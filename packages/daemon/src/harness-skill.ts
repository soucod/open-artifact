/**
 * `skill.get` and `commands.list`: the skill rendered for a harness, and one command entry per installed type.
 *
 * The skill is `@open-artifact/protocol`'s template (`skill.ts`, whose default rendering is `SKILL.md`), filled in from
 * the harness's profile and its adapter's `caps`: its command, its agent's name, how its agent calls the tools, how it
 * shows pages, its rules and what it asks the person first. `quickstart`'s `steps` come from the same options
 * ({@link harnessSkillOptions}), so the skill and `quickstart` say the same thing.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  OpenArtifactError,
  SKILL_ARGUMENT_HINT,
  SKILL_COMMAND,
  SKILL_COMMAND_NAME,
  agentPrompt,
  oneLine,
  renderSkillBody,
  skillDescription,
  skillTypesSection,
  type AdapterCaps,
  type AdapterToDaemon,
  type CommandEntry,
  type CommentRoute,
  type HarnessProfile,
  type SessionRef,
  type SkillOptions,
  type SkillParams,
  type SkillResult,
  type TypeSummary,
} from '@open-artifact/protocol';
import { harnessProfile } from './harness-profiles.ts';
import { scriptRunner, shellWord } from './paths.ts';
import { typeLocation, type ListedType } from './types.ts';

/** The methods this module answers. */
export const SKILL_METHODS = ['skill.get', 'commands.list'] as const satisfies ReadonlyArray<keyof AdapterToDaemon>;

/** The installed types and the ones the person lets agents offer (`settings.offers`): what the daemon's tools know. */
export interface SkillCatalog {
  skillCatalog(workspace: string | null): { types: ListedType[]; offers: string[] };
}

/** What the handler is given about the calling adapter. */
export interface SkillCallContext {
  harness: string;
  caller: SessionRef;
  /** The adapter's `caps` from `hello`. */
  caps?: AdapterCaps;
  /** The runtime's version. */
  version?: string;
  /** The daemon's tools, when they can list the types ({@link SkillCatalog}). */
  tools?: unknown;
  /** How the agent runs the command line (default: this runtime's own launcher). */
  cli?: string;
}

/** Templates a command entry carries, at most. */
const MAX_TEMPLATES = 8;
/** Longest starting prompt, in characters. */
const MAX_PROMPT = 1000;

/**
 * The command line this runtime answers to: the skill's launcher (`<skill>/scripts/open-artifact.mjs`, which says who
 * calls) when this runtime is a skill's vendored daemon or a checkout's source, else `open-artifact` on the PATH.
 */
export function runtimeCli(script = process.argv[1] ?? ''): string {
  const bin = resolve(script);
  const candidates = [
    // <skill>/vendor/open-artifact.mjs → <skill>/scripts/open-artifact.mjs
    join(dirname(dirname(bin)), 'scripts', 'open-artifact.mjs'),
    // <repo>/packages/daemon/src/bin/open-artifact.ts → <repo>/skills/open-artifact/scripts/open-artifact.mjs
    join(dirname(bin), '..', '..', '..', '..', 'skills', 'open-artifact', 'scripts', 'open-artifact.mjs'),
  ];
  const launcher = /open-artifact\.(m?js|ts)$/.test(bin) ? candidates.map((file) => resolve(file)).find((file) => existsSync(file)) : undefined;
  if (!launcher) return 'open-artifact';
  return `${scriptRunner()} ${shellWord(launcher)}`;
}

/** The harness's caps: its profile's, with what its adapter said in `hello` over them. */
export function capsOf(profile: HarnessProfile, caps?: AdapterCaps): AdapterCaps {
  return { ...(profile.caps ?? {}), ...(caps ?? {}) };
}

/** The command a harness's skill answers to: the one asked for, else the harness's first, else `open-artifact`. */
export function commandOf(profile: HarnessProfile, caps: AdapterCaps, asked?: unknown): string {
  if (asked !== undefined && asked !== null && asked !== '') {
    if (typeof asked !== 'string' || !SKILL_COMMAND_NAME.test(asked)) {
      throw new OpenArtifactError('invalid_argument', 'command: a command name, lowercase letters, digits, - and _ (at most 32), without the slash.');
    }
    return asked;
  }
  const named = [...(caps.commands?.names ?? []), ...(profile.commands ?? [])].find((name) => typeof name === 'string' && SKILL_COMMAND_NAME.test(name));
  return named ?? SKILL_COMMAND;
}

/**
 * The template's options for a harness: what `params` asks, else what its profile and caps say. Left out where the
 * harness says nothing, so a harness nobody described gets today's skill.
 */
export function harnessSkillOptions(harness: string, caps?: AdapterCaps, params: Partial<SkillParams> = {}): SkillOptions {
  const profile = harnessProfile(harness);
  const all = capsOf(profile, caps);
  const agentName = params.agentName ?? all.agentName ?? (profile.agentName && profile.agentName !== 'Agent' ? profile.agentName : undefined);
  const tools = params.tools ?? all.tools;
  const opens = params.opens ?? (all.open ? 'host' : undefined);
  const options: SkillOptions = {
    command: commandOf(profile, all, params.command),
    ...(agentName ? { agentName: oneLine(agentName, 40) } : {}),
    ...(tools === 'native' || tools === 'mcp' || tools === 'cli' ? { tools } : {}),
    ...(params.toolNames ?? profile.toolNames ? { toolNames: params.toolNames ?? profile.toolNames } : {}),
    ...(opens === 'host' || opens === 'agent-browser' || opens === 'system' || opens === 'link' ? { opens } : {}),
    ...(profile.rules ? { rules: profile.rules, host: profile.title || harness } : {}),
    ...(profile.policy?.confirm?.length ? { confirm: profile.policy.confirm } : {}),
  };
  return options;
}

/**
 * How comments sent from a page reach a harness's agent: put in the person's draft (`wake.mode: "draft"`), at once
 * (an adapter takes `wake.deliver`), with the person's next message (hooks), or waiting in the inbox.
 */
export function commentRouteOf(harness: string, caps?: AdapterCaps, live = false): CommentRoute {
  const profile = harnessProfile(harness);
  const all = capsOf(profile, caps);
  if (all.wake?.mode === 'draft') return 'draft';
  if (live && caps?.wake) return 'live';
  if (profile.hookDialect || profile.level === 'L2') return 'hook';
  return 'inbox';
}

/** A type's text in a locale: the exact tag, else its language, else the manifest's own. */
function localized(type: ListedType, locale: string | undefined): { title: string; description: string } {
  const i18n = type.i18n ?? {};
  const tag = locale ? Object.keys(i18n).find((k) => k.toLowerCase() === locale.toLowerCase()) ?? Object.keys(i18n).find((k) => k.toLowerCase().split('-')[0] === locale.toLowerCase().split('-')[0]) : undefined;
  const own = tag ? i18n[tag] ?? {} : {};
  return {
    title: own.title || own.name || type.title,
    description: own.summary || own.description || type.summary || type.description || '',
  };
}

/** The types a harness's skill and command menu list: enabled, runnable, not shadowed. */
function catalogOf(context: SkillCallContext): { types: ListedType[]; offers: string[] } | null {
  const tools = context.tools as Partial<SkillCatalog> | undefined;
  if (!tools || typeof tools.skillCatalog !== 'function') return null;
  try {
    const { types, offers } = tools.skillCatalog(context.caller.workspace ?? null);
    return { types: types.filter((t) => t.enabled && t.runnable && !t.shadowedBy), offers };
  } catch {
    return null;
  }
}

/** A short, stable hash of what a result says (its version left out: a new runtime with the same text keeps it). */
export function etagOf(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/** `skill.get`: the skill for this harness, the installed types after it. */
export function skillFor(params: Partial<SkillParams>, context: SkillCallContext): SkillResult {
  const form = params.form ?? 'full';
  if (form !== 'full' && form !== 'entry') throw new OpenArtifactError('invalid_argument', 'form: "entry" or "full".');
  const options: SkillOptions = { ...harnessSkillOptions(context.harness, context.caps, params), cli: context.cli ?? runtimeCli() };
  const catalog = catalogOf(context);
  const body = `${renderSkillBody(options, form)}\n\n${skillTypesSection(catalog ? catalog.types.map((t) => ({ id: t.id, title: t.title, description: t.description })) : null)}`;
  const description = skillDescription(options);
  const profile = harnessProfile(context.harness);
  let prompt: string | undefined;
  if (catalog) {
    const offers = new Set(catalog.offers);
    const types: TypeSummary[] = catalog.types.map((t) => ({ id: t.id, title: t.title, when: t.when, description: t.description, exports: t.exports, offer: offers.has(t.id) ? t.offer : null }));
    prompt = agentPrompt({ types, toolNames: options.toolNames, offer: profile.policy?.offer !== 'asked' });
  }
  const name = options.command ?? SKILL_COMMAND;
  return {
    name,
    description,
    argumentHint: SKILL_ARGUMENT_HINT,
    body,
    version: context.version ?? '0.0.0',
    etag: etagOf([name, description, SKILL_ARGUMENT_HINT, body, prompt ?? null]),
    ...(prompt ? { prompt } : {}),
  };
}

/** `commands.list`: `/<command> <type> ` per installed type, with its title, description and starting prompts. */
export function commandsFor(params: { command?: unknown; locale?: unknown }, context: SkillCallContext): { commands: CommandEntry[] } {
  const profile = harnessProfile(context.harness);
  const command = commandOf(profile, capsOf(profile, context.caps), params.command);
  const locale = typeof params.locale === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(params.locale) ? params.locale : undefined;
  const catalog = catalogOf(context);
  const commands = (catalog?.types ?? [])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((type): CommandEntry => {
      const text = localized(type, locale);
      const templates = (type.templates ?? [])
        .filter((t) => t && typeof t.prompt === 'string' && t.prompt.trim())
        .slice(0, MAX_TEMPLATES)
        .map((t) => ({ id: oneLine(t.id, 64) || 'template', name: oneLine(t.name, 80) || oneLine(t.id, 64), prompt: oneLine(t.prompt, MAX_PROMPT) }));
      return {
        text: `/${command} ${type.id} `,
        type: type.id,
        title: oneLine(text.title, 80) || type.id,
        description: oneLine(text.description, 200),
        ...typeLocation(type),
        ...(templates.length ? { templates } : {}),
      };
    });
  return { commands };
}

/** Answers `skill.get` and `commands.list`. */
export async function handleSkillCall(method: (typeof SKILL_METHODS)[number], params: Record<string, unknown>, context: SkillCallContext): Promise<unknown> {
  if (method === 'skill.get') return skillFor(params as Partial<SkillParams>, context);
  if (method === 'commands.list') return commandsFor(params, context);
  throw new OpenArtifactError('method_not_found', `${String(method)} is not available in this version of the daemon.`);
}
