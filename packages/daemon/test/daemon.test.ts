import { TEST_HOME, tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';
import {
  HARNESS_PATH,
  HARNESS_SUBPROTOCOL,
  LIBRARY_ROUTES,
  artifactIdOf,
  type DaemonState,
  type ShellBoot,
  type ToolCallResult,
  type WakeDeliverParams,
} from '@open-artifact/protocol';
import { HarnessClient, api, readDaemon } from '../src/client.ts';
import { BOOT_PLACEHOLDER, startDaemon, type Daemon } from '../src/daemon.ts';
import { harnessProfile } from '../src/harness.ts';
import { networkPermission } from '../src/mcp-app.ts';
import { files } from '../src/paths.ts';
import { sessionKeyOf } from '../src/store.ts';

let daemon: Daemon;
let state: DaemonState;
const shellDir = tempDir('open-artifact-shell-');
const workspace = tempDir('open-artifact-ws-');

before(async () => {
  writeFileSync(join(shellDir, 'index.html'), `<!doctype html><title>shell</title><script>window.__OPEN_ARTIFACT_BOOT__ = ${BOOT_PLACEHOLDER};</script>`);
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: join(shellDir, 'no-home') });
  state = (await readDaemon())!;
});

after(() => daemon.close());

/** POST /mcp with the daemon token. */
async function mcp(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${state.url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}`, ...headers },
    body: JSON.stringify(body),
  });
}

/** Creates a `design` artifact through the tools as `harness`/`session`. */
async function createDesign(title: string, session: string, harness = 'dsh'): Promise<string> {
  const made = await api<ToolCallResult>(state, 'tools.call', {
    name: 'Artifact',
    arguments: { action: 'publish', type_url: 'open-artifact://type/design', title },
    caller: { harness, session, workspace },
  });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  return artifactIdOf(String(made.url))!;
}

test('daemon.json and health', async () => {
  const written = JSON.parse(readFileSync(files.daemon(), 'utf8')) as DaemonState;
  assert.equal(written.port, daemon.port);
  assert.ok(files.daemon().startsWith(TEST_HOME));
  const health = await (await fetch(`${state.url}/__open-artifact/health`)).json();
  // nodeChildren: how type servers run; plain Node runs child processes.
  assert.deepEqual(health, { openArtifact: 1, version: written.version, nodeChildren: { mode: 'process', reason: 'node', detail: 'plain Node.js runs child processes' } });
});

test('MCP: tools/list needs the token and lists the tools', async () => {
  const refused = await fetch(`${state.url}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  assert.equal(refused.status, 401);
  const response = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };
  const names = body.result.tools.map((t) => t.name);
  for (const name of ['Artifact', 'ArtifactData', 'ArtifactComments']) assert.ok(names.includes(name), name);
  assert.ok(!names.includes('ShowArtifact'), 'ShowArtifact is only for clients that show MCP Apps');
});

test('MCP Apps: the view asks for the network permission its frame needs', () => {
  for (const origin of ['http://127.0.0.1:4800', 'http://127.1.2.3:80', 'http://localhost:4800', 'http://a.frame.localhost:4800', 'http://[::1]:4800']) {
    assert.equal(networkPermission(origin), 'loopbackNetwork', origin);
  }
  for (const origin of ['http://192.168.1.5:4800', 'http://10.0.0.2', 'http://172.20.0.1', 'http://169.254.1.1', 'http://studio.local:4800', 'http://[fd00::1]:4800']) {
    assert.equal(networkPermission(origin), 'localNetwork', origin);
  }
  for (const origin of ['https://example.com', 'http://172.32.0.1', 'http://8.8.8.8', 'not a url']) assert.equal(networkPermission(origin), null, origin);
});

test('MCP Apps: a client that shows them gets ShowArtifact and the view of the live page', async () => {
  type Rpc = { result: Record<string, any>; error?: { message: string } };
  const rpc = async (method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Rpc> =>
    (await (await mcp({ jsonrpc: '2.0', id: 1, method, params }, headers)).json()) as Rpc;
  const apps = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } };

  const plain = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.equal(plain.result.capabilities.resources, undefined);
  assert.doesNotMatch(plain.result.instructions, /ShowArtifact/);
  const other = await rpc('initialize', { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/other'] } } } });
  assert.equal(other.result.capabilities.resources, undefined, 'a client that takes no mcp-app HTML gets none');
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: apps });
  assert.deepEqual(init.result.capabilities.resources, {});
  assert.match(init.result.instructions, /ShowArtifact \{url\}/);

  const ui = { 'X-Open-Artifact-UI': '1', 'X-Open-Artifact-Harness': 'dsh', 'X-Open-Artifact-Session': 'apps-1' };
  const tools = (await rpc('tools/list', {}, ui)).result.tools as Array<{ name: string; _meta?: { ui?: { resourceUri?: string } } }>;
  const show = tools.find((t) => t.name === 'ShowArtifact');
  assert.equal(show?._meta?.ui?.resourceUri, 'ui://open-artifact/view.html');

  const listed = (await rpc('resources/list', {}, ui)).result.resources as Array<{ uri: string; mimeType: string }>;
  assert.deepEqual(listed.map((r) => [r.uri, r.mimeType]), [['ui://open-artifact/view.html', 'text/html;profile=mcp-app']]);
  const view = (await rpc('resources/read', { uri: 'ui://open-artifact/view.html' }, ui)).result.contents[0];
  assert.equal(view.mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(view._meta.ui.csp.frameDomains, [state.url], 'the view frames the daemon origin, nothing else');
  assert.deepEqual(view._meta['openai/ui'], { permissions: { loopbackNetwork: {} } }, 'a host on a public origin may frame this computer');
  const listedMeta = (listed[0] as { _meta?: Record<string, unknown> })._meta;
  assert.deepEqual(listedMeta?.['openai/ui'], view._meta['openai/ui'], 'the listing declares it too');
  assert.match(view.text, /shell_hello/, 'the view knows the page showed when the Shell greets it');
  assert.match(view.text, /securitypolicyviolation/, 'the view knows when the host refuses to frame the page');
  assert.match(view.text, /ui\/initialize/);
  assert.match(view.text, /ui\/notifications\/tool-result/);
  assert.doesNotMatch(view.text, /__OPEN_ARTIFACT_VERSION__/);
  assert.match((await mcp({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'ui://nope' } }, ui).then((r) => r.json()) as Rpc).error?.message ?? '', /No resource/);

  const id = await createDesign('Shown inline', 'apps-1');
  const called = (await rpc('tools/call', { name: 'ShowArtifact', arguments: { url: `open-artifact://artifact/${id}` } }, ui)).result;
  assert.equal(called.isError, false);
  assert.equal(called.structuredContent.url, `open-artifact://artifact/${id}`);
  assert.equal(called.structuredContent.title, 'Shown inline');
  assert.equal(called.structuredContent.type, 'design');
  assert.equal(called.structuredContent.view_url, `${state.url}/a/${id}`);
  assert.match(called.structuredContent.note, /view_url/);
  const missing = (await rpc('tools/call', { name: 'ShowArtifact', arguments: { url: 'open-artifact://artifact/art_missing' } }, ui)).result;
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent, undefined);
});

test('Artifact quickstart and publish make a design artifact from the built-in root', async () => {
  const call = async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    const response = await mcp(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'Artifact', arguments: args } },
      { 'X-Open-Artifact-Harness': 'dsh', 'X-Open-Artifact-Session': 'mcp-1', 'X-Open-Artifact-Workspace': encodeURIComponent(workspace) },
    );
    const body = (await response.json()) as { result: { content: Array<{ text: string }>; isError: boolean } };
    assert.equal(body.result.isError, false, body.result.content[0]?.text);
    return JSON.parse(body.result.content[0]!.text) as ToolCallResult;
  };
  const quick = await call({ action: 'quickstart', intent: 'design' });
  const types = quick.types as Array<{ id: string; scope: string; type_url: string }>;
  assert.deepEqual(
    types.map((t) => t.id),
    ['design', 'design-system', 'slides', 'data', 'docs', 'motion', 'page', 'sheets', 'whiteboard'],
    'only allow-listed built-in types',
  );
  assert.equal(types[0]!.scope, 'builtin');

  const made = await call({ action: 'publish', type_url: types[0]!.type_url, title: 'Landing page' });
  const id = artifactIdOf(String(made.url))!;
  const record = daemon.store.require(id);
  assert.equal(record.type, 'design');
  assert.equal(record.typeSource, 'builtin');
  assert.ok(record.root.startsWith(join(workspace, 'artifacts')), record.root);
  assert.deepEqual(record.owner, { harness: 'dsh', session: 'mcp-1', workspace });
  assert.match(String(made.instructions), /# This artifact/);
  assert.ok(String(made.instructions).length > 500, 'carries the SKILL.md body');
});

test('hook: take false registers the session and leaves the messages for the next hook (Copilot\'s prompt)', async () => {
  const ref = { harness: 'copilot', session: 'copilot-take', workspace };
  const key = sessionKeyOf(ref)!;
  daemon.inbox.append(key, { kind: 'wake', text: 'Rename the board' });
  const left = await api<{ messages: string[] }>(state, 'hook', { event: 'SessionStart', ...ref, pids: [], take: false });
  assert.deepEqual(left.messages, []);
  assert.equal(daemon.inbox.count(key), 1);
  const taken = await api<{ messages: string[] }>(state, 'hook', { event: 'UserPromptSubmit', ...ref, pids: [] });
  assert.deepEqual(taken.messages, ['Rename the board']);
  assert.equal(daemon.inbox.count(key), 0);
});

test('MCP from a plugin folder: the session’s folder, from its hook or its Codex thread record', async () => {
  // Codex starts a plugin's MCP server in the plugin's folder: the bridge names no folder, only the thread in `_meta`.
  const call = async (thread: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    const response = await mcp(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'Artifact', arguments: args, _meta: { threadId: thread } } },
      { 'X-Open-Artifact-Harness': 'codex' },
    );
    const body = (await response.json()) as { result: { content: Array<{ text: string }>; isError: boolean } };
    assert.equal(body.result.isError, false, body.result.content[0]?.text);
    return JSON.parse(body.result.content[0]!.text) as ToolCallResult;
  };
  const publish = async (thread: string, title: string): Promise<string> => {
    const types = (await call(thread, { action: 'quickstart', intent: 'design' })).types as Array<{ type_url: string }>;
    const made = await call(thread, { action: 'publish', type_url: types[0]!.type_url, title });
    return daemon.store.require(artifactIdOf(String(made.url))!).root;
  };

  // A trusted hook said where the thread works.
  const hooked = tempDir('open-artifact-hooked-');
  await api(state, 'hook', { event: 'SessionStart', harness: 'codex', session: 'thread-hooked', workspace: hooked, pids: [] });
  // A later hook that does not know the folder keeps it.
  await api(state, 'hook', { event: 'Stop', harness: 'codex', session: 'thread-hooked', workspace: null, pids: [] });
  assert.ok((await publish('thread-hooked', 'Hooked')).startsWith(join(hooked, 'artifacts')));

  // No hook ran (Codex runs plugin hooks only once trusted): the thread's rollout file names its folder.
  const codexHome = tempDir('open-artifact-codex-');
  const rolled = tempDir('open-artifact-rolled-');
  const day = join(codexHome, 'sessions', '2026', '11', '17');
  mkdirSync(day, { recursive: true });
  writeFileSync(join(day, 'rollout-2026-11-17T10-00-00-thread-rolled.jsonl'), `${JSON.stringify({ type: 'session_meta', payload: { id: 'thread-rolled', cwd: rolled } })}\n{"type":"x"}\n`);
  process.env.CODEX_HOME = codexHome;
  try {
    assert.ok((await publish('thread-rolled', 'Rolled')).startsWith(join(rolled, 'artifacts')));
  } finally {
    delete process.env.CODEX_HOME;
  }
});

test('Antigravity: sessionEnv, recent-session fallback when MCP has no session/PID match, and inbox routing', async () => {
  assert.equal(harnessProfile('antigravity').sessionEnv, 'ANTIGRAVITY_CONVERSATION_ID');

  const wsA = tempDir('open-artifact-ag-a-');
  const wsB = tempDir('open-artifact-ag-b-');
  const wsUnseen = tempDir('open-artifact-ag-c-');

  const publish = async (title: string, headers: Record<string, string>) => {
    const response = await mcp(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'Artifact', arguments: { action: 'publish', type_url: 'open-artifact://type/design', title } } },
      headers,
    );
    const body = (await response.json()) as { result: { content: Array<{ text: string }>; isError: boolean } };
    assert.equal(body.result.isError, false, body.result.content[0]?.text);
    const made = JSON.parse(body.result.content[0]!.text) as ToolCallResult;
    return daemon.store.require(artifactIdOf(String(made.url))!);
  };

  // Hooks register two Antigravity sessions on a shared language_server PID (99001), plus a Claude session on 99002.
  await api(state, 'hook', { event: 'SessionStart', harness: 'antigravity', session: 'ag-conv-a', workspace: wsA, pids: [99001] });
  await new Promise((done) => setTimeout(done, 15));
  await api(state, 'hook', { event: 'UserPromptSubmit', harness: 'antigravity', session: 'ag-conv-b', workspace: wsB, pids: [99001] });
  await api(state, 'hook', { event: 'SessionStart', harness: 'claude-code', session: 'claude-other', workspace: wsA, pids: [99002] });

  // 1. Plugin-folder MCP call (no session, no workspace, no matching PID, e.g. Windows / detached LS / daemon restart):
  //    falls back to the most recently seen Antigravity session and places the artifact in its workspace.
  const noPid = await publish('AG No PID', { 'X-Open-Artifact-Harness': 'antigravity', 'X-Open-Artifact-PPID': '88888' });
  assert.deepEqual(noPid.owner, { harness: 'antigravity', session: 'ag-conv-b', workspace: wsB });
  assert.ok(noPid.root.startsWith(join(wsB, 'artifacts')), noPid.root);

  // 2. Ask from browser routes to antigravity:ag-conv-b (not unowned) and PreInvocation receives it.
  const ask = await api<{ via: string }>(state, LIBRARY_ROUTES.ask, { id: noPid.id, text: 'Change the hero title' });
  assert.equal(ask.via, 'inbox');
  assert.equal(daemon.inbox.count('unowned'), 0);
  const delivered = await api<{ messages: string[] }>(state, 'hook', { event: 'UserPromptSubmit', harness: 'antigravity', session: 'ag-conv-b', workspace: wsB, pids: [99001] });
  assert.equal(delivered.messages.length, 1);
  assert.match(delivered.messages[0]!, /Change the hero title/);

  // 3. Workspace-scoped MCP call matches wsA's session even when wsB was more recent on the shared PID.
  const byWs = await publish('AG Workspace A', {
    'X-Open-Artifact-Harness': 'antigravity',
    'X-Open-Artifact-Workspace': encodeURIComponent(wsA),
    'X-Open-Artifact-PPID': '99001',
  });
  assert.deepEqual(byWs.owner, { harness: 'antigravity', session: 'ag-conv-a', workspace: wsA });
  assert.ok(byWs.root.startsWith(join(wsA, 'artifacts')), byWs.root);

  // 4. An unseen workspace does NOT steal another workspace's session.
  const unseen = await publish('AG Unseen WS', {
    'X-Open-Artifact-Harness': 'antigravity',
    'X-Open-Artifact-Workspace': encodeURIComponent(wsUnseen),
    'X-Open-Artifact-PPID': '99001',
  });
  assert.deepEqual(unseen.owner, { harness: 'antigravity', session: null, workspace: wsUnseen });

  // 5. Shared PID from another harness (claude-code on 99002) is NOT hijacked by an antigravity MCP call.
  const isolated = await publish('AG PID Isolated', {
    'X-Open-Artifact-Harness': 'antigravity',
    'X-Open-Artifact-Workspace': encodeURIComponent(wsA),
    'X-Open-Artifact-PPID': '99002',
  });
  assert.deepEqual(isolated.owner, { harness: 'antigravity', session: 'ag-conv-a', workspace: wsA });

  // 6. Plain unnamed MCP client does NOT steal Antigravity's recent session.
  const plain = await publish('Plain MCP', { 'X-Open-Artifact-Workspace': encodeURIComponent(wsB) });
  assert.deepEqual(plain.owner, { harness: 'mcp', session: null, workspace: wsB });

  // 7. Stale sessions outside the freshness window are not matched.
  process.env.OPEN_ARTIFACT_RECENT_SESSION_MS = '1';
  try {
    await new Promise((done) => setTimeout(done, 10));
    assert.equal(daemon.harnesses.recentSession('antigravity', wsA), null);
    assert.equal(daemon.harnesses.recentSession('antigravity', null), null);
  } finally {
    delete process.env.OPEN_ARTIFACT_RECENT_SESSION_MS;
  }
});

test('MCP bridge: refreshes daemon token on 401 after a daemon restart', async () => {
  const bin = resolve(import.meta.dirname, '..', 'src', 'bin', 'open-artifact.ts');
  const child = spawn(process.execPath, [bin, 'mcp', '--harness', 'antigravity'], {
    env: { ...process.env, OPEN_ARTIFACT_HOME: TEST_HOME, ANTIGRAVITY_CONVERSATION_ID: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, (msg: Record<string, unknown>) => void>();
  lines.on('line', (line) => {
    try {
      const msg = JSON.parse(line) as Record<string, unknown>;
      if (typeof msg.id === 'number') pending.get(msg.id)?.(msg);
    } catch {
      /* ignore */
    }
  });
  const call = (id: number, method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolveCall, rejectCall) => {
      const timer = setTimeout(() => rejectCall(new Error(`timeout waiting for ${method}`)), 5000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        pending.delete(id);
        resolveCall(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  try {
    const first = await call(1, 'ping');
    assert.deepEqual(first.result, {});
    // Restart the daemon on the same port with a new token while the MCP bridge stays alive (forces HTTP 401).
    const samePort = daemon.port;
    daemon.close();
    await new Promise((done) => setTimeout(done, 50));
    daemon = await startDaemon({ port: samePort, quiet: true, shellDir, homeDir: join(shellDir, 'no-home') });
    state = (await readDaemon())!;
    assert.equal(daemon.port, samePort);
    const second = await call(2, 'ping');
    assert.deepEqual(second.result, {}, 'recovers on HTTP 401 after daemon restart with a new token');
  } finally {
    lines.close();
    child.kill();
  }
});

test('GET /a/<id> injects the boot object into the Shell', async () => {
  const id = await createDesign('</script><b>x</b>', 'boot-1');
  const response = await fetch(`${state.url}/a/${id}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(!html.includes(BOOT_PLACEHOLDER));
  assert.ok(!html.includes('</script><b>'), 'the title is escaped');
  const json = /window\.__OPEN_ARTIFACT_BOOT__ = (.*);<\/script>/.exec(html)![1]!;
  assert.ok(json.includes('\\u003c/script>'));
  const boot = JSON.parse(json) as ShellBoot;
  assert.equal(boot.id, id);
  assert.equal(boot.type, 'design');
  assert.equal(boot.empty, true, 'no project/canvas.json yet');
  assert.equal(boot.pending, undefined, 'an empty artifact has no page to wait for (shell-boot.test.ts has the pending boot)');
  assert.equal(boot.page, null);
  assert.match(String(boot.prompt), new RegExp(`^Take over artifact open-artifact://artifact/${id} \\(Design \\(canvas\\) "`));
  assert.match(String(boot.prompt), /call Artifact \{action: "adopt", url: "open-artifact:\/\/artifact\//);
  assert.equal(boot.agentName, 'Agent');
  assert.equal((await fetch(`${state.url}/a/art_nothere`)).status, 404);
  assert.equal((await fetch(`${state.url}/_open-artifact/shell/../daemon.json`)).status, 404);
  assert.equal((await fetch(`${state.url}/_open-artifact/shell/index.html`)).status, 200);
});

test('Harness API: hello with a bad token is refused', async () => {
  const ws = new WebSocket(`${state.url.replace(/^http/, 'ws')}${HARNESS_PATH}`, [HARNESS_SUBPROTOCOL]);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', () => resolveOpen(), { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('no connection')), { once: true });
  });
  const answer = new Promise<{ error?: { code: number; data?: { code?: string } } }>((resolveAnswer) =>
    ws.addEventListener('message', (event) => resolveAnswer(JSON.parse(String(event.data))), { once: true }),
  );
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'hello', params: { harness: 'dsh', caps: {}, token: 'wrong' } }));
  const reply = await answer;
  assert.ok(reply.error, 'an error answer');
  ws.close();
});

test('wake: delivered live to a connected HarnessClient', async () => {
  const delivered: WakeDeliverParams[] = [];
  const client = new HarnessClient({
    harness: 'dsh',
    caps: { wake: {} },
    autoStart: false,
    handlers: {
      'wake.deliver': (params) => {
        delivered.push(params);
        return { status: 'delivered' };
      },
    },
  });
  try {
    await client.connect();
    await client.attach({ session: 'live-1', workspace, status: 'idle' });
    const id = await createDesign('Live', 'live-1');
    const result = await api<{ via: string }>(state, LIBRARY_ROUTES.ask, { id, text: 'Please make it blue' });
    assert.equal(result.via, 'live');
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]!.session, 'live-1');
    assert.equal(delivered[0]!.artifactId, id);
    assert.match(delivered[0]!.text, /Please make it blue/);
    assert.match(delivered[0]!.text, /sent to agent/i);
    const info = await api<{ sessions: Array<{ session: string; live: boolean }> }>(state, 'harnesses');
    assert.ok(info.sessions.some((s) => s.session === 'live-1' && s.live));
  } finally {
    client.close();
  }
});

test('create: the page opens in the app after the first write by default; open: "never" keeps it closed', async () => {
  const opened: string[] = [];
  const client = new HarnessClient({
    harness: 'dsh',
    caps: { open: true },
    autoStart: false,
    handlers: {
      'host.open': (params) => {
        opened.push(params.url);
        return { opened: true };
      },
    },
  });
  const create = (title: string, extra: Record<string, unknown> = {}) =>
    api<ToolCallResult>(state, 'tools.call', {
      name: 'Artifact',
      arguments: { action: 'publish', type_url: 'open-artifact://type/design', title, ...extra },
      caller: { harness: 'dsh', session: 'open-1', workspace },
    });
  try {
    await client.connect();
    await client.attach({ session: 'open-1', workspace, status: 'idle' });
    const made = await create('Opens by default');
    assert.equal(made.open, 'after_first_write');
    assert.equal(made.note, undefined);
    const closed = await create('Stays closed', { open: 'never' });
    assert.equal(closed.open, undefined);
    assert.equal(closed.note, undefined);
    assert.deepEqual(opened, [], 'nothing opens while the folder is empty');
    writeFileSync(join(String(made.root), 'index.html'), '<!doctype html><title>x</title>');
    writeFileSync(join(String(closed.root), 'index.html'), '<!doctype html><title>x</title>');
    await until(() => opened.length > 0, 10_000);
    await new Promise((done) => setTimeout(done, 3000)); // past the poll and settle for the second one
    assert.deepEqual(opened, [made.url]);
  } finally {
    client.close();
  }
});

test('wake: with no adapter connected it waits in the inbox', async () => {
  const id = await createDesign('Offline', 'gone-1');
  const result = await api<{ via: string }>(state, LIBRARY_ROUTES.ask, { id, text: 'Are you there?' });
  assert.equal(result.via, 'inbox');
  const key = sessionKeyOf({ harness: 'dsh', session: 'gone-1', workspace })!;
  const waiting = daemon.inbox.peek(key);
  assert.equal(waiting.length, 1);
  assert.match(waiting[0]!.text, /Are you there\?/);
  // The polling API hands it over on attach.
  const attached = await api<{ key: string; inbox: Array<{ text: string }> }>(state, 'session.attach', { harness: 'dsh', session: 'gone-1', workspace });
  assert.equal(attached.key, key);
  assert.equal(attached.inbox.length, 1);
  assert.equal(daemon.inbox.count(key), 0);
  await api(state, 'session.detach', { harness: 'dsh', session: 'gone-1', workspace });
});

test('Type API: wake with the type token', async () => {
  const id = await createDesign('Type wake', 'type-1');
  const url = `${state.url}/api/open-artifact.type.wake`;
  const body = JSON.stringify({ id, threads: [{ id: 'th_1', where: 'Board "Home"', messages: [{ from: 'user', text: 'Tighten the heading' }] }] });
  const refused = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body });
  assert.equal(refused.status, 401, 'the daemon token is not a type token');
  const otherType = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${daemon.typeToken('other')}` }, body });
  assert.equal(otherType.status, 404, "another type's artifact is as good as none");
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${daemon.typeToken('design')}` }, body });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'inbox', via: 'inbox' });
  const waiting = daemon.inbox.peek(sessionKeyOf({ harness: 'dsh', session: 'type-1', workspace })!);
  assert.match(waiting.at(-1)!.text, /Tighten the heading/);
  assert.match(waiting.at(-1)!.text, /th_1/);

  const presence = await fetch(`${state.url}/api/open-artifact.type.presence?id=${id}`, { headers: { Authorization: `Bearer ${daemon.typeToken('design')}` } });
  assert.deepEqual(await presence.json(), { presence: 'offline', canSend: true, canSendSession: true, busy: false, agentName: 'Agent', wakesIdle: true });
});

test('Type API: presence says when an idle agent is not woken (Cursor), so the page can say what to do', async () => {
  const presenceOf = async (id: string) =>
    (await (await fetch(`${state.url}/api/open-artifact.type.presence?id=${id}`, { headers: { Authorization: `Bearer ${daemon.typeToken('design')}` } })).json()) as Record<string, unknown>;
  const cursor = await presenceOf(await createDesign('Cursor deck', 'cursor-1', 'cursor'));
  assert.equal(cursor.agentName, 'Cursor');
  assert.equal(cursor.wakesIdle, false);
  assert.equal((await presenceOf(await createDesign('Codex deck', 'codex-1', 'codex'))).wakesIdle, true);
});

test('Library API: a duplicate leaves out _agent/ (the agent channel: snapshots)', async () => {
  const id = await createDesign('Copy me', 'dup-1');
  const root = daemon.store.require(id).root;
  mkdirSync(join(root, '_agent', 'snapshots'), { recursive: true });
  writeFileSync(join(root, '_agent', 'snapshots', 'snapshot-2026-01-01T00-00-00-000Z.png'), 'png');
  const copy = await api<{ id: string }>(state, LIBRARY_ROUTES.duplicate, { id });
  const copied = daemon.store.require(copy.id).root;
  assert.notEqual(copied, root);
  assert.equal(existsSync(join(copied, '_agent')), false);
  assert.ok(existsSync(join(root, '_agent', 'snapshots')), 'the original keeps its own');
});

test('Library API: a new file under _agent/ (a snapshot) does not make the artifact look updated', async () => {
  const id = await createDesign('Stamp me', 'stamp-1');
  const record = daemon.store.require(id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stamp = (): string => { (daemon as any).contentStamps.delete(record.root); return (daemon as any).contentAt(record); };
  const was = stamp();
  const file = join(record.root, '_agent', 'snapshots', 'snapshot-2099-01-01T00-00-00-000Z.png');
  mkdirSync(join(record.root, '_agent', 'snapshots'), { recursive: true });
  writeFileSync(file, 'png');
  const later = new Date(Date.parse(was) + 3_600_000);
  utimesSync(file, later, later);
  assert.equal(stamp(), was);
});

test('Library API: writes need the token or the same origin', async () => {
  const id = await createDesign('Rename me', 'lib-1');
  const anonymous = await fetch(`${state.url}/api/open-artifact.${LIBRARY_ROUTES.update}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, title: 'x' }) });
  assert.equal(anonymous.status, 403);
  const foreign = await fetch(`${state.url}/api/open-artifact.${LIBRARY_ROUTES.update}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
    body: JSON.stringify({ id, title: 'x' }),
  });
  assert.equal(foreign.status, 403);
  const renamed = await api<{ title: string; pinned: boolean }>(state, LIBRARY_ROUTES.update, { id, title: 'Renamed', pinned: true });
  assert.equal(renamed.title, 'Renamed');
  assert.equal(renamed.pinned, true);
  const list = await api<{ artifacts: Array<{ id: string }> }>(state, 'artifacts');
  assert.equal(list.artifacts[0]!.id, id, 'pinned first');
  // fetch cannot set Host: a plain request can (a DNS-rebound page would send its own name).
  const misdirected = await new Promise<number>((resolveStatus, rejectStatus) => {
    const req = request(`${state.url}/__open-artifact/health`, { headers: { Host: 'evil.example' } }, (res) => {
      res.resume();
      resolveStatus(res.statusCode ?? 0);
    });
    req.on('error', rejectStatus);
    req.end();
  });
  assert.equal(misdirected, 421);
});
