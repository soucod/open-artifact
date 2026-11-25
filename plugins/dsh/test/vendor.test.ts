/**
 * Which daemon the plugin starts: the vendored one is its own runtime, one candidate of the kit's choice, so a newer
 * shared runtime on the computer starts instead; `daemonBin` names one and skips the choice. Each "runtime" here is a
 * stand-in daemon that says in `daemon.json` which one it is and which Shell folder it was given.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { daemonStartPlan, ensureDaemon, runtimeInfo } from '@open-artifact/harness-kit';
import { PROTOCOL_MAX, PROTOCOL_MIN } from '@open-artifact/protocol';
import { daemonOptions, packageRoot, runtimeOf, vendorPaths } from '../src/server/vendor.ts';

/** A daemon that answers health and writes daemon.json naming itself, then stays until killed. */
const fakeDaemon = (name: string, version: string) => `
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.OPEN_ARTIFACT_HOME;
const server = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ openArtifact: 1 })); });
server.listen(0, '127.0.0.1', () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'daemon.json'), JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port, pid: process.pid, token: 't', version: ${JSON.stringify(version)}, which: ${JSON.stringify(name)}, shellDir: process.env.OPEN_ARTIFACT_SHELL_DIR ?? null }));
});
`;

const dirs: string[] = [];
const pids: number[] = [];
afterEach(() => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A built plugin folder (package.json + vendor/) at `version`, and an empty home. */
function setUp(version = '0.13.0') {
  const dir = mkdtempSync(join(tmpdir(), 'oa-dsh-vendor-'));
  dirs.push(dir);
  const root = join(dir, 'plugin');
  mkdirSync(join(root, 'vendor', 'shell'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-open-artifact', version }));
  writeFileSync(join(root, 'vendor', 'open-artifact.mjs'), fakeDaemon('vendored', version));
  const home = join(dir, 'home');
  mkdirSync(home);
  return { dir, root, home };
}

/** A shared runtime `<home>/runtime/<version>/`. */
function shared(home: string, version: string) {
  const dir = join(home, 'runtime', version);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'open-artifact', version, openArtifact: { protocols: { min: PROTOCOL_MIN, max: PROTOCOL_MAX } } }));
  writeFileSync(join(dir, 'scripts', 'open-artifact.mjs'), fakeDaemon(`shared ${version}`, version));
}

async function start(root: string, home: string, config: { daemonBin?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, OPEN_ARTIFACT_HOME: home };
  delete env.OPEN_ARTIFACT_DAEMON_BIN;
  delete env.OPEN_ARTIFACT_SHELL_DIR;
  const state = (await ensureDaemon({ ...daemonOptions(config, root, env), home, timeoutMs: 10_000 })) as unknown as { pid: number; which: string; shellDir: string | null };
  pids.push(state.pid);
  return state;
}

describe('the daemon the plugin starts', () => {
  it('declares the vendored daemon as its own runtime, not as an override', () => {
    const { root, home } = setUp();
    const options = daemonOptions({}, root, { OPEN_ARTIFACT_HOME: home });
    assert.equal(options.bin, undefined);
    // The runtime is the plugin folder (scripts/open-artifact.mjs beside vendor/), not vendor/ itself.
    assert.deepEqual(runtimeOf(root), { dir: root, version: '0.13.0', update: 'bundled' });
    assert.deepEqual(options.own, { dir: root, bin: join(root, 'vendor', 'open-artifact.mjs'), version: '0.13.0', protocols: { min: PROTOCOL_MIN, max: PROTOCOL_MAX } });
    assert.equal(daemonStartPlan({ ...options, home }).override, false);
  });

  it('names a folder the daemon takes for a runtime once it has the launcher, at the version it says', () => {
    const { root } = setUp('0.13.0');
    // Without scripts/open-artifact.mjs the folder is no runtime: the daemon would not record it from hello.
    assert.equal(runtimeInfo(runtimeOf(root).dir), null);
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'scripts', 'open-artifact.mjs'), '');
    writeFileSync(join(root, 'vendor', 'runtime.json'), JSON.stringify({ version: '0.13.0', protocols: { min: PROTOCOL_MIN, max: PROTOCOL_MAX } }));
    assert.deepEqual(runtimeInfo(runtimeOf(root).dir), { bin: join(root, 'scripts', 'open-artifact.mjs'), version: '0.13.0', protocols: { min: PROTOCOL_MIN, max: PROTOCOL_MAX } });
  });

  it('the built plugin folder is that runtime folder', { skip: existsSync(vendorPaths().bin) ? false : 'plugins/dsh is not built (npm run build)' }, () => {
    const root = packageRoot();
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
    assert.deepEqual(runtimeInfo(runtimeOf().dir), { bin: join(root, 'scripts', 'open-artifact.mjs'), version, protocols: { min: PROTOCOL_MIN, max: PROTOCOL_MAX } });
    // What npm publishes carries the launcher too.
    const { files } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] };
    assert.ok(files.includes('scripts/open-artifact.mjs'));
  });

  it('starts the vendored daemon when it is the newest, with its own Shell', async () => {
    const { root, home } = setUp('0.13.0');
    shared(home, '0.12.0');
    const state = await start(root, home);
    assert.equal(state.which, 'vendored');
    assert.equal(state.shellDir, join(root, 'vendor', 'shell'));
  });

  it('starts a newer shared runtime instead, without the vendored folders', async () => {
    const { root, home } = setUp('0.13.0');
    shared(home, '0.14.0');
    const state = await start(root, home);
    assert.equal(state.which, 'shared 0.14.0');
    // The vendored Shell belongs to the vendored runtime: the shared one brings its own.
    assert.equal(state.shellDir, null);
  });

  it('starts what the daemonBin setting names, skipping the choice', async () => {
    const { dir, root, home } = setUp('0.13.0');
    shared(home, '0.14.0');
    const bin = join(dir, 'pinned.mjs');
    writeFileSync(bin, fakeDaemon('pinned', '0.13.0'));
    const options = daemonOptions({ daemonBin: bin }, root, { OPEN_ARTIFACT_HOME: home });
    assert.equal(options.bin, bin);
    assert.equal((await start(root, home, { daemonBin: bin })).which, 'pinned');
  });
});
