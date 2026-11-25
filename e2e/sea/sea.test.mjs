/**
 * The single executable end to end (`npm run test:sea`; not part of `npm test` or `npm run e2e`: building one takes a
 * few seconds and a 100 MB+ file). Builds `open-artifact-<platform>-<arch>` for this computer with
 * scripts/build-sea.mjs, then runs it with a temporary home and a PATH that has no `node`: `--version`, the daemon,
 * the type list, a static type's artifact and a server type's (whose type server the executable starts),
 * `harness --stdio` hello, and `doctor`.
 *
 * The Node that builds it (and is inside it) is `$OPEN_ARTIFACT_SEA_NODE`, else the one running the test. It must be
 * an official Node.js build of 25.5 or newer; with any other the test is skipped and says why. Needs `npm run build`
 * and `node scripts/build-skill.mjs` first (skipped otherwise).
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { buildSea, checkBaseNode, executableName, SeaBuildError } from '../../scripts/build-sea.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const base = process.env.OPEN_ARTIFACT_SEA_NODE || process.execPath;

/** Why this computer cannot run the test, or `null`. */
function whyNot() {
  if (!existsSync(join(ROOT, 'skills', 'open-artifact', 'vendor', 'open-artifact.mjs'))) return 'skills/open-artifact/vendor is missing (npm run build, then node scripts/build-skill.mjs)';
  try {
    checkBaseNode(base);
    return null;
  } catch (error) {
    if (error instanceof SeaBuildError) return error.message;
    throw error;
  }
}

const skip = whyNot();
if (skip) console.log(`# sea: skipped: ${skip}`);

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'oa-sea-')));
const home = join(scratch, 'home');
const types = join(scratch, 'types');
const work = join(scratch, 'work');
const exe = join(scratch, executableName());
let built = null;

/** PATH without any folder that holds a `node`. */
const PATH = (process.env.PATH ?? '')
  .split(delimiter)
  .filter((dir) => dir && !['node', 'node.exe'].some((name) => existsSync(join(dir, name))))
  .join(delimiter);

/** The environment of every run: nothing of this computer's Open Artifact, no network, no browser. */
const ENV = {
  PATH,
  HOME: scratch,
  USERPROFILE: scratch,
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  OPEN_ARTIFACT_HOME: home,
  OPEN_ARTIFACT_USER_TYPES: types,
  OPEN_ARTIFACT_BROWSER: 'none',
  OPEN_ARTIFACT_RUNTIME_UPDATE: 'off',
  OPEN_ARTIFACT_REGISTRY: 'http://127.0.0.1:9/',
  OPEN_ARTIFACT_MACHINE_POLICY: join(scratch, 'no-policy.json'),
};

/** Runs the executable; returns its output (throws on a non-zero exit unless `allowFail`). */
function run(args, { allowFail = false } = {}) {
  const result = spawnSync(exe, args, { cwd: work, env: ENV, encoding: 'utf8', timeout: 60_000 });
  if (!allowFail && result.status !== 0) throw new Error(`${args.join(' ')} exited ${result.status ?? result.signal}:\n${result.stdout}\n${result.stderr}`);
  return result;
}
const json = (args) => JSON.parse(run(args).stdout);

after(() => {
  if (built) run(['daemon', 'stop'], { allowFail: true });
  rmSync(scratch, { recursive: true, force: true });
});

test('sea: build the executable for this platform', { skip: skip ?? false, timeout: 300_000 }, () => {
  mkdirSync(work, { recursive: true });
  mkdirSync(join(types, 'hello-static'), { recursive: true });
  writeFileSync(join(types, 'hello-static', 'index.html'), '<!doctype html><title>Hello</title><p>A static type.</p>\n');
  built = buildSea({ node: base, out: exe });
  console.log(`# sea: ${built.file}: ${built.version} on Node ${built.node}, ${(built.size / (1 << 20)).toFixed(1)} MB; ${built.signed}`);
  assert.ok(statSync(exe).size > 1 << 20);
  assert.equal(spawnSync('node', ['--version'], { env: ENV }).error?.code, 'ENOENT', 'the PATH the executable runs with has no node');
});

test('sea: --version, then the first command unpacks the runtime into the shared folder', { skip: skip ?? false, timeout: 120_000 }, () => {
  assert.ok(built, 'built');
  assert.equal(run(['--version']).stdout.trim(), built.version);
  assert.equal(existsSync(join(home, 'runtime')), false, '--version unpacks nothing');
  assert.equal(run(['home']).stdout.trim(), home);
  const dir = join(home, 'runtime', built.version);
  const record = JSON.parse(readFileSync(join(dir, '.install.json'), 'utf8'));
  assert.equal(record.executable, exe);
  assert.ok(existsSync(join(dir, 'scripts', 'open-artifact.mjs')));
  assert.ok(existsSync(join(dir, 'vendor', 'shell')));
});

test('sea: the daemon, types, a static and a server artifact, harness --stdio and doctor, with no node', { skip: skip ?? false, timeout: 180_000 }, async () => {
  assert.ok(built, 'built');
  const state = json(['daemon', 'ensure']);
  assert.equal(state.version, built.version);
  if (process.platform !== 'win32') {
    const command = spawnSync('ps', ['-o', 'command=', '-p', String(state.pid)], { encoding: 'utf8' }).stdout;
    assert.ok(command.startsWith(exe), `the daemon runs in the executable: ${command}`);
  }

  const listed = json(['artifact', JSON.stringify({ action: 'list', scope: 'types' })]);
  const ids = listed.types.map((t) => t.id);
  for (const id of ['hello-static', 'whiteboard', 'slides', 'docs']) assert.ok(ids.includes(id), `${id} in ${ids}`);

  const page = json(['artifact', JSON.stringify({ action: 'publish', type_url: 'open-artifact://type/hello-static', title: 'Static one' })]);
  assert.match(page.url, /^open-artifact:\/\/artifact\/art_/);
  const board = json(['artifact', JSON.stringify({ action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Board one' })]);
  assert.match(board.url, /^open-artifact:\/\/artifact\/art_/);
  // A type action runs on the type's server: the daemon starts it with the executable, as `node scripts/cli.mjs serve`.
  const checked = json(['artifact', JSON.stringify({ action: 'call', url: board.url, name: 'check' })]);
  assert.equal(checked.error, undefined, JSON.stringify(checked));
  const serverLog = readFileSync(join(home, 'logs', 'servers', 'whiteboard.log'), 'utf8');
  assert.match(serverLog, /"openArtifact":"ready"/);
  const view = await fetch(board.view_url);
  assert.equal(view.status, 200);

  // harness --stdio: hello, answered by the daemon over the bridge.
  const bridge = spawn(exe, ['harness', '--stdio', '--harness', 'sea-host'], { cwd: work, env: ENV, stdio: ['pipe', 'pipe', 'pipe'] });
  const hello = await new Promise((done, fail) => {
    let buffer = '';
    const timer = setTimeout(() => fail(new Error(`no hello answer: ${buffer}`)), 30_000);
    bridge.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (const line of buffer.split('\n')) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          clearTimeout(timer);
          done(message);
        }
      }
    });
    bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'hello', params: { caps: {} } })}\n`);
  });
  bridge.stdin.end();
  assert.equal(hello.result?.daemon, built.version, JSON.stringify(hello));

  const doctor = run(['doctor']);
  assert.match(doctor.stdout, /0 failed/);
  assert.match(doctor.stdout, new RegExp(`Runtime ${built.version.replace(/\./g, '\\.')} starts the daemon`));
});
