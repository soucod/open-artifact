/**
 * What a mounted file system keeps: a tree of folders and files, addressed by paths relative to its mount point
 * (`''` is the mount point itself, `a/b` below it; never a leading or trailing slash).
 *
 * A backend offers primitive operations and no policy: `sync.ts` checks every rule Node's `fs` has (what must exist,
 * what may be replaced, which error) before it calls one, inside {@link Backend.transaction}, so a backend never sees a
 * request it should refuse and one `fs` call is one transaction. Three backends exist: `SqlBackend` (a Durable
 * Object's SQLite), `MemoryBackend` (scratch files, bounded) and `AssetBackend` (the built editors, read-only).
 */

/** One file or folder. */
export interface Inode {
  /** Unique within its backend for as long as it exists. */
  ino: number;
  dir: boolean;
  /** Bytes; 0 for a folder. */
  size: number;
  /** Last change of the content, ms since the epoch (fractional: see {@link MtimeClock}). */
  mtimeMs: number;
  /** Permission bits (`0o644`, `0o755`, …), without the file type. */
  mode: number;
}

/** A name in a folder and what it is. */
export interface DirEntry {
  name: string;
  node: Inode;
}

/** What {@link Backend.lookup} finds: the node, nothing, or a file where a folder was needed on the way. */
export type Lookup = Inode | null | 'notdir';

/** Row counts of a backend's storage, as the platform bills them. */
export interface StorageCounters {
  /** SQL statements run. */
  statements: number;
  rowsRead: number;
  rowsWritten: number;
  /** The same, of the chunk table alone (bodies of files larger than the inline limit). */
  chunkRowsRead: number;
  chunkRowsWritten: number;
  /** Transactions committed and rolled back. */
  commits: number;
  rollbacks: number;
}

/** What a backend holds. */
export interface Usage {
  files: number;
  dirs: number;
  bytes: number;
}

export interface Backend {
  /** Short name for errors and stats (`sql`, `memory`, `assets`). */
  readonly kind: string;
  /** A device number for `Stats.dev`. */
  readonly dev: number;
  /** Refuses every write (`EROFS`). */
  readonly readOnly: boolean;
  /**
   * Runs `fn` as one unit: everything it changed stays, or (it threw) nothing does. Not nested: `sync.ts` opens
   * exactly one per `fs` call that changes anything.
   */
  transaction<T>(fn: () => T): T;
  lookup(rel: string): Lookup;
  /** The entries of a folder, sorted by name (code unit order of their UTF-8 bytes). */
  list(rel: string, dir: Inode): DirEntry[];
  /** Whether a folder has no entries. */
  isEmpty(rel: string, dir: Inode): boolean;
  /** Bytes `[start, end)` of a file (`end` clamped to its size). */
  read(rel: string, node: Inode, start: number, end: number): Uint8Array;
  /** Creates (`existing` null) or replaces the whole content of a file. */
  put(rel: string, existing: Inode | null, bytes: Uint8Array, mode: number, mtimeMs: number): Inode;
  /** Writes `bytes` at `offset` of an existing file, growing it (with zeros past its end) as needed. */
  writeAt(rel: string, node: Inode, offset: number, bytes: Uint8Array, mtimeMs: number): Inode;
  /** Cuts or extends (with zeros) a file to `size` bytes. */
  truncate(rel: string, node: Inode, size: number, mtimeMs: number): Inode;
  mkdir(rel: string, mode: number, mtimeMs: number): Inode;
  /** Removes a file, or a folder with everything in it. */
  remove(rel: string, node: Inode): void;
  /** Moves `from` (its node `node`) to `to`, whose current node (a file, or an empty folder) is `replaced`. */
  move(from: string, node: Inode, to: string, replaced: Inode | null): void;
  /** Sets times and permission bits. */
  setMeta(rel: string, node: Inode, meta: { mtimeMs?: number; mode?: number }): void;
  usage(): Usage;
  counters(): StorageCounters;
  /** The whole content of a file read without blocking, for backends that cannot read synchronously (assets). */
  readAsync?(rel: string): Promise<Uint8Array | null>;
}

/**
 * Modification times that always move forward. A Worker's clock stands still while it runs (it only advances across
 * I/O), so many writes in one request would get the same `Date.now()`; callers that key caches on size and mtime (the
 * type server's file hashes, the Link etags) would then miss a change of the same size. Each call returns at least a
 * microsecond more than the last.
 */
export class MtimeClock {
  private last = 0;

  now(): number {
    const wall = Date.now();
    this.last = wall > this.last ? wall : this.last + 0.001;
    return this.last;
  }
}

export const emptyCounters = (): StorageCounters => ({ statements: 0, rowsRead: 0, rowsWritten: 0, chunkRowsRead: 0, chunkRowsWritten: 0, commits: 0, rollbacks: 0 });

/** The bytes of a SQL blob, which a Durable Object returns as an `ArrayBuffer` and `node:sqlite` as a `Uint8Array`. */
export function blobBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(0);
}

/** A blob as a SQL binding both a Durable Object and `node:sqlite` take: its own `ArrayBuffer`, exactly its bytes. */
export function blobBinding(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) return bytes.buffer;
  return copyBytes(bytes).buffer as ArrayBuffer;
}

/** A copy of `bytes` in a buffer of its own (`Buffer#slice` would only be a view). */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
