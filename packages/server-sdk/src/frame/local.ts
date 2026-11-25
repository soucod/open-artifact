/**
 * The frame core on this computer: frame-host's environment
 * ({@link localFrameEnv}) and its Node HTTP adapter ({@link FrameSite}).
 *
 * Everything a hosted site has no use for, or that a Worker lacks, is here
 * and only here: the type folder and the client folder read from disk (with
 * the link checks), `fs.watch` on both folders, `os.userInfo` for the owner's
 * name, `stripTypeScriptTypes` for the client scripts run from source,
 * `import.meta.url` for where they are, and `IncomingMessage` /
 * `ServerResponse` / `createReadStream` for requests. Every viewer here is the
 * owner, and a request comes in only from this computer, but for the visit of
 * a `snapshot` (frame/snapshot-action.ts): its inner shell is loaded at
 * `/snapshot/<credential>/`, which the site claims only while that visit lasts
 * ({@link FrameSite.beginSnapshot}), and every request under it is a read-only
 * viewer nobody else sees (no writes, no presence, no event but `hello`).
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as nodeModule from 'node:module';
import { userInfo } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Site, SiteContext, StreamResponse } from '../serve.ts';
import { FrameCore, colorOf, pageDeclaration, storedFile } from './core.ts';
import { readDeclaration, type Declaration } from './declaration.ts';
import type { FrameEnv, FrameFile, FrameReply, FrameRequest, FrameTypeSource, FrameViewer } from './env.ts';
import { FrameError, LINK_GUARD, staysInside } from './files.ts';
import type { FrameEvent, FrameSession } from './wire.ts';

/**
 * Where the browser scripts and the shell page are: `$OPEN_ARTIFACT_FRAME_CLIENT_DIR`,
 * else `client/` beside this module (src/frame/client from source, or
 * dist/daemon/frame-host/client beside the bundle).
 */
export const CLIENT_DIR = process.env.OPEN_ARTIFACT_FRAME_CLIENT_DIR || join(dirname(fileURLToPath(import.meta.url)), 'client');

/** What {@link mountFrameSite} takes: serve()'s context, plus the type folder. */
export interface FrameSiteContext extends SiteContext {
  /** The type folder (default `OPEN_ARTIFACT_TYPE_DIR`, else the working directory). */
  typeDir?: string;
  /**
   * Page mode, for a page type (`openArtifact.style: "page"`): the page is the artifact's own `index.html`, in its root,
   * which it may replace (`artifact.publish(html)`), and its capabilities are the ones `.artifact.json` declares (the
   * agent's `capabilities`), never the page's own `// artifact.json` block.
   */
  page?: boolean;
  /**
   * Sent on every response of the page's own origin (its index.html, its files, the type's `artifact-type/`
   * files): frame-host gives a restricted type's pages `installedTypeCsp` (`OPEN_ARTIFACT_TYPE_RESTRICTED=1`),
   * which keeps them to their own origin and the manifest's `openArtifact.network`. Absent: no policy.
   */
  contentSecurityPolicy?: string | null;
  /** The same origin grant used to construct the restricted page's policy. */
  allowedNetworkOrigins?: readonly string[];
  /**
   * The type's root is not trusted (installed, or a project not trusted yet): the inner shell frames the page with
   * `RESTRICTED_FRAME_SANDBOX` (no popups, no top navigation). Absent: no sandbox, as before.
   */
  restricted?: boolean;
}

// ---- snapshot visits -----------------------------------------------------------------------------------------------

/** A snapshot visit's inner shell: `/snapshot/<credential>/…` on the shell's origin. */
const SNAPSHOT_PATH = /^\/snapshot\/([A-Za-z0-9_-]{32})(\/[^?]*)?(\?.*)?$/;
/** The viewers of snapshot visits, by identity: the owner's level and name, but every write refused. */
const snapshotViewers = new WeakSet<FrameViewer>();
/** The requests (`IncomingMessage`) of a snapshot visit, with its viewer: what {@link localFrameEnv} answers for them. */
const snapshotRequests = new WeakMap<object, FrameViewer>();
/**
 * What a snapshot's viewer may call: reads only. Anything else is refused with the code a viewer who may not do it
 * gets ({@link snapshotRefusal}); a capability the page was not granted answers as it always does.
 */
const SNAPSHOT_READS = new Set([
  'db.get',
  'db.query',
  'artifact.metadata',
  'artifact.search',
  'artifact.sync',
  'assets.list',
  'user.me',
  'user.profile',
  'user.email',
  'user.profiles',
  'user.access',
  'user.search',
  'permissions.state',
  'permissions.request',
  'comments.list',
  'comments.canSendToAgent',
  'room.peers',
  'room.canSendToAgentSession',
]);
const SNAPSHOT_REFUSED = 'This is a snapshot of the page: it only reads, and nothing is written.';

/** Whether `viewer` is a snapshot visit's. */
export function isSnapshotViewer(viewer: FrameViewer): boolean {
  return snapshotViewers.has(viewer);
}

/** The error a snapshot's viewer gets for `cap.method`: the one the contract gives a viewer who may not. */
function snapshotRefusal(cap: string): FrameError {
  if (cap === 'db') return new FrameError('invalid_argument', SNAPSHOT_REFUSED);
  if (cap === 'artifact' || cap === 'assets') return new FrameError('not_writer', SNAPSHOT_REFUSED);
  if (cap === 'comments') return new FrameError('forbidden', SNAPSHOT_REFUSED);
  return new FrameError('not_permitted', SNAPSHOT_REFUSED);
}

/** A JSON answer of the inner shell's API. */
function jsonReply(status: number, body: unknown): FrameReply {
  const text = Buffer.from(JSON.stringify(body));
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': text.length, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }, body: text };
}

/** The owner, as every request on this computer is. */
export function localUser(): FrameViewer {
  let name = 'You';
  try {
    name = userInfo().username || name;
  } catch {
    // no passwd entry
  }
  return { id: 'local', name, avatarUrl: null, color: colorOf('local'), email: null, level: 'owner', guest: false, canComment: true };
}

function typeConfig(typeDir: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(typeDir, 'artifact-type.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** A fingerprint of what the type serves: index.html and artifact-type/ (names, sizes, times). */
function typeFingerprint(typeDir: string): string {
  const hash = createHash('sha256');
  try {
    hash.update(readFileSync(join(typeDir, 'index.html')));
  } catch {
    hash.update('-');
  }
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 8) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith('.')) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path, `${rel}/${e.name}`, depth + 1);
      else if (e.isFile()) {
        try {
          const st = statSync(path);
          hash.update(`\n${rel}/${e.name}\0${st.size}\0${st.mtimeMs}`);
        } catch {
          // gone
        }
      }
    }
  };
  walk(join(typeDir, 'artifact-type'), 'artifact-type', 0);
  return hash.digest('hex').slice(0, 16);
}

/** The type folder on disk. */
export function localTypeSource(typeDir: string): FrameTypeSource {
  const own = join(typeDir, 'artifact-type');
  return {
    label: typeDir,
    fingerprint: () => typeFingerprint(typeDir),
    declaration: () => readDeclaration(typeDir),
    manifest: () => typeConfig(typeDir),
    indexHtml: () => {
      try {
        return readFileSync(join(typeDir, 'index.html'), 'utf8');
      } catch {
        return null;
      }
    },
    file: (rel) => {
      const file = join(typeDir, rel);
      // A link in artifact-type/ to a file outside it is not served (a project's folder is anyone's).
      if (!file.startsWith(own + sep) || !staysInside(own, file)) return null;
      return storedFile(file);
    },
  };
}

const stripped = new Map<string, { mtimeMs: number; code: string }>();

/**
 * A client file only a build makes (the comment views, comments.js and
 * comments.css): beside the bundle, or, from source, in the repository's
 * built frame-host client folder.
 */
function builtClientFile(name: string): string {
  const here = join(CLIENT_DIR, name);
  if (existsSync(here)) return here;
  return join(CLIENT_DIR, '..', '..', '..', '..', '..', 'dist', 'daemon', 'frame-host', 'client', name);
}

/** A client .ts as a browser script: types stripped by Node (no bundling: the client files import types only). */
function scriptFromSource(file: string): string {
  const st = statSync(file);
  const have = stripped.get(file);
  if (have && have.mtimeMs === st.mtimeMs) return have.code;
  const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (code: string, options?: { mode?: string }) => string }).stripTypeScriptTypes;
  if (typeof strip !== 'function') throw new Error('this Node cannot strip TypeScript; build the client scripts (node scripts/build.mjs --only frame).');
  const code = strip(readFileSync(file, 'utf8'), { mode: 'strip' });
  stripped.set(file, { mtimeMs: st.mtimeMs, code });
  return code;
}

/** The client folder: the built scripts, or, from source, the .ts with its types stripped. */
function localClientFile(name: string): FrameFile | null {
  if (name === 'runtime.js' || name === 'shell.js' || name === 'imports.js') {
    const built = join(CLIENT_DIR, name);
    try {
      if (statSync(built).isFile()) return storedFile(built);
    } catch {
      // not built: from source
    }
    const body = Buffer.from(scriptFromSource(join(CLIENT_DIR, name.replace(/\.js$/, '.ts'))), 'utf8');
    return { size: body.length, mtimeMs: null, body };
  }
  if (name === 'comments.js' || name === 'comments.css') return storedFile(builtClientFile(name));
  return storedFile(join(CLIENT_DIR, name));
}

/** What {@link localFrameEnv} takes besides serve()'s context. */
export interface LocalFrameOptions {
  typeDir: string;
  page: boolean;
  contentSecurityPolicy: string | null;
  allowedNetworkOrigins?: readonly string[];
  restricted: boolean;
}

/** frame-host's environment: this computer, its owner, the type folder, the client folder, `fs.watch`. */
export function localFrameEnv(root: string, ctx: SiteContext, options: LocalFrameOptions, type: FrameTypeSource = localTypeSource(options.typeDir)): FrameEnv {
  if (!ctx.contentOrigin) throw new FrameError('no_content_origin', 'frame-host needs serve({contentHosts: true}) and an art_ artifact id.', 500);
  const contentOrigin = ctx.contentOrigin;
  const port = new URL(contentOrigin).port;
  const owner = localUser();
  const { typeDir, page } = options;
  const log = (line: string): void => ctx.log?.(line);
  return {
    id: ctx.id,
    title: ctx.title,
    log,
    origins: {
      shell: `http://127.0.0.1:${port}`,
      shellOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
      content: contentOrigin,
      connectSrc: [`ws://127.0.0.1:${port}`, `ws://localhost:${port}`],
      frameSrc: `http://*.frame.localhost:${port}`,
    },
    // A snapshot visit's request (marked by FrameSite.handle) is its own read-only viewer; every other is the owner.
    viewer: (req) => (req.peer ? snapshotRequests.get(req.peer) : undefined) ?? owner,
    // The page's address carries no token here: its reader is the owner too (read-only, as the core treats it: the
    // page's origin answers GET and HEAD only, a snapshot's visit included).
    reader: () => owner,
    pageOrigin: () => contentOrigin,
    withholdIdentity: false,
    people: () => [{ id: owner.id, name: owner.name, email: owner.email, avatarUrl: owner.avatarUrl, color: owner.color, level: owner.level }],
    admit: (req) => ctx.local(req.peer as IncomingMessage),
    type,
    client: { file: localClientFile },
    watch: (on) => {
      const watchers: { close(): void }[] = [];
      try {
        const w = watch(root, { recursive: true }, (_event, name) => {
          if (!name) return;
          on.artifact(String(name).split(sep).join('/'));
        });
        w.on('error', () => {});
        watchers.push(w);
      } catch (error) {
        log(`watch: ${(error as Error)?.message ?? error}`);
      }
      // The type folder: a page type serves neither index.html nor artifact-type/ (its pages are the artifacts' own).
      if (!page) {
        try {
          const w = watch(typeDir, { recursive: true }, (_event, name) => on.type(name ? String(name).split(sep).join('/') : null));
          w.on('error', () => {});
          watchers.push(w);
        } catch (error) {
          log(`watch type: ${(error as Error)?.message ?? error}`);
        }
      }
      return {
        close: () => {
          for (const w of watchers) {
            try {
              w.close();
            } catch {
              // already closed
            }
          }
        },
      };
    },
    restricted: options.restricted,
    contentSecurityPolicy: options.contentSecurityPolicy,
    allowedNetworkOrigins: options.allowedNetworkOrigins,
    page,
    guard: LINK_GUARD,
    debug: () => !!process.env.OPEN_ARTIFACT_FRAME_DEBUG,
    daemon: ctx.daemon,
    agentHook: ctx.agentHook,
    ...(ctx.agentName !== undefined ? { agentName: ctx.agentName } : {}),
    ...(ctx.agentWakesIdle !== undefined ? { agentWakesIdle: ctx.agentWakesIdle } : {}),
  };
}

/** Mounts one artifact folder. Throws when the type folder carries no declaration or the server has no content hosts. */
export async function mountFrameSite(root: string, ctx: FrameSiteContext): Promise<FrameSite> {
  const typeDir = resolve(ctx.typeDir ?? process.env.OPEN_ARTIFACT_TYPE_DIR ?? process.cwd());
  const page = ctx.page === true;
  const type = localTypeSource(typeDir);
  const declaration = page ? pageDeclaration(resolve(root)) : type.declaration();
  if (!declaration) throw new FrameError('not_frame_type', `${typeDir}/index.html has no // artifact.json declaration.`, 500);
  const env = localFrameEnv(resolve(root), ctx, {
    typeDir, page, restricted: ctx.restricted === true,
    contentSecurityPolicy: ctx.contentSecurityPolicy || null,
    allowedNetworkOrigins: ctx.allowedNetworkOrigins,
  }, type);
  return new FrameSite(resolve(root), typeDir, declaration, env);
}

// ---- the Node HTTP adapter -----------------------------------------------------------------------------------------

/** A request as plain data (the core's), keeping the `IncomingMessage` for the environment. */
function plainRequest(req: IncomingMessage): FrameRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
  return { method: req.method ?? 'GET', url: req.url ?? '/', headers, body: (limit) => readBody(req, limit), peer: req };
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
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
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Writes the core's answer; a stored file is streamed. */
function sendReply(req: IncomingMessage, res: ServerResponse, reply: FrameReply): void {
  req.resume?.();
  res.writeHead(reply.status, reply.headers);
  const body = reply.body;
  if (body === null) return void res.end();
  if (body instanceof Uint8Array) return void res.end(body);
  createReadStream(body.path)
    .on('error', () => res.destroy())
    .pipe(res);
}

/** A response carried over a WebSocket (serve()'s `StreamResponse`), not an HTTP one. */
const overSocket = (res: ServerResponse | StreamResponse): res is StreamResponse => 'ws' in res;

/** One open artifact of an original type, on this computer: the core, answering Node's requests. */
export class FrameSite extends FrameCore implements Site {
  /** The type folder. */
  readonly typeDir: string;

  /** Snapshot visits under way: credential → their viewer. */
  private readonly visits = new Map<string, FrameViewer>();

  constructor(root: string, typeDir: string, declaration: Declaration, env: FrameEnv) {
    super(root, declaration, env);
    this.typeDir = typeDir;
  }

  // ---- snapshot visits ---------------------------------------------------------------------------------------------

  /**
   * Starts a snapshot visit: a one-time credential (unguessable, this artifact's only) and the address of the inner
   * shell under it, `<shell origin>/snapshot/<credential>/`. Until `end()`, every request under that address is a
   * read-only viewer of its own (the owner's level and name, so the page draws as the person sees it): it reads, each
   * write is refused, it is no peer of anyone, and its event stream says `hello` and nothing more. After `end()` the
   * address is not this site's any more (404). The credential is never logged.
   */
  beginSnapshot(): { url: string; end(): void } {
    const credential = randomBytes(24).toString('base64url');
    const viewer: FrameViewer = { ...localUser() };
    snapshotViewers.add(viewer);
    this.visits.set(credential, viewer);
    return { url: `${this.shellOrigin}/snapshot/${credential}/`, end: () => void this.visits.delete(credential) };
  }

  /** Snapshot visits under way. */
  get snapshotVisits(): number {
    return this.visits.size;
  }

  /** A snapshot visit's address, while it lasts (serve() then routes it here: `Site.claims`). */
  claims(pathname: string): boolean {
    const m = SNAPSHOT_PATH.exec(pathname);
    return !!m && this.visits.has(m[1]!);
  }

  /** The visit's own session: no comments UI or agent in the inner shell, and `snapshot` (it waits for no one). */
  override session(viewer: FrameViewer): FrameSession {
    const session = super.session(viewer);
    if (!isSnapshotViewer(viewer)) return session;
    return { ...session, snapshot: true, comments: { available: false, count: 0 }, agent: { available: false, name: null } };
  }

  /** A snapshot's viewer reads only: every other call is refused before the core runs it. */
  override async capability(cap: string, method: string, a: Record<string, unknown>, client: string, viewer: FrameViewer, forShell = false): Promise<unknown> {
    if (isSnapshotViewer(viewer) && !SNAPSHOT_READS.has(`${cap}.${method}`) && !this.stubs[cap] && this.grantsFor(viewer).includes(cap)) {
      throw snapshotRefusal(cap);
    }
    return super.capability(cap, method, a, client, viewer, forShell);
  }

  /**
   * The inner shell's own POSTs other than capability calls, for a snapshot's viewer: an upload, a title, the agent
   * and its activity are answered here, as for a viewer who may not, and never reach the core (null: the core answers).
   */
  private snapshotShellReply(req: FrameRequest): FrameReply | null {
    if (req.method !== 'POST') return null;
    const name = new URL(req.url || '/', 'http://local').pathname.replace(/^\/api\/frame\//, '');
    if (name === 'cap') return null;
    if (name === 'upload') return jsonReply(200, { error: { code: 'not_granted', message: SNAPSHOT_REFUSED } });
    if (name === 'title') return jsonReply(200, { applied: false });
    if (name === 'activity') return jsonReply(200, { working: false, available: false });
    if (name === 'agent') return jsonReply(403, { error: { code: 'forbidden', message: SNAPSHOT_REFUSED } });
    return null;
  }

  // ---- requests on the inner shell's origin (under Site.page) ------------------------------------------------------

  async handle(req: IncomingMessage, res: ServerResponse | StreamResponse): Promise<void> {
    // A snapshot visit: its credential must be live, and the path below it is the inner shell's as usual.
    const visit = SNAPSHOT_PATH.exec(req.url ?? '/');
    let snapshot: FrameViewer | undefined;
    if (visit) {
      snapshot = this.visits.get(visit[1]!);
      if (!snapshot) {
        req.resume?.();
        res.writeHead(404);
        res.end();
        return;
      }
      req.url = `${visit[2] || '/'}${visit[3] ?? ''}`;
      snapshotRequests.set(req, snapshot);
    }
    const plain = plainRequest(req);
    if (overSocket(res)) {
      if (this.acceptsStream(plain)) return snapshot ? this.quietEvents(req, plain, res) : this.events(req, plain, res);
      res.writeHead(404);
      res.end();
      return;
    }
    const refused = snapshot ? this.snapshotShellReply(plain) : null;
    if (refused) return sendReply(req, res, refused);
    const reply = await this.request(plain);
    if ('events' in reply) return snapshot ? this.quietEvents(req, plain, res) : this.events(req, plain, res);
    sendReply(req, res, reply);
  }

  /**
   * A snapshot visit's event stream: `hello` (no peers), then nothing. It is not one of the core's connections, so no
   * open view sees it among its peers, and nothing it would hear (a reload, a peer) changes the picture.
   */
  private quietEvents(req: IncomingMessage, plain: FrameRequest, res: ServerResponse | StreamResponse): void {
    const client = String(new URL(plain.url || '/', 'http://local').searchParams.get('c') ?? '');
    if (!FrameCore.validClient(client)) {
      res.writeHead(400);
      res.end();
      return;
    }
    const sse = !overSocket(res);
    if (sse) res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    else res.writeHead(200);
    const hello: FrameEvent = { t: 'hello', ver: this.ver, brokerGen: this.brokerGen, peers: [], count: 0 };
    res.write(sse ? `data: ${JSON.stringify(hello)}\n\n` : JSON.stringify(hello));
    const ping = sse ? setInterval(() => res.write(': ping\n\n'), 25_000) : null;
    req.on('close', () => {
      if (ping) clearInterval(ping);
    });
  }

  /** The event stream of one inner shell: JSON objects, over a `baoyu-sse` WebSocket or as SSE. */
  private events(req: IncomingMessage, plain: FrameRequest, res: ServerResponse | StreamResponse): void {
    const client = String(new URL(plain.url || '/', 'http://local').searchParams.get('c') ?? '');
    if (!FrameCore.validClient(client)) {
      res.writeHead(400);
      res.end();
      return;
    }
    const sse = !overSocket(res);
    if (sse) res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    else res.writeHead(200);
    const send = (obj: FrameEvent): void => {
      try {
        res.write(sse ? `data: ${JSON.stringify(obj)}\n\n` : JSON.stringify(obj));
      } catch {
        // closing
      }
    };
    const closed = this.connect(plain, client, { send, end: () => res.end() });
    const ping = sse ? setInterval(() => res.write(': ping\n\n'), 25_000) : null;
    req.on('close', () => {
      if (ping) clearInterval(ping);
      closed();
    });
  }

  // ---- the page's own origin (Site.content) ------------------------------------------------------------------------

  async content(req: IncomingMessage, res: ServerResponse): Promise<void> {
    sendReply(req, res, await this.contentRequest(plainRequest(req)));
  }

  contentUpgrade(_req: IncomingMessage, socket: Duplex): void {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  }
}
