import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HttpError,
  json,
  readJson,
  readText,
  signHmacSha256,
  timingSafeEqual,
  verifyHmacSha256,
  verifyJwt,
  type Jwk,
} from '../src/index.ts';

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array | string): string =>
  btoa(String.fromCharCode(...(typeof bytes === 'string' ? enc.encode(bytes) : bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const NOW = new Date('2026-05-01T00:00:00.000Z');
const T = Math.floor(NOW.getTime() / 1000);

async function sign(alg: 'RS256' | 'ES256' | 'HS256', key: CryptoKey, header: Record<string, unknown>, claims: Record<string, unknown>): Promise<string> {
  const data = `${b64url(JSON.stringify({ alg, typ: 'JWT', ...header }))}.${b64url(JSON.stringify(claims))}`;
  const algorithm = alg === 'RS256' ? 'RSASSA-PKCS1-v1_5' : alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : 'HMAC';
  const signature = new Uint8Array(await crypto.subtle.sign(algorithm, key, enc.encode(data)));
  return `${data}.${b64url(signature)}`;
}

async function rsa(): Promise<{ priv: CryptoKey; jwk: Jwk }> {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  return { priv: pair.privateKey, jwk: (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk };
}

async function ec(): Promise<{ priv: CryptoKey; jwk: Jwk }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { priv: pair.privateKey, jwk: (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk };
}

const good = { iss: 'https://idp.example.test', aud: 'artifacts', sub: 'u1', email: 'ann@example.com', exp: T + 600, iat: T };

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual(enc.encode('x'), 'x'), true);
  assert.equal(timingSafeEqual('', ''), true);
});

test('HMAC-SHA256: sign and verify, hex/base64/base64url, a prefix, any change refused', async () => {
  // RFC 4231 test case 2.
  assert.equal(await signHmacSha256({ secret: 'Jefe', body: 'what do ya want for nothing?' }), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  const body = '{"artifactId":"art_1"}';
  for (const encoding of ['hex', 'base64', 'base64url'] as const) {
    const signature = await signHmacSha256({ secret: 's', body, encoding });
    assert.equal(await verifyHmacSha256({ secret: 's', body, signature, encoding }), true, encoding);
    assert.equal(await verifyHmacSha256({ secret: 's', body: `${body} `, signature, encoding }), false, encoding);
    assert.equal(await verifyHmacSha256({ secret: 't', body, signature, encoding }), false, encoding);
  }
  const hex = await signHmacSha256({ secret: 's', body });
  assert.equal(await verifyHmacSha256({ secret: 's', body, signature: `sha256=${hex.toUpperCase()}`, prefix: 'sha256=' }), true);
  assert.equal(await verifyHmacSha256({ secret: 's', body, signature: null }), false);
  assert.equal(await verifyHmacSha256({ secret: 's', body, signature: '' }), false);
});

test('verifyJwt RS256 and ES256 with a JWKS: good, expired, not yet valid, wrong audience/issuer, wrong signature', async () => {
  const r = await rsa();
  const e = await ec();
  const other = await rsa();
  let fetches = 0;
  const url = 'https://idp.example.test/jwks-1';
  const fetcher: typeof fetch = async (input) => {
    fetches++;
    assert.equal(String(input), url);
    return Response.json({ keys: [{ ...r.jwk, kid: 'r1', use: 'sig' }, { ...e.jwk, kid: 'e1' }] });
  };
  const check = (token: string, extra: Record<string, unknown> = {}) => verifyJwt({ token, jwksUrl: url, issuer: good.iss, audience: 'artifacts', now: NOW, ...extra }, fetcher);

  const rs = await check(await sign('RS256', r.priv, { kid: 'r1' }, good));
  assert.ok(rs.valid);
  assert.equal(rs.claims.email, 'ann@example.com');
  assert.deepEqual(rs.header, { alg: 'RS256', kid: 'r1', typ: 'JWT' });
  const es = await check(await sign('ES256', e.priv, { kid: 'e1' }, good));
  assert.ok(es.valid);
  assert.equal(fetches, 1, 'the key set is kept');

  assert.deepEqual(await check(await sign('RS256', r.priv, { kid: 'r1' }, { ...good, exp: T - 120 })), { valid: false, reason: 'expired' });
  assert.ok((await check(await sign('RS256', r.priv, { kid: 'r1' }, { ...good, exp: T - 30 }))).valid, 'within the clock tolerance');
  assert.deepEqual(await check(await sign('RS256', r.priv, { kid: 'r1' }, { ...good, nbf: T + 600 })), { valid: false, reason: 'not valid yet (nbf)' });
  assert.deepEqual(await check(await sign('RS256', r.priv, { kid: 'r1' }, { ...good, aud: 'other-app' })), { valid: false, reason: 'wrong audience' });
  assert.ok((await check(await sign('RS256', r.priv, { kid: 'r1' }, { ...good, aud: ['x', 'artifacts'] }))).valid);
  assert.deepEqual(await check(await sign('RS256', r.priv, { kid: 'r1' }, { ...good, iss: 'https://evil.test' })), { valid: false, reason: 'wrong issuer' });
  assert.deepEqual(await check(await sign('RS256', r.priv, { kid: 'r1' }, { ...good, exp: undefined })), { valid: false, reason: 'no expiry (exp)' });
  assert.deepEqual(await check(await sign('RS256', other.priv, { kid: 'r1' }, good)), { valid: false, reason: 'bad signature' });

  // A payload changed after signing.
  const [h, , s] = (await sign('RS256', r.priv, { kid: 'r1' }, good)).split('.');
  assert.deepEqual(await check(`${h}.${b64url(JSON.stringify({ ...good, sub: 'admin' }))}.${s}`), { valid: false, reason: 'bad signature' });

  // An unknown kid refetches the set once, then says so.
  const before = fetches;
  assert.deepEqual(await check(await sign('RS256', r.priv, { kid: 'nope' }, good), { now: new Date(NOW.getTime() + 60_000) }), { valid: false, reason: 'no RS256 key with kid nope' });
  assert.equal(fetches, before + 1);
  assert.deepEqual(await check(await sign('RS256', r.priv, { kid: 'nope2' }, good), { now: new Date(NOW.getTime() + 61_000) }), { valid: false, reason: 'no RS256 key with kid nope2' });
  assert.equal(fetches, before + 1, 'made-up kids do not refetch more than every 30 seconds');
});

test('verifyJwt refuses alg none, algorithm confusion, and algorithms not accepted', async () => {
  const r = await rsa();
  const none = `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(good))}.`;
  assert.deepEqual(await verifyJwt({ token: none, key: r.jwk, now: NOW }), { valid: false, reason: 'algorithm none is not accepted' });
  assert.deepEqual(await verifyJwt({ token: none, key: 'secret', now: NOW }), { valid: false, reason: 'algorithm none is not accepted' });

  // HS256 signed with the RSA public key's text must not pass as a key of the RSA kind.
  const hmacKey = await crypto.subtle.importKey('raw', enc.encode(JSON.stringify(r.jwk)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const confused = await sign('HS256', hmacKey, {}, good);
  assert.deepEqual(await verifyJwt({ token: confused, key: r.jwk, now: NOW }), { valid: false, reason: 'no HS256 key' });

  const rs = await sign('RS256', r.priv, {}, good);
  assert.deepEqual(await verifyJwt({ token: rs, key: r.jwk, algorithms: ['ES256'], now: NOW }), { valid: false, reason: 'algorithm RS256 is not accepted' });
  assert.deepEqual(await verifyJwt({ token: 'a.b', key: 'x', now: NOW }), { valid: false, reason: 'not a JWT' });
  assert.deepEqual(await verifyJwt({ token: rs, now: NOW }), { valid: false, reason: 'no key or jwksUrl to verify with' });
});

test('verifyJwt HS256 with a shared secret; a JWKS that cannot be fetched', async () => {
  const key = await crypto.subtle.importKey('raw', enc.encode('shared-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const token = await sign('HS256', key, {}, good);
  assert.ok((await verifyJwt({ token, key: 'shared-secret', audience: 'artifacts', now: NOW })).valid);
  assert.deepEqual(await verifyJwt({ token, key: 'other-secret', now: NOW }), { valid: false, reason: 'bad signature' });
  const down = await verifyJwt({ token, jwksUrl: 'https://idp.example.test/jwks-down', now: NOW }, async () => new Response('no', { status: 503 }));
  assert.deepEqual(down, { valid: false, reason: 'the signing keys could not be fetched: the key set at https://idp.example.test/jwks-down answered 503', unavailable: true });
});

test('HTTP helpers: json, readJson, readText with a size limit, HttpError', async () => {
  const response = json({ ok: true }, { status: 201 });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(await readJson(new Request('https://x.test', { method: 'POST', body: '{"a":1}' })), { a: 1 });
  await assert.rejects(readJson(new Request('https://x.test', { method: 'POST', body: '{' })), (e: unknown) => e instanceof HttpError && e.status === 400);
  await assert.rejects(readText(new Request('https://x.test', { method: 'POST', body: 'x'.repeat(20) }), 10), (e: unknown) => e instanceof HttpError && e.status === 413);
  assert.equal(await readText(new Request('https://x.test', { method: 'POST', body: 'héllo' })), 'héllo');
  assert.equal(new HttpError(200, 'x').status, 500);
  assert.equal(new HttpError(404, 'x').name, 'HttpError');
});
