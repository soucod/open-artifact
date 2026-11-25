/**
 * Vendors the built-in types with one shared type server, for the bundles that carry the daemon (the skill, so the
 * plugins and @open-artifact/cli, and the DSH plugin):
 *
 *   vendor/type-server/                       the built server (scripts/build.mjs's dist/server/): cli.mjs, every
 *                                             editor, support.js, sheets.wasm, motion-tools.html, the PDF reader, the Shell
 *   vendor/artifact-types/<type>/             each type's own files (manifest, SKILL.md, references), without scripts/
 *   vendor/artifact-types/<type>/scripts/cli.mjs
 *                                             a few lines that run the shared server's CLI (not for a page type:
 *                                             frame-host, vendored beside the daemon, runs its artifacts)
 *
 * In the repository each type's scripts/ is a whole copy of dist/server/, so a type folder works on its own once
 * installed; every copy carries every editor, as one background server serves every type. Seven such copies made the
 * bundles over 300 MB, so here they share one. The server finds its editors and engines beside its own file
 * (import.meta.url), and starts its background server from that file, so the shared copy serves every type.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

/** Whether the type folder is a page type: its artifact-type.json says openArtifact.style "page". */
function isPageType(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'artifact-type.json'), 'utf8'))?.openArtifact?.style === 'page';
  } catch {
    return false;
  }
}

/** What a type's scripts/cli.mjs says: run the shared server's CLI (vendor/type-server/cli.mjs). */
const SHIM = `#!/usr/bin/env node
// The built-in types share one type server, ../../../type-server/ (its editors, engines and pages), instead of a copy
// each. Written by scripts/vendor-types.mjs; do not edit.
import { main } from '../../../type-server/cli.mjs';

try {
  const code = await main(process.argv.slice(2));
  if (code >= 0) process.exit(code);
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
`;

/**
 * Copies the built server once into `<vendor>/type-server/` and each type of `types` into
 * `<vendor>/artifact-types/<type>/` with a scripts/cli.mjs that runs it.
 */
export function vendorTypes({ repo, vendor, types, warn, log = () => {} }) {
  const server = join(repo, 'dist', 'server');
  const shared = join(vendor, 'type-server');
  rmSync(shared, { recursive: true, force: true });
  const built = isDir(join(server, 'editors')) && existsSync(join(server, 'cli.mjs'));
  if (built) {
    cpSync(server, shared, { recursive: true });
    log('vendor/type-server/');
  } else warn(`the type server: ${relative(repo, server)} is not built (run node scripts/build.mjs first); the types' pages will not open.`);

  for (const type of types) {
    const from = join(repo, 'artifact-types', type);
    const to = join(vendor, 'artifact-types', type);
    if (!isDir(from)) {
      warn(`the ${type} type: ${relative(repo, from)} is not there; skipped.`);
      continue;
    }
    rmSync(to, { recursive: true, force: true });
    const ownScripts = join(from, 'scripts') + sep;
    cpSync(from, to, {
      recursive: true,
      filter: (path) => basename(path) !== 'node_modules' && !(path + sep).startsWith(ownScripts),
    });
    // A page type (openArtifact.style "page") has no CLI of its own: frame-host runs its artifacts.
    if (built && !isPageType(from)) {
      mkdirSync(join(to, 'scripts'), { recursive: true });
      writeFileSync(join(to, 'scripts', 'cli.mjs'), SHIM, { mode: 0o755 });
    }
  }
}
