/**
 * A file tree in a Durable Object's SQLite (`ctx.storage.sql`).
 *
 * Schema (three tables, all keyed so every operation is an index lookup or range):
 *
 * - `oa_fs_entries(parent, name, ino, dir, size, mtime, mode, chunks, data)`, keyed by `(parent, name)`: one row per
 *   file or folder. A folder's entries are the range `parent = <its ino>`, so listing, `stat` and `exists` read only
 *   the rows they name; renaming a folder rewrites its own row alone. A file of at most {@link INLINE_MAX} bytes keeps
 *   its bytes in `data` (one row for the whole file); a larger one has `chunks > 0` and its bytes in the chunk table.
 *   The root is the row `(0, '')`, ino 1.
 * - `oa_fs_chunks(id, data)`: chunk `n` of file `ino` has id `ino * 2^20 + n`, so a file's chunks are one id range
 *   (a range read loads the chunks it covers, a delete is one range delete) and need no second index.
 * - `oa_fs_meta(key, value)`: the next free ino, handed out in blocks of {@link INO_BLOCK} (one row write per block).
 *
 * Chunk size: {@link CHUNK_SIZE} = 256 KiB. Rows written cost $1 per million and are the dominant cost, so bigger
 * chunks are cheaper: a 24 MB upload is 94 rows (64 KiB chunks made it 367). Against that, a chunk is the unit of
 * rewriting and of memory: a 1-byte append rewrites at most one 256 KiB chunk, a range read loads at most 256 KiB more
 * than it asked for, and both are small next to the 128 MB an isolate shares. The platform's own limit is 8 MB a row.
 */
import { type Backend, type DirEntry, type Inode, type Lookup, type StorageCounters, type Usage, blobBinding, blobBytes, emptyCounters } from './backend.ts';
import { fsError } from './errors.ts';

/** A cursor of `sql.exec`: its rows, and what running it read and wrote (known once its rows are taken). */
export interface SyncCursor<T> {
  toArray(): T[];
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

/** The synchronous SQL a Durable Object gives (`ctx.storage.sql`), reduced to what the file system needs. */
export interface SyncSql {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SyncCursor<T>;
  /** The database's size in bytes, where the platform reports it (a Durable Object does). */
  readonly databaseSize?: number;
}

/** A Durable Object's storage (`ctx.storage`), reduced to what the file system needs. */
export interface SyncStorage {
  sql: SyncSql;
  transactionSync<T>(closure: () => T): T;
}

/** Files up to this many bytes live in their entry row. */
export const INLINE_MAX = 4096;
/** The bytes of one chunk row. */
export const CHUNK_SIZE = 256 * 1024;
/** Chunk ids of one file: `ino * CHUNK_SPAN + n`. */
const CHUNK_SPAN = 2 ** 20;
const INO_BLOCK = 1024;
const ROOT_INO = 1;
/** Folders whose ino is remembered, so a lookup reads only the last component's row. */
const DIR_CACHE_MAX = 4096;

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS oa_fs_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL) WITHOUT ROWID',
  `CREATE TABLE IF NOT EXISTS oa_fs_entries (
     parent INTEGER NOT NULL, name TEXT NOT NULL, ino INTEGER NOT NULL, dir INTEGER NOT NULL, size INTEGER NOT NULL,
     mtime REAL NOT NULL, mode INTEGER NOT NULL, chunks INTEGER NOT NULL, data BLOB,
     PRIMARY KEY (parent, name)) WITHOUT ROWID`,
  'CREATE TABLE IF NOT EXISTS oa_fs_chunks (id INTEGER PRIMARY KEY, data BLOB NOT NULL)',
];

/** An entry as this backend knows it: where its row is, and how its bytes are kept. */
interface SqlNode extends Inode {
  parent: number;
  name: string;
  chunks: number;
}

interface EntryRow {
  ino: number;
  dir: number;
  size: number;
  mtime: number;
  mode: number;
  chunks: number;
}

const ENTRY_COLUMNS = 'ino, dir, size, mtime, mode, chunks';

let devices = 0x0a000000;

export class SqlBackend implements Backend {
  readonly kind = 'sql';
  readonly dev = ++devices;
  readonly readOnly = false;
  private readonly sql: SyncSql;
  private readonly count = emptyCounters();
  /** Folder path → ino; cleared whenever a folder moves or goes, and after a rolled-back transaction. */
  private dirs = new Map<string, number>();
  private nextIno = 0;
  private inoLimit = 0;
  private inTransaction = false;

  private readonly storage: SyncStorage;

  constructor(storage: SyncStorage) {
    this.storage = storage;
    this.sql = storage.sql;
    for (const statement of SCHEMA) this.run(statement);
    const root = this.run<{ n: number }>('SELECT count(*) AS n FROM oa_fs_entries WHERE parent = 0 AND name = ?', '')[0];
    if (!root?.n) this.run('INSERT INTO oa_fs_entries VALUES (0, ?, ?, 1, 0, ?, ?, 0, NULL)', '', ROOT_INO, Date.now(), 0o755);
  }

  transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    this.inTransaction = true;
    try {
      const result = this.storage.transactionSync(fn);
      this.count.commits++;
      return result;
    } catch (error) {
      this.count.rollbacks++;
      // What the transaction cached or reserved may not exist any more.
      this.dirs.clear();
      this.inoLimit = 0;
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  lookup(rel: string): Lookup {
    if (rel === '') return this.node(0, '', this.row(0, ''));
    const parts = rel.split('/');
    // The deepest folder already known.
    let known = parts.length - 1;
    let parent = ROOT_INO;
    for (; known > 0; known--) {
      const ino = this.dirs.get(parts.slice(0, known).join('/'));
      if (ino !== undefined) {
        parent = ino;
        break;
      }
    }
    for (let i = known; i < parts.length; i++) {
      const name = parts[i]!;
      const row = this.row(parent, name);
      if (!row) return null;
      const last = i === parts.length - 1;
      if (last) return this.node(parent, name, row);
      if (!row.dir) return 'notdir';
      this.remember(parts.slice(0, i + 1).join('/'), row.ino);
      parent = row.ino;
    }
    return null;
  }

  list(_rel: string, dir: Inode): DirEntry[] {
    const rows = this.run<EntryRow & { name: string }>(`SELECT name, ${ENTRY_COLUMNS} FROM oa_fs_entries WHERE parent = ? ORDER BY name`, dir.ino);
    return rows.map((row) => ({ name: row.name, node: this.node(dir.ino, row.name, row)! }));
  }

  isEmpty(_rel: string, dir: Inode): boolean {
    return this.run('SELECT 1 FROM oa_fs_entries WHERE parent = ? LIMIT 1', dir.ino).length === 0;
  }

  read(_rel: string, inode: Inode, start: number, end: number): Uint8Array {
    const node = inode as SqlNode;
    end = Math.min(end, node.size);
    if (end <= start) return new Uint8Array(0);
    if (node.chunks === 0) {
      const row = this.run<{ data: unknown }>('SELECT data FROM oa_fs_entries WHERE parent = ? AND name = ?', node.parent, node.name)[0];
      return blobBytes(row?.data).slice(start, end);
    }
    const first = Math.floor(start / CHUNK_SIZE);
    const last = Math.floor((end - 1) / CHUNK_SIZE);
    const rows = this.chunkRows(node.ino, first, last);
    const out = new Uint8Array(end - start);
    for (const row of rows) {
      const n = row.id - node.ino * CHUNK_SPAN;
      const bytes = blobBytes(row.data);
      const at = n * CHUNK_SIZE;
      const from = Math.max(start, at);
      const to = Math.min(end, at + bytes.length);
      if (to > from) out.set(bytes.subarray(from - at, to - at), from - start);
    }
    return out;
  }

  put(rel: string, existing: Inode | null, bytes: Uint8Array, mode: number, mtimeMs: number): SqlNode {
    if (!existing) {
      const { parent, name } = this.place(rel);
      const ino = this.allocate();
      const chunked = bytes.length > INLINE_MAX;
      const chunks = chunked ? this.writeChunks(ino, bytes, null) : 0;
      this.run('INSERT INTO oa_fs_entries VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)', parent, name, ino, bytes.length, mtimeMs, mode, chunks, chunked ? null : blobBinding(bytes));
      return { ino, dir: false, size: bytes.length, mtimeMs, mode, parent, name, chunks } satisfies SqlNode;
    }
    const node = existing as SqlNode;
    if (bytes.length <= INLINE_MAX) {
      if (node.chunks === 0 && node.size === bytes.length && equalBytes(this.read(rel, node, 0, node.size), bytes)) {
        // The same bytes: only the time moves.
        this.run('UPDATE oa_fs_entries SET mtime = ? WHERE parent = ? AND name = ?', mtimeMs, node.parent, node.name);
      } else {
        if (node.chunks > 0) this.dropChunks(node.ino, 0);
        this.run('UPDATE oa_fs_entries SET size = ?, mtime = ?, chunks = 0, data = ? WHERE parent = ? AND name = ?', bytes.length, mtimeMs, blobBinding(bytes), node.parent, node.name);
      }
      return { ...node, size: bytes.length, mtimeMs, chunks: 0 };
    }
    // Chunked: chunks whose bytes did not change stay as they are.
    const chunks = this.writeChunks(node.ino, bytes, node.chunks > 0 ? node : null);
    if (node.chunks > chunks) this.dropChunks(node.ino, chunks);
    this.run('UPDATE oa_fs_entries SET size = ?, mtime = ?, chunks = ?, data = NULL WHERE parent = ? AND name = ?', bytes.length, mtimeMs, chunks, node.parent, node.name);
    return { ...node, size: bytes.length, mtimeMs, chunks };
  }

  writeAt(rel: string, inode: Inode, offset: number, bytes: Uint8Array, mtimeMs: number): SqlNode {
    const node = inode as SqlNode;
    const size = Math.max(node.size, offset + bytes.length);
    if (size <= INLINE_MAX || node.chunks === 0) {
      // Small (or growing out of its row): assemble the whole file once.
      const whole = new Uint8Array(size);
      whole.set(this.read(rel, node, 0, node.size), 0);
      whole.set(bytes, offset);
      return this.put(rel, node, whole, node.mode, mtimeMs);
    }
    const last = Math.floor((offset + bytes.length - 1) / CHUNK_SIZE);
    // The chunks the write covers, and those the zeros between the old end and `offset` fall in.
    const from = Math.floor(Math.min(offset, node.size) / CHUNK_SIZE);
    const old = new Map(this.chunkRows(node.ino, from, last).map((row) => [row.id - node.ino * CHUNK_SPAN, blobBytes(row.data)]));
    for (let n = from; n <= last; n++) {
      const at = n * CHUNK_SIZE;
      const length = Math.min(CHUNK_SIZE, size - at);
      const chunk = new Uint8Array(length);
      const before = old.get(n);
      if (before) chunk.set(before.subarray(0, Math.min(before.length, length)), 0);
      const lo = Math.max(offset, at);
      const hi = Math.min(offset + bytes.length, at + length);
      if (hi > lo) chunk.set(bytes.subarray(lo - offset, hi - offset), lo - at);
      this.putChunk(node.ino, n, chunk);
    }
    const chunks = Math.ceil(size / CHUNK_SIZE);
    this.run('UPDATE oa_fs_entries SET size = ?, mtime = ?, chunks = ? WHERE parent = ? AND name = ?', size, mtimeMs, chunks, node.parent, node.name);
    return { ...node, size, mtimeMs, chunks };
  }

  truncate(rel: string, inode: Inode, size: number, mtimeMs: number): SqlNode {
    const node = inode as SqlNode;
    if (size === node.size) {
      this.run('UPDATE oa_fs_entries SET mtime = ? WHERE parent = ? AND name = ?', mtimeMs, node.parent, node.name);
      return { ...node, mtimeMs };
    }
    if (size > node.size) return this.writeAt(rel, node, size, new Uint8Array(0), mtimeMs);
    if (size <= INLINE_MAX || node.chunks === 0) return this.put(rel, node, this.read(rel, node, 0, size), node.mode, mtimeMs);
    const chunks = Math.ceil(size / CHUNK_SIZE);
    const tail = size - (chunks - 1) * CHUNK_SIZE;
    this.dropChunks(node.ino, chunks);
    if (tail < CHUNK_SIZE) {
      const row = this.chunkRows(node.ino, chunks - 1, chunks - 1)[0];
      this.putChunk(node.ino, chunks - 1, blobBytes(row?.data).slice(0, tail));
    }
    this.run('UPDATE oa_fs_entries SET size = ?, mtime = ?, chunks = ? WHERE parent = ? AND name = ?', size, mtimeMs, chunks, node.parent, node.name);
    return { ...node, size, mtimeMs, chunks };
  }

  mkdir(rel: string, mode: number, mtimeMs: number): SqlNode {
    const { parent, name } = this.place(rel);
    const ino = this.allocate();
    this.run('INSERT INTO oa_fs_entries VALUES (?, ?, ?, 1, 0, ?, ?, 0, NULL)', parent, name, ino, mtimeMs, mode);
    this.remember(rel, ino);
    return { ino, dir: true, size: 0, mtimeMs, mode, parent, name, chunks: 0 } satisfies SqlNode;
  }

  remove(_rel: string, inode: Inode): void {
    const node = inode as SqlNode;
    if (node.dir) {
      // Every folder below, then each one's files and rows: one index range per folder.
      const folders = this.run<{ ino: number }>(
        'WITH RECURSIVE below(ino) AS (SELECT ? UNION ALL SELECT e.ino FROM oa_fs_entries e JOIN below ON e.parent = below.ino WHERE e.dir = 1) SELECT ino FROM below',
        node.ino,
      );
      for (const { ino } of folders) {
        for (const file of this.run<{ ino: number }>('SELECT ino FROM oa_fs_entries WHERE parent = ? AND chunks > 0', ino)) this.dropChunks(file.ino, 0);
        this.run('DELETE FROM oa_fs_entries WHERE parent = ?', ino);
      }
      this.dirs.clear();
    } else if (node.chunks > 0) {
      this.dropChunks(node.ino, 0);
    }
    this.run('DELETE FROM oa_fs_entries WHERE parent = ? AND name = ?', node.parent, node.name);
  }

  move(_from: string, inode: Inode, to: string, replaced: Inode | null): void {
    const node = inode as SqlNode;
    if (replaced) this.remove(to, replaced);
    const target = this.place(to);
    this.run('UPDATE oa_fs_entries SET parent = ?, name = ? WHERE parent = ? AND name = ?', target.parent, target.name, node.parent, node.name);
    if (node.dir) this.dirs.clear();
  }

  setMeta(_rel: string, inode: Inode, meta: { mtimeMs?: number; mode?: number }): void {
    const node = inode as SqlNode;
    this.run('UPDATE oa_fs_entries SET mtime = ?, mode = ? WHERE parent = ? AND name = ?', meta.mtimeMs ?? node.mtimeMs, meta.mode ?? node.mode, node.parent, node.name);
  }

  /**
   * Counts every entry: one row read per file and folder (no chunk is read). For `stats()`, not for routine use; it is
   * left out of {@link counters}, so reading the stats twice shows only what the artifact itself did in between.
   */
  usage(): Usage {
    const before = { ...this.count };
    const row = this.run<{ files: number; dirs: number; bytes: number | null }>(
      'SELECT sum(1 - dir) AS files, sum(dir) - 1 AS dirs, sum(size) AS bytes FROM oa_fs_entries',
    )[0];
    Object.assign(this.count, before);
    return { files: row?.files ?? 0, dirs: Math.max(0, row?.dirs ?? 0), bytes: row?.bytes ?? 0 };
  }

  counters(): StorageCounters {
    return { ...this.count };
  }

  /** Deletes every row of the file system (the object's storage itself is the caller's to delete). */
  drop(): void {
    for (const table of ['oa_fs_chunks', 'oa_fs_entries', 'oa_fs_meta']) this.run(`DROP TABLE IF EXISTS ${table}`);
    this.dirs.clear();
    this.inoLimit = 0;
  }

  // ---- rows ----------------------------------------------------------------------------------------------------------

  private run<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): T[] {
    const cursor = this.sql.exec<T>(query, ...bindings);
    const rows = cursor.toArray();
    this.count.statements++;
    this.count.rowsRead += cursor.rowsRead;
    this.count.rowsWritten += cursor.rowsWritten;
    if (query.includes('oa_fs_chunks')) {
      this.count.chunkRowsRead += cursor.rowsRead;
      this.count.chunkRowsWritten += cursor.rowsWritten;
    }
    return rows;
  }

  private row(parent: number, name: string): EntryRow | undefined {
    return this.run<EntryRow>(`SELECT ${ENTRY_COLUMNS} FROM oa_fs_entries WHERE parent = ? AND name = ?`, parent, name)[0];
  }

  private node(parent: number, name: string, row: EntryRow | undefined): SqlNode | null {
    if (!row) return null;
    return { ino: row.ino, dir: row.dir === 1, size: row.size, mtimeMs: row.mtime, mode: row.mode, parent, name, chunks: row.chunks };
  }

  private remember(rel: string, ino: number): void {
    if (this.dirs.size >= DIR_CACHE_MAX) this.dirs.clear();
    this.dirs.set(rel, ino);
  }

  /** The folder ino and the name a new entry at `rel` gets (its folder exists: the caller checked). */
  private place(rel: string): { parent: number; name: string } {
    const slash = rel.lastIndexOf('/');
    const name = rel.slice(slash + 1);
    if (slash < 0) return { parent: ROOT_INO, name };
    const dir = this.lookup(rel.slice(0, slash));
    if (!dir || dir === 'notdir' || !dir.dir) throw fsError('ENOENT', 'open', rel);
    return { parent: dir.ino, name };
  }

  private allocate(): number {
    if (this.nextIno >= this.inoLimit) {
      const stored = this.run<{ value: number }>("SELECT value FROM oa_fs_meta WHERE key = 'next_ino'")[0]?.value ?? ROOT_INO + 1;
      this.nextIno = stored;
      this.inoLimit = stored + INO_BLOCK;
      this.run("INSERT INTO oa_fs_meta VALUES ('next_ino', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", this.inoLimit);
    }
    return this.nextIno++;
  }

  private chunkRows(ino: number, first: number, last: number): { id: number; data: unknown }[] {
    return this.run<{ id: number; data: unknown }>('SELECT id, data FROM oa_fs_chunks WHERE id BETWEEN ? AND ? ORDER BY id', ino * CHUNK_SPAN + first, ino * CHUNK_SPAN + last);
  }

  private putChunk(ino: number, n: number, bytes: Uint8Array): void {
    if (n >= CHUNK_SPAN) throw fsError('EFBIG', 'write');
    this.run('INSERT INTO oa_fs_chunks VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data', ino * CHUNK_SPAN + n, blobBinding(bytes));
  }

  /** Writes `bytes` as the chunks of `ino` from chunk 0; with `previous`, chunks whose bytes are the same are kept. */
  private writeChunks(ino: number, bytes: Uint8Array, previous: SqlNode | null): number {
    const chunks = Math.ceil(bytes.length / CHUNK_SIZE);
    if (chunks > CHUNK_SPAN) throw fsError('EFBIG', 'write');
    const old = previous ? new Map(this.chunkRows(ino, 0, Math.min(chunks, previous.chunks) - 1).map((row) => [row.id - ino * CHUNK_SPAN, blobBytes(row.data)])) : null;
    for (let n = 0; n < chunks; n++) {
      const chunk = bytes.subarray(n * CHUNK_SIZE, Math.min(bytes.length, (n + 1) * CHUNK_SIZE));
      const before = old?.get(n);
      if (before && equalBytes(before, chunk)) continue;
      this.putChunk(ino, n, chunk);
    }
    return chunks;
  }

  /** Deletes the chunks of `ino` from chunk `from` on. */
  private dropChunks(ino: number, from: number): void {
    this.run('DELETE FROM oa_fs_chunks WHERE id >= ? AND id < ?', ino * CHUNK_SPAN + from, (ino + 1) * CHUNK_SPAN);
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
