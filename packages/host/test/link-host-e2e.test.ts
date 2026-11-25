/**
 * Link end to end on a real Node host (the integration step's wiring, composed here: `appRouter` + `linkApiRoutes`,
 * the rooms with the Link presence registry, `nodeLinkServices`), driven with `fetch` like a daemon would: device
 * sign-in, import of a real archive, the manifest, the event stream (presence, a live wake, a person's edit, the
 * Link's own push kept out), a pushed `db/` document reaching an open page, actions through `call`, ack and
 * redelivery, unpublish.
 *
 * The editors are fakes (as in `rooms.test.ts`). Content-origin requests go out with `node:http` and an explicit
 * `Host` (no DNS for `*.localhost`).
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { LINK_API_PREFIX, type LinkArtifact, type LinkArtifactsResult, type LinkDeviceStart, type LinkFilesResult, type LinkHello, type LinkManifest, type LinkToken } from '@open-artifact/protocol';
import { archiveEntries, writeZip } from '@open-artifact/type-server';
import { APP_MAX_BODY_BYTES, appRouter, createAppHandler, type AppCtx } from '../src/core/app/index.ts';
import type { Catalog } from '../src/core/catalog/catalog.ts';
import { parseConfig } from '../src/core/config.ts';
import { HostEvents } from '../src/core/events.ts';
import { linkApiRoutes } from '../src/core/link/routes.ts';
import type { HostConfig, Principal, UserRecord } from '../src/core/types.ts';
import { nodeHandler } from '../src/node/adapter.ts';
import { dispatchByHost } from '../src/node/content.ts';
import { HOST_VERSION, nodeServices, openCatalog } from '../src/node/host.ts';
import { createLinkPresence, nodeLinkServices } from '../src/node/link.ts';
import { createRooms, type HostRooms } from '../src/node/rooms.ts';
import type { SqliteDriver } from '../src/node/sqlite.ts';
import { EventReader, until } from './link-fixture.ts';

const SAMPLE = fileURLToPath(new URL('../../../test-artifacts/whiteboard/elements', import.meta.url));
const sha = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A content-origin request with an explicit Host. */
function call(port: number, method: string, url: string, body?: unknown): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  return new Promise((resolvePromise, reject) => {
    const headers: Record<string, string> = { host: target.host, ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
    const req = request({ host: '127.0.0.1', port, method, path: target.pathname + target.search, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** A page's event socket; `text()` is everything it has heard so far. */
function pageSocket(port: number, url: string, origin: string): Promise<{ socket: Socket; text(): string }> {
  const target = new URL(url);
  return new Promise((resolvePromise, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: target.pathname + target.search,
      headers: { host: target.host, origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': randomBytes(16).toString('base64'), 'sec-websocket-version': '13' },
    });
    req.on('upgrade', (_res: IncomingMessage, socket: Socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      resolvePromise({ socket, text: () => Buffer.concat(chunks).toString('latin1') });
    });
    req.on('response', (res) => reject(new Error(`no upgrade: ${res.statusCode}`)));
    req.on('error', reject);
    req.end();
  });
}

describe('Link on a Node host, end to end', () => {
  let dir: string;
  let server: Server;
  let port: number;
  let app: string;
  let config: HostConfig;
  let catalog: Catalog;
  let driver: SqliteDriver;
  let rooms: HostRooms;
  let stopLink: () => void;
  let presence: ReturnType<typeof createLinkPresence>;
  /** Users whose computer came or went (`agent-changed`), in order. */
  const agentChanges: string[] = [];
  let ada: UserRecord;
  let cookie: string;
  /** Upgraded sockets (the page's events): `closeAllConnections` leaves them open, and `close` would wait on them. */
  const upgraded = new Set<Duplex>();

  const link = (name: string, query = ''): string => `${app}${LINK_API_PREFIX}${name}${query}`;
  const bearer = (token: string, extra: Record<string, string> = {}): Record<string, string> => ({ authorization: `Bearer ${token}`, ...extra });
  const post = (name: string, token: string, body: unknown): Promise<Response> =>
    fetch(link(name), { method: 'POST', headers: bearer(token, { 'content-type': 'application/json' }), body: JSON.stringify(body) });

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-link-e2e-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'whiteboard', 'assets'), { recursive: true });
    await writeFile(join(assets, 'editors', 'whiteboard', 'index.html'), '<!doctype html><html><head><script src="./assets/index-Ab12Cd34.js"></script></head><body></body></html>');
    await writeFile(join(assets, 'editors', 'whiteboard', 'assets', 'index-Ab12Cd34.js'), '/* editor */');
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    const uiDir = join(dir, 'ui');
    await mkdir(join(uiDir, 'shell'), { recursive: true });
    await mkdir(join(uiDir, 'home'), { recursive: true });

    // The server first (on every interface, so `localhost` reaches it either way): its port is in the origins.
    let route: ReturnType<typeof dispatchByHost> | null = null;
    server = createServer({ requestTimeout: 0 }, (req, res) => (route ? route.request(req, res) : res.writeHead(503).end()));
    server.on('upgrade', (req, socket, head) => {
      upgraded.add(socket);
      socket.on('close', () => upgraded.delete(socket));
      route?.upgrade(req, socket, head);
    });
    await new Promise<void>((done) => server.listen(0, done));
    port = (server.address() as AddressInfo).port;
    app = `http://localhost:${port}`;
    config = parseConfig({ OA_APP_ORIGIN: app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`, OA_SIGNING_KEYS: 'e'.repeat(40), OA_OWNER_KEY: 'owner-key-for-the-link-e2e-0123456789' });

    // What the integration step adds to `startHost`.
    const dataDir = join(dir, 'data');
    ({ catalog, driver } = await openCatalog(dataDir, config));
    await mkdir(join(dataDir, 'artifacts'), { recursive: true });
    const events = new HostEvents();
    events.on('agent-changed', ({ userId }) => agentChanges.push(userId));
    presence = createLinkPresence({ onChange: (userId) => events.emit('agent-changed', { userId }) });
    rooms = await createRooms({ config, catalog, dataDir, assetsDir: assets, events, linkPresence: presence, log: () => undefined });
    const services = nodeServices({ catalog, config, rooms, events, uiDir, linkOnline: (userId) => presence.online(userId) });
    const linkServices = nodeLinkServices({ rooms, catalog, events, presence, archive: services.archive, version: HOST_VERSION });
    stopLink = linkServices.stop;
    const router = appRouter();
    linkApiRoutes(router, linkServices);
    const ctx: AppCtx = { config, catalog, now: () => new Date(), log: () => undefined, ...services };
    route = dispatchByHost({ rooms, app: nodeHandler(createAppHandler({ router }), () => ctx, { maxBodyBytes: APP_MAX_BODY_BYTES, log: () => undefined }) });

    ada = await catalog.createUser({ name: 'Ada', email: 'ada@example.com', emailVerified: true });
    cookie = `oa_session=${(await catalog.createSession({ userId: ada.id, ttlMs: 3600_000 })).token}`;
  });

  after(async () => {
    stopLink?.();
    // A test that failed before step 10 leaves the page's socket open.
    for (const socket of upgraded) socket.destroy();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rooms.stop();
    driver.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('signs in, publishes, syncs both ways and hears the page', async () => {
    // 1. Device sign-in: the daemon starts it, Ada approves it in her browser, the daemon polls.
    let response = await fetch(link('device'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client: { name: 'Claude Code on laptop', harness: 'claude-code' } }) });
    assert.equal(response.status, 200);
    const started = (await response.json()) as LinkDeviceStart;
    assert.equal(started.verification_uri, `${app}/link/device`);
    response = await fetch(started.verification_uri_complete, { redirect: 'manual' });
    assert.equal(response.status, 303);
    response = await fetch(started.verification_uri_complete, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Claude Code on laptop/);
    response = await fetch(`${app}/link/device`, {
      method: 'POST',
      headers: { cookie, origin: app, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ user_code: started.user_code, decision: 'approve' }).toString(),
    });
    assert.equal(response.status, 200);
    response = await fetch(link('token'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'device_code', device_code: started.device_code }) });
    assert.equal(response.status, 200);
    const token = (await response.json()) as LinkToken;
    const access = token.access_token;
    const hello = (await (await fetch(link('hello'), { headers: bearer(access) })).json()) as LinkHello;
    assert.equal(hello.user.id, ada.id);
    assert.equal(hello.version, HOST_VERSION);

    // 2. Publish: a real archive under a fresh id.
    const chunks: Buffer[] = [];
    await writeZip(await archiveEntries(SAMPLE), async (chunk) => {
      chunks.push(chunk);
    });
    const id = `art_${randomBytes(8).toString('hex')}`;
    response = await fetch(link('import', `?id=${id}`), { method: 'POST', headers: bearer(access, { 'content-type': 'application/zip' }), body: new Uint8Array(Buffer.concat(chunks)) });
    assert.equal(response.status, 201, await response.clone().text());
    const published = (await response.json()) as LinkArtifact;
    assert.equal(published.type, 'whiteboard');
    assert.equal(published.title, 'Whiteboard element test');
    assert.equal(published.url, `${app}/a/${id}`);
    assert.equal((await catalog.getArtifact(id))!.ownerUser, ada.id);

    // 3. The manifest is the export zip's file list.
    const manifest = (await (await fetch(link('manifest', `?id=${id}`), { headers: bearer(access) })).json()) as LinkManifest;
    const entries = await archiveEntries(rooms.rootOf(id));
    assert.deepEqual(Object.keys(manifest.files).sort(), entries.map((entry) => entry.name.slice(entry.name.indexOf('/') + 1)).sort());
    for (const entry of entries) assert.equal(manifest.files[entry.name.slice(entry.name.indexOf('/') + 1)]!.etag, sha(await readFile(entry.file)));

    // 4. The event stream: Ada's agent is online while it is open.
    assert.equal((await rooms.typeApi.presence(id)).presence, 'offline');
    const abort = new AbortController();
    response = await fetch(link('events'), { headers: bearer(access), signal: abort.signal });
    assert.equal(response.status, 200);
    const events = new EventReader(response);
    await until(() => presence.online(ada.id));
    assert.equal((await rooms.typeApi.presence(id)).presence, 'online');
    // The Shell hears it too (its Library stream gets `artifacts/changed`) and reads the agent from the artifact.
    assert.deepEqual(agentChanges, [ada.id]);
    const detail = (await (await fetch(`${app}/api/open-artifact.artifact?id=${id}`, { headers: { cookie } })).json()) as { agent?: { state: string } };
    assert.equal(detail.agent?.state, 'online');

    // A page is open (its socket starts the room's watcher).
    const principal: Principal = { kind: 'user', id: ada.id, name: ada.name, email: 'ada@example.com', emailVerified: true, siteRole: ada.siteRole };
    const page = await rooms.pageFor((await catalog.getArtifact(id))!, principal, 'owner');
    assert.equal((await call(port, 'GET', `${page.pageUrl}_api/session`)).status, 200);
    const socket = await pageSocket(port, `${page.pageUrl}_api/events?client=${randomBytes(4).toString('hex')}`, app);

    // 5. The Link pushes a db document: the page hears it, the Link hears nothing back.
    const note = JSON.stringify({ type: 'note', x: 10, y: 20, text: 'From the laptop', color: 'yellow' });
    response = await post('files', access, { id, writes: [{ path: 'db/elements/linkpushed.json', content: Buffer.from(note).toString('base64'), if_match: null }] });
    assert.equal(response.status, 200);
    assert.deepEqual(((await response.json()) as LinkFilesResult).results, [{ path: 'db/elements/linkpushed.json', etag: sha(note) }]);
    await until(() => socket.text().includes('From the laptop'), 5000);
    await events.none(300);

    // 6. Ada edits in the page: the Link hears which files.
    const write = { client: 'p', writes: [{ op: 'set', path: 'elements/bypage', data: { type: 'note', x: 0, y: 0, text: 'From the page', color: 'blue' } }] };
    assert.equal((await call(port, 'POST', `${page.pageUrl}_api/db/write`, write)).status, 200);
    const edited = await events.next(5000);
    assert.equal(edited.type, 'files');
    assert.equal(edited.artifact, id);
    assert.ok(edited.type === 'files' && edited.paths.includes('db/elements/bypage.json'), JSON.stringify(edited));
    // Pull it.
    response = await fetch(link('files', `?id=${id}&path=db/elements/bypage.json`), { headers: bearer(access) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /From the page/);

    // 7. A page sends the agent something: a live wake.
    await rooms.typeApi.wake(id, { threads: [{ id: 'th1', text: 'Please tidy up' } as never] });
    const woken = await events.next(5000);
    assert.equal(woken.type, 'wake');
    assert.equal(woken.artifact, id);

    // 8. Actions through call: a comment and its reply, a db write; a host-unsupported action is refused.
    const created = await call(port, 'POST', `${page.pageUrl}_api/comments/create`, { input: { anchor: '{"element":"linkpushed"}', label: 'Note', text: 'Looks good' } });
    assert.equal(created.status, 200, created.body);
    const threads = (await (await post('call', access, { id, action: 'open-artifact.comments.read', args: {} })).json()) as { threads: Array<{ id: string }> };
    assert.ok(threads.threads.length >= 1);
    response = await post('call', access, { id, action: 'open-artifact.comments.reply', args: { thread_id: threads.threads[0]!.id, text: 'Done' } });
    assert.equal(response.status, 200, await response.clone().text());
    response = await post('call', access, { id, action: 'open-artifact.db.write', args: { writes: [{ op: 'set', path: 'elements/bycall', data: { type: 'note', x: 5, y: 5, text: 'By call', color: 'green' } }] } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(await readFile(join(rooms.rootOf(id), 'db', 'elements', 'bycall.json'), 'utf8'), /By call/);
    response = await post('call', access, { id, action: 'upload', args: { file: '/etc/hosts' } });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { code: string }).code, 'unsupported');

    // 9. Disconnect without acknowledging: everything comes again; after ack, nothing does.
    abort.abort();
    await until(() => !presence.online(ada.id));
    assert.equal((await rooms.typeApi.presence(id)).presence, 'offline');
    assert.deepEqual(agentChanges, [ada.id, ada.id]);
    const again = new AbortController();
    response = await fetch(link('events'), { headers: bearer(access), signal: again.signal });
    const replay = new EventReader(response);
    const seen: string[] = [];
    for (;;) {
      try {
        seen.push((await replay.next(400)).id);
      } catch {
        break;
      }
    }
    assert.ok(seen.includes(edited.id) && seen.includes(woken.id), JSON.stringify(seen));
    assert.equal((await post('ack', access, { ids: seen })).status, 200);
    again.abort();
    const last = new AbortController();
    response = await fetch(link('events'), { headers: bearer(access), signal: last.signal });
    await new EventReader(response).none(300);
    last.abort();

    // 10. Unpublish: the artifact is trashed and gone from the Link's list.
    socket.socket.destroy();
    response = await post('unpublish', access, { id });
    assert.equal(response.status, 200);
    assert.ok((await catalog.getArtifact(id))!.trashedAt);
    const listed = (await (await fetch(link('artifacts'), { headers: bearer(access) })).json()) as { artifacts: LinkArtifact[] };
    assert.ok(!listed.artifacts.some((artifact) => artifact.id === id));

    // 11. Publish it again under the same id: the trashed one is replaced (the type server closed it, its folder
    // removed and unpacked anew), and it is live again.
    await writeFile(join(rooms.rootOf(id), 'stale.txt'), 'from before');
    response = await fetch(link('import', `?id=${id}`), { method: 'POST', headers: bearer(access, { 'content-type': 'application/zip' }), body: new Uint8Array(Buffer.concat(chunks)) });
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal((await catalog.getArtifact(id))!.trashedAt, null);
    await assert.rejects(readFile(join(rooms.rootOf(id), 'stale.txt')));
    const relisted = (await (await fetch(link('artifacts'), { headers: bearer(access) })).json()) as { artifacts: LinkArtifact[] };
    assert.ok(relisted.artifacts.some((artifact) => artifact.id === id));
  });
});
