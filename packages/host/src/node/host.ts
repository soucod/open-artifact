/**
 * The Node host, assembled: the catalog in `<dataDir>/host.db`, the embedded type server (rooms), the app origin's
 * handler over Node `http` (the app's routes, then the Link API), content hosts sent to the rooms, and the upkeep
 * timer.
 *
 * `startHost` does the work; `main.ts` turns the environment and command line into its options.
 */

import { readFileSync } from 'node:fs';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { LINK_API_PREFIX, OpenArtifactError, titleInHtml, type DaemonHealth, type OpenArtifactErrorCode } from '@open-artifact/protocol';
import { archiveEntries, ArchiveTooLarge, attachmentHeader, HttpError, importArchive, isTypeName, readArtifactTitle, TYPES, writeZip } from '@open-artifact/type-server';
import { APP_MAX_BODY_BYTES, appRouter, createAppHandler, guardAppOrigin, IMPORT_MAX_BYTES, isPotentiallyTrustworthyOrigin, type AppCtx, type AppServices } from '../core/app/index.ts';
import { ensureOwnerKey } from '../core/auth/owner-key.ts';
import type { ProviderDeps } from '../core/auth/provider.ts';
import { AccessCache } from '../core/authz/access.ts';
import { Catalog } from '../core/catalog/catalog.ts';
import { DEFAULT_TRASH_DAYS, purgeExpiredTrash } from '../core/catalog/trash.ts';
import { HostEvents } from '../core/events.ts';
import { httpError, json, type Handler } from '../core/http.ts';
import { linkApiRoutes } from '../core/link/routes.ts';
import { LINK_MAX_BODY_BYTES, type LinkServices } from '../core/link/services.ts';
import { parseMcpConfig, type McpConfig } from '../core/mcp/config.ts';
import { connectedAppRoutes } from '../core/mcp/oauth.ts';
import { isMcpPath, MCP_MAX_BODY_BYTES } from '../core/mcp/routes.ts';
import type { McpServices } from '../core/mcp/services.ts';
import type { HostConfig } from '../core/types.ts';
import { emitEvent, forgetPluginRoles, pluginServices, purgeExpiredPluginKv, startSitePlugins, type LoadedPlugin, type Plugins } from '../core/plugins/index.ts';
import { artifactRef } from '../core/plugins/registry.ts';
import { hostKindOf, wrongHostResponse } from '../core/page-token.ts';
import { nodeHandler, sendResponse } from './adapter.ts';
import { dispatchByHost } from './content.ts';
import type { NodeHostEnv } from './env.ts';
import { createLinkPresence, nodeLinkServices, removeArtifactFolder } from './link.ts';
import { DEFAULT_TYPES_DIR, mcpRoutes, nodeMcpServices } from './mcp.ts';
import { nodeFrameTypes, PAGE_TITLE, PAGE_TYPE, parsePageNetwork, type PageNetwork } from './frames.ts';
import { createRooms, type HostRooms } from './rooms.ts';
import { nodeSiteTypes, siteTypeImport, withSiteTypes, type NodeSiteTypes } from './site-types.ts';
import { openSqlite, type SqliteDriver } from './sqlite.ts';
import { uiFiles } from './static.ts';

/** This package's version (the host's). */
export const HOST_VERSION: string = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

/** How often expired sessions and device codes, and artifacts past `OA_TRASH_DAYS` in the trash, are purged, ms. */
export const UPKEEP_MS = 60 * 60_000;

export interface StartHostOptions {
  config: HostConfig;
  env: NodeHostEnv;
  /** A built `dist/daemon` (the Shell and home page, and the frame client under `frame-host/client`). */
  uiDir: string;
  /**
   * Page artifacts on the frame engine (`frames.ts`): the pages' network (default `OA_PAGE_NETWORK`), the types
   * folder (default the MCP's), the frame client (default `<uiDir>/frame-host/client`). `false`: none. Always none
   * when both origins share one site (`OA_CONTENT_SAME_SITE`): a page needs a host name of its own the app is not
   * same-site with.
   */
  pages?: { network?: PageNetwork; typesDir?: string; clientDir?: string } | false;
  /** Read `X-Forwarded-Host` / `X-Forwarded-Proto` (only behind a proxy that sets them: `OA_TRUST_PROXY=1`). */
  trustProxy?: boolean;
  log?: (line: string) => void;
  /** Sign-in provider dependencies (tests stub `fetch`). */
  providers?: ProviderDeps;
  /** Read the Shell and home templates on every request (development). */
  reloadUi?: boolean;
  /** Remote MCP: its settings (default from `OA_MCP_ORIGINS`/`OA_OAUTH_CLIENTS`), the types folder (`OA_TYPES_DIR`), and the metadata fetcher (tests stub it). */
  mcp?: { config?: McpConfig; typesDir?: string; cimd?: McpServices['cimd']; waitCapMs?: number };
  /** Days an artifact stays in the trash before the upkeep deletes it for good (`OA_TRASH_DAYS`; 0 never). */
  trashDays?: number;
  /** How often the upkeep runs, ms (default {@link UPKEEP_MS}; tests make it short). */
  upkeepMs?: number;
  /**
   * The site's plugin list with each module loaded (`loadSitePlugins` in `plugins.ts`; tests pass plugin objects).
   * Absent or empty: no plugin runs and nothing extra happens per request.
   */
  plugins?: readonly LoadedPlugin[];
  /** Where plugins' `{"env": "NAME"}` settings are read (default `process.env`). */
  pluginEnv?: Readonly<Record<string, string | undefined>>;
}

export interface RunningHost {
  /** Where the server listens, e.g. `http://127.0.0.1:4900`. */
  listening: string;
  port: number;
  config: HostConfig;
  catalog: Catalog;
  rooms: HostRooms;
  events: HostEvents;
  /** The Link API's services (presence: which users have a daemon linked now). */
  link: LinkServices;
  server: Server;
  /** The generated owner key when this start made it (print it once), else null. */
  ownerKey: string | null;
  /** The site's plugins, running or not (null: no plugin list). */
  plugins: Plugins | null;
  stop(): Promise<void>;
}

/** Opens `<dataDir>/host.db` (migrated) as a catalog; the data folder is made (or narrowed to) mode 0700. */
export async function openCatalog(dataDir: string, config: Pick<HostConfig, 'signingKeys'>): Promise<{ catalog: Catalog; driver: SqliteDriver }> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700);
  const driver = openSqlite(join(dataDir, 'host.db'));
  return { catalog: await Catalog.open(driver, { signingKeys: config.signingKeys }), driver };
}

/** The type server's `HttpError` as the host's error (so the client gets its code and status, not a 500). */
function asHostError(error: unknown): unknown {
  if (error instanceof HttpError) return new OpenArtifactError(error.code as OpenArtifactErrorCode, error.message, { status: error.status });
  return error;
}

/**
 * A title from an archive: where its type keeps it (`titleFrom`, e.g. a doc's name), else its `.artifact.json` title,
 * else the zip's top folder name.
 */
async function titleOf(root: string, type: string, bytes: Uint8Array): Promise<string> {
  if (isTypeName(type)) {
    const title = await readArtifactTitle(root, type);
    if (title) return title;
  }
  if (type === PAGE_TYPE) {
    const title = titleInHtml(await readFile(join(root, 'index.html'), 'utf8').catch(() => ''))?.trim().slice(0, 200);
    if (title) return title;
  }
  try {
    const meta = JSON.parse(await readFile(join(root, '.artifact.json'), 'utf8')) as { title?: unknown };
    if (typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim();
  } catch {
    /* none */
  }
  // The first local file header: its name is `<folder>/<path>`.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 30 && view.getUint32(0, true) === 0x04034b50) {
    const length = view.getUint16(26, true);
    const name = new TextDecoder().decode(bytes.subarray(30, 30 + length));
    const folder = name.split('/')[0]?.trim();
    if (folder) return folder;
  }
  return 'Imported artifact';
}

/**
 * Unpacks an uploaded artifact archive into `root` (which must not exist) as artifact `id`: its type and a title.
 * Refusals are the host's errors (400 `invalid_archive`/`not_artifact`, 409, 413).
 */
export async function importArtifactArchive(
  root: string,
  id: string,
  bytes: Uint8Array,
  markerTypes: readonly string[] = [],
  options: { inspectMarker?: (marker: Record<string, unknown> | null) => void; titleOf?: (type: string, root: string) => Promise<string | undefined> } = {},
): Promise<{ type: string; title: string }> {
  try {
    const imported = await importArchive(bytes, root, { id, markerTypes, ...(options.inspectMarker ? { inspectMarker: options.inspectMarker } : {}) });
    const own = await options.titleOf?.(imported.type, root);
    return { type: imported.type, title: own || (await titleOf(root, imported.type, bytes)) };
  } catch (error) {
    throw asHostError(error);
  }
}

/**
 * Unpacks an artifact archive into its folder on this site: the built-in types, and where pages run the `page` type
 * and the published types (`siteTypeImport`: by `.artifact.json` type and `typeUid`).
 */
export function importInto(root: string, id: string, bytes: Uint8Array, site: { pages: boolean; siteTypes: NodeSiteTypes | null }): Promise<{ type: string; title: string }> {
  if (!site.pages) return importArtifactArchive(root, id, bytes, []);
  const types = site.siteTypes;
  const { markerTypes, inspect } = siteTypeImport(types, (type) => isTypeName(type) || type === PAGE_TYPE);
  return importArtifactArchive(root, id, bytes, [PAGE_TYPE, ...markerTypes], {
    inspectMarker: inspect,
    ...(types ? { titleOf: (type: string, dir: string) => types.contentTitle(type, dir) } : {}),
  });
}

/** A file name for a zip from a title: no path or control characters. */
function zipNameOf(title: string): string {
  const name = title.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').trim().slice(0, 100);
  return name || 'artifact';
}

/** The platform services of the app origin over the rooms. */
export function nodeServices(input: { catalog: Catalog; config: HostConfig; rooms: HostRooms; events: HostEvents; uiDir: string; reloadUi?: boolean; trashDays?: number; linkOnline?: (userId: string) => boolean; plugins?: Plugins; pluginRegistry?: Plugins | null }): AppServices {
  const { catalog, config, rooms, events } = input;
  const ui = uiFiles(input.uiDir, { cache: !input.reloadUi });
  const registry = input.pluginRegistry;
  return {
    events,
    access: new AccessCache(catalog, config, { groupsOf: (id) => catalog.userGroups(id), ...(input.plugins ? { plugins: input.plugins } : {}) }),
    ...(registry ? { pluginDescriptions: () => registry.describe() } : {}),
    async pageFor(artifact, principal, role) {
      const { url, pageUrl } = await rooms.pageFor(artifact, principal, role);
      return { url, pageUrl };
    },
    refreshAccess: (id) => rooms.refresh(id),
    typeInfo: (type) => (isTypeName(type) ? { title: TYPES[type].title } : type === PAGE_TYPE && rooms.frames?.runs(type) ? { title: PAGE_TITLE } : rooms.frames?.runs(type) ? { title: rooms.siteTypes?.row(type)?.name ?? type } : null),
    async archive(id, method) {
      const artifact = await catalog.getArtifact(id);
      if (!artifact) throw httpError('not_found', `No artifact ${id}.`, { status: 404 });
      const root = rooms.rootOf(id);
      let entries;
      try {
        entries = await archiveEntries(root);
      } catch (error) {
        if (error instanceof ArchiveTooLarge) return json({ code: 'too_large', message: error.message }, { status: 413 });
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw httpError('not_found', 'The artifact\'s folder is missing on this host.', { status: 404 });
        throw error;
      }
      // The folder on the host is named by id; the zip's folder is named by the title.
      const folder = zipNameOf(artifact.title);
      for (const entry of entries) entry.name = `${folder}/${entry.name.slice(entry.name.indexOf('/') + 1)}`;
      const headers = { 'content-type': 'application/zip', 'content-disposition': attachmentHeader(`${folder}.zip`), 'cache-control': 'no-store' };
      if (method === 'HEAD') return new Response(null, { headers });
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            await writeZip(entries, async (chunk) => {
              if (cancelled) throw new Error('cancelled');
              controller.enqueue(new Uint8Array(chunk));
            });
            controller.close();
          } catch (error) {
            if (!cancelled) controller.error(error);
          }
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { headers });
    },
    importArchive: (id, bytes) => importInto(rooms.rootOf(id), id, bytes, { pages: !!rooms.frames, siteTypes: rooms.siteTypes }),
    shellHtml: () => ui.shellHtml(),
    homeHtml: () => ui.homeHtml(),
    uiFile: (pathname, request) => ui.file(pathname, request),
    connected: (id) => rooms.connected(id),
    version: HOST_VERSION,
    removeArtifact: (id) => removeArtifactFolder(rooms, id),
    trashDays: input.trashDays ?? DEFAULT_TRASH_DAYS,
    importMaxBytes: IMPORT_MAX_BYTES,
    ...(input.linkOnline ? { linkOnline: input.linkOnline } : {}),
  };
}

/** The request body cap of a path: the Link API's own (what `link.hello` advertises), else the app's. */
export function maxBodyBytesOf(path: string | undefined): number {
  if ((path ?? '').split('?')[0] === '/mcp') return MCP_MAX_BODY_BYTES;
  return (path ?? '').startsWith(LINK_API_PREFIX) ? Math.max(LINK_MAX_BODY_BYTES, APP_MAX_BODY_BYTES) : APP_MAX_BODY_BYTES;
}

/** The first value of a header that may repeat or list values. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return text?.split(',')[0]?.trim() || undefined;
}

/** The health check (no session, on any host name): what the daemon's answers, once the catalog answers a query. */
export const HEALTH_PATH = '/__open-artifact/health';

/** How long an idle connection is kept open behind a trusted proxy, ms (longer than the proxies' own idle timeouts). */
export const PROXY_KEEP_ALIVE_MS = 130_000;

async function health(driver: SqliteDriver, res: ServerResponse): Promise<void> {
  let status = 200;
  let body: DaemonHealth | { openArtifact: 1; version: string; code: string; message: string } = { openArtifact: 1, version: HOST_VERSION };
  try {
    await driver.get('SELECT 1 AS ok');
  } catch (error) {
    status = 503;
    body = { ...body, code: 'unavailable', message: `The catalog does not answer: ${error instanceof Error ? error.message : String(error)}` };
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
  res.end(res.req.method === 'HEAD' ? undefined : text);
}

/** Starts the host: catalog, rooms, app, listener, upkeep. */
export async function startHost(options: StartHostOptions): Promise<RunningHost> {
  const { config, env } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  const { catalog, driver } = await openCatalog(env.dataDir, config);
  await mkdir(join(env.dataDir, 'artifacts'), { recursive: true });
  const events = new HostEvents({ onError: (error, name) => log(`event ${name}: ${error instanceof Error ? error.message : String(error)}`) });
  // One presence registry: the Link streams fill it, the rooms read it (pages show the owner's agent online).
  // A computer coming or going changes what its owner's pages say of the agent (the Ask pane).
  const linkPresence = createLinkPresence({ onChange: (userId) => events.emit('agent-changed', { userId }) });
  // The site's plugins, started before anything answers (a list that cannot run stops the host here). Forgetting
  // cached roles reaches the services' cache, the rooms' cache and the pages open now.
  let forget: (artifactId?: string) => Promise<void> = async () => undefined;
  let started: ReturnType<typeof startSitePlugins>;
  try {
    started = startSitePlugins({
      loaded: options.plugins ?? [],
      env: options.pluginEnv ?? process.env,
      catalog,
      services: pluginServices({ catalog, config, version: HOST_VERSION, invalidateAccess: (id) => forget(id) }),
      log,
    });
  } catch (error) {
    driver.close();
    throw error;
  }
  const { registry: pluginRegistry, active: plugins } = started;
  const pages = options.pages === false || config.contentSameSite ? null : (options.pages ?? {});
  // The published types run where pages run (they are pages of a type someone published).
  const siteTypes = pages ? nodeSiteTypes({ dataDir: env.dataDir, driver: catalog.driver, log }) : null;
  await siteTypes?.load();
  const rooms = await createRooms({
    config,
    catalog,
    dataDir: env.dataDir,
    assetsDir: env.assetsDir,
    frames: pages
      ? {
          types: withSiteTypes(
            nodeFrameTypes({
              typesDir: pages.typesDir ?? options.mcp?.typesDir ?? (process.env.OA_TYPES_DIR?.trim() || DEFAULT_TYPES_DIR),
              clientDir: pages.clientDir ?? join(options.uiDir, 'frame-host', 'client'),
            }),
            siteTypes!,
          ),
          siteTypes,
          network: pages.network ?? parsePageNetwork(process.env),
        }
      : null,
    events,
    log,
    access: { groupsOf: (id) => catalog.userGroups(id) },
    linkPresence,
    ...(plugins ? { plugins } : {}),
  });
  const services = nodeServices({ catalog, config, rooms, events, uiDir: options.uiDir, ...(options.reloadUi ? { reloadUi: true } : {}), ...(options.trashDays !== undefined ? { trashDays: options.trashDays } : {}), linkOnline: (userId) => linkPresence.online(userId), ...(plugins ? { plugins } : {}), pluginRegistry });
  forget = async (artifactId) => {
    await forgetPluginRoles(catalog, artifactId);
    services.access.invalidate(artifactId);
    if (artifactId) await rooms.refresh(artifactId);
    else await rooms.refreshAll();
  };
  const link = nodeLinkServices({ rooms, catalog, events, presence: linkPresence, archive: services.archive, version: HOST_VERSION, log });
  if (pages) log(`types: published types ${config.typesPublish === 'off' ? 'off (OA_TYPES_PUBLISH=off)' : `by ${config.typesPublish ?? 'admins'} (OA_TYPES_PUBLISH)`}; kept under ${join(env.dataDir, 'types')}`);

  // The app origin's routes: the app's own, then the Link API.
  const router = appRouter(options.providers ? { providers: options.providers } : {});
  linkApiRoutes(router, link);
  connectedAppRoutes(router);
  const appHandler = createAppHandler({ router });
  // Remote MCP and its OAuth are machine routes, outside the app's same-origin rule for writes.
  const mcp = await nodeMcpServices({
    rooms,
    events,
    access: services.access,
    contentTitle: link.contentTitle,
    ...(link.pages ? { pages: link.pages } : {}),
    version: HOST_VERSION,
    typesDir: options.mcp?.typesDir ?? (process.env.OA_TYPES_DIR?.trim() || undefined),
    ...(options.mcp?.cimd ? { cimd: options.mcp.cimd } : {}),
  });
  // The OAuth authorization page reads the session cookie: the same duplicate-cookie guard as the app's routes.
  const handleMcp = guardAppOrigin<AppCtx>(mcpRoutes({ config: options.mcp?.config ?? parseMcpConfig(process.env, config), services: mcp, ...(options.mcp?.waitCapMs ? { waitCapMs: options.mcp.waitCapMs } : {}) }));
  const handler: Handler<AppCtx> = (request, ctx) => (isMcpPath(new URL(request.url).pathname) ? handleMcp(request, ctx) : appHandler(request, ctx));
  const ctx: AppCtx = { config, catalog, now: () => new Date(), log, ...services, ...(plugins ? { plugins } : {}) };
  const appOrigin = new URL(config.appOrigin);

  const app = nodeHandler(handler, () => ctx, {
    maxBodyBytes: (req) => maxBodyBytesOf(req.url),
    log,
    origin: (req: IncomingMessage) => {
      const proto = options.trustProxy ? firstHeader(req.headers['x-forwarded-proto']) : undefined;
      return `${proto === 'https' || proto === 'http' ? proto : appOrigin.protocol.slice(0, -1)}://${req.headers.host ?? appOrigin.host}`;
    },
  });
  const dispatch = dispatchByHost({ rooms, app, originAgentCluster: isPotentiallyTrustworthyOrigin(config.contentOrigin) });
  const forwarded = (req: IncomingMessage): void => {
    if (!options.trustProxy) return;
    const host = firstHeader(req.headers['x-forwarded-host']);
    if (host) req.headers.host = host;
  };
  // The app answers only on its own host, in every mode, as the Cloudflare host does: a proxy's wildcard or the DNS
  // may send any name here (`login.example.com` under the artifacts' domain), and a sign-in page under it would be
  // same-site with every artifact. A content host goes to the rooms; anything else is refused before any handler.
  const refused = (req: IncomingMessage): Response | null => {
    const proto = options.trustProxy ? firstHeader(req.headers['x-forwarded-proto']) : undefined;
    const kind = hostKindOf(config, req.headers.host, proto ?? appOrigin.protocol.slice(0, -1));
    return kind.kind === 'stray' || kind.kind === 'malformed' ? wrongHostResponse(kind) : null;
  };
  const server = createServer({ requestTimeout: 0 }, (req, res) => {
    // The health check answers on any name: a load balancer probes by address.
    if (req.url === HEALTH_PATH && (req.method === 'GET' || req.method === 'HEAD')) return void health(driver, res);
    forwarded(req);
    const refusal = refused(req);
    if (refusal) return void sendResponse(res, refusal, { head: req.method === 'HEAD' });
    dispatch.request(req, res);
  });
  // Behind a proxy that keeps upstream connections open (Caddy: 2 min, ALB: 60 s), close idle ones later than it does,
  // so it never sends a request on a connection this side has just closed (a spurious 502).
  if (options.trustProxy) {
    server.keepAliveTimeout = PROXY_KEEP_ALIVE_MS;
    server.headersTimeout = PROXY_KEEP_ALIVE_MS + 5_000;
  }
  server.on('upgrade', (req, socket, head) => {
    forwarded(req);
    const refusal = refused(req);
    if (refusal) return void socket.end(`HTTP/1.1 ${refusal.status} ${refusal.status === 421 ? 'Misdirected Request' : 'Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    dispatch.upgrade(req, socket, head);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.port, env.bind, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;

  const ownerKey = await ensureOwnerKey({ config, catalog, now: () => new Date(), log });

  const upkeep = async (): Promise<void> => {
    try {
      const sessions = await catalog.purgeExpiredSessions();
      const codes = await catalog.expireDeviceCodes();
      // As the purge route does: forget cached answers, tell the Library (the catalog row went with the folder).
      const purgedIds: string[] = [];
      const trashed = await purgeExpiredTrash(catalog, async (id) => {
        await services.removeArtifact!(id);
        purgedIds.push(id);
      }, {
        days: options.trashDays ?? DEFAULT_TRASH_DAYS,
        log,
        ...(plugins ? { onPurged: (artifact: Parameters<typeof artifactRef>[0]) => emitEvent({ plugins }, 'artifact.deleted', { artifact: artifactRef(artifact), by: { kind: 'system', id: null }, reason: 'expired' }) } : {}),
      });
      if (pluginRegistry) await purgeExpiredPluginKv(driver);
      for (const id of purgedIds.splice(0)) {
        services.access.invalidate(id);
        events.emit('artifact-changed', { id });
        events.emit('access-changed', { id });
      }
      if (sessions || codes || trashed) log(`upkeep: purged ${sessions} expired session(s), ${codes} device code(s), ${trashed} artifact(s) from the trash`);
    } catch (error) {
      log(`upkeep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await upkeep();
  const timer = setInterval(() => void upkeep(), options.upkeepMs ?? UPKEEP_MS);
  timer.unref();

  let stopping: Promise<void> | null = null;
  return {
    listening: `http://${env.bind.includes(':') ? `[${env.bind}]` : env.bind}:${port}`,
    port,
    config,
    catalog,
    rooms,
    events,
    link,
    server,
    ownerKey,
    plugins: pluginRegistry,
    stop() {
      stopping ??= (async () => {
        clearInterval(timer);
        link.stop();
        const closed = new Promise<void>((done) => server.close(() => done()));
        server.closeAllConnections();
        await rooms.stop();
        await closed;
        await pluginRegistry?.idle();
        driver.close();
      })();
      return stopping;
    },
  };
}
