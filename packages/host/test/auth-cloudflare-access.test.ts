import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { ACCESS_JWT_HEADER, accessLogoutUrl, cloudflareAccessProvider } from '../src/core/auth/cloudflare-access.ts';
import { parseConfig, ConfigError } from '../src/core/config.ts';
import { base64urlEncode } from '../src/core/crypto.ts';
import { makeHost, setCookies, type TestHost } from './auth-fixture.ts';

const TEAM = 'https://acme.cloudflareaccess.com';
const AUD = 'aud-of-the-open-artifact-app';
const CERTS = `${TEAM}/cdn-cgi/access/certs`;

type Alg = 'RS256' | 'ES256';
interface FakeKey {
  kid: string;
  alg: Alg;
  privateKey: CryptoKey;
  jwk: JsonWebKey;
}

async function newKey(kid: string, alg: Alg): Promise<FakeKey> {
  const pair =
    alg === 'RS256'
      ? await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
      : await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, alg, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg, use: 'sig' } as JsonWebKey };
}

const enc = (value: unknown): string => base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));

async function signJwt(key: FakeKey, claims: Record<string, unknown>): Promise<string> {
  const input = `${enc({ alg: key.alg, typ: 'JWT', kid: key.kid })}.${enc(claims)}`;
  const algorithm = key.alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
  const signature = new Uint8Array(await crypto.subtle.sign(algorithm, key.privateKey, new TextEncoder().encode(input)));
  return `${input}.${base64urlEncode(signature)}`;
}

let rsa: FakeKey;
let ec: FakeKey;
let impostor: FakeKey;
let rotated: FakeKey;
let published: FakeKey[] = [];
let certCalls = 0;
let host: TestHost;
const realFetch = globalThis.fetch;

const fakeFetch: typeof fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === CERTS) {
    certCalls++;
    return Response.json({ keys: published.map((k) => k.jwk), public_cert: { kid: 'x', cert: '' }, public_certs: [] });
  }
  return new Response('not found', { status: 404 });
};

/** Claims Access would send for Ada now (the host's clock), with overrides. */
function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(host.ctx.now().getTime() / 1000);
  return { aud: [AUD], email: 'ada@example.com', exp: now + 600, iat: now, nbf: now, iss: TEAM, type: 'app', identity_nonce: 'n', sub: 'access-sub-ada', country: 'GB', ...over };
}

async function me(headers: Record<string, string> = {}, cookies?: Record<string, string>): Promise<{ response: Response; body: { principal: { kind: string; id?: string; email?: string } } }> {
  const response = await host.fetch('/api/open-artifact.auth.me', { headers, ...(cookies ? { cookies } : {}) });
  return { response, body: (await response.json()) as { principal: { kind: string; id?: string; email?: string } } };
}

before(async () => {
  [rsa, ec, impostor, rotated] = await Promise.all([newKey('k1', 'RS256'), newKey('k2', 'ES256'), newKey('k1', 'RS256'), newKey('k3', 'RS256')]);
  published = [rsa, ec];
  globalThis.fetch = fakeFetch;
  host = await makeHost({ OA_AUTH: JSON.stringify([{ kind: 'cloudflare-access', teamDomain: 'acme.cloudflareaccess.com', aud: AUD }]), OA_SIGNUP: 'open' });
});

afterEach(() => {
  published = [rsa, ec];
});

after(async () => {
  globalThis.fetch = realFetch;
  await host.close();
});

test('the configuration takes a team domain (bare or https) and an AUD; refuses http and paths', () => {
  const parse = (entry: Record<string, unknown>) => parseConfig({ OA_SIGNING_KEYS: 's'.repeat(40), OA_AUTH: JSON.stringify([entry]) }).auth[0];
  assert.deepEqual(parse({ kind: 'cloudflare-access', teamDomain: 'acme.cloudflareaccess.com', aud: 'a' }), { kind: 'cloudflare-access', teamDomain: TEAM, aud: 'a' });
  assert.deepEqual(parse({ kind: 'cloudflare-access', teamDomain: `${TEAM}/`, aud: 'a' }), { kind: 'cloudflare-access', teamDomain: TEAM, aud: 'a' });
  assert.throws(() => parse({ kind: 'cloudflare-access', teamDomain: 'http://acme.cloudflareaccess.com', aud: 'a' }), ConfigError);
  assert.throws(() => parse({ kind: 'cloudflare-access', teamDomain: `${TEAM}/cdn-cgi`, aud: 'a' }), ConfigError);
  assert.throws(() => parse({ kind: 'cloudflare-access', teamDomain: TEAM }), ConfigError);
});

test('a valid assertion with no session signs the person in and sets a session cookie', async () => {
  const { response, body } = await me({ [ACCESS_JWT_HEADER]: await signJwt(rsa, claims({ groups: ['eng', { name: 'design' }] })) });
  assert.equal(body.principal.kind, 'user');
  assert.equal(body.principal.email, 'ada@example.com');
  const cookie = setCookies(response).oa_session;
  assert.ok(cookie, 'a session cookie is set');
  const user = (await host.catalog.findUserByEmail('ada@example.com'))!;
  assert.equal(user.emailVerified, true);
  assert.deepEqual(await host.catalog.userGroups(user.id), ['cloudflare-access:design', 'cloudflare-access:eng']);
  assert.equal((await host.catalog.findIdentity('cloudflare-access', 'access-sub-ada'))?.userId, user.id);

  // The session then works on its own (a request without the header: a bypassed path).
  const again = await me({}, { oa_session: cookie });
  assert.equal(again.body.principal.id, user.id);
  // And with the same person's assertion it is kept (no new session).
  const same = await me({ [ACCESS_JWT_HEADER]: await signJwt(ec, claims()) }, { oa_session: cookie });
  assert.equal(same.body.principal.id, user.id);
  assert.equal(setCookies(same.response).oa_session, undefined);
});

test('a session of someone else than the assertion names is ended, and the assertion signs in', async () => {
  const first = await me({ [ACCESS_JWT_HEADER]: await signJwt(rsa, claims()) });
  const adaCookie = setCookies(first.response).oa_session!;
  const bob = await me({ [ACCESS_JWT_HEADER]: await signJwt(rsa, claims({ sub: 'access-sub-bob', email: 'bob@example.com' })) }, { oa_session: adaCookie });
  assert.equal(bob.body.principal.email, 'bob@example.com');
  assert.ok(setCookies(bob.response).oa_session);
  assert.equal(await host.catalog.findSession(adaCookie), undefined, "Ada's session is gone");
});

test('the header is never trusted unverified', async () => {
  const refused = async (token: string, why: string): Promise<void> => {
    const { response, body } = await me({ [ACCESS_JWT_HEADER]: token });
    assert.equal(body.principal.kind, 'anonymous', why);
    assert.equal(setCookies(response).oa_session, undefined, why);
  };
  await refused('not-a-jwt', 'garbage');
  await refused(`${enc({ alg: 'none', typ: 'JWT' })}.${enc(claims())}.`, 'alg none');
  await refused(await signJwt(impostor, claims()), 'signed by another key with the same kid');
  await refused(await signJwt(rsa, claims({ aud: ['another-application'] })), 'another AUD');
  await refused(await signJwt(rsa, claims({ aud: 'another-application' })), 'another AUD (string)');
  await refused(await signJwt(rsa, claims({ iss: 'https://evil.cloudflareaccess.com' })), 'another team');
  const now = Math.floor(host.ctx.now().getTime() / 1000);
  await refused(await signJwt(rsa, claims({ exp: now - 120 })), 'expired');
  await refused(await signJwt(rsa, claims({ nbf: now + 600 })), 'not yet valid');
  await refused(await signJwt(rsa, claims({ sub: '', email: undefined, common_name: 'svc.access' })), 'a service token');
  await refused(await signJwt(rsa, claims({ email: undefined })), 'no email');
  // Tampered claims under a good signature.
  const good = await signJwt(rsa, claims());
  const [h, , sig] = good.split('.');
  await refused(`${h}.${enc(claims({ email: 'admin@example.com' }))}.${sig}`, 'tampered payload');
});

test('keys are cached, and an unknown kid refetches them once (rotation)', async () => {
  const provider = cloudflareAccessProvider({ kind: 'cloudflare-access', teamDomain: TEAM, aud: AUD }, fakeFetch);
  const at = host.ctx.now().getTime();
  const before = certCalls;
  assert.ok(await provider.verify(await signJwt(rsa, claims()), at));
  assert.ok(await provider.verify(await signJwt(ec, claims()), at));
  assert.equal(certCalls - before, 1, 'one fetch for two tokens');
  published = [rotated];
  assert.ok(await provider.verify(await signJwt(rotated, claims()), at), 'a rotated key is found by refetching');
  assert.equal(certCalls - before, 2);
  assert.equal(await provider.verify(await signJwt(impostor, claims()), at), null);
  assert.equal(certCalls - before, 3, 'an unknown or bad kid costs one refetch, not a loop');
});

test("auth.me names Access's logout address, so a page can offer it before signing out", async () => {
  const anon = (await (await host.fetch('/api/open-artifact.auth.me')).json()) as { accessLogoutUrl?: string };
  assert.equal(anon.accessLogoutUrl, `${TEAM}/cdn-cgi/access/logout`);
});

test('sign-out says Access keeps its own session and links to the team logout', async () => {
  const signIn = await me({ [ACCESS_JWT_HEADER]: await signJwt(rsa, claims()) });
  const cookie = setCookies(signIn.response).oa_session!;
  const json = await host.fetch('/auth/sign-out', { method: 'POST', headers: { origin: host.config.appOrigin }, cookies: { oa_session: cookie } });
  assert.deepEqual(await json.json(), { signedOut: true, accessLogoutUrl: `${TEAM}/cdn-cgi/access/logout` });
  assert.equal(await host.catalog.findSession(cookie), undefined);
  const page = await host.fetch('/auth/sign-out', { method: 'POST', headers: { origin: host.config.appOrigin, accept: 'text/html' } });
  const html = await page.text();
  assert.match(html, /Cloudflare Access/);
  assert.ok(html.includes(accessLogoutUrl({ teamDomain: TEAM })));
});
