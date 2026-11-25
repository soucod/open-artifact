import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { KV_LIMITS } from '@open-artifact/host-plugin/contract';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { createPluginKv, deletePluginKv, purgeExpiredPluginKv } from '../src/core/plugins/kv.ts';
import { openSqlite, type SqliteDriver } from '../src/node/sqlite.ts';

let dir: string;
let driver: SqliteDriver;
let clock = new Date('2026-01-01T00:00:00.000Z');
const now = (): Date => clock;
const advance = (ms: number): void => {
  clock = new Date(clock.getTime() + ms);
};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-plugin-kv-'));
  driver = openSqlite(join(dir, 'catalog.db'));
  await Catalog.open(driver, { signingKeys: ['k'.repeat(32)], now });
});

after(async () => {
  driver.close();
  await rm(dir, { recursive: true, force: true });
});

test('get, set, delete: JSON values, overwrite, null when absent', async () => {
  const kv = createPluginKv(driver, 'alpha', { now });
  assert.equal(await kv.get('nothing'), null);
  await kv.set('a', { n: 1, list: ['x'], nested: { ok: true } });
  assert.deepEqual(await kv.get('a'), { n: 1, list: ['x'], nested: { ok: true } });
  await kv.set('a', 'second');
  assert.equal(await kv.get('a'), 'second');
  await kv.set('zero', 0);
  assert.equal(await kv.get('zero'), 0);
  await kv.delete('a');
  assert.equal(await kv.get('a'), null);
  await kv.delete('never-there');
});

test('each plugin sees only its own keys', async () => {
  const a = createPluginKv(driver, 'iso-a', { now });
  const b = createPluginKv(driver, 'iso-b', { now });
  await a.set('shared-name', 'from a');
  await b.set('shared-name', 'from b');
  assert.equal(await a.get('shared-name'), 'from a');
  assert.equal(await b.get('shared-name'), 'from b');
  assert.deepEqual((await a.list()).map((e) => e.value), ['from a']);
  await b.delete('shared-name');
  assert.equal(await a.get('shared-name'), 'from a');
  assert.equal(await deletePluginKv(driver, 'iso-a'), 1);
  assert.equal(await a.get('shared-name'), null);
});

test('TTL: an entry expires, reads as absent, and the upkeep purges it', async () => {
  const kv = createPluginKv(driver, 'ttl', { now });
  await kv.set('short', 1, { ttlSeconds: 60 });
  await kv.set('forever', 2);
  const [short] = await kv.list({ prefix: 'short' });
  assert.equal(short!.expiresAt, new Date(clock.getTime() + 60_000).toISOString());
  advance(59_000);
  assert.equal(await kv.get('short'), 1);
  advance(1_000);
  assert.equal(await kv.get('short'), null);
  await kv.set('later', 3, { ttlSeconds: 1 });
  advance(2_000);
  assert.deepEqual((await kv.list()).map((e) => e.key), ['forever']);
  assert.equal(await purgeExpiredPluginKv(driver, clock), 1);
  // Setting a value again without a TTL makes it last.
  await kv.set('x', 1, { ttlSeconds: 1 });
  await kv.set('x', 1);
  advance(5_000);
  assert.equal(await kv.get('x'), 1);
  await assert.rejects(kv.set('bad', 1, { ttlSeconds: -1 }), TypeError);
});

test('list: key order, prefix, after, limit', async () => {
  const kv = createPluginKv(driver, 'list', { now });
  for (const key of ['b:2', 'a:1', 'b:1', 'b:3', 'c', 'b:10', 'é:1']) await kv.set(key, key.toUpperCase());
  assert.deepEqual((await kv.list()).map((e) => e.key), ['a:1', 'b:1', 'b:10', 'b:2', 'b:3', 'c', 'é:1']);
  assert.deepEqual((await kv.list({ prefix: 'b:' })).map((e) => e.key), ['b:1', 'b:10', 'b:2', 'b:3']);
  assert.deepEqual((await kv.list({ prefix: 'b:', after: 'b:10', limit: 2 })).map((e) => e.key), ['b:2', 'b:3']);
  assert.deepEqual((await kv.list({ prefix: 'é' })).map((e) => e.value), ['É:1']);
  assert.deepEqual((await kv.list({ prefix: '%' })).length, 0);
  assert.equal((await kv.list({ limit: KV_LIMITS.maxList + 1 })).length, 7);
  await assert.rejects(kv.list({ limit: 0 }), TypeError);
});

test('caps: key and value size, keys per plugin', async () => {
  const kv = createPluginKv(driver, 'caps', { now });
  await assert.rejects(kv.set('', 1), TypeError);
  await assert.rejects(kv.get('k'.repeat(KV_LIMITS.maxKeyBytes + 1)), TypeError);
  await kv.set('k'.repeat(KV_LIMITS.maxKeyBytes), 1);
  await assert.rejects(kv.set('big', 'x'.repeat(KV_LIMITS.maxValueBytes)), TypeError);
  await assert.rejects(kv.set('fn', () => 1), TypeError);
  await assert.rejects(kv.set('undef', undefined), TypeError);

  // Fill to the limit cheaply, then: a new key is refused, an existing one may change, an expired one frees a place.
  const full = createPluginKv(driver, 'full', { now });
  const rows = Array.from({ length: KV_LIMITS.maxKeys - 1 }, (_, i) => ({ sql: 'INSERT INTO plugin_kv (plugin_id, key, value, expires_at) VALUES (?, ?, ?, NULL)', params: ['full', `k${i}`, '1'] }));
  await driver.batch(rows);
  await full.set('last', 1, { ttlSeconds: 10 });
  await assert.rejects(full.set('one-more', 1), /kv: this plugin already keeps 10000 keys/);
  await full.set('k0', 2);
  assert.equal(await full.get('k0'), 2);
  advance(11_000);
  await full.set('one-more', 1);
  assert.equal(await full.get('one-more'), 1);
  // Another plugin is not affected by this one's count.
  await createPluginKv(driver, 'other', { now }).set('a', 1);
});
