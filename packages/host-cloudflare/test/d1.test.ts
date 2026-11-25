import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Catalog, MIGRATIONS, migrate } from '@open-artifact/host';
import { D1_MAX_PARAMS, D1LimitError, d1Driver, ensureMigrated } from '../src/d1.ts';
import { fakeD1 } from './d1-fake.ts';

const KEYS = ['k'.repeat(32)];

test('get answers undefined for no row; all, run and changes', async () => {
  const driver = d1Driver(fakeD1());
  await driver.run('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, b BLOB)');
  assert.equal(await driver.get('SELECT * FROM t WHERE id = ?', ['none']), undefined);
  assert.deepEqual(await driver.run('INSERT INTO t (id, n, b) VALUES (?, ?, ?)', ['a', 1, null]), { changes: 1 });
  await driver.run('INSERT INTO t (id, n, b) VALUES (?, ?, ?)', ['b', 2, new Uint8Array([1, 2, 3])]);
  assert.deepEqual(await driver.get('SELECT id, n, b FROM t WHERE id = ?', ['a']), { id: 'a', n: 1, b: null });
  const blob = await driver.get<{ b: Uint8Array }>('SELECT b FROM t WHERE id = ?', ['b']);
  assert.ok(blob?.b instanceof Uint8Array, 'a BLOB comes back as bytes, not an array of numbers');
  assert.deepEqual([...blob.b], [1, 2, 3]);
  assert.equal((await driver.all('SELECT * FROM t')).length, 2);
  assert.deepEqual(await driver.run('UPDATE t SET n = n + 1'), { changes: 2 });
});

test('refuses more than 100 parameters and undefined with a clear error, before D1', async () => {
  const d1 = fakeD1();
  const driver = d1Driver(d1);
  await driver.run('CREATE TABLE t (id INTEGER)');
  const many = Array.from({ length: D1_MAX_PARAMS + 1 }, (_, i) => i);
  await assert.rejects(driver.all(`SELECT * FROM t WHERE id IN (${many.map(() => '?').join(',')})`, many), D1LimitError);
  const ok = many.slice(0, D1_MAX_PARAMS);
  assert.deepEqual(await driver.all(`SELECT * FROM t WHERE id IN (${ok.map(() => '?').join(',')})`, ok), []);
  await assert.rejects(driver.run('INSERT INTO t (id) VALUES (?)', [undefined as unknown as number]), D1LimitError);
});

test('a batch is one transaction; an empty one is not sent', async () => {
  const d1 = fakeD1();
  const driver = d1Driver(d1);
  await driver.run('CREATE TABLE t (id TEXT PRIMARY KEY)');
  await assert.rejects(driver.batch([{ sql: 'INSERT INTO t (id) VALUES (?)', params: ['a'] }, { sql: 'INSERT INTO t (id) VALUES (?)', params: ['a'] }]));
  assert.deepEqual(await driver.all('SELECT * FROM t'), [], 'the first insert rolled back with the failing one');
  const before = d1.queries;
  await driver.batch([]);
  assert.equal(d1.queries, before);
});

test('counts queries, rows read and rows written', async () => {
  const driver = d1Driver(fakeD1());
  await driver.run('CREATE TABLE t (id INTEGER)');
  await driver.batch([1, 2, 3].map((id) => ({ sql: 'INSERT INTO t (id) VALUES (?)', params: [id] })));
  await driver.all('SELECT * FROM t');
  assert.deepEqual(driver.counters(), { queries: 5, rowsRead: 3, rowsWritten: 3 });
});

test('the catalog migrates over D1, once per isolate: the next call costs nothing', async () => {
  const d1 = fakeD1();
  const driver = d1Driver(d1);
  await ensureMigrated(driver, d1);
  const versions = await driver.all<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(versions.map((v) => v.version), MIGRATIONS.map((m) => m.version));
  const before = d1.queries;
  await ensureMigrated(driver, d1);
  assert.equal(d1.queries, before);
  // A new isolate on a migrated database: one query.
  const other = d1Driver(d1);
  await ensureMigrated(other, {});
  assert.equal(d1.queries, before + 1);
  const catalog = new Catalog(driver, { signingKeys: KEYS });
  const user = await catalog.createUser({ name: 'Ada', email: 'ada@example.com', emailVerified: true });
  assert.equal((await catalog.getUser(user.id))?.name, 'Ada');
});

test('two isolates migrating one database at once both succeed, each migration applied once', async () => {
  for (let round = 0; round < 5; round++) {
    const d1 = fakeD1();
    const a = d1Driver(d1);
    const b = d1Driver(d1);
    await Promise.all([ensureMigrated(a, { a: round }), ensureMigrated(b, { b: round })]);
    const rows = await a.all<{ version: number }>('SELECT version FROM schema_migrations');
    assert.equal(rows.length, MIGRATIONS.length);
    assert.deepEqual(await migrate(a), []);
  }
});

test('a failed migration is tried again on the next call', async () => {
  const d1 = fakeD1();
  const driver = d1Driver(d1);
  const key = {};
  const broken = [{ version: 1, name: 'broken', statements: ['CREATE TABLE ('] }];
  await assert.rejects(ensureMigrated(driver, key, broken));
  await ensureMigrated(driver, key);
  assert.equal((await driver.all('SELECT version FROM schema_migrations')).length, MIGRATIONS.length);
});
