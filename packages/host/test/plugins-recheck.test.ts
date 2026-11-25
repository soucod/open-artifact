/**
 * Sessions a plugin's `auth.authenticate` makes are asked again on each request (the real core, with the
 * `header-auth` and `company-jwt` examples): the same person keeps the session, another person replaces it, no one
 * ends it, a failing plugin makes one request anonymous and keeps the session, `auth.recheck: false` opts out, and
 * sessions from other sign-in methods are never asked. A refused sign-up is told to the person (a page, a 401) and
 * audited once an hour.
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { cookiesSet, makeApp, type TestApp } from './app-fixture.ts';

const EXAMPLES = fileURLToPath(new URL('../../../examples/host-plugins/', import.meta.url));
type AuthPlugin = { id: string; auth: { authenticate: (...args: unknown[]) => unknown } };
const headerAuth = (await import(join(EXAMPLES, 'header-auth.mjs'))).default as AuthPlugin;
const companyJwt = (await import(join(EXAMPLES, 'company-jwt.mjs'))).default as { id: string };

const SECRET = 'proxy-secret-0123456789abcdef';
const KEY = 'test-signing-key-0123456789abcdef';
const ISSUER = 'https://login.corp.example';

/** What the proxy in front adds: the person's address and the shared secret. */
const proxy = (email: string): Record<string, string> => ({ 'x-forwarded-email': email, 'x-proxy-secret': SECRET });

async function me(app: TestApp, headers: Record<string, string>): Promise<{ status: number; who: string | null; cookies: Record<string, string>; body: Record<string, unknown> }> {
  const response = await app.fetch('/api/open-artifact.auth.me', { headers });
  const body = (await response.json()) as Record<string, unknown> & { principal?: { kind: string; email?: string } };
  return { status: response.status, who: body.principal?.kind === 'user' ? (body.principal.email ?? '?') : null, cookies: cookiesSet(response), body };
}

const sessionCount = async (app: TestApp): Promise<number> => (await app.catalog.driver.all<{ n: number }>('SELECT COUNT(*) AS n FROM sessions'))[0]!.n;

function headerApp(extra: { recheck?: boolean; failing?: () => boolean } = {}): Promise<TestApp> {
  let plugin: unknown = headerAuth;
  if (extra.recheck !== undefined || extra.failing) {
    const base = headerAuth;
    plugin = {
      ...base,
      auth: {
        ...base.auth,
        ...(extra.recheck !== undefined ? { recheck: extra.recheck } : {}),
        authenticate(...args: unknown[]) {
          if (extra.failing?.()) throw new Error('the proxy is down');
          return base.auth.authenticate(...args);
        },
      },
    };
  }
  return makeApp({ env: { OA_SIGNUP: 'open', PROXY_SECRET: SECRET }, plugins: [{ plugin, config: { secret: { env: 'PROXY_SECRET' } } }] });
}

test('header-auth: the session holds while the proxy sends the same person, ends when it stops, and is replaced by another person', async () => {
  const app = await headerApp();
  try {
    const first = await me(app, proxy('ada@example.com'));
    assert.equal(first.who, 'ada@example.com');
    const cookie = Object.entries(first.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    assert.ok(cookie.includes('oa_session='));
    const session = await app.catalog.driver.get<{ provider: string; subject: string; per_request: number }>('SELECT provider, subject, per_request FROM sessions');
    assert.deepEqual({ ...session }, { provider: 'plugin:header-auth', subject: 'ada@example.com', per_request: 1 });

    // The same person: the same session, no new one.
    const again = await me(app, { ...proxy('ada@example.com'), cookie });
    assert.equal(again.who, 'ada@example.com');
    assert.equal(again.cookies.oa_session, undefined, 'no new session cookie');
    assert.equal(await sessionCount(app), 1);

    // The proxy sends someone else (another person at this browser): Ada's session ends, Bob's starts.
    const bob = await me(app, { ...proxy('bob@example.com'), cookie });
    assert.equal(bob.who, 'bob@example.com');
    assert.ok(bob.cookies.oa_session, 'a new session cookie');
    assert.equal(await sessionCount(app), 1, "Ada's session is gone");
    const bobCookie = `oa_session=${bob.cookies.oa_session}`;

    // The proxy stops sending the header (signed out upstream): the session ends, the cookie is cleared.
    const gone = await me(app, { cookie: bobCookie });
    assert.equal(gone.who, null);
    assert.equal(gone.cookies.oa_session, '', 'the cookie is cleared');
    assert.equal(await sessionCount(app), 0);
    // A page visit then shows the sign-in page.
    const page = await app.fetch('/', { cookie: bobCookie, headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' } });
    assert.ok([302, 303].includes(page.status), `redirected to sign in (${page.status})`);
    assert.match(page.headers.get('location') ?? '', /\/auth\/sign-in/);
  } finally {
    await app.close();
  }
});

test('header-auth failing (throws): that request is anonymous, the session is kept and works again next time', async () => {
  let down = false;
  const app = await headerApp({ failing: () => down });
  try {
    const first = await me(app, proxy('ada@example.com'));
    const cookie = `oa_session=${first.cookies.oa_session}`;
    down = true;
    const failed = await me(app, { ...proxy('ada@example.com'), cookie });
    assert.equal(failed.who, null, 'anonymous while the plugin cannot say');
    assert.equal(failed.cookies.oa_session, undefined, 'the cookie is not cleared');
    assert.equal(await sessionCount(app), 1, 'the session is kept');
    const audited = await app.catalog.listAudit({ actionPrefix: 'plugin.failed' });
    assert.equal(audited[0]?.action, 'plugin.failed');
    down = false;
    assert.equal((await me(app, { ...proxy('ada@example.com'), cookie })).who, 'ada@example.com');
  } finally {
    await app.close();
  }
});

test('auth.recheck: false keeps the session whatever the plugin says later; other sign-in methods are never asked', async () => {
  const app = await headerApp({ recheck: false });
  try {
    const first = await me(app, proxy('ada@example.com'));
    const cookie = `oa_session=${first.cookies.oa_session}`;
    assert.equal((await me(app, { cookie })).who, 'ada@example.com', 'not asked again');
  } finally {
    await app.close();
  }
  let asked = 0;
  const counting = await makeApp({
    env: { OA_SIGNUP: 'open' },
    plugins: [{ plugin: { id: 'counter', apiVersion: 1, auth: { authenticate: () => { asked++; return null; } } } }],
  });
  try {
    // A session another method made (the fixture's, as a password or OAuth sign-in would).
    const ada = await counting.person('Ada');
    assert.equal((await me(counting, { cookie: ada.cookie })).who, 'ada@example.com');
    assert.equal(asked, 0, 'a session from another provider never asks the plugin');
  } finally {
    await counting.close();
  }
});

test('one request asks the plugin once, however many times it is authenticated on its way', async () => {
  let asked = 0;
  const base = headerAuth;
  const app = await makeApp({
    env: { OA_SIGNUP: 'open', PROXY_SECRET: SECRET },
    plugins: [{ plugin: { ...base, auth: { authenticate: (...args: unknown[]) => { asked++; return base.auth.authenticate(...args); } } }, config: { secret: { env: 'PROXY_SECRET' } } }],
  });
  try {
    const first = await me(app, proxy('ada@example.com'));
    assert.equal(asked, 1);
    const cookie = `oa_session=${first.cookies.oa_session}`;
    asked = 0;
    const list = await app.fetch('/api/open-artifact.artifacts', { cookie, headers: proxy('ada@example.com') });
    assert.equal(list.status, 200);
    assert.equal(asked, 1);
    assert.equal(await sessionCount(app), 1);
  } finally {
    await app.close();
  }
});

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
function mint(claims: Record<string, unknown>): string {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
  return `${body}.${createHmac('sha256', KEY).update(body).digest('base64url')}`;
}

function jwtApp(signup = 'open'): Promise<TestApp> {
  return makeApp({
    env: { OA_SIGNUP: signup, CORP_JWT_KEY: KEY },
    plugins: [{ plugin: companyJwt, config: { key: { env: 'CORP_JWT_KEY' }, issuer: ISSUER, departments: { design: 'editor', sales: 'viewer' } } }],
  });
}

test('company-jwt: another token replaces the session, no token ends it', async () => {
  const app = await jwtApp();
  try {
    const ann = await me(app, { cookie: `corp_token=${mint({ sub: 'e1', email: 'ann@corp.example', department: 'design' })}` });
    assert.equal(ann.who, 'ann@corp.example');
    const session = `oa_session=${ann.cookies.oa_session}`;
    const same = await me(app, { cookie: `${session}; corp_token=${mint({ sub: 'e1', email: 'ann@corp.example', department: 'design' })}` });
    assert.equal(same.who, 'ann@corp.example');
    const ben = await me(app, { cookie: `${session}; corp_token=${mint({ sub: 'e2', email: 'ben@corp.example', department: 'sales' })}` });
    assert.equal(ben.who, 'ben@corp.example');
    const none = await me(app, { cookie: `oa_session=${ben.cookies.oa_session}` });
    assert.equal(none.who, null);
    assert.equal(await sessionCount(app), 0);
  } finally {
    await app.close();
  }
});

test('a refused sign-up: the page says why, the API answers 401 with the reason, and it is audited once an hour', async () => {
  const app = await jwtApp();
  const closed = await makeApp({ env: { CORP_JWT_KEY: KEY }, plugins: [{ plugin: companyJwt, config: { key: { env: 'CORP_JWT_KEY' }, issuer: ISSUER, departments: { design: 'editor' } } }] });
  try {
    // company-jwt's own `auth.identity` refuses a department it does not list.
    const legal = { cookie: `corp_token=${mint({ sub: 'e9', email: 'lee@corp.example', department: 'legal' })}` };
    const page = await app.fetch('/', { headers: { ...legal, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' } });
    assert.equal(page.status, 403);
    assert.match(await page.text(), /Your department does not use this site yet\./);
    const api = await app.fetch('/api/open-artifact.artifacts', { headers: legal });
    assert.equal(api.status, 401);
    const body = (await api.json()) as { code: string; reason: string; message: string };
    assert.equal(body.code, 'sign_in_refused');
    assert.equal(body.reason, 'plugin_refused');
    assert.match(body.message, /department/);
    for (let i = 0; i < 3; i++) await app.fetch('/api/open-artifact.auth.me', { headers: legal });
    const refusals = await app.catalog.listAudit({ actionPrefix: 'auth.sign_in_refused' });
    assert.equal(refusals.filter((r) => r.action === 'auth.sign_in_refused').length, 1, 'once for this person within the hour');

    // The site's signup rule (no open signup here) refuses too: the reason is not_invited.
    const ann = { cookie: `corp_token=${mint({ sub: 'e1', email: 'ann@corp.example', department: 'design' })}` };
    const refused = await closed.fetch('/api/open-artifact.artifacts', { headers: ann });
    assert.equal(refused.status, 401);
    assert.equal(((await refused.json()) as { reason: string }).reason, 'not_invited');
    // The sign-in pages still answer (another method may work).
    assert.equal((await closed.fetch('/auth/sign-in', { headers: ann })).status, 200);
  } finally {
    await Promise.all([app.close(), closed.close()]);
  }
});
