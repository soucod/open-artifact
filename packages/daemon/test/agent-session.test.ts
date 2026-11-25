/**
 * The publishing guard of the command line (`agent-session.ts`): which variables mark an agent's session, which of the
 * person's decisions are refused there and with what sentence, the one override (`remotes.<name>.agentMayPublish`),
 * and what `open-artifact publish` does about a dashboard's data with and without a terminal.
 */

import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { agentSessionOf, agentVariables, dataChoice, dataLeftOut, personOnlyRefusal, saidYes, type PersonAct } from '../src/agent-session.ts';

const SHIPPED = [resolve(import.meta.dirname, '..', 'harnesses')];

test('each harness profile that names a session variable marks an agent session, and so do the app markers', () => {
  const variables = agentVariables(SHIPPED);
  // The shipped profiles' sessionEnv.
  assert.equal(variables.get('CLAUDE_CODE_SESSION_ID'), 'claude-code');
  assert.equal(variables.get('CODEX_THREAD_ID'), 'codex');
  assert.equal(variables.get('ANTIGRAVITY_CONVERSATION_ID'), 'antigravity');
  // The markers the apps set besides.
  assert.equal(variables.get('CLAUDECODE'), 'claude-code');
  assert.equal(variables.get('ANTIGRAVITY_AGENT'), 'antigravity');

  assert.deepEqual(agentSessionOf({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'abc' }, SHIPPED), { harness: 'claude-code', variable: 'CLAUDECODE', session: 'abc' });
  assert.deepEqual(agentSessionOf({ CLAUDECODE: '1' }, SHIPPED), { harness: 'claude-code', variable: 'CLAUDECODE', session: null });
  assert.deepEqual(agentSessionOf({ CODEX_THREAD_ID: 't-1' }, SHIPPED), { harness: 'codex', variable: 'CODEX_THREAD_ID', session: 't-1' });
  assert.deepEqual(agentSessionOf({ ANTIGRAVITY_CONVERSATION_ID: 'c-1' }, SHIPPED), { harness: 'antigravity', variable: 'ANTIGRAVITY_CONVERSATION_ID', session: 'c-1' });
  // A person's terminal: none of them (an empty value counts as unset; OPEN_ARTIFACT_HARNESS alone is not one).
  assert.equal(agentSessionOf({ HOME: '/home/ada', PATH: '/usr/bin', CLAUDECODE: '', OPEN_ARTIFACT_HARNESS: 'cli' }, SHIPPED), null);
});

test('inside an agent session every one of the person\'s decisions is refused, with the sentence to act on', () => {
  const agent = agentSessionOf({ CODEX_THREAD_ID: 't-1' }, SHIPPED);
  const acts: PersonAct[] = ['publish', 'unpublish', 'data', 'remote-add', 'remote-remove', 'remote-default', 'remote-auto', 'harness-add', 'harness-remove'];
  for (const act of acts) {
    const refusal = personOnlyRefusal(act, agent, { remote: 'work', settings: {}, command: 'open-artifact something' });
    assert.ok(refusal, act);
    assert.match(refusal, /is the person's decision, and this command runs inside an agent session \(codex: CODEX_THREAD_ID is set\), so it was not done\./);
    assert.match(refusal, /\nAsk the person to .+, or to run `open-artifact something` in their own terminal\.$/);
    // The override is never advertised to the agent.
    assert.doesNotMatch(refusal, /agentMayPublish|settings/);
  }
  // A person's own terminal: nothing is refused.
  for (const act of acts) assert.equal(personOnlyRefusal(act, null, { remote: 'work', settings: {}, command: 'x' }), null);
});

test('remotes.<name>.agentMayPublish lets publish and unpublish on that remote through, and nothing else', () => {
  const agent = agentSessionOf({ CLAUDECODE: '1' }, SHIPPED);
  const settings = { remotes: { work: { agentMayPublish: true } } };
  assert.equal(personOnlyRefusal('publish', agent, { remote: 'work', settings, command: 'x' }), null);
  assert.equal(personOnlyRefusal('unpublish', agent, { remote: 'work', settings, command: 'x' }), null);
  assert.ok(personOnlyRefusal('publish', agent, { remote: 'other', settings, command: 'x' }));
  assert.ok(personOnlyRefusal('publish', agent, { remote: null, settings, command: 'x' }), 'no remote to go to: refused');
  for (const act of ['data', 'remote-add', 'remote-remove', 'remote-default', 'remote-auto', 'harness-add', 'harness-remove'] as const) {
    assert.ok(personOnlyRefusal(act, agent, { remote: 'work', settings, command: 'x' }), act);
  }
});

test('a dashboard\'s data: asked at a terminal, left out without one, never confirmed by an agent session', () => {
  const agent = agentSessionOf({ CLAUDECODE: '1' }, SHIPPED);
  assert.equal(dataChoice({ live: false, confirmed: false, agent: null, interactive: true }), 'none');
  assert.equal(dataChoice({ live: true, confirmed: true, agent: null, interactive: false }), 'none');
  assert.equal(dataChoice({ live: true, confirmed: false, agent: null, interactive: true }), 'ask');
  assert.equal(dataChoice({ live: true, confirmed: false, agent: null, interactive: false }), 'no-terminal');
  assert.equal(dataChoice({ live: true, confirmed: false, agent, interactive: true }), 'agent');
  for (const yes of ['y', 'Y', 'yes', ' YES ']) assert.equal(saidYes(yes), true, yes);
  for (const no of ['', 'n', 'no', 'yep', 'sure']) assert.equal(saidYes(no), false, no);
  assert.match(dataLeftOut('art_1', 'no-terminal'), /Share panel \("Publish its data"\) or with `open-artifact publish art_1` in their own terminal, which asks\.$/);
  assert.match(dataLeftOut('art_1', 'agent'), /An agent session never publishes a dashboard's data\.$/);
});

test('the markers are the union over every profile: a reported or personal profile adds markers and never removes one', () => {
  const home = tempDir('open-artifact-markers-');
  mkdirSync(home, { recursive: true });
  // An adapter reports a Claude Code profile without markers, and one that names another harness's variable.
  writeFileSync(join(home, 'claude-code.json'), JSON.stringify({ name: 'claude-code', source: 'adapter', markers: [], sessionEnv: 'OTHER_SESSION' }));
  writeFileSync(join(home, 'sneaky.json'), JSON.stringify({ name: 'sneaky', source: 'adapter', markers: ['CODEX_THREAD_ID', 'SNEAKY_AGENT'] }));
  // The person's own harness.
  writeFileSync(join(home, 'mine.json'), JSON.stringify({ name: 'mine', markers: ['MINE_AGENT'], sessionEnv: 'MINE_SESSION' }));
  writeFileSync(join(home, 'broken.json'), '{ nope');
  const dirs = [...SHIPPED, home];
  const variables = agentVariables(dirs);
  // Every shipped marker is still there, attributed to its shipped harness.
  assert.equal(variables.get('CLAUDECODE'), 'claude-code');
  assert.equal(variables.get('CLAUDE_CODE_SESSION_ID'), 'claude-code');
  assert.equal(variables.get('CODEX_THREAD_ID'), 'codex');
  // Added ones count.
  assert.equal(variables.get('OTHER_SESSION'), 'claude-code');
  assert.equal(variables.get('SNEAKY_AGENT'), 'sneaky');
  assert.equal(variables.get('MINE_AGENT'), 'mine');
  assert.equal(variables.get('MINE_SESSION'), 'mine');
  assert.deepEqual(agentSessionOf({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'abc' }, dirs), { harness: 'claude-code', variable: 'CLAUDECODE', session: 'abc' });
  assert.deepEqual(agentSessionOf({ MINE_AGENT: '1', MINE_SESSION: 'm-1' }, dirs), { harness: 'mine', variable: 'MINE_AGENT', session: 'm-1' });
  assert.deepEqual(agentSessionOf({ SNEAKY_AGENT: '1' }, dirs), { harness: 'sneaky', variable: 'SNEAKY_AGENT', session: null });
  // And so the person-only guard holds for every one of them.
  for (const env of [{ CLAUDECODE: '1' }, { MINE_SESSION: 'x' }, { SNEAKY_AGENT: '1' }]) {
    assert.ok(personOnlyRefusal('harness-add', agentSessionOf(env, dirs), { settings: {}, command: 'open-artifact harness add p.json' }));
  }
  // No profile names a variable: no marker of its own.
  assert.equal(agentSessionOf({ HOME: '/home/ada' }, dirs), null);
});
