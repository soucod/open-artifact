/**
 * `_api/downloads`: a file the page hands the host, saved in the downloads
 * folder under a name of its own. The body streams to a hidden file beside
 * the target and is renamed once whole, so a large export never sits in
 * memory and a cut-off one leaves nothing behind.
 */

import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './http.ts';

/** Largest file handed to the host, bytes. */
export const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

const tooLarge = (limit: number): HttpError => new HttpError(413, 'invalid', `Download over ${Math.round(limit / 1024 / 1024)} MB.`);

/** A saved name's stem keeps this many code points at most. */
const MAX_NAME_CODE_POINTS = 120;
/**
 * Most file systems take a name of 255 bytes at most; a saved name leaves room for what the partial file adds
 * (`.` and `.xxxxxxxx.part`) and for a ` (n)` that makes it unique.
 */
const MAX_NAME_BYTES = 230;

/**
 * The name the page asked for, made safe for any file system: its stem cut by whole code points, to 120 and to what
 * fits in {@link MAX_NAME_BYTES} beside the extension, which is kept.
 */
export function downloadName(asked: string | null): string {
  const name = basename(asked ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const found = extname(name);
  const extension = found.length <= 16 ? found : '';
  const stem = Array.from(name.slice(0, name.length - extension.length)).slice(0, MAX_NAME_CODE_POINTS);
  while (stem.length > 0 && Buffer.byteLength(stem.join('') + extension) > MAX_NAME_BYTES) stem.pop();
  const kept = stem.join('');
  return kept === '' ? (extension === '' ? 'download' : 'download' + extension) : kept + extension;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** `name` in `dir`, or `stem (2).ext`, `stem (3).ext`… when it is taken. */
async function freeTarget(dir: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let target = join(dir, name);
  for (let n = 2; await exists(target); n++) target = join(dir, `${stem} (${n})${ext}`);
  return target;
}

/** Streams the request body into `dir` as `name` (made unique); where it was saved. Refuses more than `limit` bytes. */
export async function saveDownload(req: IncomingMessage, dir: string, name: string, limit = MAX_DOWNLOAD_BYTES): Promise<string> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw tooLarge(limit);
  }
  await mkdir(dir, { recursive: true });
  const partial = join(dir, `.${name}.${randomBytes(4).toString('hex')}.part`);
  let size = 0;
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      done(size > limit ? tooLarge(limit) : null, chunk);
    },
  });
  try {
    await pipeline(req, counted, createWriteStream(partial, { flags: 'wx' }));
    const target = await freeTarget(dir, name);
    await rename(partial, target);
    return target;
  } catch (error) {
    await rm(partial, { force: true });
    if (size > limit) req.resume();
    throw error;
  }
}
