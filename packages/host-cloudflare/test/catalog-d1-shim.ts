/**
 * Stands in for `packages/host/src/node/sqlite.ts` when the host's catalog tests run on D1 (`catalog-d1.test.ts`):
 * `openSqlite(path)` answers the D1 driver over a fresh database, real local D1 (wrangler's platform
 * proxy from `deploy/cloudflare/node_modules`) when `OA_TEST_D1=miniflare`, else the in-process fake that keeps D1's rules.
 *
 * `db.exec` (the tests' SQLite pragmas) does nothing; the tests that read SQLite's own files or journal mode are
 * skipped by the caller.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SqlDriver, SqlStatement, SqlValue } from '@open-artifact/host';
import { d1Driver, type D1Database } from '../src/d1.ts';
import { fakeD1 } from './d1-fake.ts';

interface PlatformProxy {
  env: Record<string, D1Database>;
  dispose(): Promise<void>;
}

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const DATABASES = 64;
let proxy: Promise<PlatformProxy> | null = null;
let count = 0;

// workerd keeps the process alive: end it when the file's tests are done.
after(async () => {
  if (proxy) await (await proxy).dispose();
});

/** Real local D1: wrangler's platform proxy (workerd) over a throwaway config with {@link DATABASES} databases, not persisted. */
async function startProxy(): Promise<PlatformProxy> {
  const { getPlatformProxy } = (await import(pathToFileURL(join(repo, 'deploy/cloudflare/node_modules/wrangler/wrangler-dist/cli.js')).href)) as {
    getPlatformProxy(options: Record<string, unknown>): Promise<PlatformProxy>;
  };
  const dir = mkdtempSync(join(tmpdir(), 'open-artifact-d1-'));
  const configPath = join(dir, 'wrangler.json');
  const d1 = Array.from({ length: DATABASES }, (_, i) => ({ binding: `DB${i}`, database_name: `catalog-${i}`, database_id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}` }));
  writeFileSync(configPath, JSON.stringify({ name: 'catalog-tests', compatibility_date: '2025-09-01', d1_databases: d1 }));
  return getPlatformProxy({ configPath, persist: false, remoteBindings: false, envFiles: [] });
}

async function database(): Promise<D1Database> {
  if (process.env.OA_TEST_D1 !== 'miniflare') return fakeD1();
  proxy ??= startProxy();
  const index = count++;
  if (index >= DATABASES) throw new Error(`More than ${DATABASES} catalogs in one run.`);
  return (await proxy).env[`DB${index}`]!;
}

const pending = new Map<string, Promise<D1Database>>();

export interface SqliteDriver extends SqlDriver {
  readonly db: { exec(sql: string): void };
  close(): void;
}

/** A D1-backed driver; the database is made on first use (the seam is asynchronous, `openSqlite` is not). */
export function openSqlite(path: string): SqliteDriver {
  let made = pending.get(path);
  if (!made) pending.set(path, (made = database()));
  const ready = made.then((db) => d1Driver(db));
  return {
    db: { exec: () => undefined },
    async all<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
      return (await ready).all<T>(sql, params);
    },
    async get<T>(sql: string, params?: SqlValue[]): Promise<T | undefined> {
      return (await ready).get<T>(sql, params);
    },
    async run(sql: string, params?: SqlValue[]): Promise<{ changes: number }> {
      return (await ready).run(sql, params);
    },
    async batch(statements: SqlStatement[]): Promise<void> {
      return (await ready).batch(statements);
    },
    close() {
      /* the proxy is shared by the file's tests; it is disposed after them */
    },
  };
}
