/**
 * Same-site mode (`OA_CONTENT_SAME_SITE`) and the defences that hold whether it is on or not:
 *
 * - the setting, and the host names it still refuses;
 * - every write the router has refuses a request a sibling host started (`Sec-Fetch-Site: same-site`), a valid session
 *   cookie with it; the route list is read from the router the Node host mounts, as in `app-bearer.test.ts`;
 * - the GETs that change something (joining by a share link, the sign-in steps) do so only on a top-level visit;
 * - a cookie of the app's sent twice (cookie tossing) is refused, its sessions ended, the copies deleted and audited;
 * - the isolation headers of app answers;
 * - the Node host answering the app only on its own host name in same-site mode (421 for another name);
 * - the Node host sending `Origin-Agent-Cluster` on both origins only where a browser takes it (https or localhost).
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it, test } from 'node:test';
import { appRouter, DUPLICATE_COOKIE_ACTION, duplicateCookieClears, guardAppOrigin, type AppCtx } from '../src/core/app/index.ts';
import { ConfigError, parseConfig } from '../src/core/config.ts';
import { HostEvents } from '../src/core/events.ts';
import { json, type BaseCtx, type Router } from '../src/core/http.ts';
import { linkApiRoutes } from '../src/core/link/routes.ts';
import type { LinkServices } from '../src/core/link/services.ts';
import { connectedAppRoutes } from '../src/core/mcp/oauth.ts';
import { parseNodeEnv } from '../src/node/env.ts';
import { startHost } from '../src/node/host.ts';
import { cookiesSet, makeApp, type TestApp } from './app-fixture.ts';
import { APP, CIMD_ID, CIMD_REDIRECT, makeMcpHost, pkce } from './mcp-fixture.ts';

const KEY = 'k'.repeat(40);

/** The one-domain layout the e2e suite runs: app and content hosts under `oa.localhost`. */
const SAME_SITE_ENV = { OA_APP_ORIGIN: 'http://app.oa.localhost:4900', OA_CONTENT_ORIGIN: 'http://{id}.oa.localhost:4900', OA_CONTENT_SAME_SITE: 'true' };
const CONTENT = 'http://art-0000000000.oa.localhost:4900';

function fails(env: Record<string, string>, variable: string, pattern?: RegExp): void {
  assert.throws(
    () => parseConfig({ OA_SIGNING_KEYS: KEY, ...env }),
    (error: unknown) => error instanceof ConfigError && error.variable === variable && (!pattern || pattern.test(error.message)),
  );
}

describe('OA_CONTENT_SAME_SITE', () => {
  it('lets the content hosts share the app host\'s registrable domain', () => {
    const layouts: Array<Record<string, string>> = [
      { OA_APP_ORIGIN: 'https://app.example.com', OA_CONTENT_ORIGIN: 'https://{id}.example.com' },
      { OA_APP_ORIGIN: 'https://artifacts.example.com', OA_CONTENT_ORIGIN: 'https://{id}.content.example.com' },
      { OA_APP_ORIGIN: 'http://nas.lan', OA_CONTENT_ORIGIN: 'http://{id}.nas.lan', OA_ALLOW_HTTP: 'true' },
      { OA_APP_ORIGIN: 'http://app.oa.localhost:4900', OA_CONTENT_ORIGIN: 'http://{id}.oa.localhost:4900' },
    ];
    for (const env of layouts) {
      const config = parseConfig({ OA_SIGNING_KEYS: KEY, OA_CONTENT_SAME_SITE: 'true', ...env });
      assert.equal(config.contentSameSite, true, env.OA_APP_ORIGIN);
      assert.equal(config.appOrigin, env.OA_APP_ORIGIN);
    }
  });

  it('is off by default, and the refusal then names the setting and the guide section', () => {
    assert.equal('contentSameSite' in parseConfig({ OA_SIGNING_KEYS: KEY }), false);
    assert.equal('contentSameSite' in parseConfig({ OA_SIGNING_KEYS: KEY, OA_CONTENT_SAME_SITE: 'false' }), false);
    fails({ OA_APP_ORIGIN: 'https://app.example.com', OA_CONTENT_ORIGIN: 'https://{id}.example.com' }, 'OA_CONTENT_ORIGIN', /different site.*OA_CONTENT_SAME_SITE=true.*"One domain for both" in docs\/hosting\.md/);
    fails({ OA_APP_ORIGIN: 'http://app.oa.localhost:4900', OA_CONTENT_ORIGIN: 'http://{id}.oa.localhost:4900' }, 'OA_CONTENT_ORIGIN', /OA_CONTENT_SAME_SITE/);
  });

  it('never lets the app host be a content host, or sit under one, in either mode', () => {
    for (const sameSite of ['true', 'false']) {
      for (const app of ['https://art-abc.example.com', 'https://www.art-abc.example.com']) {
        fails({ OA_APP_ORIGIN: app, OA_CONTENT_ORIGIN: 'https://{id}.example.com', OA_CONTENT_SAME_SITE: sameSite }, 'OA_CONTENT_ORIGIN', /is, or is under, an artifact's content host/);
      }
      // Ports do not separate cookies: a content host on another port is the same name.
      fails({ OA_APP_ORIGIN: 'http://art-abc.oa.localhost:5000', OA_CONTENT_ORIGIN: 'http://{id}.oa.localhost:4900', OA_CONTENT_SAME_SITE: sameSite }, 'OA_CONTENT_ORIGIN', /is, or is under/);
    }
  });

  it('takes only a yes or a no', () => {
    fails({ OA_CONTENT_SAME_SITE: 'maybe' }, 'OA_CONTENT_SAME_SITE', /true or false/);
  });
});

/** Link services no call of this test reaches. */
function linkStub(): LinkServices {
  const never = (): never => {
    throw new Error('not used by this test');
  };
  return {
    files: { manifest: async () => never(), read: async () => never(), write: async () => never() },
    importArchive: async () => never(),
    removeArtifact: async () => never(),
    archive: async () => never(),
    action: async () => never(),
    contentTitle: async () => undefined,
    refreshAccess: async () => undefined,
    presence: { connected: () => undefined, disconnected: () => undefined, online: () => false },
    events: new HostEvents(),
    version: '0.0.0-test',
  };
}

/** The app router as `startHost` assembles it. */
function hostRouter(): Router<AppCtx> {
  const router = appRouter();
  linkApiRoutes(router, linkStub());
  connectedAppRoutes(router);
  return router;
}

function pathOf(pattern: string, id: string): string {
  return pattern
    .split('/')
    .map((segment) => (segment === '*' ? 'x' : segment.startsWith(':') ? (segment === ':id' ? id : 'x') : segment))
    .join('/');
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

describe('writes started by a sibling host', () => {
  let app: TestApp;
  let router: Router<AppCtx>;
  let cookie: string;
  let boardId: string;

  before(async () => {
    router = hostRouter();
    app = await makeApp({ router, env: SAME_SITE_ENV });
    const ada = await app.person('Ada');
    cookie = ada.cookie;
    boardId = (await app.artifact(ada.user, { generalAccess: 'link' })).id;
  });
  after(() => app.close());

  it('every state-changing route refuses Sec-Fetch-Site: same-site, a valid session cookie with it', async () => {
    const writes = router.routes().filter((r) => !SAFE.has(r.method));
    assert.ok(writes.length >= 20, `only ${writes.length} write routes`);
    for (const route of writes) {
      const method = route.method === '*' ? 'POST' : route.method;
      const path = pathOf(route.pattern, boardId);
      for (const site of ['same-site', 'cross-site']) {
        const response = await app.fetch(path, {
          method,
          cookie,
          origin: CONTENT,
          headers: { 'sec-fetch-site': site, 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
          body: { id: boardId, title: 'Renamed by a page', generalAccess: 'public', role: 'editor' },
        });
        const where = `${method} ${route.pattern} (${site})`;
        assert.equal(response.status, 403, where);
        assert.equal(((await response.json()) as { code: string }).code, 'not_granted', where);
      }
    }
    const board = await app.catalog.getArtifact(boardId);
    assert.equal(board?.title, 'Board');
    assert.equal(board?.trashedAt, null);
    assert.equal(board?.generalAccess, 'link');
  });

  it('the same write from the app origin itself goes through (the control)', async () => {
    const response = await app.fetch('/api/open-artifact.artifacts.update', { cookie, headers: { 'sec-fetch-site': 'same-origin' }, body: { id: boardId, title: 'Renamed' } });
    assert.equal(response.status, 200);
    assert.equal((await app.catalog.getArtifact(boardId))?.title, 'Renamed');
  });

  it('the MCP authorization form refuses a same-site post too', async () => {
    const host = await makeMcpHost();
    try {
      const { cookie: bob } = await host.person('Bob');
      const { challenge } = pkce();
      const params = { response_type: 'code', client_id: CIMD_ID, redirect_uri: CIMD_REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource: host.mcp.resource, decision: 'approve' };
      const refused = await host.fetch('/oauth/authorize', { cookie: bob, origin: APP.replace('app.', 'art-0.'), headers: { 'sec-fetch-site': 'same-site' }, form: params });
      assert.equal(refused.status, 403);
      assert.equal(refused.headers.get('location'), null);
    } finally {
      await host.close();
    }
  });
});

describe('GETs that change something', () => {
  let app: TestApp;
  let ada: Awaited<ReturnType<TestApp['person']>>;
  let boardId: string;
  let linkToken: string;

  before(async () => {
    app = await makeApp({ env: SAME_SITE_ENV });
    ada = await app.person('Ada');
    boardId = (await app.artifact(ada.user, { generalAccess: 'link' })).id;
    linkToken = (await app.catalog.createLink(boardId, 'editor')).token;
  });
  after(() => app.close());

  const joined = async (userId: string): Promise<boolean> => (await app.catalog.listUserGuests(userId, boardId)).length > 0;

  it('a share link joins a signed-in person only on their own top-level visit', async () => {
    const asks: Array<[string, Record<string, string>]> = [
      ['an <img>', { 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-site' }],
      ['a fetch', { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site' }],
      ['a frame', { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' }],
      ['a same-site navigation', { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-site' }],
    ];
    for (const [what, headers] of asks) {
      const bob = await app.person(`Bob ${what}`);
      const response = await app.fetch(`/s/${linkToken}`, { cookie: bob.cookie, headers });
      assert.equal(response.status, 200, what);
      const page = await response.text();
      assert.match(page, /<form method="post"><button type="submit">Open it<\/button><\/form>/, what);
      assert.equal(await joined(bob.user.id), false, what);
    }
  });

  it('a cross-site click (from chat or email) and a request without Fetch Metadata still join at once', async () => {
    const visits: Array<Record<string, string>> = [{ 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' }, {}];
    for (const [index, headers] of visits.entries()) {
      const carol = await app.person(`Carol ${index}`);
      const response = await app.fetch(`/s/${linkToken}`, { cookie: carol.cookie, headers });
      assert.equal(response.status, 303, JSON.stringify(headers));
      assert.equal(await joined(carol.user.id), true, JSON.stringify(headers));
    }
  });

  it('the page\'s button joins (a same-origin post); a same-site post does not', async () => {
    const dan = await app.person('Dan');
    const refused = await app.fetch(`/s/${linkToken}`, { method: 'POST', cookie: dan.cookie, origin: CONTENT, headers: { 'sec-fetch-site': 'same-site' }, body: '' });
    assert.equal(refused.status, 403);
    assert.equal(await joined(dan.user.id), false);
    const posted = await app.fetch(`/s/${linkToken}`, { method: 'POST', cookie: dan.cookie, headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
    assert.equal(posted.status, 303);
    assert.equal(await joined(dan.user.id), true);
  });

  it('the sign-in steps refuse anything but a top-level navigation', async () => {
    for (const path of ['/auth/github/start', '/auth/github/callback?code=x&state=y']) {
      const image = await app.fetch(path, { headers: { 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-site' } });
      assert.equal(image.status, 403, path);
      assert.equal(((await image.json()) as { code: string }).code, 'not_granted', path);
      const visit = await app.fetch(path, { headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin' } });
      assert.notEqual(visit.status, 403, path);
      await visit.body?.cancel();
    }
  });
});

describe('a cookie of the app sent twice', () => {
  let app: TestApp;

  before(async () => {
    app = await makeApp({ env: SAME_SITE_ENV });
  });
  after(() => app.close());

  const me = async (response: Response): Promise<string> => ((await response.json()) as { principal: { kind: string } }).principal.kind;

  for (const order of ['the person\'s first', 'the tossed one first']) {
    it(`is refused, both sessions ended, the copies deleted and audited (${order})`, async () => {
      const victim = await app.person(`Victim ${order}`);
      const attacker = await app.person(`Mallory ${order}`);
      const pair = order === 'the person\'s first' ? [victim.cookie, attacker.cookie] : [attacker.cookie, victim.cookie];
      const response = await app.fetch('/api/open-artifact.auth.me', { cookie: `theme=dark; ${pair.join('; ')}` });
      assert.equal(response.status, 200);
      assert.equal(await me(response), 'anonymous');
      for (const cookie of [victim.cookie, attacker.cookie]) assert.equal(await app.catalog.findSession(cookie.split('=')[1]!), undefined);
      const clears = response.headers.getSetCookie();
      assert.ok(clears.includes('oa_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'), clears.join('\n'));
      assert.ok(clears.includes('oa_session=; Max-Age=0; Domain=oa.localhost; Path=/; HttpOnly; SameSite=Lax'), clears.join('\n'));
      assert.ok(clears.some((line) => line.includes('Domain=oa.localhost; Path=/api/open-artifact.auth.me;')), clears.join('\n'));
      assert.ok(clears.every((line) => line.startsWith('oa_session=;')), 'theme is not ours and is left alone');
      const audit = (await app.catalog.listAudit()).find((entry) => entry.action === DUPLICATE_COOKIE_ACTION && JSON.stringify(entry.detail).includes('auth.me'));
      assert.ok(audit);
      assert.deepEqual(audit.detail, { names: ['oa_session'], path: '/api/open-artifact.auth.me' });
      assert.equal(JSON.stringify(audit).includes(victim.cookie.split('=')[1]!), false, 'no value is written down');
      // Signing in again works: one cookie, the person's.
      const again = await app.person(`Victim again ${order}`);
      assert.equal(await me(await app.fetch('/api/open-artifact.auth.me', { cookie: again.cookie })), 'user');
    });
  }

  it('a guest cookie and the flow cookie are covered too; the guest itself stays', async () => {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user, { generalAccess: 'link' });
    const { link } = await app.catalog.createLink(board.id, 'viewer');
    const { secret } = await app.catalog.joinGuest(link.id, 'Gus');
    const label = board.id.replace(/^art_/, 'art-');
    const name = `oa_guest_${label}`;
    const response = await app.fetch(`/a/${board.id}`, { cookie: `${name}=${secret}; ${name}=forged; oa_flow=a; oa_flow=b` });
    await response.body?.cancel();
    const names = new Set(response.headers.getSetCookie().map((line) => line.split('=')[0]));
    assert.deepEqual([...names].sort(), [name, 'oa_flow'].sort());
    assert.equal((await app.catalog.findGuestBySecret(secret))?.name, 'Gus');
  });

  it('a cookie of the app sent once, or someone else\'s sent twice, is left alone', async () => {
    const eve = await app.person('Eve');
    const response = await app.fetch('/api/open-artifact.auth.me', { cookie: `pref=1; pref=2; ${eve.cookie}` });
    assert.equal(await me(response), 'user');
    assert.deepEqual(response.headers.getSetCookie(), []);
  });

  it('on https the __Host- cookie can only be the host\'s: one clear, Secure, no Domain', () => {
    assert.deepEqual(duplicateCookieClears('__Host-oa_session', new URL('https://app.example.com/a/b')), ['__Host-oa_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax']);
    const plain = duplicateCookieClears('oa_session', new URL('http://192.168.1.20:4900/x'));
    assert.ok(plain.every((line) => !line.includes('Domain=')), 'no parent domain for an address');
  });

  it('guards any handler it wraps (the MCP one included)', async () => {
    let seen: string | null = 'unset';
    const guarded = guardAppOrigin(async (request: Request) => {
      seen = request.headers.get('cookie');
      return json({ ok: true });
    });
    const ctx: BaseCtx = app.ctx;
    const response = await guarded(new Request(`${app.config.appOrigin}/oauth/authorize`, { headers: { cookie: 'oa_session=a; other=1; oa_session=b' } }), ctx);
    assert.equal(seen, 'other=1');
    assert.ok(response.headers.getSetCookie().length > 0);
  });
});

test('app answers carry CORP same-origin and Origin-Agent-Cluster; the Shell page carries COOP too', async () => {
  const app = await makeApp({ env: SAME_SITE_ENV });
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    const api = await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: ada.cookie });
    assert.equal(api.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(api.headers.get('origin-agent-cluster'), '?1');
    assert.equal(api.headers.get('cross-origin-opener-policy'), null);
    await api.body?.cancel();
    const shell = await app.fetch(`/a/${board.id}`, { cookie: ada.cookie });
    assert.equal(shell.status, 200);
    assert.equal(shell.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(shell.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.equal(shell.headers.get('origin-agent-cluster'), '?1');
    await shell.body?.cancel();
    const missing = await app.fetch('/nothing-here');
    assert.equal(missing.headers.get('origin-agent-cluster'), '?1');
    assert.deepEqual(cookiesSet(missing), {});
  } finally {
    await app.close();
  }
});

test('the Node host in same-site mode answers the app only on its own host: another name of the domain gets 421', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-same-site-'));
  await mkdir(join(dir, 'assets', 'editors'), { recursive: true });
  const config = parseConfig({ ...SAME_SITE_ENV, OA_SIGNING_KEYS: KEY, OA_OWNER_KEY: 'o'.repeat(30) });
  const env = parseNodeEnv({ OA_DATA_DIR: join(dir, 'data'), OA_PORT: '0', OA_BIND: '127.0.0.1', OA_ASSETS_DIR: join(dir, 'assets') });
  const host = await startHost({ config, env, uiDir: join(dir, 'ui'), log: () => undefined });
  const as = async (hostHeader: string, path: string): Promise<{ status: number; body: string }> => {
    const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const url = new URL(host.listening);
      const req = request({ host: url.hostname, port: url.port, path, headers: { host: hostHeader } }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
    return answer;
  };
  try {
    assert.equal((await as('app.oa.localhost:4900', '/auth/sign-in')).status, 200);
    const www = await as('www.oa.localhost:4900', '/auth/sign-in');
    assert.equal(www.status, 421);
    assert.match(www.body, /www\.oa\.localhost:4900 is not this site's app host nor an artifact's/);
    assert.equal((await as('127.0.0.1:4900', '/')).status, 421);
    assert.equal((await as('www.oa.localhost:4900', '/__open-artifact/health')).status, 200);
    assert.notEqual((await as('art-0000000000.oa.localhost:4900', '/')).status, 421);
  } finally {
    await host.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the Node host sends Origin-Agent-Cluster on app and content hosts over https or localhost, not on a LAN http name', async () => {
  for (const [app, content, expected] of [
    ['https://app.example.com', 'https://{id}.content.example.net', '?1'],
    ['http://localhost:4900', 'http://{id}.content.localhost:4900', '?1'],
    ['http://nas.lan:4900', 'http://{id}.oa-content.lan:4900', undefined],
  ] as const) {
    const dir = await mkdtemp(join(tmpdir(), 'open-artifact-oac-'));
    await mkdir(join(dir, 'assets', 'editors'), { recursive: true });
    const config = parseConfig({ OA_APP_ORIGIN: app, OA_CONTENT_ORIGIN: content, OA_SIGNING_KEYS: KEY, OA_OWNER_KEY: 'o'.repeat(30) });
    const env = parseNodeEnv({ OA_DATA_DIR: join(dir, 'data'), OA_PORT: '0', OA_BIND: '127.0.0.1', OA_ASSETS_DIR: join(dir, 'assets') });
    const host = await startHost({ config, env, uiDir: join(dir, 'ui'), log: () => undefined });
    const headersOf = (hostHeader: string, path: string): Promise<Record<string, string | string[] | undefined>> =>
      new Promise((resolve, reject) => {
        const url = new URL(host.listening);
        const req = request({ host: url.hostname, port: url.port, path, headers: { host: hostHeader } }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.headers));
        });
        req.on('error', reject);
        req.end();
      });
    try {
      const signIn = await headersOf(new URL(app).host, '/auth/sign-in');
      assert.equal(signIn['origin-agent-cluster'], expected, `${app}: the app origin`);
      assert.equal(signIn['cross-origin-resource-policy'], 'same-origin', app);
      const page = await headersOf(new URL(content.replace('{id}', 'art-0000000000')).host, '/');
      assert.equal(page['origin-agent-cluster'], expected, `${content}: the content origin`);
    } finally {
      await host.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }
});
