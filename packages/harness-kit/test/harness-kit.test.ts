import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  HARNESS_FEATURES,
  HARNESS_PATH,
  HARNESS_SUBPROTOCOL,
  PROTOCOL_MAX,
  RPC_ERRORS,
  TOOL_DEFINITIONS,
  WAKE_SOURCE_KIND,
  artifactUrl,
  renderSkillBody,
  type WakeDeliverParams,
  type WakeSource,
} from '@open-artifact/protocol';
import { HarnessClient, createHarness, readDaemon, type ArtifactReport, type Harness, type HarnessOptions } from '../src/index.ts';
import { startFakeDaemon, type FakeDaemon } from '../src/testing.ts';

const open: Array<{ close(): unknown }> = [];
after(async () => {
  for (const item of open.reverse()) await item.close();
});

async function fake(options: Parameters<typeof startFakeDaemon>[0] = {}): Promise<FakeDaemon> {
  const daemon = await startFakeDaemon(options);
  open.push(daemon);
  return daemon;
}

async function harness(daemon: FakeDaemon, options: Partial<HarnessOptions> = {}): Promise<Harness> {
  const made = await createHarness({ harness: 'test-app', home: daemon.home, autoStart: false, reconnect: { minMs: 20, maxMs: 100 }, ...options });
  open.unshift(made);
  return made;
}

async function until<T>(check: () => T, timeoutMs = 3000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((done) => setTimeout(done, 10));
  }
}

const source = (artifactId: string): WakeSource => ({
  kind: WAKE_SOURCE_KIND,
  artifactId,
  url: artifactUrl(artifactId),
  title: 'Deck',
  root: '/tmp/deck',
  viewUrl: 'http://127.0.0.1/a/' + artifactId,
  threads: [],
  requests: [],
  summary: 'A comment',
  reason: 'comment',
  from: { kind: 'owner' },
});

// ---- the fake daemon itself ----

test('fake daemon: writes daemon.json, answers health and hello over a real WebSocket, records calls', async () => {
  const daemon = await fake({ features: ['hello.profile'] });
  assert.ok(existsSync(join(daemon.home, 'daemon.json')));
  const state = await readDaemon(daemon.home);
  assert.equal(state?.url, daemon.url);
  assert.equal(state?.token, daemon.token);

  const ws = new WebSocket(`${daemon.url.replace(/^http/, 'ws')}${HARNESS_PATH}`, [HARNESS_SUBPROTOCOL]);
  await new Promise<void>((done, fail) => {
    ws.addEventListener('open', () => done(), { once: true });
    ws.addEventListener('error', () => fail(new Error('no connection')), { once: true });
  });
  assert.equal(ws.protocol, HARNESS_SUBPROTOCOL);
  const answers: Array<{ id: number; result?: unknown; error?: { code: number } }> = [];
  ws.addEventListener('message', (event) => answers.push(JSON.parse(String(event.data))));
  const call = async (id: number, method: string, params: unknown) => {
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return until(() => answers.find((a) => a.id === id));
  };
  assert.equal((await call(1, 'hello', { harness: 'x', token: 'wrong' })).error?.code, RPC_ERRORS.server);
  assert.equal((await call(2, 'hello', { harness: 'x', token: daemon.token, protocols: { min: 50, max: 60 } })).error?.code, RPC_ERRORS.server);
  const hello = (await call(3, 'hello', { harness: 'x', token: daemon.token })).result as { protocol: number; features: string[] };
  assert.equal(hello.protocol, 1);
  assert.deepEqual(hello.features, ['hello.profile']);
  assert.equal((await call(4, 'no.such.method', {})).error?.code, RPC_ERRORS.methodNotFound);
  assert.deepEqual(
    daemon.calls.map((c) => c.method),
    ['hello', 'hello', 'hello', 'no.such.method'],
  );
  assert.equal((await daemon.waitFor('no.such.method')).connection, 1);
  ws.close();
});

test('fake daemon: serves artifact?id= from setArtifact, with the token', async () => {
  const daemon = await fake();
  daemon.setArtifact({ id: 'a1', title: 'Deck' });
  const ok = await fetch(`${daemon.url}/api/open-artifact.artifact?id=a1`, { headers: { Authorization: `Bearer ${daemon.token}` } });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { title: string }).title, 'Deck');
  assert.equal((await fetch(`${daemon.url}/api/open-artifact.artifact?id=a1`)).status, 401);
  daemon.removeArtifact('a1');
  assert.equal((await fetch(`${daemon.url}/api/open-artifact.artifact?id=a1`, { headers: { Authorization: `Bearer ${daemon.token}` } })).status, 404);
});

// ---- createHarness ----

test('createHarness: hello says the kit, the protocols, the caps the callbacks imply, and a profile without nudge', async () => {
  const daemon = await fake();
  const h = await harness(daemon, {
    agentName: 'Bot',
    commands: ['artifact'],
    rules: 'Be brief.',
    policy: { offer: 'asked' },
    profile: { markers: ['TEST_APP'], nudge: { command: 'x', args: [] } } as HarnessOptions['profile'],
    embed: { origins: ['app://test'] },
    wake: () => 'resumed',
    open: () => true,
  });
  assert.equal(h.connected, true);
  const hello = daemon.hellos[0]!;
  assert.equal(hello.harness, 'test-app');
  assert.deepEqual(hello.protocols, { min: 1, max: PROTOCOL_MAX });
  assert.equal(hello.kit?.name, '@open-artifact/harness-kit');
  assert.match(hello.kit?.version ?? '', /^\d+\.\d+\.\d+/);
  assert.deepEqual(hello.caps, { agentName: 'Bot', wake: {}, open: { embed: 'frame', origins: ['app://test'], remote: 'ask' }, commands: { names: ['artifact'] } });
  assert.equal(hello.profile?.agentName, 'Bot');
  assert.deepEqual(hello.profile?.markers, ['TEST_APP']);
  assert.equal(hello.profile?.rules, 'Be brief.');
  assert.equal((hello.profile as Record<string, unknown>).nudge, undefined);
});

test('createHarness: without callbacks it claims neither wake nor open', async () => {
  const daemon = await fake();
  await harness(daemon, { caps: { wake: { resume: true }, open: true, tools: 'native' } });
  assert.deepEqual(daemon.hellos[0]!.caps, { tools: 'native' });
});

test('reconnect: a dropped connection comes back and attaches every session again', async () => {
  const daemon = await fake();
  const states: string[] = [];
  const h = await harness(daemon);
  h.on('state', (state) => states.push(state));
  await h.attach({ session: 's1', workspace: '/w', title: 'One' });
  await h.attach({ session: 's2', workspace: '/w' });
  await h.status('s1', 'running');
  await h.detach('s2');
  daemon.drop();
  await until(() => daemon.calls.some((c) => c.method === 'session.attach' && c.connection === 2));
  const reattached = daemon.calls.filter((c) => c.method === 'session.attach' && c.connection === 2).map((c) => c.params);
  assert.deepEqual(reattached, [{ session: 's1', workspace: '/w', title: 'One', status: 'running' }]);
  assert.equal(daemon.hellos.length, 2);
  assert.ok(h.connected);
  assert.deepEqual(states, ['disconnected', 'connected']);
});

test('reconnect: the first connect may fail; the harness keeps trying until a daemon is there', async () => {
  const home = mkdtempSync(join(tmpdir(), 'oa-kit-home-'));
  const h = await createHarness({ harness: 'late-app', home, autoStart: false, reconnect: { minMs: 20, maxMs: 40 } });
  open.unshift(h);
  assert.equal(h.connected, false);
  const daemon = await fake({ home });
  await until(() => h.connected);
  assert.equal(daemon.hellos[0]!.harness, 'late-app');
});

test('inbox: what waited is handed to wake on attach; what wake did not take comes back from attach', async () => {
  const daemon = await fake();
  const woken: WakeDeliverParams[] = [];
  const h = await harness(daemon, {
    wake: (params) => {
      woken.push(params);
      return params.text.includes('refuse') ? 'failed' : 'resumed';
    },
  });
  daemon.queueInbox('s1', { text: 'Make it blue', source: source('a1'), artifact: artifactUrl('a1'), artifactId: 'a1' });
  daemon.queueInbox('s1', { text: 'please refuse', source: source('a2') });
  daemon.queueInbox('s1', { kind: 'note', text: 'Just a note' });
  const { key, inbox } = await h.attach({ session: 's1', workspace: '/w' });
  assert.equal(key, 'test-app:s1');
  assert.deepEqual(
    woken.map((w) => [w.session, w.workspace, w.artifactId, w.text]),
    [
      ['s1', '/w', 'a1', 'Make it blue'],
      ['s1', '/w', 'a2', 'please refuse'],
    ],
  );
  assert.deepEqual(
    inbox.map((m) => m.text),
    ['please refuse', 'Just a note'],
  );
});

test('inbox: on a re-attach after a reconnect, waiting messages go to wake too', async () => {
  const daemon = await fake();
  const woken: string[] = [];
  const h = await harness(daemon, { wake: (params) => (woken.push(params.text), 'delivered') });
  await h.attach({ session: 's1', workspace: '/w' });
  daemon.drop();
  daemon.queueInbox('s1', { text: 'While you were away', source: source('a1') });
  await until(() => woken.length === 1);
  assert.deepEqual(woken, ['While you were away']);
});

test('wake: the callback answers the daemon; a slow or throwing one answers failed', async () => {
  const daemon = await fake();
  let mode: 'ok' | 'session' | 'slow' | 'throw' = 'ok';
  await harness(daemon, {
    wakeTimeoutMs: 50,
    wake: () => {
      if (mode === 'slow') return new Promise(() => undefined);
      if (mode === 'throw') throw new Error('boom');
      if (mode === 'session') return { status: 'resumed', session: 's9' };
      return 'drafted';
    },
  });
  assert.deepEqual(await daemon.wake({ session: 's1', text: 'hi' }), { status: 'drafted' });
  mode = 'session';
  assert.deepEqual(await daemon.wake({ session: 's1', text: 'hi' }), { status: 'resumed', session: 's9' });
  mode = 'slow';
  assert.deepEqual(await daemon.wake({ session: 's1', text: 'hi' }), { status: 'failed' });
  mode = 'throw';
  assert.deepEqual(await daemon.wake({ session: 's1', text: 'hi' }), { status: 'failed' });
});

test('open: host.open goes to the open callback', async () => {
  const daemon = await fake();
  const asked: unknown[] = [];
  await harness(daemon, { open: (request) => (asked.push(request), request.title !== 'no') });
  assert.deepEqual(await daemon.open({ url: artifactUrl('a1'), session: 's1', title: 'Deck', view: 'v1', embed_url: 'http://x/embed' }), { opened: true });
  assert.deepEqual(asked[0], { session: 's1', url: artifactUrl('a1'), viewUrl: `${daemon.url}/a/a1`, embedUrl: 'http://x/embed', view: 'v1', title: 'Deck' });
  assert.deepEqual(await daemon.open({ url: artifactUrl('a1'), title: 'no' }), { opened: false });
});

test('tools: the daemon’s when connected, the bundled definitions when not', async () => {
  const mine = [{ name: 'Artifact', description: 'mine', inputSchema: { type: 'object' as const, properties: {} } }];
  const daemon = await fake({ tools: mine as never });
  const h = await harness(daemon);
  assert.deepEqual(await h.tools(), mine);
  const home = mkdtempSync(join(tmpdir(), 'oa-kit-home-'));
  const offline = await createHarness({ harness: 'offline-app', home, autoStart: false, reconnect: { minMs: 5000 } });
  open.unshift(offline);
  const tools = await offline.tools();
  assert.deepEqual(
    tools.map((t) => t.name),
    TOOL_DEFINITIONS.map((t) => t.name),
  );
  assert.notEqual(tools[0], TOOL_DEFINITIONS[0], 'a copy, not the shared definitions');
});

test('call, wrote, open: go to the daemon with the caller', async () => {
  const daemon = await fake({ onToolCall: (name, args) => ({ content: [{ type: 'text', text: `${name}:${JSON.stringify(args)}` }] }) });
  const h = await harness(daemon);
  const result = await h.call('Artifact', { action: 'list' }, { session: 's1' });
  assert.deepEqual(result.content, [{ type: 'text', text: 'Artifact:{"action":"list"}' }]);
  assert.deepEqual((await daemon.waitFor('tools.call')).params, { name: 'Artifact', arguments: { action: 'list' }, caller: { session: 's1' } });
  await h.wrote(['/w/a.html'], { session: 's1' });
  assert.deepEqual((await daemon.waitFor('agent.wrote')).params, { paths: ['/w/a.html'], caller: { session: 's1' } });
  assert.equal((await h.open(artifactUrl('a1'), { session: 's1' })).view_url, `${daemon.url}/a/a1`);
});

test('owns: a call about an open-artifact:// link', async () => {
  const daemon = await fake();
  const h = await harness(daemon);
  assert.equal(h.owns({ action: 'publish', type_url: 'open-artifact://type/slides' }), true);
  assert.equal(h.owns({ action: 'read', url: ' open-artifact://artifact/a1' }), true);
  assert.equal(h.owns({ action: 'read', url: 'https://claude.ai/artifact/x' }), false);
  assert.equal(h.owns({ action: 'list' }), false);
  assert.equal(h.owns(null), false);
});

test('viewUrl: the local Shell page, also when published (publicUrl is the site); null when unknown', async () => {
  const daemon = await fake();
  const h = await harness(daemon);
  daemon.setArtifact({ id: 'art_aaaaaaaaa1' });
  daemon.setArtifact({ id: 'art_aaaaaaaaa2', remote: { url: 'https://site.example/art_aaaaaaaaa2' } as never });
  assert.equal(await h.viewUrl(artifactUrl('art_aaaaaaaaa1')), `${daemon.url}/a/art_aaaaaaaaa1`);
  assert.equal(await h.viewUrl(artifactUrl('art_aaaaaaaaa2')), `${daemon.url}/a/art_aaaaaaaaa2`);
  assert.equal(await h.publicUrl(artifactUrl('art_aaaaaaaaa2')), 'https://site.example/art_aaaaaaaaa2');
  assert.equal(await h.publicUrl(artifactUrl('art_aaaaaaaaa1')), null);
  assert.equal(await h.viewUrl(artifactUrl('art_nopenopeno')), null);
});

test("on('artifact'): created, updated and removed, with the owning session of this harness", async () => {
  const daemon = await fake();
  const h = await harness(daemon);
  const reports: ArtifactReport[] = [];
  const stop = h.on('artifact', (report) => reports.push(report));
  await daemon.waitFor('subscribe');
  daemon.setArtifact({
    id: 'a1',
    title: 'Deck',
    type: 'slides',
    thumbnail: 'v7',
    owner: { harness: 'test-app', session: 's1', workspace: '/w', live: true, status: 'idle' },
  });
  daemon.setArtifact({ id: 'old', title: 'Old', createdAt: '2020-01-01T00:00:00.000Z', owner: { harness: 'other-app', session: 'x', workspace: '/w', live: true, status: 'idle' } });

  daemon.emit({ type: 'artifacts/changed', id: 'a1', author: 'agent', paths: ['index.html'] });
  await until(() => reports.length === 1);
  assert.equal(reports[0]!.change, 'created');
  assert.equal(reports[0]!.session, 's1');
  assert.equal(reports[0]!.workspace, '/w');
  assert.equal(reports[0]!.author, 'agent');
  assert.deepEqual(reports[0]!.paths, ['index.html']);
  assert.equal(reports[0]!.artifact.url, artifactUrl('a1'));
  assert.equal(reports[0]!.artifact.viewUrl, `${daemon.url}/a/a1`);
  assert.equal(reports[0]!.artifact.thumbnail, `${daemon.url}/api/open-artifact.artifacts.thumbnail?id=a1&v=v7`);

  daemon.emit({ type: 'artifacts/changed', id: 'a1' });
  await until(() => reports.length === 2);
  assert.equal(reports[1]!.change, 'updated');

  daemon.emit({ type: 'artifacts/changed', id: 'old' });
  await until(() => reports.length === 3);
  assert.equal(reports[2]!.change, 'updated', 'made before the kit followed: not a creation');
  assert.equal(reports[2]!.session, null, 'not one of this harness’s sessions');

  daemon.removeArtifact('a1');
  daemon.emit({ type: 'artifacts/changed', id: 'a1', removed: true });
  await until(() => reports.length === 4);
  assert.equal(reports[3]!.change, 'removed');
  assert.equal(reports[3]!.artifact.title, 'Deck');
  assert.equal(reports[3]!.artifact.viewUrl, null);

  stop();
  await until(() => daemon.calls.some((c) => c.method === 'subscribe' && (c.params as { on: boolean }).on === false));
});

test("on('event'): every event the daemon sends", async () => {
  const daemon = await fake();
  const h = await harness(daemon);
  const events: unknown[] = [];
  h.on('event', (event) => events.push(event));
  await daemon.waitFor('subscribe');
  daemon.emit({ type: 'types/changed' } as never);
  await until(() => events.length === 1);
  assert.deepEqual(events, [{ type: 'types/changed' }]);
});

test('HarnessClient: the low-level connection sends protocols and normalizes features', async () => {
  const daemon = await fake();
  const client = new HarnessClient({ harness: 'raw-app', autoStart: false, daemon: { home: daemon.home } });
  open.unshift(client);
  const hello = await client.connect();
  assert.deepEqual(hello.features, [...HARNESS_FEATURES], 'the fake lists what the real daemon lists');
  assert.deepEqual(daemon.hellos[0]!.protocols, { min: 1, max: PROTOCOL_MAX });
  assert.ok(JSON.parse(readFileSync(join(daemon.home, 'daemon.json'), 'utf8')).token);
});

test('fake daemon: a daemon that lists no features is played with features: []', async () => {
  const daemon = await fake({ features: [] });
  const client = new HarnessClient({ harness: 'old-app', autoStart: false, daemon: { home: daemon.home } });
  open.unshift(client);
  assert.deepEqual((await client.connect()).features, []);
});

test('fake daemon: skill.get renders the protocol template for the caps; commands.list gives an entry per type', async () => {
  const daemon = await fake({ types: [{ id: 'slides', title: 'Slides', description: 'Decks.' }, { id: 'docs', title: 'Docs' }] });
  const h = await harness(daemon, { agentName: 'Example', caps: { tools: 'native', commands: { names: ['artifact'], menu: true } } });
  const dir = mkdtempSync(join(tmpdir(), 'oa-kit-skill-'));
  const installed = await h.installSkill({ dir, form: 'entry' });
  assert.equal(installed.source, 'daemon');
  const text = readFileSync(join(dir, 'artifact', 'SKILL.md'), 'utf8');
  assert.ok(text.includes(renderSkillBody({ command: 'artifact', agentName: 'Example', tools: 'native' }, 'entry')), 'the body is the protocol template for these caps');
  assert.match(text, /- `docs`: Docs\n- `slides`: Slides\. Decks\./);
  assert.deepEqual(
    (await h.commands()).map((c) => c.text),
    ['/artifact docs ', '/artifact slides '],
  );
  const skill = (await h.client.request('skill.get', { command: 'other' })) as { name: string; etag: string };
  assert.equal(skill.name, 'other');
  assert.ok(skill.etag);
});

test('fake daemon: skill.get and commands.list are overridable by the test', async () => {
  const daemon = await fake({
    onSkill: (params) => ({ name: params.command ?? 'x', description: 'd', argumentHint: 'h', body: '# Mine\n', version: '1', etag: 'e1' }),
    onCommands: () => ({ commands: [{ text: '/x mine ', type: 'mine', title: 'Mine', description: '' }] }),
  });
  const h = await harness(daemon);
  assert.equal(((await h.client.request('skill.get', { command: 'x' })) as { body: string }).body, '# Mine\n');
  assert.deepEqual((await h.commands()).map((c) => c.type), ['mine']);
});

test('runtime: status and update go to the daemon; without the feature they are unsupported', async () => {
  const asked: Array<string | undefined> = [];
  const daemon = await fake({
    version: '1.2.0',
    runtimeStatus: { pin: '^1' },
    onRuntimeUpdate: (version) => (asked.push(version), { installed: version ?? '1.3.0', pending: true, message: 'Installed.' }),
  });
  const h = await harness(daemon, { runtime: { dir: '/opt/oa', version: '1.2.0' } });
  const status = await h.runtime.status();
  assert.equal(status.running, '1.2.0');
  assert.equal(status.pin, '^1');
  assert.deepEqual(status.runtimes.map((r) => r.dir), ['/opt/oa']);
  assert.deepEqual(await h.runtime.update(), { installed: '1.3.0', pending: true, message: 'Installed.' });
  assert.equal((await h.runtime.update('1.4.0')).installed, '1.4.0');
  assert.deepEqual(asked, [undefined, '1.4.0']);

  const old = await fake({ features: [] });
  const h2 = await harness(old);
  await assert.rejects(h2.runtime.status(), (error: { code?: string }) => error.code === 'unsupported');
  await assert.rejects(h2.runtime.update(), (error: { code?: string }) => error.code === 'unsupported');
  assert.ok(!old.calls.some((c) => c.method.startsWith('runtime.')));
});
