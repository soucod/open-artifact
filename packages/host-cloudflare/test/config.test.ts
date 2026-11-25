import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError } from '@open-artifact/host';
import { isLocalHostName, parseCloudflareConfig, parseRoomTimings, stringVars } from '../src/config.ts';

const BASE = {
  OA_APP_ORIGIN: 'https://artifacts.example.com',
  OA_CONTENT_ORIGIN: 'https://{id}.example-content.net',
  OA_SIGNING_KEYS: 'k'.repeat(40),
  OA_OWNER_KEY: 'o'.repeat(30),
};

function refused(env: object, variable: string): void {
  assert.throws(() => parseCloudflareConfig(env), (error: unknown) => error instanceof ConfigError && error.message.includes(variable));
}

test('a deployment with https origins and the secrets parses; bindings are ignored', () => {
  const config = parseCloudflareConfig({ ...BASE, DB: { prepare() {} }, ROOMS: {}, OA_SIGNUP: 'open' });
  assert.equal(config.appOrigin, 'https://artifacts.example.com');
  assert.equal(config.contentOrigin, 'https://{id}.example-content.net');
  assert.equal(config.ownerKey, 'o'.repeat(30));
  assert.equal(config.signup, 'open');
});

test('http is taken only for a localhost origin (wrangler dev)', () => {
  const config = parseCloudflareConfig({ ...BASE, OA_APP_ORIGIN: 'http://localhost:8787', OA_CONTENT_ORIGIN: 'http://{id}.content.localhost:8787' });
  assert.equal(config.appOrigin, 'http://localhost:8787');
  refused({ ...BASE, OA_APP_ORIGIN: 'http://artifacts.example.com' }, 'OA_APP_ORIGIN');
  refused({ ...BASE, OA_CONTENT_ORIGIN: 'http://{id}.example-content.net' }, 'OA_CONTENT_ORIGIN');
});

test('OA_ALLOW_HTTP is refused, not ignored, even with https origins', () => {
  refused({ ...BASE, OA_ALLOW_HTTP: 'true' }, 'OA_ALLOW_HTTP');
  refused({ ...BASE, OA_ALLOW_HTTP: 'false' }, 'OA_ALLOW_HTTP');
  assert.doesNotThrow(() => parseCloudflareConfig({ ...BASE, OA_ALLOW_HTTP: '  ' }));
});

test('OA_OWNER_KEY is required while the owner-key sign-in is on, not otherwise', () => {
  const { OA_OWNER_KEY: _, ...noKey } = BASE;
  refused(noKey, 'OA_OWNER_KEY');
  refused({ ...noKey, OA_AUTH: '[{"kind":"owner-key"}]' }, 'OA_OWNER_KEY');
  refused({ ...BASE, OA_OWNER_KEY: 'short' }, 'OA_OWNER_KEY');
  const github = parseCloudflareConfig({ ...noKey, OA_AUTH: '[{"kind":"github","clientId":"id","clientSecret":"secret"}]' });
  assert.equal(github.ownerKey, undefined);
});

test('the core rules still apply: signing keys, a separate content site', () => {
  refused({ ...BASE, OA_SIGNING_KEYS: '' }, 'OA_SIGNING_KEYS');
  refused({ ...BASE, OA_SIGNING_KEYS: 'short' }, 'OA_SIGNING_KEYS');
  refused({ ...BASE, OA_CONTENT_ORIGIN: 'https://{id}.content.example.com' }, 'OA_CONTENT_ORIGIN');
});

test('OA_CONTENT_SAME_SITE: one zone for both (app.example.com beside {id}.example.com); the hosts must still differ', () => {
  const oneZone = { ...BASE, OA_APP_ORIGIN: 'https://app.example.com', OA_CONTENT_ORIGIN: 'https://{id}.example.com' };
  assert.throws(() => parseCloudflareConfig(oneZone), (error: unknown) => error instanceof ConfigError && error.message.includes('OA_CONTENT_SAME_SITE=true') && error.message.includes('One domain for both'));
  const config = parseCloudflareConfig({ ...oneZone, OA_CONTENT_SAME_SITE: 'true' });
  assert.equal(config.contentSameSite, true);
  assert.equal(parseCloudflareConfig(BASE).contentSameSite, undefined);
  refused({ ...oneZone, OA_CONTENT_SAME_SITE: 'true', OA_APP_ORIGIN: 'https://art-app.example.com' }, 'OA_CONTENT_ORIGIN');
  refused({ ...oneZone, OA_CONTENT_SAME_SITE: 'maybe' }, 'OA_CONTENT_SAME_SITE');
  refused({ ...oneZone, OA_CONTENT_SAME_SITE: 'true', OA_CONTENT_ORIGIN: 'http://{id}.example.com' }, 'OA_CONTENT_ORIGIN');
});

test('local host names and string variables', () => {
  for (const name of ['localhost', 'LOCALHOST', 'art-1.content.localhost', '127.0.0.1', '[::1]']) assert.equal(isLocalHostName(name), true, name);
  for (const name of ['example.com', 'localhost.example.com', '10.0.0.1', 'box.lan']) assert.equal(isLocalHostName(name), false, name);
  assert.deepEqual(stringVars({ A: 'x', B: 1, C: {}, D: '' }), { A: 'x', D: '' });
});

test("the rooms' idle close and event-stream heartbeat: whole milliseconds, 0 for never, unset keeps the defaults", () => {
  assert.deepEqual(parseRoomTimings({}), {});
  assert.deepEqual(parseRoomTimings({ OA_ROOM_IDLE_CLOSE_MS: '3000', OA_SSE_HEARTBEAT_MS: '0' }), { idleCloseMs: 3000, sseHeartbeatMs: 0 });
  assert.deepEqual(parseRoomTimings({ OA_ROOM_IDLE_CLOSE_MS: ' ' }), {});
  for (const bad of ['-1', '1.5', 'soon', '99999999999']) {
    assert.throws(() => parseRoomTimings({ OA_SSE_HEARTBEAT_MS: bad }), (error: unknown) => error instanceof ConfigError && /OA_SSE_HEARTBEAT_MS/.test(error.message), bad);
  }
});
