/**
 * Harness profiles: what the daemon knows about a harness before (and beside) what its adapter says.
 *
 * Three places, in order of precedence:
 *
 *   1. the person's own file, `<open-artifact home>/harnesses/<name>.json` without `source` or with `source: "user"`
 *      (`open-artifact harness add`): it replaces the shipped profile;
 *   2. what the harness's adapter reported in `hello` (`profile`), saved to the same path with `source: "adapter"`: it
 *      is laid over the shipped profile, and never overwrites a file of the person's;
 *   3. the profile shipped with the daemon (`harnesses/` beside `src/`).
 *
 * An adapter's profile is data only: whatever could make the daemon run a command (`nudge`, `mcp`), write somewhere
 * (`skillsDir`) or read its files (`sessionWorkspace`) is dropped, and so is every field that does not have the expected shape.
 */

import { readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HARNESS_NAME,
  OpenArtifactError,
  PROFILE_RULES_MAX,
  TOOL_SCHEMAS,
  type ActionKind,
  type AdapterCaps,
  type HarnessNudge,
  type HarnessPolicy,
  type HarnessProfile,
  type HarnessProfileSource,
  type HookDialect,
  type SessionMay,
  type SessionWorkspaceName,
} from '@open-artifact/protocol';
import { codexThreadWorkspace } from './codex.ts';
import { files, readJson, writeJson } from './paths.ts';

/**
 * The profiles shipped with the daemon: `$OPEN_ARTIFACT_HARNESS_PROFILES`, else
 * `harnesses/` beside `src/`.
 */
export function shippedProfilesDir(): string {
  return process.env.OPEN_ARTIFACT_HARNESS_PROFILES || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'harnesses');
}

/** The profile of a harness nobody described: a plain MCP client. */
export function defaultProfile(name: string): HarnessProfile {
  return { name, title: name, agentName: 'Agent', level: 'L1', entry: 'mcp', wake: ['inbox'] };
}

/** A profile file's content, or `null` when there is none (or it is not an object). */
function readProfile(file: string): Partial<HarnessProfile> | null {
  const found = readJson<Partial<HarnessProfile> | null>(file, null);
  return found && typeof found === 'object' && !Array.isArray(found) ? found : null;
}

/** Where a harness's profile of the person (or of its adapter) lives. */
export function homeProfileFile(name: string): string {
  return join(files.harnesses(), `${name}.json`);
}

/**
 * A harness's profile: the person's own file, else the adapter-reported one laid over the shipped one, else the
 * shipped one, else {@link defaultProfile}. `source` says which.
 */
export function harnessProfile(name: string): HarnessProfile {
  if (!HARNESS_NAME.test(name)) return defaultProfile(name);
  const own = readProfile(homeProfileFile(name));
  const shipped = readProfile(join(shippedProfilesDir(), `${name}.json`));
  if (own && own.source !== 'adapter') return { ...defaultProfile(name), ...own, name, source: 'user' };
  if (own) {
    // Checked again on the way in: the file may have been edited since it was saved.
    const reported = sanitizeAdapterProfile(own).profile;
    return { ...defaultProfile(name), ...shipped, ...reported, name, source: 'adapter' };
  }
  if (shipped) return { ...defaultProfile(name), ...shipped, name, source: 'shipped' };
  return defaultProfile(name);
}

// ---- adapter profiles ----------------------------------------------------------------------------------------------

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const COMMAND_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const TOOL_ALIAS = /^[A-Za-z0-9_.-]{1,64}$/;
const HOOK_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop']);
const HOOK_DIALECTS = new Set(['claude-code', 'cursor', 'copilot', 'antigravity']);
const ACTION_KINDS = new Set<ActionKind>(['read', 'write', 'ui', 'remove', 'person']);
/** Fields an adapter may never set. */
const NEVER_FROM_ADAPTER = new Set(['nudge', 'mcp', 'skillsDir', 'sessionWorkspace', 'source', 'name']);
/** At most this many entries in each list an adapter reports. */
const LIST_MAX = 32;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const shortString = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const stringList = (value: unknown, pattern: RegExp): value is string[] =>
  Array.isArray(value) && value.length <= LIST_MAX && value.every((item) => typeof item === 'string' && pattern.test(item));

function validCaps(value: unknown): AdapterCaps | null {
  if (!isObject(value)) return null;
  const caps: AdapterCaps = {};
  for (const [key, field] of Object.entries(value)) {
    switch (key) {
      case 'wake':
        if (!isObject(field)) return null;
        if (field.resume !== undefined && typeof field.resume !== 'boolean') return null;
        if (field.mode !== undefined && field.mode !== 'auto' && field.mode !== 'draft') return null;
        caps.wake = { ...(field.resume !== undefined ? { resume: field.resume as boolean } : {}), ...(field.mode ? { mode: field.mode as 'auto' | 'draft' } : {}) };
        break;
      case 'open':
        if (typeof field === 'boolean') caps.open = field;
        else if (isObject(field) && (field.embed === 'frame' || field.embed === 'view') && stringList(field.origins, /^[a-z][a-z0-9+.-]*:\/\/[^\s/]+$/i)) {
          caps.open = { embed: field.embed, origins: [...field.origins], ...(field.remote === 'allow' || field.remote === 'ask' || field.remote === 'deny' ? { remote: field.remote } : {}) };
        } else return null;
        break;
      case 'agentName':
        if (!shortString(field, 100)) return null;
        caps.agentName = field;
        break;
      case 'tools':
        if (field !== 'cli' && field !== 'mcp' && field !== 'native') return null;
        caps.tools = field;
        break;
      case 'commands':
        if (!isObject(field) || !stringList(field.names, COMMAND_NAME) || (field.menu !== undefined && typeof field.menu !== 'boolean')) return null;
        caps.commands = { names: [...field.names], ...(field.menu !== undefined ? { menu: field.menu as boolean } : {}) };
        break;
      case 'library':
        if (field !== 'home' && field !== 'cards' && field !== 'own') return null;
        caps.library = field;
        break;
      default:
        return null;
    }
  }
  return caps;
}

function validMay(value: unknown): SessionMay | null {
  if (!isObject(value)) return null;
  const may: SessionMay = {};
  for (const [key, field] of Object.entries(value)) {
    if (!['create', 'modify', 'remove', 'reply'].includes(key) || typeof field !== 'boolean') return null;
    may[key as keyof SessionMay] = field;
  }
  return may;
}

function validPolicy(value: unknown): HarnessPolicy | null {
  if (!isObject(value)) return null;
  const policy: HarnessPolicy = {};
  for (const [key, field] of Object.entries(value)) {
    switch (key) {
      case 'offer':
        if (field !== 'asked' && field !== 'allowed') return null;
        policy.offer = field;
        break;
      case 'reuse':
        if (field !== 'workspace' && field !== 'session' && field !== 'none') return null;
        policy.reuse = field;
        break;
      case 'roles': {
        if (!isObject(field) || Object.keys(field).length > LIST_MAX) return null;
        const roles: Record<string, SessionMay> = {};
        for (const [role, may] of Object.entries(field)) {
          const valid = COMMAND_NAME.test(role) ? validMay(may) : null;
          if (!valid) return null;
          roles[role] = valid;
        }
        policy.roles = roles;
        break;
      }
      case 'confirm':
        if (!Array.isArray(field) || !field.every((kind) => ACTION_KINDS.has(kind as ActionKind))) return null;
        policy.confirm = [...new Set(field as ActionKind[])];
        break;
      default:
        return null;
    }
  }
  return policy;
}

function validHookDialect(value: unknown): HarnessProfile['hookDialect'] | null {
  if (typeof value === 'string') return HOOK_DIALECTS.has(value) ? (value as HarnessProfile['hookDialect']) : null;
  if (!isObject(value) || !isObject(value.events) || !isObject(value.answer)) return null;
  const events = Object.entries(value.events);
  if (events.length > LIST_MAX || !events.every(([name, event]) => shortString(name, 64) && HOOK_EVENTS.has(event as string))) return null;
  const answers = Object.entries(value.answer);
  if (answers.length > LIST_MAX) return null;
  for (const [name, answer] of answers) {
    if (!shortString(name, 64) || !isObject(answer) || !shortString(answer.field, 64)) return null;
    if (answer.wrap !== undefined && !isObject(answer.wrap)) return null;
  }
  const names = /^[A-Za-z0-9_.-]{1,64}$/;
  if (value.session !== undefined && !stringList(value.session, names)) return null;
  if (value.workspace !== undefined && !stringList(value.workspace, names)) return null;
  return value as unknown as HookDialect;
}

/** Checks one field of an adapter's profile: the field as kept, or `undefined` to drop it. */
function validField(key: string, value: unknown): unknown {
  switch (key) {
    case 'title':
    case 'agentName':
      return shortString(value, 100) ? value : undefined;
    case 'plugin':
      return shortString(value, 214) ? value : undefined;
    case 'level':
      return value === 'L1' || value === 'L2' || value === 'L3' ? value : undefined;
    case 'entry':
      return value === 'harness-api' || value === 'mcp' || value === 'mod' ? value : undefined;
    case 'sessionEnv':
      return typeof value === 'string' && ENV_NAME.test(value) ? value : undefined;
    case 'wake':
      return Array.isArray(value) && value.length <= 2 && value.every((route) => route === 'live' || route === 'inbox') ? [...new Set(value)] : undefined;
    case 'wakesIdle':
      return typeof value === 'boolean' ? value : undefined;
    case 'open':
      return value === 'browser' ? value : undefined;
    case 'markers':
      return stringList(value, ENV_NAME) ? [...value] : undefined;
    case 'hookDialect':
      return validHookDialect(value) ?? undefined;
    case 'caps':
      return validCaps(value) ?? undefined;
    case 'policy':
      return validPolicy(value) ?? undefined;
    case 'rules':
      return typeof value === 'string' && value.length <= PROFILE_RULES_MAX ? value : undefined;
    case 'commands':
      return stringList(value, COMMAND_NAME) ? [...value] : undefined;
    case 'toolNames': {
      if (!isObject(value)) return undefined;
      const entries = Object.entries(value);
      return entries.every(([tool, alias]) => tool in TOOL_SCHEMAS && typeof alias === 'string' && TOOL_ALIAS.test(alias)) ? { ...value } : undefined;
    }
    default:
      return undefined;
  }
}

/** A profile's `nudge` with the expected shape (see {@link HarnessNudge}), or `null`. */
export function validNudge(value: unknown): HarnessNudge | null {
  if (!isObject(value)) return null;
  const { command, args, env, envFile } = value;
  const program = (item: unknown): boolean =>
    (typeof item === 'string' && item.length > 0 && item.length <= 1024) ||
    (Array.isArray(item) && item.length > 0 && item.length <= LIST_MAX && item.every((part) => typeof part === 'string' && part.length <= 1024) && item[0] !== '');
  if (typeof command === 'string' ? !program(command) : !Array.isArray(command) || !command.length || command.length > LIST_MAX || !command.every(program)) return null;
  if (!Array.isArray(args) || args.length > 64 || !args.every((arg) => typeof arg === 'string' && arg.length <= 4096)) return null;
  if (env !== undefined && (!isObject(env) || Object.keys(env).length > LIST_MAX || !Object.entries(env).every(([name, v]) => ENV_NAME.test(name) && typeof v === 'string' && v.length <= 1024))) {
    return null;
  }
  if (envFile !== undefined) {
    if (!isObject(envFile) || !shortString(envFile.dir, 1024) || !shortString(envFile.pattern, 200) || (envFile.pid !== undefined && !shortString(envFile.pid, 64))) return null;
    try {
      new RegExp(envFile.pattern);
    } catch {
      return null;
    }
  }
  return {
    command: typeof command === 'string' ? command : (command as Array<string | string[]>).map((item) => (Array.isArray(item) ? [...item] : item)),
    args: [...(args as string[])],
    ...(env ? { env: { ...(env as Record<string, string>) } } : {}),
    ...(envFile ? { envFile: { dir: envFile.dir as string, pattern: envFile.pattern as string, ...(envFile.pid ? { pid: envFile.pid as string } : {}) } } : {}),
  };
}

/**
 * The command that wakes an idle session of a harness (`nudge`): from the person's own profile file when there is
 * one, else from the shipped one. Never from a profile an adapter reported (`source: "adapter"`): one found there is
 * ignored, and said in `log`. `null` when there is none, or it does not have the expected shape.
 */
export function nudgeOf(name: string, log?: (line: string) => void): HarnessNudge | null {
  if (!HARNESS_NAME.test(name)) return null;
  const own = readProfile(homeProfileFile(name));
  if (own && own.source !== 'adapter') return own.nudge === undefined ? null : validNudge(own.nudge);
  if (own?.nudge !== undefined) log?.(`harness ${name}: the profile its adapter reported has a nudge, which is never run`);
  const shipped = readProfile(join(shippedProfilesDir(), `${name}.json`));
  return shipped?.nudge === undefined ? null : validNudge(shipped.nudge);
}

/** How each named {@link SessionWorkspaceName} finds a session's folder. */
const SESSION_WORKSPACES: Record<SessionWorkspaceName, (session: string) => string | null> = {
  'codex-rollout': (session) => codexThreadWorkspace(session),
};

/**
 * How a harness finds a session's folder when nothing said it (`sessionWorkspace`): like {@link nudgeOf}, only from the
 * person's own profile file or the shipped one, never from what an adapter reported. `null`: it has none.
 */
export function sessionWorkspaceOf(name: string): ((session: string) => string | null) | null {
  if (!HARNESS_NAME.test(name)) return null;
  const own = readProfile(homeProfileFile(name));
  const chosen = own && own.source !== 'adapter' ? own.sessionWorkspace : readProfile(join(shippedProfilesDir(), `${name}.json`))?.sessionWorkspace;
  return typeof chosen === 'string' && Object.hasOwn(SESSION_WORKSPACES, chosen) ? SESSION_WORKSPACES[chosen as SessionWorkspaceName] : null;
}

/**
 * What the daemon keeps of a profile an adapter reported: the fields with the expected shape, never one that could
 * run a command or name a place to write. `dropped` names what was left out.
 */
export function sanitizeAdapterProfile(raw: unknown): { profile: Partial<HarnessProfile>; dropped: string[] } {
  const profile: Record<string, unknown> = {};
  const dropped: string[] = [];
  if (!isObject(raw)) return { profile, dropped: raw === undefined ? [] : ['(not an object)'] };
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (key === 'source' || key === 'name') continue;
    const kept = NEVER_FROM_ADAPTER.has(key) ? undefined : validField(key, value);
    if (kept === undefined) dropped.push(key);
    else profile[key] = kept;
  }
  return { profile: profile as Partial<HarnessProfile>, dropped };
}

/**
 * Saves the profile an adapter reported in `hello` to `<home>/harnesses/<name>.json` with `source: "adapter"`: only
 * the fields {@link sanitizeAdapterProfile} keeps, only when it changed, and never over a file of the person's.
 * Returns what happened, for the log.
 */
export function saveAdapterProfile(name: string, raw: unknown): { saved: boolean; reason?: 'unchanged' | 'user_file' | 'empty' | 'invalid_name'; dropped: string[] } {
  if (!HARNESS_NAME.test(name)) return { saved: false, reason: 'invalid_name', dropped: [] };
  const { profile, dropped } = sanitizeAdapterProfile(raw);
  if (!Object.keys(profile).length) return { saved: false, reason: 'empty', dropped };
  const file = homeProfileFile(name);
  const existing = readProfile(file);
  if (existing && existing.source !== 'adapter') return { saved: false, reason: 'user_file', dropped };
  const next = { name, source: 'adapter' as HarnessProfileSource, ...profile };
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) return { saved: false, reason: 'unchanged', dropped };
  writeJson(file, next);
  return { saved: true, dropped };
}

// ---- the person's profiles (`open-artifact harness …`) -------------------------------------------------------------

/** One profile as `open-artifact harness list` shows it. */
export interface ProfileListing {
  name: string;
  title: string;
  /** Where the profile in effect comes from. */
  source: HarnessProfileSource;
  /** Its file. */
  file: string;
  /** The shipped profile it replaces or is laid over, when there is one. */
  shipped: boolean;
}

/** Profile names in a folder. */
function profileNames(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
      .filter((name) => HARNESS_NAME.test(name));
  } catch {
    return [];
  }
}

/** Every harness with a profile: shipped, reported by an adapter, or the person's. */
export function listProfiles(): ProfileListing[] {
  const shipped = new Set(profileNames(shippedProfilesDir()));
  const names = [...new Set([...shipped, ...profileNames(files.harnesses())])].sort();
  return names.map((name) => {
    const profile = harnessProfile(name);
    const source = profile.source ?? 'shipped';
    return {
      name,
      title: profile.title,
      source,
      file: source === 'shipped' ? join(shippedProfilesDir(), `${name}.json`) : homeProfileFile(name),
      shipped: shipped.has(name),
    };
  });
}

/**
 * Adds the person's own profile (`open-artifact harness add`): `raw` must be an object with a harness `name`. It is
 * saved with `source: "user"` and replaces the shipped and the adapter-reported profile. Returns its file.
 */
export function addUserProfile(raw: unknown): { name: string; file: string; replaced: HarnessProfileSource | null } {
  if (!isObject(raw)) throw new OpenArtifactError('invalid_argument', 'A profile is a JSON object.');
  const name = raw.name;
  if (typeof name !== 'string' || !HARNESS_NAME.test(name)) {
    throw new OpenArtifactError('invalid_argument', 'The profile needs a harness name ("name": letters, digits, ".", "_" or "-").');
  }
  if (raw.rules !== undefined && (typeof raw.rules !== 'string' || raw.rules.length > PROFILE_RULES_MAX)) {
    throw new OpenArtifactError('invalid_argument', `"rules" is text of at most ${PROFILE_RULES_MAX} characters.`);
  }
  if (raw.nudge !== undefined && !validNudge(raw.nudge)) {
    throw new OpenArtifactError('invalid_argument', '"nudge" is { command, args }: a program (or a list to try) and its arguments, with ${session} and ${text}.');
  }
  if (raw.markers !== undefined && !stringList(raw.markers, ENV_NAME)) {
    throw new OpenArtifactError('invalid_argument', '"markers" is a list of environment variable names.');
  }
  if (raw.hookDialect !== undefined && !validHookDialect(raw.hookDialect)) {
    throw new OpenArtifactError('invalid_argument', '"hookDialect" is claude-code, cursor, copilot, antigravity, or { events, answer }.');
  }
  if (raw.sessionWorkspace !== undefined && !(typeof raw.sessionWorkspace === 'string' && Object.hasOwn(SESSION_WORKSPACES, raw.sessionWorkspace))) {
    throw new OpenArtifactError('invalid_argument', `"sessionWorkspace" is one of: ${Object.keys(SESSION_WORKSPACES).join(', ')}.`);
  }
  const file = homeProfileFile(name);
  const existing = readProfile(file);
  const replaced: HarnessProfileSource | null = existing ? (existing.source === 'adapter' ? 'adapter' : 'user') : null;
  writeJson(file, { ...raw, name, source: 'user' });
  return { name, file, replaced };
}

/**
 * Removes a profile from `<home>/harnesses/` (`open-artifact harness remove`); the shipped one, if any, is in effect
 * again. A shipped profile itself is never removed.
 */
export function removeProfile(name: string): { file: string; source: HarnessProfileSource } {
  if (!HARNESS_NAME.test(name)) throw new OpenArtifactError('invalid_argument', `Not a harness name: ${name}`);
  const file = homeProfileFile(name);
  const existing = readProfile(file);
  if (!existing) {
    const shipped = readProfile(join(shippedProfilesDir(), `${name}.json`));
    throw new OpenArtifactError(
      'not_found',
      shipped ? `${name} has only the profile shipped with Open Artifact, which is not removed.` : `No profile for ${name} in ${files.harnesses()}.`,
    );
  }
  rmSync(file, { force: true });
  return { file, source: existing.source === 'adapter' ? 'adapter' : 'user' };
}
