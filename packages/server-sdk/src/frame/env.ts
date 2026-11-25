/**
 * What the frame core takes from where it runs ({@link FrameEnv}). The core
 * (core.ts) serves one artifact folder to any number of viewers; everything it
 * needs from its surroundings comes through this interface, so the same core
 * runs as frame-host on this computer (local.ts, {@link localFrameEnv}) and,
 * later, inside a hosted site (a Node server, or a Cloudflare Durable Object
 * whose `node:fs` is a virtual file system).
 *
 * Types and constants only, and no Node-only module: a site imports this file
 * and core.ts, never local.ts.
 */

import type { AgentHook } from '../serve.ts';
import type { TypeApi } from '../daemon.ts';
import type { Declaration } from './declaration.ts';
import type { PathGuard } from './files.ts';
import type { FrameLevel } from './page-values.ts';

export type { FrameLevel } from './page-values.ts';

export type { PathGuard } from './files.ts';

/** The levels in order, lowest first. */
export const FRAME_LEVELS: readonly FrameLevel[] = ['view', 'interact', 'admin', 'owner'];

/** Who one request (or one event connection) comes from. */
export interface FrameViewer {
  /** A stable id: `local` on this computer, the site's user id on a site. */
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  color: string;
  level: FrameLevel;
  /** A visitor without an account (a site's public link). */
  guest: boolean;
  /** Whether this viewer may comment: its own input, not derived from {@link level}. */
  canComment: boolean;
  /**
   * A request that came with the page's read-only token (see {@link FrameEnv.reader}): it may GET this artifact's
   * files and the type's, nothing else. The core refuses it on every route of the inner shell's origin.
   */
  readOnly?: boolean;
}

/** Someone who can reach this artifact, as `user.profiles` / `user.search` may answer about them. */
export interface FramePerson {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  color?: string;
  level: FrameLevel;
}

/**
 * One request as plain data: what a Durable Object or a Node server can both hand over. Header names are lowercase.
 */
export interface FrameRequest {
  method: string;
  /** The path and query: below `Site.page` for the inner shell's requests, as sent for the page's origin. */
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
  /**
   * The body, read when the core asks for it (never before its checks pass). Rejects with a `FrameError`
   * `too_large` (413) past `limit` bytes.
   */
  body(limit: number): Promise<Uint8Array>;
  /** What the environment needs to place the request (local: the `IncomingMessage`); opaque to the core. */
  peer?: unknown;
}

/** A body the core answers with: bytes, or a file of the artifact's storage (read with `node:fs`, or streamed). */
export type FrameBody = Uint8Array | { path: string } | null;

/** One answer as plain data. */
export interface FrameReply {
  status: number;
  headers: Record<string, string | number>;
  /** null: no body (HEAD, 304, a redirect). */
  body: FrameBody;
}

/** The inner shell asked for its event stream: the adapter opens it and calls `FrameCore.connect`. */
export interface FrameEventsAsk {
  events: true;
}

/** A file the core serves: its size, its time (null: no ETag, as for a script built on the fly) and its bytes. */
export interface FrameFile {
  size: number;
  mtimeMs: number | null;
  body: Uint8Array | { path: string };
}

/** Where the inner shell and the page run. */
export interface FrameOrigins {
  /** The inner shell's origin (the capability API's): what the page talks to. */
  shell: string;
  /** Every origin the inner shell may be loaded from (the shell's first). */
  shellOrigins: readonly string[];
  /** The page's own origin. It must differ from every shell origin when the page is restricted (see the mount check). */
  content: string;
  /** The shell page's CSP `connect-src` sources besides `'self'`. */
  connectSrc: readonly string[];
  /** The shell page's CSP `frame-src`: the page origin(s). */
  frameSrc: string;
  /**
   * The outer Shells (origins) the inner shell may speak the chrome protocol with besides a loopback one, when the
   * `open_artifact_shell` parameter names one of them (a site: its app origin). Absent: loopback only.
   */
  outer?: readonly string[];
}

/** The type the artifact is of: its files, read the way the environment keeps them. */
export interface FrameTypeSource {
  /** For messages: where the type is (local: its folder). */
  label: string;
  /** What the type serves now (index.html and artifact-type/), as a short hash: a change rewires open pages. */
  fingerprint(): string;
  /** The declaration in the type's index.html, or null; throws when its block is not literal data. */
  declaration(): Declaration | null;
  /** `artifact-type.json` (the manifest), or `{}`. */
  manifest(): Record<string, unknown>;
  /** The type's index.html, or null. */
  indexHtml(): string | null;
  /** A static file under `artifact-type/` (`rel` starts with it, already cleaned), or null. */
  file(rel: string): FrameFile | null;
}

/** The browser files the core serves itself (`runtime.js`, `imports.js`, `shell.js`, `shell.html`, `shell.css`, `comments.js`, `comments.css`). */
export interface FrameClientFiles {
  /** The file, or null when there is none; throws when a script cannot be made (the message is logged). */
  file(name: string): FrameFile | null;
}

/** What a change watcher reports, as paths relative to the artifact folder or the type folder (`/`-separated). */
export interface FrameWatchHandlers {
  artifact(rel: string): void;
  type(rel: string | null): void;
}

/** The daemon's side, on this computer: the change log and the agent's presence. */
export type FrameDaemon = Pick<TypeApi, 'available' | 'touch' | 'presence'>;

/** Everything {@link FrameCore} takes from where it runs. */
export interface FrameEnv {
  /** Artifact id. */
  id: string;
  /** Artifact title, as the host knows it (may be empty). */
  title: string;
  log(line: string): void;
  origins: FrameOrigins;
  /** The viewer of this request (one of the inner shell's origin). Local: the owner, for every request. */
  viewer(req: FrameRequest): FrameViewer;
  /**
   * The viewer of a request to the page's origin (`/_f/<ver>/…`, `/_blob/<id>`, `/_runtime/…`, `/`), resolved from
   * the page's own read-only token, never the viewer's page token; the core treats it as read-only whatever it says.
   * null: refused (403). Local: the owner (the page's address carries no token on this computer).
   */
  reader(req: FrameRequest): FrameViewer | null;
  /**
   * The page's origin for one viewer (`scheme://host[:port]`, no path), what the inner shell frames and posts to
   * (`session.contentOrigin`). A site carries the read-only token in it, as a host label (`rt-<token>.pages.…`), and
   * resolves {@link reader} from the `Host`: the page's own addresses are root-relative (`/_runtime/…`, `/_blob/<id>`,
   * the `/` redirect), so a token in a path would be lost on them. Never the viewer's page token. It must not be an
   * origin the inner shell runs on (the session refuses one, as the mount does), and `origins.frameSrc` must cover it.
   * Local: `origins.content`.
   */
  pageOrigin(viewer: FrameViewer): string;
  /**
   * The people who can reach this artifact (its owner, collaborators, …): all that `user.profiles` and `user.search`
   * answer about. Local: the owner alone.
   */
  people(): readonly FramePerson[] | Promise<readonly FramePerson[]>;
  /**
   * Whether the declaration's `user` scopes withhold identity from the page (a site: true, as the contract says): a
   * name and avatar only under `profile`, an email only under `email`, a room sender's id only when `user` is
   * declared, `user.search` over {@link people}, and an event's `from` only for a connection of the viewer's own.
   * Local: false, as before: one person on their own computer, whose page is told its name and never an email,
   * whose search finds no one, and whose client ids are taken as given.
   */
  withholdIdentity: boolean;
  /**
   * Whether a request may come in at all. Local: from this computer (loopback). A site: a token it already
   * verified. The core then checks the inner shell's own origin itself.
   */
  admit(req: FrameRequest): boolean;
  type: FrameTypeSource;
  client: FrameClientFiles;
  /**
   * Starts watching for writes that did not go through the core (local: `fs.watch` on both folders, for the agent's
   * edits). null: no watcher (a site): every write goes through the core, which sends the events itself, and a write
   * the host makes on its own is handed in with `FrameCore.noteChanges`.
   */
  watch: ((on: FrameWatchHandlers) => { close(): void }) | null;
  /** Whether the type's page is restricted (CSP + `sandbox`). A site always says yes. */
  restricted: boolean;
  /** Sent on every response of the page's origin; null: none. */
  contentSecurityPolicy: string | null;
  /** External origins the host granted to this type. Omitting the grant exposes an empty list to the page. */
  allowedNetworkOrigins?: readonly string[];
  /** Page mode: the page is the artifact's own index.html, its capabilities the ones `.artifact.json` declares. */
  page: boolean;
  /** How the stores keep inside the artifact folder: local follows links; a virtual file system has none. */
  guard: PathGuard;
  /** Whether pages relay their console errors (`OPEN_ARTIFACT_FRAME_DEBUG` locally). */
  debug(): boolean;
  /** The daemon (this computer), or null. */
  daemon: FrameDaemon | null;
  /** Wakes the owner's session. */
  agentHook: AgentHook;
  agentName?: string;
  agentWakesIdle?: boolean;
}
