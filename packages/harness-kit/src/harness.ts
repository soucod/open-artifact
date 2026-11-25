/**
 * `createHarness`: everything an agent app's adapter does with the daemon, behind one object.
 *
 * It finds or starts the daemon, connects, and keeps the connection: a dropped one comes back with backoff, attaches
 * every session again and hands what waited in their inboxes to the `wake` callback. The app answers two callbacks,
 * `wake` (give a message to a session) and `open` (show a page in its own UI), and calls the rest: sessions, tools,
 * files its agent wrote, and the artifacts its sessions make.
 */

import {
  LIBRARY_ROUTES,
  OpenArtifactError,
  TOOL_DEFINITIONS,
  artifactIdOf,
  artifactUrl,
  type AdapterCaps,
  type ArtifactDetail,
  type AttachParams,
  type CommandEntry,
  type EmbedOriginsResult,
  type HarnessEvent,
  type HostToShell,
  type ShellEventParams,
  type HarnessPolicy,
  type HarnessProfile,
  type HarnessRuntime,
  type HelloResult,
  type HostOpenParams,
  type InboxMessage,
  type RuntimeStatus,
  type RuntimeUpdateResult,
  type SessionParams,
  type SessionStatus,
  type ToolCallResult,
  type ToolDefinition,
  type WakeDeliverParams,
  type WakeDeliverResult,
  type WakeDeliverStatus,
  type WakeSource,
  wakeSourceOf,
} from '@open-artifact/protocol';
import { HarnessClient, type HarnessConnectionState } from './client.ts';
import { api, type EnsureDaemonOptions } from './daemon.ts';
import { commands, keepSkillInstalled, type InstallSkillOptions, type InstallSkillResult } from './skill.ts';
import { contextBlock, readContext, type ArtifactContext } from './context.ts';
import { remoteGate, remotePolicyOf, type AllowRemote, type RemotePage, type RemotePagePolicy } from './embed/remote.ts';
import pkg from '../package.json' with { type: 'json' };

/** This kit's name and version, said in `hello` (`kit`). */
export const KIT = { name: '@open-artifact/harness-kit', version: (pkg as { version?: string }).version ?? '0.0.0' } as const;

/** What the `wake` callback answers: a status, or a status with the session that took the message instead. */
export type WakeAnswer = WakeDeliverStatus | WakeDeliverResult;

/** What the `open` callback gets: show this artifact for this session. */
export interface OpenRequest {
  /** The session that asked, or `null` when no session did. */
  session: string | null;
  /** `open-artifact://artifact/<id>`. */
  url: string;
  /** The Shell page. */
  viewUrl: string;
  /** What a top-level view loads: `viewUrl` with a view ticket when the daemon gave one, else `viewUrl`. */
  embedUrl: string;
  /** The view ticket, when the daemon gave one. */
  view?: string;
  title?: string;
  /**
   * The artifact's type is on another computer: its page comes from these origins. Present only once the host's
   * `embed.remote` policy let it through (`allow`, or `ask` answered yes); the host lets these origins in to show it.
   */
  remote?: RemotePage;
}

/** An artifact as `on('artifact')` reports it. */
export interface HarnessArtifact {
  /** `open-artifact://artifact/<id>`: what to store in messages and cards (it does not change with the daemon's port). */
  url: string;
  id: string;
  title: string;
  /** The type id. */
  type: string;
  /** The local Shell page (also when it is published: the person's own copy); `null` once removed. */
  viewUrl: string | null;
  /** Its address on the site it is published to, or `null` when it is not published. */
  publicUrl?: string | null;
  /** The Library API address of its thumbnail, when one was captured. */
  thumbnail: string | null;
  updatedAt: string;
}

/** What changed about an artifact. */
export type ArtifactChange = 'created' | 'updated' | 'removed';

/** An `on('artifact')` report. */
export interface ArtifactReport {
  /** The session of this harness that owns the artifact, or `null` when it is not one of this harness's sessions. */
  session: string | null;
  /** That session's workspace, when known. */
  workspace: string | null;
  artifact: HarnessArtifact;
  change: ArtifactChange;
  /** Who changed it, as the daemon said (`agent`, or the person's page). */
  author?: string;
  /** The files that changed, when the daemon said. */
  paths?: string[];
}

/** Options of {@link createHarness}. */
export interface HarnessOptions {
  /** The harness name (`^[a-z0-9][a-z0-9._-]{0,40}$`). */
  harness: string;
  /** What the harness calls its agent. */
  agentName?: string;
  /** The harness's command names, e.g. `['artifact']`. */
  commands?: string[];
  /** Capabilities beyond what the callbacks and options imply (see {@link createHarness}). */
  caps?: AdapterCaps;
  /** The harness's rules that are data (the daemon writes its instructions by them, or refuses calls). */
  policy?: HarnessPolicy;
  /** The harness's rules that are only text. */
  rules?: string;
  /** More of the harness's profile, reported in `hello` (`nudge` is never sent). */
  profile?: Omit<Partial<HarnessProfile>, 'nudge' | 'name' | 'source'>;
  /** The runtime the harness carries (`@open-artifact/cli`): it starts the daemon when none runs. */
  runtime?: HarnessRuntime;
  /**
   * How the harness embeds pages, when it shows them itself (`open`). `remote` is what it does with a remote type's
   * page (one on another computer): `allow` shows it, `deny` answers not-opened without calling `open`, `ask` (the
   * default) asks `allowRemote`, keeping a yes per origin for the life of the process and asking again after a no.
   */
  embed?: { origins: string[]; mode?: 'frame' | 'view'; remote?: RemotePagePolicy };
  /** Asked under `embed.remote: 'ask'` before a remote type's page is shown; without it the answer is no. */
  allowRemote?: AllowRemote;
  /** An Open Artifact home of the harness's own: its own daemon and library, apart from the other apps'. */
  home?: string;
  /** Start the daemon when none runs (default `true`). */
  autoStart?: boolean;
  /** More options for starting the daemon (`env`, `bin`, `timeoutMs`, and `spawn` for a host that starts the process itself). */
  daemon?: EnsureDaemonOptions;
  /** Gives a message to a session (`wake.deliver`); see {@link createHarness}. */
  wake?: (params: WakeDeliverParams) => WakeAnswer | Promise<WakeAnswer>;
  /** Shows a page in the harness's own UI (`host.open`). `false`: it was not shown. */
  open?: (request: OpenRequest) => boolean | void | Promise<boolean | void>;
  /** How long `wake` may take before the daemon is told it failed (and keeps the message), ms. Default 25 s. */
  wakeTimeoutMs?: number;
  /** Reconnect delays, ms: from `minMs` (default 1 s) doubling to `maxMs` (default 30 s). */
  reconnect?: { minMs?: number; maxMs?: number };
  /** Diagnostic log. */
  log?: (line: string) => void;
}

/**
 * The runtime calls (feature `runtime.update`): what runtimes this computer has and which starts, and the host's yes
 * to an update. Both connect first, and throw `unsupported` when the daemon does not list the feature.
 */
export interface HarnessRuntimeCalls {
  /** `runtime.status`: the runtimes here, the update policy, the last check and a waiting switch. */
  status(): Promise<RuntimeStatus>;
  /**
   * `runtime.update`: downloads the newest compatible runtime (or `version`) into the shared folder; the daemon
   * switches once idle. Refused (`not_granted`) when updates are off for the whole computer.
   */
  update(version?: string): Promise<RuntimeUpdateResult>;
}

/** The connection to the daemon, as {@link createHarness} returns it. */
export interface Harness {
  /** The underlying connection, for calls the kit does not wrap (`client.request(method, params)`). */
  readonly client: HarnessClient;
  /** Whether the connection is up. */
  readonly connected: boolean;
  /** The daemon's features (see `HarnessFeature`); empty while not connected. */
  readonly features: readonly string[];
  /** Connects now if it is not connected (starting the daemon unless `autoStart` is false). */
  ready(): Promise<HelloResult>;
  /**
   * Attaches a session; a reconnect attaches it again. What waited in its inbox goes to the `wake` callback; the
   * answer's `inbox` holds what the callback did not take (all of it without a callback).
   */
  attach(params: AttachParams): Promise<{ key: string; inbox: InboxMessage[] }>;
  /** The session's agent is `running` or `idle` now. */
  status(session: string | SessionParams, status: SessionStatus): Promise<void>;
  /** Detaches a session. */
  detach(session: string | SessionParams): Promise<void>;
  /** Renames a session. */
  rename(session: string | SessionParams, title: string): Promise<void>;
  /** The tool definitions: the daemon's when connected, else the ones this kit carries. */
  tools(): Promise<ToolDefinition[]>;
  /** Calls a tool for a session. */
  call(name: string, args: Record<string, unknown>, caller?: SessionParams): Promise<ToolCallResult>;
  /** The agent wrote these files (absolute paths) with its own tools. */
  wrote(paths: string[], caller?: SessionParams): Promise<{ ok: true; artifacts?: string[] }>;
  /** Shows an artifact for a session (through `open`, when the harness shows pages). */
  open(url: string, options?: SessionParams): Promise<{ opened: boolean; view_url?: string }>;
  /** Whether a tool call is about an Open Artifact link (`url` or `type_url` is `open-artifact://…`). */
  owns(args: Record<string, unknown> | null | undefined): boolean;
  /**
   * The artifact's local Shell page (stable while the daemon keeps its port; also for a published artifact), or `null`
   * when the daemon does not know it. The published address is {@link Harness.publicUrl}.
   */
  viewUrl(url: string): Promise<string | null>;
  /** The artifact's address on the site it is published to, or `null` (not published, or unknown). */
  publicUrl(url: string): Promise<string | null>;
  /** The origins a host must let in to show pages (feature `embed.origins`); `on('event')` gets `embed/origins` changes. */
  embedOrigins(): Promise<EmbedOriginsResult>;
  /** Sends a host message to the Shell of a top-level view this harness opened (feature `shell.command`). */
  shellCommand(view: string, command: HostToShell): Promise<void>;
  /**
   * What the person selected on the artifact's page, read as its owner session (feature `view.context`); turn it into
   * prompt text with {@link Harness.contextBlock}. `on('event')` gets `view/context` when it changes (best effort).
   */
  context(url: string, options?: { session?: string | null; workspace?: string | null }): Promise<ArtifactContext>;
  /** The prompt block of a context (see `contextBlock`): `''` when there is nothing to say. */
  contextBlock(context: ArtifactContext | null | undefined): string;
  /** Saves a captured thumbnail (JPEG bytes) for the artifact, for libraries and cards. */
  saveThumbnail(url: string, jpeg: Uint8Array): Promise<void>;
  /** What the Shell of a top-level view this harness opened says (`shell.event`). Returns a function that stops. */
  on(event: 'shell', listener: (event: ShellEventParams) => void): () => void;
  /** Reports artifacts created, changed or removed. Returns a function that stops. */
  on(event: 'artifact', listener: (report: ArtifactReport) => void): () => void;
  /** Every event the daemon sends. Returns a function that stops. */
  on(event: 'event', listener: (event: HarnessEvent) => void): () => void;
  /** The connection went up or down. Returns a function that stops. */
  on(event: 'state', listener: (state: HarnessConnectionState) => void): () => void;
  /**
   * Writes the skill for this harness into `<dir>/<command>/SKILL.md` (rendered by the daemon, `skill.get`, else by
   * this kit), only when it changed; again after a reconnect to another runtime.
   */
  installSkill(options: InstallSkillOptions): Promise<InstallSkillResult>;
  /** One command per installed type, for the harness's command menu (`commands.list`; `[]` without it). */
  commands(options?: { command?: string; locale?: string }): Promise<CommandEntry[]>;
  /** The runtime's status and updates (feature `runtime.update`); `on('event')` gets `runtime/update` when one exists. */
  readonly runtime: HarnessRuntimeCalls;
  /** Closes the connection for good. */
  close(): void;
}

/** Default of {@link HarnessOptions.wakeTimeoutMs}: under the daemon's own 30 s wait for an answer. */
const WAKE_TIMEOUT_MS = 25_000;

const sessionParams = (session: string | SessionParams): SessionParams => (typeof session === 'string' ? { session } : session);

/** A string that is an Open Artifact link. */
const isLink = (value: unknown): boolean => typeof value === 'string' && value.trim().startsWith('open-artifact://');

/** Whether a tool call is about an Open Artifact link (`url` or `type_url`), so a harness with its own tools can route it. */
export function ownsCall(args: Record<string, unknown> | null | undefined): boolean {
  return !!args && (isLink(args.url) || isLink(args.type_url));
}

/** The caps `hello` says: `options.caps`, plus what the callbacks and options imply. */
function capsOf(options: HarnessOptions): AdapterCaps {
  const caps: AdapterCaps = { ...options.caps };
  if (options.agentName && !caps.agentName) caps.agentName = options.agentName;
  // Without a callback the adapter cannot answer the call, so it does not claim it.
  if (options.wake) caps.wake = caps.wake ?? {};
  else delete caps.wake;
  if (options.open) {
    if (caps.open === undefined || caps.open === true) caps.open = options.embed ? { embed: options.embed.mode ?? 'frame', origins: [...options.embed.origins], remote: remotePolicyOf(options.embed.remote) } : true;
  } else delete caps.open;
  if (options.commands?.length && !caps.commands) caps.commands = { names: [...options.commands] };
  return caps;
}

/** The profile `hello` reports, or `undefined` when there is nothing to say. */
function profileOf(options: HarnessOptions, caps: AdapterCaps): Omit<Partial<HarnessProfile>, 'nudge'> | undefined {
  const { nudge: _nudge, ...given } = (options.profile ?? {}) as Partial<HarnessProfile>;
  const profile: Omit<Partial<HarnessProfile>, 'nudge'> = {
    ...given,
    ...(options.agentName ? { agentName: options.agentName } : {}),
    ...(options.commands?.length ? { commands: [...options.commands] } : {}),
    ...(options.policy ? { policy: options.policy } : {}),
    ...(options.rules ? { rules: options.rules } : {}),
    ...(Object.keys(caps).length ? { caps } : {}),
  };
  return Object.keys(profile).length ? profile : undefined;
}

/** Runs `work`, or gives `fallback` when it takes longer than `ms`. */
function within<T>(work: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise((resolveIt, rejectIt) => {
    const timer = setTimeout(() => resolveIt(fallback()), ms);
    (timer as { unref?: () => void }).unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolveIt(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectIt(error);
      },
    );
  });
}

/** The wake to hand to the `wake` callback for one inbox message, or `null` when it is not a whole wake. */
function inboxWake(message: InboxMessage, ref: SessionParams): WakeDeliverParams | null {
  if (message.kind !== 'wake' || typeof message.text !== 'string' || !message.text || !message.source || typeof message.source !== 'object') return null;
  return {
    session: ref.session ?? null,
    workspace: ref.workspace ?? null,
    artifact: message.artifact ?? (message.source as WakeSource).url ?? '',
    artifactId: message.artifactId ?? (message.source as WakeSource).artifactId ?? '',
    text: message.text,
    source: message.source as WakeSource,
  };
}

/**
 * Connects an agent app to the daemon. Resolves once the first connection attempt is over: when it failed (no daemon
 * and `autoStart: false`, say), the harness keeps trying in the background and calls connect on demand.
 *
 * What `hello` says follows from the options: `caps.wake` when there is a `wake` callback, `caps.open` when there is
 * an `open` callback (`{ embed, origins }` with `embed`), `caps.commands` from `commands`, `caps.agentName` from
 * `agentName`; `options.caps` adds the rest (`tools`, `library`, `wake.resume`, `wake.mode`). The profile carries
 * `agentName`, `commands`, `policy`, `rules`, the caps and `options.profile`.
 *
 * `wake` answers how it handed the message over: `resumed` (started a turn), `delivered` (put it into the running
 * turn), `drafted` (put it in the session's draft, for a harness whose `caps.wake.mode` is `draft`) or `failed` (the
 * daemon keeps it for later). It may name the session that took it instead: `{ status, session }`. A callback that
 * throws, or takes longer than `wakeTimeoutMs`, answers `failed`.
 */
export async function createHarness(options: HarnessOptions): Promise<Harness> {
  const log = options.log ?? (() => undefined);
  const caps = capsOf(options);
  // A remote type's page passes this gate before `open` sees it (the policy `hello` said; `ask` by default).
  const remoteOk = remoteGate(typeof caps.open === 'object' && caps.open.remote ? caps.open.remote : remotePolicyOf(options.embed?.remote), options.allowRemote);
  const profile = profileOf(options, caps);
  const daemon: EnsureDaemonOptions = {
    ...options.daemon,
    ...(options.home ? { home: options.home } : {}),
  };
  // The harness's runtime is one candidate: the newest compatible runtime on this computer starts (`runtimes.ts`);
  // `daemon.bin` and $OPEN_ARTIFACT_DAEMON_BIN override the choice.
  if (!daemon.bin && !daemon.own && options.runtime?.dir) daemon.own = { dir: options.runtime.dir.replace(/[\\/]+$/, ''), version: options.runtime.version };
  if (!daemon.version && options.runtime?.version) daemon.version = options.runtime.version;

  const listeners = {
    artifact: new Set<(report: ArtifactReport) => void>(),
    event: new Set<(event: HarnessEvent) => void>(),
    state: new Set<(state: HarnessConnectionState) => void>(),
    shell: new Set<(event: ShellEventParams) => void>(),
  };
  const emit = (kind: keyof typeof listeners, value: unknown): void => {
    for (const listener of listeners[kind] as Set<(value: unknown) => void>) {
      try {
        listener(value);
      } catch (error) {
        log(`open-artifact ${kind} listener: ${(error as Error)?.message ?? error}`);
      }
    }
  };

  /** Inbox messages the `wake` callback did not take on a re-attach, handed back by the session's next attach. */
  const leftovers = new Map<string, InboxMessage[]>();
  const sessionKey = (ref: SessionParams): string => (ref.session ? `s:${ref.session}` : `w:${ref.workspace ?? ''}`);
  const timeout = options.wakeTimeoutMs ?? WAKE_TIMEOUT_MS;

  /** Asks the `wake` callback; never throws. */
  const wake = async (params: WakeDeliverParams): Promise<WakeDeliverResult> => {
    if (!options.wake) return { status: 'failed' };
    try {
      // An older daemon's wake has no `reason` or `from`: they are read from its text, so the callback always has them.
      const filled: WakeDeliverParams = { ...params, source: wakeSourceOf(params.source, params.text) };
      const answer = await within(Promise.resolve(options.wake(filled)), timeout, () => {
        log(`open-artifact wake for ${params.session ?? params.workspace}: no answer in ${timeout} ms`);
        return 'failed' as WakeAnswer;
      });
      const result = typeof answer === 'string' ? { status: answer } : answer;
      if (!result || typeof result.status !== 'string') return { status: 'failed' };
      return { status: result.status, ...(typeof result.session === 'string' && result.session ? { session: result.session } : {}) };
    } catch (error) {
      log(`open-artifact wake for ${params.session ?? params.workspace}: ${(error as Error)?.message ?? error}`);
      return { status: 'failed' };
    }
  };

  /** Hands an attach's inbox to `wake`; returns what it did not take. */
  const handOver = async (ref: SessionParams, inbox: InboxMessage[] | undefined): Promise<InboxMessage[]> => {
    const left: InboxMessage[] = [];
    for (const message of inbox ?? []) {
      const params = options.wake ? inboxWake(message, ref) : null;
      if (!params || (await wake(params)).status === 'failed') left.push(message);
    }
    return left;
  };

  // ---- artifacts ----

  const known = new Map<string, HarnessArtifact>();
  let since = Date.now();
  const queued = new Map<string, { removed: boolean; author?: string; paths: Set<string> }>();
  const chains = new Map<string, Promise<void>>();

  const lookup = async (id: string): Promise<(ArtifactDetail & { code?: unknown }) | null> => {
    const state = client.state ?? (await client.connect().then(() => client.state));
    if (!state) return null;
    const record = await api<ArtifactDetail & { code?: unknown }>(state, LIBRARY_ROUTES.artifact, undefined, { query: { id } }).catch(() => null);
    return record && typeof record.id === 'string' && record.id === id ? record : null;
  };

  const toArtifact = (record: ArtifactDetail): HarnessArtifact => {
    const base = client.state?.url ?? '';
    return {
      url: record.url || artifactUrl(record.id),
      id: record.id,
      title: record.title,
      type: record.type,
      // The local Shell, also for a published artifact (its site's address is `publicUrl`).
      viewUrl: base ? `${base}/a/${encodeURIComponent(record.id)}` : record.view_url || null,
      publicUrl: record.remote?.url || null,
      thumbnail: record.thumbnail ? `${base}/api/open-artifact.${LIBRARY_ROUTES.thumbnail}?id=${encodeURIComponent(record.id)}&v=${encodeURIComponent(record.thumbnail)}` : null,
      updatedAt: record.updatedAt,
    };
  };

  const report = async (id: string): Promise<void> => {
    const item = queued.get(id);
    queued.delete(id);
    if (!item) return;
    const extra = { ...(item.author ? { author: item.author } : {}), ...(item.paths.size ? { paths: [...item.paths] } : {}) };
    if (item.removed) {
      const last = known.get(id);
      known.delete(id);
      const artifact: HarnessArtifact = last ? { ...last, viewUrl: null, publicUrl: null } : { url: artifactUrl(id), id, title: '', type: '', viewUrl: null, publicUrl: null, thumbnail: null, updatedAt: new Date().toISOString() };
      emit('artifact', { session: null, workspace: null, artifact, change: 'removed', ...extra });
      return;
    }
    const record = await lookup(id);
    if (!record) return;
    const artifact = toArtifact(record);
    // The first report of an artifact made since the kit started following is its creation.
    const change: ArtifactChange = !known.has(id) && Date.parse(record.createdAt) >= since - 1000 ? 'created' : 'updated';
    known.set(id, artifact);
    const owner = record.owner && record.owner.harness === options.harness ? record.owner : null;
    emit('artifact', { session: owner?.session ?? null, workspace: owner?.workspace ?? null, artifact, change, ...extra });
  };

  const onEvent = (event: HarnessEvent): void => {
    emit('event', event);
    if (event.type !== 'artifacts/changed' || !listeners.artifact.size) return;
    const waiting = queued.get(event.id);
    if (waiting) {
      // Not looked up yet: one report covers both.
      waiting.removed ||= !!event.removed;
      if (event.author) waiting.author = event.author;
      for (const path of event.paths ?? []) waiting.paths.add(path);
      return;
    }
    queued.set(event.id, { removed: !!event.removed, ...(event.author ? { author: event.author } : {}), paths: new Set(event.paths ?? []) });
    const next = (chains.get(event.id) ?? Promise.resolve()).then(() => report(event.id)).catch((error: Error) => log(`open-artifact artifact ${event.id}: ${error.message}`));
    chains.set(event.id, next);
    void next.finally(() => {
      if (chains.get(event.id) === next) chains.delete(event.id);
    });
  };

  // ---- the connection ----

  const client = new HarnessClient({
    harness: options.harness,
    caps,
    hello: { kit: { ...KIT }, ...(profile ? { profile } : {}), ...(options.runtime ? { runtime: options.runtime } : {}) },
    daemon,
    ...(options.autoStart !== undefined ? { autoStart: options.autoStart } : {}),
    reconnect: { minMs: options.reconnect?.minMs ?? 1000, maxMs: options.reconnect?.maxMs ?? 30_000 },
    log,
    onEvent,
    onState: (state) => emit('state', state),
    onReattach: async (params, result) => {
      const left = await handOver(params, result.inbox);
      if (left.length) {
        const key = sessionKey(params);
        leftovers.set(key, [...(leftovers.get(key) ?? []), ...left]);
        log(`open-artifact: ${left.length} message(s) for ${params.session ?? params.workspace} were not taken; the next attach returns them`);
      }
    },
    handlers: {
      ...(options.wake ? { 'wake.deliver': (params: WakeDeliverParams) => wake(params) } : {}),
      'shell.event': (params: ShellEventParams) => {
        emit('shell', params);
        return { ok: true } as const;
      },
      ...(options.open
        ? {
            'host.open': async (params: HostOpenParams) => {
              const remote = params.remote && typeof params.remote.type === 'string' && Array.isArray(params.remote.origins) ? { type: params.remote.type, origins: params.remote.origins.filter((o) => typeof o === 'string') } : undefined;
              try {
                if (!(await remoteOk(remote, params.title))) {
                  log(`open-artifact open ${params.url}: a page from ${remote!.origins.join(', ')} (another computer) was not allowed`);
                  return { opened: false };
                }
              } catch {
                return { opened: false };
              }
              const request: OpenRequest = {
                session: params.session ?? null,
                url: params.url,
                viewUrl: params.view_url,
                embedUrl: params.embed_url || params.view_url,
                ...(params.view ? { view: params.view } : {}),
                ...(params.title !== undefined ? { title: params.title } : {}),
                ...(remote?.origins.length ? { remote } : {}),
              };
              try {
                return { opened: (await options.open!(request)) !== false };
              } catch (error) {
                log(`open-artifact open ${params.url}: ${(error as Error)?.message ?? error}`);
                return { opened: false };
              }
            },
          }
        : {}),
    },
  });
  // Events are only asked for while someone listens.
  await client.subscribe(false);

  try {
    await client.connect();
  } catch (error) {
    log(`open-artifact connect: ${(error as Error)?.message ?? error}`);
    client.reconnect();
  }

  /** Connects if needed, then throws `unsupported` unless the daemon lists `feature`. */
  const needs = async (feature: string, method: string): Promise<void> => {
    if (!client.connected) await client.connect();
    if (!client.features.includes(feature)) {
      throw new OpenArtifactError('unsupported', `${method} needs feature ${feature}, which daemon ${client.hello?.daemon ?? '(unknown)'} does not list.`, { fix: 'Update the Open Artifact runtime this computer runs.' });
    }
  };

  const harness: Harness = {
    client,
    get connected() {
      return client.connected;
    },
    get features() {
      return client.features;
    },
    ready: () => client.connect(),
    async attach(params) {
      const result = await client.attach(params);
      const key = sessionKey(params);
      const earlier = leftovers.get(key) ?? [];
      leftovers.delete(key);
      return { key: result.key, inbox: [...earlier, ...(await handOver(params, result.inbox))] };
    },
    async status(session, status) {
      await client.status({ ...sessionParams(session), status });
    },
    async detach(session) {
      leftovers.delete(sessionKey(sessionParams(session)));
      await client.detach(sessionParams(session));
    },
    async rename(session, title) {
      await client.rename({ ...sessionParams(session), title });
    },
    async tools() {
      if (client.connected) {
        try {
          return await client.tools();
        } catch (error) {
          log(`open-artifact tools.list: ${(error as Error)?.message ?? error}`);
        }
      }
      return TOOL_DEFINITIONS.map((tool) => ({ ...tool }));
    },
    call: (name, args, caller) => client.callTool(name, args, caller),
    wrote: (paths, caller) => client.request('agent.wrote', { paths, ...(caller ? { caller } : {}) }),
    open: (url, opts) => client.request('artifact.open', { url, ...(opts ? { caller: opts } : {}) }),
    owns: ownsCall,
    async viewUrl(url) {
      const id = artifactIdOf(url);
      if (!id) throw new OpenArtifactError('invalid_argument', `Not an artifact: ${url}`);
      const record = await lookup(id);
      return record ? toArtifact(record).viewUrl : null;
    },
    async publicUrl(url) {
      const id = artifactIdOf(url);
      if (!id) throw new OpenArtifactError('invalid_argument', `Not an artifact: ${url}`);
      const record = await lookup(id);
      return record?.remote?.url || null;
    },
    embedOrigins: () => client.request('embed.origins', {}),
    async shellCommand(view, command) {
      await client.request('shell.command', { view, command });
    },
    context: (url, opts) => readContext(client, url, opts),
    contextBlock,
    async saveThumbnail(url, jpeg) {
      const id = artifactIdOf(url);
      if (!id) throw new OpenArtifactError('invalid_argument', `Not an artifact: ${url}`);
      const state = client.state ?? (await client.connect().then(() => client.state));
      if (!state) throw new OpenArtifactError('no_daemon', 'Not connected to the daemon.');
      const target = new URL(`/api/open-artifact.${LIBRARY_ROUTES.thumbnail}`, state.url);
      target.searchParams.set('id', id);
      const response = await fetch(target, { method: 'POST', headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'image/jpeg' }, body: new Blob([new Uint8Array(jpeg)]) });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
        throw new OpenArtifactError((body.code as never) ?? 'error', body.message ?? `thumbnail: HTTP ${response.status}`);
      }
    },
    on(kind: 'artifact' | 'event' | 'state' | 'shell', listener: (value: never) => void) {
      const set = listeners[kind] as Set<(value: never) => void>;
      const wantsEvents = (): boolean => listeners.artifact.size + listeners.event.size > 0;
      const before = wantsEvents();
      set.add(listener);
      if (!before && wantsEvents()) {
        since = Date.now();
        void client.subscribe(true).catch((error: Error) => log(`open-artifact subscribe: ${error.message}`));
      }
      return () => {
        if (!set.delete(listener)) return;
        if (kind !== 'state' && kind !== 'shell' && !wantsEvents()) void client.subscribe(false).catch(() => undefined);
      };
    },
    async installSkill(opts) {
      // With an `open` handler the app shows pages itself: the kit's own rendering says so, as the daemon's does.
      const withOpens = options.open && opts.opens === undefined ? { ...opts, opens: 'host' as const } : opts;
      return (await keepSkillInstalled(client, withOpens, (listener) => harness.on('state', listener), log)).result;
    },
    commands: (opts) => commands(client, opts),
    runtime: {
      async status() {
        await needs('runtime.update', 'runtime.status');
        return client.request('runtime.status', {});
      },
      async update(version) {
        await needs('runtime.update', 'runtime.update');
        return client.request('runtime.update', version ? { version } : {});
      },
    },
    close: () => client.close(),
  };
  return harness;
}
