/**
 * The app origin's security headers, and the Shell and home pages with their boot objects inlined under a CSP that
 * allows exactly their inline scripts (by hash), the artifact's content origin in a frame and nothing from elsewhere.
 */

import { scriptHash } from '../auth/pages.ts';
import { flowCookie } from '../auth/flow.ts';
import { cookieList, serializeCookie, sessionCookie, type BaseCtx, type Handler } from '../http.ts';
import type { HostConfig } from '../types.ts';
import { contentOriginOf } from '../page-token.ts';

/** The CSP of an answer that is not a page (JSON, files, redirects): nothing loads, nothing frames it. */
export const PLAIN_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/** The Referrer-Policy of the app origin: the Shell's path never leaves it. */
export const APP_REFERRER_POLICY = 'same-origin';

/**
 * The Cross-Origin-Opener-Policy of the Shell and home pages: a window another origin opens, or that opens them, gets
 * no reference to them (`same-origin` would also cut the Shell from the popups its editors open, such as Docs' print
 * window). Only these pages carry it: the sign-in and MCP authorization pages may be opened in a popup by an agent's
 * web client that waits on its window, which a COOP would cut. Sent on a potentially trustworthy app origin only
 * ({@link isPotentiallyTrustworthyOrigin}): elsewhere a browser ignores it, with a console error.
 */
export const APP_OPENER_POLICY = 'same-origin-allow-popups';

/**
 * Whether a browser treats `origin` as potentially trustworthy (W3C Secure Contexts, as Chrome implements it): https,
 * or http on `localhost`, a `*.localhost` name, `127.0.0.0/8` or `[::1]`. Only there do `Cross-Origin-Opener-Policy`
 * and `Origin-Agent-Cluster` take effect; on any other http origin (a LAN name such as `http://nas.lan:4900`, a nip.io
 * name, a private address) Chrome ignores both and says so in the console (COOP as an error, OAC as a warning), so the
 * hosts send them only where they work. `Cross-Origin-Resource-Policy` works on any origin and is always sent.
 * `origin` may be an artifact content origin template: `{id}` stands for a label.
 */
export function isPotentiallyTrustworthyOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin.replace('{id}', 'id'));
  } catch {
    return false;
  }
  if (url.protocol === 'https:' || url.protocol === 'wss:') return true;
  if (url.protocol !== 'http:' && url.protocol !== 'ws:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * The answer with the app origin's headers: `nosniff`, no framing (`frame-ancestors 'none'` in its CSP and
 * `X-Frame-Options: DENY`), the Referrer-Policy, a CSP that loads nothing when the handler set none,
 * `Cross-Origin-Resource-Policy: same-origin` (no other origin, a content host of the same site included, may load an
 * answer as an image, script or style; a plugin route may set its own) and, on a potentially trustworthy app origin
 * ({@link isPotentiallyTrustworthyOrigin}), `Origin-Agent-Cluster: ?1`.
 */
export function withAppHeaders(response: Response, config: Pick<HostConfig, 'appOrigin'>): Response {
  // Headers of a fetched answer (the archive) cannot be changed: copy the answer.
  const headers = new Headers(response.headers);
  if (!headers.has('content-security-policy')) headers.set('content-security-policy', PLAIN_CSP);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  if (!headers.has('referrer-policy')) headers.set('referrer-policy', APP_REFERRER_POLICY);
  if (!headers.has('cross-origin-resource-policy')) headers.set('cross-origin-resource-policy', 'same-origin');
  if (isPotentiallyTrustworthyOrigin(config.appOrigin)) headers.set('origin-agent-cluster', '?1');
  else headers.delete('origin-agent-cluster');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ---------------------------------------------------------------------------
// Duplicate cookies (cookie tossing)

/** The audit action of a request refused for carrying an app cookie twice. */
export const DUPLICATE_COOKIE_ACTION = 'auth.duplicate_cookie';

/** The names of the cookies the app origin reads: the session, the sign-in flow and every guest cookie. */
function isAppCookie(name: string, config: Pick<HostConfig, 'appOrigin'>): boolean {
  return name === sessionCookie(config).name || name === flowCookie(config).name || /^(?:__Host-)?oa_guest_/.test(name);
}

/** The parent domains of a host name a sibling host could set a cookie on (two labels or more; none for an IP). */
function parentDomains(host: string): string[] {
  if (/^[\d.]+$/.test(host) || host.includes(':')) return [];
  const labels = host.split('.');
  const out: string[] = [];
  for (let i = 1; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
  return out;
}

/** Every cookie path that matches `pathname` (each prefix, with and without its trailing slash; at most six levels). */
function pathPrefixes(pathname: string): string[] {
  const parts = pathname.split('/').filter(Boolean).slice(0, 6);
  const out = new Set<string>(['/']);
  let at = '';
  for (const part of parts) {
    at += `/${part}`;
    out.add(at);
    out.add(`${at}/`);
  }
  return [...out];
}

/**
 * The `Set-Cookie`s that delete `name` wherever a request to `url` could have got it from: on the host and, unless
 * the name is `__Host-` (which no other host can set), on each parent domain, at each path that matches the request.
 */
export function duplicateCookieClears(name: string, url: URL): string[] {
  const secure = url.protocol === 'https:';
  if (name.startsWith('__Host-')) return [serializeCookie(name, '', { path: '/', secure: true, httpOnly: true, sameSite: 'Lax', maxAge: 0 })];
  const out: string[] = [];
  for (const domain of [undefined, ...parentDomains(url.hostname)]) {
    for (const path of pathPrefixes(url.pathname)) {
      out.push(serializeCookie(name, '', { path, secure, httpOnly: true, sameSite: 'Lax', maxAge: 0, ...(domain ? { domain } : {}) }));
    }
  }
  return out;
}

/**
 * The app origin's guard against cookie tossing, in every mode. A browser sends a cookie name twice when a sibling
 * host under the same parent domain (an artifact's page, in same-site mode, or any other host of that domain) set one
 * with its own `Domain` or `Path`; the server cannot tell which is the person's. Such a request:
 *
 * - is handled without any of the repeated app cookies (the session, flow and guest cookies): it is not signed in by
 *   them;
 * - ends every session those values name (the person signs in again);
 * - gets `Set-Cookie`s that delete the name on the host and on each parent domain, at each matching path;
 * - is written to the audit log (`auth.duplicate_cookie`, with the names, never the values) and the host's log.
 *
 * A single tossed cookie (the person was signed out, so theirs is not there to collide with) is not detectable here:
 * `docs/hosting.md` ("One domain for both") says what that leaves.
 */
export function guardAppOrigin<C extends BaseCtx>(handler: Handler<C>): Handler<C> {
  return async (request, ctx) => {
    const list = cookieList(request.headers.get('cookie'));
    const counts = new Map<string, number>();
    for (const [name] of list) counts.set(name, (counts.get(name) ?? 0) + 1);
    const repeated = [...counts].filter(([name, count]) => count > 1 && isAppCookie(name, ctx.config)).map(([name]) => name);
    if (repeated.length === 0) return handler(request, ctx);

    const url = new URL(request.url);
    const session = sessionCookie(ctx.config).name;
    for (const [name, value] of list) {
      if (name !== session || !value) continue;
      let token = value;
      try {
        token = decodeURIComponent(value);
      } catch {
        // kept raw
      }
      const found = await ctx.catalog.findSession(token);
      if (found) await ctx.catalog.revokeSession(found.idHash);
    }
    await ctx.catalog.appendAudit({ actorKind: 'system', action: DUPLICATE_COOKIE_ACTION, detail: { names: repeated, path: url.pathname } });
    ctx.log(`refused duplicate cookies (${repeated.join(', ')}) on ${url.pathname}: another host of this domain set them`);

    const headers = new Headers(request.headers);
    const kept = list.filter(([name]) => !repeated.includes(name)).map(([name, value]) => `${name}=${value}`);
    if (kept.length > 0) headers.set('cookie', kept.join('; '));
    else headers.delete('cookie');
    const response = await handler(new Request(request, { headers }), ctx);
    if (response.status === 101) return response;
    const out = new Response(response.body, { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) });
    for (const name of repeated) for (const clear of duplicateCookieClears(name, url)) out.headers.append('set-cookie', clear);
    return out;
  };
}

/** JSON safe inside a `<script>`: no `</script>`, no line separators that end a JS string. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The page with `placeholder` replaced by `value` as JSON (once; a missing placeholder is an error of the build). */
export function inlineBoot(template: string, placeholder: string, value: unknown): string {
  if (!template.includes(placeholder)) throw new Error(`The page has no ${placeholder} placeholder: rebuild the Shell (npm run build).`);
  const json = scriptJson(value);
  return template.replace(placeholder, () => json);
}

/** The text of every inline script (a `<script>` without `src`) of a page, as the browser hashes it. */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(match[1] ?? '')) continue;
    out.push(match[2] ?? '');
  }
  return out;
}

/**
 * The CSP of the Shell (with `artifactId`: it frames that artifact's content origin and its broker talks to it over
 * HTTP and WebSocket) or of the home page (without). Scripts: the page's own files and its inline scripts by hash.
 */
export async function pageCsp(html: string, config: Pick<HostConfig, 'contentOrigin'>, artifactId?: string): Promise<string> {
  const hashes = await Promise.all(inlineScripts(html).map(scriptHash));
  const content = artifactId ? contentOriginOf(config, artifactId) : null;
  const socket = content ? content.replace(/^http/, 'ws') : null;
  return [
    "default-src 'self'",
    `script-src 'self'${hashes.length > 0 ? ` ${[...new Set(hashes)].join(' ')}` : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:${content ? ` ${content}` : ''}`,
    "font-src 'self' data:",
    `connect-src 'self'${content ? ` ${content} ${socket}` : ''}`,
    `frame-src ${content ?? "'none'"}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** An HTML answer of a built page, never cached, under {@link pageCsp}, with {@link APP_OPENER_POLICY} where it works. */
export async function builtPage(html: string, config: Pick<HostConfig, 'appOrigin' | 'contentOrigin'>, artifactId?: string, init: { status?: number; headers?: HeadersInit } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('content-security-policy', await pageCsp(html, config, artifactId));
  if (isPotentiallyTrustworthyOrigin(config.appOrigin)) headers.set('cross-origin-opener-policy', APP_OPENER_POLICY);
  return new Response(html, { status: init.status ?? 200, headers });
}
