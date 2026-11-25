/**
 * A D1 binding over `node:sqlite` that keeps D1's rules, for tests that do not start workerd:
 *
 * - at most 100 bound parameters a statement, statements of at most 100 000 bytes;
 * - `undefined` cannot be bound; `BEGIN`/`COMMIT`/`SAVEPOINT` are refused (D1 has no transaction statements: a batch is
 *   the transaction);
 * - `first()` answers `null` for no row; BLOBs come back as arrays of numbers;
 * - `batch()` is one transaction; an empty batch is refused;
 * - every answer is asynchronous and carries `meta` (`changes`, `rows_read`, `rows_written`).
 *
 * `queries` counts the statements it ran (a batch's each).
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../src/d1.ts';

export interface FakeD1 extends D1Database {
  readonly sqlite: DatabaseSync;
  queries: number;
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function asD1Row(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = value instanceof Uint8Array ? Array.from(value) : value;
  return out;
}

export function fakeD1(path = ':memory:'): FakeD1 {
  const sqlite = new DatabaseSync(path);
  const d1: FakeD1 = {
    sqlite,
    queries: 0,
    prepare(sql: string): D1PreparedStatement {
      return statement(sql, []);
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      if (statements.length === 0) throw new Error('D1_ERROR: No SQL statements to execute.');
      await tick();
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((s) => execute((s as Statement).sql, (s as Statement).params) as D1Result<T>);
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };

  interface Statement extends D1PreparedStatement {
    sql: string;
    params: unknown[];
  }

  function check(sql: string, params: unknown[]): void {
    if (params.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${params.length}).`);
    if (Buffer.byteLength(sql) > 100_000) throw new Error('D1_ERROR: statement too long.');
    if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)) throw new Error('D1_ERROR: transactions are not supported: use batch().');
    for (const value of params) if (value === undefined) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
  }

  function execute(sql: string, params: unknown[]): D1Result {
    check(sql, params);
    d1.queries++;
    const prepared = sqlite.prepare(sql);
    const bound = params as SQLInputValue[];
    if (prepared.columns().length > 0) {
      const rows = prepared.all(...bound) as Record<string, unknown>[];
      return { results: rows.map(asD1Row), success: true, meta: { changes: 0, rows_read: rows.length, rows_written: 0 } };
    }
    const info = prepared.run(...bound);
    const changes = Number(info.changes);
    return { results: [], success: true, meta: { changes, rows_read: 0, rows_written: changes } };
  }

  function statement(sql: string, params: unknown[]): Statement {
    return {
      sql,
      params,
      bind(...values: unknown[]) {
        return statement(sql, values);
      },
      async all<T>() {
        await tick();
        return execute(sql, params) as D1Result<T>;
      },
      async run<T>() {
        await tick();
        return execute(sql, params) as D1Result<T>;
      },
      async first<T>() {
        await tick();
        const result = execute(sql, params);
        return (result.results[0] as T | undefined) ?? null;
      },
    };
  }

  return d1;
}
