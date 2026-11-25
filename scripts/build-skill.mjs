#!/usr/bin/env node
/**
 * Builds the `open-artifact` skill (skills/open-artifact/) for harnesses without an Open Artifact plugin: Claude Code,
 * Codex and any agent that reads skills and runs shell commands. The skill folder holds everything it runs, so it
 * can be copied anywhere (~/.claude/skills/, ~/.agents/skills/, a project's .claude/skills/):
 *
 *   skills/open-artifact/SKILL.md                  what the agent reads on `/open-artifact <type> …` (tracked): the
 *                                                  skill template (packages/protocol/src/skill.ts) rendered with its
 *                                                  defaults, written here when it changed
 *   skills/open-artifact/scripts/open-artifact.mjs the command the agent runs: points the daemon at vendor/ (tracked)
 *   skills/open-artifact/vendor/                   built here, git ignores it:
 *     open-artifact.mjs                            the daemon and its CLI, one Node ESM file
 *     shell/, home/                                the Shell every artifact page opens in, and the home page
 *     frame-host/                                  the type server of original hosted types (found next to open-artifact.mjs)
 *     harnesses/                                   the harness profiles
 *     type-server/                                 the built type server every built-in type runs (dist/server/)
 *     artifact-types/<id>/                         the built-in types, each scripts/cli.mjs running type-server/
 *                                                  (scripts/vendor-types.mjs)
 *
 * Run `node scripts/build.mjs` first (the Shell, frame-host and the type server come from it); a piece that is
 * not there is skipped with a warning.
 *
 *   node scripts/build-skill.mjs [--out <dir>]     --out also copies the finished skill folder there
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { renderSkill } from '../packages/protocol/src/skill.ts';
import { PROTOCOL_MAX, PROTOCOL_MIN } from '../packages/protocol/src/harness.ts';
import { vendorTypes } from './vendor-types.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = join(repo, 'skills', 'open-artifact');
const vendor = join(skill, 'vendor');
// The built-in types: the protocol's list (BUILTIN_TYPE_IDS), as the daemon lists no other type from the built-in root.
const TYPES = JSON.parse(
  /BUILTIN_TYPE_IDS[^=]*=\s*(?:Object\.freeze\()?(\[[^\]]*\])/
    .exec(readFileSync(join(repo, 'packages', 'protocol', 'src', 'type-authoring.ts'), 'utf8'))[1]
    .replace(/'/g, '"'),
);

const warn = (message) => console.warn(`open-artifact skill build: ${message}`);
const log = (message) => console.log(`open-artifact skill build: ${message}`);
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

/** Copies a folder into vendor/, leaving out node_modules; warns when it is not there. */
function vendorCopy(from, to, what) {
  if (!isDir(from)) return warn(`${what}: ${relative(repo, from)} is not there; skipped.`);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (path) => basename(path) !== 'node_modules' });
}

function bundleDaemon() {
  const entry = join(repo, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
  buildSync({
    entryPoints: [entry],
    outfile: join(vendor, 'open-artifact.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    // Bundled ESM still meets CommonJS dependencies that call require().
    banner: { js: "import { createRequire as __openArtifactCreateRequire } from 'node:module'; const require = __openArtifactCreateRequire(import.meta.url);" },
  });
}

/** SKILL.md: the template's default rendering (the same text `open-artifact skill render` prints). */
function writeSkillFile() {
  const file = join(skill, 'SKILL.md');
  const text = renderSkill();
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
  writeFileSync(file, text);
  log('SKILL.md rendered from packages/protocol/src/skill.ts');
}

function main() {
  writeSkillFile();
  rmSync(vendor, { recursive: true, force: true });
  mkdirSync(vendor, { recursive: true });
  bundleDaemon();
  log('vendor/open-artifact.mjs');
  // What this runtime is, for choosing among the runtimes on a computer (packages/harness-kit/src/runtimes.ts).
  const daemonVersion = JSON.parse(readFileSync(join(repo, 'packages', 'daemon', 'package.json'), 'utf8')).version;
  writeFileSync(join(vendor, 'runtime.json'), `${JSON.stringify({ version: daemonVersion, protocols: { min: PROTOCOL_MIN, max: PROTOCOL_MAX } }, null, 2)}\n`);
  vendorCopy(join(repo, 'dist', 'daemon', 'shell'), join(vendor, 'shell'), 'the Shell');
  vendorCopy(join(repo, 'dist', 'daemon', 'home'), join(vendor, 'home'), 'the home page');
  vendorCopy(join(repo, 'dist', 'daemon', 'frame-host'), join(vendor, 'frame-host'), 'frame-host');
  vendorCopy(join(repo, 'packages', 'daemon', 'harnesses'), join(vendor, 'harnesses'), 'the harness profiles');
  // One type server for every type, not a copy in each (scripts/vendor-types.mjs).
  vendorTypes({ repo, vendor, types: TYPES, warn, log });
  log('vendor/');
  const i = process.argv.indexOf('--out');
  if (i > 0) {
    const out = resolve(process.argv[i + 1] ?? '');
    if (!process.argv[i + 1]) throw new Error('--out <dir>');
    rmSync(out, { recursive: true, force: true });
    cpSync(skill, out, { recursive: true });
    log(`copied to ${out}`);
  }
}

main();
