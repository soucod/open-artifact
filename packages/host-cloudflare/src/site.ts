/**
 * The product Worker's logic (the entry is `worker.ts`; this is what the tests drive): one {@link Site} per isolate.
 *
 * Routing, by Host:
 *
 * - `GET|HEAD /__open-artifact/health` on any host: the health check (once the catalog answers a query).
 * - A content host (`<label>.content…`): the artifact's object (`ROOMS.idFromName(id)`), with the artifact named in
 *   `ARTIFACT_HEADER`. No cookie goes in and none comes out (decision 6). An id the catalog does not know is answered
 *   404 here, so a made-up host name creates no object.
 * - A page host (`<label>--<opaque>.content…`, a page artifact's page): the artifact's object too, as a content host
 *   (no cookie either way), which checks the opaque part against the live role. Only while the site runs pages
 *   ({@link Site.pages}); otherwise refused as a stray name.
 * - The app origin's own host (exactly, `hostKindOf`): the core's `createAppHandler` over {@link AppServices} built
 *   from the room and the hub. The Library stream is forwarded to the hub (`hub.ts`).
 * - Any other host (a wildcard route sends every name of the zone here, `login.example.com` too; a `workers.dev` name
 *   that is not the app origin's): 421, plain text, no cookie, in every mode.
 *
 * The platform serves `/_open-artifact/**` from static assets before the Worker runs (the editors, the Shell's and home
 * page's files, `support.js`). What still reaches the Worker under it: a file the assets do not have (404, as on
 * Node), and the two page templates (`run_worker_first`), which are answered 404 here because the pages are served
 * with their boot at `/` and `/a/<id>`.
 *
 * The Worker's own calls carry `ROOM_CALL_HEADER`/`HUB_CALL_HEADER`; both are stripped from every browser request.
 *
 * Uploaded archives are capped at {@link CLOUDFLARE_IMPORT_MAX_BYTES} (32 MiB), under the core's 100 MiB: the zip is
 * held whole in the Worker and again in the object, inside 128 MB isolates.
 *
 * Agents: the Link API and remote MCP (`agents.ts`) are mounted here; the Link's event stream is the hub's.
 * {@link SiteServices} lets a test add routes or a handler asked first.
 */

import { SHELL_PARAMS, type DaemonHealth } from '@open-artifact/protocol';
import {
  AccessCache,
  authRoutes,
  Catalog,
  ConfigError,
  PluginConfigError,
  contentOriginOf,
  connectedAppRoutes,
  adminPluginRoutes,
  createAppHandler,
  guardAppOrigin,
  hostKindOf,
  wrongHostResponse,
  errorResponse,
  isMcpPath,
  isPotentiallyTrustworthyOrigin,
  httpError,
  libraryRoutes,
  linkRoutes,
  pageRoutes,
  pageTokenClaims,
  parseTrashDays,
  purgeExpiredTrash,
  Router,
  shareRoutes,
  signPageToken,
  json,
  emitEvent,
  artifactRef,
  purgeExpiredPluginKv,
  type Plugins,
  type AppCtx,
  type AppServices,
  type ArtifactRow,
  type Handler,
  type HostConfig,
  type ProviderDeps,
} from '@open-artifact/host';
import type { ExecutionContext, ProductEnv } from './bindings.ts';
import { parseCloudflareConfig, isLocalHostName, stringVars } from './config.ts';
import { d1Driver, ensureMigrated, type D1Counters, type D1Driver } from './d1.ts';
import { cappedRequest, cloudflareLinkRoutes, mcpDispatch } from './agents.ts';
import { adminRoutes } from './admin.ts';
import { EVENTS_PATH, ForwardingEvents, HUB_CALL_HEADER, HubClient } from './hub.ts';
import { ROOM_CALL_HEADER, RoomClient } from './room-calls.ts';
import { ARTIFACT_HEADER } from './room.ts';
import { startCloudflarePlugins, type PluginModules } from './plugins.ts';
import { PAGE_TITLE, PAGE_TYPE, sitePagesOf, type FrameBuild, type PageNetwork } from './frames.ts';

/** The health check's path (as the Node host). */
export const HEALTH_PATH = '/__open-artifact/health';
/** Costs of this isolate, the hub and one artifact's object (`?id=`), with `OA_DEBUG_STATS=1` on a localhost app origin. */
export const STATS_PATH = '/__open-artifact/stats';
/** The largest uploaded archive the Cloudflare host takes, bytes (see the module comment). */
export const CLOUDFLARE_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
/** The Library's import route. */
export const IMPORT_PATH = '/api/open-artifact.artifacts.import';
/** How long an artifact id found in the catalog is remembered by an isolate (for content-host routing), ms. */
const KNOWN_MS = 60_000;

/** A type the build found (`artifact-types/*`): its id and the title the Library shows, plus its manifest for CF3. */
export interface TypeEntry {
  id: string;
  title: string;
  /** The manifest's own fields and skill text (remote MCP, CF3). */
  manifest?: Record<string, unknown>;
  skill?: string | null;
}

/** What the build puts in the bundle. */
export interface SiteBuild {
  version: string;
  types: readonly TypeEntry[];
  /** The built Shell's and home page's `index.html` (with their boot placeholders). */
  shellHtml: string;
  homeHtml: string;
  /** The file bundled as `open-artifact:plugins` (`OA_PLUGINS_MODULE`, or `deploy/cloudflare/plugins.mjs`). */
  pluginsModule?: string;
  /** The frame engine's types (`page`) and where its browser files are in the static assets; none: no page runs. */
  frames?: FrameBuild;
}

/** CF3's seam: routes mounted on the app origin, and a handler asked first (e.g. `/mcp`, outside the app's rules). */
export interface SiteServices {
  routes?(router: Router<AppCtx>, site: Site): void;
  before?(request: Request, ctx: AppCtx, site: Site): Promise<Response | null>;
}

export interface SiteOptions {
  services?: SiteServices;
  providers?: ProviderDeps;
  log?: (line: string) => void;
  now?: () => Date;
  /** The `fetch` of the client metadata fetcher (tests stub it; default the global one). */
  mcpFetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** The bundled plugin modules (`open-artifact:plugins`), matched to `OA_PLUGINS` by `use`. None: no plugin runs. */
  pluginModules?: PluginModules;
}

/** A file name for a zip from a title: no path or control characters (as the Node host). */
export function zipNameOf(title: string): string {
  const name = title.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').trim().slice(0, 100);
  return name || 'artifact';
}

/** The app origin's router: the core's `appRouter`, with the Library stream sent to the hub. */
export function productRouter(site: Site, options: { providers?: ProviderDeps; services?: SiteServices } = {}): Router<AppCtx> {
  const router = new Router<AppCtx>();
  authRoutes(router, options.providers);
  pageRoutes(router);
  // The import route with this host's cap on the body, then the core's (registered first, it is matched first).
  const library = new Router<AppCtx>();
  libraryRoutes(library);
  router.post(IMPORT_PATH, async (request, ctx) => library.handle(cappedRequest(request, CLOUDFLARE_IMPORT_MAX_BYTES, 'The archive'), ctx));
  libraryRoutes(router);
  shareRoutes(router);
  linkRoutes(router);
  connectedAppRoutes(router);
  cloudflareLinkRoutes(router, site);
  adminRoutes(router);
  adminPluginRoutes(router);
  router.get(EVENTS_PATH, async (request) => site.hub.stream(request));
  router.get('/_open-artifact/*', async (request, ctx) => {
    const pathname = new URL(request.url).pathname;
    const file = await ctx.uiFile(pathname, request);
    if (!file) throw httpError('not_found', `No file ${pathname}.`, { status: 404 });
    return file;
  });
  options.services?.routes?.(router, site);
  return router;
}

export class Site {
  readonly env: ProductEnv;
  readonly build: SiteBuild;
  readonly #options: SiteOptions;
  readonly #log: (line: string) => void;
  readonly #now: () => Date;
  readonly configError: Error | null = null;
  /** The site's plugins, running or not (null: no `OA_PLUGINS`). */
  readonly pluginRegistry: Plugins | null = null;
  /** The plugins a request runs (undefined: none). */
  readonly plugins: Plugins | undefined;
  readonly config!: HostConfig;
  readonly driver: D1Driver;
  readonly catalog!: Catalog;
  readonly access!: AccessCache;
  readonly hub: HubClient;
  readonly #types: Map<string, TypeEntry>;
  /** Page artifacts: whether this site runs them, and what they may reach (`OA_PAGE_NETWORK`); null: none. */
  readonly pages: { network: PageNetwork; build: FrameBuild } | null = null;
  readonly #known = new Map<string, number>();
  #handler: Handler<AppCtx> | null = null;
  #mcp: ((request: Request, ctx: AppCtx) => Promise<Response>) | null = null;

  constructor(env: ProductEnv, build: SiteBuild, options: SiteOptions = {}) {
    this.env = env;
    this.build = build;
    this.#options = options;
    this.#log = options.log ?? ((line) => console.log(line));
    this.#now = options.now ?? (() => new Date());
    this.driver = d1Driver(env.DB);
    this.hub = new HubClient(() => env.HUB.get(env.HUB.idFromName('hub')));
    this.#types = new Map(build.types.map((type) => [type.id, type]));
    try {
      this.config = parseCloudflareConfig(env);
      this.pages = sitePagesOf(this.config, stringVars(env), build.frames);
      this.catalog = new Catalog(this.driver, { signingKeys: this.config.signingKeys, now: this.#now });
      const started = startCloudflarePlugins({
        vars: stringVars(env),
        modules: options.pluginModules ?? {},
        ...(build.pluginsModule ? { modulesFile: build.pluginsModule } : {}),
        catalog: this.catalog,
        config: this.config,
        version: build.version,
        log: this.#log,
        now: this.#now,
        forgetHere: (id) => this.access.invalidate(id),
        refresh: async (id) => {
          if (id) await this.room(id).refresh();
          else await this.hub.refreshRooms();
        },
      });
      this.pluginRegistry = started.registry;
      this.plugins = started.active;
      this.access = new AccessCache(this.catalog, this.config, { groupsOf: (id) => this.catalog.userGroups(id), maxAgeMs: 2_000, now: this.#now, ...(this.plugins ? { plugins: this.plugins } : {}) });
    } catch (error) {
      if (!(error instanceof ConfigError) && !(error instanceof PluginConfigError)) throw error;
      this.configError = error;
      this.#log(`config: ${error.message}`);
    }
  }

  /** The catalog, migrated (once per isolate). */
  async ready(): Promise<Catalog> {
    await ensureMigrated(this.driver, this.env.DB);
    return this.catalog;
  }

  /** One artifact's object. */
  room(id: string): RoomClient {
    return new RoomClient(this.env.ROOMS.get(this.env.ROOMS.idFromName(id)), id);
  }

  /** The type of a known type id. */
  typeInfo(type: string): { title: string } | null {
    const entry = this.#types.get(type);
    if (entry) return { title: entry.title };
    return this.pages && type === PAGE_TYPE ? { title: PAGE_TITLE } : null;
  }

  /** The app's platform services for one request (events go to the hub after the answer). */
  services(exec: ExecutionContext): AppServices {
    const { config, catalog } = this;
    const appOrigin = new URL(config.appOrigin).origin;
    return {
      events: new ForwardingEvents(this.hub, (promise) => exec.waitUntil(promise), this.#log),
      access: this.access,
      pageFor: async (artifact: ArtifactRow, principal, role) => {
        const claims = pageTokenClaims({ artifact: artifact.id, principal, role, grantsVersion: artifact.grantsVersion, epoch: await catalog.siteEpoch(), now: this.#now() });
        const token = await signPageToken(claims, config.signingKeys);
        const pageUrl = new URL(`${artifact.type}/${encodeURIComponent(token)}/`, `${contentOriginOf(config, artifact.id)}/`).href;
        const framed = new URL(pageUrl);
        framed.searchParams.set(SHELL_PARAMS.shell, appOrigin);
        return { url: framed.href, pageUrl };
      },
      refreshAccess: async (id) => {
        this.access.invalidate(id);
        await this.room(id).refresh();
      },
      typeInfo: (type) => this.typeInfo(type),
      archive: async (id, method) => {
        const artifact = await catalog.getArtifact(id);
        if (!artifact) throw httpError('not_found', `No artifact ${id}.`, { status: 404 });
        const folder = zipNameOf(artifact.title);
        const headers = { 'content-type': 'application/zip', 'content-disposition': attachment(`${folder}.zip`), 'cache-control': 'no-store' };
        const body = await this.room(id).archive(method, folder);
        return new Response(method === 'HEAD' ? null : body, { headers });
      },
      importArchive: async (id, bytes) => {
        const imported = await this.room(id).importArtifact(bytes);
        this.#known.set(id, Date.now());
        return imported;
      },
      shellHtml: async () => this.build.shellHtml,
      homeHtml: async () => this.build.homeHtml,
      connected: (id) => this.room(id).connected(),
      uiFile: async (pathname, request) => {
        if (/\/index\.html$/.test(pathname) || pathname.endsWith('/')) return null;
        const response = await this.env.ASSETS.fetch(new Request(new URL(pathname, request.url), { method: request.method === 'HEAD' ? 'HEAD' : 'GET' }));
        return response.ok ? response : null;
      },
      version: this.build.version,
      removeArtifact: (id) => this.removeArtifact(id),
      // Checked when the config is parsed, so it does not throw here.
      trashDays: parseTrashDays(stringVars(this.env)),
      importMaxBytes: CLOUDFLARE_IMPORT_MAX_BYTES,
      // The hub keeps who has a Link stream open.
      linkOnline: (userId) => this.hub.online(userId),
      ...(this.pluginRegistry ? { pluginDescriptions: () => this.pluginRegistry!.describe() } : {}),
    };
  }

  /** Permanently deletes an artifact's object (the catalog row is the caller's). Trash keeps it. */
  async removeArtifact(id: string): Promise<void> {
    this.#known.delete(id);
    await this.room(id).destroy();
  }

  /** The Worker's `fetch`. */
  async fetch(request: Request, exec: ExecutionContext): Promise<Response> {
    if (this.configError) {
      return new Response(`Open Artifact is not configured: ${this.configError.message}\n`, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const url = new URL(request.url);
    // A browser never sends the Worker's own call headers on.
    if (request.headers.has(ROOM_CALL_HEADER) || request.headers.has(HUB_CALL_HEADER) || request.headers.has(ARTIFACT_HEADER)) {
      const headers = new Headers(request.headers);
      headers.delete(ROOM_CALL_HEADER);
      headers.delete(HUB_CALL_HEADER);
      headers.delete(ARTIFACT_HEADER);
      request = new Request(request, { headers });
    }
    if (url.pathname === HEALTH_PATH && (request.method === 'GET' || request.method === 'HEAD')) return this.#health(request);
    const before = this.driver.counters();
    let response: Response;
    // The app answers only on its own host, in every mode: a wildcard route on the content domain sends every other
    // name of the zone here too (`login.example.com`), and a Custom Domain or `workers.dev` name that is not the app
    // origin's is no better. A content host goes to its room; anything else is refused before any handler.
    const host = hostKindOf(this.config, url.host, url.protocol.slice(0, -1));
    if (host.kind === 'content') response = await this.#content(request, host.id);
    // A page host: the page artifact's object, which checks the opaque part; a name this site does not answer without pages.
    else if (host.kind === 'page') response = this.pages ? await this.#content(request, host.id) : wrongHostResponse({ kind: 'stray', host: url.host });
    else if (host.kind !== 'app') response = wrongHostResponse(host);
    else if (url.pathname === STATS_PATH && this.#statsOn()) response = await this.#stats(url);
    else response = await this.#app(request, exec);
    if (this.#statsOn()) {
      const after = this.driver.counters();
      response = withHeader(response, 'x-open-artifact-d1', `queries=${after.queries - before.queries};read=${after.rowsRead - before.rowsRead};written=${after.rowsWritten - before.rowsWritten}`);
    }
    return response;
  }

  /** The hourly upkeep (cron): expired sessions and device codes, and artifacts past `OA_TRASH_DAYS` in the trash. */
  async scheduled(): Promise<void> {
    if (this.configError) return;
    const catalog = await this.ready();
    const sessions = await catalog.purgeExpiredSessions();
    const codes = await catalog.expireDeviceCodes();
    const plugins = this.plugins;
    const trashed = await purgeExpiredTrash(catalog, (id) => this.removeArtifact(id), {
      days: parseTrashDays(stringVars(this.env)),
      now: this.#now(),
      log: this.#log,
      ...(plugins ? { onPurged: (artifact: ArtifactRow) => emitEvent({ plugins }, 'artifact.deleted', { artifact: artifactRef(artifact), by: { kind: 'system', id: null }, reason: 'expired' }) } : {}),
    });
    if (this.pluginRegistry) await purgeExpiredPluginKv(catalog.driver, this.#now());
    // The cron's own waitUntil holds this answer: what the plugins still do in the background is waited for here.
    await plugins?.idle();
    if (sessions || codes || trashed) this.#log(`upkeep: purged ${sessions} expired session(s), ${codes} device code(s), ${trashed} artifact(s) from the trash`);
  }

  #statsOn(): boolean {
    return stringVars(this.env).OA_DEBUG_STATS === '1' && isLocalHostName(new URL(this.config.appOrigin).hostname);
  }

  async #health(request: Request): Promise<Response> {
    let status = 200;
    let body: DaemonHealth | { openArtifact: 1; version: string; code: string; message: string } = { openArtifact: 1, version: this.build.version };
    try {
      await this.ready();
      await this.driver.get('SELECT 1 AS ok');
    } catch (error) {
      status = 503;
      body = { ...body, code: 'unavailable', message: `The catalog does not answer: ${error instanceof Error ? error.message : String(error)}` };
    }
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }

  /** Whether the catalog knows the artifact (found ids are remembered a minute: the object checks access anyway). */
  async #exists(id: string): Promise<boolean> {
    const seen = this.#known.get(id);
    if (seen !== undefined && Date.now() - seen < KNOWN_MS) return true;
    const catalog = await this.ready();
    const row = await catalog.driver.get<{ id: string }>('SELECT id FROM artifacts WHERE id = ?', [id]);
    if (!row) return false;
    this.#known.set(id, Date.now());
    if (this.#known.size > 10_000) this.#known.delete(this.#known.keys().next().value!);
    return true;
  }

  async #content(request: Request, id: string): Promise<Response> {
    if (!(await this.#exists(id))) return new Response('Not found.\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    headers.set(ARTIFACT_HEADER, id);
    const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(id)).fetch(new Request(request, { headers }));
    if (response.status === 101) return response;
    // The object's answer may have immutable headers: copy it, drop any cookie, ask for an origin-keyed agent cluster
    // (where a browser takes it: the Worker's origins are https, or http on localhost under wrangler dev).
    const out = new Response(response.body, response);
    out.headers.delete('set-cookie');
    if (isPotentiallyTrustworthyOrigin(this.config.contentOrigin)) out.headers.set('origin-agent-cluster', '?1');
    return out;
  }

  async #app(request: Request, exec: ExecutionContext): Promise<Response> {
    await this.ready();
    const services = this.services(exec);
    const plugins = this.plugins;
    const ctx: AppCtx = {
      config: this.config,
      catalog: this.catalog,
      now: this.#now,
      log: this.#log,
      ...services,
      ...(plugins ? { plugins, waitUntil: (promise: Promise<unknown>) => exec.waitUntil(promise) } : {}),
    };
    if (!plugins) return this.#appAnswer(request, ctx);
    try {
      return await this.#appAnswer(request, ctx);
    } finally {
      // Event handlers and audit writes the request started run on after the answer.
      exec.waitUntil(plugins.idle());
    }
  }

  async #appAnswer(request: Request, ctx: AppCtx): Promise<Response> {
    const before = await this.#options.services?.before?.(request, ctx, this);
    if (before) return before;
    // Remote MCP and its OAuth: outside the app's rules (its own CORS and origin checks), as on the Node host.
    if (isMcpPath(new URL(request.url).pathname)) {
      try {
        // Its OAuth authorization page reads the session cookie: the app's duplicate-cookie guard applies.
        this.#mcp ??= guardAppOrigin<AppCtx>(mcpDispatch(this, stringVars(this.env), this.config.appOrigin, this.#options.mcpFetch ? { fetch: this.#options.mcpFetch } : {}));
        return await this.#mcp(request, ctx);
      } catch (error) {
        return errorResponse(error, this.#log);
      }
    }
    this.#handler ??= createAppHandler({ router: productRouter(this, { ...(this.#options.providers ? { providers: this.#options.providers } : {}), ...(this.#options.services ? { services: this.#options.services } : {}) }) });
    return this.#handler(request, ctx);
  }

  async #stats(url: URL): Promise<Response> {
    const id = url.searchParams.get('id');
    const worker: D1Counters = this.driver.counters();
    const hub = await this.hub.stats().catch((error: unknown) => ({ error: String(error) }));
    const room = id ? await this.room(id).stats().catch((error: unknown) => ({ error: String(error) })) : null;
    return json({ worker: { d1: worker }, hub, room });
  }
}

/** A `Content-Disposition: attachment` with an ASCII fallback and the UTF-8 name (RFC 6266). */
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function withHeader(response: Response, name: string, value: string): Response {
  if (response.status === 101) return response;
  try {
    response.headers.set(name, value);
    return response;
  } catch {
    const out = new Response(response.body, response);
    out.headers.set(name, value);
    return out;
  }
}

