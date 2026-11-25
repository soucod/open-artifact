/**
 * The core app tests' fixture (`packages/host/test/app-fixture.ts`) with the product Worker behind it: the same
 * {@link TestApp}, but every request goes through {@link Site.fetch} with a Worker `env`:
 *
 * - `DB`: the D1 fake (D1's rules) in a temp folder, migrated as the Worker does;
 * - `HUB`: a stub over an in-process {@link SiteHub}, so the Library stream is served from the hub, and `events` is
 *   the hub's (what the tests emit reaches the streams; what the Worker emits is forwarded there);
 * - `ROOMS`: a stub per artifact answering the Worker's room calls as the core fixture's fake platform does (import
 *   reads `{type, title}` JSON, the archive is `PK-fake`, refresh is recorded, `connected` from {@link TestApp.online});
 * - `ASSETS`: the one Shell file the core fixture serves.
 *
 * `site-app-hooks.ts` puts it in place of `./app-fixture.ts` for the files in
 * `packages/host/test/`. The constants and helpers are the core fixture's own.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenArtifactError } from '@open-artifact/protocol';
import { Catalog, HostEvents, sessionCookie, type AppCtx, type AppServices, type HostEventMap, type PrincipalRef, type Router } from '@open-artifact/host';
import { HOME_HTML, SHELL_HTML, SIGNING_KEY, TYPES, bootOf, cookiesSet, type RequestOptions, type TestApp } from '../../host/test/app-fixture.ts';
import type { ExecutionContext, ProductEnv } from '../src/bindings.ts';
import { SiteHub } from '../src/hub.ts';
import { ROOM_CALL_HEADER } from '../src/room-calls.ts';
import { Site } from '../src/site.ts';
import { fakeD1 } from './d1-fake.ts';

export { HOME_HTML, SHELL_HTML, SIGNING_KEY, TYPES, bootOf, cookiesSet, type RequestOptions, type TestApp };

/** An owner key for the fixture (the Cloudflare host requires one while owner-key sign-in is on). */
export const OWNER_KEY = 'fixture-owner-key-0123456789';

export interface FakeOptions {
  env?: Record<string, string>;
  importArchive?: AppServices['importArchive'];
  /** Not supported here: the product router is the Worker's own (a test that mounts one is skipped by the caller). */
  router?: Router<AppCtx>;
  /** Host plugins, bundled into the Worker as `<id>` and listed in `OA_PLUGINS` (as the core fixture takes them). */
  plugins?: Array<{ plugin: unknown; config?: Record<string, unknown>; use?: string; enabled?: boolean; timeoutMs?: number; cacheSeconds?: number }>;
  /** Not supported here: plugins use the global `fetch`. */
  pluginFetch?: typeof fetch;
}

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

function errorJson(error: unknown): Response {
  const status = error instanceof OpenArtifactError ? (error.status ?? 400) : 500;
  const code = error instanceof OpenArtifactError ? error.code : 'server_failed';
  return Response.json({ code, message: error instanceof Error ? error.message : String(error) }, { status });
}

export async function makeApp(options: FakeOptions = {}): Promise<TestApp> {
  if (options.router) throw new Error('The Cloudflare fixture serves the Worker\'s own router.');
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-site-app-'));
  const db = fakeD1(join(dir, 'catalog.db'));
  const heard = { 'artifact-touched': [], 'artifact-changed': [], 'access-changed': [], outbox: [], 'agent-changed': [] } as unknown as TestApp['heard'];
  const refreshed: string[] = [];
  const online = new Map<string, PrincipalRef[]>();
  const logs: string[] = [];
  const importArchive = options.importArchive ?? fakeImport;

  let hub: SiteHub | null = null;
  const pluginModules: Record<string, unknown> = {};
  const pluginList = (options.plugins ?? []).map((item) => {
    const { plugin, use, ...rest } = item;
    const name = use ?? (plugin as { id?: string } | null)?.id ?? 'plugin';
    pluginModules[name] = plugin;
    return { use: name, ...rest };
  });
  const env: ProductEnv = {
    OA_SIGNING_KEYS: SIGNING_KEY,
    OA_OWNER_KEY: OWNER_KEY,
    ...options.env,
    ...(pluginList.length > 0 ? { OA_PLUGINS: JSON.stringify(pluginList) } : {}),
    DB: db,
    ASSETS: {
      async fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === '/_open-artifact/shell/assets/index-Ab12.js') {
          return new Response('/* shell */', { headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable' } });
        }
        return new Response('Not found', { status: 404 });
      },
    },
    HUB: {
      idFromName: (name) => ({ toString: () => name, name }),
      get: () => ({ fetch: (request: Request) => hub!.fetch(request) }),
    },
    ROOMS: {
      idFromName: (name) => ({ toString: () => name, name }),
      get: (objectId) => ({
        async fetch(request: Request): Promise<Response> {
          // A page: it says whether a Cookie header reached it, and tries to set one (the Worker must drop both).
          if (request.headers.get(ROOM_CALL_HEADER) !== '1') {
            return new Response('a page of the fake room', { headers: { 'content-type': 'text/plain', 'set-cookie': 'room=1; Path=/', 'x-room-saw-cookie': request.headers.has('cookie') ? 'yes' : 'no' } });
          }
          const url = new URL(request.url);
          const id = url.searchParams.get('id') ?? objectId.toString();
          try {
            switch (url.pathname.slice(1)) {
              case 'import':
                return Response.json(await importArchive(id, new Uint8Array(await request.arrayBuffer())));
              case 'archive':
                return new Response(request.method === 'HEAD' ? null : 'PK-fake', { headers: { 'content-type': 'application/zip' } });
              case 'refresh':
                refreshed.push(id);
                return Response.json({ dropped: 0 });
              case 'connected':
                return Response.json(online.get(id) ?? []);
              case 'destroy':
                return Response.json({ ok: true });
              default:
                return Response.json({ code: 'not_found', message: `No call ${url.pathname}.` }, { status: 404 });
            }
          } catch (error) {
            return errorJson(error);
          }
        },
      }),
    },
  };
  const site = new Site(env, { version: '0.0.0-test', types: Object.entries(TYPES).map(([id, title]) => ({ id, title })), shellHtml: SHELL_HTML, homeHtml: HOME_HTML }, { log: (line) => logs.push(line), pluginModules });
  if (site.configError) throw site.configError;
  const catalog: Catalog = await site.ready();
  // A refresh of every room (a plugin forgot every role) is recorded as `*`, as the core fixture does.
  hub = new SiteHub({ config: site.config, catalog: async () => catalog, log: (line) => logs.push(line), refreshRoom: async () => undefined });
  const refreshRooms = hub.refreshRooms.bind(hub);
  hub.refreshRooms = async () => {
    refreshed.push('*');
    return refreshRooms();
  };
  const events: HostEvents = hub.events;
  for (const name of Object.keys(heard) as (keyof HostEventMap)[]) events.on(name, (payload) => void (heard[name] as unknown[]).push(payload));
  const session = sessionCookie(site.config).name;
  const pending: Promise<unknown>[] = [];
  const exec: ExecutionContext = { waitUntil: (promise) => void pending.push(promise) };
  const ctx: AppCtx = { config: site.config, catalog, now: () => new Date(), log: (line) => logs.push(line), ...site.services(exec) };

  return {
    config: site.config,
    catalog,
    events,
    ctx,
    plugins: site.plugins,
    heard,
    refreshed,
    online,
    logs,
    async fetch(path, request = {}) {
      const method = request.method ?? (request.body === undefined ? 'GET' : 'POST');
      const headers = new Headers(request.headers);
      if (request.cookie) headers.set('cookie', request.cookie);
      const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (write && request.origin !== null && !headers.has('origin')) headers.set('origin', request.origin ?? site.config.appOrigin);
      let body: BodyInit | undefined;
      if (request.body instanceof Uint8Array || typeof request.body === 'string') body = request.body as BodyInit;
      else if (request.body !== undefined) {
        body = JSON.stringify(request.body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
      const url = path.startsWith('http') ? path : `${site.config.appOrigin}${path}`;
      const response = await site.fetch(new Request(url, { method, headers, ...(body === undefined ? {} : { body }), ...(request.signal ? { signal: request.signal } : {}) }), exec);
      // What the Worker hands `waitUntil` (events forwarded to the hub) is done before the test looks.
      while (pending.length) await pending.shift();
      return response;
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
      // The hub keeps who has a Link connected; it tells the streams when that flips.
      hub!.setOnline(userId, 'fixture', online);
    },
    async close() {
      db.sqlite.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
