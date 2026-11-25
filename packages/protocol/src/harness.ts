/**
 * The Harness API: how a harness adapter (a plugin inside an agent harness)
 * talks to the daemon.
 *
 * Transport: JSON-RPC 2.0 over a WebSocket at `<daemon>/__harness`, with the
 * subprotocol {@link HARNESS_SUBPROTOCOL}. Both sides call: the adapter calls
 * the daemon ({@link AdapterToDaemon}) and the daemon calls the adapter
 * ({@link DaemonToAdapter}). The first call must be `hello` with the daemon
 * token from `daemon.json`. In it the adapter may say the protocol versions it
 * speaks (`protocols`, between {@link PROTOCOL_MIN} and {@link PROTOCOL_MAX}
 * on this side); the answer names the version chosen and the daemon's
 * `features`, which adapters check before using anything newer.
 *
 * Adapters that cannot hold a socket use the HTTP polling API instead
 * ({@link POLL_ROUTES}): the same methods as `POST /api/open-artifact.session.*`, and
 * `session.wait` long-polls for wakes.
 */

import type { OpenArtifactErrorBody } from './errors.ts';
import type { HarnessInfo, LibraryEvent, OwnerStatus } from './library.ts';
import type { SessionRef } from './refs.ts';
import type { HostToShell, ShellToHost } from './shell.ts';
import type { ToolCallResult, ToolDefinition, ToolName } from './tools.ts';
import type { WakeDeliverStatus, WakePayload } from './wake.ts';

/** WebSocket path of the Harness API. */
export const HARNESS_PATH = '/__harness';

/** WebSocket subprotocol of the Harness API. */
export const HARNESS_SUBPROTOCOL = 'open-artifact-harness';

/**
 * The Harness API versions this daemon speaks. An adapter says the versions it speaks in `hello` (`protocols`); the
 * daemon answers with the highest one both speak. Within one version methods, optional fields and events are only
 * ever added, so both bounds stay 1 until something has to change meaning.
 */
export const PROTOCOL_MIN = 1;
export const PROTOCOL_MAX = 1;

/**
 * What a daemon can do beyond protocol 1 as first shipped, answered in `hello` (`features`). Adapters check a feature
 * by name before using it instead of comparing versions; a daemon lists only what it implements.
 *
 * - `hello.profile`: the daemon keeps the profile an adapter reports in `hello` (`harnesses/<name>.json`).
 * - `skill.get`, `commands.list`: the skill body and the per-type commands, rendered for the harness.
 * - `embed.origins`, `shell.command`, `shell.event`: the origins a host lets in, and the Shell channel of a top-level view.
 * - `view.context`: what the person has selected on an open page.
 * - `session.may`: `session.attach`'s `may` and `role` are enforced.
 * - `wake.drafted`, `wake.session`, `wake.from`: `wake.deliver` takes `drafted` and a handing-over `session`, and
 *   its `source` says why and from whom.
 * - `tools.actions`: `tools.list` carries each tool's action kinds.
 * - `quickstart.steps`: `quickstart` answers `steps`, `existing`, `rules` and `replaces`, and takes `type`.
 * - `types.remote`: types are described with `remote` (and `origin`) wherever they are listed, `tools.list` carries
 *   each tool's `remoteActions`, and `host.open` carries `remote` for an artifact of a remote type.
 * - `hello.runtime`: the daemon records `hello`'s `runtime` (`runtimes.json`) and starts the newest compatible one.
 * - `runtime.update`: `runtime.status` and `runtime.update` answer, and subscribed adapters get `runtime/update`.
 * - `types.source`: types are described with `source` (`builtin`, `local`, `installed`) and, for installed ones,
 *   `installed_from` and `third_party_notice`, wherever they are listed (`quickstart`, `list scope: "types"`,
 *   `read {type_url}`) and in `read {url}`; `publish` (create) and `adopt` put `third_party_notice` next to
 *   `instructions`.
 */
export type HarnessFeature =
  | 'hello.profile'
  | 'skill.get'
  | 'commands.list'
  | 'embed.origins'
  | 'shell.command'
  | 'shell.event'
  | 'view.context'
  | 'session.may'
  | 'wake.drafted'
  | 'wake.session'
  | 'wake.from'
  | 'tools.actions'
  | 'quickstart.steps'
  | 'types.remote'
  | 'hello.runtime'
  | 'runtime.update'
  | 'types.source';

/**
 * The features this release's daemon implements, the `features` its `hello` answers. Kept here, not in the daemon, so
 * the kit's fake daemon (`@open-artifact/harness-kit/testing`) answers the same list. A name goes in when the code
 * that answers it lands, never before, so an adapter can trust every name it reads.
 */
export const HARNESS_FEATURES: readonly HarnessFeature[] = Object.freeze(['hello.profile', 'embed.origins', 'shell.command', 'shell.event', 'view.context', 'wake.from', 'wake.drafted', 'wake.session', 'skill.get', 'commands.list', 'session.may', 'tools.actions', 'quickstart.steps', 'types.remote', 'hello.runtime', 'runtime.update', 'types.source'] as const);

/** How a harness shows pages in its own UI: in a frame of its page, or in a top-level view (a webview). */
export interface AdapterOpenCaps {
  embed: 'frame' | 'view';
  /** The origins the host embeds the Shell from (`app://myagent`); the Shell answers `host_hello` only from these. */
  origins: string[];
  /**
   * How the host treats the page of a remote type (one on another computer, `host.open`'s `remote`): shows it
   * (`allow`), asks the person until they say yes for its origin (`ask`, the kit's default), or does not show it (`deny`:
   * `host.open` answers not opened and the daemon falls back to the browser or the link). Said so the daemon and
   * `doctor` can tell; it changes nothing the daemon allows a remote type.
   */
  remote?: RemotePagePolicy;
}

/** How a host treats the pages of remote types ({@link AdapterOpenCaps.remote}). */
export type RemotePagePolicy = 'allow' | 'ask' | 'deny';

/**
 * What an adapter can do, said in `hello`. Each field is one dimension of an integration, and a harness says how far
 * it goes in each: tools (`cli`, `mcp`, `native`), commands, opening pages, wakes, and the library.
 */
export interface AdapterCaps {
  /**
   * The adapter takes `wake.deliver`. `resume`: it can resume a session with no live agent. `mode: 'draft'`: what it
   * takes goes into the session's draft for the person to send, and it answers `drafted`.
   */
  wake?: { resume?: boolean; mode?: 'auto' | 'draft' };
  /** The adapter takes `host.open` (shows an artifact in the harness's own UI); the object says how it embeds it. */
  open?: boolean | AdapterOpenCaps;
  /** What the harness calls its agent, e.g. `Agent`. */
  agentName?: string;
  /** How the agent reaches the tools: the command line, MCP, or tools the adapter registers itself (`tools.list`). */
  tools?: 'cli' | 'mcp' | 'native';
  /** The harness's command names (`artifact` for `/artifact`); `menu`: it lists one entry per type (`commands.list`). */
  commands?: { names: string[]; menu?: boolean };
  /**
   * Where the person finds artifacts in the harness: the embedded home page, cards under messages, or its own library.
   * A declaration only: the daemon records it and shows it (its log, `GET /api/open-artifact.harnesses`, `doctor`), and
   * nothing the daemon or the Shell does depends on it. Leave it out when the harness has no place that lists
   * artifacts (there is no value for that); artifact events and the home page work the same either way.
   */
  library?: 'home' | 'cards' | 'own';
}

/** The Harness API versions an adapter speaks, said in `hello`. */
export interface ProtocolRange {
  min: number;
  max: number;
}

/**
 * The Open Artifact runtime a harness carries (the `@open-artifact/cli` folder), said in `hello`: the daemon picks the
 * newest compatible one it knows when it starts. `update`: how the runtime updates itself for this harness.
 */
export interface HarnessRuntime {
  dir: string;
  version: string;
  update?: RuntimeUpdatePolicy;
}

/**
 * How the runtime updates itself: `prompt` (the default: check at most once a day and tell subscribed adapters,
 * download nothing until the person or the host says so), `auto` (download in the background, switch when the daemon
 * is idle) or `bundled` (never check; use the runtimes on this computer).
 */
export type RuntimeUpdatePolicy = 'auto' | 'prompt' | 'bundled';

/** One runtime that could start the daemon (`runtime.status`). */
export interface RuntimeSource {
  /** The caller's own, one an adapter registered (`hello.runtime`), or one in `<home>/runtime/<version>/`. */
  source: 'own' | 'registered' | 'shared';
  dir: string | null;
  version: string;
  /** The Harness API versions it speaks. */
  protocols: ProtocolRange;
  /** The harness that registered it. */
  harness?: string;
}

/** `runtime.status` result (also `open-artifact runtime status --json`). */
export interface RuntimeStatus {
  /** The version of the daemon that answers, or `null` when none runs. */
  running: string | null;
  /** What starting the daemon now would run. */
  selected: RuntimeSource | null;
  runtimes: RuntimeSource[];
  /** Registered runtimes whose folder is gone (an uninstalled host): skipped. */
  missing: Array<{ dir: string; version: string; harness?: string }>;
  /** The update policy in effect and where it comes from; `off`: switched off for the whole computer. */
  policy: { update: RuntimeUpdatePolicy | 'off'; source: 'machine' | 'settings' | 'adapter' | 'default' };
  /** The person's pin (`open-artifact runtime pin`), or `null`. */
  pin: string | null;
  /** The npm registry updates come from. */
  registry: string;
  /** The last check of the registry. */
  check: RuntimeCheck | null;
  /** A newer runtime on this computer the daemon switches to once it is idle, or `null`. */
  pending: string | null;
}

/** What the last registry check found. */
export interface RuntimeCheck {
  /** When (ISO). */
  at: string;
  /** The newest compatible version on the registry newer than every runtime here, or `null`. */
  available: string | null;
  /** Why the check failed, when it did. */
  error?: string;
  /**
   * Whether the registry lists a provenance attestation for `available`. The runtime does not verify it (that needs
   * Sigstore); the tarball is verified against the registry's integrity digest.
   */
  attestation?: { present: boolean; verified: false; predicateType?: string; url?: string };
}

/** `runtime.update` result. */
export interface RuntimeUpdateResult {
  /** The version now installed in the shared folder, or `null` when there was nothing newer. */
  installed: string | null;
  /** The daemon switches to it once idle (`true`), or it runs already / starts next time (`false`). */
  pending: boolean;
  /** One line for the person. */
  message: string;
}

/**
 * Sent to subscribed adapters when a compatible update exists (policy `prompt`: nothing is downloaded until the
 * person or the host calls `runtime.update`) or was installed (`auto`: the daemon switches once idle).
 */
export interface RuntimeUpdateEvent {
  type: 'runtime/update';
  current: string;
  available: string;
  installed: boolean;
}

/** What a session may do. A field left out is allowed. Read-only actions are always allowed. */
export interface SessionMay {
  create?: boolean;
  modify?: boolean;
  remove?: boolean;
  reply?: boolean;
}

/**
 * What one tool action does, for the harness's own approval check: reads (`read`), writes the artifact's own folder
 * (`write`), changes what the person sees (`ui`), removes or changes owners (`remove`), or only reports what a person
 * does (`person`).
 */
export type ActionKind = 'read' | 'write' | 'ui' | 'remove' | 'person';

/** The parts of a harness's own rules that are data: the daemon writes its instructions by them, or refuses calls. */
export interface HarnessPolicy {
  /** `asked` (the default): make artifacts only when asked; `allowed`: offer them for the types the person allowed. */
  offer?: 'asked' | 'allowed';
  /** How far `quickstart` looks for an existing artifact to reuse: the workspace (default), the session, or nowhere. */
  reuse?: 'workspace' | 'session' | 'none';
  /** What a session of each role may do, by role name (`session.attach`'s `role`). */
  roles?: Record<string, SessionMay>;
  /** The kinds of action the harness asks the person to confirm each time. */
  confirm?: ActionKind[];
}

/**
 * A hook format: which of the daemon's events each of the harness's hook events is, and which field of the answer
 * carries the text.
 */
export interface HookDialect {
  events: Record<string, 'SessionStart' | 'UserPromptSubmit' | 'Stop'>;
  answer: Record<string, { field: string; wrap?: Record<string, unknown> }>;
  /** The names the session id may have in the hook's input. */
  session?: string[];
  /** The names the workspace may have in the hook's input. */
  workspace?: string[];
}

/** The hook formats the daemon knows by name. */
export type HookDialectName = 'claude-code' | 'cursor' | 'copilot' | 'antigravity';

/**
 * How the daemon finds the folder a session works in when neither the call nor a hook said it (a profile's
 * `sessionWorkspace`), by name. `codex-rollout`: the `cwd` of the session's rollout file under `$CODEX_HOME/sessions`.
 */
export type SessionWorkspaceName = 'codex-rollout';

/**
 * How the daemon starts a turn in an idle session of a harness (a profile's `nudge`): a program run with an argument
 * list, never through a shell. Only read from a profile file on disk that is shipped or the person's own.
 */
export interface HarnessNudge {
  /**
   * The program, or programs to try in order: the first that is found runs. Each is a path (`~/` is the home folder),
   * a name looked up on `PATH`, or `${env:NAME}` (that variable's value; skipped when it is unset). A list in the list
   * is a program with the arguments that go before `args`.
   */
  command: string | Array<string | string[]>;
  /** The arguments; `${session}` (the session id) and `${text}` (the message) are filled in, each as one argument. */
  args: string[];
  /**
   * Variables to add to the program's environment. `${file.<field>}` is a field of the {@link envFile}; `${env:NAME}`
   * a variable of the daemon's.
   */
  env?: Record<string, string>;
  /**
   * A JSON file the harness's running app writes, which the nudge needs (its address, a token): the first file in
   * `dir` whose name matches `pattern` and that has every field {@link env} names, whose process (`pid`, the name of
   * the field with its process id) is alive. None: the app is not running, and nothing is run.
   */
  envFile?: { dir: string; pattern: string; pid?: string };
}

/** Where a profile came from: shipped with the daemon, reported by an adapter in `hello`, or the person's own file. */
export type HarnessProfileSource = 'shipped' | 'adapter' | 'user';

/** Longest {@link HarnessProfile.rules}, in characters. */
export const PROFILE_RULES_MAX = 4000;

/** Agent state of an attached session. */
export type SessionStatus = 'idle' | 'running';

/** `hello` params. Everything but `harness` and `token` is optional; a `hello` without `protocols` is protocol 1. */
export interface HelloParams {
  harness: string;
  caps?: AdapterCaps;
  token: string;
  /** The Harness API versions the adapter speaks. */
  protocols?: ProtocolRange;
  /** The SDK the adapter is built on, e.g. `{ name: '@open-artifact/harness-kit', version: '0.14.6' }`. */
  kit?: { name: string; version: string };
  /**
   * The harness's profile, so the daemon knows it while no adapter is connected. The daemon keeps it as
   * `harnesses/<name>.json` (`source: "adapter"`) and never takes `nudge` (or anything else that runs a command) from it.
   */
  profile?: Omit<Partial<HarnessProfile>, 'nudge'>;
  /** The runtime the harness carries. */
  runtime?: HarnessRuntime;
}

/** `hello` result. */
export interface HelloResult {
  /** The Harness API version this connection speaks: the highest both sides speak. */
  protocol: number;
  daemon: string;
  connection: string;
  /** What the daemon can do beyond the base protocol ({@link HarnessFeature}); unknown names are ignored. */
  features: string[];
}

/** Names a session of the calling harness. */
export interface SessionParams {
  session?: string | null;
  workspace?: string | null;
}

/** `session.attach` params. */
export interface AttachParams extends SessionParams {
  title?: string;
  status?: SessionStatus;
  /** Process id of the agent, so MCP calls from its children map to this session. */
  pid?: number;
  /** What this session may do. Left out: everything (or what the profile's `policy.roles` gives `role`). */
  may?: SessionMay;
  /** What the harness calls this kind of session (`subagent`, `routine`), for the sentence a refusal says. */
  role?: string;
}

/** One message that waited in a session's inbox. */
export interface InboxMessage extends Partial<WakePayload> {
  kind: 'wake' | (string & {});
  text: string;
  /** When it was queued (ISO). */
  at: string;
}

/** A caller override for `tools.call` and friends. */
export interface CallerParams {
  caller?: SessionParams;
}

/** Methods the adapter calls on the daemon: params and result of each. */
export interface AdapterToDaemon {
  hello: { params: HelloParams; result: HelloResult };
  'session.attach': { params: AttachParams; result: { key: string; inbox: InboxMessage[] } };
  'session.status': { params: SessionParams & { status: SessionStatus }; result: { ok: true } };
  'session.detach': { params: SessionParams; result: { ok: true } };
  'session.rename': { params: SessionParams & { title: string }; result: { ok: true } };
  'tools.list': { params: Record<string, never>; result: { tools: ToolDefinition[] } };
  'tools.call': { params: { name: ToolName | (string & {}); arguments: Record<string, unknown> } & CallerParams; result: ToolCallResult };
  /** The agent wrote these files (absolute paths) with its own tools. */
  'agent.wrote': { params: { paths: string[] } & CallerParams & SessionParams; result: { ok: true; artifacts?: string[] } };
  'artifact.open': { params: { url: string } & CallerParams & SessionParams; result: { opened: boolean; view_url?: string } };
  'inbox.take': { params: SessionParams & CallerParams; result: { messages: InboxMessage[] } };
  'inbox.wait': { params: SessionParams & CallerParams & { timeoutMs?: number }; result: { messages: InboxMessage[] } };
  /** Turns {@link HarnessEvent}s on or off. */
  subscribe: { params: { on: boolean }; result: { ok: true } };
  /** The skill body, rendered for this harness (feature `skill.get`). */
  'skill.get': { params: SkillParams; result: SkillResult };
  /** One command entry per installed type, for the harness's command menu (feature `commands.list`). */
  'commands.list': { params: { command?: string; locale?: string }; result: { commands: CommandEntry[] } };
  /** The origins an embedding host must let in: the daemon's and the type servers' (feature `embed.origins`). */
  'embed.origins': { params: Record<string, never>; result: EmbedOriginsResult };
  /** A message for the Shell in a top-level view this adapter opened (feature `shell.command`). */
  'shell.command': { params: { view: string; command: HostToShell }; result: { ok: true } };
  /** What the person has selected on the artifact's page (feature `view.context`). */
  'view.context': { params: { url: string; session?: string; workspace?: string }; result: ViewContextResult };
  /** The runtimes on this computer, the update policy and the last check (feature `runtime.update`). */
  'runtime.status': { params: Record<string, never>; result: RuntimeStatus };
  /**
   * The host says yes to an update: download the newest compatible runtime (or `version`) into the shared folder; the
   * daemon switches once idle (feature `runtime.update`). Refused when updates are off for the whole computer.
   */
  'runtime.update': { params: { version?: string }; result: RuntimeUpdateResult };
}

/** `skill.get` params. */
export interface SkillParams {
  /** `entry`: the short entry that defers to `quickstart`; `full` (the default): the whole body, as the skill file has it. */
  form?: 'entry' | 'full';
  /** The command name (default `open-artifact`); the body's `/open-artifact` becomes `/<command>`. */
  command?: string;
  /** What the body calls the agent. */
  agentName?: string;
  /** Which way of calling the tools the body describes. */
  tools?: 'native' | 'mcp' | 'cli';
  /** The names the harness gave the tools. */
  toolNames?: Partial<Record<ToolName, string>>;
  /**
   * How the "show it to the person" step reads: the harness opens it, the agent's browser, the system browser, a link.
   * Left out: `host` when the harness's caps have `open`, else a general step (a built-in browser, else the computer's).
   */
  opens?: 'host' | 'agent-browser' | 'system' | 'link';
  locale?: string;
}

/** `skill.get` result. */
export interface SkillResult {
  /** Equals the command. */
  name: string;
  description: string;
  /** E.g. `<type> <what to make>`. */
  argumentHint: string;
  /** The rendered body, ending with the installed types. */
  body: string;
  /** The runtime's version. */
  version: string;
  /** Changes whenever the body or the list of types does. */
  etag: string;
  /**
   * The always-on prompt (`AGENT_PROMPT` with the installed types and the harness's tool names), for a harness that
   * adds it to its system prompt. Its offers are left out when the harness's `policy.offer` is `asked`.
   */
  prompt?: string;
}

/** One `commands.list` entry: a type the person can start from the command menu. */
export interface CommandEntry {
  /** What goes into the input box, e.g. `/artifact slides `. */
  text: string;
  /** The type id. */
  type: string;
  title: string;
  description: string;
  /** The type's starting prompts. */
  templates?: Array<{ id: string; name: string; prompt: string }>;
  /** The type's page is on another computer (feature `types.remote`); `origin` says where. */
  remote?: boolean;
  origin?: string;
}

/**
 * One place an artifact page may be served from, as `embed.origins` lists it: the daemon itself (the Shell), the
 * per-artifact origins of static types (one `pattern`, `http://*.frame.localhost:<port>`), a local type server, or a
 * URL-entry type's address (which may be anywhere on the web: `remote`).
 */
export interface EmbedOriginEntry {
  /** An exact origin (`http://127.0.0.1:4123`, `https://slides.example.com`). */
  origin?: string;
  /** A wildcard origin, CSP style (`http://*.frame.localhost:4123`), for origins made per artifact. */
  pattern?: string;
  kind: 'daemon' | 'frame' | 'server' | 'url';
  /** The type it serves, for `server`, `url`, and the `frame` pattern of a local type server. */
  type?: string;
  /** Not a loopback address: a host that only lets local pages in by default decides (or asks) before allowing it. */
  remote: boolean;
}

/** `embed.origins` result (also `GET /api/open-artifact.embed`). */
export interface EmbedOriginsResult {
  /** Every origin and pattern of {@link entries}, for a host's allow list as it is. */
  origins: string[];
  entries: EmbedOriginEntry[];
}

/** Sent to subscribed adapters when the result of `embed.origins` changes (a type server started or stopped, types changed). */
export interface EmbedOriginsEvent extends EmbedOriginsResult {
  type: 'embed/origins';
}

/** `view.context` result: the same context the type's `context` action returns. */
export interface ViewContextResult {
  /** When the page reported it (ISO), or `null` when it never did. */
  at: string | null;
  context: unknown | null;
  /** The person changed the artifact on the page since this session last read it. */
  changed: boolean;
}

/** `wake.deliver` params: the payload plus the target session. */
export interface WakeDeliverParams extends WakePayload {
  session: string | null;
  workspace: string | null;
}

/** `host.open` params. */
export interface HostOpenParams {
  session: string | null;
  url: string;
  view_url: string;
  title?: string;
  /** A one-time view ticket, for a host that shows the page in a top-level view (`caps.open.embed: 'view'`). */
  view?: string;
  /** `view_url` with the ticket on it: what a top-level view loads. */
  embed_url?: string;
  /**
   * The artifact's type is remote (feature `types.remote`): its page comes from these origins, on another computer.
   * The Shell itself stays local; a host that lets the page in adds these to its allow list for this view only.
   */
  remote?: { type: string; origins: string[] };
}

/**
 * `wake.deliver` result. `session`: the session that actually took it, when another one did (a thread that ended
 * handed it to its coordinator); the daemon then makes that session the artifact's owner (feature `wake.session`).
 */
export interface WakeDeliverResult {
  status: WakeDeliverStatus;
  session?: string;
}

/** `shell.event` params: what the Shell in a top-level view said, as it would have said it to a parent frame. */
export interface ShellEventParams {
  view: string;
  session: string | null;
  event: ShellToHost;
}

/** Methods the daemon calls on the adapter. */
export interface DaemonToAdapter {
  'wake.deliver': { params: WakeDeliverParams; result: WakeDeliverResult };
  'host.open': { params: HostOpenParams; result: { opened: boolean } };
  /** The Shell in a top-level view this adapter opened said something (feature `shell.event`). */
  'shell.event': { params: ShellEventParams; result: { ok: true } };
}

/**
 * Sent to subscribed adapters (throttled) when the owner's view context of an artifact changed: call `view.context`
 * to read it. Best effort: only local type servers report the change; for a URL-entry type (served elsewhere) it may
 * never come, so read `view.context` when you need it.
 */
export interface ViewContextEvent {
  type: 'view/context';
  url: string;
  id: string;
  /** When the page reported it (ISO). */
  at: string;
}

/** Events pushed to subscribed adapters as the `event` notification. */
export type HarnessEvent = LibraryEvent | EmbedOriginsEvent | ViewContextEvent | RuntimeUpdateEvent;

/** Handlers an adapter registers for the daemon's calls. */
export type DaemonCallHandlers = {
  [M in keyof DaemonToAdapter]?: (params: DaemonToAdapter[M]['params']) => Promise<DaemonToAdapter[M]['result']> | DaemonToAdapter[M]['result'];
};

/** A JSON-RPC request or notification. */
export interface RpcRequest<P = unknown> {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: P;
}

/** A JSON-RPC response. */
export interface RpcResponse<R = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: R;
  error?: { code: number; message: string; data?: Partial<OpenArtifactErrorBody> };
}

/** JSON-RPC error codes the daemon and adapters use. */
export const RPC_ERRORS = {
  parse: -32700,
  methodNotFound: -32601,
  invalidParams: -32602,
  server: -32000,
} as const;

/**
 * The JSON-RPC `error.code` for an Open Artifact error code, the same on every transport (the WebSocket and the stdio
 * bridge): `parse_error`, `method_not_found` and `invalid_argument` have JSON-RPC's own numbers, anything else is
 * {@link RPC_ERRORS.server}. Clients switch on `error.data.code`; the number is for generic JSON-RPC tooling.
 */
export function rpcErrorCode(code: string | undefined): number {
  return code === 'parse_error' ? RPC_ERRORS.parse : code === 'method_not_found' ? RPC_ERRORS.methodNotFound : code === 'invalid_argument' ? RPC_ERRORS.invalidParams : RPC_ERRORS.server;
}

/**
 * HTTP polling adapter routes (`POST`, `Authorization: Bearer <token>`,
 * header `X-Open-Artifact-Harness: <name>`).
 */
export const POLL_ROUTES = {
  attach: '/api/open-artifact.session.attach',
  /** Long-poll: answers with the next wakes for the session, or `[]` after the timeout. */
  wait: '/api/open-artifact.session.wait',
  status: '/api/open-artifact.session.status',
  detach: '/api/open-artifact.session.detach',
  tools: '/api/open-artifact.tools',
  toolsCall: '/api/open-artifact.tools.call',
} as const;

/**
 * A harness profile (`harnesses/<name>.json` in the daemon): what the daemon
 * knows about a harness before its adapter connects.
 */
export interface HarnessProfile {
  name: string;
  title: string;
  /** What the harness calls its agent. */
  agentName: string;
  /** Integration level: L1 MCP only, L2 MCP + hooks, L3 a full adapter. */
  level: 'L1' | 'L2' | 'L3';
  /** How the harness reaches the daemon. */
  entry: 'harness-api' | 'mcp' | 'mod';
  /** Package name of the harness plugin, when there is one. */
  plugin?: string;
  /** How to start the MCP bridge, for MCP-entry harnesses. */
  mcp?: { command: string; args: string[] };
  /** Environment variable that holds the session id in a tool's process. */
  sessionEnv?: string;
  /** Where the harness looks for skills. */
  skillsDir?: string;
  /** Wake routes the harness supports, in order. */
  wake: Array<'live' | 'inbox'>;
  /**
   * false: the daemon cannot start a turn in an idle session (no adapter, monitor or command for it), so what the
   * person sends waits for the session's next turn, which they start. Left out: it can.
   */
  wakesIdle?: boolean;
  /**
   * Where the daemon shows a page the agent opens (`Artifact open`, or `open: "after_first_write"`) when no adapter
   * of the harness can (`host.open`): `browser`, the browser of this computer. Left out: nowhere; the agent gives
   * the person the link.
   */
  open?: 'browser';
  /** Environment variables the harness sets in its agent's commands, so a command knows which harness runs it. */
  markers?: string[];
  /** The harness's hook format: one the daemon knows by name, or a mapping. */
  hookDialect?: HookDialectName | HookDialect;
  /**
   * The command that starts a turn in an idle session; `${session}` and `${text}` in `args` are filled in. Only read
   * from a profile file on disk, never from one an adapter reports.
   */
  nudge?: HarnessNudge;
  /**
   * How to find a session's folder when nothing said it (it reads files on this computer): only read from a profile
   * file on disk, never from one an adapter reports.
   */
  sessionWorkspace?: SessionWorkspaceName;
  /** How far the harness goes in each dimension (supersedes `level`, which stays as a short name). */
  caps?: AdapterCaps;
  /** The harness's rules that are data. */
  policy?: HarnessPolicy;
  /**
   * The harness's rules that are only text (at most {@link PROFILE_RULES_MAX} characters): the daemon puts them where
   * the agent reads them first and says they win over the instructions that follow. They change no permission.
   */
  rules?: string;
  /** The harness's command names, e.g. `["artifact"]`. */
  commands?: string[];
  /** The names the harness gave the tools. */
  toolNames?: Partial<Record<ToolName, string>>;
  /** Where this profile came from. */
  source?: HarnessProfileSource;
}

/** One adapter connection, as `GET /api/open-artifact.harnesses` lists it. */
export interface AdapterInfo {
  /** Connection id. */
  id: string;
  harness: string;
  caps: AdapterCaps;
  /** Keys of the sessions attached through it. */
  sessions: string[];
  /** An HTTP polling adapter rather than a WebSocket. */
  polling: boolean;
}

/** `GET /api/open-artifact.harnesses`: the harnesses, their adapters and the sessions the daemon knows. */
export interface HarnessesResponse {
  harnesses: HarnessInfo[];
  adapters: AdapterInfo[];
  sessions: Array<SessionRef & { key: string; status: OwnerStatus; live: boolean; title?: string }>;
}
