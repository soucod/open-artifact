/**
 * Page artifacts in an artifact's object: the frame core (server-sdk `frame/core`) instead of the type server, as the
 * Node site's frame engine runs them (`packages/host/src/node/frames.ts`, read it for the reasons). The object serves
 * one artifact, so it holds at most one core.
 *
 * Two hosts per page artifact (`core/page-host.ts`), both routed by the Worker to this object:
 *
 *     <idlabel>.<rest>/page/<page token>/…   the inner shell and the capability API (the viewer's page token, then
 *                                            the person's CURRENT role)
 *     <idlabel>--<opaque>.<rest>/…           the page itself, read only: `<opaque>` names one principal's reader for
 *                                            this artifact and epoch, checked here against the live role every time
 *
 * - Who a request is: {@link RoomPages} (the product's, in `room-host.ts`, over D1), placed before the core sees the
 *   request and carried on `FrameRequest.peer`; the core's synchronous `viewer`/`reader`/`pageOrigin` only read it.
 * - The page hosts' index (opaque part → principal) is this object's own SQLite table {@link PAGE_HOSTS_TABLE}: one
 *   artifact's, so it lives and is dropped with the object. It holds a share link's guests too, whose page hosts
 *   cannot be worked out again from the catalog (the owner's and user grants' are, as on Node).
 * - Storage: the object's folder on the SQLite file system; the stores use only the synchronous `node:fs` calls it
 *   implements. The guard is a plain one (that file system has no links).
 * - Event connections: WebSockets made with `WebSocketPair` and `accept()` (not the hibernation API, as the type
 *   server's: an object with a socket open stays in memory, the core's rooms and leases with it), or server-sent
 *   events with the bridge's heartbeat. No watcher: the host's own writes (a Link push, the site's MCP, capabilities)
 *   are handed in with {@link RoomFrames.noteChanges}, which does nothing while no core is open.
 * - Going quiet: with no connection and no request for `idleCloseMs`, the core is closed (its timers with it) and the
 *   host is told, as the type server's idle close does. The next request opens it again from the folder.
 * - The type's files: `page` is bundled into the Worker (`open-artifact:build`: its manifest and `artifact-type/`
 *   files, a few KiB, needed synchronously); the frame client's browser files (about 950 KiB) are static assets under
 *   a content-hashed path, fetched once per isolate before a core is made ({@link assetFrameClient}).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ConfigError, type ArtifactRole, type HostConfig, type PrincipalRef } from '@open-artifact/host';
import { installedTypeCsp, titleInHtml } from '@open-artifact/protocol';
import { FrameCore, frameActions, pageDeclaration, replyBytes } from '@open-artifact/server-sdk/frame/core';
import type { FrameClientFiles, FrameEnv, FrameFile, FrameLevel, FramePerson, FrameReply, FrameRequest, FrameTypeSource, FrameViewer } from '@open-artifact/server-sdk/frame/env';
import type { TypeApiLike } from '@open-artifact/type-server';
import type { WebSocketPairFactory } from './bridge/ws.ts';

/** The type a page artifact names in its `.artifact.json`. */
export const PAGE_TYPE = 'page';
/** What the app calls the type (`typeInfo`). */
export const PAGE_TITLE = 'Page';
/** The object's table of page hosts it made: opaque part → principal. */
export const PAGE_HOSTS_TABLE = 'oa_page_hosts';
/** The largest capabilities block taken (its JSON), bytes: a declaration, not data (as on Node). */
export const MAX_CAPABILITIES_BYTES = 64 * 1024;
/** How long comment writes are gathered before the daemon is told, ms (as on Node). */
const COMMENTS_TOUCH_MS = 1000;
/** An event stream's keep-alive when the bridge's heartbeat is off, ms (the Node site's). */
const SSE_PING_MS = 25_000;
/** A page artifact's marker (its type, title and declared capabilities). */
const MARKER_FILE = '.artifact.json';

// ---- the rules both sites share (kept equal to node/frames.ts: test/frames.test.ts checks it) -----------------------

/** What a page may reach beyond its own origin (`OA_PAGE_NETWORK`): nothing (`self`, the default), or any HTTPS origin. */
export type PageNetwork = 'self' | 'https';

/** `OA_PAGE_NETWORK` (`self` or `https`; default `self`); throws a message naming the variable. */
export function parsePageNetwork(env: Record<string, string | undefined>): PageNetwork {
  const text = env.OA_PAGE_NETWORK?.trim().toLowerCase() || 'self';
  if (text !== 'self' && text !== 'https') throw new ConfigError('OA_PAGE_NETWORK', `must be self or https, not "${env.OA_PAGE_NETWORK}".`);
  return text;
}

/**
 * Whether this site runs page artifacts, and how: not on one origin (`OA_CONTENT_SAME_SITE`: a page host would share
 * the app's site, as on Node), nor with a build that bundled no frame type. Throws `ConfigError` on a bad
 * `OA_PAGE_NETWORK`.
 */
export function sitePagesOf(config: Pick<HostConfig, 'contentSameSite'>, vars: Record<string, string | undefined>, build: FrameBuild | undefined): { network: PageNetwork; build: FrameBuild } | null {
  const network = parsePageNetwork(vars);
  if (config.contentSameSite || !build || build.types.length === 0) return null;
  return { network, build };
}

/** The page origin's policy and what the page's `network` capability reports: the same sources. */
export function pageNetworkPolicy(network: PageNetwork): { contentSecurityPolicy: string; allowedNetworkOrigins: string[] } {
  const sources = network === 'https' ? ['https:'] : [];
  return { contentSecurityPolicy: installedTypeCsp(sources), allowedNetworkOrigins: sources };
}

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
/** A person's colour, by id (as on Node). */
export function colorOf(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

/** A page artifact's title: its index.html's `<title>`, or undefined. */
export function pageTitleOf(root: string): string | undefined {
  let html = '';
  try {
    html = readFileSync(join(root, 'index.html'), 'utf8');
  } catch {
    return undefined;
  }
  return titleInHtml(html)?.trim().slice(0, 200) || undefined;
}

/** A new page artifact's files (the Node site's `scaffoldArtifact` for `page`): the marker only. */
export function pageScaffold(id: string, title: string): Record<string, string> {
  return { [MARKER_FILE]: `${JSON.stringify({ type: PAGE_TYPE, id, title, release: null, capabilities: {} }, null, 2)}\n` };
}

// ---- the type's files and the browser files -------------------------------------------------------------------------

/** A frame type as the build bundles it (`open-artifact:build` `frames.types`). */
export interface BundledFrameType {
  id: string;
  /** For messages. */
  label: string;
  /** A hash of what it serves (its files): a new build with other files rewires open pages. */
  fingerprint: string;
  /** `artifact-type.json`. */
  manifest: Record<string, unknown>;
  /** Its skill text without front matter (remote MCP's `Artifact` tool reads it), or null. */
  skill: string | null;
  /** Its index.html (a page type has none: the artifact's own is the page). */
  indexHtml: string | null;
  /** Its `artifact-type/` files, path (from the type folder) → base64. */
  files: Record<string, string>;
  /** Whether its artifacts are free pages (`page`). */
  page: boolean;
}

/** The frame client's browser files as the build puts them in static assets (`open-artifact:build` `frames.client`). */
export interface FrameClientBuild {
  /** The assets path they are under, versioned by their content (`/_open-artifact/frame/<hash>/`). */
  base: string;
  /** Their names (`runtime.js`, `shell.html`, …). */
  files: readonly string[];
}

/** What the build says of frame types. */
export interface FrameBuild {
  types: readonly BundledFrameType[];
  client: FrameClientBuild;
}

/** A frame type this site runs: its files, and whether its artifacts are free pages. */
export interface SiteFrameType {
  source: FrameTypeSource;
  page: boolean;
}

/**
 * Where an object finds the frame types and the browser files. Asynchronous, so that a type catalog (types kept in
 * D1 or elsewhere, a later step) can be put beside the bundled `page` without changing the room.
 */
export interface RoomFrameTypes {
  /** The frame type of an artifact's catalog type, or null when this site runs it some other way (or not at all). */
  typeOf(type: string): Promise<SiteFrameType | null>;
  /** The browser files, loaded (the core reads them synchronously). */
  client(): Promise<FrameClientFiles>;
}

/** A bundled type as the core reads one. */
export function bundledTypeSource(type: BundledFrameType, builtAt = 0): FrameTypeSource {
  const files = new Map<string, Uint8Array>();
  for (const [rel, base64] of Object.entries(type.files)) files.set(rel, new Uint8Array(Buffer.from(base64, 'base64')));
  return {
    label: type.label,
    fingerprint: () => type.fingerprint,
    // A page type has no declaration of its own (the artifact's .artifact.json holds it): `pageDeclaration`.
    declaration: () => null,
    manifest: () => type.manifest,
    indexHtml: () => type.indexHtml,
    file: (rel) => {
      const bytes = files.get(rel);
      return bytes ? { size: bytes.byteLength, mtimeMs: builtAt, body: bytes } : null;
    },
  };
}

/** The browser files of one isolate, once fetched (they never change within a build). */
const clientCache = new Map<string, Promise<Map<string, Uint8Array>>>();

/**
 * The frame client from static assets: every file fetched once per isolate (`fetcher` is `env.ASSETS.fetch`), then
 * read synchronously by the core. Served by the core `no-store` (it rewrites nothing in them; the inner shell's
 * addresses are relative to the page token's path, which no cache may keep).
 */
export function assetFrameClient(build: FrameClientBuild, fetcher: (request: Request) => Promise<Response>, origin = 'https://assets.invalid'): () => Promise<FrameClientFiles> {
  return async () => {
    let loading = clientCache.get(build.base);
    if (!loading) {
      loading = (async () => {
        const out = new Map<string, Uint8Array>();
        await Promise.all(
          build.files.map(async (name) => {
            const response = await fetcher(new Request(new URL(`${build.base}${name}`, origin)));
            if (!response.ok) {
              await response.body?.cancel();
              throw new Error(`The frame client file ${name} is missing from the static assets (HTTP ${response.status}): build deploy/cloudflare again.`);
            }
            out.set(name, new Uint8Array(await response.arrayBuffer()));
          }),
        );
        return out;
      })();
      clientCache.set(build.base, loading);
      loading.catch(() => clientCache.delete(build.base));
    }
    const files = await loading;
    return {
      file: (name): FrameFile | null => {
        const bytes = files.get(name);
        return bytes ? { size: bytes.byteLength, mtimeMs: null, body: bytes } : null;
      },
    };
  };
}

/** The frame types from the build's table, with the browser files from static assets. */
export function bundledFrameTypes(build: FrameBuild, fetcher: (request: Request) => Promise<Response>): RoomFrameTypes {
  const types = new Map<string, SiteFrameType>();
  for (const type of build.types) types.set(type.id, { source: bundledTypeSource(type), page: type.page });
  const client = assetFrameClient(build.client, fetcher);
  return { typeOf: async (type) => types.get(type) ?? null, client };
}

// ---- who a request is: the host's side ------------------------------------------------------------------------------

/** One request, placed: the viewer the core sees, and who they are on the site. */
export interface PlacedPage {
  viewer: FrameViewer;
  ref: PrincipalRef;
  role: ArtifactRole;
  /** The viewer's page host's opaque part. */
  opaque: string;
  /** The artifact as the catalog has it now. */
  artifact: { title: string; type: string };
}

/** The object's page hosts: what was made here, kept across evictions. */
export interface PageHostIndex {
  get(opaque: string): PrincipalRef | null;
  set(opaque: string, ref: PrincipalRef): void;
}

/** The hosting decisions the object takes from the Worker for its page artifact (`room-host.ts` makes them over D1). */
export interface RoomPages {
  types: RoomFrameTypes;
  policy: { contentSecurityPolicy: string; allowedNetworkOrigins: string[] };
  /** Whether a Host header is one of this site's page hosts: its artifact and opaque part, or null. */
  pageHostOf(host: string | null): { id: string; opaque: string } | null;
  /** The inner shell's origin, the page origins' CSP source, the app origin; a viewer's page origin. */
  origins(artifactId: string): { shell: string; template: string; frameSrc: string; app: string };
  pageOrigin(artifactId: string, opaque: string): string;
  /** The artifact as the catalog has it (null: none, or in the trash). */
  artifact(artifactId: string): Promise<{ title: string; type: string } | null>;
  /** A page token's viewer (`use` as the token is checked), or null: refused. */
  placeShell(artifactId: string, token: string, use: 'document' | 'socket' | 'api', index: PageHostIndex): Promise<PlacedPage | null>;
  /** A page host's reader (the principal its opaque part was made for, with their live role), or null. */
  placeReader(artifactId: string, host: string | null, index: PageHostIndex): Promise<PlacedPage | null>;
  /** The people who can reach the artifact (`user.profiles`, `user.search`). */
  people(artifactId: string): Promise<FramePerson[]>;
}

// ---- the object's side: one artifact's core -------------------------------------------------------------------------

/** Host-side state on a viewer the core keeps (a symbol: never sent to a page). */
const PLACED = Symbol('open-artifact.cloudflare.placed');
type TaggedViewer = FrameViewer & { [PLACED]?: PlacedPage };

/** A frame core of the site: comments reach the daemon too, but not those the host handed in itself. */
class SiteFrameCore extends FrameCore {
  quiet = false;
  onComments: (() => void) | null = null;

  override commentsChanged(): void {
    super.commentsChanged();
    if (!this.quiet) this.onComments?.();
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

/** The SQLite of a Durable Object, as far as the index uses it. */
export interface IndexSql {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): { toArray(): T[] };
}

/** The page hosts' index in the object's SQLite (read once, written only when a new one is made). */
export function sqlPageHostIndex(sql: IndexSql): PageHostIndex {
  let known: Map<string, PrincipalRef> | null = null;
  const load = (): Map<string, PrincipalRef> => {
    if (known) return known;
    sql.exec(`CREATE TABLE IF NOT EXISTS ${PAGE_HOSTS_TABLE} (opaque TEXT PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL) WITHOUT ROWID`);
    known = new Map();
    for (const row of sql.exec<{ opaque: string; kind: string; id: string }>(`SELECT opaque, kind, id FROM ${PAGE_HOSTS_TABLE}`).toArray()) known.set(row.opaque, { kind: row.kind as PrincipalRef['kind'], id: row.id });
    return known;
  };
  return {
    get: (opaque) => load().get(opaque) ?? null,
    set(opaque, ref) {
      const map = load();
      const had = map.get(opaque);
      if (had && had.kind === ref.kind && had.id === ref.id) return;
      map.set(opaque, { kind: ref.kind, id: ref.id });
      sql.exec(`INSERT OR REPLACE INTO ${PAGE_HOSTS_TABLE} (opaque, kind, id) VALUES (?, ?, ?)`, opaque, ref.kind, ref.id);
    },
  };
}

export interface RoomFramesOptions {
  id: string;
  root: string;
  pages: RoomPages;
  /** The daemon calls (wake, presence, touch), the room host's. */
  typeApi: TypeApiLike;
  index: PageHostIndex;
  pair: WebSocketPairFactory;
  upgraded: (client: unknown, headers: Record<string, string>) => Response;
  log: (line: string) => void;
  /** Closes the core after this long with no connection and no request, ms; 0 never. */
  idleCloseMs: number;
  /** An SSE comment this often on an idle event stream, ms; 0 never. */
  sseHeartbeatMs: number;
  /** The core was closed for being idle. */
  onIdle(): void;
}

/** A refusal as the page reads it: plain text, no cache, no referrer. */
function refuse(status: number, message: string): Response {
  return new Response(`${message}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

/** A Fetch request as the core takes one. */
function frameRequest(request: Request, url: string, placed: PlacedPage | null): FrameRequest {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    method: request.method,
    url,
    headers,
    peer: placed,
    body: async (limit) => {
      const declared = Number(request.headers.get('content-length'));
      const tooLarge = (): Error => Object.assign(new Error(`The request is over ${limit} bytes.`), { code: 'too_large', status: 413 });
      if (Number.isFinite(declared) && declared > limit) throw tooLarge();
      if (!request.body) return new Uint8Array(0);
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel().catch(() => undefined);
          throw tooLarge();
        }
        chunks.push(value);
      }
      return new Uint8Array(Buffer.concat(chunks));
    },
  };
}

/** The core's answer as a Fetch response. */
function fetchResponse(request: Request, reply: FrameReply): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(reply.headers)) headers.set(name, String(value));
  const empty = request.method === 'HEAD' || reply.status === 204 || reply.status === 304 || (reply.status >= 300 && reply.status < 400);
  const body = empty ? null : replyBytes(reply.body);
  return new Response(body as BodyInit | null, { status: reply.status, headers });
}

/** A page's `/page/<token>/<rest>` path, split. */
function splitShellPath(url: URL): { token: string; rest: string } | null {
  const match = /^\/page\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!match) return null;
  try {
    return { token: decodeURIComponent(match[1]!), rest: match[2] ?? '' };
  } catch {
    return null;
  }
}

const useOf = (rest: string): 'document' | 'socket' | 'api' => (rest === '' || rest === '/' || rest === '/index.html' ? 'document' : rest === '/api/frame/events' ? 'socket' : 'api');

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The plain guard: a path inside the folder by its name (the SQLite file system has no links). */
const PLAIN: FrameEnv['guard'] = Object.freeze({
  inside: (root: string, file: string) => {
    const top = resolve(root);
    const at = resolve(file);
    return at === top || at.startsWith(top + sep);
  },
  real: (path: string) => resolve(path),
});

interface Connection {
  ref: PrincipalRef;
  role: ArtifactRole;
  end(): void;
}

/** One page artifact's core in its object. */
export class RoomFrames {
  readonly #o: RoomFramesOptions;
  #core: SiteFrameCore | null = null;
  #opening: Promise<SiteFrameCore> | null = null;
  #title = '';
  readonly #connections = new Set<Connection>();
  #inFlight = 0;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #commentsTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #commentsBy = new Set<string>();
  /** The viewer of the request being handled (the agent hook and comment touches run inside it). */
  readonly #current = new AsyncLocalStorage<TaggedViewer>();

  constructor(options: RoomFramesOptions) {
    this.#o = options;
  }

  /** Whether a core is open now. */
  get open(): boolean {
    return this.#core !== null;
  }

  /** Event connections now. */
  get connections(): number {
    return this.#connections.size;
  }

  /**
   * A request for the page artifact: a page host's (read only), or the inner shell's (`/page/<token>/…` on the
   * content host). Anything else is not a page's: 404.
   */
  async fetch(request: Request): Promise<Response> {
    this.#busy(+1);
    try {
      const url = new URL(request.url);
      if (this.#o.pages.pageHostOf(url.host)) return await this.#content(request, url);
      return await this.#shell(request, url);
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 500;
      return refuse(status, error instanceof Error ? error.message : 'The page cannot open.');
    } finally {
      this.#busy(-1);
    }
  }

  async #shell(request: Request, url: URL): Promise<Response> {
    const split = splitShellPath(url);
    if (!split) return refuse(404, 'Not found.');
    // `/page/<token>` → `/page/<token>/`: the inner shell's own addresses are relative to it.
    if (split.rest === '') return new Response(null, { status: 302, headers: { location: `${encodeURIComponent(split.token)}/${url.search}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
    const socket = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
    const placed = await this.#place(() => this.#o.pages.placeShell(this.#o.id, split.token, socket ? 'socket' : useOf(split.rest), this.#o.index));
    if (!placed) return refuse(403, 'This page address is not valid now: open the artifact again from the site.');
    const core = await this.#open(placed);
    const frame = frameRequest(request, split.rest + url.search, placed);
    if (socket) return this.#socket(core, frame, split.rest, placed);
    const reply = await this.#current.run(placed.viewer as TaggedViewer, () => core.request(frame));
    if (!('events' in reply)) return fetchResponse(request, reply);
    return this.#events(request, core, frame, placed);
  }

  async #content(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('upgrade')) return refuse(403, 'Not with this address.');
    const placed = await this.#place(() => this.#o.pages.placeReader(this.#o.id, url.host, this.#o.index));
    if (!placed) return refuse(403, 'Not with this address.');
    const core = await this.#open(placed);
    return fetchResponse(request, await core.contentRequest(frameRequest(request, url.pathname + url.search, placed)));
  }

  /** Placed only while the artifact still has its folder here. */
  async #place(how: () => Promise<PlacedPage | null>): Promise<PlacedPage | null> {
    if (!isDirectory(this.#o.root)) return null;
    const placed = await how();
    if (placed) (placed.viewer as TaggedViewer)[PLACED] = placed;
    return placed;
  }

  #socket(core: SiteFrameCore, frame: FrameRequest, rest: string, placed: PlacedPage): Response {
    if (rest !== '/api/frame/events' || !core.acceptsStream(frame)) return refuse(403, 'Not an event stream.');
    const client = new URL(frame.url, 'http://local').searchParams.get('c') ?? '';
    if (!FrameCore.validClient(client)) return refuse(400, 'Not a client id.');
    const [peer, server] = this.#o.pair();
    server.accept();
    let open = true;
    let closed: () => void = () => undefined;
    let untrack: () => void = () => undefined;
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      open = false;
      closed();
      untrack();
    };
    const end = (code = 1000, reason = ''): void => {
      if (open) {
        try {
          server.close(code, reason);
        } catch {
          // already closing
        }
      }
      finish();
    };
    server.addEventListener('close', finish);
    server.addEventListener('error', finish);
    untrack = this.#track(placed, () => end(4001, 'access changed'));
    try {
      closed = core.connect(frame, client, {
        send: (event) => {
          if (!open) return;
          try {
            server.send(JSON.stringify(event));
          } catch {
            end();
          }
        },
        end: () => end(),
      });
    } catch (error) {
      end(1011, 'refused');
      throw error;
    }
    if (finished) closed();
    // The inner shell asks for this subprotocol (an SSE-shaped stream over a socket): the answer must name it.
    return this.#o.upgraded(peer, { 'sec-websocket-protocol': 'baoyu-sse' });
  }

  #events(request: Request, core: SiteFrameCore, frame: FrameRequest, placed: PlacedPage): Response {
    const client = new URL(frame.url, 'http://local').searchParams.get('c') ?? '';
    if (!FrameCore.validClient(client)) return refuse(400, 'Not a client id.');
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let done = false;
    let closed: () => void = () => undefined;
    let untrack: () => void = () => undefined;
    const write = (text: string): void => {
      if (done || !controller) return;
      try {
        controller.enqueue(encoder.encode(text));
      } catch {
        finish();
      }
    };
    const finish = (): void => {
      if (done) return;
      done = true;
      if (ping) clearInterval(ping);
      closed();
      untrack();
      try {
        controller?.close();
      } catch {
        // cancelled
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        untrack = this.#track(placed, finish);
        closed = core.connect(frame, client, { send: (event) => write(`data: ${JSON.stringify(event)}\n\n`), end: finish });
        if (done) {
          closed();
          return;
        }
        // The bridge's heartbeat (how a page that left is noticed here), else the Node site's 25 s keep-alive.
        ping = setInterval(() => write(': ping\n\n'), this.#o.sseHeartbeatMs > 0 ? this.#o.sseHeartbeatMs : SSE_PING_MS);
      },
      cancel: () => finish(),
    });
    request.signal?.addEventListener('abort', finish);
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }

  /** Counts a connection until it ends; `end` is how a refresh ends it. */
  #track(placed: PlacedPage, end: () => void): () => void {
    const entry: Connection = { ref: placed.ref, role: placed.role, end };
    this.#connections.add(entry);
    this.#settle();
    return () => {
      if (!this.#connections.delete(entry)) return;
      this.#settle();
    };
  }

  #busy(delta: number): void {
    this.#inFlight += delta;
    this.#settle();
  }

  /** Arms the idle close when nothing is in flight or connected; disarms it otherwise. */
  #settle(): void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
    if (!this.#core || !this.#o.idleCloseMs || this.#inFlight > 0 || this.#connections.size > 0) return;
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = null;
      if (this.#inFlight > 0 || this.#connections.size > 0) return;
      this.close();
      this.#o.onIdle();
    }, this.#o.idleCloseMs);
  }

  /** The core, made once (the browser files are fetched first: the core reads them synchronously). */
  async #open(placed: { artifact: { title: string; type: string } }): Promise<SiteFrameCore> {
    this.#title = placed.artifact.title;
    if (this.#core) return this.#core;
    this.#opening ??= (async () => {
      try {
        const type = await this.#o.pages.types.typeOf(placed.artifact.type);
        if (!type) throw Object.assign(new Error(`${placed.artifact.type} does not run on the frame engine here.`), { status: 404 });
        const client = await this.#o.pages.types.client();
        const agentName = (await this.#o.typeApi.presence(this.#o.id).catch(() => null))?.agentName ?? 'Agent';
        const declaration = type.page ? pageDeclaration(this.#o.root) : type.source.declaration();
        if (!declaration) throw Object.assign(new Error(`${type.source.label}/index.html has no // artifact.json declaration.`), { status: 500 });
        const core = new SiteFrameCore(this.#o.root, declaration, this.#env(type, client, agentName));
        core.onComments = () => this.#touchComments();
        this.#core = core;
        return core;
      } finally {
        this.#opening = null;
      }
    })();
    return this.#opening;
  }

  #env(type: SiteFrameType, client: FrameClientFiles, agentName: string): FrameEnv {
    const { id, pages, typeApi } = this.#o;
    const origins = pages.origins(id);
    const viewerOf = (req: FrameRequest): FrameViewer | null => (req.peer as PlacedPage | null)?.viewer ?? null;
    const from = (): { name: string; role: ArtifactRole } | undefined => {
      const by = this.#current.getStore();
      const placed = by?.[PLACED];
      return by && by.level !== 'owner' ? { name: by.name, role: placed?.role ?? 'editor' } : undefined;
    };
    return {
      id,
      title: this.#title,
      log: (line) => this.#o.log(`page ${id}: ${line}`),
      origins: {
        shell: origins.shell,
        shellOrigins: [origins.shell],
        // The template's form: the core checks it differs from the shell's; each viewer's own is `pageOrigin`.
        content: origins.template,
        connectSrc: [origins.shell.replace(/^http/, 'ws')],
        frameSrc: origins.frameSrc,
        outer: [origins.app],
      },
      viewer: (req) => {
        const viewer = viewerOf(req);
        if (!viewer) throw Object.assign(new Error('Not placed.'), { code: 'forbidden', status: 403 });
        return viewer;
      },
      reader: viewerOf,
      pageOrigin: (viewer) => {
        const placed = (viewer as TaggedViewer)[PLACED];
        if (!placed) throw Object.assign(new Error('No page host for this viewer.'), { code: 'forbidden', status: 403 });
        return pages.pageOrigin(id, placed.opaque);
      },
      people: () => pages.people(id),
      withholdIdentity: true,
      admit: (req) => !!viewerOf(req),
      type: type.source,
      client,
      watch: null,
      restricted: true,
      contentSecurityPolicy: pages.policy.contentSecurityPolicy,
      allowedNetworkOrigins: pages.policy.allowedNetworkOrigins,
      page: type.page,
      guard: PLAIN,
      debug: () => false,
      daemon: { available: true, touch: (aid, body) => typeApi.touch(aid, body), presence: (aid) => typeApi.presence(aid) },
      agentHook: {
        // Who asked rides along when it was not the owner; the outbox refuses it unless editors may ask.
        thread: (view) => {
          const by = from();
          return typeApi.wake(id, { threads: [by ? { ...view, from: by } : view] } as never);
        },
        request: (asked) => {
          const by = from();
          return typeApi.wake(id, { requests: [by ? { ...asked, from: by } : asked] } as never);
        },
      },
      agentName,
      agentWakesIdle: false,
    };
  }

  #touchComments(): void {
    const by = this.#current.getStore();
    this.#commentsBy.add(by ? (by.level === 'owner' ? 'owner' : by.id) : 'owner');
    if (this.#commentsTimer) return;
    this.#commentsTimer = setTimeout(() => {
      this.#commentsTimer = null;
      const authors = [...this.#commentsBy];
      this.#commentsBy.clear();
      for (const author of authors) this.#o.typeApi.touch(this.#o.id, { author, paths: ['comments.json'] }).catch(() => undefined);
    }, COMMENTS_TOUCH_MS);
  }

  /** The principals with an event connection open now (each once). */
  connected(): PrincipalRef[] {
    const refs = new Map<string, PrincipalRef>();
    for (const c of this.#connections) refs.set(`${c.ref.kind}:${c.ref.id}`, c.ref);
    return [...refs.values()];
  }

  /** Every event connection's principal and role. */
  holders(): Array<{ ref: PrincipalRef; role: ArtifactRole }> {
    return [...this.#connections].map((c) => ({ ref: c.ref, role: c.role }));
  }

  /** Ends the connections `keep` answers false for. */
  disconnectWhere(keep: (ref: PrincipalRef, role: ArtifactRole) => boolean): void {
    for (const c of [...this.#connections]) if (!keep(c.ref, c.role)) c.end();
  }

  /** Hands the core changes the host wrote itself (open pages hear of them); nothing while no core is open. */
  noteChanges(paths: string[]): void {
    this.#core?.noteChanges(paths);
  }

  /** Runs a frame action for the host (`info`, `open-artifact.db.*`, `open-artifact.comments.*`). */
  async action(name: string, args: Record<string, unknown>): Promise<unknown> {
    const action = Object.hasOwn(frameActions, name) ? frameActions[name] : undefined;
    if (!action) throw Object.assign(new Error(`Page artifacts have no action ${name}.`), { code: 'unknown_action', status: 404 });
    const artifact = await this.#o.pages.artifact(this.#o.id);
    if (!artifact) throw Object.assign(new Error(`No page artifact ${this.#o.id}.`), { code: 'not_found', status: 404 });
    if (!isDirectory(this.#o.root)) throw Object.assign(new Error(`Artifact ${this.#o.id} has no folder.`), { code: 'not_found', status: 404 });
    this.#busy(+1);
    try {
      const core = await this.#open({ artifact });
      return await action.run({ id: this.#o.id, root: core.root, title: artifact.title, site: core as never }, args);
    } finally {
      this.#busy(-1);
    }
  }

  /** The page's declared capabilities (its marker's block; `{}` when it has none). */
  capabilities(): Record<string, unknown> {
    const caps = this.#marker()?.capabilities;
    return caps && typeof caps === 'object' && !Array.isArray(caps) ? (caps as Record<string, unknown>) : {};
  }

  /** Replaces the declared capabilities (the whole block); the open core rewires. False: they were the same. */
  setCapabilities(capabilities: Record<string, unknown>): boolean {
    const text = JSON.stringify(capabilities);
    if (Buffer.byteLength(text) > MAX_CAPABILITIES_BYTES) throw Object.assign(new Error(`The capabilities block is over ${MAX_CAPABILITIES_BYTES} bytes.`), { code: 'too_large', status: 413 });
    const marker = this.#marker() ?? { type: PAGE_TYPE, id: this.#o.id };
    if (JSON.stringify(marker.capabilities ?? null) === text) return false;
    marker.capabilities = capabilities;
    const file = join(this.#o.root, MARKER_FILE);
    const temp = `${file}.${Date.now().toString(36)}.tmp`;
    writeFileSync(temp, `${JSON.stringify(marker, null, 2)}\n`);
    renameSync(temp, file);
    this.noteChanges([MARKER_FILE]);
    return true;
  }

  #marker(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(readFileSync(join(this.#o.root, MARKER_FILE), 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /** Closes the core: its connections end (it opens again on the next request). */
  close(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    if (this.#commentsTimer) {
      clearTimeout(this.#commentsTimer);
      this.#commentsTimer = null;
      const authors = [...this.#commentsBy];
      this.#commentsBy.clear();
      for (const author of authors) this.#o.typeApi.touch(this.#o.id, { author, paths: ['comments.json'] }).catch(() => undefined);
    }
    for (const c of [...this.#connections]) c.end();
    this.#connections.clear();
    const core = this.#core;
    this.#core = null;
    core?.close();
  }
}
