import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  base64urlDecode,
  base64urlEncode,
  decryptString,
  encryptString,
  hmacSign,
  hmacVerify,
  randomId,
  randomToken,
  sha256Hex,
  timingSafeEqual,
} from '../src/core/crypto.ts';

const OLD = 'old-key-old-key-old-key-old-key-0';
const NEW = 'new-key-new-key-new-key-new-key-1';

test('base64url round-trips bytes without padding or + and /', () => {
  const bytes = new Uint8Array([0, 251, 255, 254, 62, 63, 1]);
  const text = base64urlEncode(bytes);
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(base64urlDecode(text), bytes);
  assert.equal(base64urlDecode('not base64!'), null);
  assert.equal(base64urlDecode('A'), null);
  const big = new Uint8Array(100_000).map((_, i) => i % 256);
  assert.deepEqual(base64urlDecode(base64urlEncode(big)), big);
});

test('random ids and tokens are base64url and unique', () => {
  assert.match(randomToken(), /^[A-Za-z0-9_-]{43}$/);
  assert.match(randomId('usr'), /^usr_[A-Za-z0-9_-]{22}$/);
  assert.notEqual(randomToken(), randomToken());
});

test('sha256Hex matches the known digest', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), await sha256Hex('abc'));
});

test('timingSafeEqual compares strings', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
});

test('HMAC: the first key signs, every key verifies (rotation)', async () => {
  const signedByOld = await hmacSign('payload', [OLD]);
  assert.equal(await hmacVerify('payload', signedByOld, [NEW, OLD]), true, 'an old signature verifies after rotation');
  const signedAfter = await hmacSign('payload', [NEW, OLD]);
  assert.equal(signedAfter, await hmacSign('payload', [NEW]), 'the first key signs');
  assert.equal(await hmacVerify('payload', signedAfter, [OLD]), false, 'a retired key does not verify new signatures');
  assert.equal(await hmacVerify('payload', signedByOld, [NEW]), false, 'dropping a key ends its signatures');
});

test('HMAC: tampering with data or signature fails', async () => {
  const signature = await hmacSign('payload', [NEW]);
  assert.equal(await hmacVerify('payloaD', signature, [NEW]), false);
  const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  assert.equal(await hmacVerify('payload', flipped, [NEW]), false);
  assert.equal(await hmacVerify('payload', 'garbage!', [NEW]), false);
  assert.equal(await hmacVerify('payload', '', [NEW]), false);
  await assert.rejects(hmacSign('x', []), TypeError);
});

test('AES-GCM: round trip, rotation, wrong key, wrong purpose, tampering', async () => {
  const sealed = await encryptString('secret token', [OLD], 'link-token');
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(await decryptString(sealed, [OLD], 'link-token'), 'secret token');
  assert.equal(await decryptString(sealed, [NEW, OLD], 'link-token'), 'secret token', 'readable after rotation');
  assert.equal(await decryptString(sealed, [NEW], 'link-token'), null, 'wrong key');
  assert.equal(await decryptString(sealed, [OLD], 'other'), null, 'wrong purpose');
  const parts = sealed.split('.');
  const body = parts[2]!;
  const tampered = `${parts[0]}.${parts[1]}.${(body[0] === 'A' ? 'B' : 'A') + body.slice(1)}`;
  assert.equal(await decryptString(tampered, [OLD], 'link-token'), null, 'tampered');
  assert.equal(await decryptString('v2.x.y', [OLD], 'link-token'), null);
  assert.notEqual(await encryptString('same', [OLD], 'p'), await encryptString('same', [OLD], 'p'), 'a fresh IV each time');
  assert.equal(await decryptString(await encryptString('中文 ✓', [OLD], 'p'), [OLD], 'p'), '中文 ✓');
});
