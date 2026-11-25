import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const core = fileURLToPath(new URL('../src/core/', import.meta.url));
const FORBIDDEN_PACKAGES = ['@open-artifact/type-server', '@open-artifact/server-sdk', '@open-artifact/daemon'];
const BUILTINS = new Set(builtinModules);

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** Every module specifier a file imports or re-exports (static and dynamic). */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [/\b(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.push(match[1]!);
  return found;
}

test('src/core imports no Node module and none of type-server, server-sdk or daemon', async () => {
  const list = await files(core);
  assert.ok(list.length >= 8, 'found the core files');
  const problems: string[] = [];
  for (const file of list) {
    const source = await readFile(file, 'utf8');
    for (const spec of specifiers(source)) {
      const name = relative(core, file);
      if (spec.startsWith('node:') || BUILTINS.has(spec) || BUILTINS.has(spec.split('/')[0]!)) problems.push(`${name}: ${spec}`);
      if (FORBIDDEN_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`))) problems.push(`${name}: ${spec}`);
    }
    // Node globals are not Web APIs either.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const global of ['Buffer', 'process', '__dirname', 'require']) {
      if (new RegExp(`\\b${global}\\s*[.(]`).test(code)) problems.push(`${relative(core, file)}: uses ${global}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the purity scan sees the forms of import it checks', () => {
  assert.deepEqual(specifiers(`import { a } from 'node:fs';\nexport * from "x";\nimport 'y';\nconst m = await import('z');`).sort(), ['node:fs', 'x', 'y', 'z']);
});
