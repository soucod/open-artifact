/**
 * The Node host's rooms: the embedded type server behind content hosts, with live roles.
 *
 * Requests go out with `node:http` and an explicit `Host: art-….content.localhost:<port>` (no DNS for `*.localhost`)
 * to a server this test owns, which routes by Host like the host does (`dispatchByHost`).
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it, test } from 'node:test';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { HostEvents, type HostEventMap } from '../src/core/events.ts';
import { pageTokenClaims, signPageToken, snapshotTokenClaims, PAGE_TOKEN_TTL_SECONDS } from '../src/core/page-token.ts';
import type { ArtifactRole, ArtifactRow, HostConfig, Principal, UserRecord } from '../src/core/types.ts';
import { dispatchByHost, withoutCookies } from '../src/node/content.ts';
import { DEFAULT_ASSETS_DIR, parseNodeEnv } from '../src/node/env.ts';
import { createRooms, type HostRooms } from '../src/node/rooms.ts';
import { openSqlite } from '../src/node/sqlite.ts';

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const KEYS = ['s'.repeat(40)];

function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string | Uint8Array): Promise<Answer> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** A WebSocket handshake: the open socket and its first frame, or the refusal's status. */
function socketTo(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; socket?: Socket; closed?: Promise<void> }> {
  return new Promise((resolvePromise, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': randomBytes(16).toString('base64'), 'sec-websocket-version': '13', ...headers },
    });
    req.on('upgrade', (res: IncomingMessage, socket: Socket) => {
      const closed = new Promise<void>((done) => {
        socket.on('close', () => done());
        socket.on('end', () => done());
      });
      socket.on('data', () => undefined);
      resolvePromise({ status: res.statusCode ?? 101, socket, closed });
    });
    req.on('response', (res) => {
      res.resume();
      resolvePromise({ status: res.statusCode ?? 0 });
    });
    req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' ? resolvePromise({ status: 0 }) : reject(error)));
    req.end();
  });
}

const settled = (promise: Promise<void>, ms = 300): Promise<boolean> =>
  Promise.race([promise.then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), ms))]);

async function until(check: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((done) => setTimeout(done, 20));
  }
}

describe('rooms', () => {
  let dir: string;
  let front: Server;
  let port: number;
  let config: HostConfig;
  let catalog: Catalog;
  let rooms: HostRooms;
  const events = new HostEvents();
  const heard: { [N in keyof HostEventMap]?: HostEventMap[N][] } = {};
  const online = new Set<string>();
  let ada: UserRecord, bob: UserRecord, eve: UserRecord, cam: UserRecord, adm: UserRecord;
  /** Ada's whiteboard (link access), Bob's design, Ada's public whiteboard. */
  let board: ArtifactRow, design: ArtifactRow, open: ArtifactRow;
  let guest: Principal;

  const userOf = (record: UserRecord): Principal => ({
    kind: 'user',
    id: record.id,
    name: record.name,
    ...(record.email ? { email: record.email, emailVerified: record.emailVerified } : {}),
    siteRole: record.siteRole,
  });
  const hostOf = (id: string): string => `${id.replace('_', '-')}.content.localhost:${port}`;
  /** A page path for this principal (its own token). */
  const pathFor = async (artifact: ArtifactRow, principal: Principal, role: ArtifactRole): Promise<string> => new URL((await rooms.pageFor(artifact, principal, role)).pageUrl).pathname;
  /** A content-origin request; every answer is checked for cookies. */
  const at = async (id: string, method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Answer> => {
    const answer = await call(port, method, path, { host: hostOf(id), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body === undefined ? undefined : JSON.stringify(body));
    assert.equal(answer.headers['set-cookie'], undefined, `${method} ${path} set a cookie`);
    return answer;
  };
  const json = (answer: Answer): Record<string, unknown> => JSON.parse(answer.body) as Record<string, unknown>;
  const note = { type: 'note', x: 0, y: 0, text: 'Hi', color: 'yellow' };
  const comment = { input: { anchor: '{"element":"n1"}', label: 'Note', text: 'Looks good' } };

  /** What a page can do: read, comment, edit, send to the agent. */
  const abilities = async (artifact: ArtifactRow, path: string): Promise<{ read: boolean; comment: boolean; edit: boolean; agent: boolean; role: string | null }> => {
    const session = await at(artifact.id, 'GET', `${path}_api/session`);
    const write = { client: 'p', writes: [{ op: 'set', path: `elements/${randomBytes(3).toString('hex')}`, data: note }] };
    return {
      read: session.status === 200,
      role: session.status === 200 ? (json(session) as { viewer: Viewer }).viewer.role : null,
      comment: (await at(artifact.id, 'POST', `${path}_api/comments/create`, {}, comment)).status === 200,
      edit: (await at(artifact.id, 'POST', `${path}_api/db/write`, {}, write)).status === 200,
      agent: (await at(artifact.id, 'POST', `${path}_api/agent/send`, {}, { request: { text: 'hi' } })).status === 200,
    };
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-rooms-'));
    const assets = join(dir, 'assets');
    for (const type of ['whiteboard', 'design']) {
      await mkdir(join(assets, 'editors', type, 'assets'), { recursive: true });
      await writeFile(join(assets, 'editors', type, 'index.html'), `<!doctype html><html><head><script src="./assets/index-Ab12Cd34.js"></script></head><body></body></html>`);
      await writeFile(join(assets, 'editors', type, 'assets', 'index-Ab12Cd34.js'), '/* editor */');
    }
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');

    // The front server first: its port is in the deployment's origins.
    let route: ReturnType<typeof dispatchByHost> | null = null;
    front = createServer((req, res) => (route ? route.request(req, res) : res.writeHead(503).end()));
    front.on('upgrade', (req, socket, head) => route?.upgrade(req, socket, head));
    await new Promise<void>((done) => front.listen(0, '127.0.0.1', done));
    const address = front.address();
    port = typeof address === 'object' && address ? address.port : 0;

    config = {
      appOrigin: `http://localhost:${port}`,
      contentOrigin: `http://{id}.content.localhost:${port}`,
      signingKeys: KEYS,
      auth: [{ kind: 'owner-key' }],
      owners: [],
      signup: 'invite',
      linkMaxRole: 'editor',
      publicAccess: true,
    };
    catalog = await Catalog.open(openSqlite(':memory:'), { signingKeys: KEYS });
    ada = await catalog.createUser({ name: 'Ada Lovelace', email: 'ada@example.com', emailVerified: true });
    bob = await catalog.createUser({ name: 'Bob', email: 'bob@example.com', emailVerified: true });
    eve = await catalog.createUser({ name: 'Eve' });
    cam = await catalog.createUser({ name: 'Cam', email: 'cam@example.com', emailVerified: true });
    adm = await catalog.createUser({ name: 'Admin', siteRole: 'admin' });
    await catalog.issueAgentToken({ userId: ada.id, label: "Ada's Claude", scopes: [], accessTtlMs: 60_000 });
    // Ada's agent is linked (the type server keeps each presence answer a few seconds, so this holds throughout).
    online.add(ada.id);

    events.on('outbox', (payload) => (heard.outbox ??= []).push(payload));
    events.on('artifact-touched', (payload) => (heard['artifact-touched'] ??= []).push(payload));
    rooms = await createRooms({ config, catalog, dataDir: join(dir, 'data'), assetsDir: assets, events, linkPresence: { online: (id) => online.has(id) } });
    route = dispatchByHost({ rooms, app: (_req, res) => res.writeHead(404).end('app') });

    board = await catalog.createArtifact({ type: 'whiteboard', title: 'Retro', ownerUser: ada.id, generalAccess: 'link' });
    design = await catalog.createArtifact({ type: 'design', title: 'Poster', ownerUser: bob.id });
    open = await catalog.createArtifact({ type: 'whiteboard', title: 'Open', ownerUser: ada.id, generalAccess: 'public' });
    for (const artifact of [board, design, open]) await mkdir(rooms.rootOf(artifact.id), { recursive: true });
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: eve.id, role: 'editor', createdBy: ada.id });
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'email', subject: 'cam@example.com', role: 'commenter', createdBy: ada.id });
    const { link } = await catalog.createLink(board.id, 'commenter');
    const joined = (await catalog.joinGuest(link.id, 'Gus')).guest;
    guest = { kind: 'guest', id: joined.id, name: joined.name, link: joined.linkId, artifact: board.id };
    board = (await catalog.getArtifact(board.id))!;
  });

  after(async () => {
    front.closeAllConnections();
    await new Promise<void>((done) => front.close(() => done()));
    await rooms.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('builds page addresses like a daemon open: content origin, type, token, the Shell parameter', async () => {
    const page = await rooms.pageFor(board, userOf(ada), 'owner');
    assert.ok(page.pageUrl.startsWith(`http://${hostOf(board.id)}/whiteboard/v1.`), page.pageUrl);
    assert.ok(page.pageUrl.endsWith('/'));
    assert.equal(page.url, `${page.pageUrl}?open_artifact_shell=${encodeURIComponent(config.appOrigin)}`);
    assert.ok(page.pageUrl.includes(page.token));
    assert.equal(rooms.isContentHost(hostOf(board.id)), true);
    assert.equal(rooms.isContentHost(`localhost:${port}`), false);
    assert.equal(rooms.rootOf(board.id), join(dir, 'data', 'artifacts', board.id));
    assert.throws(() => rooms.rootOf('../etc'));
  });

  it("gives each role exactly its abilities through content-origin URLs", async () => {
    assert.deepEqual(await abilities(board, await pathFor(board, userOf(ada), 'owner')), { read: true, role: 'owner', comment: true, edit: true, agent: true });
    assert.deepEqual(await abilities(board, await pathFor(board, userOf(eve), 'editor')), { read: true, role: 'editor', comment: true, edit: true, agent: false });
    assert.deepEqual(await abilities(board, await pathFor(board, userOf(cam), 'commenter')), { read: true, role: 'commenter', comment: true, edit: false, agent: false });
    assert.deepEqual(await abilities(board, await pathFor(board, guest, 'commenter')), { read: true, role: 'commenter', comment: true, edit: false, agent: false });
    assert.deepEqual(await abilities(open, await pathFor(open, { kind: 'anonymous' }, 'viewer')), { read: true, role: 'viewer', comment: false, edit: false, agent: false });
    // The token's role is a hint: a token claiming more than the catalog gives is held to the catalog.
    assert.deepEqual(await abilities(board, await pathFor(board, userOf(cam), 'editor')), { read: true, role: 'commenter', comment: true, edit: false, agent: false });
    // Nobody: a user with no grant.
    assert.equal((await at(board.id, 'GET', `${await pathFor(board, userOf(bob), 'viewer')}_api/session`)).status, 403);
    // Names and kinds reach the page; the owner keeps the id `owner`.
    const eveSession = json(await at(board.id, 'GET', `${await pathFor(board, userOf(eve), 'editor')}_api/session`)) as { viewer: Viewer };
    assert.deepEqual(eveSession.viewer, { id: eve.id, name: 'Eve', role: 'editor', kind: 'user' });
    const camSession = json(await at(board.id, 'GET', `${await pathFor(board, userOf(cam), 'commenter')}_api/session`)) as { viewer: Viewer };
    assert.equal(camSession.viewer.email, 'cam@example.com');
  });

  it("refuses a token on another artifact's host, a tampered one, and an expired one by use", async () => {
    const path = await pathFor(board, userOf(ada), 'owner');
    assert.equal((await at(open.id, 'GET', `${path}_api/session`)).status, 403, "another artifact's host");
    const [, type, token] = path.split('/') as [string, string, string];
    const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
    assert.equal((await at(board.id, 'GET', `/${type}/${tampered}/_api/session`)).status, 403);
    const forged = await signPageToken(pageTokenClaims({ artifact: board.id, principal: userOf(ada), role: 'owner', grantsVersion: board.grantsVersion, epoch: 1, now: new Date() }), ['x'.repeat(40)]);
    assert.equal((await at(board.id, 'GET', `/whiteboard/${forged}/_api/session`)).status, 403, 'signed with another key');

    const old = async (hoursAgo: number): Promise<string> =>
      signPageToken(pageTokenClaims({ artifact: board.id, principal: userOf(eve), role: 'editor', grantsVersion: 1, epoch: 1, now: new Date(Date.now() - hoursAgo * 3600_000) }), KEYS);
    const stale = await old(PAGE_TOKEN_TTL_SECONDS / 3600 + 1);
    // Past `exp`: the page document and the WebSocket refuse it; api calls accept it for the grace period.
    assert.equal((await at(board.id, 'GET', `/whiteboard/${stale}/`)).status, 403);
    assert.equal((await socketTo(port, `/whiteboard/${stale}/_api/events`, { host: hostOf(board.id) })).status, 403);
    assert.equal((await at(board.id, 'GET', `/whiteboard/${stale}/_api/session`)).status, 200);
    const dead = await old(PAGE_TOKEN_TTL_SECONDS / 3600 + 25);
    assert.equal((await at(board.id, 'GET', `/whiteboard/${dead}/_api/session`)).status, 403);
    // A new site epoch ends every token.
    const path2 = await pathFor(board, userOf(eve), 'editor');
    await catalog.bumpSiteEpoch();
    assert.equal((await at(board.id, 'GET', `${path2}_api/session`)).status, 403);
    assert.equal((await at(board.id, 'GET', `${await pathFor(board, userOf(eve), 'editor')}_api/session`)).status, 200);
  });

  it('holds roles live: a removed grant refuses the next request, a changed one applies', async () => {
    const dan = await catalog.createUser({ name: 'Dan' });
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: dan.id, role: 'editor', createdBy: ada.id });
    const path = await pathFor((await catalog.getArtifact(board.id))!, userOf(dan), 'editor');
    assert.equal((await abilities(board, path)).edit, true);
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: dan.id, role: 'viewer', createdBy: ada.id });
    assert.deepEqual(await abilities(board, path), { read: true, role: 'viewer', comment: false, edit: false, agent: false });
    await catalog.removeGrant(board.id, 'user', dan.id);
    assert.equal((await at(board.id, 'GET', `${path}_api/session`)).status, 403);
  });

  it('turns links off when general access is restricted', async () => {
    const path = await pathFor(board, guest, 'commenter');
    assert.equal((await at(board.id, 'GET', `${path}_api/session`)).status, 200);
    await catalog.setGeneralAccess(board.id, 'restricted');
    assert.equal((await at(board.id, 'GET', `${path}_api/session`)).status, 403);
    // People added by name keep access.
    assert.equal((await at(board.id, 'GET', `${await pathFor(board, userOf(eve), 'editor')}_api/session`)).status, 200);
    await catalog.setGeneralAccess(board.id, 'link');
    assert.equal((await at(board.id, 'GET', `${path}_api/session`)).status, 200);
  });

  it('refuses a trashed artifact, its owner too', async () => {
    const path = await pathFor(design, userOf(bob), 'owner');
    assert.equal((await at(design.id, 'GET', `${path}_api/session`)).status, 200);
    await catalog.trashArtifact(design.id);
    assert.equal((await at(design.id, 'GET', `${path}_api/session`)).status, 403);
    await catalog.restoreArtifact(design.id);
    assert.equal((await at(design.id, 'GET', `${path}_api/session`)).status, 200);
  });

  it('refresh drops only the connections whose role moved', async () => {
    const fred = await catalog.createUser({ name: 'Fred' });
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: fred.id, role: 'editor', createdBy: ada.id });
    const fresh = (await catalog.getArtifact(board.id))!;
    const open = async (principal: Principal, role: ArtifactRole) => {
      const ws = await socketTo(port, `${await pathFor(fresh, principal, role)}_api/events?client=${randomBytes(4).toString('hex')}`, { host: hostOf(board.id), origin: config.appOrigin });
      assert.equal(ws.status, 101);
      return ws;
    };
    const fredWs = await open(userOf(fred), 'editor');
    const camWs = await open(userOf(cam), 'commenter');
    const adaWs = await open(userOf(ada), 'owner');
    const admWs = await open(userOf(adm), 'owner');
    // Nothing changed: nobody drops.
    await rooms.refresh(board.id);
    assert.equal(await settled(fredWs.closed!), false);
    // Fred becomes a viewer: only his page drops (it comes back as a viewer).
    await catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: fred.id, role: 'viewer', createdBy: ada.id });
    await rooms.refresh(board.id);
    assert.equal(await settled(fredWs.closed!, 2000), true);
    assert.equal(await settled(camWs.closed!), false);
    assert.equal(await settled(adaWs.closed!, 50), false);
    // A site admin is the page's `owner` too; demoted, only their page drops, not the real owner's.
    await catalog.setSiteRole(adm.id, 'member');
    await rooms.refresh(board.id);
    assert.equal(await settled(admWs.closed!, 2000), true);
    assert.equal(await settled(adaWs.closed!), false);
    assert.equal(await settled(camWs.closed!, 50), false);
    for (const ws of [camWs, adaWs]) ws.socket!.destroy();
  });

  it("keeps two owners apart: each artifact's owner name and agent", async () => {
    const a = json(await at(board.id, 'GET', `${await pathFor(board, userOf(ada), 'owner')}_api/session`)) as { viewer: Viewer; agent: { available: boolean; name: string; wakesIdle?: boolean } };
    assert.deepEqual(a.viewer, { id: 'owner', name: 'Ada Lovelace', role: 'owner', kind: 'user' });
    assert.equal(a.agent.name, "Ada's Claude");
    assert.equal(a.agent.wakesIdle, undefined, 'online: woken');
    const b = json(await at(design.id, 'GET', `${await pathFor(design, userOf(bob), 'owner')}_api/session`)) as { viewer: Viewer; agent: { name: string; wakesIdle?: boolean } };
    assert.deepEqual(b.viewer, { id: 'owner', name: 'Bob', role: 'owner', kind: 'user' });
    assert.equal(b.agent.name, 'Agent');
    assert.equal(b.agent.wakesIdle, false, 'not linked: waits');
    assert.deepEqual(await rooms.typeApi.presence(design.id), { presence: 'offline', canSend: true, canSendSession: false, busy: false, agentName: 'Agent', wakesIdle: false });
    assert.equal((await rooms.typeApi.presence(board.id)).presence, 'online');
  });

  it("puts a wake in the owner's outbox, answered as stored for Link", async () => {
    heard.outbox = [];
    const before = (await catalog.listOutbox(ada.id)).length;
    const sent = await at(board.id, 'POST', `${await pathFor(board, userOf(ada), 'owner')}_api/agent/send`, {}, { request: { text: 'make it blue' } });
    assert.equal(sent.status, 200, sent.body);
    const box = await catalog.listOutbox(ada.id);
    assert.equal(box.length, before + 1);
    const last = box[box.length - 1]!;
    assert.equal(last.kind, 'wake');
    assert.equal(last.artifactId, board.id);
    assert.equal((last.payload as { requests: { text: string }[] }).requests[0]!.text, 'make it blue');
    assert.deepEqual(heard.outbox, [{ userId: ada.id }]);
    assert.equal((await catalog.listOutbox(bob.id)).length, 0);
    assert.deepEqual(await rooms.typeApi.wake(design.id, { requests: [{ label: 'x', text: 'y' }] }), { status: 'inbox', via: 'link' });
    assert.equal((await catalog.listOutbox(bob.id)).length, 1);
  });

  it('lets an editor ask the agent only while the owner allows it, naming them on the outbox row', async () => {
    const evePath = await pathFor(board, userOf(eve), 'editor');
    const camPath = await pathFor(board, userOf(cam), 'commenter');
    const send = (path: string, text: string) => at(board.id, 'POST', `${path}_api/agent/send`, {}, { request: { text } });
    const agentOf = async (path: string) => (json(await at(board.id, 'GET', `${path}_api/session`)) as { agent: { available: boolean } }).agent.available;
    // Off (the default): refused, and the agent is not there for them.
    assert.equal((await send(evePath, 'off')).status, 403);
    assert.equal(await agentOf(evePath), false);

    await catalog.setArtifactSettings(board.id, { editorsCanAskAgent: true });
    await rooms.refresh(board.id);
    assert.equal(await agentOf(evePath), true);
    const sent = await send(evePath, 'Eve asks');
    assert.equal(sent.status, 200, sent.body);
    const row = (await catalog.listOutbox(ada.id)).at(-1)!;
    const payload = row.payload as { from?: unknown; requests: Array<{ text: string; from?: unknown }> };
    assert.equal(payload.requests[0]!.text, 'Eve asks');
    assert.deepEqual(payload.from, { name: 'Eve', role: 'editor' });
    // A commenter never may, whatever the setting.
    assert.equal((await send(camPath, 'Cam asks')).status, 403);
    assert.equal(await agentOf(camPath), false);
    // The owner's own wake names nobody.
    assert.equal((await send(await pathFor(board, userOf(ada), 'owner'), 'Ada asks')).status, 200);
    assert.equal(((await catalog.listOutbox(ada.id)).at(-1)!.payload as { from?: unknown }).from, undefined);

    // Off again: the page refuses, and a wake naming an editor is refused here too (the setting is read live).
    await catalog.setArtifactSettings(board.id, { editorsCanAskAgent: false });
    await rooms.refresh(board.id);
    assert.equal((await send(evePath, 'off again')).status, 403);
    await assert.rejects(rooms.typeApi.wake(board.id, { requests: [{ text: 'sneaked', from: { name: 'Eve', role: 'editor' } }] }), /does not let editors ask/);
    await catalog.setArtifactSettings(board.id, { editorsCanAskAgent: true });
    await assert.rejects(rooms.typeApi.wake(board.id, { requests: [{ text: 'sneaked', from: { name: 'Cam', role: 'commenter' } }] }), /does not let editors ask/);
    await catalog.setArtifactSettings(board.id, { editorsCanAskAgent: false });
    await rooms.refresh(board.id);
  });

  it('counts an owner\'s MCP client used in the last two hours as there, seeing what is sent in its next turn', async () => {
    /** Not there: the Link's offline answer (its name is the most recently used token's, as before). */
    const offline = async (): Promise<void> => {
      const { agentName: _name, ...rest } = await rooms.typeApi.presence(design.id);
      assert.deepEqual(rest, { presence: 'offline', canSend: true, canSendSession: false, busy: false, wakesIdle: false });
    };
    const { token } = await catalog.issueAgentToken({ userId: bob.id, label: 'ChatGPT', harness: 'mcp', scopes: ['artifacts.read'], accessTtlMs: 60_000 });
    // Issued, never used: not there.
    await offline();
    await catalog.markAgentTokenUsed(token.id);
    // As a local ChatGPT (an L1 harness): it can be sent to, and is not woken while it idles.
    assert.deepEqual(await rooms.typeApi.presence(design.id), { presence: 'offline', canSend: true, canSendSession: true, busy: false, agentName: 'ChatGPT', wakesIdle: false });
    // Used more than two hours ago: gone again.
    await catalog.driver.run('UPDATE agent_tokens SET used_at = ? WHERE id = ?', [new Date(Date.now() - 2 * 3600_000 - 60_000).toISOString(), token.id]);
    await offline();
    // Revoked: gone, however recent.
    await catalog.markAgentTokenUsed(token.id);
    await catalog.revokeAgentToken(token.id);
    await offline();
    // A Link token (not MCP) in recent use does not count: only a connected Link does.
    const link = await catalog.issueAgentToken({ userId: bob.id, label: 'Claude Code', scopes: ['link'], accessTtlMs: 60_000 });
    await catalog.markAgentTokenUsed(link.token.id);
    assert.equal((await rooms.typeApi.presence(design.id)).canSendSession, false);
    await catalog.revokeAgentToken(link.token.id);
  });

  it('touch updates the catalog and is heard', async () => {
    heard['artifact-touched'] = [];
    const write = { client: 'p', writes: [{ op: 'set', path: 'elements/touch1', data: note }] };
    assert.equal((await at(board.id, 'POST', `${await pathFor(board, userOf(eve), 'editor')}_api/db/write`, {}, write)).status, 200);
    await until(() => (heard['artifact-touched'] ?? []).some((e) => e.id === board.id));
    await rooms.typeApi.touch(board.id, { author: 'owner', paths: ['db/x'], title: 'Retro 2' });
    assert.equal((await catalog.getArtifact(board.id))?.title, 'Retro 2');
    assert.deepEqual(heard['artifact-touched']!.at(-1), { id: board.id, author: 'owner', paths: ['db/x'], title: 'Retro 2' });
  });

  it("follows a doc's own title when a touch reports none (a folder published under its folder name)", async () => {
    const doc = await catalog.createArtifact({ type: 'docs', title: 'docs-browser-qa', ownerUser: ada.id });
    await mkdir(join(rooms.rootOf(doc.id), 'doc'), { recursive: true });
    await writeFile(join(rooms.rootOf(doc.id), 'doc', 'doc.json'), JSON.stringify({ name: 'Docs Browser QA' }));
    await rooms.typeApi.touch(doc.id, { author: 'agent', paths: ['doc/doc.json'] });
    assert.equal((await catalog.getArtifact(doc.id))?.title, 'Docs Browser QA');
    assert.equal(heard['artifact-touched']!.at(-1)?.title, 'Docs Browser QA');
  });

  it('serves an upload by its content host, opening the artifact when no page did', async () => {
    const path = await pathFor(board, userOf(eve), 'editor');
    const made = await call(port, 'POST', `${path}_api/assets?name=a.png`, { host: hostOf(board.id), 'content-type': 'image/png' }, new Uint8Array([1, 2, 3]));
    assert.equal(made.status, 200, made.body);
    const { id } = json(made) as { id: string };
    const closed = await rooms.internal('close', { body: { id: board.id } });
    assert.deepEqual(await closed.json(), { closed: true });
    const blob = await at(board.id, 'GET', `/_blob/${id}`);
    assert.equal(blob.status, 200, blob.body);
    assert.match(String(blob.headers['cache-control']), /immutable/);
    // Not another artifact's, and a page Referer must hold for this one.
    assert.equal((await at(open.id, 'GET', `/_blob/${id}`)).status, 404);
    const bobPath = await pathFor(design, userOf(bob), 'owner');
    assert.equal((await at(board.id, 'GET', `/_blob/${id}`, { referer: `http://${hostOf(board.id)}${bobPath}` })).status, 403);
    assert.equal((await at(board.id, 'GET', `/_blob/${id}`, { referer: `http://${hostOf(board.id)}${path}` })).status, 200);
  });

  it('sends a top-level visit to the app Shell, and serves editor assets for keeps', async () => {
    const path = await pathFor(board, userOf(eve), 'editor');
    const visit = await at(board.id, 'GET', `${path}?open_artifact_shell=${encodeURIComponent(config.appOrigin)}`, { 'sec-fetch-dest': 'document' });
    assert.equal(visit.status, 302);
    assert.equal(visit.headers.location, `${config.appOrigin}/a/${board.id}`);
    assert.equal(visit.headers['referrer-policy'], 'same-origin');
    const framed = await at(board.id, 'GET', `${path}?open_artifact_shell=${encodeURIComponent(config.appOrigin)}`, { 'sec-fetch-dest': 'iframe' });
    assert.equal(framed.status, 200);
    assert.match(framed.body, /\/_open-artifact\/editors\/whiteboard\/assets\/index-Ab12Cd34\.js/);
    const asset = await at(board.id, 'GET', '/_open-artifact/editors/whiteboard/assets/index-Ab12Cd34.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal((await at(board.id, 'GET', `${path}support.js`)).status, 200);
  });

  it('lets only the app origin call the page API cross-origin', async () => {
    const path = await pathFor(board, userOf(eve), 'editor');
    // The Shell's broker: the app origin is registered when a page token opens the artifact.
    const preflight = await at(board.id, 'OPTIONS', `${path}_api/db/write`, { origin: config.appOrigin, 'access-control-request-method': 'POST' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], config.appOrigin);
    const brokered = await at(board.id, 'GET', `${path}_api/session`, { origin: config.appOrigin });
    assert.equal(brokered.headers['access-control-allow-origin'], config.appOrigin);
    const evil = await at(board.id, 'GET', `${path}_api/session`, { origin: 'http://evil.test' });
    assert.equal(evil.headers['access-control-allow-origin'], undefined);
    const write = { client: 'p', writes: [{ op: 'set', path: 'elements/x9', data: note }] };
    assert.equal((await at(board.id, 'POST', `${path}_api/db/write`, { origin: 'http://evil.test' }, write)).status, 403);
    // Another artifact's content origin is another site too.
    assert.equal((await at(board.id, 'POST', `${path}_api/db/write`, { origin: `http://${hostOf(open.id)}` }, write)).status, 403);
  });

  it('never sends a cookie from a content host, and passes the app host on', async () => {
    const path = await pathFor(board, userOf(eve), 'editor');
    // The Cookie header is not passed on either (`at` checks every answer for Set-Cookie).
    const session = await at(board.id, 'GET', `${path}_api/session`, { cookie: 'oa_session=abc' });
    assert.equal(session.status, 200);
    // Both origins ask for an origin-keyed agent cluster (same-site mode: the app's process is not the page's).
    assert.equal(session.headers['origin-agent-cluster'], '?1');
    const app = await call(port, 'GET', '/', { host: `localhost:${port}` });
    assert.equal(app.body, 'app');

    const probe = createServer((_req, res) => {
      withoutCookies(res);
      res.setHeader('Set-Cookie', 'a=1');
      res.appendHeader('set-cookie', 'b=2');
      res.setHeader('x-kept', '1');
      res.writeHead(200, { 'Set-Cookie': ['c=3'], 'x-also': '2' });
      res.end('ok');
    });
    await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
    const probePort = (probe.address() as { port: number }).port;
    try {
      const answer = await call(probePort, 'GET', '/');
      assert.equal(answer.headers['set-cookie'], undefined);
      assert.equal(answer.headers['x-kept'], '1');
      assert.equal(answer.headers['x-also'], '2');
    } finally {
      await new Promise<void>((done) => probe.close(() => done()));
    }
  });

  it('runs actions of the embedded type server for the host', async () => {
    const check = (await rooms.action(board.id, 'check', {})) as { check: { problems: number } };
    assert.equal(typeof check.check.problems, 'number');
    await assert.rejects(rooms.action(board.id, 'upload', { file: '/etc/hosts' }), (error: Error & { code?: string }) => error.code === 'unsupported');
    const health = await rooms.internal('health');
    assert.equal(health.status, 200);
  });

  it('lets the owner, editors and commenters export a doc, and a viewer only while the owner allows it', async () => {
    const vic = await catalog.createUser({ name: 'Vic' });
    const plan = await catalog.createArtifact({ type: 'docs', title: 'Plan', ownerUser: ada.id });
    await mkdir(rooms.rootOf(plan.id), { recursive: true });
    for (const [subject, role] of [[eve.id, 'editor'], [cam.id, 'commenter'], [vic.id, 'viewer']] as const)
      await catalog.upsertGrant({ artifactId: plan.id, subjectKind: 'user', subject, role, createdBy: ada.id });
    // On by default (the catalog's default): turned off first.
    await catalog.setArtifactSettings(plan.id, { viewersCanExport: false });
    const fresh = (await catalog.getArtifact(plan.id))!;
    const exportAs = async (record: UserRecord, role: ArtifactRole): Promise<Answer> =>
      at(plan.id, 'GET', `${await pathFor(fresh, userOf(record), role)}_api/doc/export?format=markdown`);
    for (const [record, role] of [[ada, 'owner'], [eve, 'editor'], [cam, 'commenter']] as const) {
      const res = await exportAs(record, role);
      assert.equal(res.status, 200, `${role}: ${res.body}`);
    }
    const refused = await exportAs(vic, 'viewer');
    assert.equal(refused.status, 403);
    assert.equal(json(refused).code, 'not_writer');
    assert.match(String(json(refused).message), /has not let viewers download or export/);
    await catalog.setArtifactSettings(plan.id, { viewersCanExport: true });
    await rooms.refresh(plan.id);
    assert.equal((await exportAs(vic, 'viewer')).status, 200);
    await catalog.setArtifactSettings(plan.id, { viewersCanExport: false });
    await rooms.refresh(plan.id);
    assert.equal((await exportAs(vic, 'viewer')).status, 403);
  });

  it("serves a snapshot token as a read-only page nobody sees among the artifact's people", async () => {
    const issued = await catalog.issueAgentToken({ userId: ada.id, label: 'Snapper', scopes: ['artifacts.read'], accessTtlMs: 60_000 });
    const agent: Principal = { kind: 'agent', id: issued.token.id, user: userOf(ada) as Extract<Principal, { kind: 'user' }>, label: 'Snapper', scopes: ['artifacts.read'] };
    const fresh = (await catalog.getArtifact(board.id))!;
    const epoch = (await catalog.siteEpoch());
    const mint = async (now: Date, ttlSeconds?: number): Promise<string> =>
      signPageToken(snapshotTokenClaims({ artifact: board.id, principal: agent, grantsVersion: fresh.grantsVersion, epoch, now, ...(ttlSeconds ? { ttlSeconds } : {}) }), KEYS);
    const token = await mint(new Date());
    // The owner's own agent, yet a viewer: it reads, and writes nothing.
    const page = `/whiteboard/${token}/`;
    const session = await at(board.id, 'GET', `${page}_api/session`);
    assert.equal(session.status, 200, session.body);
    assert.equal((json(session) as { viewer: Viewer }).viewer.role, 'viewer');
    // What it writes is answered and dropped: the page goes on, the artifact does not change.
    const write = await at(board.id, 'POST', `${page}_api/db/write`, {}, { client: 'snap-1', writes: [{ op: 'set', path: 'elements/snap1', data: note }] });
    assert.equal(write.status, 200, write.body);
    const owner = await pathFor(board, userOf(ada), 'owner');
    assert.equal((json(await at(board.id, 'GET', `${owner}_api/db/get?path=elements%2Fsnap1`)).data ?? null), null);
    const outbox = (await catalog.listOutbox(ada.id)).length;
    assert.equal((await at(board.id, 'POST', `${page}_api/agent/send`, {}, { request: { text: 'hi' } })).status, 200);
    assert.equal((await catalog.listOutbox(ada.id)).length, outbox);
    // A top-level visit is the page, standing alone.
    const visit = await at(board.id, 'GET', page, { 'sec-fetch-dest': 'document' });
    assert.equal(visit.status, 200);
    assert.match(String(visit.headers['content-security-policy']), /frame-ancestors 'none'/);
    // Connected, but not one of the artifact's people.
    const before = rooms.connected(board.id);
    const ws = await socketTo(port, `${page}_api/events?client=snap-1`, { host: hostOf(board.id), origin: config.appOrigin });
    assert.equal(ws.status, 101);
    assert.deepEqual(rooms.connected(board.id), before);
    assert.equal(rooms.connected(board.id).some((ref) => ref.id === agent.id), false);
    // A sharing change drops it (it is checked again when it reconnects).
    await rooms.refresh(board.id);
    assert.equal(await settled(ws.closed!, 2000), true);
    // Past its five minutes it is refused, api calls too (no grace).
    const stale = await mint(new Date(Date.now() - 301_000));
    assert.equal((await at(board.id, 'GET', `/whiteboard/${stale}/_api/session`)).status, 403);
    // Gone when the agent's person loses the artifact.
    const own = await catalog.createArtifact({ type: 'whiteboard', title: 'Bob only', ownerUser: bob.id });
    await mkdir(rooms.rootOf(own.id), { recursive: true });
    const foreign = await signPageToken(snapshotTokenClaims({ artifact: own.id, principal: agent, grantsVersion: own.grantsVersion, epoch, now: new Date() }), KEYS);
    assert.equal((await at(own.id, 'GET', `/whiteboard/${foreign}/_api/session`)).status, 403);
  });
});

test('OA_ASSETS_DIR must hold built editors; the message says to build', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-assets-'));
  try {
    assert.throws(() => parseNodeEnv({ OA_ASSETS_DIR: dir }), /OA_ASSETS_DIR: .*no editors\//);
    await mkdir(join(dir, 'editors'));
    assert.equal(parseNodeEnv({ OA_ASSETS_DIR: dir, OA_DATA_DIR: join(dir, 'data') }).assetsDir, dir);
    // The default is this checkout's build output.
    assert.equal(DEFAULT_ASSETS_DIR, join(fileURLToPath(new URL('../../../', import.meta.url)), 'dist', 'server'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
