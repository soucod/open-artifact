/**
 * Remote types (design 18): a URL-entry type whose address is not loopback lives on another computer.
 *
 * - One definition (`entryLocation`), said wherever a type is described: the types list, quickstart, `commands.list`,
 *   the Library's TypeView and `read {url}` (`type_remote`, and each action's `remote`).
 * - `tools.list` / MCP `tools/list` name the actions that leave this computer for a remote type, and `openWorldHint`
 *   turns true while one is installed.
 * - What reaches the remote address carries no path: the open and action requests leave out `root`, an action given
 *   a path on this computer is refused before anything is sent, and creating one whose address does not answer fails
 *   saying which address and what happened (the type stays listed).
 *
 * The stub type server listens on 127.0.0.1; the types reach it as `http://0.0.0.0:<port>`, which is not a loopback
 * name, so the daemon treats them as remote with no switch of any kind in production code.
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  HARNESS_PATH,
  HARNESS_SUBPROTOCOL,
  MCP_REMOTE_ACTIONS_META,
  TOOL_REMOTE_ACTIONS,
  artifactIdOf,
  entryLocation,
  isLoopbackHost,
  type DaemonState,
  type ResolvedEntry,
  type ToolCallResult,
  type TypesResponse,
} from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { remoteOf } from '../src/harness-embed.ts';
import { REMOTE_ANSWER_MAX } from '../src/servers.ts';
import { localPathIn } from '../src/tools.ts';

// ---- units -------------------------------------------------------------------------------------------------------

test('location: a URL entry off loopback is remote, with its origin; everything else is local', () => {
  for (const host of ['localhost', 'app.localhost', '127.0.0.1', '127.9.8.7', '[::1]', '::1', 'LOCALHOST.']) assert.ok(isLoopbackHost(host), host);
  for (const host of ['0.0.0.0', 'example.com', '10.0.0.2', '127.0.0.1.example.com', 'localhost.example.com']) assert.ok(!isLoopbackHost(host), host);
  const url = (u: string): ResolvedEntry => ({ kind: 'url', url: u, open: false, share: false, actions: false }) as ResolvedEntry;
  assert.deepEqual(entryLocation(url('https://types.example.com/x/{id}')), { remote: true, origin: 'https://types.example.com' });
  assert.deepEqual(entryLocation(url('http://127.0.0.1:9000/x/{id}')), { remote: false });
  assert.deepEqual(entryLocation(null), { remote: false });
  assert.deepEqual(entryLocation({ kind: 'static' } as ResolvedEntry), { remote: false });
});

test('remoteOf: the type origin, plus the page origin when it differs and is not loopback', () => {
  const type = { id: 'far', entry: { kind: 'url', url: 'https://types.example.com/far/{id}' } as ResolvedEntry };
  assert.deepEqual(remoteOf(type), { type: 'far', origins: ['https://types.example.com'] });
  assert.deepEqual(remoteOf(type, 'https://cdn.example.net/page'), { type: 'far', origins: ['https://types.example.com', 'https://cdn.example.net'] });
  assert.deepEqual(remoteOf(type, 'https://types.example.com/far/a'), { type: 'far', origins: ['https://types.example.com'] });
  assert.equal(remoteOf({ id: 'near', entry: { kind: 'url', url: 'http://127.0.0.1:9/x/{id}' } as ResolvedEntry }), null);
  assert.equal(remoteOf(null), null);
});

test('localPathIn: absolute paths under home or the root, or existing, are found; pointers and text are not', () => {
  const root = tempDir('open-artifact-root-');
  assert.deepEqual(localPathIn({ file: join(homedir(), 'notes.txt') }, 'args', root), { at: 'args.file', path: join(homedir(), 'notes.txt') });
  assert.deepEqual(localPathIn({ list: [{ src: `file://${join(root, 'a.png')}` }] }, 'args', root)?.at, 'args.list[0].src');
  assert.equal(localPathIn({ pointer: '/blocks/0', text: 'see /Users/x', root: '/' }, 'args', root), null);
  assert.equal(localPathIn('relative/path.txt', 'args', root), null);
});

// ---- a daemon ----------------------------------------------------------------------------------------------------

let daemon: Daemon;
let state: DaemonState;
let stub: Server;
let port = 0;
let downPort = 0;
/** Every request the stub type server got: method, path, headers and JSON body. */
const got: Array<{ method: string; path: string; headers: Record<string, string | string[] | undefined>; raw: string; body: Record<string, unknown> | null }> = [];
/** A second listener on this computer, where the bouncing type points its redirects: it must hear nothing. */
let trap: Server;
let trapPort = 0;
const trapped: string[] = [];

function addType(id: string, manifest: Record<string, unknown>): void {
  const dir = join(process.env.OPEN_ARTIFACT_USER_TYPES!, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'artifact-type.json'), JSON.stringify({ name: id, ...manifest }));
}

before(async () => {
  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      let body: Record<string, unknown> | null = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        /* not JSON */
      }
      got.push({ method: req.method ?? 'GET', path, headers: { ...req.headers }, raw, body });
      const send = (status: number, out: unknown): void => void res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
      const bounce = (): void => void res.writeHead(307, { Location: `http://127.0.0.1:${trapPort}/took${path}` }).end();
      if (path === '/b/__open-artifact/open') return send(200, { url: `http://0.0.0.0:${port}/b/page` });
      if (path === '/b/__open-artifact/actions' && req.method === 'GET') return send(200, { actions: [{ name: 'go', title: 'Go', effect: 'read' }] });
      if (path === '/b/__open-artifact/actions/go' || path === '/b/__open-artifact/archive') return bounce();
      if (path === '/r/__open-artifact/actions/big') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(`{"pad":"${'x'.repeat(REMOTE_ANSWER_MAX)}"}`);
      if (path === '/r/__open-artifact/share') return send(200, { lan: false, addresses: [], links: {} });
      if (path === '/r/__open-artifact/archive') return void res.writeHead(200, { 'Content-Type': 'application/zip' }).end('PK');
      if (path === '/r/__open-artifact/health') return send(200, { openArtifact: 1, type: 'remotetype' });
      if (path === '/r/__open-artifact/open') return send(200, { url: `http://0.0.0.0:${port}/r/page/${String(body?.id)}` });
      if (path === '/r/__open-artifact/actions' && req.method === 'GET') {
        return send(200, {
          actions: [
            { name: 'stamp', title: 'Stamp', effect: 'read', schema: { type: 'object', properties: { text: { type: 'string' }, file: { type: 'string' } } } },
            { name: 'big', title: 'Big', effect: 'read' },
          ],
        });
      }
      if (path === '/r/__open-artifact/actions/stamp') return send(200, { stamped: true });
      send(404, { code: 'not_found', message: path });
    });
  });
  port = await new Promise<number>((done) => stub.listen(0, '127.0.0.1', () => done((stub.address() as { port: number }).port)));
  trap = createServer((req, res) => {
    trapped.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"took":true}');
  });
  trapPort = await new Promise<number>((done) => trap.listen(0, '127.0.0.1', () => done((trap.address() as { port: number }).port)));
  addType('remotetype', { description: 'Stamps things, on another computer.', intents: ['stamp sheet'], entry: { url: `http://0.0.0.0:${port}/r/{id}`, open: true, actions: true, share: true } });
  addType('bouncetype', { description: 'Redirects everything, on another computer.', entry: { url: `http://0.0.0.0:${port}/b/{id}`, open: true, actions: true } });
  // A port that was free a moment ago: nothing answers there.
  const spare = createServer();
  downPort = await new Promise<number>((done) => spare.listen(0, '127.0.0.1', () => done((spare.address() as { port: number }).port)));
  await new Promise((done) => spare.close(done));
  addType('downtype', { description: 'Stamps things, on a computer that is off.', intents: ['stamp sheet'], entry: { url: `http://0.0.0.0:${downPort}/d/{id}` } });
  addType('webtype', { description: 'A page on the web.', entry: { url: 'https://types.example.com/w/{id}' } });
  addType('neartype', { description: 'A page on this computer.', entry: { url: `http://127.0.0.1:${port}/n/{id}` } });
  const shellDir = tempDir('open-artifact-shell-');
  writeFileSync(join(shellDir, 'index.html'), '<!doctype html><title>shell</title>');
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => {
  daemon.close();
  stub.close();
  trap.close();
});

const caller = (session: string) => ({ harness: 'remote-app', session, workspace: tempDir('open-artifact-ws-') });
const call = (name: string, args: Record<string, unknown>, who = caller('r0')) => api<ToolCallResult>(state, 'tools.call', { name, arguments: args, caller: who });

test('types list, Library types and quickstart say remote and origin', async () => {
  const listed = (await call('Artifact', { action: 'list', scope: 'types' })) as ToolCallResult & { types: Array<{ id: string; remote?: boolean; origin?: string }> };
  const byId = new Map(listed.types.map((t) => [t.id, t]));
  assert.equal(byId.get('remotetype')?.remote, true);
  assert.equal(byId.get('remotetype')?.origin, `http://0.0.0.0:${port}`);
  assert.equal(byId.get('webtype')?.origin, 'https://types.example.com');
  assert.equal(byId.get('neartype')?.remote, false);
  assert.equal(byId.get('neartype')?.origin, undefined);

  const library = (await (await fetch(`${state.url}/api/open-artifact.types`)).json()) as TypesResponse;
  const view = library.types.find((t) => t.id === 'webtype')!;
  assert.equal(view.remote, true);
  assert.equal(view.origin, 'https://types.example.com');
  assert.equal(library.types.find((t) => t.id === 'neartype')!.remote, false);

  const quick = (await call('Artifact', { action: 'quickstart', type: 'remotetype' })) as ToolCallResult & { recommended: { remote: boolean; origin?: string }; steps: string };
  assert.equal(quick.recommended.remote, true);
  assert.equal(quick.recommended.origin, `http://0.0.0.0:${port}`);
  assert.ok(quick.steps.includes(`on 0.0.0.0:${port}, another computer`), quick.steps);
  const near = (await call('Artifact', { action: 'quickstart', type: 'neartype' })) as ToolCallResult & { steps: string };
  assert.ok(!near.steps.includes('another computer'));

  // An unreachable remote type stays in the list.
  const matched = (await call('Artifact', { action: 'quickstart', intent: 'stamp sheet' })) as ToolCallResult & { recommended: { id: string } | null; alternatives: Array<{ id: string; remote: boolean }> };
  const ids = [matched.recommended?.id, ...matched.alternatives.map((a) => a.id)];
  assert.ok(ids.includes('downtype') && ids.includes('remotetype'), JSON.stringify(ids));
});

test('tools.list and MCP tools/list: remoteActions, and openWorldHint true while a remote type is installed', async () => {
  const listed = await api<{ tools: Array<{ name: keyof typeof TOOL_REMOTE_ACTIONS; remoteActions?: string[]; annotations?: { openWorldHint?: boolean } }> }>(state, 'tools');
  for (const tool of listed.tools) {
    assert.deepEqual(tool.remoteActions, TOOL_REMOTE_ACTIONS[tool.name]);
    assert.equal(tool.annotations?.openWorldHint, true, `${tool.name}: a remote type with actions is installed`);
  }
  const response = await fetch(`${state.url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const { result } = (await response.json()) as { result: { tools: Array<Record<string, unknown>> } };
  const artifact = result.tools.find((t) => t.name === 'Artifact')!;
  assert.equal(artifact.remoteActions, undefined, 'under _meta in MCP');
  assert.deepEqual((artifact._meta as Record<string, unknown>)[MCP_REMOTE_ACTIONS_META], TOOL_REMOTE_ACTIONS.Artifact);
  assert.equal((artifact.annotations as { openWorldHint?: boolean }).openWorldHint, true);
});

test('a remote type gets no path: open and actions leave out root; a path argument is refused before anything is sent', async () => {
  const who = caller('r1');
  const made = await call('Artifact', { action: 'publish', type_url: 'open-artifact://type/remotetype', title: 'Remote one' }, who);
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  const id = artifactIdOf(String(made.url))!;
  const actions = made.actions as Array<{ name: string; remote?: boolean }>;
  assert.deepEqual(actions.map((a) => [a.name, a.remote]), [['stamp', true], ['big', true]]);

  const read = (await call('Artifact', { action: 'read', url: made.url }, who)) as ToolCallResult & { type_remote: boolean; type_origin?: string; actions?: Array<{ remote?: boolean }> };
  assert.equal(read.type_remote, true);
  assert.equal(read.type_origin, `http://0.0.0.0:${port}`);
  assert.ok(read.actions?.every((a) => a.remote === true));

  const stamped = await call('Artifact', { action: 'call', url: made.url, name: 'stamp', args: { text: 'hello' } }, who);
  assert.equal(stamped.error, undefined, JSON.stringify(stamped.error));
  const open = await until(() => got.find((r) => r.path === '/r/__open-artifact/open' && r.body?.id === id));
  assert.equal(open.body!.root, undefined, 'no folder path in the open request');
  assert.equal(open.body!.title, 'Remote one', 'the title is sent');
  const action = got.find((r) => r.path === '/r/__open-artifact/actions/stamp')!;
  assert.deepEqual(action.body, { id, args: { text: 'hello' } }, 'the id and the arguments, nothing else');
  for (const request of got) assert.ok(!JSON.stringify(request.body ?? {}).includes(homedir()), `${request.path} carries no home path`);

  const before = got.length;
  const refused = await call('Artifact', { action: 'call', url: made.url, name: 'stamp', args: { file: join(homedir(), 'secret.txt') } }, who);
  assert.equal(refused.error?.code, 'unsupported');
  assert.match(refused.error!.message, /another computer .*args\.file, a path on this computer/);
  assert.equal(got.length, before, 'nothing reached the other computer');
});

test('creating a remote type whose address does not answer fails saying where and what happened', async () => {
  const made = await call('Artifact', { action: 'publish', type_url: 'open-artifact://type/downtype', title: 'Down' });
  assert.equal(made.error?.code, 'server_failed');
  assert.ok(made.error!.message.includes(`lives at http://0.0.0.0:${downPort}, on another computer, and http://0.0.0.0:${downPort}/d/ could not be reached (ECONNREFUSED`), made.error!.message);
  assert.match(made.error!.fix ?? '', /remote is false/);
  const listed = (await call('Artifact', { action: 'list', scope: 'types' })) as ToolCallResult & { types: Array<{ id: string }> };
  assert.ok(listed.types.some((t) => t.id === 'downtype'), 'still listed');
});

test('commands.list entries say remote and origin', async () => {
  const ws = new WebSocket(`${state.url.replace(/^http/, 'ws')}${HARNESS_PATH}`, [HARNESS_SUBPROTOCOL]);
  await new Promise<void>((ok, fail) => {
    ws.addEventListener('open', () => ok(), { once: true });
    ws.addEventListener('error', () => fail(new Error('no connection')), { once: true });
  });
  const answers = new Map<number, { result?: any; error?: unknown }>();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined && !message.method) answers.set(message.id, message);
  });
  let next = 1;
  const rpc = async (method: string, params: unknown) => {
    const id = next++;
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    await until(() => answers.has(id), 5000);
    return answers.get(id)!;
  };
  try {
    const hello = await rpc('hello', { harness: 'remote-app', token: state.token });
    assert.ok((hello.result.features as string[]).includes('types.remote'));
    const { commands } = (await rpc('commands.list', {})).result as { commands: Array<{ type: string; remote?: boolean; origin?: string }> };
    assert.deepEqual(
      commands.filter((c) => ['remotetype', 'webtype', 'neartype'].includes(c.type)).map((c) => [c.type, c.remote, c.origin]),
      [
        ['neartype', false, undefined],
        ['remotetype', true, `http://0.0.0.0:${port}`],
        ['webtype', true, 'https://types.example.com'],
      ],
    );
  } finally {
    ws.close();
  }
});

test('a remote type that redirects is never followed: a POST action and the archive GET fail naming its address', async () => {
  const who = caller('b1');
  const made = await call('Artifact', { action: 'publish', type_url: 'open-artifact://type/bouncetype', title: 'Bounce' }, who);
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  const id = artifactIdOf(String(made.url))!;

  const went = await call('Artifact', { action: 'call', url: made.url, name: 'go', args: { text: 'secret words' } }, who);
  assert.equal(went.error?.code, 'server_failed');
  assert.ok(went.error!.message.includes(`http://0.0.0.0:${port}/b/__open-artifact/actions/go answered with a redirect (307)`), went.error!.message);
  assert.ok(!went.error!.message.includes(String(trapPort)), 'the target is not named');

  const zip = await fetch(`${state.url}/api/open-artifact.artifact.archive?id=${id}`, { headers: { origin: state.url } });
  const said = (await zip.json()) as { code?: string; message?: string };
  assert.equal(said.code, 'server_failed', JSON.stringify(said));
  assert.ok(said.message?.includes(`http://0.0.0.0:${port}/b/__open-artifact/archive answered with a redirect (307)`), said.message);
  assert.deepEqual(trapped, [], 'the listener the redirects point at heard nothing');
});

test('an answer from a remote type past the cap is refused', async () => {
  const who = caller('big1');
  const made = await call('Artifact', { action: 'publish', type_url: 'open-artifact://type/remotetype', title: 'Big one' }, who);
  const big = await call('Artifact', { action: 'call', url: made.url, name: 'big', args: {} }, who);
  assert.equal(big.error?.code, 'server_failed');
  assert.match(big.error!.message, /answered more than 32 MiB/);
});

test('no credentials reach a remote type: no Authorization header, no daemon token, on any call', async () => {
  const who = caller('cred1');
  const made = await call('Artifact', { action: 'publish', type_url: 'open-artifact://type/remotetype', title: 'Creds' }, who);
  const id = artifactIdOf(String(made.url))!;
  await call('Artifact', { action: 'call', url: made.url, name: 'stamp', args: { text: 'x' } }, who);
  await call('ArtifactData', { action: 'list', url: made.url, collection: 'things' }, who);
  await fetch(`${state.url}/api/open-artifact.artifact.share?id=${id}`, { headers: { origin: state.url } });
  await fetch(`${state.url}/api/open-artifact.artifact.archive?id=${id}`, { headers: { origin: state.url } });
  const seen = new Set(got.map((r) => r.path.replace(/^\/[a-z]\//, '/')));
  for (const route of ['/__open-artifact/open', '/__open-artifact/actions', '/__open-artifact/actions/stamp', '/__open-artifact/actions/open-artifact.db.read', '/__open-artifact/share', '/__open-artifact/archive']) {
    assert.ok(seen.has(route), `${route} was called (${[...seen].join(', ')})`);
  }
  for (const request of got) {
    assert.equal(request.headers.authorization, undefined, `${request.method} ${request.path}: no Authorization header`);
    const all = JSON.stringify(request.headers) + request.raw + request.path;
    assert.ok(!all.includes(state.token), `${request.method} ${request.path}: no daemon token`);
    assert.ok(!all.includes(daemon.typeToken('remotetype')), `${request.method} ${request.path}: no type token`);
  }
});
