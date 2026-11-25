/**
 * The Motion type as the server sees it: a db-backed type whose content is the
 * film's documents under `db/` (see `@open-artifact/motion-core`).
 *
 * ```
 * db/film/meta.json              {v: 1, title, updatedAt}     the marker
 * db/film/script.json            {code}: the cut, which sets window.CUT
 * db/modules/<name>.json         {kind, text} (split parts <name>~1 … ~99)
 * db/assets/<name>.json          {ref, mime, w?, h?, note?}
 * db/data/users/<uid>/…          each person's own documents
 * comments.json                  review threads
 * ```
 */

import {
  FILM_META_PATH,
  USER_DATA_COLLECTION,
  checkFilm,
  scaffoldFilmFiles,
  validateVideoViewContext,
  videoWritesProblem,
  type SyntaxProblem,
} from '@open-artifact/motion-core';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parse } from 'acorn';
import type { CheckContext, CheckFinding, WriteRefusal } from './types.ts';

/** The marker file, relative to the content folder (`db/`). */
export const MOTION_MARKER = `${FILM_META_PATH}.json`;

/** Files of a new motion artifact, relative to `db/`: its meta only, so the page shows "No animation yet". */
export function scaffoldMotion(title: string): Record<string, string> {
  return scaffoldFilmFiles(title);
}

export const validateMotionContext = (value: unknown): unknown => validateVideoViewContext(value);

/** People's own documents (`data/…`) are not edits of the film, so the version history leaves them out. */
export const motionHistoryIgnores = (path: string): boolean => path.startsWith(`${USER_DATA_COLLECTION}/`);

/**
 * Parses code as the player runs it: a classic script, inside a block, with `kit` in scope. Nothing is run. The
 * parser is acorn (JavaScript itself, no `node:vm`), so the check is the same on a host without `vm`, such as a
 * Worker. `_name` is the file the problem is reported against by the caller.
 */
export function motionSyntaxError(code: string, _name: string): SyntaxProblem | null {
  try {
    parse(`{ const kit = undefined;\n${code}\n}`, { ecmaVersion: 'latest', sourceType: 'script' });
    return null;
  } catch (error) {
    if (!(error instanceof SyntaxError)) return null;
    const line = (error as SyntaxError & { loc?: { line?: unknown } }).loc?.line;
    // acorn ends its message with the position, "(line:column)": the line is reported on its own.
    const message = error.message.replace(/\s*\(\d+:\d+\)$/, '');
    return { message, ...(typeof line === 'number' && line > 1 ? { line: line - 1 } : {}) };
  }
}

/** Checks a motion artifact. `files` maps document paths (`modules/scenes.json`) to the raw JSON text on disk. */
export function checkMotion(files: ReadonlyMap<string, string>, context: CheckContext = {}): CheckFinding[] {
  return checkFilm(files, { syntaxError: motionSyntaxError, ...(context.blobExists ? { blobExists: context.blobExists } : {}) });
}

const MAX_FILE_PATH_BYTES = 4 * 1024 * 1024;

/** The data a write names by `file_path`, read as the store will read it; the write as given when it cannot be read. */
function withFileData(write: unknown): unknown {
  if (typeof write !== 'object' || write === null || Array.isArray(write)) return write;
  const record = write as Record<string, unknown>;
  const file = record.file_path;
  if (record.data !== undefined || typeof file !== 'string' || !isAbsolute(file)) return write;
  try {
    if (statSync(file).size > MAX_FILE_PATH_BYTES) return write;
    return { ...record, data: JSON.parse(readFileSync(file, 'utf8')) as unknown };
  } catch {
    return write;
  }
}

/** Refuses an agent's batch that the player would drop part of, or that writes what only the page writes. */
export function motionTypeWritesProblem(writes: readonly unknown[], read: (path: string) => unknown): WriteRefusal | null {
  return videoWritesProblem(writes.map(withFileData), read);
}
