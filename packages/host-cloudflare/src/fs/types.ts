/** `Stats`, `Dirent` and `constants` as `node:fs` has them (the constants are Linux's, as workerd reports them). */
import { Buffer } from 'node:buffer';
import type { Inode } from './backend.ts';

export const constants = Object.freeze({
  UV_FS_SYMLINK_DIR: 1,
  UV_FS_SYMLINK_JUNCTION: 2,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  UV_DIRENT_UNKNOWN: 0,
  UV_DIRENT_FILE: 1,
  UV_DIRENT_DIR: 2,
  UV_DIRENT_LINK: 3,
  UV_DIRENT_FIFO: 4,
  UV_DIRENT_SOCKET: 5,
  UV_DIRENT_CHAR: 6,
  UV_DIRENT_BLOCK: 7,
  S_IFMT: 0o170000,
  S_IFREG: 0o100000,
  S_IFDIR: 0o040000,
  S_IFCHR: 0o020000,
  S_IFBLK: 0o060000,
  S_IFIFO: 0o010000,
  S_IFLNK: 0o120000,
  S_IFSOCK: 0o140000,
  O_CREAT: 0o100,
  O_EXCL: 0o200,
  UV_FS_O_FILEMAP: 0,
  O_NOCTTY: 0o400,
  O_TRUNC: 0o1000,
  O_APPEND: 0o2000,
  O_DIRECTORY: 0o200000,
  O_NOATIME: 0o1000000,
  O_NOFOLLOW: 0o400000,
  O_SYNC: 0o4010000,
  O_DSYNC: 0o10000,
  O_DIRECT: 0o40000,
  O_NONBLOCK: 0o4000,
  S_IRWXU: 0o700,
  S_IRUSR: 0o400,
  S_IWUSR: 0o200,
  S_IXUSR: 0o100,
  S_IRWXG: 0o70,
  S_IRGRP: 0o40,
  S_IWGRP: 0o20,
  S_IXGRP: 0o10,
  S_IRWXO: 0o7,
  S_IROTH: 0o4,
  S_IWOTH: 0o2,
  S_IXOTH: 0o1,
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  UV_FS_COPYFILE_EXCL: 1,
  COPYFILE_EXCL: 1,
  UV_FS_COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE: 2,
  UV_FS_COPYFILE_FICLONE_FORCE: 4,
  COPYFILE_FICLONE_FORCE: 4,
});

const date = (ms: number): Date => new Date(Math.floor(ms));

/** What `stat` returns. Access, change and birth times are the modification time (nothing else is kept). */
export class Stats {
  dev: number;
  ino: number;
  mode: number;
  nlink = 1;
  uid = 0;
  gid = 0;
  rdev = 0;
  size: number;
  blksize = 4096;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;

  constructor(dev: number, node: Inode) {
    this.dev = dev;
    this.ino = node.ino;
    this.mode = (node.dir ? constants.S_IFDIR : constants.S_IFREG) | node.mode;
    this.size = node.dir ? 4096 : node.size;
    this.blocks = Math.ceil(this.size / 512);
    this.atimeMs = this.mtimeMs = this.ctimeMs = this.birthtimeMs = node.mtimeMs;
    this.atime = date(node.mtimeMs);
    this.mtime = date(node.mtimeMs);
    this.ctime = date(node.mtimeMs);
    this.birthtime = date(node.mtimeMs);
  }

  isFile(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFREG;
  }
  isDirectory(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFDIR;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
}

/** An entry of `readdir(…, { withFileTypes: true })`. */
export class Dirent {
  name: string | Buffer;
  parentPath: string;
  private readonly dir: boolean;

  constructor(name: string | Buffer, dir: boolean, parentPath: string) {
    this.name = name;
    this.dir = dir;
    this.parentPath = parentPath;
  }

  /** The folder the entry is in (Node's deprecated alias of `parentPath`). */
  get path(): string {
    return this.parentPath;
  }
  isFile(): boolean {
    return !this.dir;
  }
  isDirectory(): boolean {
    return this.dir;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
}

export type PathLike = string | Buffer | URL;
export type Encoding = BufferEncoding | 'buffer' | null | undefined;

/** Bytes as a `Buffer` without copying them. */
export function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** What a write was given, as bytes. */
export function dataBytes(data: unknown, encoding: BufferEncoding = 'utf8'): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data, encoding);
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw Object.assign(new TypeError(`The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView.`), { code: 'ERR_INVALID_ARG_TYPE' });
}
