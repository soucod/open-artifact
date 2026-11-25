/**
 * `node:fs/promises` over the synchronous calls (each settles on a later microtask, as a real one would), plus the
 * one truly asynchronous read: a file of a backend that can only fetch (the built editors) is read with `readFile`.
 */
import type { Buffer } from 'node:buffer';
import { fsError, unsupportedMember } from './errors.ts';
import { locate } from './mounts.ts';
import * as sync from './sync.ts';
import { constants, type Encoding, type PathLike, type Stats, dataBytes, toBuffer } from './types.ts';

export { constants };

type ReadOptions = Encoding | { encoding?: Encoding; flag?: string; signal?: AbortSignal };

function encodingOf(options: ReadOptions | undefined): Encoding {
  if (typeof options === 'string') return options;
  return options?.encoding ?? undefined;
}

export async function readFile(path: PathLike | FileHandle, options?: ReadOptions): Promise<string | Buffer> {
  if (path instanceof FileHandle) return path.readFile(options);
  const at = locate(path, 'open');
  if (at.backend.readAsync) {
    const bytes = await at.backend.readAsync(at.rel);
    if (!bytes) throw fsError('ENOENT', 'open', at.given);
    const encoding = encodingOf(options);
    const buffer = toBuffer(bytes);
    return encoding && encoding !== 'buffer' ? buffer.toString(encoding) : buffer;
  }
  return sync.readFileSync(path, options as Parameters<typeof sync.readFileSync>[1]);
}

export async function writeFile(path: PathLike | FileHandle, data: unknown, options?: Parameters<typeof sync.writeFileSync>[2]): Promise<void> {
  if (path instanceof FileHandle) return path.writeFile(data, options);
  sync.writeFileSync(path, await collect(data, options), options);
}

export async function appendFile(path: PathLike | FileHandle, data: unknown, options?: Parameters<typeof sync.appendFileSync>[2]): Promise<void> {
  if (path instanceof FileHandle) return path.appendFile(data, options);
  sync.appendFileSync(path, await collect(data, options), options);
}

/** `writeFile` also takes an (async) iterable of chunks. */
async function collect(data: unknown, options: unknown): Promise<unknown> {
  if (typeof data === 'string' || ArrayBuffer.isView(data) || data instanceof ArrayBuffer) return data;
  if (data && typeof data === 'object' && (Symbol.asyncIterator in data || Symbol.iterator in data)) {
    const encoding = (typeof options === 'string' ? options : (options as { encoding?: BufferEncoding } | undefined)?.encoding) ?? 'utf8';
    const parts: Uint8Array[] = [];
    for await (const chunk of data as AsyncIterable<unknown>) parts.push(dataBytes(chunk, encoding as BufferEncoding));
    let length = 0;
    for (const part of parts) length += part.length;
    const out = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
  return data;
}

export async function stat(path: PathLike, options?: { bigint?: boolean }): Promise<Stats> {
  return sync.statSync(path, options) as Stats;
}

export async function lstat(path: PathLike, options?: { bigint?: boolean }): Promise<Stats> {
  return sync.lstatSync(path, options) as Stats;
}

export async function access(path: PathLike, mode?: number): Promise<void> {
  sync.accessSync(path, mode);
}

export async function readdir(path: PathLike, options?: Parameters<typeof sync.readdirSync>[1]): Promise<ReturnType<typeof sync.readdirSync>> {
  return sync.readdirSync(path, options);
}

export async function mkdir(path: PathLike, options?: Parameters<typeof sync.mkdirSync>[1]): Promise<string | undefined> {
  return sync.mkdirSync(path, options);
}

export async function mkdtemp(prefix: string, options?: unknown): Promise<string> {
  return sync.mkdtempSync(prefix, options);
}

export async function rm(path: PathLike, options?: Parameters<typeof sync.rmSync>[1]): Promise<void> {
  sync.rmSync(path, options);
}

export async function rmdir(path: PathLike, options?: Parameters<typeof sync.rmdirSync>[1]): Promise<void> {
  sync.rmdirSync(path, options);
}

export async function unlink(path: PathLike): Promise<void> {
  sync.unlinkSync(path);
}

export async function rename(oldPath: PathLike, newPath: PathLike): Promise<void> {
  sync.renameSync(oldPath, newPath);
}

export async function copyFile(src: PathLike, dest: PathLike, mode?: number): Promise<void> {
  sync.copyFileSync(src, dest, mode);
}

export async function realpath(path: PathLike, options?: unknown): Promise<string> {
  return sync.realpathSync(path, options);
}

export async function truncate(path: PathLike, len?: number): Promise<void> {
  sync.truncateSync(path, len);
}

export async function utimes(path: PathLike, atime: number | string | Date, mtime: number | string | Date): Promise<void> {
  sync.utimesSync(path, atime, mtime);
}
export const lutimes = utimes;

export async function chmod(path: PathLike, mode: number | string): Promise<void> {
  sync.chmodSync(path, mode);
}
export const lchmod = chmod;

export async function chown(path: PathLike): Promise<void> {
  sync.chownSync(path);
}
export const lchown = chown;

export async function symlink(target: PathLike, path: PathLike): Promise<void> {
  sync.symlinkSync(target, path);
}

export async function link(existing: PathLike, path: PathLike): Promise<void> {
  sync.linkSync(existing, path);
}

export async function readlink(path: PathLike): Promise<string> {
  return sync.readlinkSync(path);
}

export async function open(path: PathLike, flags?: string | number, mode?: number | string): Promise<FileHandle> {
  return new FileHandle(sync.openSync(path, flags, mode));
}

export async function opendir(): Promise<never> {
  throw unsupportedMember('opendir');
}

export async function cp(): Promise<never> {
  throw unsupportedMember('cp');
}

export async function statfs(): Promise<never> {
  throw unsupportedMember('statfs');
}

export function watch(): never {
  throw unsupportedMember('promises.watch');
}

/** What `open` gives: a descriptor with methods. */
export class FileHandle {
  private closed = false;

  readonly fd: number;

  constructor(fd: number) {
    this.fd = fd;
  }

  private check(): number {
    if (this.closed) throw fsError('EBADF', 'fstat');
    return this.fd;
  }

  async stat(options?: unknown): Promise<Stats> {
    return sync.fstatSync(this.check(), options);
  }

  async readFile(options?: ReadOptions): Promise<string | Buffer> {
    const bytes = toBuffer(sync.readRestFd(this.check()));
    const encoding = encodingOf(options);
    return encoding && encoding !== 'buffer' ? bytes.toString(encoding) : bytes;
  }

  async writeFile(data: unknown, options?: Parameters<typeof sync.writeFileSync>[2]): Promise<void> {
    const encoding = (typeof options === 'string' ? options : options?.encoding) ?? 'utf8';
    sync.writeAllFd(this.check(), dataBytes(await collect(data, options), encoding as BufferEncoding));
  }

  async appendFile(data: unknown, options?: Parameters<typeof sync.writeFileSync>[2]): Promise<void> {
    const encoding = (typeof options === 'string' ? options : options?.encoding) ?? 'utf8';
    sync.appendFileSync(this.check(), dataBytes(await collect(data, options), encoding as BufferEncoding));
  }

  async write(data: Uint8Array | string, a?: unknown, b?: unknown, c?: unknown): Promise<{ bytesWritten: number; buffer: Uint8Array | string }> {
    return { bytesWritten: sync.writeSync(this.check(), data, a, b, c), buffer: data };
  }

  async read(buffer?: Uint8Array | { buffer?: Uint8Array; offset?: number; length?: number; position?: number | null }, offset?: number, length?: number, position?: number | null): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    let target: Uint8Array;
    if (buffer instanceof Uint8Array) target = buffer;
    else {
      const options = buffer ?? {};
      target = options.buffer ?? new Uint8Array(16384);
      offset = options.offset;
      length = options.length;
      position = options.position;
    }
    const bytesRead = sync.readSync(this.check(), target, offset ?? 0, length ?? target.byteLength - (offset ?? 0), position ?? null);
    return { bytesRead, buffer: target };
  }

  async truncate(len?: number): Promise<void> {
    sync.ftruncateSync(this.check(), len);
  }

  async utimes(atime: number | string | Date, mtime: number | string | Date): Promise<void> {
    sync.futimesSync(this.check(), atime, mtime);
  }

  async chmod(): Promise<void> {
    this.check();
  }

  async sync(): Promise<void> {
    sync.fsyncSync(this.check());
  }

  async datasync(): Promise<void> {
    sync.fsyncSync(this.check());
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    sync.closeSync(this.fd);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

const promises = {
  constants,
  readFile,
  writeFile,
  appendFile,
  stat,
  lstat,
  access,
  readdir,
  mkdir,
  mkdtemp,
  rm,
  rmdir,
  unlink,
  rename,
  copyFile,
  realpath,
  truncate,
  utimes,
  lutimes,
  chmod,
  lchmod,
  chown,
  lchown,
  symlink,
  link,
  readlink,
  open,
  opendir,
  cp,
  statfs,
  watch,
  FileHandle,
};

export default promises;
