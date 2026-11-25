/**
 * Node children (`node-children.ts`): which mode runs the daemon's Node.js type servers, and that a script run in a
 * worker thread sees what it would as a child process (argv, environment, working folder, stdout and stderr, a stop as
 * SIGTERM, its exit code), in both modes. Then the type servers themselves (`servers.ts`) in threads mode: ready, a
 * restart when the type changes, a crash, and the stop the daemon waits for.
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  badModeVariable,
  chooseNodeChildren,
  modeFromEnv,
  nodeChildren,
  resetNodeChildren,
  startChild,
  threadEntry,
  type NodeChild,
  type NodeChildrenMode,
} from '../src/node-children.ts';
import { TypeServers } from '../src/servers.ts';
import { readTypeFolder } from '../src/types.ts';

describe('which mode', () => {
  test('the variable: process or threads; anything else is ignored and said', () => {
    assert.equal(modeFromEnv({}), null);
    assert.equal(modeFromEnv({ OPEN_ARTIFACT_NODE_CHILDREN: 'threads' }), 'threads');
    assert.equal(modeFromEnv({ OPEN_ARTIFACT_NODE_CHILDREN: ' Process ' }), 'process');
    assert.equal(modeFromEnv({ OPEN_ARTIFACT_NODE_CHILDREN: 'thread' }), null);
    assert.match(badModeVariable({ OPEN_ARTIFACT_NODE_CHILDREN: 'thread' })!, /neither "process" nor "threads"; it is ignored/);
    assert.equal(badModeVariable({ OPEN_ARTIFACT_NODE_CHILDREN: 'threads' }), null);
    assert.equal(badModeVariable({}), null);
  });

  test('1. the variable wins anywhere', () => {
    assert.deepEqual(chooseNodeChildren({ env: { OPEN_ARTIFACT_NODE_CHILDREN: 'threads' }, electron: undefined, processType: undefined }), { mode: 'threads', reason: 'env', detail: 'OPEN_ARTIFACT_NODE_CHILDREN=threads' });
    const forced = chooseNodeChildren({ env: { OPEN_ARTIFACT_NODE_CHILDREN: 'process' }, electron: '45.0.0', processType: 'utility' });
    assert.deepEqual([forced.mode, forced.reason], ['process', 'env']);
  });

  test('2. plain Node: child processes', () => {
    assert.deepEqual(chooseNodeChildren({ env: {}, electron: undefined, processType: undefined }), { mode: 'process', reason: 'node', detail: 'plain Node.js runs child processes' });
    // This test process is plain Node.
    assert.equal(chooseNodeChildren({ env: {} }).reason, 'node');
  });

  test('3. Electron running as Node (no process.type): child processes', () => {
    const asNode = chooseNodeChildren({ env: { ELECTRON_RUN_AS_NODE: '1' }, electron: '42.11.12', processType: undefined });
    assert.deepEqual([asNode.mode, asNode.reason], ['process', 'electron']);
    assert.match(asNode.detail, /Electron 42\.11\.12 runs the daemon as Node/);
  });

  test('4. inside an Electron process (process.type set): threads, ELECTRON_RUN_AS_NODE in the environment or not', () => {
    const utility = chooseNodeChildren({ env: {}, electron: '45.2.2', processType: 'utility' });
    assert.deepEqual([utility.mode, utility.reason], ['threads', 'electron']);
    assert.match(utility.detail, /inside an Electron utility process/);
    const ignored = chooseNodeChildren({ env: { ELECTRON_RUN_AS_NODE: '1' }, electron: '42.11.12', processType: 'utility' });
    assert.equal(ignored.mode, 'threads');
    assert.equal(chooseNodeChildren({ env: {}, electron: '45.2.2', processType: 'browser' }).mode, 'threads');
  });

  test('this process decides once and keeps it', () => {
    resetNodeChildren();
    const saved = process.env.OPEN_ARTIFACT_NODE_CHILDREN;
    process.env.OPEN_ARTIFACT_NODE_CHILDREN = 'threads';
    try {
      assert.equal(nodeChildren().mode, 'threads');
      process.env.OPEN_ARTIFACT_NODE_CHILDREN = 'process';
      assert.equal(nodeChildren().mode, 'threads');
    } finally {
      if (saved === undefined) delete process.env.OPEN_ARTIFACT_NODE_CHILDREN;
      else process.env.OPEN_ARTIFACT_NODE_CHILDREN = saved;
      resetNodeChildren();
    }
  });

  test('a thread entry: node flags apart, the script resolved against the working folder', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'run.mjs'), '');
    assert.deepEqual(threadEntry(['--no-warnings', 'run.mjs', 'serve', '--type', 'x'], dir), { execArgv: ['--no-warnings'], script: join(dir, 'run.mjs'), args: ['serve', '--type', 'x'] });
    assert.throws(() => threadEntry(['--no-warnings'], dir), /no script/);
  });
});

/** A script that reports what it sees, stops on SIGTERM after writing `stopped`, and otherwise stays. */
const REPORTER = `
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = process.env.OUT;
process.env.CHANGED_BY_CHILD = 'yes';
writeFileSync(out + '.seen', JSON.stringify({ args: process.argv.slice(2), script: process.argv[1], cwd: process.cwd(), resolved: resolve('x'), mine: process.env.MINE ?? null }));
process.once('SIGTERM', () => { writeFileSync(out + '.stopped', 'yes'); setTimeout(() => process.exit(7), 20); });
console.log('to stdout');
console.error('to stderr');
setInterval(() => {}, 1000);
`;

const children: NodeChild[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

function run(mode: NodeChildrenMode, script: string, env: NodeJS.ProcessEnv = {}): { child: NodeChild; dir: string; out: string; output: () => string; exit: Promise<[number | null, string | null]> } {
  const dir = tempDir('open-artifact-child-');
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'main.mjs'), script);
  const out = join(dir, 'out');
  const child = startChild({ command: 'node', args: ['bin/main.mjs', 'serve', '--type', 'demo'], cwd: dir, env: { ...process.env, OUT: out, MINE: mode, ...env }, mode });
  children.push(child);
  let text = '';
  child.stdout?.on('data', (chunk: Buffer) => (text += chunk));
  child.stderr?.on('data', (chunk: Buffer) => (text += chunk));
  const exit = new Promise<[number | null, string | null]>((done) => child.once('exit', (code: number | null, signal: string | null) => done([code, signal])));
  return { child, dir, out, output: () => text, exit };
}

for (const mode of ['process', 'threads'] as const) {
  describe(`a Node child in ${mode} mode`, () => {
    test('sees its argv, environment and working folder; its output comes out; a stop is SIGTERM to its handler', async () => {
      const { child, dir, out, output, exit } = run(mode, REPORTER);
      assert.equal(child.mode, mode);
      assert.match(child.label, mode === 'threads' ? /^thread \d+$/ : /^pid \d+$/);
      if (mode === 'threads') assert.equal(child.instance, `${process.pid}:${child.label.slice('thread '.length)}`);
      else assert.equal(child.instance, child.pid);
      await until(() => existsSync(`${out}.seen`), 10_000);
      const seen = JSON.parse(readFileSync(`${out}.seen`, 'utf8'));
      assert.deepEqual(seen, { args: ['serve', '--type', 'demo'], script: join(dir, 'bin', 'main.mjs'), cwd: dir, resolved: join(dir, 'x'), mine: mode });
      // Its own environment: what it changes is not this process's.
      assert.equal(process.env.CHANGED_BY_CHILD, undefined);
      await until(() => output().includes('to stdout') && output().includes('to stderr'), 5000);
      child.stop(5000);
      assert.deepEqual(await exit, [7, null]);
      assert.equal(readFileSync(`${out}.stopped`, 'utf8'), 'yes');
      assert.equal(child.ended, true);
    });

    test('ends with its own exit code; a crash ends it with 1 and its stack in stderr', async () => {
      assert.deepEqual(await run(mode, 'process.exit(5);').exit, [5, null]);
      const crash = run(mode, 'setTimeout(() => { throw new Error("boom in the child"); }, 10);');
      assert.deepEqual(await crash.exit, [1, null]);
      await until(() => crash.output().includes('boom in the child'), 2000);
    });

    test('a child that ignores the stop is forced to end', async () => {
      const stubborn = run(mode, 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.log("up");');
      await until(() => stubborn.output().includes('up'), 10_000);
      stubborn.child.stop(200);
      const [code, signal] = await stubborn.exit;
      assert.ok(mode === 'threads' ? code === 1 : signal === 'SIGKILL', `${code} ${signal}`);
    });

    test('a missing script fails its start', async () => {
      const dir = tempDir();
      const child = startChild({ command: 'node', args: ['missing.mjs'], cwd: dir, env: { ...process.env }, mode });
      children.push(child);
      let text = '';
      child.stderr?.on('data', (chunk: Buffer) => (text += chunk));
      const [code] = await new Promise<[number | null]>((done) => child.once('exit', (c: number | null) => done([c])));
      assert.equal(code, 1);
      await until(() => /Cannot find module|ERR_MODULE_NOT_FOUND/.test(text), 2000);
    });
  });
}

// ---- the type servers in threads mode --------------------------------------------------------------------------------

/** A type server: ready line, health with the secret, `/open`; it writes `stopped` on SIGTERM and ends on its own when asked. */
const SERVER = `
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
const secret = process.env.OPEN_ARTIFACT_SECRET;
const server = createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer ' + secret) return void res.writeHead(401).end();
  if (req.url === '/__open-artifact/health') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"openArtifact":1}');
  if (req.url === '/__open-artifact/open') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ url: '/page/' + process.argv[2] }));
  if (req.url === '/crash') { res.end('ok'); setTimeout(() => { throw new Error('the server crashed'); }, 10); return; }
  res.writeHead(404).end();
});
server.listen(Number(process.env.OPEN_ARTIFACT_PORT) || 0, '127.0.0.1', () => {
  console.log(JSON.stringify({ openArtifact: 'ready', url: 'http://127.0.0.1:' + server.address().port + '/' }));
});
process.once('SIGTERM', () => { appendFileSync(process.env.STOPS, process.argv[2] + '\\n'); server.close(); process.exit(0); });
`;

describe('type servers in threads mode', () => {
  test('start, stop on a type change and start again, a crash, and the stop the daemon waits for', async () => {
    resetNodeChildren();
    const saved = process.env.OPEN_ARTIFACT_NODE_CHILDREN;
    process.env.OPEN_ARTIFACT_NODE_CHILDREN = 'threads';
    const lines: string[] = [];
    const servers = new TypeServers({ daemonUrl: () => 'http://127.0.0.1:9', tokenFor: () => 't', log: (line) => lines.push(line) });
    try {
      const dir = join(tempDir('open-artifact-types-'), 'threaded');
      mkdirSync(dir);
      const stops = join(dir, 'stops.txt');
      writeFileSync(stops, '');
      writeFileSync(join(dir, 'server.mjs'), SERVER);
      const manifest = (generation: string): void =>
        writeFileSync(join(dir, 'artifact-type.json'), JSON.stringify({ name: 'Threaded', description: 'A test type.', entry: { start: { command: 'node', args: ['server.mjs', generation], env: { STOPS: stops } }, open: true } }));
      manifest('one');
      const where = { root: dir, scope: 'user', trusted: true } as const;
      let type = readTypeFolder(dir, where)!;
      assert.ok(type, 'the type folder reads');
      const page = await servers.open(type, { id: 'a1', root: dir, title: 'A' }, { shell: 'http://127.0.0.1:9' });
      assert.match(page.url, /\/page\/one$/);
      assert.ok(lines.some((l) => /type servers run in worker threads of the daemon \(OPEN_ARTIFACT_NODE_CHILDREN=threads\)/.test(l)), lines.join('\n'));
      assert.ok(lines.some((l) => /server threaded: ready at .* \(thread \d+\)/.test(l)), lines.join('\n'));
      assert.equal(servers.status('threaded')?.state, 'running');
      assert.equal(servers.status('threaded')?.pid, undefined, 'no pid of its own');
      const state = JSON.parse(readFileSync(join(process.env.OPEN_ARTIFACT_HOME!, 'servers', 'threaded.json'), 'utf8'));
      assert.match(state.thread, new RegExp(`^${process.pid}:\\d+$`));

      // The type changes: its server is asked to stop (its SIGTERM handler runs) and the next open starts the new one.
      manifest('two');
      const later = Date.now() / 1000 + 5;
      utimesSync(join(dir, 'artifact-type.json'), later, later);
      type = readTypeFolder(dir, where)!;
      servers.typesChanged(() => type);
      assert.ok(lines.some((l) => /server threaded: its type changed; stopping it/.test(l)));
      await until(() => readFileSync(stops, 'utf8').includes('one'), 5000);
      const again = await servers.open(type, { id: 'a1', root: dir, title: 'A' }, { shell: 'http://127.0.0.1:9' });
      assert.match(again.url, /\/page\/two$/);

      // A crash ends the thread, not the daemon; the server counts as stopped and the next open starts it again.
      const base = await servers.base(type);
      await fetch(new URL('crash', base), { headers: { authorization: `Bearer ${(servers as unknown as { byType: Map<string, { secret: string }> }).byType.get('threaded')!.secret}` } });
      await until(() => servers.status('threaded')?.state === 'stopped', 5000);
      const log = readFileSync(join(process.env.OPEN_ARTIFACT_HOME!, 'logs', 'servers', 'threaded.log'), 'utf8');
      assert.match(log, /the server crashed/);
      assert.match(log, /--- exit 1/);
      assert.match((await servers.open(type, { id: 'a1', root: dir, title: 'A' }, { shell: 'http://127.0.0.1:9' })).url, /\/page\/two$/);

      // Closing: the thread is asked to stop, and drained() waits until it has.
      servers.closeAll();
      await servers.drained();
      assert.equal(readFileSync(stops, 'utf8').trim().split('\n').filter((l) => l === 'two').length, 1, readFileSync(stops, 'utf8'));
    } finally {
      servers.closeAll();
      if (saved === undefined) delete process.env.OPEN_ARTIFACT_NODE_CHILDREN;
      else process.env.OPEN_ARTIFACT_NODE_CHILDREN = saved;
      resetNodeChildren();
    }
  });
});
