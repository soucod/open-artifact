/**
 * The single executable's entry (sea.ts), without building one: which arguments are scripts, and unpacking the
 * embedded runtime into the shared folder (`<home>/runtime/<version>/`) as an install does. The packer of
 * scripts/build-sea.mjs is checked against the runtime's tarball reader. Building and running a real executable is
 * `npm run test:sea` (e2e/sea/).
 */

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { daemonStartPlan, rankRuntimes, runtimeCandidates, runtimeInfo, sharedRuntimesOf } from '@open-artifact/harness-kit';
import { tempDir } from './helpers.ts';
import { makeRuntime, runtimeTarball, sri } from './runtime-fixtures.ts';
import { ensureUnpacked, scriptArgument, type EmbeddedRuntime } from '../src/sea.ts';
import { readTarball } from '../src/runtime.ts';
import { scriptRunner, shellWord } from '../src/paths.ts';
import { runtimeCli } from '../src/harness-skill.ts';
import { fileURLToPath } from 'node:url';
import { packFolder } from '../../../scripts/build-sea.mjs';

const embedded = (payload: Buffer, version = '7.1.0'): EmbeddedRuntime => ({ manifest: { version, integrity: sri(payload) }, payload: () => new Uint8Array(payload) });

/** The folder names in a home's shared runtimes. */
const sharedNames = (home: string): string[] => readdirSync(sharedRuntimesOf(home)).sort();

test('sea: a script argument runs as node would; a command does not', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'cli.mjs'), '');
  writeFileSync(join(dir, 'tool.cjs'), '');
  mkdirSync(join(dir, 'folder.js'));
  assert.equal(scriptArgument(['cli.mjs', 'serve'], dir), join(dir, 'cli.mjs'));
  assert.equal(scriptArgument([join(dir, 'tool.cjs')], '/'), join(dir, 'tool.cjs'));
  for (const args of [[], ['daemon', 'run'], ['--version'], ['artifact', '{"action":"list"}'], ['missing.mjs'], ['folder.js'], ['-e', 'cli.mjs']]) {
    assert.equal(scriptArgument(args, dir), null, args.join(' '));
  }
});

test('sea: the embedded runtime is unpacked once, checked, into the shared folder, and is an ordinary runtime there', () => {
  const home = tempDir();
  const payload = runtimeTarball('7.1.0');
  const first = ensureUnpacked(embedded(payload), { home, executable: '/apps/open-artifact' });
  assert.deepEqual(first, { dir: join(sharedRuntimesOf(home), '7.1.0'), state: 'unpacked' });
  assert.equal(runtimeInfo(first.dir)?.version, '7.1.0');
  const record = JSON.parse(readFileSync(join(first.dir, '.install.json'), 'utf8'));
  assert.equal(record.integrity, sri(payload));
  assert.equal(record.executable, '/apps/open-artifact');
  assert.equal(statSync(join(first.dir, 'scripts', 'open-artifact.mjs')).mode & 0o111, 0o111);
  // No staging folder is left; the second run finds it.
  assert.deepEqual(sharedNames(home), ['7.1.0']);
  assert.equal(ensureUnpacked(embedded(payload), { home }).state, 'present');
  // The selection rule sees it as a shared runtime.
  assert.deepEqual(
    runtimeCandidates(home).map((c) => [c.source, c.version]),
    [['shared', '7.1.0']],
  );
});

test('sea: a payload that does not match its sha512 is refused and nothing is left', () => {
  const home = tempDir();
  const payload = runtimeTarball('7.1.0');
  const broken: EmbeddedRuntime = { manifest: { version: '7.1.0', integrity: sri(runtimeTarball('7.1.1')) }, payload: () => new Uint8Array(payload) };
  assert.throws(() => ensureUnpacked(broken, { home }), /does not match/);
  assert.deepEqual(sharedNames(home), []);
  // A payload whose package says another version.
  const other = runtimeTarball('7.2.0');
  assert.throws(() => ensureUnpacked(embedded(other, '7.1.0'), { home }), /says 7\.2\.0/);
  assert.deepEqual(sharedNames(home), []);
});

test('sea: the same version from npm is kept; another payload an executable unpacked is replaced', () => {
  const home = tempDir();
  const target = join(sharedRuntimesOf(home), '7.1.0');
  makeRuntime(target, '7.1.0');
  writeFileSync(join(target, '.install.json'), JSON.stringify({ version: '7.1.0', integrity: 'sha512-fromnpm', registry: 'https://registry.npmjs.org/' }));
  assert.deepEqual(ensureUnpacked(embedded(runtimeTarball('7.1.0')), { home }), { dir: target, state: 'kept' });
  assert.match(readFileSync(join(target, 'scripts', 'open-artifact.mjs'), 'utf8'), /runtime 7\.1\.0/);

  const other = tempDir();
  ensureUnpacked(embedded(runtimeTarball('7.1.0')), { home: other, executable: '/old/build' });
  const rebuilt = runtimeTarball('7.1.0', [{ name: 'package/vendor/rebuilt.txt', data: 'new' }]);
  assert.equal(ensureUnpacked(embedded(rebuilt), { home: other, executable: '/new/build' }).state, 'unpacked');
  assert.ok(existsSync(join(sharedRuntimesOf(other), '7.1.0', 'vendor', 'rebuilt.txt')));
  assert.deepEqual(sharedNames(other), ['7.1.0']);
});

test('sea: build-sea packs a folder the runtime reads back, long paths and modes included', () => {
  const dir = tempDir();
  const long = `vendor/${'deep/'.repeat(30)}file.txt`;
  mkdirSync(join(dir, ...long.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(dir, long), 'deep');
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts', 'open-artifact.mjs'), 'run');
  chmodSync(join(dir, 'scripts', 'open-artifact.mjs'), 0o755);
  mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), 'left out');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '7.1.0' }));
  const entries = readTarball(packFolder(dir));
  assert.deepEqual(entries.map((e) => e.path).sort(), ['package.json', 'scripts/open-artifact.mjs', long].sort());
  assert.equal(entries.find((e) => e.path === long)?.data.toString(), 'deep');
  assert.equal(entries.find((e) => e.path === 'scripts/open-artifact.mjs')?.mode, 0o755);
  assert.equal(entries.find((e) => e.path === 'package.json')?.mode, 0o644);
});

test('sea: a runtime whose engines.node this Node does not meet is not chosen to start the daemon', () => {
  const home = tempDir();
  const newer = makeRuntime(join(sharedRuntimesOf(home), '9.0.0'), '9.0.0');
  writeFileSync(join(newer, 'package.json'), JSON.stringify({ name: '@open-artifact/cli', version: '9.0.0', engines: { node: '>=999' } }));
  makeRuntime(join(sharedRuntimesOf(home), '8.0.0'), '8.0.0');
  const ranked = rankRuntimes(runtimeCandidates(home), { protocols: { min: 1, max: 1 } });
  assert.deepEqual(ranked.map((c) => c.version), ['8.0.0']);
  assert.equal(daemonStartPlan({ home, env: { OPEN_ARTIFACT_HOME: home }, protocols: { min: 1, max: 1 } }).tries[0]?.version, '8.0.0');
});

test('scripts an agent is told to run start with the program actually running: node, or the executable itself', () => {
  assert.equal(scriptRunner({ execPath: '/usr/local/bin/node', sea: false, electron: false }), 'node');
  assert.equal(scriptRunner({ execPath: 'C:\\Program Files\\nodejs\\node.exe', sea: false, electron: false }), 'node');
  assert.equal(scriptRunner({ execPath: '/Applications/Agent.app/Contents/MacOS/Agent', sea: false, electron: true }), 'node');
  assert.equal(scriptRunner({ execPath: '/opt/oa/open-artifact', sea: true, electron: false }), '/opt/oa/open-artifact');
  assert.equal(scriptRunner({ execPath: '/Users/a b/oa/open-artifact', sea: true, electron: false }), '"/Users/a b/oa/open-artifact"');
  // A runtime named something else than node (not inside the executable) is still the program to name.
  assert.equal(scriptRunner({ execPath: '/opt/node22/bin/node22', sea: false, electron: false }), '/opt/node22/bin/node22');
  assert.equal(shellWord('/a/b'), '/a/b');
  assert.equal(shellWord('/a b/$x', 'linux'), '"/a b/\\$x"');
  assert.equal(shellWord('C:\\Program Files\\oa.exe', 'win32'), '"C:\\Program Files\\oa.exe"');
  // Under the test's own Node.js, the text stays as it always was.
  assert.equal(scriptRunner(), 'node');
  assert.match(runtimeCli(fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url))), /^(node .*open-artifact\.mjs|open-artifact)$/);
});
