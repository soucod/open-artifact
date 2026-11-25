/**
 * `read-db` / `write-db`: the CLI's way into a db-backed artifact (the
 * Whiteboard). Both work on the folder directly, in the shapes of the
 * reserved actions `open-artifact.db.read` / `open-artifact.db.write`; a running server's watcher
 * reports the written documents to open pages as the agent's changes.
 *
 * ```
 * read-db <dir>                      every document path
 * read-db <dir> elements             one collection, with data
 * read-db <dir> board/meta           one document
 * write-db <dir> '[{"op":"update","path":"board/meta","data":{"title":"Plan"}}]'
 * write-db <dir> writes.json         a file holding the same array
 * write-db <dir> -                   the array on stdin
 * ```
 *
 * In a write's `data`, `{"$file": "path"}` anywhere stands for that file's
 * text (relative to the working directory): an SVG or an embed's HTML goes
 * in without escaping it into JSON. A refused batch prints
 * `{"error": "CODE", "message": …}` and writes nothing.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { IDEA_DOCUMENT_PATTERN, ideaDocumentProblem } from '@open-artifact/whiteboard-core';
import { DbStore, mergePatch, splitPath } from '@open-artifact/server-sdk/db';
import { clearAsking, resetEdits } from './agent.ts';
import { detectType } from './server.ts';
import { TYPES, contentDirOf, type TypeName } from './types.ts';

/** Prints an error and returns the exit code. */
function fail(message: string): number {
  console.error(message);
  return 1;
}

/** The db-backed type whose marker document a batch writes (a new artifact's first batch), or `null`. */
function typeWrittenBy(writes: unknown): TypeName | null {
  if (!Array.isArray(writes)) return null;
  for (const write of writes) {
    if (!isPlain(write) || (write.op !== 'set' && write.op !== 'update')) continue;
    const named = String(write.path ?? (write.collection != null && write.doc_id != null ? `${String(write.collection)}/${String(write.doc_id)}` : '')).replace(/^\/+|\/+$/g, '');
    const type = Object.values(TYPES).find((t) => t.store === 'db' && t.marker === `${named}.json`);
    if (type) return type.name;
  }
  return null;
}

/** The artifact folder and its type, when it holds a db-backed type (or `writes` starts one there). */
async function dbRoot(dir: string | undefined, writes?: unknown): Promise<{ root: string; type: TypeName } | string> {
  if (!dir) return 'Pass the artifact folder.';
  const root = resolve(dir);
  const type = (await detectType(root)) ?? typeWrittenBy(writes);
  if (!type || TYPES[type].store !== 'db') {
    const kinds = Object.values(TYPES).filter((t) => t.store === 'db').map((t) => `${t.name} (${contentDirOf(t.name)}/${t.marker})`);
    return `${root} is not a db-backed artifact: ${kinds.join(', ')}. A batch that writes one of those documents starts one.`;
  }
  return { root, type };
}

/** `read-db <dir> [path]`: prints the documents as JSON. */
export async function cmdReadDb(positional: string[], options: { text?: boolean } = {}): Promise<number> {
  const found = await dbRoot(positional[0]);
  if (typeof found === 'string') return fail(found);
  const { root } = found;
  try {
    const read = new DbStore(root).readDb(positional[1] ?? '');
    if (options.text) {
      // A document's `text` as it is (a page file), for reading or diffing without the JSON quoting.
      const doc = read as { path?: string; exists?: boolean; data?: { text?: unknown } | null };
      if (typeof doc.exists !== 'boolean') return fail(`--text reads one document; ${positional[1] || 'the root'} is a collection.`);
      if (!doc.exists) return fail(`${doc.path} does not exist.`);
      const text = doc.data?.text;
      if (typeof text !== 'string') return fail(`${doc.path} has no text field.`);
      process.stdout.write(text);
      resetEdits(root);
      clearAsking(root);
      return 0;
    }
    console.log(JSON.stringify(read, null, 2));
    // The agent has read the content: people's edits are counted again from here (the view context's `edits`), and
    // it no longer waits on an answer.
    resetEdits(root);
    clearAsking(root);
    return 0;
  } catch (error) {
    return fail((error as Error).message);
  }
}

/** Reads the writes argument: inline JSON, a file, or `-` for stdin. */
function readWrites(source: string): unknown {
  const text = source === '-' ? readFileSync(0, 'utf8') : /^\s*[[{]/.test(source) ? source : existsSync(source) ? readFileSync(source, 'utf8') : null;
  if (text === null) throw new Error(`${source}: no such file (pass inline JSON, a file, or - for stdin).`);
  const value = JSON.parse(text) as unknown;
  // Accept a bare array, `{writes: […]}`, or a single write.
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { writes?: unknown }).writes)) return (value as { writes: unknown[] }).writes;
  return [value];
}

/** A refusal: printed as `{"error": CODE, "message": …}`, nothing written. */
class Refusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `{"$file": "path"}` anywhere in `value` becomes that file's text (relative to the working directory). */
export function resolveFileRefs(value: unknown, where: string): unknown {
  if (Array.isArray(value)) return value.map((item, index) => resolveFileRefs(item, `${where}[${index}]`));
  if (!isPlain(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$file') {
    if (typeof value.$file !== 'string' || !value.$file) throw new Refusal('INVALID_FILE_REF', `${where}: {"$file": …} names a file path.`);
    const file = resolve(value.$file);
    try {
      return readFileSync(file, 'utf8');
    } catch {
      throw new Refusal('FILE_NOT_FOUND', `${where}: {"$file": ${JSON.stringify(value.$file)}}: cannot read ${file}. Nothing was written.`);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = resolveFileRefs(item, `${where}.${key}`);
  return out;
}

/** Refuses a batch that would leave a saved idea the page cannot show (whiteboard). */
function checkIdeas(store: DbStore, writes: unknown[]): void {
  for (const write of writes) {
    if (!isPlain(write) || (write.op !== 'set' && write.op !== 'update')) continue;
    const named = write.path ?? (write.collection != null && write.doc_id != null ? `${String(write.collection)}/${String(write.doc_id)}` : '');
    let path: string;
    try {
      path = splitPath(String(named), 'doc').join('/');
    } catch {
      continue; // the store reports a bad path
    }
    if (!IDEA_DOCUMENT_PATTERN.test(path) || !isPlain(write.data)) continue;
    const data = write.op === 'update' ? mergePatch(store.readDoc(path) ?? {}, write.data) : write.data;
    const problem = ideaDocumentProblem(data, path);
    if (problem) throw new Refusal(problem.code, `${problem.message} Nothing was written.`);
  }
}

/** `write-db <dir> <json|file|->`: applies the writes all-or-nothing and prints the results. */
export async function cmdWriteDb(positional: string[]): Promise<number> {
  const source = positional[1];
  if (positional[0] && !source) return fail('Pass the writes: inline JSON, a file, or - for stdin.');
  let writes: unknown = null;
  try {
    if (source) writes = readWrites(source);
  } catch (error) {
    return refused(error);
  }
  const found = await dbRoot(positional[0], writes);
  if (typeof found === 'string') return fail(found);
  const { root, type } = found;
  try {
    const store = new DbStore(root);
    if (Array.isArray(writes)) {
      for (const [index, write] of writes.entries()) {
        if (!isPlain(write)) continue;
        // `file_path` must be absolute for the store; resolve relative ones against the working directory.
        if (typeof write.file_path === 'string' && write.file_path && !isAbsolute(write.file_path)) write.file_path = resolve(write.file_path);
        if (write.data !== undefined) write.data = resolveFileRefs(write.data, `writes[${index}].data`);
      }
      checkIdeas(store, writes);
      const problem = TYPES[type].writesProblem?.(writes, (path) => store.readDoc(path));
      if (problem) throw new Refusal(problem.code, `${problem.message} Nothing was written.`);
    }
    console.log(JSON.stringify({ writes: store.writeDb(writes) }, null, 2));
    return 0;
  } catch (error) {
    return refused(error);
  }
}

/** Prints a refused batch as `{"error": CODE, "message": …}` and returns the exit code. */
function refused(error: unknown): number {
  const code = error instanceof Refusal ? error.code : typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code).toUpperCase() : 'INVALID';
  const message = error instanceof SyntaxError ? `The writes are not JSON: ${error.message}` : (error as Error).message;
  console.log(JSON.stringify({ error: code, message }));
  console.error(message);
  return 1;
}
