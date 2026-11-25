/**
 * The audit log, read: `GET /api/open-artifact.admin.audit` for site admins only (no agent tokens), its filters, its
 * cap and its pages, newest first; and the Node host's `open-artifact-host audit` over the same data.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ADMIN_AUDIT_PATH, AUDIT_MAX_LIMIT } from '../src/core/app/audit.ts';
import { main } from '../src/node/main.ts';
import { openCatalog } from '../src/node/host.ts';
import { parseConfig } from '../src/core/config.ts';
import { makeApp } from './app-fixture.ts';

interface Page {
  entries: Array<{ id: string; at: string; action: string; actorId: string | null; artifactId: string | null }>;
  next: string | null;
}

test('admin.audit: site admins only, filters, newest first, pages without repeats, a capped limit', async () => {
  const app = await makeApp();
  try {
    const admin = await app.person('Ada', 'ada@example.com', { siteRole: 'admin' });
    const member = await app.person('Bob');
    for (let i = 0; i < 7; i++) await app.catalog.appendAudit({ actorKind: 'user', actorId: member.user.id, artifactId: i % 2 ? 'art_odd000000001' : null, action: `test.step_${i}` });
    await app.catalog.appendAudit({ actorKind: 'system', action: 'auth.sign_in_refused', detail: { reason: 'not_invited' } });
    const get = async (query = '', cookie = admin.cookie): Promise<Response> => app.fetch(`${ADMIN_AUDIT_PATH}${query}`, { cookie });

    assert.equal((await get('', member.cookie)).status, 403);
    assert.equal((await app.fetch(ADMIN_AUDIT_PATH)).status, 401);
    const issued = await app.catalog.issueAgentToken({ userId: admin.user.id, label: 'x', scopes: ['link'], accessTtlMs: 60_000, refreshTtlMs: 60_000 });
    assert.equal((await app.fetch(ADMIN_AUDIT_PATH, { headers: { authorization: `Bearer ${issued.accessToken}` } })).status, 401, 'an agent token is refused');

    const all = (await (await get()).json()) as Page;
    assert.equal(all.next, null);
    assert.equal(all.entries[0]!.action, 'auth.sign_in_refused', 'newest first');
    assert.deepEqual(all.entries.slice(1).map((e) => e.action), [6, 5, 4, 3, 2, 1, 0].map((i) => `test.step_${i}`));

    assert.deepEqual(((await (await get('?action=auth.')).json()) as Page).entries.map((e) => e.action), ['auth.sign_in_refused']);
    assert.equal(((await (await get('?artifact=art_odd000000001')).json()) as Page).entries.length, 3);
    assert.equal(((await (await get(`?actor=${member.user.id}`)).json()) as Page).entries.length, 7);

    // Pages of 3: every entry once, in order (entries in one millisecond included).
    const seen: string[] = [];
    let before: string | null = '';
    while (before !== null) {
      const page = (await (await get(`?limit=3${before ? `&before=${encodeURIComponent(before)}` : ''}`)).json()) as Page;
      assert.ok(page.entries.length <= 3);
      seen.push(...page.entries.map((e) => e.id));
      before = page.next;
    }
    assert.deepEqual(seen, all.entries.map((e) => e.id));

    // A time as `before`; a limit above the cap is the cap; bad filters are refused.
    assert.equal(((await (await get(`?before=${encodeURIComponent('2000-01-01T00:00:00Z')}`)).json()) as Page).entries.length, 0);
    assert.equal((await get(`?limit=${AUDIT_MAX_LIMIT * 10}`)).status, 200);
    assert.equal((await get('?limit=many')).status, 400);
    assert.equal((await get('?before=yesterday')).status, 400);
    assert.equal((await get('?who=me')).status, 400);
  } finally {
    await app.close();
  }
});

test('open-artifact-host audit: lines or --json, the same filters', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-audit-'));
  const env = { OA_DATA_DIR: join(dir, 'data'), OA_SIGNING_KEYS: 'e'.repeat(40) };
  const { catalog, driver } = await openCatalog(env.OA_DATA_DIR, parseConfig(env));
  await catalog.appendAudit({ actorKind: 'system', action: 'plugin.failed', detail: { plugin: 'groups', error: 'threw: boom' } });
  await catalog.appendAudit({ actorKind: 'system', artifactId: 'art_abc000000001', action: 'artifact.import' });
  driver.close();
  const printed: string[] = [];
  const log = console.log;
  console.log = (line: string) => void printed.push(String(line));
  try {
    await main(['audit', '--action', 'plugin.'], env);
    assert.equal(printed.length, 1);
    assert.match(printed[0]!, /^\S+Z {2}plugin\.failed {2}system {2}\{"plugin":"groups","error":"threw: boom"\}$/);
    printed.length = 0;
    await main(['audit', '--json', '--limit', '1'], env);
    const page = JSON.parse(printed.join('\n')) as Page;
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0]!.action, 'artifact.import');
    assert.ok(page.next);
    printed.length = 0;
    await main(['audit', '--artifact', 'art_nothing00000'], env);
    assert.deepEqual(printed, ['No audit entries match.']);
    await assert.rejects(main(['audit', '--limit', 'x'], env), /whole number/);
  } finally {
    console.log = log;
    await rm(dir, { recursive: true, force: true });
  }
});
