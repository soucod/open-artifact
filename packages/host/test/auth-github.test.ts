import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { makeHost, setCookies, type TestHost } from './auth-fixture.ts';

const WEB = 'https://gh.test';
const API = 'https://api.gh.test';

let emails: Array<{ email: string; primary: boolean; verified: boolean }> = [];
let user: Record<string, unknown> = {};
const seen: Array<{ url: string; init?: RequestInit }> = [];

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  seen.push({ url, ...(init ? { init } : {}) });
  if (url === `${WEB}/login/oauth/access_token`) {
    const form = new URLSearchParams(String(init?.body));
    if (form.get('code') !== 'good') return Response.json({ error: 'bad_verification_code' });
    return Response.json({ access_token: 'gho_x', token_type: 'bearer' });
  }
  const auth = new Headers(init?.headers).get('authorization');
  if (auth !== 'Bearer gho_x') return new Response('{}', { status: 401 });
  if (url === `${API}/user`) return Response.json(user);
  if (url === `${API}/user/emails`) return Response.json(emails);
  return new Response('{}', { status: 404 });
};

let host: TestHost;

before(async () => {
  host = await makeHost({ OA_AUTH: JSON.stringify([{ kind: 'github', clientId: 'gh-client', clientSecret: 'gh-secret' }]), OA_SIGNUP: 'open' }, { fetch: fakeFetch, github: { web: WEB, api: API } });
});

after(() => host.close());

async function signIn(code = 'good', returnTo = '/a/art_9'): Promise<Response> {
  const start = await host.fetch(`/auth/github/start?return_to=${encodeURIComponent(returnTo)}`);
  assert.equal(start.status, 303);
  const location = new URL(start.headers.get('location')!);
  assert.equal(`${location.origin}${location.pathname}`, `${WEB}/login/oauth/authorize`);
  assert.equal(location.searchParams.get('client_id'), 'gh-client');
  assert.equal(location.searchParams.get('redirect_uri'), 'http://localhost:4900/auth/github/callback');
  const state = location.searchParams.get('state')!;
  return host.fetch(`/auth/github/callback?code=${code}&state=${state}`, { cookies: { oa_flow: setCookies(start).oa_flow! } });
}

test('GitHub: the primary verified email, name and avatar', async () => {
  user = { id: 101, login: 'ada', name: 'Ada Lovelace', avatar_url: 'https://avatars.test/101' };
  emails = [
    { email: 'old@example.com', primary: false, verified: true },
    { email: 'Ada@Example.com', primary: true, verified: true },
  ];
  const response = await signIn();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/a/art_9');
  assert.ok(setCookies(response).oa_session);
  const identity = (await host.catalog.findIdentity('github', '101'))!;
  const record = (await host.catalog.getUser(identity.userId))!;
  assert.equal(record.name, 'Ada Lovelace');
  assert.equal(record.email, 'ada@example.com');
  assert.equal(record.emailVerified, true);
  assert.equal(record.avatar, 'https://avatars.test/101');
  const token = seen.find((s) => s.url.endsWith('/access_token'))!;
  assert.equal(new URLSearchParams(String(token.init?.body)).get('client_secret'), 'gh-secret');
});

test('GitHub: an unverified primary email is kept unverified and never links to an existing account', async () => {
  const existing = await host.catalog.createUser({ name: 'Bo', email: 'bo@example.com', emailVerified: true });
  user = { id: 202, login: 'mallory' };
  emails = [{ email: 'bo@example.com', primary: true, verified: false }];
  const response = await signIn();
  assert.equal(response.status, 303);
  const identity = (await host.catalog.findIdentity('github', '202'))!;
  assert.notEqual(identity.userId, existing.id, 'not linked to Bo');
  const record = (await host.catalog.getUser(identity.userId))!;
  assert.equal(record.name, 'mallory');
  assert.equal(record.email, null, 'the address belongs to someone else');
  assert.equal(record.emailVerified, false);
});

test('GitHub: a refused code, or a callback without the flow cookie, does not sign in', async () => {
  user = { id: 303, login: 'x' };
  const bad = await signIn('bad');
  assert.equal(bad.status, 502);
  assert.equal(setCookies(bad).oa_session, undefined);
  const noCookie = await host.fetch('/auth/github/callback?code=good&state=abc');
  assert.equal(noCookie.status, 400);
  assert.equal(await host.catalog.findIdentity('github', '303'), undefined);
});
