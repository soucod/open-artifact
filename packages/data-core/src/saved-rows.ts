/**
 * Saved rows: what people enter on the page (ticks, notes, targets), kept in the artifact's own store under `data/`
 * and read back as a source, `{kind: "store", path}`. A path with an odd number of segments names a collection (one
 * row per document, by document ID); an even number names one document (one row while it exists).
 */

import {
  USER_CHECK_DOCUMENT,
  USER_DATA_COLLECTION,
  USER_HISTORY_PREFIX,
  USER_PAGE_DOCUMENT,
  USER_RUNS_DOCUMENT,
} from './paths.ts';
import { normalizeTable } from './tables.ts';
import type { Table } from './types.ts';

/** Where saved rows live: `data/…`. */
export const SAVED_ROWS_ROOT = 'data';
/** `data/users/me/…` stands for the person looking at the page. */
export const CURRENT_VIEWER_ALIAS = 'me';
/** A collection gives at most this many rows, the first by document ID. */
export const MAX_SAVED_ROWS = 1000;
export const MAX_SAVED_ROWS_PATH_SEGMENTS = 16;
/** How long the first answer for saved rows may take before the source counts as failed. */
export const SAVED_ROWS_FIRST_ANSWER_MS = 10_000;

const SAVED_ROWS_SEGMENT = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const OWN_REPORT_NAMES: ReadonlySet<string> = new Set([USER_CHECK_DOCUMENT, USER_RUNS_DOCUMENT, USER_PAGE_DOCUMENT]);

/** Why a path can't hold saved rows. */
export type SavedRowsPathProblem = 'not_text' | 'outside_data' | 'bad_segment' | 'too_deep' | 'own_report';

export type SavedRowsShape = 'collection' | 'document';

/** One stored document of saved rows: its ID (the last path segment) and its fields. */
export interface SavedRowsDocument {
  id: string;
  data: Record<string, unknown>;
}

const segmentsOf = (path: string): string[] => path.split('/');

/** `data/users/<someone>` itself, or one of the type's own documents in it (`check`, `runs`, `page`, `history-…`). */
function isOwnReport(segments: readonly string[]): boolean {
  const [root, users, , name] = segments;
  if (`${root}/${users}` !== USER_DATA_COLLECTION) return false;
  if (segments.length === 3) return true;
  return segments.length === 4 && name !== undefined && (OWN_REPORT_NAMES.has(name) || name.startsWith(USER_HISTORY_PREFIX));
}

/** What keeps `path` from naming saved rows, or `null` when it does. */
export function savedRowsPathProblem(path: unknown): SavedRowsPathProblem | null {
  if (typeof path !== 'string' || path === '') return 'not_text';
  const segments = segmentsOf(path);
  if (segments[0] !== SAVED_ROWS_ROOT || segments.length < 2) return 'outside_data';
  if (segments.length > MAX_SAVED_ROWS_PATH_SEGMENTS) return 'too_deep';
  if (segments.some((segment) => segment === '.' || segment === '..' || !SAVED_ROWS_SEGMENT.test(segment))) return 'bad_segment';
  return isOwnReport(segments) ? 'own_report' : null;
}

export function isSavedRowsPath(path: unknown): path is string {
  return savedRowsPathProblem(path) === null;
}

/** A collection (odd number of segments) or one document (even). */
export function getSavedRowsShape(path: string): SavedRowsShape {
  return segmentsOf(path).length % 2 === 1 ? 'collection' : 'document';
}

/** The path with `data/users/me` read as this viewer's own folder. */
export function resolveSavedRowsPath(path: string, viewerId: string): string {
  const prefix = `${USER_DATA_COLLECTION}/${CURRENT_VIEWER_ALIAS}`;
  return path === prefix || path.startsWith(`${prefix}/`) ? `${USER_DATA_COLLECTION}/${viewerId}${path.slice(prefix.length)}` : path;
}

/**
 * Whether a stored path (with `me` already read as an id) is inside `data/users/<viewerId>/`, the folder that is that
 * person's own: what a commenter may write. The folder itself is no document, so it doesn't count.
 */
export function isInViewerFolder(path: string, viewerId: string): boolean {
  if (viewerId === '' || viewerId === CURRENT_VIEWER_ALIAS) return false;
  const segments = segmentsOf(path);
  return segments.length > 3 && `${segments[0]}/${segments[1]}` === USER_DATA_COLLECTION && segments[2] === viewerId && !segments.includes('..');
}

/** Orders document IDs as the store does: by UTF-16 code unit, so the same rows come first everywhere. */
export const compareSavedRowIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The rows a source of saved rows gives: one per document (all its fields, with its ID in `id`), sorted by ID and
 * cut to {@link MAX_SAVED_ROWS} (the table is then marked as cut). No documents give no rows, only the `id` column.
 */
export function savedRowsTable(documents: readonly SavedRowsDocument[]): Table {
  const sorted = [...documents].sort((a, b) => compareSavedRowIds(a.id, b.id));
  const kept = sorted.slice(0, MAX_SAVED_ROWS);
  const table = normalizeTable({ columns: ['id'], rows: kept.map((document) => ({ ...document.data, id: document.id })) });
  const rows = table ?? { columns: [], rows: [] };
  const columns = rows.columns.length === 0 ? ['id'] : rows.columns;
  return sorted.length > MAX_SAVED_ROWS ? { columns, rows: rows.rows, cut: 'rows' } : { columns, rows: rows.rows };
}
