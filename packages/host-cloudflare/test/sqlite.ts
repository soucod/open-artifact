/**
 * A Durable Object's storage played by `node:sqlite`, for tests: `exec` returns a cursor with the rows and what it
 * read and wrote, blobs come back as `ArrayBuffer` (as a Durable Object returns them), and `transactionSync` is a
 * savepoint. Rows written are SQLite's change count; rows read are the rows returned plus the rows changed (an update
 * or delete reads what it changes) — close to, though not exactly, what the platform bills.
 *
 * Every statement on the file system's tables is also planned (`EXPLAIN QUERY PLAN`): a full scan of one of them is
 * recorded in `scans`, so a test can assert that common operations never scan.
 */
import { DatabaseSync } from 'node:sqlite';
import type { SyncCursor, SyncStorage } from '../src/fs/sql.ts';

export interface TestStorage extends SyncStorage {
  db: DatabaseSync;
  /** Statements that planned a full scan of a file system table, with that plan. */
  scans: { query: string; plan: string }[];
  /** Make the next statement whose text includes `fragment` throw (a crash in the middle of a call). */
  failOn(fragment: string | null): void;
  close(): void;
}

export function testStorage(file = ':memory:'): TestStorage {
  const db = new DatabaseSync(file);
  const scans: { query: string; plan: string }[] = [];
  let failing: string | null = null;
  let depth = 0;
  const totalChanges = (): number => Number((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n);

  const exec = <T>(query: string, ...bindings: unknown[]): SyncCursor<T> => {
    if (failing && query.includes(failing)) {
      failing = null;
      throw new Error(`simulated failure at: ${query}`);
    }
    const values = bindings.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value)) as (string | number | null | Uint8Array)[];
    if (/oa_fs_/.test(query) && /^\s*(SELECT|UPDATE|DELETE|INSERT|WITH)/i.test(query)) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...values) as { detail: string }[];
      for (const step of plan) if (/^SCAN oa_fs_/.test(step.detail)) scans.push({ query, plan: step.detail });
    }
    const before = totalChanges();
    const statement = db.prepare(query);
    const returns = statement.columns().length > 0;
    const rows = (returns ? statement.all(...values) : (statement.run(...values), [])) as Record<string, unknown>[];
    const written = totalChanges() - before;
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (value instanceof Uint8Array) row[key] = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      }
    }
    return { toArray: () => rows as T[], rowsRead: rows.length + written, rowsWritten: written };
  };

  return {
    db,
    scans,
    sql: { exec },
    transactionSync<T>(closure: () => T): T {
      const name = `oa_tx_${depth++}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const result = closure();
        db.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw error;
      } finally {
        depth--;
      }
    },
    failOn(fragment) {
      failing = fragment;
    },
    close() {
      db.close();
    },
  };
}
