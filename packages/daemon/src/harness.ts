/**
 * The Harness API: adapters (plugins inside agent harnesses) connect over a
 * WebSocket at `/__harness` and speak JSON-RPC 2.0 both ways; adapters that
 * cannot hold a socket long-poll over HTTP instead (protocol `POLL_ROUTES`).
 *
 * - adapter → daemon: `hello`, `session.attach`, `session.status`,
 *   `session.detach`, `session.rename`, `tools.list`, `tools.call`,
 *   `agent.wrote`, `artifact.open`, `inbox.take`, `inbox.wait`, `subscribe`;
 * - daemon → adapter: `wake.deliver`, `host.open`, and `event`
 *   notifications after `subscribe`.
 *
 * The hub also keeps the harness profiles (`harnesses/<name>.json`): what the
 * daemon knows about a harness before its adapter connects.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  HARNESS_NAME,
  OpenArtifactError,
  RPC_ERRORS,
  rpcErrorCode,
  errorBody,
  type AdapterCaps,
  type AdapterInfo,
  type AdapterToDaemon,
  type AttachParams,
  type DaemonToAdapter,
  type HarnessEvent,
  type HarnessInfo,
  type HarnessesResponse,
  type HelloParams,
  type HelloResult,
  type InboxMessage,
  type OwnerStatus,
  type RpcRequest,
  type RpcResponse,
  type SessionParams,
  type SessionMay,
  type SessionRef,
  type SessionStatus,
  type ToolCallResult,
  type ToolDefinition,
  type WakeDeliverResult,
  type WakeDeliverStatus,
  type WakePayload,
} from '@open-artifact/protocol';
import type { Inbox } from './inbox.ts';
import { files, readJson, samePath, writeJson } from './paths.ts';
import { HARNESS_FEATURES, negotiateProtocol } from './harness-features.ts';
import { harnessProfile, saveAdapterProfile, sessionWorkspaceOf } from './harness-profiles.ts';
import { EMBED_METHODS, EmbedViews, handleEmbedCall } from './harness-embed.ts';
import { SKILL_METHODS, handleSkillCall } from './harness-skill.ts';
import { VIEW_METHODS, ViewContexts, handleViewCall } from './harness-view.ts';
import { sessionKeyOf } from './store.ts';
import type { WebSocketConnection } from './ws.ts';

/** How long the daemon waits for an adapter to answer a call, ms. */
const CALL_TIMEOUT_MS = 30_000;
/** How long a polling adapter counts as live after its last wait ended, ms. */
const POLL_GRACE_MS = Number(process.env.OPEN_ARTIFACT_POLL_GRACE_MS ?? 20_000);
/** The longest one poll is held open, ms. */
const POLL_MAX_MS = 60_000;
/** The longest `inbox.wait`, ms. */
const INBOX_WAIT_MAX_MS = 3_600_000;
/** How recently a hook or attach must have seen a session for a session-less MCP bridge to fall back to it, ms. */
const RECENT_SESSION_MS = 2 * 60 * 60_000;

function recentSessionMaxAgeMs(): number {
  const fromEnv = Number(process.env.OPEN_ARTIFACT_RECENT_SESSION_MS);
  return Number.isFinite(fromEnv) && process.env.OPEN_ARTIFACT_RECENT_SESSION_MS ? fromEnv : RECENT_SESSION_MS;
}

// ---- profiles ----------------------------------------------------------------------------------------------------

export { defaultProfile, harnessProfile, shippedProfilesDir } from './harness-profiles.ts';

/**
 * Opens a link in this computer's browser: `open` on macOS, `start` on Windows, `xdg-open` elsewhere. False where
 * there is no screen to open it on (Linux without a display) or `$OPEN_ARTIFACT_BROWSER` is `none`, `off` or `0`.
 */
export function systemBrowse(url: string): boolean {
  if (/^(none|off|0|false)$/i.test(process.env.OPEN_ARTIFACT_BROWSER ?? '')) return false;
  if (!/^https?:\/\//.test(url)) return false;
  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'win32' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  const [command, args] = platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// ---- connections -------------------------------------------------------------------------------------------------

/** `session.attach`'s `may`, kept when it is an object of booleans. */
function sessionMayOf(value: unknown): SessionMay | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const may: SessionMay = {};
  for (const key of ['create', 'modify', 'remove', 'reply'] as const) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === 'boolean') may[key] = field;
  }
  return may;
}

type DaemonCall = <M extends keyof DaemonToAdapter>(method: M, params: DaemonToAdapter[M]['params']) => Promise<DaemonToAdapter[M]['result']>;

/** An adapter's connection: a WebSocket or an HTTP poller. */
export interface AdapterConnection {
  readonly id: string;
  harness: string | null;
  caps: AdapterCaps;
  /** Said hello with the right token. */
  authed: boolean;
  /** Takes `event` notifications. */
  subscribed: boolean;
  readonly polling: boolean;
  /** Sessions attached through it, by key. */
  readonly sessions: Map<string, SessionRef>;
  /** Calls the adapter. */
  call: DaemonCall;
  /** Sends a notification. */
  notify(method: string, params: unknown): void;
  /** Fails pending calls and ends open waits. */
  close(): void;
  /** Closes the transport too. */
  terminate(code?: number): void;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A WebSocket adapter. */
class SocketConnection implements AdapterConnection {
  readonly id = randomBytes(6).toString('hex');
  harness: string | null = null;
  caps: AdapterCaps = {};
  authed = false;
  subscribed = false;
  readonly polling = false;
  readonly sessions = new Map<string, SessionRef>();

  private readonly hub: HarnessHub;
  private readonly ws: WebSocketConnection;
  private readonly pending = new Map<string, PendingCall>();
  private nextId = 1;

  constructor(hub: HarnessHub, ws: WebSocketConnection) {
    this.hub = hub;
    this.ws = ws;
    ws.handlers = {
      message: (text) => void this.onMessage(text),
      close: () => this.hub.dropConnection(this),
    };
  }

  private send(message: RpcRequest | RpcResponse | { jsonrpc: '2.0'; id: null; error: { code: number; message: string } }): void {
    try {
      this.ws.sendText(JSON.stringify(message));
    } catch {
      /* the socket is going away; close handles it */
    }
  }

  call: DaemonCall = (method, params) => {
    const id = `d${this.nextId++}`;
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new OpenArtifactError('timeout', `${method} timed out`));
      }, CALL_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { resolve: resolveCall as (value: unknown) => void, reject: rejectCall, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  };

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private async onMessage(text: string): Promise<void> {
    let message: Partial<RpcRequest & RpcResponse>;
    try {
      message = JSON.parse(text);
    } catch {
      this.send({ jsonrpc: '2.0', id: null, error: { code: RPC_ERRORS.parse, message: 'Parse error' } });
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new OpenArtifactError(message.error.data?.code ?? String(message.error.code), message.error.message ?? 'error'));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method !== 'string') return;
    try {
      const result = await this.hub.handle(this, message.method, (message.params ?? {}) as Record<string, unknown>);
      if (message.id !== undefined) this.send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
    } catch (error) {
      if (message.id === undefined) return;
      const body = errorBody(error);
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: rpcErrorCode(body.code), message: body.message, data: body } });
    }
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new OpenArtifactError('disconnected', 'The adapter disconnected.'));
    }
    this.pending.clear();
  }

  terminate(code = 1001): void {
    this.ws.close(code);
  }
}

type PollWaiter = (items: InboxMessage[]) => void;

/**
 * An adapter that long-polls over HTTP: `POST /api/open-artifact.session.attach`, then
 * `POST /api/open-artifact.session.wait` again and again. It is one session's
 * connection: wakes wait in it until the next poll takes them, and go to the
 * inbox if it goes quiet.
 */
class PollConnection implements AdapterConnection {
  readonly id = `poll-${randomBytes(6).toString('hex')}`;
  harness: string | null;
  caps: AdapterCaps;
  authed = true;
  subscribed = false;
  readonly polling = true;
  readonly sessions = new Map<string, SessionRef>();
  /** Wakes not taken by a poll yet. */
  readonly queue: InboxMessage[] = [];
  /** The open poll's resolver. */
  waiter: PollWaiter | null = null;
  lastSeen = Date.now();

  constructor(harness: string, caps: AdapterCaps) {
    this.harness = harness;
    this.caps = { ...caps, wake: caps.wake ?? {} };
  }

  notify(): void {
    /* polling adapters take no events */
  }

  call: DaemonCall = async (method, params) => {
    if (method !== 'wake.deliver') throw new OpenArtifactError('unsupported', `${method} is not available to a polling adapter.`);
    const wake = params as DaemonToAdapter['wake.deliver']['params'];
    this.queue.push({ kind: 'wake', text: wake.text, source: wake.source, artifact: wake.artifact, artifactId: wake.artifactId, at: new Date().toISOString() });
    const open = !!this.waiter;
    this.flush();
    const status: WakeDeliverStatus = open ? 'delivered' : 'queued';
    return { status } as never;
  };

  private flush(): void {
    if (!this.waiter || !this.queue.length) return;
    const done = this.waiter;
    this.waiter = null;
    done(this.queue.splice(0));
  }

  /** The next wakes, or `[]` after `timeoutMs`. One poll at a time: a new one ends the old with `[]`. */
  wait(timeoutMs: number): Promise<InboxMessage[]> {
    this.lastSeen = Date.now();
    this.waiter?.([]);
    if (this.queue.length) return Promise.resolve(this.queue.splice(0));
    return new Promise((resolveWait) => {
      const finish: PollWaiter = (items) => {
        clearTimeout(timer);
        if (this.waiter === finish) this.waiter = null;
        this.lastSeen = Date.now();
        resolveWait(items);
      };
      const timer = setTimeout(() => finish([]), Math.max(1000, Math.min(timeoutMs, POLL_MAX_MS)));
      timer.unref?.();
      this.waiter = finish;
    });
  }

  /** Quiet past the grace period with no poll open: the session went away without saying so. */
  get stale(): boolean {
    return !this.waiter && Date.now() - this.lastSeen > POLL_GRACE_MS;
  }

  close(): void {
    this.waiter?.([]);
    this.waiter = null;
  }

  terminate(): void {
    this.close();
  }
}

// ---- the hub -----------------------------------------------------------------------------------------------------

/** What the hub needs from the agent tools. */
export interface ToolRunner {
  definitions(workspace?: string | null): ToolDefinition[];
  call(name: string, args: Record<string, unknown>, caller: SessionRef): Promise<ToolCallResult>;
  agentWrote(caller: SessionRef, paths: string[]): { artifacts: string[] };
}

/** Options of {@link HarnessHub}. */
export interface HarnessHubOptions {
  /** The daemon token adapters say in `hello`. */
  token: string;
  version: string;
  tools: ToolRunner;
  inbox: Inbox;
  log: (line: string) => void;
  /** `artifact.open`: show an artifact for a caller. */
  openArtifact: (url: string, caller: SessionRef) => Promise<{ opened: boolean; view_url?: string }>;
  /** Opens a link in this computer's browser (for harnesses whose profile says `open: "browser"`); `null`: never. */
  browse?: ((url: string) => boolean) | null;
  /** The runtime registry and updates (`runtime.ts`): `hello`'s `runtime`, and `runtime.status` / `runtime.update`. */
  runtime?: { hello(harness: string, params: Pick<HelloParams, 'protocols' | 'runtime'>): void; call(method: string, raw: Record<string, unknown>): Promise<unknown> };
}

/** A session the daemon saw attach. */
export interface LiveSession {
  ref: SessionRef;
  /** The connection it is attached through; `null` after it went away. */
  conn: AdapterConnection | null;
  status: SessionStatus | 'detached';
  attachedAt: string;
  /** What the session may do, as `session.attach` said, over its role's defaults (the tools refuse the rest; left out: everything). */
  may?: SessionMay;
  /** The session's role in the harness's policy (`policy.roles`), as `session.attach` said. */
  role?: string;
}

/** Remembered session data in `sessions.json`. */
interface KnownSession extends SessionRef {
  title?: string;
  seenAt: string;
}

/** Fields a polling adapter sends with `session.*`. */
export interface PollParams extends AttachParams {
  harness?: string;
  agentName?: string;
  timeoutMs?: number;
}

/** Adapters, attached sessions, and routing to them. Emits `changed` when any of it changes. */
export class HarnessHub extends EventEmitter<{ changed: [] }> {
  /** Every open connection. */
  readonly connections = new Set<AdapterConnection>();
  /** Attached sessions by key. */
  readonly sessions = new Map<string, LiveSession>();

  private readonly options: HarnessHubOptions;
  /** Process ids registered by hooks and attaches → their session, per harness. */
  private readonly pids = new Map<number, Map<string, SessionRef>>();
  private readonly known: Record<string, KnownSession>;
  /** Polling connections by session key. */
  private readonly polls = new Map<string, PollConnection>();
  private readonly sweep: ReturnType<typeof setInterval>;
  /** Embedding: origins, host origins, top-level views (`harness-embed.ts`). */
  readonly embed: EmbedViews;
  /** `view.context` and its events (`harness-view.ts`). */
  readonly contexts: ViewContexts;

  constructor(options: HarnessHubOptions) {
    super();
    this.options = options;
    this.embed = new EmbedViews({ broadcast: (event) => this.broadcast(event), connections: () => this.connections, log: options.log });
    this.contexts = new ViewContexts({ broadcast: (event) => this.broadcast(event) });
    this.known = readJson<{ sessions?: Record<string, KnownSession> } | null>(files.sessions(), {})?.sessions ?? {};
    this.sweep = setInterval(() => {
      for (const conn of this.polls.values()) if (conn.stale) this.dropConnection(conn);
    }, 5000);
    this.sweep.unref?.();
  }

  // ---- WebSocket adapters ----

  /** Takes an accepted WebSocket as an adapter connection. */
  accept(ws: WebSocketConnection): AdapterConnection {
    const conn = new SocketConnection(this, ws);
    this.connections.add(conn);
    return conn;
  }

  /** Forgets a connection; a poller's untaken wakes go to the inbox. */
  dropConnection(conn: AdapterConnection): void {
    if (!this.connections.has(conn)) return;
    conn.close();
    this.connections.delete(conn);
    this.embed.dropConnection(conn);
    if (conn instanceof PollConnection) {
      for (const [key, c] of this.polls) if (c === conn) this.polls.delete(key);
      const key = [...conn.sessions.keys()][0];
      for (const item of conn.queue.splice(0)) if (key) this.options.inbox.append(key, item);
    }
    for (const [key, session] of this.sessions) if (session.conn === conn) this.sessions.set(key, { ...session, conn: null, status: 'detached' });
    this.emit('changed');
    this.options.log(`adapter ${conn.harness ?? '?'} disconnected`);
  }

  // ---- polling adapters ----

  /** A polling adapter's session: its connection, made or found. What waited in the inbox goes with the answer. */
  pollAttach(params: PollParams): { key: string; inbox: InboxMessage[] } {
    const harness = String(params.harness ?? '');
    if (!HARNESS_NAME.test(harness)) throw new OpenArtifactError('invalid_argument', 'harness: the harness name (body field or X-Open-Artifact-Harness header).');
    const ref: SessionRef = { harness, session: params.session ?? null, workspace: params.workspace ?? null };
    if (!ref.session) throw new OpenArtifactError('invalid_argument', 'session.attach needs session (and workspace).');
    const key = this.remember(ref, params.title ? { title: params.title } : {})!;
    let conn = this.polls.get(key);
    if (!conn) {
      conn = new PollConnection(harness, { wake: {}, ...(params.agentName ? { agentName: params.agentName } : {}) });
      this.polls.set(key, conn);
      this.connections.add(conn);
      this.options.log(`adapter ${harness} polling for ${key}`);
    }
    conn.lastSeen = Date.now();
    conn.sessions.set(key, ref);
    const may = sessionMayOf(params.may);
    const role = typeof params.role === 'string' && params.role ? params.role.slice(0, 64) : undefined;
    this.sessions.set(key, { ref, conn, status: params.status === 'running' ? 'running' : 'idle', attachedAt: new Date().toISOString(), ...(may ? { may } : {}), ...(role ? { role } : {}) });
    if (params.pid) this.registerPid(params.pid, ref);
    this.emit('changed');
    return { key, inbox: this.options.inbox.take(key) };
  }

  private pollOf(params: PollParams): { key: string; conn: PollConnection } {
    const key = sessionKeyOf({ harness: String(params.harness ?? ''), session: params.session ?? null, workspace: params.workspace ?? null });
    const conn = key ? this.polls.get(key) : undefined;
    if (!key || !conn) throw new OpenArtifactError('unknown_session', 'Attach the session first (POST /api/open-artifact.session.attach).', { status: 404 });
    return { key, conn };
  }

  /** One long poll: the next wakes for the session, or `[]` after the timeout or when `signal` aborts. */
  async pollWait(params: PollParams, signal?: AbortSignal): Promise<{ messages: InboxMessage[] }> {
    const { conn } = this.pollOf(params);
    const waiting = conn.wait(Number(params.timeoutMs) || 25_000);
    // The caller hung up: end this poll (not a newer one), so a wake is not handed to a request nobody reads.
    const mine = conn.waiter;
    signal?.addEventListener('abort', () => (conn.waiter === mine ? mine?.([]) : undefined), { once: true });
    return { messages: await waiting };
  }

  /** A polling session's agent status. */
  pollStatus(params: PollParams): { ok: true } {
    const { key } = this.pollOf(params);
    const session = this.sessions.get(key);
    if (session) session.status = params.status === 'running' ? 'running' : 'idle';
    this.emit('changed');
    return { ok: true };
  }

  /** A polling session ends. */
  pollDetach(params: PollParams): { ok: true } {
    try {
      this.dropConnection(this.pollOf(params).conn);
    } catch {
      /* already gone */
    }
    return { ok: true };
  }

  // ---- sessions ----

  private persist(): void {
    writeJson(files.sessions(), { sessions: this.known });
  }

  /** Remembers a session in `sessions.json`; returns its key. */
  remember(ref: SessionRef, extra: { title?: string } = {}): string | null {
    const key = sessionKeyOf(ref);
    if (!key) return null;
    const before = this.known[key];
    // A call that does not know the folder keeps the one a hook said.
    this.known[key] = { ...(before ?? {}), ...ref, workspace: ref.workspace || before?.workspace || null, ...extra, seenAt: new Date().toISOString() };
    this.persist();
    return key;
  }

  /**
   * The folder session `ref` works in, when the call does not say: the one its hook said (`sessions.json`), else what
   * its profile's `sessionWorkspace` finds (Codex: the thread's own record).
   */
  workspaceOf(ref: SessionRef): string | null {
    if (ref.workspace) return ref.workspace;
    if (!ref.session) return null;
    const key = sessionKeyOf(ref);
    return (key ? this.known[key]?.workspace : null) ?? sessionWorkspaceOf(ref.harness)?.(ref.session) ?? null;
  }

  /** A session ref registered for one of these process ids (hooks, attaches). */
  byPid(pids: number[], harness?: string): SessionRef | null {
    const want = harness && harness !== 'mcp' && harness !== 'unknown' ? harness : null;
    for (const pid of pids) {
      const byHarness = this.pids.get(Number(pid));
      if (!byHarness) continue;
      if (want) {
        const ref = byHarness.get(want);
        if (ref) return ref;
      } else {
        let last: SessionRef | null = null;
        for (const ref of byHarness.values()) last = ref;
        if (last) return last;
      }
    }
    return null;
  }

  /**
   * The most recently seen session for `harness` in `sessions.json`, for MCP bridges that start before any session
   * exists and share no ancestor PID with hooks (e.g. Antigravity on Windows, detached language servers, or after a
   * daemon restart). When `workspace` is given, only sessions in that workspace match.
   */
  recentSession(harness: string, workspace?: string | null, maxAgeMs = recentSessionMaxAgeMs()): SessionRef | null {
    if (!harness || harness === 'mcp' || harness === 'unknown') return null;
    const cutoff = Date.now() - maxAgeMs;
    const candidates = Object.values(this.known)
      .filter((s) => {
        if (s.harness !== harness || !s.session) return false;
        const seen = Date.parse(s.seenAt);
        return Number.isFinite(seen) && seen >= cutoff;
      })
      .sort((a, b) => Date.parse(b.seenAt) - Date.parse(a.seenAt));
    if (!candidates.length) return null;
    if (workspace) {
      const match = candidates.find((s) => !!s.workspace && samePath(s.workspace, workspace));
      return match ? { harness: match.harness, session: match.session, workspace: match.workspace || workspace } : null;
    }
    const latest = candidates[0]!;
    return { harness: latest.harness, session: latest.session, workspace: latest.workspace || null };
  }

  /** Maps a process id to a session, so MCP calls from its children map to it. */
  registerPid(pid: number, ref: SessionRef): void {
    const num = Number(pid);
    if (num <= 1) return;
    let byHarness = this.pids.get(num);
    if (!byHarness) this.pids.set(num, (byHarness = new Map()));
    byHarness.delete(ref.harness);
    byHarness.set(ref.harness, ref);
  }

  /** What the harness calls its agent: the connected adapter's word, else the profile's. */
  agentNameOf(harness: string | null | undefined): string {
    if (!harness) return 'Agent';
    for (const conn of this.connections) {
      if (conn.authed && conn.harness === harness && typeof conn.caps.agentName === 'string' && conn.caps.agentName) return conn.caps.agentName;
    }
    return harnessProfile(harness).agentName || 'Agent';
  }

  /**
   * Whether the daemon can start a turn in an idle session of the harness: a connected adapter that takes wakes can,
   * else the profile says (`wakesIdle: false` for apps with no way in, such as Cursor).
   */
  wakesIdle(harness: string | null | undefined): boolean {
    if (!harness) return true;
    for (const conn of this.connections) if (conn.authed && conn.harness === harness && conn.caps.wake) return true;
    return harnessProfile(harness).wakesIdle !== false;
  }

  /** Live state of a session. */
  statusOf(ref: SessionRef | null | undefined): { live: boolean; status: OwnerStatus; wakeMode?: 'draft'; harnessTitle?: string } {
    const session = ref ? this.sessions.get(sessionKeyOf(ref) ?? '') : undefined;
    // A harness that drafts what it is sent: the Shell's Send button says so up front.
    const draft = ref && this.wakeModeOf(ref.harness) === 'draft' ? { wakeMode: 'draft' as const } : {};
    // The name the Shell shows a person; none when the profile gives no title of its own.
    const harnessTitle = ref ? this.titleOf(ref.harness) : undefined;
    const named = { ...draft, ...(harnessTitle ? { harnessTitle } : {}) };
    if (!session?.conn) return { live: false, status: 'offline', ...named };
    return { live: true, status: session.status === 'running' ? 'running' : 'idle', ...named };
  }

  /** A harness's display name from its profile, or `undefined` when the profile gives none (its title is its id). */
  titleOf(harness: string): string | undefined {
    const title = harnessProfile(harness).title;
    return title && title !== harness ? title : undefined;
  }

  /** The folders known sessions worked in (`sessions.json`), the most recently seen first. */
  workspaces(limit = 20): string[] {
    const seen = Object.values(this.known)
      .filter((s) => !!s.workspace)
      .sort((a, b) => (Date.parse(b.seenAt) || 0) - (Date.parse(a.seenAt) || 0))
      .map((s) => s.workspace!);
    return [...new Set(seen)].slice(0, limit);
  }

  /** `GET /api/open-artifact.harnesses`. */
  info(): HarnessesResponse {
    const adapters: AdapterInfo[] = [...this.connections]
      .filter((c) => c.authed && c.harness)
      .map((c) => ({ id: c.id, harness: c.harness!, caps: c.caps, sessions: [...c.sessions.keys()], polling: c.polling }));
    const sessions: HarnessesResponse['sessions'] = [...this.sessions.entries()].map(([key, s]) => {
      const title = this.known[key]?.title;
      return {
        key,
        ...s.ref,
        status: s.conn ? (s.status === 'running' ? 'running' : 'idle') : 'offline',
        live: !!s.conn,
        ...(title ? { title } : {}),
      };
    });
    const names = new Set<string>([...adapters.map((a) => a.harness), ...sessions.map((s) => s.harness)]);
    const harnesses: HarnessInfo[] = [...names].sort().map((name) => {
      const profile = harnessProfile(name);
      return {
        name,
        title: profile.title,
        agentName: this.agentNameOf(name),
        connected: adapters.some((a) => a.harness === name),
        sessions: sessions.filter((s) => s.harness === name).map(({ live: _live, ...s }) => s),
      };
    });
    return { harnesses, adapters, sessions };
  }

  /** The connection that can act for `ref` now. */
  connectionFor(ref: SessionRef): AdapterConnection | null {
    const session = this.sessions.get(sessionKeyOf(ref) ?? '');
    if (session?.conn) return session.conn;
    // The harness's adapter is up but the session is not attached: an adapter that can resume sessions takes it.
    for (const conn of this.connections) if (conn.authed && conn.harness === ref.harness && conn.caps.wake?.resume) return conn;
    return null;
  }

  /** Live delivery: the adapter's answer, or `null` when no adapter can take it. */
  async deliver(ref: SessionRef, payload: WakePayload): Promise<WakeDeliverResult | WakeDeliverStatus | null> {
    const conn = this.connectionFor(ref);
    if (!conn?.caps.wake) return null;
    // The whole answer: the wake router checks it, and a `session` in it hands the artifact over (`wake.ts`).
    const result = (await conn.call('wake.deliver', { session: ref.session ?? null, workspace: ref.workspace ?? null, ...payload })) as unknown;
    return (result as WakeDeliverResult | WakeDeliverStatus | null | undefined) ?? null;
  }

  /** When a hook, call or attach last saw `ref`'s session (`sessions.json`), ms since the epoch, or `null`. */
  seenAt(ref: SessionRef | null | undefined): number | null {
    const key = sessionKeyOf(ref);
    const seen = key ? Date.parse(this.known[key]?.seenAt ?? '') : NaN;
    return Number.isFinite(seen) ? seen : null;
  }

  /**
   * Whether a session of the harness that is not attached can still be reached: an adapter of it that resumes
   * sessions is connected, or its profile says it does (`caps.wake.resume`). Offline is then not gone.
   */
  resumes(harness: string): boolean {
    for (const conn of this.connections) if (conn.authed && conn.harness === harness && conn.caps.wake?.resume) return true;
    return harnessProfile(harness).caps?.wake?.resume === true;
  }

  /** How the harness's adapter takes wakes: `draft` when it puts them in the session's draft for the person to send. */
  wakeModeOf(harness: string | null | undefined): 'auto' | 'draft' {
    if (!harness) return 'auto';
    for (const conn of this.connections) if (conn.authed && conn.harness === harness && conn.caps.wake) return conn.caps.wake.mode === 'draft' ? 'draft' : 'auto';
    return harnessProfile(harness).caps?.wake?.mode === 'draft' ? 'draft' : 'auto';
  }

  /** Whether the caller's harness can show an artifact (`host.open`). */
  canOpen(ref: SessionRef | null): boolean {
    return !!ref && !!this.connectionFor(ref)?.caps.open;
  }

  /** Whether the caller's profile has pages shown in this computer's browser when its app cannot show them. */
  private browserFor(ref: SessionRef | null): boolean {
    return !!ref && !!this.options.browse && harnessProfile(ref.harness).open === 'browser';
  }

  /** Whether the daemon can show an artifact for the caller: in its app, or in the browser its profile names. */
  canShow(ref: SessionRef | null): boolean {
    return this.canOpen(ref) || this.browserFor(ref);
  }

  /**
   * Shows an artifact for the caller, for the agent: in its app (`host.open`), else in this computer's browser when
   * the harness's profile says `open: "browser"`. Not for the person's own clicks, whose page is already in front of
   * them. `null` when it was shown nowhere.
   */
  async show(ref: SessionRef | null, params: { url: string; view_url: string; title?: string }): Promise<'app' | 'browser' | null> {
    if (await this.hostOpen(ref, params)) return 'app';
    if (this.browserFor(ref) && this.options.browse?.(params.view_url)) return 'browser';
    return null;
  }

  /** Asks the caller's harness to show an artifact (`host.open`), when it can. */
  async hostOpen(ref: SessionRef | null, params: { url: string; view_url: string; title?: string }): Promise<boolean> {
    const conn = ref ? this.connectionFor(ref) : null;
    if (!ref || !conn?.caps.open) return false;
    const extras = this.embed.openExtras(conn, ref.session ?? null, params.url);
    const result = await conn.call('host.open', { session: ref.session ?? null, ...params, ...extras }).catch(() => null);
    return !!result?.opened;
  }

  /** Sends an event to every subscribed adapter. */
  broadcast(event: HarnessEvent): void {
    for (const conn of this.connections) if (conn.authed && conn.subscribed) conn.notify('event', event);
  }

  private callerOf(conn: AdapterConnection, params: SessionParams & { caller?: SessionParams }): SessionRef {
    const caller = params.caller ?? {};
    return {
      harness: conn.harness ?? 'unknown',
      session: caller.session ?? params.session ?? null,
      workspace: caller.workspace ?? params.workspace ?? null,
    };
  }

  /** Answers one adapter call. */
  async handle(conn: AdapterConnection, method: string, raw: Record<string, unknown>): Promise<unknown> {
    if (method === 'hello') {
      const params = raw as unknown as HelloParams;
      if (params.token !== this.options.token) throw new OpenArtifactError('unauthorized', 'Bad token: read it from daemon.json.');
      if (typeof params.harness !== 'string' || !HARNESS_NAME.test(params.harness)) throw new OpenArtifactError('invalid_argument', 'hello needs a harness name.');
      const protocol = negotiateProtocol(params.protocols);
      conn.authed = true;
      conn.harness = params.harness;
      conn.caps = params.caps ?? {};
      const kit = params.kit && typeof params.kit.name === 'string' ? ` via ${params.kit.name}@${params.kit.version}` : '';
      this.options.log(`adapter ${conn.harness} connected${kit} (protocol ${protocol}, ${JSON.stringify(conn.caps)})`);
      if (params.profile !== undefined) this.saveProfile(params.harness, params.profile);
      try {
        this.options.runtime?.hello(params.harness, params);
      } catch (error) {
        this.options.log(`runtime: recording ${params.harness}'s runtime failed: ${(error as Error)?.message ?? error}`);
      }
      this.emit('changed');
      const hello: HelloResult = { protocol, daemon: this.options.version, connection: conn.id, features: [...HARNESS_FEATURES] };
      return hello;
    }
    if (!conn.authed || !conn.harness) throw new OpenArtifactError('unauthorized', 'Say hello first.');
    const harness = conn.harness;
    switch (method as keyof AdapterToDaemon) {
      case 'session.attach': {
        const params = raw as AttachParams;
        const ref: SessionRef = { harness, session: params.session ?? null, workspace: params.workspace ?? null };
        const key = this.remember(ref, params.title ? { title: params.title } : {});
        if (!key) throw new OpenArtifactError('invalid_argument', 'session.attach needs session or workspace.');
        const may = sessionMayOf(params.may);
        const role = typeof params.role === 'string' && params.role ? params.role.slice(0, 64) : undefined;
        this.sessions.set(key, { ref, conn, status: params.status ?? 'idle', attachedAt: new Date().toISOString(), ...(may ? { may } : {}), ...(role ? { role } : {}) });
        conn.sessions.set(key, ref);
        if (params.pid) this.registerPid(params.pid, ref);
        this.emit('changed');
        // What waited for this session goes with the answer.
        return { key, inbox: this.options.inbox.take(key) };
      }
      case 'session.status': {
        const params = raw as unknown as SessionParams & { status: SessionStatus };
        const session = this.sessions.get(sessionKeyOf({ harness, session: params.session ?? null, workspace: params.workspace ?? null }) ?? '');
        if (session) session.status = params.status === 'running' ? 'running' : 'idle';
        this.emit('changed');
        return { ok: true };
      }
      case 'session.detach': {
        const params = raw as unknown as SessionParams;
        const key = sessionKeyOf({ harness, session: params.session ?? null, workspace: params.workspace ?? null });
        if (key) {
          this.sessions.delete(key);
          conn.sessions.delete(key);
        }
        this.emit('changed');
        return { ok: true };
      }
      case 'session.rename': {
        const params = raw as unknown as SessionParams & { title: string };
        this.remember({ harness, session: params.session ?? null, workspace: params.workspace ?? null }, { title: String(params.title ?? '') });
        this.emit('changed');
        return { ok: true };
      }
      case 'tools.list':
        return { tools: this.options.tools.definitions(this.callerOf(conn, raw as SessionParams).workspace) };
      case 'tools.call': {
        const params = raw as unknown as AdapterToDaemon['tools.call']['params'];
        return this.options.tools.call(String(params.name), params.arguments ?? {}, this.callerOf(conn, params));
      }
      case 'agent.wrote': {
        const params = raw as unknown as AdapterToDaemon['agent.wrote']['params'];
        const paths = Array.isArray(params.paths) ? params.paths.filter((p): p is string => typeof p === 'string') : [];
        return { ok: true, ...this.options.tools.agentWrote(this.callerOf(conn, params), paths) };
      }
      case 'artifact.open': {
        const params = raw as unknown as AdapterToDaemon['artifact.open']['params'];
        return this.options.openArtifact(String(params.url), this.callerOf(conn, params));
      }
      case 'inbox.take': {
        const key = sessionKeyOf(this.callerOf(conn, raw));
        return { messages: key ? this.options.inbox.take(key) : [] };
      }
      case 'inbox.wait': {
        const params = raw as AdapterToDaemon['inbox.wait']['params'];
        const key = sessionKeyOf(this.callerOf(conn, params));
        if (!key) throw new OpenArtifactError('invalid_argument', 'inbox.wait needs session or workspace.');
        const timeout = Math.min(Number(params.timeoutMs) || 600_000, INBOX_WAIT_MAX_MS);
        return { messages: await this.options.inbox.wait(key, timeout) };
      }
      case 'subscribe':
        conn.subscribed = (raw as { on?: boolean }).on !== false;
        return { ok: true };
      // Each answered by its own module (`harness-skill.ts`, `harness-embed.ts`, `harness-view.ts`), listed in features.
      case 'skill.get':
      case 'commands.list':
        return handleSkillCall(method as (typeof SKILL_METHODS)[number], raw, { harness, caller: this.callerOf(conn, raw), caps: conn.caps, version: this.options.version, tools: this.options.tools });
      case 'embed.origins':
      case 'shell.command':
        return handleEmbedCall(method as (typeof EMBED_METHODS)[number], raw, { harness, caller: this.callerOf(conn, raw), conn, views: this.embed });
      case 'view.context':
        return handleViewCall(method as (typeof VIEW_METHODS)[number], raw, { harness, caller: this.callerOf(conn, raw), contexts: this.contexts });
      case 'runtime.status':
      case 'runtime.update':
        if (!this.options.runtime) throw new OpenArtifactError('method_not_found', `Unknown method ${method}.`);
        return this.options.runtime.call(method, raw);
      default:
        throw new OpenArtifactError('method_not_found', `Unknown method ${method}.`);
    }
  }

  /** Keeps the profile an adapter reported in `hello` (see `saveAdapterProfile`); a failure only logs. */
  private saveProfile(harness: string, profile: unknown): void {
    try {
      const result = saveAdapterProfile(harness, profile);
      if (result.dropped.length) this.options.log(`adapter ${harness} profile: left out ${result.dropped.join(', ')}`);
      if (result.saved) this.options.log(`adapter ${harness} profile saved`);
      else if (result.reason === 'user_file') this.options.log(`adapter ${harness} profile not saved: the person's own profile is in place`);
    } catch (error) {
      this.options.log(`adapter ${harness} profile not saved: ${(error as Error).message}`);
    }
  }

  /** Closes every connection. */
  close(): void {
    clearInterval(this.sweep);
    this.embed.close();
    this.contexts.close();
    for (const conn of this.connections) {
      conn.close();
      conn.terminate(1001);
    }
    this.connections.clear();
  }
}
