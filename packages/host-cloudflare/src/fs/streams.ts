/**
 * `createReadStream` and `createWriteStream` over `node:stream`. A read stream reads its range a piece at a time
 * (each piece loads only the chunks it covers: a `start`/`end` range of a large file never reads the rest); a write
 * stream writes each piece through a descriptor as it comes.
 */
import { Readable, Writable } from 'node:stream';
import type { Buffer } from 'node:buffer';
import { CHUNK_SIZE } from './sql.ts';
import { fsError } from './errors.ts';
import { locate, pathString } from './mounts.ts';
import * as sync from './sync.ts';
import { type Encoding, type PathLike, dataBytes, toBuffer } from './types.ts';

interface ReadStreamOptions {
  flags?: string;
  encoding?: Encoding;
  fd?: number;
  start?: number;
  end?: number;
  highWaterMark?: number;
  autoClose?: boolean;
  emitClose?: boolean;
  signal?: AbortSignal;
}

export class ReadStream extends Readable {
  readonly path: string;
  bytesRead = 0;
  pending = true;
  private position: number;
  private readonly end: number;
  private size = -1;
  private readonly piece: number;

  constructor(path: PathLike, options: ReadStreamOptions = {}) {
    const highWaterMark = options.highWaterMark ?? CHUNK_SIZE;
    super({ highWaterMark, ...(options.encoding && options.encoding !== 'buffer' ? { encoding: options.encoding } : {}), ...(options.signal ? { signal: options.signal } : {}), emitClose: options.emitClose ?? true });
    this.path = pathString(path);
    this.position = options.start ?? 0;
    this.end = options.end === undefined || options.end === Infinity ? Infinity : options.end + 1;
    this.piece = highWaterMark;
  }

  override _construct(callback: (error?: Error | null) => void): void {
    const at = locate(this.path, 'open');
    if (at.backend.readAsync) {
      // A fetched asset: read whole, then hand out.
      at.backend.readAsync(at.rel).then(
        (bytes) => {
          if (!bytes) return callback(fsError('ENOENT', 'open', this.path));
          this.whole = bytes;
          this.opened(bytes.length);
          callback();
        },
        (error: Error) => callback(error),
      );
      return;
    }
    try {
      const { node } = sync.locateFile(this.path, 'open');
      if (node.dir) throw fsError('EISDIR', 'read');
      this.opened(node.size);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  private whole: Uint8Array | null = null;

  private opened(size: number): void {
    this.size = size;
    this.pending = false;
    this.emit('open', -1);
    this.emit('ready');
  }

  override _read(): void {
    const stop = Math.min(this.end, this.size);
    if (this.position >= stop) {
      this.push(null);
      return;
    }
    // Pieces end on piece boundaries, so a range starting mid-chunk reads each chunk once.
    const to = Math.min(stop, this.position - (this.position % this.piece) + this.piece);
    try {
      const bytes = this.whole ? this.whole.subarray(this.position, to) : sync.readRange(this.path, this.position, to);
      if (bytes.length === 0) {
        this.push(null);
        return;
      }
      this.position += bytes.length;
      this.bytesRead += bytes.length;
      this.push(toBuffer(bytes));
    } catch (error) {
      this.destroy(error as Error);
    }
  }

  close(callback?: (error?: Error | null) => void): void {
    if (callback) this.once('close', () => callback());
    this.destroy();
  }
}

interface WriteStreamOptions {
  flags?: string;
  encoding?: BufferEncoding;
  fd?: number;
  mode?: number;
  start?: number;
  autoClose?: boolean;
  emitClose?: boolean;
  flush?: boolean;
  signal?: AbortSignal;
  highWaterMark?: number;
}

export class WriteStream extends Writable {
  readonly path: string;
  bytesWritten = 0;
  pending = true;
  fd: number | null = null;
  private position: number | null;
  private readonly flags: string;
  private readonly mode: number | undefined;
  private readonly defaultEncoding: BufferEncoding;

  constructor(path: PathLike, options: WriteStreamOptions = {}) {
    super({ ...(options.signal ? { signal: options.signal } : {}), ...(options.highWaterMark ? { highWaterMark: options.highWaterMark } : {}), emitClose: options.emitClose ?? true, decodeStrings: true });
    this.path = pathString(path);
    this.flags = options.flags ?? 'w';
    this.mode = options.mode;
    this.position = options.start ?? null;
    this.defaultEncoding = options.encoding ?? 'utf8';
    if (options.fd !== undefined) this.fd = options.fd;
  }

  override _construct(callback: (error?: Error | null) => void): void {
    try {
      this.fd ??= sync.openSync(this.path, this.flags, this.mode);
      this.pending = false;
      this.emit('open', this.fd);
      this.emit('ready');
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try {
      const bytes = dataBytes(chunk, typeof chunk === 'string' ? encoding ?? this.defaultEncoding : 'utf8');
      const written = sync.writeSync(this.fd!, bytes, 0, bytes.length, this.position);
      if (this.position !== null) this.position += written;
      this.bytesWritten += written;
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.fd !== null) {
      try {
        sync.closeSync(this.fd);
      } catch {
        // Already closed.
      }
      this.fd = null;
    }
    callback(error);
  }

  close(callback?: (error?: Error | null) => void): void {
    if (callback) this.once('close', () => callback());
    this.end();
  }
}

export function createReadStream(path: PathLike, options?: ReadStreamOptions | BufferEncoding): ReadStream {
  return new ReadStream(path, typeof options === 'string' ? { encoding: options } : options);
}

export function createWriteStream(path: PathLike, options?: WriteStreamOptions | BufferEncoding): WriteStream {
  return new WriteStream(path, typeof options === 'string' ? { encoding: options } : options);
}
