/**
 * The site hub (`hub.ts`): events emitted to it reach every Library stream it serves, a stream that leaves releases its
 * listeners, an idle stream is written a heartbeat, and after a new instance (eviction, redeploy) a reconnecting
 * client is served again. The hub is driven as its object would be (`fetch`), and through {@link HubClient} the way the
 * Worker and the objects call it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Catalog, HostEvents, type HostConfig } from '@open-artifact/host';
import { d1Driver, ensureMigrated } from '../src/d1.ts';
import { EVENTS_PATH, ForwardingEvents, HUB_CALL_HEADER, HubClient, LINK_EVENTS_PATH, SiteHub } from '../src/hub.ts';
import { fakeD1 } from './d1-fake.ts';

const KEYS = ['s'.repeat(40)];
const config: HostConfig = {
  appOrigin: 'http://localhost:8787',
  contentOrigin: 'http://{id}.content.localhost:8787',
  signingKeys: KEYS,
  auth: [{ kind: 'owner-key' }],
  owners: [],
  signup: 'invite',
  linkMaxRole: 'editor',
  publicAccess: true,
};

async function site() {
  const driver = d1Driver(fakeD1());
  await ensureMigrated(driver, {});
  const catalog = new Catalog(driver, { signingKeys: KEYS });
  const ada = await catalog.createUser({ name: 'Ada' });
  const bob = await catalog.createUser({ name: 'Bob' });
  const board = await catalog.createArtifact({ type: 'whiteboard', title: 'Retro', ownerUser: ada.id });
  const other = await catalog.createArtifact({ type: 'whiteboard', title: 'Bob only', ownerUser: bob.id });
  const cookie = async (userId: string): Promise<string> => `oa_session=${(await catalog.createSession({ userId, ttlMs: 3_600_000 })).token}`;
  // The Library tests count listeners: the outbox feed (its own two) is off there, on in the Link test.
  const hub = (heartbeatMs?: number, linkFeed = false) => new SiteHub({ config, catalog: async () => catalog, log: () => undefined, linkFeed, ...(heartbeatMs ? { heartbeatMs } : {}) });
  return { catalog, ada, bob, board, other, cookie, hub };
}

/** A Library stream of the hub, read as text. */
async function open(hub: SiteHub, cookie: string, path = EVENTS_PATH, headers: Record<string, string> = {}) {
  const response = await hub.fetch(new Request(`http://localhost:8787${path}`, { headers: { cookie, accept: 'text/event-stream', ...headers } }));
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  let text = '';
  const decoder = new TextDecoder();
  return {
    async until(match: RegExp, ms = 3000): Promise<string> {
      const deadline = Date.now() + ms;
      while (!match.test(text)) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`Not seen in ${ms} ms: ${match}. Got: ${text}`);
        const next = await Promise.race([reader.read(), new Promise<null>((done) => setTimeout(() => done(null), left))]);
        if (next && !next.done) text += decoder.decode(next.value);
        if (next?.done) throw new Error(`Ended before ${match}. Got: ${text}`);
      }
      return text;
    },
    get text() {
      return text;
    },
    close: () => reader.cancel(),
  };
}

const tick = (ms = 30): Promise<void> => new Promise((done) => setTimeout(done, ms));

test('an emitted event reaches every stream that may see the artifact, and only those', async () => {
  const { ada, bob, board, other, cookie, hub: make } = await site();
  const hub = make();
  const one = await open(hub, await cookie(ada.id));
  const two = await open(hub, await cookie(ada.id));
  const bobs = await open(hub, await cookie(bob.id));
  for (const stream of [one, two, bobs]) await stream.until(/: hello/);
  assert.equal(hub.stats().streams, 3);
  assert.equal(hub.stats().listeners['artifact-touched'], 3);

  hub.emit('artifact-touched', { id: board.id, author: 'owner', paths: ['db/x'] });
  await one.until(new RegExp(board.id));
  await two.until(new RegExp(board.id));
  hub.emit('artifact-changed', { id: other.id });
  await bobs.until(new RegExp(other.id));
  await tick(100);
  assert.doesNotMatch(bobs.text, new RegExp(board.id), "Bob does not hear of Ada's artifact");
  assert.doesNotMatch(one.text, new RegExp(other.id));
  for (const stream of [one, two, bobs]) await stream.close();
});

test('a stream that leaves releases its listeners; an idle one is written a heartbeat', async () => {
  const { ada, cookie, hub: make } = await site();
  const hub = make(60);
  const stream = await open(hub, await cookie(ada.id));
  await stream.until(/: hello/);
  await stream.until(/: ping/, 1000);
  assert.equal(hub.stats().listeners['artifact-changed'], 1);
  await stream.close();
  const deadline = Date.now() + 2000;
  while (hub.stats().streams !== 0 && Date.now() < deadline) await tick(20);
  assert.deepEqual(hub.stats().listeners, { 'artifact-touched': 0, 'artifact-changed': 0, 'access-changed': 0, outbox: 0, 'agent-changed': 0 });
  assert.equal(hub.stats().streams, 0);
});

test('a client that reconnects to a new instance (eviction, redeploy) is served again', async () => {
  const { ada, board, cookie, hub: make } = await site();
  const session = await cookie(ada.id);
  const first = make();
  const stream = await open(first, session);
  await stream.until(/: hello/);
  // The old instance is gone: its streams end (here: the client sees it end and reconnects).
  await stream.close();
  const second = make();
  const again = await open(second, session);
  await again.until(/: hello/);
  // An event emitted to the old instance is not heard on the new one (what the Library then reads again is the list).
  first.emit('artifact-changed', { id: board.id });
  second.emit('artifact-touched', { id: board.id, author: 'owner', paths: [] });
  await again.until(new RegExp(`"author":"owner"`));
  assert.equal((again.text.match(new RegExp(board.id, 'g')) ?? []).length, 1);
  await again.close();
});

test('without a session the stream still serves public events only; an unknown bearer is refused', async () => {
  const { catalog, ada, hub: make } = await site();
  const hub = make();
  const pub = await catalog.createArtifact({ type: 'whiteboard', title: 'Public', ownerUser: ada.id, generalAccess: 'public' });
  const anon = await open(hub, '');
  await anon.until(/: hello/);
  hub.emit('artifact-changed', { id: pub.id });
  await anon.until(new RegExp(pub.id));
  await anon.close();
  const bearer = await hub.fetch(new Request(`http://localhost:8787${EVENTS_PATH}`, { headers: { authorization: 'Bearer nope' } }));
  assert.equal(bearer.status, 401);
});

test('the client: emit, presence and stats go over the hub calls; a browser cannot make a hub call', async () => {
  const { ada, board, cookie, hub: make } = await site();
  const hub = make();
  const stubs: number[] = [];
  const client = new HubClient(() => {
    stubs.push(stubs.length);
    return { fetch: (request: Request) => hub.fetch(request) };
  });
  const stream = await open(hub, await cookie(ada.id));
  await stream.until(/: hello/);
  await client.emit('artifact-touched', { id: board.id, author: 'owner', paths: [] });
  await stream.until(new RegExp(board.id));
  assert.equal(await client.online(ada.id), false);
  await client.setOnline(ada.id, 'link-1', true);
  await client.setOnline(ada.id, 'link-2', true);
  await client.setOnline(ada.id, 'link-1', false);
  assert.equal(await client.online(ada.id), true, 'one connection still holds them online');
  await client.setOnline(ada.id, 'link-2', false);
  assert.equal(await client.online(ada.id), false);
  const stats = await client.stats();
  assert.equal(stats.emitted, 1);
  assert.equal(stubs.length, 9, 'a stub per call (a stub cannot cross requests in a Worker)');
  // A browser's request to the stream path with the hub-call header stripped is the stream, not a call.
  const forwarded = await client.stream(new Request(`http://localhost:8787${EVENTS_PATH}`, { headers: { [HUB_CALL_HEADER]: '1', cookie: await cookie(ada.id) } }));
  assert.match(forwarded.headers.get('content-type') ?? '', /event-stream/);
  await forwarded.body?.cancel();
  assert.equal((await hub.fetch(new Request('http://hub.internal/emit', { method: 'POST', headers: { [HUB_CALL_HEADER]: '1' }, body: JSON.stringify({ name: 'nope', payload: {} }) }))).status, 400);
  await stream.close();
});

test("the Worker's events hear their own emit and forward it to the hub after the answer", async () => {
  const sent: Array<{ name: string; payload: unknown }> = [];
  const later: Promise<unknown>[] = [];
  const events = new ForwardingEvents({ emit: async (name, payload) => void sent.push({ name, payload }), online: async () => false }, (p) => later.push(p), () => undefined);
  assert.ok(events instanceof HostEvents);
  const heard: unknown[] = [];
  events.on('outbox', (payload) => heard.push(payload));
  events.emit('outbox', { userId: 'u1' });
  await Promise.all(later);
  assert.deepEqual(heard, [{ userId: 'u1' }]);
  assert.deepEqual(sent, [{ name: 'outbox', payload: { userId: 'u1' } }]);
  // A hub that fails does not fail the request.
  const failing = new ForwardingEvents({ emit: async () => Promise.reject(new Error('down')), online: async () => false }, (p) => later.push(p), () => undefined);
  failing.emit('outbox', { userId: 'u2' });
  await Promise.all(later);
});

test('the Link stream: every connection of the owner gets each edit, never its own pushes, until acknowledged', async () => {
  const { catalog, ada, bob, board, other, hub: make } = await site();
  const hub = make(undefined, true);
  await hub.feedReady();
  const issued = await catalog.issueAgentToken({ userId: ada.id, label: 'laptop', scopes: ['link'], accessTtlMs: 3600_000, refreshTtlMs: 86400_000 });
  const link = (after?: string) => open(hub, '', `${LINK_EVENTS_PATH}${after ? `?after=${after}` : ''}`, { authorization: `Bearer ${issued.accessToken}` });
  const one = await link();
  const two = await link();
  await one.until(/: hello/);
  await two.until(/: hello/);
  assert.equal(hub.stats().links, 2);
  assert.equal(hub.isOnline(ada.id), true, 'a Link stream holds its owner online');
  assert.equal(hub.isOnline(bob.id), false);

  // A person's edit reaches both connections; the Link's own push (author agent) is not echoed; Bob's artifact
  // (no Link token) queues nothing.
  hub.emit('artifact-touched', { id: board.id, author: 'agent', paths: ['db/pushed'] });
  hub.emit('artifact-touched', { id: board.id, author: 'owner', paths: ['db/edited'] });
  hub.emit('artifact-touched', { id: other.id, author: 'owner', paths: ['db/bob'] });
  const seen = await one.until(/db\/edited/);
  await two.until(/db\/edited/);
  await tick(100);
  assert.doesNotMatch(one.text + two.text, /db\/pushed|db\/bob/);
  const id = /id: (\d+)/.exec(seen)![1]!;
  assert.match(seen, new RegExp(`"type":"files","artifact":"${board.id}","author":"owner","paths":\\["db/edited"\\]`));
  await one.close();
  await two.close();
  const deadline = Date.now() + 2000;
  while (hub.stats().links !== 0 && Date.now() < deadline) await tick(20);
  assert.equal(hub.isOnline(ada.id), false);

  // Not acknowledged: a new connection is sent it again. Acknowledged: not any more.
  const again = await link();
  await again.until(/db\/edited/);
  await again.close();
  await catalog.ackOutbox(ada.id, [Number(id)]);
  hub.emit('artifact-changed', { id: board.id });
  const last = await link();
  await last.until(/"type":"artifact"/);
  assert.doesNotMatch(last.text, /db\/edited/);
  await last.close();
});

test('a room that asked about its owner is told when their agent comes or goes, until it forgets', async () => {
  const { ada, bob } = await site();
  const told: string[] = [];
  const hub = new SiteHub({ config, catalog: async () => { throw new Error('unused'); }, log: () => undefined, linkFeed: false, notifyRoom: async (room) => void told.push(room) });
  const client = new HubClient(() => ({ fetch: (request: Request) => hub.fetch(request) }));
  // The Shells' streams hear the same flips (`agent-changed`: the Ask pane's words), and only the flips.
  const flips: string[] = [];
  hub.events.on('agent-changed', ({ userId }) => void flips.push(userId));
  assert.equal(await client.online(ada.id, 'art-a'), false);
  assert.equal(await client.online(ada.id, 'art-b'), false);
  assert.equal(await client.online(bob.id, 'art-c'), false);
  assert.equal(hub.stats().watchingRooms, 3);
  await client.setOnline(ada.id, 'link-1', true);
  assert.deepEqual(told.splice(0).sort(), ['art-a', 'art-b'], "Ada's rooms, not Bob's");
  // A second connection changes nothing a page shows: no call.
  await client.setOnline(ada.id, 'link-2', true);
  await client.setOnline(ada.id, 'link-1', false);
  assert.deepEqual(told, []);
  // A room whose artifact closed is not called (it would wake a sleeping object).
  await client.forget('art-b');
  await client.setOnline(ada.id, 'link-2', false);
  assert.deepEqual(told.splice(0), ['art-a']);
  assert.equal(hub.stats().watchingRooms, 2);
  assert.equal(hub.stats().notified, 3);
  assert.deepEqual(flips, [ada.id, ada.id]);
  // Asking again watches again; a failing room does not fail the hub.
  const failing = new SiteHub({ config, catalog: async () => { throw new Error('unused'); }, log: () => undefined, linkFeed: false, notifyRoom: async () => Promise.reject(new Error('gone')) });
  failing.online(ada.id, 'art-a');
  failing.setOnline(ada.id, 'x', true);
});
