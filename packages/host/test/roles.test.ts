import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capRole, effectiveRole, maxRole, roleAtLeast } from '../src/core/authz/roles.ts';
import { DEFAULT_ARTIFACT_SETTINGS } from '../src/core/catalog/catalog.ts';
import type { ArtifactRow, GrantRecord, HostConfig, LinkRecord, Principal, UserPrincipal } from '../src/core/types.ts';

const ID = 'art_0abcdefghi1234';
const NOW = new Date('2026-06-01T00:00:00Z');
const config: Pick<HostConfig, 'linkMaxRole' | 'publicAccess'> = { linkMaxRole: 'editor', publicAccess: true };
const artifact = (patch: Partial<ArtifactRow> = {}): ArtifactRow => ({
  id: ID,
  type: 'design',
  typeRelease: null,
  title: 'T',
  ownerUser: 'usr_owner',
  workspaceId: null,
  generalAccess: 'restricted',
  settings: DEFAULT_ARTIFACT_SETTINGS,
  grantsVersion: 1,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  trashedAt: null,
  ...patch,
});
const user = (patch: Partial<UserPrincipal> = {}): UserPrincipal => ({ kind: 'user', id: 'usr_x', name: 'X', siteRole: 'member', ...patch });
const grant = (patch: Partial<GrantRecord>): GrantRecord => ({ artifactId: ID, subjectKind: 'user', subject: 'usr_x', role: 'viewer', createdBy: 'usr_owner', createdAt: NOW.toISOString(), expiresAt: null, ...patch });
const link = (patch: Partial<LinkRecord> = {}): LinkRecord => ({ id: 'lnk_e', artifactId: ID, role: 'editor', enabled: true, createdAt: NOW.toISOString(), ...patch });
const guest: Principal = { kind: 'guest', id: 'gst_1', name: 'G', link: 'lnk_e', artifact: ID };
const role = (p: Principal, a: ArtifactRow, grants: GrantRecord[] = [], links: LinkRecord[] = [], c = config) => effectiveRole(p, a, grants, c, { links, now: NOW });

test('role helpers', () => {
  assert.equal(maxRole('viewer', 'editor', null, 'commenter'), 'editor');
  assert.equal(maxRole(), null);
  assert.equal(roleAtLeast('editor', 'commenter'), true);
  assert.equal(roleAtLeast('viewer', 'commenter'), false);
  assert.equal(roleAtLeast(null, 'viewer'), false);
  assert.equal(capRole('editor', 'viewer'), 'viewer');
  assert.equal(capRole('viewer', 'editor'), 'viewer');
});

test('the owner and site admins are owner; nobody else without a grant', () => {
  assert.equal(role(user({ id: 'usr_owner' }), artifact()), 'owner');
  assert.equal(role(user({ siteRole: 'admin' }), artifact()), 'owner');
  assert.equal(role(user(), artifact()), null);
  assert.equal(role({ kind: 'anonymous' }, artifact()), null);
});

test('user, verified-email, domain and group grants; the highest wins', () => {
  const verified = user({ email: 'X@Example.com', emailVerified: true, groups: ['google:eng'] });
  assert.equal(role(user(), artifact(), [grant({ role: 'commenter' })]), 'commenter');
  assert.equal(role(verified, artifact(), [grant({ subjectKind: 'email', subject: 'x@example.com', role: 'editor' })]), 'editor');
  assert.equal(role(user({ email: 'x@example.com', emailVerified: false }), artifact(), [grant({ subjectKind: 'email', subject: 'x@example.com' })]), null, 'unverified email');
  assert.equal(role(verified, artifact(), [grant({ subjectKind: 'domain', subject: 'example.com' })]), 'viewer');
  assert.equal(role(user({ email: 'x@example.com' }), artifact(), [grant({ subjectKind: 'domain', subject: 'example.com' })]), null, 'domain needs verification');
  assert.equal(role(verified, artifact(), [grant({ subjectKind: 'domain', subject: 'other.com' })]), null);
  assert.equal(role(verified, artifact(), [grant({ subjectKind: 'group', subject: 'google:eng', role: 'commenter' })]), 'commenter');
  assert.equal(role(verified, artifact(), [grant({ subjectKind: 'group', subject: 'google:ops' })]), null);
  assert.equal(
    role(verified, artifact(), [grant({ role: 'viewer' }), grant({ subjectKind: 'group', subject: 'google:eng', role: 'editor' }), grant({ subjectKind: 'domain', subject: 'example.com', role: 'commenter' })]),
    'editor',
  );
  assert.equal(role(user(), artifact(), [grant({ artifactId: 'art_0zzzzzzzzz9999' })]), null, 'another artifact’s grant');
});

test('expired grants do not count', () => {
  assert.equal(role(user(), artifact(), [grant({ expiresAt: '2026-05-31T23:59:59.000Z' })]), null);
  assert.equal(role(user(), artifact(), [grant({ expiresAt: NOW.toISOString() })]), null, 'expires at now');
  assert.equal(role(user(), artifact(), [grant({ expiresAt: '2026-06-02T00:00:00.000Z' })]), 'viewer');
});

test('a link guest holds the link’s role while it is on, capped by linkMaxRole', () => {
  const linked = artifact({ generalAccess: 'link' });
  assert.equal(role(guest, linked, [], [link()]), 'editor');
  assert.equal(role(guest, artifact({ generalAccess: 'public' }), [], [link()]), 'editor', 'public keeps links on');
  assert.equal(role(guest, linked, [], [link({ enabled: false })]), null, 'link off');
  assert.equal(role(guest, linked, [], []), null, 'no links given');
  assert.equal(role(guest, linked, [], [link({ id: 'lnk_other' })]), null, 'not their link');
  assert.equal(role(guest, linked, [], [link()], { linkMaxRole: 'commenter', publicAccess: true }), 'commenter');
  assert.equal(role(guest, linked, [], [link({ role: 'viewer' })], { linkMaxRole: 'commenter', publicAccess: true }), 'viewer');
  assert.equal(role({ ...guest, artifact: 'art_0zzzzzzzzz9999' }, linked, [], [link()]), null, 'a guest of another artifact');
});

test('restricted general access turns every link off', () => {
  assert.equal(role(guest, artifact({ generalAccess: 'restricted' }), [], [link()]), null);
  // People added by name keep their access.
  assert.equal(role(user(), artifact({ generalAccess: 'restricted' }), [grant({ role: 'editor' })]), 'editor');
});

test('public access gives viewer at most, only when the site allows it', () => {
  const pub = artifact({ generalAccess: 'public' });
  assert.equal(role({ kind: 'anonymous' }, pub), 'viewer');
  assert.equal(role(user(), pub), 'viewer');
  assert.equal(role(user(), pub, [grant({ role: 'editor' })]), 'editor', 'a grant above public');
  assert.equal(role({ kind: 'anonymous' }, pub, [], [], { linkMaxRole: 'editor', publicAccess: false }), null, 'publicAccess off');
  assert.equal(role({ kind: 'anonymous' }, artifact({ generalAccess: 'link' })), null);
});

test('an agent has its user’s role', () => {
  const agent = (u: UserPrincipal): Principal => ({ kind: 'agent', id: 'agt_1', user: u, label: 'Claude Code', scopes: [] });
  assert.equal(role(agent(user({ id: 'usr_owner' })), artifact()), 'owner');
  assert.equal(role(agent(user()), artifact(), [grant({ role: 'commenter' })]), 'commenter');
  assert.equal(role(agent(user()), artifact()), null);
});

test('a trashed artifact is the owner’s and admins’ alone', () => {
  const trashed = artifact({ trashedAt: NOW.toISOString(), generalAccess: 'public' });
  assert.equal(role(user({ id: 'usr_owner' }), trashed), 'owner');
  assert.equal(role(user({ siteRole: 'admin' }), trashed), 'owner');
  assert.equal(role(user(), trashed, [grant({ role: 'editor' })]), null);
  assert.equal(role({ kind: 'anonymous' }, trashed), null);
});
