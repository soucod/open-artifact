/**
 * `ensureDaemon({ spawn })` and `createHarness({ daemon: { spawn } })`: a host that starts the daemon process itself
 * (an Electron app with its `RunAsNode` fuse off uses `utilityProcess.fork`). The kit hands it the entry, the arguments,
 * the environment and the log file; it still waits for the daemon, tries the next runtime when one fails, and says what
 * the host's start threw. Each "runtime" is a stand-in daemon that writes `daemon.json` naming itself.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { PROTOCOL_MAX, PROTOCOL_MIN } from '@open-artifact/protocol';
import { createHarness, ensureDaemon, type DaemonStart } from '../src/index.ts';

/** A daemon that answers health and writes daemon.json naming itself and its argv, then stays until killed. */
const fakeDaemon = (name: string, version: string): string => `
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.OPEN_ARTIFACT_HOME;
const server = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ openArtifact: 1, version: ${JSON.stringify(version)} })); });
server.listen(0, '127.0.0.1', () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'daemon.json'), JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port, pid: process.pid, token: 't', version: ${JSON.stringify(version)}, which: ${JSON.stringify(name)}, args: process.argv.slice(2) }));
});
`;

/** A runtime that ends at once without a daemon. */
const broken = 'process.exit(3);\n';

const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oa-kit-spawn-'));
  dirs.push(dir);
  return join(dir, 'home');
}

/** A shared runtime `<home>/runtime/<version>/` whose entry is `script`. */
function shared(at: string, version: string, script: string): string {
  const dir = join(at, 'runtime', version);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'open-artifact', version, openArtifact: { protocols: { min: PROTOCOL_MIN, max: PROTOCOL_MAX } } }));
  writeFileSync(join(dir, 'scripts', 'open-artifact.mjs'), script);
  return join(dir, 'scripts', 'open-artifact.mjs');
}

/** The host's start: plain Node here, as utilityProcess.fork would run it; records what it was given. */
function hostSpawn(seen: DaemonStart[]) {
  return (start: DaemonStart): ChildProcess => {
    seen.push(start);
    const child = spawn(process.execPath, [start.bin, ...start.args], { env: start.env, stdio: 'ignore' });
    children.push(child);
    return child;
  };
}

const cleanEnv = (at: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, OPEN_ARTIFACT_HOME: at };
  delete env.OPEN_ARTIFACT_DAEMON_BIN;
  return env;
};

describe('ensureDaemon with the host starting the process (spawn)', () => {
  it('hands the host the entry, daemon run, the environment with the home, and the log file; the kit does not start one', async () => {
    const at = home();
    const bin = shared(at, '9.0.0', fakeDaemon('shared', '9.0.0'));
    const seen: DaemonStart[] = [];
    const state = (await ensureDaemon({ env: { ...cleanEnv(at), ELECTRON_RUN_AS_NODE: '1' }, home: at, timeoutMs: 10_000, spawn: hostSpawn(seen) })) as unknown as { which: string; args: string[] };
    assert.equal(state.which, 'shared');
    assert.deepEqual(state.args, ['daemon', 'run']);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.bin, bin);
    assert.deepEqual(seen[0]!.args, ['daemon', 'run']);
    assert.equal(seen[0]!.env.OPEN_ARTIFACT_HOME, at);
    assert.equal(seen[0]!.env.ELECTRON_RUN_AS_NODE, undefined, 'the host runs Node by its own means');
    assert.equal(seen[0]!.logFile, join(at, 'logs', 'daemon.out'));
  });

  it('a running daemon is used: the host is not asked', async () => {
    const at = home();
    shared(at, '9.0.0', fakeDaemon('shared', '9.0.0'));
    const seen: DaemonStart[] = [];
    await ensureDaemon({ env: cleanEnv(at), home: at, timeoutMs: 10_000, spawn: hostSpawn(seen) });
    await ensureDaemon({ env: cleanEnv(at), home: at, timeoutMs: 10_000, spawn: hostSpawn(seen) });
    assert.equal(seen.length, 1);
  });

  it('tries the next runtime when the host start throws, or the process it returns ends without a daemon', async () => {
    const at = home();
    shared(at, '9.0.0', broken);
    shared(at, '8.0.0', '');
    shared(at, '7.0.0', fakeDaemon('seven', '7.0.0'));
    const seen: DaemonStart[] = [];
    const start = hostSpawn(seen);
    const state = (await ensureDaemon({
      env: cleanEnv(at),
      home: at,
      timeoutMs: 10_000,
      spawn: (s) => {
        if (s.bin.includes(join('runtime', '8.0.0'))) {
          seen.push(s);
          throw new Error('the host refused');
        }
        return start(s);
      },
    })) as unknown as { which: string };
    assert.equal(state.which, 'seven');
    assert.deepEqual(
      seen.map((s) => s.bin.split(/[\\/]runtime[\\/]/)[1]?.split(/[\\/]/)[0]),
      ['9.0.0', '8.0.0', '7.0.0'],
    );
  });

  it('says what the host start threw when no runtime starts', async () => {
    const at = home();
    shared(at, '9.0.0', fakeDaemon('shared', '9.0.0'));
    await assert.rejects(
      ensureDaemon({ env: cleanEnv(at), home: at, timeoutMs: 3_000, spawn: async () => Promise.reject(new Error('utilityProcess is not available')) }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, 'daemon_failed');
        assert.match(error.message, /utilityProcess is not available/);
        assert.match(error.message, /daemon\.out/);
        return true;
      },
    );
  });

  it('a start that returns nothing is waited for until the daemon answers', async () => {
    const at = home();
    shared(at, '9.0.0', fakeDaemon('shared', '9.0.0'));
    const seen: DaemonStart[] = [];
    const start = hostSpawn(seen);
    const state = (await ensureDaemon({
      env: cleanEnv(at),
      home: at,
      timeoutMs: 10_000,
      spawn: async (s) => {
        await new Promise((done) => setTimeout(done, 300));
        start(s);
      },
    })) as unknown as { which: string };
    assert.equal(state.which, 'shared');
  });

  it('createHarness passes daemon.spawn through', async () => {
    const at = home();
    shared(at, '9.0.0', fakeDaemon('shared', '9.0.0'));
    const seen: DaemonStart[] = [];
    const env = cleanEnv(at);
    const harness = await createHarness({ harness: 'spawn-test', agentName: 'Agent', home: at, daemon: { env, timeoutMs: 10_000, spawn: hostSpawn(seen) }, reconnect: { minMs: 60_000, maxMs: 60_000 }, caps: { tools: 'native', library: 'own' }, wake: () => 'queued' });
    try {
      // The stand-in speaks no Harness API: the connection fails, but the host was asked to start it.
      await harness.ready().catch(() => undefined);
      assert.equal(seen.length, 1);
      assert.equal(seen[0]!.env.OPEN_ARTIFACT_HOME, at);
    } finally {
      harness.close();
    }
  });
});
