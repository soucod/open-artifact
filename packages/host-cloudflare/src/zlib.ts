/**
 * `node:zlib` for the Workers bundle (`deploy/cloudflare/build.mjs` points the type server's imports here): workerd's
 * own, with `inflateRaw` and `inflateRawSync` taking `maxOutputLength` as Node does.
 *
 * workerd (wrangler 4.166) checks `maxOutputLength` against the size of the buffer it grows as it unpacks, not against
 * the bytes unpacked: a 52457-byte file refuses with "Memory limit exceeded" at a limit of 52458, and at 65536. The
 * buffer at most doubles past what it holds, so the limit is handed on as twice the asked one plus a 64 KiB margin,
 * and the answer is checked against the asked limit here: past it is the same `RangeError` Node throws. What an entry
 * can take while it unpacks stays bounded (about twice its cap).
 */
import * as zlib from 'node:zlib';
import type { InputType, ZlibOptions } from 'node:zlib';

export * from 'node:zlib';

const MARGIN = 64 * 1024;

/** The limit to hand workerd for an asked one (none stays none). */
function widened(options: ZlibOptions | undefined): ZlibOptions | undefined {
  const asked = options?.maxOutputLength;
  return asked === undefined ? options : { ...options, maxOutputLength: 2 * asked + MARGIN };
}

function checked(result: Buffer, options: ZlibOptions | undefined): Buffer {
  const asked = options?.maxOutputLength;
  if (asked !== undefined && result.length > asked) throw new RangeError('Memory limit exceeded');
  return result;
}

/** {@link zlib.inflateRawSync}, its `maxOutputLength` counting the bytes unpacked. */
export function inflateRawSync(buffer: InputType, options?: ZlibOptions): Buffer {
  return checked(zlib.inflateRawSync(buffer, widened(options)), options);
}

type Callback = (error: Error | null, result: Buffer) => void;

/** {@link zlib.inflateRaw}, its `maxOutputLength` counting the bytes unpacked. */
export function inflateRaw(buffer: InputType, options: ZlibOptions | Callback, callback?: Callback): void {
  const done = (typeof options === 'function' ? options : callback) as Callback;
  const asked = typeof options === 'function' ? undefined : options;
  zlib.inflateRaw(buffer, widened(asked) ?? {}, (error, result) => {
    if (error) return done(error, result);
    try {
      done(null, checked(result, asked));
    } catch (refused) {
      done(refused as Error, Buffer.alloc(0));
    }
  });
}

export default { ...zlib, inflateRaw, inflateRawSync };
