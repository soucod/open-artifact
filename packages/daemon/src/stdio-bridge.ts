/**
 * `open-artifact harness --stdio --harness <name>`: the Harness API over a host's stdin and stdout (design 11), for a
 * host that would rather spawn a process than open a WebSocket or read `daemon.json`.
 *
 * Framing. Each message is one JSON-RPC 2.0 object, UTF-8, on one line ended by `\n` (a `\r` before it is ignored);
 * no other bytes go on stdout, and JSON never contains a raw newline, so a line is a message. Blank lines are skipped.
 * Batches (arrays) are not accepted. A line that is not JSON is answered `{"jsonrpc":"2.0","id":null,"error":{"code":
 * -32700,…}}`; a line over 64 MiB ends the bridge. stderr carries the bridge's log, never protocol.
 *
 * Methods. The same as the WebSocket Harness API (`AdapterToDaemon`, `DaemonToAdapter` in `@open-artifact/protocol`),
 * in both directions:
 *  - host → bridge: requests (`id` a string or number) `hello`, `session.*`, `tools.*`, `subscribe`, `runtime.*`, …;
 *    each is answered with the same `id`. `hello` comes first and carries no `token` (the bridge reads `daemon.json`
 *    and says it to the daemon; the token never crosses stdio); its `harness`, when given, must be `--harness`. The
 *    answer is the daemon's `HelloResult`. Errors carry `error.data` `{code, message, fix?}` as on the WebSocket.
 *  - bridge → host: requests `wake.deliver` (when `hello`'s caps say `wake`), `host.open` and `shell.event` (when they
 *    say `open`) (ids `d1`, `d2`, … the host answers with
 *    `{"jsonrpc":"2.0","id":"d1","result":…}` or `error`); the notification `event` (`params`: a `HarnessEvent`) once
 *    the host said `subscribe {on: true}`.
 *  - bridge → host, the bridge's own notifications: `bridge.state` `{state: "connected" | "disconnected"}` when the
 *    daemon connection comes up (just before `hello`'s answer) or drops (the bridge reconnects by itself, starting the daemon again if needed, and
 *    attaches the host's sessions again), and `bridge.reattached` `{params, inbox}` after such an attach, with what
 *    waited for that session meanwhile (as `session.attach`'s `inbox`).
 *
 * The bridge ends when stdin ends (the daemon keeps running).
 */

import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import {
  HARNESS_NAME,
  OpenArtifactError,
  rpcErrorCode,
  errorBody,
  type AdapterCaps,
  type AdapterToDaemon,
  type AttachParams,
  type DaemonCallHandlers,
  type DaemonToAdapter,
  type HarnessEvent,
  type HelloResult,
  type SessionParams,
  type SessionStatus,
} from '@open-artifact/protocol';
import type { EnsureDaemonOptions, HelloExtras as HelloExtrasLike } from '@open-artifact/harness-kit';
import { HarnessClient, ownRuntime } from './client.ts';

/** The longest line read, bytes. */
const MAX_LINE = 64 << 20;

/** Options of {@link runStdioBridge}. */
export interface StdioBridgeOptions {
  /** `--harness`: the harness this bridge speaks for. */
  harness: string;
  input: Readable;
  output: Writable;
  /** The log (stderr). */
  log: (line: string) => void;
  /** Passed on to the daemon connection (tests: a home, a bin). */
  daemon?: EnsureDaemonOptions;
  /** Reconnect delays (tests). */
  reconnect?: { minMs?: number; maxMs?: number };
}

type Id = string | number;
interface Incoming {
  jsonrpc?: unknown;
  id?: Id | null;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: { code?: string; message?: string; fix?: string } };
}

const DAEMON_CALLS: ReadonlyArray<keyof DaemonToAdapter> = ['wake.deliver', 'host.open', 'shell.event'];

/** Runs the bridge until `input` ends. */
export async function runStdioBridge(options: StdioBridgeOptions): Promise<void> {
  const { harness, output, log } = options;
  if (!HARNESS_NAME.test(harness)) throw new OpenArtifactError('invalid_argument', `--harness ${harness}: a harness name is lowercase letters, digits, . _ -.`);
  const write = (message: object): void => void output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const fail = (id: Id | null, error: unknown): void => {
    const body = errorBody(error);
    write({ id, error: { code: rpcErrorCode(body.code), message: body.message, data: body } });
  };

  // Calls to the host, by id.
  const waiting = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let next = 1;
  const callHost = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = `d${next++}`;
      waiting.set(id, { resolve, reject });
      write({ id, method, params });
    });

  let client: HarnessClient | null = null;
  let hello: HelloResult | null = null;
  let subscribed = false;

  const start = async (params: Record<string, unknown>): Promise<HelloResult> => {
    if (params.harness !== undefined && params.harness !== harness) throw new OpenArtifactError('invalid_argument', `hello.harness is ${String(params.harness)}, but this bridge is --harness ${harness}.`);
    if ('token' in params) log('stdio: hello carried a token; ignored (the bridge reads daemon.json)');
    const { harness: _h, token: _t, caps, ...extras } = params as { harness?: unknown; token?: unknown; caps?: AdapterCaps } & HelloExtrasLike;
    // A host that names no runtime of its own: this command's runtime folder, so the daemon knows it.
    const own = ownRuntime();
    const hostSaid = extras as HelloExtrasLike;
    const helloExtras = { ...hostSaid, ...(hostSaid.runtime === undefined && own.dir ? { runtime: { dir: own.dir, version: own.version } } : {}) };
    // Only the calls the host declared in its caps are forwarded (wake → wake.deliver; open → host.open, and the
    // shell.event of the views it opened). The daemon sends no others; one that came anyway is methodNotFound here.
    const declared: AdapterCaps = caps && typeof caps === 'object' ? caps : {};
    const forwards: Record<(typeof DAEMON_CALLS)[number], boolean> = { 'wake.deliver': !!declared.wake, 'host.open': !!declared.open, 'shell.event': !!declared.open };
    const handlers: DaemonCallHandlers = {};
    for (const method of DAEMON_CALLS) if (forwards[method]) (handlers as Record<string, (p: unknown) => Promise<unknown>>)[method] = (p) => callHost(method, p);
    const made = new HarnessClient({
      harness,
      caps: declared,
      hello: helloExtras,
      handlers,
      onEvent: (event: HarnessEvent) => {
        if (subscribed) write({ method: 'event', params: event });
      },
      onState: (state) => write({ method: 'bridge.state', params: { state } }),
      onReattach: (attach: AttachParams, result) => write({ method: 'bridge.reattached', params: { params: attach, inbox: result.inbox ?? [] } }),
      log: (line) => log(`stdio: ${line}`),
      ...(options.daemon ? { daemon: options.daemon } : {}),
      ...(options.reconnect ? { reconnect: options.reconnect } : {}),
    });
    // Events only once the host subscribes.
    await made.subscribe(false);
    client = made;
    try {
      return await made.connect();
    } catch (error) {
      made.close();
      client = null;
      throw error;
    }
  };

  const handle = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (method === 'hello') {
      if (hello) throw new OpenArtifactError('conflict', 'hello was said already on this bridge.');
      hello = await start(params);
      return hello;
    }
    if (!client || !hello) throw new OpenArtifactError('unauthorized', 'Say hello first.');
    const c: HarnessClient = client;
    switch (method) {
      case 'session.attach':
        return c.attach(params as AttachParams);
      case 'session.status':
        return c.status(params as unknown as SessionParams & { status: SessionStatus });
      case 'session.rename':
        return c.rename(params as unknown as SessionParams & { title: string });
      case 'session.detach':
        return c.detach(params as SessionParams);
      case 'subscribe':
        subscribed = (params as { on?: unknown }).on !== false;
        await c.subscribe(subscribed);
        return { ok: true };
      default:
        return c.request(method as keyof AdapterToDaemon, params as never);
    }
  };

  const onLine = (line: string): void => {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!text.trim()) return;
    let message: Incoming;
    try {
      message = JSON.parse(text) as Incoming;
    } catch {
      return fail(null, new OpenArtifactError('parse_error', 'Not a JSON line.'));
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return fail(null, new OpenArtifactError('invalid_argument', 'One JSON-RPC object per line; batches are not accepted.'));
    // The host's answer to one of the daemon's calls.
    if (message.method === undefined && message.id !== undefined && message.id !== null) {
      const pending = waiting.get(String(message.id));
      if (!pending) return log(`stdio: an answer to ${String(message.id)}, which was not asked`);
      waiting.delete(String(message.id));
      if (message.error) pending.reject(new OpenArtifactError(message.error.data?.code ?? 'error', message.error.message ?? 'The host failed.', message.error.data?.fix ? { fix: message.error.data.fix } : {}));
      else pending.resolve(message.result ?? null);
      return;
    }
    if (typeof message.method !== 'string') return fail(message.id ?? null, new OpenArtifactError('invalid_argument', 'A request needs a method.'));
    const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params) ? (message.params as Record<string, unknown>) : {};
    const id = message.id;
    void handle(message.method, params).then(
      (result) => {
        if (id !== undefined && id !== null) write({ id, result: result ?? null });
      },
      (error: unknown) => {
        if (id !== undefined && id !== null) fail(id, error);
        else log(`stdio: notification ${String(message.method)} failed: ${(error as Error)?.message ?? error}`);
      },
    );
  };

  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  await new Promise<void>((resolve) => {
    lines.on('line', (line) => {
      if (Buffer.byteLength(line) > MAX_LINE) {
        log('stdio: a line over 64 MiB; ending');
        lines.close();
        return;
      }
      onLine(line);
    });
    lines.on('close', resolve);
  });
  for (const pending of waiting.values()) pending.reject(new OpenArtifactError('disconnected', 'The host closed stdin.'));
  waiting.clear();
  (client as HarnessClient | null)?.close();
}
