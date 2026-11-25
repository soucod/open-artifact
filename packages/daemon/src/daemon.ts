/**
 * The `open-artifact` daemon: one per user (per `OPEN_ARTIFACT_HOME`). On one loopback port it
 * serves the Shell (`/a/<id>`), the home page (`/`), their built assets
 * (`/_open-artifact/shell/*`, `/_open-artifact/home/*`), static entries on per-artifact origins
 * (`<id>.frame.localhost:<port>`), the Library API (`/api/open-artifact.*`), the Type
 * API (`/api/open-artifact.type.*`), the HTTP polling API, MCP (`POST /mcp`) and the
 * Harness API (WebSocket `/__harness`); and it starts the type servers that
 * serve every other page.
 */

import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFileSync, cpSync, createReadStream, existsSync, openSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync, writeSync, closeSync, type Dirent, type FSWatcher } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { userInfo } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { Readable, type Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  DATA_REFRESH_ACTION,
  HARNESS_PATH,
  HARNESS_SUBPROTOCOL,
  LIBRARY_ROUTES,
  OpenArtifactError,
  SHELL_FRAME_NAME,
  SHELL_PARAMS,
  TYPE_API_ROUTES,
  RESTRICTED_FRAME_SANDBOX,
  TYPE_SERVER_ROUTES,
  artifactIdOf,
  installedTypeCsp,
  restrictedTypeNotice,
  artifactUrl,
  errorBody,
  shellPath,
  taskMessage,
  type ArtifactDetail,
  type ArtifactRecord,
  type ArtifactView,
  type AskRequest,
  type CreateArtifactRequest,
  type DaemonHealth,
  type DataRefreshResult,
  type DaemonState,
  type LibraryEvent,
  type OpenArtifactSettings,
  type ResolvedEntry,
  type SessionRef,
  type ShareRequest,
  type ShareView,
  type ShellBoot,
  type TypeApiArtifact,
  type TypeApiEvent,
  type TypeApiPresence,
  type TypeApiTask,
  type TypeApiWakeRequest,
  type TypeApiWakeResult,
  type TypesProject,
  type TypesResponse,
  type EmbedResponse,
  type TypeView,
  type UpdateArtifactRequest,
  type WakeRequestItem,
  type WakeStatus,
  type WakeThread,
  type TypePackagePreview,
  type SiteTypeVisibility,
  SITE_TYPE_VISIBILITIES,
} from '@open-artifact/protocol';
import { archiveEntries, sendArchive as sendFolderArchive, zipBytes } from '@open-artifact/server-sdk/zip';
import { DATA_TYPE, DataRefresher } from './data-refresh.ts';
import { HarnessHub, systemBrowse, type PollParams } from './harness.ts';
import { embedOrigins, remoteOf, type ViewSink } from './harness-embed.ts';
import { Inbox } from './inbox.ts';
import { LinkHub } from './link.ts';
import { callerFromRequest, handleMcp, uiFromRequest, type McpMessage, type McpReply } from './mcp.ts';
import { nudgeSession } from './nudge.ts';
import { Ownership } from './ownership.ts';
import { ensureDir, expandHome, files, inside, openArtifactHome, readJson, realInside, writeJson } from './paths.ts';
import { ACTION_CALL_MS, TypeServers } from './servers.ts';
import { badModeVariable, nodeChildren } from './node-children.ts';
import { readPreset, type CloudPreset } from './preset.ts';
import { ReleaseGuard, releaseView, writeMarkerRelease } from './release-guard.ts';
import { ARTIFACT_IMPORT_LIMITS, readArtifactArchive, unpackArtifactArchive } from './artifact-import.ts';
import {
  PACKAGE_DOWNLOAD_MAX,
  fetchTypePackage,
  installTypePackage,
  isAddress,
  loadTypePackage,
  readTypePackage,
  stagePackage,
  stagedPackage,
  typeCapabilities,
  typeMismatch,
  typeSourceOf,
  uninstallType,
  unstagePackage,
  updateSource,
  packTypeBytes,
} from './type-packages.ts';
import { RuntimeManager } from './runtime.ts';
import { remoteArchiveBytes, remoteErrorBody } from './remote-archive.ts';
import { ownRuntime } from './client.ts';
import { startDaemonProcess } from '@open-artifact/harness-kit';
import { loadSettings, saveCloudSettings } from './settings.ts';
import { ArtifactStore, sessionKeyOf, userEditsAfter, type StoreChange } from './store.ts';
import { Tools, type ShareAccess } from './tools.ts';
import { BUILTIN_TYPE_IDS, TypeRegistry, isBuiltinPage, isSiteKindType, siteRefusal, typeLocation, type ListedType, type TypeInfo } from './types.ts';
import { checkType, newType, setProjectTrusted, setTypeEnabled, typeFromPage, typeFromSaved } from './type-authoring.ts';
import { WakeRouter, type WakeResult } from './wake.ts';
import { acceptWebSocket } from './ws.ts';
import pkg from '../package.json' with { type: 'json' };

/** How long a dashboard's live-data refresh may take on its type server, ms (every live query, one by one). */
const DATA_REFRESH_MS = 15 * 60_000;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The daemon's version (its package version). Imported, not read from disk,
 * so a bundled daemon (the DSH plugin's vendor/open-artifact.mjs) keeps its own version.
 */
export const VERSION: string = (pkg as { version?: string }).version ?? '0.0.0';

/**
 * Where the built Shell or home app lives: `$OPEN_ARTIFACT_SHELL_DIR` / `$OPEN_ARTIFACT_HOME_DIR`,
 * else `<repo>/dist/daemon/<name>` resolved from this module's location.
 */
export function defaultUiDir(name: 'shell' | 'home'): string {
  const fromEnv = name === 'shell' ? process.env.OPEN_ARTIFACT_SHELL_DIR : process.env.OPEN_ARTIFACT_HOME_DIR;
  return fromEnv ? resolve(fromEnv) : resolve(here, '..', '..', '..', 'dist', 'daemon', name);
}

/** The placeholder in the Shell's `index.html` that the boot object replaces. */
export const BOOT_PLACEHOLDER = '/*__OPEN_ARTIFACT_BOOT__*/null';

/** Base paths of the built apps (their Vite `base`). */
export const UI_PATHS = { shell: '/_open-artifact/shell/', home: '/_open-artifact/home/' } as const;

const PAGE_IDLE_MS = Number(process.env.OPEN_ARTIFACT_PAGE_IDLE_MS ?? 15 * 60_000);
/** How long a long action may run before its end is no longer delivered. */
const TASK_TTL_MS = 24 * 60 * 60_000;
/** After an agent's write action answers, page writes within this long are still the agent's. */
const ACTING_GRACE_MS = Number(process.env.OPEN_ARTIFACT_ACTING_GRACE_MS ?? 3_000);
/** `open: "after_first_write"`: how often to look for the content, how long to let it settle, and when to give up. */
const OPEN_POLL_MS = 1_000;
const OPEN_SETTLE_MS = 1_500;
const OPEN_GIVE_UP_MS = 30 * 60_000;
/**
 * The Shell's page (`GET /a/<id>`) starts opening the artifact's page and answers at once; its boot request
 * (`artifacts.boot`) takes that open's result when it settled no longer than this ago.
 */
const BOOT_REUSE_MS = 10_000;

/** A long action the agent started: its end goes to the caller. */
interface StartedTask {
  artifactId: string;
  action: string;
  caller: SessionRef;
  write: boolean;
  at: number;
}

/** Whether a file under an artifact's root is content (not a marker, agent state, a blob or the version history). */
function isContentPath(rel: string): boolean {
  const parts = rel.split('/');
  return !!rel && !parts.some((part) => part.startsWith('.')) && parts[0] !== '_agent' && parts[0] !== '_blobs' && parts[0] !== 'history';
}

/** Whether the folder holds any content file (looks a few levels deep). */
function hasContent(root: string, rel = '', depth = 0): boolean {
  if (depth > 4) return false;
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries.slice(0, 500)) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (!isContentPath(path)) continue;
    if (entry.isFile()) return true;
    if (entry.isDirectory() && hasContent(root, path, depth + 1)) return true;
  }
  return false;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

/** A static entry's own origin: `http://<artifact id>.frame.localhost:<port>`. */
const FRAME_HOST = /^(art_[0-9a-z]+)\.frame\.localhost:(\d+)$/;

/** `GET /api/open-artifact.type.icon?id=`: a type's icon, for the home page (not the Type API, despite its prefix). */
const TYPE_ICON_ROUTE = 'type.icon';

const contentType = (file: string): string => CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

function sendHtml(res: ServerResponse, html: string, contentSecurityPolicy: string | null = null): void {
  res
    .writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(contentSecurityPolicy ? { 'Content-Security-Policy': contentSecurityPolicy } : {}),
    })
    .end(html);
}

/** A static type of an untrusted root (installed, or a project not trusted yet): its page is framed by the Shell. */
const restrictedStatic = (type: { trusted: boolean; entry: { kind: string } | null } | null | undefined): boolean => !!type && !type.trusted && type.entry?.kind === 'static';

function readBody(req: IncomingMessage, limit = 4 << 20): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        rejectBody(new OpenArtifactError('too_large', 'The request body is too large.', { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<Partial<T>> {
  const buffer = await readBody(req);
  if (!buffer.length) return {};
  try {
    const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
  } catch {
    throw new OpenArtifactError('invalid_argument', 'The body is not JSON.');
  }
}

/** The first language the browser asks for, as a `{lang}` placeholder takes it. */
const langOf = (req: IncomingMessage | undefined): string | undefined =>
  String(req?.headers['accept-language'] ?? '').split(',')[0]!.split(';')[0]!.trim() || undefined;

const isLoopback = (address: string | undefined): boolean => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** JSON safe to put inside a `<script>`. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Whether `.sharing.json` in an artifact folder says it is shared on the network (the type server writes it). */
function sharedOnLan(root: string): boolean {
  return readJson<{ lan?: boolean } | null>(join(root, '.sharing.json'), null)?.lan === true;
}

function safeUserName(): string {
  try {
    return userInfo().username || 'You';
  } catch {
    return 'You';
  }
}

/** HTTP status of a failure. */
function statusOf(error: unknown): number {
  if (error instanceof OpenArtifactError && error.status) return error.status;
  const { code } = errorBody(error);
  switch (code) {
    case 'not_found':
    case 'unknown_session':
      return 404;
    case 'unauthorized':
      return 401;
    case 'not_granted':
      return 403;
    case 'unsupported':
    case 'conflict':
      return 409;
    case 'too_large':
      return 413;
    case 'rate_limited':
      return 429;
    case 'server_failed':
      return 502;
    default:
      return 400;
  }
}

function listenOn(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      resolveListen(typeof address === 'object' && address ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** The prompt that hands an empty artifact to an agent. */
export function takeOverPrompt(record: Pick<ArtifactRecord, 'id' | 'title' | 'root'>, typeTitle: string): string {
  const url = artifactUrl(record.id);
  return `Take over artifact ${url} (${typeTitle} "${record.title}", folder ${record.root}): call Artifact {action: "adopt", url: "${url}"} for the type's instructions, then build it as they say.`;
}

/** The Shell used when the built one is missing: the artifact page, framed full-screen. */
const FALLBACK_SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Artifact</title>
<style>
  html, body { margin: 0; height: 100%; background: #fff; color: #222; font: 14px/1.5 system-ui, sans-serif; }
  iframe { display: block; border: 0; width: 100%; height: 100%; }
  .note { max-width: 640px; margin: 64px auto; padding: 0 24px; }
  pre { white-space: pre-wrap; background: #f4f4f4; padding: 12px; border-radius: 6px; }
  @media (prefers-color-scheme: dark) { html, body { background: #161616; color: #ddd; } pre { background: #222; } }
</style>
<script>window.__OPEN_ARTIFACT_BOOT__ = ${BOOT_PLACEHOLDER};</script>
</head>
<body>
<script>
(() => {
  const boot = window.__OPEN_ARTIFACT_BOOT__;
  document.title = boot.title;
  if (boot.page) {
    const at = new URL(boot.page, location.href);
    at.searchParams.set(${JSON.stringify(SHELL_PARAMS.shell)}, location.origin);
    at.searchParams.set(${JSON.stringify(SHELL_PARAMS.id)}, boot.id);
    const frame = document.createElement('iframe');
    frame.name = ${JSON.stringify(SHELL_FRAME_NAME)};
    frame.allow = 'clipboard-read; clipboard-write; fullscreen';
    // A restricted static type's page (installed, or a project not trusted yet): no popups, no top navigation.
    if (boot.pageKind === 'static' && boot.sandbox) frame.setAttribute('sandbox', boot.sandbox);
    frame.src = at.href;
    document.body.append(frame);
    return;
  }
  const note = document.createElement('div');
  note.className = 'note';
  const h = document.createElement('h1');
  h.textContent = boot.title;
  note.append(h);
  const p = document.createElement('p');
  p.textContent = boot.empty ? 'Nothing is written yet. Hand it to an agent with this prompt:' : (boot.problem || 'The page could not be opened.');
  note.append(p);
  if (boot.prompt) {
    const pre = document.createElement('pre');
    pre.textContent = boot.prompt;
    note.append(pre);
  }
  document.body.append(note);
})();
</script>
</body>
</html>
`;

/** Options of {@link Daemon}. */
export interface DaemonOptions {
  /** Port to listen on; `0` picks one. Default: settings `serverPort` (the next free one when taken). */
  port?: number;
  /** Exit after this long with nothing connected, ms; `0` never. Default `$OPEN_ARTIFACT_IDLE_MS`, else 30 min. */
  idleMs?: number;
  /** No log lines on stderr. */
  quiet?: boolean;
  /** The built Shell (`index.html` and assets). Default {@link defaultUiDir}`('shell')`. */
  shellDir?: string;
  /** The built home page. Default {@link defaultUiDir}`('home')`. */
  homeDir?: string;
  /** The built-in type root; `null` turns it off. Default: the repository's `artifact-types/`. */
  builtinTypesDir?: string | null;
  /**
   * Opens a page in this computer's browser, for harnesses whose profile says `open: "browser"`; `null` never does.
   * Default {@link systemBrowse}.
   */
  browse?: ((url: string) => boolean) | null;
}

/** A resolved artifact page. */
interface OpenPage {
  kind: ResolvedEntry['kind'];
  /** What the Shell frames (absolute). */
  page: string;
  page_url: string;
  lastUsed: number;
}

/** What opening an artifact's page for the Shell came to. */
interface ShellOpen {
  page: Omit<OpenPage, 'lastUsed'> | null;
  /** Why it could not open. */
  problem: string | null;
}

/** An open for the Shell: in flight, or settled at `at`; `taken` once a boot request has had it. */
interface ShellOpening {
  done: Promise<ShellOpen>;
  at: number | null;
  taken: boolean;
}

interface TypeEventClient {
  res: ServerResponse;
  typeId: string;
  ids: Set<string>;
}

/** The daemon. Emits `exit` when it closes itself (idle). */
export class Daemon extends EventEmitter<{ exit: [] }> {
  /** The listening port, once started. */
  port = 0;
  /** Bearer token of the Library and Harness APIs and MCP. */
  readonly token = randomBytes(24).toString('base64url');
  settings: OpenArtifactSettings;
  /** Install-time cloud presets (environment, `preset.json`), read once at construction. */
  private readonly preset: CloudPreset;
  readonly types: TypeRegistry;
  readonly store: ArtifactStore;
  readonly inbox: Inbox;
  readonly wake: WakeRouter;
  readonly servers: TypeServers;
  readonly tools: Tools;
  readonly harnesses: HarnessHub;
  /** Cloud remotes and the sync of what is published to them. */
  readonly link: LinkHub;
  /** Live data of published dashboards: the snapshots this computer takes for their hosts. */
  readonly data: DataRefresher;
  /** The runtimes on this computer and updates (`runtime.ts`). */
  readonly runtime: RuntimeManager;
  /** Tool calls running now (a runtime switch waits for none). */
  private toolCalls = 0;
  readonly shellDir: string;
  readonly homeDir: string;
  readonly server: Server;

  private readonly wantPort: number;
  private readonly idleMs: number;
  private readonly quiet: boolean;
  private readonly logFile: string;
  private readonly eventClients = new Set<ServerResponse>();
  private readonly typeEventClients = new Set<TypeEventClient>();
  private readonly typeTokens = new Map<string, string>();
  private readonly tokenTypes = new Map<string, string>();
  private readonly pages = new Map<string, OpenPage>();
  /** Opens for the Shell by artifact id: one in flight per artifact, kept {@link BOOT_REUSE_MS} once settled. */
  private readonly shellOpens = new Map<string, ShellOpening>();
  private readonly watchers = new Map<string, { watcher: FSWatcher; stop: () => void }>();
  private readonly contentStamps = new Map<string, { at: number; value: string }>();
  /** Long actions the agent started, by `<type>:<task>`. */
  private readonly tasks = new Map<string, StartedTask>();
  /** Ends that came before their start was known (a quick task), by `<type>:<task>`. */
  private readonly earlyEnds = new Map<string, { body: TypeApiTask; at: number }>();
  /** Write actions of the agent running on an artifact, and until when their page writes count as the agent's. */
  private readonly acting = new Map<string, { running: number; until: number }>();
  /** Pages waiting for the agent's first write, by artifact id: stops the wait. */
  private readonly pendingOpens = new Map<string, () => void>();
  private hosts = new Set<string>();
  private lastActivity = Date.now();
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(options: DaemonOptions = {}) {
    super();
    ensureDir(openArtifactHome(), 0o700);
    ensureDir(files.logs());
    this.preset = readPreset();
    this.settings = loadSettings(this.preset);
    this.wantPort = options.port ?? this.settings.serverPort;
    this.idleMs = options.idleMs ?? Number(process.env.OPEN_ARTIFACT_IDLE_MS ?? 30 * 60_000);
    this.quiet = options.quiet ?? false;
    this.shellDir = resolve(options.shellDir ?? defaultUiDir('shell'));
    this.homeDir = resolve(options.homeDir ?? defaultUiDir('home'));
    this.logFile = files.daemonLog();
    const log = (line: string): void => this.log(line);
    this.types = new TypeRegistry(() => this.settings, options.builtinTypesDir !== undefined ? { builtinDir: options.builtinTypesDir } : {});
    this.store = new ArtifactStore();
    this.inbox = new Inbox();
    this.wake = new WakeRouter({
      store: this.store,
      inbox: this.inbox,
      live: () => this.harnesses,
      viewUrl: (id) => this.viewUrl(id),
      log,
      emit: (event) => this.broadcast(event),
      nudge: (target, payload) => void nudgeSession(target, payload.artifact, { log }),
    });
    this.servers = new TypeServers({ daemonUrl: () => this.origin, tokenFor: (typeId) => this.typeToken(typeId), log, changed: () => this.harnesses?.embed.originsChanged() });
    const browse = options.browse === undefined ? systemBrowse : options.browse;
    this.link = new LinkHub({
      store: this.store,
      inbox: this.inbox,
      settings: () => this.settings,
      wake: (id, item) => this.wake.queue(id, item),
      archive: (record) => this.archiveBytes(record),
      browse,
      log,
      version: VERSION,
      saveCloud: (patch) => {
        saveCloudSettings(patch);
        this.settings = loadSettings(this.preset);
      },
      insecureHttp: () => this.preset.insecureHttp === true,
      localOnly: (record) => siteRefusal(this.types.get(record.type, record.owner?.workspace ?? undefined)),
      needsPages: (record) => isBuiltinPage(this.types.get(record.type, record.owner?.workspace ?? undefined)),
      siteType: (record) => {
        const type = this.types.get(record.type, record.owner?.workspace ?? undefined);
        return type && isSiteKindType(type) ? type : null;
      },
      packType: (type, workspace) => packTypeBytes(type.dir, { settings: this.settings, registry: this.types, workspace: workspace ?? this.settings.homeWorkspace }),
      data: {
        published: (id) => this.data.published(id),
        requested: (id, queries) => void this.data.refresh(id, { ...(queries ? { queries } : {}), reason: 'asked from the host' }),
        unpublished: (record) => void this.data.unpublished(record),
      },
    });
    this.data = new DataRefresher({
      store: this.store,
      settings: () => this.settings,
      run: async (record, args) => {
        const type = this.typeOf(record);
        if (!type) throw new OpenArtifactError('not_found', `The type ${record.type} is not installed.`);
        return this.servers.call<DataRefreshResult>(type, 'POST', `${TYPE_SERVER_ROUTES.actions}${encodeURIComponent(DATA_REFRESH_ACTION)}`, { id: record.id, root: record.root, args }, undefined, DATA_REFRESH_MS);
      },
      sync: (id) => this.link.syncNow(id),
      owner: (record) => this.link.ownerName(record),
      log,
    });
    this.tools = new Tools({
      types: this.types,
      store: this.store,
      inbox: this.inbox,
      harnesses: () => this.harnesses,
      settings: () => this.settings,
      viewUrl: (id) => this.viewUrl(id),
      openPage: (record) => this.openPage(record),
      reopenPage: (record) => this.reopenPage(record),
      reach: (type) => this.servers.reach(type),
      typeAction: (type, record, name, args) =>
        this.servers.call(type, 'POST', `${TYPE_SERVER_ROUTES.actions}${encodeURIComponent(name)}`, { id: record.id, root: record.root, args }, undefined, ACTION_CALL_MS),
      typeActions: (type, options) => this.servers.actions(type, options),
      shareOf: (record) => this.shareOf(record),
      log,
      taskStarted: ({ record, type, task, action, effect, caller }) => this.taskStarted(type.id, task, { artifactId: record.id, action, caller, write: effect === 'write', at: Date.now() }),
      agentActing: (id, phase) => this.agentActing(id, phase),
      openAfterFirstWrite: (record, caller) => this.openAfterFirstWrite(record, caller),
      cancelOpenAfterFirstWrite: (id) => this.pendingOpens.get(id)?.(),
      link: this.link,
      ownership: new Ownership({ store: this.store, hub: () => this.harnesses ?? null, log }),
    });
    this.guardToolCalls();
    this.runtime = new RuntimeManager({
      version: VERSION,
      own: ownRuntime(),
      log,
      // Not to an adapter that said `bundled`: it updates its own runtime.
      broadcast: (event, skip) => {
        for (const conn of this.harnesses?.connections ?? []) if (conn.authed && conn.subscribed && !(conn.harness && skip.has(conn.harness))) conn.notify('event', event);
      },
      idle: () => this.idleForSwitch(),
      connected: () => [...new Set([...this.harnesses.connections].filter((c) => c.authed && c.harness).map((c) => c.harness!))],
      switchTo: (candidate, env) => {
        this.close(`leaving for runtime ${candidate.version}`);
        // A daemon inside an Electron process (Node children in threads) leaves the new runtime to the app that started
        // this one: its harness reconnects and the kit starts the newest. Spawning its executable here would start the
        // app, not a daemon.
        const choice = nodeChildren();
        if (choice.mode === 'threads' && process.versions.electron) this.log(`runtime: leaving for ${candidate.version}; the app that started this daemon starts it (${choice.detail})`);
        else startDaemonProcess(candidate.bin, { env });
        this.emit('exit');
      },
      ...(process.env.OPEN_ARTIFACT_RUNTIME_CHECK_DELAY_MS ? { checkDelayMs: Number(process.env.OPEN_ARTIFACT_RUNTIME_CHECK_DELAY_MS) } : {}),
    });
    this.harnesses = new HarnessHub({
      runtime: this.runtime,
      token: this.token,
      version: VERSION,
      tools: this.tools,
      inbox: this.inbox,
      log,
      browse,
      openArtifact: async (url, caller) => {
        const result = await this.tools.call('Artifact', { action: 'open', url }, caller);
        if (result.error) throw new OpenArtifactError(result.error.code, result.error.message);
        return { opened: !!result.opened, ...(typeof result.view_url === 'string' ? { view_url: result.view_url } : {}) };
      },
    });
    this.harnesses.on('changed', () => this.broadcast({ type: 'harness/changed' }));
    this.configureEmbedding();
    this.store.on('changed', (record: StoreChange) => {
      if (record.removed) this.closePage(record);
      this.broadcast({ type: 'artifacts/changed', id: record.id, ...(record.removed ? { removed: true } : {}) });
    });
    this.types.on('changed', () => {
      this.servers.typesChanged(
        (id, old) =>
          this.types.scanRoot({ root: old.root, scope: old.scope, trusted: old.trusted, ...(old.scope === 'installed' ? { deny: BUILTIN_TYPE_IDS } : {}) }).find((t) => t.id === id) ?? null,
      );
      this.broadcast({ type: 'types/changed' });
      this.harnesses.embed.originsChanged();
    });
    this.server = createServer((req, res) => {
      this.onRequest(req, res).catch((error: unknown) => {
        this.log(`request ${req.method} ${req.url} failed: ${(error as Error)?.stack ?? error}`);
        if (!res.headersSent) sendJson(res, 500, { code: 'error', message: 'internal error' });
        else res.destroy();
      });
    });
    this.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.onUpgrade(req, socket, head));
  }

  /** Appends a line to the daemon log (and stderr with `OPEN_ARTIFACT_LOG_STDERR=1`). */
  log(line: string): void {
    const text = `[${new Date().toISOString()}] ${line}\n`;
    try {
      appendFileSync(this.logFile, text);
    } catch {
      /* nowhere to log */
    }
    if (!this.quiet && process.env.OPEN_ARTIFACT_LOG_STDERR === '1') process.stderr.write(text);
  }

  /** The daemon's base URL. */
  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** The Shell address of an artifact: its cloud address once it is published. */
  viewUrl(id: string): string {
    return this.store.get(id)?.remote?.url ?? `${this.origin}/a/${id}`;
  }

  /** Embedding and view context (`harness-embed.ts`, `harness-view.ts`): where their answers come from. */
  private configureEmbedding(): void {
    this.harnesses.embed.setOrigins(() =>
      embedOrigins({
        daemon: this.origin,
        port: this.port,
        // Every installed, enabled type (any workspace's are not known here: the global and built-in ones).
        types: this.types.list().filter((t) => t.enabled).map((t) => ({ id: t.id, entry: t.entry })),
        running: this.servers.running(),
      }),
    );
    // A view loads the local Shell, also for a published artifact.
    this.harnesses.embed.setShellUrl((id) => `${this.origin}/a/${id}`);
    // An artifact of a remote type: host.open says where its page comes from, for the host to decide.
    this.harnesses.embed.setRemoteOf((id) => {
      const record = this.store.get(id);
      return record ? remoteOf(this.typeOf(record), this.pages.get(id)?.page) : null;
    });
    this.harnesses.contexts.configure({
      record: (url) => this.store.require(url),
      // The agent's way to the type's `context` action: its host for a published artifact, else its server.
      context: async (view) => {
        const record = this.store.require(view.id);
        const type = this.typeOf(record);
        if (!type?.entry || type.entry.kind === 'static' || !type.entry.actions) return null;
        if (this.link.forwards(record, type, 'context')) return this.link.call(record, 'context', {}, 'read');
        const actions = await this.servers.actions(type, { start: true });
        if (!actions?.some((a) => a.name === 'context')) return null;
        await this.openPage(record);
        return this.servers.call(type, 'POST', `${TYPE_SERVER_ROUTES.actions}context`, { id: record.id, root: record.root, args: {} }, undefined, ACTION_CALL_MS);
      },
    });
  }

  /**
   * `GET /api/open-artifact.view?view=&id=[&key=]`: the Shell of a top-level view claims its ticket (or comes back with
   * its key) and gets the host's commands as an event stream, the first event (`view`) carrying its key. `POST {view,
   * key, event}`: what the Shell says to its host, on to the adapter. Only pages of this origin.
   */
  private async viewChannel(req: IncomingMessage, res: ServerResponse, url: URL, get: boolean): Promise<void> {
    const site = req.headers['sec-fetch-site'];
    if (!this.originOk(req) || (site !== undefined && site !== 'same-origin')) throw new OpenArtifactError('not_granted', 'Only the Shell of this daemon opens a view.', { status: 403 });
    if (!get) {
      const body = await readJsonBody<{ view?: unknown; key?: unknown; event?: unknown }>(req);
      return sendJson(res, 200, this.harnesses.embed.event(String(body.view ?? ''), String(body.key ?? ''), body.event));
    }
    const id = artifactIdOf(String(url.searchParams.get('id') ?? ''));
    const view = String(url.searchParams.get('view') ?? '');
    // Commands the claim hands over at once wait for the stream's head.
    let started = false;
    const early: string[] = [];
    const write = (chunk: string): void => {
      if (started) res.write(chunk);
      else early.push(chunk);
    };
    const sink: ViewSink = {
      send: (command) => write(`event: command\ndata: ${JSON.stringify(command)}\n\n`),
      end: () => res.end(),
    };
    // Throws not_found (an unknown, used or expired ticket, another artifact's, a wrong key) before the stream starts.
    const claimed = this.harnesses.embed.claim(view, id ?? '', url.searchParams.get('key') || null, sink);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: view\ndata: ${JSON.stringify({ view, key: claimed.key, session: claimed.session })}\n\n`);
    started = true;
    for (const chunk of early.splice(0)) res.write(chunk);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    ping.unref?.();
    res.on('close', () => {
      clearInterval(ping);
      this.harnesses.embed.detach(view, sink);
    });
  }

  private typeOf(record: ArtifactRecord): ListedType | null {
    return this.types.get(record.type, record.owner?.workspace ?? undefined);
  }

  private agentNameOf(record: ArtifactRecord): string {
    return this.harnesses.agentNameOf(record.owner?.harness);
  }

  /** Listens, takes the lock and writes `daemon.json`. */
  async start(): Promise<this> {
    ensureDir(openArtifactHome());
    // One daemon per OPEN_ARTIFACT_HOME: the lock holds this process's pid.
    const lock = files.lock();
    try {
      const fd = openSync(lock, 'wx', 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
    } catch {
      const other = Number(readFileSync(lock, 'utf8'));
      let alive = false;
      try {
        process.kill(other, 0);
        alive = other !== process.pid;
      } catch {
        alive = false;
      }
      if (alive) throw new OpenArtifactError('conflict', `Another open-artifact daemon (pid ${other}) runs for ${openArtifactHome()}.`);
      writeFileSync(lock, String(process.pid), { mode: 0o600 });
    }
    let port = this.wantPort;
    for (let i = 0; ; i++) {
      try {
        this.port = await listenOn(this.server, port, '127.0.0.1');
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || i >= 20 || port === 0) {
          rmSync(lock, { force: true });
          throw error;
        }
        port += 1;
      }
    }
    this.hosts = new Set([`127.0.0.1:${this.port}`, `localhost:${this.port}`, `[::1]:${this.port}`]);
    const state: DaemonState = { url: this.origin, port: this.port, pid: process.pid, token: this.token, version: VERSION, startedAt: new Date().toISOString() };
    writeJson(files.daemon(), state, 0o600);
    this.timer = setInterval(() => this.tick(), 30_000);
    this.timer.unref?.();
    this.log(`daemon ${VERSION} listening at ${this.origin} (home ${openArtifactHome()})`);
    const badChildren = badModeVariable();
    if (badChildren) this.log(badChildren);
    try {
      this.runtime.start();
    } catch (error) {
      this.log(`runtime: registering this runtime failed: ${(error as Error)?.message ?? error}`);
    }
    // Links handed out before a restart keep working: open what is shared again.
    void this.remountShared();
    // Published artifacts sync again, and each remote's events come in (nothing without a remote).
    this.link.start(this.preset);
    this.data.start();
    return this;
  }

  private async remountShared(): Promise<void> {
    for (const record of this.store.list()) {
      if (!sharedOnLan(record.root)) continue;
      try {
        await this.openPage(record);
      } catch (error) {
        this.log(`sharing: could not open ${record.id} again: ${(error as Error)?.message ?? error}`);
      }
    }
  }

  /** A long action answered `{task, pending: true}`: remembers who gets its end. */
  private taskStarted(typeId: string, task: string, started: StartedTask): void {
    const key = `${typeId}:${task}`;
    this.tasks.set(key, started);
    if (started.write) this.agentActing(started.artifactId, 'start');
    const early = this.earlyEnds.get(key);
    if (early) {
      this.earlyEnds.delete(key);
      this.taskEnded(typeId, early.body);
    }
  }

  /** A long action ended: its result goes to the caller that started it, live or into its inbox. */
  private taskEnded(typeId: string, body: TypeApiTask): void {
    const key = `${typeId}:${body.task}`;
    const started = this.tasks.get(key);
    if (!started) {
      // The end may come before the action's answer reached Tools: keep it a while.
      this.earlyEnds.set(key, { body, at: Date.now() });
      return;
    }
    this.tasks.delete(key);
    if (started.write) this.agentActing(started.artifactId, 'end');
    const record = this.store.get(started.artifactId);
    if (!record) return;
    const message = taskMessage(
      record,
      { task: body.task, action: started.action, ...(body.error !== undefined && body.error !== null ? { error: body.error } : { result: body.result ?? null }) },
      { viewUrl: this.viewUrl(record.id) },
    );
    void this.wake
      .send(started.caller, { artifact: artifactUrl(record.id), artifactId: record.id, text: message.text, source: message.source })
      .catch((error: unknown) => this.log(`task ${body.task} of ${record.id}: delivery failed: ${(error as Error)?.message ?? error}`));
  }

  /** The agent's write action on an artifact starts or answers. */
  private agentActing(id: string, phase: 'start' | 'end'): void {
    const now = Date.now();
    const entry = this.acting.get(id) ?? { running: 0, until: 0 };
    if (phase === 'start') entry.running += 1;
    else {
      entry.running = Math.max(0, entry.running - 1);
      entry.until = now + ACTING_GRACE_MS;
    }
    this.acting.set(id, entry);
  }

  /**
   * Every tool call (MCP, the Harness API, the Library API) goes through the release check (`release-guard.ts`) and is
   * counted while it runs, so a runtime switch never cuts one off.
   */
  private guardToolCalls(): void {
    const call = this.tools.call.bind(this.tools);
    const guard = new ReleaseGuard({
      record: (urlOrId) => {
        try {
          return this.store.require(urlOrId);
        } catch {
          return null;
        }
      },
      typeVersion: (record) => this.typeOf(record)?.version ?? null,
      setRelease: (record, release) => {
        this.store.update(record.id, { typeRelease: release, updatedAt: record.updatedAt });
        writeMarkerRelease(record, release);
      },
      typeMismatch: (record) => {
        const refusal = typeMismatch(record, this.typeOf(record));
        return refusal ? { code: refusal.code, message: refusal.message, ...(refusal.fix ? { fix: refusal.fix } : {}) } : null;
      },
    });
    this.tools.call = async (name, args, caller) => {
      this.toolCalls += 1;
      try {
        return await guard.call(name, args, caller, call);
      } finally {
        this.toolCalls -= 1;
      }
    };
  }

  /** Nothing a runtime switch would cut off: no open page, no tool call, long action or agent write running. */
  private idleForSwitch(): boolean {
    if (this.closed || this.pages.size > 0 || this.toolCalls > 0 || this.tasks.size > 0) return false;
    for (const entry of this.acting.values()) if (entry.running > 0) return false;
    return !this.link.busy();
  }

  /** Whether page writes on the artifact now come from the agent's action. */
  private isAgentActing(id: string): boolean {
    const entry = this.acting.get(id);
    return !!entry && (entry.running > 0 || Date.now() < entry.until);
  }

  /**
   * `open: "after_first_write"`: once a content file appears under the root
   * and has settled, shows the page in the caller's app. `false` when that
   * app cannot show pages.
   */
  private openAfterFirstWrite(record: ArtifactRecord, caller: SessionRef): boolean {
    if (!this.harnesses.canShow(caller)) return false;
    this.pendingOpens.get(record.id)?.();
    const id = record.id;
    const started = Date.now();
    let settle: ReturnType<typeof setTimeout> | undefined;
    const poll = setInterval(() => {
      const now = this.store.get(id);
      if (!now || this.closed || Date.now() - started > OPEN_GIVE_UP_MS) return stop();
      if (settle || !hasContent(now.root)) return;
      settle = setTimeout(() => {
        stop();
        void this.openFor(id, caller);
      }, OPEN_SETTLE_MS);
      settle.unref?.();
    }, OPEN_POLL_MS);
    poll.unref?.();
    const stop = (): void => {
      clearInterval(poll);
      clearTimeout(settle);
      if (this.pendingOpens.get(id) === stop) this.pendingOpens.delete(id);
    };
    this.pendingOpens.set(id, stop);
    return true;
  }

  /** Opens the page and asks the caller's app to show it. */
  private async openFor(id: string, caller: SessionRef): Promise<void> {
    const record = this.store.get(id);
    if (!record) return;
    try {
      await this.openPage(record);
      const shown = await this.harnesses.show(caller, { url: artifactUrl(id), view_url: this.viewUrl(id), title: record.title });
      this.log(`opened ${id} after the first write${shown === 'browser' ? ' in the browser' : shown ? '' : ': the app did not show it'}`);
    } catch (error) {
      this.log(`opening ${id} after the first write failed: ${(error as Error)?.message ?? error}`);
    }
  }

  private tick(): void {
    const now = Date.now();
    for (const [key, task] of this.tasks) {
      if (now - task.at > TASK_TTL_MS) {
        this.tasks.delete(key);
        if (task.write) this.agentActing(task.artifactId, 'end');
      }
    }
    for (const [key, early] of this.earlyEnds) if (now - early.at > 60_000) this.earlyEnds.delete(key);
    for (const [id, entry] of this.acting) if (!entry.running && now > entry.until) this.acting.delete(id);
    for (const [id, page] of this.pages) {
      if (Date.now() - page.lastUsed > PAGE_IDLE_MS) {
        this.pages.delete(id);
        this.unwatch(id);
      }
    }
    // Update checks as the policy says, and the switch to a newer runtime once idle.
    this.runtime.tick(now);
    if (this.closed) return;
    if (!this.idleMs) return;
    const busy = this.harnesses.connections.size > 0 || this.pages.size > 0 || this.eventClients.size > 0 || this.typeEventClients.size > 0 || this.link.busy();
    if (busy) this.lastActivity = Date.now();
    else if (Date.now() - this.lastActivity > this.idleMs) {
      this.close('idle');
      this.emit('exit');
    }
  }

  /**
   * After {@link close}: resolves once the type servers in this process's worker threads have ended (bounded), so the
   * process can exit without cutting their clean-up short. At once when they are child processes.
   */
  drained(): Promise<void> {
    return this.servers.drained();
  }

  /**
   * Stops everything, removes `daemon.json` and the lock, and says so in the log with `reason` (a signal's name,
   * `idle`, …): the log's last word of this daemon, but for the lines of type servers still ending.
   */
  close(reason = 'closed'): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.runtime.close();
    this.servers.closeAll();
    for (const id of [...this.watchers.keys()]) this.unwatch(id);
    for (const stop of [...this.pendingOpens.values()]) stop();
    this.link.close();
    this.data.close();
    for (const client of this.typeEventClients) client.res.end();
    this.harnesses.close();
    for (const res of this.eventClients) res.end();
    this.types.close();
    this.server.close();
    this.server.closeAllConnections?.();
    const state = readJson<DaemonState | null>(files.daemon(), null);
    if (state?.pid === process.pid) rmSync(files.daemon(), { force: true });
    try {
      if (Number(readFileSync(files.lock(), 'utf8')) === process.pid) rmSync(files.lock(), { force: true });
    } catch {
      /* no lock */
    }
    this.log(`daemon ${VERSION} stopped (${reason})`);
  }

  /** Sends an event to the Library event streams, subscribed adapters and type servers. */
  broadcast(event: LibraryEvent): void {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.eventClients) res.write(line);
    this.harnesses?.broadcast(event);
    if (this.typeEventClients.size) this.typeEvent(event);
  }

  // ---- requests ----------------------------------------------------------------------------------------------------

  /** Our own names and the static entries' (DNS rebinding gets a 421). */
  private hostAllowed(req: IncomingMessage): boolean {
    const host = String(req.headers.host ?? '');
    return this.hosts.has(host) || this.frameIdOf(host) !== null;
  }

  /** The artifact id of a static entry's host, or `null`. */
  private frameIdOf(host: string | undefined): string | null {
    const match = FRAME_HOST.exec(String(host ?? '').toLowerCase());
    return match && Number(match[2]) === this.port ? match[1]! : null;
  }

  /** A static entry's origin. */
  frameOrigin(id: string): string {
    return `http://${id}.frame.localhost:${this.port}`;
  }

  private originOk(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  /** A write from the home page or Shell (same origin, JSON) or a process with the token. */
  private writeAllowed(req: IncomingMessage): boolean {
    if (this.hasToken(req)) return true;
    if (!isLoopback(req.socket.remoteAddress)) return false;
    return req.headers.origin !== undefined && this.originOk(req) && String(req.headers['content-type'] ?? '').startsWith('application/json');
  }

  /**
   * Who asked for a publishing or site change, for the daemon's log (`audit:` lines): a page of this daemon's origin
   * (the Shell or the home page, in this computer's browser), or a process holding the daemon token, which says what it
   * is with `X-Open-Artifact-Client` (`cli`) and, inside an agent's session, `X-Open-Artifact-Agent`. Those headers are
   * the caller's word: a process that leaves them out is logged as one that did not say what it is.
   */
  private askedBy(req: IncomingMessage, route: string): string {
    const header = (name: string): string => {
      const value = req.headers[name];
      if (typeof value !== 'string' || !value) return '';
      try {
        return decodeURIComponent(value).replace(/[^\x20-\x7e]/g, '?').slice(0, 200);
      } catch {
        return '?';
      }
    };
    if (!this.hasToken(req)) return `a page of this daemon in this computer's browser (the Shell), route ${route}`;
    const agent = header('x-open-artifact-agent');
    const who = header('x-open-artifact-client') === 'cli' ? 'the open-artifact command line' : 'a process holding the daemon token that did not say what it is';
    return `${who}${agent ? ` inside the agent session ${agent}` : ''}, route ${route}`;
  }

  private hasToken(req: IncomingMessage): boolean {
    return String(req.headers.authorization ?? '') === `Bearer ${this.token}`;
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.lastActivity = Date.now();
    if (!this.hostAllowed(req)) {
      req.resume();
      res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Misdirected request');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://local');
    const p = url.pathname;
    const frameId = this.frameIdOf(req.headers.host);
    if (frameId) {
      // Static entries are for this computer only.
      if (isLoopback(req.socket.remoteAddress)) return this.staticEntry(req, res, frameId, url);
      return this.notFound(req, res);
    }
    // The daemon is for this computer; shared pages are the type servers'.
    if (!isLoopback(req.socket.remoteAddress)) return this.notFound(req, res);
    if (p === '/__open-artifact/health') {
      const health: DaemonHealth = { openArtifact: 1, version: VERSION, nodeChildren: nodeChildren() };
      return sendJson(res, 200, health);
    }
    if (p === '/favicon.ico') {
      req.resume();
      res.writeHead(204).end();
      return;
    }
    if (p === '/' || p === '/index.html') return this.homePage(req, res);
    if (p.startsWith(UI_PATHS.shell)) return this.staticUnder(req, res, this.shellDir, p.slice(UI_PATHS.shell.length));
    if (p.startsWith(UI_PATHS.home)) return this.staticUnder(req, res, this.homeDir, p.slice(UI_PATHS.home.length));
    const shell = /^\/a\/(art_[0-9a-z]+)\/?$/.exec(p);
    if (shell) return this.shellPage(req, res, shell[1]!);
    if (p.startsWith('/api/open-artifact.')) return this.api(req, res, p.slice('/api/open-artifact.'.length), url);
    if (p === '/mcp') return this.mcp(req, res);
    return this.notFound(req, res);
  }

  private notFound(req: IncomingMessage, res: ServerResponse): void {
    req.resume();
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Not found');
  }

  /** A file under `dir` (no path escapes, no dot files), for GET and HEAD. */
  private staticUnder(req: IncomingMessage, res: ServerResponse, dir: string, rel: string): void {
    req.resume();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(rel);
    } catch {
      return this.notFound(req, res);
    }
    const parts = decoded.split('/').filter(Boolean);
    if (!parts.length || decoded.includes('\0') || parts.some((part) => part.startsWith('.'))) return this.notFound(req, res);
    let file: string;
    try {
      file = inside(dir, parts.join('/'));
    } catch {
      return this.notFound(req, res);
    }
    this.sendFile(req, res, file, file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  }

  private sendFile(req: IncomingMessage, res: ServerResponse, file: string, cache: string): void {
    let stat;
    try {
      stat = statSync(file);
      if (stat.isDirectory()) {
        file = join(file, 'index.html');
        stat = statSync(file);
      }
    } catch {
      return this.notFound(req, res);
    }
    if (!stat.isFile()) return this.notFound(req, res);
    const etag = `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
    const headers = { ETag: etag, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'Content-Type': contentType(file) };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers).end();
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  /** `GET /`: the built home page, or a plain list when it is missing. */
  private homePage(req: IncomingMessage, res: ServerResponse): void {
    req.resume();
    try {
      sendHtml(res, readFileSync(join(this.homeDir, 'index.html'), 'utf8'));
      return;
    } catch {
      /* not built: the plain list */
    }
    const rows = this.store
      .list()
      .map((record) => {
        const type = this.typeOf(record);
        return `<li><a href="/a/${encodeURIComponent(record.id)}">${escapeHtml(record.title)}</a> <span>${escapeHtml(type?.title ?? record.type)}</span></li>`;
      })
      .join('\n');
    sendHtml(
      res,
      `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Open Artifact</title>
<style>body{font:14px/1.6 system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 24px;color:#222}span{color:#888;margin-left:8px}@media (prefers-color-scheme:dark){body{background:#161616;color:#ddd}a{color:#8ab4f8}}</style>
</head>
<body>
<h1>Open Artifact</h1>
${rows ? `<ul>\n${rows}\n</ul>` : '<p>No artifacts yet. Ask an agent to make one with the Artifact tool.</p>'}
</body>
</html>
`,
    );
  }

  /** What the Shell's boot says before the page is opened: everything but `page`, `pageUrl`, `pageKind` and `problem`. */
  private bootOf(record: ArtifactRecord): ShellBoot {
    const type = this.typeOf(record);
    // Made but not written yet: none of the type's marker files is there.
    const empty = !!type?.detect.length && !type.detect.some((rel) => existsSync(join(record.root, rel)));
    const typeTitle = type?.title ?? record.type;
    return {
      id: record.id,
      url: artifactUrl(record.id),
      title: record.title,
      type: record.type,
      typeTitle,
      root: record.root,
      page: null,
      pageUrl: null,
      pageKind: null,
      problem: null,
      empty,
      prompt: empty ? takeOverPrompt(record, typeTitle) : null,
      owner: record.owner ? { harness: record.owner.harness, key: sessionKeyOf(record.owner) } : null,
      agentName: this.agentNameOf(record),
      userName: safeUserName(),
      version: VERSION,
      // Written by a newer type release: the page opens view-only and the Shell says how to update.
      ...releaseView(record, type?.version ?? null),
      // A restricted static type's page is framed by the Shell itself: the Shell sandboxes it (frame-host does that
      // for a frame type's page, inside its own page).
      ...(restrictedStatic(type) ? { sandbox: RESTRICTED_FRAME_SANDBOX } : {}),
    };
  }

  /**
   * Opens the artifact's page for the Shell, as the browser at `req` reaches the daemon. An open in flight is joined,
   * never started twice. With `reuse`, one that settled less than {@link BOOT_REUSE_MS} ago is taken too, once: the
   * boot request that follows the page that started it (so a failure is not kept past that pair, and a reload retries).
   */
  private openForShell(record: ArtifactRecord, req: IncomingMessage | undefined, reuse: boolean): Promise<ShellOpen> {
    const have = this.shellOpens.get(record.id);
    if (have && have.at === null) {
      if (reuse) have.taken = true;
      return have.done;
    }
    if (have && reuse && !have.taken && Date.now() - have.at! < BOOT_REUSE_MS) {
      this.shellOpens.delete(record.id);
      return have.done;
    }
    const context = { lang: langOf(req), ...(req?.headers.host ? { shell: `http://${req.headers.host}` } : {}) };
    const opening: ShellOpening = {
      at: null,
      taken: false,
      done: this.openPage(record, context).then(
        (page): ShellOpen => ({ page, problem: null }),
        (error: unknown): ShellOpen => ({ page: null, problem: (error as Error)?.message ?? String(error) }),
      ),
    };
    this.shellOpens.set(record.id, opening);
    void opening.done.then(() => {
      opening.at = Date.now();
      const forget = (): void => {
        if (this.shellOpens.get(record.id) === opening) this.shellOpens.delete(record.id);
      };
      // A boot request already had it; else it waits a moment for the one that follows its page.
      if (opening.taken) forget();
      else setTimeout(forget, BOOT_REUSE_MS).unref();
    });
    return opening.done;
  }

  /**
   * The finished boot object of the Shell for one artifact (never `pending`): waits for its page to open.
   * With `reuse`, takes the open the Shell's page started a moment ago ({@link openForShell}).
   */
  async shellBoot(record: ArtifactRecord, req?: IncomingMessage, options: { reuse?: boolean } = {}): Promise<ShellBoot> {
    const boot = this.bootOf(record);
    if (boot.empty) return boot;
    const opened = await this.openForShell(record, req, options.reuse ?? false);
    return { ...boot, page: opened.page?.page ?? null, pageUrl: opened.page?.page_url ?? null, pageKind: opened.page?.kind ?? null, problem: opened.problem };
  }

  /**
   * `GET /a/<id>`: the Shell's `index.html` with the boot object in place, at once. The page starts opening here
   * (a type server may take a while to start) and the boot says `pending`: the Shell asks `artifacts.boot` for the
   * finished one. An empty artifact has nothing to open; the fallback page (no built Shell) waits for the page.
   */
  private async shellPage(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    req.resume();
    const found = this.store.get(id);
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(`No artifact ${id}.`);
      return;
    }
    // A published artifact is edited on its host: one editable page, not two. Offline, the working copy shows here.
    if (found.remote && this.link.reachable(found.remote.name)) {
      res.writeHead(302, { Location: found.remote.url, 'Cache-Control': 'no-store' }).end();
      return;
    }
    const record = this.touchOpened(found);
    let template: string | null = null;
    try {
      template = readFileSync(join(this.shellDir, 'index.html'), 'utf8');
    } catch {
      /* not built: the fallback */
    }
    let boot: ShellBoot;
    if (template === null) boot = await this.shellBoot(record, req);
    else {
      boot = this.bootOf(record);
      if (!boot.empty) {
        void this.openForShell(record, req, false);
        boot = { ...boot, pending: true };
      }
    }
    // A restricted static type's page stays on a page origin of this daemon: frame-src holds every navigation of the
    // Shell's frame, the page's own too (CSP host sources cannot spell an id with '_': any page origin on this port).
    const policy = restrictedStatic(this.typeOf(record)) ? `frame-src http://*.frame.localhost:${this.port}` : null;
    sendHtml(res, (template ?? FALLBACK_SHELL).replace(BOOT_PLACEHOLDER, () => scriptJson(boot)), policy);
  }

  // ---- library helpers ---------------------------------------------------------------------------------------------

  /** Opened in the Shell or from a list: when (the record's `updatedAt` stays). */
  private touchOpened(record: ArtifactRecord): ArtifactRecord {
    try {
      return this.store.update(record.id, { openedAt: new Date().toISOString(), updatedAt: record.updatedAt });
    } catch {
      return record;
    }
  }

  /** The newest change in the artifact's folder; a bounded walk, kept for 5 s. */
  private contentAt(record: ArtifactRecord): string {
    const now = Date.now();
    const have = this.contentStamps.get(record.root);
    if (have && now - have.at < 5000) return have.value;
    let newest = 0;
    let seen = 0;
    const walk = (dir: string, depth: number): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (seen++ > 4000) return;
        // Bookkeeping is not content, nor is the agent's own channel (`_agent/`: snapshots, kept conflicts).
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'exports') continue;
        if (depth === 0 && entry.name === '_agent') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < 5) walk(full, depth + 1);
        } else {
          try {
            newest = Math.max(newest, statSync(full).mtimeMs);
          } catch {
            /* gone meanwhile */
          }
        }
      }
    };
    walk(record.root, 0);
    const value = newest ? new Date(Math.floor(newest)).toISOString() : record.updatedAt;
    this.contentStamps.set(record.root, { at: now, value });
    return value;
  }

  /** The folder's size (a bounded walk: a huge folder reads as at least this much). */
  private folderBytes(root: string): number {
    let bytes = 0;
    let seen = 0;
    const walk = (dir: string, depth: number): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (seen++ > 20000) return;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < 8 && entry.name !== 'node_modules') walk(full, depth + 1);
        } else if (entry.isFile()) {
          try {
            bytes += statSync(full).size;
          } catch {
            /* gone meanwhile */
          }
        }
      }
    };
    walk(root, 0);
    return bytes;
  }

  /** A copy of the artifact beside it: its content, not its bookkeeping (dot files, history, exports). */
  /**
   * Adds the artifact in `folder` (its `.artifact.json` or a type's marker files say which type), owned by no session,
   * as Artifact {action:"adopt"} does: its record, or null when the folder is missing or holds no artifact of a known
   * type. Other failures throw.
   */
  private async adoptFolder(folder: string): Promise<ArtifactRecord | null> {
    const result = await this.tools.call('Artifact', { action: 'adopt', folder }, {});
    if (result.error) {
      if (result.error.code === 'not_found' || result.error.code === 'invalid_argument') return null;
      throw new OpenArtifactError(result.error.code, result.error.message);
    }
    const id = artifactIdOf(String(result.url ?? ''));
    return id ? this.store.update(id, { owner: null, createdBy: null }) : null;
  }

  private async duplicate(record: ArtifactRecord, name?: string): Promise<ArtifactRecord> {
    if (record.type === 'docs') {
      const type = this.typeOf(record);
      if (!type) throw new OpenArtifactError('unsupported', 'The Docs type is unavailable.');
      const copy = await this.servers.call<{ root: string; name: string }>(type, 'POST', TYPE_SERVER_ROUTES.actions + 'duplicate',
        { root: record.root, id: record.id, args: { name: name ?? (record.title.slice(0, 249) + ' (copy)') } }, undefined, ACTION_CALL_MS);
      return this.store.create({ root: copy.root, title: copy.name, type: record.type, typeSource: record.typeSource, typeRelease: record.typeRelease, typeUid: record.typeUid ?? null, owner: record.owner });
    }
    const parent = dirname(record.root);
    const base = record.root.slice(parent.length + 1);
    let root = join(parent, `${base}-copy`);
    for (let n = 2; existsSync(root); n++) root = join(parent, `${base}-copy-${n}`);
    // `_agent/` is this computer's agent channel (snapshots): never part of the artifact, so not of its copy.
    const skip = (name: string): boolean => name.startsWith('.') || name === 'history' || name === 'exports' || name === 'node_modules' || name === '_agent';
    ensureDir(root);
    for (const name of readdirSync(record.root)) {
      if (skip(name)) continue;
      cpSync(join(record.root, name), join(root, name), { recursive: true, errorOnExist: false });
    }
    return this.store.create({ root, type: record.type, typeSource: record.typeSource, typeRelease: record.typeRelease, typeUid: record.typeUid ?? null, owner: record.owner, title: `Copy of ${record.title}`.slice(0, 200) });
  }

  private thumbnailFile(id: string): string {
    return join(files.thumbnails(), `${id}.jpg`);
  }

  /** The content stamp a thumbnail was taken at, or `null`. */
  private thumbnailOf(id: string): string | null {
    return readJson<{ v?: string } | null>(join(files.thumbnails(), `${id}.json`), null)?.v ?? null;
  }

  /** One artifact as lists show it. */
  artifactView(record: ArtifactRecord): ArtifactView {
    const type = this.typeOf(record);
    const live = this.harnesses.statusOf(record.owner);
    return {
      id: record.id,
      url: artifactUrl(record.id),
      title: record.title,
      type: record.type,
      typeTitle: type?.title ?? record.type,
      typeMissing: !type,
      root: record.root,
      view_url: this.viewUrl(record.id),
      page_url: this.pages.get(record.id)?.page_url ?? this.viewUrl(record.id),
      owner: record.owner ? { harness: record.owner.harness, session: record.owner.session, workspace: record.owner.workspace, ...live } : null,
      pinned: !!record.pinnedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      openedAt: record.openedAt ?? null,
      contentAt: this.contentAt(record),
      thumbnail: this.thumbnailOf(record.id),
      shared: sharedOnLan(record.root),
      open: this.pages.has(record.id),
      remote: record.remote ? { name: record.remote.name, host: record.remote.host, url: record.remote.url, syncedAt: record.remote.syncedAt } : null,
      ...releaseView(record, type?.version ?? null),
    };
  }

  private typeView(type: ListedType): TypeView {
    return {
      id: type.id,
      title: type.title,
      description: type.description,
      scope: type.scope,
      root: type.root,
      runtime: type.runtime,
      entry: type.entry?.kind ?? null,
      server: this.servers.status(type.id),
      runnable: type.runnable,
      enabled: type.enabled,
      shadowedBy: type.shadowedBy,
      version: type.version,
      problems: type.problems,
      icon: !!type.icon,
      ...typeLocation(type),
      ...(type.uid ? { uid: type.uid } : {}),
      dir: type.dir,
      ...(type.scope === 'project' ? { trusted: type.trusted } : {}),
      ...typeSourceOf(type),
      capabilities: type.runtime === 'frame' || type.runtime === 'static' ? typeCapabilities(type.dir) : [],
      network: type.network,
      // A type of an untrusted root (installed, or a project not trusted yet): who wrote its text.
      ...((notice) => (notice ? { notice } : {}))(restrictedTypeNotice(type)),
    };
  }

  /** The project types of the folders this computer knows, but `skip` (whose types the answer lists already). */
  private projectTypes(skip?: string): TypesProject[] {
    const known = [...this.harnesses.workspaces(), ...(this.settings.trustedProjects ?? []), this.settings.homeWorkspace, ...this.typeProjects];
    const folders = new Set(known.map((d) => resolve(d)));
    const out: TypesProject[] = [];
    for (const dir of folders) {
      if (skip && resolve(skip) === dir) continue;
      const root = this.types.roots(dir).find((r) => r.scope === 'project');
      if (!root || !existsSync(root.root)) continue;
      const types = this.types.list(dir, { includeShadowed: true }).filter((t) => t.scope === 'project');
      if (types.length) out.push({ dir, root: root.root, trusted: root.trusted, types: types.map((t) => this.typeView(t)) });
    }
    return out;
  }

  /** Projects a type was made in since the daemon started (`types new|from --scope project`): the home page lists them. */
  private readonly typeProjects = new Set<string>();

  /**
   * Why a `types.*` call is refused, or null. These change what this computer runs, so they come only from the CLI (the
   * token) or this daemon's own Shell and home page: a call that carries any other `Origin` (an artifact's page on
   * `*.frame.localhost`, a type server's page on its own port, another site) is refused even with the token, and so is
   * a browser's cross-site request. `types.enable`, `types.disable` and `types.trust` are the person's to decide: a
   * call that says it comes from inside an agent's session (`X-Open-Artifact-Agent`, which the CLI sends there) is
   * refused too. That header is the caller's word, as in {@link askedBy}: a guard rail, not a boundary.
   */
  private typesRefusal(req: IncomingMessage, name: string): string | null {
    const origin = req.headers.origin;
    if (origin !== undefined && !this.ownOrigin(origin)) return `${name} comes from the open-artifact command line or this daemon's own page, not from ${origin}.`;
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return `${name} comes from the open-artifact command line or this daemon's own page, not from another site.`;
    const personOnly: string[] = [LIBRARY_ROUTES.typesEnable, LIBRARY_ROUTES.typesDisable, LIBRARY_ROUTES.typesTrust];
    if (personOnly.includes(name) && req.headers['x-open-artifact-agent']) {
      return 'Turning a type on or off and trusting a project are for the person to decide: they run it in their own terminal, or use the Types tab of the home page.';
    }
    const sites: string[] = [LIBRARY_ROUTES.typesPublish, LIBRARY_ROUTES.typesUnpublish];
    if (sites.includes(name) && req.headers['x-open-artifact-agent']) {
      return 'Publishing a type to a site and taking it off are for the person to decide: they run open-artifact types publish | unpublish in their own terminal.';
    }
    const installs: string[] = [LIBRARY_ROUTES.typesInstall, LIBRARY_ROUTES.typesUninstall, LIBRARY_ROUTES.typesUpdate];
    if (installs.includes(name) && req.headers['x-open-artifact-agent']) {
      return "Installing, updating and uninstalling a type are for the person to decide: they run open-artifact types install | update | uninstall in their own terminal, or use the Types tab of the home page.";
    }
    return null;
  }

  /** An origin of this daemon's own pages (the Shell, the home page): `http://<one of its hosts>`. */
  private ownOrigin(origin: string): boolean {
    try {
      const u = new URL(origin);
      return u.protocol === 'http:' && `${u.protocol}//${u.host}` === origin && this.hosts.has(u.host);
    } catch {
      return false;
    }
  }

  /** `types.new`, `types.check`, `types.from`, `types.enable`, `types.disable`, `types.trust` (all `POST`). */
  private async typesCall(req: IncomingMessage, res: ServerResponse, name: string, get: boolean): Promise<void> {
    if (get) throw new OpenArtifactError('invalid_argument', `${name} is a POST.`, { status: 405 });
    const refusal = this.typesRefusal(req, name);
    if (refusal) {
      req.resume();
      return sendJson(res, 403, { code: 'not_granted', message: refusal });
    }
    if (name === LIBRARY_ROUTES.typesPreview || name === LIBRARY_ROUTES.import) return this.packageCall(req, res, name);
    const body = await readJsonBody<Record<string, unknown>>(req);
    const workspace = typeof body.workspace === 'string' && isAbsolute(body.workspace) ? resolve(body.workspace) : null;
    const project = typeof body.project === 'string' && body.project ? body.project : null;
    if (project !== null && !isAbsolute(project)) throw new OpenArtifactError('invalid_argument', 'project: the project folder, as an absolute path.');
    const o = { settings: this.settings, registry: this.types, workspace: workspace ?? (body.scope === 'project' ? project : null) ?? this.settings.homeWorkspace };
    const changed = (): void => {
      this.settings = loadSettings(this.preset);
      this.broadcast({ type: 'types/changed' });
    };
    const R = LIBRARY_ROUTES;
    switch (name) {
      case R.typesNew: {
        const made = newType({ id: body.id, scope: body.scope, template: body.template, name: body.name, project }, o);
        this.log(`audit: made the type ${made.id} (${made.scope}, ${String(body.template ?? 'page')}) at ${made.dir}, asked by ${this.askedBy(req, name)}`);
        if (made.scope === 'project' && project) this.typeProjects.add(resolve(project));
        changed();
        return sendJson(res, 200, made);
      }
      case R.typesFrom: {
        if (body.path !== undefined) {
          // A folder or file by path: the command line's (it holds the token), never a page's, this daemon's included.
          if (!this.hasToken(req)) throw new OpenArtifactError('not_granted', `${R.typesFrom} with a path is for the command line: open-artifact types from <path> --id <id>.`, { status: 403 });
          if (typeof body.path !== 'string' || !isAbsolute(body.path)) throw new OpenArtifactError('invalid_argument', 'path: the saved page (a folder or an .html file), as an absolute path.');
          const made = typeFromSaved(body.path, { id: body.id, scope: body.scope, name: body.name, project }, o);
          this.log(`audit: made the type ${made.id} from the saved page ${made.source} at ${made.dir}, asked by ${this.askedBy(req, name)}`);
          if (made.scope === 'project' && project) this.typeProjects.add(resolve(project));
          changed();
          return sendJson(res, 200, made);
        }
        const record = this.store.require(body.artifact);
        const made = typeFromPage(record, this.typeOf(record), { id: body.id, scope: body.scope, name: body.name, project }, o);
        this.log(`audit: made the type ${made.id} from ${record.id} at ${made.dir}, asked by ${this.askedBy(req, name)}`);
        if (made.scope === 'project' && project) this.typeProjects.add(resolve(project));
        changed();
        return sendJson(res, 200, made);
      }
      case R.typesCheck: {
        // By id only: a page of this daemon has no business reading folders by path.
        const id = String(body.id ?? '');
        const type = this.types.list(o.workspace ?? undefined).find((t) => t.id === id);
        if (!type) throw new OpenArtifactError('not_found', `No type ${id}.`);
        return sendJson(res, 200, checkType(type.dir, { ...o, forShare: body.forShare === true }));
      }
      case R.typesEnable:
      case R.typesDisable: {
        const enabled = name === R.typesEnable;
        const out = setTypeEnabled(body.id, enabled);
        this.log(`audit: turned the type ${String(body.id)} ${enabled ? 'on' : 'off'}, asked by ${this.askedBy(req, name)}`);
        changed();
        return sendJson(res, 200, out);
      }
      case R.typesTrust: {
        const trusted = body.trusted !== false;
        const out = setProjectTrusted(body.dir, trusted);
        this.log(`audit: ${trusted ? 'trusted' : 'stopped trusting'} the project ${String(body.dir)}, asked by ${this.askedBy(req, name)}`);
        changed();
        return sendJson(res, 200, out);
      }
      case R.typesInstall:
      case R.typesUpdate: {
        const id = typeof body.id === 'string' ? body.id : null;
        if (name === R.typesUpdate && !id) throw new OpenArtifactError('invalid_argument', 'id: the installed type to update.');
        // types.update {id} without sha256: a preview of what its recorded source holds now.
        if (name === R.typesUpdate && typeof body.sha256 !== 'string') {
          const recorded = updateSource(id!);
          const loaded = await loadTypePackage(recorded.source);
          return sendJson(res, 200, await this.stagedPreview(loaded.bytes, loaded.source, id));
        }
        const hash = String(body.sha256 ?? '');
        const staged = stagedPackage(hash);
        const as = name === R.typesUpdate ? id : typeof body.as === 'string' && body.as ? body.as : null;
        const expectUid = name === R.typesUpdate ? updateSource(id!).uid : undefined;
        const pkg = await readTypePackage(staged.bytes, staged.source, { as, registry: this.types });
        if (name === R.typesUpdate && pkg.preview.id !== id) throw new OpenArtifactError('invalid_argument', `That package installs ${pkg.preview.id}, not ${id}.`);
        const installed = await installTypePackage(pkg, expectUid ? { expectUid } : {});
        unstagePackage(hash);
        this.log(`audit: ${name === R.typesUpdate ? 'updated' : installed.replaced ? 'installed again' : 'installed'} the type ${installed.id} ${installed.version} (uid ${installed.uid}, sha256 ${installed.sha256}) from ${installed.source} at ${installed.dir}, asked by ${this.askedBy(req, name)}`);
        changed();
        return sendJson(res, 200, installed);
      }
      case R.typesPublish:
      case R.typesUnpublish: {
        const id = typeof body.id === 'string' ? body.id : '';
        if (!id) throw new OpenArtifactError('invalid_argument', 'id: the type.');
        const remote = typeof body.remote === 'string' && body.remote ? body.remote : this.link.defaultRemote();
        if (!remote) throw new OpenArtifactError('invalid_argument', 'Which site? Pass --remote <name>.', { fix: 'open-artifact remote list shows them; add one with open-artifact remote add <name> <https://host>.' });
        if (name === R.typesUnpublish) {
          const out = await this.link.unpublishType(id, remote);
          this.log(`audit: unpublished the type ${id} from ${remote} (${out.removed ? 'removed' : `delisted, ${out.artifacts} artifact(s) use it`}), asked by ${this.askedBy(req, name)}`);
          return sendJson(res, 200, out);
        }
        const visibility = body.visibility === undefined ? undefined : String(body.visibility);
        if (visibility !== undefined && !(SITE_TYPE_VISIBILITIES as readonly string[]).includes(visibility)) throw new OpenArtifactError('invalid_argument', 'visibility is private, site or link.');
        const type = this.types.get(id, workspace ?? undefined);
        if (!type) throw new OpenArtifactError('not_found', `No type ${id} on this computer.`, { fix: 'open-artifact types lists them.' });
        const out = await this.link.publishType(type, remote, visibility as SiteTypeVisibility | undefined, workspace);
        this.log(`audit: published the type ${type.id} ${out.type.version} (uid ${out.type.uid}, sha256 ${out.type.sha256}, ${out.change}, visibility ${out.type.visibility}) from ${type.dir} to ${remote}, asked by ${this.askedBy(req, name)}`);
        return sendJson(res, 200, out);
      }
      case R.typesUninstall: {
        const out = uninstallType(String(body.id ?? ''));
        this.log(`audit: uninstalled the type ${out.id} (${out.dir}), asked by ${this.askedBy(req, name)}`);
        changed();
        return sendJson(res, 200, out);
      }
    }
  }

  /** A package read and checked, its bytes kept for the install the person confirms: the preview, with its sha256. */
  private async stagedPreview(bytes: Uint8Array, source: string, as: string | null): Promise<TypePackagePreview> {
    const pkg = await readTypePackage(bytes, source, { as, registry: this.types });
    stagePackage(bytes, source);
    return pkg.preview;
  }

  /**
   * `types.preview` and `artifacts.import`, whose body is a file: the bytes themselves (`application/octet-stream` or
   * `application/zip`, which only a caller with the daemon token sends, `?name=` for its name), or JSON `{ name, data }`
   * with the bytes in base64 (the home page), or for a preview `{ url }`, an address the daemon fetches once.
   */
  private async packageCall(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    const preview = name === LIBRARY_ROUTES.typesPreview;
    const max = preview ? PACKAGE_DOWNLOAD_MAX : ARTIFACT_IMPORT_LIMITS.zipBytes;
    const json = String(req.headers['content-type'] ?? '').startsWith('application/json');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const raw = await readBody(req, json ? Math.ceil((max * 4) / 3) + (1 << 20) : max);
    let body: Record<string, unknown> = {};
    let bytes: Uint8Array | null = null;
    if (json) {
      try {
        const parsed = JSON.parse(raw.toString('utf8')) as unknown;
        if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
      } catch {
        throw new OpenArtifactError('invalid_argument', 'The body is not JSON.');
      }
      if (typeof body.data === 'string') bytes = Buffer.from(body.data, 'base64');
    } else {
      bytes = raw;
      body = { name: url.searchParams.get('name') ?? undefined, as: url.searchParams.get('as') ?? undefined, folder: url.searchParams.get('folder') ?? undefined };
    }
    // A file the command line read keeps its path (where `types update` reads it again); a page's file, its name.
    const label = typeof body.name === 'string' && body.name ? (json ? basename(body.name) : body.name).slice(0, 1000) : preview ? 'the package' : 'the archive';
    if (preview) {
      const as = typeof body.as === 'string' && body.as ? body.as : null;
      if (!bytes) {
        // Only an address: a page of this daemon has no business reading files by path.
        if (typeof body.url !== 'string' || !isAddress(body.url)) throw new OpenArtifactError('invalid_argument', 'Send the package (its bytes, or { name, data } in base64), or { url } with its https:// address.');
        return sendJson(res, 200, await this.stagedPreview(await fetchTypePackage(body.url), body.url, as));
      }
      return sendJson(res, 200, await this.stagedPreview(bytes, label, as));
    }
    if (!bytes || !bytes.byteLength) throw new OpenArtifactError('invalid_argument', 'Send the zip: its bytes, or { name, data } in base64.');
    const workspace = this.settings.homeWorkspace ?? null;
    const read = await readArtifactArchive(bytes, label, { registry: this.types, workspace });
    const folder = typeof body.folder === 'string' && body.folder ? body.folder : undefined;
    if (folder && !isAbsolute(folder)) throw new OpenArtifactError('invalid_argument', 'folder: where to put it, as an absolute path.');
    const base = folder ? resolve(folder) : this.tools.resolveFolder(undefined, { harness: 'home', session: null, workspace }, read.top);
    let dest = base;
    if (!folder) for (let n = 2; existsSync(dest); n++) dest = `${base}-${n}`;
    const unpacked = await unpackArtifactArchive(bytes, read, dest);
    const record = await this.adoptFolder(unpacked.root);
    if (!record) {
      rmSync(unpacked.root, { recursive: true, force: true });
      throw new OpenArtifactError('bad_archive', `${label} could not be added as an artifact.`);
    }
    this.log(`audit: imported ${label} as ${record.id} (${read.type.id}${read.marker.typeUid ? `, uid ${read.marker.typeUid}` : ''}) at ${record.root}, asked by ${this.askedBy(req, name)}`);
    return sendJson(res, 201, { ...this.artifactView(record), files: unpacked.files, bytes: unpacked.bytes });
  }

  /**
   * Resolves the artifact's page: `page` is what the Shell frames, an
   * absolute address on the page's own origin.
   */
  async openPage(record: ArtifactRecord, context: { lang?: string | undefined; shell?: string } = {}): Promise<Omit<OpenPage, 'lastUsed'>> {
    const type = this.typeOf(record);
    if (!type) throw new OpenArtifactError('type_missing', `The type ${record.type} is not installed.`);
    const mismatch = typeMismatch(record, type);
    if (mismatch) throw mismatch;
    if (!type.runnable || !type.entry) throw new OpenArtifactError('type_not_runnable', type.problems.join(' ') || `${type.id} cannot open.`);
    const kind = type.entry.kind;
    let out: Omit<OpenPage, 'lastUsed'>;
    if (kind === 'static') {
      const page = `${this.frameOrigin(record.id)}/`;
      out = { kind, page, page_url: page };
      this.watchFolder(record);
    } else {
      const got = await this.servers.open(type, record, { ...(context.lang ? { lang: context.lang } : {}), shell: context.shell ?? this.origin });
      out = { kind, page: got.url, page_url: got.page_url };
    }
    this.pages.set(record.id, { ...out, lastUsed: Date.now() });
    return out;
  }

  /**
   * Closes the artifact in its type server, waiting for it, then opens it again: what a sync pulled into a folder its
   * server keeps in memory (a published doc's or Sheet's `doc/`, `sheet/`) is read anew. Its open pages reconnect.
   */
  async reopenPage(record: ArtifactRecord): Promise<void> {
    const type = this.typeOf(record);
    if (type?.entry?.kind === 'server' && type.entry.open && this.servers.isReady(type.id)) {
      await this.servers.call(type, 'POST', TYPE_SERVER_ROUTES.close, { id: record.id }).catch(() => undefined);
    }
    await this.openPage(record);
  }

  /** The artifact left the list: its type server may let it go. */
  private closePage(record: ArtifactRecord): void {
    this.pages.delete(record.id);
    this.unwatch(record.id);
    const type = this.typeOf(record);
    if (type?.entry?.kind === 'server' && type.entry.open && this.servers.isReady(type.id)) {
      this.servers.call(type, 'POST', TYPE_SERVER_ROUTES.close, { id: record.id }).catch(() => undefined);
    }
  }

  /** A static entry's artifact folder: what changed goes out as `artifacts/changed` with the paths. */
  private watchFolder(record: ArtifactRecord): void {
    if (this.watchers.has(record.id)) return;
    const changed = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const watcher = watch(record.root, { recursive: true, persistent: false }, (_event, name) => {
        const rel = String(name ?? '').split(sep).join('/');
        if (!rel || rel.split('/').some((part) => part.startsWith('.'))) return;
        changed.add(rel);
        clearTimeout(timer);
        timer = setTimeout(() => {
          const paths = [...changed];
          changed.clear();
          this.contentStamps.delete(record.root);
          this.broadcast({ type: 'artifacts/changed', id: record.id, paths });
        }, 150);
      });
      watcher.on('error', () => this.unwatch(record.id));
      this.watchers.set(record.id, { watcher, stop: () => clearTimeout(timer) });
    } catch {
      /* a folder that is not there (yet) */
    }
  }

  private unwatch(id: string): void {
    const have = this.watchers.get(id);
    if (!have) return;
    this.watchers.delete(id);
    have.stop();
    have.watcher.close();
  }

  /** A static entry: the type folder at `/`, the artifact folder at `/_root/`, read only. */
  private staticEntry(req: IncomingMessage, res: ServerResponse, id: string, url: URL): void {
    req.resume();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const record = this.store.get(id);
    const type = record ? this.typeOf(record) : null;
    if (!record || type?.entry?.kind !== 'static') return this.notFound(req, res);
    // Made with another type of the same id (typeUid): not served by this one's page.
    if (typeMismatch(record, type)) return this.notFound(req, res);
    // The Shell's frame address visited as a page of its own (copied, opened from history): the Shell shows it. The
    // bare address (`page_url`, "Open in new tab") stays the page without the Shell.
    if (req.method === 'GET' && req.headers['sec-fetch-dest'] === 'document' && url.searchParams.has(SHELL_PARAMS.shell)) {
      res.writeHead(302, { Location: this.origin + shellPath(id), 'Cache-Control': 'no-store' }).end();
      return;
    }
    const page = this.pages.get(id);
    if (page) page.lastUsed = Date.now();
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return this.notFound(req, res);
    }
    if (rel.includes('\0')) return this.notFound(req, res);
    let base = type.dir;
    if (rel === '/_root' || rel.startsWith('/_root/')) {
      base = record.root;
      rel = rel.slice('/_root'.length);
    } else if (rel === '/' || rel === '') rel = `/${type.entry.file}`;
    const parts = rel.split('/').filter(Boolean);
    // Dot files (.artifact.json, .git, a server's state) are nobody's page.
    if (parts.some((part) => part.startsWith('.'))) return this.notFound(req, res);
    let file: string;
    try {
      file = parts.length ? inside(resolve(base), parts.join('/')) : resolve(base);
    } catch {
      return this.notFound(req, res);
    }
    // A link in the type's folder or the artifact's to a file outside it is nobody's page either.
    if (existsSync(file) && !realInside(base, file)) return this.notFound(req, res);
    // A restricted type's page (installed, or a project not trusted yet) reaches its own origin and the origins its
    // manifest lists, nothing else.
    if (!type.trusted) res.setHeader('Content-Security-Policy', installedTypeCsp(type.network));
    this.sendFile(req, res, file, 'no-cache');
  }

  /**
   * `artifact.archive`: the artifact's folder as a zip, passed on from its
   * type server's `/__open-artifact/archive` as it streams (`HEAD`: the
   * headers, or 413 for a folder too large to zip). A static type's folder is
   * zipped here. A type without a server, or whose server has no such route,
   * answers `unsupported`.
   */
  private async sendArchive(req: IncomingMessage, res: ServerResponse, record: ArtifactRecord): Promise<void> {
    // A static type has no server: the daemon zips the folder itself, with the same rules.
    if (this.typeOf(record)?.entry?.kind === 'static') {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return sendFolderArchive(req, res, record.root);
    }
    const head = req.method === 'HEAD';
    const answer = await this.archiveAnswer(record, head ? 'HEAD' : 'GET');
    const headers: Record<string, string> = { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const disposition = answer.headers.get('content-disposition');
    if (disposition) headers['Content-Disposition'] = disposition;
    if (head || !answer.body) {
      void answer.body?.cancel();
      res.writeHead(200, headers).end();
      return;
    }
    res.writeHead(200, headers);
    const body = Readable.fromWeb(answer.body as Parameters<typeof Readable.fromWeb>[0]);
    res.on('close', () => {
      if (!res.writableFinished) body.destroy();
    });
    body.on('error', () => res.destroy());
    body.pipe(res);
  }

  /** The type server's answer to `/__open-artifact/archive` for the artifact, refused answers thrown. */
  private async archiveAnswer(record: ArtifactRecord, method: 'GET' | 'HEAD', timeoutMs?: number): Promise<Response> {
    const type = this.typeOf(record);
    const entry = type?.entry;
    const unsupported = (): OpenArtifactError => new OpenArtifactError('unsupported', `${type?.title ?? record.type} folders cannot be zipped here.`);
    if (!type || !entry || entry.kind === 'static') throw unsupported();
    await this.openPage(record);
    const answer = await this.servers.fetchRaw(type, method, TYPE_SERVER_ROUTES.archive, { id: record.id }, timeoutMs);
    if (!answer.ok) {
      // A remote type's error body is read up to a cap (remote-archive.ts); a local one's as before.
      const body = typeLocation(type).remote ? await remoteErrorBody(type, answer) : ((await answer.json().catch(() => null)) as { code?: unknown; message?: unknown } | null);
      if (answer.status === 404 || answer.status === 405) throw unsupported();
      const code = typeof body?.code === 'string' ? body.code : answer.status === 413 ? 'too_large' : 'server_failed';
      throw new OpenArtifactError(code, typeof body?.message === 'string' ? body.message : `${type.id}: the zip answered ${answer.status}.`, { status: answer.status });
    }
    return answer;
  }

  /** The artifact's folder as a zip, made by its type server with the export's rules (what Link publishes). */
  private async archiveBytes(record: ArtifactRecord): Promise<Uint8Array> {
    if (this.typeOf(record)?.entry?.kind === 'static') return zipBytes(await archiveEntries(record.root));
    const answer = await this.archiveAnswer(record, 'GET', 300_000);
    const type = this.typeOf(record);
    // Held in memory whole: capped for a type on another computer (remote-archive.ts).
    if (type && typeLocation(type).remote) return remoteArchiveBytes(type, answer);
    return new Uint8Array(await answer.arrayBuffer());
  }

  /** The artifact's LAN sharing, through its type server's `/__open-artifact/share`. */
  private async shareOf(record: ArtifactRecord): Promise<ShareAccess> {
    const type = this.typeOf(record);
    const entry = type?.entry;
    if (type && entry && entry.kind !== 'static' && entry.share) {
      // The server knows the artifact once it opened it (again, if it restarted since).
      await this.openPage(record);
      return {
        view: () => this.servers.call<ShareView>(type, 'GET', TYPE_SERVER_ROUTES.share, undefined, { id: record.id }),
        update: (change) => {
          const request: ShareRequest = { id: record.id, ...change };
          return this.servers.call<ShareView>(type, 'POST', TYPE_SERVER_ROUTES.share, request);
        },
      };
    }
    throw new OpenArtifactError('unsupported', `${type?.title ?? record.type} pages cannot be shared on the network.`);
  }

  // ---- Type API: what the type servers this daemon started call back ------------------------------------------------

  /** The Type API token of a type (`OPEN_ARTIFACT_TYPE_TOKEN`). */
  typeToken(typeId: string): string {
    let token = this.typeTokens.get(typeId);
    if (!token) {
      token = `oat_${randomBytes(24).toString('base64url')}`;
      this.typeTokens.set(typeId, token);
      this.tokenTypes.set(token, typeId);
    }
    return token;
  }

  private presenceOf(record: ArtifactRecord): TypeApiPresence {
    const live = this.harnesses.statusOf(record.owner);
    return {
      presence: live.live ? 'online' : record.owner ? 'offline' : 'none',
      canSend: true,
      canSendSession: !!record.owner,
      busy: live.live && live.status === 'running',
      agentName: this.agentNameOf(record),
      wakesIdle: this.harnesses.wakesIdle(record.owner?.harness),
    };
  }

  private typeEvent(event: LibraryEvent): void {
    for (const client of this.typeEventClients) {
      const send = (e: TypeApiEvent): void => void client.res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      if (event.type === 'artifacts/changed' && client.ids.has(event.id)) {
        const record = this.store.get(event.id);
        send(record ? { type: 'artifact', id: event.id, title: record.title } : { type: 'artifact', id: event.id, removed: true });
      } else if (event.type === 'harness/changed' || event.type === 'wake/state') {
        for (const id of client.ids) {
          if (event.type === 'wake/state' && event.artifactId !== id) continue;
          const record = this.store.get(id);
          if (record) send({ type: 'presence', id, ...this.presenceOf(record) });
        }
      }
    }
  }

  private async typeApi(req: IncomingMessage, res: ServerResponse, name: string, url: URL): Promise<void> {
    const auth = String(req.headers.authorization ?? '');
    const typeId = auth.startsWith('Bearer ') ? this.tokenTypes.get(auth.slice(7)) : undefined;
    if (!typeId || !isLoopback(req.socket.remoteAddress)) {
      req.resume();
      return sendJson(res, 401, { code: 'not_granted', message: 'The Type API takes the OPEN_ARTIFACT_TYPE_TOKEN of a server this daemon started.' });
    }
    const get = req.method === 'GET';
    const body = get ? {} : await readJsonBody(req);
    if (get) req.resume();
    const theirs = (raw: unknown): ArtifactRecord => {
      const id = artifactIdOf(String(raw ?? ''));
      const record = id ? this.store.get(id) : null;
      // Another type's artifact is as good as none.
      if (!record || record.type !== typeId) throw new OpenArtifactError('not_found', `No artifact ${String(raw)} of type ${typeId}.`);
      return record;
    };
    switch (name) {
      case TYPE_API_ROUTES.artifact: {
        const record = theirs(url.searchParams.get('id'));
        const answer: TypeApiArtifact = {
          id: record.id,
          url: artifactUrl(record.id),
          root: record.root,
          title: record.title,
          owner: record.owner ? { label: `${record.owner.harness}${record.owner.session ? ` · ${record.owner.session}` : ''}`, harness: record.owner.harness } : null,
          agentName: this.agentNameOf(record),
          view_url: this.viewUrl(record.id),
          // The type server serves a read-only artifact's pages as a viewer's (release-guard.ts).
          ...releaseView(record, this.typeOf(record)?.version ?? null),
        };
        return sendJson(res, 200, answer);
      }
      case TYPE_API_ROUTES.wake: {
        const request = body as Partial<TypeApiWakeRequest>;
        const record = theirs(request.id);
        const threads = Array.isArray(request.threads) ? request.threads.filter((t): t is WakeThread => !!t && typeof t === 'object' && !!t.id) : [];
        const requests = Array.isArray(request.requests) ? request.requests.filter((r) => !!r && typeof r === 'object' && typeof r.text === 'string') : [];
        if (!threads.length && !requests.length) throw new OpenArtifactError('invalid_argument', 'wake needs threads or requests.');
        const waits: Array<Promise<WakeResult>> = [
          ...threads.map((thread) => this.wake.queue(record.id, { thread })),
          ...requests.map((r) => this.wake.queue(record.id, { request: { ...r, id: r.id ?? `req_${Date.now().toString(36)}` } as WakeRequestItem })),
        ];
        const result = (await Promise.all(waits)).at(-1)!;
        const status: WakeStatus =
          result.via === 'live' ? (result.status === 'resumed' ? 'resumed' : result.status === 'failed' ? 'failed' : 'delivered') : result.via === 'wait' ? 'delivered' : result.via === 'inbox' ? 'inbox' : 'failed';
        // Drafted stays `delivered` for pages older than the field; `drafted` lets a newer one say so.
        const answer: TypeApiWakeResult = { status, via: result.via, ...(result.via === 'live' && result.status === 'drafted' ? { drafted: true as const } : {}) };
        return sendJson(res, 200, answer);
      }
      case TYPE_API_ROUTES.presence:
        return sendJson(res, 200, this.presenceOf(theirs(url.searchParams.get('id'))));
      case TYPE_API_ROUTES.events: {
        const ids = new Set(
          String(url.searchParams.get('ids') ?? '')
            .split(',')
            .filter(Boolean)
            .map((raw) => theirs(raw).id),
        );
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': open-artifact\n\n');
        const client: TypeEventClient = { res, typeId, ids };
        this.typeEventClients.add(client);
        for (const id of ids) {
          const record = this.store.get(id);
          if (record) res.write(`event: presence\ndata: ${JSON.stringify({ type: 'presence', id, ...this.presenceOf(record) })}\n\n`);
        }
        // The response's close: the request's fires once its (empty) body is read.
        res.on('close', () => this.typeEventClients.delete(client));
        return;
      }
      case TYPE_API_ROUTES.touch: {
        const record = theirs(body.id);
        const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
        this.contentStamps.delete(record.root);
        const author = String(body.author ?? '');
        const patch: Partial<ArtifactRecord> = {};
        if (title && title !== record.title) patch.title = title;
        const paths = Array.isArray(body.paths) ? body.paths.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
        // Page writes while the agent's write action runs are the agent's doing, not the person's.
        if (author && author !== 'agent' && !this.isAgentActing(record.id)) {
          const at = new Date().toISOString();
          patch.lastUserEditAt = at;
          if (paths.length) patch.userEdits = userEditsAfter(record, paths, at);
        }
        if (Object.keys(patch).length) this.store.update(record.id, patch);
        this.broadcast({ type: 'artifacts/changed', id: record.id, author, paths });
        return sendJson(res, 200, { ok: true });
      }
      case TYPE_API_ROUTES.context: {
        // The owner's view context changed: adapters hear of it (throttled), and read it with view.context.
        const record = theirs(body.id);
        this.harnesses.contexts.noted(record.id, typeof body.at === 'string' ? body.at : new Date().toISOString());
        return sendJson(res, 200, { ok: true });
      }
      case TYPE_API_ROUTES.task: {
        // Long actions report here: progress is logged; the end goes to the agent that started the action.
        const report = body as Partial<TypeApiTask>;
        const task = typeof report.task === 'string' ? report.task.slice(0, 200) : '';
        if (!task) throw new OpenArtifactError('invalid_argument', 'task needs the task id.');
        const error = report.error === undefined || report.error === null ? '' : typeof report.error === 'string' ? report.error : JSON.stringify(report.error);
        this.log(`type ${typeId} task ${task}: ${report.done ? 'done' : 'progress'}${error ? ` (error ${error.slice(0, 200)})` : ''}`);
        if (report.done) this.taskEnded(typeId, { ...report, task } as TypeApiTask);
        return sendJson(res, 200, { ok: true });
      }
      default:
        throw new OpenArtifactError('not_found', `No Type API call ${name}.`);
    }
  }

  // ---- Library API ------------------------------------------------------------------------------------------------

  private async api(req: IncomingMessage, res: ServerResponse, name: string, url: URL): Promise<void> {
    // `type.*` is the Type API (a type server's token), except `type.icon`: a Library read the home page makes.
    if (name.startsWith('type.') && name !== TYPE_ICON_ROUTE) {
      try {
        return await this.typeApi(req, res, name.slice('type.'.length), url);
      } catch (error) {
        if (!res.headersSent) sendJson(res, statusOf(error), errorBody(error));
        return;
      }
    }
    // HEAD reads as GET does (node leaves the body out).
    const get = req.method === 'GET' || req.method === 'HEAD';
    if (!get && !this.writeAllowed(req)) {
      req.resume();
      return sendJson(res, 403, { code: 'not_granted', message: 'Writes come from this origin (JSON) or carry the daemon token.' });
    }
    if (get) req.resume();
    try {
      await this.libraryCall(req, res, name, url, get);
    } catch (error) {
      if (!res.headersSent) sendJson(res, statusOf(error), errorBody(error));
    }
  }

  private async libraryCall(req: IncomingMessage, res: ServerResponse, name: string, url: URL, get: boolean): Promise<void> {
    const R = LIBRARY_ROUTES;
    switch (name) {
      case R.artifacts: {
        const type = url.searchParams.get('type');
        const harness = url.searchParams.get('harness');
        const list = this.store.list().filter((a) => (!type || a.type === type) && (!harness || a.owner?.harness === harness));
        return sendJson(res, 200, { artifacts: list.map((a) => this.artifactView(a)) });
      }
      case R.artifact: {
        const record = this.store.require(url.searchParams.get('id'));
        const detail: ArtifactDetail = { ...this.artifactView(record), bytes: this.folderBytes(record.root) };
        return sendJson(res, 200, detail);
      }
      case R.boot: {
        // The Shell's finished boot: joins the open its page started; `fresh=1` (the frame was refused) opens again.
        if (!get) throw new OpenArtifactError('invalid_argument', `${R.boot} is a read (GET).`);
        const record = this.store.require(url.searchParams.get('id'));
        return sendJson(res, 200, await this.shellBoot(record, req, { reuse: url.searchParams.get('fresh') !== '1' }));
      }
      case R.types: {
        const workspace = url.searchParams.get('workspace') || undefined;
        const answer: TypesResponse = {
          roots: this.types.roots(workspace).map((r) => ({ scope: r.scope, dir: r.root })),
          types: this.types.list(workspace, { includeShadowed: true }).map((t) => this.typeView(t)),
          projects: this.projectTypes(workspace),
        };
        return sendJson(res, 200, answer);
      }
      case TYPE_ICON_ROUTE: {
        const type = this.types.get(String(url.searchParams.get('id') ?? ''), url.searchParams.get('workspace') || undefined);
        if (!type?.icon) throw new OpenArtifactError('not_found', 'No icon.');
        return this.sendFile(req, res, inside(type.dir, type.icon), 'no-cache');
      }
      case R.typesNew:
      case R.typesCheck:
      case R.typesFrom:
      case R.typesEnable:
      case R.typesDisable:
      case R.typesTrust:
      case R.typesPreview:
      case R.typesInstall:
      case R.typesUninstall:
      case R.typesUpdate:
      case R.typesPublish:
      case R.typesUnpublish:
      case R.import:
        return this.typesCall(req, res, name, get);
      case R.harnesses:
        return sendJson(res, 200, this.harnesses.info());
      case R.embed: {
        // Where pages are served from, and the origins hosts embed the Shell from (the Shell answers only those).
        const answer: EmbedResponse = { ...this.harnesses.embed.origins(), hosts: this.harnesses.embed.hostOrigins() };
        return sendJson(res, 200, answer);
      }
      case R.view:
        return this.viewChannel(req, res, url, get);
      case R.events: {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': hello\n\n');
        this.eventClients.add(res);
        // The response's close: the request's fires once its (empty) body is read.
        res.on('close', () => this.eventClients.delete(res));
        return;
      }
      case R.share: {
        const body = get ? {} : await readJsonBody<ShareRequest & { url?: string }>(req);
        const record = this.store.require(get ? url.searchParams.get('id') : (body.id ?? body.url));
        const access = await this.shareOf(record);
        if (get) return sendJson(res, 200, await access.view());
        // The type server checks each part; this passes on only what has the right shape.
        const change: Omit<ShareRequest, 'id'> = {
          ...(typeof body.lan === 'boolean' ? { lan: body.lan } : {}),
          ...(body.links && typeof body.links === 'object' && !Array.isArray(body.links) ? { links: body.links } : {}),
          ...(Array.isArray(body.reset) ? { reset: body.reset } : {}),
          ...(body.guests && typeof body.guests === 'object' && !Array.isArray(body.guests) ? { guests: body.guests } : {}),
        };
        const view = await access.update(change);
        this.broadcast({ type: 'artifacts/changed', id: record.id });
        return sendJson(res, 200, view);
      }
      case R.archive:
        return this.sendArchive(req, res, this.store.require(url.searchParams.get('id')));
      case R.thumbnail: {
        const record = this.store.require(url.searchParams.get('id'));
        if (get) {
          let image: Buffer;
          try {
            image = readFileSync(this.thumbnailFile(record.id));
          } catch {
            throw new OpenArtifactError('not_found', 'No thumbnail yet.');
          }
          // The address carries the content stamp (v=), so a new picture is a new address.
          res
            .writeHead(200, {
              'Content-Type': 'image/jpeg',
              'Cache-Control': url.searchParams.get('v') ? 'private, max-age=31536000, immutable' : 'no-store',
              'Content-Length': image.length,
            })
            .end(image);
          return;
        }
        const image = await readBody(req, 4 << 20);
        if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) throw new OpenArtifactError('invalid_argument', 'The body is not a JPEG.');
        const v = url.searchParams.get('v') || this.contentAt(record);
        ensureDir(files.thumbnails());
        writeFileSync(this.thumbnailFile(record.id), image);
        writeJson(join(files.thumbnails(), `${record.id}.json`), { v, at: new Date().toISOString() });
        return sendJson(res, 200, { thumbnail: v });
      }
      case R.restore: {
        const body = await readJsonBody<{ id: string }>(req);
        const record = this.store.restore(artifactIdOf(body.id));
        if (!record) throw new OpenArtifactError('not_found', 'Nothing to restore.');
        return sendJson(res, 200, this.artifactView(record));
      }
      case R.open: {
        const body = await readJsonBody<{ id: string; url: string; host: boolean }>(req);
        const record = this.touchOpened(this.store.require(body.id ?? body.url));
        const page = await this.openPage(record, { lang: langOf(req) });
        const shown =
          body.host !== false && record.owner
            ? await this.harnesses.hostOpen(record.owner, { url: artifactUrl(record.id), view_url: this.viewUrl(record.id), title: record.title })
            : false;
        return sendJson(res, 200, { view_url: this.viewUrl(record.id), page: page.page, page_url: page.page_url, shownInHarness: shown });
      }
      case R.preview: {
        // Start its page without counting as an opening and without the Shell (for thumbnails); the idle sweep stops it.
        const body = await readJsonBody<{ id: string; url: string }>(req);
        const record = this.store.require(body.id ?? body.url);
        const page = await this.openPage(record, { lang: langOf(req) });
        return sendJson(res, 200, { page_url: page.page_url, view_url: this.viewUrl(record.id) });
      }
      case R.create: {
        // From the home page: a type and a title, no session. The artifact belongs to nobody until an agent adopts it.
        const body = await readJsonBody<CreateArtifactRequest>(req);
        const typeId = String(body.type ?? '').replace(/^open-artifact:\/\/type\//, '');
        if (!typeId) throw new OpenArtifactError('invalid_argument', 'type: the type id (or open-artifact://type/<id>) to create from.');
        const folder = typeof body.folder === 'string' && body.folder.trim() ? body.folder.trim() : undefined;
        if (folder && !isAbsolute(folder) && !folder.startsWith('~')) throw new OpenArtifactError('invalid_argument', 'folder: an absolute path (or ~/...).');
        const caller: SessionRef = { harness: 'open-artifact-home', session: null, workspace: this.settings.homeWorkspace };
        const made = await this.tools.call(
          'Artifact',
          { action: 'publish', type_url: `open-artifact://type/${typeId}`, title: String(body.title ?? '').slice(0, 200), ...(folder ? { folder: expandHome(folder) } : {}) },
          caller,
        );
        if (made.error) return sendJson(res, statusOf(new OpenArtifactError(made.error.code, made.error.message)), made.error);
        const record = this.store.update(artifactIdOf(made.url)!, { owner: null, createdBy: null });
        const view = this.artifactView(record);
        return sendJson(res, 201, { ...view, prompt: body.prompt ? `${body.prompt}\n\n${takeOverPrompt(record, view.typeTitle)}` : takeOverPrompt(record, view.typeTitle) });
      }
      case R.update: {
        const body = await readJsonBody<UpdateArtifactRequest & { url: string }>(req);
        const record = this.store.require(body.id ?? body.url);
        const patch: Partial<ArtifactRecord> = {};
        if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
        if (typeof body.pinned === 'boolean') patch.pinnedAt = body.pinned ? new Date().toISOString() : null;
        return sendJson(res, 200, this.artifactView(this.store.update(record.id, patch)));
      }
      case R.duplicate: {
        const body = await readJsonBody<{ id: string; url: string; name?: string }>(req);
        return sendJson(res, 201, this.artifactView(await this.duplicate(this.store.require(body.id ?? body.url), body.name)));
      }
      case R.delete: {
        const body = await readJsonBody<{ id: string; url: string }>(req);
        const record = this.store.require(body.id ?? body.url);
        this.store.remove(record.id);
        return sendJson(res, 200, { deleted: record.id, folderKept: record.root });
      }
      case R.ask: {
        const body = await readJsonBody<AskRequest & { url: string }>(req);
        const record = this.store.require(body.id ?? body.url);
        if (typeof body.text !== 'string' || !body.text.trim()) throw new OpenArtifactError('invalid_argument', 'text: what to ask.');
        const result = await this.wake.ask(record.id, body.text.trim().slice(0, 4000), typeof body.label === 'string' ? body.label : undefined);
        return sendJson(res, 200, result);
      }
      case R.adopt: {
        const body = await readJsonBody<Record<string, unknown> & { caller?: Partial<SessionRef> }>(req);
        const { caller, ...args } = body;
        const result = await this.tools.call('Artifact', { ...args, action: 'adopt' }, caller ?? {});
        return sendJson(res, result.error ? statusOf(new OpenArtifactError(result.error.code, result.error.message)) : 200, result);
      }
      case R.tools: {
        // For an adapter without a WebSocket: the tools' schemas and the always-on note.
        const workspace = url.searchParams.get('workspace') || undefined;
        return sendJson(res, 200, { tools: this.tools.definitions(workspace), instructions: this.tools.instructions(workspace) });
      }
      case 'tools.call': {
        const body = await readJsonBody<{ name: string; arguments: Record<string, unknown>; caller: Partial<SessionRef> }>(req);
        return sendJson(res, 200, await this.tools.call(String(body.name ?? ''), body.arguments ?? {}, body.caller ?? {}));
      }
      case 'hook': {
        // A harness hook (`open-artifact hook <event>`): remember the session and its processes, hand it what waited
        // (unless `take: false`: a later hook of the same turn hands it over).
        const body = await readJsonBody<{ harness: string; session: string; workspace: string; pids: number[]; take?: boolean }>(req);
        const ref: SessionRef = { harness: String(body.harness ?? 'mcp'), session: body.session || null, workspace: body.workspace || null };
        for (const pid of Array.isArray(body.pids) ? body.pids : []) this.harnesses.registerPid(Number(pid), ref);
        this.harnesses.remember(ref);
        const keys = [sessionKeyOf(ref), sessionKeyOf({ harness: ref.harness, session: null, workspace: ref.workspace })].filter((k): k is string => !!k);
        if (body.take === false) return sendJson(res, 200, { messages: [] });
        const messages = [...new Set(keys)].flatMap((key) => this.inbox.take(key)).map((m) => m.text);
        return sendJson(res, 200, { messages });
      }
      case 'session.resolve': {
        // Which session a hook registered for these processes (an MCP bridge asks for its own, to watch its wakes).
        const body = await readJsonBody<{ pids?: number[]; harness?: string; workspace?: string | null }>(req);
        const pids = (Array.isArray(body.pids) ? body.pids : []).map(Number).filter((n) => n > 1);
        const harness = typeof body.harness === 'string' ? body.harness : undefined;
        const workspace = typeof body.workspace === 'string' && body.workspace ? body.workspace : null;
        const session = this.harnesses.byPid(pids, harness) ?? (harness ? this.harnesses.recentSession(harness, workspace) : null);
        return sendJson(res, 200, { session });
      }
      case 'remotes':
        return sendJson(res, 200, { remotes: this.link.status(), cloud: this.link.cloudStatus(), ...(this.link.presetProblem ? { presetProblem: this.link.presetProblem } : {}) });
      case 'cloud.settings': {
        // A person's choice (the CLI's `remote default` / `remote auto`, the Share panel): never an agent tool.
        const body = await readJsonBody<{ default: string | null; publish: 'auto' | 'manual' }>(req);
        const patch: { default?: string | null; publish?: 'auto' | 'manual' } = {};
        if (body.default === null || typeof body.default === 'string') patch.default = body.default || null;
        if (body.publish !== undefined) patch.publish = body.publish;
        const cloud = this.link.setCloud(patch);
        const said = [
          ...(patch.default !== undefined ? [patch.default ? `default site ${patch.default}` : 'no default site'] : []),
          ...(patch.publish ? [`automatic publishing ${patch.publish === 'auto' ? 'on' : 'off'}`] : []),
        ];
        if (said.length) this.log(`audit: ${said.join(', ')}, asked by ${this.askedBy(req, name)}`);
        return sendJson(res, 200, { cloud });
      }
      case 'remotes.add': {
        // Starts a device sign-in; the daemon polls the host. `remotes.add.wait` reports how it ends.
        // `browse: false`: the Shell shows the approval link itself, so no browser window is opened here.
        // `insecureHttp`: plain http to a host that is not on a private network (`remote add --insecure-http`).
        const body = await readJsonBody<{ name: string; host: string; browse: boolean; insecureHttp: boolean }>(req);
        const started = await this.link.signIn(String(body.name ?? ''), body.host, { browse: body.browse !== false, insecureHttp: body.insecureHttp === true });
        this.log(`audit: connecting the site ${String(body.name ?? '')} (${started.host}${body.insecureHttp === true ? ', --insecure-http' : ''}), asked by ${this.askedBy(req, name)}`);
        return sendJson(res, 200, started);
      }
      case 'remotes.add.cancel': {
        // The person cancelled the sign-in (the Share panel's Cancel): the daemon stops polling the host.
        const body = await readJsonBody<{ name: string }>(req);
        return sendJson(res, 200, this.link.cancelSignIn(String(body.name ?? '')));
      }
      case 'remotes.add.wait': {
        const body = await readJsonBody<{ name: string; ms: number }>(req);
        const ms = Math.min(Math.max(Number(body.ms) || 25_000, 0), 60_000);
        return sendJson(res, 200, await this.link.signInResult(String(body.name ?? ''), ms));
      }
      case 'remotes.remove': {
        const body = await readJsonBody<{ name: string; force: boolean }>(req);
        const removed = this.link.removeRemote(String(body.name ?? ''), body.force === true);
        this.log(`audit: removed the site ${removed.removed}${removed.unlinked.length ? ` (left local only: ${removed.unlinked.join(', ')})` : ''}, asked by ${this.askedBy(req, name)}`);
        return sendJson(res, 200, removed);
      }
      case 'artifacts.publish': {
        // A person's act (the CLI or the Share panel): publishes to a remote. `data: true` is the person's word that a
        // dashboard's rows go with it (the Share panel says so before its Publish); without it a dashboard whose data
        // was not confirmed goes up without rows, and the answer's `data` says so (the CLI then asks at a terminal).
        const body = await readJsonBody<{ id: string; url: string; folder: string; remote: string; adopt: boolean; data: boolean; withType: boolean }>(req);
        const folder = typeof body.folder === 'string' && body.folder ? resolve(expandHome(body.folder)) : null;
        let record = folder ? this.store.byRoot(folder) : this.store.require(body.id ?? body.url);
        // `adopt` (the CLI's publish <folder>): a folder that holds an artifact this daemon does not know yet is added
        // first, as Artifact {action:"adopt"} would; one that holds none stays refused.
        let adopted = false;
        if (!record && folder && body.adopt === true) {
          record = await this.adoptFolder(folder);
          adopted = record !== null;
        }
        if (!record) {
          throw new OpenArtifactError('not_found', `No artifact in ${body.folder}.`, {
            fix: `Give the artifact id, or the folder an artifact lives in. To make the folder an artifact first, adopt it with its type: open-artifact artifact '{"action":"adopt","folder":"${folder ?? body.folder}","type_url":"open-artifact://type/<type>"}' (open-artifact types lists them).`,
          });
        }
        let remote = typeof body.remote === 'string' ? body.remote : '';
        // Published already and no site named: the site it is on (publishing again is how the CLI adds its data).
        if (!remote && record.remote) remote = record.remote.name;
        if (!remote) {
          // None named: the default site (`settings.cloud.default`, or the only remote).
          const names = Object.keys(this.link.remotes.list());
          const chosen = this.link.defaultRemote();
          if (!chosen) {
            throw new OpenArtifactError('invalid_argument', names.length ? `Which remote? ${names.join(', ')}.` : 'No remote yet.', {
              fix: names.length ? 'Pass --remote <name>, or choose the default: open-artifact remote default <name>.' : 'Add one: open-artifact remote add <name> <https://host>.',
            });
          }
          remote = chosen;
        }
        const already = record.remote?.name === remote;
        // `withType` (the CLI's --with-type): the artifact's own type goes to the site's catalog first.
        if (body.withType === true && req.headers['x-open-artifact-agent']) {
          throw new OpenArtifactError('not_granted', 'Publishing a type to a site is for the person to decide: they run open-artifact publish <id> --with-type in their own terminal.', { status: 403 });
        }
        const next = await this.link.publish(record, remote, { withType: body.withType === true });
        const confirmsData = next.type === DATA_TYPE && body.data === true && next.dataPublish !== true;
        if (!already || confirmsData) {
          this.log(`audit: ${already ? 'confirmed the data of' : 'published'} ${next.id} to ${remote}${!already && confirmsData ? ' with its data' : ''}, asked by ${this.askedBy(req, name)}`);
        }
        if (confirmsData) void this.data.confirm(next.id, true).catch(() => undefined);
        const data = next.type === DATA_TYPE ? this.data.status(next.id) : null;
        return sendJson(res, 200, {
          url: artifactUrl(next.id),
          id: next.id,
          remote: next.remote?.name,
          view_url: next.remote?.url,
          ...(adopted ? { adopted: { type: next.type, title: next.title, root: next.root } } : {}),
          ...(data ? { data: { live: data.live, publish: data.publish || confirmsData } } : {}),
        });
      }
      case 'artifacts.data': {
        // A published dashboard's live data: how it stands; `publish` confirms (or takes back) that its data goes with
        // it; `refresh` runs its queries now. A person's act (the Share panel), never the agent's.
        const body = await readJsonBody<{ id: string; url: string; publish: boolean; refresh: boolean }>(req);
        const record = this.store.require(body.id ?? body.url);
        if (record.type !== DATA_TYPE) throw new OpenArtifactError('invalid_argument', `${artifactUrl(record.id)} is not a Data dashboard.`);
        if (typeof body.publish === 'boolean') {
          if (body.publish !== (record.dataPublish === true)) {
            this.log(`audit: ${body.publish ? 'confirmed publishing the data of' : 'stopped publishing the data of'} ${record.id}, asked by ${this.askedBy(req, name)}`);
          }
          await this.data.confirm(record.id, body.publish);
        }
        if (body.refresh === true) {
          const fresh = this.store.require(record.id);
          if (!this.data.eligible(fresh)) throw new OpenArtifactError('invalid_argument', fresh.remote ? 'Its data is not published: confirm publishing its data first.' : 'It is not published.');
          await this.data.refresh(record.id, { reason: 'asked here' });
        }
        return sendJson(res, 200, this.data.status(record.id));
      }
      case 'artifacts.unpublish': {
        const body = await readJsonBody<{ id: string; url: string }>(req);
        const record = this.store.require(body.id ?? body.url);
        const from = record.remote?.name;
        const next = await this.link.unpublish(record);
        this.log(`audit: unpublished ${next.id} from ${from}, asked by ${this.askedBy(req, name)}`);
        return sendJson(res, 200, { url: artifactUrl(next.id), id: next.id, view_url: this.viewUrl(next.id) });
      }
      case 'session.attach':
        return sendJson(res, 200, this.harnesses.pollAttach(await this.pollBody(req)));
      case 'session.wait': {
        const body = await this.pollBody(req);
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        return sendJson(res, 200, await this.harnesses.pollWait(body, abort.signal));
      }
      case 'session.status':
        return sendJson(res, 200, this.harnesses.pollStatus(await this.pollBody(req)));
      case 'session.detach':
        return sendJson(res, 200, this.harnesses.pollDetach(await this.pollBody(req)));
      default:
        throw new OpenArtifactError('not_found', `No /api/open-artifact.${name}.`);
    }
  }

  /** A polling call's body, with the harness from `X-Open-Artifact-Harness` when the body names none. */
  private async pollBody(req: IncomingMessage): Promise<PollParams> {
    const body = (await readJsonBody<PollParams>(req)) as PollParams;
    const header = req.headers['x-open-artifact-harness'];
    if (!body.harness && typeof header === 'string') body.harness = header;
    return body;
  }

  // ---- MCP --------------------------------------------------------------------------------------------------------

  private async mcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'DELETE') {
      req.resume();
      res.writeHead(200).end();
      return;
    }
    if (req.method !== 'POST') {
      req.resume();
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    // The bridge carries the token; a browser page cannot (it has no Authorization to give and its Origin is refused).
    if (!this.hasToken(req) || req.headers.origin !== undefined) {
      req.resume();
      return sendJson(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: run `open-artifact mcp`, which carries the daemon token.' } });
    }
    let body: McpMessage | McpMessage[];
    try {
      body = JSON.parse((await readBody(req)).toString('utf8')) as McpMessage | McpMessage[];
    } catch {
      return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const ui = uiFromRequest(req);
    const one = (message: McpMessage): Promise<McpReply | null> => {
      const caller = callerFromRequest(req, this.harnesses, message?.params?._meta);
      return handleMcp(message, { tools: this.tools, caller, version: VERSION, workspaceOf: (ref) => this.harnesses.workspaceOf(ref), ui, origin: this.origin });
    };
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(one))).filter((reply): reply is McpReply => reply !== null);
      if (out.length) return sendJson(res, 200, out);
      res.writeHead(202).end();
      return;
    }
    const out = await one(body);
    if (out) return sendJson(res, 200, out, { 'Mcp-Session-Id': 'open-artifact' });
    res.writeHead(202).end();
  }

  // ---- upgrades ---------------------------------------------------------------------------------------------------

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => undefined);
    this.lastActivity = Date.now();
    if (!this.hostAllowed(req) || !this.originOk(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname === HARNESS_PATH) {
      // Adapters are processes on this computer: a browser's Origin is not welcome here, nor is the network.
      if (req.headers.origin !== undefined || !isLoopback(req.socket.remoteAddress)) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      const ws = acceptWebSocket(req, socket, head, HARNESS_SUBPROTOCOL);
      if (ws) this.harnesses.accept(ws);
      return;
    }
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  }
}

/** Starts a daemon in this process (`open-artifact daemon run`, tests). */
export async function startDaemon(options: DaemonOptions = {}): Promise<Daemon> {
  const daemon = new Daemon(options);
  await daemon.start();
  return daemon;
}

/** Re-exported for callers that only import the daemon. */
export type { TypeInfo };
