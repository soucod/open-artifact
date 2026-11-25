import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signInWith } from '../src/core/auth/accounts.ts';
import { SignInError } from '../src/core/auth/errors.ts';
import type { ExternalIdentity } from '../src/core/auth/provider.ts';
import { makeHost, type TestHost } from './auth-fixture.ts';

async function withHost(env: Record<string, string>, body: (host: TestHost) => Promise<void>): Promise<void> {
  const host = await makeHost(env);
  try {
    await body(host);
  } finally {
    await host.close();
  }
}

const person = (subject: string, email?: string, verified = true, extra: Partial<ExternalIdentity> = {}): ExternalIdentity => ({
  provider: 'oidc:corp',
  subject,
  ...(email ? { email, emailVerified: verified } : {}),
  name: subject,
  ...extra,
});

async function refused(promise: Promise<unknown>, reason: string): Promise<void> {
  await assert.rejects(promise, (e: unknown) => e instanceof SignInError && e.reason === reason);
}

/** An artifact owned by a fresh user, to hang grants on. */
async function artifact(host: TestHost): Promise<string> {
  const owner = await host.catalog.createUser({ name: 'Owner', email: `owner-${Math.random()}@x.example`, emailVerified: true });
  return (await host.catalog.createArtifact({ type: 'html', title: 'T', ownerUser: owner.id })).id;
}

test('owners-only: only OA_OWNERS emails, and only verified', async () => {
  await withHost({ OA_SIGNUP: 'owners-only', OA_OWNERS: 'boss@x.example' }, async (host) => {
    await refused(signInWith(person('a', 'someone@x.example'), host.ctx), 'not_invited');
    await refused(signInWith(person('b', 'boss@x.example', false), host.ctx), 'not_invited');
    await refused(signInWith(person('c'), host.ctx), 'not_invited');
    const boss = await signInWith(person('d', 'Boss@X.example'), host.ctx);
    assert.equal(boss.siteRole, 'admin');
  });
});

test('invite: owners, a pending email grant, a domain grant, a group grant; nothing else', async () => {
  await withHost({ OA_SIGNUP: 'invite', OA_OWNERS: 'boss@x.example' }, async (host) => {
    await refused(signInWith(person('stranger', 'stranger@y.example'), host.ctx), 'not_invited');
    const id = await artifact(host);
    await host.catalog.upsertGrant({ artifactId: id, subjectKind: 'email', subject: 'Invited@Y.example', role: 'viewer', createdBy: 'x' });
    await refused(signInWith(person('inv-unverified', 'invited@y.example', false), host.ctx), 'not_invited');
    assert.equal((await signInWith(person('inv', 'invited@y.example'), host.ctx)).email, 'invited@y.example');
    await host.catalog.upsertGrant({ artifactId: id, subjectKind: 'domain', subject: 'team.example', role: 'viewer', createdBy: 'x' });
    assert.ok(await signInWith(person('dom', 'anyone@team.example'), host.ctx));
    await refused(signInWith(person('dom2', 'anyone@team.example.evil'), host.ctx), 'not_invited');
    await host.catalog.upsertGrant({ artifactId: id, subjectKind: 'group', subject: 'oidc:corp:eng', role: 'viewer', createdBy: 'x' });
    assert.ok(await signInWith(person('grp', undefined, true, { groups: ['eng'] }), host.ctx));
    await refused(signInWith(person('grp2', undefined, true, { groups: ['sales'] }), host.ctx), 'not_invited');
    // An expired invitation does not count.
    await host.catalog.upsertGrant({ artifactId: id, subjectKind: 'email', subject: 'late@y.example', role: 'viewer', createdBy: 'x', expiresAt: '2020-01-01T00:00:00.000Z' });
    await refused(signInWith(person('late', 'late@y.example'), host.ctx), 'not_invited');
    assert.equal((await signInWith(person('boss', 'boss@x.example'), host.ctx)).siteRole, 'admin');
  });
});

test('domain:<d>: that domain (verified) and owners', async () => {
  await withHost({ OA_SIGNUP: 'domain:corp.example', OA_OWNERS: 'boss@x.example' }, async (host) => {
    assert.ok(await signInWith(person('a', 'a@corp.example'), host.ctx));
    await refused(signInWith(person('b', 'b@corp.example', false), host.ctx), 'not_invited');
    await refused(signInWith(person('c', 'c@sub.corp.example.org'), host.ctx), 'not_invited');
    await refused(signInWith(person('d', 'd@evilcorp.example'), host.ctx), 'not_invited');
    assert.ok(await signInWith(person('boss', 'boss@x.example'), host.ctx));
  });
});

test('open: anyone, even without an email', async () => {
  await withHost({ OA_SIGNUP: 'open' }, async (host) => {
    assert.ok(await signInWith(person('nobody'), host.ctx));
    assert.ok(await signInWith(person('unverified', 'u@z.example', false), host.ctx));
  });
});

test('with no owners configured the first user ever is the admin; later ones are members', async () => {
  await withHost({ OA_SIGNUP: 'open' }, async (host) => {
    assert.equal((await signInWith(person('first', 'first@x.example'), host.ctx)).siteRole, 'admin');
    assert.equal((await signInWith(person('second', 'second@x.example'), host.ctx)).siteRole, 'member');
  });
});

test('owners are admins, and are promoted when they already had an account; the first user is not admin when owners are configured', async () => {
  await withHost({ OA_SIGNUP: 'open', OA_OWNERS: 'boss@x.example' }, async (host) => {
    assert.equal((await signInWith(person('first', 'first@x.example'), host.ctx)).siteRole, 'member');
    const pre = await host.catalog.createUser({ name: 'Boss', email: 'boss@x.example', emailVerified: true });
    const boss = await signInWith(person('boss-sub', 'boss@x.example'), host.ctx);
    assert.equal(boss.id, pre.id);
    assert.equal(boss.siteRole, 'admin');
  });
});

test('accounts link only on a verified email; known identities come back to the same user; name and avatar follow', async () => {
  await withHost({ OA_SIGNUP: 'open' }, async (host) => {
    const ada = await signInWith(person('ada-oidc', 'ada@x.example'), host.ctx);
    const viaGithub = await signInWith({ provider: 'github', subject: '1', email: 'ada@x.example', emailVerified: true, name: 'Ada GH', avatar: 'https://a/1.png' }, host.ctx);
    assert.equal(viaGithub.id, ada.id, 'linked by verified email');
    assert.equal(viaGithub.name, 'Ada GH');
    assert.equal(viaGithub.avatar, 'https://a/1.png');
    assert.equal((await host.catalog.listIdentities(ada.id)).length, 2);

    const impostor = await signInWith({ provider: 'github', subject: '2', email: 'ada@x.example', emailVerified: false, name: 'Not Ada' }, host.ctx);
    assert.notEqual(impostor.id, ada.id, 'an unverified email never links');
    assert.equal(impostor.email, null);

    const again = await signInWith(person('ada-oidc', 'ada@x.example', true, { name: 'Ada L.' }), host.ctx);
    assert.equal(again.id, ada.id);
    assert.equal(again.name, 'Ada L.');
  });
});

test('groups are stored per provider as <provider>:<group>', async () => {
  await withHost({ OA_SIGNUP: 'open' }, async (host) => {
    const u = await signInWith(person('g', 'g@x.example', true, { groups: ['eng'] }), host.ctx);
    await signInWith({ provider: 'oidc:other', subject: 'g2', email: 'g@x.example', emailVerified: true, groups: ['ops'] }, host.ctx);
    assert.deepEqual(await host.catalog.userGroups(u.id), ['oidc:corp:eng', 'oidc:other:ops']);
    await signInWith(person('g', 'g@x.example', true, { groups: ['design'] }), host.ctx);
    assert.deepEqual(await host.catalog.userGroups(u.id), ['oidc:corp:design', 'oidc:other:ops']);
    await signInWith(person('g', 'g@x.example'), host.ctx);
    assert.deepEqual(await host.catalog.userGroups(u.id), ['oidc:other:ops'], 'a sign-in without groups clears that provider’s');
  });
});

test('a disabled user is refused, whether found by identity or by email', async () => {
  await withHost({ OA_SIGNUP: 'open' }, async (host) => {
    const u = await signInWith(person('d', 'd@x.example'), host.ctx);
    await host.catalog.disableUser(u.id);
    await refused(signInWith(person('d', 'd@x.example'), host.ctx), 'disabled');
    await refused(signInWith({ provider: 'github', subject: 'd', email: 'd@x.example', emailVerified: true }, host.ctx), 'disabled');
  });
});
