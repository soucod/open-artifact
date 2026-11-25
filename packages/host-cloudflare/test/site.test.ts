/**
 * The product Worker's app origin (`site.ts`):
 *
 * - the host core's own app suites (`app-security`, `app-share`, `app-roles`, `plugins-host`, `plugins-recheck`,
 *   `admin-audit`, `app-access` in `packages/host/test/`), unchanged,
 *   with the Worker behind their fixture (`site-app-fixture.ts`, put in place by `site-app-hooks.ts`). Skipped: the
 *   three roles tests that read the core fixture's made-up token text (the Worker mints real tokens), and
 *   `app-bearer` (it mounts its own router);
 * - what is the Worker's own: its router matches the core's, the health route, content-host routing (unknown ids,
 *   cookies, the Worker's call headers), the 32 MiB import cap, a configuration error, the debug stats gate.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appRouter, connectedAppRoutes, Router } from '@open-artifact/host';
import { LINK_API_PREFIX, LINK_ROUTES, type HomeBoot } from '@open-artifact/protocol';
import { CLOUDFLARE_IMPORT_MAX_BYTES, HEALTH_PATH, IMPORT_PATH, STATS_PATH, Site, productRouter } from '../src/site.ts';
import { ROOM_CALL_HEADER } from '../src/room-calls.ts';
import { ARTIFACT_HEADER } from '../src/room.ts';
import { HUB_CALL_HEADER } from '../src/hub.ts';
import { ADMIN_LINK_TOKENS_PATH, ADMIN_LINK_TOKENS_REVOKE_PATH } from '../src/admin.ts';
import { bootOf, makeApp, OWNER_KEY } from './site-app-fixture.ts';
import { fakeD1 } from './d1-fake.ts';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const hooks = fileURLToPath(new URL('./site-app-hooks.ts', import.meta.url));
const FAKE_TOKEN_TESTS = ['editor, commenter, viewer: their own role and user', 'link guest: their link role, no user', 'anonymous on a public artifact: viewer, no user'];
/**
 * Plugin tests that reach past the requests: a removal hook set on the test's context (the Worker's rooms delete the
 * folder), and a timing that assumes the response does not wait (the fixture awaits what the Worker hands
 * `waitUntil`, plugin handlers included, before it answers).
 */
const NODE_ONLY_PLUGIN_TESTS = [
  'the import guard of a known type removes the unpacked folder when it refuses',
  'an event handler that throws or hangs never slows or breaks the request',
  // The Node host's command line, not an app route.
  'open-artifact-host audit: lines or --json, the same filters',
  "open-artifact-host plugin role: the same answer in sentences or --json, the plugins from the site's list",
  // A Worker takes no plain-http origin but localhost (`config.test.ts`): its origins are always potentially trustworthy.
  'on a plain-http LAN app origin, no COOP and no Origin-Agent-Cluster \\(a browser ignores both there\\); CORP stays',
];

/** The core suites run against the Worker, and how many of their tests pass at least. */
const CORE_SUITES: Record<string, number> = { 'app-security': 10, 'app-share': 10, 'app-roles': 10, 'plugins-host': 10, 'plugins-recheck': 6, 'admin-audit': 1, 'app-access': 1 };

for (const [suite, least] of Object.entries(CORE_SUITES)) {
  test(`the core's ${suite} tests pass against the Worker`, () => {
    const skip = [...FAKE_TOKEN_TESTS, ...NODE_ONLY_PLUGIN_TESTS];
    const args = ['--import', hooks, '--test', '--test-reporter=tap', ...skip.map((name) => `--test-skip-pattern=^${name}$`), join(repo, `packages/host/test/${suite}.test.ts`)];
    const { NODE_TEST_CONTEXT: _, ...env } = process.env;
    const child = spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', env, timeout: 120_000 });
    const output = `${child.stdout}\n${child.stderr}`;
    const passed = Number(/^# pass (\d+)/m.exec(output)?.[1] ?? 0);
    const failed = Number(/^# fail (\d+)/m.exec(output)?.[1] ?? -1);
    assert.equal(failed, 0, output.slice(-4000));
    assert.ok(passed >= least, `${passed} passed:\n${output.slice(-2000)}`);
  });
}

test("the Worker's router has the core's routes, the Link and connected-app routes, the import route first (its cap)", () => {
  const app = appRouter().routes().map((r) => `${r.method} ${r.pattern}`);
  const agents = connectedAppRoutes(new Router()).routes().map((r) => `${r.method} ${r.pattern}`);
  const site = { hub: { stream: async () => new Response() }, build: { version: '0.0.0-test' } } as unknown as Site;
  const product = productRouter(site).routes().map((r) => `${r.method} ${r.pattern}`);
  const core = new Set([...app, ...agents]);
  assert.deepEqual([...core].filter((route) => !product.includes(route)), [], 'every core route is served');
  const extra = [...new Set(product)].filter((route) => !core.has(route));
  const link = (route: string): boolean => route.split(' ')[1]!.startsWith(LINK_API_PREFIX) || route.endsWith(' /link/device');
  assert.deepEqual(extra.filter((route) => !link(route)).sort(), [`POST ${ADMIN_LINK_TOKENS_PATH}`, `POST ${ADMIN_LINK_TOKENS_REVOKE_PATH}`], 'the only others are the Link API, its device page and the admin token routes');
  for (const name of Object.values(LINK_ROUTES)) assert.ok(product.some((route) => route.endsWith(` ${LINK_API_PREFIX}${name}`)), name);
  assert.ok(product.indexOf(`POST ${IMPORT_PATH}`) < product.lastIndexOf(`POST ${IMPORT_PATH}`), 'the capped import route is matched first');
});

test('health answers on any host without a session; HEAD has no body', async () => {
  const app = await makeApp();
  try {
    const health = await app.fetch(HEALTH_PATH);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { openArtifact: 1, version: '0.0.0-test' });
    assert.equal((await app.fetch(HEALTH_PATH, { method: 'HEAD' })).status, 200);
    const onContent = await app.fetch(`http://art-0000000000.content.localhost:4900${HEALTH_PATH}`);
    assert.equal(onContent.status, 200);
  } finally {
    await app.close();
  }
});

test('a content host: an unknown id makes no object; a known one gets no cookie and sets none', async () => {
  const app = await makeApp();
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    const host = `http://${board.id.replace('_', '-')}.content.localhost:4900`;
    assert.equal((await app.fetch('http://art-zzzzzzzzzz.content.localhost:4900/whiteboard/x/')).status, 404);
    const page = await app.fetch(`${host}/whiteboard/x/`, { cookie: ada.cookie });
    assert.equal(page.status, 200);
    assert.equal(await page.text(), 'a page of the fake room');
    assert.equal(page.headers.get('set-cookie'), null);
    assert.equal(page.headers.get('x-room-saw-cookie'), 'no', 'the Cookie header is not passed on');
    assert.equal(page.headers.get('origin-agent-cluster'), '?1');
  } finally {
    await app.close();
  }
});

test('a content host on https asks for an origin-keyed agent cluster too (both Worker origins are trustworthy)', async () => {
  const app = await makeApp({ env: { OA_APP_ORIGIN: 'https://app.example.com', OA_CONTENT_ORIGIN: 'https://{id}.content.example.net' } });
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    const page = await app.fetch(`https://${board.id.replace('_', '-')}.content.example.net/whiteboard/x/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('origin-agent-cluster'), '?1');
    await page.body?.cancel();
  } finally {
    await app.close();
  }
});

test("a browser cannot send the Worker's call headers on: they are stripped", async () => {
  const app = await makeApp();
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    const host = `http://${board.id.replace('_', '-')}.content.localhost:4900`;
    // With the room-call header kept, the fake object would answer a call (JSON 404 "No call"); stripped, it is a page.
    const answer = await app.fetch(`${host}/destroy?id=${board.id}`, { headers: { [ROOM_CALL_HEADER]: '1', [ARTIFACT_HEADER]: 'art_other', [HUB_CALL_HEADER]: '1' } });
    assert.equal(await answer.text(), 'a page of the fake room');
  } finally {
    await app.close();
  }
});

test(`an upload larger than ${CLOUDFLARE_IMPORT_MAX_BYTES / 1024 / 1024} MiB is refused, by its length or as it streams`, async () => {
  const app = await makeApp();
  try {
    const sam = await app.person('Sam');
    const declared = await app.fetch(IMPORT_PATH, { cookie: sam.cookie, body: 'x', headers: { 'content-type': 'application/zip', 'content-length': String(CLOUDFLARE_IMPORT_MAX_BYTES + 1) } });
    assert.equal(declared.status, 413);
    // A Request made from bytes carries no Content-Length header: the cap counts the body as it streams.
    const big = new Uint8Array(CLOUDFLARE_IMPORT_MAX_BYTES + 1);
    const streamed = await app.fetch(IMPORT_PATH, { cookie: sam.cookie, body: big, headers: { 'content-type': 'application/zip' } });
    assert.equal(streamed.status, 413, await streamed.clone().text());
    const fits = await app.fetch(IMPORT_PATH, { cookie: sam.cookie, body: JSON.stringify({ type: 'design', title: 'Small' }), headers: { 'content-type': 'application/zip' } });
    assert.equal(fits.status, 201);
  } finally {
    await app.close();
  }
});

test("the home page says the Worker's own upload limit and OA_TRASH_DAYS", async () => {
  const app = await makeApp({ env: { OA_TRASH_DAYS: '7' } });
  try {
    const sam = await app.person('Sam');
    const home = await app.fetch('/', { cookie: sam.cookie });
    assert.equal(home.status, 200);
    const boot = bootOf(await home.text(), '__OPEN_ARTIFACT_HOME__') as HomeBoot;
    assert.equal(boot.cloud?.trashDays, 7);
    assert.deepEqual(boot.cloud?.limits, { importBytes: CLOUDFLARE_IMPORT_MAX_BYTES });
  } finally {
    await app.close();
  }
});

test('the template pages are not served as files; a missing UI file is a 404', async () => {
  const app = await makeApp();
  try {
    assert.equal((await app.fetch('/_open-artifact/shell/index.html')).status, 404);
    assert.equal((await app.fetch('/_open-artifact/home/')).status, 404);
    assert.equal((await app.fetch('/_open-artifact/shell/assets/index-Ab12.js')).status, 200);
  } finally {
    await app.close();
  }
});

test('debug stats: only with OA_DEBUG_STATS=1 on a localhost app origin', async () => {
  const on = await makeApp({ env: { OA_DEBUG_STATS: '1' } });
  try {
    const home = await on.fetch('/');
    assert.match(home.headers.get('x-open-artifact-d1') ?? '', /^queries=\d+;read=\d+;written=\d+$/);
    const stats = await on.fetch(STATS_PATH);
    assert.equal(stats.status, 200);
    const body = (await stats.json()) as { worker: { d1: { queries: number } }; hub: { streams: number } };
    assert.ok(body.worker.d1.queries > 0);
    assert.equal(body.hub.streams, 0);
  } finally {
    await on.close();
  }
  const off = await makeApp();
  try {
    assert.equal((await off.fetch('/')).headers.get('x-open-artifact-d1'), null);
    assert.equal((await off.fetch(STATS_PATH)).status, 404);
  } finally {
    await off.close();
  }
});

test('a configuration error answers every request with a 500 naming the variable', async () => {
  const stub = { idFromName: (name: string) => ({ toString: () => name }), get: () => ({ fetch: async () => new Response() }) };
  const site = new Site(
    { DB: fakeD1(), ROOMS: stub, HUB: stub, ASSETS: { fetch: async () => new Response() }, OA_SIGNING_KEYS: 'k'.repeat(40), OA_APP_ORIGIN: 'http://artifacts.example.com', OA_OWNER_KEY: OWNER_KEY },
    { version: 'x', types: [], shellHtml: '', homeHtml: '' },
    { log: () => undefined },
  );
  const answer = await site.fetch(new Request('http://artifacts.example.com/'), { waitUntil: () => undefined });
  assert.equal(answer.status, 500);
  assert.match(await answer.text(), /OA_APP_ORIGIN/);
});

test('an administrator mints a preset Link token (the CLI\'s link-token); nobody else can; it is revoked the same way', async () => {
  const app = await makeApp();
  try {
    const admin = await app.person('Root', 'root@example.com', { siteRole: 'admin' });
    const member = await app.person('Mo');
    const mint = (cookie: string, body: unknown, headers: Record<string, string> = {}) => app.fetch(ADMIN_LINK_TOKENS_PATH, { cookie, body, headers });
    assert.equal((await mint(member.cookie, { user: 'ada@example.com' })).status, 403, 'a member');
    assert.equal((await app.fetch(ADMIN_LINK_TOKENS_PATH, { body: { user: 'ada@example.com' } })).status, 401, 'nobody signed in');
    assert.ok([401, 403].includes((await mint(admin.cookie, { user: 'ada@example.com' }, { authorization: 'Bearer x' })).status), 'never with a token');
    assert.equal((await app.fetch(ADMIN_LINK_TOKENS_PATH, { cookie: admin.cookie, body: { user: 'ada@example.com' }, origin: 'https://evil.example' })).status, 403, 'cross-site');
    assert.equal((await mint(admin.cookie, { user: 'not an email' })).status, 400);

    const minted = await mint(admin.cookie, { user: 'Ada@Example.com', label: 'build box' });
    assert.equal(minted.status, 201);
    assert.equal(minted.headers.get('cache-control'), 'no-store');
    const body = (await minted.json()) as { id: string; user: string; remote: string; token: string };
    assert.equal(body.user, 'ada@example.com');
    assert.equal(body.remote, app.config.appOrigin);
    assert.match(body.token, /^oa_rt_/);
    const ada = (await app.catalog.findUserByEmail('ada@example.com'))!;
    assert.equal(ada.emailVerified, true);
    const token = (await app.catalog.getAgentToken(body.id))!;
    assert.deepEqual([token.userId, token.label, token.scopes], [ada.id, 'build box', ['link']]);

    const revoke = (cookie: string, id: string) => app.fetch(ADMIN_LINK_TOKENS_REVOKE_PATH, { cookie, body: { id } });
    assert.equal((await revoke(member.cookie, body.id)).status, 403);
    assert.equal((await revoke(admin.cookie, 'agt_nosuch')).status, 404);
    assert.deepEqual(await (await revoke(admin.cookie, body.id)).json(), { revoked: body.id });
    assert.deepEqual(await (await revoke(admin.cookie, body.id)).json(), { revoked: body.id, already: true });
    const audit = await app.catalog.driver.all<{ action: string }>("SELECT action FROM audit WHERE action LIKE 'link.token_%'");
    assert.deepEqual(audit.map((row) => row.action).sort(), ['link.token_issued', 'link.token_revoked']);
  } finally {
    await app.close();
  }
});

/** The one-domain layout: app and content hosts under `oa.localhost` (`OA_CONTENT_SAME_SITE`). */
const SAME_SITE_ENV = { OA_APP_ORIGIN: 'http://app.oa.localhost:4900', OA_CONTENT_ORIGIN: 'http://{id}.oa.localhost:4900', OA_CONTENT_SAME_SITE: 'true' };

test('same-site mode on the Worker: the layout is taken, content hosts route as content, cookies stay out', async () => {
  const app = await makeApp({ env: SAME_SITE_ENV });
  try {
    assert.equal(app.config.contentSameSite, true);
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    const page = await app.fetch(`http://${board.id.replace('_', '-')}.oa.localhost:4900/whiteboard/x/`, { cookie: `${ada.cookie}; other=1` });
    assert.equal(await page.text(), 'a page of the fake room');
    assert.equal(page.headers.get('x-room-saw-cookie'), 'no');
    assert.equal(page.headers.get('set-cookie'), null);
    assert.equal(page.headers.get('origin-agent-cluster'), '?1');
    // Another host of the zone, sent here by the wildcard route, gets no app.
    const www = await app.fetch('http://www.oa.localhost:4900/', { cookie: ada.cookie });
    assert.equal(www.status, 421);
    assert.equal((await app.fetch(`http://www.oa.localhost:4900${HEALTH_PATH}`)).status, 200, 'the health check answers on any host');
    // The app host is not a content host.
    const me = await app.fetch('/api/open-artifact.auth.me', { cookie: ada.cookie });
    assert.equal(((await me.json()) as { principal: { kind: string } }).principal.kind, 'user');
    assert.equal(me.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(me.headers.get('origin-agent-cluster'), '?1');
  } finally {
    await app.close();
  }
});

test('in two-origin mode the Worker answers the app only on its own host: a stray name of the content zone is 421', async () => {
  // The live layout: the app on `workers.dev`, the content on a wildcard route of another zone, which sends every name
  // of that zone here (`login.example.com` too).
  const app = await makeApp({ env: { OA_APP_ORIGIN: 'https://oa.someone.workers.dev', OA_CONTENT_ORIGIN: 'https://{id}.example.com' } });
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    for (const url of ['https://login.example.com/auth/sign-in', 'https://login.example.com/', 'https://example.com/', 'https://www.example.com/api/open-artifact.auth.me', 'https://login.example.com/mcp', 'https://login.example.com/s/abc', 'https://login.example.com/plugins/x/y', 'https://oa.someone.workers.dev.:443/', 'https://oa.someone.workers.dev:8443/', 'https://other.someone.workers.dev/auth/sign-in']) {
      const answer = await app.fetch(url, { cookie: ada.cookie });
      assert.equal(answer.status, 421, url);
      assert.equal(answer.headers.get('set-cookie'), null, url);
      assert.equal(answer.headers.get('location'), null, url);
      assert.match(answer.headers.get('content-type') ?? '', /^text\/plain/, url);
      assert.doesNotMatch(await answer.text(), /<form|<html/i, url);
    }
    const signIn = await app.fetch('https://login.example.com/auth/owner-key', { method: 'POST', headers: { origin: 'https://login.example.com', 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key: OWNER_KEY }).toString() });
    assert.equal(signIn.status, 421);
    assert.equal(signIn.headers.get('set-cookie'), null);
    assert.equal((await app.fetch(`https://login.example.com${HEALTH_PATH}`)).status, 200, 'the health check answers on any host');
    // The app host in any case and with its default port; a well-formed artifact name the catalog lacks is 404.
    assert.equal((await app.fetch('https://OA.Someone.workers.dev/api/open-artifact.auth.me', { cookie: ada.cookie })).status, 200);
    assert.equal((await app.fetch('https://oa.someone.workers.dev:443/api/open-artifact.auth.me', { cookie: ada.cookie })).status, 200);
    assert.equal((await app.fetch('https://art-0000000000000000.example.com/')).status, 404);
    assert.equal(await (await app.fetch(`https://${board.id.replace('_', '-')}.example.com/whiteboard/x/`)).text(), 'a page of the fake room');
  } finally {
    await app.close();
  }
});

test('the one-zone layout on the Worker: the Custom Domain app host is the app, other names of the zone are 421', async () => {
  // A Custom Domain `app.example.com` and the wildcard route `*.example.com/*` both match the app host: either way the
  // request's URL is the app's.
  const app = await makeApp({ env: { OA_APP_ORIGIN: 'https://app.example.com', OA_CONTENT_ORIGIN: 'https://{id}.example.com', OA_CONTENT_SAME_SITE: 'true' } });
  try {
    const ada = await app.person('Ada');
    assert.equal((await app.fetch('https://app.example.com/api/open-artifact.auth.me', { cookie: ada.cookie })).status, 200);
    assert.equal((await app.fetch('https://APP.example.com/api/open-artifact.auth.me', { cookie: ada.cookie })).status, 200);
    assert.equal((await app.fetch('https://login.example.com/auth/sign-in')).status, 421);
    assert.equal((await app.fetch('https://app.example.com./auth/sign-in')).status, 421);
  } finally {
    await app.close();
  }
});

test('without OA_CONTENT_SAME_SITE the Worker refuses one domain for both, naming the setting', async () => {
  const stub = { idFromName: (name: string) => ({ toString: () => name }), get: () => ({ fetch: async () => new Response() }) };
  const env = { DB: fakeD1(), ROOMS: stub, HUB: stub, ASSETS: { fetch: async () => new Response() }, OA_SIGNING_KEYS: 'k'.repeat(40), OA_OWNER_KEY: OWNER_KEY };
  const site = new Site({ ...env, OA_APP_ORIGIN: SAME_SITE_ENV.OA_APP_ORIGIN, OA_CONTENT_ORIGIN: SAME_SITE_ENV.OA_CONTENT_ORIGIN }, { version: 'x', types: [], shellHtml: '', homeHtml: '' }, { log: () => undefined });
  const answer = await site.fetch(new Request('http://app.oa.localhost:4900/'), { waitUntil: () => undefined });
  assert.equal(answer.status, 500);
  assert.match(await answer.text(), /OA_CONTENT_ORIGIN.*OA_CONTENT_SAME_SITE=true.*One domain for both/s);
});

test('the Worker refuses a tossed session cookie on the app routes and on MCP\'s, and a same-site write', async () => {
  const app = await makeApp({ env: SAME_SITE_ENV });
  try {
    const ada = await app.person('Ada');
    const mallory = await app.person('Mallory');
    for (const path of ['/api/open-artifact.auth.me', '/oauth/authorize?client_id=x']) {
      const victim = await app.person(`Victim ${path}`);
      const answer = await app.fetch(path, { cookie: `${mallory.cookie}; ${victim.cookie}` });
      await answer.body?.cancel();
      const clears = answer.headers.getSetCookie();
      assert.ok(clears.includes('oa_session=; Max-Age=0; Domain=oa.localhost; Path=/; HttpOnly; SameSite=Lax'), `${path}: ${clears.join(' | ')}`);
      assert.equal(await app.catalog.findSession(victim.cookie.split('=')[1]!), undefined, path);
    }
    assert.equal(await app.catalog.findSession(mallory.cookie.split('=')[1]!), undefined);
    assert.ok((await app.catalog.listAudit()).some((entry) => entry.action === 'auth.duplicate_cookie'));

    const board = await app.artifact(ada.user);
    const write = await app.fetch('/api/open-artifact.artifacts.update', { cookie: ada.cookie, origin: 'http://art-0.oa.localhost:4900', headers: { 'sec-fetch-site': 'same-site' }, body: { id: board.id, title: 'Renamed by a page' } });
    assert.equal(write.status, 403);
    assert.equal((await app.catalog.getArtifact(board.id))?.title, 'Board');
  } finally {
    await app.close();
  }
});

test('on the Worker a share link joins a signed-in person only on a top-level visit', async () => {
  const app = await makeApp({ env: SAME_SITE_ENV });
  try {
    const ada = await app.person('Ada');
    const bob = await app.person('Bob');
    const board = await app.artifact(ada.user, { generalAccess: 'link' });
    const { token } = await app.catalog.createLink(board.id, 'editor');
    const image = await app.fetch(`/s/${token}`, { cookie: bob.cookie, headers: { 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-site' } });
    assert.equal(image.status, 200);
    assert.match(await image.text(), /<form method="post">/);
    assert.equal((await app.catalog.listUserGuests(bob.user.id, board.id)).length, 0);
    const visit = await app.fetch(`/s/${token}`, { cookie: bob.cookie, headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' } });
    assert.equal(visit.status, 303);
    assert.equal((await app.catalog.listUserGuests(bob.user.id, board.id)).length, 1);
  } finally {
    await app.close();
  }
});
