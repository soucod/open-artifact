/**
 * `@open-artifact/host-plugin/contract`: the rules of the plugin API that the host and the test kit share, so a plugin
 * that passes its tests under the kit loads and behaves the same on the host.
 *
 * - {@link checkPlugin}: what a plugin object must look like (its `id`, `apiVersion`, hooks), what is reported and
 *   ignored (unknown keys and hooks), and what refuses it.
 * - {@link validateConfig}: the operator's settings against the plugin's schema, `{"env": "NAME"}` references
 *   resolved, defaults filled in, secrets never echoed.
 * - The answer checks of every hook (`check*`): an answer of the wrong shape counts as a failure.
 * - {@link withTimeLimit}: one hook call under its time limit.
 * - The key-value store's limits ({@link KV_LIMITS}), route path matching and the same-origin rule for writes.
 *
 * Plugin authors do not need this module; it is public so the rules are written down in one place.
 */

import {
  PLUGIN_API_VERSION,
  type ArtifactRole,
  type ConfigField,
  type ConfigFieldType,
  type ConfigSchema,
  type GuardAction,
  type HostPlugin,
  type Identity,
  type PluginEventName,
  type PluginUi,
} from './index.ts';

// ---------------------------------------------------------------------------
// Names

/** The plugin API versions this release runs (the current one first). A version here but not current runs through an adapter. */
export const SUPPORTED_API_VERSIONS: readonly number[] = [PLUGIN_API_VERSION];

/** Every event of API version 1, in the order the documentation lists them. */
export const EVENT_NAMES: readonly PluginEventName[] = [
  'user.created',
  'user.signed_in',
  'artifact.created',
  'artifact.changed',
  'artifact.trashed',
  'artifact.restored',
  'artifact.deleted',
  'share.changed',
  'share.invited',
  'agent.requested',
  'audit',
];

/** Every guarded action of API version 1. */
export const GUARD_ACTIONS: readonly GuardAction[] = [
  'artifact.create',
  'artifact.import',
  'artifact.delete',
  'artifact.export',
  'share.change',
  'link.connect',
  'link.publish',
  'type.publish',
  'mcp.connect',
  'agent.ask',
];

/** The hooks of API version 1 besides the event handlers (`on.<event>`). */
export const HOOK_NAMES = [
  'auth.authenticate',
  'auth.signIn',
  'auth.identity',
  'auth.signOutUrl',
  'authz.role',
  'authz.artifacts',
  'guard',
  'wake.deliver',
  'routes',
  'ui',
] as const;

/** A hook's name: one of {@link HOOK_NAMES} or `on.<event>`. */
export type HookName = (typeof HOOK_NAMES)[number] | `on.${PluginEventName}`;

/** The members of `ctx` (for `ctx.host.supports('ctx.kv')`). */
export const CONTEXT_FEATURES: readonly string[] = [
  'ctx.config',
  'ctx.log',
  'ctx.fetch',
  'ctx.kv',
  'ctx.now',
  'ctx.signal',
  'ctx.host.users',
  'ctx.host.artifacts',
  'ctx.host.artifacts.list',
  'ctx.host.access',
  'ctx.host.audit',
];

/** `ctx.host.artifacts.list`: the page size unless the plugin asks for another, and the most one call answers. */
export const ARTIFACT_LIST_DEFAULT = 50;
export const ARTIFACT_LIST_MAX = 200;

/** `ctx.host.artifacts.list`'s options checked: a TypeError for a wrong one, the limit clamped to the cap. */
export function artifactListOptions(options: unknown): { owner?: string; after?: string; limit: number } {
  if (options === undefined || options === null) return { limit: ARTIFACT_LIST_DEFAULT };
  if (typeof options !== 'object' || Array.isArray(options)) throw new TypeError('artifacts.list takes {owner?, limit?, after?}.');
  const { owner, limit, after } = options as Record<string, unknown>;
  if (owner !== undefined && (typeof owner !== 'string' || owner === '')) throw new TypeError('artifacts.list: owner is a user id.');
  if (after !== undefined && (typeof after !== 'string' || after === '')) throw new TypeError("artifacts.list: after is the page before's next.");
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) throw new TypeError('artifacts.list: limit is a whole number from 1.');
  return { ...(owner !== undefined ? { owner } : {}), ...(after !== undefined ? { after } : {}), limit: Math.min(limit ?? ARTIFACT_LIST_DEFAULT, ARTIFACT_LIST_MAX) };
}

/** Everything `ctx.host.supports` answers true for on a host that runs all of API version 1. */
export const ALL_FEATURES: readonly string[] = [
  ...HOOK_NAMES,
  ...EVENT_NAMES.map((name) => `on.${name}`),
  ...GUARD_ACTIONS.map((name) => `guard.${name}`),
  ...CONTEXT_FEATURES,
];

/** Which kind of failure policy a hook has (decision: sign-in, permission and guard hooks fail closed). */
export function failsClosed(hook: string): boolean {
  return hook.startsWith('auth.') || hook.startsWith('authz.') || hook === 'guard';
}

// ---------------------------------------------------------------------------
// Limits

/** Each hook call's time limit unless the operator sets `timeoutMs`, ms. */
export const DEFAULT_TIMEOUT_MS = 5000;
/** The longest `timeoutMs` an operator may set, ms. */
export const MAX_TIMEOUT_MS = 60_000;
/** How long the host reuses a plugin's role answers unless it sets `authz.cacheSeconds`. */
export const DEFAULT_CACHE_SECONDS = 30;
/** The longest `authz.cacheSeconds` the host honours (a day). */
export const MAX_CACHE_SECONDS = 86_400;

/**
 * The key-value store's limits, per plugin. Keys up to 512 bytes (room for a prefix and an id or URL); values up to
 * 64 KiB of JSON (a cached answer or a queued webhook, well under every database's row limit, D1's 1 MB included);
 * 10,000 live keys (bounds what one plugin can put in the site's catalog: at most ~640 MB in the worst case, and
 * typically far less); a listing returns at most 1000 entries at a time.
 */
export const KV_LIMITS = { maxKeyBytes: 512, maxValueBytes: 64 * 1024, maxKeys: 10_000, maxList: 1000, defaultList: 100 } as const;

/** Lower-case letters, digits and single `-` between them; at most 64 characters. */
export const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_PLUGIN_ID = 64;

// ---------------------------------------------------------------------------
// Messages

/** `"x"` for a name in a message. */
const q = (name: string): string => JSON.stringify(name);

/** Edit distance, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length]!;
}

/** ` Did you mean "x"?` when a known name is close to `name`, else ``. */
export function didYouMean(name: string, known: readonly string[]): string {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of known) {
    const d = distance(name.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(name.length / 4)) ? ` Did you mean ${q(best)}?` : '';
}

/** What a value is, for a message, without showing it. */
export function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  switch (typeof value) {
    case 'string':
      return 'a string';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'true or false';
    case 'object':
      return 'an object';
    default:
      return typeof value;
  }
}

/** A short rendering of a non-secret value, for a message. */
function shown(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

/**
 * Why a plugin's `apiVersion` keeps it from running here, or null when it may run. The messages say what to do:
 * update the host for a newer version, update the plugin for one this host no longer runs.
 */
export function apiVersionProblem(label: string, version: unknown, hostVersion?: string): string | null {
  const host = hostVersion ? `this host (Open Artifact ${hostVersion})` : 'this host';
  const current = SUPPORTED_API_VERSIONS[0]!;
  if (version === undefined) return `${label} does not say which plugin API it was written for: add apiVersion: ${current} to the plugin object.`;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return `${label} has apiVersion ${shown(version)}, which is not a plugin API version: it should be ${current}.`;
  if (SUPPORTED_API_VERSIONS.includes(version)) return null;
  if (version > current) {
    return `${label} needs plugin API version ${version}, but ${host} runs version ${current}. Update Open Artifact to a release that runs plugin API ${version}, or use a release of the plugin written for API ${current}.`;
  }
  return `${label} was written for plugin API version ${version}, which ${host} no longer runs (it runs ${SUPPORTED_API_VERSIONS.join(', ')}). Update the plugin to a release written for API ${current}.`;
}

// ---------------------------------------------------------------------------
// The plugin object

/** A route, checked: its method, path segments and whether it is public. */
export interface CheckedRoute {
  method: string;
  path: string;
  segments: string[];
  public: boolean;
  /** Its index in the plugin's `routes`. */
  index: number;
}

/** A plugin object, checked: what the host and the test kit run. */
export interface CheckedPlugin {
  id: string;
  apiVersion: number;
  name: string;
  version: string | null;
  description: string | null;
  /** The object itself: hooks are called on it (`plugin.auth.authenticate(…)`, so `this` works in methods). */
  source: HostPlugin;
  schema: ConfigSchema;
  /** The hooks it has, by {@link HookName}. */
  hooks: HookName[];
  cacheSeconds: number;
  /** Whether a session `auth.authenticate` made is asked again on each request (`auth.recheck`, default true). */
  recheck: boolean;
  routes: CheckedRoute[];
  ui: { links: NonNullable<PluginUi['links']>; brand: NonNullable<PluginUi['brand']> | null };
}

/** {@link checkPlugin}'s answer: the plugin when it can run, why not (`errors`), and what was ignored (`warnings`). */
export interface PluginCheck {
  plugin: CheckedPlugin | null;
  errors: string[];
  warnings: string[];
}

const TOP_KEYS = ['id', 'apiVersion', 'name', 'version', 'description', 'config', 'validate', 'auth', 'authz', 'guard', 'on', 'wake', 'routes', 'ui'];
const AUTH_KEYS = ['authenticate', 'recheck', 'signIn', 'identity', 'signOutUrl'];
const SIGN_IN_KEYS = ['label', 'start', 'finish'];
const AUTHZ_KEYS = ['role', 'cacheSeconds', 'artifacts'];
const WAKE_KEYS = ['deliver'];
const ROUTE_KEYS = ['method', 'path', 'public', 'handler'];
const UI_KEYS = ['links', 'brand'];
const LINK_KEYS = ['label', 'href', 'where'];
const BRAND_KEYS = ['name', 'logoUrl'];
const FIELD_KEYS = ['type', 'required', 'default', 'description'];
const FIELD_TYPES: readonly ConfigFieldType[] = ['string', 'number', 'boolean', 'string[]', 'secret', 'map', 'json'];
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', '*'];
const SETTING_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFunction = (value: unknown): value is (...args: never[]) => unknown => typeof value === 'function';

/** Whether `href` is a link the host may show: an `https:`/`http:` URL, or a path on the site. */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== 'string' || href.length === 0 || href.length > 2048) return false;
  if (href.startsWith('/')) return !href.startsWith('//') && !href.startsWith('/\\');
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function checkSchema(label: string, value: unknown, errors: string[], warnings: string[]): ConfigSchema {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    errors.push(`${label}: config must be an object of settings ({name: {type, required?, default?, description?}}), not ${kindOf(value)}.`);
    return {};
  }
  const schema: Record<string, ConfigField> = {};
  for (const [name, field] of Object.entries(value)) {
    const where = `${label}, setting ${q(name)}`;
    if (!SETTING_NAME.test(name)) {
      errors.push(`${where}: a setting's name is letters, digits and _ (starting with a letter).`);
      continue;
    }
    if (!isRecord(field)) {
      errors.push(`${where}: must be {type, required?, default?, description?}, not ${kindOf(field)}.`);
      continue;
    }
    for (const key of Object.keys(field)) if (!FIELD_KEYS.includes(key)) warnings.push(`${where}: unknown key ${q(key)} ignored.${didYouMean(key, FIELD_KEYS)}`);
    if (!FIELD_TYPES.includes(field.type as ConfigFieldType)) {
      errors.push(`${where}: type must be one of ${FIELD_TYPES.join(', ')}.`);
      continue;
    }
    const type = field.type as ConfigFieldType;
    if (field.required !== undefined && typeof field.required !== 'boolean') errors.push(`${where}: required must be true or false.`);
    if (field.description !== undefined && typeof field.description !== 'string') errors.push(`${where}: description must be a string.`);
    if (field.default !== undefined && convert(type, field.default) === undefined) errors.push(`${where}: its default is not a ${type}.`);
    schema[name] = {
      type,
      ...(field.required === true ? { required: true } : {}),
      ...(field.default !== undefined ? { default: field.default as ConfigField['default'] } : {}),
      ...(typeof field.description === 'string' ? { description: field.description } : {}),
    };
  }
  return schema;
}

/** Records the unknown keys of `value` once, as warnings. */
function unknownKeys(where: string, value: Record<string, unknown>, known: readonly string[], warnings: string[]): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) warnings.push(`${where}: unknown ${q(key)} ignored (this host does not know it).${didYouMean(key, known)}`);
  }
}

/** Splits a route path into segments, or says why it is not one. */
function routeSegments(path: unknown): string[] | string {
  if (typeof path !== 'string' || !path.startsWith('/')) return 'its path must be a string starting with /';
  const segments = path.split('/').filter((s) => s !== '');
  const star = segments.indexOf('*');
  if (star !== -1 && star !== segments.length - 1) return "a '*' must end its path";
  for (const segment of segments) if (segment.startsWith(':') && segment.length === 1) return 'a parameter needs a name (:name)';
  return segments;
}

/**
 * Checks a plugin object (a module's default export). `label` names it in messages (the `use` of its entry).
 *
 * Refused (`errors`): not an object; a bad `id`; an `apiVersion` this host does not run; a hook that is not a
 * function where one must be; a bad config schema, route or UI link. Reported once and ignored (`warnings`): keys
 * and hooks this host does not know, at any level, and events it does not know under `on`.
 */
export function checkPlugin(value: unknown, label: string, options: { hostVersion?: string } = {}): PluginCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (isFunction(value)) return { plugin: null, errors: [`${label} exports a function: export the plugin object itself (export default {id, apiVersion, …}).`], warnings };
  if (!isRecord(value)) return { plugin: null, errors: [`${label} does not export a plugin: its default export is ${kindOf(value)}, not an object.`], warnings };

  const id = value.id;
  if (typeof id !== 'string' || !PLUGIN_ID.test(id) || id.length > MAX_PLUGIN_ID) {
    errors.push(`${label}: the plugin's id must be lower-case letters, digits and - (e.g. "acme-sso"), at most ${MAX_PLUGIN_ID} characters${typeof id === 'string' ? `, not ${q(id)}` : ''}.`);
  }
  const named = typeof id === 'string' && PLUGIN_ID.test(id) ? `Plugin ${q(id)}` : label;
  const apiProblem = apiVersionProblem(named, value.apiVersion, options.hostVersion);
  if (apiProblem) errors.push(apiProblem);
  unknownKeys(named, value, TOP_KEYS, warnings);

  for (const key of ['name', 'version', 'description'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') errors.push(`${named}: ${key} must be a string.`);
  }
  const schema = checkSchema(named, value.config, errors, warnings);
  if (value.validate !== undefined && !isFunction(value.validate)) errors.push(`${named}: validate must be a function, not ${kindOf(value.validate)}.`);
  const hooks: HookName[] = [];
  const mustBeFunction = (where: string, fn: unknown, hook: HookName): void => {
    if (fn === undefined) return;
    if (isFunction(fn)) hooks.push(hook);
    else errors.push(`${named}: ${where} must be a function, not ${kindOf(fn)}.`);
  };

  let recheck = true;
  if (value.auth !== undefined) {
    if (!isRecord(value.auth)) errors.push(`${named}: auth must be an object of hooks.`);
    else {
      unknownKeys(`${named}, auth`, value.auth, AUTH_KEYS, warnings);
      mustBeFunction('auth.authenticate', value.auth.authenticate, 'auth.authenticate');
      if (value.auth.recheck !== undefined) {
        if (typeof value.auth.recheck !== 'boolean') errors.push(`${named}: auth.recheck must be true or false.`);
        else recheck = value.auth.recheck;
      }
      if (value.auth.signIn !== undefined) {
        const signIn = value.auth.signIn;
        if (!isRecord(signIn)) errors.push(`${named}: auth.signIn must be {label, start, finish}.`);
        else {
          unknownKeys(`${named}, auth.signIn`, signIn, SIGN_IN_KEYS, warnings);
          if (typeof signIn.label !== 'string' || !signIn.label.trim() || signIn.label.length > 80) errors.push(`${named}: auth.signIn.label must be a button label (1-80 characters).`);
          if (!isFunction(signIn.start) || !isFunction(signIn.finish)) errors.push(`${named}: auth.signIn needs both start and finish functions.`);
          else hooks.push('auth.signIn');
        }
      }
      mustBeFunction('auth.identity', value.auth.identity, 'auth.identity');
      mustBeFunction('auth.signOutUrl', value.auth.signOutUrl, 'auth.signOutUrl');
    }
  }

  let cacheSeconds = DEFAULT_CACHE_SECONDS;
  if (value.authz !== undefined) {
    if (!isRecord(value.authz)) errors.push(`${named}: authz must be an object of hooks.`);
    else {
      unknownKeys(`${named}, authz`, value.authz, AUTHZ_KEYS, warnings);
      mustBeFunction('authz.role', value.authz.role, 'authz.role');
      mustBeFunction('authz.artifacts', value.authz.artifacts, 'authz.artifacts');
      const seconds = value.authz.cacheSeconds;
      if (seconds !== undefined) {
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) errors.push(`${named}: authz.cacheSeconds must be a number of seconds, 0 or more.`);
        else cacheSeconds = Math.min(Math.floor(seconds), MAX_CACHE_SECONDS);
      }
    }
  }

  mustBeFunction('guard', value.guard, 'guard');

  if (value.on !== undefined) {
    if (!isRecord(value.on)) errors.push(`${named}: on must be an object of event handlers ({'share.invited': handler}).`);
    else {
      for (const [event, handler] of Object.entries(value.on)) {
        if (!EVENT_NAMES.includes(event as PluginEventName)) {
          warnings.push(`${named}: unknown event ${q(event)} ignored (this host does not send it).${didYouMean(event, EVENT_NAMES)}`);
          continue;
        }
        mustBeFunction(`on[${q(event)}]`, handler, `on.${event as PluginEventName}`);
      }
    }
  }

  if (value.wake !== undefined) {
    if (!isRecord(value.wake)) errors.push(`${named}: wake must be {deliver}.`);
    else {
      unknownKeys(`${named}, wake`, value.wake, WAKE_KEYS, warnings);
      mustBeFunction('wake.deliver', value.wake.deliver, 'wake.deliver');
    }
  }

  const routes: CheckedRoute[] = [];
  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes)) errors.push(`${named}: routes must be a list of {method, path, handler, public?}.`);
    else {
      const seen = new Set<string>();
      value.routes.forEach((route: unknown, index) => {
        const where = `${named}, routes[${index}]`;
        if (!isRecord(route)) return void errors.push(`${where}: must be {method, path, handler, public?}.`);
        unknownKeys(where, route, ROUTE_KEYS, warnings);
        const method = typeof route.method === 'string' ? route.method.toUpperCase() : '';
        if (!METHODS.includes(method)) return void errors.push(`${where}: method must be one of ${METHODS.join(', ')}.`);
        const segments = routeSegments(route.path);
        if (typeof segments === 'string') return void errors.push(`${where}: ${segments}.`);
        if (!isFunction(route.handler)) return void errors.push(`${where}: handler must be a function.`);
        if (route.public !== undefined && typeof route.public !== 'boolean') return void errors.push(`${where}: public must be true or false.`);
        const key = `${method} /${segments.join('/')}`;
        if (seen.has(key)) warnings.push(`${where}: ${key} is already a route of this plugin; the first one answers.`);
        seen.add(key);
        routes.push({ method, path: `/${segments.join('/')}`, segments, public: route.public === true, index });
      });
      if (routes.length > 0) hooks.push('routes');
    }
  }

  const ui: CheckedPlugin['ui'] = { links: [], brand: null };
  if (value.ui !== undefined) {
    if (!isRecord(value.ui)) errors.push(`${named}: ui must be {links?, brand?}.`);
    else {
      unknownKeys(`${named}, ui`, value.ui, UI_KEYS, warnings);
      if (value.ui.links !== undefined) {
        if (!Array.isArray(value.ui.links)) errors.push(`${named}: ui.links must be a list of {label, href, where}.`);
        else
          value.ui.links.forEach((link: unknown, index) => {
            const where = `${named}, ui.links[${index}]`;
            if (!isRecord(link)) return void errors.push(`${where}: must be {label, href, where}.`);
            unknownKeys(where, link, LINK_KEYS, warnings);
            if (typeof link.label !== 'string' || !link.label.trim() || link.label.length > 80) return void errors.push(`${where}: label must be 1-80 characters.`);
            if (!isSafeHref(link.href)) return void errors.push(`${where}: href must be an https: or http: address, or a path starting with /.`);
            if (link.where !== 'account-menu' && link.where !== 'home') return void warnings.push(`${where}: where ${shown(link.where)} is not a place this host knows (account-menu, home); the link is not shown.`);
            ui.links.push({ label: link.label.trim(), href: link.href, where: link.where });
          });
      }
      if (value.ui.brand !== undefined) {
        const brand = value.ui.brand;
        if (!isRecord(brand)) errors.push(`${named}: ui.brand must be {name?, logoUrl?}.`);
        else {
          unknownKeys(`${named}, ui.brand`, brand, BRAND_KEYS, warnings);
          if (brand.name !== undefined && (typeof brand.name !== 'string' || brand.name.length > 80)) errors.push(`${named}: ui.brand.name must be a string of at most 80 characters.`);
          else if (brand.logoUrl !== undefined && !isSafeHref(brand.logoUrl)) errors.push(`${named}: ui.brand.logoUrl must be an https: or http: address, or a path starting with /.`);
          else {
            ui.brand = {
              ...(typeof brand.name === 'string' && brand.name.trim() ? { name: brand.name.trim() } : {}),
              ...(typeof brand.logoUrl === 'string' ? { logoUrl: brand.logoUrl } : {}),
            };
          }
        }
      }
      if (ui.links.length > 0 || ui.brand) hooks.push('ui');
    }
  }

  if (errors.length > 0) return { plugin: null, errors, warnings };
  return {
    plugin: {
      id: id as string,
      apiVersion: value.apiVersion as number,
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : (id as string),
      version: typeof value.version === 'string' ? value.version : null,
      description: typeof value.description === 'string' ? value.description : null,
      source: value as unknown as HostPlugin,
      schema,
      hooks,
      cacheSeconds,
      recheck,
      routes,
      ui,
    },
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Settings

/** A value converted to a field's type, or undefined when it is not one. Strings (from the environment) are parsed. */
function convert(type: ConfigFieldType, value: unknown, fromEnv = false): unknown {
  if (fromEnv && (type === 'map' || type === 'json') && typeof value === 'string') {
    try {
      return convert(type, JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  switch (type) {
    case 'map': {
      if (!isRecord(value)) return undefined;
      const map: Record<string, string> = {};
      for (const [key, v] of Object.entries(value)) {
        if (typeof v !== 'string') return undefined;
        map[key] = v;
      }
      return map;
    }
    case 'json':
      return isJson(value, 0) ? structuredCloneJson(value) : undefined;
    case 'string':
    case 'secret':
      return typeof value === 'string' ? value : undefined;
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
      if (fromEnv && typeof value === 'string' && value.trim() !== '') {
        const n = Number(value.trim());
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (fromEnv && typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(v)) return true;
        if (['false', '0', 'no', 'off'].includes(v)) return false;
      }
      return undefined;
    }
    case 'string[]': {
      if (Array.isArray(value)) return value.every((v) => typeof v === 'string') ? [...(value as string[])] : undefined;
      if (fromEnv && typeof value === 'string') {
        const text = value.trim();
        if (text.startsWith('[')) {
          try {
            return convert('string[]', JSON.parse(text));
          } catch {
            return undefined;
          }
        }
        return text.split(',').map((s) => s.trim()).filter((s) => s !== '');
      }
      return undefined;
    }
  }
}

/** What a field's type is called in a message. */
function typeWords(type: ConfigFieldType): string {
  switch (type) {
    case 'string':
    case 'secret':
      return 'a string';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'true or false';
    case 'string[]':
      return 'a list of strings';
    case 'map':
      return 'an object of strings ({"name": "value"})';
    case 'json':
      return 'a JSON value';
  }
}

/** Whether `value` is plain JSON (no functions, no cycles, at most 32 levels deep). */
function isJson(value: unknown, depth: number): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isJson(v, depth + 1));
  if (isRecord(value)) return Object.values(value).every((v) => isJson(v, depth + 1));
  return false;
}

/** A deep copy of a JSON value, so a plugin cannot change the operator's configuration under the host. */
function structuredCloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** {@link validateConfig}'s answer. `secrets` are the secret values in `config`, for the host to blank out of its log. */
export interface ConfigCheck {
  config: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  secrets: string[];
}

/**
 * The operator's settings for a plugin, checked against its schema:
 *
 * - every value of the right type (a `{"env": "NAME"}` value is read from `env` and parsed: numbers, `true`/`false`,
 *   a JSON list or a comma-separated one); a variable that is not set (or empty) is an error naming the plugin, the
 *   setting and the variable;
 * - required settings present (an empty string does not count); defaults filled in;
 * - a setting the schema does not have is an error (a typo must not pass silently), with a suggestion;
 * - a `secret` written into the configuration instead of `{"env": …}` is a warning.
 *
 * No message ever shows a secret's value, nor the value of a setting it does not know (it may be a mistyped secret).
 */
export function validateConfig(pluginId: string, schema: ConfigSchema, values: unknown, env: Readonly<Record<string, string | undefined>> = {}): ConfigCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const secrets: string[] = [];
  const config: Record<string, unknown> = {};
  const label = `Plugin ${q(pluginId)}`;
  const names = Object.keys(schema);
  if (values !== undefined && values !== null && !isRecord(values)) {
    return { config, errors: [`${label}: config must be an object of settings, not ${kindOf(values)}.`], warnings, secrets };
  }
  const given = (values ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(given)) {
    if (!(name in schema)) {
      errors.push(
        names.length === 0
          ? `${label} takes no settings, but the configuration sets ${q(name)}.`
          : `${label}: unknown setting ${q(name)}.${didYouMean(name, names)} Its settings are: ${names.join(', ')}.`,
      );
    }
  }
  for (const [name, field] of Object.entries(schema)) {
    const where = `${label}, setting ${q(name)}`;
    const about = field.description ? ` (${field.description})` : '';
    let raw = given[name];
    let fromEnv = false;
    let variable: string | undefined;
    if (isRecord(raw) && 'env' in raw) {
      const keys = Object.keys(raw);
      if (keys.length !== 1 || typeof raw.env !== 'string' || !ENV_NAME.test(raw.env)) {
        errors.push(`${where}: an environment reference is {"env": "NAME"}, with NAME letters, digits and _.`);
        continue;
      }
      variable = raw.env;
      const read = env[variable];
      if (read === undefined || read === '') {
        errors.push(`${where}: the environment variable ${variable} is not set.`);
        continue;
      }
      raw = read;
      fromEnv = true;
    } else if (raw !== undefined && field.type === 'secret') {
      warnings.push(`${where}: the secret is written into the configuration; give it as {"env": "NAME"} to keep it out of the file.`);
    }
    if (raw === undefined || raw === null) {
      if (field.default !== undefined) config[name] = convert(field.type, field.default);
      else if (field.required) errors.push(`${where} is required${about}.`);
      continue;
    }
    const value = convert(field.type, raw, fromEnv);
    if (value === undefined) {
      const source = variable ? `the environment variable ${variable} holds` : 'got';
      const what = field.type === 'secret' || fromEnv ? (fromEnv ? 'something else' : kindOf(raw)) : `${kindOf(raw)} ${shown(raw)}`;
      errors.push(`${where}: expected ${typeWords(field.type)}, ${source} ${what}.`);
      continue;
    }
    if (field.required && (value === '' || (Array.isArray(value) && value.length === 0) || (field.type === 'map' && isRecord(value) && Object.keys(value).length === 0))) {
      errors.push(`${where} is required${about}, and it is empty.`);
      continue;
    }
    if (field.type === 'secret' && typeof value === 'string' && value !== '') secrets.push(value);
    config[name] = value;
  }
  return { config: Object.freeze(config), errors, warnings, secrets };
}

/** Replaces every secret in `text` with `[secret]`. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret.length >= 4) out = out.split(secret).join('[secret]');
  return out;
}

// ---------------------------------------------------------------------------
// Answers

const ROLES: readonly ArtifactRole[] = ['owner', 'editor', 'commenter', 'viewer'];

/** Whether a value is an artifact role. */
export function isArtifactRole(value: unknown): value is ArtifactRole {
  return typeof value === 'string' && ROLES.includes(value as ArtifactRole);
}

const LIMITS = { subject: 256, email: 320, name: 200, avatar: 2048, groups: 200, group: 200 };

/** An identity a plugin answered, cleaned (unknown fields dropped), or null when it is not one. */
export function checkIdentity(value: unknown): Identity | null {
  if (!isRecord(value)) return null;
  const { subject, email, emailVerified, name, avatar, groups } = value;
  if (typeof subject !== 'string' || subject.length === 0 || subject.length > LIMITS.subject) return null;
  if (email !== undefined && (typeof email !== 'string' || email.length > LIMITS.email || (email !== '' && !email.includes('@')))) return null;
  if (emailVerified !== undefined && typeof emailVerified !== 'boolean') return null;
  if (name !== undefined && (typeof name !== 'string' || name.length > LIMITS.name)) return null;
  if (avatar !== undefined && (typeof avatar !== 'string' || avatar.length > LIMITS.avatar)) return null;
  if (groups !== undefined && (!Array.isArray(groups) || groups.length > LIMITS.groups || !groups.every((g) => typeof g === 'string' && g.length > 0 && g.length <= LIMITS.group))) return null;
  return {
    subject,
    ...(typeof email === 'string' && email !== '' ? { email } : {}),
    ...(emailVerified !== undefined ? { emailVerified } : {}),
    ...(typeof name === 'string' && name !== '' ? { name } : {}),
    ...(typeof avatar === 'string' && avatar !== '' ? { avatar } : {}),
    ...(groups !== undefined ? { groups: [...(groups as string[])] } : {}),
  };
}

/** A sentence a plugin gave (a refusal, a denial), trimmed and cut to 500 characters, or null when it is not one. */
export function checkSentence(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? (text.length > 500 ? `${text.slice(0, 497)}...` : text) : null;
}

/** Whether a value is a `Response` (also one made by another copy of the Fetch API). */
export function isResponse(value: unknown): value is Response {
  if (value instanceof Response) return true;
  return isRecord(value) && typeof value.status === 'number' && value.headers instanceof Headers && 'body' in value && typeof value.arrayBuffer === 'function';
}

/** The path to return to after a sign-in: a path on the site, else `/`. */
export function safePath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}

// ---------------------------------------------------------------------------
// Time limits

/** How a hook call ended: its value, or why not. */
export type CallOutcome<T> = { ok: true; value: T } | { ok: false; reason: 'threw' | 'timeout'; error: unknown };

/**
 * Runs `fn` with a time limit: the outcome of the call, or `timeout` when it takes longer than `ms`. `controller`
 * is aborted at the limit (the hook's `ctx.signal`). A hook that hangs keeps running in the background; nobody
 * waits for it.
 */
export async function withTimeLimit<T>(fn: () => T | Promise<T>, ms: number, controller?: AbortController): Promise<CallOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<CallOutcome<T>>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort(new Error(`the hook took longer than ${ms} ms`));
      resolve({ ok: false, reason: 'timeout', error: new Error(`took longer than ${ms} ms`) });
    }, ms);
  });
  const run = (async (): Promise<CallOutcome<T>> => {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      return { ok: false, reason: 'threw', error };
    }
  })();
  try {
    return await Promise.race([run, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** A failure's message for the log. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Routes and writes

/** The parameters of `path` under a route's segments, or null when it does not match. */
export function matchRoute(segments: readonly string[], path: readonly string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const want = segments[i]!;
    if (want === '*') {
      params['*'] = path.slice(i).join('/');
      return params;
    }
    const got = path[i];
    if (got === undefined) return null;
    if (want.startsWith(':')) {
      try {
        params[want.slice(1)] = decodeURIComponent(got);
      } catch {
        return null;
      }
    } else if (want !== got) {
      return null;
    }
  }
  return path.length === segments.length ? params : null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The host's same-origin rule for writes, as it applies to plugin routes that are not `public`: reads always pass;
 * a write passes with `Sec-Fetch-Site: same-origin` (or `none` without cookies), or, from a client that sends no
 * `Sec-Fetch-Site`, with no `Origin` or the site's own.
 */
export function isSameOriginWrite(request: Request, appOrigin: string): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) {
    const value = site.trim().toLowerCase();
    if (value === 'same-origin') return true;
    return value === 'none' && !request.headers.has('cookie');
  }
  const origin = request.headers.get('origin');
  return origin === null || origin === appOrigin;
}

// ---------------------------------------------------------------------------
// The key-value store

/** The UTF-8 length of a string. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Checks a key; throws a `TypeError` the plugin sees. */
export function checkKvKey(key: unknown): string {
  if (typeof key !== 'string' || key.length === 0) throw new TypeError('kv: a key is a non-empty string.');
  if (byteLength(key) > KV_LIMITS.maxKeyBytes) throw new TypeError(`kv: a key is at most ${KV_LIMITS.maxKeyBytes} bytes.`);
  return key;
}

/** A value as stored (JSON); throws a `TypeError` the plugin sees. */
export function encodeKvValue(value: unknown): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`kv: the value cannot be stored as JSON (${messageOf(error)}).`);
  }
  if (text === undefined) throw new TypeError('kv: the value cannot be stored as JSON (use null, not undefined).');
  if (byteLength(text) > KV_LIMITS.maxValueBytes) throw new TypeError(`kv: a value is at most ${KV_LIMITS.maxValueBytes} bytes of JSON.`);
  return text;
}

/** When a value set now with `ttlSeconds` expires (ISO-8601), or null; throws a `TypeError` for a bad TTL. */
export function kvExpiry(now: Date, ttlSeconds: unknown): string | null {
  if (ttlSeconds === undefined) return null;
  if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new TypeError('kv: ttlSeconds is a number of seconds above 0.');
  return new Date(now.getTime() + Math.ceil(ttlSeconds * 1000)).toISOString();
}

/** A listing's limit: default 100, at most 1000. */
export function kvListLimit(limit: unknown): number {
  if (limit === undefined) return KV_LIMITS.defaultList;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) throw new TypeError('kv: limit is a whole number above 0.');
  return Math.min(limit, KV_LIMITS.maxList);
}

/** The error for a store that is full. */
export function kvFull(): Error {
  return new RangeError(`kv: this plugin already keeps ${KV_LIMITS.maxKeys} keys; delete some (or give them a ttlSeconds) first.`);
}

// ---------------------------------------------------------------------------
// Running a hook

/** An answer, checked: what it means, or why it is of the wrong shape. */
export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** How a hook call ended, its answer checked: `shape` when the answer is not one the hook may give. */
export type HookOutcome<T> = { ok: true; value: T } | { ok: false; reason: 'threw' | 'timeout' | 'shape'; message: string; error?: unknown };

/** Calls a hook under its time limit and checks its answer. Never throws. */
export async function runHook<T>(fn: () => unknown, check: (answer: unknown) => Checked<T>, ms: number, controller?: AbortController): Promise<HookOutcome<T>> {
  const outcome = await withTimeLimit(fn, ms, controller);
  if (!outcome.ok) return { ok: false, reason: outcome.reason, message: messageOf(outcome.error), error: outcome.error };
  const checked = check(outcome.value);
  return checked.ok ? checked : { ok: false, reason: 'shape', message: checked.message };
}

const good = <T>(value: T): Checked<T> => ({ ok: true, value });
const bad = (message: string): Checked<never> => ({ ok: false, message });

/**
 * The answer check of every hook: what an answer means, or why it is not one the hook may give. An answer of the
 * wrong shape is a failure (closed or open by the hook's kind, see {@link failsClosed}).
 */
export const answers = {
  /** `auth.authenticate`: an identity, or null (nothing: null too). */
  authenticate(answer: unknown): Checked<Identity | null> {
    if (answer === undefined || answer === null) return good(null);
    const identity = checkIdentity(answer);
    return identity ? good(identity) : bad('answered something that is not an identity ({subject, email?, emailVerified?, name?, avatar?, groups?}) or null');
  },
  /** `auth.signIn.start`: a Response. */
  signInStart(answer: unknown): Checked<Response> {
    return isResponse(answer) ? good(answer) : bad('must answer a Response (usually a redirect)');
  },
  /** `auth.signIn.finish`: `{identity, returnTo?}` (returnTo made a path on the site). */
  signInFinish(answer: unknown): Checked<{ identity: Identity; returnTo?: string }> {
    if (!isRecord(answer)) return bad('must answer {identity, returnTo?}');
    const identity = checkIdentity(answer.identity);
    if (!identity) return bad('answered {identity} with something that is not an identity');
    if (answer.returnTo !== undefined && typeof answer.returnTo !== 'string') return bad('answered a returnTo that is not a string');
    return good({ identity, ...(answer.returnTo !== undefined ? { returnTo: safePath(answer.returnTo) } : {}) });
  },
  /** `auth.identity`: the same person (same `subject`) changed, `{reject}`, or nothing (`keep`). */
  identity(answer: unknown, subject: string): Checked<{ keep: true } | { identity: Identity } | { reject: string }> {
    if (answer === undefined || answer === null) return good({ keep: true });
    if (isRecord(answer) && 'reject' in answer) {
      const sentence = checkSentence(answer.reject);
      return sentence ? good({ reject: sentence }) : bad('answered {reject} without a sentence');
    }
    const identity = checkIdentity(answer);
    if (!identity) return bad('answered something that is not an identity, {reject: sentence} or nothing');
    if (identity.subject !== subject) return bad('changed the identity\'s subject, which it may not (it would sign the person in as someone else)');
    return good({ identity });
  },
  /** `auth.signOutUrl`: an `https:`/`http:` URL or a path, or nothing (null). */
  signOutUrl(answer: unknown): Checked<string | null> {
    if (answer === undefined || answer === null) return good(null);
    return isSafeHref(answer) ? good(answer) : bad('answered something that is not an https: or http: address or a path');
  },
  /** `authz.role`: a role, null (no access), or nothing (`opinion: false`). */
  role(answer: unknown): Checked<{ opinion: false } | { opinion: true; role: ArtifactRole | null }> {
    if (answer === undefined) return good({ opinion: false });
    if (answer === null) return good({ opinion: true, role: null });
    return isArtifactRole(answer) ? good({ opinion: true, role: answer }) : bad(`answered ${shown(answer)}, which is not a role (owner, editor, commenter, viewer), null or nothing`);
  },
  /** `authz.artifacts`: artifact ids (nothing: none). */
  artifacts(answer: unknown): Checked<string[]> {
    if (answer === undefined || answer === null) return good([]);
    if (!Array.isArray(answer) || !answer.every((id) => typeof id === 'string')) return bad('must answer a list of artifact ids (strings)');
    if (answer.length > 10_000) return bad('answered more than 10000 artifact ids');
    return good([...new Set(answer as string[])]);
  },
  /** `guard`: nothing (allowed) or `{deny: sentence}`. */
  guard(answer: unknown): Checked<{ deny: string } | null> {
    if (answer === undefined || answer === null) return good(null);
    if (isRecord(answer) && 'deny' in answer) {
      const sentence = checkSentence(answer.deny);
      return sentence ? good({ deny: sentence }) : bad('answered {deny} without a sentence');
    }
    return bad('must answer nothing (allowed) or {deny: sentence}');
  },
  /** `wake.deliver`: `{delivered: true}` (true), or nothing (false). */
  deliver(answer: unknown): Checked<boolean> {
    if (answer === undefined || answer === null) return good(false);
    if (isRecord(answer) && answer.delivered === true) return good(true);
    if (isRecord(answer) && answer.delivered === false) return good(false);
    return bad('must answer {delivered: true} or nothing');
  },
  /** A route handler: a Response. */
  route(answer: unknown): Checked<Response> {
    return isResponse(answer) ? good(answer) : bad('must answer a Response');
  },
  /** An event handler: anything (its answer is not used). */
  event(): Checked<null> {
    return good(null);
  },
} as const;

/** Whether an error is the plugin API's `HttpError` (also from another copy of this package): a route's chosen status. */
export function httpErrorOf(error: unknown): { status: number; message: string } | null {
  if (!(error instanceof Error) || error.name !== 'HttpError') return null;
  const status = (error as Error & { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status <= 599 ? { status, message: error.message } : null;
}

/**
 * Runs a plugin's `validate(config)` the way every host does: once, after {@link validateConfig} passed. Returns the
 * problems, each naming the plugin (`Plugin "acme": …`); an exception counts as one problem with its message.
 */
export function runValidate(plugin: CheckedPlugin, config: Readonly<Record<string, unknown>>): string[] {
  const validate = plugin.source.validate;
  if (typeof validate !== 'function') return [];
  const label = `Plugin ${q(plugin.id)}`;
  let answer: unknown;
  try {
    answer = validate.call(plugin.source, config);
  } catch (error) {
    return [`${label}: ${messageOf(error)}`];
  }
  if (answer === undefined || answer === null) return [];
  if (typeof answer === 'string') return answer.trim() ? [`${label}: ${answer.trim()}`] : [];
  if (Array.isArray(answer)) return answer.filter((m): m is string => typeof m === 'string' && m.trim() !== '').map((m) => `${label}: ${m.trim()}`);
  if (typeof (answer as { then?: unknown }).then === 'function') return [`${label}: validate must answer at once (it returned a promise); check settings without waiting.`];
  return [`${label}: validate answered ${kindOf(answer)}; it returns nothing, a sentence or a list of sentences.`];
}
