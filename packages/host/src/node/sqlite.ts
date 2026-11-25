/**
 * A {@link SqlDriver} over `node:sqlite` (built into Node >= 22.13, no flag).
 *
 * The database runs in WAL mode with foreign keys on and a busy timeout;
 * statements are prepared once and cached. `node:sqlite` is synchronous, so
 * each call finishes before the next starts, and `batch` runs in one
 * `BEGIN IMMEDIATE … COMMIT`.
 *
 * The catalog holds hashes of every credential and the encrypted link tokens, so its files are the owner's alone:
 * the database, its `-wal` and `-shm` are mode 0600 (SQLite gives the side files the database's mode).
 */

import { chmodSync, closeSync, existsSync, openSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { SqlDriver, SqlStatement, SqlValue } from '../core/types.ts';

export interface SqliteDriver extends SqlDriver {
  /** The underlying database (for tests and maintenance). */
  readonly db: DatabaseSync;
  close(): void;
}

/** Opens (creating if needed) a SQLite database at `path`, or an in-memory one for `':memory:'`. */
export function openSqlite(path: string): SqliteDriver {
  const onDisk = path !== ':memory:';
  if (onDisk) {
    // Made 0600 before SQLite opens it (the umask cannot widen a mode it only narrows), and narrowed when older.
    closeSync(openSync(path, 'a', 0o600));
    chmodSync(path, 0o600);
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  if (onDisk) {
    db.exec('PRAGMA journal_mode = WAL');
    for (const side of [`${path}-wal`, `${path}-shm`]) if (existsSync(side)) chmodSync(side, 0o600);
  }
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');

  const cache = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };
  const bind = (params: SqlValue[] | undefined): SQLInputValue[] => params ?? [];

  return {
    db,
    async all<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
      return prepare(sql).all(...bind(params)) as T[];
    },
    async get<T>(sql: string, params?: SqlValue[]): Promise<T | undefined> {
      return prepare(sql).get(...bind(params)) as T | undefined;
    },
    async run(sql: string, params?: SqlValue[]): Promise<{ changes: number }> {
      return { changes: Number(prepare(sql).run(...bind(params)).changes) };
    },
    async batch(statements: SqlStatement[]): Promise<void> {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const { sql, params } of statements) prepare(sql).run(...bind(params));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close(): void {
      cache.clear();
      db.close();
    },
  };
}
