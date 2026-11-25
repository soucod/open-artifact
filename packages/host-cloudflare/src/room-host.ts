/**
 * The product's {@link RoomHost}: who each content-origin request is, decided with the host core over D1, for the
 * artifact's object. It mirrors the Node host's `node/rooms.ts` (read it for the reasons):
 *
 * - `resolve` verifies the page token (signature, artifact, site epoch, expiry) and looks the holder's CURRENT role up
 *   (`AccessCache`, decision 15); the token's role is a hint only. No access now, a trashed artifact or another type:
 *   refused. The owner (or a site admin) is the page's `owner` (viewer id `'owner'`); everybody else keeps their id.
 *   A snapshot token is a `viewer` and nobody in the page's people.
 * - Answers are kept at most {@link ACCESS_MAX_AGE_MS} (2 s): an object serves one artifact, and every sharing change
 *   reaches it as `refresh`, which forgets them at once ({@link ProductRoomHost.invalidate}). What no sharing change
 *   announces (a user disabled, an agent token revoked) applies within those 2 s.
 * - The type server's daemon calls: `wake` appends to the owner's outbox in D1 and tells the hub (`outbox`);
 *   `presence` asks the hub whether the owner's Link is connected (kept {@link PRESENCE_MS}), else a recent MCP
 *   token; `touch` updates the catalog and tells the hub (`artifact-touched`). Asking names the room, so the hub
 *   tells the room when that answer changes (`presenceChanged` forgets it here); `idle` (the artifact closed with
 *   nothing open) tells the hub to stop, so a sleeping room is never called.
 * - `mayAskAgent`/`mayExport` follow the owner's settings, read with every resolve and refresh (the type server asks
 *   synchronously).
 * - `dataRefresh` (a dashboard's page asked for its live data to be run again) appends a `data-refresh` row to the
 *   owner's outbox with the core's `queueDataRefresh` and tells the hub, as `wake` does; no connector runs here.
 * - `refresh` (after a sharing change) ends only the connections whose holder's role moved, and editors' when whether
 *   they may ask the agent moved.
 * - `pages` (when the site runs page artifacts): who a page artifact's request is, as the Node site's frame engine
 *   decides it (`node/frames.ts`): a page token on the content host (`placeShell`, the live role, the epoch, never a
 *   snapshot), or a page host's opaque part (`placeReader`: the principal it was made for, from the object's index or
 *   worked out for the owner and the user grants, with their live role and the live epoch).
 */

import type { TypeApiPresence, TypeApiWakeResult } from '@open-artifact/protocol';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import {
  AccessCache,
  checkPageToken,
  contentOriginOf,
  pageHostFits,
  pageHostMatches,
  pageHostOf,
  pageHostOpaque,
  pageHostSource,
  pageOriginOf,
  httpError,
  MCP_HARNESS,
  MCP_PRESENT_MS,
  artifactRef,
  emitEvent,
  offerWake,
  queueDataRefresh,
  refKey,
  type Plugins,
  verifyPageToken,
  type ArtifactRole,
  type ArtifactRow,
  type CachedAccess,
  type Catalog,
  type HostConfig,
  type HostEventMap,
  type HostEventName,
  type PrincipalRef,
} from '@open-artifact/host';
import { isTypeName, readArtifactTitle, type TypeApiLike } from '@open-artifact/type-server';
import { shellPath } from '@open-artifact/protocol';
import type { RoomHost } from './room.ts';
import { colorOf, frameLevelOf, PAGE_TYPE, pageNetworkPolicy, pageTitleOf, type PageNetwork, type PlacedPage, type RoomFrameTypes, type RoomPages } from './frames.ts';
import type { FramePerson, FrameViewer } from '@open-artifact/server-sdk/frame/env';

/** Longest a role answer is kept in an object, ms. */
export const ACCESS_MAX_AGE_MS = 2_000;
/** Longest the hub's word on whether a Link is connected is kept, ms. */
export const PRESENCE_MS = 3_000;
/** How long an artifact's owner name is kept before it is read again, ms (as the Node host). */
export const OWNER_NAME_MS = 10_000;
/** The agent name pages show when the owner has never linked one. */
export const DEFAULT_AGENT_NAME = 'Agent';

/** What the room host needs from the site hub. */
export interface HubLink {
  /** Tells the hub (and so the Library streams and, later, the Link) that something happened. */
  emit<N extends HostEventName>(name: N, payload: HostEventMap[N]): Promise<void>;
  /**
   * Whether the user's agent is connected over Link now. With `room` (an artifact id) the hub remembers that room asks
   * about the user and tells it when the answer changes, until {@link forget}.
   */
  online(userId: string, room?: string): Promise<boolean>;
  /** The room's artifact closed: stop telling it of presence changes. */
  forget?(room: string): Promise<void>;
  /**
   * The room has pages open while a plugin decides roles: the hub keeps its name so a plugin forgetting every role
   * reaches it (`refreshRooms`), until {@link forget}.
   */
  awake?(room: string): Promise<void>;
}

/** The part of a room the refresh needs. */
export interface RoomConnections {
  holders(): Array<{ ref: PrincipalRef | null; role: Viewer['role'] }>;
  disconnectWhere(keep: (ref: PrincipalRef | null, role: Viewer['role']) => boolean): void;
}

export interface ProductRoomHostOptions {
  config: HostConfig;
  catalog: Catalog;
  hub: HubLink;
  /** The folder of an artifact in its object (`ArtifactRoom.rootOf`), for the title in its files. */
  rootOf(id: string): string;
  now?: () => Date;
  /** Access cache settings (default: groups from the catalog, {@link ACCESS_MAX_AGE_MS}). */
  accessMaxAgeMs?: number;
  /** The site's plugins in this object (absent: none): `authz.role`, `wake.deliver`, `artifact.changed`. */
  plugins?: Plugins;
  /** Page artifacts (the frame engine's types, `OA_PAGE_NETWORK`); absent: the site runs none. */
  pages?: { types: RoomFrameTypes; network: PageNetwork };
}

export interface ProductRoomHost {
  host: RoomHost;
  /** Forgets every cached answer about the artifact. */
  invalidate(artifactId: string): void;
  /** After a sharing change: drops the connections whose holder's role moved (see the module comment). */
  refresh(room: RoomConnections, artifactId: string): Promise<{ dropped: number }>;
  /** The access cache (tests). */
  readonly access: AccessCache;
}

/** Makes the product room host. */
export function createProductRoomHost(options: ProductRoomHostOptions): ProductRoomHost {
  const { config, catalog, hub } = options;
  const now = options.now ?? (() => new Date());
  const maxAgeMs = options.accessMaxAgeMs ?? ACCESS_MAX_AGE_MS;
  const appOrigin = new URL(config.appOrigin).origin;
  const plugins = options.plugins;
  const access = new AccessCache(catalog, config, { groupsOf: (id) => catalog.userGroups(id), maxAgeMs, now, ...(plugins ? { plugins } : {}) });
  /** Whether the hub knows this room is awake (told once per artifact while a plugin decides roles). */
  const told = new Set<string>();

  /** Whole answers (artifact row and epoch with the role), at most `maxAgeMs`: the cache above still reads two rows. */
  const memo = new Map<string, { value: CachedAccess | null; until: number }>();
  const lookUp = async (id: string, ref: PrincipalRef): Promise<CachedAccess | null> => {
    const key = `${id}\n${refKey(ref)}`;
    const at = now().getTime();
    const kept = memo.get(key);
    if (kept && kept.until > at) return kept.value;
    const value = await access.role(id, ref);
    memo.set(key, { value, until: at + maxAgeMs });
    if (memo.size > 5000) memo.delete(memo.keys().next().value!);
    return value;
  };
  const invalidate = (id: string): void => {
    access.invalidate(id);
    for (const key of [...memo.keys()]) if (key.startsWith(`${id}\n`)) memo.delete(key);
  };

  const ownerNames = new Map<string, { user: string; name: string; at: number }>();
  const ownerName = async (artifact: ArtifactRow): Promise<string> => {
    const known = ownerNames.get(artifact.id);
    if (known && known.user === artifact.ownerUser && now().getTime() - known.at < OWNER_NAME_MS) return known.name;
    const user = await catalog.getUser(artifact.ownerUser);
    const name = user?.name ?? 'Owner';
    ownerNames.set(artifact.id, { user: artifact.ownerUser, name, at: now().getTime() });
    return name;
  };

  const editorsAsk = new Map<string, boolean>();
  const viewersExport = new Map<string, boolean>();
  const rememberSettings = (artifact: ArtifactRow): void => {
    editorsAsk.set(artifact.id, artifact.settings.editorsCanAskAgent);
    viewersExport.set(artifact.id, artifact.settings.viewersCanExport);
  };

  const presence = new Map<string, { online: boolean; until: number }>();
  const isOnline = async (userId: string, room: string): Promise<boolean> => {
    const at = now().getTime();
    const kept = presence.get(userId);
    if (kept && kept.until > at) return kept.online;
    let online = false;
    try {
      online = await hub.online(userId, room);
    } catch {
      online = false;
    }
    presence.set(userId, { online, until: at + PRESENCE_MS });
    return online;
  };

  const agentNameOf = async (userId: string): Promise<string> => {
    const tokens = (await catalog.listAgentTokens(userId)).filter((t) => t.revokedAt === null);
    tokens.sort((a, b) => (b.usedAt ?? b.createdAt).localeCompare(a.usedAt ?? a.createdAt));
    return tokens[0]?.label || DEFAULT_AGENT_NAME;
  };
  const recentMcpToken = async (userId: string): Promise<{ label: string } | undefined> => {
    const since = now().getTime() - MCP_PRESENT_MS;
    const recent = (await catalog.listAgentTokens(userId)).filter((t) => t.harness === MCP_HARNESS && t.revokedAt === null && t.usedAt !== null && Date.parse(t.usedAt) >= since);
    recent.sort((a, b) => (b.usedAt ?? '').localeCompare(a.usedAt ?? ''));
    return recent[0];
  };
  const contentTitle = async (artifact: ArtifactRow): Promise<string | undefined> => {
    let title: string | undefined;
    if (isTypeName(artifact.type)) title = (await readArtifactTitle(options.rootOf(artifact.id), artifact.type).catch(() => undefined))?.slice(0, 200);
    else if (options.pages && artifact.type === PAGE_TYPE) title = pageTitleOf(options.rootOf(artifact.id));
    return title && title !== artifact.title ? title : undefined;
  };
  const tellAwake = (id: string): void => {
    if (plugins?.hasRoleHook && !told.has(id) && hub.awake) {
      told.add(id);
      void hub.awake(id).catch(() => told.delete(id));
    }
  };

  const typeApi: TypeApiLike = {
    async wake(id, body = {}): Promise<TypeApiWakeResult> {
      const artifact = await catalog.getArtifact(id);
      if (!artifact) throw httpError('not_found', `No artifact ${id}.`);
      const from = body.requests?.find((r) => r.from)?.from ?? body.threads?.find((t) => t.from)?.from;
      if (from && (from.role !== 'editor' || !artifact.settings.editorsCanAskAgent)) throw httpError('not_granted', 'The owner does not let editors ask their agent.', { status: 403 });
      if (await offerWake(plugins, catalog, artifact, body, now)) return { status: 'delivered', via: 'live' };
      await catalog.appendOutbox({
        artifactId: id,
        toUser: artifact.ownerUser,
        kind: 'wake',
        payload: { ...(body.threads ? { threads: body.threads } : {}), ...(body.requests ? { requests: body.requests } : {}), ...(from ? { from } : {}) },
      });
      await hub.emit('outbox', { userId: artifact.ownerUser }).catch(() => undefined);
      return { status: 'inbox', via: 'link' };
    },
    async presence(id): Promise<TypeApiPresence> {
      const artifact = await catalog.getArtifact(id);
      if (!artifact) return { presence: 'none', canSend: false, canSendSession: false, busy: false, agentName: DEFAULT_AGENT_NAME };
      const online = await isOnline(artifact.ownerUser, id);
      if (!online) {
        const mcp = await recentMcpToken(artifact.ownerUser);
        if (mcp) return { presence: 'offline', canSend: true, canSendSession: true, busy: false, agentName: mcp.label || DEFAULT_AGENT_NAME, wakesIdle: false };
      }
      return {
        presence: online ? 'online' : 'offline',
        canSend: true,
        canSendSession: online,
        busy: false,
        agentName: await agentNameOf(artifact.ownerUser),
        ...(online ? {} : { wakesIdle: false }),
      };
    },
    async touch(id, { author, paths, title: reported }) {
      const artifact = await catalog.getArtifact(id);
      if (!artifact) return {};
      const title = reported?.trim().slice(0, 200) || (await contentTitle(artifact));
      const touched = await catalog.touchArtifact(id, title ? { title } : {});
      if (touched) await hub.emit('artifact-touched', { id, author, paths, ...(title ? { title } : {}) }).catch(() => undefined);
      // Who wrote is known here only by the name the page gave (or `agent`).
      if (touched && plugins?.listens('artifact.changed')) {
        emitEvent({ plugins }, 'artifact.changed', { artifact: artifactRef(title ? { ...artifact, title } : artifact), by: { kind: 'system', id: null, name: author }, changes: { files: paths, ...(title ? { title } : {}) } });
      }
      return {};
    },
  };

  /** A frame viewer for a principal's current access (as the Node site's `viewerOf`). */
  const viewerOf = (found: CachedAccess, ref: PrincipalRef): FrameViewer => {
    const { principal, role } = found;
    const person = principal.kind === 'agent' ? principal.user : principal;
    const { level, canComment } = frameLevelOf(role);
    return {
      id: ref.id,
      name: person.kind === 'anonymous' ? 'Anonymous' : person.name,
      email: person.kind === 'user' ? (person.email ?? null) : null,
      avatarUrl: person.kind === 'user' ? (person.avatar ?? null) : null,
      color: colorOf(ref.id),
      level,
      guest: person.kind === 'guest' || person.kind === 'anonymous',
      canComment,
    };
  };

  /** The page artifacts' side: see the module comment. */
  function pageHost(types: RoomFrameTypes, network: PageNetwork): RoomPages {
    const policy = pageNetworkPolicy(network);
    /** A principal's current access to a page artifact, or null (no access, trashed, not a frame type here). */
    const accessOf = async (id: string, ref: PrincipalRef): Promise<CachedAccess | null> => {
      const found = await lookUp(id, ref);
      if (!found || found.artifact.trashedAt !== null || !(await types.typeOf(found.artifact.type))) return null;
      tellAwake(id);
      return found;
    };
    const placed = (found: CachedAccess, ref: PrincipalRef, opaque: string): PlacedPage => ({
      viewer: viewerOf(found, ref),
      ref,
      role: found.role,
      opaque,
      artifact: { title: found.artifact.title, type: found.artifact.type },
    });
    return {
      types,
      policy,
      pageHostOf: (host) => pageHostOf(config, host),
      origins: (id) => ({ shell: contentOriginOf(config, id), template: pageOriginOf(config, id, 'a'.repeat(24)), frameSrc: pageHostSource(config), app: appOrigin }),
      pageOrigin: (id, opaque) => pageOriginOf(config, id, opaque),
      async artifact(id) {
        const artifact = await catalog.getArtifact(id);
        return artifact && artifact.trashedAt === null ? { title: artifact.title, type: artifact.type } : null;
      },
      async placeShell(id, token, use, index) {
        const claims = await verifyPageToken(token, config.signingKeys);
        // A snapshot token: no snapshot of a page here (as on Node).
        if (!claims || claims.s === 1) return null;
        if (!checkPageToken(claims, { artifact: id, grantsVersion: claims.gv, epoch: claims.ep, now: now(), use }).ok) return null;
        if (!pageHostFits(id)) throw Object.assign(new Error(`The artifact id ${id} is too long for a page host name.`), { code: 'unsupported', status: 400 });
        const ref: PrincipalRef = { kind: claims.k, id: claims.p };
        const found = await accessOf(id, ref);
        if (!found || found.epoch !== claims.ep) return null;
        const opaque = await pageHostOpaque(config.signingKeys, id, ref, found.epoch);
        index.set(opaque, ref);
        return placed(found, ref, opaque);
      },
      async placeReader(id, host, index) {
        const named = pageHostOf(config, host);
        if (!named || named.id !== id) return null;
        let ref = index.get(named.opaque);
        if (!ref) {
          // Not made in this object (a lost index): the owner's and the user grants' are worked out.
          const artifact = await catalog.getArtifact(id);
          if (!artifact) return null;
          const epoch = await catalog.siteEpoch();
          const candidates: PrincipalRef[] = [{ kind: 'user', id: artifact.ownerUser }];
          for (const g of await catalog.listGrants(id)) if (g.subjectKind === 'user') candidates.push({ kind: 'user', id: g.subject });
          for (const c of candidates) if (await pageHostMatches(config.signingKeys, named.opaque, id, c, epoch)) ref = c;
          if (!ref) return null;
        }
        const found = await accessOf(id, ref);
        if (!found) return null;
        // The epoch moved (every session signed out): the old host names nobody.
        if (!(await pageHostMatches(config.signingKeys, named.opaque, id, ref, found.epoch))) return null;
        return placed(found, ref, named.opaque);
      },
      async people(id) {
        const artifact = await catalog.getArtifact(id);
        if (!artifact) return [];
        const at = now().getTime();
        const grants = (await catalog.listGrants(id)).filter((g) => g.subjectKind === 'user' && (g.expiresAt === null || Date.parse(g.expiresAt) > at));
        const users = await catalog.getUsers([artifact.ownerUser, ...grants.map((g) => g.subject)]);
        const out: FramePerson[] = [];
        const add = (userId: string, role: ArtifactRole): void => {
          const user = users.get(userId);
          if (!user || out.some((p) => p.id === userId)) return;
          out.push({ id: userId, name: user.name, email: user.email ?? null, avatarUrl: user.avatar ?? null, color: colorOf(userId), level: frameLevelOf(role).level });
        };
        add(artifact.ownerUser, 'owner');
        for (const g of grants) add(g.subject, g.role as ArtifactRole);
        return out;
      },
    };
  }

  const host: RoomHost = {
    async resolve(id, token, use) {
      const claims = await verifyPageToken(token, config.signingKeys);
      if (!claims) return null;
      if (!checkPageToken(claims, { artifact: id, grantsVersion: claims.gv, epoch: claims.ep, now: now(), use }).ok) return null;
      const ref: PrincipalRef = { kind: claims.k, id: claims.p };
      const found = await lookUp(id, ref);
      if (!found || found.epoch !== claims.ep) return null;
      tellAwake(id);
      const { artifact, principal, role } = found;
      if (artifact.trashedAt !== null) return null;
      rememberSettings(artifact);
      if (claims.s === 1) {
        return { title: artifact.title, type: artifact.type, viewer: { id: claims.p, name: claims.n, role: 'viewer' }, snapshot: { until: claims.exp * 1000 } };
      }
      const person = principal.kind === 'agent' ? principal.user : principal;
      const viewer: Viewer =
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
      return { title: artifact.title, type: artifact.type, viewer, principal: ref };
    },
    async locate(id) {
      const artifact = await catalog.getArtifact(id);
      if (!artifact || artifact.trashedAt !== null) return null;
      rememberSettings(artifact);
      return { title: artifact.title };
    },
    pageBase: (id) => `${contentOriginOf(config, id)}/`,
    shellUrl: (id) => appOrigin + shellPath(id),
    appOrigin: () => appOrigin,
    async ownerName(id) {
      const artifact = await catalog.getArtifact(id);
      return artifact ? ownerName(artifact) : 'Owner';
    },
    mayAskAgent: (id, viewer) => viewer.role === 'editor' && editorsAsk.get(id) === true,
    mayExport: (id, viewer) => viewer.role === 'owner' || viewer.role === 'editor' || viewer.role === 'commenter' || (viewer.role === 'viewer' && viewersExport.get(id) === true),
    async dataRefresh(id, viewer, request) {
      const owner = await queueDataRefresh(catalog, id, { name: viewer.name, role: viewer.role }, request.queries);
      await hub.emit('outbox', { userId: owner }).catch(() => undefined);
      return { online: await isOnline(owner, id) };
    },
    typeApi,
    ...(options.pages ? { pages: pageHost(options.pages.types, options.pages.network) } : {}),
    // One artifact per object: what is kept here is that artifact's owner's.
    presenceChanged: () => presence.clear(),
    idle: (id) => {
      presence.clear();
      told.delete(id);
      void hub.forget?.(id).catch(() => undefined);
    },
  };

  return {
    host,
    access,
    invalidate,
    async refresh(room, id) {
      invalidate(id);
      const artifact = await catalog.getArtifact(id);
      let dropped = 0;
      if (!artifact || artifact.trashedAt !== null) {
        room.disconnectWhere(() => {
          dropped++;
          return false;
        });
        return { dropped };
      }
      const asked = editorsAsk.get(id);
      rememberSettings(artifact);
      const editorsMoved = asked !== undefined && asked !== artifact.settings.editorsCanAskAgent;
      const refs = new Map<string, PrincipalRef>();
      for (const { ref } of room.holders()) if (ref) refs.set(refKey(ref), ref);
      const roles = new Map<string, ArtifactRole | null>();
      for (const [key, ref] of refs) roles.set(key, (await lookUp(id, ref))?.role ?? null);
      room.disconnectWhere((ref, role) => {
        let keep: boolean;
        if (!ref) keep = false;
        else {
          const key = refKey(ref);
          if (!roles.has(key)) keep = true;
          else if (editorsMoved && role === 'editor') keep = false;
          else keep = roles.get(key) === role;
        }
        if (!keep) dropped++;
        return keep;
      });
      return { dropped };
    },
  };
}
