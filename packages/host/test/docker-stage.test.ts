/**
 * The Docker image carries only the workspace packages `deploy/docker/stage.sh` lists (`PACKAGES`). This walks the
 * imports the host runs, from `packages/host/src/node/main.ts` through every workspace package they reach (static
 * `import`/`export … from`, and `import('…')` of a literal), and checks each package reached is in that list, so a new
 * import cannot leave the image unable to start. Type-only imports are erased when Node strips the types, so they are
 * not followed. `@open-artifact/host-plugin` is listed in any case: a site's plugins import it from the host.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = join(REPO, 'packages/host/src/node/main.ts');

type Exports = string | { [key: string]: Exports } | null;
interface Workspace {
  dir: string;
  folder: string;
  exports: Exports;
}

function workspaces(): Map<string, Workspace> {
  const out = new Map<string, Workspace>();
  for (const folder of readdirSync(join(REPO, 'packages'))) {
    const file = join(REPO, 'packages', folder, 'package.json');
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { name: string; exports?: Exports; main?: string };
    out.set(manifest.name, { dir: join(REPO, 'packages', folder), folder, exports: manifest.exports ?? manifest.main ?? './index.js' });
  }
  return out;
}

/** The file an `exports` entry names for Node (conditions node, import, default), or null. */
function pick(entry: Exports | undefined): string | null {
  if (entry === undefined || entry === null) return null;
  if (typeof entry === 'string') return entry;
  for (const condition of ['node', 'import', 'default']) {
    const found = pick(entry[condition]);
    if (found) return found;
  }
  return null;
}

function exported(ws: Workspace, subpath: string): string | null {
  const { exports } = ws;
  if (typeof exports === 'string') return subpath === '.' ? join(ws.dir, exports) : null;
  if (!exports) return null;
  const keys = Object.keys(exports);
  if (!keys.some((k) => k.startsWith('.'))) return subpath === '.' ? (pick(exports) ? join(ws.dir, pick(exports)!) : null) : null;
  const direct = pick(exports[subpath]);
  if (direct) return join(ws.dir, direct);
  for (const key of keys) {
    if (!key.includes('*')) continue;
    const [head, tail] = key.split('*') as [string, string];
    if (subpath.startsWith(head) && subpath.endsWith(tail)) {
      const target = pick(exports[key]);
      if (target) return join(ws.dir, target.replace('*', subpath.slice(head.length, subpath.length - tail.length)));
    }
  }
  return null;
}

/** The specifiers a module imports at run time. */
function importsOf(source: string): string[] {
  const out: string[] = [];
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const match of text.matchAll(/(?:^|[;\n])\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    if (match[2]) continue; // `import type … from`, `export type … from`
    out.push(match[4]!);
  }
  for (const match of text.matchAll(/(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g)) out.push(match[1]!);
  for (const match of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(match[1]!);
  return out;
}

function reached(): Set<string> {
  const all = workspaces();
  const seen = new Set<string>();
  const folders = new Set<string>(['host']);
  const queue = [MAIN];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !/\.(ts|tsx|mts|js|mjs)$/.test(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      let target: string | null = null;
      if (spec.startsWith('.')) target = resolve(dirname(file), spec);
      else {
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
        const ws = all.get(name);
        if (!ws) continue; // a dependency from npm (npm ci installs those) or a built-in
        folders.add(ws.folder);
        target = exported(ws, spec === name ? '.' : `.${spec.slice(name.length)}`);
      }
      if (target) queue.push(target);
    }
  }
  return folders;
}

function staged(): Set<string> {
  const script = readFileSync(join(REPO, 'deploy/docker/stage.sh'), 'utf8');
  const list = /^PACKAGES="([^"]*)"/m.exec(script);
  assert.ok(list, 'stage.sh has a PACKAGES list');
  return new Set(list[1]!.split(/\s+/).filter(Boolean));
}

test('stage.sh copies every workspace package the host imports (and host-plugin, which plugins import)', () => {
  const needed = reached();
  const listed = staged();
  assert.ok(needed.size > 10, `the walk found the host's packages (${[...needed].join(' ')})`);
  const missing = [...needed].filter((folder) => !listed.has(folder));
  assert.deepEqual(missing, [], `add to PACKAGES in deploy/docker/stage.sh: ${missing.join(' ')}`);
  assert.ok(listed.has('host-plugin'), 'host-plugin is staged: plugins import it from the host');
  for (const folder of listed) assert.ok(existsSync(join(REPO, 'packages', folder, 'package.json')), `PACKAGES names packages/${folder}, which is not a workspace`);
});
