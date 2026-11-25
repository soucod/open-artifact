/**
 * Hook dialects: how `open-artifact hook <event> --harness <name>` reads a harness's hook input and answers in the
 * shape that harness gives its model. The harness's profile says which (`hookDialect`): one of the formats known by
 * name below, or a mapping of its own ({@link HookDialect}).
 *
 * The daemon itself knows three events: `SessionStart` (register the session, hand over what waited),
 * `UserPromptSubmit` (hand over what waited with the person's next message) and `Stop` (hand it over at the end of a
 * turn, so the harness runs another). A dialect maps the harness's event names onto these and says where the text goes
 * in the answer.
 *
 * The named formats:
 *
 * - `claude-code` (Claude Code, Codex, ZCode): `SessionStart`, `UserPromptSubmit`, `Stop`; `Stop` answers
 *   `{decision: "block", reason}`, the others `{hookSpecificOutput: {hookEventName, additionalContext}}`.
 * - `cursor`: `sessionStart`, `postToolUse` (as `UserPromptSubmit`), `stop`; `stop` answers `{followup_message}` (sent
 *   as the next message), the others `{additional_context, additionalContext}`.
 * - `copilot` (GitHub Copilot): `sessionStart`, `userPromptTransformed` and `postToolUse` (as `UserPromptSubmit`),
 *   `agentStop`; `agentStop` answers `{decision: "block", reason}` (another turn), `userPromptTransformed`
 *   `{modifiedTransformedPrompt}` (the prompt with the messages after it), the others both context fields.
 * - `antigravity`: Claude Code's event names, with `PreInvocation` as `UserPromptSubmit`; `Stop` answers
 *   `{decision: "continue", reason}`, the others `{injectSteps: [{systemMessage: {systemMessage}}]}`.
 *
 * Not Cursor's `beforeSubmitPrompt` or Copilot's `userPromptSubmitted`: their output never reaches the model, and the
 * daemon hands a hook the messages it waits with, so a plugin must not install them.
 *
 * A harness with no dialect (a profile without `hookDialect`, or no profile) gets the format the command line always
 * had: every named format's event names at once, answered by the event's name.
 *
 * A mapping ({@link HookDialect}) names each event (`events`), and for each event (by the harness's name, else the
 * daemon's) the answer: `wrap`, an object whose string values may say `${event}` (the harness's event name), with the
 * text set at `field` (a dotted path, e.g. `hookSpecificOutput.additionalContext`). An event with no answer prints the
 * text alone. `session` and `workspace` name the input fields that hold the session id and the workspace folder (a
 * list there gives its first entry).
 */

import type { HarnessProfile, HookDialect, HookDialectName } from '@open-artifact/protocol';

/** The daemon's hook events. */
export type HookEvent = 'SessionStart' | 'UserPromptSubmit' | 'Stop';

/** A hook input, as the harness wrote it on stdin. */
export type HookInput = Record<string, unknown>;

/** A dialect the command line can use: the named ones, a mapping, or the format of a harness that names none. */
export interface ResolvedDialect {
  /** The named format, `custom` for a mapping, `any` for none. */
  name: HookDialectName | 'custom' | 'any';
  /** The daemon's event for the harness's (an unknown one is passed on as it is). */
  event(event: string): string;
  /** Whether this hook only registers the session and leaves the messages for a later hook of the same turn. */
  leaves(event: string, input: HookInput): boolean;
  /** The session id in the hook's input. */
  session(input: HookInput): string | null;
  /** The workspace folder in the hook's input. */
  workspace(input: HookInput): string | null;
  /** What the hook prints so the harness gives the model `text`. */
  answer(event: string, text: string, input: HookInput): unknown;
}

const SESSION_FIELDS = ['session_id', 'sessionId', 'conversation_id', 'conversationId'];

/** The session id the named formats read: `session_id`, `sessionId`, `conversation_id` or `conversationId`. */
function knownSession(input: HookInput): string | null {
  for (const name of SESSION_FIELDS) {
    const value = input[name];
    if (value !== undefined && value !== null) return value as string;
  }
  return null;
}

/**
 * The workspace the named formats read: `cwd`, else the first of Cursor's `workspace_roots` or Antigravity's
 * `workspacePaths` (Antigravity's hooks run in the plugin's folder, not the workspace).
 */
function knownWorkspace(input: HookInput): string | null {
  const roots = [input.workspace_roots, input.workspacePaths].flatMap((list) => (Array.isArray(list) ? (list as unknown[]) : []));
  const named = input.cwd ?? roots[0];
  return typeof named === 'string' && named ? named : null;
}

/**
 * GitHub Copilot's `sessionStart` with a prompt to follow (`initialPrompt`, in the CLI) only registers the session:
 * its `additionalContext` lasts for that run alone (a resumed session no longer has it), while `userPromptTransformed`,
 * which runs next, puts the messages into the prompt, which the session keeps.
 */
function leavesForPrompt(event: string, input: HookInput): boolean {
  return event === 'sessionStart' && typeof input.initialPrompt === 'string' && input.initialPrompt.trim() !== '';
}

const never = (): boolean => false;
const bothContexts = (text: string): unknown => ({ additional_context: text, additionalContext: text });
const claudeContext = (event: string, text: string): unknown => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

/** A named format, by its event names and its answers. */
function named(
  name: HookDialectName,
  events: Record<string, HookEvent>,
  answer: (event: string, text: string, input: HookInput) => unknown,
  leaves: (event: string, input: HookInput) => boolean = never,
): ResolvedDialect {
  return { name, event: (event) => events[event] ?? event, leaves, session: knownSession, workspace: knownWorkspace, answer };
}

/** The hook formats known by name. */
export const HOOK_DIALECTS: Readonly<Record<HookDialectName, ResolvedDialect>> = Object.freeze({
  'claude-code': named('claude-code', { SessionStart: 'SessionStart', UserPromptSubmit: 'UserPromptSubmit', Stop: 'Stop' }, (event, text) =>
    event === 'Stop' ? { decision: 'block', reason: text } : claudeContext(event, text),
  ),
  cursor: named(
    'cursor',
    { sessionStart: 'SessionStart', postToolUse: 'UserPromptSubmit', stop: 'Stop' },
    (event, text) => (event === 'stop' ? { followup_message: text } : bothContexts(text)),
    leavesForPrompt,
  ),
  copilot: named(
    'copilot',
    { sessionStart: 'SessionStart', userPromptTransformed: 'UserPromptSubmit', postToolUse: 'UserPromptSubmit', agentStop: 'Stop' },
    (event, text, input) => {
      if (event === 'agentStop') return { decision: 'block', reason: text };
      if (event === 'userPromptTransformed') return { modifiedTransformedPrompt: `${String(input.transformedPrompt ?? input.prompt ?? '')}\n\n${text}` };
      return bothContexts(text);
    },
    leavesForPrompt,
  ),
  antigravity: named('antigravity', { SessionStart: 'SessionStart', PreInvocation: 'UserPromptSubmit', Stop: 'Stop' }, (event, text) =>
    // Antigravity shares Claude Code's event names but not its output: steps to add to the conversation, and
    // `decision: "continue"` on Stop, whose reason it adds as a system message.
    event === 'Stop' ? { decision: 'continue', reason: text } : { injectSteps: [{ systemMessage: { systemMessage: text } }] },
  ),
});

/** Every named format's event names at once: what a harness without a dialect gets. */
const ANY_EVENTS: Readonly<Record<string, string>> = {
  sessionStart: 'SessionStart',
  userPromptTransformed: 'UserPromptSubmit',
  postToolUse: 'UserPromptSubmit',
  PreInvocation: 'UserPromptSubmit',
  stop: 'Stop',
  agentStop: 'Stop',
};

/** The format of a harness that names none: each event answered the way the named format that has it answers. */
const ANY: ResolvedDialect = {
  name: 'any',
  event: (event) => ANY_EVENTS[event] ?? event,
  leaves: leavesForPrompt,
  session: knownSession,
  workspace: knownWorkspace,
  answer(event, text, input) {
    switch (event) {
      case 'Stop':
      case 'agentStop':
        return { decision: 'block', reason: text };
      case 'stop':
        return { followup_message: text };
      case 'sessionStart':
      case 'postToolUse':
        return bothContexts(text);
      case 'userPromptTransformed':
        return HOOK_DIALECTS.copilot.answer(event, text, input);
      default:
        return claudeContext(event, text);
    }
  },
};

/** The first value named in `names`: a string, or the first string of a list. */
function firstOf(input: HookInput, names: readonly string[]): string | null {
  for (const name of names) {
    const value = input[name];
    if (typeof value === 'string' && value) return value;
    if (Array.isArray(value)) {
      const first = value.find((item): item is string => typeof item === 'string' && item !== '');
      if (first) return first;
    }
  }
  return null;
}

/** A copy of `value` with `${event}` in its strings filled in. */
function fill(value: unknown, event: string): unknown {
  if (typeof value === 'string') return value.replace(/\$\{event\}/g, () => event);
  if (Array.isArray(value)) return value.map((item) => fill(item, event));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, event)]));
  return value;
}

/** Sets `text` at the dotted `path` of `target`, making the objects on the way. */
function setPath(target: Record<string, unknown>, path: string, text: string): void {
  const keys = path.split('.').filter(Boolean);
  if (!keys.length) return;
  let at = target;
  for (const key of keys.slice(0, -1)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
    const next = at[key];
    at = (at[key] = next && typeof next === 'object' && !Array.isArray(next) ? next : {}) as Record<string, unknown>;
  }
  const last = keys.at(-1)!;
  if (last === '__proto__' || last === 'constructor' || last === 'prototype') return;
  at[last] = text;
}

/** A dialect from a profile's mapping. */
function custom(mapping: HookDialect): ResolvedDialect {
  const events = mapping.events ?? {};
  const answers = mapping.answer ?? {};
  return {
    name: 'custom',
    event: (event) => (Object.hasOwn(events, event) ? events[event]! : event),
    leaves: never,
    session: (input) => (mapping.session?.length ? firstOf(input, mapping.session) : knownSession(input)),
    workspace: (input) => (mapping.workspace?.length ? firstOf(input, mapping.workspace) : knownWorkspace(input)),
    answer(event, text) {
      const daemonEvent = Object.hasOwn(events, event) ? events[event]! : event;
      const shape = Object.hasOwn(answers, event) ? answers[event] : Object.hasOwn(answers, daemonEvent) ? answers[daemonEvent] : undefined;
      if (!shape || typeof shape.field !== 'string') return text;
      const answer = (shape.wrap && typeof shape.wrap === 'object' ? fill(shape.wrap, event) : {}) as Record<string, unknown>;
      setPath(answer, shape.field, text);
      return answer;
    },
  };
}

/** The dialect a profile names: a named format, its mapping, or (none, or one this daemon does not know) {@link ANY}. */
export function hookDialectOf(profile: Pick<HarnessProfile, 'hookDialect'> | null | undefined): ResolvedDialect {
  const dialect = profile?.hookDialect;
  if (typeof dialect === 'string') return Object.hasOwn(HOOK_DIALECTS, dialect) ? HOOK_DIALECTS[dialect] : ANY;
  if (dialect && typeof dialect === 'object' && dialect.events && typeof dialect.events === 'object') return custom(dialect);
  return ANY;
}
