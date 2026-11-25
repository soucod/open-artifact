/**
 * Why someone has access: `GET /api/open-artifact.admin.access?artifact=&email=` (site admins signed in in a browser
 * only) answers the role and what decided it, the host's own rule then each permission plugin; and the Node host's
 * `open-artifact-host plugin role <artifact id> --as <email>` over the same data. Runs on both hosts (the Cloudflare
 * Worker behind this fixture through `site.test.ts`).
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ADMIN_ACCESS_PATH } from '../src/core/app/routes.ts';
import type { AccessExplanation } from '../src/core/authz/explain.ts';
import { parseConfig } from '../src/core/config.ts';
import { openCatalog } from '../src/node/host.ts';
import { main } from '../src/node/main.ts';
import { makeApp } from './app-fixture.ts';

const STATIC_GROUPS = fileURLToPath(new URL('../../../examples/host-plugins/static-groups.mjs', import.meta.url));
const GROUPS = { groups: { staff: '@staff.example' }, roles: { staff: 'viewer' } };

test('admin.access: site admins only; the host\'s reason, each plugin\'s answer and what decided it', async () => {
  const staticGroups = (await import(STATIC_GROUPS)) as { default: unknown };
  const app = await makeApp({ plugins: [{ plugin: staticGroups.default, config: GROUPS, use: 'static-groups' }] });
  try {
    const admin = await app.person('Ada', 'ada@example.com', { siteRole: 'admin' });
    const owner = await app.person('Olga', 'olga@example.com');
    const bob = await app.person('Bob', 'bob@example.com');
    const board = await app.artifact(owner.user, { title: 'Plan' });
    await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'email', subject: 'bob@example.com', role: 'commenter', createdBy: owner.user.id });
    const ask = async (query: string, cookie = admin.cookie): Promise<Response> => app.fetch(`${ADMIN_ACCESS_PATH}${query}`, { cookie });
    const answer = async (email: string): Promise<AccessExplanation> => {
      const response = await ask(`?artifact=${board.id}&email=${encodeURIComponent(email)}`);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return (await response.json()) as AccessExplanation;
    };

    // Who may ask.
    assert.equal((await app.fetch(`${ADMIN_ACCESS_PATH}?artifact=${board.id}&email=bob@example.com`)).status, 401);
    assert.equal((await ask(`?artifact=${board.id}&email=bob@example.com`, owner.cookie)).status, 403, 'an artifact owner who is not a site admin');
    const issued = await app.catalog.issueAgentToken({ userId: admin.user.id, label: 'x', scopes: ['link'], accessTtlMs: 60_000, refreshTtlMs: 60_000 });
    assert.equal((await app.fetch(`${ADMIN_ACCESS_PATH}?artifact=${board.id}&email=bob@example.com`, { headers: { authorization: `Bearer ${issued.accessToken}` } })).status, 401, 'an agent token is refused');
    assert.equal((await ask(`?artifact=${board.id}`)).status, 400);
    assert.equal((await ask('?email=bob@example.com')).status, 400);
    assert.equal((await ask('?artifact=art_nothing00000&email=bob@example.com')).status, 404);

    // A share: the host decides; the plugin has no opinion about someone outside its groups.
    const shared = await answer('Bob@Example.com');
    assert.equal(shared.role, 'commenter');
    assert.equal(shared.decidedBy, 'host');
    assert.equal(shared.person.userId, bob.user.id);
    assert.equal(shared.host.reason, 'a share with email bob@example.com (commenter)');
    assert.deepEqual(shared.plugins.map((s) => [s.plugin, s.answer, s.before, s.after]), [['static-groups', 'no opinion', 'commenter', 'commenter']]);

    // Someone who never signed in, in a plugin's group: what they would get, decided by the plugin.
    const staff = await answer('sam@staff.example');
    assert.equal(staff.person.userId, null);
    assert.equal(staff.host.role, null);
    assert.equal(staff.host.reason, 'no share, link or public access gives a role');
    assert.equal(staff.role, 'viewer');
    assert.equal(staff.decidedBy, 'plugin:static-groups');
    assert.deepEqual(staff.plugins.map((s) => [s.answer, s.after]), [['viewer', 'viewer']]);

    // Nobody gives a stranger anything; the owner and a site admin are the host's.
    const stranger = await answer('eve@example.com');
    assert.deepEqual([stranger.role, stranger.decidedBy], [null, 'host']);
    assert.deepEqual([(await answer('olga@example.com')).host.reason, (await answer('olga@example.com')).role], ["the artifact's owner", 'owner']);
    const asAdmin = await answer('ada@example.com');
    assert.deepEqual([asAdmin.role, asAdmin.person.siteRole, asAdmin.host.reason], ['owner', 'admin', 'a site admin (owner of every artifact)']);

    // A disabled account gets nothing, whatever a share says.
    await app.catalog.disableUser(bob.user.id);
    const off = await answer('bob@example.com');
    assert.deepEqual([off.role, off.decidedBy, off.person.disabled], [null, 'disabled', true]);
  } finally {
    await app.close();
  }
});

test('open-artifact-host plugin role: the same answer in sentences or --json, the plugins from the site\'s list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-access-'));
  const env = {
    OA_DATA_DIR: join(dir, 'data'),
    OA_SIGNING_KEYS: 'e'.repeat(40),
    OA_PLUGINS: JSON.stringify([{ use: STATIC_GROUPS, config: GROUPS }]),
  };
  const { catalog, driver } = await openCatalog(env.OA_DATA_DIR, parseConfig(env));
  const owner = await catalog.createUser({ name: 'Olga', email: 'olga@example.com', emailVerified: true });
  const board = await catalog.createArtifact({ type: 'whiteboard', title: 'Plan', ownerUser: owner.id });
  driver.close();
  const printed: string[] = [];
  const log = console.log;
  console.log = (line: string) => void printed.push(String(line));
  try {
    await main(['plugin', 'role', board.id, '--as', 'sam@staff.example'], env);
    const text = printed.join('\n');
    assert.match(text, /^sam@staff\.example \(never signed in: what they would get once they do, with a verified address\) on "Plan"/);
    assert.match(text, /host: no access: no share, link or public access gives a role/);
    assert.match(text, /plugin static-groups: answered viewer; role no access -> viewer/);
    assert.match(text, /Role: viewer \(decided by plugin:static-groups\)\.$/);
    printed.length = 0;
    await main(['plugin', 'role', board.id, '--as', 'olga@example.com', '--json'], env);
    const answer = JSON.parse(printed.join('\n')) as AccessExplanation;
    assert.deepEqual([answer.role, answer.decidedBy, answer.person.userId], ['owner', 'host', owner.id]);
    await assert.rejects(main(['plugin', 'role', board.id], env), /usage: .* plugin role <artifact id> --as <email>/);
    await assert.rejects(main(['plugin', 'role', board.id, '--as', 'nobody'], env), /is not an email address/);
    await assert.rejects(main(['plugin', 'role', 'art_nothing00000', '--as', 'sam@staff.example'], env), /no artifact art_nothing00000/);
  } finally {
    console.log = log;
    await rm(dir, { recursive: true, force: true });
  }
});
