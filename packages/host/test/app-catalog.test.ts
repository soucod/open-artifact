/**
 * What the app added to the catalog and the role rules: migration 3 (link members, per-person pins) and the role a
 * signed-in person gets from a link they opened (decision 20).
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { effectiveRole } from '../src/core/authz/roles.ts';
import { Catalog } from '../src/core/catalog/catalog.ts';
import type { UserPrincipal } from '../src/core/types.ts';
import { openSqlite } from '../src/node/sqlite.ts';

const KEYS = ['k'.repeat(40)];
const config: { linkMaxRole: 'editor' | 'commenter' | 'viewer'; publicAccess: boolean } = { linkMaxRole: 'editor', publicAccess: true };

test('migration 3, link members and pins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-catalog3-'));
  const driver = openSqlite(join(dir, 'host.db'));
  try {
    const catalog = await Catalog.open(driver, { signingKeys: KEYS });
    const versions = (await driver.all<{ version: number; name: string }>('SELECT version, name FROM schema_migrations ORDER BY version')).map((r) => `${r.version}:${r.name}`);
    assert.ok(versions.includes('3:link-members-and-pins'), versions.join(', '));
    // Opening again applies nothing twice.
    await Catalog.open(driver, { signingKeys: KEYS });

    const ada = await catalog.createUser({ name: 'Ada' });
    const sam = await catalog.createUser({ name: 'Sam' });
    const art = await catalog.createArtifact({ type: 'whiteboard', title: 'B', ownerUser: ada.id, generalAccess: 'link' });
    const { link } = await catalog.createLink(art.id, 'commenter');
    const v0 = (await catalog.getArtifact(art.id))!.grantsVersion;
    const first = await catalog.joinUserGuest(link.id, sam.id, 'Sam');
    const again = await catalog.joinUserGuest(link.id, sam.id, 'Sam');
    assert.equal(first.id, again.id, 'one row per person and link');
    assert.equal(first.userId, sam.id);
    assert.ok((await catalog.getArtifact(art.id))!.grantsVersion > v0, 'joining bumps the grants version');
    assert.deepEqual((await catalog.listUserGuests(sam.id, art.id)).map((g) => g.id), [first.id]);
    assert.deepEqual((await catalog.listArtifactsFor({ id: sam.id, email: null, emailVerified: false })).map((a) => a.id), [art.id]);

    await catalog.setPinned(sam.id, art.id, true);
    await catalog.setPinned(sam.id, art.id, true);
    assert.deepEqual([...(await catalog.pinnedBy(sam.id))], [art.id]);
    assert.equal((await catalog.pinnedBy(ada.id)).size, 0);
    await catalog.setPinned(sam.id, art.id, false);
    assert.equal((await catalog.pinnedBy(sam.id)).size, 0);
    await catalog.setPinned(sam.id, art.id, true);
    await catalog.deleteArtifact(art.id);
    assert.equal((await catalog.pinnedBy(sam.id)).size, 0, 'a deleted artifact takes its pins');
  } finally {
    driver.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a person's link role (decision 20): only while the link is on and the artifact is not restricted, capped", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-roles20-'));
  const driver = openSqlite(join(dir, 'host.db'));
  try {
    const catalog = await Catalog.open(driver, { signingKeys: KEYS });
    const ada = await catalog.createUser({ name: 'Ada' });
    const sam = await catalog.createUser({ name: 'Sam' });
    const art = await catalog.createArtifact({ type: 'whiteboard', title: 'B', ownerUser: ada.id, generalAccess: 'link' });
    const { link } = await catalog.createLink(art.id, 'editor');
    const person: UserPrincipal = { kind: 'user', id: sam.id, name: 'Sam', siteRole: 'member' };
    const role = async (c = config) => effectiveRole(person, (await catalog.getArtifact(art.id))!, [], c, { links: await catalog.listLinks(art.id), userLinks: [link.id] });
    assert.equal(await role(), 'editor');
    assert.equal(await role({ ...config, linkMaxRole: 'commenter' }), 'commenter');
    await catalog.setLinkEnabled(link.id, false);
    assert.equal(await role(), null);
    await catalog.setLinkEnabled(link.id, true);
    await catalog.setGeneralAccess(art.id, 'restricted');
    assert.equal(await role(), null);
    await catalog.setGeneralAccess(art.id, 'public');
    assert.equal(await role(), 'editor');
    // Without the row (after a reset) only public's viewer is left.
    assert.equal(effectiveRole(person, (await catalog.getArtifact(art.id))!, [], config, { links: await catalog.listLinks(art.id) }), 'viewer');
  } finally {
    driver.close();
    await rm(dir, { recursive: true, force: true });
  }
});
