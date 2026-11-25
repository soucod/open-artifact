/**
 * The Library list's cost (a fixed number of catalog queries however long the list, with the roles `AccessCache`
 * would give), and deleting for good: `artifacts.purge` and the trash's timer (`purgeExpiredTrash`).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { purgeExpiredTrash, parseTrashDays, DEFAULT_TRASH_DAYS } from '../src/core/catalog/catalog.ts';
import { ConfigError } from '../src/core/config.ts';
import type { ArtifactView } from '@open-artifact/protocol';
import { makeApp, type TestApp } from './app-fixture.ts';

/** Counts the catalog's statements (a batch counts once, as one D1 call). */
function countQueries(app: TestApp): () => number {
  const driver = app.catalog.driver as unknown as Record<'all' | 'get' | 'run' | 'batch', (...args: unknown[]) => Promise<unknown>>;
  let count = 0;
  for (const name of ['all', 'get', 'run', 'batch'] as const) {
    const original = driver[name].bind(driver);
    driver[name] = (...args: unknown[]) => {
      count++;
      return original(...args);
    };
  }
  return () => count;
}

async function list(app: TestApp, cookie: string, trashed = false): Promise<ArtifactView[]> {
  const response = await app.fetch(`/api/open-artifact.artifacts${trashed ? '?trashed=1' : ''}`, { cookie });
  assert.equal(response.status, 200);
  return ((await response.json()) as { artifacts: ArtifactView[] }).artifacts;
}

test('the artifact list costs the same number of queries for 1 artifact and for 25, with the same roles as AccessCache', async () => {
  const app = await makeApp({ env: { OA_LINK_MAX_ROLE: 'editor' } });
  try {
    const ada = await app.person('Ada');
    const bob = await app.person('Bob');
    const queries = countQueries(app);
    await app.artifact(ada.user, { title: 'Mine 0' });
    let before = queries();
    const one = await list(app, ada.cookie);
    const costOne = queries() - before;
    assert.equal(one.length, 1);

    // 24 more, reached every way: owned, a user grant, an email grant, a domain grant, a link Ada opened, public.
    for (let i = 1; i < 6; i++) await app.artifact(ada.user, { title: `Mine ${i}` });
    for (let i = 0; i < 4; i++) {
      const a = await app.artifact(bob.user, { title: `User grant ${i}` });
      await app.catalog.upsertGrant({ artifactId: a.id, subjectKind: 'user', subject: ada.user.id, role: i % 2 ? 'editor' : 'viewer', createdBy: bob.user.id });
    }
    for (let i = 0; i < 4; i++) {
      const a = await app.artifact(bob.user, { title: `Email grant ${i}` });
      await app.catalog.upsertGrant({ artifactId: a.id, subjectKind: 'email', subject: 'ada@example.com', role: 'commenter', createdBy: bob.user.id });
    }
    for (let i = 0; i < 4; i++) {
      const a = await app.artifact(bob.user, { title: `Domain grant ${i}` });
      await app.catalog.upsertGrant({ artifactId: a.id, subjectKind: 'domain', subject: 'example.com', role: 'viewer', createdBy: bob.user.id });
    }
    const linked: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = await app.artifact(bob.user, { title: `Link ${i}`, generalAccess: 'link' });
      const { link } = await app.catalog.createLink(a.id, i % 2 ? 'editor' : 'commenter');
      await app.catalog.joinUserGuest(link.id, ada.user.id, 'Ada');
      linked.push(a.id);
    }
    // One of those links is turned off: that artifact drops out of the list.
    const off = (await app.catalog.listLinks(linked[0]!))[0]!;
    await app.catalog.setLinkEnabled(off.id, false);
    for (let i = 0; i < 3; i++) {
      const a = await app.artifact(bob.user, { title: `Grant expired ${i}` });
      await app.catalog.upsertGrant({ artifactId: a.id, subjectKind: 'user', subject: ada.user.id, role: 'editor', createdBy: bob.user.id, expiresAt: '2000-01-01T00:00:00.000Z' });
    }
    await app.catalog.setPinned(ada.user.id, linked[1]!, true);

    before = queries();
    const many = await list(app, ada.cookie);
    const costMany = queries() - before;
    assert.equal(many.length, 6 + 4 + 4 + 4 + 3, 'the 21 Ada can open (not the turned-off link, not the expired grants)');
    assert.equal(costMany, costOne, `the list costs ${costOne} queries for 1 artifact and ${costMany} for ${many.length}`);
    assert.ok(costOne <= 10, `a list costs ${costOne} queries`);

    // The same roles, shared and pinned flags as the per-artifact lookup gives.
    for (const view of many) {
      const access = await app.ctx.access.role(view.id, { kind: 'user', id: ada.user.id });
      assert.equal(view.role, access?.role, view.title);
      const shared = access!.artifact.generalAccess !== 'restricted' || (await app.catalog.listGrants(view.id)).length > 0;
      assert.equal(view.shared, shared, view.title);
      assert.equal(view.pinned, view.id === linked[1], view.title);
    }
    assert.equal(many.find((v) => v.title === 'Mine 0')?.shared, false);
    assert.equal(many.find((v) => v.title === 'User grant 1')?.role, 'editor');
    assert.equal(many.find((v) => v.title === 'Link 1')?.role, 'editor');
    assert.equal(many.find((v) => v.title === 'Link 2')?.role, 'commenter');

    // The trash list: the owner's own, as before.
    const trashedOne = many.find((v) => v.title === 'Mine 3')!;
    assert.equal((await app.fetch('/api/open-artifact.artifacts.delete', { cookie: ada.cookie, body: { id: trashedOne.id } })).status, 200);
    const trash = await list(app, ada.cookie, true);
    assert.deepEqual(trash.map((v) => [v.title, v.role]), [['Mine 3', 'owner']]);
    assert.equal((await list(app, ada.cookie)).some((v) => v.id === trashedOne.id), false);

  } finally {
    await app.close();
  }
});

test('artifacts.purge: only the owner, only from the trash, bytes first then the catalog rows', async () => {
  const app = await makeApp();
  try {
    const ada = await app.person('Ada');
    const bob = await app.person('Bob');
    const board = await app.artifact(ada.user, { title: 'Old board' });
    await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: bob.user.id, role: 'editor', createdBy: ada.user.id });
    const purge = (cookie: string, id = board.id) => app.fetch('/api/open-artifact.artifacts.purge', { cookie, body: { id } });

    // Not offered without the platform's deletion.
    assert.equal((await purge(ada.cookie)).status, 409, 'not in the trash yet');
    assert.equal((await app.fetch('/api/open-artifact.artifacts.delete', { cookie: ada.cookie, body: { id: board.id } })).status, 200);
    assert.equal((await purge(ada.cookie)).status, 501, 'no removeArtifact on this platform');

    const removed: string[] = [];
    app.ctx.removeArtifact = async (id) => {
      removed.push(id);
    };
    assert.equal((await purge(bob.cookie)).status, 404, 'an editor cannot see it in the trash');
    assert.equal((await purge(ada.cookie, 'art_nosuchartifact00')).status, 404);
    assert.equal(removed.length, 0);

    const answer = await purge(ada.cookie);
    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { purged: board.id });
    assert.deepEqual(removed, [board.id]);
    assert.equal(await app.catalog.getArtifact(board.id), undefined);
    assert.equal((await app.catalog.listGrants(board.id)).length, 0);
    const audit = await app.catalog.driver.all<{ action: string; actor_id: string }>("SELECT action, actor_id FROM audit WHERE action = 'artifact.purge'");
    assert.deepEqual(audit.map((row) => ({ ...row })), [{ action: 'artifact.purge', actor_id: ada.user.id }]);
    assert.ok(app.heard['artifact-changed'].some((e) => e.id === board.id));

    // A deletion that fails keeps the record (to try again).
    const second = await app.artifact(ada.user, { title: 'Second' });
    await app.fetch('/api/open-artifact.artifacts.delete', { cookie: ada.cookie, body: { id: second.id } });
    app.ctx.removeArtifact = async () => {
      throw new Error('disk on fire');
    };
    assert.equal((await purge(ada.cookie, second.id)).status, 500);
    assert.ok(await app.catalog.getArtifact(second.id));
  } finally {
    await app.close();
  }
});

test('the trash timer deletes what has been in the trash OA_TRASH_DAYS days', async () => {
  assert.equal(parseTrashDays({}), DEFAULT_TRASH_DAYS);
  assert.equal(parseTrashDays({ OA_TRASH_DAYS: '0' }), 0);
  assert.equal(parseTrashDays({ OA_TRASH_DAYS: '7' }), 7);
  assert.throws(() => parseTrashDays({ OA_TRASH_DAYS: '-1' }), ConfigError);
  assert.throws(() => parseTrashDays({ OA_TRASH_DAYS: 'soon' }), ConfigError);

  const app = await makeApp();
  try {
    const ada = await app.person('Ada');
    const old = await app.artifact(ada.user, { title: 'Old' });
    const recent = await app.artifact(ada.user, { title: 'Recent' });
    const kept = await app.artifact(ada.user, { title: 'Kept' });
    await app.catalog.trashArtifact(old.id);
    await app.catalog.trashArtifact(recent.id);
    await app.catalog.driver.run('UPDATE artifacts SET trashed_at = ? WHERE id = ?', ['2026-01-01T00:00:00.000Z', old.id]);
    await app.catalog.driver.run('UPDATE artifacts SET trashed_at = ? WHERE id = ?', ['2026-01-25T00:00:00.000Z', recent.id]);
    const removed: string[] = [];
    const remove = async (id: string): Promise<void> => {
      removed.push(id);
    };
    const now = new Date('2026-02-05T00:00:00.000Z');
    assert.equal(await purgeExpiredTrash(app.catalog, remove, { days: 0, now }), 0, '0 days: never on a timer');
    assert.equal(await purgeExpiredTrash(app.catalog, remove, { days: 30, now }), 1);
    assert.deepEqual(removed, [old.id]);
    assert.equal(await app.catalog.getArtifact(old.id), undefined);
    assert.ok(await app.catalog.getArtifact(recent.id));
    assert.ok(await app.catalog.getArtifact(kept.id));
    assert.equal(await purgeExpiredTrash(app.catalog, remove, { days: 7, now }), 1);
    assert.deepEqual(removed, [old.id, recent.id]);
    assert.ok(await app.catalog.getArtifact(kept.id), 'never what is not in the trash');
  } finally {
    await app.close();
  }
});
