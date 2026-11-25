// Type servers in worker threads (`OPEN_ARTIFACT_NODE_CHILDREN=threads`, packages/daemon/src/node-children.ts): what an
// Electron host whose RunAsNode fuse is off gets, run here under plain Node. A real daemon (`open-artifact daemon run`,
// from source) in a temporary OPEN_ARTIFACT_HOME on a free port, with copies of the built Slides and Docs types as its
// built-in types, and a host connected through @open-artifact/harness-kit.
//
//  (a) The daemon says threads in its health answer, `open-artifact doctor` reports it with why, and the daemon log
//      says it once.
//  (b) Slides: create a deck, write a slide (publish), open it: its server comes up in a thread of the daemon (no
//      process of its own), serves the page, and its `check` action runs there.
//  (c) Docs: create a doc and write it through its server (the `create` call), read it back; the file is on disk.
//  (d) The Docs type changes: its server is stopped (it ends by its own shutdown, exit 0) and the next call starts a
//      new one in another thread.
//  (e) The daemon stops (SIGTERM): it waits for its threads to finish (each server log ends with `--- exit 0`), exits
//      0, removes daemon.json and its lock, says in its log that it stopped and why, and nothing listens on the
//      servers' ports or runs from the home.
//
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer as createNetServer, connect } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createHarness, readDaemon } from '@open-artifact/harness-kit';
import { until } from './lib/http.mjs';
import { removeTmp, repoRoot, skipFor, tmpDir, typePath } from './lib/target.mjs';

const T = { timeout: 120000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const skip = skipFor('slides') || skipFor('docs');
if (skip) console.log(`# node-threads: skipped: ${skip}`);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Whether something accepts connections on the port. */
function listening(port) {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });
}

/** The CLI, asynchronously (the host in this process keeps answering the daemon meanwhile). */
function cli(args, env, cwd) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

describe('type servers in worker threads of a real daemon', { skip }, () => {
  const ctx = {};
  const log = () => fs.readFileSync(path.join(ctx.home, 'logs', 'daemon.log'), 'utf8');
  const serverLog = type => fs.readFileSync(path.join(ctx.home, 'logs', 'servers', `${type}.log`), 'utf8');
  const caller = () => ({ session: 'threads-1', workspace: ctx.workspace });
  const call = async (args) => {
    const result = await ctx.host.call('Artifact', args, caller());
    assert.equal(result.error, undefined, `${args.action} ${args.name ?? ''}: ${JSON.stringify(result.error)}`);
    return result;
  };
  /** The type's server as the type list shows it. */
  const status = async type => {
    const state = await readDaemon(ctx.home);
    const listed = await (await fetch(`${state.url}/api/open-artifact.types`, { headers: { authorization: `Bearer ${state.token}` } })).json();
    return listed.types.find(t => t.id === type)?.server ?? null;
  };

  before(async () => {
    const root = tmpDir('node-threads');
    ctx.home = path.join(root, 'home');
    ctx.builtin = path.join(root, 'builtin');
    ctx.workspace = path.join(root, 'work');
    const user = path.join(root, 'user');
    for (const dir of [ctx.builtin, ctx.workspace, user]) fs.mkdirSync(dir, { recursive: true });
    for (const type of ['slides', 'docs']) fs.cpSync(typePath(type), path.join(ctx.builtin, type), { recursive: true });
    ctx.env = {
      ...process.env,
      OPEN_ARTIFACT_HOME: ctx.home,
      OPEN_ARTIFACT_USER_TYPES: user,
      OPEN_ARTIFACT_BUILTIN_TYPES: ctx.builtin,
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
      OPEN_ARTIFACT_NODE_CHILDREN: 'threads',
    };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION', 'OPEN_ARTIFACT_DAEMON_BIN']) delete ctx.env[name];
    ctx.port = await freePort();
    ctx.daemonOut = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(ctx.port)], { env: ctx.env, cwd: ctx.workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (ctx.daemonOut += chunk));
    ctx.daemon.stderr.on('data', chunk => (ctx.daemonOut += chunk));
    ctx.exited = new Promise(resolve => ctx.daemon.once('exit', (code, signal) => resolve({ code, signal })));
    ctx.kill = () => ctx.daemon.exitCode === null && ctx.daemon.kill('SIGKILL');
    process.on('exit', ctx.kill);
    assert.ok(await until(() => fs.existsSync(path.join(ctx.home, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.daemonOut}`);
    ctx.host = await createHarness({ harness: 'threads-e2e', agentName: 'Threads', home: ctx.home, autoStart: false, caps: { tools: 'native', library: 'own' }, wake: () => 'queued' });
    await ctx.host.ready();
    await ctx.host.attach({ ...caller(), title: 'Threads chat', status: 'idle' });
  });

  after(async () => {
    ctx.host?.close();
    if (ctx.daemon?.exitCode === null) {
      ctx.daemon.kill('SIGTERM');
      await Promise.race([ctx.exited, new Promise(r => setTimeout(r, 10000))]);
    }
    ctx.kill?.();
    if (ctx.kill) process.off('exit', ctx.kill);
    removeTmp();
  });

  it('(a) the daemon says threads: its health, doctor, and its log once', T, async () => {
    const state = await readDaemon(ctx.home);
    const health = await (await fetch(`${state.url}/__open-artifact/health`)).json();
    assert.deepEqual(health.nodeChildren, { mode: 'threads', reason: 'env', detail: 'OPEN_ARTIFACT_NODE_CHILDREN=threads' });
    const run = await cli(['doctor', '--json'], ctx.env, ctx.workspace);
    const finding = JSON.parse(run.stdout).findings.find(f => f.id === 'node-children');
    assert.equal(finding?.status, 'ok', run.stdout);
    assert.match(finding.message, /worker threads of the daemon \(set by OPEN_ARTIFACT_NODE_CHILDREN/);
  });

  it('(b) Slides: the server runs in a thread, serves the page, and runs check', T, async () => {
    const made = await call({ action: 'publish', type_url: 'open-artifact://type/slides', title: 'Threaded deck', open: 'never' });
    ctx.deck = made;
    const opened = await call({ action: 'open', url: made.url });
    assert.ok(opened.view_url, JSON.stringify(opened));
    assert.ok(await until(() => /server slides: ready at http:\/\/127\.0\.0\.1:\d+\/ \(thread \d+\)/.test(log()), 30000), log());
    // The server made the empty deck as it opened it: the agent's first write adds a slide.
    const deckFile = path.join(made.root, 'project', 'deck.json');
    assert.ok(await until(() => fs.existsSync(deckFile), 10000), 'the server scaffolds the deck');
    const deck = JSON.parse(fs.readFileSync(deckFile, 'utf8'));
    const slide = '<section class="slide"><h1>Made in a thread</h1></section>\n';
    await call({ action: 'publish', url: made.url, files: { 'project/slides/s1.html': slide, 'project/deck.json': JSON.stringify({ ...deck, order: ['s1'] }, null, 2) } });
    assert.equal(fs.readFileSync(path.join(made.root, 'project', 'slides', 's1.html'), 'utf8'), slide);
    assert.equal(log().match(/type servers run in worker threads of the daemon/g)?.length, 1, 'said once');
    const server = await status('slides');
    assert.equal(server?.state, 'running', JSON.stringify(server));
    assert.equal(server.pid, undefined, 'no process of its own');
    ctx.slidesPort = Number(new URL(server.url).port);
    const page = await fetch(opened.view_url);
    assert.equal(page.status, 200);
    const checked = await call({ action: 'call', url: made.url, name: 'check' });
    assert.equal(JSON.stringify(checked).includes('"problems"'), true, JSON.stringify(checked).slice(0, 500));
  });

  it('(c) Docs: a write through its server lands, and reads back', T, async () => {
    const made = await call({ action: 'publish', type_url: 'open-artifact://type/docs', title: 'Threaded notes', open: 'never' });
    ctx.doc = made;
    const created = await call({ action: 'call', url: made.url, name: 'create', args: { call: { name: 'Threaded notes', doc: { markdown: '# Threaded notes\n\nWritten by a server in a worker thread.' } } } });
    assert.equal(created.ok, true, JSON.stringify(created).slice(0, 500));
    assert.match(created.xml, /Written by a server in a worker thread\./);
    const read = await call({ action: 'call', url: made.url, name: 'read', args: { call: {} } });
    assert.equal(read.name, 'Threaded notes');
    assert.ok(fs.readdirSync(made.root, { recursive: true }).length > 1, 'the doc is on disk');
    assert.ok(/server docs: ready at .* \(thread \d+\)/.test(log()), log());
    ctx.docsPort = Number(new URL((await status('docs')).url).port);
  });

  it('(d) the Docs type changes: its server stops by its own shutdown, and the next call starts a new thread', T, async () => {
    const threads = () => [...log().matchAll(/server docs: ready at .* \(thread (\d+)\)/g)].map(m => m[1]);
    const before = threads();
    const manifest = path.join(ctx.builtin, 'docs', 'artifact-type.json');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(manifest, later, later);
    // The roots are watched: a new entry in the root says something changed.
    fs.writeFileSync(path.join(ctx.builtin, '.changed'), '');
    assert.ok(await until(() => /server docs: its type changed; stopping it/.test(log()), 15000), log());
    assert.ok(await until(() => /--- exit 0\n$/.test(serverLog('docs')), 10000), serverLog('docs'));
    const read = await call({ action: 'call', url: ctx.doc.url, name: 'read', args: { call: {} } });
    assert.equal(read.name, 'Threaded notes');
    const after = threads();
    assert.equal(after.length, before.length + 1, log());
    assert.notEqual(after.at(-1), before.at(-1));
    ctx.docsPort = Number(new URL((await status('docs')).url).port);
  });

  it('(e) the daemon stops: its threads finish first, and nothing is left behind', T, async () => {
    ctx.host.close();
    ctx.daemon.kill('SIGTERM');
    const { code, signal } = await Promise.race([ctx.exited, new Promise(r => setTimeout(() => r({ code: 'timeout' }), 15000))]);
    assert.deepEqual({ code, signal }, { code: 0, signal: null }, ctx.daemonOut);
    for (const type of ['slides', 'docs']) assert.match(serverLog(type), /--- exit 0\n$/, `${type}: ${serverLog(type).slice(-500)}`);
    // The daemon log says it stopped and why, once.
    assert.equal(log().match(/^\[[^\]]+\] daemon \S+ stopped \(SIGTERM\)$/gm)?.length, 1, log().slice(-600));
    assert.equal(fs.existsSync(path.join(ctx.home, 'daemon.json')), false);
    assert.equal(fs.existsSync(path.join(ctx.home, 'daemon.lock')), false);
    for (const port of [ctx.port, ctx.slidesPort, ctx.docsPort]) assert.equal(await listening(port), false, `port ${port} still listens`);
    if (process.platform !== 'win32') {
      const ps = execFileSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 1 << 28 });
      const left = ps.split('\n').filter(line => line.includes(ctx.home) || line.includes(ctx.builtin));
      assert.deepEqual(left, []);
    }
  });
});
