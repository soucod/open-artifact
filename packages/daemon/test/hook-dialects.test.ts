/**
 * Hook dialects (`hook-dialects.ts`): what `open-artifact hook` prints for each harness, pinned to what the command
 * line printed before the formats became profile data (the old code is kept below as the reference), plus a mapping
 * of a harness's own.
 */

import './helpers.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { HarnessProfile } from '@open-artifact/protocol';
import { HOOK_DIALECTS, hookDialectOf } from '../src/hook-dialects.ts';

// ---- the code this replaced (bin/open-artifact.ts before profiles named the dialect) ----

const LEGACY_EVENTS: Record<string, string> = {
  sessionStart: 'SessionStart',
  userPromptTransformed: 'UserPromptSubmit',
  postToolUse: 'UserPromptSubmit',
  PreInvocation: 'UserPromptSubmit',
  stop: 'Stop',
  agentStop: 'Stop',
};

function legacyLeaves(event: string, input: Record<string, unknown>): boolean {
  return event === 'sessionStart' && typeof input.initialPrompt === 'string' && input.initialPrompt.trim() !== '';
}

function legacyAnswer(event: string, text: string, input: Record<string, unknown>, harness = ''): unknown {
  if (harness === 'antigravity') {
    if (event === 'Stop') return { decision: 'continue', reason: text };
    return { injectSteps: [{ systemMessage: { systemMessage: text } }] };
  }
  switch (event) {
    case 'Stop':
    case 'agentStop':
      return { decision: 'block', reason: text };
    case 'stop':
      return { followup_message: text };
    case 'sessionStart':
    case 'postToolUse':
      return { additional_context: text, additionalContext: text };
    case 'userPromptTransformed':
      return { modifiedTransformedPrompt: `${String(input.transformedPrompt ?? input.prompt ?? '')}\n\n${text}` };
    default:
      return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
  }
}

function legacySession(input: Record<string, unknown>): unknown {
  return input.session_id ?? input.sessionId ?? input.conversation_id ?? input.conversationId ?? null;
}

function legacyWorkspace(input: Record<string, unknown>): string | null {
  const roots = [input.workspace_roots, input.workspacePaths].flatMap((list) => (Array.isArray(list) ? (list as unknown[]) : []));
  const named = input.cwd ?? roots[0];
  return typeof named === 'string' && named ? named : null;
}

// ---- the shipped profiles and the events their plugins install ----

const SHIPPED = resolve(import.meta.dirname, '..', 'harnesses');
const profile = (name: string): HarnessProfile => JSON.parse(readFileSync(resolve(SHIPPED, `${name}.json`), 'utf8')) as HarnessProfile;

/** The hook events each plugin installs (plugins/<app>/hooks), plus Cursor's and Copilot's documented `postToolUse`. */
const INSTALLED: Record<string, string[]> = {
  'claude-code': ['SessionStart', 'UserPromptSubmit', 'Stop'],
  codex: ['SessionStart', 'UserPromptSubmit', 'Stop'],
  zcode: ['SessionStart', 'UserPromptSubmit', 'Stop'],
  cursor: ['sessionStart', 'postToolUse', 'stop'],
  copilot: ['sessionStart', 'userPromptTransformed', 'postToolUse', 'agentStop'],
  antigravity: ['SessionStart', 'PreInvocation', 'Stop'],
};

const INPUTS: Array<Record<string, unknown>> = [
  {},
  { session_id: 's1', cwd: '/work' },
  { sessionId: 's2', workspace_roots: ['/cursor-root', '/other'] },
  { conversation_id: 'c3', workspacePaths: ['/ag-root'] },
  { conversationId: 'c4', prompt: 'hello', transformedPrompt: 'hello there' },
  { sessionId: 's5', prompt: 'only prompt' },
  { initialPrompt: 'start', sessionId: 's6' },
  { initialPrompt: '   ' },
];

test('each shipped profile names its hook dialect', () => {
  assert.equal(profile('claude-code').hookDialect, 'claude-code');
  assert.equal(profile('codex').hookDialect, 'claude-code');
  assert.equal(profile('zcode').hookDialect, 'claude-code');
  assert.equal(profile('cursor').hookDialect, 'cursor');
  assert.equal(profile('copilot').hookDialect, 'copilot');
  assert.equal(profile('antigravity').hookDialect, 'antigravity');
  // No hooks: the format the command line always had.
  assert.equal(profile('dsh').hookDialect, undefined);
  assert.equal(profile('chatgpt').hookDialect, undefined);
});

test('every shipped harness prints exactly what it printed before, for every event its plugin installs', () => {
  for (const [harness, events] of Object.entries(INSTALLED)) {
    const dialect = hookDialectOf(profile(harness));
    for (const event of events) {
      for (const input of INPUTS) {
        const what = `${harness} ${event} ${JSON.stringify(input)}`;
        assert.equal(dialect.event(event), LEGACY_EVENTS[event] ?? event, what);
        assert.equal(dialect.leaves(event, input), legacyLeaves(event, input), what);
        assert.deepEqual(dialect.answer(event, 'MSG', input), legacyAnswer(event, 'MSG', input, harness), what);
        assert.equal(dialect.session(input), legacySession(input), what);
        assert.equal(dialect.workspace(input), legacyWorkspace(input), what);
      }
    }
  }
});

test('a harness with no dialect gets the old format for any event', () => {
  const none = hookDialectOf(null);
  assert.equal(none.name, 'any');
  assert.equal(hookDialectOf({ hookDialect: 'nonsense' as never }).name, 'any');
  const events = ['SessionStart', 'UserPromptSubmit', 'Stop', 'PostToolUse', 'sessionStart', 'postToolUse', 'stop', 'agentStop', 'userPromptTransformed', 'PreInvocation', 'Other'];
  for (const event of events) {
    for (const input of INPUTS) {
      assert.equal(none.event(event), LEGACY_EVENTS[event] ?? event);
      assert.equal(none.leaves(event, input), legacyLeaves(event, input));
      assert.deepEqual(none.answer(event, 'MSG', input), legacyAnswer(event, 'MSG', input));
    }
  }
});

test('the named dialects, pinned', () => {
  const cc = HOOK_DIALECTS['claude-code'];
  assert.deepEqual(cc.answer('Stop', 'T', {}), { decision: 'block', reason: 'T' });
  assert.deepEqual(cc.answer('SessionStart', 'T', {}), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'T' } });
  assert.deepEqual(cc.answer('UserPromptSubmit', 'T', {}), { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'T' } });
  const cursor = HOOK_DIALECTS.cursor;
  assert.equal(cursor.event('postToolUse'), 'UserPromptSubmit');
  assert.deepEqual(cursor.answer('stop', 'T', {}), { followup_message: 'T' });
  assert.deepEqual(cursor.answer('sessionStart', 'T', {}), { additional_context: 'T', additionalContext: 'T' });
  const copilot = HOOK_DIALECTS.copilot;
  assert.equal(copilot.event('userPromptTransformed'), 'UserPromptSubmit');
  assert.deepEqual(copilot.answer('agentStop', 'T', {}), { decision: 'block', reason: 'T' });
  assert.deepEqual(copilot.answer('userPromptTransformed', 'T', { prompt: 'p' }), { modifiedTransformedPrompt: 'p\n\nT' });
  assert.equal(copilot.leaves('sessionStart', { initialPrompt: 'go' }), true);
  const ag = HOOK_DIALECTS.antigravity;
  assert.equal(ag.event('PreInvocation'), 'UserPromptSubmit');
  assert.deepEqual(ag.answer('Stop', 'T', {}), { decision: 'continue', reason: 'T' });
  assert.deepEqual(ag.answer('PreInvocation', 'T', {}), { injectSteps: [{ systemMessage: { systemMessage: 'T' } }] });
});

test('a mapping of the harness\'s own: events, answer fields, wraps, and where the session and workspace are', () => {
  const dialect = hookDialectOf({
    hookDialect: {
      events: { start: 'SessionStart', beforeModel: 'UserPromptSubmit', end: 'Stop' },
      answer: {
        end: { field: 'continueWith' },
        UserPromptSubmit: { field: 'output.context', wrap: { output: { kind: 'context', event: '${event}' } } },
      },
      session: ['thread'],
      workspace: ['folders', 'dir'],
    },
  });
  assert.equal(dialect.name, 'custom');
  assert.equal(dialect.event('start'), 'SessionStart');
  assert.equal(dialect.event('beforeModel'), 'UserPromptSubmit');
  assert.equal(dialect.event('unknown'), 'unknown');
  assert.equal(dialect.event('toString'), 'toString', 'no inherited names');
  assert.deepEqual(dialect.answer('end', 'T', {}), { continueWith: 'T' });
  assert.deepEqual(dialect.answer('beforeModel', 'T', {}), { output: { kind: 'context', event: 'beforeModel', context: 'T' } });
  // No answer for the event: the text alone.
  assert.equal(dialect.answer('start', 'T', {}), 'T');
  assert.equal(dialect.session({ thread: 't-9', session_id: 'no' }), 't-9');
  assert.equal(dialect.session({ session_id: 'no' }), null);
  assert.equal(dialect.workspace({ folders: ['/a', '/b'] }), '/a');
  assert.equal(dialect.workspace({ dir: '/d' }), '/d');
  assert.equal(dialect.leaves('start', { initialPrompt: 'x' }), false);
  // A mapping without session or workspace names reads the usual fields.
  const plain = hookDialectOf({ hookDialect: { events: {}, answer: {} } });
  assert.equal(plain.session({ session_id: 'x' }), 'x');
  assert.equal(plain.workspace({ cwd: '/w' }), '/w');
  // A path through a prototype is never written.
  const bad = hookDialectOf({ hookDialect: { events: {}, answer: { Stop: { field: '__proto__.polluted' } } } });
  bad.answer('Stop', 'T', {});
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
