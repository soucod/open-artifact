/**
 * Embedding (`harness-embed.ts`) and view context (`harness-view.ts`): the origins answer, the hosts' origins, the
 * one-time view tickets (single use, bound to their connection, expiring, queued commands), and `view.context`
 * through the type's `context` action with its throttled event. The second half runs a daemon: a URL-entry type with
 * a non-loopback address, a local type server starting and stopping, a type added, and a URL-entry type whose
 * `context` action a stub server answers.
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  HARNESS_PATH,
  HARNESS_SUBPROTOCOL,
  MAX_HOST_DESTINATIONS,
  MAX_HOST_TEXT,
  artifactIdOf,
  type DaemonState,
  type EmbedOriginsEvent,
  type EmbedResponse,
  type HarnessEvent,
  type ShellEventParams,
  type ToolCallResult,
  type ViewContextEvent,
} from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { EmbedViews, MAX_QUEUED, embedOrigins, hostCommandOf, shellEventOf, type ViewSink } from '../src/harness-embed.ts';
import { CONTEXT_EVENT_MS, ViewContexts, type ViewRecord } from '../src/harness-view.ts';
import type { AdapterConnection } from '../src/harness.ts';

// ---- units -------------------------------------------------------------------------------------------------------

/** A stand-in adapter connection: what it was called with. */
function conn(caps: Record<string, unknown> = { open: { embed: 'view', origins: ['app://host'] } }): AdapterConnection & { calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    id: Math.random().toString(36).slice(2),
    authed: true,
    subscribed: true,
    harness: 'host-app',
    caps,
    calls,
    call: async (method: string, params: unknown) => {
      calls.push({ method, params });
      return { ok: true };
    },
    notify: () => undefined,
    close: () => undefined,
  } as unknown as AdapterConnection & { calls: typeof calls };
}

function sink(): ViewSink & { got: unknown[]; ended: boolean } {
  const s = { got: [] as unknown[], ended: false, send: (c: unknown) => void s.got.push(c), end: () => void (s.ended = true) };
  return s;
}

const SHELL = 'http://127.0.0.1:4800/a/art_one';

test('embedOrigins: daemon, one frame pattern, local servers with theirs, URL entries with remote marked', () => {
  const out = embedOrigins({
    daemon: 'http://127.0.0.1:4800',
    port: 4800,
    types: [
      { id: 'slides', entry: { kind: 'static' } },
      { id: 'docs', entry: { kind: 'static' } },
      { id: 'far', entry: { kind: 'url', url: 'https://types.example.com/far/{id}' } },
      { id: 'near', entry: { kind: 'url', url: 'http://127.0.0.1:9000/near/{id}' } },
      { id: 'served', entry: { kind: 'server', url: null } },
    ],
    running: [
      { type: 'served', base: 'http://127.0.0.1:5123/' },
      { type: 'faraway', base: 'https://types.example.net:8443/' },
    ],
  });
  assert.deepEqual(out.origins, [
    'http://127.0.0.1:4800',
    'http://*.frame.localhost:4800',
    'https://types.example.com',
    'http://127.0.0.1:9000',
    'http://127.0.0.1:5123',
    'http://*.frame.localhost:5123',
    'https://types.example.net:8443',
  ]);
  assert.deepEqual(out.entries[1], { pattern: 'http://*.frame.localhost:4800', kind: 'frame', remote: false });
  assert.deepEqual(out.entries[2], { origin: 'https://types.example.com', kind: 'url', type: 'far', remote: true });
  assert.deepEqual(out.entries[3], { origin: 'http://127.0.0.1:9000', kind: 'url', type: 'near', remote: false });
  assert.deepEqual(out.entries[4], { origin: 'http://127.0.0.1:5123', kind: 'server', type: 'served', remote: false });
  // A local server's per-artifact origins (frame-host gives each original artifact one); none for a server elsewhere.
  assert.deepEqual(out.entries[5], { pattern: 'http://*.frame.localhost:5123', kind: 'frame', type: 'served', remote: false });
  assert.deepEqual(out.entries[6], { origin: 'https://types.example.net:8443', kind: 'server', type: 'faraway', remote: true });
});

test('EmbedViews: origins change is broadcast once, host origins come from connected adapters', () => {
  const events: HarnessEvent[] = [];
  const conns = [conn(), conn({ open: { embed: 'frame', origins: ['https://app.example.com/', '*', 'null', 'javascript:alert(1)'] } }), conn({ open: true })];
  const views = new EmbedViews({ broadcast: (e) => events.push(e), connections: () => conns });
  try {
    let running = ['http://127.0.0.1:5000/'];
    views.setOrigins(() => embedOrigins({ daemon: 'http://127.0.0.1:4800', port: 4800, types: [], running: running.map((base) => ({ type: 't', base })) }));
    views.originsChanged();
    assert.equal(events.length, 0, 'nothing changed');
    running = [];
    views.originsChanged();
    views.originsChanged();
    assert.equal(events.length, 1);
    assert.deepEqual((events[0] as EmbedOriginsEvent).origins, ['http://127.0.0.1:4800']);
    assert.equal(events[0]!.type, 'embed/origins');
    assert.deepEqual(views.hostOrigins(), ['app://host', 'https://app.example.com']);
  } finally {
    views.close();
  }
});

test('tickets: only for top-level views; single use; bound to the artifact; the key brings a reload back', () => {
  const views = new EmbedViews({ broadcast: () => undefined, connections: () => [] });
  try {
    const framed = views.issue(conn({ open: { embed: 'frame', origins: [] } }), { session: 's', artifactId: 'art_one', shellUrl: SHELL });
    assert.deepEqual(framed, { embed_url: SHELL }, 'a framing adapter gets the plain Shell address');

    const c = conn();
    const { view, embed_url } = views.issue(c, { session: 's1', artifactId: 'art_one', shellUrl: SHELL });
    assert.ok(view && view.length >= 32);
    assert.equal(new URL(embed_url).searchParams.get('oa_view'), view);
    assert.throws(() => views.claim(view!, 'art_two', null, sink()), /No such view/, "another artifact's Shell cannot claim it");
    const first = sink();
    const claimed = views.claim(view!, 'art_one', null, first);
    assert.equal(claimed.session, 's1');
    assert.throws(() => views.claim(view!, 'art_one', null, sink()), /No such view/, 'a used ticket is refused');
    assert.throws(() => views.claim(view!, 'art_one', 'wrong-key', sink()), /No such view/, 'a wrong key is refused');
    // The same Shell back with its key: the old stream ends.
    const again = sink();
    views.claim(view!, 'art_one', claimed.key, again);
    assert.equal(first.ended, true);
  } finally {
    views.close();
  }
});

test('tickets: commands of another connection are refused; commands before the Shell connects wait', () => {
  const views = new EmbedViews({ broadcast: () => undefined, connections: () => [] });
  try {
    const owner = conn();
    const other = conn();
    const { view } = views.issue(owner, { session: null, artifactId: 'art_one', shellUrl: SHELL });
    assert.throws(() => views.command(other, { view, command: { openArtifact: 'goto', hash: '#x' } }), /No such view of this connection/);
    assert.throws(() => views.command(owner, { view, command: { openArtifact: 'eval', code: '1' } }), /host_hello or goto/);
    for (let i = 0; i < MAX_QUEUED + 5; i++) views.command(owner, { view, command: { openArtifact: 'goto', hash: `#${i}` } });
    views.command(owner, { view, command: { openArtifact: 'host_hello', caps: { sessions: true, evil: true }, agentName: 'A', script: 'x' } });
    const s = sink();
    views.claim(view!, 'art_one', null, s);
    assert.equal(s.got.length, MAX_QUEUED, 'the queue keeps the newest commands');
    assert.deepEqual(s.got.at(-1), { openArtifact: 'host_hello', caps: { sessions: true }, agentName: 'A' }, 'commands are reduced to their fields');
    views.command(owner, { view, command: { openArtifact: 'goto', hash: '#live' } });
    assert.deepEqual(s.got.at(-1), { openArtifact: 'goto', hash: '#live' });
  } finally {
    views.close();
  }
});

test('tickets: expire unclaimed; a view whose Shell left expires after the grace; a dropped connection ends its views', () => {
  let now = 1_000_000;
  const views = new EmbedViews({ broadcast: () => undefined, connections: () => [], ticketMs: 1000, graceMs: 500, now: () => now });
  try {
    const c = conn();
    const late = views.issue(c, { session: null, artifactId: 'art_one', shellUrl: SHELL }).view!;
    now += 1001;
    assert.throws(() => views.claim(late, 'art_one', null, sink()), /No such view/, 'an expired ticket is refused');

    const { view } = views.issue(c, { session: null, artifactId: 'art_one', shellUrl: SHELL });
    const s = sink();
    const { key } = views.claim(view!, 'art_one', null, s);
    now += 60_000;
    views.sweep();
    assert.equal(views.size, 1, 'a connected view does not expire');
    views.detach(view!, s);
    now += 501;
    assert.throws(() => views.claim(view!, 'art_one', key, sink()), /No such view/, 'gone after the grace');

    const kept = views.issue(c, { session: null, artifactId: 'art_one', shellUrl: SHELL }).view!;
    const live = sink();
    views.claim(kept, 'art_one', null, live);
    views.dropConnection(c);
    assert.equal(live.ended, true);
    assert.equal(views.size, 0);
  } finally {
    views.close();
  }
});

test('view events: what the Shell says goes to its adapter as shell.event, reduced and with the key only', async () => {
  const views = new EmbedViews({ broadcast: () => undefined, connections: () => [] });
  try {
    const c = conn();
    const { view } = views.issue(c, { session: 'sess', artifactId: 'art_one', shellUrl: SHELL });
    assert.throws(() => views.event(view!, '', { openArtifact: 'close' }), /No such view/, 'nothing before the claim');
    const { key } = views.claim(view!, 'art_one', null, sink());
    assert.throws(() => views.event(view!, 'nope', { openArtifact: 'close' }), /No such view/);
    assert.throws(() => views.event(view!, key, { openArtifact: 'run', code: 'x' }), /a Shell message/);
    assert.throws(() => views.event(view!, key, { openArtifact: 'open_external', url: 'javascript:alert(1)' }), /a Shell message/);
    views.event(view!, key, { openArtifact: 'new_session', prompt: 'x'.repeat(MAX_HOST_TEXT + 50), artifact: 'a', extra: 1 });
    await new Promise((done) => setImmediate(done));
    assert.equal(c.calls.length, 1);
    const sent = c.calls[0]!.params as ShellEventParams;
    assert.equal(c.calls[0]!.method, 'shell.event');
    assert.equal(sent.view, view);
    assert.equal(sent.session, 'sess');
    assert.deepEqual(Object.keys(sent.event), ['openArtifact', 'prompt', 'artifact']);
    assert.equal((sent.event as { prompt: string }).prompt.length, MAX_HOST_TEXT);
  } finally {
    views.close();
  }
});

test('message shapes: destinations capped, theme checked, non-messages dropped', () => {
  const many = Array.from({ length: MAX_HOST_DESTINATIONS + 4 }, (_, i) => ({ id: `d${i}`, label: `Dest ${i}` }));
  const hello = hostCommandOf({ openArtifact: 'host_hello', caps: {}, destinations: [...many, { id: '', label: 'x' }], theme: { scheme: 'dark', accent: 'red' } });
  assert.ok(hello && hello.openArtifact === 'host_hello');
  assert.equal(hello.destinations!.length, MAX_HOST_DESTINATIONS);
  assert.deepEqual(hello.theme, { scheme: 'dark' }, 'an accent that is not #rrggbb is left out');
  assert.equal(hostCommandOf({ openArtifact: 'goto', hash: '' }), null);
  assert.equal(shellEventOf({ openArtifact: 'saved_file', path: '' }), null);
  assert.deepEqual(shellEventOf({ openArtifact: 'saved_file', path: '/Users/me/Downloads/deck.pdf' }), { openArtifact: 'saved_file', path: '/Users/me/Downloads/deck.pdf' });
});

test('ViewContexts: owner only; nulls without a context action; changed; events throttled per artifact', async () => {
  const events: ViewContextEvent[] = [];
  let now = 10_000;
  const contexts = new ViewContexts({ broadcast: (e) => events.push(e), now: () => now });
  const owner = { harness: 'h', session: 'one', workspace: '/w' };
  const records: Record<string, ViewRecord> = {
    art_aaaaaaaaaa: { id: 'art_aaaaaaaaaa', owner, lastUserEditAt: '2026-01-02T00:00:00.000Z', agentSeenAt: '2026-01-01T00:00:00.000Z' },
    art_bbbbbbbbbb: { id: 'art_bbbbbbbbbb', owner, lastUserEditAt: null, agentSeenAt: '2026-01-01T00:00:00.000Z' },
  };
  contexts.configure({
    record: (url) => records[artifactIdOf(url) ?? url]!,
    context: async (r) => (r.id === 'art_aaaaaaaaaa' ? { at: '2026-01-03T00:00:00.000Z', context: { slide: 2 }, note: 'x' } : null),
  });
  try {
    assert.deepEqual(await contexts.read('open-artifact://artifact/art_aaaaaaaaaa', owner), { at: '2026-01-03T00:00:00.000Z', context: { slide: 2 }, changed: true });
    assert.deepEqual(await contexts.read('open-artifact://artifact/art_bbbbbbbbbb', owner), { at: null, context: null, changed: false });
    await assert.rejects(contexts.read('open-artifact://artifact/art_aaaaaaaaaa', { ...owner, session: 'two' }), /Only the session that owns/);

    contexts.noted('art_aaaaaaaaaa', '2026-01-03T00:00:01.000Z');
    assert.equal(events.length, 1, 'the first change goes at once');
    contexts.noted('art_aaaaaaaaaa', '2026-01-03T00:00:02.000Z');
    contexts.noted('art_aaaaaaaaaa', '2026-01-03T00:00:03.000Z');
    contexts.noted('art_bbbbbbbbbb', '2026-01-03T00:00:03.000Z');
    assert.equal(events.length, 2, 'another artifact is not held back');
    now += CONTEXT_EVENT_MS;
    await until(() => events.length === 3, 3000);
    assert.deepEqual(events[2], { type: 'view/context', url: 'open-artifact://artifact/art_aaaaaaaaaa', id: 'art_aaaaaaaaaa', at: '2026-01-03T00:00:03.000Z' });
  } finally {
    contexts.close();
  }
});

// ---- a daemon ----------------------------------------------------------------------------------------------------

let daemon: Daemon;
let state: DaemonState;
let stub: Server;
let stubPort = 0;
/** Every `context` action the stub type server was asked. */
const contextCalls: unknown[] = [];

function addType(id: string, files: Record<string, string>): void {
  const dir = join(process.env.OPEN_ARTIFACT_USER_TYPES!, id);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

/** A URL-entry type server that lists a `context` action and answers it. */
function startStub(): Promise<number> {
  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      const send = (status: number, body: unknown): void => void res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      if (path === '/ctx/__open-artifact/actions' && req.method === 'GET') return send(200, { actions: [{ name: 'context', title: 'Context', effect: 'read' }] });
      if (path === '/ctx/__open-artifact/actions/context' && req.method === 'POST') {
        contextCalls.push(JSON.parse(raw));
        return send(200, { at: '2026-05-01T10:00:00.000Z', context: { selection: 'B2:C4' }, note: 'what the person has selected' });
      }
      send(404, { code: 'not_found', message: path });
    });
  });
  return new Promise((done) => stub.listen(0, '127.0.0.1', () => done((stub.address() as { port: number }).port)));
}

/** A minimal adapter on the Harness API socket. */
async function adapter(harness: string, caps: Record<string, unknown> = {}) {
  const ws = new WebSocket(`${state.url.replace(/^http/, 'ws')}${HARNESS_PATH}`, [HARNESS_SUBPROTOCOL]);
  await new Promise<void>((ok, fail) => {
    ws.addEventListener('open', () => ok(), { once: true });
    ws.addEventListener('error', () => fail(new Error('no connection')), { once: true });
  });
  const answers = new Map<number, { result?: any; error?: { code: number; message: string; data?: { code?: string } } }>();
  const events: HarnessEvent[] = [];
  const calls: Array<{ method: string; params: any }> = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'event') events.push(message.params);
    else if (message.method && message.id !== undefined) {
      calls.push({ method: message.method, params: message.params });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: message.method === 'host.open' ? { opened: true } : { ok: true } }));
    } else if (message.id !== undefined) answers.set(message.id, message);
  });
  let next = 1;
  const call = async (method: string, params: unknown) => {
    const id = next++;
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    await until(() => answers.has(id), 5000);
    return answers.get(id)!;
  };
  const hello = await call('hello', { harness, token: state.token, caps });
  assert.equal(hello.error, undefined);
  await call('subscribe', { on: true });
  return { ws, call, events, calls, close: () => ws.close() };
}

before(async () => {
  stubPort = await startStub();
  addType('ctxtype', { 'artifact-type.json': JSON.stringify({ name: 'ctxtype', description: 'A URL type with a context action.', entry: { url: `http://127.0.0.1:${stubPort}/ctx/{id}`, actions: true } }) });
  addType('fartype', { 'artifact-type.json': JSON.stringify({ name: 'fartype', description: 'A URL type on the web.', entry: { url: 'https://types.example.com/far/{id}' } }) });
  // Remote (0.0.0.0 is not a loopback name) yet answered by the local stub: creating one needs its address to answer.
  addType('neartype', { 'artifact-type.json': JSON.stringify({ name: 'neartype', description: 'A URL type on another computer, reachable.', entry: { url: `http://0.0.0.0:${stubPort}/far/{id}` } }) });
  addType(
    'srvtype',
    {
      'artifact-type.json': JSON.stringify({ name: 'srvtype', description: 'A local server type.', entry: { start: { command: process.execPath, args: ['server.mjs'] }, open: true } }),
      'server.mjs': `import { createServer } from 'node:http';
const server = createServer((req, res) => {
  if (req.url.startsWith('/__open-artifact/health')) return res.writeHead(200, { 'content-type': 'application/json' }).end('{"openArtifact":1,"type":"srvtype"}');
  if (req.url.startsWith('/__open-artifact/open')) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port + '/page' }));
  res.writeHead(404).end();
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ openArtifact: 'ready', url: 'http://127.0.0.1:' + server.address().port })));
`,
    },
  );
  const shellDir = tempDir('open-artifact-shell-');
  writeFileSync(join(shellDir, 'index.html'), '<!doctype html><title>shell</title>');
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => {
  daemon.close();
  stub.close();
});

async function create(type: string, caller: { harness: string; session: string; workspace: string }): Promise<string> {
  const made = await api<ToolCallResult>(state, 'tools.call', { name: 'Artifact', arguments: { action: 'publish', type_url: `open-artifact://type/${type}`, title: `A ${type}` }, caller });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  return artifactIdOf(String(made.url))!;
}

test('origins: a URL entry on the web is remote; a server starting and stopping and a new type send embed/origins', async () => {
  const host = await adapter('origins-app', { open: { embed: 'frame', origins: ['app://origins-app'] } });
  try {
    const answer = (await host.call('embed.origins', {})).result as EmbedResponse;
    assert.equal(answer.origins[0], state.url);
    assert.ok(answer.entries.some((e) => e.kind === 'url' && e.type === 'fartype' && e.origin === 'https://types.example.com' && e.remote === true));
    assert.ok(answer.entries.some((e) => e.kind === 'url' && e.type === 'ctxtype' && e.remote === false));
    const http = (await (await fetch(`${state.url}/api/open-artifact.embed`)).json()) as EmbedResponse;
    assert.deepEqual(http.origins, answer.origins);
    assert.deepEqual(http.hosts, ['app://origins-app'], 'the declared host origins come along');

    // A local server starts: its origin comes, and goes when it stops.
    const id = await create('srvtype', { harness: 'origins-app', session: 'o1', workspace: tempDir('open-artifact-ws-') });
    await daemon.openPage(daemon.store.require(id));
    const started = await until(() => host.events.find((e): e is EmbedOriginsEvent => e.type === 'embed/origins' && e.entries.some((x) => x.kind === 'server' && x.type === 'srvtype')), 10_000);
    const origin = started.entries.find((x) => x.type === 'srvtype')!.origin!;
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const seen = host.events.length;
    daemon.servers.stop('srvtype');
    await until(() => host.events.slice(seen).some((e) => e.type === 'embed/origins' && !(e as EmbedOriginsEvent).origins.includes(origin)), 5000);

    // A type added (no server started): its address comes.
    const before = host.events.length;
    addType('latetype', { 'artifact-type.json': JSON.stringify({ name: 'latetype', description: 'Added later.', entry: { url: 'https://late.example.org/x/{id}' } }) });
    await until(() => host.events.slice(before).some((e) => e.type === 'embed/origins' && (e as EmbedOriginsEvent).origins.includes('https://late.example.org')), 5000);
  } finally {
    host.close();
  }
});

test("view.context: answered by a URL-entry type's context action, owner only; the type's report sends view/context", async () => {
  const workspace = tempDir('open-artifact-ws-');
  const host = await adapter('ctx-app');
  try {
    const id = await create('ctxtype', { harness: 'ctx-app', session: 'c1', workspace });
    const url = `open-artifact://artifact/${id}`;
    const read = await host.call('view.context', { url, session: 'c1', workspace });
    assert.equal(read.error, undefined, JSON.stringify(read.error));
    assert.deepEqual(read.result, { at: '2026-05-01T10:00:00.000Z', context: { selection: 'B2:C4' }, changed: false });
    assert.equal((contextCalls.at(-1) as { id: string }).id, id);
    const other = await host.call('view.context', { url, session: 'c2', workspace });
    assert.equal(other.error?.data?.code, 'not_granted');

    // A type without a context action: nulls.
    const far = await create('neartype', { harness: 'ctx-app', session: 'c1', workspace });
    const none = await host.call('view.context', { url: `open-artifact://artifact/${far}`, session: 'c1', workspace });
    assert.deepEqual(none.result, { at: null, context: null, changed: false });

    // The type server reports a change: subscribed adapters hear of it.
    const response = await fetch(`${state.url}/api/open-artifact.type.context`, {
      method: 'POST',
      headers: { authorization: `Bearer ${daemon.typeToken('ctxtype')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id, at: '2026-05-01T10:00:05.000Z' }),
    });
    assert.equal(response.status, 200);
    const event = await until(() => host.events.find((e): e is ViewContextEvent => e.type === 'view/context'), 3000);
    assert.deepEqual(event, { type: 'view/context', url, id, at: '2026-05-01T10:00:05.000Z' });
  } finally {
    host.close();
  }
});

test('top-level views over the daemon: host.open carries a ticket; the Shell claims it once; events and commands flow', async () => {
  const workspace = tempDir('open-artifact-ws-');
  const host = await adapter('view-app', { open: { embed: 'view', origins: [] } });
  const other = await adapter('view-other', { open: { embed: 'view', origins: [] } });
  try {
    await host.call('session.attach', { session: 'v1', workspace });
    const id = await create('neartype', { harness: 'view-app', session: 'v1', workspace });
    await fetch(`${state.url}/api/open-artifact.artifacts.open`, { method: 'POST', headers: { 'content-type': 'application/json', origin: state.url }, body: JSON.stringify({ id }) });
    const open = await until(() => host.calls.find((c) => c.method === 'host.open'), 5000);
    const view = open.params.view as string;
    assert.ok(view);
    assert.equal(open.params.embed_url, `${state.url}/a/${id}?oa_view=${view}`, 'the local Shell, with the ticket');
    assert.deepEqual(open.params.remote, { type: 'neartype', origins: [`http://0.0.0.0:${stubPort}`] }, 'a remote type: where its page comes from');

    // A command before the Shell connects waits.
    assert.equal((await host.call('shell.command', { view, command: { openArtifact: 'goto', hash: '#s2' } })).result.ok, true);
    const stolen = await other.call('shell.command', { view, command: { openArtifact: 'goto', hash: '#x' } });
    assert.equal(stolen.error?.data?.code, 'not_found', "another connection cannot use the ticket");

    // A page of another origin cannot claim it.
    const foreign = await fetch(`${state.url}/api/open-artifact.view?view=${view}&id=${id}`, { headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);

    const controller = new AbortController();
    const stream = await fetch(`${state.url}/api/open-artifact.view?view=${view}&id=${id}`, { signal: controller.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    let text = '';
    await until(async () => {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
      return text.includes('#s2');
    }, 5000);
    const key = JSON.parse(/event: view\ndata: (.*)\n/.exec(text)![1]!).key as string;
    assert.ok(key);
    const again = await fetch(`${state.url}/api/open-artifact.view?view=${view}&id=${id}`);
    assert.equal(again.status, 404, 'the ticket is used once');

    const post = await fetch(`${state.url}/api/open-artifact.view`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: state.url },
      body: JSON.stringify({ view, key, event: { openArtifact: 'place', artifact: `open-artifact://artifact/${id}`, hash: '#s3' } }),
    });
    assert.equal(post.status, 200);
    const event = await until(() => host.calls.find((c) => c.method === 'shell.event'), 3000);
    assert.deepEqual(event.params, { view, session: 'v1', event: { openArtifact: 'place', artifact: `open-artifact://artifact/${id}`, hash: '#s3' } });
    controller.abort();
  } finally {
    host.close();
    other.close();
  }
});
