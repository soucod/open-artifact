/**
 * A fake daemon for testing an adapter (`@open-artifact/harness-kit/testing`): it speaks the Harness API over a real
 * WebSocket on an ephemeral port, in this process, with no dependencies. It writes `daemon.json` in a home of its own,
 * so `createHarness({ harness, home: fake.home, autoStart: false })` finds it as it finds the real daemon.
 *
 *   const fake = await startFakeDaemon();
 *   const harness = await createHarness({ harness: 'my-app', home: fake.home, autoStart: false, wake: … });
 *   await harness.attach({ session: 's1', workspace: '/w' });
 *   assert.equal((await fake.wake({ session: 's1', … })).status, 'resumed');   // the adapter's `wake` answered
 *   fake.setArtifact({ id: 'a1', title: 'Deck', … });
 *   fake.emit({ type: 'artifacts/changed', id: 'a1' });               // `on('artifact')` reports it
 *   fake.drop();                                                      // the adapter reconnects and attaches again
 *   await fake.close();
 *
 * What it answers: `hello` (negotiating `protocols`; `features` as the real daemon lists them, `HARNESS_FEATURES`),
 * `skill.get` (the protocol's skill template, rendered for the adapter's caps), `commands.list` (one entry per
 * {@link FakeDaemonOptions.types}), `session.attach` (with what {@link FakeDaemon.queueInbox} queued),
 * `session.status`, `session.detach`, `session.rename`, `tools.list`, `tools.call`, `agent.wrote`, `artifact.open`,
 * `inbox.take`, `subscribe`, `embed.origins` ({@link FakeDaemonOptions.origins}), `shell.command` (kept in
 * {@link FakeDaemon.shellCommands}; a view this fake did not open is `not_found`), `view.context` (from
 * {@link FakeDaemon.setContext}), `runtime.status`, `runtime.update`; any other method is `methodNotFound` unless `handle` answers it. The Library API answers
 * `GET artifact?id=` from {@link FakeDaemon.setArtifact}, `POST artifacts.thumbnail?id=` (kept in
 * {@link FakeDaemon.thumbnails}), and health. {@link FakeDaemon.open} with `view` set plays a top-level view; then
 * {@link FakeDaemon.shellEvent} sends the adapter what its Shell said.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HARNESS_FEATURES,
  HARNESS_PATH,
  HARNESS_SUBPROTOCOL,
  LIBRARY_ROUTES,
  PROTOCOL_MAX,
  PROTOCOL_MIN,
  SKILL_ARGUMENT_HINT,
  SKILL_COMMAND,
  TOOL_DEFINITIONS,
  WAKE_SOURCE_KIND,
  artifactUrl,
  renderSkillBody,
  rpcErrorCode,
  skillDescription,
  skillTypesSection,
  type ArtifactDetail,
  type AttachParams,
  type CommandEntry,
  type SkillParams,
  type SkillResult,
  type SkillTypeLine,
  type DaemonToAdapter,
  type EmbedOriginsResult,
  type HarnessEvent,
  type HostToShell,
  type ShellEventParams,
  type ShellToHost,
  type ViewContextResult,
  type HelloParams,
  type HostOpenParams,
  type InboxMessage,
  type RuntimeSource,
  type RuntimeStatus,
  type RuntimeUpdateResult,
  type ToolCallResult,
  type ToolDefinition,
  type WakeDeliverParams,
  type WakeDeliverResult,
} from '@open-artifact/protocol';
import { acceptWebSocket, type WebSocketConnection } from './testing-ws.ts';

/** One call the fake daemon took from an adapter. */
export interface FakeCall {
  method: string;
  params: unknown;
  /** The connection it came on (1 for the first, 2 after one reconnect, …). */
  connection: number;
}

/** Options of {@link startFakeDaemon}. */
export interface FakeDaemonOptions {
  /** The home to write `daemon.json` in (default: a new temporary folder, removed by `close`). */
  home?: string;
  /** The token adapters must say (default: random). */
  token?: string;
  /** The version `hello` answers (default `0.0.0-fake`). */
  version?: string;
  /** The protocol versions it speaks (default this kit's). */
  protocols?: { min: number; max: number };
  /** The features `hello` answers (default the real daemon's, `HARNESS_FEATURES`; `[]` plays an older daemon). */
  features?: string[];
  /** The installed types `skill.get` lists and `commands.list` gives an entry each (default one, `slides`). */
  types?: SkillTypeLine[];
  /** Answers `skill.get` (default: the protocol's template rendered for the adapter's caps and the params). */
  onSkill?: (params: SkillParams) => SkillResult | Promise<SkillResult>;
  /** Answers `commands.list` (default: `/<command> <type> ` per {@link FakeDaemonOptions.types}). */
  onCommands?: (params: { command?: string; locale?: string }) => { commands: CommandEntry[] } | Promise<{ commands: CommandEntry[] }>;
  /** What `tools.list` answers (default the definitions this kit carries). */
  tools?: ToolDefinition[];
  /** Answers `tools.call` (default `{ content: [{ type: 'text', text: 'ok' }] }`). */
  onToolCall?: (name: string, args: Record<string, unknown>) => ToolCallResult | Promise<ToolCallResult>;
  /** Answers any method first; return `undefined` to leave it to the fake. Throw to answer an error. */
  handle?: (method: string, params: unknown) => unknown;
  /** What `embed.origins` answers (default the fake's own origin, as the daemon's). */
  origins?: EmbedOriginsResult;
  /**
   * What `runtime.status` answers, over a default built from what adapters said in `hello`'s `runtime` (each a
   * `registered` runtime; the running one is the fake's version). List `hello.runtime` / `runtime.update` in `features`
   * to have adapters use it.
   */
  runtimeStatus?: Partial<RuntimeStatus>;
  /** Answers `runtime.update` (default: nothing to update). */
  onRuntimeUpdate?: (version: string | undefined) => RuntimeUpdateResult | Promise<RuntimeUpdateResult>;
}

/** A running fake daemon. */
export interface FakeDaemon {
  /** Its address, `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** The home its `daemon.json` is in. */
  readonly home: string;
  readonly token: string;
  /** Every call adapters made, in order. */
  readonly calls: FakeCall[];
  /** The params of every `hello`. */
  readonly hellos: HelloParams[];
  /** The sessions attached now, by key (`<harness>:<session>`, else `<harness>:w:<workspace>`). */
  readonly sessions: Map<string, AttachParams>;
  /** Whether an adapter is connected and said hello. */
  readonly connected: boolean;
  /** Sends `wake.deliver` to the connected adapter; answers what it answered (`{ status }` objects included). */
  wake(params: Partial<WakeDeliverParams> & { text: string }): Promise<WakeDeliverResult>;
  /** Sends `host.open` to the connected adapter. */
  open(params: Partial<HostOpenParams> & { url: string }): Promise<{ opened: boolean }>;
  /** Sends any call to the connected adapter. */
  request<M extends keyof DaemonToAdapter>(method: M, params: DaemonToAdapter[M]['params']): Promise<DaemonToAdapter[M]['result']>;
  /** Sends an event to adapters that subscribed. */
  emit(event: HarnessEvent): void;
  /** Queues a message for a session; its next `session.attach` (or `inbox.take`) returns it. */
  queueInbox(session: string, message: Partial<InboxMessage> & { text: string }): void;
  /** What `artifact?id=` answers for this id (missing fields get defaults). */
  setArtifact(artifact: Partial<ArtifactDetail> & { id: string }): ArtifactDetail;
  /** `artifact?id=` answers `not_found` for this id again. */
  removeArtifact(id: string): void;
  /** Resolves with the next call of `method` (or a past one not waited for yet). */
  waitFor(method: string, timeoutMs?: number): Promise<FakeCall>;
  /** The `shell.command`s adapters sent, in order. */
  readonly shellCommands: Array<{ view: string; command: HostToShell }>;
  /** The thumbnails saved, by artifact id (JPEG bytes). */
  readonly thumbnails: Map<string, Uint8Array>;
  /** What `view.context` answers for this artifact id (default `{ at: null, context: null, changed: false }`). */
  setContext(id: string, context: Partial<ViewContextResult>): void;
  /** Sends `shell.event` (what the Shell of top-level view `view` said) to the connected adapter. */
  shellEvent(view: string, event: ShellToHost & { artifact?: string }, session?: string | null): Promise<{ ok: true }>;
  /** Tells subscribed adapters a runtime update exists (`runtime/update`; `installed`: already downloaded). */
  runtimeUpdate(available: string, installed?: boolean): void;
  /** Drops the connection, as a daemon that went away; the server keeps listening. */
  drop(): void;
  /** Stops the server (and removes the home it made). */
  close(): Promise<void>;
}

/** Starts a fake daemon on `127.0.0.1` at an ephemeral port. */
export async function startFakeDaemon(options: FakeDaemonOptions = {}): Promise<FakeDaemon> {
  const madeHome = !options.home;
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'oa-fake-daemon-'));
  const token = options.token ?? randomBytes(16).toString('hex');
  const version = options.version ?? '0.0.0-fake';
  const speaks = options.protocols ?? { min: PROTOCOL_MIN, max: PROTOCOL_MAX };
  const calls: FakeCall[] = [];
  const hellos: HelloParams[] = [];
  const sessions = new Map<string, AttachParams>();
  const inboxes = new Map<string, InboxMessage[]>();
  const artifacts = new Map<string, ArtifactDetail>();
  const contexts = new Map<string, ViewContextResult>();
  const views = new Set<string>();
  const shellCommands: Array<{ view: string; command: HostToShell }> = [];
  const thumbnails = new Map<string, Uint8Array>();
  const waiters: Array<{ method: string; seen: number; done: (call: FakeCall) => void }> = [];
  const taken = new Map<string, number>();
  let connections = 0;
  let socket: WebSocketConnection | null = null;
  let harness = '';
  let said = false;
  let subscribed = false;
  let nextId = 1;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  const keyOf = (params: { session?: string | null; workspace?: string | null }): string =>
    params.session ? `${harness}:${params.session}` : `${harness}:w:${params.workspace ?? ''}`;

  const record = (call: FakeCall): void => {
    calls.push(call);
    for (const waiter of [...waiters]) {
      if (waiter.method !== call.method) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      taken.set(call.method, calls.filter((c) => c.method === call.method).length);
      waiter.done(call);
    }
  };

  /** Throws a JSON-RPC error with the daemon's number for `code` (`rpcErrorCode`) and `data: { code, message }`. */
  const fail = (code: string, message: string): never => {
    throw Object.assign(new Error(message), { rpc: { code: rpcErrorCode(code), message, data: { code, message } } });
  };

  const types: SkillTypeLine[] = options.types ?? [{ id: 'slides', title: 'Slides', description: 'A slide deck.' }];
  /** The command the adapter's skill answers to: asked for, else the first of its caps, else `open-artifact`. */
  const commandOf = (asked: unknown): string => (typeof asked === 'string' && asked ? asked : hellos.at(-1)?.caps?.commands?.names?.[0] ?? SKILL_COMMAND);

  /** `skill.get` as the daemon renders it (`harness-skill.ts`), from the adapter's caps and the params alone. */
  const skillOf = (params: SkillParams): SkillResult => {
    const caps = hellos.at(-1)?.caps ?? {};
    const form = params.form ?? 'full';
    if (form !== 'full' && form !== 'entry') fail('invalid_argument', 'form: "entry" or "full".');
    const agentName = params.agentName ?? caps.agentName;
    const tools = params.tools ?? caps.tools;
    const opens = params.opens ?? (caps.open ? 'host' : undefined);
    const o = {
      command: commandOf(params.command),
      ...(agentName ? { agentName } : {}),
      ...(tools ? { tools } : {}),
      ...(params.toolNames ? { toolNames: params.toolNames } : {}),
      ...(opens ? { opens } : {}),
    };
    const body = `${renderSkillBody(o, form)}\n\n${skillTypesSection(types)}`;
    const description = skillDescription(o);
    return { name: o.command, description, argumentHint: SKILL_ARGUMENT_HINT, body, version, etag: createHash('sha256').update(JSON.stringify([o.command, description, body])).digest('hex').slice(0, 16) };
  };

  const commandsOf = (params: { command?: string }): { commands: CommandEntry[] } => {
    const command = commandOf(params.command);
    return { commands: [...types].sort((a, b) => a.id.localeCompare(b.id)).map((t) => ({ text: `/${command} ${t.id} `, type: t.id, title: t.title, description: t.description ?? '' })) };
  };

  const answer = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const own = options.handle?.(method, params);
    if (own !== undefined) return await own;
    if (method !== 'hello' && !said) fail('not_granted', 'Say hello first.');
    switch (method) {
      case 'hello': {
        const hello = params as unknown as HelloParams;
        if (hello.token !== token) fail('not_granted', 'Wrong token.');
        const asked = hello.protocols ?? { min: 1, max: 1 };
        const lo = Math.max(asked.min, speaks.min);
        const hi = Math.min(asked.max, speaks.max);
        if (lo > hi) fail('unsupported_protocol', 'No common protocol version.');
        hellos.push(hello);
        harness = hello.harness;
        said = true;
        return { protocol: hi, daemon: version, connection: `c${connections}`, features: [...(options.features ?? HARNESS_FEATURES)] };
      }
      case 'session.attach': {
        const attach = params as unknown as AttachParams;
        const key = keyOf(attach);
        sessions.set(key, attach);
        const inbox = inboxes.get(attach.session ?? '') ?? [];
        inboxes.delete(attach.session ?? '');
        return { key, inbox };
      }
      case 'session.status':
      case 'session.rename':
        return { ok: true };
      case 'session.detach':
        sessions.delete(keyOf(params as { session?: string }));
        return { ok: true };
      case 'tools.list':
        return { tools: options.tools ?? TOOL_DEFINITIONS };
      case 'tools.call': {
        const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
        return options.onToolCall ? await options.onToolCall(name, args ?? {}) : { content: [{ type: 'text', text: 'ok' }] };
      }
      case 'agent.wrote':
        return { ok: true };
      case 'artifact.open': {
        const id = String((params as { url?: string }).url ?? '').replace(/^open-artifact:\/\/artifact\//, '');
        return { opened: false, view_url: `${server.url}/a/${id}` };
      }
      case 'inbox.take': {
        const session = String((params as { session?: string }).session ?? '');
        const messages = inboxes.get(session) ?? [];
        inboxes.delete(session);
        return { messages };
      }
      case 'subscribe':
        subscribed = !!(params as { on?: boolean }).on;
        return { ok: true };
      case 'embed.origins':
        return options.origins ?? { origins: [server.url], entries: [{ origin: server.url, kind: 'daemon', remote: false }] };
      case 'shell.command': {
        const { view, command } = params as { view?: string; command?: HostToShell };
        if (!view || !views.has(view)) fail('not_found', 'No such view.');
        shellCommands.push({ view: view!, command: command! });
        return { ok: true };
      }
      case 'skill.get':
        return options.onSkill ? await options.onSkill(params as SkillParams) : skillOf(params as SkillParams);
      case 'commands.list':
        return options.onCommands ? await options.onCommands(params as { command?: string; locale?: string }) : commandsOf(params as { command?: string });
      case 'view.context': {
        const id = String((params as { url?: string }).url ?? '').replace(/^open-artifact:\/\/artifact\//, '');
        return contexts.get(id) ?? { at: null, context: null, changed: false };
      }
      case 'runtime.status': {
        const runtimes: RuntimeSource[] = hellos
          .filter((h) => h.runtime?.dir && h.runtime.version)
          .map((h) => ({ source: 'registered', dir: h.runtime!.dir, version: h.runtime!.version, protocols: h.protocols ?? { min: 1, max: 1 }, harness: h.harness }));
        const status: RuntimeStatus = {
          running: version,
          selected: runtimes[0] ?? null,
          runtimes,
          missing: [],
          policy: { update: 'prompt', source: 'default' },
          pin: null,
          registry: 'https://registry.npmjs.org/',
          check: null,
          pending: null,
        };
        return { ...status, ...options.runtimeStatus };
      }
      case 'runtime.update': {
        const asked = (params as { version?: unknown }).version;
        const want = typeof asked === 'string' ? asked : undefined;
        return options.onRuntimeUpdate ? await options.onRuntimeUpdate(want) : { installed: null, pending: false, message: 'Nothing to update (fake daemon).' };
      }
      default:
        return fail('method_not_found', `No method ${method}.`);
    }
  };

  const onMessage = async (connection: WebSocketConnection, id: number, text: string): Promise<void> => {
    let message: { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message.method) {
      const waiting = pending.get(String(message.id));
      if (!waiting) return;
      pending.delete(String(message.id));
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
      return;
    }
    record({ method: message.method, params: message.params ?? {}, connection: id });
    try {
      const result = await answer(message.method, message.params ?? {});
      if (message.id !== undefined) connection.sendText(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: result ?? null }));
    } catch (error) {
      const rpc = (error as { rpc?: unknown }).rpc ?? { code: rpcErrorCode('error'), message: (error as Error)?.message ?? String(error) };
      if (message.id !== undefined) connection.sendText(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: rpc }));
    }
  };

  const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const http: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === `/api/open-artifact.${LIBRARY_ROUTES.thumbnail}` && req.headers.authorization === `Bearer ${token}`) {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        thumbnails.set(url.searchParams.get('id') ?? '', new Uint8Array(Buffer.concat(chunks)));
        sendJson(res, 200, { thumbnail: 'fake' });
      });
      return;
    }
    req.resume();
    if (url.pathname === '/__open-artifact/health') return sendJson(res, 200, { openArtifact: 1, version, pid: process.pid });
    if (req.headers.authorization !== `Bearer ${token}`) return sendJson(res, 401, { code: 'not_granted', message: 'Token required.' });
    if (url.pathname === `/api/open-artifact.${LIBRARY_ROUTES.artifact}`) {
      const found = artifacts.get(url.searchParams.get('id') ?? '');
      return found ? sendJson(res, 200, found) : sendJson(res, 404, { code: 'not_found', message: 'No such artifact.' });
    }
    return sendJson(res, 404, { code: 'not_found', message: `Not served by the fake daemon: ${url.pathname}` });
  });
  http.on('upgrade', (req, sock, head) => {
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== HARNESS_PATH) {
      sock.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    const connection = acceptWebSocket(req, sock, head, HARNESS_SUBPROTOCOL);
    if (!connection) return;
    // One adapter at a time: a new connection replaces the old one.
    socket?.close();
    const id = ++connections;
    socket = connection;
    said = false;
    subscribed = false;
    connection.handlers = {
      message: (text) => void onMessage(connection, id, text),
      close: () => {
        if (socket !== connection) return;
        socket = null;
        said = false;
        for (const waiting of pending.values()) waiting.reject(new Error('The adapter went away.'));
        pending.clear();
      },
    };
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  const server = { url: `http://127.0.0.1:${(http.address() as AddressInfo).port}` };
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'daemon.json'), JSON.stringify({ url: server.url, port: Number(server.url.split(':')[2]), pid: process.pid, token, version }));

  const request = <M extends keyof DaemonToAdapter>(method: M, params: DaemonToAdapter[M]['params']): Promise<DaemonToAdapter[M]['result']> =>
    new Promise((resolveCall, rejectCall) => {
      if (!socket || !said) {
        rejectCall(new Error('No adapter is connected.'));
        return;
      }
      const id = `d${nextId++}`;
      pending.set(id, { resolve: resolveCall as (value: unknown) => void, reject: rejectCall });
      socket.sendText(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });

  return {
    url: server.url,
    home,
    token,
    calls,
    hellos,
    sessions,
    get connected() {
      return !!socket && said;
    },
    async wake(params) {
      const artifact = params.artifact ?? artifactUrl(params.artifactId ?? 'a1');
      const full: WakeDeliverParams = {
        session: params.session ?? null,
        workspace: params.workspace ?? null,
        artifact,
        artifactId: params.artifactId ?? artifact.replace(/^open-artifact:\/\/artifact\//, ''),
        text: params.text,
        source: params.source ?? {
          kind: WAKE_SOURCE_KIND,
          artifactId: params.artifactId ?? artifact.replace(/^open-artifact:\/\/artifact\//, ''),
          url: artifact,
          title: 'Untitled',
          root: '',
          viewUrl: `${server.url}/a/${params.artifactId ?? ''}`,
          threads: [],
          requests: [],
          summary: params.text.slice(0, 120),
          reason: 'comment',
          from: { kind: 'owner' },
        },
      };
      const result = (await request('wake.deliver', full)) as WakeDeliverResult | WakeDeliverResult['status'];
      return typeof result === 'string' ? { status: result } : result;
    },
    open(params) {
      const id = params.url.replace(/^open-artifact:\/\/artifact\//, '');
      if (params.view) views.add(params.view);
      return request('host.open', { ...params, session: params.session ?? null, view_url: params.view_url ?? `${server.url}/a/${id}` });
    },
    request,
    emit(event) {
      if (socket && said && subscribed) socket.sendText(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: event }));
    },
    queueInbox(session, message) {
      const list = inboxes.get(session) ?? [];
      list.push({ kind: 'wake', at: new Date().toISOString(), ...message });
      inboxes.set(session, list);
    },
    setArtifact(artifact) {
      const now = new Date().toISOString();
      const detail: ArtifactDetail = {
        url: artifactUrl(artifact.id),
        title: 'Untitled',
        type: 'slides',
        typeTitle: 'Slides',
        typeMissing: false,
        root: join(home, 'artifacts', artifact.id),
        view_url: `${server.url}/a/${artifact.id}`,
        page_url: `${server.url}/a/${artifact.id}/page`,
        owner: null,
        pinned: false,
        createdAt: now,
        updatedAt: now,
        openedAt: null,
        contentAt: null,
        thumbnail: null,
        shared: false,
        open: false,
        bytes: 0,
        ...artifact,
      };
      artifacts.set(artifact.id, detail);
      return detail;
    },
    removeArtifact(id) {
      artifacts.delete(id);
    },
    shellCommands,
    thumbnails,
    setContext(id, context) {
      contexts.set(id, { at: null, context: null, changed: false, ...context });
    },
    shellEvent(view, event, session = null) {
      const params: ShellEventParams = { view, session, event } as ShellEventParams;
      return request('shell.event', params) as Promise<{ ok: true }>;
    },
    waitFor(method, timeoutMs = 5000) {
      const seen = taken.get(method) ?? 0;
      const past = calls.filter((c) => c.method === method);
      if (past.length > seen) {
        taken.set(method, seen + 1);
        return Promise.resolve(past[seen]!);
      }
      return new Promise((resolveWait, rejectWait) => {
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          rejectWait(new Error(`No ${method} call within ${timeoutMs} ms.`));
        }, timeoutMs);
        const waiter = {
          method,
          seen,
          done: (call: FakeCall) => {
            clearTimeout(timer);
            resolveWait(call);
          },
        };
        waiters.push(waiter);
      });
    },
    runtimeUpdate(available, installed = false) {
      if (socket && said && subscribed) socket.sendText(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'runtime/update', current: version, available, installed } }));
    },
    drop() {
      socket?.close(1012);
    },
    async close() {
      socket?.close(1001);
      const closed = new Promise<void>((done) => http.close(() => done()));
      http.closeAllConnections?.();
      await closed;
      if (madeHome) rmSync(home, { recursive: true, force: true });
    },
  };
}
