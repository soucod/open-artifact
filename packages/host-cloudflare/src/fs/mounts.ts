/**
 * The mount table: which backend holds a path. A Durable Object mounts its artifact's folder (`mount('/a/<id>',
 * ctx.storage)`); the built editors are mounted read-only; every other path is scratch memory, shared by the isolate
 * and bounded. Several objects share one isolate, so there is no "current" storage: every call routes by its path.
 */
import { posix } from 'node:path';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { type Backend, MtimeClock } from './backend.ts';
import { AssetBackend, type AssetFetcher } from './assets.ts';
import { fsError } from './errors.ts';
import { MemoryBackend } from './memory.ts';
import { SqlBackend, type SyncStorage } from './sql.ts';
import type { PathLike } from './types.ts';
import { closeWatchersUnder } from './watch.ts';

/** Scratch memory's bound unless {@link setScratchLimit} says otherwise. */
export const DEFAULT_SCRATCH_BYTES = 64 * 1024 * 1024;

interface Mount {
  root: string;
  backend: Backend;
}

const mounts: Mount[] = [];
let scratch = new MemoryBackend(DEFAULT_SCRATCH_BYTES);

/** The clock of every modification time (see {@link MtimeClock}). */
export const clock = new MtimeClock();

/** Ends a mount; returned by {@link mount}, with the backend it put there. */
export interface Unmount {
  (): void;
  readonly backend: Backend;
}

/** Puts a Durable Object's storage at `root` (absolute); paths below it read and write that storage. */
export function mount(root: string, storage: SyncStorage): Unmount & { readonly backend: SqlBackend } {
  return mountBackend(root, new SqlBackend(storage)) as Unmount & { readonly backend: SqlBackend };
}

/** Puts the built editors at `root`, fetched with `fetcher` from `base` (see {@link AssetBackend}). */
export function mountAssets(root: string, fetcher: AssetFetcher, base: string): Unmount {
  return mountBackend(root, new AssetBackend(fetcher, base));
}

/** Puts `backend` at `root`. A root already mounted, or inside or around another mount, is refused. */
export function mountBackend(root: string, backend: Backend): Unmount {
  const at = posix.resolve('/', root);
  if (at === '/') throw new Error('The root of the file system cannot be mounted over.');
  for (const other of mounts) {
    if (other.root === at || at.startsWith(other.root + '/') || other.root.startsWith(at + '/')) {
      throw new Error(`${at} overlaps the mount at ${other.root}.`);
    }
  }
  const entry: Mount = { root: at, backend };
  mounts.push(entry);
  const unmount = (): void => {
    const index = mounts.indexOf(entry);
    if (index < 0) return;
    mounts.splice(index, 1);
    closeWatchersUnder(at);
    // Descriptors still open on it now fail with EBADF.
    for (const close of onUnmount) close(backend);
  };
  return Object.assign(unmount, { backend });
}

/** The mounted backends, for stats. */
export function mounted(): readonly { root: string; backend: Backend }[] {
  return mounts.map(({ root, backend }) => ({ root, backend }));
}

/** Replaces scratch memory with an empty one bounded at `maxBytes` (tests; a Worker sets it once at start). */
export function setScratchLimit(maxBytes: number): void {
  scratch = new MemoryBackend(maxBytes);
}

export function scratchBackend(): MemoryBackend {
  return scratch;
}

/** Hooks run when a backend is unmounted (the descriptor table closes its descriptors). */
export const onUnmount = new Set<(backend: Backend) => void>();

/** A path as a call names it, resolved: where it lives and how errors name it. */
export interface Located {
  /** As given, for error messages. */
  given: string;
  /** Absolute and normalized. */
  abs: string;
  backend: Backend;
  /** Below the backend's mount point (`''` is the mount point). */
  rel: string;
  /** The path ended in `/` (it must then be a folder). */
  slash: boolean;
}

export function pathString(path: PathLike, argument = 'path'): string {
  if (typeof path === 'string') return path;
  if (Buffer.isBuffer(path)) return path.toString('utf8');
  if (path instanceof URL) return fileURLToPath(path);
  throw Object.assign(new TypeError(`The "${argument}" argument must be of type string or an instance of Buffer or URL.`), { code: 'ERR_INVALID_ARG_TYPE' });
}

export function locate(path: PathLike, syscall: string): Located {
  const given = pathString(path);
  if (given.includes('\0')) throw Object.assign(new TypeError(`The argument 'path' must be a string without null bytes. Received ${JSON.stringify(given)}`), { code: 'ERR_INVALID_ARG_VALUE' });
  if (given === '') throw fsError('ENOENT', syscall, given);
  const abs = posix.resolve('/', given);
  const slash = given.length > 1 && given.endsWith('/');
  for (const { root, backend } of mounts) {
    if (abs === root) return { given, abs, backend, rel: '', slash };
    if (abs.startsWith(root + '/')) return { given, abs, backend, rel: abs.slice(root.length + 1), slash };
  }
  return { given, abs, backend: scratch, rel: abs.slice(1), slash };
}
