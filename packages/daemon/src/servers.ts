/**
 * Type servers: URL entries and the local servers the daemon starts for
 * server entries. The daemon resolves an artifact's page here: a URL
 * template filled in, or `/__open-artifact/open` asked of the type's server (started
 * first when it is not running). One process per type, shared by all its
 * artifacts.
 *
 * Start-up follows the protocol: the server gets the `OPEN_ARTIFACT_*` variables, has
 * `READY_TIMEOUT_MS` to print its ready line, is probed every
 * `HEALTH_INTERVAL_MS`, counts as stopped after `HEALTH_MISSES` misses, and
 * is given up on after `MAX_RESTARTS` failed starts (with back-off between).
 */

import { randomBytes } from 'node:crypto';
import { createWriteStream, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  HEALTH_INTERVAL_MS,
  HEALTH_MISSES,
  MAX_RESTARTS,
  OPEN_ARTIFACT_PROTOCOL,
  OpenArtifactError,
  READY_TIMEOUT_MS,
  TYPE_SERVER_ROUTES,
  shellPath,
  type OpenRequest,
  type OpenResult,
  type ReadyLine,
  type ResolvedEntry,
  type TypeServerEnv,
  type TypeServerStatus,
} from '@open-artifact/protocol';
import { nodeChildren, startChild, type NodeChild, type NodeChildrenMode } from './node-children.ts';
import { ensureDir, files, readJson, writeJson } from './paths.ts';
import { isLoopbackUrl, typeLocation, type TypeInfo } from './types.ts';

const KILL_MS = 5_000;
const CALL_MS = 10_000;
/** How long {@link TypeServers.reach} waits for a remote type's address. */
const REACH_MS = 5_000;
/** How long the agent's action calls may take (a check of a big project, an upload, a snapshot); long ones answer at once with a task. */
export const ACTION_CALL_MS = 90_000;

/** Where a type server's files go under the daemon's home. */
export const serverFiles = {
  /** Last address and pid (`servers/<type>.json`), to reuse the port. */
  state: (type: string): string => join(files.servers(), `${type}.json`),
  /** The server's own state folder (`OPEN_ARTIFACT_STATE_DIR`). */
  stateDir: (type: string): string => join(files.servers(), type),
  log: (type: string): string => join(files.logs(), 'servers', `${type}.log`),
  /** The last action list the server gave (`servers/<type>.actions.json`). */
  actions: (type: string): string => join(files.servers(), `${type}.actions.json`),
};

/** One action a type server lists (`GET /__open-artifact/actions`). */
export interface TypeAction {
  name: string;
  title: string;
  description?: string;
  /** JSON Schema of `args`. */
  schema?: Record<string, unknown>;
  effect?: 'read' | 'write';
  long?: boolean;
}

/** An action name the agent may call: not empty, not reserved. */
export const ACTION_NAME = /^[a-z0-9_-][a-z0-9_.-]{0,63}$/i;

/** The entries of a `GET /__open-artifact/actions` answer that are well formed, reserved `open-artifact.*` ones left out. */
export function parseActions(raw: unknown): TypeAction[] {
  if (!Array.isArray(raw)) return [];
  const out: TypeAction[] = [];
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (typeof a.name !== 'string' || !ACTION_NAME.test(a.name) || a.name.startsWith('open-artifact.')) continue;
    const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    const description = text(a.description, 1000);
    out.push({
      name: a.name,
      title: text(a.title, 200) || a.name,
      ...(description ? { description } : {}),
      ...(a.schema && typeof a.schema === 'object' && !Array.isArray(a.schema) ? { schema: a.schema as Record<string, unknown> } : {}),
      ...(a.effect === 'read' || a.effect === 'write' ? { effect: a.effect } : {}),
      ...(a.long === true ? { long: true } : {}),
    });
  }
  return out;
}

/** What {@link serverFiles.actions} holds. */
interface ActionCache {
  stamp: string;
  /**
   * The server that gave the list: its pid, or `<daemon pid>:<thread id>` for one in a worker thread (`null`: a URL
   * entry or a server the daemon did not start).
   */
  pid: number | string | null;
  actions: TypeAction[];
}

/** Fills a URL template's `{id}`, `{lang}` and `{root}`. */
export function fillTemplate(template: string, values: { id: string; lang?: string | undefined; root: string }): string {
  return template.replace(/\{(id|lang|root)\}/g, (_, key: string) =>
    encodeURIComponent(key === 'id' ? values.id : key === 'lang' ? values.lang || 'en' : values.root),
  );
}

/** A route's address as an error names it: its path, and its origin too for a remote type (which computer failed). */
const where = (type: TypeInfo, url: URL): string => (typeLocation(type).remote ? `${url.origin}${url.pathname}` : url.pathname);

const withSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`);

/** The base of a URL template: what comes before its first placeholder, ending with `/`. */
export const templateBase = (template: string): string => withSlash(new URL(template.replace(/\{[a-z]+\}.*$/, '')).href);

/**
 * Why a fetch failed, in a few words: the network's code (`ECONNREFUSED`, `ENOTFOUND`), a timeout, or the message.
 * `fetch` itself only says "fetch failed".
 */
export function failureOf(error: unknown, timeoutMs?: number): string {
  const e = error as { name?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } } | null;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return timeoutMs ? `no answer within ${Math.round(timeoutMs / 1000)} s` : 'timed out';
  const cause = e?.cause;
  if (cause && typeof cause.code === 'string') return typeof cause.message === 'string' && cause.message ? `${cause.code}: ${cause.message}` : cause.code;
  if (cause && typeof cause.message === 'string' && cause.message) return cause.message;
  return typeof e?.message === 'string' ? e.message : String(error);
}

/**
 * The body of a request to a remote type ({@link typeLocation}): without `root`, the artifact's folder on this
 * computer. Every request the daemon sends a type goes through here.
 */
export function forRemote<T>(type: TypeInfo, body: T): T {
  if (!typeLocation(type).remote || !body || typeof body !== 'object' || Array.isArray(body) || !('root' in body)) return body;
  const { root: _root, ...rest } = body as Record<string, unknown>;
  return rest as T;
}

/**
 * The most a remote type's answer to a JSON route may be before the daemon parses it: 32 MiB, the size the daemon
 * itself takes in one MCP request. The built-in types' answers (a page of documents, a read of a doc or a sheet, an
 * export's text) stay well under it; a local type is not capped.
 */
export const REMOTE_ANSWER_MAX = 32 * 1024 * 1024;

/**
 * A redirect from a remote type is never followed: the daemon would send the request again, body and all, to an
 * address the other computer picked (one on this computer or the person's network). The error names the address that
 * answered with the redirect, not where it pointed.
 */
function refuseRedirect(type: TypeInfo, url: URL, response: Response): void {
  if (response.status < 300 || response.status > 399) return;
  void response.body?.cancel().catch(() => undefined);
  throw new OpenArtifactError('server_failed', `${type.id}: ${where(type, url)} answered with a redirect (${response.status}); a type on another computer is never followed elsewhere.`, {
    fix: "The type's address must answer its routes itself: ask its author, or use a type that runs on this computer.",
  });
}

/** A remote type's answer as text, refused past {@link REMOTE_ANSWER_MAX} without reading the rest. */
async function cappedText(type: TypeInfo, url: URL, response: Response, max = REMOTE_ANSWER_MAX): Promise<string> {
  const tooLarge = (): OpenArtifactError =>
    new OpenArtifactError('server_failed', `${type.id}: ${where(type, url)} answered more than ${Math.round(max / (1024 * 1024))} MiB; answers from a type on another computer are capped there.`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    void response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** What, changed, means a running server is stale (the type folder was updated or reinstalled). */
function stampOf(type: TypeInfo): string {
  let mtime = 0;
  try {
    mtime = statSync(join(type.dir, 'artifact-type.json')).mtimeMs;
  } catch {
    /* no manifest */
  }
  // Trust is in it: trusting a project (or no longer) starts its frame-host again, with or without the restrictions.
  return JSON.stringify([type.dir, type.version, mtime, type.entry, type.trusted]);
}

type ServerState = 'stopped' | 'starting' | 'ready';

interface Running {
  type: TypeInfo;
  stamp: string;
  child: NodeChild | null;
  base: string | null;
  secret: string | null;
  state: ServerState;
  starting: Promise<string> | null;
  failures: number;
  retryAt: number;
  error: string | null;
  misses: number;
}

/** Options of {@link TypeServers}. */
export interface TypeServersOptions {
  /** The daemon's base URL (`OPEN_ARTIFACT_DAEMON_URL`). */
  daemonUrl: () => string;
  /** The Type API token of a type (`OPEN_ARTIFACT_TYPE_TOKEN`). */
  tokenFor: (typeId: string) => string;
  log: (line: string) => void;
  /** A server started or stopped (its address came or went). */
  changed?: () => void;
}

/** A type's entry needs a server or URL to answer `/__open-artifact/*`. */
type RemoteEntry = Extract<ResolvedEntry, { kind: 'url' | 'server' }>;

const remoteEntry = (type: TypeInfo): RemoteEntry => {
  const entry = type.entry;
  if (!entry || entry.kind === 'static') throw new OpenArtifactError('unsupported', `${type.id} has no server.`);
  return entry;
};

/** The type servers of one daemon. */
export class TypeServers {
  private readonly options: TypeServersOptions;
  private readonly byType = new Map<string, Running>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly onExit: () => void;
  /** Servers in threads asked to stop and not ended yet ({@link drained}). */
  private readonly stopping = new Set<NodeChild>();
  private saidThreads = false;

  constructor(options: TypeServersOptions) {
    this.options = options;
    this.timer = setInterval(() => void this.checkHealth(), HEALTH_INTERVAL_MS);
    this.timer.unref?.();
    // A daemon that exits without closeAll() (a crash) does not leave its servers behind.
    this.onExit = () => this.killAll();
    process.on('exit', this.onExit);
  }

  /** What the type list shows about a type's server; `null` when it never started. */
  status(typeId: string): TypeServerStatus | null {
    const s = this.byType.get(typeId);
    if (!s) return null;
    const state: TypeServerStatus['state'] =
      s.state === 'ready' ? 'running' : s.state === 'starting' ? 'starting' : s.failures >= MAX_RESTARTS || s.error ? 'failed' : 'stopped';
    return {
      state,
      ...(s.base ? { url: s.base } : {}),
      ...(s.child?.pid ? { pid: s.child.pid } : {}),
      ...(s.error ? { error: s.error } : {}),
      restarts: s.failures,
    };
  }

  /** The servers that are up now: their type and address. */
  running(): Array<{ type: string; base: string }> {
    return [...this.byType.values()].filter((s) => s.state === 'ready' && s.base).map((s) => ({ type: s.type.id, base: s.base! }));
  }

  /** True when the type's server is up. */
  isReady(typeId: string): boolean {
    return this.byType.get(typeId)?.state === 'ready';
  }

  /** The artifact's page (absolute addresses): a URL template filled in, or `/__open-artifact/open` asked of the server. */
  async open(type: TypeInfo, record: { id: string; root: string; title: string }, context: { lang?: string; shell: string }): Promise<{ url: string; page_url: string }> {
    const entry = remoteEntry(type);
    if (entry.kind === 'url' && !entry.open) {
      const url = fillTemplate(entry.url, { id: record.id, lang: context.lang, root: record.root });
      return { url, page_url: url };
    }
    const base = await this.base(type);
    if (!entry.open) {
      // A server with a url template: the server is up, its page is the template filled in.
      const url = fillTemplate(entry.url!, { id: record.id, lang: context.lang, root: record.root });
      return { url, page_url: url };
    }
    // The Shell's own address on the same origin: a top-level visit to the framed page goes there. A remote type gets
    // no `root` (forRemote): the title, language and the Shell's address only, which its page sees anyway.
    const request: OpenRequest = { id: record.id, root: record.root, title: record.title, lang: context.lang || 'en', shell: context.shell, viewer: context.shell + shellPath(record.id) };
    const out = await this.call<Partial<OpenResult>>(type, 'POST', TYPE_SERVER_ROUTES.open, request);
    if (!out || typeof out.url !== 'string') throw new OpenArtifactError('server_failed', `${type.id}: ${TYPE_SERVER_ROUTES.open} returned no url.`);
    const url = new URL(out.url, base).href;
    const pageUrl = typeof out.page_url === 'string' ? new URL(out.page_url, base).href : url;
    return { url, page_url: pageUrl };
  }

  /** Calls one of the server's `/__open-artifact/*` routes with its secret. */
  async call<T = unknown>(type: TypeInfo, method: 'GET' | 'POST', route: string, body?: unknown, query?: Record<string, string>, timeoutMs = CALL_MS): Promise<T> {
    const base = await this.base(type);
    const secret = this.byType.get(type.id)?.secret;
    const url = new URL(route.replace(/^\//, ''), base);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    // Never a local path to another computer, whichever caller built the body.
    const sent = forRemote(type, body);
    const remote = typeLocation(type).remote;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { ...(secret ? { Authorization: `Bearer ${secret}` } : {}), ...(sent !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(sent !== undefined ? { body: JSON.stringify(sent) } : {}),
        // A remote type's redirect is refused, never followed (refuseRedirect).
        ...(remote ? { redirect: 'manual' as const } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new OpenArtifactError('server_failed', `${type.id}: ${where(type, url)} did not answer (${failureOf(error, timeoutMs)}).`);
    }
    if (remote) refuseRedirect(type, url, response);
    const text = remote ? await cappedText(type, url, response) : await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!response.ok) {
      const e = (json ?? {}) as { code?: unknown; message?: unknown; fix?: unknown; current?: unknown };
      throw new OpenArtifactError(typeof e.code === 'string' ? e.code : 'server_failed', typeof e.message === 'string' ? e.message : `${type.id}: ${where(type, url)} answered ${response.status}.`, {
        status: response.status,
        ...(typeof e.fix === 'string' && e.fix.trim() ? { fix: e.fix.trim().slice(0, 1000) } : {}),
        // A conflict's current state is data the caller merges with: it travels in its own field.
        ...(e.code === 'conflict' && e.current !== undefined ? { current: e.current } : {}),
      });
    }
    return json as T;
  }

  /**
   * Calls one of the server's `/__open-artifact/*` routes with its secret and
   * hands back the answer as it is, body unread (a download to pass on). The
   * timeout covers the wait for the headers only.
   */
  async fetchRaw(type: TypeInfo, method: 'GET' | 'HEAD', route: string, query?: Record<string, string>, timeoutMs = CALL_MS): Promise<Response> {
    const base = await this.base(type);
    const secret = this.byType.get(type.id)?.secret;
    const url = new URL(route.replace(/^\//, ''), base);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error('timed out')), timeoutMs);
    const remote = typeLocation(type).remote;
    let response: Response;
    try {
      response = await fetch(url, { method, headers: secret ? { Authorization: `Bearer ${secret}` } : {}, ...(remote ? { redirect: 'manual' as const } : {}), signal: abort.signal });
    } catch (error) {
      throw new OpenArtifactError('server_failed', `${type.id}: ${where(type, url)} did not answer (${failureOf(error, timeoutMs)}).`);
    } finally {
      clearTimeout(timer);
    }
    if (remote) refuseRedirect(type, url, response);
    return response;
  }

  /**
   * The type's actions (`GET /__open-artifact/actions`). The list is kept on disk until
   * the type changes and asked again when its server process changes. With
   * `start: false` a stopped server is not started: the kept list answers,
   * or `null` when there is none. `[]`: the type has no actions.
   */
  async actions(type: TypeInfo, options: { start?: boolean } = {}): Promise<TypeAction[] | null> {
    const entry = type.entry;
    if (!entry || entry.kind === 'static' || !entry.actions) return [];
    const stamp = stampOf(type);
    const kept = readJson<ActionCache | null>(serverFiles.actions(type.id), null);
    const cached = kept && kept.stamp === stamp && Array.isArray(kept.actions) ? kept : null;
    const pid = (): number | string | null => this.byType.get(type.id)?.child?.instance ?? null;
    const ready = entry.kind === 'url' || this.isReady(type.id);
    if (cached && (!ready || cached.pid === pid())) return cached.actions;
    if (!ready && options.start === false) return null;
    try {
      const out = await this.call<{ actions?: unknown }>(type, 'GET', TYPE_SERVER_ROUTES.actions.slice(0, -1));
      const actions = parseActions(out?.actions);
      try {
        writeJson(serverFiles.actions(type.id), { stamp, pid: pid(), actions } satisfies ActionCache);
      } catch {
        /* kept in memory only for this call */
      }
      return actions;
    } catch (error) {
      this.options.log(`server ${type.id}: ${TYPE_SERVER_ROUTES.actions.slice(0, -1)} failed (${(error as Error)?.message ?? error})`);
      return cached?.actions ?? null;
    }
  }

  /**
   * Checks that a remote type's address answers at all (any HTTP status will do), so creating an artifact of one that
   * cannot be reached fails at once and says why: which address, and what happened. Nothing about an artifact is
   * sent. Local types are not checked.
   */
  async reach(type: TypeInfo, timeoutMs = REACH_MS): Promise<void> {
    const location = typeLocation(type);
    if (!location.remote || type.entry?.kind !== 'url') return;
    const entry = type.entry;
    const probe = entry.open || entry.actions || entry.share ? new URL(TYPE_SERVER_ROUTES.health.replace(/^\//, ''), templateBase(entry.url)) : new URL(templateBase(entry.url));
    try {
      const response = await fetch(probe, { method: 'GET', signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      throw new OpenArtifactError('server_failed', `${type.title || type.id} lives at ${location.origin}, on another computer, and ${probe.href} could not be reached (${failureOf(error, timeoutMs)}).`, {
        fix: 'Check the network connection and that the address is right, then try again; or pick a type that runs on this computer (Artifact {action: "list", scope: "types"}: remote is false).',
      });
    }
  }

  /** The server's base address: the entry's url, or the one its process printed, starting it when needed. */
  async base(type: TypeInfo): Promise<string> {
    const entry = remoteEntry(type);
    if (entry.kind === 'url') return templateBase(entry.url);
    let s = this.byType.get(type.id);
    const stamp = stampOf(type);
    if (s && s.stamp !== stamp) {
      // The type folder changed: its server starts again from the new files.
      this.stop(type.id);
      s = undefined;
    }
    if (!s) {
      s = { type, stamp, child: null, base: null, secret: null, state: 'stopped', starting: null, failures: 0, retryAt: 0, error: null, misses: 0 };
      this.byType.set(type.id, s);
    }
    if (s.state === 'ready' && s.base) return s.base;
    if (s.starting) return s.starting;
    const log = serverFiles.log(type.id);
    if (s.failures >= MAX_RESTARTS) throw new OpenArtifactError('server_failed', `${type.id}: its server failed to start ${s.failures} times (${s.error}). See ${log}.`);
    if (Date.now() < s.retryAt) {
      throw new OpenArtifactError('server_failed', `${type.id}: its server failed (${s.error}); trying again in ${Math.ceil((s.retryAt - Date.now()) / 1000)} s. See ${log}.`);
    }
    const running = s;
    running.starting = this.launch(running)
      .then((started) => {
        // A new process: ask for its actions now, so the next read and create list them.
        if (type.entry?.kind !== 'static' && type.entry?.actions) setImmediate(() => void this.actions(type).catch(() => {}));
        return started;
      })
      .finally(() => {
        running.starting = null;
      });
    return running.starting;
  }

  private async launch(s: Running): Promise<string> {
    const { type } = s;
    // Trust is about the type's own program: frame-host (runtime `frame`) is the daemon's, and runs for any root.
    if (type.ownCode && !type.trusted) {
      throw new OpenArtifactError(
        'not_granted',
        type.scope === 'installed'
          ? `${type.id} is an installed type, and an installed type never starts a program of its own ("entry.start").`
          : `${type.id} is in a project folder that is not trusted yet; trust it to start its server.`,
      );
    }
    const entry = remoteEntry(type);
    // `url` with `start`: a server already running there (a developer's own) is used as it is.
    if (entry.url) {
      const base = templateBase(entry.url);
      if (await this.healthy(base, null)) {
        Object.assign(s, { base, state: 'ready', secret: null, child: null, error: null, misses: 0 });
        this.options.log(`server ${type.id}: using the one already at ${base}`);
        return base;
      }
    }
    try {
      const base = await this.spawn(s);
      s.failures = 0;
      return base;
    } catch (error) {
      s.failures += 1;
      s.error = (error as Error)?.message ?? String(error);
      s.retryAt = Date.now() + Math.min(60_000, 1000 * 2 ** (s.failures - 1));
      s.state = 'stopped';
      this.options.log(`server ${type.id}: ${s.error}`);
      throw new OpenArtifactError('server_failed', `${type.id}: its server did not start (${s.error}). See ${serverFiles.log(type.id)}.`);
    }
  }

  /** How a `node` server runs (`node-children.ts`); said once in the log when it is worker threads. */
  private nodeMode(): NodeChildrenMode {
    const choice = nodeChildren();
    if (choice.mode === 'threads' && !this.saidThreads) {
      this.saidThreads = true;
      this.options.log(`type servers run in worker threads of the daemon (${choice.detail})`);
    }
    return choice.mode;
  }

  private async spawn(s: Running): Promise<string> {
    const { type } = s;
    const entry = type.entry;
    if (entry?.kind !== 'server') throw new Error('not a server entry');
    const { start } = entry;
    const isNode = start.command === 'node';
    const mode = isNode ? this.nodeMode() : 'process';
    const last = readJson<{ port?: number } | null>(serverFiles.state(type.id), null);
    const secret = randomBytes(24).toString('base64url');
    ensureDir(dirname(serverFiles.log(type.id)));
    const stateDir = ensureDir(serverFiles.stateDir(type.id));
    const log = createWriteStream(serverFiles.log(type.id), { flags: 'a' });
    log.write(`\n--- ${new Date().toISOString()} start ${start.command} ${start.args.join(' ')}\n`);
    const openArtifactEnv: TypeServerEnv = {
      OPEN_ARTIFACT_PROTOCOL: String(OPEN_ARTIFACT_PROTOCOL),
      OPEN_ARTIFACT_TYPE: type.id,
      OPEN_ARTIFACT_TYPE_DIR: type.dir,
      OPEN_ARTIFACT_PORT: String(Number(last?.port) || 0),
      OPEN_ARTIFACT_SECRET: secret,
      OPEN_ARTIFACT_DAEMON_URL: this.options.daemonUrl(),
      OPEN_ARTIFACT_TYPE_TOKEN: this.options.tokenFor(type.id),
      OPEN_ARTIFACT_STATE_DIR: stateDir,
      OPEN_ARTIFACT_TYPE_SCOPE: type.scope,
      // Set by the daemon, after start.env (so neither the type nor the daemon's own environment decides it): frame-host
      // limits the page of a type of an untrusted root (installed, or a project not trusted yet) to its declared origins.
      OPEN_ARTIFACT_TYPE_RESTRICTED: type.trusted ? '0' : '1',
    };
    // `node` is this process's own runtime (startChild): a child process, or a worker thread with its own copy of `env`.
    const env: NodeJS.ProcessEnv = { ...process.env, ...start.env, ...openArtifactEnv };
    const readyMs = Number(process.env.OPEN_ARTIFACT_SERVER_READY_MS) || READY_TIMEOUT_MS;
    return new Promise((resolveReady, rejectReady) => {
      let child: NodeChild;
      try {
        child = startChild({ command: start.command, args: start.args, cwd: type.dir, env, mode, name: `open-artifact type server ${type.id}` });
      } catch (error) {
        log.end();
        rejectReady(error);
        return;
      }
      s.child = child;
      s.secret = secret;
      s.state = 'starting';
      let settled = false;
      let buffered = '';
      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stop(KILL_MS);
        rejectReady(new Error(message));
      };
      const timer = setTimeout(() => fail(`no ready line within ${readyMs / 1000} s`), readyMs);
      child.stderr?.pipe(log, { end: false });
      child.stdout?.on('data', (chunk: Buffer) => {
        log.write(chunk);
        if (settled) return;
        buffered += chunk.toString('utf8');
        let nl: number;
        while ((nl = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, nl).trim();
          buffered = buffered.slice(nl + 1);
          if (!line.startsWith('{')) continue;
          let message: Partial<ReadyLine>;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message?.openArtifact !== 'ready') continue;
          if (typeof message.url !== 'string' || !/^http:\/\//.test(message.url) || !isLoopbackUrl(message.url)) {
            fail(`its ready line has no loopback url: ${line.slice(0, 200)}`);
            return;
          }
          settled = true;
          clearTimeout(timer);
          const base = withSlash(message.url);
          Object.assign(s, { base, state: 'ready', error: null, misses: 0 });
          try {
            writeJson(serverFiles.state(type.id), { port: Number(new URL(base).port) || null, url: base, ...(child.pid ? { pid: child.pid } : { thread: child.instance }), at: new Date().toISOString() });
          } catch {
            /* the port is a suggestion */
          }
          this.options.log(`server ${type.id}: ready at ${base} (${child.label})`);
          this.options.changed?.();
          resolveReady(base);
          return;
        }
      });
      child.on('error', (error: Error) => fail(`could not run ${start.command}: ${error.message}`));
      child.on('exit', (code: number | null, signal: string | null) => {
        log.write(`--- exit ${code ?? signal}\n`);
        log.end();
        if (s.child === child) {
          s.child = null;
          const was = s.state === 'ready';
          if (was) this.options.log(`server ${type.id}: exited (${code ?? signal})`);
          s.state = 'stopped';
          s.base = null;
          if (was) this.options.changed?.();
        }
        fail(`it exited (${code ?? signal}) before it was ready`);
      });
    });
  }

  private async healthy(base: string, secret: string | null): Promise<boolean> {
    try {
      const response = await fetch(new URL(TYPE_SERVER_ROUTES.health.replace(/^\//, ''), base), {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { openArtifact?: unknown };
      return Number(body?.openArtifact) >= 1;
    } catch {
      return false;
    }
  }

  /** One health round: a server that misses `HEALTH_MISSES` probes in a row is stopped; the next open starts it again. */
  async checkHealth(): Promise<void> {
    for (const [id, s] of this.byType) {
      if (s.state !== 'ready' || !s.base) continue;
      if (await this.healthy(s.base, s.secret)) {
        s.misses = 0;
        continue;
      }
      s.misses += 1;
      if (s.misses >= HEALTH_MISSES) {
        this.options.log(`server ${id}: no health for ${s.misses} checks; stopping it`);
        this.stop(id);
      }
    }
  }

  /** The type folders changed: servers whose type changed or went away stop (the next open starts the new one). */
  typesChanged(lookup: (id: string, old: TypeInfo) => TypeInfo | null): void {
    for (const [id, s] of this.byType) {
      const now = lookup(id, s.type);
      if (!now || stampOf(now) !== s.stamp) {
        this.options.log(`server ${id}: its type changed; stopping it`);
        this.stop(id);
      }
    }
  }

  /** Stops a type's server. */
  stop(typeId: string): void {
    const s = this.byType.get(typeId);
    if (!s) return;
    this.byType.delete(typeId);
    if (s.child) this.stopChild(s.child);
    if (s.state === 'ready') this.options.changed?.();
  }

  /** Asks a server to stop (SIGTERM, or the same delivered to its thread), forced after `KILL_MS`. */
  private stopChild(child: NodeChild): void {
    if (child.ended) return;
    if (child.mode === 'threads') this.stopping.add(child);
    child.once('exit', () => this.stopping.delete(child));
    child.stop(KILL_MS);
  }

  /** This process is exiting: what still runs is asked to stop (a thread ends with the process anyway). */
  private killAll(): void {
    for (const s of this.byType.values()) if (s.child && !s.child.ended) s.child.stop(KILL_MS);
  }

  /**
   * Resolves once the servers that run in this process's threads have ended (after {@link closeAll}), or after
   * `timeoutMs`: the daemon waits for them before it exits, so each finishes its own clean-up as a process would. Child
   * processes are not waited for: they finish by themselves.
   */
  async drained(timeoutMs = KILL_MS + 1000): Promise<void> {
    const left = [...this.stopping].filter((child) => !child.ended);
    if (!left.length) return;
    await Promise.race([
      Promise.all(left.map((child) => new Promise((done) => (child.ended ? done(null) : child.once('exit', done))))),
      new Promise((done) => setTimeout(done, timeoutMs)),
    ]);
  }

  /** Stops every server. */
  closeAll(): void {
    clearInterval(this.timer);
    process.off('exit', this.onExit);
    for (const id of [...this.byType.keys()]) this.stop(id);
  }
}
