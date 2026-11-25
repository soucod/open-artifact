/**
 * The catalog's {@link SqlDriver} over a D1 binding, and its migration once per isolate.
 *
 * D1's rules, and what this driver does about each:
 *
 * - A statement binds at most {@link D1_MAX_PARAMS} (100) parameters: a longer list is refused here with a clear error
 *   (before D1's own, which names no statement). The catalog stays under it except where a list is the caller's
 *   (`markOutboxDelivered`/`ackOutbox` with a long id list, `grantsMatching` for a user in many groups).
 * - A statement is at most {@link D1_MAX_SQL_BYTES} long: refused here likewise.
 * - `first()` answers `null` for no row; the seam's `get` answers `undefined`. `get` reads with `all()` and takes the
 *   first row, so its rows read are counted like every other statement.
 * - `undefined` cannot be bound; `null` can. A BLOB comes back as an array of numbers: made a `Uint8Array` again.
 * - `batch()` runs its statements in one transaction (D1 has no `BEGIN` of its own); an empty batch is not sent.
 *
 * {@link d1Driver} counts statements, rows read and rows written (D1's `meta`), which `stats()` reports.
 */

import { MIGRATIONS, migrate, type Migration } from '@open-artifact/host';
import type { SqlDriver, SqlStatement, SqlValue } from '@open-artifact/host';

/** The most parameters one D1 statement binds. */
export const D1_MAX_PARAMS = 100;
/** The longest SQL statement D1 takes, bytes. */
export const D1_MAX_SQL_BYTES = 100_000;

/** What a D1 statement answers. */
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes?: number; rows_read?: number; rows_written?: number; duration?: number; last_row_id?: number };
}

/** A prepared D1 statement, as far as the driver uses one. */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

/** A D1 database binding (`env.DB`), as far as the driver uses one. */
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** What a {@link D1Driver} has done since it was made. */
export interface D1Counters {
  queries: number;
  rowsRead: number;
  rowsWritten: number;
}

export interface D1Driver extends SqlDriver {
  readonly db: D1Database;
  counters(): D1Counters;
}

/** A statement D1 would refuse, refused here with the reason. */
export class D1LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'D1LimitError';
  }
}

const encoder = new TextEncoder();

function checkStatement(sql: string, params: readonly SqlValue[] | undefined): void {
  if ((params?.length ?? 0) > D1_MAX_PARAMS) {
    throw new D1LimitError(`D1 binds at most ${D1_MAX_PARAMS} parameters; this statement has ${params!.length}: ${sql.slice(0, 120)}`);
  }
  if (encoder.encode(sql).byteLength > D1_MAX_SQL_BYTES) throw new D1LimitError(`D1 takes statements of at most ${D1_MAX_SQL_BYTES} bytes: ${sql.slice(0, 120)}…`);
  for (const value of params ?? []) {
    if (value === undefined) throw new D1LimitError(`D1 cannot bind undefined (use null): ${sql.slice(0, 120)}`);
  }
}

/** A row as the seam gives it: BLOBs (arrays of numbers on D1) as `Uint8Array`s. */
function rowOf<T>(row: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(row)) {
    if (Array.isArray(value)) row[key] = Uint8Array.from(value as number[]);
    else if (value instanceof ArrayBuffer) row[key] = new Uint8Array(value);
  }
  return row as T;
}

/** A {@link SqlDriver} over `db`. */
export function d1Driver(db: D1Database): D1Driver {
  const counters: D1Counters = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  const count = (meta: D1Result['meta'] | undefined): void => {
    counters.queries++;
    counters.rowsRead += meta?.rows_read ?? 0;
    counters.rowsWritten += meta?.rows_written ?? 0;
  };
  const prepare = (sql: string, params: SqlValue[] | undefined): D1PreparedStatement => {
    checkStatement(sql, params);
    const statement = db.prepare(sql);
    return params && params.length > 0 ? statement.bind(...params) : statement;
  };

  return {
    db,
    counters: () => ({ ...counters }),
    async all<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
      const result = await prepare(sql, params).all<Record<string, unknown>>();
      count(result.meta);
      return result.results.map((row) => rowOf<T>(row));
    },
    async get<T>(sql: string, params?: SqlValue[]): Promise<T | undefined> {
      const result = await prepare(sql, params).all<Record<string, unknown>>();
      count(result.meta);
      const row = result.results[0];
      return row ? rowOf<T>(row) : undefined;
    },
    async run(sql: string, params?: SqlValue[]): Promise<{ changes: number }> {
      const result = await prepare(sql, params).run();
      count(result.meta);
      return { changes: Number(result.meta?.changes ?? 0) };
    },
    async batch(statements: SqlStatement[]): Promise<void> {
      if (statements.length === 0) return;
      const prepared = statements.map(({ sql, params }) => prepare(sql, params));
      const results = await db.batch(prepared);
      for (const result of results) count(result.meta);
    },
  };
}

/** Migrations per database binding, once per isolate (a failed attempt is tried again on the next call). */
const migrated = new WeakMap<object, Promise<void>>();

/**
 * Migrates the catalog once per isolate: after the first success every call is free. Safe when two isolates race:
 * each migration is one D1 batch (one transaction) with its `schema_migrations` row, so of two isolates applying the
 * same migration one commits and the other's batch fails whole (the table exists, or the version's primary key does);
 * the loser then reads the versions again and is done when every migration is recorded.
 *
 * The fast path is one query: `SELECT version FROM schema_migrations` naming every version.
 */
export function ensureMigrated(driver: SqlDriver, key: object = driver, migrations: readonly Migration[] = MIGRATIONS): Promise<void> {
  let done = migrated.get(key);
  if (!done) {
    done = migrateRacing(driver, migrations);
    done.catch(() => migrated.delete(key));
    migrated.set(key, done);
  }
  return done;
}

async function recorded(driver: SqlDriver): Promise<Set<number> | null> {
  try {
    const rows = await driver.all<{ version: number }>('SELECT version FROM schema_migrations');
    return new Set(rows.map((row) => Number(row.version)));
  } catch {
    return null;
  }
}

async function migrateRacing(driver: SqlDriver, migrations: readonly Migration[]): Promise<void> {
  const all = (versions: Set<number> | null): boolean => versions !== null && migrations.every((m) => versions.has(m.version));
  if (all(await recorded(driver))) return;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await migrate(driver, migrations);
      return;
    } catch (error) {
      lastError = error;
      // Another isolate may have applied it meanwhile: done when every version is recorded now.
      if (all(await recorded(driver))) return;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw lastError;
}
