/**
 * HTTP on Fetch `Request`/`Response`: the handler shape, a small router, JSON
 * and error answers, cookies, and the same-origin check for writes.
 *
 * Errors answer with the protocol's flat body `{ code, message, fix? }` (what
 * the daemon sends and the Shell's `answerOf` reads), with the same status
 * for each code as the daemon.
 */

import { OpenArtifactError, errorBody, type OpenArtifactErrorCode } from '@open-artifact/protocol';
import type { Catalog } from './catalog/catalog.ts';
import type { Plugins } from './plugins/registry.ts';
import type { HostConfig } from './types.ts';

// ---------------------------------------------------------------------------
// Handlers and context

/**
 * What every handler gets besides the request. Later packages extend it by
 * intersection rather than by casting, e.g.
 * `type AuthedCtx = Ctx<{ principal: Principal }>` and `Handler<AuthedCtx>`.
 */
export interface BaseCtx {
  config: HostConfig;
  catalog: Catalog;
  /** The clock (tests pass a fixed one). */
  now(): Date;
  /** One line to the host's log. */
  log(line: string): void;
  /** The site's plugins; absent when it runs none (every plugin call site is then skipped). */
  plugins?: Plugins;
  /** Keeps background work alive past the response (a Worker request's `waitUntil`); absent on Node. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** {@link BaseCtx} plus whatever a layer adds (the principal, platform services…). */
export type Ctx<Extra extends object = Record<never, never>> = BaseCtx & Extra;

/** A request handler. */
export type Handler<C extends BaseCtx = BaseCtx> = (request: Request, ctx: C) => Promise<Response>;

/** A route's handler: the context also carries the path parameters. */
export type RouteHandler<C extends BaseCtx = BaseCtx> = (request: Request, ctx: C & { params: Record<string, string> }) => Promise<Response>;

// ---------------------------------------------------------------------------
// Errors

/** Throws-ready protocol error with an HTTP status. */
export function httpError(code: OpenArtifactErrorCode, message: string, options: { status?: number; fix?: string; current?: unknown } = {}): OpenArtifactError {
  return new OpenArtifactError(code, message, options);
}

/** HTTP status of a failure: its own `status`, else by code (the daemon's mapping), else 400. */
export function statusOf(error: unknown): number {
  if (error instanceof OpenArtifactError && error.status) return error.status;
  switch (errorBody(error).code) {
    case 'not_found':
    case 'unknown_session':
      return 404;
    case 'unauthorized':
      return 401;
    case 'not_granted':
      return 403;
    case 'unsupported':
    case 'conflict':
      return 409;
    case 'too_large':
      return 413;
    case 'rate_limited':
      return 429;
    case 'server_failed':
      return 502;
    default:
      return 400;
  }
}

/**
 * A failure as a JSON answer. A protocol error answers with its own body and
 * status; anything else is a bug: 500 with a generic message (the details go
 * to `log` when given, never to the client).
 */
export function errorResponse(error: unknown, log?: (line: string) => void): Response {
  if (error instanceof OpenArtifactError) return json(error.toJSON(), { status: statusOf(error) });
  log?.(`error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return json({ code: 'error', message: 'The host failed to answer this request.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// JSON

/** A JSON answer (`no-store` unless the caller sets `cache-control`). */
export function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(value), { ...init, headers });
}

/** Default cap on a request body read by {@link readBody}/{@link readJson}: 1 MiB. */
export const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;

/** The whole body, refusing more than `maxBytes` with `too_large`. */
export async function readBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await reader.read();
    } catch (error) {
      if (error instanceof OpenArtifactError) throw error;
      throw httpError('invalid_argument', 'The request body could not be read.');
    }
    if (step.done) break;
    size += step.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(maxBytes);
    }
    chunks.push(step.value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** The body as JSON (`invalid_argument` when it is not; `too_large` past `maxBytes`). */
export async function readJson<T = unknown>(request: Request, maxBytes = DEFAULT_MAX_JSON_BYTES): Promise<T> {
  const bytes = await readBody(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw httpError('invalid_argument', 'The request body is not JSON.', { fix: 'Send a JSON body with Content-Type: application/json.' });
  }
}

function tooLarge(maxBytes: number): OpenArtifactError {
  return httpError('too_large', `The request body is larger than ${maxBytes} bytes.`);
}

// ---------------------------------------------------------------------------
// Router

interface Route<C extends BaseCtx> {
  method: string;
  segments: string[];
  handler: RouteHandler<C>;
}

/**
 * Method + path routing; the first matching route wins.
 *
 * A pattern is a path of segments: a literal (`/api/open-artifact.artifacts`),
 * `:name` (one segment, URL-decoded into `params.name`), or a final `*` (the
 * rest of the path, possibly empty, in `params['*']`). `HEAD` falls back to
 * `GET` routes. No matching path → 404 `not_found`; a matching path with
 * another method → 405 with `Allow`. Thrown errors become {@link errorResponse}s.
 */
export class Router<C extends BaseCtx = BaseCtx> {
  readonly #routes: Route<C>[] = [];

  /** Adds a route. `method` is upper case, or `*` for any. */
  on(method: string, pattern: string, handler: RouteHandler<C>): this {
    const segments = splitPath(pattern);
    const star = segments.indexOf('*');
    if (star !== -1 && star !== segments.length - 1) throw new TypeError(`A '*' must end the pattern: ${pattern}`);
    this.#routes.push({ method: method.toUpperCase(), segments, handler });
    return this;
  }

  get(pattern: string, handler: RouteHandler<C>): this {
    return this.on('GET', pattern, handler);
  }

  post(pattern: string, handler: RouteHandler<C>): this {
    return this.on('POST', pattern, handler);
  }

  put(pattern: string, handler: RouteHandler<C>): this {
    return this.on('PUT', pattern, handler);
  }

  delete(pattern: string, handler: RouteHandler<C>): this {
    return this.on('DELETE', pattern, handler);
  }

  /** Every route as registered, in order: its method and pattern (for tests that walk them all). */
  routes(): Array<{ method: string; pattern: string }> {
    return this.#routes.map((route) => ({ method: route.method, pattern: `/${route.segments.join('/')}` }));
  }

  /** The route for a method and path, with its parameters, or why there is none. */
  match(method: string, pathname: string): { handler: RouteHandler<C>; params: Record<string, string> } | { allow: string[] } | null {
    const path = splitPath(pathname);
    const allow = new Set<string>();
    let getMatch: { handler: RouteHandler<C>; params: Record<string, string> } | null = null;
    const wanted = method.toUpperCase();
    for (const route of this.#routes) {
      const params = matchSegments(route.segments, path);
      if (!params) continue;
      if (route.method === '*' || route.method === wanted) return { handler: route.handler, params };
      if (wanted === 'HEAD' && route.method === 'GET' && !getMatch) getMatch = { handler: route.handler, params };
      allow.add(route.method);
    }
    if (getMatch) return getMatch;
    return allow.size > 0 ? { allow: [...allow] } : null;
  }

  /** Answers a request (never throws). */
  readonly handle: Handler<C> = async (request, ctx) => {
    const { pathname } = new URL(request.url);
    const found = this.match(request.method, pathname);
    if (!found) return errorResponse(httpError('not_found', `No route for ${request.method} ${pathname}.`), ctx.log);
    if ('allow' in found) {
      const response = errorResponse(httpError('method_not_found', `${request.method} is not allowed on ${pathname}.`, { status: 405 }), ctx.log);
      response.headers.set('allow', found.allow.join(', '));
      return response;
    }
    try {
      return await found.handler(request, { ...ctx, params: found.params });
    } catch (error) {
      return errorResponse(error, ctx.log);
    }
  };
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

function matchSegments(pattern: string[], path: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i]!;
    if (want === '*') {
      params['*'] = path.slice(i).join('/');
      return params;
    }
    const got = path[i];
    if (got === undefined) return null;
    if (want.startsWith(':')) {
      try {
        params[want.slice(1)] = decodeURIComponent(got);
      } catch {
        return null;
      }
    } else if (want !== got) {
      return null;
    }
  }
  return path.length === pattern.length ? params : null;
}

// ---------------------------------------------------------------------------
// Cookies

/** The cookies of a `Cookie` header (the first of a repeated name wins; values URL-decoded when they decode). */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Every cookie of a `Cookie` header in order, repeats kept (raw values). A browser sends a name twice when two cookies
 * of that name match the request: one the host set and one with a `Domain` or `Path` of someone else's choosing
 * (cookie tossing from a sibling host). {@link parseCookies} keeps the first, which is the one with the longer path.
 */
export function cookieList(header: string | null | undefined): Array<[name: string, value: string]> {
  const out: Array<[string, string]> = [];
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name) out.push([name, part.slice(eq + 1).trim()]);
  }
  return out;
}

export interface CookieOptions {
  /** Seconds; 0 deletes the cookie. */
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** A `Set-Cookie` value. The value is URL-encoded. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!COOKIE_NAME.test(name)) throw new TypeError(`Not a cookie name: ${name}`);
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.secure) parts.push('Secure');
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

/**
 * The session cookie's name and attributes (decision 11): `__Host-oa_session`
 * with `Secure` when the app origin is https, `oa_session` without when it is
 * http (development). Always `HttpOnly; SameSite=Lax; Path=/`, no `Domain`.
 */
export function sessionCookie(config: Pick<HostConfig, 'appOrigin'>): { name: string; options: CookieOptions } {
  const secure = config.appOrigin.startsWith('https:');
  return { name: secure ? '__Host-oa_session' : 'oa_session', options: { path: '/', secure, httpOnly: true, sameSite: 'Lax' } };
}

// ---------------------------------------------------------------------------
// Same-origin writes

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Whether a write may change something on the app origin (decision 22). Reads
 * (`GET`/`HEAD`/`OPTIONS`) always may.
 *
 * - With `Sec-Fetch-Site` (every current browser sends it): `same-origin`
 *   passes; `none` (typed into the address bar, or a tool that sets it) passes
 *   only without cookies, so it cannot ride on a session; `same-site` (a
 *   content host under the same parent domain) and `cross-site` are refused.
 *   `Origin` is not consulted then: a form posted from a page under
 *   `Referrer-Policy: no-referrer` carries `Origin: null` though it is the
 *   app's own.
 * - Without it (non-browser clients such as the Link daemon with a Bearer
 *   token, old browsers): `Origin` must be absent or the app origin;
 *   `Origin: null` is refused.
 */
export function isSameOriginWrite(request: Request, config: Pick<HostConfig, 'appOrigin'>): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) {
    const value = site.trim().toLowerCase();
    if (value === 'same-origin') return true;
    return value === 'none' && !request.headers.has('cookie');
  }
  const origin = request.headers.get('origin');
  return origin === null || origin === config.appOrigin;
}

/**
 * Whether a `GET` that changes something (joining by a share link, finishing a sign-in) comes from a top-level
 * navigation the person can see: `Sec-Fetch-Dest: document` and `Sec-Fetch-Mode: navigate`. An `<img>`, a `fetch`, a
 * frame or a prefetch are not. A request without Fetch Metadata (an old browser, a test client) passes: the headers
 * are what tells them apart, and every current browser sends them.
 */
export function isTopLevelNavigation(request: Request): boolean {
  const dest = request.headers.get('sec-fetch-dest');
  const mode = request.headers.get('sec-fetch-mode');
  if (dest === null && mode === null) return true;
  return dest?.trim().toLowerCase() === 'document' && mode?.trim().toLowerCase() === 'navigate';
}

/** The request's `Sec-Fetch-Site` (`same-origin`, `same-site`, `cross-site`, `none`), lower case, or null without one. */
export function fetchSite(request: Request): string | null {
  return request.headers.get('sec-fetch-site')?.trim().toLowerCase() ?? null;
}

/** Refuses a write {@link isSameOriginWrite} does not allow (`not_granted`, 403). */
export function assertSameOrigin(request: Request, config: Pick<HostConfig, 'appOrigin'>): void {
  if (!isSameOriginWrite(request, config)) throw crossSite();
}

function crossSite(): OpenArtifactError {
  return httpError('not_granted', 'Cross-site requests may not change anything here.', { status: 403 });
}
