/**
 * Rooms: the type server the Node host embeds, and who each content-origin request is.
 *
 * One type server (all built-in types) serves every artifact, each on its own content host
 * (`<label>.content…`, `page-token.ts`). The host is that server's daemon and its identity source
 * (`TypeServerHosting`):
 *
 * - A page's address carries a page token the host signed for one person (`pageFor`). On every request the token's
 *   signature, artifact (the Host header's), site epoch and expiry are checked, and the person's CURRENT role is
 *   looked up in the catalog (`AccessCache`, decision 15); the token's own role and `grants_version` are hints only.
 *   No access now: refused. The owner (or a site admin) is the page's `owner`; everybody else keeps their own id.
 * - The type server's daemon calls (`TypeApiLike`) land here: a wake goes into the owner's outbox for their linked
 *   agent (`via: 'link'`; an editor's, with who sent it, only while the owner lets editors ask), presence is whether
 *   that agent's Link is connected (else, an MCP client used in the last two hours counts: it reads what is sent in
 *   its next turn), a page write touches the catalog.
 * - After a sharing change `refresh` ends only the page connections whose holder's role moved (and editors' when
 *   whether they may ask the agent moved); they come back with the new one.
 * - Exporting on the type server's side (a doc's file, `hosting.mayExport`) follows the role and the owner's
 *   `viewersCanExport`: the owner, editors and commenters may; a viewer while the owner lets viewers export.
 * - A snapshot token (`s` claim, minted for a remote agent by the MCP `snapshot` call) is a `viewer` whatever the
 *   agent's person may do, needs that person's current access like any token, and is nobody in the page's "who is
 *   here" or the Share panel's online list (its viewer carries no principal); the type server keeps its page
 *   read-only and standalone.
 *
 * The type server's `/__open-artifact/*` routes stay on its own loopback listener behind a random secret
 * (`action`, `internal`).
 */

import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { ARTIFACT_ID, SHELL_PARAMS, shellPath, type OpenArtifactErrorCode, type TypeApiPresence, type TypeApiWakeResult } from '@open-artifact/protocol';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import { createTypeServer, isTypeName, readArtifactTitle, type TypeApiLike, type TypeServer, type TypeServerHosting } from '@open-artifact/type-server';
import { AccessCache, refKey, type AccessCacheOptions, type PrincipalRef } from '../core/authz/access.ts';
import type { Catalog } from '../core/catalog/catalog.ts';
import { MCP_HARNESS, MCP_PRESENT_MS } from '../core/mcp/oauth.ts';
import type { HostEvents } from '../core/events.ts';
import { httpError } from '../core/http.ts';
import { queueDataRefresh } from '../core/link/outbox.ts';
import { artifactOfContentHost, checkPageToken, contentOriginOf, pageTokenClaims, signPageToken, verifyPageToken } from '../core/page-token.ts';
import type { ArtifactRole, ArtifactRow, HostConfig, Principal } from '../core/types.ts';
import { emitEvent, offerWake, type Plugins } from '../core/plugins/index.ts';
import { artifactRef } from '../core/plugins/registry.ts';
import { titleInHtml } from '@open-artifact/protocol';
import { readFile } from 'node:fs/promises';
import { createFrameEngine, PAGE_TYPE, type FrameEngine, type PageNetwork, type SiteFrameTypes } from './frames.ts';
import type { NodeSiteTypes } from './site-types.ts';

/** Whether a user's agent is connected over Link right now. The Link layer implements it; the default says never. */
export interface LinkPresence {
  online(userId: string): boolean;
}

/** The agent name pages show when the owner has never linked one. */
export const DEFAULT_AGENT_NAME = 'Agent';

export interface RoomsOptions {
  config: HostConfig;
  catalog: Catalog;
  /** Artifacts live in `<dataDir>/artifacts/<id>/`. */
  dataDir: string;
  /** The built editors (`NodeHostEnv.assetsDir`). */
  assetsDir: string;
  events: HostEvents;
  linkPresence?: LinkPresence;
  log?: (line: string) => void;
  /** The clock (default: now): page token expiry and the access cache. */
  now?: () => Date;
  /** Access cache settings (`groupsOf`, `maxAgeMs`). */
  access?: Omit<AccessCacheOptions, 'now'>;
  /** The site's plugins (absent: none): their `authz.role` in the access cache, `wake.deliver`, events. */
  plugins?: Plugins;
  /** Closes an artifact with no page and no request for this long, ms (default {@link ROOM_IDLE_CLOSE_MS}; 0: never). */
  idleCloseMs?: number;
  /**
   * The frame engine's types and the pages' network (`frames.ts`): `page` artifacts run on the frame core. Absent or
   * null: no page artifact runs here (one domain for both origins, `OA_CONTENT_SAME_SITE`, or a test without them).
   */
  frames?: { types: SiteFrameTypes; network: PageNetwork; siteTypes?: NodeSiteTypes | null } | null;
}

/** How long an artifact nobody uses stays open on the Node host: ten minutes. */
export const ROOM_IDLE_CLOSE_MS = 10 * 60_000;

export interface HostRooms {
  /** The folder of an artifact: `<dataDir>/artifacts/<id>`. */
  rootOf(id: string): string;
  /**
   * The page address the Shell frames for this principal, `<content origin>/<type>/<page token>/?open_artifact_shell=<app
   * origin>` (as a daemon's `OpenResult.url`), the same without the parameter (`pageUrl`), and the token. Mints the token.
   */
  pageFor(artifact: ArtifactRow, principal: Principal, role: ArtifactRole): Promise<{ url: string; pageUrl: string; token: string }>;
  /** Node handlers for content-origin traffic (see `content.ts`, which wraps them). */
  handle(req: IncomingMessage, res: ServerResponse): void;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Whether a Host header is a content host of this deployment. */
  isContentHost(host: string | undefined): boolean;
  /** Drops the page connections whose principal lost access or changed role (call after sharing changes). */
  refresh(id: string): Promise<void>;
  /** {@link refresh} for every artifact a page was opened for since the start (a plugin forgot every cached role). */
  refreshAll(): Promise<void>;
  /** The principals that have a page of the artifact open now (each once). */
  connected(id: string): PrincipalRef[];
  /** Calls an action of the embedded type server on behalf of the host (`/__open-artifact/actions/<name>`); the answer's JSON. */
  action(id: string, name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Another `/__open-artifact/<route>` of the type server (archive, close, list, health), as its raw answer. */
  internal(route: string, init?: { method?: string; query?: Record<string, string>; body?: unknown }): Promise<Response>;
  /** What the type server calls back as its daemon (for tests and the Link layer). */
  readonly typeApi: TypeApiLike;
  /** The loopback address of the type server's own listener. */
  readonly internalUrl: string;
  /** The frame engine that runs page artifacts, or null when this site runs none. */
  readonly frames: FrameEngine | null;
  /** The types published to this site (they run on the frame engine), or null. */
  readonly siteTypes: NodeSiteTypes | null;
  stop(): Promise<void>;
}

/** Host-side state on a page's viewer: who the page token named (not sent to the page: JSON leaves symbols out). */
const PRINCIPAL = Symbol('open-artifact.host.principal');
type TaggedViewer = Viewer & { [PRINCIPAL]?: PrincipalRef };

/** The principal a page connection's viewer stands for: the host's tag, else its kind and id (never `owner`). */
function refOfViewer(viewer: Viewer): PrincipalRef | null {
  const tagged = (viewer as TaggedViewer)[PRINCIPAL];
  if (tagged) return tagged;
  if (!viewer.kind || viewer.id === 'owner') return null;
  return { kind: viewer.kind, id: viewer.id };
}

/** Whether a Host header names `origin`'s host (a default port spelled out counts). */
function isHostOf(host: string | undefined, origin: URL): boolean {
  if (!host) return false;
  let given = host.trim().toLowerCase();
  const defaultPort = origin.protocol === 'https:' ? '443' : '80';
  if (!origin.port && given.endsWith(`:${defaultPort}`)) given = given.slice(0, -defaultPort.length - 1);
  return given === origin.host;
}

/** How long an artifact's owner name is kept before it is read again, ms. */
const OWNER_NAME_MS = 10_000;

/** Starts the embedded type server (on a loopback port for its internal routes) and returns the host's rooms. */
export async function createRooms(options: RoomsOptions): Promise<HostRooms> {
  const { config, catalog, events } = options;
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => new Date());
  const linkPresence = options.linkPresence ?? { online: () => false };
  const app = new URL(config.appOrigin);
  const appOrigin = app.origin;
  const secret = randomBytes(32).toString('hex');
  const cache = new AccessCache(catalog, config, { ...options.access, now, ...(options.plugins ? { plugins: options.plugins } : {}) });
  const plugins = options.plugins;
  /** The artifacts a page token was made for (what {@link HostRooms.refreshAll} goes through). */
  const opened = new Set<string>();

  const rootOf = (id: string): string => {
    if (!ARTIFACT_ID.test(id)) throw httpError('invalid_argument', `Not an artifact id: ${id}`);
    return join(options.dataDir, 'artifacts', id);
  };
  const isDirectory = async (path: string): Promise<boolean> => {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  };

  /** Owner display names per artifact: `hosting.ownerName` is synchronous, so they are read ahead of each use. */
  const ownerNames = new Map<string, { user: string; name: string; at: number }>();
  const rememberOwner = async (artifact: ArtifactRow): Promise<void> => {
    const known = ownerNames.get(artifact.id);
    if (known && known.user === artifact.ownerUser && Date.now() - known.at < OWNER_NAME_MS) return;
    const user = await catalog.getUser(artifact.ownerUser);
    ownerNames.set(artifact.id, { user: artifact.ownerUser, name: user?.name ?? 'Owner', at: Date.now() });
  };

  /**
   * Whether each artifact's owner lets editors ask their agent (`editorsCanAskAgent`): `hosting.mayAskAgent` is
   * synchronous, so the setting is read with every page token resolved and after every sharing change.
   */
  const editorsAsk = new Map<string, boolean>();
  /** Whether each artifact's owner lets viewers export (`viewersCanExport`), read alongside {@link editorsAsk}. */
  const viewersExport = new Map<string, boolean>();
  const rememberSettings = (artifact: ArtifactRow): void => {
    editorsAsk.set(artifact.id, artifact.settings.editorsCanAskAgent);
    viewersExport.set(artifact.id, artifact.settings.viewersCanExport);
  };

  const hosting: TypeServerHosting = {
    hostAllowed: (host) => isHostOf(host, app) || artifactOfContentHost(config, host) !== null,
    artifactOfHost: (host) => artifactOfContentHost(config, host),
    pageBase: (id) => `${contentOriginOf(config, id)}/`,
    shellUrl: (id) => appOrigin + shellPath(id),
    appOrigin,
    ownerName: (id) => ownerNames.get(id)?.name ?? 'Owner',
    mayAskAgent: (id, viewer) => viewer.role === 'editor' && editorsAsk.get(id) === true,
    mayExport: (id, viewer) => viewer.role === 'owner' || viewer.role === 'editor' || viewer.role === 'commenter' || (viewer.role === 'viewer' && viewersExport.get(id) === true),
    // A page asked for a dashboard's live data to be refreshed: queued for the owner's Link like a wake (no connector here).
    async dataRefresh(id, viewer, request) {
      const owner = await queueDataRefresh(catalog, id, { name: viewer.name, role: viewer.role }, request.queries);
      events.emit('outbox', { userId: owner });
      return { online: linkPresence.online(owner) };
    },
    // An artifact nobody has had open for a while is closed (its watchers and stores released) and opens again on the
    // next request. Not `watch: 'events'`: this computer's own file watching can miss a change while a watch arms.
    idleCloseMs: options.idleCloseMs ?? ROOM_IDLE_CLOSE_MS,

    async resolve(token, type, req, use) {
      const id = artifactOfContentHost(config, req.headers.host);
      if (!id) return null;
      const claims = await verifyPageToken(token, config.signingKeys);
      if (!claims) return null;
      // The artifact and expiry first (no database read); `gv` is never compared: the role is looked up live
      // (decision 15); the epoch is checked against the one read with it.
      if (!checkPageToken(claims, { artifact: id, grantsVersion: claims.gv, epoch: claims.ep, now: now(), use }).ok) return null;
      const ref: PrincipalRef = { kind: claims.k, id: claims.p };
      const access = await cache.role(id, ref);
      if (!access || access.epoch !== claims.ep) return null;
      const { artifact, principal, role } = access;
      if (artifact.trashedAt !== null || artifact.type !== type) return null;
      const root = rootOf(id);
      if (!(await isDirectory(root))) return null;
      await rememberOwner(artifact);
      rememberSettings(artifact);
      if (claims.s === 1) {
        // A snapshot: read-only whatever the person may do, and nobody among the page's people (no principal tag, no
        // kind), so it is neither listed as connected nor kept across a sharing change (it reconnects and is checked).
        const until = claims.exp * 1000;
        return { id, root, title: artifact.title, viewer: { id: claims.p, name: claims.n, role: 'viewer' }, snapshot: { until } };
      }
      const person = principal.kind === 'agent' ? principal.user : principal;
      const viewer: TaggedViewer =
        role === 'owner'
          ? { id: 'owner', name: claims.n, role: 'owner', kind: claims.k }
          : {
              id: claims.p,
              name: claims.n,
              role,
              kind: claims.k,
              ...(person.kind === 'user' && person.email ? { email: person.email } : {}),
              ...(person.kind === 'user' && person.avatar ? { avatar: person.avatar } : {}),
            };
      // The type server keeps this viewer (spread for the owner, which keeps symbol keys) on the page's connections.
      viewer[PRINCIPAL] = ref;
      return { id, root, title: artifact.title, viewer };
    },

    async locate(id) {
      const artifact = await catalog.getArtifact(id);
      if (!artifact || artifact.trashedAt !== null) return null;
      const root = rootOf(id);
      if (!(await isDirectory(root))) return null;
      await rememberOwner(artifact);
      rememberSettings(artifact);
      return { root, title: artifact.title };
    },
  };

  /** The label of the owner's most recently used agent token, else {@link DEFAULT_AGENT_NAME}. */
  const agentNameOf = async (userId: string): Promise<string> => {
    const tokens = (await catalog.listAgentTokens(userId)).filter((t) => t.revokedAt === null);
    tokens.sort((a, b) => (b.usedAt ?? b.createdAt).localeCompare(a.usedAt ?? a.createdAt));
    return tokens[0]?.label || DEFAULT_AGENT_NAME;
  };

  /** The owner's MCP token used most recently, when within {@link MCP_PRESENT_MS} and not revoked. */
  const recentMcpToken = async (userId: string): Promise<{ label: string } | undefined> => {
    const since = now().getTime() - MCP_PRESENT_MS;
    const recent = (await catalog.listAgentTokens(userId)).filter((t) => t.harness === MCP_HARNESS && t.revokedAt === null && t.usedAt !== null && Date.parse(t.usedAt) >= since);
    recent.sort((a, b) => (b.usedAt ?? '').localeCompare(a.usedAt ?? ''));
    return recent[0];
  };

  /** The title in an artifact's own files when it differs from the catalog's, else undefined. */
  const contentTitle = async (id: string): Promise<string | undefined> => {
    const artifact = await catalog.getArtifact(id);
    if (!artifact) return undefined;
    // A page's title is its index.html's <title> (the type's `titleFrom`).
    const title = (
      artifact.type === PAGE_TYPE
        ? titleInHtml(await readFile(join(rootOf(id), 'index.html'), 'utf8').catch(() => ''))
        : isTypeName(artifact.type)
          ? await readArtifactTitle(rootOf(id), artifact.type)
          : await options.frames?.siteTypes?.contentTitle(artifact.type, rootOf(id))
    )?.slice(0, 200);
    return title && title !== artifact.title ? title : undefined;
  };

  const typeApi: TypeApiLike = {
    async wake(id, body = {}): Promise<TypeApiWakeResult> {
      const artifact = await catalog.getArtifact(id);
      if (!artifact) throw httpError('not_found', `No artifact ${id}.`);
      // Sent by someone else than the owner: an editor, and only while the owner lets editors ask (checked live
      // here as well as on the page). The sender rides on the row (`from`), and the Link names them to the agent.
      const from = body.requests?.find((r) => r.from)?.from ?? body.threads?.find((t) => t.from)?.from;
      if (from && (from.role !== 'editor' || !artifact.settings.editorsCanAskAgent)) throw httpError('not_granted', 'The owner does not let editors ask their agent.', { status: 403 });
      if (await offerWake(plugins, catalog, artifact, body, now)) return { status: 'delivered', via: 'live' };
      await catalog.appendOutbox({
        artifactId: id,
        toUser: artifact.ownerUser,
        kind: 'wake',
        payload: { ...(body.threads ? { threads: body.threads } : {}), ...(body.requests ? { requests: body.requests } : {}), ...(from ? { from } : {}) },
      });
      events.emit('outbox', { userId: artifact.ownerUser });
      return { status: 'inbox', via: 'link' };
    },
    async presence(id): Promise<TypeApiPresence> {
      const artifact = await catalog.getArtifact(id);
      if (!artifact) return { presence: 'none', canSend: false, canSendSession: false, busy: false, agentName: DEFAULT_AGENT_NAME };
      const online = linkPresence.online(artifact.ownerUser);
      if (!online) {
        // No Link, but an MCP client in recent use: its agent reads what is sent when it next calls (an MCP tool
        // hands wakes over), as a local ChatGPT does: there, not woken while it idles.
        const mcp = await recentMcpToken(artifact.ownerUser);
        if (mcp) return { presence: 'offline', canSend: true, canSendSession: true, busy: false, agentName: mcp.label || DEFAULT_AGENT_NAME, wakesIdle: false };
      }
      return {
        presence: online ? 'online' : 'offline',
        // A wake is always kept in the outbox; it reaches the agent at once only while its Link is connected.
        canSend: true,
        canSendSession: online,
        busy: false,
        agentName: await agentNameOf(artifact.ownerUser),
        ...(online ? {} : { wakesIdle: false }),
      };
    },
    async touch(id, { author, paths, title: reported }) {
      // A type reports some renames (a doc's); the others show in the file its manifest's `titleFrom` names.
      const title = reported?.trim().slice(0, 200) || (await contentTitle(id));
      const touched = await catalog.touchArtifact(id, title ? { title } : {});
      if (touched) events.emit('artifact-touched', { id, author, paths, ...(title ? { title } : {}) });
      if (touched && plugins?.listens('artifact.changed')) {
        const artifact = await catalog.getArtifact(id);
        // Who wrote is known here only by the name the page gave (or `agent`).
        if (artifact) emitEvent({ plugins }, 'artifact.changed', { artifact: artifactRef(artifact), by: { kind: 'system', id: null, name: author }, changes: { files: paths, ...(title ? { title } : {}) } });
      }
      return {};
    },
  };

  const typeServer: TypeServer = createTypeServer({
    assetsDir: options.assetsDir,
    secret,
    hosting,
    daemon: typeApi,
    idleMs: 0,
    lanAddresses: () => [],
    downloadsDir: join(options.dataDir, 'downloads'),
    log,
  });
  const internalUrl = await typeServer.listen(0, '127.0.0.1');

  const frames: FrameEngine | null = options.frames
    ? createFrameEngine({
        config,
        catalog,
        cache,
        typeApi,
        rootOf,
        dataDir: options.dataDir,
        types: options.frames.types,
        network: options.frames.network,
        log,
        now,
        idleCloseMs: options.idleCloseMs ?? ROOM_IDLE_CLOSE_MS,
      })
    : null;
  /** The frame engine's answer to a request it took, or a 500 when it failed. */
  const framed = (res: ServerResponse, run: Promise<void>): void => {
    run.catch((error: unknown) => {
      log(`page: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end();
    });
  };
  /** Whether a content-host request is the frame engine's: a page host, or `/page/…` on an artifact's content host. */
  const forFrames = (req: IncomingMessage): 'content' | 'shell' | null => {
    if (!frames) return null;
    if (frames.isPageHost(req.headers.host)) return 'content';
    return (req.url ?? '').startsWith(`/${PAGE_TYPE}/`) || req.url === `/${PAGE_TYPE}` ? 'shell' : null;
  };

  const internal = async (route: string, init: { method?: string; query?: Record<string, string>; body?: unknown } = {}): Promise<Response> => {
    const url = new URL(`__open-artifact/${route}`, internalUrl);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    const post = init.body !== undefined;
    return fetch(url, {
      method: init.method ?? (post ? 'POST' : 'GET'),
      headers: { authorization: `Bearer ${secret}`, ...(post ? { 'content-type': 'application/json' } : {}) },
      ...(post ? { body: JSON.stringify(init.body) } : {}),
    });
  };

  const rooms: HostRooms = {
    rootOf,
    typeApi,
    internalUrl,
    frames,
    siteTypes: options.frames?.siteTypes ?? null,

    async pageFor(artifact, principal, role) {
      await rememberOwner(artifact);
      opened.add(artifact.id);
      const claims = pageTokenClaims({ artifact: artifact.id, principal, role, grantsVersion: artifact.grantsVersion, epoch: await catalog.siteEpoch(), now: now() });
      const token = await signPageToken(claims, config.signingKeys);
      // The frame engine serves every type it runs under `/page/` (a published type's id may be anything).
      const segment = frames?.runs(artifact.type) ? PAGE_TYPE : artifact.type;
      const pageUrl = new URL(`${segment}/${encodeURIComponent(token)}/`, `${contentOriginOf(config, artifact.id)}/`).href;
      const framed = new URL(pageUrl);
      framed.searchParams.set(SHELL_PARAMS.shell, appOrigin);
      return { url: framed.href, pageUrl, token };
    },

    handle(req, res) {
      const route = forFrames(req);
      if (route === 'content') return framed(res, frames!.content(req, res));
      if (route === 'shell') return framed(res, frames!.shell(req, res));
      typeServer.handle(req, res);
    },
    upgrade(req, socket, head) {
      const route = forFrames(req);
      if (route) {
        frames!.upgrade(req, socket, head).catch(() => socket.destroy());
        return;
      }
      typeServer.upgrade(req, socket, head);
    },
    isContentHost: (host) => artifactOfContentHost(config, host) !== null || !!frames?.isPageHost(host),

    async refresh(id) {
      // A sharing change was made: work every holder's role out again.
      cache.invalidate(id);
      const artifact = await catalog.getArtifact(id);
      await frames?.refresh(id);
      if (!artifact || artifact.trashedAt !== null) {
        typeServer.disconnect(id);
        return;
      }
      // Whether editors may ask the agent changed: their pages reconnect, and hear the agent as they now may.
      const asked = editorsAsk.get(id);
      rememberSettings(artifact);
      const editorsMoved = asked !== undefined && asked !== artifact.settings.editorsCanAskAgent;
      // `disconnect` asks synchronously: list the holders first (keeping all), look their roles up, then drop.
      const refs = new Map<string, PrincipalRef>();
      typeServer.disconnect(id, (viewer) => {
        const ref = refOfViewer(viewer);
        if (ref) refs.set(refKey(ref), ref);
        return true;
      });
      const roles = new Map<string, ArtifactRole | null>();
      for (const [key, ref] of refs) roles.set(key, (await cache.role(id, ref))?.role ?? null);
      typeServer.disconnect(id, (viewer) => {
        const ref = refOfViewer(viewer);
        if (!ref) return false;
        const key = refKey(ref);
        // Connected while the roles were looked up: just resolved, with the current role.
        if (!roles.has(key)) return true;
        if (editorsMoved && viewer.role === 'editor') return false;
        return roles.get(key) === viewer.role;
      });
    },

    async refreshAll() {
      cache.invalidate();
      for (const id of [...opened]) {
        await rooms.refresh(id);
        if (rooms.connected(id).length === 0) opened.delete(id);
      }
    },

    connected(id) {
      // `disconnect` with a filter that keeps everyone only lists the holders.
      const refs = new Map<string, PrincipalRef>();
      typeServer.disconnect(id, (viewer) => {
        const ref = refOfViewer(viewer);
        if (ref) refs.set(refKey(ref), ref);
        return true;
      });
      for (const ref of frames?.connected(id) ?? []) refs.set(refKey(ref), ref);
      return [...refs.values()];
    },

    async action(id, name, args) {
      const artifact = await catalog.getArtifact(id);
      if (!artifact) throw httpError('not_found', `No artifact ${id}.`);
      if (frames?.runs(artifact.type)) return frames.action(id, name, args);
      await rememberOwner(artifact);
      const answer = await internal(`actions/${encodeURIComponent(name)}`, { method: 'POST', body: { id, root: rootOf(id), args } });
      const body = (await answer.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
      if (!answer.ok) {
        const code = typeof body?.code === 'string' ? body.code : 'server_failed';
        const message = typeof body?.message === 'string' ? body.message : `The action ${name} failed (HTTP ${answer.status}).`;
        throw httpError(code as OpenArtifactErrorCode, message, { status: answer.status });
      }
      return body;
    },

    internal,

    async stop() {
      await frames?.stop();
      await typeServer.stop();
    },
  };
  return rooms;
}
