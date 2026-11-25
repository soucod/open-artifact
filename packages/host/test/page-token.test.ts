import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base64urlDecode, base64urlEncode } from '../src/core/crypto.ts';
import {
  PAGE_TOKEN_API_GRACE_SECONDS,
  PAGE_TOKEN_TTL_SECONDS,
  SNAPSHOT_TOKEN_TTL_SECONDS,
  artifactOfContentHost,
  checkPageToken,
  contentOriginOf,
  pageTokenClaims,
  principalClaims,
  signPageToken,
  snapshotTokenClaims,
  verifyPageToken,
  type PageTokenClaims,
} from '../src/core/page-token.ts';
import type { Principal } from '../src/core/types.ts';

const KEYS = ['k'.repeat(32)];
const ID = 'art_0abcdefghi1234';
const NOW = new Date('2026-01-01T00:00:00Z');
const claims: PageTokenClaims = pageTokenClaims({
  artifact: ID,
  principal: { kind: 'user', id: 'usr_1', name: 'Ada', siteRole: 'member' },
  role: 'editor',
  grantsVersion: 3,
  epoch: 1,
  now: NOW,
});
const expected = { artifact: ID, grantsVersion: 3, epoch: 1, now: NOW, use: 'document' as const };

test('a page token is v1.<payload>.<signature> with the claims in a fixed order', async () => {
  const token = await signPageToken(claims, KEYS);
  const [version, payload, signature, ...rest] = token.split('.');
  assert.equal(version, 'v1');
  assert.equal(rest.length, 0);
  assert.match(token, /^[A-Za-z0-9_.-]+$/, 'safe in a URL path');
  assert.equal(base64urlDecode(signature!)!.length, 32);
  const json = new TextDecoder().decode(base64urlDecode(payload!)!);
  assert.deepEqual(Object.keys(JSON.parse(json)), ['a', 'p', 'k', 'n', 'r', 'gv', 'ep', 'exp']);
  assert.deepEqual(await verifyPageToken(token, KEYS), claims);
  assert.equal(claims.exp, Math.floor(NOW.getTime() / 1000) + PAGE_TOKEN_TTL_SECONDS);
  assert.equal(PAGE_TOKEN_TTL_SECONDS, 12 * 3600);
});

test('a tampered, foreign or malformed token does not verify', async () => {
  const token = await signPageToken(claims, KEYS);
  const [v, , s] = token.split('.');
  const forged = base64urlEncode(new TextEncoder().encode(JSON.stringify({ ...claims, r: 'owner' })));
  assert.equal(await verifyPageToken(`${v}.${forged}.${s}`, KEYS), null);
  assert.equal(await verifyPageToken(token, ['x'.repeat(32)]), null);
  assert.equal(await verifyPageToken(token.replace(/^v1/, 'v2'), KEYS), null);
  assert.equal(await verifyPageToken(`${token}.x`, KEYS), null);
  assert.equal(await verifyPageToken('deadbeef', KEYS), null);
  // Well signed but not claims.
  const { hmacSign } = await import('../src/core/crypto.ts');
  const odd = `v1.${base64urlEncode(new TextEncoder().encode('{"a":1}'))}`;
  assert.equal(await verifyPageToken(`${odd}.${await hmacSign(odd, KEYS)}`, KEYS), null);
});

test('a token signed with an older key still verifies after rotation', async () => {
  const token = await signPageToken(claims, KEYS);
  assert.deepEqual(await verifyPageToken(token, ['n'.repeat(32), ...KEYS]), claims);
});

test('checkPageToken refuses another artifact, a stale grants version or epoch', () => {
  assert.deepEqual(checkPageToken(claims, expected), { ok: true });
  assert.deepEqual(checkPageToken(claims, { ...expected, artifact: 'art_0zzzzzzzzz9999' }), { ok: false, reason: 'artifact' });
  assert.deepEqual(checkPageToken(claims, { ...expected, grantsVersion: 4 }), { ok: false, reason: 'grants' });
  assert.deepEqual(checkPageToken(claims, { ...expected, epoch: 2 }), { ok: false, reason: 'epoch' });
});

test('exp binds documents and sockets; api calls get 24 hours past it', () => {
  const at = (seconds: number): Date => new Date(claims.exp * 1000 + seconds * 1000);
  for (const use of ['document', 'socket'] as const) {
    assert.deepEqual(checkPageToken(claims, { ...expected, use, now: at(-1) }), { ok: true }, use);
    assert.deepEqual(checkPageToken(claims, { ...expected, use, now: at(0) }), { ok: false, reason: 'expired' }, use);
  }
  assert.deepEqual(checkPageToken(claims, { ...expected, use: 'api', now: at(1) }), { ok: true });
  assert.deepEqual(checkPageToken(claims, { ...expected, use: 'api', now: at(PAGE_TOKEN_API_GRACE_SECONDS - 1) }), { ok: true });
  assert.deepEqual(checkPageToken(claims, { ...expected, use: 'api', now: at(PAGE_TOKEN_API_GRACE_SECONDS) }), { ok: false, reason: 'expired' });
});

test('a snapshot token is a viewer for five minutes, marked `s`, with no api grace', async () => {
  const agent: Principal = { kind: 'agent', id: 'agt_1', user: { kind: 'user', id: 'usr_1', name: 'Ada', siteRole: 'member' }, label: 'Claude Code', scopes: [] };
  const snap = snapshotTokenClaims({ artifact: ID, principal: agent, grantsVersion: 3, epoch: 1, now: NOW });
  assert.equal(snap.r, 'viewer');
  assert.equal(snap.s, 1);
  assert.equal(snap.p, 'agt_1');
  assert.equal(SNAPSHOT_TOKEN_TTL_SECONDS, 300);
  assert.equal(snap.exp, Math.floor(NOW.getTime() / 1000) + 300);
  assert.equal(snapshotTokenClaims({ artifact: ID, principal: agent, grantsVersion: 3, epoch: 1, now: NOW, ttlSeconds: 2 }).exp, Math.floor(NOW.getTime() / 1000) + 2);
  const token = await signPageToken(snap, KEYS);
  const json = new TextDecoder().decode(base64urlDecode(token.split('.')[1]!)!);
  assert.deepEqual(Object.keys(JSON.parse(json)), ['a', 'p', 'k', 'n', 'r', 'gv', 'ep', 'exp', 's']);
  assert.deepEqual(await verifyPageToken(token, KEYS), snap);
  // A person's token carries no `s`.
  assert.equal((await verifyPageToken(await signPageToken(claims, KEYS), KEYS))!.s, undefined);
  // Signed with `s` but another role, or another `s`: not a token.
  const { hmacSign } = await import('../src/core/crypto.ts');
  const forge = async (payload: object): Promise<string> => {
    const head = `v1.${base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))}`;
    return `${head}.${await hmacSign(head, KEYS)}`;
  };
  assert.equal(await verifyPageToken(await forge({ ...snap, r: 'editor' }), KEYS), null);
  assert.equal(await verifyPageToken(await forge({ ...snap, s: 2 }), KEYS), null);
  // No grace: an api call stops at exp like the page.
  const at = (seconds: number): Date => new Date(snap.exp * 1000 + seconds * 1000);
  for (const use of ['document', 'socket', 'api'] as const) {
    assert.deepEqual(checkPageToken(snap, { ...expected, use, now: at(-1) }), { ok: true }, use);
    assert.deepEqual(checkPageToken(snap, { ...expected, use, now: at(0) }), { ok: false, reason: 'expired' }, use);
  }
});

test('principal claims per kind', () => {
  const user = { kind: 'user', id: 'usr_1', name: 'Ada', siteRole: 'member' } as const;
  assert.deepEqual(principalClaims(user), { p: 'usr_1', k: 'user', n: 'Ada' });
  assert.deepEqual(principalClaims({ kind: 'guest', id: 'gst_1', name: 'Bo', link: 'lnk_1', artifact: ID }), { p: 'gst_1', k: 'guest', n: 'Bo' });
  assert.deepEqual(principalClaims({ kind: 'agent', id: 'agt_1', user, label: 'Claude Code', scopes: [] }), { p: 'agt_1', k: 'agent', n: 'Claude Code' });
  assert.deepEqual(principalClaims({ kind: 'anonymous' }), { p: 'anonymous', k: 'anonymous', n: 'Anonymous' });
});

test('content origins: label in, artifact out', () => {
  const dev = { contentOrigin: 'http://{id}.content.localhost:4900' };
  assert.equal(contentOriginOf(dev, ID), 'http://art-0abcdefghi1234.content.localhost:4900');
  assert.throws(() => contentOriginOf(dev, 'nope'), TypeError);
  assert.equal(artifactOfContentHost(dev, 'art-0abcdefghi1234.content.localhost:4900'), ID);
  assert.equal(artifactOfContentHost(dev, 'ART-0ABCDEFGHI1234.content.localhost:4900'), ID);
  assert.equal(artifactOfContentHost(dev, 'art-0abcdefghi1234.content.localhost'), null, 'port must match');
  assert.equal(artifactOfContentHost(dev, 'localhost:4900'), null);
  assert.equal(artifactOfContentHost(dev, 'a.art-0abcdefghi1234.content.localhost:4900'), null);
  assert.equal(artifactOfContentHost(dev, 'www.content.localhost:4900'), null);
  assert.equal(artifactOfContentHost(dev, undefined), null);

  const prod = { contentOrigin: 'https://{id}.oa-content.example.net' };
  assert.equal(contentOriginOf(prod, ID), 'https://art-0abcdefghi1234.oa-content.example.net');
  assert.equal(artifactOfContentHost(prod, 'art-0abcdefghi1234.oa-content.example.net'), ID);
  assert.equal(artifactOfContentHost(prod, 'art-0abcdefghi1234.oa-content.example.net:443'), ID);
  assert.equal(artifactOfContentHost(prod, 'art-0abcdefghi1234.oa-content.example.net.evil.com'), null);
  assert.equal(artifactOfContentHost(prod, 'art-0abcdefghi1234.example.net'), null);
});
