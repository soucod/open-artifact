/**
 * An app origin for the core app tests: a fresh catalog (node:sqlite in a temp folder), the real `AccessCache` and
 * `HostEvents`, fake platform services (page addresses, archives, the built pages), the handler of
 * `createAppHandler`, and helpers to make people and their session cookies.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenArtifactError } from '@open-artifact/protocol';
import { createAppHandler, type AppCtx, type AppServices } from '../src/core/app/index.ts';
import { HOME_BOOT_PLACEHOLDER, SHELL_BOOT_PLACEHOLDER } from '../src/core/app/pages.ts';
import { AccessCache, type PrincipalRef } from '../src/core/authz/access.ts';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { parseConfig } from '../src/core/config.ts';
import { HostEvents, type HostEventMap } from '../src/core/events.ts';
import { sessionCookie, type Router } from '../src/core/http.ts';
import { contentOriginOf } from '../src/core/page-token.ts';
import type { ArtifactRow, HostConfig, UserRecord } from '../src/core/types.ts';
import { openSqlite } from '../src/node/sqlite.ts';
import { forgetPluginRoles, pluginServices, startSitePlugins, type Plugins } from '../src/core/plugins/index.ts';

export const SIGNING_KEY = 's'.repeat(40);

/** The fake Shell template: one inline script holding the boot placeholder. */
export const SHELL_HTML = `<!doctype html><html><head><script>window.__OPEN_ARTIFACT_BOOT__=${SHELL_BOOT_PLACEHOLDER};</script><script type="module" src="/_open-artifact/shell/assets/index-Ab12.js"></script></head><body></body></html>`;
/** The fake home template. */
export const HOME_HTML = `<!doctype html><html><head><script>window.__OPEN_ARTIFACT_HOME__=${HOME_BOOT_PLACEHOLDER};</script></head><body></body></html>`;

/** The fake types this host has. */
export const TYPES: Record<string, string> = { whiteboard: 'Whiteboard', design: 'Design', docs: 'Docs' };

export interface RequestOptions {
  method?: string;
  /** Cookies as `name=value` pairs, e.g. from {@link TestApp.cookieOf}. */
  cookie?: string;
  headers?: Record<string, string>;
  /** JSON (an object) or raw bytes/text. */
  body?: unknown;
  /** The `Origin` of a write (the app origin unless given; `null` sends none). */
  origin?: string | null;
  /** Aborts the request (an event stream's end). */
  signal?: AbortSignal;
}

export interface TestApp {
  config: HostConfig;
  catalog: Catalog;
  events: HostEvents;
  ctx: AppCtx;
  /** The running plugins (undefined without any). */
  plugins: Plugins | undefined;
  /** Events emitted, by name. */
  heard: { [N in keyof HostEventMap]: HostEventMap[N][] };
  /** Artifacts whose page connections `refreshAccess` was asked to re-check. */
  refreshed: string[];
  /** The principals the fake rooms say are connected, by artifact. */
  online: Map<string, PrincipalRef[]>;
  logs: string[];
  fetch(path: string, options?: RequestOptions): Promise<Response>;
  /** A person with a session; `cookie` is their `Cookie` header. */
  person(name: string, email?: string | null, extra?: { siteRole?: 'admin' | 'member' }): Promise<{ user: UserRecord; cookie: string }>;
  artifact(owner: UserRecord, patch?: { type?: string; title?: string; generalAccess?: 'restricted' | 'link' | 'public' }): Promise<ArtifactRow>;
  /** A computer the user linked connects (a Link stream opens) or goes away, as the platform's presence registry hears it. */
  setLinkOnline(userId: string, online: boolean): void;
  close(): Promise<void>;
}

/** Options of the fake platform. */
export interface FakeOptions {
  env?: Record<string, string>;
  /** The import stub: bytes are UTF-8 JSON `{type, title}`; `{"bad": true}` is refused like a broken zip. */
  importArchive?: AppServices['importArchive'];
  /** The router behind the origin rules (default: `appRouter()`), e.g. with the Link API mounted as the Node host does. */
  router?: Router<AppCtx>;
  /** Host plugins to run (each `{plugin, config?}`, its `use` its id), as a site's list would start them. */
  plugins?: Array<{ plugin: unknown; config?: Record<string, unknown>; use?: string; enabled?: boolean; timeoutMs?: number; cacheSeconds?: number }>;
  /** `fetch` as the plugins' `ctx.fetch` sees it. */
  pluginFetch?: typeof fetch;
}

/** The default import stub (see {@link FakeOptions.importArchive}). */
async function fakeImport(_id: string, bytes: Uint8Array): Promise<{ type: string; title: string }> {
  let parsed: { type?: string; title?: string; bad?: boolean };
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as typeof parsed;
  } catch {
    throw new OpenArtifactError('invalid_archive', 'Not a zip.', { status: 400 });
  }
  if (parsed.bad) throw new OpenArtifactError('invalid_archive', 'Not an artifact archive.', { status: 400 });
  return { type: parsed.type ?? 'whiteboard', title: parsed.title ?? 'Imported' };
}

export async function makeApp(options: FakeOptions = {}): Promise<TestApp> {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-app-'));
  const driver = openSqlite(join(dir, 'catalog.db'));
  const config = parseConfig({ OA_SIGNING_KEYS: SIGNING_KEY, ...options.env });
  const catalog = await Catalog.open(driver, { signingKeys: config.signingKeys });
  const events = new HostEvents();
  const heard = { 'artifact-touched': [], 'artifact-changed': [], 'access-changed': [], outbox: [], 'agent-changed': [] } as unknown as TestApp['heard'];
  const record = <N extends keyof HostEventMap>(name: N): void => {
    events.on(name, (payload) => {
      heard[name].push(payload);
    });
  };
  for (const name of Object.keys(heard) as (keyof HostEventMap)[]) record(name);
  const refreshed: string[] = [];
  const online = new Map<string, PrincipalRef[]>();
  const logs: string[] = [];
  let minted = 0;
  const linked = new Set<string>();
  let access: AccessCache | null = null;
  const started = startSitePlugins({
    loaded: (options.plugins ?? []).map((item) => {
      const id = (item.plugin as { id?: string } | null)?.id ?? 'plugin';
      const { plugin, use, ...rest } = item;
      return { entry: { use: use ?? id, ...rest }, plugin };
    }),
    env: options.env ?? {},
    catalog,
    log: (line) => logs.push(line),
    services: pluginServices({
      catalog,
      config,
      version: '0.0.0-test',
      ...(options.pluginFetch ? { fetch: options.pluginFetch } : {}),
      invalidateAccess: async (artifactId) => {
        await forgetPluginRoles(catalog, artifactId);
        access?.invalidate(artifactId);
        refreshed.push(artifactId ?? '*');
      },
    }),
  });
  const plugins = started.active;
  access = new AccessCache(catalog, config, { groupsOf: (id) => catalog.userGroups(id), ...(plugins ? { plugins } : {}) });
  const services: AppServices = {
    events,
    access,
    pluginDescriptions: () => started.registry?.describe() ?? [],
    async pageFor(artifact, principal, role) {
      const pageUrl = `${contentOriginOf(config, artifact.id)}/${artifact.type}/tok${++minted}.${principal.kind}.${role}/`;
      return { pageUrl, url: `${pageUrl}?open_artifact_shell=${encodeURIComponent(config.appOrigin)}` };
    },
    async refreshAccess(id) {
      refreshed.push(id);
    },
    typeInfo: (type) => (TYPES[type] ? { title: TYPES[type] } : null),
    async archive(id, method) {
      const headers = { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${id}.zip"` };
      return new Response(method === 'HEAD' ? null : 'PK-fake', { headers });
    },
    importArchive: options.importArchive ?? fakeImport,
    shellHtml: async () => SHELL_HTML,
    homeHtml: async () => HOME_HTML,
    connected: (id) => online.get(id) ?? [],
    async uiFile(pathname) {
      if (pathname === '/_open-artifact/shell/assets/index-Ab12.js') return new Response('/* shell */', { headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable' } });
      return null;
    },
    version: '0.0.0-test',
    linkOnline: (userId) => linked.has(userId),
  };
  const ctx: AppCtx = { config, catalog, now: () => new Date(), log: (line) => logs.push(line), ...services, ...(plugins ? { plugins } : {}) };
  const handler = createAppHandler(options.router ? { router: options.router } : {});
  const session = sessionCookie(config).name;

  return {
    config,
    catalog,
    events,
    ctx,
    plugins,
    heard,
    refreshed,
    online,
    logs,
    async fetch(path, request = {}) {
      const method = request.method ?? (request.body === undefined ? 'GET' : 'POST');
      const headers = new Headers(request.headers);
      if (request.cookie) headers.set('cookie', request.cookie);
      const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (write && request.origin !== null && !headers.has('origin')) headers.set('origin', request.origin ?? config.appOrigin);
      let body: BodyInit | undefined;
      if (request.body instanceof Uint8Array || typeof request.body === 'string') body = request.body as BodyInit;
      else if (request.body !== undefined) {
        body = JSON.stringify(request.body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
      const url = path.startsWith('http') ? path : `${config.appOrigin}${path}`;
      return handler(new Request(url, { method, headers, ...(body === undefined ? {} : { body }), ...(request.signal ? { signal: request.signal } : {}) }), ctx);
    },
    async person(name, email = `${name.toLowerCase()}@example.com`, extra = {}) {
      const user = await catalog.createUser({ name, ...(email ? { email, emailVerified: true } : {}), ...(extra.siteRole ? { siteRole: extra.siteRole } : {}) });
      const { token } = await catalog.createSession({ userId: user.id, ttlMs: 3600_000 });
      return { user, cookie: `${session}=${token}` };
    },
    artifact(owner, patch = {}) {
      return catalog.createArtifact({ type: patch.type ?? 'whiteboard', title: patch.title ?? 'Board', ownerUser: owner.id, ...(patch.generalAccess ? { generalAccess: patch.generalAccess } : {}) });
    },
    setLinkOnline(userId, online) {
      if (online === linked.has(userId)) return;
      if (online) linked.add(userId);
      else linked.delete(userId);
      // As the Node host's presence registry tells it.
      events.emit('agent-changed', { userId });
    },
    async close() {
      driver.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** The `name=value` of every cookie a response sets. */
export function cookiesSet(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of response.headers.getSetCookie()) {
    const first = line.split(';')[0]!;
    const eq = first.indexOf('=');
    out[first.slice(0, eq)] = first.slice(eq + 1);
  }
  return out;
}

/** The boot JSON inlined into a built page. */
export function bootOf(html: string, name = '__OPEN_ARTIFACT_BOOT__'): unknown {
  const match = new RegExp(`window\\.${name}=(.*?);</script>`).exec(html);
  if (!match) throw new Error('no boot in the page');
  return JSON.parse(match[1]!);
}
