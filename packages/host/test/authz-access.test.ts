import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccessCache, currentRole, principalRef } from '../src/core/authz/access.ts';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { HostEvents } from '../src/core/events.ts';
import type { HostConfig } from '../src/core/types.ts';
import { openSqlite } from '../src/node/sqlite.ts';

const KEYS = ['k'.repeat(40)];
const config: Pick<HostConfig, 'owners' | 'linkMaxRole' | 'publicAccess'> = { owners: ['root@example.com'], linkMaxRole: 'editor', publicAccess: true };

async function setup() {
  const driver = openSqlite(':memory:');
  const catalog = await Catalog.open(driver, { signingKeys: KEYS });
  const ada = await catalog.createUser({ name: 'Ada', email: 'ada@example.com', emailVerified: true });
  const eve = await catalog.createUser({ name: 'Eve' });
  const cam = await catalog.createUser({ name: 'Cam', email: 'cam@example.com', emailVerified: true });
  const una = await catalog.createUser({ name: 'Una', email: 'una@example.com', emailVerified: false });
  const root = await catalog.createUser({ name: 'Root', email: 'root@example.com', emailVerified: true });
  const art = await catalog.createArtifact({ type: 'whiteboard', title: 'Retro', ownerUser: ada.id, generalAccess: 'link' });
  return { driver, catalog, ada, eve, cam, una, root, art };
}

test('currentRole loads the principal again and applies the role table', async () => {
  const { catalog, ada, eve, cam, una, root, art } = await setup();
  const now = new Date();
  const role = async (kind: 'user' | 'guest' | 'agent' | 'anonymous', id: string) => (await currentRole(catalog, config, art.id, { kind, id }, now))?.role ?? null;
  assert.equal(await role('user', ada.id), 'owner');
  assert.equal(await role('user', root.id), 'owner', 'a site owner by OA_OWNERS (verified email)');
  assert.equal(await role('user', eve.id), null);
  await catalog.upsertGrant({ artifactId: art.id, subjectKind: 'user', subject: eve.id, role: 'editor', createdBy: ada.id });
  assert.equal(await role('user', eve.id), 'editor');
  await catalog.upsertGrant({ artifactId: art.id, subjectKind: 'email', subject: 'cam@example.com', role: 'commenter', createdBy: ada.id });
  await catalog.upsertGrant({ artifactId: art.id, subjectKind: 'email', subject: 'una@example.com', role: 'commenter', createdBy: ada.id });
  assert.equal(await role('user', cam.id), 'commenter');
  assert.equal(await role('user', una.id), null, 'an unverified email matches no grant');
  assert.equal(await role('user', 'usr_missing'), null);

  // A guest through a link, while general access lets links count.
  const { link } = await catalog.createLink(art.id, 'commenter');
  const { guest } = await catalog.joinGuest(link.id, 'Gus');
  assert.equal(await role('guest', guest.id), 'commenter');
  await catalog.setGeneralAccess(art.id, 'restricted');
  assert.equal(await role('guest', guest.id), null);
  assert.equal(await role('user', eve.id), 'editor', 'people added by name keep access');
  await catalog.setGeneralAccess(art.id, 'public');
  assert.equal(await role('anonymous', 'anonymous'), 'viewer');
  await catalog.setGeneralAccess(art.id, 'link');
  assert.equal(await role('anonymous', 'anonymous'), null);

  // An agent has its user's role while its token is not revoked.
  const { token } = await catalog.issueAgentToken({ userId: eve.id, label: 'Claude Code', scopes: [], accessTtlMs: 60_000 });
  const agent = await currentRole(catalog, config, art.id, { kind: 'agent', id: token.id }, now);
  assert.equal(agent?.role, 'editor');
  assert.equal(agent?.principal.kind, 'agent');
  await catalog.revokeAgentToken(token.id);
  assert.equal(await role('agent', token.id), null);

  // A disabled user has no access, even as owner.
  await catalog.disableUser(ada.id);
  assert.equal(await role('user', ada.id), null);
  assert.equal(await currentRole(catalog, config, 'art_0000000000aaaa', { kind: 'user', id: eve.id }, now), null, 'no such artifact');
});

test('group grants count when the host says which groups a user is in', async () => {
  const { catalog, ada, eve, art } = await setup();
  await catalog.upsertGrant({ artifactId: art.id, subjectKind: 'group', subject: 'google:eng', role: 'viewer', createdBy: ada.id });
  assert.equal(await currentRole(catalog, config, art.id, { kind: 'user', id: eve.id }, new Date()), null);
  const access = await currentRole(catalog, config, art.id, { kind: 'user', id: eve.id }, new Date(), { groupsOf: async () => ['google:eng'] });
  assert.equal(access?.role, 'viewer');
});

test('principalRef names each kind as a page token does', () => {
  assert.deepEqual(principalRef({ kind: 'anonymous' }), { kind: 'anonymous', id: 'anonymous' });
  assert.deepEqual(principalRef({ kind: 'guest', id: 'gst_1', name: 'G', link: 'l', artifact: 'a' }), { kind: 'guest', id: 'gst_1' });
});

test('AccessCache follows grant changes made through any Catalog, without invalidate', async () => {
  const { driver, catalog, ada, eve, art } = await setup();
  // Another Catalog object over the same database: what the app layer's sharing routes use.
  const other = new Catalog(driver, { signingKeys: KEYS });
  const cache = new AccessCache(catalog, config);
  const eveRef = { kind: 'user' as const, id: eve.id };
  assert.equal(await cache.role(art.id, eveRef), null);
  await other.upsertGrant({ artifactId: art.id, subjectKind: 'user', subject: eve.id, role: 'editor', createdBy: ada.id });
  assert.equal((await cache.role(art.id, eveRef))?.role, 'editor');
  await other.upsertGrant({ artifactId: art.id, subjectKind: 'user', subject: eve.id, role: 'viewer', createdBy: ada.id });
  assert.equal((await cache.role(art.id, eveRef))?.role, 'viewer');
  await other.removeGrant(art.id, 'user', eve.id);
  assert.equal(await cache.role(art.id, eveRef), null);
  // The answer carries the fresh row and the epoch.
  const owner = await cache.role(art.id, { kind: 'user', id: ada.id });
  assert.equal(owner?.role, 'owner');
  assert.equal(owner?.epoch, 1);
  await other.bumpSiteEpoch();
  assert.equal((await cache.role(art.id, { kind: 'user', id: ada.id }))?.epoch, 2);
  await other.trashArtifact(art.id);
  assert.equal((await cache.role(art.id, { kind: 'user', id: ada.id }))?.artifact.trashedAt !== null, true);
});

test('AccessCache keeps answers at most maxAgeMs, and no later than a grant expiry', async () => {
  const { catalog, ada, eve, art } = await setup();
  let clock = Date.now();
  const cache = new AccessCache(catalog, config, { now: () => new Date(clock), maxAgeMs: 5_000 });
  const eveRef = { kind: 'user' as const, id: eve.id };
  await catalog.upsertGrant({ artifactId: art.id, subjectKind: 'user', subject: eve.id, role: 'editor', createdBy: ada.id, expiresAt: new Date(clock + 2_000).toISOString() });
  assert.equal((await cache.role(art.id, eveRef))?.role, 'editor');
  // A change that does not move grants_version (the user disabled) shows once the answer is too old.
  await catalog.disableUser(eve.id);
  assert.equal((await cache.role(art.id, eveRef))?.role, 'editor', 'kept');
  clock += 2_001;
  assert.equal(await cache.role(art.id, eveRef), null, 'the grant expired and the answer with it');
  cache.invalidate();
  assert.equal(await cache.role(art.id, eveRef), null);
});

test('HostEvents: typed listeners, unsubscribe, a throwing listener does not stop the rest', () => {
  const errors: string[] = [];
  const events = new HostEvents({ onError: (_error, name) => errors.push(name) });
  const seen: string[] = [];
  events.on('outbox', () => {
    throw new Error('boom');
  });
  const off = events.on('outbox', ({ userId }) => seen.push(userId));
  events.on('artifact-touched', ({ id, paths }) => seen.push(`${id}:${paths.join(',')}`));
  events.emit('outbox', { userId: 'usr_a' });
  events.emit('artifact-touched', { id: 'art_x', author: 'owner', paths: ['db/a'] });
  off();
  events.emit('outbox', { userId: 'usr_b' });
  assert.deepEqual(seen, ['usr_a', 'art_x:db/a']);
  assert.deepEqual(errors, ['outbox', 'outbox']);
  assert.equal(events.listenerCount('outbox'), 1);
  assert.equal(events.listenerCount('access-changed'), 0);
});
