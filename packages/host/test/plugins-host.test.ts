/**
 * The host plugins wired into the app origin (`makeApp({plugins})`): nothing extra without them, `authz.role` and its
 * cache and invalidation, `authz.artifacts` on the home list, every guard of an app route, events and the audit
 * wrapper, plugin routes, the admin API, `share.invited`, `wake.deliver` and the pages' `ui`.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { ArtifactView, HomeBoot } from '@open-artifact/protocol';
import { GUARD_PATHS, guards } from '../src/core/plugins/hooks.ts';
import { PLUGIN_ROUTE_MAX_BYTES } from '../src/core/app/routes.ts';
import { HOME_HTML, bootOf, makeApp, type TestApp } from './app-fixture.ts';

/** Counts the catalog's statements (a batch counts once). */
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

async function list(app: TestApp, cookie: string): Promise<ArtifactView[]> {
  const response = await app.fetch('/api/open-artifact.artifacts', { cookie });
  assert.equal(response.status, 200);
  return ((await response.json()) as { artifacts: ArtifactView[] }).artifacts;
}

const plugin = (id: string, hooks: Record<string, unknown>) => ({ plugin: { id, apiVersion: 1, ...hooks } });

test('without plugins the context has none, and the list and an artifact cost what they did', async () => {
  const plain = await makeApp();
  const empty = await makeApp({ plugins: [] });
  // A plugin with only an event handler changes nothing on the access path.
  const events = await makeApp({ plugins: [plugin('quiet', { on: { 'artifact.changed': () => undefined } })] });
  try {
    assert.equal(plain.ctx.plugins, undefined);
    assert.equal(empty.ctx.plugins, undefined);
    assert.ok(events.ctx.plugins);
    const costs: number[] = [];
    for (const app of [plain, empty, events]) {
      const ada = await app.person('Ada');
      for (let i = 0; i < 3; i++) await app.artifact(ada.user, { title: `Mine ${i}` });
      const board = await app.artifact(ada.user);
      const queries = countQueries(app);
      const before = queries();
      assert.equal((await list(app, ada.cookie)).length, 4);
      assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: ada.cookie })).status, 200);
      costs.push(queries() - before);
    }
    assert.equal(costs[1], costs[0], 'an empty list costs nothing');
    assert.equal(costs[2], costs[0], 'an event-only plugin costs nothing on these paths');
  } finally {
    await Promise.all([plain.close(), empty.close(), events.close()]);
  }
});

test('authz.role grants a role, is cached for cacheSeconds, and ctx.host.access.invalidate forgets it', async () => {
  const asked: string[] = [];
  let grant: 'editor' | 'viewer' = 'editor';
  const app = await makeApp({
    plugins: [
      plugin('groups', {
        authz: {
          role: ({ principal, role }: { principal: { kind: string; email?: string }; role: string | null }) => {
            asked.push(principal.kind);
            if (principal.kind === 'user' && principal.email === 'bob@example.com') return role ?? grant;
            return undefined;
          },
        },
        routes: [{ method: 'POST', path: '/forget', handler: async (_input: unknown, ctx: { host: { access: { invalidate(id?: string): Promise<void> } } }) => {
          await ctx.host.access.invalidate();
          return new Response('ok');
        } }],
      }),
    ],
  });
  try {
    const ada = await app.person('Ada');
    const bob = await app.person('Bob');
    const board = await app.artifact(ada.user);
    const role = async (): Promise<string> => {
      const response = await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: bob.cookie });
      assert.equal(response.status, 200);
      return ((await response.json()) as ArtifactView).role ?? 'none';
    };
    assert.equal(await role(), 'editor');
    const calls = asked.length;
    assert.equal(await role(), 'editor');
    assert.equal(asked.length, calls, 'the answer is reused');
    grant = 'viewer';
    assert.equal(await role(), 'editor', 'still cached');
    assert.equal((await app.fetch('/plugins/groups/forget', { cookie: ada.cookie, method: 'POST', body: '' })).status, 200);
    assert.ok(app.refreshed.includes('*'), 'live pages are told');
    assert.equal(await role(), 'viewer');
    // Ada (the owner) keeps hers: the plugin has no opinion.
    const mine = await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: ada.cookie });
    assert.equal(((await mine.json()) as ArtifactView).role, 'owner');
  } finally {
    await app.close();
  }
});

test('authz.role that fails denies (fail closed); a role hook failing never lets anyone in', async () => {
  const app = await makeApp({ plugins: [plugin('broken', { authz: { role: () => { throw new Error('down'); } } })] });
  try {
    const ada = await app.person('Ada');
    const bob = await app.person('Bob');
    const board = await app.artifact(ada.user);
    await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: bob.user.id, role: 'viewer', createdBy: ada.user.id });
    const response = await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: bob.cookie });
    // Refused (fail closed), and told why: the check failed, not "not shared with you".
    const sentence = "A permission check could not be completed just now. Try again in a moment; if it persists, the site's operator can see why in the audit log.";
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { code: 'not_granted', message: sentence });
    const page = await app.fetch(`/a/${board.id}`, { cookie: bob.cookie, headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
    assert.equal(page.status, 403);
    assert.ok((await page.text()).includes(sentence.replace("'", '&#39;')), 'the page says so');
    // The operator sees which plugin and why.
    await app.plugins!.idle();
    const failed = (await app.catalog.listAudit({ actionPrefix: 'plugin.failed' }))[0];
    assert.equal(failed?.actorId, 'plugin:broken');
    assert.deepEqual(failed?.detail, { plugin: 'broken', hook: 'authz.role', reason: 'threw', error: 'threw: down' });
    // Someone with no access at all, and an anonymous visitor, are told nothing more than before.
    const eve = await app.person('Eve');
    const other = await app.artifact(eve.user);
    assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${other.id}`)).status, 401);
  } finally {
    await app.close();
  }
});

test('authz.artifacts adds artifacts to the home list with the role authz.role gives, in a fixed number of queries', async () => {
  const extra: string[] = [];
  const app = await makeApp({
    plugins: [
      plugin('teams', {
        authz: {
          artifacts: ({ principal }: { principal: { kind: string; email?: string } }) => (principal.kind === 'user' && principal.email === 'bob@example.com' ? extra : []),
          role: ({ principal, artifact, role }: { principal: { email?: string }; artifact: { id: string }; role: string | null }) =>
            principal.email === 'bob@example.com' && extra.includes(artifact.id) ? (role ?? 'commenter') : undefined,
        },
      }),
    ],
  });
  try {
    const ada = await app.person('Ada');
    const bob = await app.person('Bob');
    await app.artifact(bob.user, { title: 'Bob own' });
    const first = await app.artifact(ada.user, { title: 'Team 0' });
    extra.push(first.id);
    const queries = countQueries(app);
    let before = queries();
    let seen = await list(app, bob.cookie);
    const costOne = queries() - before;
    assert.deepEqual(seen.map((a) => [a.title, a.role]).sort(), [['Bob own', 'owner'], ['Team 0', 'commenter']]);
    for (let i = 1; i < 12; i++) extra.push((await app.artifact(ada.user, { title: `Team ${i}` })).id);
    // An id that is not an artifact, or that the role hook does not open, is dropped.
    extra.push('a_nope');
    app.ctx.access.invalidate();
    before = queries();
    seen = await list(app, bob.cookie);
    assert.equal(queries() - before, costOne, 'the same number of queries for 1 extra and for 12');
    assert.equal(seen.length, 13);
    assert.ok(seen.every((a) => a.title === 'Bob own' || a.role === 'commenter'));
    // Ada sees only her own.
    assert.equal((await list(app, ada.cookie)).length, 12);
  } finally {
    await app.close();
  }
});

test('ctx.host.artifacts.list: outside the trash, in id order, by owner, a page at a time, capped per call', async () => {
  let host: { artifacts: { list(options?: unknown): Promise<{ artifacts: Array<Record<string, unknown>>; next: string | null }> } } | null = null;
  const app = await makeApp({ plugins: [plugin('lister', { routes: [{ method: 'GET', path: '/x', handler: (_input: unknown, ctx: { host: typeof host }) => ((host = ctx.host), new Response('ok')) }] })] });
  try {
    const ada = await app.person('Ada');
    const bob = await app.person('Bob');
    const made: string[] = [];
    for (let i = 0; i < 5; i++) made.push((await app.artifact(ada.user, { title: `A${i}` })).id);
    made.push((await app.artifact(bob.user, { title: 'B' })).id);
    const trashed = await app.artifact(bob.user, { title: 'Gone' });
    await app.catalog.trashArtifact(trashed.id);
    assert.equal((await app.fetch('/plugins/lister/x', { cookie: ada.cookie })).status, 200);
    const list = host!.artifacts.list.bind(host!.artifacts);
    const all = await list();
    assert.deepEqual(all.artifacts.map((a) => a.id), [...made].sort());
    assert.equal(all.next, null);
    assert.deepEqual(Object.keys(all.artifacts[0]!).sort(), ['id', 'owner', 'title', 'type', 'updatedAt']);
    assert.deepEqual((await list({ owner: bob.user.id })).artifacts.map((a) => a.title), ['B']);
    const seen: string[] = [];
    let after: string | null | undefined;
    do {
      const page = await list({ limit: 2, ...(after ? { after } : {}) });
      assert.ok(page.artifacts.length <= 2);
      seen.push(...page.artifacts.map((a) => String(a.id)));
      after = page.next;
    } while (after);
    assert.deepEqual(seen, [...made].sort());
    for (let i = 0; i < 205; i++) await app.artifact(bob.user, { title: `Many ${i}` });
    const capped = await list({ limit: 1000 });
    assert.equal(capped.artifacts.length, 200, 'at most 200 a call');
    assert.ok(capped.next);
    await assert.rejects(list({ limit: 0 }), /limit/);
    await assert.rejects(list({ owner: 3 }), /owner/);
  } finally {
    await app.close();
  }
});

test('static-groups on the home list: its artifacts are listed once per cacheSeconds, and the list costs what it did', async () => {
  const staticGroups = ((await import(fileURLToPath(new URL('../../../examples/host-plugins/static-groups.mjs', import.meta.url)))) as { default: unknown }).default;
  const app = await makeApp({ plugins: [{ plugin: staticGroups, config: { groups: { staff: '@example.com' }, roles: { staff: 'viewer' } } }] });
  try {
    const ada = await app.person('Ada');
    const bob = await app.person('Bob');
    for (let i = 0; i < 3; i++) await app.artifact(ada.user, { title: `Ada ${i}` });
    const queries = countQueries(app);
    const seen = await list(app, bob.cookie);
    assert.deepEqual(seen.map((a) => a.role), ['viewer', 'viewer', 'viewer']);
    // Warm: the list comes from the plugin's store, so more artifacts do not cost more queries.
    let before = queries();
    await list(app, bob.cookie);
    const warm = queries() - before;
    for (let i = 3; i < 12; i++) await app.artifact(ada.user, { title: `Ada ${i}` });
    app.ctx.access.invalidate();
    before = queries();
    assert.equal((await list(app, bob.cookie)).length, 3, 'the kept list, until cacheSeconds pass');
    assert.ok(queries() - before <= warm + 2, `${queries() - before} queries, ${warm} when warm`);
  } finally {
    await app.close();
  }
});

test('every app-route guard refuses with the plugin sentence, before the action happens', async () => {
  const seen: string[] = [];
  const app = await makeApp({
    plugins: [
      plugin('policy', {
        guard: ({ action }: { action: string }) => {
          seen.push(action);
          return { deny: `No ${action} here.` };
        },
      }),
    ],
  });
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    const refused = async (response: Response, action: string): Promise<void> => {
      assert.equal(response.status, 403, action);
      const body = (await response.json()) as { code: string; message: string };
      assert.deepEqual([body.code, body.message], ['not_granted', `No ${action} here.`]);
    };
    await refused(await app.fetch(`/api/open-artifact.artifact.archive?id=${board.id}`, { cookie: ada.cookie }), 'artifact.export');
    await refused(await app.fetch('/api/open-artifact.artifacts.import', { cookie: ada.cookie, body: JSON.stringify({ title: 'Up' }), headers: { 'content-type': 'application/zip' } }), 'artifact.import');
    await refused(await app.fetch('/api/open-artifact.artifacts.ask', { cookie: ada.cookie, body: { id: board.id, text: 'hello' } }), 'agent.ask');
    await refused(await app.fetch('/api/open-artifact.artifact.share', { cookie: ada.cookie, body: { id: board.id, access: 'link' } }), 'share.change');
    await refused(await app.fetch('/api/open-artifact.artifacts.delete', { cookie: ada.cookie, body: { id: board.id } }), 'artifact.delete');
    // Nothing happened.
    const row = await app.catalog.getArtifact(board.id);
    assert.equal(row?.trashedAt, null);
    assert.equal(row?.generalAccess, 'restricted');
    assert.equal(app.heard.outbox.length, 0);
    assert.deepEqual(seen, ['artifact.export', 'artifact.import', 'agent.ask', 'share.change', 'artifact.delete']);
  } finally {
    await app.close();
  }
});

test('a guard that throws refuses (fail closed) with a sentence to try again', async () => {
  const app = await makeApp({ plugins: [plugin('flaky', { guard: () => { throw new Error('unreachable'); } })] });
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    const response = await app.fetch('/api/open-artifact.artifacts.delete', { cookie: ada.cookie, body: { id: board.id } });
    assert.equal(response.status, 403);
    assert.match(((await response.json()) as { message: string }).message, /could not be checked just now/);
    assert.equal((await app.catalog.getArtifact(board.id))?.trashedAt, null);
  } finally {
    await app.close();
  }
});

test('the import guard of a known type removes the unpacked folder when it refuses', async () => {
  const removed: string[] = [];
  const app = await makeApp({ plugins: [plugin('types', { guard: ({ action, detail }: { action: string; detail: { type: string | null } }) => (action === 'artifact.create' && detail.type === 'docs' ? { deny: 'No Docs here.' } : undefined) })] });
  try {
    app.ctx.removeArtifact = async (id) => {
      removed.push(id);
    };
    const ada = await app.person('Ada');
    const send = (type: string) => app.fetch('/api/open-artifact.artifacts.import', { cookie: ada.cookie, body: JSON.stringify({ type, title: 'Up' }), headers: { 'content-type': 'application/zip' } });
    const docs = await send('docs');
    assert.equal(docs.status, 403);
    assert.equal(removed.length, 1);
    assert.equal((await send('whiteboard')).status, 201);
    assert.equal(removed.length, 1);
  } finally {
    await app.close();
  }
});

test('events reach the plugins after the fact; audit entries go through the one wrapper', async () => {
  const heard: Array<[string, unknown]> = [];
  const app = await makeApp({
    plugins: [
      plugin('listen', {
        on: {
          'artifact.changed': (event: { changes: unknown }) => void heard.push(['artifact.changed', event.changes]),
          'artifact.trashed': (event: { artifact: { title: string } }) => void heard.push(['artifact.trashed', event.artifact.title]),
          'artifact.restored': () => void heard.push(['artifact.restored', null]),
          'artifact.created': (event: { via: string }) => void heard.push(['artifact.created', event.via]),
          'agent.requested': (event: { text: string }) => void heard.push(['agent.requested', event.text]),
          audit: (event: { action: string }) => void heard.push(['audit', event.action]),
        },
      }),
    ],
  });
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user, { title: 'Old' });
    assert.equal((await app.fetch('/api/open-artifact.artifacts.update', { cookie: ada.cookie, body: { id: board.id, title: 'New' } })).status, 200);
    assert.equal((await app.fetch('/api/open-artifact.artifacts.ask', { cookie: ada.cookie, body: { id: board.id, text: 'tidy up' } })).status, 200);
    assert.equal((await app.fetch('/api/open-artifact.artifacts.delete', { cookie: ada.cookie, body: { id: board.id } })).status, 200);
    assert.equal((await app.fetch('/api/open-artifact.artifacts.restore', { cookie: ada.cookie, body: { id: board.id } })).status, 200);
    assert.equal((await app.fetch('/api/open-artifact.artifacts.import', { cookie: ada.cookie, body: JSON.stringify({ title: 'Up' }), headers: { 'content-type': 'application/zip' } })).status, 201);
    await app.plugins!.idle();
    assert.deepEqual(
      heard.filter(([name]) => name !== 'audit'),
      [
        ['artifact.changed', { title: 'New' }],
        ['agent.requested', 'tidy up'],
        ['artifact.trashed', 'New'],
        ['artifact.restored', null],
        ['artifact.created', 'import'],
      ],
    );
    const audits = heard.filter(([name]) => name === 'audit').map(([, action]) => action);
    for (const action of ['artifact.trash', 'artifact.restore', 'artifact.import']) assert.ok(audits.includes(action), action);
  } finally {
    await app.close();
  }
});

test('an event handler that throws or hangs never slows or breaks the request', async () => {
  const app = await makeApp({
    plugins: [
      { ...plugin('slow', { on: { 'artifact.changed': () => new Promise(() => undefined), 'artifact.trashed': () => { throw new Error('boom'); } } }), timeoutMs: 200 },
    ],
  });
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    const started = Date.now();
    assert.equal((await app.fetch('/api/open-artifact.artifacts.update', { cookie: ada.cookie, body: { id: board.id, title: 'New' } })).status, 200);
    assert.equal((await app.fetch('/api/open-artifact.artifacts.delete', { cookie: ada.cookie, body: { id: board.id } })).status, 200);
    assert.ok(Date.now() - started < 150, 'the requests did not wait');
    await app.plugins!.idle();
    assert.ok(app.logs.some((line) => line.includes('boom')), app.logs.join('\n'));
  } finally {
    await app.close();
  }
});

test('plugin routes: the session person, anonymous with a Bearer header, same-origin writes, the body cap, the app headers', async () => {
  const app = await makeApp({
    plugins: [
      plugin('hello', {
        routes: [
          { method: 'GET', path: '/who', handler: ({ principal }: { principal: { kind: string; name?: string } }) => Response.json({ kind: principal.kind, name: principal.name ?? null }) },
          { method: 'POST', path: '/echo', handler: async ({ request }: { request: Request }) => new Response(String((await request.arrayBuffer()).byteLength)) },
          { method: 'POST', path: '/hook', public: true, handler: () => new Response('ok') },
        ],
      }),
    ],
  });
  try {
    const ada = await app.person('Ada');
    const who = await app.fetch('/plugins/hello/who', { cookie: ada.cookie });
    assert.equal(who.status, 200);
    assert.deepEqual(await who.json(), { kind: 'user', name: 'Ada' });
    assert.equal(who.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(who.headers.get('x-frame-options'), 'DENY');
    // A Bearer header is not the session's person (and is not refused like on the app's own routes).
    const bearer = await app.fetch('/plugins/hello/who', { cookie: ada.cookie, headers: { authorization: 'Bearer oa_whatever' } });
    assert.deepEqual(await bearer.json(), { kind: 'anonymous', name: null });
    assert.equal((await app.fetch('/plugins/hello/echo', { cookie: ada.cookie, body: 'abc' })).status, 200);
    assert.equal((await app.fetch('/plugins/hello/echo', { cookie: ada.cookie, body: 'abc', origin: 'https://evil.example' })).status, 403);
    assert.equal((await app.fetch('/plugins/hello/hook', { body: 'x', origin: 'https://other.example' })).status, 200, 'a public route takes a cross-site write');
    const big = await app.fetch('/plugins/hello/echo', { cookie: ada.cookie, body: new Uint8Array(PLUGIN_ROUTE_MAX_BYTES + 1) });
    assert.equal(big.status, 413);
    assert.equal((await app.fetch('/plugins/nobody/who', { cookie: ada.cookie })).status, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/open-artifact.admin.plugins: the list for a site admin, settings by name only; refused to others', async () => {
  const app = await makeApp({ plugins: [{ ...plugin('keyed', { config: { token: { type: 'secret' } } }), config: { token: 'x'.repeat(40) } }] });
  try {
    const admin = await app.person('Root', 'root@example.com', { siteRole: 'admin' });
    const member = await app.person('Ada');
    const answer = await app.fetch('/api/open-artifact.admin.plugins', { cookie: admin.cookie });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers.get('cache-control'), 'no-store');
    const text = await answer.text();
    assert.ok(!text.includes('x'.repeat(40)), 'no secret value');
    const body = JSON.parse(text) as { plugins: Array<{ id: string }> };
    assert.deepEqual(body.plugins.map((p) => p.id), ['keyed']);
    const refused = await app.fetch('/api/open-artifact.admin.plugins', { cookie: member.cookie });
    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { message: string }).message, 'Only a site admin sees the plugin list.');
  } finally {
    await app.close();
  }
});

test('share.invited: one per person newly named, with the Shell address; share.changed once', async () => {
  const invited: Array<{ invitee: unknown; role: string; url: string }> = [];
  let changed = 0;
  const app = await makeApp({
    plugins: [
      plugin('mail', {
        on: {
          'share.invited': (event: { invitee: unknown; role: string; url: string }) => void invited.push({ invitee: event.invitee, role: event.role, url: event.url }),
          'share.changed': () => void changed++,
        },
      }),
    ],
  });
  try {
    const ada = await app.person('Ada');
    const bob = await app.person('Bob');
    const board = await app.artifact(ada.user);
    const response = await app.fetch('/api/open-artifact.artifact.share', { cookie: ada.cookie, body: { id: board.id, members: { 'email:new@example.com': 'viewer', 'email:bob@example.com': 'editor' } } });
    assert.equal(response.status, 200);
    await app.plugins!.idle();
    assert.equal(changed, 1);
    assert.equal(invited.length, 2);
    assert.ok(invited.every((i) => i.url === `${app.config.appOrigin}/a/${board.id}`), JSON.stringify(invited));
    assert.deepEqual(invited.map((i) => i.role).sort(), ['editor', 'viewer']);
    // Changing a role is not a new invitation.
    const again = await app.fetch('/api/open-artifact.artifact.share', { cookie: ada.cookie, body: { id: board.id, access: 'link' } });
    assert.equal(again.status, 200);
    await app.plugins!.idle();
    assert.equal(invited.length, 2);
    assert.equal(changed, 2);
    void bob;
  } finally {
    await app.close();
  }
});

test('wake.deliver: a delivered Ask is not put in the outbox; without one it is', async () => {
  const delivered: unknown[] = [];
  let take = true;
  const app = await makeApp({
    plugins: [
      plugin('runner', {
        wake: {
          deliver: ({ payload, owner }: { payload: { requests: Array<{ text: string }> }; owner: { name: string } }) => {
            if (!take) return undefined;
            delivered.push([owner.name, payload.requests[0]?.text]);
            return { delivered: true };
          },
        },
      }),
    ],
  });
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    const ask = async (): Promise<unknown> => (await app.fetch('/api/open-artifact.artifacts.ask', { cookie: ada.cookie, body: { id: board.id, text: 'go' } })).json();
    assert.deepEqual(await ask(), { via: 'link', status: 'delivered' });
    assert.deepEqual(delivered, [['Ada', 'go']]);
    assert.equal(app.heard.outbox.length, 0);
    take = false;
    const answer = (await ask()) as { status: string };
    assert.notEqual(answer.status, 'delivered');
  } finally {
    await app.close();
  }
});

test("a ui address that is not http(s) or a path stops the site with the entry named", async () => {
  await assert.rejects(
    makeApp({ plugins: [plugin('brand', { ui: { links: [{ label: 'Bad', href: 'javascript:alert(1)', where: 'home' }] } })] }),
    /Plugin "brand", ui\.links\[0\]: href must be an https: or http: address, or a path starting with \//,
  );
});

test("the home page's boot carries the plugins' brand and the links a page may follow", async () => {
  const app = await makeApp({
    plugins: [
      plugin('brand', {
        ui: {
          // Plain http: to another site is dropped from the pages (this site is not served over it).
          brand: { name: 'Acme Artifacts', logoUrl: 'http://cdn.example.com/logo.png' },
          links: [
            { label: 'Help', href: 'https://help.example.com/', where: 'account-menu' },
            { label: 'Policy', href: '/plugins/brand/policy', where: 'home' },
            { label: 'Plain', href: 'http://plain.example.com/', where: 'home' },
          ],
        },
      }),
    ],
  });
  try {
    const ada = await app.person('Ada');
    const page = await app.fetch('/', { cookie: ada.cookie, headers: { accept: 'text/html' } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.notEqual(html, HOME_HTML);
    const boot = bootOf(html, '__OPEN_ARTIFACT_HOME__') as HomeBoot;
    assert.deepEqual(boot.cloud?.site, {
      links: [
        { label: 'Help', href: 'https://help.example.com/', where: 'account-menu' },
        { label: 'Policy', href: '/plugins/brand/policy', where: 'home' },
      ],
      brand: { name: 'Acme Artifacts' },
    });
  } finally {
    await app.close();
  }
});

test('GUARD_PATHS: every guarded action has its helper, and the code calls each helper as often as it lists paths', async () => {
  const helperOf: Record<keyof typeof GUARD_PATHS, keyof typeof guards> = {
    'artifact.create': 'create',
    'artifact.import': 'import',
    'artifact.delete': 'delete',
    'artifact.export': 'export',
    'share.change': 'share',
    'link.connect': 'linkConnect',
    'link.publish': 'linkPublish',
    'type.publish': 'typePublish',
    'mcp.connect': 'mcpConnect',
    'agent.ask': 'ask',
  };
  const root = fileURLToPath(new URL('../src/core', import.meta.url));
  const files = (await readdir(root, { recursive: true })).filter((name) => name.endsWith('.ts') && !name.startsWith('plugins'));
  const source = (await Promise.all(files.map((name) => readFile(join(root, name), 'utf8')))).join('\n');
  for (const [action, paths] of Object.entries(GUARD_PATHS) as Array<[keyof typeof GUARD_PATHS, readonly string[]]>) {
    const helper = helperOf[action];
    assert.equal(typeof guards[helper], 'function', action);
    const calls = source.split(`guards.${helper}(`).length - 1;
    // link.publish is asked twice on one path (before replacing, and again once the real type is known).
    assert.ok(calls >= paths.length, `${action}: ${calls} calls of guards.${helper} for ${paths.length} paths`);
  }
});

test("the list entry's cacheSeconds replaces the plugin's: 0 asks authz.role on every request", async () => {
  let asked = 0;
  const app = await makeApp({ plugins: [{ ...plugin('fresh', { authz: { cacheSeconds: 300, role: () => void asked++ } }), cacheSeconds: 0 }] });
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    for (let i = 0; i < 3; i++) assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: ada.cookie })).status, 200);
    assert.ok(asked >= 3, `${asked}`);
  } finally {
    await app.close();
  }
});
