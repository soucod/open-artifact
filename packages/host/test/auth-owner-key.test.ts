import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureOwnerKey, FREE_FAILURES, OWNER_KEY_HASH } from '../src/core/auth/owner-key.ts';
import { ConfigError, parseConfig } from '../src/core/config.ts';
import { sha256Hex } from '../src/core/crypto.ts';
import { form, makeHost, setCookieLine, setCookies, SIGNING_KEY } from './auth-fixture.ts';

const KEY = 'owner-key-0123456789-abcdef';

test('OA_OWNER_KEY must be at least 24 characters; OA_OWNER_NAME is read', () => {
  assert.throws(() => parseConfig({ OA_SIGNING_KEYS: SIGNING_KEY, OA_OWNER_KEY: 'short' }), (e: unknown) => e instanceof ConfigError && e.variable === 'OA_OWNER_KEY');
  const config = parseConfig({ OA_SIGNING_KEYS: SIGNING_KEY, OA_OWNER_KEY: KEY, OA_OWNER_NAME: 'Jim' });
  assert.equal(config.ownerKey, KEY);
  assert.equal(config.ownerName, 'Jim');
  assert.equal('ownerKey' in parseConfig({ OA_SIGNING_KEYS: SIGNING_KEY }), false);
});

test('a generated key: given once, only its hash kept, then it signs the owner in', async () => {
  const host = await makeHost();
  try {
    const key = await ensureOwnerKey(host.ctx);
    assert.ok(key && key.length >= 24);
    assert.equal(await ensureOwnerKey(host.ctx), null, 'only the first time');
    assert.equal(await host.catalog.getSite(OWNER_KEY_HASH), await sha256Hex(key));
    const dump = JSON.stringify(await host.ctx.catalog.driver.all('SELECT * FROM site'));
    assert.ok(!dump.includes(key), 'the clear key is not stored');

    const response = await host.fetch('/auth/owner-key', form({ key, return_to: '/a/art_x' }, host.config.appOrigin));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/a/art_x');
    const session = setCookies(response).oa_session;
    assert.ok(session);

    const users = await host.catalog.listUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0]!.name, 'Owner');
    assert.equal(users[0]!.siteRole, 'admin');
    assert.ok((await host.catalog.listAudit()).some((a) => a.action === 'auth.sign_in'));

    // Signing in again is the same user; a name given in the form renames them.
    await host.fetch('/auth/owner-key', form({ key, name: 'Jim' }));
    const again = await host.catalog.listUsers();
    assert.equal(again.length, 1);
    assert.equal(again[0]!.name, 'Jim');
  } finally {
    await host.close();
  }
});

test('a configured key: nothing generated; email from OA_OWNERS; name from OA_OWNER_NAME', async () => {
  const host = await makeHost({ OA_OWNER_KEY: KEY, OA_OWNERS: 'Boss@Example.com,b@example.com', OA_OWNER_NAME: 'The Boss' });
  try {
    assert.equal(await ensureOwnerKey(host.ctx), null);
    const response = await host.fetch('/auth/owner-key', form({ key: KEY }));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/');
    const [user] = await host.catalog.listUsers();
    assert.equal(user!.name, 'The Boss');
    assert.equal(user!.email, 'boss@example.com');
    assert.equal(user!.emailVerified, true);
    assert.equal(user!.siteRole, 'admin');
  } finally {
    await host.close();
  }
});

test('no owner-key sign-in configured: nothing generated, the form is refused', async () => {
  const host = await makeHost({ OA_AUTH: JSON.stringify([{ kind: 'github', clientId: 'c', clientSecret: 's' }]) });
  try {
    assert.equal(await ensureOwnerKey(host.ctx), null);
    const response = await host.fetch('/auth/owner-key', form({ key: KEY }));
    assert.equal(response.status, 404);
  } finally {
    await host.close();
  }
});

test('a wrong key is refused, audited, and the page does not echo it', async () => {
  const host = await makeHost({ OA_OWNER_KEY: KEY });
  try {
    const wrong = 'not-the-key-but-long-enough-xyz';
    const response = await host.fetch('/auth/owner-key', form({ key: wrong, return_to: '/x' }));
    assert.equal(response.status, 401);
    assert.equal(setCookies(response).oa_session, undefined);
    const html = await response.text();
    assert.ok(!html.includes(wrong));
    assert.ok(!html.includes(KEY));
    assert.match(html, /not the owner key/);
    assert.match(html, /name="return_to" value="\/x"/);
    assert.ok((await host.catalog.listAudit({ limit: 1000 })).some((a) => a.action === 'auth.owner_key_failed'));
    assert.equal((await host.catalog.listUsers()).length, 0);
    // An empty key is wrong too.
    assert.equal((await host.fetch('/auth/owner-key', form({ key: '' }))).status, 401);
  } finally {
    await host.close();
  }
});

test('failed attempts back off: free tries, then locks that double; the right key waits too; success resets', async () => {
  const host = await makeHost({ OA_OWNER_KEY: KEY });
  try {
    const attempt = (key: string): Promise<Response> => host.fetch('/auth/owner-key', form({ key }));
    for (let i = 1; i < FREE_FAILURES; i++) assert.equal((await attempt('wrong')).status, 401, `free failure ${i}`);
    assert.equal((await attempt('wrong')).status, 401, 'the failure that starts the lock');
    const locked = await attempt(KEY);
    assert.equal(locked.status, 429, 'even the right key waits');
    assert.equal(locked.headers.get('retry-after'), '30');
    host.advance(31_000);
    assert.equal((await attempt('wrong')).status, 401);
    const second = await attempt(KEY);
    assert.equal(second.status, 429);
    assert.equal(second.headers.get('retry-after'), '60', 'the lock doubled');
    host.advance(61_000);
    assert.equal((await attempt(KEY)).status, 303);
    // The count started again.
    for (let i = 1; i < FREE_FAILURES; i++) assert.equal((await attempt('wrong')).status, 401);
    assert.equal((await attempt(KEY)).status, 303);
    const failed = (await host.catalog.listAudit({ limit: 1000 })).filter((a) => a.action === 'auth.owner_key_failed');
    assert.ok(failed.length >= FREE_FAILURES + 2);
  } finally {
    await host.close();
  }
});

test('session cookie attributes: oa_session on http, __Host-oa_session with Secure on https', async () => {
  const http = await makeHost({ OA_OWNER_KEY: KEY });
  const https = await makeHost({ OA_OWNER_KEY: KEY, OA_APP_ORIGIN: 'https://app.example.com', OA_CONTENT_ORIGIN: 'https://{id}.content.example.net' });
  try {
    const a = await http.fetch('/auth/owner-key', form({ key: KEY }));
    const lineA = setCookieLine(a, 'oa_session')!;
    assert.match(lineA, /HttpOnly/);
    assert.match(lineA, /SameSite=Lax/);
    assert.match(lineA, /Path=\//);
    assert.match(lineA, /Max-Age=2592000/);
    assert.doesNotMatch(lineA, /Secure|Domain/);

    const b = await https.fetch('/auth/owner-key', form({ key: KEY }, 'https://app.example.com'));
    assert.equal(b.status, 303);
    const lineB = setCookieLine(b, '__Host-oa_session')!;
    assert.match(lineB, /Secure/);
    assert.match(lineB, /HttpOnly/);
    assert.doesNotMatch(lineB, /Domain/);
  } finally {
    await http.close();
    await https.close();
  }
});

test('the owner-key form refuses a cross-site post', async () => {
  const host = await makeHost({ OA_OWNER_KEY: KEY });
  try {
    assert.equal((await host.fetch('/auth/owner-key', form({ key: KEY }, 'https://evil.example'))).status, 403);
  } finally {
    await host.close();
  }
});
