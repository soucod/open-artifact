/**
 * The `open-artifact` command line against the real host: `remote add` (the browser is not opened; the person approves
 * through the host's approval route), `remote list`, `remote status`, `publish` by id and by folder, `unpublish` and
 * `remote remove`. The CLI runs as its own process (`bin/open-artifact.ts`) and finds this process's daemon through
 * the temporary `OPEN_ARTIFACT_HOME` the test helpers set.
 */

import { tempDir, TEST_HOME, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { artifactIdOf, type DaemonState, type ToolCallResult } from '@open-artifact/protocol';
import type { UserRecord } from '../../host/src/core/types.ts';
import { api, readDaemon } from '../src/client.ts';
import { saveSettings } from '../src/settings.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { startRealHost, type RealHost } from './real-host.ts';

process.env.OPEN_ARTIFACT_LINK_RETRY_MS = '100';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));
const caller = { harness: 'dsh', session: 'cli-1', workspace: tempDir('open-artifact-ws-') };

let real: RealHost;
let ada: UserRecord;
let adaCookie: string;
let daemon: Daemon;
let state: DaemonState;
/** The pages the daemon "opened" in the browser. */
const browsed: string[] = [];

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI; `onStderr` sees its error output as it comes (the sign-in code is printed there). `env` adds variables
 * (an agent app's session variable, to run it as an agent would).
 */
function cli(args: string[], onStderr?: (text: string) => void, env: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, OPEN_ARTIFACT_HOME: TEST_HOME, OPEN_ARTIFACT_BROWSER: 'none', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      onStderr?.(stderr);
    });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

const tool = (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => api<ToolCallResult>(state, 'tools.call', { name, arguments: args, caller });

async function whiteboard(title: string): Promise<{ id: string; root: string }> {
  const made = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  const id = artifactIdOf(String(made.url))!;
  return { id, root: daemon.store.require(id).root };
}

before(async () => {
  real = await startRealHost();
  ({ user: ada, cookie: adaCookie } = await real.person('Ada', 'ada@example.com'));
  const shellDir = tempDir('open-artifact-shell-');
  // The browser: recorded, never really opened.
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: `${shellDir}/no-home`, browse: (url) => (browsed.push(url), true) });
  state = (await readDaemon())!;
});

after(async () => {
  daemon?.close();
  await real?.stop();
});

test('remote add: the CLI prints the code, the person approves on the host, the CLI says who it linked', async () => {
  let approving: Promise<unknown> | null = null;
  const run = await cli(['remote', 'add', 'cloud', real.app], (text) => {
    const code = /shows the code (\S+?),/.exec(text)?.[1];
    if (code && !approving) approving = real.decide(adaCookie, code);
  });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(approving, run.stderr);
  // The daemon opened the approval page in the browser, and the CLI says so.
  assert.match(run.stderr, new RegExp(`^Opened ${real.app}/link/device\\?`, 'm'));
  assert.equal(browsed.length, 1);
  assert.equal(run.stdout.trim(), `Linked cloud (${real.app}) as ada@example.com.`);
  await until(() => real.host.link.presence.online(ada.id), 10_000);
});

test('remote add --no-browser opens nothing: it prints the address and the code', async () => {
  const before = browsed.length;
  let approving: Promise<unknown> | null = null;
  const run = await cli(['remote', 'add', 'spare', real.app, '--no-browser'], (text) => {
    const code = /shows the code (\S+?),/.exec(text)?.[1];
    if (code && !approving) approving = real.decide(adaCookie, code);
  });
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stderr, new RegExp(`^Open ${real.app}/link/device\\?\\S+ in a browser where you are signed in to the site, check that it shows the code `, 'm'));
  assert.equal(browsed.length, before, 'no browser was opened');
  assert.equal(run.stdout.trim(), `Linked spare (${real.app}) as ada@example.com.`);
  const removed = await cli(['remote', 'remove', 'spare']);
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(removed.stdout.trim(), 'Removed the site spare: this computer no longer publishes or syncs there.\nPublishing without --remote now uses cloud.');
});

test('remote list and remote status show the signed-in remote', async () => {
  const list = await cli(['remote', 'list']);
  assert.equal(list.code, 0, list.stderr);
  assert.equal(list.stdout.trim(), `cloud\t${real.app}\tada@example.com\t0 published\tdefault`);
  // In words by default; the daemon's answer with --json.
  const text = await cli(['remote', 'status']);
  assert.equal(text.code, 0, text.stderr);
  assert.equal(text.stdout.trim(), `cloud (${real.app}): signed in as ada@example.com, connected\n  nothing published`);
  const status = await cli(['remote', 'status', '--json']);
  assert.equal(status.code, 0, status.stderr);
  const remotes = JSON.parse(status.stdout) as { remotes: Array<{ name: string; signedIn: boolean; reachable: boolean; note?: string; lastError: string | null; code: string | null }> };
  assert.equal(remotes.remotes[0]?.name, 'cloud');
  assert.equal(remotes.remotes[0]?.signedIn, true);
  assert.equal(remotes.remotes[0]?.reachable, true);
  assert.equal(remotes.remotes[0]?.note, undefined);
  assert.equal(remotes.remotes[0]?.lastError, null);
  assert.equal(remotes.remotes[0]?.code, null);
});

/** The refusal's two lines: what was not done, and the sentence an agent acts on. */
const REFUSED = /is the person's decision, and this command runs inside an agent session \((\S+): (\w+) is set\), so it was not done\.\nAsk the person to .+, or to run `open-artifact .+` in their own terminal\.\n$/;

test('inside an agent session publish, unpublish and the remote changes are refused, with what to do instead', async () => {
  const board = await whiteboard('Agent tried');
  // Every command, under Claude Code's marker.
  const commands = [
    ['publish', board.id],
    ['publish', board.root, '--remote', 'cloud'],
    ['unpublish', board.id],
    ['remote', 'add', 'other', real.app],
    ['remote', 'remove', 'cloud', '--force'],
    ['remote', 'default', 'cloud'],
    ['remote', 'default', '--clear'],
    ['remote', 'auto', 'on'],
    ['remote', 'auto', 'off'],
  ];
  for (const args of commands) {
    const run = await cli(args, undefined, { CLAUDECODE: '1' });
    assert.equal(run.code, 1, `${args.join(' ')}: ${run.stdout}${run.stderr}`);
    assert.match(run.stderr, REFUSED, args.join(' '));
    assert.equal(run.stdout, '');
  }
  // Publish under each harness profile's own session variable.
  for (const [variable, harness] of [
    ['CLAUDE_CODE_SESSION_ID', 'claude-code'],
    ['CODEX_THREAD_ID', 'codex'],
    ['ANTIGRAVITY_CONVERSATION_ID', 'antigravity'],
    ['ANTIGRAVITY_AGENT', 'antigravity'],
  ] as const) {
    const run = await cli(['publish', board.id], undefined, { [variable]: 'session-1' });
    assert.equal(run.code, 1, run.stdout + run.stderr);
    assert.deepEqual(REFUSED.exec(run.stderr)?.slice(1, 3), [harness, variable]);
  }
  // Nothing happened: still local, still linked, the default and auto-publish as they were.
  assert.equal(daemon.store.require(board.id).remote ?? null, null);
  const list = await cli(['remote', 'list']);
  assert.equal(list.stdout.trim(), `cloud	${real.app}	ada@example.com	0 published	default`);
  assert.equal(daemon.link.cloudStatus().publish, 'manual');
});

test('agentMayPublish on a remote lets an agent session publish and unpublish there, logged with its session; the rest stays refused', async () => {
  const board = await whiteboard('Agent allowed');
  saveSettings({ remotes: { cloud: { agentMayPublish: true } } });
  try {
    let run = await cli(['publish', board.id], undefined, { CODEX_THREAD_ID: 'thread-7' });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout.trim(), `Published to cloud: ${real.app}/a/${board.id}`);
    run = await cli(['remote', 'auto', 'on'], undefined, { CODEX_THREAD_ID: 'thread-7' });
    assert.equal(run.code, 1);
    assert.match(run.stderr, REFUSED);
    run = await cli(['unpublish', board.id], undefined, { CODEX_THREAD_ID: 'thread-7' });
    assert.equal(run.code, 0, run.stderr);
    const log = readFileSync(join(TEST_HOME, 'logs', 'daemon.log'), 'utf8');
    assert.match(log, new RegExp(`audit: published ${board.id} to cloud, asked by the open-artifact command line inside the agent session codex session thread-7, route artifacts\\.publish`));
    assert.match(log, new RegExp(`audit: unpublished ${board.id} from cloud, asked by the open-artifact command line inside the agent session codex session thread-7`));
  } finally {
    saveSettings({ remotes: {} });
  }
});

test('the only remote cannot stop being the default: clearing it says why and what to do instead', async () => {
  const run = await cli(['remote', 'default', '--clear']);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /cloud is the only remote, so it is always the default/);
  assert.match(run.stderr, /open-artifact remote auto off/);
  const list = await cli(['remote', 'list']);
  assert.match(list.stdout, /	default$/m);
});

test('a dashboard with live queries published without a terminal goes up without its rows, and says how to add them', async () => {
  const root = join(tempDir('open-artifact-dash-'), 'sales-and-signups');
  cpSync(fileURLToPath(new URL('../../../test-artifacts/data/sales-and-signups', import.meta.url)), root, { recursive: true });
  const id = daemon.store.create({ root, type: 'data', title: 'Sales and signups' }).id;
  // The test's pipes are not a terminal: no question, no rows.
  let run = await cli(['publish', id]);
  assert.equal(run.code, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines[0], `Published to cloud: ${real.app}/a/${id}`);
  assert.match(lines[1] ?? '', new RegExp(`^Its live data was not published: .+\\("Publish its data"\\) or with \`open-artifact publish ${id}\` in their own terminal, which asks\\.$`));
  assert.notEqual(daemon.store.require(id).dataPublish, true);
  // Publishing it again (already published, no site named) is fine and still leaves the rows out.
  run = await cli(['publish', id]);
  assert.equal(run.code, 0, run.stderr);
  assert.notEqual(daemon.store.require(id).dataPublish, true);
  run = await cli(['unpublish', id]);
  assert.equal(run.code, 0, run.stderr);
});

test('publish by id and by folder, unpublish, then remote remove (refused while published, unless forced)', async () => {
  const byId = await whiteboard('By id');
  const byFolder = await whiteboard('By folder');

  let run = await cli(['publish', byId.id]);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout.trim(), `Published to cloud: ${real.app}/a/${byId.id}`);
  run = await cli(['publish', byFolder.root, '--remote', 'cloud']);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout.trim(), `Published to cloud: ${real.app}/a/${byFolder.id}`);
  assert.equal((await real.host.catalog.getArtifact(byFolder.id))?.title, 'By folder');

  // A folder that holds an artifact the daemon does not know yet (a doc copied in, never adopted) is added, then
  // published; its title is the doc's own name, not the folder's.
  const loose = join(tempDir('open-artifact-loose-'), 'docs-browser-qa');
  cpSync(fileURLToPath(new URL('../../../test-artifacts/docs/browser-qa', import.meta.url)), loose, { recursive: true });
  run = await cli(['publish', loose]);
  assert.equal(run.code, 0, run.stderr);
  const added = daemon.store.byRoot(loose);
  assert.ok(added, 'the folder was not added');
  assert.equal(run.stdout.trim(), `Added ${loose} as open-artifact://artifact/${added.id} (docs, "Docs Browser QA").\nPublished to cloud: ${real.app}/a/${added.id}`);
  assert.equal((await real.host.catalog.getArtifact(added.id))?.title, 'Docs Browser QA');
  // A folder that holds no artifact is refused as before, with how to make it one.
  const plain = tempDir('open-artifact-plain-');
  writeFileSync(join(plain, 'notes.txt'), 'not an artifact');
  run = await cli(['publish', plain]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, new RegExp(`No artifact in ${plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`));
  assert.match(run.stderr, /"action":"adopt"/);
  assert.equal(daemon.store.byRoot(plain), null);

  run = await cli(['remote', 'list']);
  assert.match(run.stdout, /\t3 published\tdefault$/m);

  run = await cli(['unpublish', byId.id]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`^Unpublished open-artifact://artifact/${byId.id}; it opens at ${state.url}`));
  assert.ok((await real.host.catalog.getArtifact(byId.id))?.trashedAt);

  run = await cli(['remote', 'remove', 'cloud']);
  assert.equal(run.code, 1);
  assert.match(run.stderr, new RegExp(byFolder.id));
  run = await cli(['remote', 'remove', 'cloud', '--force', '--json']);
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).removed, 'cloud');
  assert.deepEqual([...JSON.parse(run.stdout).unlinked].sort(), [byFolder.id, daemon.store.byRoot(loose)!.id].sort());
  run = await cli(['remote', 'list']);
  assert.match(run.stdout, /^No remotes\./);
  assert.equal(daemon.store.require(byFolder.id).remote ?? null, null);
});
