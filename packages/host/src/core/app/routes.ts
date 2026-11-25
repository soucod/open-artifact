/**
 * The app origin as one handler: sign-in (`authRoutes`), the pages, the Library API, sharing, share links, the event
 * stream and the built Shell's files, behind the app origin's rules:
 *
 * - every write (not `GET`/`HEAD`/`OPTIONS`) must come from the app origin itself (`assertSameOrigin`, decision 22);
 * - an agent's `Authorization: Bearer` token is taken only by the Link API ({@link takesAgentToken}); on every other
 *   route (the browser's: a session or guest cookie) it is refused with a 401, never read as an anonymous visit;
 * - an error a browser navigates to on a page path (`/`, `/a/*`, `/s/*`, `/auth/*`) is a page, not JSON;
 * - every answer carries `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'` and a Referrer-Policy, and a
 *   CSP that loads nothing unless the route set its own (the Shell and home pages, the sign-in pages);
 * - request bodies are capped per route (JSON writes 64 KiB, an uploaded archive {@link IMPORT_MAX_BYTES});
 * - a request that carries one of the app's cookies twice (cookie tossing from a sibling host) is handled without
 *   them, its sessions ended and the copies deleted ({@link guardAppOrigin}).
 *
 * A site's plugins answer `/plugins/<id>/…` ({@link answerPluginRoute}) before any of this: their routes take a
 * webhook's own `Authorization` header, and a route the plugin did not mark `public` refuses a write from another
 * origin; the security headers and a body cap ({@link PLUGIN_ROUTE_MAX_BYTES}) apply to them too.
 */

import { LINK_API_PREFIX } from '@open-artifact/protocol';
import { authRoutes, signInRefusedAnswer } from '../auth/routes.ts';
import { authenticate, hasBearer } from '../auth/session.ts';
import { explainAccess } from '../authz/explain.ts';
import type { ProviderDeps } from '../auth/provider.ts';
import { LINK_SCOPE } from '../link/services.ts';
import { assertSameOrigin, errorResponse, httpError, json, readBody, Router, type BaseCtx, type Handler } from '../http.ts';
import { ADMIN_AUDIT_PATH, auditPage, auditQueryOf } from './audit.ts';
import { asPageWhenNavigating } from './error-page.ts';
import { libraryRoutes } from './library.ts';
import { pageRoutes } from './pages.ts';
import { signedIn } from './views.ts';
import { guardAppOrigin, withAppHeaders } from './security.ts';
import { IMPORT_MAX_BYTES, type AppCtx } from './services.ts';
import { linkRoutes, shareRoutes } from './share.ts';
import { eventRoutes } from './stream.ts';

/** The largest request body any app route reads (the platform adapter's cap should be at least this). */
export const APP_MAX_BODY_BYTES = IMPORT_MAX_BYTES;

/** Largest request body a plugin route is handed (a bigger one is answered 413 before the plugin runs). */
export const PLUGIN_ROUTE_MAX_BYTES = 1024 * 1024;
/** The path prefix of plugin routes. */
export const PLUGIN_ROUTE_PREFIX = '/plugins/';

/**
 * Answers a request for a plugin route (`/plugins/<id>/…`), or null for any other path or a site without plugins.
 * Who asks is the session cookie's person (anonymous for anything else, a webhook's Bearer header included). The
 * body is read first, up to {@link PLUGIN_ROUTE_MAX_BYTES}, and handed on as a fresh request; the app's security
 * headers are added to the plugin's answer (its own `Content-Security-Policy` is kept).
 */
export async function answerPluginRoute(request: Request, ctx: BaseCtx): Promise<Response | null> {
  const plugins = ctx.plugins;
  if (!plugins || !new URL(request.url).pathname.startsWith(PLUGIN_ROUTE_PREFIX)) return null;
  let response: Response | null;
  try {
    let capped = request;
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
      const bytes = await readBody(request, PLUGIN_ROUTE_MAX_BYTES);
      capped = new Request(request.url, { method: request.method, headers: request.headers, body: bytes as Uint8Array<ArrayBuffer>, signal: request.signal });
    }
    response = await plugins.route(capped, async (asked) => (await authenticate(asked, ctx)).principal);
  } catch (error) {
    response = errorResponse(error, ctx.log);
  }
  return response ? withAppHeaders(response, ctx.config) : null;
}

/** The site's plugins as the list has them (`{plugins: PluginDescription[]}`; settings by name, never values). */
export const ADMIN_PLUGINS_PATH = '/api/open-artifact.admin.plugins';

/**
 * Why a person has the role they have on an artifact (`?artifact=<id>&email=<address>`): the host's own rule and each
 * permission plugin's answer, as {@link explainAccess} gives them. Someone who never signed in is answered as they
 * would be once they do.
 */
export const ADMIN_ACCESS_PATH = '/api/open-artifact.admin.access';

/** Where the built Shell and home page are served (as the daemon serves them). */
export const UI_PATHS = { shell: '/_open-artifact/shell/', home: '/_open-artifact/home/' } as const;

/**
 * The site admin's API, on both hosts: {@link ADMIN_PLUGINS_PATH}, {@link ADMIN_ACCESS_PATH} and {@link ADMIN_AUDIT_PATH} (`audit.ts`). Site
 * admins signed in in a browser only (an agent's Bearer token is refused on every app route).
 */
export function adminPluginRoutes(router: Router<AppCtx>): void {
  router.get(ADMIN_PLUGINS_PATH, async (request, ctx) => {
    const { person } = await signedIn(request, ctx);
    if (person.siteRole !== 'admin') throw httpError('not_granted', 'Only a site admin sees the plugin list.', { status: 403 });
    return json({ plugins: ctx.pluginDescriptions?.() ?? [] }, { headers: { 'cache-control': 'no-store' } });
  });
  router.get(ADMIN_ACCESS_PATH, async (request, ctx) => {
    const { person } = await signedIn(request, ctx);
    if (person.siteRole !== 'admin') throw httpError('not_granted', 'Only a site admin asks why someone has access.', { status: 403 });
    const query = new URL(request.url).searchParams;
    const artifact = query.get('artifact')?.trim() ?? '';
    const email = query.get('email')?.trim() ?? '';
    if (!artifact || !email.includes('@')) throw httpError('invalid_argument', 'Name the artifact (?artifact=<id>) and the person (&email=<address>).', { status: 400 });
    const answer = await explainAccess({ catalog: ctx.catalog, config: ctx.config, plugins: ctx.plugins }, artifact, email);
    if (!answer) throw httpError('not_found', `There is no artifact ${artifact} on this site.`, { status: 404 });
    return json(answer, { headers: { 'cache-control': 'no-store' } });
  });
  router.get(ADMIN_AUDIT_PATH, async (request, ctx) => {
    const { person } = await signedIn(request, ctx);
    if (person.siteRole !== 'admin') throw httpError('not_granted', 'Only a site admin reads the audit log.', { status: 403 });
    const page = await auditPage(ctx.catalog, auditQueryOf(new URL(request.url).searchParams));
    return json(page, { headers: { 'cache-control': 'no-store' } });
  });
}

/** The app origin's router: every route, without the origin rules (see {@link createAppHandler}). */
export function appRouter(options: { providers?: ProviderDeps } = {}): Router<AppCtx> {
  const router = new Router<AppCtx>();
  authRoutes(router, options.providers);
  pageRoutes(router);
  libraryRoutes(router);
  shareRoutes(router);
  linkRoutes(router);
  eventRoutes(router);
  adminPluginRoutes(router);
  router.get('/_open-artifact/*', async (request, ctx) => {
    const pathname = new URL(request.url).pathname;
    const file = await ctx.uiFile(pathname, request);
    if (!file) throw httpError('not_found', `No file ${pathname}.`, { status: 404 });
    return file;
  });
  return router;
}

/**
 * Whether an app-origin path takes an agent's Bearer token: the Link API only (its routes then require the `link`
 * scope). `/mcp` and the OAuth routes take MCP tokens, but they are answered before the app handler (`isMcpPath`).
 */
export function takesAgentToken(pathname: string): boolean {
  return pathname.startsWith(LINK_API_PREFIX);
}

/**
 * The 401 for an agent token sent to a route that is the browser's. It says which kind of token came (looked up by its
 * hash) and where that kind works: a Link token (a computer linked with `open-artifact remote add`) only on the Link
 * API, an MCP token (an MCP client's OAuth sign-in) only on `/mcp`; a token the site does not know, neither.
 */
export async function agentTokenRefused(request: Request, ctx: Pick<BaseCtx, 'catalog'>): Promise<Response> {
  const presented = /^Bearer\s+(\S+)/i.exec(request.headers.get('authorization')?.trim() ?? '')?.[1];
  const record = presented ? await ctx.catalog.findAgentTokenByAccess(presented).catch(() => undefined) : undefined;
  const link = record?.scopes.includes(LINK_SCOPE) ?? false;
  const mcp = record?.scopes.some((scope) => scope !== LINK_SCOPE) ?? false;
  const browser = 'This route takes a signed-in browser (or a share link\'s guest), with no Authorization header.';
  let message: string;
  let fix: string;
  if (link && mcp) {
    message = `The Bearer token sent is an agent token for the Link API (${LINK_API_PREFIX}*) and /mcp: it works only there. ${browser}`;
    fix = 'Send no Authorization header here: sign in in a browser, or use the Link API or /mcp with this token.';
  } else if (link) {
    message = `The Bearer token sent is a Link token (a computer linked with \`open-artifact remote add\`): it works only on the Link API (${LINK_API_PREFIX}*), not here and not on /mcp. ${browser}`;
    fix = 'Use it on the Link API only (the daemon does); for /mcp, connect the MCP client to /mcp so it signs in with OAuth and gets an MCP token.';
  } else if (mcp) {
    message = `The Bearer token sent is an MCP token (from an MCP client's OAuth sign-in): it works only on /mcp, not here and not on the Link API. ${browser}`;
    fix = 'Use it on /mcp only; to publish from a computer, link it with `open-artifact remote add`.';
  } else {
    message = `The Bearer token sent is not one this site knows now (revoked, expired, or from another site). ${browser}`;
    fix = 'Send no Authorization header here: sign in in a browser. Link tokens work on the Link API only, MCP tokens on /mcp only.';
  }
  return json(
    { code: 'unauthorized', message, fix },
    { status: 401, headers: { 'www-authenticate': `Bearer error="invalid_token", error_description="${message.replace(/"/g, "'")}"` } },
  );
}

/** The app origin's handler: {@link appRouter} behind the origin rules of the module comment. */
export function createAppHandler(options: { providers?: ProviderDeps; router?: Router<AppCtx> } = {}): Handler<AppCtx> {
  const router = options.router ?? appRouter(options);
  return guardAppOrigin<AppCtx>(async (request, ctx) => {
    let response: Response;
    const plugin = await answerPluginRoute(request, ctx);
    if (plugin) return plugin;
    try {
      if (hasBearer(request) && !takesAgentToken(new URL(request.url).pathname)) return withAppHeaders(await asPageWhenNavigating(request, await agentTokenRefused(request, ctx)), ctx.config);
      assertSameOrigin(request, ctx.config);
      if (ctx.plugins?.hasAuthenticate) {
        // A plugin named someone the site does not let in: say so (once per request: `authenticate` is remembered).
        const { refused } = await authenticate(request, ctx);
        const answer = refused ? await signInRefusedAnswer(request, ctx, refused, options.providers) : null;
        if (answer) return withAppHeaders(answer, ctx.config);
      }
      response = await router.handle(request, ctx);
    } catch (error) {
      response = errorResponse(error, ctx.log);
    }
    return withAppHeaders(await asPageWhenNavigating(request, response), ctx.config);
  });
}
