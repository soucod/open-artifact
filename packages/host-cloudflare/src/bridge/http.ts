/**
 * A Fetch `Request` as the `IncomingMessage`/`ServerResponse` pair the type server's `handle(req, res)` takes, and the
 * `Response` it writes.
 *
 * What the type server and `server-sdk` touch, and so what this offers: on the request `method`, `url`, `headers`
 * (lower-case, repeated ones joined), `rawHeaders`, `socket.remoteAddress`, the body as a `Readable` (async iteration,
 * `on('data')`, `resume()`, `pipe`), `destroy()`, and `close`; on the response `statusCode`, `writeHead`,
 * `setHeader`/`getHeader`/`getHeaders`/`hasHeader`/`removeHeader`, `flushHeaders`, `headersSent`, `write` (with
 * backpressure: `false` and then `drain`), `end`, `destroy`, `destroyed`, `writableFinished`, and the events `finish`
 * and `close`.
 *
 * A response ended at once (most of them: JSON, pages, files) becomes a `Response` with its bytes; one that keeps
 * writing (an event stream, an archive) streams. The client leaving reaches the server as Node reports it — `close` on
 * the response and the request, `destroyed` set — from two signals: the stream's cancellation (seen at the next write)
 * and the request's abort signal (seen at once where the platform raises it: workerd's `enable_request_signal`
 * compatibility flag). Under `wrangler dev` the signal of a request forwarded to a Durable Object aborts only when its
 * response stream is cancelled, i.e. at a write, so an event stream that has nothing to send is written an SSE comment
 * after {@link HEARTBEAT_MS} of quiet: a page that left is noticed within about that long either way.
 */
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable, Writable } from 'node:stream';

/** Statuses that carry no body. */
const NO_BODY = new Set([101, 204, 205, 304]);
/** Bytes a response may hold before it starts streaming. */
const BUFFER_LIMIT = 64 * 1024;
/** The stream's queue before `write()` answers `false`. */
const HIGH_WATER = 64 * 1024;

export interface BridgeOptions {
  /** The address the type server sees (`req.socket.remoteAddress`). Default: a documentation address (not loopback). */
  remoteAddress?: string;
  /** Replaces or adds request headers the type server sees (e.g. `host`, `authorization` for internal routes). */
  headers?: Record<string, string>;
  /**
   * An event stream idle this long gets an SSE comment line (`:`), ms; 0 never. Default {@link HEARTBEAT_MS}. A write
   * is what tells the platform the client left when the abort signal does not (see the module comment).
   */
  heartbeatMs?: number;
}

/** How often an idle event stream is written to, so a page that left is noticed (the type server's own is 25 s). */
export const HEARTBEAT_MS = 1000;
const HEARTBEAT = new TextEncoder().encode(':\n\n');

export interface Bridged {
  req: IncomingMessage;
  res: ServerResponse;
  /** The response, once the server sent its head (at the first write, `flushHeaders`, or `end`). */
  response: Promise<Response>;
  /** Resolves when the exchange is over (finished or the client left): the type server's `close` has run. */
  closed: Promise<void>;
}

type HeaderValue = string | number | readonly string[];

export function bridgeRequest(request: Request, options: BridgeOptions = {}): Bridged {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  const rawHeaders: string[] = [];
  for (const [name, value] of request.headers) {
    headers[name] = name in headers ? `${headers[name]}${name === 'cookie' ? '; ' : ', '}${value}` : value;
    rawHeaders.push(name, value);
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers[name.toLowerCase()] = value;
    rawHeaders.push(name, value);
  }

  const reader = request.body ? request.body.getReader() : null;
  // `close` on the request is emitted below, once, when the exchange ends (as Node does), not when the body ends.
  const req = new Readable({
    emitClose: false,
    read() {
      if (!reader) {
        this.push(null);
        return;
      }
      reader.read().then(
        ({ done, value }) => {
          if (done) {
            (req as unknown as { complete: boolean }).complete = true;
            this.push(null);
          } else this.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        },
        (error: Error) => this.destroy(error),
      );
    },
    destroy(error, callback) {
      reader?.cancel().catch(() => undefined);
      callback(error);
    },
  });
  const socket = {
    remoteAddress: options.remoteAddress ?? '192.0.2.1',
    remotePort: 0,
    remoteFamily: 'IPv4',
    localAddress: '127.0.0.1',
    localPort: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    encrypted: url.protocol === 'https:',
    destroyed: false,
    destroy: () => res.destroy(),
    setTimeout: () => socket,
    setNoDelay: () => socket,
    setKeepAlive: () => socket,
    on: () => socket,
    once: () => socket,
    off: () => socket,
    removeListener: () => socket,
  };
  Object.assign(req, {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    rawHeaders,
    trailers: {},
    rawTrailers: [],
    httpVersion: '1.1',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    socket,
    connection: socket,
    aborted: false,
    complete: !reader,
    setTimeout: () => req,
  });

  let settle!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => (settle = resolve));
  let closedResolve!: () => void;
  const closed = new Promise<void>((resolve) => (closedResolve = resolve));

  const outHeaders = new Map<string, [string, HeaderValue]>();
  /** Writes made before the head went out, sent with it. */
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  /** The write waiting for the reader to want more (backpressure). */
  let waiting: ((error?: Error | null) => void) | null = null;
  let cancelled = false;
  let headersSent = false;
  /** Whether the bytes sent so far end between two events (where a comment line may go), and when they were sent. */
  let atBoundary = true;
  let lastByte = 10;
  let lastWrite = Date.now();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;

  const headOf = (): Headers => {
    const out = new Headers();
    for (const [name, value] of outHeaders.values()) {
      for (const one of Array.isArray(value) ? value : [value]) out.append(name, String(one));
    }
    return out;
  };
  const noBody = (): boolean => NO_BODY.has(res.statusCode) || request.method === 'HEAD';

  /** Sends the head with everything written so far as the whole body. */
  const sendWhole = (): void => {
    if (headersSent) return;
    headersSent = true;
    clearFlush();
    let body: Uint8Array | null = null;
    if (!noBody()) body = pending.length === 1 ? pending[0]! : concat(pending, pendingBytes);
    pending = [];
    settle(new Response(body as BodyInit | null, { status: res.statusCode, statusText: res.statusMessage || undefined, headers: headOf() }));
  };

  /** Sends the head and starts streaming (what was written so far goes first). */
  const startStreaming = (): void => {
    if (headersSent) return;
    headersSent = true;
    clearFlush();
    if (noBody()) {
      pending = [];
      settle(new Response(null, { status: res.statusCode, headers: headOf() }));
      return;
    }
    const first = pending;
    pending = [];
    const body = new ReadableStream<Uint8Array>(
      {
        start(c) {
          controller = c;
          for (const chunk of first) c.enqueue(chunk);
          if (first.length) noteWrite(first[first.length - 1]!);
        },
        pull() {
          const next = waiting;
          waiting = null;
          next?.();
        },
        cancel() {
          gone();
        },
      },
      { highWaterMark: HIGH_WATER, size: (chunk) => chunk.byteLength },
    );
    settle(new Response(body, { status: res.statusCode, statusText: res.statusMessage || undefined, headers: headOf() }));
    if (heartbeatMs > 0 && /^text\/event-stream/i.test(String(res.getHeader('content-type') ?? ''))) {
      heartbeat = setInterval(() => {
        if (!controller || cancelled || !atBoundary || Date.now() - lastWrite < heartbeatMs / 2) return;
        try {
          controller.enqueue(HEARTBEAT);
          lastWrite = Date.now();
        } catch {
          stopHeartbeat();
        }
      }, heartbeatMs);
    }
  };

  const stopHeartbeat = (): void => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  /** Remembers the last write: when, and whether it ended an event (a blank line). */
  const noteWrite = (bytes: Uint8Array): void => {
    lastWrite = Date.now();
    const n = bytes.byteLength;
    if (n === 0) return;
    const before = n >= 2 ? bytes[n - 2] : lastByte;
    lastByte = bytes[n - 1]!;
    atBoundary = lastByte === 10 && before === 10;
  };

  const clearFlush = (): void => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
  };

  /** The client left: fail the waiting write, destroy the response (Node's `close` on both follows). */
  const gone = (): void => {
    if (cancelled) return;
    cancelled = true;
    (req as unknown as { aborted: boolean }).aborted = !res.writableFinished;
    const next = waiting;
    waiting = null;
    next?.(new Error('The connection closed.'));
    if (!res.destroyed) res.destroy();
  };

  const res = new Writable({
    highWaterMark: HIGH_WATER,
    write(chunk: Buffer, _encoding, callback) {
      if (cancelled) return callback(new Error('The connection closed.'));
      const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      if (!headersSent) {
        pending.push(bytes);
        pendingBytes += bytes.byteLength;
        // Ended at once: one Response with the bytes. Still writing a moment later, or a lot: stream.
        if (pendingBytes > BUFFER_LIMIT) startStreaming();
        else flushTimer ??= setTimeout(startStreaming, 0);
        return callback();
      }
      if (!controller) return callback(); // A body-less response: writes go nowhere.
      try {
        controller.enqueue(bytes);
        noteWrite(bytes);
      } catch (error) {
        return callback(error as Error);
      }
      if ((controller.desiredSize ?? 1) > 0) return callback();
      waiting = callback;
    },
    final(callback) {
      if (!headersSent) sendWhole();
      else {
        try {
          controller?.close();
        } catch {
          // Already closed by the reader.
        }
      }
      callback();
    },
    destroy(error, callback) {
      clearFlush();
      if (!headersSent) {
        headersSent = true;
        settle(new Response(null, { status: cancelled ? 499 : 502 }));
      } else if (controller && !cancelled) {
        try {
          controller.error(error ?? new Error('The response was destroyed.'));
        } catch {
          // Already errored.
        }
      }
      callback(error);
    },
  }) as unknown as ServerResponse & Writable;

  Object.defineProperty(res, 'headersSent', { get: () => headersSent });
  Object.assign(res, {
    statusCode: 200,
    statusMessage: '',
    sendDate: false,
    req,
    socket,
    connection: socket,
    setHeader(name: string, value: HeaderValue) {
      outHeaders.set(name.toLowerCase(), [name, value]);
      return res;
    },
    appendHeader(name: string, value: HeaderValue) {
      const had = outHeaders.get(name.toLowerCase())?.[1];
      const list = [...(had === undefined ? [] : Array.isArray(had) ? had : [String(had)]), ...(Array.isArray(value) ? value : [String(value)])];
      outHeaders.set(name.toLowerCase(), [name, list]);
      return res;
    },
    getHeader: (name: string) => outHeaders.get(name.toLowerCase())?.[1],
    getHeaders: () => Object.fromEntries([...outHeaders.entries()].map(([key, [, value]]) => [key, value])),
    getHeaderNames: () => [...outHeaders.keys()],
    hasHeader: (name: string) => outHeaders.has(name.toLowerCase()),
    removeHeader: (name: string) => void outHeaders.delete(name.toLowerCase()),
    flushHeaders: () => startStreaming(),
    setTimeout: () => res,
    writeHead(status: number, ...rest: unknown[]) {
      res.statusCode = status;
      if (typeof rest[0] === 'string') res.statusMessage = rest[0];
      const last = rest[rest.length - 1];
      if (Array.isArray(last)) {
        for (let i = 0; i + 1 < last.length; i += 2) res.setHeader(String(last[i]), last[i + 1] as HeaderValue);
      } else if (last && typeof last === 'object') {
        for (const [name, value] of Object.entries(last as Record<string, HeaderValue | undefined>)) if (value !== undefined) res.setHeader(name, value);
      }
      return res;
    },
    writeContinue: () => undefined,
    writeEarlyHints: () => undefined,
  });

  // Node emits `close` on the request as well when the exchange ends (finished, or the client went away).
  let over = false;
  res.on('close', () => {
    if (over) return;
    over = true;
    clearFlush();
    stopHeartbeat();
    socket.destroyed = true;
    if (!req.destroyed) req.emit('close');
    closedResolve();
  });
  const signal = request.signal as AbortSignal | undefined;
  if (signal) {
    if (signal.aborted) queueMicrotask(gone);
    else signal.addEventListener('abort', gone, { once: true });
  }
  return { req: req as unknown as IncomingMessage, res, response, closed };
}

function concat(parts: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}
