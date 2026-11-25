/**
 * `@open-artifact/host-plugin`: the plugin API of the Open Artifact cloud host, version 1.
 *
 * A plugin is a plain object exported by an ES module:
 *
 * ```js
 * export default {
 *   id: 'hello',
 *   apiVersion: 1,
 *   on: { 'artifact.created': (event, ctx) => ctx.log(`${event.by.name} made ${event.artifact.title}`) },
 * };
 * ```
 *
 * It needs nothing from this package. Import it for editor help ({@link definePlugin}, the types), for the small helpers
 * at the end of this file (JSON answers, request bodies, HMAC signatures, JWTs), and for the test kit
 * (`@open-artifact/host-plugin/testing`).
 *
 * How a plugin talks to the host: only through its hooks, each `(input, ctx) => result`, with Web-standard types
 * (`Request`, `Response`, `fetch`, WebCrypto), so one plugin runs on the Node host and on Cloudflare alike.
 *
 * The stability promise (API version 1): the host may add fields to every input, every event and `ctx`, and may add
 * hooks, events and guard actions, at any release. Your plugin keeps working as long as it ignores what it does not
 * know. Removing or changing anything here is a new `apiVersion`, and the host keeps running plugins of the previous
 * version for at least one release cycle. `ctx.host.supports(name)` tells you whether this host has a feature.
 *
 * Failure policy: every hook call has a time limit (5 s unless the operator sets `timeoutMs`). Sign-in, permission
 * and guard hooks fail CLOSED (an error, a timeout or an answer of the wrong shape means: not signed in, no access,
 * denied). Event handlers and `wake.deliver` fail OPEN (the host logs it and carries on as if the plugin were absent).
 *
 * A time limit stops waiting, not running: it cannot interrupt a plugin stuck in synchronous code (a busy loop, a
 * huge regular expression). Such a plugin holds up the whole host process (or Worker isolate), so keep hooks
 * asynchronous and short.
 */

/** The plugin API version this package describes. A plugin sets `apiVersion` to it. */
export const PLUGIN_API_VERSION = 1 as const;

/** A value or a promise of it: every hook may be `async` or not. */
export type Awaitable<T> = T | Promise<T>;

// ---------------------------------------------------------------------------
// Who and what

/** A person's role on an artifact, highest first: `owner` > `editor` > `commenter` > `viewer`. */
export type ArtifactRole = 'owner' | 'editor' | 'commenter' | 'viewer';

/** A role the owner can share (every role but `owner`). */
export type ShareRole = 'editor' | 'commenter' | 'viewer';

/** An artifact's "general access": only the people it is shared with, anyone with a link, or anyone. */
export type GeneralAccess = 'restricted' | 'link' | 'public';

/**
 * Who someone is, as a sign-in method says: what `auth.authenticate`, `auth.signIn.finish` and `auth.identity`
 * answer. The host turns it into an account (found by `subject`, or linked by a verified e-mail address, or created
 * when the site's sign-up policy allows) and a session. The provider of an identity a plugin returns is
 * `plugin:<id>`.
 */
export interface Identity {
  /** The stable id of the person in your system. Never reuse one for somebody else. At most 256 characters. */
  subject: string;
  email?: string;
  /**
   * Whether your system vouches that the person controls `email`. Only a verified address links accounts or
   * matches e-mail and domain shares, so say `true` only when it is.
   */
  emailVerified?: boolean;
  name?: string;
  /** An image URL. */
  avatar?: string;
  /** Group names in your system. The host stores them as `<provider>:<group>`, which is how a share names a group. */
  groups?: string[];
}

/** A signed-in person. */
export interface UserPrincipal {
  kind: 'user';
  /** The host's user id. */
  id: string;
  name: string;
  email?: string;
  emailVerified?: boolean;
  avatar?: string;
  /** Groups as the host stores them: `<provider>:<group>` each (`plugin:<id>:<group>` for a plugin's). */
  groups?: string[];
  /** `admin` for the site's administrators. */
  siteRole: 'admin' | 'member';
}

/** Someone who joined one artifact through its share link, without signing in. */
export interface GuestPrincipal {
  kind: 'guest';
  id: string;
  /** The name they typed. */
  name: string;
  /** The artifact whose link they joined. */
  artifact: string;
}

/** An agent (a coding assistant, a script) acting for a user with a token the user issued. */
export interface AgentPrincipal {
  kind: 'agent';
  /** The token's id. */
  id: string;
  /** The label the user gave the token. */
  label: string;
  /** The agent app, when it said (`claude-code`, `codex`, …). */
  harness?: string;
  /** The person the agent acts for. */
  user: UserPrincipal;
}

/** Nobody signed in. */
export interface AnonymousPrincipal {
  kind: 'anonymous';
}

/** Who is asking. Check `kind` first; new kinds may be added, so handle an unknown one as "no opinion". */
export type Principal = UserPrincipal | GuestPrincipal | AgentPrincipal | AnonymousPrincipal;

/** An artifact, as hooks see it. */
export interface ArtifactInfo {
  id: string;
  /** Its type: `slides`, `design`, `whiteboard`, `sheets`, `docs`, … */
  type: string;
  title: string;
  /** The owner's user id. */
  owner: string;
  generalAccess: GeneralAccess;
  /** ISO-8601 times. */
  createdAt: string;
  updatedAt: string;
  /** When it went to the trash, or null. */
  trashedAt: string | null;
}

/** One artifact of `ctx.host.artifacts.list`. */
export interface ArtifactSummary {
  id: string;
  title: string;
  type: string;
  /** The owner's user id. */
  owner: string;
  /** ISO-8601. */
  updatedAt: string;
}

/** `ctx.host.artifacts.list`'s options. */
export interface ArtifactListOptions {
  /** Only this user's artifacts (a user id). */
  owner?: string;
  /** At most this many (default 50, at most 200). */
  limit?: number;
  /** The page after this one: the `next` of the page before. */
  after?: string;
}

/** A page of `ctx.host.artifacts.list`: `next` is null on the last page. */
export interface ArtifactList {
  artifacts: ArtifactSummary[];
  next: string | null;
}

/** A user of the site, as `ctx.host.users` answers. */
export interface UserInfo {
  id: string;
  name: string;
  /** Lower case. */
  email: string | null;
  emailVerified: boolean;
  avatar: string | null;
  siteRole: 'admin' | 'member';
  createdAt: string;
  /** Whether an admin disabled the account. */
  disabled: boolean;
}

/** Who did something, in events. `system` is the host itself (the trash's upkeep, a plugin: `id` `plugin:<id>`). */
export interface Actor {
  kind: 'user' | 'agent' | 'guest' | 'anonymous' | 'system';
  /** The user, agent token or guest id; null for `anonymous` and the host. */
  id: string | null;
  /** A name to show, when there is one. */
  name?: string;
}

/** The artifact an event is about. */
export interface ArtifactRef {
  id: string;
  type: string;
  title: string;
  /** The owner's user id. */
  owner: string;
}

// ---------------------------------------------------------------------------
// Sharing

/** What a sharing change asks for (each part only when it changes). */
export interface ShareChanges {
  access?: GeneralAccess;
  /** People, addresses, domains and groups given a role (`role: null`: removed). */
  grants?: Array<{ subjectKind: 'user' | 'email' | 'domain' | 'group'; subject: string; role: ShareRole | null }>;
  /** Share links turned on or off, or given a new address. */
  links?: Array<{ role: ShareRole; enabled?: boolean; reset?: boolean }>;
  /** Link guests given another role (`role: null`: removed). */
  guests?: Array<{ id: string; role: ShareRole | null }>;
  settings?: { viewersCanExport?: boolean; editorsCanAskAgent?: boolean };
}

// ---------------------------------------------------------------------------
// Events

/**
 * The events a plugin can listen to (`on: {'share.invited': handler}`), each with what it carries. Every payload
 * also has `event` (its name) and `at` (an ISO-8601 time). Handlers run after the fact, in the background: they
 * cannot stop anything (that is {@link GuardInput | guard}'s job), and an error in one is logged and ignored.
 */
export interface PluginEventMap {
  /** A person's account was created at their first sign-in. */
  'user.created': { user: { id: string; name: string; email: string | null }; provider: string };
  /** A person signed in (`provider`: `github`, `oidc:<id>`, `plugin:<id>`, …). */
  'user.signed_in': { user: { id: string; name: string; email: string | null }; provider: string };
  /**
   * An artifact was made: from an archive uploaded in the Library (`import`), published by a linked computer (`link`),
   * or by an agent's `create` (`mcp`). The host's Library has no "New" of its own: artifacts start on a computer or
   * with an agent.
   */
  'artifact.created': { artifact: ArtifactRef; by: Actor; via: 'import' | 'link' | 'mcp' };
  /** An artifact was renamed (`changes.title`) or its files changed (`changes.files`, paths in the artifact). */
  'artifact.changed': { artifact: ArtifactRef; by: Actor; changes: { title?: string; files?: string[] } };
  /** An artifact went to the trash. */
  'artifact.trashed': { artifact: ArtifactRef; by: Actor };
  /** An artifact came back from the trash. */
  'artifact.restored': { artifact: ArtifactRef; by: Actor };
  /** An artifact was deleted for good (`reason`: `owner` deleted it from the trash, the trash `expired`). */
  'artifact.deleted': { artifact: ArtifactRef; by: Actor; reason: 'owner' | 'expired' | (string & {}) };
  /** Who may open an artifact changed. */
  'share.changed': { artifact: ArtifactRef; by: Actor; changes: ShareChanges };
  /**
   * Someone was given a role on an artifact by name or address (one event per person). `url` opens the artifact.
   * The host sends no e-mail itself: this is where a plugin does.
   */
  'share.invited': {
    artifact: ArtifactRef;
    by: Actor;
    invitee: { email?: string; userId?: string; name?: string };
    role: ShareRole;
    url: string;
  };
  /** Someone asked the owner's agent to do something on an artifact (the Ask pane). */
  'agent.requested': { artifact: ArtifactRef; by: Actor; owner: string; text: string; label?: string };
  /** Every entry written to the host's audit log (`action` such as `share.change`, `auth.sign_in`). */
  audit: { action: string; actor: Actor; artifact: string | null; detail: unknown };
}

/** An event's name. */
export type PluginEventName = keyof PluginEventMap;

/** What an event handler receives: the event's fields, its name and when it happened. */
export type PluginEvent<E extends PluginEventName = PluginEventName> = E extends PluginEventName
  ? PluginEventMap[E] & { event: E; at: string }
  : never;

// ---------------------------------------------------------------------------
// Guard

/**
 * The actions `guard` is asked about before the host does them, each with its `detail`. New actions may be added:
 * answer nothing for an action you do not know.
 */
export interface GuardDetails {
  /**
   * A new artifact, once its type is known: an archive uploaded in the Library, after unpacking (`import`, which
   * `artifact.import` asked about first); a linked computer's first publish of an id (`link`, after `link.publish`);
   * an agent's `create` (`mcp`). There is no host "New".
   */
  'artifact.create': { type: string; title: string; via: 'import' | 'link' | 'mcp' };
  /**
   * An archive uploaded in the Library, asked before it is unpacked: so the type is not known yet (`type: null`) and
   * `artifact.create` follows with it. A linked computer's publish is `link.publish`, not this.
   */
  'artifact.import': { type: null; bytes: number; via: 'library' };
  /** To the trash (`permanent: false`) or deleted for good (`permanent: true`). */
  'artifact.delete': { permanent: boolean };
  /** A download of the artifact (`format`: `zip`, or an export format such as `pdf`, `pptx`, `png`). */
  'artifact.export': { format: string };
  /** A change of who may open the artifact. */
  'share.change': { changes: ShareChanges };
  /** A local computer links to the host (the device sign-in). */
  'link.connect': { client: { name: string; harness?: string; version?: string } };
  /** A linked computer publishes or replaces an artifact. */
  'link.publish': { type: string; bytes: number; replaces: boolean };
  /**
   * A person publishes an artifact type to the site (`open-artifact types publish`), asked once the package is read and
   * before anything of it is kept: its `id`, `uid` and `version`, the package's size, who may list it, and whether it
   * replaces a version already there.
   */
  'type.publish': { id: string; uid: string; version: string; bytes: number; visibility: 'private' | 'site' | 'link'; replaces: boolean };
  /** An MCP client (an agent app) is given access to the person's artifacts. */
  'mcp.connect': { client: { id: string; name: string } };
  /** A request to the owner's agent from the Ask pane. */
  'agent.ask': { text: string; label?: string };
}

/** A guarded action's name. */
export type GuardAction = keyof GuardDetails;

/** What `guard` receives: the action, who asks, the artifact when there is one, and the action's detail. */
export type GuardInput = {
  [A in GuardAction]: { action: A; principal: Principal; artifact?: ArtifactInfo; detail: GuardDetails[A] };
}[GuardAction];

/** Nothing to let the action happen; `{deny}` to refuse it with a sentence the person sees. */
export type GuardResult = void | undefined | { deny: string };

// ---------------------------------------------------------------------------
// Hook inputs and results

/** `auth.authenticate`'s input. The request carries no body here: decide from its headers and cookies. */
export interface AuthenticateInput {
  request: Request;
}

/** `auth.signIn.start`'s input. */
export interface SignInStartInput {
  request: Request;
  /** The path on the host to return to afterwards (pass it through your round trip, or give it back from `finish`). */
  returnTo: string;
  /** Where your sign-in must come back to: the host calls `finish` there. */
  callbackUrl: string;
}

/** `auth.signIn.finish`'s input: the request that arrived at `callbackUrl`. */
export interface SignInFinishInput {
  request: Request;
}

/** `auth.signIn.finish`'s answer. `returnTo` must be a path on the host; anything else goes to `/`. */
export interface SignInResult {
  identity: Identity;
  returnTo?: string;
}

/** `auth.identity`'s input: who a sign-in method (`provider`) says someone is, possibly changed by earlier plugins. */
export interface IdentityInput {
  identity: Identity;
  /** `owner-key`, `github`, `oidc:<id>`, `cloudflare-access`, `plugin:<id>`, … */
  provider: string;
}

/**
 * `auth.identity`'s answer: a changed identity (more groups, another name; `subject` must stay), `{reject}` to refuse
 * the sign-in with a sentence the person sees, or nothing to leave it as it is.
 */
export type IdentityResult = Identity | { reject: string } | void | undefined;

/** `auth.signOutUrl`'s input. */
export interface SignOutInput {
  principal: UserPrincipal;
}

/** `authz.role`'s input. */
export interface RoleInput {
  principal: Principal;
  artifact: ArtifactInfo;
  /** What the host worked out from its own shares, or what an earlier plugin answered (null: no access). */
  role: ArtifactRole | null;
}

/** `authz.role`'s answer: a role to replace `role`, `null` for no access, nothing for no opinion. */
export type RoleResult = ArtifactRole | null | void | undefined;

/** `authz.artifacts`'s input. */
export interface ArtifactsInput {
  principal: Principal;
}

/** What `wake.deliver` receives: a request meant for the owner's agent. */
export interface WakeInput {
  artifact: ArtifactInfo;
  owner: UserInfo;
  payload: WakePayload;
  /** Who asked, and their role on the artifact. */
  from: { name: string; role: ArtifactRole; userId?: string };
}

/**
 * A request to an agent (the Ask pane's text). Only requests are offered to `wake.deliver`: a wake that carries
 * comment threads (comments sent to the agent) always goes to the owner's outbox, because the agent answers those
 * inside the artifact's comment threads from the owner's computer, which a delivery elsewhere could not reply to.
 */
export interface WakePayload {
  kind: 'wake';
  requests: Array<{ id: string; text: string; sentAt: string; label?: string }>;
}

/** `{delivered: true}` when the plugin delivered it; nothing to let it go to the owner's outbox as usual. */
export type WakeResult = { delivered: true } | void | undefined;

/** What a route handler receives. */
export interface RouteInput {
  /** The request, body included. */
  request: Request;
  /** Who is asking (by the host's session cookie); `anonymous` for a webhook from another server. */
  principal: Principal;
  /** The `:name` parts of the route's path (and `*` for a trailing `*`). */
  params: Record<string, string>;
}

/** A route's method (`*` for any). */
export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/**
 * An HTTP route, mounted at `/plugins/<id><path>` on the site. `path` starts with `/`; a segment `:name` matches one
 * path segment into `params.name`; a final `*` matches the rest. A write (not GET, HEAD or OPTIONS) is accepted only
 * from the site's own pages unless `public: true` (for a webhook from another server, which must then check its own
 * signature: see {@link verifyHmacSha256}).
 */
export interface PluginRoute<Config = Record<string, unknown>> {
  method: HttpMethod | '*';
  path: string;
  public?: boolean;
  handler(input: RouteInput, ctx: PluginContext<Config>): Awaitable<Response>;
}

/** A link the host shows: in the account menu, or on the home page. `href` is an `https:`/`http:` URL or a path. */
export interface PluginUiLink {
  label: string;
  href: string;
  where: 'account-menu' | 'home';
}

/** Declarative additions to the host's pages. */
export interface PluginUi {
  links?: PluginUiLink[];
  /** The site's name and logo instead of Open Artifact's (the first plugin that sets one wins). */
  brand?: { name?: string; logoUrl?: string };
}

// ---------------------------------------------------------------------------
// The context

/**
 * A small durable key-value store private to the plugin (other plugins cannot see its keys). Values are anything
 * JSON can carry. Limits: keys up to 512 bytes, values up to 64 KiB of JSON, 10,000 keys per plugin. Meant for
 * caches, retry queues and small state, not for files.
 */
export interface PluginKv {
  /** The value, or null when there is none (or it expired). */
  get<T = unknown>(key: string): Promise<T | null>;
  /** Stores a value; `ttlSeconds` makes it expire. */
  set(key: string, value: unknown, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  /** Entries in key order: those starting with `prefix`, after the key `after`, at most `limit` (default 100, at most 1000). */
  list<T = unknown>(options?: { prefix?: string; after?: string; limit?: number }): Promise<Array<{ key: string; value: T; expiresAt: string | null }>>;
}

/** What a plugin can ask of the host. */
export interface PluginHost {
  /** The plugin API version the host runs this plugin with. */
  apiVersion: number;
  /** The host's version (`0.14.6`). */
  version: string;
  /** The site's address, e.g. `https://artifacts.example.com`. */
  appOrigin: string;
  /**
   * Whether this host has a feature: a hook (`authz.role`), an event (`on.share.invited`), a guard action
   * (`guard.agent.ask`) or a context member (`ctx.kv`).
   */
  supports(name: string): boolean;
  users: {
    get(id: string): Promise<UserInfo | null>;
    findByEmail(email: string): Promise<UserInfo | null>;
  };
  artifacts: {
    get(id: string): Promise<ArtifactInfo | null>;
    /**
     * The site's artifacts (not those in the trash), in id order, a page at a time: `owner` (a user id) for one
     * person's, `limit` (default 50, at most 200 a call) and `after` (the `next` of the page before). Meant for small
     * sites: a plugin that walks every page of a large site is slow on every request it does so; keep the answer
     * (`ctx.kv` with a TTL) rather than listing again.
     */
    list(options?: ArtifactListOptions): Promise<ArtifactList>;
  };
  access: {
    /** Forgets cached roles (of one artifact, or all) so the next request asks `authz.role` again. */
    invalidate(artifactId?: string): Promise<void>;
  };
  /** Writes an entry to the host's audit log, as this plugin. `action` is short, e.g. `invite.sent`. */
  audit(action: string, detail?: unknown): Promise<void>;
}

/** The second argument of every hook. The host may add members; a plugin ignores what it does not know. */
export interface PluginContext<Config = Record<string, unknown>> {
  plugin: { id: string };
  /** The operator's settings, checked against the plugin's `config` schema, with defaults filled in. */
  config: Readonly<Config>;
  /** One line to the host's log, prefixed with the plugin's id. Secret settings are blanked out of it. */
  log(message: string, fields?: Record<string, unknown>): void;
  /** `fetch`, stopped when the hook's time runs out (pass your own `signal` to stop it sooner). */
  fetch: typeof fetch;
  kv: PluginKv;
  /** The host's clock. */
  now(): Date;
  /** Aborted when the hook's time limit runs out. */
  signal: AbortSignal;
  host: PluginHost;
}

// ---------------------------------------------------------------------------
// Configuration

/**
 * A setting's type. `secret` is a string the host never logs or shows. `map` is an object of strings by name
 * (`{"staff": "editor"}`). `json` is any JSON value; the host checks only that it is JSON, so check its shape in the
 * plugin's `validate`. Given as `{"env": "NAME"}`, a `map` or `json` setting reads the variable as JSON text.
 */
export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'string[]' | 'secret' | 'map' | 'json';

/**
 * One setting a plugin declares. The operator may give any value as `{"env": "NAME"}` to read it from an environment
 * variable (a Worker secret on Cloudflare), which is how secrets stay out of the configuration file.
 */
export interface ConfigField {
  readonly type: ConfigFieldType;
  /** The operator must set it (a `default` makes that unnecessary). */
  readonly required?: boolean;
  readonly default?: string | number | boolean | readonly string[] | { readonly [name: string]: string } | JsonValue;
  /** One line for the operator (shown by `plugin check` and in error messages). */
  readonly description?: string;
}

/** A plugin's settings, by name. */
export type ConfigSchema = { readonly [name: string]: ConfigField };

/** The value type of a field. */
export type ConfigValue<F extends ConfigField> = F['type'] extends 'number'
  ? number
  : F['type'] extends 'boolean'
    ? boolean
    : F['type'] extends 'string[]'
      ? string[]
      : F['type'] extends 'map'
        ? Record<string, string>
        : F['type'] extends 'json'
          ? JsonValue
          : string;

/** A JSON value (what a `json` setting holds). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type AlwaysSet<F extends ConfigField> = F extends { readonly required: true } ? true : F extends { readonly default: unknown } ? true : false;

/** The config object a schema gives: required settings and those with a default are always there, others may be absent. */
export type ConfigOf<S extends ConfigSchema> = {
  [K in keyof S as AlwaysSet<S[K]> extends true ? K : never]: ConfigValue<S[K]>;
} & {
  [K in keyof S as AlwaysSet<S[K]> extends true ? never : K]?: ConfigValue<S[K]>;
};

/**
 * One entry of the operator's plugin list (`OA_PLUGINS`, or `plugins.json` on the Node host):
 * `[{"use": "@acme/oa-plugin", "config": {"url": "https://…", "secret": {"env": "ACME_SECRET"}}}]`.
 */
export interface PluginEntry {
  /** A package name or a path to the module (relative to the configuration file). */
  use: string;
  /** The plugin's settings. */
  config?: Record<string, unknown>;
  /** False to keep it listed but off. Default true. */
  enabled?: boolean;
  /** When the plugin cannot load or its settings are wrong, start without it (logged) instead of refusing to start. */
  optional?: boolean;
  /**
   * Each hook call's time limit, ms (default 5000, at most 60000). It stops the host waiting; it cannot stop a
   * plugin stuck in synchronous code.
   */
  timeoutMs?: number;
  /** Overrides the plugin's own `authz.cacheSeconds`: how long role answers may be reused (0 to 86400). */
  cacheSeconds?: number;
}

// ---------------------------------------------------------------------------
// The plugin

/** Sign-in hooks. */
export interface PluginAuth<Config = Record<string, unknown>> {
  /**
   * Who a request comes from, by itself: a header an upstream proxy sets, your app's cookie or JWT. The host makes a
   * session from the answer, and asks again on every later request of that session (unless `recheck` is false): the
   * same subject keeps it, another identity ends it and signs that one in, and `null` or nothing ends it (not this
   * plugin's to say means no one, here). Throw when you could not decide (your upstream is down): that request is
   * anonymous, but the session is kept for the next one.
   */
  authenticate?(input: AuthenticateInput, ctx: PluginContext<Config>): Awaitable<Identity | null | void | undefined>;
  /**
   * Whether the sessions `authenticate` makes are asked again on each request (default true). Set false only for an
   * upstream that cannot answer on every request (it proves who someone is once, on a sign-in redirect, say): the
   * session then lasts its 30 days, or until sign-out, whatever the upstream says later.
   */
  recheck?: boolean;
  /** An interactive sign-in, shown as a button (`label`) on the sign-in page. */
  signIn?: {
    label: string;
    /** Starts it: usually a redirect to your sign-in page that comes back to `callbackUrl`. */
    start(input: SignInStartInput, ctx: PluginContext<Config>): Awaitable<Response>;
    /** Completes it at `callbackUrl`: who signed in. Throw to refuse. */
    finish(input: SignInFinishInput, ctx: PluginContext<Config>): Awaitable<SignInResult>;
  };
  /** After any sign-in method (built in or a plugin's): add groups, change the name, or refuse. */
  identity?(input: IdentityInput, ctx: PluginContext<Config>): Awaitable<IdentityResult>;
  /** Where to send someone after the host signs them out (to end your system's session too). */
  signOutUrl?(input: SignOutInput, ctx: PluginContext<Config>): Awaitable<string | void | undefined>;
}

/** Permission hooks. */
export interface PluginAuthz<Config = Record<string, unknown>> {
  /** A person's role on an artifact (see {@link RoleInput} and {@link RoleResult}). Plugins run in the list's order. */
  role?(input: RoleInput, ctx: PluginContext<Config>): Awaitable<RoleResult>;
  /** How long the host may reuse this plugin's role answers, seconds (default 30; 0: ask every time). */
  cacheSeconds?: number;
  /** Artifact ids this person can see beyond the host's own shares (for the home list; each is checked with `role`). */
  artifacts?(input: ArtifactsInput, ctx: PluginContext<Config>): Awaitable<string[] | void | undefined>;
}

/** Event handlers, by event name. */
export type PluginEventHandlers<Config = Record<string, unknown>> = {
  [E in PluginEventName]?: (event: PluginEvent<E>, ctx: PluginContext<Config>) => Awaitable<void>;
};

/** A host plugin. Every hook is optional. */
export interface HostPlugin<Config = Record<string, unknown>> {
  /** Lower-case letters, digits and `-` (e.g. `acme-sso`). Unique on the site; part of its routes and its provider id. */
  id: string;
  /** The plugin API version it was written for: {@link PLUGIN_API_VERSION}. */
  apiVersion: number;
  /** A name for people (default: the id). */
  name?: string;
  /** The plugin's own version. */
  version?: string;
  description?: string;
  /** The settings it takes. */
  config?: ConfigSchema;
  /**
   * Checks the settings beyond their types, once at start-up after the host's own check (a setting needed only with
   * another, the shape of a `json` setting). Return or throw a sentence (or several) to refuse them: the host then
   * stops with a configuration error naming the plugin (or starts without it when the entry is `optional`).
   */
  validate?(config: Config): string | readonly string[] | void | undefined;
  auth?: PluginAuth<Config>;
  authz?: PluginAuthz<Config>;
  /** A veto before an action happens (see {@link GuardAction}). Plugins run in order; the first `{deny}` wins. */
  guard?(input: GuardInput, ctx: PluginContext<Config>): Awaitable<GuardResult>;
  on?: PluginEventHandlers<Config>;
  wake?: {
    /** Delivers a request meant for the owner's agent elsewhere (a cloud agent runner). */
    deliver?(input: WakeInput, ctx: PluginContext<Config>): Awaitable<WakeResult>;
  };
  routes?: ReadonlyArray<PluginRoute<Config>>;
  ui?: PluginUi;
}

/** A plugin as {@link definePlugin} takes it: `config` is a schema, and the hooks' `ctx.config` follows from it. */
export type PluginDefinition<S extends ConfigSchema = ConfigSchema> = Omit<HostPlugin<ConfigOf<S>>, 'config'> & { config?: S };

/**
 * Returns the plugin as it is. It only gives your editor the types: with it, `ctx.config` in every hook has the
 * settings your `config` schema declares.
 *
 * ```ts
 * export default definePlugin({
 *   id: 'hello', apiVersion: 1,
 *   config: { greeting: { type: 'string', default: 'Hello' } },
 *   on: { 'user.signed_in': (e, ctx) => ctx.log(`${ctx.config.greeting}, ${e.user.name}`) },
 * });
 * ```
 */
export function definePlugin<const S extends ConfigSchema = Record<never, never>>(plugin: PluginDefinition<S>): PluginDefinition<S> {
  return plugin;
}

// ---------------------------------------------------------------------------
// Helpers: HTTP

/**
 * An error a route handler throws to answer with a status: `throw new HttpError(403, 'Bad signature.')` answers
 * `403 {"code": "plugin_error", "message": "Bad signature."}`. Any other error answers a generic 500 (and is logged).
 */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status >= 400 && status <= 599 ? Math.floor(status) : 500;
  }
}

/** A JSON answer (`Content-Type: application/json`, `Cache-Control: no-store` unless `init` sets them). */
export function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(value), { ...init, headers });
}

/** The largest body {@link readJson} and {@link readBody} read by default: 1 MiB. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** A request's whole body as bytes, refusing more than `maxBytes` (an {@link HttpError} 413). */
export async function readBody(request: Request, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, `The request body is larger than ${maxBytes} bytes.`);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    size += step.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, `The request body is larger than ${maxBytes} bytes.`);
    }
    chunks.push(step.value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** A request's body as text (UTF-8): what a signature is checked over. */
export async function readText(request: Request, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<string> {
  return new TextDecoder().decode(await readBody(request, maxBytes));
}

/** A request's body as JSON (an {@link HttpError} 400 when it is not JSON, 413 past `maxBytes`). */
export async function readJson<T = unknown>(request: Request, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<T> {
  const text = await readText(request, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'The request body is not JSON.');
  }
}

// ---------------------------------------------------------------------------
// Helpers: comparing secrets and signatures

const encoder = new TextEncoder();
const bytesOf = (value: string | Uint8Array): Uint8Array => (typeof value === 'string' ? encoder.encode(value) : value);

/**
 * Whether two secrets are equal, taking the same time whatever their content (so the time an answer takes does not
 * tell an attacker how much of a guess was right). Use it instead of `===` for every secret and signature.
 */
export function timingSafeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const x = bytesOf(a);
  const y = bytesOf(b);
  const length = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** How a signature is written: hex (`a1b2…`), base64, or base64url. */
export type SignatureEncoding = 'hex' | 'base64' | 'base64url';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function encodeBytes(bytes: Uint8Array, encoding: SignatureEncoding): string {
  if (encoding === 'hex') return toHex(bytes);
  const base64 = toBase64(bytes);
  return encoding === 'base64' ? base64 : base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string | Uint8Array, body: string | Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', bytesOf(secret) as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytesOf(body) as Uint8Array<ArrayBuffer>));
}

/** The HMAC-SHA256 of `body` under `secret`, written in `encoding` (default hex): to sign what a plugin sends. */
export async function signHmacSha256(input: { secret: string | Uint8Array; body: string | Uint8Array; encoding?: SignatureEncoding }): Promise<string> {
  return encodeBytes(await hmac(input.secret, input.body), input.encoding ?? 'hex');
}

/**
 * Whether `signature` is the HMAC-SHA256 of `body` under `secret` (compared in constant time). `body` must be the
 * exact bytes received ({@link readText}), not re-serialized JSON. A `prefix` such as `sha256=` is removed from the
 * signature first when present. Hex is compared without regard to case.
 */
export async function verifyHmacSha256(input: {
  secret: string | Uint8Array;
  body: string | Uint8Array;
  signature: string | null | undefined;
  encoding?: SignatureEncoding;
  prefix?: string;
}): Promise<boolean> {
  if (!input.signature) return false;
  let given = input.signature.trim();
  if (input.prefix && given.startsWith(input.prefix)) given = given.slice(input.prefix.length);
  const encoding = input.encoding ?? 'hex';
  if (encoding === 'hex') given = given.toLowerCase();
  if (encoding === 'base64url') given = given.replace(/=+$/, '');
  const expected = encodeBytes(await hmac(input.secret, input.body), encoding);
  return timingSafeEqual(given, expected);
}

// ---------------------------------------------------------------------------
// Helpers: JWT

/** The algorithms {@link verifyJwt} takes. `none` and every other algorithm are refused. */
export type JwtAlgorithm = 'RS256' | 'ES256' | 'HS256';

/** A JSON Web Key, as a JWKS publishes it (the fields {@link verifyJwt} reads). */
export interface Jwk {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  crv?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  /** A symmetric key (`kty: 'oct'`), base64url. */
  k?: string;
}

/** What {@link verifyJwt} checks a token against. */
export interface VerifyJwtOptions {
  token: string;
  /** Where the signing keys are published (fetched with the `fetch` you pass, kept for 10 minutes). */
  jwksUrl?: string;
  /** Or one key: a public JWK (RS256, ES256), a symmetric JWK, or a shared secret string (HS256). */
  key?: Jwk | string;
  /** The `iss` the token must carry. */
  issuer?: string;
  /** The `aud` the token must carry (one of them, when a list). */
  audience?: string | string[];
  /** The algorithms accepted (default: all three, each only with a key of its kind). */
  algorithms?: JwtAlgorithm[];
  /** Seconds of clock difference tolerated on `exp` and `nbf` (default 60). */
  clockToleranceSeconds?: number;
  /** Whether a token without `exp` is refused (default true: a token that never expires is rarely meant). */
  requireExpiry?: boolean;
  /** The clock (default: now). */
  now?: Date;
}

/**
 * {@link verifyJwt}'s answer: the claims, or why the token was refused (for your log, not for the person).
 * `unavailable`: it could not be checked at all (the signing keys could not be fetched), which says nothing about the
 * token: an `auth.authenticate` should throw then, so the host keeps the person's session for the next request
 * instead of ending it.
 */
export type VerifyJwtResult =
  | { valid: true; claims: Record<string, unknown>; header: { alg: string; kid?: string; typ?: string } }
  | { valid: false; reason: string; unavailable?: true };

function base64urlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function decodeJsonPart(part: string): Record<string, unknown> | null {
  const bytes = base64urlDecode(part);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const JWKS_TTL_MS = 10 * 60_000;
const JWKS_REFRESH_MS = 30_000;
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();

async function jwksKeys(url: string, fetcher: typeof fetch, now: number, refresh: boolean): Promise<Jwk[]> {
  const kept = jwksCache.get(url);
  if (kept && !refresh && now - kept.at < JWKS_TTL_MS) return kept.keys;
  // An unknown `kid` refetches, but at most every 30 seconds: tokens with made-up kids must not hammer the key server.
  if (kept && refresh && now - kept.at < JWKS_REFRESH_MS) return kept.keys;
  const response = await fetcher(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`the key set at ${url} answered ${response.status}`);
  const body = (await response.json()) as { keys?: unknown };
  const keys = Array.isArray(body.keys) ? (body.keys.filter((k) => typeof k === 'object' && k !== null) as Jwk[]) : [];
  jwksCache.set(url, { keys, at: now });
  return keys;
}

/** Whether a key can verify `alg`: an RSA public key for RS256, a P-256 key for ES256, a symmetric key for HS256. */
function keyFits(key: Jwk, alg: JwtAlgorithm): boolean {
  if (key.use !== undefined && key.use !== 'sig') return false;
  if (key.alg !== undefined && key.alg !== alg) return false;
  if (alg === 'RS256') return key.kty === 'RSA' && typeof key.n === 'string' && typeof key.e === 'string';
  if (alg === 'ES256') return key.kty === 'EC' && key.crv === 'P-256' && typeof key.x === 'string' && typeof key.y === 'string';
  return key.kty === 'oct' && typeof key.k === 'string';
}

async function verifySignature(alg: JwtAlgorithm, key: Jwk, data: Uint8Array<ArrayBuffer>, signature: Uint8Array<ArrayBuffer>): Promise<boolean> {
  try {
    if (alg === 'RS256') {
      const imported = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: key.n, e: key.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', imported, signature, data);
    }
    if (alg === 'ES256') {
      // A JWS ES256 signature is raw r||s (64 bytes), which is what WebCrypto's ECDSA takes.
      if (signature.length !== 64) return false;
      const imported = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, signature, data);
    }
    const secret = base64urlDecode(key.k ?? '');
    if (!secret || secret.length === 0) return false;
    const imported = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('HMAC', imported, signature, data);
  } catch {
    return false;
  }
}

const ALGORITHMS: readonly JwtAlgorithm[] = ['RS256', 'ES256', 'HS256'];

/**
 * Verifies a compact JWT (JWS): its signature (RS256 and ES256 with public keys, HS256 with a shared secret; never
 * `none`, and never an algorithm the key is not for), then `exp`, `nbf`, `iss` and `aud`. Keys come from `key` or
 * from `jwksUrl` (by the token's `kid`; an unknown `kid` refetches the set once). Pass `ctx.fetch` as `fetcher`.
 * Never throws for a bad token: the answer says why.
 */
export async function verifyJwt(options: VerifyJwtOptions, fetcher: typeof fetch = (input, init) => fetch(input, init)): Promise<VerifyJwtResult> {
  const parts = options.token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'not a JWT' };
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJsonPart(h);
  const claims = decodeJsonPart(p);
  const signature = base64urlDecode(s);
  if (!header || !claims || !signature || typeof header.alg !== 'string') return { valid: false, reason: 'not a JWT' };
  const alg = header.alg;
  const accepted = options.algorithms ?? ALGORITHMS;
  if (!ALGORITHMS.includes(alg as JwtAlgorithm) || !accepted.includes(alg as JwtAlgorithm)) return { valid: false, reason: `algorithm ${alg} is not accepted` };
  const algorithm = alg as JwtAlgorithm;
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  const nowDate = options.now ?? new Date();

  let candidates: Jwk[];
  if (options.key !== undefined) {
    const key: Jwk = typeof options.key === 'string' ? { kty: 'oct', k: encodeBytes(encoder.encode(options.key), 'base64url') } : options.key;
    candidates = [key];
  } else if (options.jwksUrl) {
    try {
      candidates = await jwksKeys(options.jwksUrl, fetcher, nowDate.getTime(), false);
      if (kid !== undefined && !candidates.some((k) => k.kid === kid)) candidates = await jwksKeys(options.jwksUrl, fetcher, nowDate.getTime(), true);
    } catch (error) {
      return { valid: false, reason: `the signing keys could not be fetched: ${error instanceof Error ? error.message : String(error)}`, unavailable: true };
    }
    if (kid !== undefined) candidates = candidates.filter((k) => k.kid === kid);
  } else {
    return { valid: false, reason: 'no key or jwksUrl to verify with' };
  }
  const fitting = candidates.filter((k) => keyFits(k, algorithm));
  if (fitting.length === 0) return { valid: false, reason: `no ${algorithm} key${kid ? ` with kid ${kid}` : ''}` };
  const data = encoder.encode(`${h}.${p}`) as Uint8Array<ArrayBuffer>;
  let verified = false;
  for (const key of fitting) {
    if (await verifySignature(algorithm, key, data, signature)) {
      verified = true;
      break;
    }
  }
  if (!verified) return { valid: false, reason: 'bad signature' };

  const now = nowDate.getTime() / 1000;
  const tolerance = options.clockToleranceSeconds ?? 60;
  if (claims.exp === undefined) {
    if (options.requireExpiry !== false) return { valid: false, reason: 'no expiry (exp)' };
  } else if (typeof claims.exp !== 'number' || now - tolerance >= claims.exp) {
    return { valid: false, reason: 'expired' };
  }
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || now + tolerance < claims.nbf)) return { valid: false, reason: 'not valid yet (nbf)' };
  if (options.issuer !== undefined && claims.iss !== options.issuer) return { valid: false, reason: 'wrong issuer' };
  if (options.audience !== undefined) {
    const wanted = Array.isArray(options.audience) ? options.audience : [options.audience];
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.some((a) => typeof a === 'string' && wanted.includes(a))) return { valid: false, reason: 'wrong audience' };
  }
  return {
    valid: true,
    claims,
    header: { alg, ...(kid !== undefined ? { kid } : {}), ...(typeof header.typ === 'string' ? { typ: header.typ } : {}) },
  };
}
