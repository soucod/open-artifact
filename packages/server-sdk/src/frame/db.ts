/**
 * The db capability's local backend: documents are JSON files at
 * `<root>/db/<collection>/<doc>.json`, a subcollection is a folder beside its
 * document (`db/a/b.json` and `db/a/b/c/`). Paths follow the capability's
 * grammar; queries (where / one orderBy / limit) run over one collection's
 * files. Leases (`acquire`) live in memory.
 *
 * `readDb` / `writeDb` are the agent's view (`open-artifact.db.read` / `open-artifact.db.write`),
 * in the shapes the CLI libraries answer.
 */

import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { FrameError, LINK_GUARD, writeAtomic, type PathGuard } from './files.ts';
import type { Json, JsonObject } from './page-values.ts';

export type { Json, JsonObject } from './page-values.ts';

export const DB_DIR = 'db';
export const DOC_MAX_BYTES = 256 * 1024;
const DEPTH_MAX = 32;
const SEGMENT = /^[A-Za-z0-9_\-.~:@+]+$/;
const OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains']);
const SHA = /^[0-9a-f]{64}$/;
/** Largest page of an agent's read. */
export const READ_MAX = 1000;

export const dbError = (code: string, message: string, extra: Record<string, unknown> = {}): FrameError =>
  new FrameError(code, message, code === 'invalid_argument' ? 400 : 409, extra);

/**
 * A document's hash for `if_match`: the sha256 (lowercase hex) of its data as
 * compact JSON, so reformatting a file by hand does not change it.
 */
export function docSha256(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

/** The fix for a `set` / `delete` over an existing document without `if_match`. */
export const IF_MATCH_FIX = 'Read the document with ArtifactData {action: "get"} and pass its sha256 as if_match, or pass "*" to replace it anyway.';

/** A new random document id (what `add()` names a document). */
export function newDocId(): string {
  return randomBytes(10).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
}

/** Splits and checks a db path. `kind`: 'doc', 'collection' or 'any' ('' is the root, allowed for 'any' only). */
export function splitPath(p: unknown, kind: 'doc' | 'collection' | 'any' = 'any'): string[] {
  if (typeof p !== 'string') throw dbError('invalid_argument', 'A db path is a string.');
  const trimmed = p.replace(/^\/+|\/+$/g, '');
  if (trimmed === '') {
    if (kind === 'any') return [];
    throw dbError('invalid_argument', 'An empty db path names no document or collection.');
  }
  if (Buffer.byteLength(trimmed) > 1000) throw dbError('invalid_argument', 'A db path is at most 1000 bytes.');
  const segs = trimmed.split('/');
  if (segs.length > 16) throw dbError('invalid_argument', 'A db path has at most 16 segments.');
  for (const s of segs) {
    if (!SEGMENT.test(s) || s === '.' || s === '..' || Buffer.byteLength(s) > 200) throw dbError('invalid_argument', `Bad db path segment ${JSON.stringify(s)}.`);
  }
  if (kind === 'doc' && segs.length % 2 !== 0) throw dbError('invalid_argument', `${trimmed} names a collection, not a document.`);
  if (kind === 'collection' && segs.length % 2 !== 1) throw dbError('invalid_argument', `${trimmed} names a document, not a collection.`);
  return segs;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** RFC 7386-style merge for `update`: objects merge, arrays and scalars replace, `{__delete__: true}` removes a key. */
export function mergePatch(target: unknown, patch: Record<string, unknown>): JsonObject {
  const out: Record<string, unknown> = isPlain(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (isPlain(v) && v.__delete__ === true && Object.keys(v).length === 1) delete out[k];
    else if (isPlain(v)) out[k] = mergePatch(out[k], v);
    else out[k] = v;
  }
  return out as JsonObject;
}

function hasDeleteMarker(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasDeleteMarker);
  if (!isPlain(v)) return false;
  if (v.__delete__ === true) return true;
  return Object.values(v).some(hasDeleteMarker);
}

function depthOf(v: unknown, d = 0): number {
  if (d > DEPTH_MAX) return d;
  if (Array.isArray(v)) return Math.max(d, ...v.map((x) => depthOf(x, d + 1)));
  if (isPlain(v)) return Math.max(d, ...Object.values(v).map((x) => depthOf(x, d + 1)));
  return d;
}

function checkData(data: unknown): string {
  if (!isPlain(data)) throw dbError('invalid_argument', 'Document data is a JSON object.');
  const text = JSON.stringify(data);
  if (Buffer.byteLength(text) > DOC_MAX_BYTES) throw dbError('too_large', `A document is at most ${DOC_MAX_BYTES} bytes.`);
  if (depthOf(data) > DEPTH_MAX) throw dbError('invalid_argument', `A document nests at most ${DEPTH_MAX} levels.`);
  return text;
}

function fieldOf(data: unknown, field: string): unknown {
  if (field === '__name__' || field === 'id') return undefined;
  let v = data;
  for (const k of String(field).split('.')) {
    if (!isPlain(v)) return undefined;
    v = v[k];
  }
  return v;
}

const typeRank = (v: unknown): number =>
  v === null ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'number' ? 2 : typeof v === 'string' ? 3 : Array.isArray(v) ? 4 : 5;

function compare(a: unknown, b: unknown): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2) return (a as number) - (b as number);
  if (ra === 3) return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
  if (ra === 1) return Number(a) - Number(b);
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface Where {
  field: string;
  op: string;
  value: unknown;
}

export interface QuerySpec {
  where: Where[];
  orderBy: { field: string; dir: 'asc' | 'desc' } | null;
  limit: number | null;
}

export interface Doc {
  id: string;
  data: JsonObject;
}

function matches(doc: Doc, w: Where): boolean {
  const v = w.field === '__name__' || w.field === 'id' ? doc.id : fieldOf(doc.data, w.field);
  switch (w.op) {
    case '==':
      return v !== undefined && same(v, w.value);
    case '!=':
      return v !== undefined && !same(v, w.value);
    case '<':
    case '<=':
    case '>':
    case '>=': {
      if (v === undefined || typeRank(v) !== typeRank(w.value)) return false;
      const c = compare(v, w.value);
      return w.op === '<' ? c < 0 : w.op === '<=' ? c <= 0 : w.op === '>' ? c > 0 : c >= 0;
    }
    case 'in':
      return v !== undefined && Array.isArray(w.value) && w.value.some((x) => same(x, v));
    case 'not-in':
      return v !== undefined && Array.isArray(w.value) && !w.value.some((x) => same(x, v));
    case 'array-contains':
      return Array.isArray(v) && v.some((x) => same(x, w.value));
    default:
      return false;
  }
}

/** Checks a query spec from a page: `{where?: [{field, op, value}], orderBy?: {field, dir}, limit?}`. */
export function checkSpec(raw: unknown = {}): QuerySpec {
  const spec = isPlain(raw) ? raw : {};
  const where = (Array.isArray(spec.where) ? spec.where : []) as Where[];
  for (const w of where) {
    if (typeof w?.field !== 'string' || !w.field) throw dbError('invalid_argument', 'where() needs a field.');
    if (!OPS.has(w.op)) throw dbError('invalid_argument', `where() does not know the operator ${w.op}.`);
    if ((w.op === 'in' || w.op === 'not-in') && (!Array.isArray(w.value) || w.value.length > 30)) throw dbError('invalid_argument', `${w.op} takes an array of at most 30 values.`);
  }
  let orderBy: QuerySpec['orderBy'] = null;
  if (spec.orderBy) {
    const o = spec.orderBy as { field?: unknown; dir?: unknown };
    if (typeof o.field !== 'string' || !o.field) throw dbError('invalid_argument', 'orderBy() needs a field.');
    orderBy = { field: o.field, dir: o.dir === 'desc' ? 'desc' : 'asc' };
  }
  let limit: number | null = null;
  if (spec.limit !== undefined && spec.limit !== null) {
    if (!Number.isInteger(spec.limit) || (spec.limit as number) < 1 || (spec.limit as number) > 1000) throw dbError('invalid_argument', 'limit() takes 1 to 1000.');
    limit = spec.limit as number;
  }
  return { where, orderBy, limit };
}

export interface Lease {
  holder: string;
  expiresAt: number;
  version: number;
}

export interface DbWrite {
  op: 'set' | 'update' | 'delete' | 'str_replace';
  path?: string;
  collection?: string;
  doc_id?: string;
  data?: unknown;
  file_path?: string;
  /** The sha256 the writer read: write only while the document still has it. `null`: only while it does not exist. `"*"`: whatever it is now. */
  if_match?: string | null;
  /** `str_replace`: the field (a dot path) holding the text. */
  field?: string;
  /** `str_replace`: the text to find; it must occur exactly once. */
  old?: string;
  /** `str_replace`: what replaces it. */
  new?: string;
}

/** Options of {@link DbStore.readDb}. */
export interface ReadOptions {
  /** A query over a collection: `{where?, orderBy?, limit?}` as pages give it. */
  query?: unknown;
  /** Page size (1 to 1000). Default: everything. */
  limit?: unknown;
  /** Where a page starts: the `next_cursor` of the page before. */
  cursor?: unknown;
}

/** Options of {@link DbStore.writeDb}. */
export interface WriteOptions {
  /** Refuse a `set` or `delete` over an existing document that has no `if_match`. */
  requireIfMatch?: boolean;
}

function pageOf(opts: ReadOptions): { limit: number | null; offset: number } {
  let limit: number | null = null;
  if (opts.limit !== undefined && opts.limit !== null) {
    if (!Number.isInteger(opts.limit) || (opts.limit as number) < 1 || (opts.limit as number) > READ_MAX) throw dbError('invalid_argument', `limit is 1 to ${READ_MAX}.`);
    limit = opts.limit as number;
  }
  let offset = 0;
  if (opts.cursor !== undefined && opts.cursor !== null && opts.cursor !== '') {
    const n = typeof opts.cursor === 'string' && /^\d{1,9}$/.test(opts.cursor) ? Number(opts.cursor) : NaN;
    if (!Number.isInteger(n)) throw dbError('invalid_argument', 'cursor is the next_cursor of an earlier read.');
    offset = n;
  }
  return { limit, offset };
}

function paged<T>(items: T[], opts: ReadOptions): { items: T[]; total: number; next_cursor?: string } {
  const { limit, offset } = pageOf(opts);
  const end = limit === null ? items.length : Math.min(items.length, offset + limit);
  return { items: items.slice(offset, end), total: items.length, ...(end < items.length ? { next_cursor: String(end) } : {}) };
}

/** Sets a dot-path field of a copy of `data`. */
function withField(data: JsonObject, field: string, value: Json): JsonObject {
  const keys = field.split('.');
  const out: JsonObject = { ...data };
  let at: JsonObject = out;
  for (const k of keys.slice(0, -1)) {
    const next = at[k];
    if (!isPlain(next)) throw dbError('invalid_argument', `str_replace: ${field} is not a text field.`);
    at[k] = { ...(next as JsonObject) };
    at = at[k] as JsonObject;
  }
  at[keys.at(-1)!] = value;
  return out;
}

function occurrences(text: string, part: string): number {
  let n = 0;
  for (let i = text.indexOf(part); i !== -1; i = text.indexOf(part, i + part.length)) n++;
  return n;
}

/** A store of one artifact's documents. Emits `change` with the doc paths a write touched. */
export class DbStore extends EventEmitter {
  readonly root: string;
  readonly dir: string;
  readonly leases = new Map<string, Lease>();
  private readonly guard: PathGuard;

  /** `guard`: how it keeps inside the artifact folder (default {@link LINK_GUARD}: links followed). */
  constructor(root: string, options: { guard?: PathGuard } = {}) {
    super();
    this.root = root;
    this.dir = join(root, DB_DIR);
    this.guard = options.guard ?? LINK_GUARD;
  }

  /** A document's file; refused when a link (db/ itself, or a folder in it) leads it out of the artifact folder. */
  private fileOf(segs: string[]): string {
    const file = join(this.dir, ...segs.slice(0, -1), `${segs.at(-1)}.json`);
    if (!this.guard.inside(this.root, file)) throw dbError('invalid_argument', `${segs.join('/')} leads out of the artifact folder (a link).`);
    return file;
  }

  readDoc(p: string): JsonObject | null {
    const segs = splitPath(p, 'doc');
    try {
      const data = JSON.parse(readFileSync(this.fileOf(segs), 'utf8')) as unknown;
      return isPlain(data) ? (data as JsonObject) : null;
    } catch {
      return null;
    }
  }

  /** Documents of one collection, sorted by id. */
  listCollection(p: string): Doc[] {
    const segs = splitPath(p, 'collection');
    const dir = join(this.dir, ...segs);
    if (!this.guard.inside(this.root, dir)) return [];
    let names;
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const docs: Doc[] = [];
    for (const e of names) {
      if (!e.isFile() || e.name.startsWith('.') || !e.name.endsWith('.json')) continue;
      const id = e.name.slice(0, -5);
      if (!SEGMENT.test(id)) continue;
      try {
        const data = JSON.parse(readFileSync(join(dir, e.name), 'utf8')) as unknown;
        if (isPlain(data)) docs.push({ id, data: data as JsonObject });
      } catch {
        // half-written by hand: skipped until it parses
      }
    }
    docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return docs;
  }

  query(p: string, rawSpec?: unknown): Doc[] {
    const spec = checkSpec(rawSpec);
    let docs = this.listCollection(p).filter((d) => spec.where.every((w) => matches(d, w)));
    if (spec.orderBy) {
      const { field, dir } = spec.orderBy;
      const key = (d: Doc): unknown => (field === '__name__' || field === 'id' ? d.id : fieldOf(d.data, field));
      docs = docs
        .map((d, i) => ({ d, i, k: key(d) }))
        .sort((a, b) => {
          // Documents without the field sort last, either way.
          if (a.k === undefined && b.k === undefined) return a.i - b.i;
          if (a.k === undefined) return 1;
          if (b.k === undefined) return -1;
          const c = compare(a.k, b.k) * (dir === 'desc' ? -1 : 1);
          return c || a.i - b.i;
        })
        .map((x) => x.d);
    }
    if (spec.limit) docs = docs.slice(0, spec.limit);
    return docs;
  }

  set(p: string, data: unknown): { bytes: number; created: boolean } {
    const segs = splitPath(p, 'doc');
    if (hasDeleteMarker(data)) throw dbError('invalid_argument', '{__delete__: true} is for update only.');
    const text = checkData(data);
    const file = this.fileOf(segs);
    const created = !existsSync(file);
    writeAtomic(file, `${text}\n`);
    this.changed([segs.join('/')]);
    return { bytes: Buffer.byteLength(text), created };
  }

  update(p: string, patch: unknown): { bytes: number } {
    const segs = splitPath(p, 'doc');
    if (!isPlain(patch)) throw dbError('invalid_argument', 'update() takes an object.');
    const have = this.readDoc(p);
    if (!have) throw dbError('invalid_argument', `update(): ${segs.join('/')} does not exist.`);
    const text = checkData(mergePatch(have, patch));
    writeAtomic(this.fileOf(segs), `${text}\n`);
    this.changed([segs.join('/')]);
    return { bytes: Buffer.byteLength(text) };
  }

  delete(p: string): { existed: boolean } {
    const segs = splitPath(p, 'doc');
    let existed = true;
    try {
      rmSync(this.fileOf(segs));
    } catch {
      existed = false;
    }
    this.leases.delete(segs.join('/'));
    if (existed) this.changed([segs.join('/')]);
    return { existed };
  }

  /** A new document in `collection`, under `id` (default: a new random one, {@link newDocId}). */
  add(collection: string, data: unknown, id: string = newDocId()): { id: string; path: string } {
    const segs = splitPath(collection, 'collection');
    const docPath = [...segs, id].join('/');
    this.set(docPath, data);
    return { id, path: docPath };
  }

  /** A lease on a document. */
  acquire(p: string, opts: { holder?: unknown; ttlMs?: unknown; data?: unknown } = {}): { acquired: boolean; version?: number; expiresAt?: number; holder?: string } {
    const key = splitPath(p, 'doc').join('/');
    const { holder, ttlMs = 30_000, data } = opts;
    // 128 characters from a page; the frame core puts the viewer's id before them (up to 512 in all).
    if (typeof holder !== 'string' || !holder || holder.length > 512) throw dbError('invalid_argument', 'acquire() needs a holder.');
    if (typeof ttlMs !== 'number' || !Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 600_000) throw dbError('invalid_argument', 'acquire(): ttlMs is 1000 to 600000.');
    const now = Date.now();
    const have = this.leases.get(key);
    if (have && have.expiresAt > now && have.holder !== holder) return { acquired: false, holder: have.holder, expiresAt: have.expiresAt };
    const lease: Lease = { holder, expiresAt: now + ttlMs, version: (have?.version ?? 0) + 1 };
    this.leases.set(key, lease);
    if (data !== undefined) {
      if (this.readDoc(key)) this.update(key, data);
      else this.set(key, data);
    }
    return { acquired: true, version: lease.version, expiresAt: lease.expiresAt, holder };
  }

  release(p: string, holder: unknown): { released: boolean } {
    const key = splitPath(p, 'doc').join('/');
    const have = this.leases.get(key);
    const released = !!have && have.holder === holder;
    if (released) this.leases.delete(key);
    return { released };
  }

  changed(paths: string[]): void {
    this.emit('change', paths);
  }

  // ---- the agent's view ---------------------------------------------------------------------------------------------

  /** Every document file. */
  listAll(): { path: string; bytes: number }[] {
    const out: { path: string; bytes: number }[] = [];
    const walk = (dir: string, segs: string[]): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory() && SEGMENT.test(e.name)) walk(join(dir, e.name), [...segs, e.name]);
        else if (e.isFile() && e.name.endsWith('.json')) {
          const id = e.name.slice(0, -5);
          const docSegs = [...segs, id];
          if (docSegs.length % 2 !== 0 || !SEGMENT.test(id)) continue;
          out.push({ path: docSegs.join('/'), bytes: statSync(join(dir, e.name)).size });
        }
      }
    };
    if (this.guard.inside(this.root, this.dir)) walk(this.dir, []);
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  /**
   * The agent's read (`open-artifact.db.read`): the root lists every document path, a
   * collection its documents (filtered by `query`), a document its data.
   * Documents carry `sha256` for `if_match`; a page that stops early carries
   * `next_cursor`.
   */
  readDb(p?: unknown, opts: ReadOptions = {}): unknown {
    const segs = splitPath(p ?? '', 'any');
    if (segs.length === 0) {
      const page = paged(this.listAll(), opts);
      return { root: DB_DIR, documents: page.items, total: page.total, ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}) };
    }
    const joined = segs.join('/');
    if (segs.length % 2 === 1) {
      const query = opts.query !== undefined && opts.query !== null;
      const docs = query ? this.query(joined, opts.query) : this.listCollection(joined);
      const page = paged(docs, opts);
      return {
        collection: joined,
        ...(query ? { query: true } : {}),
        docs: page.items.map((d) => ({ id: d.id, path: `${joined}/${d.id}`, sha256: docSha256(d.data), data: d.data })),
        total: page.total,
        ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}),
      };
    }
    if (opts.query !== undefined && opts.query !== null) throw dbError('invalid_argument', `${joined} names a document; a query reads a collection.`);
    const data = this.readDoc(joined);
    return data ? { path: joined, exists: true, sha256: docSha256(data), data } : { path: joined, exists: false, sha256: null };
  }

  /**
   * The agent's batch (`open-artifact.db.write`): every write is checked before any is
   * made. A write with `if_match` that no longer holds fails the whole batch
   * with `conflict`, its `current` holding what each such document is now.
   */
  writeDb(writes: unknown, opts: WriteOptions = {}): Record<string, unknown>[] {
    if (!Array.isArray(writes) || writes.length === 0) throw dbError('invalid_argument', 'writes is a non-empty array.');
    if (writes.length > 500) throw dbError('invalid_argument', 'At most 500 writes at once.');
    const seen = new Set<string>();
    const conflicts: Record<string, unknown> = {};
    const unguarded: string[] = [];
    const plan = (writes as DbWrite[]).map((w) => {
      const op = w?.op;
      if (op !== 'set' && op !== 'update' && op !== 'delete' && op !== 'str_replace') throw dbError('invalid_argument', `Unknown op ${String(op)}.`);
      // A write names its document by `path`, or by `collection` + `doc_id` (the ArtifactData batch shape).
      const named = w.path ?? (w.collection != null && w.doc_id != null ? `${w.collection}/${w.doc_id}` : '');
      const p = splitPath(String(named), 'doc').join('/');
      if (seen.has(p)) throw dbError('invalid_argument', `${p} appears twice in one batch.`);
      seen.add(p);
      const ifMatch = w.if_match;
      if (ifMatch !== undefined && ifMatch !== null && ifMatch !== '*' && !(typeof ifMatch === 'string' && SHA.test(ifMatch))) {
        throw dbError('invalid_argument', `${op} ${p}: if_match is a sha256 you read, null or "*".`);
      }
      const have = this.readDoc(p);
      const haveSha = have ? docSha256(have) : null;
      if (ifMatch !== undefined && ifMatch !== '*' && ifMatch !== haveSha) {
        conflicts[p] = have ? { path: p, exists: true, sha256: haveSha, data: have } : { path: p, exists: false, sha256: null };
      }
      if (opts.requireIfMatch && (op === 'set' || op === 'delete') && have && ifMatch === undefined) unguarded.push(`${op} ${p}`);
      if (op === 'delete') return { op, path: p, data: undefined as unknown };
      if (op === 'str_replace') {
        if (typeof w.field !== 'string' || !w.field) throw dbError('invalid_argument', `str_replace ${p}: field (a dot path) is required.`);
        if (typeof w.old !== 'string' || !w.old) throw dbError('invalid_argument', `str_replace ${p}: old is a non-empty string.`);
        if (typeof w.new !== 'string') throw dbError('invalid_argument', `str_replace ${p}: new is a string.`);
        if (!have) throw dbError('invalid_argument', `str_replace: ${p} does not exist.`);
        const text = fieldOf(have, w.field);
        if (typeof text !== 'string') throw dbError('invalid_argument', `str_replace ${p}: ${w.field} is not a text field.`);
        const n = occurrences(text, w.old);
        if (n === 0) throw dbError('invalid_argument', `str_replace ${p}: old does not occur in ${w.field}.`, { fix: 'Read the document again and copy old exactly from it.' });
        if (n > 1) throw dbError('invalid_argument', `str_replace ${p}: old occurs ${n} times in ${w.field}.`, { fix: 'Make old longer so it occurs exactly once.' });
        const data = withField(have, w.field, text.replace(w.old, () => w.new!));
        checkData(data);
        return { op, path: p, data: data as unknown };
      }
      const hasData = w.data !== undefined;
      const hasFile = typeof w.file_path === 'string' && w.file_path !== '';
      if (hasData === hasFile) throw dbError('invalid_argument', `${op} ${p}: give exactly one of data or file_path.`);
      let data = w.data;
      if (hasFile) {
        if (!isAbsolute(w.file_path!)) throw dbError('invalid_argument', 'file_path is an absolute path.');
        try {
          data = JSON.parse(readFileSync(w.file_path!, 'utf8')) as unknown;
        } catch (error) {
          throw dbError('invalid_argument', `${w.file_path}: ${(error as Error)?.message ?? error}`);
        }
      }
      if (!isPlain(data)) throw dbError('invalid_argument', `${op} ${p}: the data is a JSON object.`);
      if (op === 'set' && hasDeleteMarker(data)) throw dbError('invalid_argument', `set ${p}: {__delete__: true} is for update only.`);
      checkData(op === 'update' ? mergePatch(have ?? {}, data) : data);
      return { op, path: p, data };
    });
    const conflicted = Object.keys(conflicts);
    if (conflicted.length) {
      throw dbError('conflict', `${conflicted.length === 1 ? `${conflicted[0]} changed` : `${conflicted.length} documents changed`} since you read it: nothing was written.`, {
        fix: 'Merge your change into the document in current, then write again with its sha256 as if_match.',
        current: conflicts,
      });
    }
    if (unguarded.length) {
      throw dbError('invalid_argument', `${unguarded.join(', ')}: the document exists, so the write needs if_match. Nothing was written.`, {
        fix: IF_MATCH_FIX,
        need_if_match: unguarded.map((u) => u.slice(u.indexOf(' ') + 1)),
      });
    }
    const out: Record<string, unknown>[] = [];
    const shaOf = (path: string): string | null => {
      const data = this.readDoc(path);
      return data ? docSha256(data) : null;
    };
    for (const w of plan) {
      if (w.op === 'delete') {
        const { existed } = this.delete(w.path);
        out.push({ op: 'delete', path: w.path, sha256: null, ...(existed ? {} : { note: 'did not exist' }) });
      } else if (w.op === 'update' && this.readDoc(w.path)) {
        const r = this.update(w.path, w.data);
        out.push({ op: 'update', path: w.path, bytes: r.bytes, sha256: shaOf(w.path) });
      } else if (w.op === 'update') {
        const r = this.set(w.path, mergePatch({}, w.data as Record<string, unknown>));
        out.push({ op: 'update', path: w.path, bytes: r.bytes, sha256: shaOf(w.path), created: true, note: 'did not exist; created' });
      } else {
        const r = this.set(w.path, w.data);
        out.push({ op: w.op, path: w.path, bytes: r.bytes, sha256: shaOf(w.path), ...(r.created ? { created: true } : {}) });
      }
    }
    return out;
  }
}

/** Doc paths of the db files a watcher saw change (paths relative to the artifact folder). */
export function docPathsOf(relPaths: Iterable<string>): string[] {
  const out: string[] = [];
  for (const rel of relPaths) {
    const segs = rel.split(/[\\/]/);
    if (segs[0] !== DB_DIR || segs.length < 2) continue;
    const last = segs.at(-1)!;
    if (last.startsWith('.') || !last.endsWith('.json')) continue;
    const doc = [...segs.slice(1, -1), last.slice(0, -5)];
    if (doc.length % 2 === 0) out.push(doc.join('/'));
  }
  return out;
}
