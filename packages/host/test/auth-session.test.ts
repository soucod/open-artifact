import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { safeReturnTo } from '../src/core/auth/flow.ts';
import { authenticate, guestCookie, resolvePrincipal, SESSION_TTL_MS, startSession } from '../src/core/auth/session.ts';
import { newArtifactId } from '../src/core/catalog/catalog.ts';
import { parseConfig } from '../src/core/config.ts';
import { form, makeHost, setCookies, SIGNING_KEY, type TestHost } from './auth-fixture.ts';

const KEY = 'owner-key-0123456789-abcdef';
const HOUR = 3600_000;
let host: TestHost;

before(async () => {
  host = await makeHost({ OA_OWNER_KEY: KEY, OA_SIGNUP: 'open', OA_AUTH: JSON.stringify([{ kind: 'owner-key' }, { kind: 'github', clientId: 'gh-client-id', clientSecret: 'gh-client-secret-value' }]) });
});
after(() => host.close());

const req = (headers: Record<string, string> = {}): Request => new Request(`${host.config.appOrigin}/x`, { headers });
const cookie = (pairs: Record<string, string>): Record<string, string> => ({ cookie: Object.entries(pairs).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') });

async function session(name = 'User'): Promise<{ userId: string; token: string }> {
  const user = await host.catalog.createUser({ name });
  const line = await startSession(user, req({ 'user-agent': 'TestBrowser/1' }), host.ctx);
  const token = decodeURIComponent(line.split(';')[0]!.split('=')[1]!);
  return { userId: user.id, token };
}

test('resolvePrincipal: anonymous without credentials', async () => {
  assert.deepEqual(await resolvePrincipal(req(), host.ctx), { kind: 'anonymous' });
  const auth = await authenticate(req(), host.ctx);
  assert.equal(auth.credential, null);
  assert.deepEqual(auth.invalid, []);
});

test('resolvePrincipal: a user by session cookie, with groups', async () => {
  const { userId, token } = await session('Sam');
  await host.catalog.setUserGroups(userId, 'oidc:corp', ['oidc:corp:eng']);
  const principal = await resolvePrincipal(req(cookie({ oa_session: token })), host.ctx);
  assert.equal(principal.kind, 'user');
  assert.equal(principal.kind === 'user' && principal.id, userId);
  assert.deepEqual(principal.kind === 'user' && principal.groups, ['oidc:corp:eng']);
  assert.equal(principal.kind === 'user' && principal.siteRole, 'member');
});

test('sessions roll: touched (and the cookie re-sent) at most once an hour, 30 days from the last use', async () => {
  const { token } = await session();
  const first = await authenticate(req(cookie({ oa_session: token })), host.ctx);
  assert.equal(first.setCookie, undefined, 'just started: no touch');
  host.advance(HOUR + 1);
  const second = await authenticate(req(cookie({ oa_session: token })), host.ctx);
  assert.match(second.setCookie ?? '', /^oa_session=.*Max-Age=2592000/);
  const [stored] = (await host.catalog.listSessions((await host.catalog.findSession(token))!.userId));
  assert.equal(stored!.expiresAt, new Date(host.ctx.now().getTime() + SESSION_TTL_MS).toISOString());
  const third = await authenticate(req(cookie({ oa_session: token })), host.ctx);
  assert.equal(third.setCookie, undefined);
  // Unused for 30 days: gone.
  host.advance(SESSION_TTL_MS + 1);
  const late = await authenticate(req(cookie({ oa_session: token })), host.ctx);
  assert.equal(late.principal.kind, 'anonymous');
  assert.deepEqual(late.invalid, ['session']);
});

test('a revoked session or a disabled user is anonymous', async () => {
  const a = await session();
  await host.catalog.revokeUserSessions(a.userId);
  assert.equal((await resolvePrincipal(req(cookie({ oa_session: a.token })), host.ctx)).kind, 'anonymous');
  const b = await session();
  await host.catalog.disableUser(b.userId);
  assert.equal((await resolvePrincipal(req(cookie({ oa_session: b.token })), host.ctx)).kind, 'anonymous');
  assert.equal((await resolvePrincipal(req(cookie({ oa_session: 'made-up' })), host.ctx)).kind, 'anonymous');
});

test('an agent by Bearer token where agents are taken; an expired, revoked or unknown token is anonymous and marked invalid', async () => {
  const AGENTS = { agents: true };
  const user = await host.catalog.createUser({ name: 'Agent Owner', email: 'ao@x.example', emailVerified: true });
  const issued = await host.catalog.issueAgentToken({ userId: user.id, label: 'Claude Code', harness: 'claude-code', scopes: ['artifacts'], accessTtlMs: HOUR });
  const auth = await authenticate(req({ authorization: `Bearer ${issued.accessToken}` }), host.ctx, AGENTS);
  assert.equal(auth.credential, 'bearer');
  assert.equal(auth.principal.kind, 'agent');
  if (auth.principal.kind === 'agent') {
    assert.equal(auth.principal.user.id, user.id);
    assert.equal(auth.principal.label, 'Claude Code');
    assert.equal(auth.principal.harness, 'claude-code');
    assert.deepEqual(auth.principal.scopes, ['artifacts']);
  }
  assert.ok((await host.catalog.getAgentToken(issued.token.id))!.usedAt);

  // A bad Bearer never falls back to a cookie.
  const { token } = await session();
  const unknown = await authenticate(req({ authorization: 'Bearer oa_at_nope', ...cookie({ oa_session: token }) }), host.ctx, AGENTS);
  assert.deepEqual([unknown.principal.kind, unknown.invalid], ['anonymous', ['bearer']]);
  const malformed = await authenticate(req({ authorization: 'Basic abc' }), host.ctx, AGENTS);
  assert.deepEqual(malformed.invalid, ['bearer']);

  // Where agents are not taken (every route but Link's), a good token is refused too, and never falls back to a
  // cookie; another scheme (a proxy's Basic login) is not ours and is ignored.
  const elsewhere = await authenticate(req({ authorization: `Bearer ${issued.accessToken}`, ...cookie({ oa_session: token }) }), host.ctx);
  assert.deepEqual([elsewhere.principal.kind, elsewhere.credential, elsewhere.invalid], ['anonymous', null, ['bearer']]);
  const basic = await authenticate(req({ authorization: 'Basic abc', ...cookie({ oa_session: token }) }), host.ctx);
  assert.deepEqual([basic.principal.kind, basic.credential, basic.invalid], ['user', 'session', []]);

  host.advance(HOUR + 1);
  const expired = await authenticate(req({ authorization: `Bearer ${issued.accessToken}` }), host.ctx, AGENTS);
  assert.deepEqual([expired.principal.kind, expired.invalid], ['anonymous', ['bearer']]);

  const fresh = await host.catalog.issueAgentToken({ userId: user.id, label: 'x', scopes: [], accessTtlMs: HOUR });
  await host.catalog.revokeAgentToken(fresh.token.id);
  assert.deepEqual((await authenticate(req({ authorization: `Bearer ${fresh.accessToken}` }), host.ctx, AGENTS)).invalid, ['bearer']);
});

test('a guest by the artifact’s guest cookie; only for that artifact; a session wins', async () => {
  const owner = await host.catalog.createUser({ name: 'O' });
  const art = await host.catalog.createArtifact({ type: 'html', title: 'T', ownerUser: owner.id, generalAccess: 'link' });
  const other = await host.catalog.createArtifact({ type: 'html', title: 'U', ownerUser: owner.id });
  const { link } = await host.catalog.createLink(art.id, 'commenter');
  const { guest, secret } = await host.catalog.joinGuest(link.id, 'Gus');
  const name = guestCookie(host.config, art.id).name;
  assert.equal(name, `oa_guest_${art.id.replace('_', '-')}`);

  const principal = await resolvePrincipal(req(cookie({ [name]: secret })), host.ctx, { artifactId: art.id });
  assert.deepEqual(principal, { kind: 'guest', id: guest.id, name: 'Gus', link: link.id, artifact: art.id });
  assert.equal((await resolvePrincipal(req(cookie({ [name]: secret })), host.ctx)).kind, 'anonymous', 'no artifact named');
  // The cookie of one artifact does not open another, even if renamed.
  const otherName = guestCookie(host.config, other.id).name;
  const wrong = await authenticate(req(cookie({ [otherName]: secret })), host.ctx, { artifactId: other.id });
  assert.deepEqual([wrong.principal.kind, wrong.invalid], ['anonymous', ['guest']]);

  const { token } = await session('Signed In');
  const both = await resolvePrincipal(req(cookie({ [name]: secret, oa_session: token })), host.ctx, { artifactId: art.id });
  assert.equal(both.kind, 'user');

  // A removed guest is anonymous.
  await host.catalog.removeGuest(guest.id);
  assert.equal((await resolvePrincipal(req(cookie({ [name]: secret })), host.ctx, { artifactId: art.id })).kind, 'anonymous');
});

test('guest cookie attributes: http and https', () => {
  const id = newArtifactId();
  const http = guestCookie(host.config, id);
  assert.deepEqual(http, { name: `oa_guest_${id.replace('_', '-')}`, options: { path: '/', secure: false, httpOnly: true, sameSite: 'Lax', maxAge: 365 * 24 * 3600 } });
  const httpsConfig = parseConfig({ OA_SIGNING_KEYS: SIGNING_KEY, OA_APP_ORIGIN: 'https://app.example.com', OA_CONTENT_ORIGIN: 'https://{id}.c.example.net' });
  const https = guestCookie(httpsConfig, id);
  assert.equal(https.name, `__Host-oa_guest_${id.replace('_', '-')}`);
  assert.equal(https.options.secure, true);
});

test('return_to accepts same-origin paths only', () => {
  const config = host.config;
  assert.equal(safeReturnTo('/a/art_1?x=1#y', config), '/a/art_1?x=1#y');
  assert.equal(safeReturnTo(undefined, config), '/');
  assert.equal(safeReturnTo('', config), '/');
  for (const bad of ['//evil.example/x', '/\\evil.example', '\\\\evil.example', 'https://evil.example/', 'javascript:alert(1)', 'evil.example', '/%0d%0aSet-Cookie:x', '/\t/evil.example', '/\nx', 'http://localhost:4900.evil.example/']) {
    const got = safeReturnTo(bad, config);
    assert.ok(got === '/' || (got.startsWith('/') && !got.startsWith('//')), `${JSON.stringify(bad)} -> ${got}`);
    assert.equal(new URL(got, config.appOrigin).origin, config.appOrigin, bad);
  }
  assert.equal(safeReturnTo('//evil.example/x', config), '/');
  assert.equal(safeReturnTo('/\\evil.example', config), '/');
  assert.equal(safeReturnTo('https://evil.example/', config), '/');
});

test('the owner-key sign-in and the start route never redirect off the app origin', async () => {
  for (const bad of ['//evil.example', 'https://evil.example/', '/\\evil.example']) {
    const response = await host.fetch('/auth/owner-key', form({ key: KEY, return_to: bad }));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/');
    const start = await host.fetch(`/auth/owner-key/start?return_to=${encodeURIComponent(bad)}`);
    assert.equal(start.headers.get('location'), '/auth/sign-in?return_to=%2F');
  }
});

test('the sign-in page: providers, escaped return_to, a hashed fragment script, strict CSP, no secrets', async () => {
  const response = await host.fetch(`/auth/sign-in?return_to=${encodeURIComponent('/a/"><script>alert(1)</script>')}`, { headers: { 'accept-language': 'en' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const csp = response.headers.get('content-security-policy')!;
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  const html = await response.text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Continue with GitHub/);
  assert.match(html, /href="\/auth\/github\/start\?return_to=/);
  assert.match(html, /name="key" type="password"/);
  for (const secret of [KEY, SIGNING_KEY, 'gh-client-secret-value']) assert.ok(!html.includes(secret), 'no secret in the page');

  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script))).toString('base64');
  assert.ok(csp.includes(`'sha256-${digest}'`), 'the inline script is allowed by its hash only');
  assert.doesNotMatch(csp, /unsafe-inline'[^;]*script|script-src[^;]*unsafe-inline/);

  const zh = await (await host.fetch('/auth/sign-in', { headers: { 'accept-language': 'zh-CN,zh;q=0.9' } })).text();
  assert.match(zh, /登录/);
});

test('auth.me: the principal, the providers, the sign-in and sign-out addresses; 401 for a bad Bearer', async () => {
  const anon = await (await host.fetch('/api/open-artifact.auth.me')).json();
  assert.deepEqual(anon.principal, { kind: 'anonymous' });
  assert.deepEqual(anon.providers.map((p: { id: string }) => p.id), ['owner-key', 'github']);
  assert.equal(anon.signInUrl, 'http://localhost:4900/auth/sign-in');
  assert.equal(anon.signOutUrl, 'http://localhost:4900/auth/sign-out');
  assert.ok(!JSON.stringify(anon).includes('gh-client-secret-value'));
  // No Cloudflare Access on this site: nothing more to sign out of.
  assert.equal('accessLogoutUrl' in anon, false);

  const signedIn = await host.fetch('/auth/owner-key', form({ key: KEY }));
  const token = setCookies(signedIn).oa_session!;
  const me = await (await host.fetch('/api/open-artifact.auth.me', { cookies: { oa_session: token } })).json();
  assert.equal(me.principal.kind, 'user');
  assert.equal(me.principal.siteRole, 'admin');

  const bad = await host.fetch('/api/open-artifact.auth.me', { headers: { authorization: 'Bearer nope' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('www-authenticate'), 'Bearer error="invalid_token"');
  assert.equal((await bad.json()).code, 'unauthorized');
});

test('sessions: list, revoke one, revoke all; others’ sessions are not reachable', async () => {
  const login = async (): Promise<string> => setCookies(await host.fetch('/auth/owner-key', form({ key: KEY }))).oa_session!;
  const a = await login();
  const b = await login();
  const list = await (await host.fetch('/api/open-artifact.auth.sessions', { cookies: { oa_session: a } })).json();
  assert.ok(list.sessions.length >= 2);
  const current = list.sessions.find((s: { current: boolean }) => s.current);
  const otherSession = list.sessions.find((s: { current: boolean }) => !s.current);
  assert.ok(current && otherSession);
  assert.ok(!JSON.stringify(list).includes(a), 'the cookie value is not listed');

  assert.equal((await host.fetch('/api/open-artifact.auth.sessions')).status, 401);
  const stranger = await session('Stranger');
  const notMine = await host.fetch('/api/open-artifact.auth.sessions.revoke', { method: 'POST', body: JSON.stringify({ id: otherSession.id }), cookies: { oa_session: stranger.token } });
  assert.equal(notMine.status, 404);
  const crossSite = await host.fetch('/api/open-artifact.auth.sessions.revoke', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ all: true }), cookies: { oa_session: a } });
  assert.equal(crossSite.status, 403);

  const one = await host.fetch('/api/open-artifact.auth.sessions.revoke', { method: 'POST', body: JSON.stringify({ id: otherSession.id }), cookies: { oa_session: a } });
  assert.deepEqual(await one.json(), { revoked: 1 });
  assert.equal(setCookies(one).oa_session, undefined, 'the current session stays');
  assert.ok((await host.catalog.listAudit({ limit: 1000 })).some((a) => a.action === 'auth.sessions_revoked'));

  const all = await host.fetch('/api/open-artifact.auth.sessions.revoke', { method: 'POST', body: JSON.stringify({ all: true }), cookies: { oa_session: b } });
  assert.equal(setCookies(all).oa_session, '', 'the current cookie is cleared');
  assert.equal((await resolvePrincipal(req(cookie({ oa_session: a })), host.ctx)).kind, 'anonymous');
  assert.equal((await resolvePrincipal(req(cookie({ oa_session: b })), host.ctx)).kind, 'anonymous');
});

test('sign-out: same origin only; ends the session, clears the cookie, audits', async () => {
  const token = setCookies(await host.fetch('/auth/owner-key', form({ key: KEY }))).oa_session!;
  const evil = await host.fetch('/auth/sign-out', { method: 'POST', headers: { origin: 'https://evil.example' }, cookies: { oa_session: token } });
  assert.equal(evil.status, 403);
  const crossSite = await host.fetch('/auth/sign-out', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, cookies: { oa_session: token } });
  assert.equal(crossSite.status, 403);
  assert.equal((await resolvePrincipal(req(cookie({ oa_session: token })), host.ctx)).kind, 'user', 'still signed in');

  const out = await host.fetch('/auth/sign-out', { method: 'POST', headers: { origin: host.config.appOrigin }, cookies: { oa_session: token } });
  assert.equal(out.status, 200);
  assert.deepEqual(await out.json(), { signedOut: true });
  assert.match(out.headers.getSetCookie().join('\n'), /oa_session=; Max-Age=0/);
  assert.equal((await resolvePrincipal(req(cookie({ oa_session: token })), host.ctx)).kind, 'anonymous');
  assert.ok((await host.catalog.listAudit({ limit: 1000 })).some((a) => a.action === 'auth.sign_out'));

  // A form post from the page goes back to the sign-in page.
  const token2 = setCookies(await host.fetch('/auth/owner-key', form({ key: KEY }))).oa_session!;
  const page = await host.fetch('/auth/sign-out', { ...form({}, host.config.appOrigin), cookies: { oa_session: token2 } });
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/auth/sign-in');
});
