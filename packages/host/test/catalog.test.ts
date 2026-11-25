import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OpenArtifactError } from '@open-artifact/protocol';
import { Catalog, newArtifactId, normalizeUserCode } from '../src/core/catalog/catalog.ts';
import { MIGRATIONS, migrate } from '../src/core/catalog/schema.ts';
import { sha256Hex } from '../src/core/crypto.ts';
import { openSqlite, type SqliteDriver } from '../src/node/sqlite.ts';

const KEYS = ['k'.repeat(32)];
let dir: string;
let driver: SqliteDriver;
let catalog: Catalog;
let clock = new Date('2026-01-01T00:00:00.000Z');
const advance = (ms: number): void => {
  clock = new Date(clock.getTime() + ms);
};
const HOUR = 3600_000;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-catalog-'));
  driver = openSqlite(join(dir, 'catalog.db'));
  catalog = await Catalog.open(driver, { signingKeys: KEYS, now: () => clock });
});

after(async () => {
  driver.close();
  await rm(dir, { recursive: true, force: true });
});

async function owner(name = 'Owner'): Promise<string> {
  return (await catalog.createUser({ name, email: `${name.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.com`, emailVerified: true })).id;
}

test('migrations are idempotent and recorded', async () => {
  assert.deepEqual(await migrate(driver), []);
  assert.deepEqual(await migrate(driver), []);
  const rows = await driver.all<{ version: number }>('SELECT version FROM schema_migrations');
  assert.deepEqual(rows.map((r) => r.version), MIGRATIONS.map((m) => m.version));
  const mode = await driver.get<{ journal_mode: string }>('PRAGMA journal_mode');
  assert.equal(mode?.journal_mode, 'wal');
});

test('a failing batch rolls back every statement', async () => {
  await assert.rejects(driver.batch([{ sql: "INSERT INTO site (key, value) VALUES ('rb', '1')" }, { sql: 'INSERT INTO no_such_table VALUES (1)' }]));
  assert.equal(await catalog.getSite('rb'), undefined);
});

test('users: create, find, list, update, site role, disable', async () => {
  const ada = await catalog.createUser({ name: 'Ada', email: 'Ada@Example.com', emailVerified: true });
  assert.match(ada.id, /^usr_/);
  assert.equal(ada.email, 'ada@example.com');
  assert.equal(ada.siteRole, 'member');
  assert.deepEqual(await catalog.getUser(ada.id), ada);
  assert.equal((await catalog.findUserByEmail('ADA@example.com'))?.id, ada.id);
  assert.ok((await catalog.listUsers()).some((u) => u.id === ada.id));
  assert.equal((await catalog.updateUser(ada.id, { name: 'Ada L.', avatar: 'https://x/a.png' }))?.name, 'Ada L.');
  assert.equal(await catalog.setSiteRole(ada.id, 'admin'), true);
  assert.equal((await catalog.getUser(ada.id))?.siteRole, 'admin');
  await assert.rejects(catalog.createUser({ name: 'Dup', email: 'ada@example.com' }), 'emails are unique');

  const { token } = await catalog.createSession({ userId: ada.id, ttlMs: HOUR });
  const agent = await catalog.issueAgentToken({ userId: ada.id, label: 'CC', scopes: ['artifacts'], accessTtlMs: HOUR });
  await catalog.disableUser(ada.id);
  assert.ok((await catalog.getUser(ada.id))?.disabledAt);
  assert.equal(await catalog.findSession(token), undefined);
  assert.equal(await catalog.findAgentTokenByAccess(agent.accessToken), undefined);
});

test('identities link and find', async () => {
  const id = await owner('Ident');
  const linked = await catalog.linkIdentity('oidc:google', 'sub-1', id);
  assert.deepEqual(linked, { provider: 'oidc:google', subject: 'sub-1', userId: id, createdAt: clock.toISOString() });
  assert.deepEqual(await catalog.findIdentity('oidc:google', 'sub-1'), linked);
  assert.equal(await catalog.findIdentity('github', 'sub-1'), undefined);
  assert.equal((await catalog.listIdentities(id)).length, 1);
});

test('sessions: create, find valid, touch, expire, revoke', async () => {
  const id = await owner('Sess');
  const { token, session } = await catalog.createSession({ userId: id, ttlMs: HOUR, userAgent: 'test' });
  assert.equal(session.idHash, await sha256Hex(token));
  assert.equal((await catalog.findSession(token))?.userId, id);
  assert.equal(await catalog.findSession('wrong'), undefined);
  advance(HOUR / 2);
  await catalog.touchSession(session.idHash, HOUR);
  advance(HOUR * 0.9);
  assert.ok(await catalog.findSession(token), 'rolling expiry kept it alive');
  advance(HOUR);
  assert.equal(await catalog.findSession(token), undefined, 'expired');
  assert.equal(await catalog.purgeExpiredSessions() >= 1, true);

  const a = await catalog.createSession({ userId: id, ttlMs: HOUR });
  const b = await catalog.createSession({ userId: id, ttlMs: HOUR });
  assert.equal((await catalog.listSessions(id)).length, 2);
  assert.equal(await catalog.revokeSession(a.session.idHash), true);
  assert.equal(await catalog.findSession(a.token), undefined);
  assert.ok(await catalog.findSession(b.token));
  assert.equal(await catalog.revokeUserSessions(id), 1);
  assert.equal(await catalog.findSession(b.token), undefined);
});

test('artifacts: create, get, list owned and shared, touch, trash and restore, access, settings', async () => {
  const me = await owner('Me');
  const other = await owner('Other');
  const mine = await catalog.createArtifact({ type: 'design', title: 'Mine', ownerUser: me });
  assert.match(mine.id, /^art_[0-9a-z]{25}$/);
  assert.equal(mine.generalAccess, 'restricted');
  assert.equal(mine.grantsVersion, 1);
  assert.deepEqual(mine.settings, { viewersCanExport: true, editorsCanAskAgent: false });
  await assert.rejects(catalog.createArtifact({ id: 'bad', type: 'design', title: 'x', ownerUser: me }), (e: unknown) => e instanceof OpenArtifactError && e.code === 'invalid_argument');

  const theirs = await catalog.createArtifact({ type: 'slides', title: 'Theirs', ownerUser: other });
  const hidden = await catalog.createArtifact({ type: 'slides', title: 'Hidden', ownerUser: other });
  const viaDomain = await catalog.createArtifact({ type: 'docs', title: 'Domain', ownerUser: other });
  await catalog.upsertGrant({ artifactId: theirs.id, subjectKind: 'user', subject: me, role: 'editor', createdBy: other });
  await catalog.upsertGrant({ artifactId: viaDomain.id, subjectKind: 'domain', subject: 'Example.com', role: 'viewer', createdBy: other });
  const meUser = (await catalog.getUser(me))!;

  advance(1000);
  await catalog.touchArtifact(theirs.id, { title: 'Theirs, renamed' });
  const listed = await catalog.listArtifactsFor({ id: me, email: meUser.email, emailVerified: true });
  assert.deepEqual(listed.map((a) => a.title).sort(), ['Domain', 'Mine', 'Theirs, renamed'], 'owned, user grant, domain grant');
  assert.ok(!listed.some((a) => a.id === hidden.id));
  assert.equal(listed[0]!.id, theirs.id, 'most recently updated first');
  const unverified = await catalog.listArtifactsFor({ id: me, email: meUser.email, emailVerified: false });
  assert.ok(!unverified.some((a) => a.id === viaDomain.id), 'domain needs a verified email');

  assert.equal(await catalog.trashArtifact(mine.id), true);
  assert.equal(await catalog.trashArtifact(mine.id), false, 'already trashed');
  assert.ok(!(await catalog.listArtifactsFor({ id: me })).some((a) => a.id === mine.id));
  assert.deepEqual((await catalog.listArtifactsFor({ id: me }, { trashed: true })).map((a) => a.id), [mine.id]);
  assert.equal(await catalog.restoreArtifact(mine.id), true);
  assert.equal((await catalog.getArtifact(mine.id))?.trashedAt, null);

  assert.equal((await catalog.setGeneralAccess(mine.id, 'public'))?.generalAccess, 'public');
  assert.deepEqual((await catalog.setArtifactSettings(mine.id, { editorsCanAskAgent: true }))?.settings, { viewersCanExport: true, editorsCanAskAgent: true });
  assert.equal(await catalog.setArtifactOwner(mine.id, other), true);
  assert.equal((await catalog.getArtifact(mine.id))?.ownerUser, other);

  await catalog.deleteArtifact(hidden.id);
  assert.equal(await catalog.getArtifact(hidden.id), undefined);
});

test('grants_version rises with every change to who may access, and only then', async () => {
  const me = await owner('Ver');
  const art = await catalog.createArtifact({ type: 'design', title: 'V', ownerUser: me });
  const version = async (): Promise<number> => (await catalog.getArtifact(art.id))!.grantsVersion;
  let v = await version();
  const expectBump = async (what: string, fn: () => Promise<unknown>): Promise<void> => {
    await fn();
    const next = await version();
    assert.equal(next, v + 1, what);
    v = next;
  };
  const expectSame = async (what: string, fn: () => Promise<unknown>): Promise<void> => {
    await fn();
    assert.equal(await version(), v, what);
  };
  await expectBump('upsert grant', () => catalog.upsertGrant({ artifactId: art.id, subjectKind: 'email', subject: 'X@Y.com', role: 'viewer', createdBy: me }));
  await expectBump('change grant', () => catalog.upsertGrant({ artifactId: art.id, subjectKind: 'email', subject: 'x@y.com', role: 'editor', createdBy: me }));
  assert.deepEqual((await catalog.listGrants(art.id)).map((g) => [g.subject, g.role]), [['x@y.com', 'editor']]);
  await expectBump('remove grant', () => catalog.removeGrant(art.id, 'email', 'X@y.com'));
  assert.deepEqual(await catalog.listGrants(art.id), []);
  await expectBump('general access', () => catalog.setGeneralAccess(art.id, 'link'));
  const { link } = await (async () => {
    let out!: Awaited<ReturnType<Catalog['createLink']>>;
    await expectBump('create link', async () => (out = await catalog.createLink(art.id, 'editor')));
    return out;
  })();
  await expectBump('disable link', () => catalog.setLinkEnabled(link.id, false));
  await expectBump('reset link', () => catalog.resetLink(link.id));
  const { guest } = await catalog.joinGuest(link.id, 'G');
  assert.equal(await version(), v, 'joining does not change who may access');
  await expectBump('guest role', () => catalog.setGuestRole(guest.id, 'viewer'));
  await expectBump('remove guest', () => catalog.removeGuest(guest.id));
  await expectBump('trash', () => catalog.trashArtifact(art.id));
  await expectBump('restore', () => catalog.restoreArtifact(art.id));
  await expectBump('owner', () => catalog.setArtifactOwner(art.id, me));
  await expectBump('explicit bump', () => catalog.bumpGrantsVersion(art.id));
  await expectSame('settings', () => catalog.setArtifactSettings(art.id, { viewersCanExport: false }));
  await expectSame('touch', () => catalog.touchArtifact(art.id, { title: 'New' }));
});

test('grants matching a user, expiry respected', async () => {
  const me = (await catalog.createUser({ name: 'Match', email: 'match@team.org', emailVerified: true })).id;
  const other = await owner('Granter');
  const a = await catalog.createArtifact({ type: 'design', title: 'A', ownerUser: other });
  const b = await catalog.createArtifact({ type: 'design', title: 'B', ownerUser: other });
  const c = await catalog.createArtifact({ type: 'design', title: 'C', ownerUser: other });
  await catalog.upsertGrant({ artifactId: a.id, subjectKind: 'group', subject: 'oidc:okta:design', role: 'commenter', createdBy: other });
  await catalog.upsertGrant({ artifactId: b.id, subjectKind: 'email', subject: 'match@team.org', role: 'viewer', createdBy: other, expiresAt: new Date(clock.getTime() + HOUR).toISOString() });
  await catalog.upsertGrant({ artifactId: c.id, subjectKind: 'domain', subject: 'team.org', role: 'viewer', createdBy: other });
  const who = { id: me, email: 'match@team.org', emailVerified: true, groups: ['oidc:okta:design'] };
  assert.deepEqual((await catalog.grantsMatching(who)).map((g) => g.artifactId).sort(), [a.id, b.id, c.id].sort());
  advance(2 * HOUR);
  assert.deepEqual((await catalog.grantsMatching(who)).map((g) => g.artifactId).sort(), [a.id, c.id].sort(), 'the expired email grant is gone');
  assert.deepEqual((await catalog.grantsMatching({ id: me })).map((g) => g.artifactId), []);
});

test('links: one per role, token once, find by token, enable, reset drops guests, read back the token', async () => {
  const me = await owner('Links');
  const art = await catalog.createArtifact({ type: 'design', title: 'L', ownerUser: me });
  const { link, token } = await catalog.createLink(art.id, 'commenter');
  assert.match(link.id, /^lnk_/);
  assert.equal(link.enabled, true);
  await assert.rejects(catalog.createLink(art.id, 'commenter'), (e: unknown) => e instanceof OpenArtifactError && e.code === 'conflict');
  assert.equal((await catalog.findLinkByToken(token))?.id, link.id);
  assert.equal(await catalog.findLinkByToken('nope'), undefined);
  assert.equal(await catalog.linkToken(link.id), token);
  assert.equal((await catalog.setLinkEnabled(link.id, false))?.enabled, false);
  assert.equal((await catalog.findLinkByToken(token))?.enabled, false, 'found even when off (the caller decides)');

  const { guest, secret } = await catalog.joinGuest(link.id, 'Guest');
  assert.equal((await catalog.findGuestBySecret(secret))?.id, guest.id);
  const reset = await catalog.resetLink(link.id);
  assert.ok(reset);
  assert.notEqual(reset.token, token);
  assert.equal(reset.link.id, link.id, 'same link, new token');
  assert.equal(await catalog.findLinkByToken(token), undefined, 'old token dead');
  assert.equal((await catalog.findLinkByToken(reset.token))?.id, link.id);
  assert.equal(await catalog.linkToken(link.id), reset.token);
  assert.equal(await catalog.findGuestBySecret(secret), undefined, 'guests of the old token are gone');
  assert.deepEqual(await catalog.listGuests(art.id), []);

  // A rotated key list still reads the token; a foreign one does not.
  assert.equal(await new Catalog(driver, { signingKeys: ['n'.repeat(32), ...KEYS] }).linkToken(link.id), reset.token);
  assert.equal(await new Catalog(driver, { signingKeys: ['n'.repeat(32)] }).linkToken(link.id), null);
  assert.equal((await catalog.listLinks(art.id)).length, 1);
});

test('guests: join, find, seen, set role moves links, remove', async () => {
  const me = await owner('Guests');
  const art = await catalog.createArtifact({ type: 'design', title: 'G', ownerUser: me });
  const editor = await catalog.createLink(art.id, 'editor');
  await assert.rejects(catalog.joinGuest('lnk_missing', 'x'), (e: unknown) => e instanceof OpenArtifactError && e.code === 'not_found');
  const { guest, secret } = await catalog.joinGuest(editor.link.id, 'Bo');
  assert.equal(guest.artifactId, art.id);
  assert.equal(guest.seenAt, null);
  await catalog.seeGuest(guest.id);
  assert.equal((await catalog.getGuest(guest.id))?.seenAt, clock.toISOString());

  const moved = await catalog.setGuestRole(guest.id, 'viewer');
  const viewerLink = (await catalog.listLinks(art.id)).find((l) => l.role === 'viewer');
  assert.ok(viewerLink, 'the viewer link was created');
  assert.equal(viewerLink.enabled, false, 'created off');
  assert.equal(moved?.linkId, viewerLink.id);
  assert.equal((await catalog.findGuestBySecret(secret))?.linkId, viewerLink.id, 'the secret still works');
  assert.equal((await catalog.setGuestRole(guest.id, 'editor'))?.linkId, editor.link.id, 'back to the existing editor link');
  assert.equal(await catalog.removeGuest(guest.id), true);
  assert.equal(await catalog.removeGuest(guest.id), false);
  assert.equal(await catalog.findGuestBySecret(secret), undefined);
});

test('agent tokens: issue, find, expire, rotate once, revoke, list', async () => {
  const me = await owner('Agent');
  const issued = await catalog.issueAgentToken({ userId: me, label: 'Claude Code', harness: 'claude-code', scopes: ['artifacts', 'link'], accessTtlMs: HOUR });
  assert.match(issued.accessToken, /^oa_at_/);
  assert.match(issued.refreshToken, /^oa_rt_/);
  assert.deepEqual(issued.token.scopes, ['artifacts', 'link']);
  assert.equal((await catalog.findAgentTokenByAccess(issued.accessToken))?.id, issued.token.id);
  assert.equal(await catalog.findAgentTokenByAccess(issued.refreshToken), undefined);
  assert.equal((await catalog.findAgentTokenByRefresh(issued.refreshToken))?.id, issued.token.id);
  await catalog.markAgentTokenUsed(issued.token.id);
  assert.equal((await catalog.getAgentToken(issued.token.id))?.usedAt, clock.toISOString());

  advance(2 * HOUR);
  assert.equal(await catalog.findAgentTokenByAccess(issued.accessToken), undefined, 'access expired');
  const rotated = await catalog.rotateAgentToken(issued.refreshToken, HOUR);
  assert.ok(rotated);
  assert.equal(rotated.token.id, issued.token.id);
  assert.equal((await catalog.findAgentTokenByAccess(rotated.accessToken))?.id, issued.token.id);
  assert.equal(await catalog.rotateAgentToken(issued.refreshToken, HOUR), undefined, 'a refresh token works once');
  assert.equal(await catalog.findAgentTokenByRefresh(issued.refreshToken), undefined);

  assert.equal(await catalog.revokeAgentToken(issued.token.id), true);
  assert.equal(await catalog.findAgentTokenByAccess(rotated.accessToken), undefined);
  assert.equal(await catalog.rotateAgentToken(rotated.refreshToken, HOUR), undefined);
  const list = await catalog.listAgentTokens(me);
  assert.equal(list.length, 1);
  assert.ok(list[0]!.revokedAt);
});

test('device codes: create, find, poll, approve, consume once, deny, expire', async () => {
  const me = await owner('Device');
  const started = await catalog.createDeviceCode({ client: { name: 'open-artifact', version: '0.12.3' }, ttlMs: 10 * 60_000, interval: 5 });
  assert.match(started.userCode, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  assert.equal(started.record.status, 'pending');
  assert.equal(normalizeUserCode(started.userCode.toLowerCase().replace('-', ' ')), started.userCode);
  assert.equal(normalizeUserCode('AAAA-AAAA'), null);
  assert.equal((await catalog.findDeviceCodeByUserCode(started.userCode.toLowerCase()))?.deviceCodeHash, started.record.deviceCodeHash);
  assert.equal((await catalog.findDeviceCodeByDeviceCode(started.deviceCode))?.userCode, started.userCode);

  assert.equal((await catalog.recordDevicePoll(started.deviceCode))?.lastPolledAt, null);
  assert.equal((await catalog.recordDevicePoll(started.deviceCode))?.lastPolledAt, clock.toISOString());
  assert.equal(await catalog.consumeDeviceCode(started.deviceCode), undefined, 'not approved yet');
  assert.equal(await catalog.approveDeviceCode(started.userCode, me), true);
  assert.equal(await catalog.denyDeviceCode(started.userCode), false, 'already decided');
  const consumed = await catalog.consumeDeviceCode(started.deviceCode);
  assert.equal(consumed?.status, 'consumed');
  assert.equal(consumed?.userId, me);
  assert.equal(await catalog.consumeDeviceCode(started.deviceCode), undefined, 'once');

  const denied = await catalog.createDeviceCode({ client: { name: 'x' }, ttlMs: 60_000, interval: 5 });
  assert.equal(await catalog.denyDeviceCode(denied.userCode), true);
  assert.equal((await catalog.findDeviceCodeByDeviceCode(denied.deviceCode))?.status, 'denied');

  const late = await catalog.createDeviceCode({ client: { name: 'x' }, ttlMs: 60_000, interval: 5 });
  advance(2 * 60_000);
  assert.equal(await catalog.approveDeviceCode(late.userCode, me), false, 'expired');
  assert.equal(await catalog.findDeviceCodeByUserCode(late.userCode), undefined);
  assert.ok((await catalog.expireDeviceCodes()) >= 2);
  assert.equal(await catalog.findDeviceCodeByDeviceCode(late.deviceCode), undefined);
});

test('OAuth clients and codes: create, find, consume once, expiry', async () => {
  const me = await owner('OAuth');
  const client = await catalog.createOAuthClient({ name: 'claude.ai', redirectUris: ['https://claude.ai/cb'], metadataUrl: 'https://claude.ai/meta.json' });
  assert.deepEqual(await catalog.getOAuthClient(client.id), client);
  assert.deepEqual(client.redirectUris, ['https://claude.ai/cb']);
  const { code, record } = await catalog.createOAuthCode({ clientId: client.id, userId: me, redirectUri: 'https://claude.ai/cb', codeChallenge: 'abc', scopes: ['mcp'], ttlMs: 60_000 });
  assert.equal(record.usedAt, null);
  const used = await catalog.consumeOAuthCode(code);
  assert.equal(used?.userId, me);
  assert.deepEqual(used?.scopes, ['mcp']);
  assert.equal(await catalog.consumeOAuthCode(code), undefined, 'once');
  const late = await catalog.createOAuthCode({ clientId: client.id, userId: me, redirectUri: 'https://claude.ai/cb', codeChallenge: 'abc', scopes: [], ttlMs: 60_000 });
  advance(2 * 60_000);
  assert.equal(await catalog.consumeOAuthCode(late.code), undefined, 'expired');
});

test('outbox: append, list after a cursor, deliver, ack', async () => {
  const me = await owner('Outbox');
  const other = await owner('Else');
  const art = newArtifactId(clock);
  const first = await catalog.appendOutbox({ artifactId: art, toUser: me, kind: 'wake', payload: { threads: [1] } });
  const second = await catalog.appendOutbox({ artifactId: art, toUser: me, kind: 'files', payload: { paths: ['a'] } });
  await catalog.appendOutbox({ artifactId: art, toUser: other, kind: 'wake', payload: null });
  assert.ok(second.id > first.id);
  assert.deepEqual((await catalog.listOutbox(me)).map((e) => e.id), [first.id, second.id]);
  assert.deepEqual((await catalog.listOutbox(me, first.id)).map((e) => e.kind), ['files']);
  assert.deepEqual((await catalog.listOutbox(me))[0]!.payload, { threads: [1] });
  await catalog.markOutboxDelivered([first.id]);
  assert.ok((await catalog.listOutbox(me))[0]!.deliveredAt, 'delivered stays listed until acked');
  assert.equal(await catalog.ackOutbox(other, [first.id]), 0, 'only the recipient acks');
  assert.equal(await catalog.ackOutbox(me, [first.id, second.id]), 2);
  assert.deepEqual(await catalog.listOutbox(me), []);
  assert.equal(await catalog.ackOutbox(me, []), 0);
});

test('audit: append and list, newest first, by artifact', async () => {
  const art = newArtifactId(clock);
  await catalog.appendAudit({ actorKind: 'user', actorId: 'usr_a', artifactId: art, action: 'share.grant', detail: { role: 'editor' }, ip: '203.0.113.1' });
  advance(1000);
  await catalog.appendAudit({ actorKind: 'system', action: 'site.epoch' });
  const all = await catalog.listAudit({ limit: 2 });
  assert.deepEqual(all.map((a) => a.action), ['site.epoch', 'share.grant']);
  const scoped = await catalog.listAudit({ artifactId: art });
  assert.equal(scoped.length, 1);
  assert.deepEqual(scoped[0]!.detail, { role: 'editor' });
  assert.deepEqual((await catalog.listAudit({ before: all[0]!.at, limit: 1 })).map((a) => a.action), ['share.grant']);
});

test('site: get, set, epoch bump', async () => {
  assert.equal(await catalog.getSite('owner-key'), undefined);
  await catalog.setSite('owner-key', 'claimed');
  await catalog.setSite('owner-key', 'claimed-2');
  assert.equal(await catalog.getSite('owner-key'), 'claimed-2');
  await catalog.deleteSite('owner-key');
  assert.equal(await catalog.getSite('owner-key'), undefined);
  assert.equal(await catalog.siteEpoch(), 1);
  assert.equal(await catalog.bumpSiteEpoch(), 2);
  assert.equal(await catalog.bumpSiteEpoch(), 3);
  assert.equal(await catalog.siteEpoch(), 3);
});

test('no secret is stored in clear', async () => {
  const me = await owner('Secrets');
  const art = await catalog.createArtifact({ type: 'design', title: 'S', ownerUser: me });
  const secrets: string[] = [];
  secrets.push((await catalog.createSession({ userId: me, ttlMs: HOUR })).token);
  const { link, token } = await catalog.createLink(art.id, 'viewer');
  secrets.push(token);
  secrets.push((await catalog.joinGuest(link.id, 'G')).secret);
  const agent = await catalog.issueAgentToken({ userId: me, label: 'x', scopes: [], accessTtlMs: HOUR });
  secrets.push(agent.accessToken, agent.refreshToken);
  secrets.push((await catalog.createDeviceCode({ client: { name: 'x' }, ttlMs: HOUR, interval: 5 })).deviceCode);
  const client = await catalog.createOAuthClient({ name: 'c', redirectUris: [] });
  secrets.push((await catalog.createOAuthCode({ clientId: client.id, userId: me, redirectUri: 'https://x', codeChallenge: 'c', scopes: [], ttlMs: HOUR })).code);

  driver.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const files = (await readdir(dir)).filter((name) => name.startsWith('catalog.db'));
  const contents = (await Promise.all(files.map((name) => readFile(join(dir, name))))).map((b) => b.toString('latin1')).join('\n');
  assert.ok(contents.includes(await sha256Hex(token)), 'the scan sees the hash, so it reads the right bytes');
  for (const secret of secrets) assert.ok(!contents.includes(secret), `a secret is in the database file: ${secret.slice(0, 6)}…`);
  // Nor the token's base64url body without the agent prefixes.
  for (const secret of [agent.accessToken.slice(6), agent.refreshToken.slice(6)]) assert.ok(!contents.includes(secret));
});
