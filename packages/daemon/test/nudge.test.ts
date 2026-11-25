/**
 * Nudges (`nudge.ts`): the shipped Codex and Antigravity nudges, now profile data, run the same commands as before;
 * arguments are filled in as an argument list; a nudge is read only from a shipped profile or the person's own.
 */

import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { addUserProfile, nudgeOf, saveAdapterProfile } from '../src/harness-profiles.ts';
import { fillArg, liveEnvFile, nudgeProgram, nudgeSession, nudgeText, onPath, type NudgeRun } from '../src/nudge.ts';

/** A home folder with Antigravity's hub files. */
function home(hubs: Record<string, object | string>): string {
  const dir = tempDir('open-artifact-nudge-');
  const daemon = join(dir, '.gemini', 'antigravity', 'daemon');
  mkdirSync(daemon, { recursive: true });
  for (const [name, hub] of Object.entries(hubs)) writeFileSync(join(daemon, name), typeof hub === 'string' ? hub : JSON.stringify(hub));
  return dir;
}

const HUB = { dir: '~/.gemini/antigravity/daemon', pattern: '^hub_\\d+\\.json$', pid: 'pid' };

test('liveEnvFile: the live hub with every field needed, skipping dead and unreadable ones', () => {
  const dir = home({
    'hub_1.json': { pid: 11, httpPort: 1, csrfToken: 'dead' },
    'hub_2.json': '{ not json',
    'hub_3.json': { pid: 33, httpPort: 3, csrfToken: 'live' },
    'hub_4.json': { pid: 33, httpPort: 4 },
    'other.json': { pid: 33, httpPort: 9, csrfToken: 'no' },
  });
  assert.deepEqual(liveEnvFile(HUB, ['httpPort', 'csrfToken'], dir, (pid) => pid === 33), { pid: 33, httpPort: 3, csrfToken: 'live' });
  assert.equal(liveEnvFile(HUB, ['httpPort', 'csrfToken'], dir, () => false), null);
  assert.equal(liveEnvFile(HUB, ['httpPort'], tempDir('open-artifact-nudge-none-')), null);
});

test('fillArg: ${session} and ${text} become one argument each, filled in once', () => {
  assert.equal(fillArg('--thread=${session}', { session: 's-1', text: 't' }), '--thread=s-1');
  // What is filled in is never read again: a message that says ${session} stays as it is.
  assert.equal(fillArg('${text}', { session: 's-1', text: 'say ${session} and $(rm -rf /)' }), 'say ${session} and $(rm -rf /)');
  assert.equal(fillArg('${other}', { session: 's', text: 't' }), '${other}');
});

test('nudgeProgram: a set variable, an existing path, a name on PATH, in that order', () => {
  const dir = tempDir('open-artifact-nudge-bin-');
  const tool = join(dir, 'mytool');
  writeFileSync(tool, '#!/bin/sh\n');
  chmodSync(tool, 0o755);
  delete process.env.OPEN_ARTIFACT_TEST_BIN;
  assert.deepEqual(nudgeProgram(['${env:OPEN_ARTIFACT_TEST_BIN}', '/no/such/program', [tool, 'sub']], dir), { command: tool, args: ['sub'] });
  assert.deepEqual(nudgeProgram(['~/mytool'], dir), { command: tool, args: [] });
  process.env.OPEN_ARTIFACT_TEST_BIN = '/named/bin';
  const path = process.env.PATH;
  try {
    assert.deepEqual(nudgeProgram(['${env:OPEN_ARTIFACT_TEST_BIN}', tool], dir), { command: '/named/bin', args: [] });
    process.env.PATH = dir;
    assert.deepEqual(nudgeProgram('mytool', '/nowhere'), { command: tool, args: [] });
    assert.equal(nudgeProgram(['nothere', '/no/such'], '/nowhere'), null);
  } finally {
    delete process.env.OPEN_ARTIFACT_TEST_BIN;
    process.env.PATH = path;
  }
});

test('Windows: an .exe is looked for first; a .cmd or .bat is never run (Node needs a shell for it), and the log says why', () => {
  const early = tempDir('open-artifact-nudge-win-a-');
  const late = tempDir('open-artifact-nudge-win-b-');
  writeFileSync(join(early, 'codex.cmd'), '@echo off\r\n');
  writeFileSync(join(late, 'codex.exe'), 'MZ');
  writeFileSync(join(early, 'only.bat'), '@echo off\r\n');
  const PATH = [early, late].join(delimiter);
  // The .exe in a later folder wins over the .cmd in an earlier one.
  assert.deepEqual(onPath('codex', 'win32', PATH), { found: join(late, 'codex.exe') });
  assert.deepEqual(onPath('only', 'win32', PATH), { batch: join(early, 'only.bat') });
  assert.equal(onPath('none', 'win32', PATH), null);
  // Elsewhere: the name as it is.
  assert.equal(onPath('codex', 'linux', PATH), null);

  const lines: string[] = [];
  const log = (line: string): void => void lines.push(line);
  assert.deepEqual(nudgeProgram('codex', '/nowhere', { platform: 'win32', path: PATH, log }), { command: join(late, 'codex.exe'), args: [] });
  assert.equal(nudgeProgram('only', '/nowhere', { platform: 'win32', path: PATH, log }), null);
  assert.equal(nudgeProgram([join(early, 'codex.cmd')], '/nowhere', { platform: 'win32', path: PATH, log }), null);
  // A later candidate still counts after a batch file was passed over.
  assert.deepEqual(nudgeProgram(['only', 'codex'], '/nowhere', { platform: 'win32', path: PATH, log }), { command: join(late, 'codex.exe'), args: [] });
  assert.equal(lines.length, 3);
  for (const line of lines) assert.match(line, /\.(cmd|bat) script, which Node runs only through a shell; not run/);
});

test('nudgeSession: Antigravity sends the message to the conversation through agentapi, as before', async () => {
  const dir = home({ 'hub_7.json': { pid: 77, httpPort: 7, csrfToken: 'tok' } });
  const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const run: NudgeRun = async (command, args, env) => {
    calls.push({ command, args, env });
    return null;
  };
  process.env.OPEN_ARTIFACT_ANTIGRAVITY_AGENTAPI = '/bin/agentapi-test';
  try {
    const url = 'open-artifact://artifact/art_1';
    assert.equal(await nudgeSession({ harness: 'antigravity', session: 'conv-1', workspace: null }, url, { home: dir, alive: () => true, run }), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.command, '/bin/agentapi-test');
    assert.deepEqual(calls[0]!.args, ['send-message', 'conv-1', nudgeText(url)]);
    assert.equal(calls[0]!.env.ANTIGRAVITY_LS_ADDRESS, '127.0.0.1:7');
    assert.equal(calls[0]!.env.ANTIGRAVITY_CSRF_TOKEN, 'tok');

    // Other harnesses, no session, the app not running, a failing command: no nudge.
    assert.equal(await nudgeSession({ harness: 'claude-code', session: 's', workspace: null }, url, { home: dir, alive: () => true, run }), false);
    assert.equal(await nudgeSession({ harness: 'antigravity', session: null, workspace: '/w' }, url, { home: dir, alive: () => true, run }), false);
    assert.equal(await nudgeSession({ harness: 'antigravity', session: 'conv-1', workspace: null }, url, { home: dir, alive: () => false, run }), false);
    // A session id an argument parser could take for an option is never passed on.
    assert.equal(await nudgeSession({ harness: 'antigravity', session: '--help', workspace: null }, url, { home: dir, alive: () => true, run }), false);
    assert.equal(calls.length, 1);
    const failing: NudgeRun = async () => new Error('exit 1');
    assert.equal(await nudgeSession({ harness: 'antigravity', session: 'conv-1', workspace: null }, url, { home: dir, alive: () => true, run: failing }), false);
  } finally {
    delete process.env.OPEN_ARTIFACT_ANTIGRAVITY_AGENTAPI;
  }
});

test('nudgeSession: Codex queues the message for a thread, as before', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const run: NudgeRun = async (command, args) => {
    calls.push({ command, args });
    return null;
  };
  process.env.OPEN_ARTIFACT_CODEX_BIN = '/bin/codex-test';
  try {
    const url = 'open-artifact://artifact/art_2';
    assert.equal(await nudgeSession({ harness: 'codex', session: 'thread-1', workspace: '/w' }, url, { run }), true);
    assert.deepEqual(calls, [{ command: '/bin/codex-test', args: ['queue', '--thread', 'thread-1', '--message', nudgeText(url)] }]);
    assert.equal(await nudgeSession({ harness: 'codex', session: null, workspace: '/w' }, url, { run }), false);
    assert.equal(await nudgeSession({ harness: 'codex', session: 'thread-1', workspace: null }, url, { run: async () => new Error('exit 2') }), false);
    assert.equal(calls.length, 1);
  } finally {
    delete process.env.OPEN_ARTIFACT_CODEX_BIN;
  }
});

test('a nudge comes from the person\'s own profile or the shipped one, never from what an adapter reported', async () => {
  const dir = join(TEST_HOME, 'harnesses');
  const logs: string[] = [];
  try {
    // The adapter of a harness with no shipped nudge reports one: dropped when saved, and ignored if written in by hand.
    const saved = saveAdapterProfile('evil', { title: 'Evil', nudge: { command: '/bin/sh', args: ['-c', 'echo pwned'] } });
    assert.ok(saved.dropped.includes('nudge'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'evil.json'), JSON.stringify({ name: 'evil', source: 'adapter', nudge: { command: '/bin/sh', args: ['-c', 'echo pwned'] } }));
    assert.equal(nudgeOf('evil', (line) => logs.push(line)), null);
    assert.match(logs.join('\n'), /never run/);
    const ran: string[] = [];
    assert.equal(await nudgeSession({ harness: 'evil', session: 's', workspace: null }, 'u', { run: async (command) => (ran.push(command), null) }), false);
    assert.deepEqual(ran, []);
    // An adapter's profile of a shipped harness: the shipped nudge, not one of its own.
    writeFileSync(join(dir, 'codex.json'), JSON.stringify({ name: 'codex', source: 'adapter', nudge: { command: '/bin/sh', args: ['x'] } }));
    assert.deepEqual(nudgeOf('codex')?.args, ['queue', '--thread', '${session}', '--message', '${text}']);

    // The person's own profile: its nudge runs, with the arguments filled in as an argument list.
    addUserProfile({ name: 'mine', title: 'Mine', nudge: { command: '/opt/mine/bin/wake', args: ['--to', '${session}', '${text}'] } });
    const calls: Array<{ command: string; args: string[] }> = [];
    const program = nudgeOf('mine');
    assert.ok(program);
    const run: NudgeRun = async (command, args) => (calls.push({ command, args }), null);
    // The program does not exist here: nothing runs.
    assert.equal(await nudgeSession({ harness: 'mine', session: 'm 1', workspace: null }, 'u', { run }), false);
    assert.equal(await nudgeSession({ harness: 'mine', session: 'm 1', workspace: null }, 'u', { run, nudgeOf: () => ({ ...program, command: process.execPath }) }), true);
    assert.deepEqual(calls, [{ command: process.execPath, args: ['--to', 'm 1', nudgeText('u')] }]);
    // A nudge that is not { command, args } is refused when added.
    assert.throws(() => addUserProfile({ name: 'broken', nudge: { command: 'x' } }), /nudge/);
    assert.throws(() => addUserProfile({ name: 'broken', nudge: 'rm -rf /' }), /nudge/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
