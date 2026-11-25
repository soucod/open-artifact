/**
 * `@open-artifact/host-plugin/testing`: run a plugin's hooks in a unit test, with no host.
 *
 * ```js
 * import { test } from 'node:test';
 * import assert from 'node:assert/strict';
 * import { createPluginHarness } from '@open-artifact/host-plugin/testing';
 * import plugin from './my-plugin.mjs';
 *
 * test('editors from the directory', async () => {
 *   const h = createPluginHarness(plugin, {
 *     config: { url: 'https://perms.example.com', secret: { env: 'PERMS_SECRET' } },
 *     env: { PERMS_SECRET: 'x'.repeat(32) },
 *     fetch: async () => Response.json({ role: 'editor' }),
 *   });
 *   const artifact = h.addArtifact({ title: 'Plan' });
 *   const { role } = await h.role({ principal: h.userPrincipal(h.addUser({ email: 'ann@example.com' })), artifact, role: null });
 *   assert.equal(role, 'editor');
 * });
 * ```
 *
 * The harness checks the plugin and its settings with the host's own rules (`./contract.ts`): it throws what the
 * host would refuse to start with. Each hook is then called as the host calls it: in order, under the time limit,
 * with the same failure policy (sign-in, permission and guard hooks fail closed, events and `wake.deliver` open) and
 * the same answer checks. Failures are kept in `failures`; `ctx.log`, `ctx.host.audit` and `ctx.fetch` calls in
 * `logs`, `audits` and `fetches`.
 */

import {
  answers,
  artifactListOptions,
  checkIdentity,
  checkPlugin,
  DEFAULT_TIMEOUT_MS,
  EVENT_NAMES,
  ALL_FEATURES,
  checkKvKey,
  encodeKvValue,
  httpErrorOf,
  isSameOriginWrite,
  KV_LIMITS,
  kvExpiry,
  kvFull,
  kvListLimit,
  matchRoute,
  redact,
  runHook,
  runValidate,
  validateConfig,
  type CheckedPlugin,
  type Checked,
  type CheckedRoute,
  type HookOutcome,
} from './contract.ts';
import type {
  ArtifactInfo,
  ArtifactRole,
  GuardAction,
  GuardDetails,
  Identity,
  PluginContext,
  PluginEventMap,
  PluginEventName,
  PluginHost,
  PluginKv,
  Principal,
  UserInfo,
  UserPrincipal,
  WakePayload,
} from './index.ts';

/** How to set up a harness. */
export interface HarnessOptions {
  /** The settings, as the operator would write them (`{env: NAME}` references included). */
  config?: Record<string, unknown>;
  /** The environment `{env: NAME}` settings read. */
  env?: Record<string, string | undefined>;
  /** The clock: a fixed time (moved with `advance`), or a function. Default: 2026-01-01T00:00:00Z. */
  now?: Date | (() => Date);
  /** Answers `ctx.fetch` (and gets the `Request`). Without it, a call to `ctx.fetch` fails the hook. */
  fetch?: (request: Request) => Response | Promise<Response>;
  /** Each hook call's time limit, ms (default 5000, as the host). */
  timeoutMs?: number;
  /** The operator's `cacheSeconds` for the entry: replaces the plugin's `authz.cacheSeconds`, as the host does. */
  cacheSeconds?: number;
  /** The site's address (default `https://artifacts.example.test`). */
  appOrigin?: string;
  /** The host version `ctx.host.version` says (default `0.0.0-test`). */
  hostVersion?: string;
  /** What `ctx.host.supports` answers true for (default: all of API version 1). */
  features?: readonly string[];
}

/** A hook call that failed, as the host would log it. */
export interface HarnessFailure {
  hook: string;
  reason: 'threw' | 'timeout' | 'shape';
  message: string;
}

/** The plugin under test, and every way to call it. */
export interface PluginHarness<Config = Record<string, unknown>> {
  /** The plugin as the host checked it (its hooks, routes, schema). */
  plugin: CheckedPlugin;
  /** What the host would report and ignore (unknown hooks, an inline secret). */
  warnings: string[];
  /** The validated settings. */
  config: Readonly<Config>;
  /** A context like the one hooks get, to call your own helpers with. */
  ctx: PluginContext<Config>;
  kv: PluginKv & { dump(): Record<string, unknown> };
  logs: Array<{ message: string; fields?: Record<string, unknown> }>;
  audits: Array<{ action: string; detail: unknown }>;
  fetches: Request[];
  failures: HarnessFailure[];
  /** Every `ctx.host.access.invalidate` call (null: all artifacts). */
  invalidated: Array<string | null>;
  /** The fake site's users and artifacts, which `ctx.host.users` and `ctx.host.artifacts` read. */
  users: Map<string, UserInfo>;
  artifacts: Map<string, ArtifactInfo>;
  /** Adds a user (defaults filled in). */
  addUser(user?: Partial<UserInfo>): UserInfo;
  /** Adds an artifact (defaults filled in). */
  addArtifact(artifact?: Partial<ArtifactInfo>): ArtifactInfo;
  /** A user as a principal (`groups` as the host keeps them, `<provider>:<group>`). */
  userPrincipal(user: UserInfo, groups?: string[]): UserPrincipal;
  /** Moves the fixed clock forward. */
  advance(ms: number): void;

  /** `auth.authenticate`: the identity, or null (also after a failure). */
  authenticate(request: Request): Promise<Identity | null>;
  /** `auth.signIn.start`. Throws when it fails (the host shows a sign-in error). */
  signInStart(input?: { request?: Request; returnTo?: string; callbackUrl?: string }): Promise<Response>;
  /** `auth.signIn.finish`. Throws when it fails. */
  signInFinish(request: Request): Promise<{ identity: Identity; returnTo?: string }>;
  /** `auth.identity`: the identity to sign in, or a refusal (also after a failure). */
  identity(identity: Identity, provider?: string): Promise<{ identity: Identity } | { reject: string }>;
  /** `auth.signOutUrl`. */
  signOutUrl(principal: UserPrincipal): Promise<string | null>;
  /** `authz.role`, as one link of the host's chain: the role after it, and how long the host would reuse it. */
  role(input: { principal: Principal; artifact: ArtifactInfo; role: ArtifactRole | null }): Promise<{ role: ArtifactRole | null; cacheSeconds: number | null }>;
  /** `authz.artifacts`. */
  artifactsFor(principal: Principal): Promise<string[]>;
  /** `guard`: allowed, or the sentence the person would see. */
  guard<A extends GuardAction>(action: A, input: { principal: Principal; artifact?: ArtifactInfo; detail: GuardDetails[A] }): Promise<{ allowed: true } | { allowed: false; reason: string }>;
  /** Sends an event and waits for the handler (the host does not wait; a failure lands in `failures`). */
  emit<E extends PluginEventName>(event: E, payload: PluginEventMap[E] & { at?: string }): Promise<void>;
  /** `wake.deliver`: whether it delivered (false after a failure). */
  deliverWake(input: { artifact: ArtifactInfo; owner: UserInfo; payload: WakePayload; from: { name: string; role: ArtifactRole; userId?: string } }): Promise<boolean>;
  /**
   * A request to one of the plugin's routes. `path` is the route's path (`/invalidate`) or the full one
   * (`/plugins/<id>/invalidate`); `principal` is who the host says sends it (default anonymous). The host's answers
   * for no route (404), another method (405) and a cross-site write to a route that is not public (403) apply.
   */
  request(method: string, path: string, init?: RequestInit & { principal?: Principal }): Promise<Response>;
}

/** The harness refused the plugin, as the host would refuse to start: `problems` lists why. */
export class PluginRefusedError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'PluginRefusedError';
    this.problems = problems;
  }
}

const DEFAULT_NOW = new Date('2026-01-01T00:00:00.000Z');
type AnyHook = (input: unknown, ctx: PluginContext) => unknown;

function memoryKv(now: () => Date): PluginKv & { dump(): Record<string, unknown> } {
  const store = new Map<string, { value: string; expiresAt: string | null }>();
  const alive = (entry: { expiresAt: string | null }): boolean => entry.expiresAt === null || entry.expiresAt > now().toISOString();
  const sweep = (): void => {
    for (const [key, entry] of store) if (!alive(entry)) store.delete(key);
  };
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      checkKvKey(key);
      const entry = store.get(key);
      if (!entry || !alive(entry)) {
        store.delete(key);
        return null;
      }
      return JSON.parse(entry.value) as T;
    },
    async set(key, value, options = {}) {
      checkKvKey(key);
      const text = encodeKvValue(value);
      const expiresAt = kvExpiry(now(), options.ttlSeconds);
      if (!store.has(key)) {
        sweep();
        if (store.size >= KV_LIMITS.maxKeys) throw kvFull();
      }
      store.set(key, { value: text, expiresAt });
    },
    async delete(key) {
      checkKvKey(key);
      store.delete(key);
    },
    async list<T = unknown>(options: { prefix?: string; after?: string; limit?: number } = {}) {
      const limit = kvListLimit(options.limit);
      sweep();
      return [...store.entries()]
        .filter(([key]) => (options.prefix === undefined || key.startsWith(options.prefix)) && (options.after === undefined || key > options.after))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, limit)
        .map(([key, entry]) => ({ key, value: JSON.parse(entry.value) as T, expiresAt: entry.expiresAt }));
    },
    dump() {
      sweep();
      return Object.fromEntries([...store.entries()].map(([key, entry]) => [key, JSON.parse(entry.value) as unknown]));
    },
  };
}

/**
 * A harness for `plugin` (the object your module exports). Throws a {@link PluginRefusedError} when the host would
 * refuse the plugin or its settings, with the host's messages.
 */
export function createPluginHarness<Config = Record<string, unknown>>(plugin: unknown, options: HarnessOptions = {}): PluginHarness<Config> {
  const checked = checkPlugin(plugin, 'The plugin', options.hostVersion ? { hostVersion: options.hostVersion } : {});
  if (!checked.plugin) throw new PluginRefusedError(checked.errors);
  const p: CheckedPlugin = options.cacheSeconds !== undefined ? { ...checked.plugin, cacheSeconds: options.cacheSeconds } : checked.plugin;
  const settings = validateConfig(p.id, p.schema, options.config, options.env ?? {});
  if (settings.errors.length > 0) throw new PluginRefusedError(settings.errors);
  const refused = runValidate(p, settings.config).map((problem) => redact(problem, settings.secrets));
  if (refused.length > 0) throw new PluginRefusedError(refused);
  const warnings = [...checked.warnings, ...settings.warnings];

  let fixed = options.now instanceof Date ? options.now : DEFAULT_NOW;
  const now = typeof options.now === 'function' ? options.now : () => fixed;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const appOrigin = options.appOrigin ?? 'https://artifacts.example.test';
  const features = new Set(options.features ?? ALL_FEATURES);
  const logs: PluginHarness['logs'] = [];
  const audits: PluginHarness['audits'] = [];
  const fetches: Request[] = [];
  const failures: HarnessFailure[] = [];
  const invalidated: Array<string | null> = [];
  const users = new Map<string, UserInfo>();
  const artifacts = new Map<string, ArtifactInfo>();
  const kv = memoryKv(now);
  let counter = 0;

  const host: PluginHost = {
    apiVersion: p.apiVersion,
    version: options.hostVersion ?? '0.0.0-test',
    appOrigin,
    supports: (name) => features.has(name),
    users: {
      get: async (id) => users.get(id) ?? null,
      findByEmail: async (email) => [...users.values()].find((u) => u.email === email.trim().toLowerCase()) ?? null,
    },
    artifacts: {
      get: async (id) => artifacts.get(id) ?? null,
      // As the hosts answer: outside the trash, in id order, a page at a time (the same cap).
      list: async (options) => {
        const { owner, after, limit } = artifactListOptions(options);
        const all = [...artifacts.values()]
          .filter((a) => a.trashedAt === null && (!owner || a.owner === owner) && (!after || a.id > after))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const page = all.slice(0, limit).map(({ id, title, type, owner: by, updatedAt }) => ({ id, title, type, owner: by, updatedAt }));
        return { artifacts: page, next: all.length > limit ? page.at(-1)!.id : null };
      },
    },
    access: {
      invalidate: async (artifactId) => {
        invalidated.push(artifactId ?? null);
      },
    },
    audit: async (action, detail) => {
      audits.push({ action, detail: detail ?? null });
    },
  };

  function contextFor(signal: AbortSignal): PluginContext<Config> {
    return {
      plugin: { id: p.id },
      config: settings.config as Readonly<Config>,
      log: (message, fields) => {
        logs.push({ message: redact(String(message), settings.secrets), ...(fields !== undefined ? { fields } : {}) });
      },
      fetch: async (resource, init) => {
        const request = new Request(resource, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
        fetches.push(request.clone());
        if (!options.fetch) throw new Error(`ctx.fetch(${request.url}) was called, but the harness has no fetch stub: pass {fetch} to createPluginHarness.`);
        return options.fetch(request);
      },
      kv,
      now,
      signal,
      host,
    };
  }

  async function call<T>(hook: string, invoke: (ctx: PluginContext) => unknown, check: (answer: unknown) => Checked<T>): Promise<HookOutcome<T>> {
    const controller = new AbortController();
    const ctx = contextFor(controller.signal) as unknown as PluginContext;
    const outcome = await runHook(() => invoke(ctx), check, timeoutMs, controller);
    if (!outcome.ok) failures.push({ hook, reason: outcome.reason, message: outcome.message });
    return outcome;
  }

  const source = p.source;
  const has = (hook: string): boolean => (p.hooks as string[]).includes(hook);

  const harness: PluginHarness<Config> = {
    plugin: p,
    warnings,
    config: settings.config as Readonly<Config>,
    ctx: contextFor(new AbortController().signal),
    kv,
    logs,
    audits,
    fetches,
    failures,
    invalidated,
    users,
    artifacts,

    addUser(user = {}) {
      const id = user.id ?? `user_${++counter}`;
      const info: UserInfo = {
        id,
        name: user.name ?? `User ${counter}`,
        email: user.email?.toLowerCase() ?? null,
        emailVerified: user.emailVerified ?? user.email !== undefined,
        avatar: user.avatar ?? null,
        siteRole: user.siteRole ?? 'member',
        createdAt: user.createdAt ?? now().toISOString(),
        disabled: user.disabled ?? false,
      };
      users.set(id, info);
      return info;
    },

    addArtifact(artifact = {}) {
      const id = artifact.id ?? `art_${now().getTime().toString(36).padStart(9, '0')}${(++counter).toString(16).padStart(16, '0')}`;
      const at = now().toISOString();
      const info: ArtifactInfo = {
        id,
        type: artifact.type ?? 'slides',
        title: artifact.title ?? 'Untitled',
        owner: artifact.owner ?? 'owner',
        generalAccess: artifact.generalAccess ?? 'restricted',
        createdAt: artifact.createdAt ?? at,
        updatedAt: artifact.updatedAt ?? at,
        trashedAt: artifact.trashedAt ?? null,
      };
      artifacts.set(id, info);
      return info;
    },

    userPrincipal(user, groups) {
      return {
        kind: 'user',
        id: user.id,
        name: user.name,
        ...(user.email ? { email: user.email, emailVerified: user.emailVerified } : {}),
        ...(user.avatar ? { avatar: user.avatar } : {}),
        ...(groups ? { groups } : {}),
        siteRole: user.siteRole,
      };
    },

    advance(ms) {
      fixed = new Date(fixed.getTime() + ms);
    },

    async authenticate(request) {
      if (!has('auth.authenticate')) return null;
      const bare = new Request(request.url, { method: request.method, headers: request.headers });
      const outcome = await call('auth.authenticate', (ctx) => (source.auth!.authenticate as AnyHook).call(source.auth, { request: bare }, ctx), answers.authenticate);
      return outcome.ok ? outcome.value : null;
    },

    async signInStart(input = {}) {
      if (!has('auth.signIn')) throw new Error('The plugin has no auth.signIn.');
      const signIn = source.auth!.signIn!;
      const request = input.request ?? new Request(`${appOrigin}/auth/plugin:${p.id}/start`);
      const outcome = await call('auth.signIn', (ctx) => (signIn.start as AnyHook).call(signIn, { request, returnTo: input.returnTo ?? '/', callbackUrl: input.callbackUrl ?? `${appOrigin}/auth/plugin:${p.id}/callback` }, ctx), answers.signInStart);
      if (!outcome.ok) throw new Error(`auth.signIn.start failed (${outcome.reason}): ${outcome.message}`);
      return outcome.value;
    },

    async signInFinish(request) {
      if (!has('auth.signIn')) throw new Error('The plugin has no auth.signIn.');
      const signIn = source.auth!.signIn!;
      const outcome = await call('auth.signIn', (ctx) => (signIn.finish as AnyHook).call(signIn, { request }, ctx), answers.signInFinish);
      if (!outcome.ok) throw new Error(`auth.signIn.finish failed (${outcome.reason}): ${outcome.message}`);
      return outcome.value;
    },

    async identity(identity, provider = 'oidc:test') {
      const given = checkIdentity(identity) ?? structuredClone(identity);
      if (!has('auth.identity')) return { identity: given };
      const outcome = await call('auth.identity', (ctx) => (source.auth!.identity as AnyHook).call(source.auth, { identity: structuredClone(given), provider }, ctx), (answer) => answers.identity(answer, given.subject));
      if (!outcome.ok) return { reject: 'This sign-in could not be checked just now. Try again in a moment.' };
      const value = outcome.value;
      if ('reject' in value) return { reject: value.reject };
      return { identity: 'identity' in value ? value.identity : given };
    },

    async signOutUrl(principal) {
      if (!has('auth.signOutUrl')) return null;
      const outcome = await call('auth.signOutUrl', (ctx) => (source.auth!.signOutUrl as AnyHook).call(source.auth, { principal: structuredClone(principal) }, ctx), answers.signOutUrl);
      return outcome.ok ? outcome.value : null;
    },

    async role(input) {
      if (!has('authz.role')) return { role: input.role, cacheSeconds: null };
      const outcome = await call('authz.role', (ctx) => (source.authz!.role as AnyHook).call(source.authz, structuredClone(input), ctx), answers.role);
      if (!outcome.ok) return { role: null, cacheSeconds: 0 };
      return { role: outcome.value.opinion ? outcome.value.role : input.role, cacheSeconds: p.cacheSeconds };
    },

    async artifactsFor(principal) {
      if (!has('authz.artifacts')) return [];
      const outcome = await call('authz.artifacts', (ctx) => (source.authz!.artifacts as AnyHook).call(source.authz, { principal: structuredClone(principal) }, ctx), answers.artifacts);
      return outcome.ok ? outcome.value : [];
    },

    async guard(action, input) {
      if (!has('guard')) return { allowed: true };
      const asked = { action, principal: input.principal, ...(input.artifact ? { artifact: input.artifact } : {}), detail: input.detail };
      const outcome = await call('guard', (ctx) => (source.guard as AnyHook).call(source, structuredClone(asked), ctx), answers.guard);
      if (!outcome.ok) return { allowed: false, reason: `This could not be checked just now (${p.name}). Try again in a moment.` };
      return outcome.value ? { allowed: false, reason: outcome.value.deny } : { allowed: true };
    },

    async emit(event, payload) {
      if (!EVENT_NAMES.includes(event)) throw new TypeError(`No such event: ${String(event)}.`);
      if (!has(`on.${event}`)) return;
      const handlers = source.on as Record<string, AnyHook>;
      const full = { ...payload, event, at: payload.at ?? now().toISOString() };
      await call(`on.${event}`, (ctx) => handlers[event]!.call(handlers, structuredClone(full), ctx), answers.event);
    },

    async deliverWake(input) {
      if (!has('wake.deliver')) return false;
      const outcome = await call('wake.deliver', (ctx) => (source.wake!.deliver as AnyHook).call(source.wake, structuredClone(input), ctx), answers.deliver);
      return outcome.ok ? outcome.value : false;
    },

    async request(method, path, init = {}) {
      const { principal = { kind: 'anonymous' }, ...requestInit } = init;
      const prefix = `/plugins/${p.id}`;
      const full = path.startsWith(`${prefix}/`) || path === prefix ? path : `${prefix}${path.startsWith('/') ? path : `/${path}`}`;
      const request = new Request(`${appOrigin}${full}`, { ...requestInit, method });
      const rest = new URL(request.url).pathname.split('/').filter((s) => s !== '').slice(2);
      const wanted = method.toUpperCase();
      const allow = new Set<string>();
      type Match = { route: CheckedRoute; params: Record<string, string> };
      let found: Match | null = null;
      let getMatch: Match | null = null;
      for (const route of p.routes) {
        const params = matchRoute(route.segments, rest);
        if (!params) continue;
        if (route.method === '*' || route.method === wanted) {
          found = { route, params };
          break;
        }
        if (wanted === 'HEAD' && route.method === 'GET' && !getMatch) getMatch = { route, params };
        allow.add(route.method);
      }
      found ??= getMatch;
      const answer = (status: number, code: string, message: string, headers?: HeadersInit): Response =>
        Response.json({ code, message }, { status, ...(headers ? { headers } : {}) });
      if (!found) {
        return allow.size > 0
          ? answer(405, 'method_not_found', `${method} is not allowed on ${full}.`, { allow: [...allow].join(', ') })
          : answer(404, 'not_found', `No route for ${method} ${full}.`);
      }
      if (!found.route.public && !isSameOriginWrite(request, appOrigin)) return answer(403, 'not_granted', 'Cross-site requests may not change anything here.');
      const declared = source.routes![found.route.index]!;
      const params = found.params;
      const outcome = await call('routes', (ctx) => (declared.handler as AnyHook).call(declared, { request, principal, params }, ctx), answers.route);
      if (outcome.ok) return outcome.value;
      if (outcome.reason === 'threw') {
        const chosen = httpErrorOf(outcome.error);
        if (chosen) return answer(chosen.status, 'plugin_error', chosen.message);
      }
      if (outcome.reason === 'timeout') return answer(504, 'plugin_timeout', `The ${p.name} plugin took too long to answer.`);
      return answer(500, 'plugin_error', `The ${p.name} plugin failed to answer this request.`);
    },
  };
  return harness;
}
