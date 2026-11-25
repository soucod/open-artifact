/**
 * The frame core: one open artifact of an original type (or a page artifact),
 * served to any number of viewers. It answers plain-data requests
 * ({@link FrameRequest} → {@link FrameReply}) and holds event connections
 * ({@link FrameCore.connect}); everything it takes from where it runs comes
 * through a {@link FrameEnv}. Nothing here imports a Node-only module (no
 * `node:http`, `node:os`, `node:module`, `node:url`, `import.meta`, `fs.watch`
 * or streams): local.ts adapts it to frame-host on this computer, and a hosted
 * site can run it as is. Its storage (db/, comments.json, the published files,
 * _blobs/) uses `node:fs` sync calls that a site's virtual file system also has.
 *
 * Every answer that depends on who asks takes the viewer from the request (or
 * from the connection it belongs to), never from the instance: one core serves
 * many viewers at once, and checks each call against that viewer's level and the
 * declaration's access settings (access.ts). Nothing the page or the inner shell
 * says about who it is counts: not a holder, not a client id, not an author.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FRAME_BACKED_CAPABILITIES, FRAME_STUBBED_CAPABILITIES, RESTRICTED_FRAME_SANDBOX, declaredCapabilities, titleInHtml } from '@open-artifact/protocol';
import type { ArtifactRef, ServerAction } from '../serve.ts';
import { AGENT_AUTHOR, COMMENTS_FILE, CommentStore, agentView, type Author, type Thread } from './comments.ts';
import { compileDbRules, dbAllows, meets, topicLevel, uploadLevel, userScopes, type DbRules } from './access.ts';
import { DbStore, checkSpec, docPathsOf, newDocId, splitPath } from './db.ts';
import type { Declaration } from './declaration.ts';
import type { FrameEnv, FrameEventsAsk, FrameFile, FrameLevel, FramePerson, FrameReply, FrameRequest, FrameViewer } from './env.ts';
import { BlobStore, FileStore, blobClaims, type BlobMeta, FrameError, cleanPath, contentTypeOf, reservedPath, typePath, type FileWrite, type PublishResult } from './files.ts';
import {
  STALE_GEN_MESSAGE,
  UNDECLARED_MESSAGE,
  type CapErrorBody,
  type CapReply,
  type FrameBoot,
  type FrameEvent,
  type FrameSession,
  type LocalUser,
  type Peer,
} from './wire.ts';

/** The Frame Runtime contract reported to pages. */
export const CONTRACT = '0.2.92';

/** Capabilities with a local backend; a declared one is granted. `artifact` (self) and `permissions` always are. */
const BACKED = new Set(FRAME_BACKED_CAPABILITIES);
/** Declared capabilities that answer, but only with an error code: nothing here can serve them. */
const STUBBED: Readonly<Record<string, string>> = FRAME_STUBBED_CAPABILITIES;
/** A page artifact's marker: its declared capabilities are there (`capabilities`), put by the daemon. */
export const MARKER_FILE = '.artifact.json';
/** Caps whose stale-generation reply is `unavailable`; `user` answers null; others use the fallback error code. */
const STALE_UNAVAILABLE = new Set(['db', 'downloads', 'files', 'paste', 'reads']);
const BODY_MAX = 64 * 1024 * 1024;
const UPLOAD_MAX = 21 * 1024 * 1024;
const WATCH_DEBOUNCE_MS = 300;
/** An inner shell's client id (its event stream, its room sender). */
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** `user.search` answers at most this many people. */
const SEARCH_MAX = 8;

const PALETTE = ['#785ee8', '#dc3c3d', '#019c7f', '#fbb315', '#ce447d', '#10a122', '#257de0'];
const ROOM_LIMITS = { maxBytes: 4096, presenceHz: 30, keepaliveMs: 20_000, silenceMs: 150_000, maxPeers: 256, maxRooms: 0 };

type Args = Record<string, unknown>;

/** One inner shell's event connection, with the viewer it was opened by. */
interface Client {
  /** The inner shell's own id (what peers see). */
  id: string;
  viewer: FrameViewer;
  send(event: FrameEvent): void;
  presence: Record<string, unknown>;
  end(): void;
}

/** A colour of the palette, by id. */
export function colorOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length] ?? '#c7c9d1';
}

const atLeast = (level: FrameLevel, min: FrameLevel): boolean => meets(level, min);

/**
 * The viewer as the wire's `me` (`FrameSession.me`): its name and avatar only under the declaration's `profile` scope,
 * its email only under `email` (without `scopes`, all that a page is told).
 */
export function wireUser(viewer: FrameViewer, scopes: { profile: boolean; email: boolean } = { profile: true, email: true }): LocalUser {
  return {
    id: viewer.id,
    name: scopes.profile ? viewer.name : '',
    avatarUrl: scopes.profile ? viewer.avatarUrl : null,
    color: viewer.color,
    email: scopes.email ? viewer.email : null,
    isOwner: viewer.level === 'owner',
    canEdit: atLeast(viewer.level, 'admin'),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A page artifact's declaration: the capabilities its `.artifact.json` declares (none when it has none). */
export function pageDeclaration(root: string): Declaration {
  let marker: unknown = null;
  try {
    marker = JSON.parse(readFileSync(join(root, MARKER_FILE), 'utf8'));
  } catch {
    // none yet, or being written: no capabilities
  }
  return { key: 'page', capabilities: declaredCapabilities(isObject(marker) && isObject(marker.capabilities) ? marker.capabilities : null), monitoring: {} };
}

/** What a page artifact shows before it has an index.html: a quiet empty page, which reloads once one is written. */
const EMPTY_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Empty page</title>' +
  '<style>:root{color-scheme:light dark}html,body{height:100%;margin:0}body{display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,sans-serif;color:#6b6f76;background:Canvas}' +
  'p{margin:0;text-align:center;max-width:28em;padding:0 16px}</style></head>' +
  '<body data-open-artifact-empty><p>This page is empty for now. It shows up here as soon as its index.html is written.</p></body></html>';

/**
 * Mounts one artifact folder on an environment. Throws when the type carries no declaration, or when the page is
 * restricted and its origin is one the inner shell runs on (see {@link FrameCore}).
 */
export function mountFrameCore(root: string, env: FrameEnv): FrameCore {
  const declaration = env.page ? pageDeclaration(resolve(root)) : env.type.declaration();
  if (!declaration) throw new FrameError('not_frame_type', `${env.type.label}/index.html has no // artifact.json declaration.`, 500);
  return new FrameCore(resolve(root), declaration, env);
}

/** One open artifact of an original type. */
export class FrameCore {
  readonly root: string;
  readonly id: string;
  readonly page: string;
  readonly contentOrigin: string;
  readonly shellOrigin: string;
  readonly db: DbStore;
  readonly comments: CommentStore;
  readonly files: FileStore;
  readonly blobs: BlobStore;
  /** The broker generation: bumped when the type or the files change under an open page. */
  brokerGen = 1;
  /** Page mode ({@link FrameEnv.page}). */
  readonly pageMode: boolean;
  /** {@link FrameEnv.contentSecurityPolicy}. */
  readonly contentSecurityPolicy: string | null;
  /** {@link FrameEnv.restricted}. */
  readonly restricted: boolean;
  declaration: Declaration;
  title: string;
  ver: string;
  /** What the declaration grants (each viewer gets those of these its level allows: {@link grantsFor}). */
  grants: string[] = [];
  stubs: Record<string, string> = {};
  /** The declaration's db rules, compiled. */
  dbRules: DbRules = compileDbRules(undefined);

  protected readonly env: FrameEnv;
  private readonly shellOrigins: Set<string>;
  private readonly config: Record<string, unknown>;
  private flagKeys: string[] = [];
  private typeVer: string;
  /** Open event connections, by viewer and client id. */
  private readonly clients = new Map<string, Client>();
  private touchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Paths the page wrote, by the author the daemon records them under. */
  private readonly touchPaths = new Map<string, Set<string>>();
  private presenceCache: { at: number; value: unknown } | null = null;
  private watcher: { close(): void } | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private typeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Set<string>();
  /** Page mode: the capabilities last read from the marker, to tell when they change. */
  private capsSeen = '';

  constructor(root: string, declaration: Declaration, env: FrameEnv) {
    this.root = root;
    this.declaration = declaration;
    this.env = env;
    this.pageMode = env.page;
    this.contentSecurityPolicy = env.contentSecurityPolicy || null;
    this.restricted = env.restricted;
    this.id = env.id;
    this.title = env.title ?? '';
    this.page = `/f/${randomBytes(18).toString('base64url')}/`;
    this.contentOrigin = env.origins.content;
    this.shellOrigin = env.origins.shell;
    this.shellOrigins = new Set([env.origins.shell, ...env.origins.shellOrigins]);
    // A sandbox with allow-same-origin keeps the page from the inner shell only while the two origins differ.
    if (this.restricted && [...this.shellOrigins].some((o) => originOf(o) === originOf(this.contentOrigin))) {
      throw new FrameError(
        'same_origin',
        `A restricted page needs an origin of its own: ${this.contentOrigin} is the inner shell's. Give the page a host name the shell does not use.`,
        500,
      );
    }
    const guard = { guard: env.guard };
    this.db = new DbStore(root, guard);
    this.comments = new CommentStore(root, guard);
    this.files = new FileStore(root, { ownIndex: this.pageMode, ...guard });
    this.blobs = new BlobStore(root, guard);
    this.ver = this.files.manifest().ver;
    this.config = env.type.manifest();
    this.typeVer = env.type.fingerprint();
    this.applyDeclaration(declaration);
    this.db.on('change', (paths: string[]) => this.dbChanged(paths));
    this.startWatching();
    if (this.pageMode) this.pageTitle();
  }

  private applyDeclaration(declaration: Declaration): void {
    this.declaration = declaration;
    if (this.pageMode) this.capsSeen = JSON.stringify(declaration.capabilities ?? {});
    const caps = declaration.capabilities ?? {};
    this.grants = [...new Set([...Object.keys(caps).filter((c) => BACKED.has(c)), 'artifact', 'permissions'])];
    this.stubs = Object.fromEntries(Object.keys(caps).flatMap((c) => (STUBBED[c] ? [[c, STUBBED[c]]] : [])));
    const flags = caps.flags;
    this.flagKeys = isObject(flags) && Array.isArray(flags.keys) ? flags.keys.filter((k): k is string => typeof k === 'string') : [];
    this.dbRules = compileDbRules(caps.db);
    if (this.dbRules.problem) this.log(`db rules refused (only the owner reads or writes): ${this.dbRules.problem}`);
  }

  // ---- who may do what (access.ts holds the rules) ------------------------------------------------------------------

  private get caps(): Record<string, unknown> {
    return this.declaration.capabilities ?? {};
  }

  /**
   * What the page is told of people: the declaration's `user` scopes where the environment withholds identity (a
   * site); else as before (names, no email).
   */
  private get scopes(): { profile: boolean; email: boolean } {
    return this.env.withholdIdentity ? userScopes(this.caps.user) : { profile: true, email: false };
  }

  /** Whether room senders carry their viewer's id (`by`): with `user` declared, or wherever identity is not withheld. */
  private get vouches(): boolean {
    return !this.env.withholdIdentity || this.grants.includes('user');
  }

  /**
   * The capabilities one viewer is granted: the declaration's, less `comments` for a viewer who may not comment and
   * `assets` below the upload level (`admin`, or `interact` when the declaration opens uploads to it).
   */
  grantsFor(viewer: FrameViewer): string[] {
    return this.grants.filter((cap) => {
      if (cap === 'comments') return viewer.canComment;
      if (cap === 'assets') return atLeast(viewer.level, uploadLevel(this.caps.assets));
      return true;
    });
  }

  /** Whether a viewer may read / write a db path (`segs`): the declared rules, else the defaults. */
  mayDb(viewer: FrameViewer, segs: readonly string[], action: 'read' | 'write'): boolean {
    return dbAllows(this.dbRules, viewer, segs, action);
  }

  /** A db write the viewer may make, or `invalid_argument` (as the contract answers a refused write). */
  private mustWrite(viewer: FrameViewer, segs: readonly string[]): void {
    if (!this.mayDb(viewer, segs, 'write')) throw new FrameError('invalid_argument', `This viewer may not write ${segs.join('/')}.`);
  }

  /** Whether the viewer edits the artifact (admin and above). */
  private static edits(viewer: FrameViewer): boolean {
    return atLeast(viewer.level, 'admin');
  }

  /**
   * Whether the page may write itself. On a site, `{artifact: {publish: false}}` (or `self`) says no, for every viewer,
   * writers included (the contract: `publish`, `edit` and `sync` reject `not_granted`; editors and the agent still
   * publish the usual way, outside the page). On this computer, as before: the declaration is not read for it.
   */
  private get publishes(): boolean {
    if (!this.env.withholdIdentity) return true;
    const own = isObject(this.caps.artifact) ? this.caps.artifact : isObject(this.caps.self) ? this.caps.self : {};
    return own.publish !== false;
  }

  /** A write of the artifact's files: `not_granted` where the page declares `publish: false`, `not_writer` below admin. */
  private mustPublish(viewer: FrameViewer): void {
    if (!this.publishes) throw new FrameError('not_granted', 'This page declares publish: false.');
    if (!FrameCore.edits(viewer)) throw new FrameError('not_writer', 'Only people who can edit this artifact publish its files.');
  }

  /** Whether a viewer may put text in front of the owner's agent: an editor who may comment. */
  private static reachesAgent(viewer: FrameViewer): boolean {
    return FrameCore.edits(viewer) && viewer.canComment;
  }

  protected log(line: string): void {
    this.env.log?.(line);
  }

  /** The viewer of a request. */
  viewerOf(req: FrameRequest): FrameViewer {
    return this.env.viewer(req);
  }

  close(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    if (this.typeTimer) clearTimeout(this.typeTimer);
    if (this.touchTimer) clearTimeout(this.touchTimer);
    try {
      this.watcher?.close();
    } catch {
      // already closed
    }
    this.watcher = null;
    for (const c of this.clients.values()) c.end();
    this.clients.clear();
  }

  hasBlob(id: string): boolean {
    return !!this.blobs.meta(id);
  }

  // ---- changes -------------------------------------------------------------------------------------------------------

  /** Starts the environment's watcher, when it has one; else every change comes through the core. */
  private startWatching(): void {
    const start = this.env.watch;
    if (!start) return;
    this.watcher = start({
      artifact: (rel) => {
        // Page mode: the marker carries the capabilities (the daemon writes it through a temporary file and a rename).
        if (this.pageMode && (rel === MARKER_FILE || rel.startsWith(`${MARKER_FILE}.`) || rel.startsWith(`.${MARKER_FILE}`))) {
          if (this.typeTimer) clearTimeout(this.typeTimer);
          this.typeTimer = setTimeout(() => this.capabilitiesChanged(), WATCH_DEBOUNCE_MS);
          return;
        }
        if (ignoredChange(rel)) return;
        this.pending.add(rel);
        if (this.watchTimer) clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => this.flushWatch(), WATCH_DEBOUNCE_MS);
      },
      // The type folder: a new index.html or artifact-type/ under an open page rewires its broker.
      type: (rel) => {
        if (rel && rel.split('/').some((s) => s.startsWith('.'))) return;
        if (this.typeTimer) clearTimeout(this.typeTimer);
        this.typeTimer = setTimeout(() => this.typeChanged(), WATCH_DEBOUNCE_MS);
      },
    });
  }

  /** Re-reads the type; when what it serves changed, rewires. */
  typeChanged(): boolean {
    const next = this.env.type.fingerprint();
    if (next === this.typeVer) return false;
    this.typeVer = next;
    let declaration: Declaration | null = null;
    try {
      declaration = this.env.type.declaration();
    } catch (error) {
      this.log(`type: ${(error as Error)?.message ?? error}`);
    }
    if (declaration) this.applyDeclaration(declaration);
    this.rewire('type');
    return true;
  }

  /**
   * Page mode: re-reads the capabilities `.artifact.json` declares; when they changed, rewires as for a new type, and
   * open pages reload with the new set. Also run when a shell asks for its session, in case a watcher missed it.
   */
  capabilitiesChanged(): boolean {
    if (!this.pageMode) return false;
    const declaration = pageDeclaration(this.root);
    if (JSON.stringify(declaration.capabilities) === this.capsSeen) return false;
    this.applyDeclaration(declaration);
    this.rewire('type');
    return true;
  }

  /** Page mode: the title of the page's index.html (its `<title>`) becomes the artifact's, when it says one. */
  private pageTitle(): void {
    let html: string;
    try {
      html = readFileSync(join(this.root, 'index.html'), 'utf8');
    } catch {
      return;
    }
    const title = titleInHtml(html)?.slice(0, 200);
    if (!title || title === this.title) return;
    this.title = title;
    const daemon = this.env.daemon;
    // No author: the title follows the file, whoever wrote it (the page's own publish is recorded as the person's).
    if (daemon?.available) daemon.touch(this.id, { author: '', paths: [], title }).catch(() => {});
  }

  /** A new broker generation: calls stamped with the old one are not run, open shells cut theirs and reload. */
  private rewire(reason: 'type' | 'files'): void {
    this.brokerGen += 1;
    this.broadcast((c) => ({ t: 'rewired', brokerGen: this.brokerGen, caps: this.grantsFor(c.viewer), reason }));
  }

  /** Applies what the folder watcher gathered (exposed for tests: watchers are slow to settle). */
  flushWatch(): void {
    const rels = [...this.pending];
    this.pending.clear();
    this.noteChanges(rels);
  }

  /**
   * Paths of the artifact folder that changed without the core writing them (relative, `/`-separated): the watcher's
   * gatherings, or, where there is no watcher, what the host wrote itself (a site's sync). Open pages get the events.
   */
  noteChanges(paths: string[]): void {
    if (this.pageMode && paths.includes(MARKER_FILE)) this.capabilitiesChanged();
    const rels = paths.filter((r) => !ignoredChange(r));
    if (!rels.length) return;
    const docs = docPathsOf(rels);
    if (docs.length || rels.some((r) => r === 'db' || r.startsWith('db/'))) this.dbChanged(docs);
    if (rels.includes(COMMENTS_FILE)) this.commentsChanged();
    if (rels.some((r) => r !== COMMENTS_FILE && !r.startsWith('db/') && r !== 'db')) this.filesChanged(rels.filter((r) => !reservedPath(r)));
    if (this.pageMode && rels.includes('index.html')) this.pageTitle();
  }

  /** Files changed on disk, not by this page's own publish: a new manifest rewires and reloads open pages. */
  filesChanged(paths: string[] = []): boolean {
    const m = this.files.manifest();
    if (m.ver === this.ver) return false;
    this.ver = m.ver;
    this.rewire('files');
    this.broadcast({ t: 'files', ver: m.ver, paths });
    return true;
  }

  /**
   * Sends an event to every open connection, or what `event` makes of it for that connection's viewer (null: nothing
   * for this one).
   */
  private broadcast(event: FrameEvent | ((c: Client) => FrameEvent | null)): void {
    for (const c of this.clients.values()) {
      const out = typeof event === 'function' ? event(c) : event;
      if (out) c.send(out);
    }
  }

  /**
   * Documents changed: each connection hears of the ones its viewer may read, and of none it may not. No paths (a
   * change the watcher could not place) reruns every listener, whose reads are each checked.
   */
  private dbChanged(paths: string[]): void {
    this.broadcast((c) => {
      if (!paths.length) return { t: 'db', paths: [] };
      const mine = paths.filter((p) => {
        try {
          return this.mayDb(c.viewer, splitPath(p), 'read');
        } catch {
          return false;
        }
      });
      return mine.length ? { t: 'db', paths: mine } : null;
    });
  }

  /** A write from the page: the daemon records it (best effort, gathered), under the viewer who made it. */
  private touched(paths: string[], viewer: FrameViewer): void {
    const author = touchAuthor(viewer);
    let set = this.touchPaths.get(author);
    if (!set) this.touchPaths.set(author, (set = new Set()));
    for (const p of paths) set.add(p);
    if (this.touchTimer) return;
    this.touchTimer = setTimeout(() => {
      this.touchTimer = null;
      const batches = [...this.touchPaths.entries()];
      this.touchPaths.clear();
      const daemon = this.env.daemon;
      for (const [by, set] of batches) {
        const list = [...set].slice(0, 100);
        if (daemon?.available) daemon.touch(this.id, { author: by, paths: list }).catch(() => {});
      }
    }, 1000);
    (this.touchTimer as { unref?: () => void }).unref?.();
  }

  // ---- requests on the inner shell's origin (under Site.page) ------------------------------------------------------

  /**
   * Whether a request may open the event stream over a WebSocket: admitted, from the inner shell's origin (a browser
   * sends `Origin` on every WebSocket), and not the page's read-only token.
   */
  acceptsStream(req: FrameRequest): boolean {
    if (new URL(req.url || '/', 'http://local').pathname !== '/api/frame/events') return false;
    return this.env.admit(req) && this.sameOrigin(req) && this.readOnly(req) === false;
  }

  /** Whether the request's viewer is the page's read-only token; null when the environment places no viewer. */
  private readOnly(req: FrameRequest): boolean | null {
    try {
      return !!this.viewerOf(req).readOnly;
    } catch {
      return null;
    }
  }

  /**
   * One request on the inner shell's origin. `{events: true}`: it asks for its event stream, which the adapter opens
   * and hands to {@link connect}.
   */
  async request(req: FrameRequest): Promise<FrameReply | FrameEventsAsk> {
    const reply = await this.shellReply(req);
    // Neither origin tells anyone where it was: the page address and the shell's carry the site's tokens.
    if ('status' in reply) reply.headers['Referrer-Policy'] = 'no-referrer';
    return reply;
  }

  private async shellReply(req: FrameRequest): Promise<FrameReply | FrameEventsAsk> {
    const url = new URL(req.url || '/', 'http://local');
    const p = url.pathname;
    if (!this.env.admit(req)) return deny(403, 'Frame pages open on this computer only.');
    // The page's read-only token opens the page's own origin, nothing here.
    if (this.readOnly(req) !== false) return deny(403, 'Not with this token.');
    const blob = /^\/_blob\/([0-9a-f]{32})$/.exec(p);
    if (blob) return this.sendBlob(req, blob[1]!);
    if (p === '/' || p === '/index.html') return this.sendClientFile(req, 'shell.html');
    if (p === '/shell.js' || p === '/shell.css' || p === '/comments.js' || p === '/comments.css') return this.sendClientFile(req, p.slice(1));
    if (!p.startsWith('/api/frame/')) return deny(404, 'Not found');
    if (!this.sameOrigin(req)) return deny(403, 'Not from this page.');
    const name = p.slice('/api/frame/'.length);
    try {
      if (name === 'events' && req.method === 'GET') return { events: true };
      const viewer = this.viewerOf(req);
      if (name === 'session' && req.method === 'GET') return json(200, this.session(viewer));
      if (req.method !== 'POST') return deny(405, 'Method not allowed');
      if (name === 'upload') {
        const stale = this.gate('assets', numberOrUndefined(url.searchParams.get('gen')));
        if (stale) return json(200, stale);
        // Checked before the body is read: a viewer who may not upload sends nothing in.
        if (!this.grantsFor(viewer).includes('assets')) return json(200, { error: { code: 'not_granted', message: `assets: ${UNDECLARED_MESSAGE}` } });
        const data = bufferOf(await req.body(UPLOAD_MAX));
        const out = this.blobs.upload(data, url.searchParams.get('type') ?? req.headers['content-type'], viewer.id);
        this.touched(['_blobs'], viewer);
        return json(200, { result: out });
      }
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return deny(415, 'JSON only.');
      const body = JSON.parse(bufferOf(await req.body(BODY_MAX)).toString('utf8') || '{}') as Args;
      if (name === 'cap') return json(200, await this.call(body, viewer));
      if (name === 'title') return json(200, await this.proposeTitle(body, viewer));
      if (name === 'agent') return json(200, await this.askAgent(body, viewer));
      if (name === 'activity') return json(200, await this.activity(viewer));
      return deny(404, 'Not found');
    } catch (error) {
      return json((error as FrameError)?.status ?? 500, { error: errorOf(error) });
    }
  }

  /** The inner shell's own requests: from its origin, never from a page elsewhere. */
  private sameOrigin(req: FrameRequest): boolean {
    const origin = req.headers.origin;
    if (origin !== undefined) return this.shellOrigins.has(origin);
    const site = req.headers['sec-fetch-site'];
    return site === undefined || site === 'same-origin' || site === 'none';
  }

  /** Per-capability config, as `__frame_init.capabilities[cap].config` or a grant carries it. */
  private configs(viewer: FrameViewer): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const cap of this.grantsFor(viewer)) {
      if (cap === 'artifact') out[cap] = { id: this.id, key: this.declaration.key, publish: this.publishes };
      else if (cap === 'user') {
        // For the viewer (see runtime.ts): its name only under the `profile` scope, its email only under `email`. The
        // owner holds everything (no `can` list: runtime.ts answers true); anyone else is told what its level allows.
        const { profile, email } = this.scopes;
        const can =
          viewer.level === 'owner'
            ? {}
            : {
                can: [
                  ...(this.mayDb(viewer, [], 'write') ? ['data.write'] : []),
                  ...(FrameCore.edits(viewer) && this.publishes ? ['files.write'] : []),
                  ...(FrameCore.edits(viewer) && this.grants.includes('assets') ? ['assets.write'] : []),
                ],
              };
        out[cap] = { id: viewer.id, color: viewer.color, owner: viewer.level === 'owner', canEdit: FrameCore.edits(viewer), profile, email, ...can };
      } else if (cap === 'room') out[cap] = { limits: ROOM_LIMITS };
      else if (cap === 'network') {
        const declaration = this.caps.network;
        const optional = isObject(declaration) && declaration.optional === true;
        out[cap] = { origins: optional ? [] : [...(this.env.allowedNetworkOrigins ?? [])] };
      } else out[cap] = {};
    }
    return out;
  }

  /** What one viewer's inner shell needs to start. */
  session(viewer: FrameViewer): FrameSession {
    this.capabilitiesChanged();
    const flags: Record<string, boolean> = {};
    const openArtifact = isObject(this.config.openArtifact) ? this.config.openArtifact : {};
    const configured = (isObject(openArtifact.flags) ? openArtifact.flags : isObject(this.config.flags) ? this.config.flags : {}) as Record<string, unknown>;
    for (const k of this.flagKeys) flags[k] = configured[k] === true;
    return {
      id: this.id,
      title: this.title,
      key: this.declaration.key,
      ver: this.ver,
      contract: CONTRACT,
      contentOrigin: this.pageOriginFor(viewer),
      shellOrigin: this.shellOrigin,
      ...(this.env.origins.outer?.length ? { outerOrigins: [...this.env.origins.outer] } : {}),
      brokerGen: this.brokerGen,
      grants: this.grantsFor(viewer),
      stubs: this.stubs,
      configs: this.configs(viewer),
      capabilities: this.declaration.capabilities,
      flags,
      readyTimeoutS: Number(this.declaration.monitoring?.readyTimeoutS) || 60,
      ...(this.restricted ? { sandbox: RESTRICTED_FRAME_SANDBOX } : {}),
      me: wireUser(viewer, this.scopes),
      comments: { available: this.grantsFor(viewer).includes('comments'), count: viewer.canComment ? this.comments.openCount() : 0 },
      agent: {
        available: FrameCore.reachesAgent(viewer) && !!this.env.daemon?.available,
        name: this.env.agentName ?? null,
        ...(this.env.agentWakesIdle === false ? { wakesIdle: false } : {}),
      },
    };
  }

  /**
   * The page's origin for one viewer ({@link FrameEnv.pageOrigin}): an origin alone, and, for a restricted page, never
   * one the inner shell runs on (as the mount checks for the instance's).
   */
  private pageOriginFor(viewer: FrameViewer): string {
    const raw = this.env.pageOrigin(viewer);
    let origin: string;
    try {
      origin = new URL(raw).origin;
    } catch {
      throw new FrameError('same_origin', `The page origin ${JSON.stringify(raw)} is not one.`, 500);
    }
    if (origin !== raw.replace(/\/$/, '')) throw new FrameError('same_origin', `The page origin is an origin alone, not ${JSON.stringify(raw)}.`, 500);
    if (this.restricted && [...this.shellOrigins].some((o) => originOf(o) === origin)) {
      throw new FrameError('same_origin', `A restricted page needs an origin of its own: ${origin} is the inner shell's.`, 500);
    }
    return origin;
  }

  /** Whether `client` is an inner shell's client id. */
  static validClient(client: string): boolean {
    return CLIENT_ID.test(client);
  }

  /**
   * Opens one inner shell's event connection (`client`, its own id), for the viewer of `req`: a connection of the same
   * viewer and id is ended first. `out` carries the events; the answer is to be called when the connection closes.
   * Throws `invalid_request` (400) for a client id that is not one ({@link FrameCore.validClient}).
   */
  connect(req: FrameRequest, client: string, out: { send(event: FrameEvent): void; end(): void }): () => void {
    if (!FrameCore.validClient(client)) throw new FrameError('invalid_request', 'Not a client id.', 400);
    const viewer = this.viewerOf(req);
    if (viewer.readOnly) throw new FrameError('forbidden', 'Not with this token.', 403);
    const key = `${viewer.id}\u0000${client}`;
    this.clients.get(key)?.end();
    const entry: Client = { id: client, viewer, send: out.send, presence: {}, end: out.end };
    this.clients.set(key, entry);
    out.send({ t: 'hello', ver: this.ver, brokerGen: this.brokerGen, peers: this.peers(), count: viewer.canComment ? this.comments.openCount() : 0 });
    this.broadcast({ t: 'peers', peers: this.peers() });
    return () => {
      if (this.clients.get(key) === entry) {
        this.clients.delete(key);
        this.broadcast({ t: 'peers', peers: this.peers() });
      }
    };
  }

  /** The open connection of a viewer's client id. */
  private clientOf(viewer: FrameViewer, client: string): Client | undefined {
    return this.clients.get(`${viewer.id}\u0000${client}`);
  }

  /**
   * Who an event names as its sender (`from`): on a site, only a connection of the viewer's own (a page cannot speak
   * as another client); on this computer, where one person is every viewer, the client id as given, as before.
   */
  private senderOf(viewer: FrameViewer, client: string): string | undefined {
    if (!this.env.withholdIdentity) return client || undefined;
    return this.clientOf(viewer, client)?.id;
  }

  /** The connections as peers: `by` only when the declaration has `user`, a name only under its `profile` scope. */
  private peers(): Peer[] {
    const by = this.vouches;
    const named = by && this.scopes.profile;
    return [...this.clients.values()].map((c) => ({ peer: c.id, by: by ? c.viewer.id : null, name: named ? c.viewer.name : '', presence: c.presence, kind: 'user' as const }));
  }

  // ---- capabilities ------------------------------------------------------------------------------------------------

  gate(cap: string, gen: number | undefined): CapReply | null {
    if (gen !== undefined && gen !== this.brokerGen) {
      if (cap === 'user') return { result: null };
      const code = STALE_UNAVAILABLE.has(cap) ? 'unavailable' : 'upstream_error';
      return { error: { code, message: STALE_GEN_MESSAGE, ...(cap === 'mcp' ? { retryable: true } : {}) } };
    }
    return null;
  }

  /** `POST /api/frame/cap`: one call of `viewer`'s, answered as `{result}` or `{error}`. */
  async call(body: Args, viewer: FrameViewer): Promise<CapReply> {
    const cap = String(body.cap ?? '') === 'self' ? 'artifact' : String(body.cap ?? '');
    const method = String(body.method ?? '');
    const gen = typeof body.brokerGen === 'number' ? body.brokerGen : undefined;
    const stale = this.gate(cap, gen);
    if (stale) return stale;
    const args = Array.isArray(body.args) ? body.args : [body.args];
    try {
      // `shell: true`: the inner shell's own comments UI (its envelope, which a page's relayed call never sets).
      const forShell = body.shell === true;
      return { result: await this.capability(cap, method, isObject(args[0]) ? args[0] : {}, String(body.client ?? ''), viewer, forShell) };
    } catch (error) {
      this.log(`${cap}.${method}: ${(error as FrameError)?.code ?? 'error'} ${(error as Error)?.message ?? error}`);
      return { error: errorOf(error) };
    }
  }

  private author(viewer: FrameViewer): Author & { principal: string } {
    return { kind: 'user', name: viewer.name, principal: viewer.id };
  }

  /**
   * How a thread reaches the caller. The inner shell's own comments UI (`forShell`), and every caller on this computer:
   * as stored. A page on a site: an author's name only under the `profile` scope, its principal only when `user` is
   * declared, and `mine` on the viewer's own messages either way (so a page's moderation still knows them).
   */
  private threadView(viewer: FrameViewer, forShell: boolean): (t: Thread) => Record<string, unknown> {
    if (forShell || !this.env.withholdIdentity) return pageThread;
    const named = this.scopes.profile;
    const vouched = this.vouches;
    return (t) => {
      const out = pageThread(t);
      out.messages = t.messages.map((m) => {
        const author = m.author as Author & { principal?: string };
        const mine = author.kind === 'user' && author.principal === viewer.id;
        const shown =
          author.kind === 'user'
            ? { kind: author.kind, name: named ? author.name : '', ...(vouched && author.principal !== undefined ? { principal: author.principal } : {}), ...(mine ? { mine: true } : {}) }
            : { kind: author.kind, name: author.name };
        return { id: m.id, author: shown, text: m.text, at: m.at };
      });
      return out;
    };
  }

  async capability(cap: string, method: string, a: Args, client: string, viewer: FrameViewer, forShell = false): Promise<unknown> {
    if (this.stubs[cap]) throw new FrameError(this.stubs[cap]!, `${cap} is not available on this computer.`);
    if (!this.grantsFor(viewer).includes(cap)) throw new FrameError('not_granted', `${cap}: ${UNDECLARED_MESSAGE}`);
    const path = (): string => String(a.path ?? '');
    const doc = (): string[] => splitPath(path(), 'doc');
    switch (`${cap}.${method}`) {
      case 'db.get': {
        // A document this viewer may not read looks like one that is not there.
        if (!this.mayDb(viewer, doc(), 'read')) return { exists: false };
        const data = this.db.readDoc(path());
        return data ? { exists: true, data } : { exists: false };
      }
      case 'db.set':
        this.mustWrite(viewer, doc());
        this.db.set(path(), a.data);
        this.touched([`db/${path()}`], viewer);
        return {};
      case 'db.update':
        this.mustWrite(viewer, doc());
        this.db.update(path(), a.data);
        this.touched([`db/${path()}`], viewer);
        return {};
      case 'db.delete':
        this.mustWrite(viewer, doc());
        this.db.delete(path());
        this.touched([`db/${path()}`], viewer);
        return {};
      case 'db.add': {
        const id = newDocId();
        this.mustWrite(viewer, [...splitPath(path(), 'collection'), id]);
        const out = this.db.add(path(), a.data, id);
        this.touched([`db/${out.path}`], viewer);
        return out;
      }
      case 'db.query': {
        const coll = splitPath(path(), 'collection');
        const spec = checkSpec(a.spec ?? {});
        // Only the rows this viewer may read, and the limit counted among those.
        const docs = this.db.query(path(), { ...(isObject(a.spec) ? a.spec : {}), limit: null }).filter((d) => this.mayDb(viewer, [...coll, d.id], 'read'));
        return { docs: spec.limit ? docs.slice(0, spec.limit) : docs };
      }
      case 'db.acquire': {
        // The lease is the viewer's: the page's holder string tells only its own tabs apart, under the viewer's id.
        this.mustWrite(viewer, doc());
        const options = isObject(a.options) ? a.options : {};
        const holder = options.holder;
        if (typeof holder !== 'string' || !holder || holder.length > 128) throw new FrameError('invalid_argument', 'acquire() needs a holder.');
        const out = this.db.acquire(path(), { ...options, holder: leaseHolder(viewer, holder) });
        // Busy: when it frees up; who holds it only when it is the viewer itself (another tab: always, on this computer).
        if (out.acquired) return { ...out, holder };
        const mine = out.holder?.startsWith(leaseHolder(viewer, '')) ? out.holder.slice(leaseHolder(viewer, '').length) : undefined;
        return { acquired: false, ...(mine !== undefined ? { holder: mine } : {}), ...(out.expiresAt !== undefined ? { expiresAt: out.expiresAt } : {}) };
      }
      case 'db.release':
        this.mustWrite(viewer, doc());
        return this.db.release(path(), typeof a.holder === 'string' ? leaseHolder(viewer, a.holder) : null);
      case 'artifact.publish':
        this.mustPublish(viewer);
        if (typeof a.html === 'string') {
          if (!this.pageMode) throw new FrameError('read_only_path', "index.html belongs to this artifact's type; publish files instead.", 403);
          return this.publishPage(a.html, typeof a.ver === 'string' ? a.ver : undefined, viewer);
        }
        return this.publish(isObject(a.files) ? a.files : {}, client, viewer);
      case 'artifact.sync':
        this.mustPublish(viewer);
        return { version: this.ver, files: this.files.manifest().files };
      case 'artifact.metadata': {
        const refs = Array.isArray(a.refs) ? a.refs : [];
        const out: Record<string, unknown> = {};
        for (const ref of refs.slice(0, 100)) {
          if (ref === this.id || ref === 'self') out[String(ref)] = { id: this.id, title: this.title, type: this.declaration.key };
        }
        return out;
      }
      case 'artifact.search':
        return { results: [] };
      case 'artifact.edit':
        this.mustPublish(viewer);
        throw new FrameError('capability_disabled', 'edit() is for live documents; publish the files instead.');
      // Below admin (a viewer the declaration lets upload): only the assets it uploaded itself.
      case 'assets.list':
        return FrameCore.edits(viewer) ? this.blobs.list() : this.blobs.list((m) => this.uploadedBy(m, viewer));
      case 'assets.delete': {
        // An editor deletes the asset; anyone else, only its own claim (the bytes stay while another claims them).
        const out = this.blobs.delete(a.ref, FrameCore.edits(viewer) ? undefined : viewer.id);
        if (out.deleted) this.touched(['_blobs'], viewer);
        return out;
      }
      case 'user.me':
      case 'user.profile': {
        const { profile } = this.scopes;
        return { id: viewer.id, name: profile ? viewer.name : '', avatarUrl: profile ? viewer.avatarUrl : null, color: viewer.color };
      }
      case 'user.email':
        return this.scopes.email ? viewer.email : null;
      case 'user.profiles': {
        const ids = (Array.isArray(a.ids) ? a.ids : []).filter((i): i is string => typeof i === 'string').slice(0, 100);
        const people = await this.reachable(viewer);
        return Object.fromEntries(ids.flatMap((i) => (people.has(i) ? [[i, this.profileOf(people.get(i)!, viewer)]] : [])));
      }
      case 'user.access': {
        // One's own level; anyone else's only for an editor, and only of people who can reach the artifact.
        const ids = (Array.isArray(a.ids) ? a.ids : []).slice(0, 100);
        const people = FrameCore.edits(viewer) ? await this.reachable(viewer) : new Map<string, FramePerson>();
        return Object.fromEntries(ids.map((i) => [String(i), i === viewer.id ? viewer.level : (people.get(String(i))?.level ?? null)]));
      }
      case 'user.search': {
        // A site: under `profile`, for a viewer who edits or comments; names, and emails only under `email`.
        // This computer (identity not withheld): no one to search for, as before.
        if (!this.env.withholdIdentity) return [];
        const { profile, email } = userScopes(this.caps.user);
        if (!profile || !(FrameCore.edits(viewer) || viewer.canComment)) return [];
        const q = String(a.q ?? a.query ?? '').trim().toLowerCase();
        const people = await this.reachable(viewer);
        const hits = [...people.values()].filter((p) =>
          q === '' ? p.id === viewer.id : !!p.name && (p.name.toLowerCase().includes(q) || (email && !!p.email && p.email.toLowerCase().includes(q))),
        );
        return hits
          .filter((p) => !!p.name)
          .slice(0, SEARCH_MAX)
          .map((p) => this.profileOf(p, viewer));
      }
      case 'permissions.state':
      case 'permissions.request': {
        // Answered from this viewer's grants (the page usually answers these itself; this is for a call that comes here).
        const mine = this.grantsFor(viewer);
        const state = (n: unknown): string => (mine.includes(String(n) === 'self' ? 'artifact' : String(n)) ? 'granted' : 'unavailable');
        const named = method === 'state' ? (a.name !== undefined ? [a.name] : null) : Array.isArray(a.names) ? a.names : a.names !== undefined ? [a.names] : null;
        if (method === 'state' && named) return state(named[0]);
        return Object.fromEntries((named ?? mine).map((n) => [String(n), state(n)]));
      }
      case 'permissions.manage':
        throw new FrameError('unavailable', 'There is no permissions panel here.');
      case 'downloads.save':
        // Saved by the page itself; nothing on this side saves for it.
        throw new FrameError('unavailable', 'Downloads are saved by the page.');
      case 'comments.list':
        return { threads: this.comments.threads({ all: a.all !== false }).map(this.threadView(viewer, forShell)) };
      case 'comments.create': {
        const thread = this.comments.create({
          anchor: a.anchor,
          label: a.label,
          detail: a.detail,
          location: { custom: a.anchor ?? null, ...(typeof a.file === 'string' ? { file: a.file } : {}) },
          text: a.text,
          author: this.author(viewer),
        });
        this.commentsChanged();
        return { threadId: thread.id, commentId: thread.messages[0]!.id, thread: this.threadView(viewer, forShell)(thread) };
      }
      case 'comments.reply': {
        const { thread, message } = this.comments.addMessage(a.threadId, this.author(viewer), a.text);
        this.commentsChanged();
        return { threadId: thread.id, commentId: message.id, thread: this.threadView(viewer, forShell)(thread) };
      }
      case 'comments.resolve': {
        this.mustModerate(viewer, a.threadId);
        const thread = this.comments.setResolved(a.threadId, a.resolved !== false, this.author(viewer));
        this.commentsChanged();
        return { thread: this.threadView(viewer, forShell)(thread) };
      }
      case 'comments.move': {
        this.mustModerate(viewer, a.threadId);
        const have = this.comments.load().threads.find((t) => t.id === a.threadId);
        const thread = this.comments.move(a.threadId, a.anchor, { ...(have?.location ?? {}), custom: a.anchor ?? null });
        this.commentsChanged();
        return { thread: this.threadView(viewer, forShell)(thread) };
      }
      case 'comments.delete': {
        this.mustModerate(viewer, a.threadId, a.commentId);
        const out = this.comments.remove(a.threadId, a.commentId);
        this.commentsChanged();
        return out;
      }
      case 'comments.sendToAgent':
        if (!FrameCore.reachesAgent(viewer)) throw new FrameError('forbidden', 'Only people who can edit this artifact send comments to its agent.');
        return this.sendToAgent(a, viewer, forShell);
      case 'comments.canSendToAgent':
        return FrameCore.reachesAgent(viewer) ? this.canSendToAgent() : 'writers_only';
      case 'room.emit': {
        if (JSON.stringify(a.data ?? null).length > ROOM_LIMITS.maxBytes) throw new FrameError('too_large', `A room message is at most ${ROOM_LIMITS.maxBytes} bytes.`);
        const topic = String(a.topic ?? '');
        // A named room's topic arrives as `name/topic`: the declared level is the topic's own.
        if (!atLeast(viewer.level, topicLevel(this.caps.room, topic.slice(topic.lastIndexOf('/') + 1)))) {
          throw new FrameError('not_permitted', `This viewer may not send on ${JSON.stringify(topic)}.`);
        }
        // On a site the sender is a connection the viewer opened; a client id that is not one of its own sends nothing.
        const from = this.senderOf(viewer, client);
        if (from === undefined && this.env.withholdIdentity) return {};
        this.broadcast({ t: 'room', topic, data: a.data ?? null, from: from ?? client, by: this.vouches ? viewer.id : null });
        return {};
      }
      case 'room.presence': {
        const c = this.clientOf(viewer, client);
        if (c) c.presence = { ...c.presence, ...(isObject(a.patch) ? a.patch : {}) };
        this.broadcast({ t: 'peers', peers: this.peers() });
        return {};
      }
      case 'room.peers':
        return this.peers();
      case 'room.sendToAgentSession': {
        if (!FrameCore.reachesAgent(viewer)) throw new FrameError('not_permitted', "Only people who can edit this artifact reach its owner's agent.");
        const text = typeof a.data === 'string' ? a.data : JSON.stringify(a.data ?? null);
        if (Buffer.byteLength(text) > ROOM_LIMITS.maxBytes) throw new FrameError('too_large', `sendToAgentSession() takes at most ${ROOM_LIMITS.maxBytes} bytes.`);
        const out = await this.env.agentHook.request({ label: this.declaration.key ?? 'page', text });
        return { to: out?.via ?? 'agent' };
      }
      case 'room.canSendToAgentSession':
        return FrameCore.reachesAgent(viewer) && (await this.canSendToAgent()) === 'available';
      default:
        throw new FrameError('invalid_request', `${cap}.${method} is not supported here.`);
    }
  }

  /** The page's publish: its wire form (`{text}` | `{b64}` | null | `{delete:true}`, each with an optional ifMatch). */
  publish(files: Record<string, unknown>, client: string, viewer: FrameViewer): PublishResult {
    const plan: Record<string, FileWrite> = {};
    for (const [p, raw] of Object.entries(files)) {
      const spec = isObject(raw) ? raw : null;
      const guard = spec && 'ifMatch' in spec ? { ifMatch: spec.ifMatch as string | null } : {};
      if (raw === null || spec?.delete === true) {
        plan[p] = { delete: true, ...guard };
        continue;
      }
      let data: Buffer;
      if (typeof spec?.b64 === 'string') data = Buffer.from(spec.b64, 'base64');
      else if (typeof spec?.text === 'string') data = Buffer.from(spec.text, 'utf8');
      else throw new FrameError('invalid_content', `${p}: no content.`);
      plan[p] = { data, ...(typeof spec.contentType === 'string' ? { contentType: spec.contentType } : {}), ...guard };
    }
    const out = this.files.publish(plan);
    if (out.version !== this.ver) {
      // The page's own write: no rewiring (its calls stay valid); other shells reload.
      this.ver = out.version;
      // `from` (the inner shell that published keeps its page): on a site, only a connection of this viewer's own.
      const own = this.senderOf(viewer, client);
      this.broadcast({ t: 'files', ver: out.version, paths: out.changed.map((c) => c.path), ...(own !== undefined ? { from: own } : {}) });
    }
    if (out.changed.length) this.touched(out.changed.map((c) => c.path), viewer);
    return out;
  }

  /**
   * Page mode's `publish(html)`: the whole document replaces the root index.html, only while the files are still the
   * version this view was loaded from (`ver`; else `conflict`, nothing written). Every open view reloads, this one too.
   */
  publishPage(html: string, ver: string | undefined, viewer: FrameViewer): PublishResult {
    if (ver !== undefined && ver !== this.files.manifest().ver) {
      throw new FrameError('conflict', 'The page changed since this view loaded it: nothing was written.', 409, { live: this.files.manifest().ver });
    }
    const out = this.files.publish({ 'index.html': { data: Buffer.from(html, 'utf8'), contentType: 'text/html' } });
    if (out.version !== this.ver) {
      this.ver = out.version;
      this.rewire('files');
      this.broadcast({ t: 'files', ver: out.version, paths: ['index.html'] });
    }
    if (out.changed.length) this.touched(['index.html'], viewer);
    this.pageTitle();
    return out;
  }

  /** The comments changed: only viewers who may comment hear of it. */
  commentsChanged(): void {
    const count = this.comments.openCount();
    this.broadcast((c) => (c.viewer.canComment ? { t: 'comments', count } : null));
  }

  /** Resolving, moving or deleting a thread (or one message of it): its starter (that message's author) or an editor. */
  private mustModerate(viewer: FrameViewer, threadId: unknown, commentId?: unknown): void {
    if (FrameCore.edits(viewer)) return;
    const thread = this.comments.load().threads.find((t) => t.id === threadId);
    if (!thread) return; // the store answers not_found
    const message = commentId === undefined || commentId === null ? thread.messages[0] : thread.messages.find((m) => m.id === commentId);
    const by = (message?.author as { principal?: string } | undefined)?.principal;
    if (by !== viewer.id) throw new FrameError('forbidden', 'Only who started this thread, or an editor, may do that.');
  }

  /** Whether a viewer uploaded an asset (`uploader`): one with none is the owner's. */
  private uploadedBy(meta: BlobMeta, viewer: FrameViewer): boolean {
    const claims = blobClaims(meta);
    return claims.length === 0 ? viewer.level === 'owner' : claims.includes(viewer.id);
  }

  /** The people `user` answers about: those who can reach the artifact, and the viewer. */
  private async reachable(viewer: FrameViewer): Promise<Map<string, FramePerson>> {
    const out = new Map<string, FramePerson>();
    for (const p of await this.env.people()) out.set(p.id, p);
    out.set(viewer.id, { id: viewer.id, name: viewer.name, email: viewer.email, avatarUrl: viewer.avatarUrl, color: viewer.color, level: viewer.level });
    return out;
  }

  /** A person as `user.profiles` / `user.search` give them: names under `profile`, emails under `email`. */
  private profileOf(p: FramePerson, viewer: FrameViewer): Record<string, unknown> {
    const { profile, email } = this.scopes;
    return {
      id: p.id,
      name: profile ? p.name : '',
      avatarUrl: profile ? p.avatarUrl : null,
      color: p.color ?? colorOf(p.id),
      email: email ? p.email : null,
      isMe: p.id === viewer.id,
      guest: p.id === viewer.id ? viewer.guest : false,
      roles: null,
    };
  }

  private async presence(): Promise<{ canSend?: boolean; busy?: boolean } | null> {
    const daemon = this.env.daemon;
    if (!daemon?.available) return null;
    if (this.presenceCache && Date.now() - this.presenceCache.at < 3000) return this.presenceCache.value as { canSend?: boolean } | null;
    let value: unknown = null;
    try {
      value = await daemon.presence(this.id);
    } catch {
      value = null;
    }
    this.presenceCache = { at: Date.now(), value };
    return value as { canSend?: boolean; busy?: boolean } | null;
  }

  private async canSendToAgent(): Promise<'available' | 'no_session' | 'off'> {
    if (!this.env.daemon?.available) return 'off';
    const p = await this.presence();
    if (!p) return 'no_session';
    return p.canSend === false ? 'no_session' : 'available';
  }

  private async sendToAgent(a: Args, viewer: FrameViewer, forShell = false): Promise<unknown> {
    let threadId = typeof a.threadId === 'string' ? a.threadId : '';
    if (!threadId) {
      threadId = this.comments.create({ anchor: a.anchor, label: a.label, detail: a.detail, location: { custom: a.anchor ?? null }, text: a.text, author: this.author(viewer) }).id;
    } else if (typeof a.text === 'string' && a.text.trim()) {
      this.comments.addMessage(threadId, this.author(viewer), a.text);
    }
    this.comments.markSent(threadId);
    this.commentsChanged();
    const thread = this.comments.load().threads.find((t) => t.id === threadId)!;
    let out;
    try {
      const view = agentView(thread);
      const note = a.handoffNote;
      if (typeof note === 'string' && note.length <= 2000 && note.trim() && Buffer.byteLength(note) <= 2000) view.pageContext = note;
      out = await this.env.agentHook.thread(view as never);
    } catch (error) {
      throw new FrameError('agent_unavailable', (error as Error)?.message ?? 'The agent could not be reached.', 409);
    }
    const marked = this.comments.markDelivered(threadId, out?.via === 'wait' ? 'wait' : 'hook');
    this.commentsChanged();
    return { threadId, status: out?.status ?? 'delivered', thread: this.threadView(viewer, forShell)(marked) };
  }

  private async proposeTitle({ title, ifUnnamed }: Args, viewer: FrameViewer): Promise<{ applied: boolean; title?: string }> {
    // The title is the artifact's: an editor's to change.
    if (!FrameCore.edits(viewer)) return { applied: false };
    if (typeof title !== 'string' || !title.trim()) return { applied: false };
    const clean = title.trim().slice(0, 200);
    if (ifUnnamed && this.title && !/^untitled\b/i.test(this.title)) return { applied: false };
    const daemon = this.env.daemon;
    if (!daemon?.available) return { applied: false };
    try {
      await daemon.touch(this.id, { author: touchAuthor(viewer), paths: [], title: clean });
      this.title = clean;
      return { applied: true, title: clean };
    } catch {
      return { applied: false };
    }
  }

  private async askAgent({ text }: Args, viewer: FrameViewer): Promise<{ status: string; via: string | null }> {
    if (!FrameCore.reachesAgent(viewer)) throw new FrameError('forbidden', "Only people who can edit this artifact reach its owner's agent.", 403);
    const out = await this.env.agentHook.request({ label: this.declaration.key ?? 'page', text: String(text ?? '').slice(0, 20_000) });
    return { status: out?.status ?? 'delivered', via: out?.via ?? null };
  }

  private async activity(viewer: FrameViewer): Promise<{ working: boolean; available: boolean }> {
    if (!FrameCore.reachesAgent(viewer)) return { working: false, available: false };
    const p = await this.presence();
    return { working: !!p?.busy, available: !!p };
  }

  // ---- the page's own origin (Site.content) ------------------------------------------------------------------------

  /** One request on the page's own origin; every answer carries the page's CSP, when there is one. */
  async contentRequest(req: FrameRequest): Promise<FrameReply> {
    let reader: FrameViewer | null = null;
    try {
      reader = this.env.reader(req);
    } catch {
      // a token the environment cannot place: refused below
    }
    const reply = reader ? this.contentReply(req, { ...reader, readOnly: true }) : deny(403, 'Not with this address.');
    reply.headers['Referrer-Policy'] = 'no-referrer';
    if (reply.status >= 400 && !String(req.url).endsWith('/_files.json')) this.log(`content ${req.method} ${req.url} → ${reply.status}`);
    if (this.contentSecurityPolicy) reply.headers = { 'Content-Security-Policy': this.contentSecurityPolicy, ...reply.headers };
    return reply;
  }

  /** The page origin's answer, for its reader (read-only, whatever the environment said). */
  private contentReply(req: FrameRequest, reader: FrameViewer): FrameReply {
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, 'Method not allowed');
    const url = new URL(req.url || '/', 'http://local');
    const p = url.pathname;
    if (p === '/' || p === '/index.html') return { status: 302, headers: { Location: `/_f/${this.ver}/${url.search}`, 'Cache-Control': 'no-store' }, body: null };
    if (p === '/_runtime/open-artifact-frame.js') return this.sendScript(req, 'runtime');
    if (p.startsWith('/_/openartifact:')) return this.capabilityModule(req, p);
    const blob = /^\/_blob\/([0-9a-f]{32})$/.exec(p);
    if (blob) return this.sendBlob(req, blob[1]!);
    const m = /^\/_f\/([A-Za-z0-9_-]{1,128})\/(.*)$/.exec(p);
    if (!m) return deny(404, 'Not found');
    let rel: string;
    try {
      rel = decodeURIComponent(m[2]!);
    } catch {
      return deny(400, 'Bad path');
    }
    if (rel === '' || rel === 'index.html') {
      if (!this.loadedByShell(req)) return deny(403, 'This page opens inside its Open Artifact page.');
      return this.sendIndex(req, reader);
    }
    if (rel === '_files.json') {
      const manifest = this.files.manifest();
      // An artifact with no files yet has no listing: the original pages read that 404 as "start empty".
      if (Object.keys(manifest.files).length === 0) return json(404, { code: 'empty', message: 'No files yet.' }, req.method === 'HEAD');
      return json(200, { ver: manifest.ver, files: manifest.files }, req.method === 'HEAD');
    }
    const clean = cleanPath(rel);
    if (!clean || clean.split('/').some((s) => s.startsWith('.'))) return deny(404, 'Not found');
    if (clean.startsWith('artifact-type/')) {
      const file = this.env.type.file(clean);
      if (!file) return deny(404, 'Not found');
      return sendFile(req, file, contentTypeOf(clean), true);
    }
    if (typePath(clean)) return deny(404, 'Not found');
    const file = this.files.resolve(clean);
    if (!file) return deny(404, 'Not found');
    return this.sendStored(req, file, contentTypeOf(file));
  }

  /**
   * Who may load the page: the inner shell's frame (it sends its origin as the Referer), the page itself, a visit
   * typed into the address bar, or a client with no fetch metadata (a script, an old browser). A frame put up by
   * anyone else is refused here, not by CSP `frame-ancestors`: that directive checks every ancestor, and the app
   * around the Open Artifact Shell may be a `file://` page or a scheme of its own (`app://`), which no source list
   * written on this computer can name.
   */
  private loadedByShell(req: FrameRequest): boolean {
    const dest = req.headers['sec-fetch-dest'];
    const site = req.headers['sec-fetch-site'];
    if (dest === 'document' || site === 'same-origin') return true;
    const referer = req.headers.referer;
    if (!referer) return dest === undefined && site === undefined;
    try {
      return this.shellOrigins.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  /** The type's index.html (page mode: the artifact's, or an empty page) with the Frame Runtime first in its <head>. */
  private sendIndex(req: FrameRequest, reader: FrameViewer): FrameReply {
    let html: string;
    if (this.pageMode) {
      try {
        html = readFileSync(join(this.root, 'index.html'), 'utf8');
      } catch {
        html = EMPTY_PAGE;
      }
    } else {
      const own = this.env.type.indexHtml();
      if (own === null) return deny(500, 'The type has no index.html.');
      html = own;
    }
    // The page's origin knows its reader only by the read-only token: what it is given is that viewer's grants.
    const boot: FrameBoot = {
      shellOrigin: this.shellOrigin,
      id: this.id,
      key: this.declaration.key,
      grants: this.grantsFor(reader),
      stubs: Object.keys(this.stubs),
      contract: CONTRACT,
      ...(this.env.debug() ? { debug: true } : {}),
    };
    const safe = (v: unknown): string => JSON.stringify(v).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const inject =
      `<script>window.__FRAME_PREAMBLE=${safe({ origins: [this.shellOrigin] })};window.__OPEN_ARTIFACT_FRAME=${safe(boot)};</script>` +
      `<script src="/_runtime/open-artifact-frame.js"></script>`;
    const head = /<head\b[^>]*>/i.exec(html);
    const out = head ? html.slice(0, head.index + head[0].length) + inject + html.slice(head.index + head[0].length) : inject + html;
    const body = Buffer.from(out, 'utf8');
    return {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        // No frame-ancestors: who framed it is checked when it is asked for (loadedByShell).
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
      body: req.method === 'HEAD' ? null : body,
    };
  }

  private sendClientFile(req: FrameRequest, name: string): FrameReply {
    if (name === 'shell.js') return this.sendScript(req, 'shell');
    if (name === 'comments.js' || name === 'comments.css') {
      return sendFile(req, this.env.client.file(name), name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
    }
    if (name === 'shell.html') {
      return sendFile(req, this.env.client.file(name), 'text/html; charset=utf-8', false, {
        'Content-Security-Policy': [
          "default-src 'none'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          // The comment views' font (Inter) is inlined as data: URLs in comments.css.
          "font-src 'self' data:",
          ["connect-src 'self'", ...this.env.origins.connectSrc].join(' '),
          // CSP host sources cannot spell an id with '_', so: any artifact origin on this server's port.
          `frame-src ${this.env.origins.frameSrc}`,
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; '),
        // The page frame sets its own `referrerpolicy="origin"`, so the page's origin still sees who framed it.
        'Referrer-Policy': 'no-referrer',
      });
    }
    return sendFile(req, this.env.client.file(name), 'text/css; charset=utf-8');
  }

  /** ESM addresses contain only the capability name and the optional contract of this host. */
  private capabilityModule(req: FrameRequest, pathname: string): FrameReply {
    const match = /^\/_\/openartifact:([a-z][a-z0-9]{0,23})(?:@(\d+\.\d+\.\d+))?$/.exec(pathname);
    if (!match) return deny(404, 'Unknown capability module.');
    const [, name, version] = match;
    if (version !== undefined && version !== CONTRACT) return deny(404, 'Contract not served by this frame.');
    if (name === 'use' && !version) return this.sendScript(req, 'imports');
    if (name !== 'use' && name !== 'self' && name !== 'hot' && !BACKED.has(name) && !Object.hasOwn(STUBBED, name)) return deny(404, 'Unknown capability module.');
    const body = Buffer.from(name === 'use'
      ? 'export { at, default } from "/_/openartifact:use";\n'
      : `import { at } from "/_/openartifact:use"; export default at(${JSON.stringify(name)});\n`);
    return sendFile(req, { size: body.length, mtimeMs: null, body }, 'text/javascript; charset=utf-8');
  }

  /** A browser script: the built `<name>.js`, or one the environment makes (from source, locally). */
  private sendScript(req: FrameRequest, name: 'runtime' | 'shell' | 'imports'): FrameReply {
    let file: FrameFile | null;
    try {
      file = this.env.client.file(`${name}.js`);
    } catch (error) {
      this.log(`client ${name}: ${(error as Error)?.message ?? error}`);
      return deny(500, `The frame ${name} script is missing.`);
    }
    return sendFile(req, file, 'text/javascript; charset=utf-8');
  }

  private sendBlob(req: FrameRequest, id: string): FrameReply {
    const meta = this.blobs.meta(id);
    if (!meta) return deny(404, 'Not found');
    const extra: Record<string, string> = meta.contentType === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {};
    return this.sendStored(req, join(this.blobs.dir, id), meta.contentType, true, { ...extra, 'Cache-Control': 'public, max-age=31536000, immutable' });
  }

  /** A file of the artifact's storage. */
  private sendStored(req: FrameRequest, path: string, type: string, cacheable = false, extra: Record<string, string> = {}): FrameReply {
    return sendFile(req, storedFile(path), type, cacheable, extra);
  }
}

// ---- helpers -----------------------------------------------------------------------------------------------------------

/** A lease's holder as stored: the viewer's id, then the page's own string (which only tells its tabs apart). */
function leaseHolder(viewer: FrameViewer, holder: string): string {
  return `${viewer.id}\u0000${holder}`;
}

/** What the daemon records a page's write under: the owner's is `owner` (as before); another viewer's, its id. */
function touchAuthor(viewer: FrameViewer): string {
  return viewer.level === 'owner' ? 'owner' : viewer.id;
}

/** Changes no page hears of: hidden paths, the blobs, the history. */
function ignoredChange(rel: string): boolean {
  return rel.split('/').some((s) => s.startsWith('.')) || rel.startsWith('_blobs/') || rel.startsWith('history/');
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

/** A file of the artifact's storage, or null when it is not a file. */
export function storedFile(path: string): FrameFile | null {
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    return { size: st.size, mtimeMs: st.mtimeMs, body: { path } };
  } catch {
    return null;
  }
}

/** The answer for a file: 404 without one; its ETag (when it has a time), 304, and no body for HEAD. */
function sendFile(req: FrameRequest, file: FrameFile | null, type: string, cacheable = false, extra: Record<string, string> = {}): FrameReply {
  if (!file) return deny(404, 'Not found');
  const head = req.method === 'HEAD';
  if (file.mtimeMs === null) {
    // Made on the fly (a script from source): no ETag, never cached.
    return {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': file.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
      body: head ? null : file.body,
    };
  }
  const etag = `W/"${file.size.toString(16)}-${Math.floor(file.mtimeMs).toString(16)}"`;
  const headers: Record<string, string | number> = {
    'Content-Type': type,
    'Cache-Control': cacheable ? 'no-cache' : 'no-store',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
  if (req.headers['if-none-match'] === etag) return { status: 304, headers, body: null };
  return { status: 200, headers: { ...headers, 'Content-Length': file.size }, body: head ? null : file.body };
}

/** A body's bytes: a stored file read whole, for a host that cannot stream it (a Durable Object). */
export function replyBytes(body: FrameReply['body']): Uint8Array | null {
  if (body === null) return null;
  if (body instanceof Uint8Array) return body;
  return readFileSync(body.path);
}

const bufferOf = (bytes: Uint8Array): Buffer => (Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));

const numberOrUndefined = (v: string | null): number | undefined => (v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** A thread as a page sees it. */
function pageThread(t: Thread): Record<string, unknown> {
  let anchor: unknown = t.location?.custom;
  if (anchor === undefined) {
    try {
      anchor = JSON.parse(t.anchor);
    } catch {
      anchor = t.anchor;
    }
  }
  return {
    id: t.id,
    anchor,
    label: t.label,
    resolved: t.status === 'resolved',
    status: t.status,
    agent: t.agent ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messages: t.messages.map((m) => ({ id: m.id, author: m.author, text: m.text, at: m.at })),
  };
}

function errorOf(error: unknown): CapErrorBody {
  const e = error as Partial<FrameError> | null;
  return { code: typeof e?.code === 'string' ? e.code : 'upstream_error', message: e?.message ?? String(error), ...(e?.extra ?? {}) };
}

function json(status: number, body: unknown, headOnly = false): FrameReply {
  const text = Buffer.from(JSON.stringify(body));
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': text.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    body: headOnly ? null : text,
  };
}

function deny(status: number, message: string): FrameReply {
  return { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: Buffer.from(message, 'utf8') };
}

// ---- the agent's actions -------------------------------------------------------------------------------------------

function frameOf(artifact: ArtifactRef): FrameCore {
  const site: unknown = artifact.site;
  if (!(site instanceof FrameCore)) throw new FrameError('not_found', `${artifact.id} is not open here.`, 404);
  return site;
}

/**
 * The type's actions (`/__open-artifact/actions/<name>`): `info` for Artifact `call`,
 * and the hidden `open-artifact.db.*` and `open-artifact.comments.*` that ArtifactData and
 * ArtifactComments use, in the shapes `libraryActions` answers.
 */
export const frameActions: Record<string, ServerAction> = {
  info: {
    title: 'What the artifact holds',
    run: (artifact) => {
      const site = frameOf(artifact);
      const manifest = site.files.manifest();
      return {
        info: {
          type: site.declaration.key,
          contract: CONTRACT,
          capabilities: site.grants,
          ver: manifest.ver,
          brokerGen: site.brokerGen,
          files: Object.entries(manifest.files).map(([p, f]) => ({ path: p, size: f.size })),
          db: site.db.listAll().length,
          assets: site.blobs.list().usage,
          comments: { open: site.comments.openCount() },
        },
      };
    },
  },
  'open-artifact.db.read': { hidden: true, run: (artifact, a) => frameOf(artifact).db.readDb(a.path || undefined, { query: a.query, limit: a.limit, cursor: a.cursor }) },
  'open-artifact.db.write': {
    hidden: true,
    run: (artifact, a) => ({ writes: frameOf(artifact).db.writeDb(Array.isArray(a.writes) ? a.writes : [], { requireIfMatch: a.require_if_match === true }) }),
  },
  'open-artifact.comments.read': {
    hidden: true,
    run: (artifact, a) => ({
      threads: frameOf(artifact)
        .comments.threads({ all: !!a.all })
        .map((t, i) => agentView(t, i + 1)),
      // A thread without `agent` was not sent to the agent: the daemon keeps the agent's replies off it.
      sent_tracked: true,
    }),
  },
  'open-artifact.comments.reply': {
    hidden: true,
    run: (artifact, a) => {
      const site = frameOf(artifact);
      const { thread } = site.comments.addMessage(a.thread_id, { ...AGENT_AUTHOR }, a.text, { resolve: !!a.resolve });
      site.commentsChanged();
      return { thread: agentView(thread) };
    },
  },
  'open-artifact.comments.resolve': {
    hidden: true,
    run: (artifact, a) => {
      const site = frameOf(artifact);
      const thread = site.comments.setResolved(a.thread_id, !a.reopen, { ...AGENT_AUTHOR });
      site.commentsChanged();
      return { thread: agentView(thread) };
    },
  },
};
