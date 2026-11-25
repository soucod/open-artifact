/**
 * The per-artifact object: one artifact's folder, its type server, and its pages' connections, as a Durable Object.
 *
 * The folder is the object's own SQLite, mounted at `/a/<id>` through the `node:fs` replacement (`fs/`); the artifact
 * is `/a/<id>/<id>` inside it (an import unpacks into a temp folder beside it and renames it in, so the mount holds
 * both). The type server runs unchanged on top, in hosted mode, with its identity decisions taken from an injected
 * {@link RoomHost} (the Worker package backs it with the host core).
 *
 * One type server per object, not one per isolate. The type server keeps every artifact it served in memory (its
 * `byId` map, a store per artifact, watchers, status and rescan timers) and only lets go in `close(id)`/`stop()`;
 * an object that is evicted gets no call to say so. With one server per object, everything of an artifact lives and
 * dies with its object: a new instance for the same id (eviction, then a request) stops the previous instance's
 * server and unmounts its folder before it mounts its own ({@link previous}), and two artifacts in one isolate share
 * nothing but the read-only editor assets. One shared server would keep evicted artifacts' state (and timers) alive
 * with no one to close them, and route two objects' calls through one `byId`.
 *
 * Paths: the Worker serves `/_open-artifact/editors/<type>/assets/**`, `/_open-artifact/shell/assets/**` and
 * `support.js` straight from static assets (they never reach an object). The type server reads only what it rewrites
 * or answers itself — `editors/<type>/index.html`, `shell/index.html`, and assets asked of it directly — through the
 * read-only mount at `/_assets` ({@link ASSETS_ROOT}), which fetches `env.ASSETS`.
 *
 * Internal routes (`/__open-artifact/*`, the agent's actions) are reached without a listener, through the type
 * server's `internal(req, res)`: the in-process call is the trust. A page's event socket is a Workers `WebSocketPair`
 * handed to `connect(req, socket)` once the server admitted it (`bridge/ws.ts`).
 *
 * Going quiet: the type server runs with `watch: 'events'` (the folder's storage reports every write, so no timer
 * polls it) and `idleCloseMs` ({@link ROOM_IDLE_CLOSE_MS}): once no page has been connected and no request has been in
 * flight that long, the artifact is closed (its store flushed, watchers and timers gone) and the host is told
 * ({@link RoomHost.idle}) so nothing calls the object again until a page or the Worker does. The next request opens
 * it again from the folder. An open event stream keeps the type server's 25 s keep-alive and the bridge's heartbeat
 * ({@link RoomOptions.sseHeartbeatMs}); a WebSocket keeps no timer (the platform keeps it alive).
 *
 * The agent's presence: the host keeps the hub's word briefly; when the hub says the owner's Link came or went
 * ({@link ArtifactRoom.agentChanged}) the host forgets it and the open pages are told at once. A room whose artifact is
 * closed has nothing to tell and boots nothing for it.
 *
 * Page artifacts (`type: page`, when the host offers {@link RoomHost.pages}): the frame core runs them instead of the
 * type server ({@link RoomFrames}, `frames.ts`), on the same mounted folder. What reaches it: `/page/<token>/…` on the
 * content host, and every request of the artifact's page hosts (`<idlabel>--<opaque>`). The Worker's calls take them
 * too: a page's actions are the frame core's, writes are handed to its open pages, its connections are counted with
 * the type server's, and its page-host index ({@link PAGE_HOSTS_TABLE}) is dropped with the rest by `destroy`.
 */
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { dirname, join } from 'node:path';
import type { PrincipalRef } from '@open-artifact/host';
import type { LinkFile, LinkWrite, LinkWriteResult, OpenArtifactErrorCode } from '@open-artifact/protocol';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import {
  archiveEntries,
  ArchiveTooLarge,
  createTypeServer,
  importArchive as unpackArchive,
  readArtifactTitle,
  contentDirOf,
  detectType,
  TYPES,
  isTypeName,
  writeZip,
  type ImportedArchive,
  type ImportLimits,
  type TypeApiLike,
  type TypeServer,
  type TypeServerHosting,
} from '@open-artifact/type-server';
import { createArtifactFiles } from '@open-artifact/host/files';
import { bridgeRequest, HEARTBEAT_MS } from './bridge/http.ts';
import { deferredSocket, type WebSocketPairFactory, type WorkersWebSocket } from './bridge/ws.ts';
import { mount, mountAssets, type Unmount } from './fs/mounts.ts';
import type { StorageCounters, Usage } from './fs/backend.ts';
import type { SqlBackend, SyncStorage } from './fs/sql.ts';
import { openDescriptors } from './fs/sync.ts';
import { watcherCount } from './fs/watch.ts';
import { liveTimers, trackTimers, type LiveTimer } from './timers.ts';
import { PAGE_HOSTS_TABLE, PAGE_TYPE, pageScaffold, pageTitleOf, RoomFrames, sqlPageHostIndex, type PageHostIndex, type RoomPages } from './frames.ts';

/** Where the editors are mounted (read-only, fetched from the assets binding). */
export const ASSETS_ROOT = '/_assets';
/** The assets binding's path the editors are under (`dist/server` copied to `<assets dir>/_open-artifact/`). */
export const ASSETS_BASE = 'https://assets.invalid/_open-artifact/';
/** The request header the Worker names the artifact in (it routes by artifact id). */
export const ARTIFACT_HEADER = 'x-open-artifact-artifact';
/** How long an artifact stays open with no page and no request, ms (`RoomOptions.idleCloseMs`). */
export const ROOM_IDLE_CLOSE_MS = 60_000;

/** Who a page connection stands for, kept on its viewer (not sent: JSON leaves symbols out). */
const PRINCIPAL = Symbol('open-artifact.cloudflare.principal');
type TaggedViewer = Viewer & { [PRINCIPAL]?: PrincipalRef };

/** A principal as the host core names one. */
export type { PrincipalRef };

/** The hosting decisions a room takes from the Worker (which implements them with the host core and D1). */
export interface RoomHost {
  /** Verify a page token for this artifact and say who it is; null refuses. */
  resolve(
    artifactId: string,
    token: string,
    use: 'document' | 'socket' | 'api',
    request: Request,
  ): Promise<{ title: string; type: string; viewer: Viewer; principal?: PrincipalRef; snapshot?: { until: number } } | null>;
  /**
   * Whether the artifact may be opened without a page (a `/_blob/<id>` request with no page Referer): its title, or
   * null when it may not (unknown here, or in the trash). Without it the folder alone decides.
   */
  locate?(artifactId: string): Promise<{ title: string } | null>;
  pageBase(artifactId: string): string;
  shellUrl(artifactId: string): string;
  appOrigin(): string;
  /** The owner's display name (read at each resolve and action: the type server asks for it synchronously). */
  ownerName(artifactId: string): Promise<string>;
  /** Whether this viewer may ask the owner's agent (an editor, when the owner allows it). Synchronous: cache ahead. */
  mayAskAgent?(artifactId: string, viewer: Viewer): boolean;
  /** Whether this viewer may export on the type server's side (a doc's file). Synchronous: cache ahead. */
  mayExport?(artifactId: string, viewer: Viewer): boolean;
  /** A dashboard's page asked for its live data to be refreshed: queue it for the owner's Link (see `TypeServerHosting`). */
  dataRefresh?(artifactId: string, viewer: Viewer, request: { queries?: string[] }): Promise<{ online: boolean }>;
  /** The type server's daemon calls (wake, presence, touch) for this artifact. */
  typeApi: TypeApiLike;
  /** The agent's presence changed (the hub said so): forget what was kept about it before the pages ask again. */
  presenceChanged?(artifactId: string): void;
  /** The artifact was closed for being idle (nothing open in the room): stop telling the room of anything. */
  idle?(artifactId: string): void;
  /** Page artifacts (the frame engine): who their requests are, their types and policy. Absent: none run here. */
  pages?: RoomPages;
}

/** A Durable Object's state, as far as a room uses it. */
export interface RoomState {
  storage: SyncStorage & { deleteAll?(): Promise<void> };
  id: { toString(): string; readonly name?: string };
}

/** What `env.ASSETS` offers (the static assets binding). */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

/** The bindings a room reads. */
export interface RoomEnv {
  ASSETS: AssetsBinding;
}

export interface RoomOptions {
  host: RoomHost;
  /** Makes a WebSocket pair (Workers: `() => Object.values(new WebSocketPair())`); default the global one. */
  pair?: WebSocketPairFactory;
  /**
   * The handshake's answer for the client end (Workers: `new Response(null, { status: 101, webSocket })`), with the
   * headers it must carry (a page's inner shell asks for a subprotocol, which the answer names).
   */
  upgraded?: (client: unknown, headers?: Record<string, string>) => Response;
  /** Diagnostic log (default `console.log`). */
  log?: (line: string) => void;
  /** Closes the artifact after this long with no page and no request, ms; 0 never. Default {@link ROOM_IDLE_CLOSE_MS}. */
  idleCloseMs?: number;
  /**
   * How often an idle event stream gets an SSE comment from the bridge, ms; 0 never. Default the bridge's 1 s. The
   * write is how a departed client is noticed where the request's abort signal does not reach the object.
   */
  sseHeartbeatMs?: number;
  /** List the isolate's live timers in `stats()` (wraps the global timer functions; default off). */
  trackTimers?: boolean;
}

/** What `stats()` reports. */
export interface RoomStats {
  artifactId: string | null;
  /** This object's SQL since it was constructed: statements, rows read and written (chunk rows apart). */
  storage: StorageCounters;
  /** What its folder holds now (an index scan: for stats only). */
  usage: Usage;
  /** The database's size in bytes, where the platform reports it. */
  databaseBytes: number | null;
  /** Page connections now (event streams and sockets). */
  connections: number;
  /** Artifacts open in the type server or the frame core (0 or 1; 0 once closed for being idle). */
  open: number;
  /**
   * In the isolate (shared with other objects in it): timers (null unless `trackTimers`), `fs.watch` watchers, open
   * descriptors.
   */
  isolate: { timers: LiveTimer[] | null; watchers: number; descriptors: number };
}

/** A previous instance's teardown per artifact (an evicted object's successor runs it). */
const previous = new Map<string, () => Promise<void>>();
/** The editors' mount, shared by every room in the isolate. */
let assetsMount: Unmount | null = null;

const META_TABLE = 'oa_room_meta';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Runs `fn` with the error a caller can act on: an `HttpError`-like `{ status, code, message }` as an `Error` with
 * those fields, which survives RPC as its message.
 */
function roomError(code: OpenArtifactErrorCode | string, message: string, status = 400): Error & { code: string; status: number } {
  return Object.assign(new Error(message), { code, status });
}

export class ArtifactRoom {
  readonly state: RoomState;
  readonly env: RoomEnv;
  private readonly host: RoomHost;
  private readonly pair: WebSocketPairFactory;
  private readonly upgraded: (client: unknown, headers?: Record<string, string>) => Response;
  private readonly log: (line: string) => void;
  private readonly idleCloseMs: number;
  private readonly sseHeartbeatMs: number;
  private readonly tracking: boolean;
  /** The type server's own listener secret (unused: the room calls `internal`, and nothing listens). */
  private readonly secret = randomBytes(32).toString('hex');
  /** The artifact this object holds, once known. */
  private artifactId: string | null = null;
  private folder: (Unmount & { readonly backend: SqlBackend }) | null = null;
  private typeServer: TypeServer | null = null;
  private files: ReturnType<typeof createArtifactFiles> | null = null;
  /** A page artifact's frame core, once a page request or call needed it (it opens its core lazily itself). */
  private frames: RoomFrames | null = null;
  private pageIndex: PageHostIndex | null = null;
  private booting: Promise<void> | null = null;
  /** The owner's name and the title, as last read (the type server asks synchronously). */
  private ownerName = 'Owner';
  private title = '';
  /** The Fetch request behind each bridged one (for `RoomHost.resolve`). */
  private readonly requests = new WeakMap<IncomingMessage, Request>();

  constructor(state: RoomState, env: RoomEnv, options: RoomOptions) {
    this.state = state;
    this.env = env;
    this.host = options.host;
    this.log = options.log ?? ((line) => console.log(line));
    this.pair = options.pair ?? defaultPair;
    this.upgraded = options.upgraded ?? ((client, headers) => new Response(null, { status: 101, webSocket: client, ...(headers ? { headers } : {}) } as ResponseInit));
    this.idleCloseMs = Math.max(0, options.idleCloseMs ?? ROOM_IDLE_CLOSE_MS);
    this.sseHeartbeatMs = Math.max(0, options.sseHeartbeatMs ?? HEARTBEAT_MS);
    this.tracking = options.trackTimers === true;
    if (this.tracking) trackTimers();
    this.state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID`);
    const known = this.state.storage.sql.exec<{ value: string }>(`SELECT value FROM ${META_TABLE} WHERE key = 'artifact'`).toArray()[0];
    this.artifactId = known?.value ?? (state.id.name && ID_PATTERN.test(state.id.name) ? state.id.name : null);
  }

  /** The artifact folder (`/a/<id>/<id>`). */
  rootOf(id: string): string {
    return `/a/${id}/${id}`;
  }

  /* ---------------------------------------------------------------------- */
  /* Content-origin traffic                                                 */
  /* ---------------------------------------------------------------------- */

  /** A page's request (HTTP, an event stream, or its WebSocket). The Worker names the artifact in {@link ARTIFACT_HEADER}. */
  async fetch(request: Request): Promise<Response> {
    try {
      this.claim(request.headers.get(ARTIFACT_HEADER));
      const server = await this.boot();
      const pages = this.host.pages;
      if (pages) {
        const url = new URL(request.url);
        // A page host is a page artifact's only: never the type server's.
        if (pages.pageHostOf(url.host)) return await this.framesOf(pages).fetch(request);
        if (url.pathname === `/${PAGE_TYPE}` || url.pathname.startsWith(`/${PAGE_TYPE}/`)) return await this.framesOf(pages).fetch(request);
      }
      const { req, res, response } = bridgeRequest(request, { heartbeatMs: this.sseHeartbeatMs });
      this.requests.set(req, request);
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        // The server admits it (or answers the refusal's status); the platform does the handshake.
        const pending = deferredSocket();
        const status = await server.connect(req, pending.socket);
        // The bridged response is not used: the answer is the handshake's.
        res.destroy();
        if (status !== 101) {
          pending.abandon();
          return new Response(null, { status });
        }
        const [client, socket] = this.pair();
        pending.accept(socket);
        return this.upgraded(client);
      }
      server.handle(req, res);
      return await response;
    } catch (error) {
      return errorResponse(error);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Calls from the Worker                                                  */
  /* ---------------------------------------------------------------------- */

  /** Names the artifact this object holds (the first call records it) and starts its type server. */
  async ready(id: string): Promise<void> {
    this.claim(id);
    await this.boot();
  }

  /** Writes a new artifact's files (path → bytes) as its folder; `exists` when it has one. */
  async seed(id: string, files: Record<string, Uint8Array | string>): Promise<{ files: number; bytes: number }> {
    this.claim(id);
    await this.boot();
    const root = this.rootOf(id);
    if (existsSync(root)) throw roomError('exists', `Artifact ${id} has a folder already.`, 409);
    const temp = `${dirname(root)}/.seed.${randomBytes(6).toString('hex')}.tmp`;
    let bytes = 0;
    try {
      for (const [path, content] of Object.entries(files)) {
        if (!path || path.startsWith('/') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
          throw roomError('invalid_argument', `Not a path in an artifact: ${path}`);
        }
        const file = join(temp, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
        bytes += typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
      }
      mkdirSync(temp, { recursive: true });
      renameSync(temp, root);
    } catch (error) {
      rmSync(temp, { recursive: true, force: true });
      throw error;
    }
    return { files: Object.keys(files).length, bytes };
  }

  /** Unpacks an export archive as this artifact's folder (the type server's `importArchive`, on the mounted storage). */
  async importArchive(bytes: Uint8Array, options: { id: string; limits?: ImportLimits }): Promise<ImportedArchive> {
    this.claim(options.id);
    await this.boot();
    // A page archive is known by its marker alone (it has no content of its own to detect), when pages run here.
    const markerTypes = this.host.pages ? [PAGE_TYPE] : undefined;
    return unpackArchive(bytes, this.rootOf(options.id), { id: options.id, ...(options.limits ? { limits: options.limits } : {}), ...(markerTypes ? { markerTypes } : {}) });
  }

  /**
   * Unpacks an uploaded archive (as {@link importArchive}) and says its type and a title, as the Node host does: where
   * the type keeps its title (a doc's name), else the `.artifact.json` title, else the zip's top folder name.
   */
  async importArtifact(bytes: Uint8Array, options: { id: string; limits?: ImportLimits }): Promise<{ type: string; title: string }> {
    const imported = await this.importArchive(bytes, options);
    const root = this.rootOf(options.id);
    let title: string | undefined;
    if (isTypeName(imported.type)) title = (await readArtifactTitle(root, imported.type).catch(() => undefined)) ?? undefined;
    // A page's title is its <title> (as on Node).
    else if (this.host.pages && imported.type === PAGE_TYPE) title = pageTitleOf(root);
    if (!title) {
      try {
        const meta = JSON.parse(readFileSync(join(root, '.artifact.json'), 'utf8')) as { title?: unknown };
        if (typeof meta.title === 'string' && meta.title.trim()) title = meta.title.trim();
      } catch {
        /* none */
      }
    }
    return { type: imported.type, title: title ?? zipFolderOf(bytes) ?? 'Imported artifact' };
  }

  /**
   * Makes a new artifact's folder as the type server would (the Node host's `scaffoldArtifact`): `.artifact.json` and
   * the type's empty content, written beside the folder and renamed in. `exists` (409) when it has one.
   */
  async create(input: { id: string; type: string; title: string }): Promise<void> {
    if (this.host.pages && input.type === PAGE_TYPE) {
      await this.seed(input.id, pageScaffold(input.id, input.title));
      return;
    }
    if (!isTypeName(input.type)) throw roomError('invalid_argument', `Unknown type ${input.type}.`);
    const type = input.type;
    const dir = contentDirOf(type);
    const files: Record<string, string> = {
      '.artifact.json': `${JSON.stringify({ type, id: input.id, title: input.title, release: null }, null, 2)}\n`,
    };
    for (const [path, content] of Object.entries(TYPES[type].scaffold(input.title, join(this.rootOf(input.id), dir)))) {
      files[dir ? `${dir}/${path}` : path] = content;
    }
    await this.seed(input.id, files);
  }

  /** The title the artifact's own files hold now (its type's `titleFrom`), at most 200 characters, or null. */
  async contentTitle(type: string): Promise<string | null> {
    const id = this.requireId();
    await this.boot();
    if (this.host.pages && type === PAGE_TYPE) return pageTitleOf(this.rootOf(id)) ?? null;
    if (!isTypeName(type)) return null;
    const title = (await readArtifactTitle(this.rootOf(id), type).catch(() => undefined))?.trim().slice(0, 200);
    return title || null;
  }

  /**
   * The folder as an export zip, streamed (what the Shell's Export tab downloads). `folder` names the zip's top folder
   * (the Node host names it by the title; default the id). `head`: only check it can be zipped (413 when too big) and
   * answer null.
   */
  async archive(options: { folder?: string; head?: boolean } = {}): Promise<ReadableStream<Uint8Array> | null> {
    const id = this.requireId();
    await this.boot();
    const root = this.rootOf(id);
    if (!existsSync(root)) throw roomError('not_found', `Artifact ${id} has no folder.`, 404);
    let entries;
    try {
      entries = await archiveEntries(root);
    } catch (error) {
      if (error instanceof ArchiveTooLarge) throw roomError('too_large', error.message, 413);
      throw error;
    }
    if (options.head) return null;
    if (options.folder) for (const entry of entries) entry.name = `${options.folder}/${entry.name.slice(entry.name.indexOf('/') + 1)}`;
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    writeZip(entries, (chunk) => writer.write(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))).then(
      () => writer.close(),
      (error: unknown) => writer.abort(error),
    );
    return readable;
  }

  /** Every file an export would hold, path → etag and size. */
  async manifest(): Promise<Record<string, LinkFile>> {
    await this.boot();
    return this.artifactFiles().manifest(this.requireId());
  }

  /** One file's bytes and etag, or null. */
  async readFile(path: string): Promise<{ bytes: Uint8Array; etag: string } | null> {
    await this.boot();
    return this.artifactFiles().read(this.requireId(), path);
  }

  /** A page artifact's declared capabilities, or null when it is not a page here. */
  async capabilities(): Promise<Record<string, unknown> | null> {
    await this.boot();
    const pages = this.host.pages;
    if (!pages || !(await this.isPage(pages))) return null;
    return this.framesOf(pages).capabilities();
  }

  /** Replaces a page artifact's declared capabilities; false when they were the same. `invalid_argument` for another type. */
  async setCapabilities(capabilities: Record<string, unknown>): Promise<boolean> {
    const id = this.requireId();
    await this.boot();
    const pages = this.host.pages;
    if (!pages || !(await this.isPage(pages))) throw roomError('invalid_argument', `${id} is not a page artifact: only a page declares its capabilities.`);
    if (!isDirectory(this.rootOf(id))) throw roomError('not_found', `Artifact ${id} has no folder.`, 404);
    return this.framesOf(pages).setCapabilities(capabilities);
  }

  /** Writes and deletes files with the Link's checks (`ArtifactFiles.write`). */
  async writeFiles(writes: LinkWrite[], author: string): Promise<LinkWriteResult[]> {
    await this.boot();
    return this.artifactFiles().write(this.requireId(), writes, author);
  }

  /** Runs an action of the type server (`/__open-artifact/actions/<name>`), or a page's frame action; its JSON answer. */
  async action(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.requireId();
    const server = await this.boot();
    const pages = this.host.pages;
    if (pages && (await this.isPage(pages))) return this.framesOf(pages).action(name, args);
    this.ownerName = await this.host.ownerName(id);
    const request = new Request(`http://127.0.0.1/__open-artifact/actions/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, root: this.rootOf(id), args }),
    });
    const { req, res, response } = bridgeRequest(request);
    server.internal(req, res);
    const answer = await response;
    const body = (await answer.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
    if (!answer.ok) {
      const code = typeof body?.code === 'string' ? body.code : 'server_failed';
      const message = typeof body?.message === 'string' ? body.message : `The action ${name} failed (HTTP ${answer.status}).`;
      throw roomError(code, message, answer.status);
    }
    return body;
  }

  /** The page connections' viewers now (none while the type server or the artifact is not open). */
  private viewers(): Viewer[] {
    return this.typeServer && this.artifactId ? this.typeServer.viewers(this.artifactId) : [];
  }

  /** The principals with a page open now (each once). */
  connected(): PrincipalRef[] {
    const refs = new Map<string, PrincipalRef>();
    for (const viewer of this.viewers()) {
      const ref = refOfViewer(viewer);
      if (ref) refs.set(`${ref.kind}:${ref.id}`, ref);
    }
    for (const ref of this.frames?.connected() ?? []) refs.set(`${ref.kind}:${ref.id}`, ref);
    return [...refs.values()];
  }

  /** Every page connection's principal (null for a snapshot or a viewer the host did not tag) and role. */
  holders(): Array<{ ref: PrincipalRef | null; role: Viewer['role'] }> {
    return [...this.viewers().map((viewer) => ({ ref: refOfViewer(viewer), role: viewer.role })), ...(this.frames?.holders() ?? [])];
  }

  /**
   * The owner's agent came or went (the hub says so): the host forgets the presence it kept and the open pages are
   * told now. Boots nothing: with no type server running there is no page to tell.
   */
  agentChanged(): void {
    const id = this.artifactId;
    if (!id) return;
    this.host.presenceChanged?.(id);
    this.typeServer?.agentChanged(id);
  }

  /** Ends the page connections `keep` answers false for (it is asked synchronously, once per connection). */
  disconnectWhere(keep: (ref: PrincipalRef | null, role: Viewer['role']) => boolean): void {
    this.frames?.disconnectWhere(keep);
    if (!this.typeServer || !this.artifactId) return;
    this.typeServer.disconnect(this.artifactId, (viewer) => keep(refOfViewer(viewer), viewer.role));
  }

  /** Ends the page connections of everyone not in `keep` (principal ids); everyone's when omitted. */
  disconnect(keep?: string[]): void {
    const kept = new Set(keep ?? []);
    this.frames?.disconnectWhere((ref) => kept.has(ref.id));
    if (!this.typeServer || !this.artifactId) return;
    this.typeServer.disconnect(this.artifactId, (viewer) => {
      const ref = refOfViewer(viewer);
      return ref !== null && kept.has(ref.id);
    });
  }

  /** Rows, bytes, connections, whether the artifact is open, and the isolate's live timers. */
  async stats(): Promise<RoomStats> {
    const backend = this.folder?.backend;
    let open = 0;
    if (this.typeServer) {
      const { req, res, response } = bridgeRequest(new Request('http://127.0.0.1/__open-artifact/health'));
      this.typeServer.internal(req, res);
      open = ((await (await response).json()) as { open?: number }).open ?? 0;
    }
    return {
      artifactId: this.artifactId,
      storage: backend?.counters() ?? { statements: 0, rowsRead: 0, rowsWritten: 0, chunkRowsRead: 0, chunkRowsWritten: 0, commits: 0, rollbacks: 0 },
      usage: backend?.usage() ?? { files: 0, dirs: 0, bytes: 0 },
      databaseBytes: this.state.storage.sql.databaseSize ?? null,
      connections: this.viewers().length + (this.frames?.connections ?? 0),
      open: open + (this.frames?.open ? 1 : 0),
      isolate: { timers: this.tracking ? liveTimers() : null, watchers: watcherCount(), descriptors: openDescriptors() },
    };
  }

  /** Stops the type server and deletes everything this object stored. */
  async destroy(): Promise<void> {
    const id = this.artifactId;
    await this.teardown();
    if (id) previous.delete(id);
    const backend = this.folder?.backend;
    backend?.drop();
    this.folder = null;
    this.state.storage.sql.exec(`DROP TABLE IF EXISTS ${META_TABLE}`);
    this.state.storage.sql.exec(`DROP TABLE IF EXISTS ${PAGE_HOSTS_TABLE}`);
    this.pageIndex = null;
    await this.state.storage.deleteAll?.();
    this.artifactId = null;
  }

  /* ---------------------------------------------------------------------- */
  /* Inside                                                                 */
  /* ---------------------------------------------------------------------- */

  /** Records which artifact this object holds (the first time it is told); another id is refused. */
  private claim(id: string | null | undefined): void {
    if (!id) {
      if (!this.artifactId) throw roomError('invalid_argument', 'Name the artifact this object holds.');
      return;
    }
    if (!ID_PATTERN.test(id)) throw roomError('invalid_argument', `Not an artifact id: ${id}`);
    if (this.artifactId === id) return;
    if (this.artifactId) throw roomError('invalid_argument', `This object holds ${this.artifactId}, not ${id}.`);
    this.artifactId = id;
    // After `destroy` the same instance may serve the id again (a Link re-publishing what it unpublished).
    this.state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID`);
    this.state.storage.sql.exec(`INSERT OR REPLACE INTO ${META_TABLE} (key, value) VALUES ('artifact', ?)`, id);
  }

  private requireId(): string {
    if (!this.artifactId) throw roomError('not_found', 'This object holds no artifact yet.', 404);
    return this.artifactId;
  }

  private artifactFiles(): ReturnType<typeof createArtifactFiles> {
    this.files ??= createArtifactFiles(
      (id) => {
        if (id !== this.artifactId) throw roomError('not_found', `This object does not hold ${id}.`, 404);
        return this.rootOf(id);
      },
      // A write the host made itself reaches a page's open core (it has no watcher); nothing while none is open.
      { afterWrite: (_, paths) => this.frames?.noteChanges(paths) },
    );
    return this.files;
  }

  /** Whether this object's artifact is a page here (the catalog's type, through the host). */
  private async isPage(pages: RoomPages): Promise<boolean> {
    const artifact = await pages.artifact(this.requireId());
    return !!artifact && (await pages.types.typeOf(artifact.type))?.page === true;
  }

  /** The page artifact's frame engine (made once; it opens its core on the first request that needs it). */
  private framesOf(pages: RoomPages): RoomFrames {
    const id = this.requireId();
    if (this.frames) return this.frames;
    this.pageIndex ??= sqlPageHostIndex(this.state.storage.sql);
    this.frames = new RoomFrames({
      id,
      root: this.rootOf(id),
      pages,
      typeApi: this.host.typeApi,
      index: this.pageIndex,
      pair: this.pair,
      upgraded: (client, headers) => this.upgraded(client, headers),
      log: (line) => this.log(`[room ${id}] ${line}`),
      idleCloseMs: this.idleCloseMs,
      sseHeartbeatMs: this.sseHeartbeatMs,
      onIdle: () => this.host.idle?.(id),
    });
    return this.frames;
  }

  /** Mounts the folder and starts the type server, once. */
  private boot(): Promise<TypeServer> {
    this.booting ??= this.start().catch((error: unknown) => {
      this.booting = null;
      throw error;
    });
    return this.booting.then(() => this.typeServer!);
  }

  private async start(): Promise<void> {
    const id = this.requireId();
    // An earlier instance of this object (evicted) left its server and mount in the isolate: end them first.
    await previous.get(id)?.();
    assetsMount ??= mountAssets(ASSETS_ROOT, (request) => this.env.ASSETS.fetch(request), ASSETS_BASE);
    this.folder = mount(`/a/${id}`, this.state.storage);
    const host = this.host;
    const appOrigin = host.appOrigin();
    const hosting: TypeServerHosting = {
      // The Worker routes by host and artifact; what reaches the object is this artifact's.
      hostAllowed: () => true,
      artifactOfHost: () => id,
      pageBase: () => host.pageBase(id),
      shellUrl: () => host.shellUrl(id),
      appOrigin,
      ownerName: () => this.ownerName,
      ...(host.mayAskAgent ? { mayAskAgent: (_: string, viewer: Viewer) => host.mayAskAgent!(id, viewer) } : {}),
      ...(host.mayExport ? { mayExport: (_: string, viewer: Viewer) => host.mayExport!(id, viewer) } : {}),
      ...(host.dataRefresh ? { dataRefresh: (_: string, viewer: Viewer, request: { queries?: string[] }) => host.dataRefresh!(id, viewer, request) } : {}),
      resolve: async (token, type, req, use) => {
        const request = this.requests.get(req);
        if (!request) return null;
        const resolved = await host.resolve(id, token, use, request);
        if (!resolved || resolved.type !== type) return null;
        const root = this.rootOf(id);
        if (!isDirectory(root)) return null;
        this.ownerName = await host.ownerName(id);
        this.title = resolved.title;
        // A snapshot is nobody among the page's people: no principal tag (it is neither listed nor kept by a refresh).
        if (resolved.snapshot) return { id, root, title: resolved.title, viewer: { ...resolved.viewer }, snapshot: resolved.snapshot };
        const viewer: TaggedViewer = { ...resolved.viewer };
        viewer[PRINCIPAL] = resolved.principal ?? { kind: resolved.viewer.kind ?? 'user', id: resolved.viewer.id };
        return { id, root, title: resolved.title, viewer };
      },
      locate: async (asked) => {
        if (asked !== id) return null;
        const root = this.rootOf(id);
        if (!isDirectory(root)) return null;
        if (host.locate) {
          const located = await host.locate(id);
          if (!located) return null;
          this.title = located.title;
        }
        this.ownerName = await host.ownerName(id);
        if (!this.title) {
          const type = await detectType(root);
          this.title = (type ? await readArtifactTitle(root, type).catch(() => undefined) : undefined) ?? id;
        }
        return { root, title: this.title };
      },
      // The folder's storage reports every write to `fs.watch`, and this server is its only writer.
      watch: 'events',
      idleCloseMs: this.idleCloseMs,
      onIdleClose: (closed, stillOpen) => {
        if (stillOpen === 0) host.idle?.(closed);
      },
      // The bundle carries no PDF.js: a doc's PDF import is refused as `unsupported`.
      pdfImport: false,
    };
    const server = createTypeServer({
      assetsDir: ASSETS_ROOT,
      secret: this.secret,
      hosting,
      daemon: host.typeApi,
      idleMs: 0,
      lanAddresses: () => [],
      downloadsDir: '/tmp/open-artifact-downloads',
      log: (line) => this.log(`[room ${id}] ${line}`),
    });
    this.typeServer = server;
    const teardown = (): Promise<void> => this.teardown();
    previous.set(id, teardown);
  }

  /** Stops the type server and unmounts the folder (the storage stays). */
  private async teardown(): Promise<void> {
    this.frames?.close();
    this.frames = null;
    const server = this.typeServer;
    this.typeServer = null;
    this.booting = null;
    this.files = null;
    if (server) {
      try {
        await server.stop();
      } catch (error) {
        this.log(`[room] stopping the type server failed: ${String(error)}`);
      }
    }
    // Unmounted, the storage stays (destroy drops it); a later boot mounts it again.
    this.folder?.();
  }
}

/** The principal a page connection's viewer stands for. */
function refOfViewer(viewer: Viewer): PrincipalRef | null {
  const tagged = (viewer as TaggedViewer)[PRINCIPAL];
  if (tagged) return tagged;
  if (!viewer.kind || viewer.id === 'owner') return null;
  return { kind: viewer.kind, id: viewer.id };
}

/** The top folder name of a zip's first entry (`<folder>/<path>`), or null. */
function zipFolderOf(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 30 || view.getUint32(0, true) !== 0x04034b50) return null;
  const length = view.getUint16(26, true);
  const name = new TextDecoder().decode(bytes.subarray(30, 30 + length));
  return name.split('/')[0]?.trim() || null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The global `WebSocketPair` of workerd as a factory. */
const defaultPair: WebSocketPairFactory = () => {
  const Pair = (globalThis as unknown as { WebSocketPair?: new () => Record<string, unknown> }).WebSocketPair;
  if (!Pair) throw new Error('WebSocketPair is not available here: pass `pair` in the room options.');
  const made = Object.values(new Pair());
  return [made[0], made[1] as WorkersWebSocket];
};

/** A refusal as the JSON answer pages and the Worker read. */
function errorResponse(error: unknown): Response {
  const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
  const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'server_failed';
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ code, message }, { status, headers: { 'cache-control': 'no-store' } });
}
