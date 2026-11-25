/**
 * `serve()`: the skeleton of a type server. One process per type, started by
 * the daemon through `entry.start` (or by hand). It listens on `OPEN_ARTIFACT_PORT` (or
 * a free port), prints the {@link ReadyLine}, answers the daemon's `/__open-artifact/*`
 * routes behind `Bearer OPEN_ARTIFACT_SECRET`, and hands every request under
 * `/<kind>/<token>/` to that artifact's {@link Site}.
 *
 * A type plugs in with `mountSite(root, context)`, which returns a
 * {@link Site}: the object that serves one artifact's pages.
 */

import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { threadId } from 'node:worker_threads';
import {
  OPEN_ARTIFACT_PROTOCOL,
  OpenArtifactError,
  TYPE_SERVER_ROUTES,
  errorBody,
  type ArtifactTypeManifest,
  type CloseRequest,
  type ManifestHostHints,
  type OpenRequest,
  type OpenResult,
  type ReadyLine,
  type ShareRequest,
  type ShareView,
  type SummaryResult,
  type TypeApiWakeResult,
  type TypeServerHealth,
  type WakeRequestItem,
  type WakeThread,
} from '@open-artifact/protocol';
import { TypeApi } from './daemon.ts';
import { LanNetwork, type SiteNetwork } from './lan.ts';
import { acceptWebSocket, type WebSocketConnection } from './ws.ts';
import { sendArchive } from './zip.ts';

/** Protocol version this SDK speaks. */
export const PROTOCOL = OPEN_ARTIFACT_PROTOCOL;

/** File a mounted artifact's folder gets, naming the server that serves it. */
export const STATE_FILE = '.artifact-server.json';

/** Per-artifact log file, in the artifact folder. */
const LOG_FILE = '.artifact-server.log';

/** WebSocket subprotocol that carries a site's server-sent event stream. */
export const STREAM_PROTOCOL = 'baoyu-sse';

/** Close codes at and above this one mean "the stream was refused with HTTP status (code - 4000)". */
const STREAM_REFUSED = 4000;

/** Host of an artifact's own origin: `<artifact id>.frame.localhost:<port>`. */
const CONTENT_HOST = /^(art_[0-9a-z]+)\.frame\.localhost:(\d+)$/;

const isLoopback = (address: string | undefined): boolean => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

// ---- Site contract ---------------------------------------------------------------------------------------------------

/** The sharing side of a site, when its type supports LAN sharing. */
export interface SiteShare {
  /** True while the site's LAN sharing is on (keeps it mounted when idle). */
  readonly listening?: boolean;
  /** Restores the saved sharing state after mounting; `open` is whether to open listeners right away. */
  start?(open: boolean): unknown;
  /** `GET /__open-artifact/share?id=`: the sharing state. */
  shareView?(): ShareView | Promise<ShareView>;
  /** `POST /__open-artifact/share`: changes sharing; answers the new state. */
  share?(action: Omit<ShareRequest, 'id'> & Record<string, unknown>): ShareView | Promise<ShareView>;
  /** The share links: `linkRole(token)` is truthy when `/s/<token>` is one of this site's links. */
  sharing?: { linkRole?(token: string): unknown };
}

/**
 * What a type's `mountSite` returns: the server side of one open artifact.
 * The skeleton routes every request under {@link page} to {@link handle},
 * with `req.url` rewritten to the path below the page.
 */
export interface Site {
  /** The site's address, `/<kind>/<token>/`. Unique per server. */
  readonly page: string;
  /**
   * Answers one request. For an event stream carried over WebSocket
   * ({@link STREAM_PROTOCOL}), `res` is a {@link StreamResponse}, which offers
   * the subset of `ServerResponse` an SSE handler uses.
   */
  handle(req: IncomingMessage, res: ServerResponse | StreamResponse): unknown;
  /** Takes a WebSocket upgrade under the page (other than an event stream). */
  upgrade?(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Unmounts: stops watchers, closes connections. */
  close(): void;
  /** LAN sharing, when the type supports it. */
  readonly share?: SiteShare;
  /** Whether the site answers a path outside its page (e.g. its own top-level routes). */
  claims?(pathname: string): boolean;
  /** Whether the site serves a path shared by every site (e.g. common assets). */
  common?(pathname: string): boolean;
  /** Whether the site holds the upload `/_blob/<id>`. */
  hasBlob?(id: string): boolean | Promise<boolean>;
  /**
   * Answers a request on the artifact's own origin, `http://<id>.frame.localhost:<port>`
   * (servers started with {@link TypeServerOptions.contentHosts}). `req.url` is left as sent.
   */
  content?(req: IncomingMessage, res: ServerResponse): unknown;
  /** Takes a WebSocket upgrade on the artifact's own origin. */
  contentUpgrade?(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}

/** Hands what a page sends for the agent to the daemon's wake router. */
export interface AgentHook {
  /** A comment thread for the owner's session. */
  thread(view: WakeThread): Promise<TypeApiWakeResult>;
  /** A page request ("Ask agent to…") for the owner's session. */
  request(request: Omit<WakeRequestItem, 'id'> & { id?: string }): Promise<TypeApiWakeResult>;
}

/** What `mountSite` gets besides the artifact folder. */
export interface SiteContext {
  /** Artifact id. */
  id: string;
  /** Artifact title, as the daemon knows it (may be empty). */
  title: string;
  /** The Type API client. */
  daemon: TypeApi;
  /** Appends a line to the artifact's log file. */
  log(line: string): void;
  /** The LAN listeners, for sharing. */
  network: SiteNetwork;
  /** Whether a request comes from this computer. */
  local(req: IncomingMessage): boolean;
  /** Wakes the owner's session; rejects when the agent could not be reached. */
  agentHook: AgentHook;
  /** The agent's display name, when the daemon knows it. */
  agentName?: string;
  /** false: the daemon cannot wake the agent while it idles; what is sent waits for its next turn. */
  agentWakesIdle?: boolean;
  /** Opening another folder from a page; this skeleton does not support it. */
  open(): Promise<never>;
  /**
   * The artifact's own origin, `http://<id>.frame.localhost:<port>`, when the
   * server routes content hosts ({@link TypeServerOptions.contentHosts}); else null.
   */
  contentOrigin?: string | null;
}

/** One open artifact, as actions see it. */
export interface ArtifactRef {
  id: string;
  /** Absolute path of the artifact folder. */
  root: string;
  title: string;
  site: Site;
}

/** A named operation the agent can call (`POST /__open-artifact/actions/<name>`). */
export interface ServerAction {
  /** Shown in the action list: one line, what it does. */
  title?: string;
  /** When to use it and what it returns (at most 1000 characters reach the agent). */
  description?: string;
  /** `read`: changes nothing. `write` (the default): changes the artifact. */
  effect?: 'read' | 'write';
  /** Left out of `GET /__open-artifact/actions` (reserved `open-artifact.*` actions). */
  hidden?: boolean;
  /** JSON schema of `args`, for the list. */
  schema?: unknown;
  /**
   * A long action: the call answers `{task, pending: true}` at once, the
   * action runs on, and its answer (or error) goes to the daemon through
   * `open-artifact.type.task`, which hands it to the calling session. Without a daemon
   * it runs like any other action.
   */
  long?: boolean;
  /** Runs the action; the answer is sent as JSON. A long action may report `progress` (0 to 1). */
  run(artifact: ArtifactRef, args: Record<string, unknown>, task?: ActionTask): unknown;
}

/** What a long action's `run` gets besides its arguments. */
export interface ActionTask {
  /** The task id the call answered with. */
  id: string;
  /** Reports progress, 0 to 1 (logged by the daemon). */
  progress(fraction: number): void;
}

/** One entry of `GET /__open-artifact/actions`. */
export interface ActionInfo {
  name: string;
  title: string;
  description?: string;
  effect?: 'read' | 'write';
  schema?: unknown;
  long?: boolean;
}

/** What a long action's call answers with, besides its task id. */
export const LONG_ACTION_NOTE = 'This action runs in the background: its result comes to you as a message that starts with "[Artifact task finished]".';

/** The record {@link STATE_FILE} holds. */
export interface ServerStateRecord {
  pid: number;
  /**
   * The worker thread the server runs in, when the daemon runs it in one (an Electron host without `RunAsNode`): the
   * servers in one process share its pid.
   */
  thread?: number;
  /** The site's page URL. */
  url: string;
  port: number;
  root: string;
  /** First segment of the page path. */
  kind: string;
  startedAt: string;
  /** Artifact id. */
  openArtifact: string;
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readJsonBody(req: IncomingMessage, limit = 8 << 20): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new OpenArtifactError('too_large', 'The request body is too large.', { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolvePromise({});
      try {
        const value = JSON.parse(text) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value)) resolvePromise(value as Record<string, unknown>);
        else reject(new OpenArtifactError('invalid_argument', 'The body is not a JSON object.', { status: 400 }));
      } catch {
        reject(new OpenArtifactError('invalid_argument', 'The body is not JSON.', { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function listenOn(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolvePromise((server.address() as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

const notFound = (res: ServerResponse): void => {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Not found');
};

// ---- StreamResponse --------------------------------------------------------------------------------------------------

/**
 * The part of an HTTP response a site's event-stream handler uses, carried
 * over one WebSocket: every `write` is one text message, `end` closes it
 * (with `4000 + status` when the handler refused the stream). Emits `close`
 * when the client goes away.
 */
export class StreamResponse extends EventEmitter {
  /** The WebSocket the stream goes out on. */
  readonly ws: WebSocketConnection;
  /** Status the handler set. */
  statusCode = 200;
  /** Mirrors `ServerResponse.headersSent`. */
  headersSent = false;
  /** Mirrors `ServerResponse.writableEnded`. */
  writableEnded = false;
  /** Mirrors `ServerResponse.destroyed`. */
  destroyed = false;

  /** Wraps an accepted WebSocket. */
  constructor(ws: WebSocketConnection) {
    super();
    this.ws = ws;
  }

  /** Records the status; headers do not travel. */
  writeHead(status: number, ..._rest: unknown[]): this {
    this.statusCode = status;
    this.headersSent = true;
    return this;
  }

  /** Headers do not travel; a no-op. */
  setHeader(..._args: unknown[]): this {
    return this;
  }

  /** A no-op. */
  flushHeaders(): void {}

  /** Sends `chunk` as one text message while the stream is open with status 200. */
  write(chunk: unknown): boolean {
    if (this.statusCode === 200 && !this.writableEnded) this.ws.sendText(String(chunk));
    return true;
  }

  /** Ends the stream, closing the WebSocket. */
  end(chunk?: unknown): this {
    if (this.writableEnded) return this;
    if (chunk !== undefined) this.write(chunk);
    this.writableEnded = true;
    this.ws.close(this.statusCode === 200 ? 1000 : STREAM_REFUSED + Math.min(this.statusCode, 999));
    return this;
  }

  /** Ends the stream. */
  destroy(): this {
    this.destroyed = true;
    return this.end();
  }

  /** The client went away. */
  closed(): void {
    this.writableEnded = true;
    this.emit('close');
  }
}

// ---- libraryActions / typeManifest -----------------------------------------------------------------------------------

/**
 * What {@link libraryActions} looks for in a type library (the module that
 * exports `mountSite`). Every function is optional.
 */
export interface TypeLibrary {
  /** Checks the artifact's files. */
  check?(target: string): unknown;
  /** Adds a file: bytes and a name (`project` style) or an absolute path (`root` style). */
  upload?(target: string, file: Uint8Array | string, name: string, group?: unknown): unknown;
  /** What the artifact holds. */
  readInfo?(target: string): unknown;
  /**
   * `open-artifact.db.read`: the whole store, a collection or a document. `options`
   * (`query`, `limit`, `cursor`) as the agent gave them; see DbStore.readDb.
   */
  readDb?(root: string, path?: string, options?: { query?: unknown; limit?: unknown; cursor?: unknown }): unknown;
  /** `open-artifact.db.write`: a batch of writes; `requireIfMatch` as DbStore.writeDb takes it. */
  writeDb?(root: string, writes: unknown[], options?: { requireIfMatch?: boolean }): unknown;
  /** `open-artifact.comments.read`: open threads (`all`: resolved too). */
  commentThreads?(root: string, all: boolean): unknown;
  /** `open-artifact.comments.reply`. */
  replyComment?(root: string, threadId: string, text: string, resolve: boolean): unknown;
  /** `open-artifact.comments.resolve`. */
  resolveComment?(root: string, threadId: string, reopen: boolean): unknown;
}

const stringArg = (args: Record<string, unknown>, name: string): string => {
  const value = args[name];
  if (typeof value !== 'string' || !value) throw new OpenArtifactError('invalid_argument', `args.${name} must be a non-empty string.`, { status: 400 });
  return value;
};

/**
 * The agent's operations on an artifact through a type library: `check`,
 * `upload` and `info` for the agent's `call`, and the reserved `open-artifact.db.*` and
 * `open-artifact.comments.*` the ArtifactData and ArtifactComments tools use. `config`
 * is the type's `open-artifact` block (`style`, `projectDir`).
 */
export function libraryActions(lib: TypeLibrary, config: ManifestHostHints = {}): Record<string, ServerAction> {
  const style = config.style ?? 'root';
  const target = (root: string): string => (style === 'project' ? join(root, config.projectDir ?? 'project') : root);
  const actions: Record<string, ServerAction> = {};
  if (typeof lib.check === 'function') {
    const check = lib.check.bind(lib);
    actions.check = { title: 'Check the artifact', run: async ({ root }) => ({ check: await check(target(root)) }) };
  }
  if (typeof lib.upload === 'function') {
    const upload = lib.upload.bind(lib);
    actions.upload = {
      title: 'Add a file (args.file: an absolute path; name, group)',
      run: async ({ root }, args) => {
        const file = args.file;
        if (typeof file !== 'string' || !isAbsolute(file)) throw new OpenArtifactError('invalid_argument', 'upload: args.file is an absolute path.', { status: 400 });
        const name = typeof args.name === 'string' && args.name ? args.name : basename(file);
        if (style === 'project') return { upload: await upload(target(root), new Uint8Array(readFileSync(file)), name, args.group) };
        return { upload: await upload(target(root), file, name) };
      },
    };
  }
  actions.info = {
    title: 'What the artifact holds',
    run: async ({ root }) => ({ info: typeof lib.readInfo === 'function' ? await lib.readInfo(target(root)) : null }),
  };
  if (typeof lib.readDb === 'function' && typeof lib.writeDb === 'function') {
    const readDb = lib.readDb.bind(lib);
    const writeDb = lib.writeDb.bind(lib);
    actions['open-artifact.db.read'] = {
      hidden: true,
      run: ({ root }, args) => readDb(root, typeof args.path === 'string' && args.path ? args.path : undefined, { query: args.query, limit: args.limit, cursor: args.cursor }),
    };
    actions['open-artifact.db.write'] = {
      hidden: true,
      run: async ({ root }, args) => ({ writes: await writeDb(root, Array.isArray(args.writes) ? args.writes : [], { requireIfMatch: args.require_if_match === true }) }),
    };
  }
  if (typeof lib.commentThreads === 'function') {
    const threads = lib.commentThreads.bind(lib);
    actions['open-artifact.comments.read'] = { hidden: true, run: async ({ root }, args) => ({ threads: await threads(root, !!args.all) }) };
    if (typeof lib.replyComment === 'function') {
      const reply = lib.replyComment.bind(lib);
      actions['open-artifact.comments.reply'] = {
        hidden: true,
        run: async ({ root }, args) => ({ thread: await reply(root, stringArg(args, 'thread_id'), stringArg(args, 'text'), !!args.resolve) }),
      };
    }
    if (typeof lib.resolveComment === 'function') {
      const resolveComment = lib.resolveComment.bind(lib);
      actions['open-artifact.comments.resolve'] = {
        hidden: true,
        run: async ({ root }, args) => ({ thread: await resolveComment(root, stringArg(args, 'thread_id'), !!args.reopen) }),
      };
    }
  }
  return actions;
}

/** The type's `artifact-type.json`, read from `dir` (default `OPEN_ARTIFACT_TYPE_DIR`); `{}` when there is none. */
export function typeManifest(dir: string | undefined = process.env.OPEN_ARTIFACT_TYPE_DIR): ArtifactTypeManifest {
  if (!dir) return {};
  try {
    const value = JSON.parse(readFileSync(join(dir, 'artifact-type.json'), 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ArtifactTypeManifest) : {};
  } catch {
    return {};
  }
}

// ---- TypeServer ------------------------------------------------------------------------------------------------------

/** Options of {@link TypeServer} and {@link serve}. */
export interface TypeServerOptions {
  /** Mounts one artifact folder; returns its site. */
  mountSite(root: string, context: SiteContext): Site | Promise<Site>;
  /** Named actions (`POST /__open-artifact/actions/<name>`). */
  actions?: Record<string, ServerAction>;
  /** `GET /__open-artifact/summary?id=`. */
  summary?(artifact: { id: string; root: string }): SummaryResult | Promise<SummaryResult>;
  /** Type id (default `OPEN_ARTIFACT_TYPE`, else `type`). */
  type?: string;
  /** Version reported by `/__open-artifact/health` (default `0`). */
  version?: string;
  /** Port to listen on (default `OPEN_ARTIFACT_PORT`, else any free one). */
  port?: number;
  /** Address to listen on (default `127.0.0.1`). */
  host?: string;
  /** Bearer secret of `/__open-artifact/*` (default `OPEN_ARTIFACT_SECRET`); `null` turns the check off. */
  secret?: string | null;
  /** Idle time after which unused sites unmount and the process exits, ms (default `OPEN_ARTIFACT_SERVER_IDLE_MS`, else 15 min; 0: never). */
  idleMs?: number;
  /** Called when the whole server has been idle for `idleMs` (default: close and exit). */
  onIdle?: () => void;
  /** The Type API client (default: from the environment). */
  daemon?: TypeApi;
  /** Diagnostic log (default: stderr with a timestamp). */
  log?: (line: string) => void;
  /**
   * Gives each artifact its own origin: a request whose Host is
   * `<artifact id>.frame.localhost:<port>` (from this computer) goes to that
   * site's {@link Site.content} / {@link Site.contentUpgrade}. Browsers resolve
   * `*.localhost` to loopback by themselves.
   */
  contentHosts?: boolean;
  /**
   * Answers `GET|HEAD /__open-artifact/archive?id=`: the open artifact's folder as a zip, in the shape and with the
   * path rules of the type server's (`zip.ts`, `sendArchive`). frame-host turns it on.
   */
  archive?: boolean;
}

/** One mounted artifact. */
interface Mounted extends ArtifactRef {
  page: string;
  /** Open event streams. */
  streams: number;
  lastUsed: number;
}

/** A type server built on the SDK: the `/__open-artifact/*` routes plus routing to each artifact's site. */
export class TypeServer {
  /** Type id. */
  readonly type: string;
  /** Version reported by `/__open-artifact/health`. */
  readonly version: string;
  /** The Type API client. */
  readonly daemon: TypeApi;
  /** Diagnostic log. */
  readonly log: (line: string) => void;
  /** The loopback HTTP server. */
  readonly server: Server;
  /** The LAN listeners. */
  readonly lan: LanNetwork;
  /** Port once listening. */
  port = 0;

  private readonly options: TypeServerOptions;
  private readonly secret: string | null;
  private readonly idleMs: number;
  private readonly byId = new Map<string, Mounted>();
  private readonly byPage = new Map<string, Mounted>();
  private readonly mounting = new Map<string, Promise<Mounted>>();
  private hosts = new Set<string>();
  private lastActivity = Date.now();
  private timer: NodeJS.Timeout | null = null;

  /** Creates the server; call {@link listen} next. */
  constructor(options: TypeServerOptions) {
    if (typeof options?.mountSite !== 'function') throw new TypeError('serve() needs mountSite(root, context).');
    this.options = options;
    this.type = options.type ?? process.env.OPEN_ARTIFACT_TYPE ?? 'type';
    this.version = options.version ?? '0';
    this.secret = options.secret !== undefined ? options.secret : process.env.OPEN_ARTIFACT_SECRET || null;
    this.daemon = options.daemon ?? new TypeApi();
    this.log = options.log ?? ((line) => process.stderr.write(`[${new Date().toISOString()}] ${line}\n`));
    this.idleMs = options.idleMs ?? Number(process.env.OPEN_ARTIFACT_SERVER_IDLE_MS ?? 15 * 60_000);
    this.server = this.makeServer();
    this.lan = new LanNetwork({
      port: () => this.port,
      createServer: () => this.makeServer(),
      stillShared: () => this.anySharing(),
      log: (line) => this.log(line),
    });
  }

  /** `http://127.0.0.1:<port>`, without a trailing slash. */
  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Number of mounted artifacts. */
  get openCount(): number {
    return this.byId.size;
  }

  private makeServer(): Server {
    const server = createServer((req, res) => {
      this.onRequest(req, res).catch((error: unknown) => {
        if (res.headersSent) return void res.destroy();
        const status = (error as { status?: unknown } | null)?.status;
        sendJson(res, typeof status === 'number' ? status : 500, errorBody(error));
      });
    });
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.onUpgrade(req, socket, head));
    return server;
  }

  /** Listens on the configured port, or any free one when it is taken. */
  async listen(): Promise<this> {
    const want = this.options.port ?? Number(process.env.OPEN_ARTIFACT_PORT || 0);
    const host = this.options.host ?? '127.0.0.1';
    try {
      this.port = await listenOn(this.server, want, host);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || !want) throw error;
      // The last port is taken: any free one (share links name the port, so the daemon offers the same one first).
      this.port = await listenOn(this.server, 0, host);
    }
    this.hosts = new Set([`127.0.0.1:${this.port}`, `localhost:${this.port}`, `[::1]:${this.port}`]);
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
    return this;
  }

  /** The line the daemon waits for, with the protocol version and type for logs. */
  readyLine(): ReadyLine & { protocol: number; type: string } {
    return { openArtifact: 'ready', url: `${this.origin}/`, protocol: PROTOCOL, type: this.type };
  }

  /** Prints the ready line to `out` (default stdout). */
  ready(out: { write(text: string): unknown } = process.stdout): void {
    out.write(`${JSON.stringify(this.readyLine())}\n`);
  }

  private tick(): void {
    if (this.idleMs <= 0) return;
    const now = Date.now();
    // Sites nobody asked anything of for a while, with no stream open and not shared, go.
    for (const entry of [...this.byId.values()]) {
      if (entry.streams <= 0 && now - entry.lastUsed > this.idleMs && !this.sharing(entry)) this.unmount(entry.id);
    }
    if (!this.byId.size && now - this.lastActivity > this.idleMs) {
      this.log('idle: exiting');
      if (this.options.onIdle) this.options.onIdle();
      else {
        this.close();
        process.exit(0);
      }
    }
  }

  private sharing(entry: Mounted): boolean {
    return !!entry.site.share?.listening;
  }

  private anySharing(): boolean {
    return [...this.byId.values()].some((entry) => this.sharing(entry));
  }

  private hostAllowed(req: IncomingMessage): boolean {
    const host = String(req.headers.host ?? '');
    return this.hosts.has(host) || this.lan.hostAllowed(host) || this.contentIdOf(req) !== null;
  }

  /** The artifact id of a request on an artifact's own origin, or null. */
  private contentIdOf(req: IncomingMessage): string | null {
    if (!this.options.contentHosts || !this.port) return null;
    const match = CONTENT_HOST.exec(String(req.headers.host ?? '').toLowerCase());
    if (!match || Number(match[2]) !== this.port || !isLoopback(req.socket.remoteAddress)) return null;
    return match[1]!;
  }

  /** The mounted site whose own origin a request is on, or null when it is not on one. */
  private contentEntry(req: IncomingMessage): { entry: Mounted | null } | null {
    const id = this.contentIdOf(req);
    if (id === null) return null;
    return { entry: this.byId.get(id) ?? null };
  }

  // ---- artifacts -----------------------------------------------------------------------------------------------------

  /** Mounts an artifact (or finds it mounted); idempotent. */
  async open(request: Partial<OpenRequest>): Promise<ArtifactRef & { page: string }> {
    const { id, root, title } = request;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new OpenArtifactError('invalid_argument', 'open needs an artifact id.', { status: 400 });
    if (typeof root !== 'string' || !isAbsolute(root)) {
      throw new OpenArtifactError('invalid_argument', 'open needs the artifact root (an absolute path).', { status: 400 });
    }
    const have = this.byId.get(id);
    if (have && have.root === resolve(root)) {
      have.lastUsed = Date.now();
      if (title) have.title = title;
      return have;
    }
    if (have) this.unmount(id);
    const busy = this.mounting.get(id);
    if (busy) return busy;
    const work = this.mount(id, resolve(root), title).finally(() => this.mounting.delete(id));
    this.mounting.set(id, work);
    return work;
  }

  private async mount(id: string, root: string, title: string | undefined): Promise<Mounted> {
    if (!existsSync(root)) throw new OpenArtifactError('not_found', `The folder ${root} is gone.`, { status: 404 });
    const logFile = join(root, LOG_FILE);
    const log = (line: string): void => {
      try {
        appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`);
      } catch {
        // A read-only or vanished folder.
      }
    };
    let agentName: string | undefined;
    try {
      agentName = (await this.daemon.artifact(id)).agentName || undefined;
    } catch {
      agentName = undefined;
    }
    let agentWakesIdle: boolean | undefined;
    try {
      agentWakesIdle = (await this.daemon.presence(id)).wakesIdle;
    } catch {
      agentWakesIdle = undefined;
    }
    const wake = async (body: Parameters<TypeApi['wake']>[1]): Promise<TypeApiWakeResult> => {
      const out = await this.daemon.wake(id, body);
      if (out.status === 'failed') throw new OpenArtifactError('daemon_failed', 'The agent could not be reached.');
      return out;
    };
    const site = await this.options.mountSite(root, {
      id,
      title: title ?? '',
      daemon: this.daemon,
      log,
      network: this.lan.network,
      local: (req) => isLoopback(req.socket.remoteAddress),
      agentHook: { thread: (view) => wake({ threads: [view] }), request: (request) => wake({ requests: [request] }) },
      ...(agentName ? { agentName } : {}),
      ...(agentWakesIdle === false ? { agentWakesIdle } : {}),
      contentOrigin: this.options.contentHosts && CONTENT_HOST.test(`${id}.frame.localhost:${this.port}`) ? `http://${id}.frame.localhost:${this.port}` : null,
      open: async () => {
        throw new OpenArtifactError('unsupported', 'Opening another folder from a page is not supported here.');
      },
    });
    const other = this.byPage.get(site.page);
    if (other) {
      site.close();
      throw new OpenArtifactError('conflict', `${other.root} is already open at ${site.page}.`, { status: 409 });
    }
    const entry: Mounted = { id, root, title: title ?? '', site, page: site.page, streams: 0, lastUsed: Date.now() };
    this.byId.set(id, entry);
    this.byPage.set(site.page, entry);
    try {
      await site.share?.start?.(false);
    } catch (error) {
      this.unmount(id);
      throw error;
    }
    try {
      const record: ServerStateRecord = {
        pid: process.pid,
        ...(threadId ? { thread: threadId } : {}),
        url: `${this.origin}${site.page}`,
        port: this.port,
        root,
        kind: site.page.split('/')[1] ?? '',
        startedAt: new Date().toISOString(),
        openArtifact: id,
      };
      writeFileSync(join(root, STATE_FILE), `${JSON.stringify(record, null, 2)}\n`);
    } catch {
      // Tools looking for this server will not find it; the page still works.
    }
    this.log(`mounted ${id} at ${site.page}`);
    log(`serving ${root} at ${this.origin}${site.page} (open-artifact type server ${this.type})`);
    return entry;
  }

  /** Unmounts an artifact; false when it was not mounted. */
  unmount(id: string): boolean {
    const entry = this.byId.get(id);
    if (!entry) return false;
    this.byId.delete(id);
    this.byPage.delete(entry.page);
    try {
      const file = join(entry.root, STATE_FILE);
      const state = JSON.parse(readFileSync(file, 'utf8')) as Partial<ServerStateRecord>;
      if (state.pid === process.pid && (state.thread ?? 0) === threadId) rmSync(file, { force: true });
    } catch {
      // Nothing written, or someone else's.
    }
    try {
      entry.site.close();
    } catch (error) {
      this.log(`closing ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return true;
  }

  /** The site whose address `pathname` is under, with the path below it. */
  private under(pathname: string): { entry: Mounted; rest: string } | null {
    const [, first, second] = pathname.split('/');
    const entry = first && second ? this.byPage.get(`/${first}/${second}/`) : undefined;
    if (entry) return { entry, rest: pathname.slice(entry.page.length - 1) };
    for (const e of this.byPage.values()) if (e.site.claims?.(pathname)) return { entry: e, rest: pathname };
    return null;
  }

  /** The site of the page that referred this request (same host only). */
  private referred(req: IncomingMessage): Mounted | null {
    const referer = req.headers.referer;
    if (typeof referer !== 'string') return null;
    try {
      const at = new URL(referer);
      return at.host === req.headers.host ? (this.under(at.pathname)?.entry ?? null) : null;
    } catch {
      return null;
    }
  }

  /** The site that answers a path outside every site's address: share links, uploads, common paths, the referrer. */
  private async answering(req: IncomingMessage, pathname: string): Promise<Mounted | null> {
    const link = /^\/s\/([A-Za-z0-9_-]{16,64})$/.exec(pathname);
    if (link) return [...this.byPage.values()].find((e) => e.site.share?.sharing?.linkRole?.(link[1]!)) ?? null;
    const blob = /^\/_blob\/([0-9a-f]{32})$/.exec(pathname);
    if (blob) {
      const referred = this.referred(req);
      const all = [...this.byPage.values()];
      for (const e of referred ? [referred, ...all.filter((x) => x !== referred)] : all) if (await e.site.hasBlob?.(blob[1]!)) return e;
      return null;
    }
    for (const e of this.byPage.values()) if (e.site.common?.(pathname)) return e;
    return this.referred(req);
  }

  // ---- requests ------------------------------------------------------------------------------------------------------

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.lastActivity = Date.now();
    if (!this.hostAllowed(req)) {
      req.resume();
      res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Misdirected request');
      return;
    }
    const content = this.contentEntry(req);
    if (content) {
      const site = content.entry?.site;
      if (!content.entry || !site?.content) {
        req.resume();
        return notFound(res);
      }
      content.entry.lastUsed = Date.now();
      await site.content(req, res);
      return;
    }
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname.startsWith('/__open-artifact/')) return this.openArtifactRoute(req, res, url);
    return this.siteRequest(req, res, url);
  }

  private async siteRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const at = this.under(url.pathname);
    if (at) {
      at.entry.lastUsed = Date.now();
      if (at.rest === '') {
        req.resume();
        res.writeHead(308, { Location: `${url.pathname}/${url.search}`, 'Cache-Control': 'no-store' }).end();
        return;
      }
      req.url = `${at.rest}${url.search}`;
      await at.entry.site.handle(req, res);
      return;
    }
    const entry = await this.answering(req, url.pathname);
    if (entry) {
      entry.lastUsed = Date.now();
      await entry.site.handle(req, res);
      return;
    }
    req.resume();
    notFound(res);
  }

  /** The daemon's routes: from this computer, with the secret, never from a page. */
  private async openArtifactRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const granted =
      isLoopback(req.socket.remoteAddress) &&
      (!this.secret || req.headers.authorization === `Bearer ${this.secret}`) &&
      req.headers.origin === undefined;
    if (!granted) {
      req.resume();
      return sendJson(res, 401, { code: 'unauthorized', message: "The /__open-artifact/* routes are the Open Artifact daemon's." });
    }
    const path = url.pathname;
    if (path === TYPE_SERVER_ROUTES.archive && this.options.archive) {
      const entry = this.byId.get(url.searchParams.get('id') ?? '');
      if (!entry) {
        req.resume();
        return sendJson(res, 404, { code: 'not_found', message: `${url.searchParams.get('id')} is not open here.`, fix: 'Open it first (/__open-artifact/open).' });
      }
      entry.lastUsed = Date.now();
      return sendArchive(req, res, entry.root);
    }
    const get = req.method === 'GET';
    const body = get ? {} : await readJsonBody(req);
    const artifact = (id: unknown): Mounted => {
      const entry = this.byId.get(String(id ?? ''));
      if (!entry) throw new OpenArtifactError('not_found', `${String(id)} is not open here.`, { status: 404, fix: 'Open it first (/__open-artifact/open).' });
      entry.lastUsed = Date.now();
      return entry;
    };

    if (path === TYPE_SERVER_ROUTES.health) {
      const health: TypeServerHealth = { openArtifact: 1, type: this.type, version: this.version, open: this.byId.size };
      return sendJson(res, 200, health);
    }
    if (path === TYPE_SERVER_ROUTES.open && !get) {
      const entry = await this.open(body as Partial<OpenRequest>);
      const page = `${this.origin}${entry.page}`;
      const result: OpenResult = { url: page, page_url: page };
      return sendJson(res, 200, result);
    }
    if (path === TYPE_SERVER_ROUTES.close && !get) {
      const { id } = body as Partial<CloseRequest>;
      return sendJson(res, 200, { closed: this.unmount(String(id ?? '')) });
    }
    if (path === TYPE_SERVER_ROUTES.share) {
      const entry = artifact(get ? url.searchParams.get('id') : body.id);
      const share = entry.site.share;
      if (!share || typeof share.shareView !== 'function' || typeof share.share !== 'function') {
        throw new OpenArtifactError('unsupported', `${this.type} pages cannot be shared.`, { status: 409 });
      }
      if (get) return sendJson(res, 200, await share.shareView());
      const { id: _id, ...action } = body;
      return sendJson(res, 200, await share.share(action));
    }
    if (path === TYPE_SERVER_ROUTES.actions.slice(0, -1) && get) {
      const actions: ActionInfo[] = Object.entries(this.options.actions ?? {})
        .filter(([, a]) => !a.hidden)
        .map(([name, a]) => ({
          name,
          title: a.title ?? name,
          ...(a.description ? { description: a.description } : {}),
          ...(a.effect ? { effect: a.effect } : {}),
          ...(a.schema ? { schema: a.schema } : {}),
          ...(a.long ? { long: true } : {}),
        }));
      return sendJson(res, 200, { actions });
    }
    if (path.startsWith(TYPE_SERVER_ROUTES.actions) && !get) {
      const name = decodeURIComponent(path.slice(TYPE_SERVER_ROUTES.actions.length));
      const action = Object.hasOwn(this.options.actions ?? {}, name) ? this.options.actions![name] : undefined;
      if (!action) throw new OpenArtifactError('unknown_action', `${this.type} has no action ${name}.`, { status: 404 });
      const entry = artifact(body.id);
      const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? (body.args as Record<string, unknown>) : {};
      const ref = { id: entry.id, root: entry.root, title: entry.title, site: entry.site };
      if (action.long && this.daemon.available) return sendJson(res, 200, this.runLong(name, action, ref, args));
      return sendJson(res, 200, await action.run(ref, args));
    }
    if (path === TYPE_SERVER_ROUTES.summary && get && this.options.summary) {
      const entry = artifact(url.searchParams.get('id'));
      return sendJson(res, 200, await this.options.summary({ id: entry.id, root: entry.root }));
    }
    req.resume();
    return sendJson(res, 404, { code: 'not_found', message: `No route ${path}.` });
  }

  /** Starts a long action and answers with its task; the end goes to the daemon (`open-artifact.type.task`). */
  private runLong(name: string, action: ServerAction, ref: ArtifactRef, args: Record<string, unknown>): { task: string; pending: true; note: string } {
    const task = `task_${randomBytes(8).toString('hex')}`;
    const report = (body: Parameters<TypeApi['task']>[1]): Promise<void> =>
      this.daemon.task(task, body).then(
        () => undefined,
        (error: unknown) => this.log(`task ${task} (${name}): reporting failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    const progress = (fraction: number): void => {
      if (Number.isFinite(fraction)) void report({ progress: Math.max(0, Math.min(1, fraction)) });
    };
    void (async () => {
      try {
        const result = await action.run(ref, args, { id: task, progress });
        await report({ done: true, result: result ?? null });
      } catch (error) {
        await report({ done: true, error: errorBody(error) });
      }
    })();
    return { task, pending: true, note: LONG_ACTION_NOTE };
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => {});
    this.lastActivity = Date.now();
    if (!this.hostAllowed(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const content = this.contentEntry(req);
    if (content) {
      const site = content.entry?.site;
      if (!content.entry || !site?.contentUpgrade) {
        socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
        return;
      }
      content.entry.lastUsed = Date.now();
      site.contentUpgrade(req, socket, head);
      return;
    }
    const url = new URL(req.url ?? '/', 'http://local');
    const at = this.under(url.pathname);
    if (!at) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    at.entry.lastUsed = Date.now();
    req.url = `${at.rest}${url.search}`;
    const asked = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((s) => s.trim());
    if (asked.includes(STREAM_PROTOCOL)) return this.stream(at.entry, req, socket, head, url);
    if (at.entry.site.upgrade) return at.entry.site.upgrade(req, socket, head);
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  }

  /** A site's event stream (SSE) carried over a WebSocket ({@link STREAM_PROTOCOL}). */
  private stream(entry: Mounted, req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
    const ws = acceptWebSocket(req, socket, head, STREAM_PROTOCOL);
    if (!ws) return;
    const last = url.searchParams.get('__lastEventId');
    if (last !== null) {
      req.headers['last-event-id'] = last;
      url.searchParams.delete('__lastEventId');
      req.url = `${(req.url ?? '').split('?')[0]}${url.search}`;
    }
    req.method = 'GET';
    const response = new StreamResponse(ws);
    entry.streams += 1;
    ws.handlers = {
      close: () => {
        entry.streams -= 1;
        entry.lastUsed = Date.now();
        this.lastActivity = Date.now();
        response.closed();
        req.emit('close');
      },
    };
    Promise.resolve()
      .then(() => entry.site.handle(req, response))
      .catch(() => ws.close(STREAM_REFUSED + 500));
  }

  /** Unmounts everything and stops listening. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const id of [...this.byId.keys()]) this.unmount(id);
    this.lan.close();
    this.server.close();
    this.server.closeAllConnections();
  }
}

/**
 * Runs a type server: listens, prints the ready line, and closes everything
 * on SIGTERM / SIGINT. Resolves with the {@link TypeServer}.
 */
export async function serve(options: TypeServerOptions): Promise<TypeServer> {
  const server = new TypeServer(options);
  await server.listen();
  const stop = (): void => {
    server.close();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  server.ready();
  server.log(`${server.type} type server at ${server.origin}/ (pid ${process.pid}${threadId ? `, thread ${threadId}` : ''}, ${hostname()})`);
  return server;
}
