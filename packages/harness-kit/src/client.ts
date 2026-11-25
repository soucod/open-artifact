/**
 * A Harness API connection (`/__harness`, JSON-RPC 2.0 over a WebSocket): it says hello, answers the daemon's calls,
 * and when the daemon goes away it reconnects with backoff and attaches its sessions again.
 *
 * Uses the global `WebSocket` (Node ≥ 22, Electron's Node).
 */

import {
  HARNESS_PATH,
  HARNESS_SUBPROTOCOL,
  OpenArtifactError,
  PROTOCOL_MAX,
  PROTOCOL_MIN,
  RPC_ERRORS,
  type AdapterCaps,
  type AdapterToDaemon,
  type AttachParams,
  type DaemonCallHandlers,
  type DaemonState,
  type DaemonToAdapter,
  type HarnessEvent,
  type HelloParams,
  type HelloResult,
  type RpcRequest,
  type RpcResponse,
  type SessionParams,
  type SessionStatus,
  type ToolCallResult,
  type ToolDefinition,
} from '@open-artifact/protocol';
import { ensureDaemon, readDaemon, type EnsureDaemonOptions } from './daemon.ts';

/** Connection state reported to {@link HarnessClientOptions.onState}. */
export type HarnessConnectionState = 'connected' | 'disconnected';

/** What else `hello` says besides the harness, its caps and the token. `protocols` defaults to what this kit speaks. */
export type HelloExtras = Omit<HelloParams, 'harness' | 'token' | 'caps'>;

/** Options of {@link HarnessClient}. */
export interface HarnessClientOptions {
  /** The harness name said in `hello`. */
  harness: string;
  caps?: AdapterCaps;
  /** More of `hello`: `kit`, `profile`, `runtime`, `protocols`. */
  hello?: HelloExtras;
  /** Answers the daemon's calls (`wake.deliver`, `host.open`, `shell.event`). */
  handlers?: DaemonCallHandlers;
  /** Takes events; when set, the client subscribes after connecting. */
  onEvent?: (event: HarnessEvent) => void;
  onState?: (state: HarnessConnectionState) => void;
  /**
   * Called with what `session.attach` answered when the client attached a session again after a reconnect (its
   * `inbox` holds what waited for the session meanwhile).
   */
  onReattach?: (params: AttachParams, result: AdapterToDaemon['session.attach']['result']) => void | Promise<void>;
  /** Start the daemon when none runs (default `true`). */
  autoStart?: boolean;
  /** Passed to {@link ensureDaemon} (and its `home` to {@link readDaemon}). */
  daemon?: EnsureDaemonOptions;
  /**
   * Delay before reconnecting, ms: `minMs` after a drop, doubling after each failed try up to `maxMs`. Default 2 s
   * each, a steady retry.
   */
  reconnect?: { minMs?: number; maxMs?: number };
  /** Diagnostic log. */
  log?: (line: string) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Delay before reconnecting a dropped connection, ms, unless {@link HarnessClientOptions.reconnect} says otherwise. */
const RECONNECT_MS = 2000;

/** A session's key in the client: its id when it has one, else its workspace (as the daemon keys sessions). */
function keyOf(params: SessionParams): string {
  return params.session ? `s:${params.session}` : `w:${params.workspace ?? ''}`;
}

/**
 * A Harness API connection. It reconnects when dropped, and says hello and attaches the sessions again.
 */
export class HarnessClient {
  readonly harness: string;
  /** The daemon this client talks to, once connected. */
  state: DaemonState | null = null;
  /** What the last `hello` answered (`features` is `[]` from a daemon that does not say). */
  hello: HelloResult | null = null;

  private readonly options: HarnessClientOptions;
  private readonly pending = new Map<string, Pending>();
  private readonly attached = new Map<string, AttachParams>();
  private nextId = 1;
  private closed = false;
  private subscribed: boolean;
  private ready: Promise<HelloResult> | null = null;
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;

  constructor(options: HarnessClientOptions) {
    this.options = options;
    this.harness = options.harness;
    this.subscribed = !!options.onEvent;
  }

  /** Whether the connection is up and said hello. */
  get connected(): boolean {
    return !!this.hello && this.ws?.readyState === WebSocket.OPEN;
  }

  /** The daemon's features (see `HarnessFeature`), as the last `hello` answered them. */
  get features(): readonly string[] {
    return this.hello?.features ?? [];
  }

  /** Connects (once); later calls share the same attempt. */
  connect(): Promise<HelloResult> {
    if (this.closed) return Promise.reject(new OpenArtifactError('disconnected', 'The open-artifact client is closed.'));
    if (this.ready) return this.ready;
    this.ready = this.open().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async open(): Promise<HelloResult> {
    const daemon = this.options.daemon ?? {};
    const state = this.options.autoStart === false ? await readDaemon(daemon.home ?? daemon.env?.OPEN_ARTIFACT_HOME) : await ensureDaemon(daemon);
    if (!state) throw new OpenArtifactError('no_daemon', 'No open-artifact daemon is running.');
    this.state = state;
    const ws = new WebSocket(`${state.url.replace(/^http/, 'ws')}${HARNESS_PATH}`, [HARNESS_SUBPROTOCOL]);
    this.ws = ws;
    await new Promise<void>((resolveOpen, rejectOpen) => {
      ws.addEventListener('open', () => resolveOpen(), { once: true });
      ws.addEventListener('error', () => rejectOpen(new OpenArtifactError('connect_failed', 'Could not connect to the open-artifact daemon.')), { once: true });
    });
    ws.addEventListener('message', (event) => void this.onMessage(String(event.data)));
    ws.addEventListener('close', () => this.onClose(ws));
    let hello: HelloResult;
    try {
      const params: HelloParams = {
        harness: this.harness,
        caps: this.options.caps ?? {},
        token: state.token,
        protocols: { min: PROTOCOL_MIN, max: PROTOCOL_MAX },
        ...this.options.hello,
      };
      const answer = await this.call('hello', params);
      hello = { ...answer, features: Array.isArray(answer?.features) ? answer.features : [] };
    } catch (error) {
      // A refused hello (a bad token, no common protocol) leaves nothing to keep open; the close retries later.
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      throw error;
    }
    this.hello = hello;
    this.failures = 0;
    this.options.onState?.('connected');
    if (this.subscribed) await this.call('subscribe', { on: true });
    // A reconnect attaches the sessions again.
    for (const params of [...this.attached.values()]) {
      const result = await this.call('session.attach', params).catch((error: Error) => {
        this.options.log?.(`open-artifact attach ${params.session ?? params.workspace}: ${error.message}`);
        return null;
      });
      // Not awaited: handing over what waited may start turns, and the connection is ready before that.
      const onReattach = this.options.onReattach;
      if (result && onReattach) {
        void Promise.resolve()
          .then(() => onReattach(params, result))
          .catch((error: Error) => this.options.log?.(`open-artifact reattach: ${error.message}`));
      }
    }
    return hello;
  }

  private onClose(ws: WebSocket): void {
    if (this.ws !== ws) return;
    for (const pending of this.pending.values()) pending.reject(new OpenArtifactError('disconnected', 'The open-artifact daemon went away.'));
    this.pending.clear();
    const wasUp = !!this.hello;
    this.ready = null;
    this.ws = null;
    this.hello = null;
    if (wasUp) this.options.onState?.('disconnected');
    this.reconnect();
  }

  /**
   * Tries to connect again later, and keeps trying with backoff until it is connected or closed. The client does this
   * by itself after a drop; call it after a first {@link connect} failed to keep trying in the background.
   */
  reconnect(): void {
    if (this.closed || this.retry !== undefined || this.connected) return;
    const min = this.options.reconnect?.minMs ?? RECONNECT_MS;
    const max = Math.max(min, this.options.reconnect?.maxMs ?? RECONNECT_MS);
    const delay = Math.min(max, min * 2 ** Math.min(this.failures, 16));
    this.retry = setTimeout(() => {
      this.retry = undefined;
      if (this.closed || this.connected) return;
      this.connect().catch((error: unknown) => {
        this.failures++;
        this.options.log?.(`open-artifact reconnect: ${(error as Error).message}`);
        // A socket that opened and then closed has scheduled the next try already.
        this.reconnect();
      });
    }, delay);
    (this.retry as { unref?: () => void }).unref?.();
  }

  private async onMessage(text: string): Promise<void> {
    let message: RpcRequest & Partial<RpcResponse>;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    // A response to one of our calls.
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error) {
        const data = message.error.data ?? {};
        pending.reject(new OpenArtifactError(data.code ?? String(message.error.code), message.error.message, data.fix ? { fix: data.fix } : {}));
      } else pending.resolve(message.result);
      return;
    }
    if (message.method === 'event') {
      try {
        this.options.onEvent?.(message.params as HarnessEvent);
      } catch (error) {
        this.options.log?.(`open-artifact event: ${(error as Error)?.message ?? error}`);
      }
      return;
    }
    if (message.id === undefined) return;
    const handler = this.options.handlers?.[message.method as keyof DaemonToAdapter] as ((params: unknown) => unknown) | undefined;
    if (!handler) {
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: RPC_ERRORS.methodNotFound, message: `No handler for ${message.method}` } });
      return;
    }
    try {
      const result = await handler(message.params ?? {});
      this.send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
    } catch (error) {
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: RPC_ERRORS.server, message: (error as Error)?.message ?? String(error) } });
    }
  }

  private send(message: RpcRequest | RpcResponse): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  /** Calls a daemon method on the current connection (without connecting). */
  private call<M extends keyof AdapterToDaemon>(method: M, params: AdapterToDaemon[M]['params']): Promise<AdapterToDaemon[M]['result']> {
    const id = `a${this.nextId++}`;
    return new Promise((resolveCall, rejectCall) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        rejectCall(new OpenArtifactError('disconnected', 'Not connected to the open-artifact daemon.'));
        return;
      }
      this.pending.set(id, { resolve: resolveCall as (value: unknown) => void, reject: rejectCall });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Connects if needed, then calls a daemon method. */
  async request<M extends keyof AdapterToDaemon>(method: M, params: AdapterToDaemon[M]['params']): Promise<AdapterToDaemon[M]['result']> {
    await this.connect();
    return this.call(method, params);
  }

  /** Turns events on or off; a reconnect keeps the choice. */
  async subscribe(on: boolean): Promise<void> {
    this.subscribed = on;
    if (this.connected) await this.call('subscribe', { on });
  }

  /** Attaches a session; a reconnect attaches it again. Returns what waited in its inbox. */
  attach(params: AttachParams): Promise<AdapterToDaemon['session.attach']['result']> {
    this.attached.set(keyOf(params), params);
    return this.request('session.attach', params);
  }

  /** The session's agent is `running` or `idle` now; a reconnect attaches it with this status. */
  status(params: SessionParams & { status: SessionStatus }): Promise<{ ok: true }> {
    const key = keyOf(params);
    const attached = this.attached.get(key);
    if (attached) this.attached.set(key, { ...attached, status: params.status });
    return this.request('session.status', params);
  }

  /** Renames a session; a reconnect attaches it with this title. */
  rename(params: SessionParams & { title: string }): Promise<{ ok: true }> {
    const key = keyOf(params);
    const attached = this.attached.get(key);
    if (attached) this.attached.set(key, { ...attached, title: params.title });
    return this.request('session.rename', params);
  }

  /** Detaches a session. */
  detach(params: SessionParams): Promise<{ ok: true }> {
    this.attached.delete(keyOf(params));
    return this.request('session.detach', params);
  }

  /** The tool definitions. */
  async tools(): Promise<ToolDefinition[]> {
    return (await this.request('tools.list', {})).tools;
  }

  /** Calls a tool as `caller`. */
  callTool(name: string, args: Record<string, unknown>, caller?: SessionParams): Promise<ToolCallResult> {
    return this.request('tools.call', { name, arguments: args, ...(caller ? { caller } : {}) });
  }

  /** Closes the connection for good. */
  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    this.retry = undefined;
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
  }
}
