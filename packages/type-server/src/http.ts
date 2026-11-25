/**
 * Small HTTP helpers on top of `node:http`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FrameDeniedReason } from '@open-artifact/protocol';

/** Media types by extension. */
export const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  mdx: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ts: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  ttc: 'font/collection',
  wasm: 'application/wasm',
};

/** Media type of a path. */
export function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

/** Extension for a media type (for stored blobs). */
export function extensionOf(contentType: string): string {
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  for (const [ext, type] of Object.entries(MIME)) if (type.split(';')[0] === base) return ext;
  return 'bin';
}

/** Error with an HTTP status and an API error code. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra fields merged into the JSON error body (e.g. conflict `paths`). */
  readonly extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    if (extra) this.extra = extra;
  }
}

/** Reads the request body, refusing more than `limit` bytes. */
export async function readBody(req: IncomingMessage, limit = 32 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'invalid', `Request body over ${Math.round(limit / 1024 / 1024)} MB.`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Reads a JSON body. */
export async function readJson<T>(req: IncomingMessage, limit?: number): Promise<T> {
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString('utf8') || '{}') as T;
  } catch {
    throw new HttpError(400, 'invalid', 'Body is not valid JSON.');
  }
}

/** Common security headers. */
const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

/** Sends JSON. */
export function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': MIME.json!, 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

/** Sends bytes or text. */
export function send(res: ServerResponse, status: number, body: string | Buffer, contentType: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': contentType, 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

/**
 * The byte span a `Range` header asks of a body `size` bytes long: `null`
 * when the whole body should go out (no header, a unit other than bytes,
 * several spans, or a malformed one), `'unsatisfiable'` when it starts past
 * the end. Media players need this to seek (Safari will not play a video
 * from a server that ignores it).
 */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    // `bytes=-N`: the last N bytes.
    const length = Number(match[2]);
    if (length === 0) return 'unsatisfiable';
    return size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size) return 'unsatisfiable';
  return end < start ? null : { start, end };
}

/**
 * Sends bytes, honouring a single-span `Range` request with 206 (or 416
 * past the end); every answer says ranges are accepted.
 */
export function sendBytes(req: IncomingMessage, res: ServerResponse, body: Buffer, contentType: string, headers: Record<string, string> = {}): void {
  // Node leaves the body out of a HEAD answer by itself.
  const ranged = { ...headers, 'accept-ranges': 'bytes' };
  const span = byteRange(req.headers.range, body.length);
  if (span === 'unsatisfiable') {
    res.writeHead(416, { ...BASE_HEADERS, ...ranged, 'content-range': `bytes */${body.length}` });
    res.end();
    return;
  }
  if (span === null) {
    send(res, 200, body, contentType, ranged);
    return;
  }
  const part = body.subarray(span.start, span.end + 1);
  send(res, 206, part, contentType, { ...ranged, 'content-range': `bytes ${span.start}-${span.end}/${body.length}` });
}

/** `cache-control` of a file whose name carries its content's hash: it never changes under that name. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** True for a built file named with its content hash, as Vite names them (`index-Ca_9xNA0.js`). */
export function isHashedName(path: string): boolean {
  return /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/.test(path.slice(path.lastIndexOf('/') + 1));
}

/** True when the request is a navigation inside a frame (`Sec-Fetch-Dest: iframe` or `frame`). */
export function isFramedNavigation(req: IncomingMessage): boolean {
  const dest = req.headers['sec-fetch-dest'];
  return (req.method === 'GET' || req.method === 'HEAD') && (dest === 'iframe' || dest === 'frame');
}

const escHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The page a frame gets when it cannot be shown: one line for whoever looks at it, and a script that tells the
 * Shell framing it (`frame_denied`, see `@open-artifact/protocol`'s `PageToShell`) so the Shell can open it again or
 * say why. The message carries no secret, so it goes to any parent. `ancestors` is who may frame it (a host: its app
 * origin); without it, anyone (no `frame-ancestors`: `*` would leave out an app whose page is `file://`).
 */
export function sendFrameDenied(res: ServerResponse, status: number, reason: FrameDeniedReason, title: string, message: string, ancestors?: string): void {
  const script = `parent.postMessage({ openArtifact: 'frame_denied', reason: ${JSON.stringify(reason)} }, '*');`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title></head><body><p>${escHtml(message)}</p><script>${script}</script></body></html>`;
  send(res, status, html, MIME.html!, { 'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'${ancestors ? `; frame-ancestors ${ancestors}` : ''}` });
}

/** Sends an error as `{code, message, …}`. */
export function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof HttpError) {
    sendJson(res, error.status, { code: error.code, message: error.message, ...(error.extra ?? {}) });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, 500, { code: 'unavailable', message });
}

/** True when the Host header names this machine (blocks DNS-rebinding pages). */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name.endsWith('.localhost');
}
