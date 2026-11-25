/**
 * The headless host against a real daemon, in a temporary `OPEN_ARTIFACT_HOME`: `main.mjs` makes an artifact of a
 * small user type, a page request (`artifacts.ask`, what the Shell's "Ask" sends) wakes its session, and the
 * session's line says it came from the owner. The shared modules (allowlist, wakes, cards, places) get their own
 * tests first: `examples/harness-electron` uses them as they are.
 *
 * Run: node --test examples/harness-node/harness-node.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { api, readDaemon } from '@open-artifact/harness-kit';
import { OriginAllowlist } from './allowlist.mjs';
import { cardOf, followArtifacts } from './artifacts.mjs';
import { hostRuntime, runtimeFolders } from './harness.mjs';
import { PlaceMemory } from './places.mjs';
import { describeWake, routeOf, wakeHandler } from './wakes.mjs';
import { ScriptedAgent } from './agent.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

const source = (from, extra = {}) => ({ kind: 'open-artifact.event', artifactId: 'a1', url: 'open-artifact://artifact/a1', title: 'Deck', root: '', viewUrl: '', threads: [], requests: [], summary: 'Bigger title', reason: 'comment', from, ...extra });

describe('shared modules', () => {
  it('lets in exactly the listed origins and per-artifact patterns, and follows changes', () => {
    const list = new OriginAllowlist(['http://127.0.0.1:4123', 'http://*.frame.localhost:4123']);
    assert.ok(list.allows('http://127.0.0.1:4123/a/abc?oa_view=1'));
    assert.ok(list.allows('http://a1b2.frame.localhost:4123/index.html'));
    assert.ok(!list.allows('http://frame.localhost:4123/'));
    assert.ok(!list.allows('http://127.0.0.1:4124/'));
    assert.ok(!list.allows('http://localhost:4123/'));
    assert.ok(!list.allows('https://127.0.0.1:4123/'));
    assert.ok(!list.allows('file:///etc/passwd'));
    assert.ok(!list.allows('not a url'));
    list.set(['http://127.0.0.1:5000']);
    assert.ok(!list.allows('http://127.0.0.1:4123/'));
    assert.ok(list.allows('http://127.0.0.1:5000/'));
  });

  it('follows embed/origins events from the connection', async () => {
    const listeners = [];
    const oa = { on: (_name, listener) => (listeners.push(listener), () => undefined), embedOrigins: async () => ({ origins: ['http://127.0.0.1:1'], entries: [] }) };
    const list = new OriginAllowlist();
    await list.follow(oa);
    assert.ok(list.allows('http://127.0.0.1:1/'));
    listeners[0]({ type: 'embed/origins', origins: ['http://127.0.0.1:2'], entries: [] });
    assert.ok(list.allows('http://127.0.0.1:2/') && !list.allows('http://127.0.0.1:1/'));
  });

  it('leaves out a remote origin until the person trusts it', () => {
    const list = new OriginAllowlist();
    list.fromDaemon({
      origins: ['http://127.0.0.1:1', 'https://types.example.com'],
      entries: [
        { origin: 'http://127.0.0.1:1', kind: 'daemon', remote: false },
        { origin: 'https://types.example.com', kind: 'url', type: 'slides', remote: true },
      ],
    });
    assert.ok(list.allows('http://127.0.0.1:1/'));
    assert.ok(!list.allows('https://types.example.com/deck'));
    // A declined origin is not kept as refused: a later event keeps it out, and a later yes lets it in.
    list.fromDaemon(list.last);
    assert.ok(!list.allows('https://types.example.com/deck'));
    list.trust('https://types.example.com');
    assert.ok(list.allows('https://types.example.com/deck'));
  });

  it('routes the owner to a turn and everyone else to a notice', () => {
    assert.equal(routeOf({ source: source({ kind: 'owner' }) }), 'turn');
    assert.equal(routeOf({ source: source({ kind: 'collaborator', name: 'Ann', role: 'commenter' }) }), 'notice');
    assert.equal(routeOf({ source: source({ kind: 'system' }, { reason: 'task' }) }), 'notice');
    assert.equal(describeWake({ artifactId: 'a1', source: source({ kind: 'collaborator', name: 'Ann', role: 'commenter' }) }), 'comment from Ann (commenter) on "Deck": Bigger title');
    const agent = new ScriptedAgent({ id: 's1', workspace: '/w' });
    const wake = wakeHandler(new Map([['s1', agent]]));
    assert.equal(wake({ session: 's1', text: 'owner text', source: source({ kind: 'owner' }) }), 'delivered');
    assert.equal(wake({ session: 's1', text: 'outside', source: source({ kind: 'system' }, { reason: 'task' }) }), 'delivered');
    assert.equal(wake({ session: 'gone', text: 'x', source: source({ kind: 'owner' }) }), 'failed');
    assert.deepEqual(agent.transcript, [
      { role: 'user', text: 'owner text' },
      { role: 'notice', text: 'outside' },
    ]);
  });

  it('keeps one card per artifact and session', () => {
    const listeners = [];
    const { cards } = followArtifacts({ on: (_name, listener) => (listeners.push(listener), () => undefined) });
    const artifact = { url: 'open-artifact://artifact/a1', id: 'a1', title: 'Deck', type: 'slides', viewUrl: null, thumbnail: null, updatedAt: 't' };
    listeners[0]({ session: 's1', workspace: '/w', artifact, change: 'created' });
    listeners[0]({ session: 's1', workspace: '/w', artifact: { ...artifact, title: 'Deck 2' }, change: 'updated' });
    assert.equal(cards.get('s1').get(artifact.url).title, 'Deck 2');
    // The kit reports a removal with no session: the card still leaves its session's table.
    listeners[0]({ session: null, workspace: null, artifact, change: 'removed' });
    assert.equal(cards.get('s1').size, 0);
    assert.ok(!cards.has(''));
    assert.equal(cardOf({ artifact, change: 'removed' }), null);
  });

  it('carries a runtime: the installed @open-artifact/cli or the repository\'s built one, else says what to install', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-runtime-'));
    const saved = process.env.OPEN_ARTIFACT_DAEMON_BIN;
    try {
      const runtime = join(dir, 'cli');
      mkdirSync(join(runtime, 'scripts'), { recursive: true });
      writeFileSync(join(runtime, 'scripts', 'open-artifact.mjs'), '');
      writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: '@open-artifact/cli', version: '1.2.3' }));
      assert.deepEqual(hostRuntime([join(dir, 'missing'), runtime]), { dir: runtime, version: '1.2.3' });
      // Inside this repository the built runtime is a candidate (after an installed package, when there is one).
      assert.equal(runtimeFolders().at(-1), join(repo, 'skills', 'open-artifact'));
      delete process.env.OPEN_ARTIFACT_DAEMON_BIN;
      assert.throws(() => hostRuntime([]), /install @open-artifact\/cli .*build it/);
      process.env.OPEN_ARTIFACT_DAEMON_BIN = '/somewhere/open-artifact.mjs';
      assert.equal(hostRuntime([]), undefined, 'a named daemon needs no runtime');
    } finally {
      if (saved === undefined) delete process.env.OPEN_ARTIFACT_DAEMON_BIN;
      else process.env.OPEN_ARTIFACT_DAEMON_BIN = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('remembers places in a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-places-'));
    try {
      const file = join(dir, 'places.json');
      new PlaceMemory(file).set('open-artifact://artifact/a1', '#slide-3');
      assert.equal(new PlaceMemory(file).get('open-artifact://artifact/a1'), '#slide-3');
      assert.equal(new PlaceMemory().get('open-artifact://artifact/a1'), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('main.mjs against a real daemon', () => {
  let dir;
  let env;
  let child;
  const lines = [];

  /** Bundles the daemon from source (Node's type stripping cannot run it as `.ts`) and sets up a home with one type. */
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'oa-harness-node-'));
    const bin = join(dir, 'open-artifact.mjs');
    buildSync({
      entryPoints: [join(repo, 'packages/daemon/src/bin/open-artifact.ts')],
      outfile: bin,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      charset: 'utf8',
      legalComments: 'none',
      logLevel: 'silent',
      banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" },
    });
    const type = join(dir, 'types', 'note');
    mkdirSync(type, { recursive: true });
    writeFileSync(join(type, 'artifact-type.json'), JSON.stringify({ name: 'Note', description: 'A one-page note as a local HTML file.', when: 'The person wants a short note.' }));
    writeFileSync(join(type, 'index.html'), '<!doctype html><title>note</title><iframe src="note.html"></iframe>\n');
    mkdirSync(join(dir, 'builtin'));
    mkdirSync(join(dir, 'work'));
    env = {
      ...process.env,
      OPEN_ARTIFACT_HOME: join(dir, 'home'),
      OPEN_ARTIFACT_USER_TYPES: join(dir, 'types'),
      OPEN_ARTIFACT_BUILTIN_TYPES: join(dir, 'builtin'),
      OPEN_ARTIFACT_DAEMON_BIN: bin,
      OPEN_ARTIFACT_PORT: '0',
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
      OPEN_ARTIFACT_WAKE_MERGE_MS: '20',
    };
  });

  after(() => {
    child?.kill('SIGKILL');
    try {
      const { pid } = JSON.parse(readFileSync(join(dir, 'home', 'daemon.json'), 'utf8'));
      if (pid) process.kill(pid, 'SIGTERM');
    } catch {
      // no daemon came up
    }
    rmSync(dir, { recursive: true, force: true });
  });

  /** Resolves with the first stdout line that starts with `word`. */
  function lineOf(word, ms = 30_000) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`no "${word}" line in ${ms} ms; got:\n${lines.join('\n')}`)), ms);
      const check = () => {
        const line = lines.find((l) => l.startsWith(`${word} `));
        if (line) {
          clearTimeout(timer);
          clearInterval(poll);
          done(line);
        }
      };
      const poll = setInterval(check, 20);
      check();
    });
  }

  it('makes an artifact, then gets the owner\'s request as a turn', { timeout: 90_000 }, async () => {
    child = spawn(process.execPath, [join(here, 'main.mjs'), '--workspace', join(dir, 'work'), '--type', 'note', '--once'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop();
      lines.push(...parts);
    });
    const exited = new Promise((done) => child.on('exit', (code) => done(code)));

    const ready = await Promise.race([lineOf('ready'), exited.then((code) => Promise.reject(new Error(`main.mjs exited ${code}\n${lines.join('\n')}\n${stderr}`)))]);
    const url = ready.slice('ready '.length);
    assert.match(url, /^open-artifact:\/\/artifact\//);
    assert.match(await lineOf('connected'), /^connected yes/);
    assert.match(await lineOf('tools'), /Artifact/);
    assert.match(await lineOf('skill'), /^skill daemon .*commands=.*note/);
    assert.match(await lineOf('published'), new RegExp(`^published ${url} root=`));
    assert.match(await lineOf('opened'), /^opened by-address http/);
    assert.ok(readFileSync(join(dir, 'work', '.example-skills', 'open-artifact', 'SKILL.md'), 'utf8').length > 100);

    // The page's "Ask": the daemon wakes the artifact's owner session, live through main.mjs's connection.
    const state = await readDaemon(env.OPEN_ARTIFACT_HOME);
    assert.ok(state, 'daemon.json');
    const answer = await api(state, 'artifacts.ask', { id: url.split('/').pop(), text: 'Make the title bigger' });
    assert.equal(answer.via, 'live', JSON.stringify(answer));
    assert.match(await lineOf('wake'), /^wake turn request from owner on "Hello from the example"/);
    assert.equal(await exited, 0);
  });
});
