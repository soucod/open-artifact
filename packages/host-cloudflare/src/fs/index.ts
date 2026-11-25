/**
 * A `node:fs` for Durable Objects: the bundle of a room aliases `node:fs` to this module (and `node:fs/promises` to
 * `promises.ts`), so the type server's stores — written for a disk — keep their files in the object's SQLite.
 *
 * What is mounted where is decided by the room (`mount`, `mountAssets`); every other path is bounded scratch memory.
 * Members nothing reachable in hosted mode calls throw `ENOSYS` naming themselves (see `unsupported` below).
 */
import { fsError, unsupportedMember } from './errors.ts';
import { locate } from './mounts.ts';
import promises from './promises.ts';
import * as asyncFs from './promises.ts';
import { ReadStream, WriteStream, createReadStream, createWriteStream } from './streams.ts';
import * as sync from './sync.ts';
import { constants, Dirent, type Encoding, type PathLike, Stats } from './types.ts';
import { FSWatcher, type WatchListener } from './watch.ts';

export { DEFAULT_SCRATCH_BYTES, mount, mountAssets, mountBackend, mounted, setScratchLimit, type Unmount } from './mounts.ts';
export { CHUNK_SIZE, INLINE_MAX, SqlBackend, type SyncCursor, type SyncSql, type SyncStorage } from './sql.ts';
export type { StorageCounters, Usage } from './backend.ts';
export { openDescriptors } from './sync.ts';
export { watcherCount } from './watch.ts';
export { constants, Dirent, ReadStream, Stats, WriteStream, FSWatcher, promises, createReadStream, createWriteStream };

export const {
  accessSync,
  appendFileSync,
  chmodSync,
  chownSync,
  closeSync,
  copyFileSync,
  existsSync,
  fdatasyncSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  futimesSync,
  lchmodSync,
  lchownSync,
  linkSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} = sync;

export const F_OK = constants.F_OK;
export const R_OK = constants.R_OK;
export const W_OK = constants.W_OK;
export const X_OK = constants.X_OK;

type Callback = (error: Error | null, ...result: unknown[]) => void;

/** The callback form of a promise-returning call: `(…args, callback)`. */
function callbackForm<A extends unknown[]>(name: string, fn: (...args: A) => Promise<unknown>, results = 1): (...args: unknown[]) => void {
  const wrapped = (...args: unknown[]): void => {
    const callback = args.pop();
    if (typeof callback !== 'function') {
      throw Object.assign(new TypeError(`The "cb" argument of fs.${name} must be of type function.`), { code: 'ERR_INVALID_ARG_TYPE' });
    }
    fn(...(args as A)).then(
      (result) => (results === 0 ? (callback as Callback)(null) : (callback as Callback)(null, result)),
      (error: Error) => (callback as Callback)(error),
    );
  };
  Object.defineProperty(wrapped, 'name', { value: name });
  return wrapped;
}

export const access = callbackForm('access', asyncFs.access, 0);
export const appendFile = callbackForm('appendFile', asyncFs.appendFile, 0);
export const chmod = callbackForm('chmod', asyncFs.chmod, 0);
export const chown = callbackForm('chown', asyncFs.chown, 0);
export const copyFile = callbackForm('copyFile', asyncFs.copyFile, 0);
export const lstat = callbackForm('lstat', asyncFs.lstat);
export const mkdir = callbackForm('mkdir', asyncFs.mkdir);
export const mkdtemp = callbackForm('mkdtemp', asyncFs.mkdtemp);
export const readFile = callbackForm('readFile', asyncFs.readFile);
export const readdir = callbackForm('readdir', asyncFs.readdir);
export const readlink = callbackForm('readlink', asyncFs.readlink);
export const realpath = Object.assign(callbackForm('realpath', asyncFs.realpath), { native: callbackForm('realpath', asyncFs.realpath) });
export const rename = callbackForm('rename', asyncFs.rename, 0);
export const rm = callbackForm('rm', asyncFs.rm, 0);
export const rmdir = callbackForm('rmdir', asyncFs.rmdir, 0);
export const stat = callbackForm('stat', asyncFs.stat);
export const symlink = callbackForm('symlink', asyncFs.symlink, 0);
export const truncate = callbackForm('truncate', asyncFs.truncate, 0);
export const unlink = callbackForm('unlink', asyncFs.unlink, 0);
export const utimes = callbackForm('utimes', asyncFs.utimes, 0);
export const writeFile = callbackForm('writeFile', asyncFs.writeFile, 0);
export const open = callbackForm('open', async (path: PathLike, flags?: string | number, mode?: number) => sync.openSync(path, flags, mode));
export const close = callbackForm('close', async (fd: number) => sync.closeSync(fd), 0);
export const fstat = callbackForm('fstat', async (fd: number) => sync.fstatSync(fd));
export const fsync = callbackForm('fsync', async (fd: number) => sync.fsyncSync(fd), 0);
export const ftruncate = callbackForm('ftruncate', async (fd: number, len?: number) => sync.ftruncateSync(fd, len), 0);

/** `fs.read(fd, buffer, offset, length, position, callback)`: the callback gets `(error, bytesRead, buffer)`. */
export function read(fd: number, buffer: Uint8Array, ...rest: unknown[]): void {
  const callback = rest.pop() as (error: Error | null, bytesRead?: number, buffer?: Uint8Array) => void;
  queueMicrotask(() => {
    try {
      callback(null, sync.readSync(fd, buffer, rest[0], rest[1], rest[2]), buffer);
    } catch (error) {
      callback(error as Error);
    }
  });
}

/** `fs.write(fd, data, …, callback)`: the callback gets `(error, bytesWritten, data)`. */
export function write(fd: number, data: Uint8Array | string, ...rest: unknown[]): void {
  const callback = rest.pop() as (error: Error | null, written?: number, data?: Uint8Array | string) => void;
  queueMicrotask(() => {
    try {
      callback(null, sync.writeSync(fd, data, rest[0], rest[1], rest[2]), data);
    } catch (error) {
      callback(error as Error);
    }
  });
}

/** `fs.exists(path, callback)`: the callback gets only a boolean. */
export function exists(path: PathLike, callback: (exists: boolean) => void): void {
  queueMicrotask(() => callback(sync.existsSync(path)));
}

type WatchOptions = { recursive?: boolean; persistent?: boolean; encoding?: Encoding; signal?: AbortSignal };

/** Watches a file or folder (see `watch.ts` for what is reported). The path must exist. */
export function watch(path: PathLike, options?: WatchOptions | Encoding | WatchListener, listener?: WatchListener): FSWatcher {
  if (typeof options === 'function') {
    listener = options;
    options = {};
  }
  const settings: WatchOptions = typeof options === 'string' ? { encoding: options } : options ?? {};
  const at = locate(path, 'watch');
  const node = at.backend.lookup(at.rel);
  if (node === null) throw fsError('ENOENT', 'watch', at.given);
  if (node === 'notdir') throw fsError('ENOTDIR', 'watch', at.given);
  const watcher = new FSWatcher(at.abs, settings.recursive === true, settings.encoding, settings.persistent !== false);
  if (listener) watcher.on('change', listener);
  if (settings.signal) {
    if (settings.signal.aborted) watcher.close();
    else settings.signal.addEventListener('abort', () => watcher.close(), { once: true });
  }
  return watcher;
}

const unsupported = (name: string) => () => {
  throw unsupportedMember(name);
};

/** Members nothing reachable in hosted mode uses. */
export const watchFile = unsupported('watchFile');
export const unwatchFile = unsupported('unwatchFile');
export const opendirSync = unsupported('opendirSync');
export const opendir = unsupported('opendir');
export const cpSync = unsupported('cpSync');
export const cp = unsupported('cp');
export const statfsSync = unsupported('statfsSync');
export const statfs = unsupported('statfs');
export const readvSync = unsupported('readvSync');
export const writevSync = unsupported('writevSync');
export const readv = unsupported('readv');
export const writev = unsupported('writev');
export const openAsBlob = unsupported('openAsBlob');
export const globSync = unsupported('globSync');
export const glob = unsupported('glob');

const fs = {
  ...sync,
  constants,
  F_OK,
  R_OK,
  W_OK,
  X_OK,
  Stats,
  Dirent,
  ReadStream,
  WriteStream,
  FSWatcher,
  promises,
  createReadStream,
  createWriteStream,
  access,
  appendFile,
  chmod,
  chown,
  close,
  copyFile,
  exists,
  fstat,
  fsync,
  ftruncate,
  lstat,
  mkdir,
  mkdtemp,
  open,
  read,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  truncate,
  unlink,
  utimes,
  watch,
  write,
  writeFile,
  watchFile,
  unwatchFile,
  opendirSync,
  opendir,
  cpSync,
  cp,
  statfsSync,
  statfs,
  readvSync,
  writevSync,
  readv,
  writev,
  openAsBlob,
  globSync,
  glob,
};

export default fs;
