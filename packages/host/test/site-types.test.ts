/**
 * Types published to a site (D2b): the catalog's rules (`core/catalog/site-types.ts`), `OA_TYPES_PUBLISH`, reading a
 * package the way `types install` does and taking only page-kind types (`node/site-types.ts`), the `types.*` Link
 * routes on a real Node host, and an artifact of a published type: imported by its `.artifact.json` type and
 * `typeUid`, run on the frame engine under its manifest's CSP, reloaded on a new version, still opening once delisted.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { installedTypeCsp, LINK_API_PREFIX, type LinkHello, type LinkTypeImportResult, type LinkTypesResult, type LinkTypeUnpublishResult } from '@open-artifact/protocol';
import { rawZip } from '../../server-sdk/test/zip-builder.ts';
import { packageOf, UID } from './site-type-fixture.ts';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { mayDownloadSiteType, mayListSiteType, mayPublishTypes, SiteTypes, typesPublishRefusal, type SiteTypeCandidate } from '../src/core/catalog/site-types.ts';
import { ConfigError, parseConfig } from '../src/core/config.ts';
import type { UserRecord } from '../src/core/types.ts';
import { parseNodeEnv } from '../src/node/env.ts';
import { startHost, type RunningHost } from '../src/node/host.ts';
import { nodeSiteTypes } from '../src/node/site-types.ts';
import { openSqlite } from '../src/node/sqlite.ts';

const KEYS = ['t'.repeat(40)];
const TYPES_DIR = join(import.meta.dirname, '..', '..', '..', 'artifact-types');
const candidate = (o: Partial<SiteTypeCandidate> = {}): SiteTypeCandidate => ({ id: 'kit', uid: 'uid-a', name: 'Kit', version: '1.0.0', description: 'd', sha256: 'a'.repeat(64), bytes: 10, capabilities: [], network: [], ...o });

describe('OA_TYPES_PUBLISH', () => {
  const base = { OA_SIGNING_KEYS: 'k'.repeat(40) };
  it('is admins by default, off, admins or members, and off with one domain for both', () => {
    assert.equal(parseConfig(base).typesPublish, 'admins');
    assert.equal(parseConfig({ ...base, OA_TYPES_PUBLISH: 'members' }).typesPublish, 'members');
    assert.equal(parseConfig({ ...base, OA_TYPES_PUBLISH: 'OFF' }).typesPublish, 'off');
    assert.throws(() => parseConfig({ ...base, OA_TYPES_PUBLISH: 'everyone' }), (e: unknown) => e instanceof ConfigError && /OA_TYPES_PUBLISH/.test(e.message));
    const same = { ...base, OA_APP_ORIGIN: 'https://app.example.com', OA_CONTENT_ORIGIN: 'https://{id}.content.example.com', OA_CONTENT_SAME_SITE: 'true' };
    assert.equal(parseConfig(same).typesPublish, 'off');
    assert.equal(parseConfig({ ...same, OA_TYPES_PUBLISH: 'members' }).typesPublish, 'off');
  });

  it('says who may publish, and why not', () => {
    assert.equal(mayPublishTypes('admins', 'admin'), true);
    assert.equal(mayPublishTypes('admins', 'member'), false);
    assert.equal(mayPublishTypes('members', 'member'), true);
    assert.equal(mayPublishTypes('off', 'admin'), false);
    assert.match(typesPublishRefusal('admins', 'member')!, /Only the site admins/);
    assert.match(typesPublishRefusal('off', 'admin')!, /OA_TYPES_PUBLISH=off/);
    assert.match(typesPublishRefusal('off', 'admin', true)!, /OA_CONTENT_SAME_SITE/);
    assert.equal(typesPublishRefusal('members', 'member'), null);
  });
});

describe('the type catalog', () => {
  let types: SiteTypes;
  let catalog: Catalog;
  const ada = { id: 'u_ada', siteRole: 'member' as const };
  const bob = { id: 'u_bob', siteRole: 'member' as const };
  const root = { id: 'u_root', siteRole: 'admin' as const };

  before(async () => {
    catalog = await Catalog.open(openSqlite(':memory:'), { signingKeys: KEYS });
    types = new SiteTypes(catalog.driver);
  });

  it('refuses built-in, reserved and malformed ids, uids and versions', async () => {
    for (const id of ['slides', 'page', 'docs', 'new-type']) await assert.rejects(types.plan(candidate({ id }), ada), /built-in|reserved/, id);
    await assert.rejects(types.plan(candidate({ id: '../x' }), ada), /not a type id/);
    await assert.rejects(types.plan(candidate({ uid: '../../etc' }), ada), /uid/);
    await assert.rejects(types.plan(candidate({ version: '1.0/../../x' }), ada), /version/);
  });

  it('keeps one type per id and uid: a new version only by its publisher or an admin, never the same version twice', async () => {
    const first = await types.plan(candidate(), ada);
    assert.equal(first.change, 'new');
    const row = await types.save(candidate(), ada, first);
    assert.equal(row.visibility, 'private');
    assert.equal(row.publisherUser, ada.id);
    // Another uid under the id: refused, naming the uid that has it.
    await assert.rejects(types.plan(candidate({ uid: 'uid-b' }), bob), (e: Error & { code?: string }) => e.code === 'conflict' && /uid-a/.test(e.message));
    // The same uid by someone else: refused; by an admin: a new version.
    await assert.rejects(types.plan(candidate({ version: '1.1.0' }), bob), (e: Error & { code?: string }) => e.code === 'not_granted');
    const byAdmin = await types.plan(candidate({ version: '1.1.0', sha256: 'b'.repeat(64) }), root);
    assert.equal(byAdmin.change, 'version');
    // The same uid under another id: refused (a type keeps its id).
    await assert.rejects(types.plan(candidate({ id: 'kit-two' }), ada), /keeps its id/);
    // The same version with other bytes: raise the version; the same bytes: nothing changes.
    await assert.rejects(types.plan(candidate({ sha256: 'c'.repeat(64) }), ada), /Raise the version|already on this site/);
    assert.equal((await types.plan(candidate(), ada)).change, 'unchanged');
    const next = await types.save(candidate({ version: '2.0.0', sha256: 'd'.repeat(64) }), ada, await types.plan(candidate({ version: '2.0.0', sha256: 'd'.repeat(64) }), ada), 'site');
    assert.equal(next.version, '2.0.0');
    assert.equal(next.visibility, 'site');
    assert.equal(next.publisherUser, ada.id, 'the publisher stays');
    const kept = await types.save(candidate({ version: '2.0.1', sha256: 'e'.repeat(64) }), ada, await types.plan(candidate({ version: '2.0.1', sha256: 'e'.repeat(64) }), ada));
    assert.equal(kept.visibility, 'site', 'a new version keeps the visibility unless told');
  });

  it('lists and downloads by visibility; delisted types only to who manages them; counts artifacts, trashed too', async () => {
    const row = (await types.byId('kit'))!;
    assert.equal(mayListSiteType(row, bob), true, 'site: every member');
    const priv = { ...row, visibility: 'private' as const };
    assert.equal(mayListSiteType(priv, bob), false);
    assert.equal(mayListSiteType(priv, root), true);
    const link = { ...row, visibility: 'link' as const };
    assert.equal(mayListSiteType(link, bob), false);
    assert.equal(mayDownloadSiteType(link, bob), true, 'link: anyone naming it');
    const gone = { ...row, unpublished: true };
    assert.equal(mayListSiteType(gone, bob), false);
    assert.equal(mayDownloadSiteType(gone, bob), false);
    assert.equal(mayListSiteType(gone, ada), true);
    assert.equal(await types.artifactCount('kit'), 0);
    const a = await catalog.createArtifact({ type: 'kit', title: 'A', ownerUser: ada.id });
    await catalog.trashArtifact(a.id);
    assert.equal(await types.artifactCount('kit'), 1);
    await types.delist(row.uid);
    assert.equal((await types.get(row.uid))!.unpublished, true);
    const again = await types.plan(candidate({ version: '3.0.0', sha256: 'f'.repeat(64) }), ada);
    assert.equal((await types.save(candidate({ version: '3.0.0', sha256: 'f'.repeat(64) }), ada, again)).unpublished, false, 'publishing again lists it again');
    await types.remove(row.uid);
    assert.equal(await types.byId('kit'), undefined);
  });
});

describe('reading a package for a site', () => {
  let dir: string;
  let services: ReturnType<ReturnType<typeof nodeSiteTypes>['services']>;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-site-types-read-'));
    const catalog = await Catalog.open(openSqlite(':memory:'), { signingKeys: KEYS });
    services = nodeSiteTypes({ dataDir: dir, driver: catalog.driver }).services(() => undefined);
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it('takes a page-kind type: its id, uid, version, capabilities and network', async () => {
    const got = await services.read(packageOf({ network: ['https://api.example.com'] }));
    assert.equal(got.id, 'poll-kit');
    assert.equal(got.uid, UID);
    assert.equal(got.version, '1.0.0');
    assert.deepEqual(got.capabilities.sort(), ['comments', 'db']);
    assert.deepEqual(got.network, ['https://api.example.com']);
    assert.match(got.sha256, /^[0-9a-f]{64}$/);
  });

  it('refuses what install refuses, and what a site does not run', async () => {
    const top = 'poll-kit-1.0.0';
    const cases: Array<[string, Uint8Array, RegExp]> = [
      ['a path that climbs out', packageOf({ extra: [{ name: `${top}/../evil.txt`, data: 'x' }] }), /\.\.|outside|path/i],
      ['a symbolic link', packageOf({ extra: [{ name: `${top}/link`, data: '/etc/passwd', mode: 0o120777 }] }), /link|plain|regular/i],
      ['two top folders', packageOf({ extra: [{ name: 'other/x.txt', data: 'x' }] }), /top folder/i],
      ['a built-in id', packageOf({ id: 'slides' }), /built-in/],
      ['entry.start', packageOf({ manifest: { entry: { start: 'node server.js' } } }), /entry\.start/],
      ['a server of its own', packageOf({ manifest: { entry: 'index.html' } }), /entry/],
      ['a page type', packageOf({ manifest: { openArtifact: { style: 'page' } } }), /page type/],
      ['no declaration', packageOf({ html: '<!doctype html><p>no declaration</p>' }), /declaration/],
      ['no index.html', packageOf({ html: null }), /declaration|index\.html/],
      ['a declaration that runs code', packageOf({ html: '<script>\n// artifact.json\nvar key = "poll";\nvar capabilities = { db: fetch("/x") };\n// end\n</script>' }), /literal/],
      ['network that is not https', packageOf({ network: ['http://api.example.com'] }), /https/],
    ];
    for (const [what, bytes, pattern] of cases) await assert.rejects(services.read(bytes), pattern, what);
  });

  it('refuses, when keeping it, a file that unpacks past the size it declared, and keeps nothing', async () => {
    const bytes = packageOf({ extra: [{ name: 'poll-kit-1.0.0/big.txt', data: 'x'.repeat(100), declaredSize: 5 }] });
    const read = await services.read(bytes);
    await assert.rejects(services.store(read, bytes), /size|declared|more|bad|zip/i);
    assert.deepEqual(await readdir(join(dir, 'types', UID)).catch(() => []), []);
  });
});

// ---- on a real host ---------------------------------------------------------------------------------------------

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

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

/** An artifact archive of a published type: `.artifact.json` naming it (and its uid), and its data. */
function artifactArchive(o: { type?: string; typeUid?: string | null; title?: string } = {}): Uint8Array {
  const marker = { type: o.type ?? 'poll-kit', id: 'art_placeholder00', ...(o.typeUid === null ? {} : { typeUid: o.typeUid ?? UID, typeSource: 'local' }) };
  return new Uint8Array(rawZip([{ name: 'poll/.artifact.json', data: JSON.stringify(marker) }, { name: 'poll/poll.json', data: JSON.stringify({ title: o.title ?? 'Lunch poll' }) }]));
}

describe('types on a Node site', () => {
  let dir: string;
  let host: RunningHost;
  let port: number;
  let admin: UserRecord;
  let member: UserRecord;
  const tokens: Record<string, string> = {};

  const link = (name: string, init: RequestInit & { as: string; query?: string } ): Promise<Response> =>
    fetch(`${host.listening.replace('127.0.0.1', 'localhost')}${LINK_API_PREFIX}${name}${init.query ?? ''}`, { ...init, headers: { authorization: `Bearer ${tokens[init.as]}`, ...(init.headers as Record<string, string>) } });
  const publish = (as: string, bytes: Uint8Array, query = ''): Promise<Response> => link('types.import', { as, query, method: 'POST', headers: { 'content-type': 'application/zip' }, body: bytes as Uint8Array<ArrayBuffer> });
  const importArtifact = (as: string, id: string, bytes: Uint8Array): Promise<Response> => link('import', { as, query: `?id=${id}`, method: 'POST', headers: { 'content-type': 'application/zip' }, body: bytes as Uint8Array<ArrayBuffer> });
  const contentHost = (id: string): string => `${id.replace('_', '-')}.content.localhost:${port}`;
  const sessionOf = async (id: string, who: UserRecord): Promise<{ path: string; session: Record<string, any> }> => {
    const artifact = (await host.catalog.getArtifact(id))!;
    const opened = await host.rooms.pageFor(artifact, { kind: 'user', id: who.id, name: who.name, siteRole: who.siteRole }, who.id === artifact.ownerUser ? 'owner' : 'viewer');
    const path = new URL(opened.pageUrl).pathname;
    const answer = await call(port, `${path}api/frame/session`, { host: contentHost(id) });
    assert.equal(answer.status, 200, answer.body);
    return { path, session: JSON.parse(answer.body) as Record<string, any> };
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-site-types-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    const client = join(dir, 'client');
    await mkdir(client, { recursive: true });
    for (const name of ['runtime.js', 'imports.js', 'shell.js', 'comments.js', 'shell.css', 'comments.css']) await writeFile(join(client, name), `/* ${name} */`);
    await writeFile(join(client, 'shell.html'), '<!doctype html><title>inner shell</title>');
    const uiDir = join(dir, 'ui');
    await mkdir(join(uiDir, 'shell'), { recursive: true });
    await mkdir(join(uiDir, 'home'), { recursive: true });
    port = await freePort();
    const config = parseConfig({ OA_APP_ORIGIN: `http://localhost:${port}`, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`, OA_SIGNING_KEYS: KEYS[0]!, OA_OWNER_KEY: 'o'.repeat(30) });
    const env = { ...parseNodeEnv({ OA_DATA_DIR: join(dir, 'data'), OA_PORT: String(port), OA_BIND: '127.0.0.1' }), assetsDir: assets };
    host = await startHost({ config, env, uiDir, log: () => undefined, pages: { typesDir: TYPES_DIR, clientDir: client } });
    admin = await host.catalog.createUser({ name: 'Root', email: 'root@example.com', emailVerified: true, siteRole: 'admin' });
    member = await host.catalog.createUser({ name: 'Mia', email: 'mia@example.com', emailVerified: true });
    for (const [name, user] of [['admin', admin], ['member', member]] as const) {
      tokens[name] = (await host.catalog.issueAgentToken({ userId: user.id, label: 'test', scopes: ['link'], accessTtlMs: 3600_000 })).accessToken;
    }
    tokens.mcp = (await host.catalog.issueAgentToken({ userId: admin.id, label: 'not link', scopes: ['mcp'], accessTtlMs: 3600_000 })).accessToken;
  });

  after(async () => {
    await host.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('says it keeps types in hello, and who may publish', async () => {
    const hello = (await (await link('hello', { as: 'member' })).json()) as LinkHello;
    assert.deepEqual(hello.features, { pages: 1, types: 1 });
    assert.equal(hello.typesPublish, 'admins');
  });

  it('takes a package from an admin only (OA_TYPES_PUBLISH=admins), and only with a Link token', async () => {
    const refused = await publish('member', packageOf());
    assert.equal(refused.status, 403);
    assert.match(((await refused.json()) as { message: string }).message, /Only the site admins/);
    assert.equal((await publish('mcp', packageOf())).status, 403, 'a token without the link scope');
    const made = await publish('admin', packageOf());
    assert.equal(made.status, 201, await made.clone().text());
    const result = (await made.json()) as LinkTypeImportResult;
    assert.equal(result.change, 'new');
    assert.equal(result.type.visibility, 'private');
    assert.equal(result.type.mine, true);
    assert.deepEqual(await readdir(join(dir, 'data', 'types', UID, '1.0.0')), ['files', 'package.oatype']);
    const again = await publish('admin', packageOf());
    assert.equal(((await again.json()) as LinkTypeImportResult).change, 'unchanged');
    const other = await publish('admin', packageOf({ uid: 'another-uid' }));
    assert.equal(other.status, 409);
    assert.match(((await other.json()) as { message: string }).message, new RegExp(UID));
  });

  it('lists and hands out the package by visibility, with the third-party notice', async () => {
    const mine = (await (await link('types.list', { as: 'admin' })).json()) as LinkTypesResult & { notice: string };
    assert.deepEqual(mine.types.map((t) => t.id), ['poll-kit']);
    assert.match(mine.notice, /publisher/);
    assert.deepEqual(((await (await link('types.list', { as: 'member' })).json()) as LinkTypesResult).types, [], 'private: not to a member');
    assert.equal((await link('types.archive', { as: 'member', query: '?id=poll-kit' })).status, 404);
    assert.equal((await publish('admin', packageOf(), '?visibility=link')).status, 200);
    const pkg = await link('types.archive', { as: 'member', query: '?id=poll-kit' });
    assert.equal(pkg.status, 200);
    assert.match(String(pkg.headers.get('content-disposition')), /poll-kit-1\.0\.0\.oatype/);
    assert.deepEqual(new Uint8Array(await pkg.arrayBuffer()), packageOf());
  });

  let art: string;
  it('imports an artifact of it by type and typeUid; another uid is type_mismatch, an unknown type type_missing', async () => {
    art = 'art_sitetypepoll0001';
    const made = await importArtifact('member', art, artifactArchive());
    assert.equal(made.status, 201, await made.clone().text());
    const row = (await host.catalog.getArtifact(art))!;
    assert.equal(row.type, 'poll-kit');
    assert.equal(row.title, 'Lunch poll', 'the title its type\'s titleFrom names');
    const mismatch = await importArtifact('member', 'art_sitetypepoll0002', artifactArchive({ typeUid: 'someone-else' }));
    assert.equal(((await mismatch.json()) as { code: string }).code, 'type_mismatch');
    const missing = await importArtifact('member', 'art_sitetypepoll0003', artifactArchive({ type: 'quiz-kit', typeUid: 'uid-q' }));
    const body = (await missing.json()) as { code: string; message: string; fix: string };
    assert.equal(body.code, 'type_missing');
    assert.match(body.message, /quiz-kit.*uid-q/);
    assert.match(body.fix, /types publish quiz-kit/);
    assert.equal(await host.catalog.getArtifact('art_sitetypepoll0002'), undefined);
  });

  it('runs it on the frame engine under /page/, restricted, its CSP from the manifest; the address holds no type id', async () => {
    const { path, session } = await sessionOf(art, member);
    assert.match(path, /^\/page\/v1\./);
    assert.equal(session.me.isOwner, true);
    const pageHost = new URL(session.contentOrigin as string).host;
    const index = await call(port, `/_f/${session.ver}/`, { host: pageHost });
    assert.equal(index.status, 200, index.body);
    assert.match(index.body, /v1\.0\.0/);
    assert.equal(index.headers['content-security-policy'], installedTypeCsp([]));
    const css = await call(port, `/_f/${session.ver}/artifact-type/poll.css`, { host: pageHost });
    assert.equal(css.body, '/* 1.0.0 */');
    assert.equal(host.link.pages && (await host.link.pages.capabilities(art)), null, 'its capabilities are its type\'s, not the artifact\'s');
  });

  it('a new version reaches the open artifact (new files, new CSP), and the old version\'s files go', async () => {
    const next = await publish('admin', packageOf({ version: '1.1.0', network: ['https://api.example.com'] }));
    const result = (await next.json()) as LinkTypeImportResult;
    assert.equal(result.change, 'version');
    assert.equal(result.previous, '1.0.0');
    assert.equal(result.type.visibility, 'link', 'kept');
    const { session } = await sessionOf(art, member);
    const pageHost = new URL(session.contentOrigin as string).host;
    const index = await call(port, `/_f/${session.ver}/`, { host: pageHost });
    assert.match(index.body, /v1\.1\.0/);
    assert.equal(index.headers['content-security-policy'], installedTypeCsp(['https://api.example.com']));
    assert.deepEqual(await readdir(join(dir, 'data', 'types', UID)), ['1.1.0']);
  });

  it('unpublishing a type in use only delists it: its artifacts still open, no new one is taken; unused, it goes', async () => {
    assert.equal((await link('types.unpublish', { as: 'member', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'poll-kit' }) })).status, 404, 'not listed to the member');
    const out = (await (await link('types.unpublish', { as: 'admin', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'poll-kit' }) })).json()) as LinkTypeUnpublishResult;
    assert.deepEqual(out, { id: 'poll-kit', uid: UID, removed: false, artifacts: 1 });
    await sessionOf(art, member);
    const refused = await importArtifact('member', 'art_sitetypepoll0004', artifactArchive());
    assert.match(((await refused.json()) as { message: string }).message, /unpublished/);
    assert.equal((await link('types.archive', { as: 'member', query: '?id=poll-kit' })).status, 404);
    // Nothing left of it: removed, files and all.
    await host.catalog.deleteArtifact(art);
    const gone = (await (await link('types.unpublish', { as: 'admin', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'poll-kit' }) })).json()) as LinkTypeUnpublishResult;
    assert.equal(gone.removed, true);
    assert.deepEqual(await readdir(join(dir, 'data', 'types')), []);
  });
});
