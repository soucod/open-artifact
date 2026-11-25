/**
 * The synchronous half of `node:fs`, with Node's rules: what must exist, what may be replaced, and which error says
 * why not (`code`, `errno`, `syscall`, `path`). Each call that changes anything is one transaction of its backend, so
 * a failure part-way (or a crash of the object) leaves nothing half done. The asynchronous forms (`promises.ts`,
 * the callbacks in `index.ts`) and the streams are built on these.
 *
 * Known differences from a disk: no symbolic or hard links (creating one fails with `EPERM`, and none exist); an open
 * descriptor follows its path, not its inode (a file renamed while open is no longer reached through it); access and
 * change times are the modification time; a folder's own time does not move when its entries change.
 */
import { Buffer } from 'node:buffer';
import type { Backend, Inode } from './backend.ts';
import { type FsError, fsError, isFsError } from './errors.ts';
import { clock, locate, type Located, onUnmount, pathString } from './mounts.ts';
import { constants, Dirent, type Encoding, type PathLike, Stats, dataBytes, toBuffer } from './types.ts';
import { changed, dropChanges, flushChanges } from './watch.ts';

const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

// ---- the core ----------------------------------------------------------------------------------------------------

/** Runs a change on `backend` as one transaction; reports its changes to watchers once it committed. */
function change<T>(backend: Backend, fn: () => T): T {
  if (backend.readOnly) {
    dropChanges();
    throw fsError('EROFS', 'open');
  }
  try {
    const result = backend.transaction(fn);
    flushChanges();
    return result;
  } catch (error) {
    dropChanges();
    throw error;
  }
}

/** The node at a located path, or the error Node gives for `syscall`. */
function find(at: Located, syscall: string): Inode {
  const node = at.backend.lookup(at.rel);
  if (node === null) throw fsError('ENOENT', syscall, at.given);
  if (node === 'notdir') throw fsError('ENOTDIR', syscall, at.given);
  if (at.slash && !node.dir) throw fsError('ENOTDIR', syscall, at.given);
  return node;
}

/** The node at a located path, `null` when nothing is there (its folder exists), or the error. */
function findOrNull(at: Located, syscall: string): Inode | null {
  const node = at.backend.lookup(at.rel);
  if (node === 'notdir') throw fsError('ENOTDIR', syscall, at.given);
  if (node === null) {
    parentOf(at, syscall);
    return null;
  }
  if (at.slash && !node.dir) throw fsError('ENOTDIR', syscall, at.given);
  return node;
}

/** The folder a new entry at `at` goes into; ENOENT or ENOTDIR when it cannot. */
function parentOf(at: Located, syscall: string): Inode {
  if (at.rel === '') return at.backend.lookup('') as Inode;
  const slash = at.rel.lastIndexOf('/');
  const parent = at.backend.lookup(slash < 0 ? '' : at.rel.slice(0, slash));
  if (parent === null) throw fsError('ENOENT', syscall, at.given);
  if (parent === 'notdir' || !parent.dir) throw fsError('ENOTDIR', syscall, at.given);
  return parent;
}

function notMountPoint(at: Located, syscall: string): void {
  if (at.rel === '') throw fsError('EPERM', syscall, at.given, undefined, 'a mount point cannot be removed or moved');
}

function encodingOf(options: unknown, fallback: Encoding = undefined): Encoding {
  if (typeof options === 'string') return options as Encoding;
  if (options && typeof options === 'object' && 'encoding' in options) return (options as { encoding?: Encoding }).encoding ?? fallback;
  return fallback;
}

function decode(bytes: Uint8Array, encoding: Encoding): string | Buffer {
  const buffer = toBuffer(bytes);
  return encoding && encoding !== 'buffer' ? buffer.toString(encoding) : buffer;
}

function modeOf(options: unknown, fallback: number): number {
  if (options && typeof options === 'object' && 'mode' in options) {
    const mode = (options as { mode?: number | string }).mode;
    if (typeof mode === 'number') return mode & 0o7777 & ~0o022;
    if (typeof mode === 'string') return parseInt(mode, 8) & 0o7777 & ~0o022;
  }
  return fallback;
}

/** Seconds (a number), a numeric string or a Date, as ms. */
function timeMs(value: number | string | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Number(value) * 1000;
  return value * 1000;
}

// ---- open flags ---------------------------------------------------------------------------------------------------

interface Flags {
  read: boolean;
  write: boolean;
  create: boolean;
  exclusive: boolean;
  truncate: boolean;
  append: boolean;
}

const STRING_FLAGS: Record<string, Flags> = {};
for (const [names, read, write, create, exclusive, truncate, append] of [
  [['r', 'rs', 'sr'], true, false, false, false, false, false],
  [['r+', 'rs+', 'sr+'], true, true, false, false, false, false],
  [['w'], false, true, true, false, true, false],
  [['wx', 'xw'], false, true, true, true, true, false],
  [['w+'], true, true, true, false, true, false],
  [['wx+', 'xw+'], true, true, true, true, true, false],
  [['a', 'as', 'sa'], false, true, true, false, false, true],
  [['ax', 'xa'], false, true, true, true, false, true],
  [['a+', 'as+', 'sa+'], true, true, true, false, false, true],
  [['ax+', 'xa+'], true, true, true, true, false, true],
] as const) {
  for (const name of names) STRING_FLAGS[name] = { read, write, create, exclusive, truncate, append };
}

export function parseFlags(flags: string | number | undefined, fallback = 'r'): Flags {
  if (flags === undefined || flags === null) flags = fallback;
  if (typeof flags === 'number') {
    const access = flags & 3;
    return {
      read: access === constants.O_RDONLY || access === constants.O_RDWR,
      write: access === constants.O_WRONLY || access === constants.O_RDWR,
      create: (flags & constants.O_CREAT) !== 0,
      exclusive: (flags & constants.O_EXCL) !== 0,
      truncate: (flags & constants.O_TRUNC) !== 0,
      append: (flags & constants.O_APPEND) !== 0,
    };
  }
  const parsed = STRING_FLAGS[flags];
  if (!parsed) throw Object.assign(new TypeError(`The value "${flags}" is invalid for option "flags"`), { code: 'ERR_INVALID_ARG_VALUE' });
  return parsed;
}

// ---- reading --------------------------------------------------------------------------------------------------------

export function statSync(path: PathLike, options?: { throwIfNoEntry?: boolean; bigint?: boolean }): Stats | undefined {
  const at = locate(path, 'stat');
  try {
    return new Stats(at.backend.dev, find(at, 'stat'));
  } catch (error) {
    if (options?.throwIfNoEntry === false && isFsError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return undefined;
    throw error;
  }
}

export function lstatSync(path: PathLike, options?: { throwIfNoEntry?: boolean; bigint?: boolean }): Stats | undefined {
  const at = locate(path, 'lstat');
  try {
    return new Stats(at.backend.dev, find(at, 'lstat'));
  } catch (error) {
    if (options?.throwIfNoEntry === false && isFsError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return undefined;
    throw error;
  }
}

export function existsSync(path: PathLike): boolean {
  try {
    const at = locate(path, 'access');
    const node = at.backend.lookup(at.rel);
    return node !== null && node !== 'notdir' && (!at.slash || node.dir);
  } catch {
    return false;
  }
}

export function accessSync(path: PathLike, _mode?: number): void {
  const at = locate(path, 'access');
  find(at, 'access');
}

export function readFileSync(path: PathLike | number, options?: Encoding | { encoding?: Encoding; flag?: string }): string | Buffer {
  const encoding = encodingOf(options);
  if (typeof path === 'number') return decode(readAllFd(path), encoding);
  const at = locate(path, 'open');
  const node = find(at, 'open');
  if (node.dir) throw fsError('EISDIR', 'read', undefined);
  return decode(at.backend.read(at.rel, node, 0, node.size), encoding);
}

/** Bytes `[start, end)` of a file (used by the read stream: one range, only the chunks it covers). */
export function readRange(path: PathLike, start: number, end: number): Uint8Array {
  const at = locate(path, 'open');
  const node = find(at, 'open');
  if (node.dir) throw fsError('EISDIR', 'read');
  return at.backend.read(at.rel, node, start, end);
}

type ReaddirOptions = Encoding | { encoding?: Encoding; withFileTypes?: boolean; recursive?: boolean };

export function readdirSync(path: PathLike, options?: ReaddirOptions): (string | Buffer | Dirent)[] {
  const at = locate(path, 'scandir');
  const node = find(at, 'scandir');
  if (!node.dir) throw fsError('ENOTDIR', 'scandir', at.given);
  const encoding = encodingOf(options);
  const withTypes = typeof options === 'object' && options !== null && options.withFileTypes === true;
  const recursive = typeof options === 'object' && options !== null && options.recursive === true;
  const out: (string | Buffer | Dirent)[] = [];
  const name = (value: string): string | Buffer => (encoding === 'buffer' ? Buffer.from(value) : value);
  // Breadth first, as Node lists a tree.
  const queue: { rel: string; node: Inode; prefix: string; dir: string }[] = [{ rel: at.rel, node, prefix: '', dir: at.abs }];
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const entry of at.backend.list(next.rel, next.node)) {
      const relName = next.prefix + entry.name;
      out.push(withTypes ? new Dirent(name(entry.name), entry.node.dir, next.dir) : name(relName));
      if (recursive && entry.node.dir) {
        queue.push({ rel: next.rel === '' ? entry.name : `${next.rel}/${entry.name}`, node: entry.node, prefix: relName + '/', dir: `${next.dir === '/' ? '' : next.dir}/${entry.name}` });
      }
    }
  }
  return out;
}

export function realpathSync(path: PathLike, _options?: unknown): string {
  const at = locate(path, 'realpath');
  find(at, 'realpath');
  return at.abs;
}
realpathSync.native = realpathSync;

// ---- writing --------------------------------------------------------------------------------------------------------

type WriteOptions = Encoding | { encoding?: Encoding; mode?: number | string; flag?: string; flush?: boolean };

export function writeFileSync(path: PathLike | number, data: unknown, options?: WriteOptions): void {
  const encoding = (encodingOf(options) ?? 'utf8') as BufferEncoding;
  const bytes = dataBytes(data, encoding === ('buffer' as string) ? 'utf8' : encoding);
  if (typeof path === 'number') {
    const fd = descriptor(path, 'write');
    writeFd(fd, bytes, fd.append ? null : fd.position, true);
    return;
  }
  const flag = typeof options === 'object' && options !== null && options.flag ? options.flag : 'w';
  writeWhole(locate(path, 'open'), bytes, parseFlags(flag), modeOf(options, FILE_MODE));
}

export function appendFileSync(path: PathLike | number, data: unknown, options?: WriteOptions): void {
  const encoding = (encodingOf(options) ?? 'utf8') as BufferEncoding;
  const bytes = dataBytes(data, encoding);
  if (typeof path === 'number') {
    const fd = descriptor(path, 'write');
    writeFd(fd, bytes, null, true);
    return;
  }
  const flag = typeof options === 'object' && options !== null && options.flag ? options.flag : 'a';
  writeWhole(locate(path, 'open'), bytes, parseFlags(flag), modeOf(options, FILE_MODE));
}

/** `writeFile`/`appendFile` by path: open with `flags`, write everything, close — one transaction. */
function writeWhole(at: Located, bytes: Uint8Array, flags: Flags, mode: number): void {
  change(at.backend, () => {
    const existing = findOrNull(at, 'open');
    if (existing?.dir || (existing === null && at.slash)) throw fsError('EISDIR', 'open', at.given);
    if (existing && flags.exclusive) throw fsError('EEXIST', 'open', at.given);
    if (!existing && !flags.create) throw fsError('ENOENT', 'open', at.given);
    const now = clock.now();
    if (existing && flags.append) at.backend.writeAt(at.rel, existing, existing.size, bytes, now);
    else if (existing && !flags.truncate) {
      // `r+` and friends: overwrite from the start, keep what lies beyond.
      at.backend.writeAt(at.rel, existing, 0, bytes, now);
    } else at.backend.put(at.rel, existing, bytes, mode, now);
    if (!existing) changed(at.abs, 'rename');
    changed(at.abs, 'change');
  });
}

export function mkdirSync(path: PathLike, options?: number | string | { recursive?: boolean; mode?: number | string }): string | undefined {
  const recursive = typeof options === 'object' && options !== null && options.recursive === true;
  const mode = typeof options === 'object' ? modeOf(options, DIR_MODE) : modeOf({ mode: options }, DIR_MODE);
  const at = locate(path, 'mkdir');
  if (!recursive) {
    change(at.backend, () => {
      const existing = at.backend.lookup(at.rel);
      if (existing === 'notdir') throw fsError('ENOTDIR', 'mkdir', at.given);
      if (existing) throw fsError('EEXIST', 'mkdir', at.given);
      parentOf(at, 'mkdir');
      at.backend.mkdir(at.rel, mode, clock.now());
      changed(at.abs, 'rename');
    });
    return undefined;
  }
  return change(at.backend, () => {
    const existing = at.backend.lookup(at.rel);
    if (existing && existing !== 'notdir') {
      if (!existing.dir) throw fsError('EEXIST', 'mkdir', at.given);
      return undefined;
    }
    // The missing folders, outermost first.
    const parts = at.rel.split('/');
    let first: string | undefined;
    for (let i = 1; i <= parts.length; i++) {
      const rel = parts.slice(0, i).join('/');
      const node = at.backend.lookup(rel);
      if (node === 'notdir' || (node && !node.dir)) throw fsError('ENOTDIR', 'mkdir', at.given);
      if (node) continue;
      at.backend.mkdir(rel, mode, clock.now());
      const abs = at.abs.slice(0, at.abs.length - at.rel.length) + rel;
      changed(abs, 'rename');
      first ??= abs;
    }
    return first;
  });
}

const TEMP_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function mkdtempSync(prefix: string, _options?: unknown): string {
  for (let attempt = 0; ; attempt++) {
    let suffix = '';
    const random = crypto.getRandomValues(new Uint8Array(6));
    for (const byte of random) suffix += TEMP_CHARS[byte % TEMP_CHARS.length];
    const path = prefix + suffix;
    try {
      mkdirSync(path, { mode: 0o700 });
      return path;
    } catch (error) {
      if (!isFsError(error, 'EEXIST') || attempt > 10) throw rename(error, 'mkdtemp', prefix + 'XXXXXX');
    }
  }
}

/** Gives an error from an inner call the syscall and path of the outer one. */
function rename(error: unknown, syscall: string, path: string): unknown {
  if (!isFsError(error)) return error;
  return fsError(error.code, syscall, path);
}

export function rmSync(path: PathLike, options?: { recursive?: boolean; force?: boolean; maxRetries?: number; retryDelay?: number }): void {
  const at = locate(path, 'rm');
  change(at.backend, () => {
    const node = at.backend.lookup(at.rel);
    if (node === null || node === 'notdir') {
      if (options?.force) return;
      throw fsError(node === null ? 'ENOENT' : 'ENOTDIR', 'lstat', at.given);
    }
    if (node.dir && !options?.recursive) {
      const error = fsError('EISDIR', 'rm', at.given) as FsError & { code: string };
      error.code = 'ERR_FS_EISDIR' as FsError['code'];
      error.message = `Path is a directory: rm returned EISDIR (is a directory) ${at.given}`;
      throw error;
    }
    notMountPoint(at, 'rm');
    at.backend.remove(at.rel, node);
    changed(at.abs, 'rename');
  });
}

export function rmdirSync(path: PathLike, options?: { recursive?: boolean }): void {
  if (options?.recursive) return rmSync(path, { recursive: true });
  const at = locate(path, 'rmdir');
  change(at.backend, () => {
    const node = find(at, 'rmdir');
    if (!node.dir) throw fsError('ENOTDIR', 'rmdir', at.given);
    if (!at.backend.isEmpty(at.rel, node)) throw fsError('ENOTEMPTY', 'rmdir', at.given);
    notMountPoint(at, 'rmdir');
    at.backend.remove(at.rel, node);
    changed(at.abs, 'rename');
  });
}

export function unlinkSync(path: PathLike): void {
  const at = locate(path, 'unlink');
  change(at.backend, () => {
    const node = find(at, 'unlink');
    if (node.dir) throw fsError('EISDIR', 'unlink', at.given);
    at.backend.remove(at.rel, node);
    changed(at.abs, 'rename');
  });
}

export function renameSync(oldPath: PathLike, newPath: PathLike): void {
  const from = locate(oldPath, 'rename');
  const to = locate(newPath, 'rename');
  const fail = (code: Parameters<typeof fsError>[0]): FsError => fsError(code, 'rename', from.given, to.given);
  if (from.backend !== to.backend) {
    // Node checks the source first.
    const node = from.backend.lookup(from.rel);
    if (node === null) throw fail('ENOENT');
    throw fail('EXDEV');
  }
  change(from.backend, () => {
    const node = from.backend.lookup(from.rel);
    if (node === null) throw fail('ENOENT');
    if (node === 'notdir' || (from.slash && !node.dir)) throw fail('ENOTDIR');
    const target = to.backend.lookup(to.rel);
    if (target === 'notdir') throw fail('ENOTDIR');
    if (target === null) {
      const slash = to.rel.lastIndexOf('/');
      const parent = to.rel === '' ? null : to.backend.lookup(slash < 0 ? '' : to.rel.slice(0, slash));
      if (parent === null) throw fail('ENOENT');
      if (parent === 'notdir' || !parent.dir) throw fail('ENOTDIR');
      if (to.slash && !node.dir) throw fail('ENOTDIR');
    }
    if (from.abs === to.abs) return;
    if (node.dir && (to.abs + '/').startsWith(from.abs + '/')) throw fail('EINVAL');
    if (from.rel === '' || to.rel === '') throw fail('EPERM');
    if (target) {
      if (node.dir && !target.dir) throw fail('ENOTDIR');
      if (!node.dir && target.dir) throw fail('EISDIR');
      if (target.dir && !to.backend.isEmpty(to.rel, target)) throw fail('ENOTEMPTY');
      if (target.ino === node.ino) return;
    }
    from.backend.move(from.rel, node, to.rel, target);
    changed(from.abs, 'rename');
    changed(to.abs, 'rename');
  });
}

export function copyFileSync(src: PathLike, dest: PathLike, mode = 0): void {
  const from = locate(src, 'copyfile');
  const to = locate(dest, 'copyfile');
  const fail = (code: Parameters<typeof fsError>[0]): FsError => fsError(code, 'copyfile', from.given, to.given);
  const node = from.backend.lookup(from.rel);
  if (node === null) throw fail('ENOENT');
  if (node === 'notdir') throw fail('ENOTDIR');
  if (node.dir) throw fail('EISDIR');
  const bytes = from.backend.read(from.rel, node, 0, node.size);
  change(to.backend, () => {
    const target = to.backend.lookup(to.rel);
    if (target === 'notdir') throw fail('ENOTDIR');
    if (target === null) {
      const slash = to.rel.lastIndexOf('/');
      const parent = to.backend.lookup(slash < 0 ? '' : to.rel.slice(0, slash));
      if (parent === null) throw fail('ENOENT');
      if (parent === 'notdir' || !parent.dir) throw fail('ENOTDIR');
    }
    if (target && (mode & constants.COPYFILE_EXCL)) throw fail('EEXIST');
    if (target?.dir) throw fail('EISDIR');
    if (target && from.backend === to.backend && target.ino === node.ino) return;
    to.backend.put(to.rel, target, bytes, node.mode, clock.now());
    if (!target) changed(to.abs, 'rename');
    changed(to.abs, 'change');
  });
}

export function truncateSync(path: PathLike | number, len = 0): void {
  if (typeof path === 'number') return ftruncateSync(path, len);
  const at = locate(path, 'open');
  change(at.backend, () => {
    const node = find(at, 'open');
    if (node.dir) throw fsError('EISDIR', 'open', at.given);
    at.backend.truncate(at.rel, node, Math.max(0, len), clock.now());
    changed(at.abs, 'change');
  });
}

export function utimesSync(path: PathLike, _atime: number | string | Date, mtime: number | string | Date): void {
  const at = locate(path, 'utime');
  change(at.backend, () => {
    const node = find(at, 'utime');
    at.backend.setMeta(at.rel, node, { mtimeMs: timeMs(mtime) });
    changed(at.abs, 'change');
  });
}
export const lutimesSync = utimesSync;

export function chmodSync(path: PathLike, mode: number | string): void {
  const at = locate(path, 'chmod');
  change(at.backend, () => {
    const node = find(at, 'chmod');
    at.backend.setMeta(at.rel, node, { mode: (typeof mode === 'string' ? parseInt(mode, 8) : mode) & 0o7777 });
    changed(at.abs, 'change');
  });
}
export const lchmodSync = chmodSync;

export function chownSync(path: PathLike): void {
  find(locate(path, 'chown'), 'chown');
}
export const lchownSync = chownSync;

export function symlinkSync(_target: PathLike, path: PathLike): void {
  throw fsError('EPERM', 'symlink', pathString(path), undefined, 'links are not supported');
}

export function linkSync(_existing: PathLike, path: PathLike): void {
  throw fsError('EPERM', 'link', pathString(path), undefined, 'links are not supported');
}

export function readlinkSync(path: PathLike): string {
  find(locate(path, 'readlink'), 'readlink');
  throw fsError('EINVAL', 'readlink', pathString(path));
}

// ---- descriptors ----------------------------------------------------------------------------------------------------

interface Descriptor {
  fd: number;
  at: Located;
  ino: number;
  read: boolean;
  write: boolean;
  append: boolean;
  position: number;
}

const descriptors = new Map<number, Descriptor>();
let nextFd = 1000;

onUnmount.add((backend) => {
  for (const [fd, entry] of descriptors) if (entry.at.backend === backend) descriptors.delete(fd);
});

function descriptor(fd: number, syscall: string): Descriptor {
  const entry = descriptors.get(fd);
  if (!entry) throw fsError('EBADF', syscall);
  return entry;
}

/** The file a descriptor names now (gone or replaced: EBADF). */
function nodeOf(entry: Descriptor, syscall: string): Inode {
  const node = entry.at.backend.lookup(entry.at.rel);
  if (!node || node === 'notdir' || node.ino !== entry.ino) throw fsError('EBADF', syscall, undefined, undefined, 'the file was moved or removed while open');
  return node;
}

export function openSync(path: PathLike, flags?: string | number, mode?: number | string): number {
  const parsed = parseFlags(flags);
  const at = locate(path, 'open');
  const fileMode = mode === undefined ? FILE_MODE : modeOf({ mode }, FILE_MODE);
  const open = (): Inode => {
    const existing = findOrNull(at, 'open');
    if (existing && parsed.create && parsed.exclusive) throw fsError('EEXIST', 'open', at.given);
    if (!existing) {
      if (!parsed.create) throw fsError('ENOENT', 'open', at.given);
      if (at.slash) throw fsError('EISDIR', 'open', at.given);
      const node = at.backend.put(at.rel, null, new Uint8Array(0), fileMode, clock.now());
      changed(at.abs, 'rename');
      return node;
    }
    if (existing.dir && parsed.write) throw fsError('EISDIR', 'open', at.given);
    if (parsed.truncate && existing.size > 0) {
      changed(at.abs, 'change');
      return at.backend.truncate(at.rel, existing, 0, clock.now());
    }
    return existing;
  };
  const node = parsed.create || parsed.truncate ? change(at.backend, open) : open();
  const fd = nextFd++;
  descriptors.set(fd, { fd, at, ino: node.ino, read: parsed.read, write: parsed.write, append: parsed.append, position: 0 });
  return fd;
}

export function closeSync(fd: number): void {
  descriptor(fd, 'close');
  descriptors.delete(fd);
}

export function fstatSync(fd: number, _options?: unknown): Stats {
  const entry = descriptor(fd, 'fstat');
  return new Stats(entry.at.backend.dev, nodeOf(entry, 'fstat'));
}

export function fsyncSync(fd: number): void {
  descriptor(fd, 'fsync');
}
export const fdatasyncSync = fsyncSync;

export function ftruncateSync(fd: number, len = 0): void {
  const entry = descriptor(fd, 'ftruncate');
  if (!entry.write) throw fsError('EINVAL', 'ftruncate');
  change(entry.at.backend, () => {
    entry.at.backend.truncate(entry.at.rel, nodeOf(entry, 'ftruncate'), Math.max(0, len), clock.now());
    changed(entry.at.abs, 'change');
  });
}

export function futimesSync(fd: number, _atime: number | string | Date, mtime: number | string | Date): void {
  const entry = descriptor(fd, 'futime');
  change(entry.at.backend, () => {
    entry.at.backend.setMeta(entry.at.rel, nodeOf(entry, 'futime'), { mtimeMs: timeMs(mtime) });
    changed(entry.at.abs, 'change');
  });
}

/** Writes `bytes` through a descriptor at `position` (`null`: its own position, or the end when appending). */
function writeFd(entry: Descriptor, bytes: Uint8Array, position: number | null, advance: boolean): number {
  if (!entry.write) throw fsError('EBADF', 'write');
  change(entry.at.backend, () => {
    const node = nodeOf(entry, 'write');
    const at = entry.append ? node.size : position ?? entry.position;
    if (bytes.length > 0) entry.at.backend.writeAt(entry.at.rel, node, at, bytes, clock.now());
    if (advance && (position === null || entry.append)) entry.position = at + bytes.length;
    changed(entry.at.abs, 'change');
  });
  return bytes.length;
}

function readAllFd(fd: number): Uint8Array {
  const entry = descriptor(fd, 'read');
  if (!entry.read) throw fsError('EBADF', 'read');
  const node = nodeOf(entry, 'read');
  if (node.dir) throw fsError('EISDIR', 'read');
  const bytes = entry.at.backend.read(entry.at.rel, node, entry.position, node.size);
  entry.position += bytes.length;
  return bytes;
}

type BufferLike = Uint8Array;

/**
 * `writeSync(fd, buffer, offset?, length?, position?)`, `writeSync(fd, buffer, { offset, length, position })` or
 * `writeSync(fd, string, position?, encoding?)`.
 */
export function writeSync(fd: number, data: BufferLike | string, a?: unknown, b?: unknown, c?: unknown): number {
  const entry = descriptor(fd, 'write');
  if (typeof data === 'string') {
    const position = typeof a === 'number' ? a : null;
    return writeFd(entry, Buffer.from(data, (typeof b === 'string' ? b : 'utf8') as BufferEncoding), position, true);
  }
  const bytes = dataBytes(data);
  let offset = 0;
  let length: number | undefined;
  let position: number | null = null;
  if (a && typeof a === 'object') {
    const options = a as { offset?: number; length?: number; position?: number | null };
    offset = options.offset ?? 0;
    length = options.length;
    position = options.position ?? null;
  } else {
    offset = typeof a === 'number' ? a : 0;
    length = typeof b === 'number' ? b : undefined;
    position = typeof c === 'number' ? c : null;
  }
  length ??= bytes.length - offset;
  if (offset < 0 || length < 0 || offset + length > bytes.length) throw Object.assign(new RangeError('The value of "length" is out of range.'), { code: 'ERR_OUT_OF_RANGE' });
  return writeFd(entry, bytes.subarray(offset, offset + length), position, true);
}

/** `readSync(fd, buffer, offset, length, position)` or `readSync(fd, buffer, { offset, length, position })`. */
export function readSync(fd: number, buffer: BufferLike, a?: unknown, b?: unknown, c?: unknown): number {
  const entry = descriptor(fd, 'read');
  if (!entry.read) throw fsError('EBADF', 'read');
  let offset = 0;
  let length: number | undefined;
  let position: number | bigint | null = null;
  if (a && typeof a === 'object') {
    const options = a as { offset?: number; length?: number; position?: number | bigint | null };
    offset = options.offset ?? 0;
    length = options.length;
    position = options.position ?? null;
  } else {
    offset = typeof a === 'number' ? a : 0;
    length = typeof b === 'number' ? b : undefined;
    position = typeof c === 'number' || typeof c === 'bigint' ? c : null;
  }
  length ??= buffer.byteLength - offset;
  const node = nodeOf(entry, 'read');
  if (node.dir) throw fsError('EISDIR', 'read');
  const from = position === null || Number(position) < 0 ? entry.position : Number(position);
  const bytes = entry.at.backend.read(entry.at.rel, node, from, from + length);
  new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).set(bytes, offset);
  if (position === null || Number(position) < 0) entry.position += bytes.length;
  return bytes.length;
}

/** Writes a whole file through a descriptor (`FileHandle.writeFile`): from its position, as `fs.writeFile(fd)` does. */
export function writeAllFd(fd: number, bytes: Uint8Array): void {
  const entry = descriptor(fd, 'write');
  writeFd(entry, bytes, entry.append ? null : entry.position, true);
}

/** Reads the rest of a file through a descriptor (`FileHandle.readFile`). */
export function readRestFd(fd: number): Uint8Array {
  return readAllFd(fd);
}

/** The descriptor's path (for errors and the async read of assets). */
export function descriptorPath(fd: number): string {
  return descriptor(fd, 'fstat').at.abs;
}

export function openDescriptors(): number {
  return descriptors.size;
}

// ---- misc -----------------------------------------------------------------------------------------------------------

/** The located path and node of a file, for the stream and promise layers. */
export function locateFile(path: PathLike, syscall: string): { at: Located; node: Inode } {
  const at = locate(path, syscall);
  return { at, node: find(at, syscall) };
}

