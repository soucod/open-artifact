/**
 * The SQL seam the catalog runs on. Each platform supplies a {@link SqlDriver}:
 * `node:sqlite` (`src/node/sqlite.ts`), later D1 and Postgres.
 *
 * Rules for SQL written against it (so one schema serves SQLite and Postgres):
 * `?` placeholders; no SQLite-only functions; times as ISO-8601 strings
 * (compared as text); booleans as integers 0/1; JSON as text.
 */
export type { SqlDriver, SqlStatement, SqlValue } from '../types.ts';
