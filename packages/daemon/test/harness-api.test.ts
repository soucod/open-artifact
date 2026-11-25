import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, test } from 'node:test';
import { HARNESS_PATH, HARNESS_SUBPROTOCOL, PROTOCOL_MAX, PROTOCOL_MIN, RPC_ERRORS, rpcErrorCode, type DaemonState, type HelloResult } from '@open-artifact/protocol';
import { readDaemon } from '../src/client.ts';
import { BOOT_PLACEHOLDER, startDaemon, type Daemon } from '../src/daemon.ts';
import { HARNESS_FEATURES, negotiateProtocol } from '../src/harness-features.ts';
import { harnessProfile, listProfiles, saveAdapterProfile, sanitizeAdapterProfile } from '../src/harness-profiles.ts';
import { HarnessHub, type AdapterConnection } from '../src/harness.ts';
import { Inbox } from '../src/inbox.ts';
import { files } from '../src/paths.ts';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));
/** Shipped profiles of these tests' own, so a profile written here never meets a real one. */
const SHIPPED = tempDir('open-artifact-shipped-');
process.env.OPEN_ARTIFACT_HARNESS_PROFILES = SHIPPED;
writeFileSync(
  join(SHIPPED, 'shipped-app.json'),
  JSON.stringify({ name: 'shipped-app', title: 'Shipped App', agentName: 'Shippy', level: 'L2', entry: 'mcp', wake: ['inbox'], sessionEnv: 'SHIPPED_SESSION', nudge: { command: 'shipped-nudge', args: [] } }),
);

const TOKEN = 'test-token';

function hub(): HarnessHub {
  return new HarnessHub({
    token: TOKEN,
    version: '9.9.9',
    tools: { definitions: () => [], call: async () => ({ content: [] }), agentWrote: () => ({ artifacts: [] }) },
    inbox: new Inbox(),
    log: () => undefined,
    openArtifact: async () => ({ opened: false }),
    browse: null,
  });
}

/** A connection for {@link HarnessHub.handle}, with nothing on the other end. */
function connection(): AdapterConnection {
  return {
    id: 'c1',
    harness: null,
    caps: {},
    authed: false,
    subscribed: false,
    polling: false,
    sessions: new Map(),
    call: (async () => null) as AdapterConnection['call'],
    notify: () => undefined,
    close: () => undefined,
    terminate: () => undefined,
  };
}

const profileFile = (name: string): string => join(files.harnesses(), `${name}.json`);

beforeEach(() => rmSync(files.harnesses(), { recursive: true, force: true }));

// ---- negotiation and features ----

test('negotiation: a hello without protocols is protocol 1', () => {
  assert.equal(negotiateProtocol(undefined), 1);
});

test('negotiation: overlapping ranges answer the highest common version', () => {
  assert.equal(negotiateProtocol({ min: 1, max: 1 }), 1);
  assert.equal(negotiateProtocol({ min: PROTOCOL_MIN, max: PROTOCOL_MAX + 5 }), PROTOCOL_MAX);
});

test('negotiation: no overlap says which side must upgrade', () => {
  assert.throws(() => negotiateProtocol({ min: PROTOCOL_MAX + 1, max: PROTOCOL_MAX + 3 }), (error: Error & { code?: string; fix?: string }) => {
    assert.equal(error.code, 'unsupported_protocol');
    assert.match(error.fix ?? '', /runtime|daemon/i);
    return true;
  });
  if (PROTOCOL_MIN > 1) {
    assert.throws(() => negotiateProtocol({ min: 1, max: PROTOCOL_MIN - 1 }), /adapter/i);
  }
  assert.throws(() => negotiateProtocol({ min: 2, max: 1 }), (error: Error & { code?: string }) => error.code === 'invalid_argument');
  assert.throws(() => negotiateProtocol({ min: 'one' }), (error: Error & { code?: string }) => error.code === 'invalid_argument');
});

test('hello: answers the negotiated protocol and the features list; no overlap is refused', async () => {
  const h = hub();
  try {
    const old = (await h.handle(connection(), 'hello', { harness: 'old-app', token: TOKEN })) as HelloResult;
    assert.equal(old.protocol, 1);
    assert.equal(old.daemon, '9.9.9');
    assert.deepEqual(old.features, [...HARNESS_FEATURES]);
    const ranged = (await h.handle(connection(), 'hello', { harness: 'new-app', token: TOKEN, protocols: { min: 1, max: 99 } })) as HelloResult;
    assert.equal(ranged.protocol, PROTOCOL_MAX);
    const conn = connection();
    await assert.rejects(h.handle(conn, 'hello', { harness: 'future-app', token: TOKEN, protocols: { min: 99, max: 100 } }), /speaks Harness API/);
    assert.equal(conn.authed, false, 'a refused hello does not authorize the connection');
  } finally {
    h.close();
  }
});

test('features: only implemented features are listed', () => {
  for (const done of ['hello.profile', 'embed.origins', 'shell.command', 'shell.event', 'view.context', 'skill.get', 'commands.list', 'session.may', 'tools.actions', 'quickstart.steps', 'types.remote']) {
    assert.ok(HARNESS_FEATURES.includes(done as never), `${done} is implemented and listed`);
  }
});

test('skill.get and commands.list answer; an unknown method is method_not_found', async () => {
  const h = hub();
  try {
    const conn = connection();
    await h.handle(conn, 'hello', { harness: 'stub-app', token: TOKEN });
    const skill = (await h.handle(conn, 'skill.get', {})) as { name: string; etag: string };
    assert.equal(skill.name, 'open-artifact');
    assert.match(skill.etag, /^[0-9a-f]{16}$/);
    // The hub's fake tools list no types: no command entries.
    assert.deepEqual(await h.handle(conn, 'commands.list', {}), { commands: [] });
    await assert.rejects(h.handle(conn, 'no.such.method', {}), (error: Error & { code?: string }) => error.code === 'method_not_found');
  } finally {
    h.close();
  }
});

test('session.attach: keeps may and role on the session record', async () => {
  const h = hub();
  try {
    const conn = connection();
    await h.handle(conn, 'hello', { harness: 'may-app', token: TOKEN });
    const { key } = (await h.handle(conn, 'session.attach', { session: 's1', workspace: '/w', may: { create: false, reply: true, bogus: 1 }, role: 'reviewer' })) as { key: string };
    const session = h.sessions.get(key)!;
    assert.deepEqual(session.may, { create: false, reply: true });
    assert.equal(session.role, 'reviewer');
    const { key: plain } = (await h.handle(conn, 'session.attach', { session: 's2', workspace: '/w' })) as { key: string };
    assert.equal(h.sessions.get(plain)!.may, undefined);
    assert.equal(h.sessions.get(plain)!.role, undefined);
  } finally {
    h.close();
  }
});

// ---- profiles ----

test('profile: hello.profile is saved with source "adapter", without nudge or anything that runs a command', async () => {
  const h = hub();
  try {
    await h.handle(connection(), 'hello', {
      harness: 'adapter-app',
      token: TOKEN,
      profile: {
        name: 'someone-else',
        agentName: 'Helper',
        commands: ['artifact'],
        rules: 'Ask before publishing.',
        markers: ['ADAPTER_APP'],
        nudge: { command: 'rm', args: ['-rf', '/'] },
        mcp: { command: 'evil', args: [] },
        skillsDir: '/etc',
        source: 'user',
        policy: { offer: 'allowed', confirm: ['remove'] },
        caps: { tools: 'native', open: { embed: 'frame', origins: ['app://adapter'] } },
        level: 'L9',
      },
    });
    const saved = JSON.parse(readFileSync(profileFile('adapter-app'), 'utf8'));
    assert.equal(saved.source, 'adapter');
    assert.equal(saved.name, 'adapter-app');
    assert.equal(saved.agentName, 'Helper');
    assert.deepEqual(saved.commands, ['artifact']);
    assert.deepEqual(saved.policy, { offer: 'allowed', confirm: ['remove'] });
    assert.deepEqual(saved.caps, { tools: 'native', open: { embed: 'frame', origins: ['app://adapter'] } });
    for (const dropped of ['nudge', 'mcp', 'skillsDir', 'level']) assert.equal(saved[dropped], undefined, dropped);
    const profile = harnessProfile('adapter-app');
    assert.equal(profile.source, 'adapter');
    assert.equal(profile.agentName, 'Helper');
    assert.equal(profile.nudge, undefined);
  } finally {
    h.close();
  }
});

test('profile: rules longer than the limit and malformed fields are dropped', () => {
  const { profile, dropped } = sanitizeAdapterProfile({
    rules: 'x'.repeat(5000),
    markers: ['not a variable'],
    commands: ['/artifact'],
    toolNames: { Artifact: 'oa_artifact', Nope: 'x' },
    hookDialect: 'claude-code',
    wake: ['live'],
  });
  assert.deepEqual(profile, { hookDialect: 'claude-code', wake: ['live'] });
  assert.deepEqual(dropped.sort(), ['commands', 'markers', 'rules', 'toolNames']);
});

test('profile: an adapter never overwrites the person’s own file', () => {
  mkdirSync(files.harnesses(), { recursive: true });
  writeFileSync(profileFile('mine'), JSON.stringify({ name: 'mine', title: 'Mine', agentName: 'Mine Agent' }));
  const result = saveAdapterProfile('mine', { agentName: 'Adapter Agent' });
  assert.equal(result.saved, false);
  assert.equal(result.reason, 'user_file');
  assert.equal(JSON.parse(readFileSync(profileFile('mine'), 'utf8')).agentName, 'Mine Agent');
  writeFileSync(profileFile('mine'), JSON.stringify({ name: 'mine', agentName: 'Mine Agent', source: 'user' }));
  assert.equal(saveAdapterProfile('mine', { agentName: 'Adapter Agent' }).reason, 'user_file');
  // An adapter's own earlier file is updated, and left alone when nothing changed.
  assert.equal(saveAdapterProfile('theirs', { agentName: 'One' }).saved, true);
  assert.equal(saveAdapterProfile('theirs', { agentName: 'One' }).reason, 'unchanged');
  assert.equal(saveAdapterProfile('theirs', { agentName: 'Two' }).saved, true);
  assert.equal(harnessProfile('theirs').agentName, 'Two');
});

test('profile: precedence is the person’s file, then the adapter’s over the shipped one, then the shipped one', () => {
  // Shipped only.
  let profile = harnessProfile('shipped-app');
  assert.equal(profile.source, 'shipped');
  assert.equal(profile.agentName, 'Shippy');
  assert.deepEqual(profile.nudge, { command: 'shipped-nudge', args: [] });
  // The adapter's lies over the shipped one: its fields win, the shipped ones it leaves out stay (nudge included).
  saveAdapterProfile('shipped-app', { agentName: 'Reported', nudge: { command: 'evil', args: [] } });
  profile = harnessProfile('shipped-app');
  assert.equal(profile.source, 'adapter');
  assert.equal(profile.agentName, 'Reported');
  assert.equal(profile.sessionEnv, 'SHIPPED_SESSION');
  assert.deepEqual(profile.nudge, { command: 'shipped-nudge', args: [] });
  // A nudge written into the adapter's file by hand is still not read.
  writeFileSync(profileFile('shipped-app'), JSON.stringify({ name: 'shipped-app', source: 'adapter', nudge: { command: 'evil', args: [] } }));
  assert.deepEqual(harnessProfile('shipped-app').nudge, { command: 'shipped-nudge', args: [] });
  // The person's own file replaces both.
  writeFileSync(profileFile('shipped-app'), JSON.stringify({ name: 'shipped-app', title: 'Person', agentName: 'Personal' }));
  profile = harnessProfile('shipped-app');
  assert.equal(profile.source, 'user');
  assert.equal(profile.agentName, 'Personal');
  assert.equal(profile.sessionEnv, undefined);
  // Nothing anywhere: the default.
  assert.equal(harnessProfile('nobody-app').source, undefined);
  assert.equal(harnessProfile('nobody-app').entry, 'mcp');
});

test('profile: listProfiles names each profile’s source', () => {
  saveAdapterProfile('listed-adapter', { agentName: 'A' });
  const list = listProfiles();
  assert.equal(list.find((p) => p.name === 'shipped-app')?.source, 'shipped');
  assert.equal(list.find((p) => p.name === 'listed-adapter')?.source, 'adapter');
});

// ---- the harness command ----

function cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, OPEN_ARTIFACT_HOME: TEST_HOME, OPEN_ARTIFACT_HARNESS_PROFILES: SHIPPED },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

test('harness add | list | remove: the person’s profiles in <home>/harnesses', async () => {
  const dir = tempDir('open-artifact-profile-');
  const file = join(dir, 'mine.json');
  writeFileSync(file, JSON.stringify({ name: 'cli-app', title: 'CLI App', agentName: 'Clippy', nudge: { command: 'cli-app', args: ['resume', '${session}'] } }));
  saveAdapterProfile('cli-app', { agentName: 'From adapter' });

  const added = await cli(['harness', 'add', file]);
  assert.equal(added.code, 0, added.stderr);
  assert.match(added.stdout, /cli-app/);
  assert.match(added.stdout, /adapter reported/);
  const saved = JSON.parse(readFileSync(profileFile('cli-app'), 'utf8'));
  assert.equal(saved.source, 'user');
  assert.deepEqual(saved.nudge, { command: 'cli-app', args: ['resume', '${session}'] }, 'the person’s own file may say how to nudge');
  assert.equal(harnessProfile('cli-app').agentName, 'Clippy');

  const listed = await cli(['harness', 'list', '--json']);
  assert.equal(listed.code, 0, listed.stderr);
  const list = JSON.parse(listed.stdout) as Array<{ name: string; source: string }>;
  assert.equal(list.find((p) => p.name === 'cli-app')?.source, 'user');
  assert.equal(list.find((p) => p.name === 'shipped-app')?.source, 'shipped');
  const text = await cli(['harness', 'list']);
  assert.match(text.stdout, /cli-app\s+user\s+CLI App/);

  const removed = await cli(['harness', 'remove', 'cli-app']);
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(existsSync(profileFile('cli-app')), false);

  // A shipped profile is never removed; a bad file or name is refused.
  const shipped = await cli(['harness', 'remove', 'shipped-app']);
  assert.notEqual(shipped.code, 0);
  assert.match(shipped.stderr, /shipped/);
  assert.ok(existsSync(join(SHIPPED, 'shipped-app.json')));
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ title: 'No name' }));
  const bad = await cli(['harness', 'add', join(dir, 'bad.json')]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /name/);
});

// ---- over the wire ----

let daemon: Daemon;
let state: DaemonState;

before(async () => {
  const shellDir = tempDir('open-artifact-shell-');
  writeFileSync(join(shellDir, 'index.html'), `<!doctype html><script>window.__OPEN_ARTIFACT_BOOT__ = ${BOOT_PLACEHOLDER};</script>`);
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: join(shellDir, 'no-home') });
  state = (await readDaemon())!;
});

after(() => daemon.close());

test('Harness API: skill.get answers, an unknown method is JSON-RPC methodNotFound over the socket', async () => {
  const ws = new WebSocket(`${state.url.replace(/^http/, 'ws')}${HARNESS_PATH}`, [HARNESS_SUBPROTOCOL]);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', () => resolveOpen(), { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('no connection')), { once: true });
  });
  const answers = new Map<number, { result?: unknown; error?: { code: number; data?: { code?: string } } }>();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id === 'number') answers.set(message.id, message);
  });
  const call = async (id: number, method: string, params: unknown) => {
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    for (let i = 0; i < 200 && !answers.has(id); i++) await new Promise((done) => setTimeout(done, 10));
    return answers.get(id)!;
  };
  try {
    const hello = await call(1, 'hello', { harness: 'wire-app', token: state.token, protocols: { min: 1, max: 3 } });
    assert.deepEqual(hello.result, { protocol: 1, daemon: (hello.result as HelloResult).daemon, connection: (hello.result as HelloResult).connection, features: [...HARNESS_FEATURES] });
    const skill = await call(2, 'skill.get', { form: 'entry' });
    assert.equal((skill.result as { name?: string }).name, 'open-artifact');
    const unknown = await call(4, 'no.such.method', {});
    assert.equal(unknown.error?.code, RPC_ERRORS.methodNotFound);
    assert.equal(unknown.error?.data?.code, 'method_not_found');
    // invalid_argument has JSON-RPC's invalidParams number, as on the stdio bridge (stdio-bridge.test.ts).
    const bad = await call(5, 'session.attach', {});
    assert.equal(bad.error?.data?.code, 'invalid_argument');
    assert.equal(bad.error?.code, RPC_ERRORS.invalidParams);
    assert.equal(bad.error?.code, rpcErrorCode('invalid_argument'));
    // Implemented now: an unknown artifact is not_found, not methodNotFound.
    const view = await call(3, 'view.context', { url: 'open-artifact://artifact/x' });
    assert.equal(view.error?.data?.code, 'not_found');
  } finally {
    ws.close();
  }
});
