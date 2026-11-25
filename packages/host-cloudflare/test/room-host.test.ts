/**
 * The product room host (`room-host.ts`): the Node host's rooms scenarios (`packages/host/test/rooms.test.ts`) on the
 * Cloudflare pieces. Each artifact is an {@link ArtifactRoom} (as its Durable Object would hold it) on the SQLite file
 * system, its identity decided by {@link createProductRoomHost} over the catalog on D1 (the fake that keeps D1's
 * rules), with a fake hub that records what it is told and says who is online.
 *
 * `node:fs` is aliased to this package's file system as in `room-node.test.ts` (the hook is the same).
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import { testStorage } from './sqlite.ts';
import { fakeD1 } from './d1-fake.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '../../..');
const fsDir = join(repo, 'packages/host-cloudflare/src/fs/');
const editors = join(repo, 'dist/server');

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : '';
    const aliased = parent.startsWith(repo) && !parent.startsWith(fsDir) && !parent.includes('/node_modules/') && !parent.includes('/packages/wasm-sheets/') && !parent.includes('/host-cloudflare/test/');
    if (aliased && (specifier === 'node:fs' || specifier === 'fs')) return { url: pathToFileURL(join(fsDir, 'index.ts')).href, shortCircuit: true };
    if (aliased && (specifier === 'node:fs/promises' || specifier === 'fs/promises')) return { url: pathToFileURL(join(fsDir, 'promises.ts')).href, shortCircuit: true };
    return next(specifier, context);
  },
});

// Loaded after the hook (the host core and the room import `node:fs`).
type Host = typeof import('@open-artifact/host');
type Rooms = typeof import('../src/room.ts');
type RoomHosts = typeof import('../src/room-host.ts');
type D1 = typeof import('../src/d1.ts');
let core: Host;
let rooms: Rooms;
let roomHosts: RoomHosts;
let d1: D1;

const KEYS = ['s'.repeat(40)];

const assets = {
  async fetch(request: Request): Promise<Response> {
    const path = decodeURIComponent(new URL(request.url).pathname.replace(/^\/_open-artifact\//, ''));
    const file = join(editors, path);
    if (!file.startsWith(editors) || !existsSync(file) || statSync(file).isDirectory()) return new Response(null, { status: 404 });
    return new Response(readFileSync(file));
  },
};

function folderFiles(dir: string): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name !== '.gitignore') out[relative(dir, path)] = readFileSync(path);
    }
  };
  walk(dir);
  return out;
}

/** Fake sockets: every pair the room makes, with what was sent and whether it closed. */
function sockets() {
  const made: Array<{ sent: string[]; closed: boolean }> = [];
  const pair = () => {
    const record = { sent: [] as string[], closed: false };
    made.push(record);
    const server = {
      accept() {},
      send(message: string | ArrayBuffer | ArrayBufferView) {
        record.sent.push(typeof message === 'string' ? message : Buffer.from(message as ArrayBuffer).toString('utf8'));
      },
      close() {
        record.closed = true;
      },
      addEventListener() {},
    };
    return [{ client: true }, server] as [unknown, typeof server];
  };
  return { made, pair };
}

async function until(check: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((done) => setTimeout(done, 20));
  }
}

interface Answer {
  status: number;
  headers: Headers;
  body: string;
}

describe('the product room host', () => {
  let config: import('@open-artifact/host').HostConfig;
  let catalog: import('@open-artifact/host').Catalog;
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const online = new Set<string>();
  const hub = {
    async emit(name: string, payload: unknown) {
      emitted.push({ name, payload });
    },
    async online(userId: string) {
      return online.has(userId);
    },
  };
  type Principal = import('@open-artifact/host').Principal;
  type ArtifactRow = import('@open-artifact/host').ArtifactRow;
  type ArtifactRole = import('@open-artifact/host').ArtifactRole;
  type UserRecord = import('@open-artifact/host').UserRecord;
  let ada: UserRecord, bob: UserRecord, eve: UserRecord, cam: UserRecord, adm: UserRecord;
  let board: ArtifactRow, design: ArtifactRow, open: ArtifactRow;
  let guest: Principal;

  interface Live {
    room: InstanceType<Rooms['ArtifactRoom']>;
    host: import('../src/room-host.ts').ProductRoomHost;
    ws: ReturnType<typeof sockets>;
  }
  const live = new Map<string, Live>();

  /** The artifact's object (made once, as `idFromName(id)` would find it). */
  const objectOf = async (artifact: ArtifactRow, files: Record<string, Uint8Array | string> = {}): Promise<Live> => {
    const known = live.get(artifact.id);
    if (known) return known;
    const ws = sockets();
    let room: InstanceType<Rooms['ArtifactRoom']> | null = null;
    const host = roomHosts.createProductRoomHost({ config, catalog, hub, rootOf: (id) => room!.rootOf(id) });
    room = new rooms.ArtifactRoom({ storage: testStorage(), id: { toString: () => artifact.id, name: artifact.id } }, { ASSETS: assets }, {
      host: host.host,
      pair: ws.pair,
      upgraded: () => new Response(null, { status: 204, headers: { 'x-upgraded': '1' } }),
      log: () => undefined,
    });
    await room.seed(artifact.id, files);
    const made = { room, host, ws };
    live.set(artifact.id, made);
    return made;
  };

  const userOf = (record: UserRecord): Principal => ({
    kind: 'user',
    id: record.id,
    name: record.name,
    ...(record.email ? { email: record.email, emailVerified: record.emailVerified } : {}),
    siteRole: record.siteRole,
  });
  /** A page path for this principal (as `pageFor` mints it in the Worker). */
  const pathFor = async (artifact: ArtifactRow, principal: Principal, role: ArtifactRole, now = new Date()): Promise<string> => {
    const epoch = await catalog.siteEpoch();
    const token = await core.signPageToken(core.pageTokenClaims({ artifact: artifact.id, principal, role, grantsVersion: artifact.grantsVersion, epoch, now }), KEYS);
    return `/${artifact.type}/${token}/`;
  };
  /** A content-origin request to the artifact's object (`onto` another artifact's object, for the wrong-host case). */
  const at = async (artifact: ArtifactRow, method: string, path: string, headers: Record<string, string> = {}, body?: unknown, onto?: ArtifactRow): Promise<Answer> => {
    const target = onto ?? artifact;
    const { room } = await objectOf(target);
    const request = new Request(`${core.contentOriginOf(config, target.id)}${path}`, {
      method,
      headers: { [rooms.ARTIFACT_HEADER]: target.id, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const answer = await room.fetch(request);
    assert.equal(answer.headers.get('set-cookie'), null, `${method} ${path} set a cookie`);
    return { status: answer.status, headers: answer.headers, body: await answer.text() };
  };
  const json = (answer: Answer): Record<string, unknown> => JSON.parse(answer.body) as Record<string, unknown>;
  const note = { type: 'note', x: 0, y: 0, text: 'Hi', color: 'yellow' };
  const comment = { input: { anchor: '{"element":"n1"}', label: 'Note', text: 'Looks good' } };
  let serial = 0;

  const abilities = async (artifact: ArtifactRow, path: string): Promise<{ read: boolean; comment: boolean; edit: boolean; agent: boolean; role: string | null }> => {
    const session = await at(artifact, 'GET', `${path}_api/session`);
    const write = { client: 'p', writes: [{ op: 'set', path: `elements/e${++serial}`, data: note }] };
    return {
      read: session.status === 200,
      role: session.status === 200 ? (json(session) as { viewer: Viewer }).viewer.role : null,
      comment: (await at(artifact, 'POST', `${path}_api/comments/create`, {}, comment)).status === 200,
      edit: (await at(artifact, 'POST', `${path}_api/db/write`, {}, write)).status === 200,
      agent: (await at(artifact, 'POST', `${path}_api/agent/send`, {}, { request: { text: 'hi' } })).status === 200,
    };
  };
  /** Opens a page's WebSocket; answers the record of its socket. */
  const socket = async (artifact: ArtifactRow, path: string): Promise<{ sent: string[]; closed: boolean }> => {
    const { ws } = await objectOf(artifact);
    const answer = await at(artifact, 'GET', `${path}_api/events?client=c${++serial}`, { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13' });
    assert.equal(answer.headers.get('x-upgraded'), '1', answer.body);
    return ws.made.at(-1)!;
  };
  /** Refresh as the Worker asks it after a sharing change. */
  const refresh = async (artifact: ArtifactRow): Promise<number> => {
    const { room, host } = await objectOf(artifact);
    return (await host.refresh(room, artifact.id)).dropped;
  };

  before(async () => {
    core = await import('@open-artifact/host');
    rooms = await import('../src/room.ts');
    roomHosts = await import('../src/room-host.ts');
    d1 = await import('../src/d1.ts');
    config = {
      appOrigin: 'http://localhost:8787',
      contentOrigin: 'http://{id}.content.localhost:8787',
      signingKeys: KEYS,
      auth: [{ kind: 'owner-key' }],
      owners: [],
      signup: 'invite',
      linkMaxRole: 'editor',
      publicAccess: true,
    };
    const driver = d1.d1Driver(fakeD1());
    await d1.ensureMigrated(driver, {});
    catalog = new core.Catalog(driver, { signingKeys: KEYS });
    ada = await catalog.createUser({ name: 'Ada Lovelace', email: 'ada@example.com', emailVerified: true });
    bob = await catalog.createUser({ name: 'Bob', email: 'bob@example.com', emailVerified: true });
    eve = await catalog.createUser({ name: 'Eve' });
    cam = await catalog.createUser({ name: 'Cam', email: 'cam@example.com', emailVerified: true });
    adm = await catalog.createUser({ name: 'Admin', siteRole: 'admin' });
    await catalog.issueAgentToken({ userId: ada.id, label: "Ada's Claude", scopes: [], accessTtlMs: 60_000 });
    online.add(ada.id);
    board = await catalog.createArtifact({ type: 'whiteboard', title: 'Retro', ownerUser: ada.id, generalAccess: 'link' });
    design = await catalog.createArtifact({ type: 'design', title: 'Poster', ownerUser: bob.id });
    open = await catalog.createArtifact({ type: 'whiteboard', title: 'Open', ownerUser: ada.id, generalAccess: 'public' });
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: eve.id, role: 'editor', createdBy: ada.id });
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'email', subject: 'cam@example.com', role: 'commenter', createdBy: ada.id });
    const { link } = await catalog.createLink(board.id, 'commenter');
    const joined = (await catalog.joinGuest(link.id, 'Gus')).guest;
    guest = { kind: 'guest', id: joined.id, name: joined.name, link: joined.linkId, artifact: board.id };
    board = (await catalog.getArtifact(board.id))!;
  });

  after(async () => {
    for (const { room } of live.values()) await room.destroy().catch(() => undefined);
  });

  it('gives each role exactly its abilities; the token role is a hint; the owner is `owner`', async () => {
    assert.deepEqual(await abilities(board, await pathFor(board, userOf(ada), 'owner')), { read: true, role: 'owner', comment: true, edit: true, agent: true });
    assert.deepEqual(await abilities(board, await pathFor(board, userOf(eve), 'editor')), { read: true, role: 'editor', comment: true, edit: true, agent: false });
    assert.deepEqual(await abilities(board, await pathFor(board, userOf(cam), 'commenter')), { read: true, role: 'commenter', comment: true, edit: false, agent: false });
    assert.deepEqual(await abilities(board, await pathFor(board, guest, 'commenter')), { read: true, role: 'commenter', comment: true, edit: false, agent: false });
    assert.deepEqual(await abilities(open, await pathFor(open, { kind: 'anonymous' }, 'viewer')), { read: true, role: 'viewer', comment: false, edit: false, agent: false });
    assert.deepEqual(await abilities(board, await pathFor(board, userOf(cam), 'editor')), { read: true, role: 'commenter', comment: true, edit: false, agent: false });
    assert.equal((await at(board, 'GET', `${await pathFor(board, userOf(bob), 'viewer')}_api/session`)).status, 403);
    const eveSession = json(await at(board, 'GET', `${await pathFor(board, userOf(eve), 'editor')}_api/session`)) as { viewer: Viewer };
    assert.deepEqual(eveSession.viewer, { id: eve.id, name: 'Eve', role: 'editor', kind: 'user' });
    const camSession = json(await at(board, 'GET', `${await pathFor(board, userOf(cam), 'commenter')}_api/session`)) as { viewer: Viewer };
    assert.equal(camSession.viewer.email, 'cam@example.com');
    // A site admin is the page's owner too.
    assert.equal((json(await at(board, 'GET', `${await pathFor(board, userOf(adm), 'owner')}_api/session`)) as { viewer: Viewer }).viewer.id, 'owner');
  });

  it("refuses a token on another artifact's object, a tampered one, another key's, an expired one by use, an old epoch", async () => {
    const path = await pathFor(board, userOf(ada), 'owner');
    assert.equal((await at(board, 'GET', `${path}_api/session`, {}, undefined, open)).status, 403, "another artifact's object");
    const [, type, token] = path.split('/') as [string, string, string];
    const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
    assert.equal((await at(board, 'GET', `/${type}/${tampered}/_api/session`)).status, 403);
    const forged = await core.signPageToken(core.pageTokenClaims({ artifact: board.id, principal: userOf(ada), role: 'owner', grantsVersion: board.grantsVersion, epoch: 1, now: new Date() }), ['x'.repeat(40)]);
    assert.equal((await at(board, 'GET', `/whiteboard/${forged}/_api/session`)).status, 403);

    const hours = core.PAGE_TOKEN_TTL_SECONDS / 3600;
    const stale = await pathFor(board, userOf(eve), 'editor', new Date(Date.now() - (hours + 1) * 3600_000));
    assert.equal((await at(board, 'GET', stale)).status, 403, 'the page document refuses a token past exp');
    assert.equal((await at(board, 'GET', `${stale}_api/events`, { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13' })).status, 403);
    assert.equal((await at(board, 'GET', `${stale}_api/session`)).status, 200, 'api calls have a grace period');
    const dead = await pathFor(board, userOf(eve), 'editor', new Date(Date.now() - (hours + 25) * 3600_000));
    assert.equal((await at(board, 'GET', `${dead}_api/session`)).status, 403);

    const before = await pathFor(board, userOf(eve), 'editor');
    await catalog.bumpSiteEpoch();
    // A new site epoch reaches no object directly (nothing lists them): the old token goes when the kept answer does,
    // within ACCESS_MAX_AGE_MS (the Node host re-reads the epoch on every call).
    await until(async () => (await at(board, 'GET', `${before}_api/session`)).status === 403, roomHosts.ACCESS_MAX_AGE_MS + 1500);
    assert.equal((await at(board, 'GET', `${await pathFor(board, userOf(eve), 'editor')}_api/session`)).status, 200);
  });

  it('holds roles live: a change applies after a refresh, or within 2 s without one', async () => {
    const dan = await catalog.createUser({ name: 'Dan' });
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: dan.id, role: 'editor', createdBy: ada.id });
    board = (await catalog.getArtifact(board.id))!;
    const path = await pathFor(board, userOf(dan), 'editor');
    assert.equal((await abilities(board, path)).edit, true);
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: dan.id, role: 'viewer', createdBy: ada.id });
    await refresh(board);
    assert.deepEqual(await abilities(board, path), { read: true, role: 'viewer', comment: false, edit: false, agent: false });
    // No refresh (a change nobody announced): the kept answer lasts at most ACCESS_MAX_AGE_MS.
    await catalog.removeGrant(board.id, 'user', dan.id);
    await until(async () => (await at(board, 'GET', `${path}_api/session`)).status === 403, roomHosts.ACCESS_MAX_AGE_MS + 1500);
  });

  it('turns links off when general access is restricted', async () => {
    const path = await pathFor(board, guest, 'commenter');
    assert.equal((await at(board, 'GET', `${path}_api/session`)).status, 200);
    await catalog.setGeneralAccess(board.id, 'restricted');
    await refresh(board);
    assert.equal((await at(board, 'GET', `${path}_api/session`)).status, 403);
    assert.equal((await at(board, 'GET', `${await pathFor(board, userOf(eve), 'editor')}_api/session`)).status, 200);
    await catalog.setGeneralAccess(board.id, 'link');
    await refresh(board);
    assert.equal((await at(board, 'GET', `${path}_api/session`)).status, 200);
  });

  it('refuses a trashed artifact, its owner too, and a refresh then ends every page', async () => {
    const path = await pathFor(design, userOf(bob), 'owner');
    assert.equal((await at(design, 'GET', `${path}_api/session`)).status, 200);
    const page = await socket(design, path);
    await catalog.trashArtifact(design.id);
    assert.equal(await refresh(design), 1);
    await until(() => page.closed);
    assert.equal((await at(design, 'GET', `${path}_api/session`)).status, 403);
    assert.equal(await (await objectOf(design)).host.host.locate!(design.id), null);
    await catalog.restoreArtifact(design.id);
    await refresh(design);
    assert.equal((await at(design, 'GET', `${path}_api/session`)).status, 200);
  });

  it('refresh drops only the connections whose role moved', async () => {
    const fred = await catalog.createUser({ name: 'Fred' });
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: fred.id, role: 'editor', createdBy: ada.id });
    board = (await catalog.getArtifact(board.id))!;
    const fredWs = await socket(board, await pathFor(board, userOf(fred), 'editor'));
    const camWs = await socket(board, await pathFor(board, userOf(cam), 'commenter'));
    const adaWs = await socket(board, await pathFor(board, userOf(ada), 'owner'));
    const admWs = await socket(board, await pathFor(board, userOf(adm), 'owner'));
    assert.equal(await refresh(board), 0, 'nothing changed: nobody drops');
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: fred.id, role: 'viewer', createdBy: ada.id });
    assert.equal(await refresh(board), 1);
    await until(() => fredWs.closed);
    assert.equal(camWs.closed || adaWs.closed || admWs.closed, false);
    await catalog.setSiteRole(adm.id, 'member');
    assert.equal(await refresh(board), 1);
    await until(() => admWs.closed);
    assert.equal(camWs.closed || adaWs.closed, false);
    const { room } = await objectOf(board);
    room.disconnect([]);
  });

  it("keeps two owners apart: each artifact's owner name and agent, online from the hub", async () => {
    const a = json(await at(board, 'GET', `${await pathFor(board, userOf(ada), 'owner')}_api/session`)) as { viewer: Viewer; agent: { name: string; wakesIdle?: boolean } };
    assert.deepEqual(a.viewer, { id: 'owner', name: 'Ada Lovelace', role: 'owner', kind: 'user' });
    assert.equal(a.agent.name, "Ada's Claude");
    assert.equal(a.agent.wakesIdle, undefined, 'online: woken');
    const b = json(await at(design, 'GET', `${await pathFor(design, userOf(bob), 'owner')}_api/session`)) as { viewer: Viewer; agent: { name: string; wakesIdle?: boolean } };
    assert.deepEqual(b.viewer, { id: 'owner', name: 'Bob', role: 'owner', kind: 'user' });
    assert.equal(b.agent.name, 'Agent');
    assert.equal(b.agent.wakesIdle, false, 'not linked: waits');
    const api = (await objectOf(design)).host.host.typeApi;
    assert.deepEqual(await api.presence(design.id), { presence: 'offline', canSend: true, canSendSession: false, busy: false, agentName: 'Agent', wakesIdle: false });
    assert.equal((await (await objectOf(board)).host.host.typeApi.presence(board.id)).presence, 'online');
  });

  it("tells the open pages at once when the hub says the owner's agent came, and asks the hub naming the room", async () => {
    const asked: Array<string | undefined> = [];
    const realOnline = hub.online;
    hub.online = async (userId: string, room?: string) => {
      asked.push(room);
      return online.has(userId);
    };
    try {
      const page = await socket(design, await pathFor(design, userOf(bob), 'owner'));
      await until(() => page.sent.some((m) => m.includes('"agent"')));
      const offline = page.sent.filter((m) => m.includes('"agent"')).at(-1)!;
      // Offline, a wake waits (`wakesIdle: false`); online it does not say so.
      assert.match(offline, /"wakesIdle":false/);
      online.add(bob.id);
      (await objectOf(design)).room.agentChanged();
      await until(() => !page.sent.filter((m) => m.includes('"agent"')).at(-1)!.includes('"wakesIdle":false'));
      assert.ok(asked.includes(design.id), 'the room names itself, so the hub can tell it');
      online.delete(bob.id);
      (await objectOf(design)).room.agentChanged();
      await until(() => page.sent.filter((m) => m.includes('"agent"')).at(-1)!.includes('"wakesIdle":false'));
      (await objectOf(design)).room.disconnect([]);
    } finally {
      hub.online = realOnline;
    }
  });

  it("puts a wake in the owner's outbox (D1) and tells the hub", async () => {
    emitted.length = 0;
    const before = (await catalog.listOutbox(ada.id)).length;
    const sent = await at(board, 'POST', `${await pathFor(board, userOf(ada), 'owner')}_api/agent/send`, {}, { request: { text: 'make it blue' } });
    assert.equal(sent.status, 200, sent.body);
    const box = await catalog.listOutbox(ada.id);
    assert.equal(box.length, before + 1);
    const last = box.at(-1)!;
    assert.equal(last.kind, 'wake');
    assert.equal(last.artifactId, board.id);
    assert.equal((last.payload as { requests: { text: string }[] }).requests[0]!.text, 'make it blue');
    assert.deepEqual(emitted.filter((e) => e.name === 'outbox'), [{ name: 'outbox', payload: { userId: ada.id } }]);
    assert.equal((await catalog.listOutbox(bob.id)).length, 0);
  });

  it('lets an editor ask the agent only while the owner allows it, naming them on the outbox row', async () => {
    const evePath = await pathFor(board, userOf(eve), 'editor');
    const camPath = await pathFor(board, userOf(cam), 'commenter');
    const send = (path: string, text: string) => at(board, 'POST', `${path}_api/agent/send`, {}, { request: { text } });
    const agentOf = async (path: string) => (json(await at(board, 'GET', `${path}_api/session`)) as { agent: { available: boolean } }).agent.available;
    assert.equal((await send(evePath, 'off')).status, 403);
    assert.equal(await agentOf(evePath), false);
    await catalog.setArtifactSettings(board.id, { editorsCanAskAgent: true });
    await refresh(board);
    assert.equal(await agentOf(evePath), true);
    assert.equal((await send(evePath, 'Eve asks')).status, 200);
    const payload = (await catalog.listOutbox(ada.id)).at(-1)!.payload as { from?: unknown; requests: Array<{ text: string }> };
    assert.equal(payload.requests[0]!.text, 'Eve asks');
    assert.deepEqual(payload.from, { name: 'Eve', role: 'editor' });
    assert.equal((await send(camPath, 'Cam asks')).status, 403);
    // Off again; a page that holds an editor's connection is dropped by the refresh (its ability moved).
    const eveWs = await socket(board, evePath);
    await catalog.setArtifactSettings(board.id, { editorsCanAskAgent: false });
    await refresh(board);
    await until(() => eveWs.closed);
    assert.equal((await send(evePath, 'off again')).status, 403);
    const api = (await objectOf(board)).host.host.typeApi;
    await assert.rejects(api.wake(board.id, { requests: [{ text: 'sneaked', from: { name: 'Eve', role: 'editor' } }] }), /does not let editors ask/);
  });

  it("counts an owner's MCP client used in the last two hours as there", async () => {
    const api = (await objectOf(design)).host.host.typeApi;
    const { token } = await catalog.issueAgentToken({ userId: bob.id, label: 'ChatGPT', harness: 'mcp', scopes: ['artifacts.read'], accessTtlMs: 60_000 });
    assert.equal((await api.presence(design.id)).canSendSession, false);
    await catalog.markAgentTokenUsed(token.id);
    assert.deepEqual(await api.presence(design.id), { presence: 'offline', canSend: true, canSendSession: true, busy: false, agentName: 'ChatGPT', wakesIdle: false });
    await catalog.revokeAgentToken(token.id);
    assert.equal((await api.presence(design.id)).canSendSession, false);
  });

  it('touch updates the catalog and tells the hub', async () => {
    emitted.length = 0;
    const api = (await objectOf(board)).host.host.typeApi;
    await api.touch(board.id, { author: 'owner', paths: ['db/x'], title: 'Retro 2' });
    assert.equal((await catalog.getArtifact(board.id))?.title, 'Retro 2');
    assert.deepEqual(emitted.at(-1), { name: 'artifact-touched', payload: { id: board.id, author: 'owner', paths: ['db/x'], title: 'Retro 2' } });
    // A page's write touches too.
    emitted.length = 0;
    const write = { client: 'p', writes: [{ op: 'set', path: 'elements/touch1', data: note }] };
    assert.equal((await at(board, 'POST', `${await pathFor(board, userOf(eve), 'editor')}_api/db/write`, {}, write)).status, 200);
    await until(() => emitted.some((e) => e.name === 'artifact-touched'), 5000);
  });

  it("follows a doc's own title when a touch reports none (a folder published under its folder name)", async () => {
    const doc = await catalog.createArtifact({ type: 'docs', title: 'docs-browser-qa', ownerUser: ada.id });
    const api = (await objectOf(doc, folderFiles(join(repo, 'test-artifacts/docs/browser-qa')))).host.host.typeApi;
    emitted.length = 0;
    await api.touch(doc.id, { author: 'agent', paths: ['doc/doc.json'] });
    assert.equal((await catalog.getArtifact(doc.id))?.title, 'Docs Browser QA');
    assert.deepEqual(emitted.at(-1), { name: 'artifact-touched', payload: { id: doc.id, author: 'agent', paths: ['doc/doc.json'], title: 'Docs Browser QA' } });
  });

  it('lets only the app origin call the page API cross-origin', async () => {
    const path = await pathFor(board, userOf(eve), 'editor');
    const preflight = await at(board, 'OPTIONS', `${path}_api/db/write`, { origin: config.appOrigin, 'access-control-request-method': 'POST' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), config.appOrigin);
    const evil = await at(board, 'GET', `${path}_api/session`, { origin: 'http://evil.test' });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    const write = { client: 'p', writes: [{ op: 'set', path: 'elements/x9', data: note }] };
    assert.equal((await at(board, 'POST', `${path}_api/db/write`, { origin: 'http://evil.test' }, write)).status, 403);
  });

  it('lets the owner, editors and commenters export a doc, and a viewer only while the owner allows it', async () => {
    const vic = await catalog.createUser({ name: 'Vic' });
    let plan = await catalog.createArtifact({ type: 'docs', title: 'Plan', ownerUser: ada.id });
    for (const [subject, role] of [[eve.id, 'editor'], [cam.id, 'commenter'], [vic.id, 'viewer']] as const)
      await catalog.upsertGrant({ artifactId: plan.id, subjectKind: 'user', subject, role, createdBy: ada.id });
    await catalog.setArtifactSettings(plan.id, { viewersCanExport: false });
    plan = (await catalog.getArtifact(plan.id))!;
    await objectOf(plan, folderFiles(join(repo, 'test-artifacts/docs/browser-qa')));
    const exportAs = async (record: UserRecord, role: ArtifactRole): Promise<Answer> => at(plan, 'GET', `${await pathFor(plan, userOf(record), role)}_api/doc/export?format=markdown`);
    for (const [record, role] of [[ada, 'owner'], [eve, 'editor'], [cam, 'commenter']] as const) {
      const res = await exportAs(record, role);
      assert.equal(res.status, 200, `${role}: ${res.body}`);
    }
    const refused = await exportAs(vic, 'viewer');
    assert.equal(refused.status, 403);
    assert.equal(json(refused).code, 'not_writer');
    await catalog.setArtifactSettings(plan.id, { viewersCanExport: true });
    await refresh(plan);
    assert.equal((await exportAs(vic, 'viewer')).status, 200);
  });

  it("serves a snapshot token as a read-only page nobody sees among the artifact's people", async () => {
    const issued = await catalog.issueAgentToken({ userId: ada.id, label: 'Snapper', scopes: ['artifacts.read'], accessTtlMs: 60_000 });
    const agent: Principal = { kind: 'agent', id: issued.token.id, user: userOf(ada) as Extract<Principal, { kind: 'user' }>, label: 'Snapper', scopes: ['artifacts.read'] };
    board = (await catalog.getArtifact(board.id))!;
    const epoch = await catalog.siteEpoch();
    const token = await core.signPageToken(core.snapshotTokenClaims({ artifact: board.id, principal: agent, grantsVersion: board.grantsVersion, epoch, now: new Date() }), KEYS);
    const page = `/whiteboard/${token}/`;
    const session = await at(board, 'GET', `${page}_api/session`);
    assert.equal(session.status, 200, session.body);
    assert.equal((json(session) as { viewer: Viewer }).viewer.role, 'viewer');
    const write = await at(board, 'POST', `${page}_api/db/write`, {}, { client: 'snap-1', writes: [{ op: 'set', path: 'elements/snap1', data: note }] });
    assert.equal(write.status, 200, write.body);
    const owner = await pathFor(board, userOf(ada), 'owner');
    assert.equal(json(await at(board, 'GET', `${owner}_api/db/get?path=elements%2Fsnap1`)).data ?? null, null);
    const { room } = await objectOf(board);
    const before = room.connected();
    const ws = await socket(board, page);
    assert.deepEqual(room.connected(), before);
    await refresh(board);
    await until(() => ws.closed);
    const stale = await core.signPageToken(core.snapshotTokenClaims({ artifact: board.id, principal: agent, grantsVersion: board.grantsVersion, epoch, now: new Date(Date.now() - 301_000) }), KEYS);
    assert.equal((await at(board, 'GET', `/whiteboard/${stale}/_api/session`)).status, 403);
  });

  it('keeps an access answer: repeated page calls read D1 once per 2 s', async () => {
    const driver = d1.d1Driver(fakeD1());
    await d1.ensureMigrated(driver, {});
    const local = new core.Catalog(driver, { signingKeys: KEYS });
    const owner = await local.createUser({ name: 'Olga' });
    const artifact = await local.createArtifact({ type: 'whiteboard', title: 'Counted', ownerUser: owner.id });
    let clock = Date.now();
    const host = roomHosts.createProductRoomHost({ config, catalog: local, hub, rootOf: () => '/nowhere', now: () => new Date(clock) });
    const token = await core.signPageToken(core.pageTokenClaims({ artifact: artifact.id, principal: userOf(owner), role: 'owner', grantsVersion: artifact.grantsVersion, epoch: 1, now: new Date(clock) }), KEYS);
    const first = driver.counters().queries;
    assert.equal((await host.host.resolve(artifact.id, token, 'api', new Request('http://x/')))?.viewer.role, 'owner');
    const cost = driver.counters().queries - first;
    for (let i = 0; i < 10; i++) await host.host.resolve(artifact.id, token, 'api', new Request('http://x/'));
    assert.equal(driver.counters().queries - first, cost, 'kept: no more queries');
    clock += roomHosts.ACCESS_MAX_AGE_MS + 1;
    await host.host.resolve(artifact.id, token, 'api', new Request('http://x/'));
    assert.ok(driver.counters().queries - first > cost, 'read again after 2 s');
    host.invalidate(artifact.id);
    const now = driver.counters().queries;
    await host.host.resolve(artifact.id, token, 'api', new Request('http://x/'));
    assert.ok(driver.counters().queries > now, 'read again after invalidate');
  });
});
