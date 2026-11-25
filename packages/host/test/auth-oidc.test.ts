import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { pkceChallenge } from '../src/core/auth/flow.ts';
import { base64urlEncode } from '../src/core/crypto.ts';
import { makeHost, setCookies, type TestHost } from './auth-fixture.ts';

const ISSUER = 'https://idp.test/realm';
const CLIENT = 'oa-client';

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

async function signJwt(key: FakeKey, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const input = `${enc({ alg: key.alg, typ: 'JWT', kid: key.kid, ...header })}.${enc(claims)}`;
  const algorithm = key.alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
  const signature = new Uint8Array(await crypto.subtle.sign(algorithm, key.privateKey, new TextEncoder().encode(input)));
  return `${input}.${base64urlEncode(signature)}`;
}

/** A fake issuer behind a stubbed `fetch`. */
class FakeIssuer {
  published: FakeKey[] = [];
  calls: string[] = [];
  forms: URLSearchParams[] = [];
  /** Makes the next ID token. */
  token: () => Promise<string> = async () => 'none';
  discoveryIssuer = ISSUER;

  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    this.calls.push(url);
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({ issuer: this.discoveryIssuer, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys` });
    }
    if (url === `${ISSUER}/keys`) return Response.json({ keys: this.published.map((k) => k.jwk) });
    if (url === `${ISSUER}/token`) {
      this.forms.push(new URLSearchParams(String(init?.body)));
      return Response.json({ access_token: 'at', token_type: 'Bearer', id_token: await this.token() });
    }
    return new Response('not found', { status: 404 });
  };
}

let rsa: FakeKey;
let ec: FakeKey;
let other: FakeKey;
let rotated: FakeKey;
let issuer: FakeIssuer;
let host: TestHost;
let publicHost: TestHost;

before(async () => {
  [rsa, ec, other, rotated] = await Promise.all([newKey('rsa1', 'RS256'), newKey('ec1', 'ES256'), newKey('rsa1', 'RS256'), newKey('rsa2', 'RS256')]);
  issuer = new FakeIssuer();
  issuer.published = [rsa, ec];
  const auth = (secret: boolean): string => JSON.stringify([{ kind: 'oidc', id: 'corp', name: 'Corp SSO', issuer: ISSUER, clientId: CLIENT, ...(secret ? { clientSecret: 'shh' } : {}) }]);
  host = await makeHost({ OA_AUTH: auth(true), OA_SIGNUP: 'open' }, { fetch: issuer.fetch });
  publicHost = await makeHost({ OA_AUTH: auth(false), OA_SIGNUP: 'open' }, { fetch: issuer.fetch });
});

after(async () => {
  await host.close();
  await publicHost.close();
});

interface Started {
  state: string;
  nonce: string;
  challenge: string;
  location: URL;
  flow: string;
}

async function start(on: TestHost = host, returnTo = '/a/art_1'): Promise<Started> {
  const response = await on.fetch(`/auth/oidc:corp/start?return_to=${encodeURIComponent(returnTo)}`);
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('location')!);
  const flow = setCookies(response).oa_flow!;
  assert.ok(flow);
  return { state: location.searchParams.get('state')!, nonce: location.searchParams.get('nonce')!, challenge: location.searchParams.get('code_challenge')!, location, flow };
}

function claims(on: TestHost, nonce: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(on.ctx.now().getTime() / 1000);
  return { iss: ISSUER, aud: CLIENT, sub: 'u-1', email: 'Ada@Corp.example', email_verified: true, name: 'Ada', iat: now, exp: now + 300, nonce, ...extra };
}

async function callback(started: Started, on: TestHost = host, flow: string | null = started.flow, state = started.state): Promise<Response> {
  return on.fetch(`/auth/oidc:corp/callback?code=the-code&state=${encodeURIComponent(state)}`, { cookies: flow ? { oa_flow: flow } : {} });
}

async function failsWith(response: Response, status: number, pattern: RegExp): Promise<void> {
  assert.equal(response.status, status);
  assert.equal(setCookies(response).oa_session, undefined);
  assert.equal(setCookies(response).oa_flow, '', 'the flow cookie is cleared');
  assert.match(await response.text(), pattern);
}

test('start: authorization code + PKCE S256 + state + nonce, flow cookie 10 minutes', async () => {
  const response = await host.fetch('/auth/oidc:corp/start?return_to=/a/art_1');
  const location = new URL(response.headers.get('location')!);
  assert.equal(`${location.origin}${location.pathname}`, `${ISSUER}/authorize`);
  const q = location.searchParams;
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('client_id'), CLIENT);
  assert.equal(q.get('redirect_uri'), 'http://localhost:4900/auth/oidc:corp/callback');
  assert.equal(q.get('scope'), 'openid email profile');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.ok(q.get('state') && q.get('nonce') && q.get('code_challenge'));
  const line = response.headers.getSetCookie().find((l) => l.startsWith('oa_flow='))!;
  assert.match(line, /Max-Age=600/);
  assert.match(line, /HttpOnly/);
  assert.match(line, /SameSite=Lax/);
});

test('a good RS256 ID token signs in, with the verifier and secret sent to the token endpoint', async () => {
  const s = await start();
  issuer.token = () => signJwt(rsa, claims(host, s.nonce, { groups: ['eng', 'ops'], picture: 'https://idp.test/ada.png' }));
  const response = await callback(s);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/a/art_1');
  assert.ok(setCookies(response).oa_session);
  assert.equal(setCookies(response).oa_flow, '');

  const sent = issuer.forms.at(-1)!;
  assert.equal(sent.get('grant_type'), 'authorization_code');
  assert.equal(sent.get('code'), 'the-code');
  assert.equal(sent.get('client_secret'), 'shh');
  assert.equal(sent.get('redirect_uri'), 'http://localhost:4900/auth/oidc:corp/callback');
  assert.equal(await pkceChallenge(sent.get('code_verifier')!), s.challenge);

  const identity = await host.catalog.findIdentity('oidc:corp', 'u-1');
  assert.ok(identity);
  const user = (await host.catalog.getUser(identity.userId))!;
  assert.equal(user.email, 'ada@corp.example');
  assert.equal(user.emailVerified, true);
  assert.equal(user.avatar, 'https://idp.test/ada.png');
  assert.deepEqual(await host.catalog.userGroups(user.id), ['oidc:corp:eng', 'oidc:corp:ops']);
});

test('a good ES256 ID token signs in', async () => {
  const s = await start();
  issuer.token = () => signJwt(ec, claims(host, s.nonce, { sub: 'u-ec', email: 'ec@corp.example' }));
  assert.equal((await callback(s)).status, 303);
  assert.ok(await host.catalog.findIdentity('oidc:corp', 'u-ec'));
});

test('a public client sends no secret', async () => {
  const s = await start(publicHost);
  issuer.token = () => signJwt(rsa, claims(publicHost, s.nonce, { sub: 'u-pub', email: 'pub@corp.example' }));
  assert.equal((await callback(s, publicHost)).status, 303);
  assert.equal(issuer.forms.at(-1)!.has('client_secret'), false);
});

for (const [name, mutate] of [
  ['wrong aud', { aud: 'someone-else' }],
  ['wrong iss', { iss: 'https://evil.test' }],
  ['wrong nonce', { nonce: 'not-it' }],
  ['expired', { exp: Math.floor(new Date('2026-05-31T00:00:00Z').getTime() / 1000) }],
  ['no sub', { sub: '' }],
  ['several audiences without azp', { aud: [CLIENT, 'other'] }],
] as const) {
  test(`an ID token with ${name} is refused`, async () => {
    const s = await start();
    issuer.token = () => signJwt(rsa, { ...claims(host, s.nonce, { sub: `u-${name}` }), ...mutate });
    await failsWith(await callback(s), 400, /could not be verified/);
    assert.equal(await host.catalog.findIdentity('oidc:corp', `u-${name}`), undefined);
  });
}

test('an ID token with a bad signature is refused', async () => {
  const s = await start();
  // Signed by another key that claims the published kid.
  issuer.token = () => signJwt(other, claims(host, s.nonce, { sub: 'u-forged' }));
  await failsWith(await callback(s), 400, /could not be verified/);
  const s2 = await start();
  issuer.token = async () => {
    const good = await signJwt(rsa, claims(host, s2.nonce, { sub: 'u-tampered' }));
    const [h, , sig] = good.split('.');
    return `${h}.${enc({ ...claims(host, s2.nonce), sub: 'u-evil' })}.${sig}`;
  };
  await failsWith(await callback(s2), 400, /could not be verified/);
  const s3 = await start();
  issuer.token = async () => (await signJwt(rsa, claims(host, s3.nonce, { sub: 'u-none' }))).replace(/^[^.]+/, enc({ alg: 'none', kid: 'rsa1' }));
  await failsWith(await callback(s3), 400, /could not be verified/);
});

test('an unknown kid refetches the keys once (rotation), then verifies', async () => {
  // Warm the cache.
  const warm = await start();
  issuer.token = () => signJwt(rsa, claims(host, warm.nonce, { sub: 'u-warm', email: 'warm@corp.example' }));
  assert.equal((await callback(warm)).status, 303);

  issuer.published = [rsa, ec, rotated];
  const before = issuer.calls.filter((u) => u.endsWith('/keys')).length;
  const s = await start();
  issuer.token = () => signJwt(rotated, claims(host, s.nonce, { sub: 'u-rotated', email: 'rot@corp.example' }));
  assert.equal((await callback(s)).status, 303);
  assert.equal(issuer.calls.filter((u) => u.endsWith('/keys')).length, before + 1);

  // A kid the issuer never published: one refetch, then refused.
  const s2 = await start();
  const ghost = await newKey('ghost', 'RS256');
  issuer.token = () => signJwt(ghost, claims(host, s2.nonce, { sub: 'u-ghost' }));
  const count = issuer.calls.filter((u) => u.endsWith('/keys')).length;
  await failsWith(await callback(s2), 400, /could not be verified/);
  assert.equal(issuer.calls.filter((u) => u.endsWith('/keys')).length, count + 1);
  issuer.published = [rsa, ec];
});

test('a missing, forged, expired or other-provider state is refused', async () => {
  const s = await start();
  issuer.token = () => signJwt(rsa, claims(host, s.nonce, { sub: 'u-state' }));
  await failsWith(await callback(s, host, null), 400, /took too long|Start again/);
  await failsWith(await callback(s, host, s.flow, 'forged-state'), 400, /Start again/);
  const [payload, sig] = s.flow.split('.');
  const forged = `${enc({ p: 'oidc:corp', s: 'x', n: 'y', v: 'z', r: '/', exp: 9e9 })}.${sig}`;
  await failsWith(await callback(s, host, forged, 'x'), 400, /Start again/);
  assert.ok(payload);
  host.advance(11 * 60_000);
  await failsWith(await callback(s), 400, /Start again/);
  assert.equal(await host.catalog.findIdentity('oidc:corp', 'u-state'), undefined);
});

test('an error from the provider is a cancelled sign-in; an issuer mismatch in discovery is a provider error', async () => {
  const s = await start();
  const response = await host.fetch(`/auth/oidc:corp/callback?error=access_denied&state=${s.state}`, { cookies: { oa_flow: s.flow } });
  await failsWith(response, 400, /cancelled/);

  const other = new FakeIssuer();
  other.discoveryIssuer = 'https://elsewhere.test';
  const mismatched = await makeHost({ OA_AUTH: JSON.stringify([{ kind: 'oidc', id: 'corp', name: 'Corp', issuer: ISSUER, clientId: CLIENT }]) }, { fetch: other.fetch });
  try {
    const r = await mismatched.fetch('/auth/oidc:corp/start');
    assert.equal(r.status, 502);
  } finally {
    await mismatched.close();
  }
});

test('an unknown provider is a 404 page', async () => {
  assert.equal((await host.fetch('/auth/oidc:nope/start')).status, 404);
  assert.equal((await host.fetch('/auth/nope/callback')).status, 404);
  assert.equal((await host.fetch('/auth/owner-key/callback')).status, 404);
});
