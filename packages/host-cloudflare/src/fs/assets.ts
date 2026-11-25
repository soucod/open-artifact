/**
 * The built editors and Shell (`dist/server`), read-only, fetched from the Worker's static assets. The type server
 * reads a few of them itself (an editor's `index.html`, which it rewrites; the Shell's boot page; `support.js`), and
 * only with `fs/promises.readFile`: that is the one operation offered. Everything else — the synchronous calls, which
 * cannot wait for a fetch, `stat`, listing — fails with `ENOSYS`, and every write with `EROFS`.
 */
import { type Backend, type DirEntry, type Inode, type Lookup, type StorageCounters, type Usage, emptyCounters } from './backend.ts';
import { fsError } from './errors.ts';

/** What fetches an asset: `env.ASSETS.fetch` of a Worker, or anything shaped like it. */
export type AssetFetcher = (request: Request) => Promise<Response>;

let devices = 0x0c000000;

export class AssetBackend implements Backend {
  readonly kind = 'assets';
  readonly dev = ++devices;
  readonly readOnly = true;
  private fetched = 0;
  private bytes = 0;

  /** `base` is the URL the mount point stands for, e.g. `http://assets/_open-artifact/`. */
  private readonly fetcher: AssetFetcher;
  private readonly base: string;

  constructor(fetcher: AssetFetcher, base: string) {
    this.fetcher = fetcher;
    this.base = base;
  }

  async readAsync(rel: string): Promise<Uint8Array | null> {
    const url = new URL(rel.split('/').map(encodeURIComponent).join('/'), this.base.endsWith('/') ? this.base : this.base + '/');
    const response = await this.fetcher(new Request(url));
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw fsError('EIO', 'open', rel, undefined, `asset fetch answered ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.fetched++;
    this.bytes += bytes.length;
    return bytes;
  }

  transaction<T>(fn: () => T): T {
    return fn();
  }

  lookup(rel: string): Lookup {
    throw this.sync(rel);
  }

  list(rel: string): DirEntry[] {
    throw this.sync(rel);
  }

  isEmpty(rel: string): boolean {
    throw this.sync(rel);
  }

  read(rel: string): Uint8Array {
    throw this.sync(rel);
  }

  put(rel: string): Inode {
    throw fsError('EROFS', 'open', rel);
  }

  writeAt(rel: string): Inode {
    throw fsError('EROFS', 'write', rel);
  }

  truncate(rel: string): Inode {
    throw fsError('EROFS', 'truncate', rel);
  }

  mkdir(rel: string): Inode {
    throw fsError('EROFS', 'mkdir', rel);
  }

  remove(rel: string): void {
    throw fsError('EROFS', 'rm', rel);
  }

  move(rel: string): void {
    throw fsError('EROFS', 'rename', rel);
  }

  setMeta(rel: string): void {
    throw fsError('EROFS', 'utime', rel);
  }

  usage(): Usage {
    return { files: this.fetched, dirs: 0, bytes: this.bytes };
  }

  counters(): StorageCounters {
    return emptyCounters();
  }

  private sync(rel: string): Error {
    return fsError('ENOSYS', 'open', rel, undefined, 'the built editors can only be read with fs/promises readFile');
  }
}
