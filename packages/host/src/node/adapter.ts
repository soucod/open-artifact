/**
 * Node `http` ↔ Fetch: turns an `IncomingMessage` into a `Request` and
 * writes a `Response` to a `ServerResponse`, streaming bodies both ways.
 *
 * - A request body larger than the cap fails with `too_large` (413): at once
 *   when `Content-Length` says so, else when the stream passes the cap.
 * - Each `Set-Cookie` of a response is sent as its own header.
 * - A client that goes away cancels the response body.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { OpenArtifactError } from '@open-artifact/protocol';
import { errorResponse, httpError, type BaseCtx, type Handler } from '../core/http.ts';

/** Default request body cap: 25 MiB (the type server's upload limit). */
export const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;

const BODILESS = new Set(['GET', 'HEAD']);

/**
 * A Fetch `Request` for a Node request. `origin` is the scheme and host the
 * URL is built on (e.g. `https://app.example`); the path and query come
 * from `req.url`.
 */
export function toRequest(req: IncomingMessage, origin: string, options: { maxBodyBytes?: number; signal?: AbortSignal } = {}): Request {
  const maxBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const headers = new Headers();
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i]!;
    // HTTP/2 pseudo headers are not headers.
    if (name.startsWith(':')) continue;
    headers.append(name, raw[i + 1]!);
  }
  const method = (req.method ?? 'GET').toUpperCase();
  let url: URL;
  try {
    url = new URL(req.url ?? '/', origin);
  } catch {
    // A Host header (the origin's host) that cannot form a URL: the client's mistake, not the host's.
    throw httpError('invalid_argument', 'The request has no valid Host header.', { status: 400 });
  }
  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (options.signal) init.signal = options.signal;
  if (!BODILESS.has(method)) {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
    init.body = bodyStream(req, maxBytes);
    init.duplex = 'half';
  }
  return new Request(url, init);
}

function tooLarge(maxBytes: number): OpenArtifactError {
  return httpError('too_large', `The request body is larger than ${maxBytes} bytes.`);
}

/** The request body as a web stream that errors with `too_large` past `maxBytes`. */
function bodyStream(req: IncomingMessage, maxBytes: number): ReadableStream<Uint8Array> {
  let size = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      req.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > maxBytes) {
          controller.error(tooLarge(maxBytes));
          req.pause();
          return;
        }
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        if ((controller.desiredSize ?? 1) <= 0) req.pause();
      });
      req.on('end', () => {
        try {
          controller.close();
        } catch {
          // Already errored.
        }
      });
      req.on('error', (error) => {
        try {
          controller.error(error);
        } catch {
          // Already closed.
        }
      });
    },
    pull() {
      if (size <= maxBytes) req.resume();
    },
    cancel() {
      req.resume();
    },
  });
}

/** Writes a Fetch `Response` to a Node response, streaming its body (none for `HEAD`). */
export async function sendResponse(res: ServerResponse, response: Response, options: { head?: boolean } = {}): Promise<void> {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);

  if (!response.body || options.head) {
    await response.body?.cancel().catch(() => undefined);
    res.end();
    return;
  }
  const reader = response.body.getReader();
  const onClose = (): void => {
    if (!res.writableFinished) void reader.cancel().catch(() => undefined);
  };
  res.on('close', onClose);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.destroyed) break;
      if (!res.write(value)) await new Promise<void>((resolve) => {
        const done = (): void => {
          res.off('drain', done);
          res.off('close', done);
          resolve();
        };
        res.on('drain', done);
        res.on('close', done);
      });
    }
    res.end();
  } catch {
    // The body failed mid-stream: the status is sent, so all that is left is to cut the connection.
    res.destroy();
  } finally {
    res.off('close', onClose);
  }
}

export interface NodeHandlerOptions {
  /** The origin a request's URL is built on (default `http://<Host header>`). */
  origin?: (req: IncomingMessage) => string;
  /** Request body cap in bytes (default {@link DEFAULT_MAX_BODY_BYTES}), or the cap of each request (by its path). */
  maxBodyBytes?: number | ((req: IncomingMessage) => number);
  /** Where errors outside the handler go (default `console.error`). */
  log?: (line: string) => void;
}

/**
 * A Node `(req, res)` listener that runs a core handler: builds the
 * `Request`, asks `ctxFor` for the context, sends the `Response`. Errors
 * become JSON error answers; a client that disconnects aborts `request.signal`.
 */
export function nodeHandler<C extends BaseCtx>(
  handler: Handler<C>,
  ctxFor: (req: IncomingMessage) => C | Promise<C>,
  options: NodeHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  const log = options.log ?? ((line: string) => console.error(line));
  const originOf = options.origin ?? ((req: IncomingMessage) => `http://${req.headers.host ?? 'localhost'}`);
  return (req, res) => {
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    void (async () => {
      let response: Response;
      try {
        const cap = typeof options.maxBodyBytes === 'function' ? options.maxBodyBytes(req) : options.maxBodyBytes;
        const request = toRequest(req, originOf(req), { ...(cap !== undefined ? { maxBodyBytes: cap } : {}), signal: abort.signal });
        const ctx = await ctxFor(req);
        try {
          response = await handler(request, ctx);
        } catch (error) {
          response = errorResponse(error, ctx.log);
        }
      } catch (error) {
        response = errorResponse(error, log);
      }
      if (response.status === 413) res.setHeader('connection', 'close');
      await sendResponse(res, response, { head: (req.method ?? '').toUpperCase() === 'HEAD' });
    })().catch((error: unknown) => {
      log(`host: failed to answer ${req.method} ${req.url}: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  };
}
