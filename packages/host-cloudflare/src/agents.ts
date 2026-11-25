/**
 * Agents on the Cloudflare host: the Link API a local daemon publishes through, and remote MCP with OAuth. Both are
 * the host core's routes (`linkApiRoutes`, `mcpHandler`), over services built here from the artifact's object
 * (`RoomClient`) and the site hub, as the Node host builds them over its rooms (`node/link.ts`, `node/mcp.ts`).
 *
 * - The core's routes emit events on their services; a Worker's events must leave through the request's
 *   `waitUntil` (`ForwardingEvents`). So the agent routes are mounted per request, over that request's services:
 *   {@link linkDispatch} and {@link mcpDispatch}. The device sign-in (`device`, `token`, the `/link/device` page) is
 *   mounted once, so its rate limit counts across the isolate's requests.
 * - The Link's event stream is served by the hub (`hub.ts`): the Worker forwards it.
 * - Request bodies are capped lower than the core's (the Worker holds a body whole in a 128 MB isolate, and the object
 *   holds it again): {@link CLOUDFLARE_LINK_LIMITS}, which `link.hello` advertises instead of the core's constants.
 * - The installed types (`McpTypeService`) come from the build's table (each type's manifest and skill text), with
 *   the type server's own definitions for what it adds (store, comments, actions), as `readMcpTypes` reads them; the
 *   free-page type `page` is listed only while the site runs pages (as on Node).
 * - Page artifacts (`pages`, while the site runs them): `link.hello` says `features.pages`, `link.capabilities` and
 *   MCP set what a page declares through its object, and a change not made by the Link reaches the owner's Link as
 *   an `artifact` event with `capabilities`.
 * - The client metadata fetcher uses the Workers `fetch` and has no DNS lookup (Workers has no resolver to ask): the
 *   core still refuses literal private and loopback addresses and local names, any scheme but https, a redirect to
 *   another host, slow and large answers. A public name that resolves to a private address is not caught here; the
 *   Workers runtime does not route a subrequest into the deployment's private network, which is what that check
 *   guards on the Node host.
 */

import { LINK_API_PREFIX, LINK_ROUTES, type LinkHello } from '@open-artifact/protocol';
import { actionsOfType, isTypeName, TYPES } from '@open-artifact/type-server';
import {
  httpError,
  json,
  LINK_AUTHOR,
  LINK_REFUSED_ACTIONS,
  linkApiRoutes,
  mcpHandler,
  parseMcpConfig,
  Router,
  type AppCtx,
  type ArtifactFiles,
  type LinkServices,
  type McpConfig,
  type McpServices,
  type McpTypeAction,
  type McpTypeInfo,
  type McpTypeService,
  type PageServices,
} from '@open-artifact/host';
import { PAGE_TITLE, PAGE_TYPE, type FrameBuild } from './frames.ts';
import { LINK_EVENTS_PATH } from './hub.ts';
import type { TypeEntry } from './site.ts';
import type { RoomClient } from './room-calls.ts';

/**
 * What a Link request may carry here, and what `link.hello` says (the core's are 100 MiB and 64 MiB).
 *
 * - `maxBodyBytes` 32 MiB: an import's zip or a `files` push's JSON is read whole by the Worker, sent to the
 *   artifact's object and parsed there again, each inside a 128 MB isolate. The same cap as an uploaded archive.
 * - `maxFileBytes` 16 MiB: one file, base64 in a `files` push (21.4 MiB), fits that body with room for others.
 */
export const CLOUDFLARE_LINK_LIMITS: LinkHello['limits'] = { maxBodyBytes: 32 * 1024 * 1024, maxFileBytes: 16 * 1024 * 1024 };
/** The largest `/mcp` request body here: the core's 32 MiB (`MCP_MAX_BODY_BYTES`). */
export const CLOUDFLARE_MCP_MAX_BODY_BYTES = 32 * 1024 * 1024;
/**
 * The longest `ArtifactComments wait`: the core's 25 s. A Worker may wait on a client for as long as it stays
 * connected (no wall-clock limit while the client is there; the CPU spent waiting is near nothing), and the call
 * polls the outbox every 2 s, so a wait costs at most 13 small D1 reads. 25 s stays under the 30 s or 60 s request
 * timeouts that proxies and MCP clients put on one call.
 */
export const CLOUDFLARE_MCP_WAIT_CAP_MS = 25_000;

/** The Link route names served per request (all but the device sign-in's, and the events stream the hub serves). */
const AGENT_ROUTES = Object.values(LINK_ROUTES).filter((name) => name !== LINK_ROUTES.device && name !== LINK_ROUTES.token && name !== LINK_ROUTES.events);
/** The routes whose body may be large (capped at {@link CLOUDFLARE_LINK_LIMITS}). */
const LARGE_BODIES: ReadonlySet<string> = new Set([LINK_ROUTES.import, LINK_ROUTES.files, LINK_ROUTES.call].map((name) => `${LINK_API_PREFIX}${name}`));

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/** What the agent services need of the site (the `Site`, or a test's stand-in). */
export interface AgentSite {
  readonly build: { version: string; types: readonly TypeEntry[]; frames?: FrameBuild };
  /** Whether the site runs page artifacts (null: not). */
  readonly pages?: { build: FrameBuild } | null;
  room(id: string): RoomClient;
  /** Permanently deletes an artifact's object. */
  removeArtifact(id: string): Promise<void>;
  /** Forwards a stream request to the hub. */
  readonly hub: { stream(request: Request): Promise<Response> };
}

/** A request whose body errors past `max` bytes (a declared length past it is refused at once). */
export function cappedRequest(request: Request, max: number, what = 'The request body'): Request {
  const tooLarge = (): Error => httpError('too_large', `${what} is larger than ${max} bytes, the most this host takes.`, { status: 413 });
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  if (!request.body) return request;
  let size = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > max) controller.error(tooLarge());
      else controller.enqueue(chunk);
    },
  });
  return new Request(request, { body: request.body.pipeThrough(counter), duplex: 'half' } as RequestInit);
}

/** An artifact's files through its object. */
export function roomFiles(site: Pick<AgentSite, 'room'>): ArtifactFiles {
  return {
    manifest: (id) => site.room(id).manifest(),
    read: (id, path) => site.room(id).readFile(path),
    write: (id, writes, author) => site.room(id).writeFiles(writes, author),
  };
}

/** Page artifacts' declared capabilities through their object (the Node site's `pageServices`). */
export function roomPageServices(site: Pick<AgentSite, 'room'>, events: Pick<AppCtx['events'], 'emit'>): PageServices {
  return {
    capabilities: (id) => site.room(id).capabilities(),
    async setCapabilities(id, capabilities, author) {
      const changed = await site.room(id).setCapabilities(capabilities);
      if (changed && author !== LINK_AUTHOR) events.emit('artifact-changed', { id, author, capabilities });
    },
  };
}

/** The Link services for one request. */
export function cloudflareLinkServices(site: AgentSite, ctx: AppCtx): LinkServices {
  return {
    ...(site.pages ? { pages: roomPageServices(site, ctx.events) } : {}),
    files: roomFiles(site),
    importArchive: (id, bytes) => ctx.importArchive(id, bytes),
    removeArtifact: (id) => site.removeArtifact(id),
    archive: (id, method) => ctx.archive(id, method),
    action: (id, name, args) => site.room(id).action(name, args),
    contentTitle: (id, type) => site.room(id).contentTitle(type),
    refreshAccess: (id) => ctx.refreshAccess(id),
    // The hub keeps who is online (its Link streams); nothing here opens one.
    presence: { connected: () => undefined, disconnected: () => undefined, online: () => false },
    events: ctx.events,
    version: site.build.version,
  };
}

/** Registers the Link API on the app router: the device sign-in once, the rest per request ({@link linkDispatch}). */
export function cloudflareLinkRoutes(router: Router<AppCtx>, site: AgentSite): void {
  const dispatch = linkDispatch(site);
  router.get(LINK_EVENTS_PATH, async (request) => site.hub.stream(request));
  for (const name of AGENT_ROUTES) router.on('*', `${LINK_API_PREFIX}${name}`, dispatch);
  // The device sign-in routes (and nothing else is matched by them: every agent route was registered above).
  linkApiRoutes(router, unusedLinkServices(site.build.version));
}

/** One Link request, over that request's services. */
export function linkDispatch(site: AgentSite): (request: Request, ctx: AppCtx) => Promise<Response> {
  return async (request, ctx) => {
    const path = new URL(request.url).pathname;
    const router = linkApiRoutes(new Router<AppCtx>(), cloudflareLinkServices(site, ctx));
    if (path === `${LINK_API_PREFIX}${LINK_ROUTES.hello}`) {
      const answer = await router.handle(request, ctx);
      if (!answer.ok) return answer;
      const hello = (await answer.json()) as LinkHello;
      return json({ ...hello, limits: CLOUDFLARE_LINK_LIMITS } satisfies LinkHello);
    }
    if (request.method === 'POST' && LARGE_BODIES.has(path)) request = cappedRequest(request, CLOUDFLARE_LINK_LIMITS.maxBodyBytes);
    return router.handle(request, ctx);
  };
}

/** Services for the routes that use none (the device sign-in). */
function unusedLinkServices(version: string): LinkServices {
  const never = (): never => {
    throw httpError('server_failed', 'This Link route is served per request.', { status: 500 });
  };
  return {
    files: { manifest: never, read: never, write: never },
    importArchive: never,
    removeArtifact: never,
    archive: never,
    action: never,
    contentTitle: never,
    refreshAccess: never,
    presence: { connected: never, disconnected: never, online: () => false },
    events: { emit: never, on: never } as unknown as LinkServices['events'],
    version,
  };
}

/** The actions of a type a hosted agent may run (the Node host's `mcpActionsOf`). */
export function mcpActionsOf(type: string): McpTypeAction[] {
  if (!isTypeName(type)) return [];
  return actionsOfType(type)
    .filter((action) => !LINK_REFUSED_ACTIONS.has(action.name))
    .map((action) => ({ name: action.name, title: action.title, effect: action.effect, schema: action.schema }));
}

/** The free-page type as the agent tools describe it (the Node host's `pageTypeInfo`). */
export function pageTypeInfo(manifest: Record<string, unknown>): McpTypeInfo {
  return {
    id: PAGE_TYPE,
    title: typeof manifest.title === 'string' ? manifest.title : PAGE_TITLE,
    description: typeof manifest.description === 'string' ? manifest.description : '',
    intents: strings(manifest.intents),
    ...(typeof manifest.when === 'string' ? { when: manifest.when } : {}),
    exports: [],
    uses: [],
    store: 'db',
    comments: true,
    ...(typeof manifest.artifactTitle === 'string' ? { artifactTitle: manifest.artifactTitle } : {}),
    openEarly: false,
    actions: [{ name: 'info', title: 'What the artifact holds', effect: 'read', schema: { type: 'object', properties: {} } }],
  };
}

/**
 * The installed types from the build's table, as the Node host's `readMcpTypes` reads them from `artifact-types`;
 * with `frames` (the site runs pages), the free-page type too.
 */
export function mcpTypesOf(entries: readonly TypeEntry[], frames?: FrameBuild | null): McpTypeService {
  const types = new Map<string, { info: McpTypeInfo; skill: string | null }>();
  for (const frame of frames?.types ?? []) {
    if (frame.id === PAGE_TYPE && frame.page) types.set(PAGE_TYPE, { skill: frame.skill, info: pageTypeInfo(frame.manifest) });
  }
  for (const entry of entries) {
    const id = entry.id;
    if (!isTypeName(id)) continue;
    const manifest = isRecord(entry.manifest) ? entry.manifest : {};
    const oa = isRecord(manifest.openArtifact) ? manifest.openArtifact : {};
    types.set(id, {
      skill: entry.skill ?? null,
      info: {
        id,
        title: typeof manifest.title === 'string' ? manifest.title : TYPES[id].title,
        description: typeof manifest.description === 'string' ? manifest.description : typeof manifest.summary === 'string' ? manifest.summary : '',
        intents: strings(manifest.intents),
        ...(typeof manifest.when === 'string' ? { when: manifest.when } : {}),
        exports: strings(oa.exports),
        uses: strings(oa.uses),
        store: TYPES[id].store ?? null,
        comments: TYPES[id].comments === true || oa.comments === true,
        ...(typeof manifest.artifactTitle === 'string' ? { artifactTitle: manifest.artifactTitle } : {}),
        openEarly: oa.openEarly === true,
        actions: mcpActionsOf(id),
      },
    });
  }
  const list = [...types.values()].map((t) => t.info).sort((a, b) => a.id.localeCompare(b.id));
  return {
    list: () => list,
    get: (id) => types.get(id)?.info ?? null,
    skill: (id) => types.get(id)?.skill ?? null,
  };
}

/** The remote MCP services for one request. */
export function cloudflareMcpServices(site: AgentSite, ctx: AppCtx, types: McpTypeService, fetcher: McpServices['cimd']['fetch'] = (url, init) => fetch(url, init)): McpServices {
  return {
    types,
    ...(site.pages ? { pages: roomPageServices(site, ctx.events) } : {}),
    create: (artifact) => site.room(artifact.id).create(artifact.type, artifact.title),
    files: roomFiles(site),
    action: (id, name, args) => site.room(id).action(name, args),
    contentTitle: (id, type) => site.room(id).contentTitle(type),
    refreshAccess: (id) => ctx.refreshAccess(id),
    events: ctx.events,
    access: ctx.access,
    // No `lookup`: see the module comment.
    cimd: { fetch: fetcher },
    version: site.build.version,
  };
}

/** Answers `/mcp`, the discovery documents and `/oauth/*` (the paths `isMcpPath` names), over this request's services. */
export function mcpDispatch(site: AgentSite, env: Record<string, string | undefined>, appOrigin: string, options: { fetch?: McpServices['cimd']['fetch'] } = {}): (request: Request, ctx: AppCtx) => Promise<Response> {
  const config: McpConfig = parseMcpConfig(env, { appOrigin });
  const types = mcpTypesOf(site.build.types, site.pages?.build);
  return async (request, ctx) => {
    const handler = mcpHandler({ config, services: cloudflareMcpServices(site, ctx, types, options.fetch), waitCapMs: CLOUDFLARE_MCP_WAIT_CAP_MS });
    if (request.method === 'POST') request = cappedRequest(request, CLOUDFLARE_MCP_MAX_BODY_BYTES);
    return handler(request, ctx);
  };
}
