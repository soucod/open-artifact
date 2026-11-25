/**
 * Page artifacts in an artifact's object (`frames.ts`, `room.ts`, `room-host.ts`): the Node site's scenarios
 * (`packages/host/test/page-frames.test.ts`) on the Cloudflare pieces. Each artifact is an {@link ArtifactRoom} on the
 * SQLite file system, its people decided by {@link createProductRoomHost} over the catalog on the fake D1, the `page`
 * type from the build's table, the frame client's files from a fake assets binding.
 *
 * - the dispatch: `/page/<token>/` on the content host is the inner shell, a page host is the page, a socket answers
 *   with the inner shell's subprotocol;
 * - each role's level; one page host per principal (a share link's guest too), kept in the object's index;
 * - what a page host's holder cannot do: call the API, read another artifact, keep reading after access went or the
 *   epoch moved; a snapshot token and the opaque part as a token open nothing;
 * - the Worker's calls: actions, capabilities, writes handed to the open core, connections and refresh, stats, idle
 *   close, import by the marker, create, title, destroy (the index with it);
 * - no pages: nothing of the above (a page host is not routed here, the import refuses a page).
 *
 * `node:fs` is aliased to this package's file system as in `room-host.test.ts`.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installedTypeCsp } from '@open-artifact/protocol';
import { testStorage, type TestStorage } from './sqlite.ts';
import { fakeD1 } from './d1-fake.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '../../..');
const fsDir = join(repo, 'packages/host-cloudflare/src/fs/');
const editors = join(repo, 'dist/server');
const pageType = join(repo, 'artifact-types/page');

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : '';
    const aliased = parent.startsWith(repo) && !parent.startsWith(fsDir) && !parent.includes('/node_modules/') && !parent.includes('/packages/wasm-sheets/') && !parent.includes('/host-cloudflare/test/');
    if (aliased && (specifier === 'node:fs' || specifier === 'fs')) return { url: pathToFileURL(join(fsDir, 'index.ts')).href, shortCircuit: true };
    if (aliased && (specifier === 'node:fs/promises' || specifier === 'fs/promises')) return { url: pathToFileURL(join(fsDir, 'promises.ts')).href, shortCircuit: true };
    return next(specifier, context);
  },
});

type Host = typeof import('@open-artifact/host');
type Rooms = typeof import('../src/room.ts');
type RoomHosts = typeof import('../src/room-host.ts');
type Frames = typeof import('../src/frames.ts');
type D1 = typeof import('../src/d1.ts');
type Archive = typeof import('@open-artifact/type-server');
let core: Host;
let rooms: Rooms;
let roomHosts: RoomHosts;
let frames: Frames;
let d1: D1;
let archive: Archive;

const KEYS = ['p'.repeat(40)];
const CLIENT = ['runtime.js', 'imports.js', 'shell.js', 'comments.js', 'shell.css', 'comments.css', 'shell.html'];

/** The build's frame table for the tests: the real `page` type, a synthetic client under a versioned path. */
function frameBuild(): import('../src/frames.ts').FrameBuild {
  const files: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(pageType, path)] = readFileSync(path).toString('base64');
    }
  };
  walk(join(pageType, 'artifact-type'));
  return {
    types: [{ id: 'page', label: 'artifact-types/page', fingerprint: 'test0000test0000', manifest: JSON.parse(readFileSync(join(pageType, 'artifact-type.json'), 'utf8')), skill: 'Write index.html.', indexHtml: null, files, page: true }],
    client: { base: '/_open-artifact/frame/test0000test0000/', files: CLIENT },
  };
}

const fetched: string[] = [];
const assets = {
  async fetch(request: Request): Promise<Response> {
    const path = decodeURIComponent(new URL(request.url).pathname);
    fetched.push(path);
    const client = /^\/_open-artifact\/frame\/test0000test0000\/(.+)$/.exec(path);
    if (client) {
      const name = client[1]!;
      if (!CLIENT.includes(name)) return new Response(null, { status: 404 });
      return new Response(name === 'shell.html' ? '<!doctype html><title>inner shell</title><script src="./shell.js"></script>' : `/* ${name} */`);
    }
    const file = join(editors, path.replace(/^\/_open-artifact\//, ''));
    if (!file.startsWith(editors) || !existsSync(file) || statSync(file).isDirectory()) return new Response(null, { status: 404 });
    return new Response(readFileSync(file));
  },
};

function sockets() {
  const made: Array<{ sent: string[]; closed: number | null; listeners: Record<string, Array<(e: unknown) => void>> }> = [];
  const pair = () => {
    const record = { sent: [] as string[], closed: null as number | null, listeners: {} as Record<string, Array<(e: unknown) => void>> };
    made.push(record);
    const server = {
      accept() {},
      send(message: string | ArrayBuffer | ArrayBufferView) {
        record.sent.push(typeof message === 'string' ? message : Buffer.from(message as ArrayBuffer).toString('utf8'));
      },
      close(code?: number) {
        record.closed = code ?? 1000;
      },
      addEventListener(type: string, listener: (e: unknown) => void) {
        (record.listeners[type] ??= []).push(listener);
      },
    };
    return [{ client: true }, server] as unknown as [unknown, import('../src/bridge/ws.ts').WorkersWebSocket];
  };
  return { made, pair };
}

async function until(check: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
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

describe('page artifacts in an artifact\'s object', () => {
  let config: import('@open-artifact/host').HostConfig;
  let catalog: import('@open-artifact/host').Catalog;
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const hub = {
    async emit(name: string, payload: unknown) {
      emitted.push({ name, payload });
    },
    async online() {
      return false;
    },
  };
  type Principal = import('@open-artifact/host').Principal;
  type ArtifactRow = import('@open-artifact/host').ArtifactRow;
  type ArtifactRole = import('@open-artifact/host').ArtifactRole;
  type UserRecord = import('@open-artifact/host').UserRecord;
  let ada: UserRecord, bob: UserRecord, cam: UserRecord, eve: UserRecord;
  let page: ArtifactRow, other: ArtifactRow, board: ArtifactRow;
  let guest: Principal;

  interface Live {
    room: InstanceType<Rooms['ArtifactRoom']>;
    host: import('../src/room-host.ts').ProductRoomHost;
    ws: ReturnType<typeof sockets>;
    storage: TestStorage;
  }
  const live = new Map<string, Live>();
  let pagesOn: { types: import('../src/frames.ts').RoomFrameTypes; network: 'self' };

  const objectOf = async (artifact: ArtifactRow, files?: Record<string, string>, options: { pages?: boolean; idleCloseMs?: number } = {}): Promise<Live> => {
    const known = live.get(artifact.id);
    if (known) return known;
    const ws = sockets();
    let room: InstanceType<Rooms['ArtifactRoom']> | null = null;
    const host = roomHosts.createProductRoomHost({ config, catalog, hub, rootOf: (id) => room!.rootOf(id), ...(options.pages === false ? {} : { pages: pagesOn }) });
    const storage = testStorage();
    room = new rooms.ArtifactRoom({ storage, id: { toString: () => artifact.id, name: artifact.id } }, { ASSETS: assets }, {
      host: host.host,
      pair: ws.pair,
      upgraded: (_client, headers) => new Response(null, { status: 204, headers: { 'x-upgraded': '1', ...(headers ?? {}) } }),
      log: () => undefined,
      ...(options.idleCloseMs !== undefined ? { idleCloseMs: options.idleCloseMs } : {}),
    });
    if (files) await room.seed(artifact.id, files);
    const made = { room, host, ws, storage };
    live.set(artifact.id, made);
    return made;
  };
  const pageFiles = (artifact: ArtifactRow, text: string): Record<string, string> => ({
    '.artifact.json': JSON.stringify({ type: 'page', id: artifact.id, capabilities: { db: true, comments: true } }),
    'index.html': `<!doctype html><title>${artifact.title}</title><script src="app.js"></script>`,
    'app.js': `/* ${text} */`,
  });

  const user = (record: UserRecord): Principal => ({ kind: 'user', id: record.id, name: record.name, siteRole: record.siteRole });
  const contentHost = (id: string): string => new URL(core.contentOriginOf(config, id)).host;
  /** A request to the artifact's object, on any host (the Worker sends it with the artifact named). */
  const at = async (artifact: ArtifactRow, host: string, path: string, headers: Record<string, string> = {}, init: { method?: string; body?: string } = {}): Promise<Answer> => {
    const { room } = await objectOf(artifact);
    const answer = await room.fetch(new Request(`http://${host}${path}`, { method: init.method ?? 'GET', headers: { [rooms.ARTIFACT_HEADER]: artifact.id, ...headers }, ...(init.body ? { body: init.body } : {}) }));
    return { status: answer.status, headers: answer.headers, body: await answer.text() };
  };
  const shellPath = async (artifact: ArtifactRow, principal: Principal, role: ArtifactRole, claims: Partial<import('@open-artifact/host').PageTokenClaims> = {}): Promise<string> => {
    const token = await core.signPageToken({ ...core.pageTokenClaims({ artifact: artifact.id, principal, role, grantsVersion: artifact.grantsVersion, epoch: await catalog.siteEpoch(), now: new Date() }), ...claims }, KEYS);
    return `/page/${encodeURIComponent(token)}/`;
  };
  const sessionOf = async (artifact: ArtifactRow, principal: Principal, role: ArtifactRole): Promise<Record<string, any>> => {
    const answer = await at(artifact, contentHost(artifact.id), `${await shellPath(artifact, principal, role)}api/frame/session`);
    assert.equal(answer.status, 200, answer.body);
    return JSON.parse(answer.body) as Record<string, any>;
  };
  const pageHostFor = async (artifact: ArtifactRow, principal: Principal, role: ArtifactRole): Promise<{ host: string; ver: string }> => {
    const session = await sessionOf(artifact, principal, role);
    return { host: new URL(session.contentOrigin as string).host, ver: String(session.ver) };
  };

  before(async () => {
    core = await import('@open-artifact/host');
    rooms = await import('../src/room.ts');
    roomHosts = await import('../src/room-host.ts');
    frames = await import('../src/frames.ts');
    d1 = await import('../src/d1.ts');
    archive = await import('@open-artifact/type-server');
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
    pagesOn = { types: frames.bundledFrameTypes(frameBuild(), (request) => assets.fetch(request)), network: 'self' };
    const driver = d1.d1Driver(fakeD1());
    await d1.ensureMigrated(driver, {});
    catalog = new core.Catalog(driver, { signingKeys: KEYS });
    ada = await catalog.createUser({ name: 'Ada', email: 'ada@example.com', emailVerified: true });
    bob = await catalog.createUser({ name: 'Bob' });
    cam = await catalog.createUser({ name: 'Cam' });
    eve = await catalog.createUser({ name: 'Eve' });
    page = await catalog.createArtifact({ type: 'page', title: 'Poll', ownerUser: ada.id, generalAccess: 'link' });
    other = await catalog.createArtifact({ type: 'page', title: 'Other', ownerUser: ada.id });
    board = await catalog.createArtifact({ type: 'whiteboard', title: 'Board', ownerUser: ada.id });
    await catalog.upsertGrant({ artifactId: page.id, subjectKind: 'user', subject: bob.id, role: 'viewer', createdBy: ada.id });
    await catalog.upsertGrant({ artifactId: page.id, subjectKind: 'user', subject: cam.id, role: 'commenter', createdBy: ada.id });
    await catalog.upsertGrant({ artifactId: page.id, subjectKind: 'user', subject: eve.id, role: 'editor', createdBy: ada.id });
    const { link } = await catalog.createLink(page.id, 'commenter');
    const joined = (await catalog.joinGuest(link.id, 'Gus')).guest;
    guest = { kind: 'guest', id: joined.id, name: joined.name, link: joined.linkId, artifact: page.id };
    page = (await catalog.getArtifact(page.id))!;
    await objectOf(page, pageFiles(page, 'poll'));
    await objectOf(other, pageFiles(other, 'secret'));
  });

  after(async () => {
    for (const { room } of live.values()) await room.destroy().catch(() => undefined);
  });

  it('dispatches /page/<token>/ to the inner shell, with a CSP that frames page hosts only; no slash → 302', async () => {
    const path = await shellPath(page, user(ada), 'owner');
    const shell = await at(page, contentHost(page.id), path);
    assert.equal(shell.status, 200, shell.body);
    assert.match(shell.body, /inner shell/);
    assert.match(shell.headers.get('content-security-policy') ?? '', /frame-src[^;]*http:\/\/\*\.content\.localhost:8787/);
    assert.equal(shell.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(shell.headers.get('cache-control'), 'no-store');
    const bare = await at(page, contentHost(page.id), path.slice(0, -1));
    assert.equal(bare.status, 302);
    assert.equal(bare.headers.get('location'), `${path.split('/')[2]}/`);
    // The client's files came from the versioned assets path, once per isolate.
    assert.ok(fetched.includes('/_open-artifact/frame/test0000test0000/runtime.js'));
    const script = await at(page, contentHost(page.id), `${path}shell.js`);
    assert.equal(script.body, '/* shell.js */');
  });

  it('gives each role its level; one page host per principal, a guest\'s too, kept in the object\'s index', async () => {
    const levels: Array<[Principal, ArtifactRole, boolean, boolean, boolean]> = [
      [user(ada), 'owner', true, true, true],
      [user(eve), 'editor', false, true, true],
      [user(cam), 'commenter', false, false, true],
      [user(bob), 'viewer', false, false, false],
      [guest, 'commenter', false, false, true],
    ];
    const hosts = new Set<string>();
    for (const [who, role, owner, edits, comments] of levels) {
      const session = await sessionOf(page, who, role);
      assert.equal(session.me.isOwner, owner, role);
      assert.equal(session.me.canEdit, edits, role);
      assert.equal(session.comments.available, comments, role);
      assert.deepEqual(session.outerOrigins, [config.appOrigin]);
      const host = new URL(session.contentOrigin as string).host;
      assert.equal(core.pageHostOf(config, host)?.id, page.id);
      assert.equal(host.includes('v1.'), false);
      hosts.add(host);
    }
    assert.equal(hosts.size, 5, 'one page host per principal');
    const { storage } = live.get(page.id)!;
    const rows = storage.db.prepare(`SELECT kind, id FROM ${frames.PAGE_HOSTS_TABLE}`).all() as Array<{ kind: string; id: string }>;
    assert.equal(rows.length, 5);
    assert.ok(rows.some((r) => r.kind === 'guest' && r.id === (guest as { id: string }).id), 'the guest\'s page host is kept');
    // The token's role is a hint: a viewer's token with an editor role claimed is still a viewer's level.
    assert.equal((await sessionOf(page, user(bob), 'editor')).me.canEdit, false);
  });

  it('serves the page on its page host, read only, with the network policy\'s CSP; a guest\'s page host works after the object forgot it', async () => {
    const { host, ver } = await pageHostFor(page, user(bob), 'viewer');
    const index = await at(page, host, '/');
    assert.equal(index.status, 302);
    assert.equal(index.headers.get('location'), `/_f/${ver}/`);
    const script = await at(page, host, `/_f/${ver}/app.js`);
    assert.equal(script.status, 200, script.body);
    assert.equal(script.body, '/* poll */');
    assert.equal(script.headers.get('content-security-policy'), installedTypeCsp([]));
    const runtime = await at(page, host, '/_runtime/open-artifact-frame.js');
    assert.equal(runtime.status, 200);
    // A new instance of the object on the same storage (an eviction, then a request): it reads the index from its
    // storage, so the guest's page host (which the catalog cannot work out again) still opens. It serves from now on.
    const guestHost = await pageHostFor(page, guest, 'commenter');
    const { storage } = live.get(page.id)!;
    const ws = sockets();
    let again: InstanceType<Rooms['ArtifactRoom']> | null = null;
    const host2 = roomHosts.createProductRoomHost({ config, catalog, hub, rootOf: (id) => again!.rootOf(id), pages: pagesOn });
    again = new rooms.ArtifactRoom({ storage, id: { toString: () => page.id, name: page.id } }, { ASSETS: assets }, {
      host: host2.host,
      pair: ws.pair,
      upgraded: (_client, headers) => new Response(null, { status: 204, headers: { 'x-upgraded': '1', ...(headers ?? {}) } }),
      log: () => undefined,
    });
    live.set(page.id, { room: again, host: host2, ws, storage });
    const answer = await at(page, guestHost.host, `/_f/${guestHost.ver}/app.js`);
    assert.equal(answer.status, 200, answer.body);
  });

  it('a page host cannot reach the API or another artifact; the opaque part and a snapshot token are no page token', async () => {
    const ownerPath = await shellPath(page, user(ada), 'owner');
    const { host, ver } = await pageHostFor(page, user(ada), 'owner');
    for (const path of [`${ownerPath}api/frame/session`, '/api/frame/session', ownerPath]) {
      const answer = await at(page, host, path);
      assert.ok(answer.status >= 400, `${path} → ${answer.status}`);
      assert.equal(answer.body.includes('"grants"'), false);
    }
    assert.equal((await at(page, host, `/_f/${ver}/x`, { upgrade: 'websocket' })).status, 403, 'no socket on a page host');
    // Its opaque part under the other artifact's id label: nobody's (sent to that artifact's object).
    const opaque = core.pageHostOf(config, host)!.opaque;
    const forged = new URL(core.pageOriginOf(config, other.id, opaque)).host;
    assert.equal((await at(other, forged, `/_f/${ver}/app.js`)).status, 403);
    // A page host sent to another artifact's object (a Worker mistake): refused, not served from that object.
    assert.equal((await at(other, host, `/_f/${ver}/app.js`)).status, 403);
    assert.equal((await at(page, contentHost(page.id), `/page/${opaque}/api/frame/session`)).status, 403);
    const snap = await core.signPageToken(core.snapshotTokenClaims({ artifact: page.id, principal: user(ada), grantsVersion: page.grantsVersion, epoch: await catalog.siteEpoch(), now: new Date() }), KEYS);
    assert.equal((await at(page, contentHost(page.id), `/page/${encodeURIComponent(snap)}/api/frame/session`)).status, 403);
    // Another artifact's token on this content host.
    assert.equal((await at(page, contentHost(page.id), `${await shellPath(other, user(ada), 'owner')}api/frame/session`)).status, 403);
    // Someone with no access.
    const stranger = await catalog.createUser({ name: 'Zed' });
    assert.equal((await at(page, contentHost(page.id), `${await shellPath(page, user(stranger), 'viewer')}api/frame/session`)).status, 403);
  });

  it('opens a socket with the inner shell\'s subprotocol; refresh ends it when the role moved, and the page host reads nothing after', async () => {
    const path = await shellPath(page, user(cam), 'commenter');
    const { host, ver } = await pageHostFor(page, user(cam), 'commenter');
    const { room, host: roomHost, ws } = live.get(page.id)!;
    const answer = await at(page, contentHost(page.id), `${path}api/frame/events?c=client-1234`, { upgrade: 'websocket', connection: 'Upgrade', origin: core.contentOriginOf(config, page.id) });
    assert.equal(answer.headers.get('x-upgraded'), '1', answer.body);
    assert.equal(answer.headers.get('sec-websocket-protocol'), 'baoyu-sse');
    const socket = ws.made.at(-1)!;
    await until(() => socket.sent.length > 0);
    assert.ok(room.connected().some((ref) => ref.id === cam.id));
    assert.ok((await room.stats()).connections >= 1);
    assert.equal((await room.stats()).open >= 1, true);
    await catalog.removeGrant(page.id, 'user', cam.id);
    const { dropped } = await roomHost.refresh(room, page.id);
    assert.equal(dropped, 1);
    assert.equal(socket.closed, 4001);
    assert.equal(room.connected().some((ref) => ref.id === cam.id), false);
    assert.equal((await at(page, host, `/_f/${ver}/app.js`)).status, 403);
  });

  it('a new site epoch retires every page host', async () => {
    const { host, ver } = await pageHostFor(page, user(eve), 'editor');
    assert.equal((await at(page, host, `/_f/${ver}/app.js`)).status, 200);
    await catalog.bumpSiteEpoch();
    live.get(page.id)!.host.invalidate(page.id);
    assert.equal((await at(page, host, `/_f/${ver}/app.js`)).status, 403);
    const fresh = await pageHostFor(page, user(eve), 'editor');
    assert.notEqual(fresh.host, host);
    assert.equal((await at(page, fresh.host, `/_f/${fresh.ver}/app.js`)).status, 200);
  });

  it('runs the frame actions for the Worker; an unknown one is unknown_action', async () => {
    const { room } = live.get(page.id)!;
    const info = (await room.action('info', {})) as Record<string, unknown>;
    assert.ok(info && typeof info === 'object');
    await assert.rejects(room.action('nope', {}), (error: { code?: string; status?: number }) => error.code === 'unknown_action' && error.status === 404);
  });

  it('capabilities: read, set (the marker and the open core), unchanged is no change, too large and a non-page refused', async () => {
    const { room } = live.get(page.id)!;
    assert.deepEqual(await room.capabilities(), { db: true, comments: true });
    assert.equal(await room.setCapabilities({ db: true, identity: true }), true);
    assert.equal(await room.setCapabilities({ db: true, identity: true }), false);
    const read = await room.readFile('.artifact.json');
    const saved = JSON.parse(Buffer.from(read!.bytes).toString('utf8')) as { type: string; capabilities: unknown };
    assert.equal(saved.type, 'page');
    assert.deepEqual(saved.capabilities, { db: true, identity: true });
    assert.equal((await sessionOf(page, user(ada), 'owner')).comments.available, false, 'the open core read the new declaration');
    await assert.rejects(room.setCapabilities({ big: 'x'.repeat(70 * 1024) }), (error: { code?: string }) => error.code === 'too_large');
    const boardRoom = (await objectOf(board, { '.artifact.json': JSON.stringify({ type: 'whiteboard', id: board.id }) })).room;
    assert.equal(await boardRoom.capabilities(), null);
    await assert.rejects(boardRoom.setCapabilities({ db: true }), (error: { code?: string }) => error.code === 'invalid_argument');
    await room.setCapabilities({ db: true, comments: true });
  });

  it('hands a write the Worker made to the open core (no watcher); the page hears the new version', async () => {
    const { room } = live.get(page.id)!;
    const before = String((await sessionOf(page, user(ada), 'owner')).ver);
    const [result] = await room.writeFiles([{ path: 'app.js', content: Buffer.from('/* poll 2 */').toString('base64') } as never], 'agent');
    assert.ok(result);
    const after = String((await sessionOf(page, user(ada), 'owner')).ver);
    assert.notEqual(after, before, 'the open core saw the write');
    const { host } = await pageHostFor(page, user(ada), 'owner');
    assert.equal((await at(page, host, `/_f/${after}/app.js`)).body, '/* poll 2 */');
  });

  it('takes the title from <title>, scaffolds a new page, and imports a page archive by its marker only when pages run', async () => {
    const { room } = live.get(page.id)!;
    assert.equal(await room.contentTitle('page'), 'Poll');
    const fresh = await catalog.createArtifact({ type: 'page', title: 'New', ownerUser: ada.id });
    const made = await objectOf(fresh);
    await made.room.create({ id: fresh.id, type: 'page', title: 'New' });
    const marker = JSON.parse(Buffer.from((await made.room.readFile('.artifact.json'))!.bytes).toString('utf8')) as Record<string, unknown>;
    assert.deepEqual(marker, { type: 'page', id: fresh.id, title: 'New', release: null, capabilities: {} });
    // An export of the page, imported into a new artifact's object.
    const zip = new Uint8Array(await new Response(await room.archive({ folder: 'Poll' })).arrayBuffer());
    const copy = await catalog.createArtifact({ type: 'page', title: 'Copy', ownerUser: ada.id });
    const into = await objectOf(copy);
    assert.deepEqual(await into.room.importArtifact(zip, { id: copy.id }), { type: 'page', title: 'Poll' });
    const nopages = await catalog.createArtifact({ type: 'page', title: 'No', ownerUser: ada.id });
    const plain = await objectOf(nopages, undefined, { pages: false });
    await assert.rejects(plain.room.importArtifact(zip, { id: nopages.id }), /not an artifact/);
    await assert.rejects(plain.room.create({ id: nopages.id, type: 'page', title: 'No' }), /Unknown type/);
    assert.ok(archive.importArchive);
  });

  it('without pages, a page path and a page host are not the frame core\'s', async () => {
    const nopages = await catalog.createArtifact({ type: 'page', title: 'Off', ownerUser: ada.id });
    await objectOf(nopages, pageFiles(nopages, 'off'), { pages: false });
    const answer = await at(nopages, contentHost(nopages.id), `${await shellPath(nopages, user(ada), 'owner')}api/frame/session`);
    assert.notEqual(answer.status, 200);
    assert.equal(answer.body.includes('"contentOrigin"'), false);
  });

  it('closes the core when nothing is open for idleCloseMs, and opens it again with nothing lost', async () => {
    const quiet = await catalog.createArtifact({ type: 'page', title: 'Quiet', ownerUser: ada.id });
    const { room } = await objectOf(quiet, pageFiles(quiet, 'quiet'), { idleCloseMs: 100 });
    assert.equal((await at(quiet, contentHost(quiet.id), `${await shellPath(quiet, user(ada), 'owner')}api/frame/session`)).status, 200);
    assert.equal((await room.stats()).open, 1);
    await until(async () => (await room.stats()).open === 0);
    assert.equal((await at(quiet, contentHost(quiet.id), `${await shellPath(quiet, user(ada), 'owner')}api/frame/session`)).status, 200);
  });

  it('destroy drops the page hosts\' index with the rest; the page host reads nothing after', async () => {
    const { host, ver } = await pageHostFor(other, user(ada), 'owner');
    const { room, storage } = live.get(other.id)!;
    assert.equal((storage.db.prepare(`SELECT COUNT(*) AS n FROM ${frames.PAGE_HOSTS_TABLE}`).get() as { n: number }).n, 1);
    await room.destroy();
    assert.equal(storage.db.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(frames.PAGE_HOSTS_TABLE), undefined);
    assert.equal((await at(other, host, `/_f/${ver}/app.js`)).status, 403);
  });
});
