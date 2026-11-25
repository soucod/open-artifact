#!/usr/bin/env node
/**
 * Builds the harness plugins into `dist/plugins/<name>/`, each a folder that installs on its own:
 *
 *   plugins/<name>/            the plugin's own files (manifest, hooks, MCP config, README), copied as they are
 *   LICENSE, NOTICE            the repository's license files, copied into every plugin
 *   skills/open-artifact/      the skill with its vendored daemon, copied into every plugin as skills/open-artifact/
 *
 * and the marketplace files that list them (`dist/plugins/.claude-plugin/marketplace.json` and the like, from
 * `plugins/_marketplace/`). The skill is built first (scripts/build-skill.mjs), which needs `node scripts/build.mjs`.
 *
 *   node scripts/build-plugins.mjs [--only <name>] [--no-skill]
 *
 * plugins/dsh (DeepSeek Harness) is an npm package built by its own script, through `node scripts/build.mjs`.
 *
 * A plugin's `test/` folder stays behind. A plugin with code that imports workspace packages lists it in `BUNDLED`:
 * that file is bundled with esbuild into one dependency-free ES module in its place (plugins/zcode's extension, which
 * imports @open-artifact/harness-kit and which ZCode loads as it is).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repo, 'plugins');
const out = join(repo, 'dist', 'plugins');
const skill = join(repo, 'skills', 'open-artifact');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const only = arg('only');

/** Per plugin, the files bundled in place (paths inside the plugin folder). */
const BUNDLED = { zcode: ['extension/index.mjs'] };
const log = (message) => console.log(`plugins build: ${message}`);

if (!process.argv.includes('--no-skill') || !existsSync(join(skill, 'vendor', 'open-artifact.mjs'))) {
  const run = spawnSync(process.execPath, [join(repo, 'scripts', 'build-skill.mjs')], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error('the skill build failed');
}

// plugins/dsh is an npm package with its own build (plugins/dsh/scripts/build.mjs, run by scripts/build.mjs): not copied here.
const plugins = readdirSync(source).filter(
  (name) => !name.startsWith('_') && !name.startsWith('.') && statSync(join(source, name)).isDirectory() && !existsSync(join(source, name, 'package.json')),
);
mkdirSync(out, { recursive: true });
for (const name of plugins) {
  if (only && only !== name) continue;
  const target = join(out, name);
  rmSync(target, { recursive: true, force: true });
  const from = join(source, name);
  cpSync(from, target, { recursive: true, filter: (path) => basename(path) !== 'node_modules' && relative(from, path) !== 'test' });
  for (const file of BUNDLED[name] ?? []) {
    buildSync({
      entryPoints: [join(from, file)],
      outfile: join(target, file),
      allowOverwrite: true,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      legalComments: 'none',
      logLevel: 'warning',
    });
  }
  cpSync(skill, join(target, 'skills', 'open-artifact'), { recursive: true });
  for (const file of ['LICENSE', 'NOTICE']) cpSync(join(repo, file), join(target, file));
  log(`dist/plugins/${name}`);
}
const marketplace = join(source, '_marketplace');
if (existsSync(marketplace) && !only) {
  cpSync(marketplace, out, { recursive: true });
  log('dist/plugins (marketplace files)');
}
