/**
 * The frame engine: the Node host runs its `page` artifacts on the frame core (server-sdk `frame/core.ts`), as
 * frame-host does on a computer, beside the embedded type server that runs the built-in types (`rooms.ts`).
 *
 * Two hosts per page artifact (`core/page-host.ts`):
 *
 *     <idlabel>.<rest>/page/<page token>/…   the inner shell and the capability API: the viewer's page token, checked
 *                                            as the type server's are (signature, artifact, epoch, expiry, then the
 *                                            person's CURRENT role from the access cache)
 *     <idlabel>--<opaque>.<rest>/…           the page itself, read only: `<opaque>` names one principal's reader for
 *                                            this artifact and epoch; the live role is checked on every request
 *
 * The core's environment members are synchronous, so each request is placed first (here, async) and carried to the
 * core on `FrameRequest.peer`; `viewer`, `reader`, `admit` and `pageOrigin` only read it.
 *
 * Levels: owner → `owner`, editor → `admin`, commenter → `view` and may comment, viewer → `view`. A guest (a share
 * link's) or an anonymous visit is `guest: true`. The page withholds identity as a site must (`withholdIdentity`),
 * runs restricted (CSP + sandbox) under {@link pageCsp}, and no watcher runs: every write goes through the core, and
 * the host's own (a Link push, the site's MCP) is handed in with {@link FrameEngine.noteChanges}.
 *
 * What the core writes reaches the daemon the way a built-in type's page writes do: `touch` (the core's db, asset and
 * publish writes; comments here, which the core does not touch) → `artifact-touched` → the owner's Link `files` row.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { installedTypeCsp, titleInHtml, type ArtifactRole } from '@open-artifact/protocol';
import { FrameCore, FrameError, frameActions, LINK_GUARD, localTypeSource, pageDeclaration, storedFile, type FrameClientFiles, type FrameEnv, type FrameLevel, type FramePerson, type FrameReply, type FrameRequest, type FrameTypeSource, type FrameViewer } from '@open-artifact/server-sdk/frame';
import type { TypeApiLike } from '@open-artifact/server-sdk';
import { acceptWebSocket } from '@open-artifact/server-sdk/ws';
import { refKey, type AccessCache, type CachedAccess, type PrincipalRef } from '../core/authz/access.ts';
import type { Catalog } from '../core/catalog/catalog.ts';
import type { HostEvents } from '../core/events.ts';
import { LINK_AUTHOR } from '../core/link/outbox.ts';
import type { PageServices } from '../core/link/services.ts';
import { ConfigError } from '../core/config.ts';
import { httpError } from '../core/http.ts';
import { pageHostFits, pageHostMatches, pageHostOf, pageHostOpaque, pageHostSource, pageOriginOf } from '../core/page-host.ts';
import { artifactOfContentHost, checkPageToken, contentOriginOf, verifyPageToken, type PageTokenUse } from '../core/page-token.ts';
import type { ArtifactRow, HostConfig } from '../core/types.ts';

/** The type a page artifact names in its `.artifact.json`. */
export const PAGE_TYPE = 'page';
/** What the app calls the type (`typeInfo`). */
export const PAGE_TITLE = 'Page';

/** What a page may reach beyond its own origin (`OA_PAGE_NETWORK`): nothing (`self`, the default), or any HTTPS origin. */
export type PageNetwork = 'self' | 'https';

/** `OA_PAGE_NETWORK` (`self` or `https`; default `self`). */
export function parsePageNetwork(env: Record<string, string | undefined>): PageNetwork {
  const text = env.OA_PAGE_NETWORK?.trim().toLowerCase() || 'self';
  if (text !== 'self' && text !== 'https') throw new ConfigError('OA_PAGE_NETWORK', `must be self or https, not "${env.OA_PAGE_NETWORK}".`);
  return text;
}

/**
 * The page origin's policy and what the page's `network` capability says it may reach: the two always agree (the
 * capability reports the very sources the policy lists: none, or the `https:` scheme).
 */
export function pageNetworkPolicy(network: PageNetwork): { contentSecurityPolicy: string; allowedNetworkOrigins: string[] } {
  const sources = network === 'https' ? ['https:'] : [];
  return { contentSecurityPolicy: installedTypeCsp(sources), allowedNetworkOrigins: sources };
}

// ---- where the types and the browser files come from (the built-in page type; published ones: site-types.ts) -------

/** A frame type this site runs: its files, and whether its artifacts are free pages. */
export interface SiteFrameType {
  source: FrameTypeSource;
  page: boolean;
  /**
   * The CSP its pages run under and the origins its `network` capability reports, when the type says (a published
   * type: its manifest's `openArtifact.network`); absent, the site's `OA_PAGE_NETWORK`. Read when an artifact opens
   * and again on {@link FrameEngine.typeChanged}.
   */
  policy?: { contentSecurityPolicy: string; allowedNetworkOrigins: string[] };
}

/** The frame types a site runs and the frame client's browser files. */
export interface SiteFrameTypes {
  /** The frame type of an artifact's catalog type, or null when this site runs it some other way (or not at all). */
  typeOf(type: string): SiteFrameType | null;
  client: FrameClientFiles;
}

const CLIENT_FILES = new Set(['runtime.js', 'imports.js', 'shell.js', 'shell.html', 'shell.css', 'comments.js', 'comments.css']);

/** The built frame client (`dist/daemon/frame-host/client`, what `scripts/build.mjs` `buildFrame` writes). */
export function builtFrameClient(dir: string): FrameClientFiles {
  return { file: (name) => (CLIENT_FILES.has(name) ? storedFile(join(dir, name)) : null) };
}

/**
 * The Node site's frame types: the built-in `page` type from the `artifact-types` folder (`OA_TYPES_DIR`, as the
 * MCP's types), and the built frame client under the built pages' folder (`OA_UI_DIR`/`frame-host/client`).
 */
export function nodeFrameTypes(input: { typesDir: string; clientDir: string }): SiteFrameTypes {
  const page: SiteFrameType = { source: localTypeSource(join(input.typesDir, PAGE_TYPE)), page: true };
  return { typeOf: (type) => (type === PAGE_TYPE ? page : null), client: builtFrameClient(input.clientDir) };
}

// ---- the engine ------------------------------------------------------------------------------------------------------

export interface FrameEngineOptions {
  config: HostConfig;
  catalog: Catalog;
  /** The rooms' access cache: the live role of every request. */
  cache: AccessCache;
  /** The rooms' daemon side: wakes go to the owner's outbox, touches to the catalog and the Link feed. */
  typeApi: TypeApiLike;
  rootOf(id: string): string;
  /** Where the page hosts' index is kept (`<dataDir>/page-hosts/`). */
  dataDir: string;
  types: SiteFrameTypes;
  network: PageNetwork;
  log?: (line: string) => void;
  now?: () => Date;
  /** Closes an artifact nobody uses for this long, ms (0: never). */
  idleCloseMs: number;
}

/** Who one request is, as placed before the core sees it. */
interface Placed {
  viewer: FrameViewer;
}

/** Host-side state on a viewer the core keeps (symbols: never sent to a page). */
const REF = Symbol('open-artifact.frame.principal');
const ROLE = Symbol('open-artifact.frame.role');
const OPAQUE = Symbol('open-artifact.frame.page-host');
type SiteViewer = FrameViewer & { [REF]?: PrincipalRef; [ROLE]?: ArtifactRole; [OPAQUE]?: string };

/** A level of the frame core for a role on the site. */
export function frameLevelOf(role: ArtifactRole): { level: FrameLevel; canComment: boolean } {
  switch (role) {
    case 'owner':
      return { level: 'owner', canComment: true };
    case 'editor':
      return { level: 'admin', canComment: true };
    case 'commenter':
      return { level: 'view', canComment: true };
    default:
      return { level: 'view', canComment: false };
  }
}

const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#ab6400'];
function colorOf(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

/** The viewer a principal's current access makes. */
function viewerOf(access: CachedAccess, ref: PrincipalRef): SiteViewer {
  const { principal, role } = access;
  const person = principal.kind === 'agent' ? principal.user : principal;
  const { level, canComment } = frameLevelOf(role);
  const viewer: SiteViewer = {
    id: ref.id,
    name: person.kind === 'anonymous' ? 'Anonymous' : person.name,
    email: person.kind === 'user' ? (person.email ?? null) : null,
    avatarUrl: person.kind === 'user' ? (person.avatar ?? null) : null,
    color: colorOf(ref.id),
    level,
    guest: person.kind === 'guest' || person.kind === 'anonymous',
    canComment,
  };
  viewer[REF] = ref;
  viewer[ROLE] = role;
  return viewer;
}

/** A frame core of the site: comments reach the daemon too (the core does not touch them; here the Link needs to). */
class SiteFrameCore extends FrameCore {
  /** Set while a change the host made itself is handed in: it is the daemon's, not to be sent back. */
  quiet = false;
  onComments: (() => void) | null = null;

  override commentsChanged(): void {
    super.commentsChanged();
    if (!this.quiet) this.onComments?.();
  }

  /** A new version of the type may reach other origins: the CSP the core sends from now on. */
  setPolicy(contentSecurityPolicy: string): void {
    (this as unknown as { contentSecurityPolicy: string | null }).contentSecurityPolicy = contentSecurityPolicy || null;
  }

  override noteChanges(paths: string[]): void {
    this.quiet = true;
    try {
      super.noteChanges(paths);
    } finally {
      this.quiet = false;
    }
  }
}

interface Room {
  core: SiteFrameCore;
  env: FrameEnv;
  artifact: ArtifactRow;
  /** Open event connections: who, and how to end it. */
  connections: Set<{ ref: PrincipalRef; role: ArtifactRole; end(): void }>;
  lastUsed: number;
  commentsTimer: NodeJS.Timeout | null;
  commentsBy: Set<string>;
}

export interface FrameEngine {
  /** Whether a site's catalog type runs here. */
  runs(type: string): boolean;
  /** Whether a Host header is one of the page hosts (`<idlabel>--<opaque>`). */
  isPageHost(host: string | undefined): boolean;
  /** A request on an artifact's content host under `/page/…` (the inner shell and its API). */
  shell(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** A request on a page host. */
  content(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** The inner shell's event stream as a WebSocket (`/page/<token>/api/frame/events`); a page host's are refused. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>;
  /** Ends the connections whose holder's role moved or went (after a sharing change). */
  refresh(id: string): Promise<void>;
  /** The principals with an event connection open now. */
  connected(id: string): PrincipalRef[];
  /** Whether a certificate may be issued for a page host: its opaque part is a current principal's. */
  pageHostAllowed(host: string): Promise<boolean>;
  /** Closes an artifact deleted for good and drops its page hosts' index (nobody is named by them any more). */
  forget(id: string): Promise<void>;
  /**
   * A type's files or listing changed (a published type's new version, delisted, removed): the open artifacts of it
   * re-read it, and their pages reload when what it serves changed; one of a type no longer run here closes.
   */
  typeChanged(type: string): void;
  /** Hands the core changes the host wrote itself (a Link push, the site's MCP): open pages hear of them. */
  noteChanges(id: string, paths: string[]): void;
  /** Runs an action on a page artifact for the host: `info`, `open-artifact.db.*`, `open-artifact.comments.*`. */
  action(id: string, name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Closes one artifact (it opens again on the next request): after it was removed or replaced. */
  close(id: string): void;
  stop(): Promise<void>;
}

/** A page's `/page/<token>/<rest>` path, split. */
function splitShellPath(url: string): { token: string; rest: string; search: string } | null {
  const u = new URL(url || '/', 'http://local');
  const match = /^\/page\/([^/]+)(\/.*)?$/.exec(u.pathname);
  if (!match) return null;
  let token: string;
  try {
    token = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  return { token, rest: match[2] ?? '', search: u.search };
}

function plain(req: IncomingMessage, url: string, placed: Placed | null): FrameRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
  return {
    method: req.method ?? 'GET',
    url,
    headers,
    peer: placed,
    body: (limit) =>
      new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size > limit) {
            reject(new FrameError('too_large', `The request is over ${limit} bytes.`, 413));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      }),
  };
}

function send(req: IncomingMessage, res: ServerResponse, reply: FrameReply): void {
  req.resume?.();
  res.writeHead(reply.status, reply.headers);
  const body = reply.body;
  if (body === null || req.method === 'HEAD') return void res.end();
  if (body instanceof Uint8Array) return void res.end(body);
  createReadStream(body.path)
    .on('error', () => res.destroy())
    .pipe(res);
}

function refuse(res: ServerResponse, status: number, message: string): void {
  const body = `${message}\n`;
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  res.end(body);
}

/**
 * The people a page's `user` capability answers about: the owner and the users with a grant that has not expired
 * (share-link guests are not listed: each sees only themself).
 */
export async function framePeople(catalog: Pick<Catalog, 'listGrants' | 'getUsers'>, artifact: ArtifactRow, now: Date): Promise<FramePerson[]> {
  const grants = (await catalog.listGrants(artifact.id)).filter((g) => g.subjectKind === 'user' && (g.expiresAt === null || Date.parse(g.expiresAt) > now.getTime()));
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
}

/** The engine over the site's catalog. */
export function createFrameEngine(options: FrameEngineOptions): FrameEngine {
  const { config, catalog, cache, typeApi, types } = options;
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => new Date());
  const policy = pageNetworkPolicy(options.network);
  const appOrigin = new URL(config.appOrigin).origin;
  const rooms = new Map<string, Room>();
  const opening = new Map<string, Promise<Room>>();
  /** The viewer of the request being handled (the agent hook and comment touches are called inside it). */
  const current = new AsyncLocalStorage<SiteViewer>();
  /** Page hosts made, per artifact: opaque → principal (kept on disk too, so a restart keeps open pages working). */
  const index = new Map<string, Map<string, PrincipalRef>>();
  const indexDir = join(options.dataDir, 'page-hosts');

  const loadIndex = async (id: string): Promise<Map<string, PrincipalRef>> => {
    let known = index.get(id);
    if (known) return known;
    known = new Map();
    try {
      const saved = JSON.parse(await readFile(join(indexDir, `${id}.json`), 'utf8')) as Record<string, PrincipalRef>;
      for (const [opaque, ref] of Object.entries(saved)) if (ref && typeof ref.kind === 'string' && typeof ref.id === 'string') known.set(opaque, { kind: ref.kind, id: ref.id });
    } catch {
      // none yet
    }
    index.set(id, known);
    return known;
  };
  const remember = async (id: string, opaque: string, ref: PrincipalRef): Promise<void> => {
    const known = await loadIndex(id);
    const had = known.get(opaque);
    if (had && refKey(had) === refKey(ref)) return;
    known.set(opaque, ref);
    await mkdir(indexDir, { recursive: true, mode: 0o700 });
    const file = join(indexDir, `${id}.json`);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(Object.fromEntries(known)), { mode: 0o600 });
    await rename(temp, file);
  };

  const isDirectory = async (path: string): Promise<boolean> => {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  };

  /** The page's origin for a viewer of an artifact: its own page host. */
  const pageOrigin = (id: string, viewer: FrameViewer): string => {
    const opaque = (viewer as SiteViewer)[OPAQUE];
    if (!opaque) throw new FrameError('forbidden', 'No page host for this viewer.', 403);
    return pageOriginOf(config, id, opaque);
  };

  const people = (artifact: ArtifactRow): Promise<FramePerson[]> => framePeople(catalog, artifact, now());

  const touchComments = (room: Room): void => {
    const by = current.getStore();
    room.commentsBy.add(by ? (by.level === 'owner' ? 'owner' : by.id) : 'owner');
    if (room.commentsTimer) return;
    room.commentsTimer = setTimeout(() => {
      room.commentsTimer = null;
      const authors = [...room.commentsBy];
      room.commentsBy.clear();
      for (const author of authors) typeApi.touch(room.artifact.id, { author, paths: ['comments.json'] }).catch(() => undefined);
    }, 1000);
    room.commentsTimer.unref();
  };

  const envOf = (artifact: ArtifactRow, type: SiteFrameType, agentName: string): FrameEnv => {
    const id = artifact.id;
    const shell = contentOriginOf(config, id);
    const socket = shell.replace(/^http/, 'ws');
    return {
      id,
      title: artifact.title,
      log: (line) => log(`page ${id}: ${line}`),
      origins: {
        shell,
        shellOrigins: [shell],
        // The template's form: the core checks it differs from the shell's; each viewer's own is `pageOrigin`.
        content: pageOriginOf(config, id, 'a'.repeat(24)),
        connectSrc: [socket],
        frameSrc: pageHostSource(config),
        outer: [appOrigin],
      },
      viewer: (req) => {
        const placed = req.peer as Placed | null;
        if (!placed) throw new FrameError('forbidden', 'Not placed.', 403);
        return placed.viewer;
      },
      reader: (req) => (req.peer as Placed | null)?.viewer ?? null,
      pageOrigin: (viewer) => pageOrigin(id, viewer),
      people: async () => people((await catalog.getArtifact(id)) ?? artifact),
      withholdIdentity: true,
      admit: (req) => !!(req.peer as Placed | null)?.viewer,
      type: type.source,
      client: types.client,
      watch: null,
      restricted: true,
      contentSecurityPolicy: (type.policy ?? policy).contentSecurityPolicy,
      allowedNetworkOrigins: [...(type.policy ?? policy).allowedNetworkOrigins],
      page: type.page,
      // The site's folders are its own: a link inside one is followed no further than the local guard lets it.
      guard: LINK_GUARD,
      debug: () => false,
      daemon: { available: true, touch: (aid, body) => typeApi.touch(aid, body), presence: (aid) => typeApi.presence(aid) },
      agentHook: {
        // Who asked rides along when it was not the owner; the outbox refuses it unless editors may ask.
        thread: (view) => {
          const by = current.getStore();
          const from = by && by.level !== 'owner' ? { name: by.name, role: by[ROLE] ?? 'editor' } : undefined;
          return typeApi.wake(id, { threads: [from ? { ...view, from } : view] });
        },
        request: (request) => {
          const by = current.getStore();
          const from = by && by.level !== 'owner' ? { name: by.name, role: by[ROLE] ?? 'editor' } : undefined;
          return typeApi.wake(id, { requests: [from ? { ...request, from } : request] as never });
        },
      },
      agentName,
      agentWakesIdle: false,
    };
  };

  const open = async (artifact: ArtifactRow): Promise<Room> => {
    const have = rooms.get(artifact.id);
    if (have) {
      have.artifact = artifact;
      have.lastUsed = Date.now();
      return have;
    }
    let pending = opening.get(artifact.id);
    if (!pending) {
      pending = (async () => {
        const type = types.typeOf(artifact.type);
        if (!type) throw new FrameError('not_frame_type', `${artifact.type} does not run on the frame engine.`, 404);
        if (!pageHostFits(artifact.id)) throw new FrameError('unsupported', `The artifact id ${artifact.id} is too long for a page host name.`, 400);
        const agentName = (await typeApi.presence(artifact.id).catch(() => null))?.agentName ?? 'Agent';
        const root = options.rootOf(artifact.id);
        const declaration = type.page ? pageDeclaration(root) : type.source.declaration();
        if (!declaration) throw new FrameError('not_frame_type', `${type.source.label}/index.html has no // artifact.json declaration.`, 500);
        const env = envOf(artifact, type, agentName);
        const site = new SiteFrameCore(root, declaration, env);
        const room: Room = { core: site, env, artifact, connections: new Set(), lastUsed: Date.now(), commentsTimer: null, commentsBy: new Set() };
        site.onComments = () => touchComments(room);
        rooms.set(artifact.id, room);
        return room;
      })();
      opening.set(artifact.id, pending);
      pending.finally(() => opening.delete(artifact.id)).catch(() => undefined);
    }
    return pending;
  };

  /** The current access of a principal to a page artifact, or null (no access, trashed, not a page, no folder). */
  const accessOf = async (id: string, ref: PrincipalRef): Promise<CachedAccess | null> => {
    const access = await cache.role(id, ref);
    if (!access) return null;
    if (access.artifact.trashedAt !== null || !types.typeOf(access.artifact.type)) return null;
    if (!(await isDirectory(options.rootOf(id)))) return null;
    return access;
  };

  /** A page token's viewer: the token as the type server checks one, then the live role. */
  const placeShell = async (req: IncomingMessage, token: string, use: PageTokenUse): Promise<{ viewer: SiteViewer; artifact: ArtifactRow } | null> => {
    const id = artifactOfContentHost(config, req.headers.host);
    if (!id) return null;
    const claims = await verifyPageToken(token, config.signingKeys);
    if (!claims || claims.s === 1) return null; // a snapshot token: no snapshot of a page here
    if (!checkPageToken(claims, { artifact: id, grantsVersion: claims.gv, epoch: claims.ep, now: now(), use }).ok) return null;
    const ref: PrincipalRef = { kind: claims.k, id: claims.p };
    const access = await accessOf(id, ref);
    if (!access || access.epoch !== claims.ep) return null;
    const viewer = viewerOf(access, ref);
    const opaque = await pageHostOpaque(config.signingKeys, id, ref, access.epoch);
    viewer[OPAQUE] = opaque;
    await remember(id, opaque, ref);
    return { viewer, artifact: access.artifact };
  };

  /** A page host's reader: the principal its opaque part was made for, with their live role. */
  const placeReader = async (host: string | undefined): Promise<{ viewer: SiteViewer; artifact: ArtifactRow } | null> => {
    const named = pageHostOf(config, host);
    if (!named) return null;
    const known = await loadIndex(named.id);
    let ref = known.get(named.opaque) ?? null;
    if (!ref) {
      // Not made here yet (another host's index, or a lost one): the owner's and the user grants' are worked out.
      const artifact = await catalog.getArtifact(named.id);
      if (!artifact) return null;
      const epoch = await catalog.siteEpoch();
      const candidates: PrincipalRef[] = [{ kind: 'user', id: artifact.ownerUser }];
      for (const g of await catalog.listGrants(named.id)) if (g.subjectKind === 'user') candidates.push({ kind: 'user', id: g.subject });
      for (const c of candidates) if (await pageHostMatches(config.signingKeys, named.opaque, named.id, c, epoch)) ref = c;
      if (!ref) return null;
    }
    const access = await accessOf(named.id, ref);
    if (!access) return null;
    // The epoch moved (every session signed out): the old host names nobody.
    if (!(await pageHostMatches(config.signingKeys, named.opaque, named.id, ref, access.epoch))) return null;
    const viewer = viewerOf(access, ref);
    viewer[OPAQUE] = named.opaque;
    return { viewer, artifact: access.artifact };
  };

  const useOf = (rest: string): PageTokenUse => (rest === '' || rest === '/' || rest === '/index.html' ? 'document' : rest === '/api/frame/events' ? 'socket' : 'api');

  const track = (room: Room, viewer: SiteViewer, end: () => void): (() => void) => {
    const entry = { ref: viewer[REF]!, role: viewer[ROLE]!, end };
    room.connections.add(entry);
    return () => {
      room.connections.delete(entry);
      room.lastUsed = Date.now();
    };
  };

  const engine: FrameEngine = {
    runs: (type) => types.typeOf(type) !== null,
    isPageHost: (host) => pageHostOf(config, host) !== null,

    async shell(req, res) {
      const split = splitShellPath(req.url ?? '/');
      if (!split) return refuse(res, 404, 'Not found.');
      // `/page/<token>` → `/page/<token>/`: the inner shell's own addresses are relative to it.
      if (split.rest === '') {
        res.writeHead(302, { location: `${encodeURIComponent(split.token)}/${split.search}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        return void res.end();
      }
      const placed = await placeShell(req, split.token, useOf(split.rest));
      if (!placed) return refuse(res, 403, 'This page address is not valid now: open the artifact again from the site.');
      let room: Room;
      try {
        room = await open(placed.artifact);
      } catch (error) {
        return refuse(res, (error as FrameError)?.status ?? 500, (error as Error)?.message ?? 'The page cannot open.');
      }
      room.lastUsed = Date.now();
      const request = plain(req, split.rest + split.search, { viewer: placed.viewer });
      const reply = await current.run(placed.viewer, () => room.core.request(request));
      if (!('events' in reply)) return send(req, res, reply);
      // The event stream as server-sent events (the WebSocket comes in through `upgrade`).
      const client = String(new URL(request.url, 'http://local').searchParams.get('c') ?? '');
      if (!FrameCore.validClient(client)) return refuse(res, 400, 'Not a client id.');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'Referrer-Policy': 'no-referrer' });
      const untrack = track(room, placed.viewer, () => res.end());
      const closed = room.core.connect(request, client, { send: (obj) => void res.write(`data: ${JSON.stringify(obj)}\n\n`), end: () => res.end() });
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        closed();
        untrack();
      });
    },

    async content(req, res) {
      const placed = await placeReader(req.headers.host);
      if (!placed) return refuse(res, 403, 'Not with this address.');
      let room: Room;
      try {
        room = await open(placed.artifact);
      } catch (error) {
        return refuse(res, (error as FrameError)?.status ?? 500, (error as Error)?.message ?? 'The page cannot open.');
      }
      room.lastUsed = Date.now();
      send(req, res, await room.core.contentRequest(plain(req, req.url ?? '/', { viewer: placed.viewer })));
    },

    async upgrade(req, socket, head) {
      const split = pageHostOf(config, req.headers.host) ? null : splitShellPath(req.url ?? '/');
      const no = (): void => void socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      if (!split || split.rest !== '/api/frame/events') return no();
      const placed = await placeShell(req, split.token, 'socket');
      if (!placed) return no();
      const room = await open(placed.artifact).catch(() => null);
      if (!room) return no();
      const request = plain(req, split.rest + split.search, { viewer: placed.viewer });
      if (!room.core.acceptsStream(request)) return no();
      const client = String(new URL(request.url, 'http://local').searchParams.get('c') ?? '');
      if (!FrameCore.validClient(client)) return no();
      const ws = acceptWebSocket(req, socket, head, 'baoyu-sse');
      if (!ws) return;
      const untrack = track(room, placed.viewer, () => ws.close(4001));
      const closed = room.core.connect(request, client, { send: (obj) => ws.sendText(JSON.stringify(obj)), end: () => ws.close() });
      ws.handlers.close = () => {
        closed();
        untrack();
      };
    },

    async refresh(id) {
      const room = rooms.get(id);
      if (!room) return;
      const artifact = await catalog.getArtifact(id);
      if (!artifact || artifact.trashedAt !== null) {
        engine.close(id);
        return;
      }
      room.artifact = artifact;
      for (const c of [...room.connections]) {
        const access = await cache.role(id, c.ref);
        if (!access || access.role !== c.role) c.end();
      }
    },

    connected(id) {
      const room = rooms.get(id);
      const refs = new Map<string, PrincipalRef>();
      for (const c of room?.connections ?? []) refs.set(refKey(c.ref), c.ref);
      return [...refs.values()];
    },

    async pageHostAllowed(host) {
      return (await placeReader(host).catch(() => null)) !== null;
    },

    typeChanged(typeId) {
      for (const [id, room] of [...rooms]) {
        if (room.artifact.type !== typeId) continue;
        const type = types.typeOf(typeId);
        if (!type) {
          engine.close(id);
          continue;
        }
        const next = type.policy ?? policy;
        if (next.contentSecurityPolicy !== room.core.contentSecurityPolicy) {
          room.core.setPolicy(next.contentSecurityPolicy);
          (room.env as { allowedNetworkOrigins?: readonly string[] }).allowedNetworkOrigins = [...next.allowedNetworkOrigins];
        }
        room.core.typeChanged();
      }
    },

    noteChanges(id, paths) {
      rooms.get(id)?.core.noteChanges(paths);
    },

    async action(id, name, args) {
      const artifact = await catalog.getArtifact(id);
      if (!artifact || !types.typeOf(artifact.type)) throw httpError('not_found', `No page artifact ${id}.`);
      const room = await open(artifact);
      const action = Object.hasOwn(frameActions, name) ? frameActions[name] : undefined;
      if (!action) throw httpError('unknown_action', `Page artifacts have no action ${name}.`, { status: 404 });
      room.lastUsed = Date.now();
      try {
        return await action.run({ id, root: room.core.root, title: room.artifact.title, site: room.core as never }, args);
      } catch (error) {
        if (error instanceof FrameError) throw httpError(error.code as never, error.message, { status: error.status });
        throw error;
      }
    },

    async forget(id) {
      engine.close(id);
      index.delete(id);
      await rm(join(indexDir, `${id}.json`), { force: true });
    },

    close(id) {
      const room = rooms.get(id);
      if (!room) return;
      rooms.delete(id);
      if (room.commentsTimer) clearTimeout(room.commentsTimer);
      for (const c of room.connections) c.end();
      room.core.close();
    },

    async stop() {
      clearInterval(sweep);
      for (const id of [...rooms.keys()]) engine.close(id);
    },
  };

  // An artifact nobody has open or asked for a while is closed; the next request opens it again.
  const sweep = setInterval(() => {
    if (!options.idleCloseMs) return;
    const before = Date.now() - options.idleCloseMs;
    for (const [id, room] of rooms) if (room.connections.size === 0 && room.lastUsed < before) engine.close(id);
  }, Math.max(1000, Math.min(60_000, options.idleCloseMs || 60_000)));
  sweep.unref();

  return engine;
}

// ---- the host's own side: titles and declared capabilities ---------------------------------------------------------

/** A page artifact's title: its index.html's `<title>`, or undefined. */
export async function pageTitleOf(root: string): Promise<string | undefined> {
  const html = await readFile(join(root, 'index.html'), 'utf8').catch(() => '');
  return titleInHtml(html)?.trim().slice(0, 200) || undefined;
}

/** The largest capabilities block taken (its JSON), bytes: a declaration, not data. */
export const MAX_CAPABILITIES_BYTES = 64 * 1024;

/**
 * The Link's (and the site's MCP's) side of page artifacts: their declared capabilities, kept in `.artifact.json`
 * (which no file push may write). A change reaches the open pages through the core (`capabilitiesChanged`, by
 * `noteChanges`), and, unless the Link made it, the owner's Link (`artifact-changed` with `capabilities`).
 */
export function pageServices(rooms: { rootOf(id: string): string; frames: FrameEngine }, events: HostEvents, catalog?: Pick<Catalog, 'getArtifact'>): PageServices {
  const markerOf = async (id: string): Promise<Record<string, unknown> | null> => {
    try {
      const parsed = JSON.parse(await readFile(join(rooms.rootOf(id), '.artifact.json'), 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  // Only the page type's artifacts declare capabilities: a published type's come from its declaration.
  const isPage = async (id: string): Promise<boolean> => {
    if (catalog) {
      const artifact = await catalog.getArtifact(id);
      return !!artifact && artifact.type === PAGE_TYPE && rooms.frames.runs(artifact.type);
    }
    return (await markerOf(id))?.type === PAGE_TYPE;
  };
  return {
    async capabilities(id) {
      if (!(await isPage(id))) return null;
      const caps = (await markerOf(id))?.capabilities;
      return caps && typeof caps === 'object' && !Array.isArray(caps) ? (caps as Record<string, unknown>) : {};
    },
    async setCapabilities(id, capabilities, author) {
      if (!(await isPage(id))) throw httpError('invalid_argument', `${id} is not a page artifact: only a page declares its capabilities.`);
      const text = JSON.stringify(capabilities);
      if (Buffer.byteLength(text) > MAX_CAPABILITIES_BYTES) throw httpError('too_large', `The capabilities block is over ${MAX_CAPABILITIES_BYTES} bytes.`);
      const marker = (await markerOf(id)) ?? { type: PAGE_TYPE, id };
      if (JSON.stringify(marker.capabilities ?? null) === text) return;
      marker.capabilities = capabilities;
      const file = join(rooms.rootOf(id), '.artifact.json');
      const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
      await writeFile(temp, `${JSON.stringify(marker, null, 2)}\n`);
      await rename(temp, file);
      rooms.frames.noteChanges(id, ['.artifact.json']);
      if (author !== LINK_AUTHOR) events.emit('artifact-changed', { id, author, capabilities });
    },
  };
}
