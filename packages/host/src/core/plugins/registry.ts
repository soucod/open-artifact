/**
 * The plugins of a site, running (decisions 47-53): {@link createPlugins} checks the operator's list and every
 * plugin's settings, then answers one method per integration point. Each method runs the plugins in the list's
 * order, gives every hook call its time limit (`timeoutMs`, default 5 s) and applies the failure policy:
 *
 * - `auth.*`, `authz.*` and `guard` fail CLOSED: an error, a timeout or an answer of the wrong shape means not
 *   signed in, no access, denied. The failure is logged and audited (`plugin.failed`).
 * - Event handlers and `wake.deliver` fail OPEN: logged; the host carries on as if the plugin were absent.
 *
 * Methods take the host's own types (`Principal`, `ArtifactRow`) and hand plugins the plugin API's views of them,
 * a fresh copy for each plugin, so one plugin cannot change what the next one sees. Every answer is plain data the
 * host acts on; nothing here touches the catalog, which the host reaches through {@link PluginServices}.
 *
 * Platform neutral.
 */

import type {
  Actor,
  ArtifactInfo,
  ArtifactList,
  ArtifactRef,
  ArtifactRole,
  GuardAction,
  GuardDetails,
  Identity,
  PluginContext,
  PluginEventMap,
  PluginEventName,
  PluginEntry,
  PluginHost,
  PluginKv,
  PluginUiLink,
  Principal as PluginPrincipal,
  UserInfo,
  UserPrincipal as PluginUserPrincipal,
  WakePayload,
} from '@open-artifact/host-plugin';
import {
  ALL_FEATURES,
  answers,
  artifactListOptions,
  checkIdentity,
  checkPlugin,
  EVENT_NAMES,
  failsClosed,
  GUARD_ACTIONS,
  httpErrorOf,
  isSameOriginWrite,
  matchRoute,
  redact,
  runHook,
  type CheckedRoute,
  type Checked,
  type HookName,
  type HookOutcome,
} from '@open-artifact/host-plugin/contract';
import { ARTIFACT_ID } from '@open-artifact/protocol';
import { SignInError } from '../auth/errors.ts';
import { httpError, json } from '../http.ts';
import type { ArtifactRow, Principal, UserPrincipal, UserRecord } from '../types.ts';
import { PluginConfigError, preparePlugin, type PreparedPlugin } from './config.ts';

// ---------------------------------------------------------------------------
// What the host gives

/**
 * The host capabilities a plugin's `ctx` reaches (decision 50). The platform implements it over its catalog and
 * caches; tests pass fakes.
 */
export interface PluginServices {
  /** The host's version. */
  version: string;
  /** The site's address (`HostConfig.appOrigin`): plugin routes' writes must come from it unless public. */
  appOrigin: string;
  users: {
    get(id: string): Promise<UserInfo | null>;
    findByEmail(email: string): Promise<UserInfo | null>;
  };
  artifacts: {
    get(id: string): Promise<ArtifactInfo | null>;
    /** A page of the site's artifacts outside the trash, in id order (options already checked and capped). */
    list(options: { owner?: string; after?: string; limit: number }): Promise<ArtifactList>;
  };
  /** Drops cached role answers (one artifact's, or all), so the next request asks `authz.role` again. */
  invalidateAccess(artifactId?: string): void | Promise<void>;
  /**
   * Writes an audit entry as a plugin: the host records actor `system` with id `plugin:<pluginId>` (which is how
   * {@link Plugins.emit} keeps a plugin from hearing its own entries back).
   */
  audit(entry: { pluginId: string; action: string; detail: unknown }): Promise<void>;
  /** The plugin's private key-value store (`createPluginKv` over the catalog). */
  kv(pluginId: string): PluginKv;
  /** Outbound `fetch` (default: the global one). */
  fetch?: typeof fetch;
  /**
   * What `ctx.host.supports` answers true for (default: every hook, event, guard action and context member of API
   * version 1). A platform that does not fire an event or ask a guard action yet leaves it out.
   */
  features?: readonly string[];
}

/** {@link createPlugins}' input. */
export interface CreatePluginsInput {
  /** Each entry of the list with what loading its module gave: the default export, or why it could not load. */
  plugins: ReadonlyArray<{ entry: PluginEntry; plugin?: unknown; loadError?: string }>;
  /** Where `{"env": "NAME"}` settings are read (`process.env`; the Worker's env). */
  env: Readonly<Record<string, string | undefined>>;
  services: PluginServices;
  /** One line to the host's log. */
  log(line: string): void;
  /** The clock (tests pass a fixed one). */
  now?: () => Date;
  /** Keeps background work (event handlers, audit writes) alive past the request (a Worker's `ctx.waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

// ---------------------------------------------------------------------------
// What the host gets

/** One plugin as `plugin list` and an admin page show it. `settings` are names only, never values. */
export interface PluginDescription {
  /** The plugin's id, or its entry's `use` when it never loaded. */
  id: string;
  use: string;
  name: string;
  version: string | null;
  apiVersion: number | null;
  /** Whether it runs (false: disabled in the list, or optional and failed). */
  enabled: boolean;
  /** `on` (runs), `off` (disabled in the list) or `failed` (could not load or start: `problems` says why). */
  state: 'on' | 'off' | 'failed';
  hooks: string[];
  settings: string[];
  /** What was ignored, is unwise, or (for one that does not run) why it does not. */
  problems: string[];
}

/** A sign-in button a plugin adds (`id` is the provider id, `plugin:<id>`). */
export interface PluginSignInButton {
  id: string;
  label: string;
}

/** The plugins' additions to the host's pages. */
export interface PluginUiView {
  links: Array<PluginUiLink & { plugin: string }>;
  brand: { name?: string; logoUrl?: string } | null;
}

/** The plugins of a site, one method per integration point (see the module comment for the failure policy). */
/** One `authz.role` answer in the chain, as {@link Plugins.role} records it when asked to (the access explanation). */
export interface RoleStep {
  plugin: string;
  /** The role the plugin was shown. */
  before: ArtifactRole | null;
  /** What it answered: a role, `null` (no access), `no opinion`, or `failed` (an error or a timeout: no access). */
  answer: ArtifactRole | null | 'no opinion' | 'failed';
  /** The role after it. */
  after: ArtifactRole | null;
}

export interface Plugins {
  /** How many plugins run. */
  readonly size: number;
  /** Whether any plugin has `auth.authenticate` (the host may skip {@link Plugins.authenticate} otherwise). */
  readonly hasAuthenticate: boolean;
  /** Whether any plugin has `auth.identity`. */
  readonly hasIdentityHook: boolean;
  /**
   * Whether any plugin has `authz.role`. Without one the host keeps its own exact-freshness role cache and never
   * calls {@link Plugins.role}.
   */
  readonly hasRoleHook: boolean;
  /** Whether any plugin has `authz.artifacts`. */
  readonly hasArtifactsHook: boolean;
  /** Whether any plugin handles the event (the host may skip building its payload otherwise). */
  listens(event: PluginEventName): boolean;

  /**
   * Who a request comes from by itself (the first plugin that says), with the provider id `plugin:<id>`; or null.
   * `except`: a plugin id not to ask (one just asked by {@link Plugins.recheck}).
   */
  authenticate(request: Request, options?: { except?: string }): Promise<{ identity: Identity; provider: string } | null>;
  /**
   * Asks again the plugin whose `auth.authenticate` made a session (`provider`: `plugin:<id>`): `answer` with whom
   * this request comes from (null: no one), `failed` when the plugin threw, timed out or answered nonsense, `skip`
   * when the session is not to be checked (no such plugin running, no `authenticate`, or `auth.recheck: false`).
   */
  recheck(provider: string, request: Request): Promise<{ kind: 'answer'; identity: Identity | null } | { kind: 'failed' } | { kind: 'skip' }>;
  /** The sign-in buttons plugins add, in order. */
  signInButtons(): PluginSignInButton[];
  /** Starts a plugin's sign-in (`id`: `plugin:<id>` or `<id>`). Throws a `SignInError` (`unknown_provider`, `provider_error`). */
  startSignIn(id: string, request: Request, returnTo: string, callbackUrl: string): Promise<Response>;
  /** Completes it. Throws a `SignInError` (`unknown_provider`, `provider_error`). */
  finishSignIn(id: string, request: Request): Promise<{ identity: Identity; provider: string; returnTo?: string }>;
  /** Runs `auth.identity` of every plugin over an identity from any provider: the identity to sign in, or a refusal. */
  identity(identity: Identity, provider: string): Promise<{ identity: Identity } | { reject: string; plugin: string }>;
  /** Where to send a signed-out person (the first plugin that says), or null. */
  signOutUrl(principal: UserPrincipal): Promise<string | null>;
  /**
   * The role after the plugins' chain: each `authz.role` sees the role so far and may replace it. `cacheSeconds`:
   * how long the answer may be reused (the smallest `authz.cacheSeconds` of the plugins asked; 0 after a failure;
   * null when no plugin has `authz.role`, so the host's own rule stands).
   */
  /**
   * The role after every `authz.role`. When one fails (throws, times out, answers nonsense) the answer is no access
   * (fail closed), never kept, and `failed` names that plugin (its error is in the log and the audit log).
   */
  role(input: { principal: Principal; artifact: ArtifactRow; role: ArtifactRole | null }, trace?: RoleStep[]): Promise<{ role: ArtifactRole | null; cacheSeconds: number | null; failed?: string }>;
  /** Artifact ids plugins add to a person's list (each still to be checked with {@link Plugins.role}). */
  extraArtifacts(principal: Principal): Promise<string[]>;
  /** Asks every plugin's `guard`; throws the host's `not_granted` (403) with the plugin's sentence on a denial. */
  guard<A extends GuardAction>(action: A, input: { principal: Principal; artifact?: ArtifactRow; detail: GuardDetails[A] }): Promise<void>;
  /**
   * Hands an event to its handlers and returns at once: they run in the background, each under its time limit, and
   * never throw into the host. `waitUntil` (a Worker request's) keeps that work alive; without it the one given to
   * {@link createPlugins} is used. `at` defaults to now.
   */
  emit<E extends PluginEventName>(event: E, payload: PluginEventMap[E] & { at?: string }, waitUntil?: (promise: Promise<unknown>) => void): void;
  /** Offers a request for the owner's agent to `wake.deliver`: true when a plugin delivered it. */
  deliverWake(input: { artifact: ArtifactRow; owner: UserInfo; payload: WakePayload; from: { name: string; role: ArtifactRole; userId?: string } }): Promise<boolean>;
  /** Whether a path is a plugin route's, and whether that route is public; null when it is not under `/plugins/`. */
  routeInfo(request: Request): { pluginId: string; public: boolean } | null;
  /**
   * Answers a request under `/plugins/<id>/…`, or null for another path: 404 for no such plugin or path, 405 (with
   * `Allow`) for another method, 403 for a cross-site write to a route that is not public. `principalOf` is asked
   * only for a matched route.
   */
  route(request: Request, principalOf: (request: Request) => Promise<Principal>): Promise<Response | null>;
  /** The plugins' links and brand. */
  ui(): PluginUiView;
  /** Every plugin of the list, running or not. */
  describe(): PluginDescription[];
  /** Resolves when no background work (event handlers, audit writes) is left. */
  idle(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Views of the host's records

/** An artifact row as plugins see it. */
export function artifactInfo(row: ArtifactRow): ArtifactInfo {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    owner: row.ownerUser,
    generalAccess: row.generalAccess,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    trashedAt: row.trashedAt,
  };
}

/** An artifact row as events name it. */
export function artifactRef(row: Pick<ArtifactRow, 'id' | 'type' | 'title' | 'ownerUser'>): ArtifactRef {
  return { id: row.id, type: row.type, title: row.title, owner: row.ownerUser };
}

/** A user record as plugins see it. */
export function userInfo(record: UserRecord): UserInfo {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    emailVerified: record.emailVerified,
    avatar: record.avatar,
    siteRole: record.siteRole,
    createdAt: record.createdAt,
    disabled: record.disabledAt !== null,
  };
}

function pluginUser(user: UserPrincipal): PluginUserPrincipal {
  return {
    kind: 'user',
    id: user.id,
    name: user.name,
    ...(user.email !== undefined ? { email: user.email } : {}),
    ...(user.emailVerified !== undefined ? { emailVerified: user.emailVerified } : {}),
    ...(user.avatar !== undefined ? { avatar: user.avatar } : {}),
    ...(user.groups !== undefined ? { groups: [...user.groups] } : {}),
    siteRole: user.siteRole,
  };
}

/** A principal as plugins see it (no link ids, no token scopes). */
export function pluginPrincipal(principal: Principal): PluginPrincipal {
  switch (principal.kind) {
    case 'user':
      return pluginUser(principal);
    case 'guest':
      return { kind: 'guest', id: principal.id, name: principal.name, artifact: principal.artifact };
    case 'agent':
      return { kind: 'agent', id: principal.id, label: principal.label, ...(principal.harness ? { harness: principal.harness } : {}), user: pluginUser(principal.user) };
    default:
      return { kind: 'anonymous' };
  }
}

/** Who did something, for an event. */
export function actorOf(principal: Principal): Actor {
  switch (principal.kind) {
    case 'user':
      return { kind: 'user', id: principal.id, name: principal.name };
    case 'guest':
      return { kind: 'guest', id: principal.id, name: principal.name };
    case 'agent':
      return { kind: 'agent', id: principal.id, name: `${principal.label} (${principal.user.name})` };
    default:
      return { kind: 'anonymous', id: null };
  }
}

// ---------------------------------------------------------------------------
// The registry

/**
 * Plugins of an older API major, adapted to the current one (decision 48): `ADAPTERS[n]` turns a version-n plugin
 * object into a current one. Empty while version 1 is the only one; `SUPPORTED_API_VERSIONS` in the contract must
 * list every major that has an adapter here.
 */
const ADAPTERS: Readonly<Record<number, (plugin: Record<string, unknown>) => Record<string, unknown>>> = {};

/** A plugin that runs. */
interface Running extends PreparedPlugin {
  id: string;
  kv: PluginKv;
  host: PluginHost;
}

type AnyHook = (input: unknown, ctx: PluginContext) => unknown;

const clone = <T>(value: T): T => structuredClone(value);
const AUDIT_ACTION = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_AUDIT_DETAIL_BYTES = 8 * 1024;
const MAX_EXTRA_ARTIFACTS = 10_000;

function describeFailure(outcome: Extract<HookOutcome<unknown>, { ok: false }>): string {
  switch (outcome.reason) {
    case 'timeout':
      return outcome.message;
    case 'shape':
      return `answered wrongly: it ${outcome.message}`;
    default:
      return `threw: ${outcome.message}`;
  }
}

function errorAnswer(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return json({ code, message }, { status, ...(headers ? { headers } : {}) });
}

/**
 * Checks the plugin list (every plugin object and its settings, unique ids) and returns the running plugins. Throws a
 * {@link PluginConfigError} listing every problem when a plugin that is not `optional` cannot run; an optional one
 * is left out (logged, and shown by {@link Plugins.describe}). Unknown keys and hooks are logged once here.
 */
export function createPlugins(input: CreatePluginsInput): Plugins {
  const { services, log } = input;
  const now = input.now ?? (() => new Date());
  const features = new Set(services.features ?? ALL_FEATURES);
  const fetcher: typeof fetch = services.fetch ?? ((resource, init) => fetch(resource, init));
  const fatal: string[] = [];
  const descriptions: PluginDescription[] = [];
  const running: Running[] = [];
  const ids = new Set<string>();

  for (const item of input.plugins) {
    const { entry } = item;
    let plugin = item.plugin;
    if (plugin && typeof plugin === 'object' && !Array.isArray(plugin)) {
      const version = (plugin as Record<string, unknown>).apiVersion;
      const adapt = typeof version === 'number' ? ADAPTERS[version] : undefined;
      if (adapt) plugin = adapt(plugin as Record<string, unknown>);
    }
    if (entry.enabled === false) {
      const checked = item.loadError === undefined && plugin !== undefined ? checkPlugin(plugin, entry.use).plugin : null;
      descriptions.push({
        id: checked?.id ?? entry.use,
        use: entry.use,
        name: checked?.name ?? entry.use,
        version: checked?.version ?? null,
        apiVersion: checked?.apiVersion ?? null,
        enabled: false,
        state: 'off',
        hooks: checked?.hooks ?? [],
        settings: Object.keys(checked?.schema ?? {}),
        problems: ['disabled in the plugin list'],
      });
      continue;
    }
    const prep = preparePlugin({ entry, ...(plugin !== undefined ? { plugin } : {}), ...(item.loadError !== undefined ? { loadError: item.loadError } : {}) }, input.env, services.version);
    const errors = [...prep.errors];
    if (prep.prepared && ids.has(prep.prepared.plugin.id)) errors.push(`Two plugins in the list have the id ${JSON.stringify(prep.prepared.plugin.id)}; ids must be unique (${entry.use}).`);
    const name = prep.prepared?.plugin.name ?? prep.id ?? entry.use;
    for (const warning of prep.warnings) log(`plugin ${prep.id ?? entry.use}: ${warning}`);
    if (errors.length > 0 || !prep.prepared) {
      if (entry.optional) {
        for (const error of errors) log(`plugin ${prep.id ?? entry.use} is optional and left out: ${error}`);
      } else {
        fatal.push(...errors);
      }
      descriptions.push({
        id: prep.id ?? entry.use,
        use: entry.use,
        name,
        version: prep.prepared?.plugin.version ?? null,
        apiVersion: prep.prepared?.plugin.apiVersion ?? null,
        enabled: false,
        state: 'failed',
        hooks: [],
        settings: [],
        problems: [...errors, ...prep.warnings],
      });
      continue;
    }
    const prepared = prep.prepared;
    const id = prepared.plugin.id;
    ids.add(id);
    const kv = services.kv(id);
    const host: PluginHost = {
      apiVersion: prepared.plugin.apiVersion,
      version: services.version,
      appOrigin: services.appOrigin,
      supports: (name: string) => features.has(name),
      users: { get: (userId) => services.users.get(userId), findByEmail: (email) => services.users.findByEmail(email) },
      artifacts: {
        get: (artifactId) => services.artifacts.get(artifactId),
        list: async (options) => services.artifacts.list(artifactListOptions(options)),
      },
      access: { invalidate: async (artifactId) => void (await services.invalidateAccess(artifactId)) },
      audit: async (action, detail) => {
        if (typeof action !== 'string' || !AUDIT_ACTION.test(action)) throw new TypeError('audit: action is 1-64 letters, digits, . _ or -.');
        let text: string | undefined;
        try {
          text = JSON.stringify(detail ?? null);
        } catch {
          text = undefined;
        }
        if (text === undefined || new TextEncoder().encode(text).byteLength > MAX_AUDIT_DETAIL_BYTES) throw new TypeError(`audit: detail is JSON of at most ${MAX_AUDIT_DETAIL_BYTES} bytes.`);
        await services.audit({ pluginId: id, action, detail: JSON.parse(text) as unknown });
      },
    };
    running.push({ ...prepared, id, kv, host });
    descriptions.push({
      id,
      use: entry.use,
      name: prepared.plugin.name,
      version: prepared.plugin.version,
      apiVersion: prepared.plugin.apiVersion,
      enabled: true,
      state: 'on',
      hooks: [...prepared.plugin.hooks],
      settings: Object.keys(prepared.plugin.schema),
      problems: [...prepared.warnings],
    });
  }
  if (fatal.length > 0) throw new PluginConfigError(fatal);

  // ---- running hooks

  const pending = new Set<Promise<unknown>>();
  function track(work: Promise<unknown>, waitUntil?: (promise: Promise<unknown>) => void): void {
    const settled: Promise<unknown> = work.catch(() => undefined).finally(() => pending.delete(settled));
    pending.add(settled);
    (waitUntil ?? input.waitUntil)?.(settled);
  }

  function logFor(p: Running): (line: string) => void {
    return (line) => log(redact(`plugin ${p.id}: ${line}`, p.secrets));
  }

  function contextFor(p: Running, signal: AbortSignal): PluginContext {
    const write = logFor(p);
    return {
      plugin: { id: p.id },
      config: p.config,
      log: (message, fields) => {
        let extra = '';
        if (fields !== undefined) {
          try {
            extra = ` ${JSON.stringify(fields)}`;
          } catch {
            extra = ' [fields not JSON]';
          }
        }
        write(`${String(message)}${extra}`);
      },
      fetch: (resource, init) => fetcher(resource, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }),
      kv: p.kv,
      now: () => now(),
      signal,
      host: p.host,
    };
  }

  /** Logs a failed hook call; a fail-closed one is audited too (`plugin.failed`). */
  function failed(p: Running, hook: HookName, outcome: Extract<HookOutcome<unknown>, { ok: false }>, waitUntil?: (promise: Promise<unknown>) => void): void {
    const closed = failsClosed(hook);
    logFor(p)(`${hook} failed (${closed ? 'refused' : 'ignored'}): ${describeFailure(outcome)}`);
    if (closed && hook !== 'on.audit') {
      track(services.audit({ pluginId: p.id, action: 'plugin.failed', detail: { plugin: p.id, hook, reason: outcome.reason, error: redact(describeFailure(outcome), p.secrets).slice(0, 500) } }).catch((error: unknown) => log(`plugin ${p.id}: the failure could not be audited: ${error instanceof Error ? error.message : String(error)}`)), waitUntil);
    }
  }

  async function call<T>(p: Running, hook: HookName, invoke: (ctx: PluginContext) => unknown, check: (answer: unknown) => Checked<T>, waitUntil?: (promise: Promise<unknown>) => void): Promise<HookOutcome<T>> {
    const controller = new AbortController();
    const ctx = contextFor(p, controller.signal);
    const outcome = await runHook(() => invoke(ctx), check, p.timeoutMs, controller);
    if (!outcome.ok) failed(p, hook, outcome, waitUntil);
    return outcome;
  }

  const having = (hook: HookName): Running[] => running.filter((p) => p.plugin.hooks.includes(hook));
  const authenticators = having('auth.authenticate');
  const signIns = having('auth.signIn');
  const identityHooks = having('auth.identity');
  const signOutHooks = having('auth.signOutUrl');
  const roleHooks = having('authz.role');
  const artifactsHooks = having('authz.artifacts');
  const guards = having('guard');
  const delivers = having('wake.deliver');
  const byId = new Map(running.map((p) => [p.id, p]));

  const uiView: PluginUiView = { links: [], brand: null };
  for (const p of running) {
    for (const link of p.plugin.ui.links) uiView.links.push({ ...link, plugin: p.id });
    if (!uiView.brand && p.plugin.ui.brand) uiView.brand = { ...p.plugin.ui.brand };
  }

  function signInPlugin(id: string): Running {
    const bare = id.startsWith('plugin:') ? id.slice('plugin:'.length) : id;
    const p = byId.get(bare);
    if (!p || !p.plugin.hooks.includes('auth.signIn')) throw new SignInError('unknown_provider', id);
    return p;
  }

  /** The request without its body: `auth.authenticate` decides from headers and cookies, and must not use the body up. */
  function headersOnly(request: Request): Request {
    return new Request(request.url, { method: request.method, headers: request.headers });
  }

  const plugins: Plugins = {
    size: running.length,
    hasAuthenticate: authenticators.length > 0,
    hasIdentityHook: identityHooks.length > 0,
    hasRoleHook: roleHooks.length > 0,
    hasArtifactsHook: artifactsHooks.length > 0,
    listens: (event) => having(`on.${event}`).length > 0,

    async authenticate(request, options = {}) {
      for (const p of authenticators) {
        if (p.id === options.except) continue;
        const outcome = await call(p, 'auth.authenticate', (ctx) => (p.plugin.source.auth!.authenticate as AnyHook).call(p.plugin.source.auth, { request: headersOnly(request) }, ctx), answers.authenticate);
        if (outcome.ok && outcome.value) return { identity: outcome.value, provider: `plugin:${p.id}` };
      }
      return null;
    },

    async recheck(provider, request) {
      const p = provider.startsWith('plugin:') ? byId.get(provider.slice('plugin:'.length)) : undefined;
      if (!p || !p.plugin.hooks.includes('auth.authenticate') || !p.plugin.recheck) return { kind: 'skip' };
      const outcome = await call(p, 'auth.authenticate', (ctx) => (p.plugin.source.auth!.authenticate as AnyHook).call(p.plugin.source.auth, { request: headersOnly(request) }, ctx), answers.authenticate);
      return outcome.ok ? { kind: 'answer', identity: outcome.value } : { kind: 'failed' };
    },

    signInButtons() {
      return signIns.map((p) => ({ id: `plugin:${p.id}`, label: p.plugin.source.auth!.signIn!.label.trim() }));
    },

    async startSignIn(id, request, returnTo, callbackUrl) {
      const p = signInPlugin(id);
      const signIn = p.plugin.source.auth!.signIn!;
      const outcome = await call(p, 'auth.signIn', (ctx) => (signIn.start as AnyHook).call(signIn, { request, returnTo, callbackUrl }, ctx), answers.signInStart);
      if (!outcome.ok) throw new SignInError('provider_error', `plugin ${p.id}: start ${outcome.reason}`);
      return outcome.value;
    },

    async finishSignIn(id, request) {
      const p = signInPlugin(id);
      const signIn = p.plugin.source.auth!.signIn!;
      const outcome = await call(p, 'auth.signIn', (ctx) => (signIn.finish as AnyHook).call(signIn, { request }, ctx), answers.signInFinish);
      if (!outcome.ok) throw new SignInError('provider_error', `plugin ${p.id}: finish ${outcome.reason}`);
      return { ...outcome.value, provider: `plugin:${p.id}` };
    },

    async identity(identity, provider) {
      let current = checkIdentity(identity) ?? clone(identity);
      for (const p of identityHooks) {
        const subject = current.subject;
        const outcome = await call(p, 'auth.identity', (ctx) => (p.plugin.source.auth!.identity as AnyHook).call(p.plugin.source.auth, { identity: clone(current), provider }, ctx), (answer) => answers.identity(answer, subject));
        if (!outcome.ok) return { reject: 'This sign-in could not be checked just now. Try again in a moment.', plugin: p.id };
        const value = outcome.value;
        if ('reject' in value) return { reject: value.reject, plugin: p.id };
        if ('identity' in value) current = value.identity;
      }
      return { identity: current };
    },

    async signOutUrl(principal) {
      for (const p of signOutHooks) {
        const outcome = await call(p, 'auth.signOutUrl', (ctx) => (p.plugin.source.auth!.signOutUrl as AnyHook).call(p.plugin.source.auth, { principal: pluginUser(principal) }, ctx), answers.signOutUrl);
        if (outcome.ok && outcome.value) return outcome.value;
      }
      return null;
    },

    async role({ principal, artifact, role }, trace) {
      if (roleHooks.length === 0) return { role, cacheSeconds: null };
      const who = pluginPrincipal(principal);
      const what = artifactInfo(artifact);
      let current = role;
      let cacheSeconds = Infinity;
      for (const p of roleHooks) {
        const outcome = await call(p, 'authz.role', (ctx) => (p.plugin.source.authz!.role as AnyHook).call(p.plugin.source.authz, { principal: clone(who), artifact: clone(what), role: current }, ctx), answers.role);
        if (!outcome.ok) {
          trace?.push({ plugin: p.id, before: current, answer: 'failed', after: null });
          return { role: null, cacheSeconds: 0, failed: p.id };
        }
        cacheSeconds = Math.min(cacheSeconds, p.plugin.cacheSeconds);
        const before = current;
        if (outcome.value.opinion) current = outcome.value.role;
        trace?.push({ plugin: p.id, before, answer: outcome.value.opinion ? outcome.value.role : 'no opinion', after: current });
      }
      return { role: current, cacheSeconds };
    },

    async extraArtifacts(principal) {
      const who = pluginPrincipal(principal);
      const out = new Set<string>();
      for (const p of artifactsHooks) {
        const outcome = await call(p, 'authz.artifacts', (ctx) => (p.plugin.source.authz!.artifacts as AnyHook).call(p.plugin.source.authz, { principal: clone(who) }, ctx), answers.artifacts);
        if (!outcome.ok) continue;
        for (const id of outcome.value) {
          if (out.size >= MAX_EXTRA_ARTIFACTS) break;
          if (ARTIFACT_ID.test(id)) out.add(id);
        }
      }
      return [...out];
    },

    async guard(action, input) {
      if (!GUARD_ACTIONS.includes(action)) throw new TypeError(`Unknown guard action ${action}.`);
      if (guards.length === 0) return;
      const asked = { action, principal: pluginPrincipal(input.principal), ...(input.artifact ? { artifact: artifactInfo(input.artifact) } : {}), detail: input.detail };
      for (const p of guards) {
        const outcome = await call(p, 'guard', (ctx) => (p.plugin.source.guard as AnyHook).call(p.plugin.source, clone(asked), ctx), answers.guard);
        if (!outcome.ok) throw httpError('not_granted', `This could not be checked just now (${p.plugin.name}). Try again in a moment.`, { status: 403 });
        if (outcome.value) {
          track(services.audit({ pluginId: p.id, action: 'plugin.denied', detail: { action, artifact: input.artifact?.id ?? null } }).catch(() => undefined));
          throw httpError('not_granted', outcome.value.deny, { status: 403 });
        }
      }
    },

    emit(event, payload, waitUntil) {
      if (!EVENT_NAMES.includes(event)) {
        log(`plugins: no such event ${String(event)}`);
        return;
      }
      const hook: HookName = `on.${event}`;
      const listeners = having(hook);
      if (listeners.length === 0) return;
      const full = { ...payload, event, at: payload.at ?? now().toISOString() };
      const actor = event === 'audit' ? (payload as PluginEventMap['audit']).actor : null;
      for (const p of listeners) {
        // A plugin does not hear its own audit entries back (a handler that audits would loop).
        if (actor && actor.kind === 'system' && actor.id === `plugin:${p.id}`) continue;
        const work = (async () => {
          await Promise.resolve();
          const handlers = p.plugin.source.on as Record<string, AnyHook>;
          await call(p, hook, (ctx) => handlers[event]!.call(handlers, clone(full), ctx), answers.event, waitUntil);
        })();
        track(work, waitUntil);
      }
    },

    async deliverWake(wake) {
      if (delivers.length === 0) return false;
      const asked = { artifact: artifactInfo(wake.artifact), owner: wake.owner, payload: wake.payload, from: wake.from };
      for (const p of delivers) {
        const outcome = await call(p, 'wake.deliver', (ctx) => (p.plugin.source.wake!.deliver as AnyHook).call(p.plugin.source.wake, clone(asked), ctx), answers.deliver);
        if (outcome.ok && outcome.value) return true;
      }
      return false;
    },

    routeInfo(request) {
      const found = findRoute(request);
      if (!found) return null;
      return { pluginId: found.pluginId, public: found.kind === 'route' ? found.route.public : false };
    },

    async route(request, principalOf) {
      const found = findRoute(request);
      if (!found) return null;
      if (found.kind === 'no-plugin') return errorAnswer(404, 'not_found', `There is no plugin ${JSON.stringify(found.pluginId)} on this site.`);
      if (found.kind === 'no-path') return errorAnswer(404, 'not_found', `No route for ${request.method} ${new URL(request.url).pathname}.`);
      if (found.kind === 'no-method') return errorAnswer(405, 'method_not_found', `${request.method} is not allowed on ${new URL(request.url).pathname}.`, { allow: found.allow.join(', ') });
      const { p, route, params } = found;
      if (!route.public && !isSameOriginWrite(request, services.appOrigin)) return errorAnswer(403, 'not_granted', 'Cross-site requests may not change anything here.');
      const principal = pluginPrincipal(await principalOf(request));
      const declared = p.plugin.source.routes![route.index]!;
      const outcome = await call(p, 'routes', (ctx) => (declared.handler as AnyHook).call(declared, { request, principal, params }, ctx), answers.route);
      if (outcome.ok) return outcome.value;
      if (outcome.reason === 'threw') {
        const chosen = httpErrorOf(outcome.error);
        if (chosen) return errorAnswer(chosen.status, 'plugin_error', chosen.message);
      }
      if (outcome.reason === 'timeout') return errorAnswer(504, 'plugin_timeout', `The ${p.plugin.name} plugin took too long to answer.`);
      return errorAnswer(500, 'plugin_error', `The ${p.plugin.name} plugin failed to answer this request.`);
    },

    ui() {
      return { links: uiView.links.map((link) => ({ ...link })), brand: uiView.brand ? { ...uiView.brand } : null };
    },

    describe() {
      return descriptions.map((d) => ({ ...d, hooks: [...d.hooks], settings: [...d.settings], problems: [...d.problems] }));
    },

    async idle() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };

  type Found =
    | { kind: 'no-plugin'; pluginId: string }
    | { kind: 'no-path'; pluginId: string }
    | { kind: 'no-method'; pluginId: string; allow: string[] }
    | { kind: 'route'; pluginId: string; p: Running; route: CheckedRoute; params: Record<string, string> };

  function findRoute(request: Request): Found | null {
    const path = new URL(request.url).pathname.split('/').filter((s) => s !== '');
    if (path[0] !== 'plugins' || path.length < 2) return null;
    const pluginId = path[1]!;
    const p = byId.get(pluginId);
    if (!p) return { kind: 'no-plugin', pluginId };
    const rest = path.slice(2);
    const method = request.method.toUpperCase();
    const allow = new Set<string>();
    let getMatch: { route: CheckedRoute; params: Record<string, string> } | null = null;
    for (const route of p.plugin.routes) {
      const params = matchRoute(route.segments, rest);
      if (!params) continue;
      if (route.method === '*' || route.method === method) return { kind: 'route', pluginId, p, route, params };
      if (method === 'HEAD' && route.method === 'GET' && !getMatch) getMatch = { route, params };
      allow.add(route.method);
    }
    if (getMatch) return { kind: 'route', pluginId, p, ...getMatch };
    return allow.size > 0 ? { kind: 'no-method', pluginId, allow: [...allow] } : { kind: 'no-path', pluginId };
  }

  return plugins;
}
