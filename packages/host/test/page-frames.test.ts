/**
 * Page artifacts on the Node site (the frame engine, `node/frames.ts`, and the page hosts, `core/page-host.ts`):
 *
 * - the page host name: one DNS label, round trip, never a content host, never a page token, made per artifact,
 *   principal and epoch, and still read under a key rotation;
 * - the levels each site role gets, the network setting and the CSP it makes;
 * - the dispatch: `/page/<token>/` on the content host is the inner shell, a page host is the page, anything else the
 *   type server; the inner shell names the viewer's page host and no token, the page host serves files only;
 * - what the page host's holder cannot do: call the API, read another artifact, keep reading after access went;
 * - TLS ask for page hosts, capabilities set on the site (told to the Link unless the Link set them), and the import
 *   that takes a page by its `.artifact.json`;
 * - single-origin mode: no pages.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it, test } from 'node:test';
import { installedTypeCsp } from '@open-artifact/protocol';
import { archiveEntries, importArchive, writeZip } from '../../type-server/src/archive.ts';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { parseConfig } from '../src/core/config.ts';
import { HostEvents, type HostEventMap } from '../src/core/events.ts';
import { LINK_AUTHOR } from '../src/core/link/outbox.ts';
import { PAGE_HOST_OPAQUE_LENGTH, pageHostFits, pageHostLabel, pageHostMatches, pageHostOf, pageHostOpaque, pageHostSource, pageOriginOf } from '../src/core/page-host.ts';
import { artifactOfContentHost, hostKindOf, snapshotTokenClaims, signPageToken } from '../src/core/page-token.ts';
import type { ArtifactRole, ArtifactRow, HostConfig, Principal, UserRecord } from '../src/core/types.ts';
import { dispatchByHost } from '../src/node/content.ts';
import { createLinkPresence, nodeLinkServices, removeArtifactFolder } from '../src/node/link.ts';
import { readMcpTypes } from '../src/node/mcp.ts';
import { parseNodeEnv } from '../src/node/env.ts';
import { frameLevelOf, framePeople, nodeFrameTypes, pageNetworkPolicy, pageServices, parsePageNetwork } from '../src/node/frames.ts';
import { startHost } from '../src/node/host.ts';
import { createRooms, type HostRooms } from '../src/node/rooms.ts';
import { openSqlite } from '../src/node/sqlite.ts';

const KEYS = ['p'.repeat(40)];
const TYPES_DIR = join(import.meta.dirname, '..', '..', '..', 'artifact-types');
const CONFIG = { contentOrigin: 'https://{id}.content.example' };

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function call(port: number, path: string, headers: Record<string, string>): Promise<Answer> {
  return new Promise((done, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** An open event stream (server-sent events): what came so far, and whether the server ended it. */
function stream(port: number, path: string, headers: Record<string, string>): { text(): string; ended: Promise<void>; close(): void } {
  let text = '';
  let close = (): void => undefined;
  const ended = new Promise<void>((done, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      if (res.statusCode !== 200) reject(new Error(`events: HTTP ${res.statusCode}`));
      res.on('data', (c: Buffer) => (text += c.toString('utf8')));
      res.on('end', () => done());
      res.on('close', () => done());
    });
    close = () => req.destroy();
    req.on('error', () => done());
    req.end();
  });
  return { text: () => text, ended, close };
}

async function until<T>(check: () => T | Promise<T>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((done) => setTimeout(done, 25));
  }
}

describe('page host names', () => {
  const id = 'art_0123456789abcdefghijklmno';
  const ada = { kind: 'user', id: 'u_ada' };

  it('are one DNS label of the id label and 24 base32 characters, read back to the artifact and the opaque part', async () => {
    const opaque = await pageHostOpaque(KEYS, id, ada, 1);
    assert.match(opaque, new RegExp(`^[a-z2-7]{${PAGE_HOST_OPAQUE_LENGTH}}$`));
    const label = pageHostLabel(id, opaque);
    assert.ok(label.length <= 63, label);
    assert.match(label, /^[a-z0-9-]+$/);
    assert.equal(label, `art-0123456789abcdefghijklmno--${opaque}`);
    const origin = pageOriginOf(CONFIG, id, opaque);
    assert.equal(origin, `https://${label}.content.example`);
    assert.deepEqual(pageHostOf(CONFIG, new URL(origin).host), { id, opaque });
    assert.deepEqual(pageHostOf(CONFIG, `${new URL(origin).host}:443`), { id, opaque }, 'the default port is the same host');
    assert.equal(pageHostSource(CONFIG), 'https://*.content.example');
  });

  it('are never a content host, a page token or another deployment\'s host; a content host is never a page host', async () => {
    const opaque = await pageHostOpaque(KEYS, id, ada, 1);
    const host = new URL(pageOriginOf(CONFIG, id, opaque)).host;
    assert.equal(artifactOfContentHost(CONFIG, host), null, 'a page host names no content origin');
    assert.equal(pageHostOf(CONFIG, 'art-0123456789abcdefghijklmno.content.example'), null);
    assert.equal(pageHostOf(CONFIG, host.replace('content.example', 'other.example')), null);
    assert.equal(pageHostOf(CONFIG, `art-0123456789abcdefghijklmno--v1.abc.def.content.example`), null, 'a token-shaped label');
    assert.equal(pageHostOf(CONFIG, `art-0123456789abcdefghijklmno--${opaque.slice(1)}.content.example`), null, 'too short');
    assert.equal(pageHostOf(CONFIG, `art-0123456789abcdefghijklmno--${opaque.toUpperCase()}1.content.example`), null);
    const app = { appOrigin: 'https://app.example', ...CONFIG };
    assert.deepEqual(hostKindOf(app, host), { kind: 'page', id, opaque });
    assert.deepEqual(hostKindOf(app, 'art-0123456789abcdefghijklmno.content.example'), { kind: 'content', id });
  });

  it('depend on the artifact, the principal and the epoch; a rotated key still reads the old ones', async () => {
    const base = await pageHostOpaque(KEYS, id, ada, 1);
    assert.equal(await pageHostOpaque(KEYS, id, ada, 1), base, 'stable while access lasts');
    assert.notEqual(await pageHostOpaque(KEYS, 'art_0123456789abcdefghijklmnp', ada, 1), base);
    assert.notEqual(await pageHostOpaque(KEYS, id, { kind: 'user', id: 'u_bob' }, 1), base);
    assert.notEqual(await pageHostOpaque(KEYS, id, { kind: 'guest', id: 'u_ada' }, 1), base);
    assert.notEqual(await pageHostOpaque(KEYS, id, ada, 2), base);
    assert.equal(await pageHostMatches(KEYS, base, id, ada, 1), true);
    assert.equal(await pageHostMatches(KEYS, base, id, ada, 2), false);
    assert.equal(await pageHostMatches(['n'.repeat(40), ...KEYS], base, id, ada, 1), true, 'the old key is still listed');
    assert.equal(await pageHostMatches(['n'.repeat(40)], base, id, ada, 1), false);
  });

  it('leave no room for an id longer than 33 characters after art_: refused, not cut', () => {
    assert.equal(pageHostFits('art_' + 'a'.repeat(33)), true);
    assert.equal(pageHostFits('art_' + 'a'.repeat(34)), false);
    assert.throws(() => pageHostLabel('art_' + 'a'.repeat(34), 'a'.repeat(24)), /too long/);
  });
});

describe('page levels and network', () => {
  it('maps site roles to frame levels', () => {
    assert.deepEqual(frameLevelOf('viewer'), { level: 'view', canComment: false });
    assert.deepEqual(frameLevelOf('commenter'), { level: 'view', canComment: true });
    assert.deepEqual(frameLevelOf('editor'), { level: 'admin', canComment: true });
    assert.deepEqual(frameLevelOf('owner'), { level: 'owner', canComment: true });
  });

  it('reads OA_PAGE_NETWORK: self (default) or https; the CSP and the origins a page is told agree', () => {
    assert.equal(parsePageNetwork({}), 'self');
    assert.equal(parsePageNetwork({ OA_PAGE_NETWORK: 'https' }), 'https');
    assert.throws(() => parsePageNetwork({ OA_PAGE_NETWORK: 'any' }), /OA_PAGE_NETWORK/);
    assert.deepEqual(pageNetworkPolicy('self'), { contentSecurityPolicy: installedTypeCsp([]), allowedNetworkOrigins: [] });
    assert.deepEqual(pageNetworkPolicy('https'), { contentSecurityPolicy: installedTypeCsp(['https:']), allowedNetworkOrigins: ['https:'] });
  });
});

describe('page artifacts on the site', () => {
  let dir: string;
  let front: Server;
  let port: number;
  let config: HostConfig;
  let catalog: Catalog;
  let rooms: HostRooms;
  let route: ReturnType<typeof dispatchByHost> | null = null;
  let client: string;
  let assets: string;
  const events = new HostEvents();
  const changed: HostEventMap['artifact-changed'][] = [];
  let ada: UserRecord, bob: UserRecord, cam: UserRecord, eve: UserRecord;
  let page: ArtifactRow, other: ArtifactRow;

  const user = (record: UserRecord): Principal => ({ kind: 'user', id: record.id, name: record.name, siteRole: record.siteRole });
  const contentHost = (id: string): string => `${id.replace('_', '-')}.content.localhost:${port}`;
  const at = (host: string, path: string, headers: Record<string, string> = {}): Promise<Answer> => call(port, path, { host, ...headers });
  const shellPath = async (artifact: ArtifactRow, principal: Principal, role: ArtifactRole): Promise<string> => new URL((await rooms.pageFor(artifact, principal, role)).pageUrl).pathname;
  const sessionOf = async (artifact: ArtifactRow, principal: Principal, role: ArtifactRole): Promise<Record<string, any>> => {
    const answer = await at(contentHost(artifact.id), `${await shellPath(artifact, principal, role)}api/frame/session`);
    assert.equal(answer.status, 200, answer.body);
    return JSON.parse(answer.body) as Record<string, any>;
  };
  const pageHostFor = async (artifact: ArtifactRow, principal: Principal, role: ArtifactRole): Promise<{ host: string; ver: string }> => {
    const session = await sessionOf(artifact, principal, role);
    return { host: new URL(session.contentOrigin as string).host, ver: String(session.ver) };
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-page-frames-'));
    assets = join(dir, 'assets');
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    client = join(dir, 'client');
    await mkdir(client, { recursive: true });
    for (const name of ['runtime.js', 'imports.js', 'shell.js', 'comments.js']) await writeFile(join(client, name), `/* ${name} */`);
    for (const name of ['shell.css', 'comments.css']) await writeFile(join(client, name), '/* css */');
    await writeFile(join(client, 'shell.html'), '<!doctype html><title>inner shell</title><script src="./shell.js"></script>');

    route = null;
    front = createServer((req, res) => (route ? route.request(req, res) : res.writeHead(503).end()));
    front.on('upgrade', (req, socket, head) => route?.upgrade(req, socket, head));
    await new Promise<void>((done) => front.listen(0, '127.0.0.1', done));
    port = (front.address() as { port: number }).port;
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
    ada = await catalog.createUser({ name: 'Ada', email: 'ada@example.com', emailVerified: true });
    bob = await catalog.createUser({ name: 'Bob' });
    cam = await catalog.createUser({ name: 'Cam' });
    eve = await catalog.createUser({ name: 'Eve' });
    events.on('artifact-changed', (payload) => changed.push(payload));
    rooms = await createRooms({
      config,
      catalog,
      dataDir: join(dir, 'data'),
      assetsDir: assets,
      events,
      linkPresence: { online: () => false },
      frames: { types: nodeFrameTypes({ typesDir: TYPES_DIR, clientDir: client }), network: 'self' },
    });
    route = dispatchByHost({ rooms, app: (_req, res) => res.writeHead(404).end('app') });

    page = await catalog.createArtifact({ type: 'page', title: 'Poll', ownerUser: ada.id });
    other = await catalog.createArtifact({ type: 'page', title: 'Other', ownerUser: ada.id });
    for (const [artifact, text] of [[page, 'poll'], [other, 'secret']] as const) {
      const root = rooms.rootOf(artifact.id);
      await mkdir(root, { recursive: true });
      await writeFile(join(root, '.artifact.json'), JSON.stringify({ type: 'page', id: artifact.id, capabilities: { db: true, comments: true } }));
      await writeFile(join(root, 'index.html'), `<!doctype html><title>${artifact.title}</title><script src="app.js"></script>`);
      await writeFile(join(root, 'app.js'), `/* ${text} */`);
    }
    await catalog.upsertGrant({ artifactId: page.id, subjectKind: 'user', subject: bob.id, role: 'viewer', createdBy: ada.id });
    await catalog.upsertGrant({ artifactId: page.id, subjectKind: 'user', subject: cam.id, role: 'commenter', createdBy: ada.id });
    await catalog.upsertGrant({ artifactId: page.id, subjectKind: 'user', subject: eve.id, role: 'editor', createdBy: ada.id });
  });

  after(async () => {
    front.closeAllConnections();
    await new Promise<void>((done) => front.close(() => done()));
    await rooms.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('dispatches /page/<token>/ to the inner shell, with a CSP that frames page hosts only', async () => {
    assert.ok(rooms.frames, 'pages are on');
    const path = await shellPath(page, user(ada), 'owner');
    assert.match(path, /^\/page\/v1\./);
    const shell = await at(contentHost(page.id), path);
    assert.equal(shell.status, 200, shell.body);
    assert.match(shell.body, /inner shell/);
    assert.match(String(shell.headers['content-security-policy']), new RegExp(`frame-src[^;]*${pageHostSource(config).replace(/[.*]/g, '\\$&')}`));
    assert.equal(shell.headers['referrer-policy'], 'no-referrer');
    const bare = await at(contentHost(page.id), path.slice(0, -1));
    assert.equal(bare.status, 302, 'the address without its slash is sent to it');
  });

  it('gives each role its level; the session names the viewer\'s own page host, with no token in it', async () => {
    // [who, role, owner, edits, comments]
    const levels: Array<[UserRecord, ArtifactRole, boolean, boolean, boolean]> = [
      [ada, 'owner', true, true, true],
      [eve, 'editor', false, true, true],
      [cam, 'commenter', false, false, true],
      [bob, 'viewer', false, false, false],
    ];
    const hosts = new Set<string>();
    for (const [who, role, owner, edits, comments] of levels) {
      const session = await sessionOf(page, user(who), role);
      assert.equal(session.me.isOwner, owner, role);
      assert.equal(session.me.canEdit, edits, role);
      assert.equal(session.me.id, who.id);
      assert.equal(session.comments.available, comments, role);
      assert.deepEqual(session.outerOrigins, [config.appOrigin]);
      const host = new URL(session.contentOrigin as string).host;
      assert.deepEqual(pageHostOf(config, host)?.id, page.id);
      assert.equal(host.includes('v1.'), false);
      assert.equal(session.contentOrigin.includes((await rooms.pageFor(page, user(who), role)).token), false);
      hosts.add(host);
    }
    assert.equal(hosts.size, 4, 'one page host per principal');
  });

  it('serves the page on its page host, read only, with the network policy\'s CSP', async () => {
    const { host, ver } = await pageHostFor(page, user(bob), 'viewer');
    const index = await at(host, '/');
    assert.equal(index.status, 302);
    assert.equal(index.headers.location, `/_f/${ver}/`);
    const script = await at(host, `/_f/${ver}/app.js`);
    assert.equal(script.status, 200, script.body);
    assert.equal(script.body, '/* poll */');
    assert.equal(script.headers['content-security-policy'], installedTypeCsp([]));
  });

  it('a page host cannot reach the API, the inner shell or another artifact; a page token is no page host', async () => {
    const owner = await rooms.pageFor(page, user(ada), 'owner');
    const { host, ver } = await pageHostFor(page, user(ada), 'owner');
    for (const path of [`/page/${encodeURIComponent(owner.token)}/api/frame/session`, '/api/frame/session', `/page/${encodeURIComponent(owner.token)}/`]) {
      const answer = await at(host, path);
      assert.ok(answer.status >= 400, `${path} → ${answer.status}`);
      assert.equal(answer.body.includes('"grants"'), false);
    }
    // Its opaque part under the other artifact's id label: nobody's.
    const opaque = pageHostOf(config, host)!.opaque;
    const forged = `${pageHostLabel(other.id, opaque)}.content.localhost:${port}`;
    assert.equal((await at(forged, `/_f/${ver}/app.js`)).status, 403);
    // The opaque part as a page token on the content host: refused.
    assert.equal((await at(contentHost(page.id), `/page/${opaque}/api/frame/session`)).status, 403);
    // A snapshot token opens no page.
    const snap = await signPageToken(snapshotTokenClaims({ artifact: page.id, principal: user(ada), role: 'owner', grantsVersion: page.grantsVersion, epoch: await catalog.siteEpoch(), now: new Date() } as never), KEYS);
    assert.equal((await at(contentHost(page.id), `/page/${encodeURIComponent(snap)}/api/frame/session`)).status, 403);
  });

  it('a page host of someone whose access went reads nothing; TLS ask follows the same rule', async () => {
    const { host, ver } = await pageHostFor(page, user(cam), 'commenter');
    assert.equal(await rooms.frames!.pageHostAllowed(host), true);
    assert.equal(await rooms.frames!.pageHostAllowed(`${pageHostLabel(page.id, 'a'.repeat(24))}.content.localhost:${port}`), false);
    await catalog.removeGrant(page.id, 'user', cam.id);
    await rooms.refresh(page.id);
    assert.equal((await at(host, `/_f/${ver}/app.js`)).status, 403);
    assert.equal(await rooms.frames!.pageHostAllowed(host), false);
  });

  it('a new site epoch (everyone signed out) retires every page host', async () => {
    const { host, ver } = await pageHostFor(page, user(eve), 'editor');
    assert.equal((await at(host, `/_f/${ver}/app.js`)).status, 200);
    await catalog.bumpSiteEpoch();
    await rooms.refresh(page.id);
    assert.equal((await at(host, `/_f/${ver}/app.js`)).status, 403);
    const fresh = await pageHostFor(page, user(eve), 'editor');
    assert.notEqual(fresh.host, host);
    assert.equal((await at(fresh.host, `/_f/${fresh.ver}/app.js`)).status, 200);
  });

  it('runs the frame actions for the host (info, db), as the site MCP and the Link call them', async () => {
    const info = (await rooms.action(page.id, 'info', {})) as Record<string, unknown>;
    assert.ok(info && typeof info === 'object');
    await assert.rejects(rooms.action(page.id, 'nope', {}), /no action/);
  });

  it('capabilities set on the site reach the marker and the open pages; only a non-Link change is told to the Link', async () => {
    const services = pageServices(rooms as HostRooms & { frames: NonNullable<HostRooms['frames']> }, events, catalog);
    assert.deepEqual(await services.capabilities(page.id), { db: true, comments: true });
    await services.setCapabilities(page.id, { db: true, identity: true }, 'mcp');
    const marker = JSON.parse(await readFile(join(rooms.rootOf(page.id), '.artifact.json'), 'utf8')) as { type: string; capabilities: unknown };
    assert.equal(marker.type, 'page');
    assert.deepEqual(marker.capabilities, { db: true, identity: true });
    assert.deepEqual(changed.at(-1), { id: page.id, author: 'mcp', capabilities: { db: true, identity: true } });
    const told = changed.length;
    await services.setCapabilities(page.id, { db: true }, LINK_AUTHOR);
    assert.equal(changed.length, told, 'the Link\'s own change is not sent back to it');
    assert.equal((await sessionOf(page, user(ada), 'owner')).comments.available, false, 'the open core read the new declaration');
  });

  it('people() is the owner and the users with a live grant: an expired grant names nobody', async () => {
    const gone = await catalog.createUser({ name: 'Gil' });
    await catalog.upsertGrant({ artifactId: page.id, subjectKind: 'user', subject: gone.id, role: 'editor', createdBy: ada.id, expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const later = await catalog.createUser({ name: 'Liv' });
    await catalog.upsertGrant({ artifactId: page.id, subjectKind: 'user', subject: later.id, role: 'commenter', createdBy: ada.id, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    try {
      const people = await framePeople(catalog, (await catalog.getArtifact(page.id))!, new Date());
      const ids = people.map((p) => p.id);
      assert.equal(ids[0], ada.id, 'the owner first');
      assert.equal(people[0]!.level, 'owner');
      assert.ok(ids.includes(later.id), 'a grant still running');
      assert.equal(ids.includes(gone.id), false, 'an expired grant');
      assert.equal(people.find((p) => p.id === later.id)?.level, 'view');
    } finally {
      await catalog.removeGrant(page.id, 'user', gone.id);
      await catalog.removeGrant(page.id, 'user', later.id);
    }
  });

  it('ends a person\'s event connections when their role drops or goes; others stay open', async () => {
    const dan = await catalog.createUser({ name: 'Dan' });
    await catalog.upsertGrant({ artifactId: page.id, subjectKind: 'user', subject: dan.id, role: 'editor', createdBy: ada.id });
    await rooms.refresh(page.id);
    const open = async (who: UserRecord, role: ArtifactRole, c: string) => {
      const path = `${await shellPath((await catalog.getArtifact(page.id))!, user(who), role)}api/frame/events?c=${c}`;
      const events = stream(port, path, { host: contentHost(page.id) });
      await until(() => events.text().includes('"hello"'));
      return events;
    };
    const dans = await open(dan, 'editor', 'dan-client-1');
    const adas = await open(ada, 'owner', 'ada-client-1');
    let danEnded = false;
    void dans.ended.then(() => (danEnded = true));
    // Editor → viewer: a lower role, the connection ends (the page opens again with the new level).
    await catalog.upsertGrant({ artifactId: page.id, subjectKind: 'user', subject: dan.id, role: 'viewer', createdBy: ada.id });
    await rooms.refresh(page.id);
    await until(() => danEnded);
    // Back as a viewer, then gone: ends again.
    const again = await open(dan, 'viewer', 'dan-client-2');
    let againEnded = false;
    void again.ended.then(() => (againEnded = true));
    await catalog.removeGrant(page.id, 'user', dan.id);
    await rooms.refresh(page.id);
    await until(() => againEnded);
    // The owner's stays.
    let adaEnded = false;
    void adas.ended.then(() => (adaEnded = true));
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(adaEnded, false, 'the owner kept their connection');
    adas.close();
  });

  it('a comments.json the Link pushes reaches the open page as a comments event', async () => {
    const link = nodeLinkServices({ rooms, catalog, events, presence: createLinkPresence(), archive: (async () => { throw new Error('no export here'); }) as never, version: 'test' });
    try {
      const path = `${await shellPath((await catalog.getArtifact(page.id))!, user(eve), 'editor')}api/frame/events?c=eve-client-1`;
      const open = stream(port, path, { host: contentHost(page.id) });
      await until(() => open.text().includes('"hello"'));
      const comments = { version: 1, threads: [{ id: 'th_local', status: 'open', anchor: null, messages: [{ id: 'c1', text: 'From the computer', author: { name: 'Agent' }, at: new Date().toISOString() }] }] };
      await link.files.write(page.id, [{ path: 'comments.json', content: Buffer.from(JSON.stringify(comments)).toString('base64') }], LINK_AUTHOR);
      await until(() => /"t":"comments"/.test(open.text()));
      open.close();
    } finally {
      link.stop();
    }
  });

  it('a share-link guest whose page host the index lost gets a working page again by opening it again', async () => {
    await catalog.setGeneralAccess(page.id, 'link');
    const { link: shareLink } = await catalog.createLink(page.id, 'viewer');
    const { guest } = await catalog.joinGuest(shareLink.id, 'Vic');
    const vic: Principal = { kind: 'guest', id: guest.id, name: 'Vic', link: shareLink.id, artifact: page.id };
    const live = async (): Promise<ArtifactRow> => (await catalog.getArtifact(page.id))!;
    const { host, ver } = await pageHostFor(await live(), vic, 'viewer');
    assert.equal((await at(host, `/_f/${ver}/app.js`)).status, 200);
    // The index file is lost and the site restarts (a fresh engine reads the folder again).
    await rm(join(dir, 'data', 'page-hosts', `${page.id}.json`), { force: true });
    const fresh = await createRooms({ config, catalog, dataDir: join(dir, 'data'), assetsDir: assets, events, linkPresence: { online: () => false }, frames: { types: nodeFrameTypes({ typesDir: TYPES_DIR, clientDir: client }), network: 'self' } });
    const old = route;
    const oldRooms = rooms;
    route = dispatchByHost({ rooms: fresh, app: (_req, res) => res.writeHead(404).end('app') });
    rooms = fresh;
    try {
      // Owners and user grants are worked out again from the key; a guest is not (their page host names a link guest
      // the site would have to try one by one): it reads nothing until they open the page again.
      assert.equal((await at(host, `/_f/${ver}/app.js`)).status, 403);
      const reopened = await pageHostFor(await live(), vic, 'viewer');
      assert.equal(reopened.host, host, 'the same page host: it is made from the guest, not stored');
      assert.equal((await at(host, `/_f/${reopened.ver}/app.js`)).status, 200);
      // A user's is worked out without reopening.
      const owners = await pageHostFor(await live(), user(ada), 'owner');
      await rm(join(dir, 'data', 'page-hosts', `${page.id}.json`), { force: true });
      assert.equal((await at(owners.host, `/_f/${owners.ver}/app.js`)).status, 200);
    } finally {
      route = old;
      rooms = oldRooms;
      await fresh.stop();
      await catalog.removeGuest(guest.id);
      await catalog.setGeneralAccess(page.id, 'restricted');
    }
  });

  it('keeps the page hosts it made on disk; deleting the artifact for good drops them and the page host', async () => {
    const { host, ver } = await pageHostFor(other, user(ada), 'owner');
    const file = join(dir, 'data', 'page-hosts', `${other.id}.json`);
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, { kind: string; id: string }>;
    assert.deepEqual(saved[pageHostOf(config, host)!.opaque], { kind: 'user', id: ada.id });
    await removeArtifactFolder(rooms, other.id);
    await assert.rejects(readFile(file, 'utf8'), /ENOENT/);
    assert.equal((await at(host, `/_f/${ver}/app.js`)).status, 403);
  });
});

test('an archive is taken as a page by its .artifact.json only when the caller runs pages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-page-import-'));
  try {
    const src = join(dir, 'src');
    await mkdir(join(src, 'db', 'votes'), { recursive: true });
    await writeFile(join(src, '.artifact.json'), JSON.stringify({ type: 'page', id: 'art_x', capabilities: { db: true } }));
    await writeFile(join(src, 'index.html'), '<!doctype html><title>Poll</title>');
    await writeFile(join(src, 'db', 'votes', 'a.json'), '{"n":1}');
    const chunks: Buffer[] = [];
    await writeZip(await archiveEntries(src), async (chunk) => void chunks.push(Buffer.from(chunk)));
    const bytes = new Uint8Array(Buffer.concat(chunks));
    await assert.rejects(importArchive(bytes, join(dir, 'a')), /not an artifact/);
    const taken = await importArchive(bytes, join(dir, 'b'), { markerTypes: ['page'], id: 'art_y' });
    assert.equal(taken.type, 'page');
    const marker = JSON.parse(await readFile(join(dir, 'b', '.artifact.json'), 'utf8')) as { id: string; capabilities: unknown };
    assert.deepEqual(marker.capabilities, { db: true });
    await assert.rejects(importArchive(bytes, join(dir, 'c'), { markerTypes: ['other'] }), /not an artifact/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the site MCP lists the page type only where pages run', () => {
  assert.equal(readMcpTypes(TYPES_DIR).get('page'), null);
  const page = readMcpTypes(TYPES_DIR, { pages: true }).get('page');
  assert.equal(page?.store, 'db');
  assert.equal(page?.comments, true);
});

test('single-origin mode runs no pages: the hello does not offer them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-page-same-site-'));
  try {
    await mkdir(join(dir, 'assets', 'editors'), { recursive: true });
    const config = parseConfig({ OA_APP_ORIGIN: 'http://app.oa.localhost:4900', OA_CONTENT_ORIGIN: 'http://{id}.oa.localhost:4900', OA_CONTENT_SAME_SITE: 'true', OA_SIGNING_KEYS: 'k'.repeat(40), OA_OWNER_KEY: 'o'.repeat(30) });
    const env = parseNodeEnv({ OA_DATA_DIR: join(dir, 'data'), OA_PORT: '0', OA_BIND: '127.0.0.1', OA_ASSETS_DIR: join(dir, 'assets') });
    const host = await startHost({ config, env, uiDir: join(dir, 'ui'), log: () => undefined });
    try {
      assert.equal(host.rooms.frames, null);
      assert.equal(host.link.pages, undefined);
    } finally {
      await host.stop();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
