/**
 * The Shell's two-phase boot: `GET /a/<id>` answers at once with a `pending` boot and starts opening the page;
 * `artifacts.boot` answers the finished boot, joining that open (one per artifact) or taking it once it settled;
 * `fresh=1` opens again; a failure is not kept. Also: the open request carries the Shell's address (`viewer`), and a
 * static entry's framed address visited as a page goes to the Shell.
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { artifactIdOf, type DaemonState, type OpenRequest, type ShellBoot, type ToolCallResult } from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { BOOT_PLACEHOLDER, startDaemon, type Daemon } from '../src/daemon.ts';

let daemon: Daemon;
let state: DaemonState;
let typeServer: Server;
let typePort = 0;
/** Every `/__open-artifact/open` the fake type server was sent. */
const opens: OpenRequest[] = [];
/** While set, opens wait for it. */
let gate: Promise<void> | null = null;
/** While set, opens fail with this message. */
let failWith: string | null = null;

/** A URL type with `open: true`: its opens can be held back or made to fail. */
function fakeServer(): Promise<number> {
  typeServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname !== '/slow/__open-artifact/open' || req.method !== 'POST') return send(404, { code: 'not_found', message: url.pathname });
      const body = JSON.parse(raw) as OpenRequest;
      opens.push(body);
      const n = opens.length;
      if (gate) await gate;
      if (failWith) return send(500, { code: 'server_failed', message: failWith });
      send(200, { url: `/slow/page/${body.id}/?n=${n}`, page_url: `/slow/page/${body.id}/` });
    });
  });
  return new Promise((done) => typeServer.listen(0, '127.0.0.1', () => done((typeServer.address() as { port: number }).port)));
}

function addType(id: string, files: Record<string, string>): void {
  const dir = join(process.env.OPEN_ARTIFACT_USER_TYPES!, id);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

before(async () => {
  typePort = await fakeServer();
  addType('slow', { 'artifact-type.json': JSON.stringify({ name: 'slow', description: 'A type whose page takes a while to open.', entry: { url: `http://127.0.0.1:${typePort}/slow/{id}`, open: true } }) });
  addType('plainpage', { 'index.html': '<!doctype html><title>plain</title><p>static page</p>' });
  const shellDir = tempDir('open-artifact-shell-');
  writeFileSync(join(shellDir, 'index.html'), `<!doctype html><title>shell</title><script>window.__OPEN_ARTIFACT_BOOT__ = ${BOOT_PLACEHOLDER};</script>`);
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => {
  daemon.close();
  typeServer.close();
});

const caller = { harness: 'dsh', session: 'boot-1', workspace: tempDir('open-artifact-ws-') };

async function create(type: string, title: string): Promise<string> {
  const made = await api<ToolCallResult>(state, 'tools.call', { name: 'Artifact', arguments: { action: 'publish', type_url: `open-artifact://type/${type}`, title }, caller });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  return artifactIdOf(String(made.url))!;
}

/** `GET /a/<id>`: the injected boot. */
async function shellPage(id: string): Promise<ShellBoot> {
  const response = await fetch(`${state.url}/a/${id}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  return JSON.parse(/window\.__OPEN_ARTIFACT_BOOT__ = (.*);<\/script>/.exec(html)![1]!) as ShellBoot;
}

/** `GET artifacts.boot`. */
async function finished(id: string, fresh = false): Promise<ShellBoot> {
  const response = await fetch(`${state.url}/api/open-artifact.artifacts.boot?id=${id}${fresh ? '&fresh=1' : ''}`);
  assert.equal(response.status, 200);
  return (await response.json()) as ShellBoot;
}

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 50));

test('GET /a/<id> answers before the page is open; artifacts.boot shares that one open', async () => {
  const id = await create('slow', 'Slow page');
  let release!: () => void;
  gate = new Promise((done) => (release = done));
  const before = opens.length;
  try {
    const boot = await shellPage(id);
    assert.equal(boot.pending, true);
    assert.equal(boot.id, id);
    assert.equal(boot.title, 'Slow page');
    assert.equal(boot.type, 'slow');
    assert.equal(boot.empty, false);
    assert.deepEqual([boot.page, boot.pageUrl, boot.pageKind, boot.problem], [null, null, null, null]);
    await until(() => opens.length === before + 1);

    let done = false;
    const answer = finished(id).then((b) => ((done = true), b));
    await settle();
    assert.equal(done, false, 'the boot waits for the open');
    release();
    const boot2 = await answer;
    assert.equal(boot2.pending, undefined);
    assert.equal(boot2.problem, null);
    assert.equal(boot2.pageKind, 'url');
    assert.equal(boot2.page, `http://127.0.0.1:${typePort}/slow/page/${id}/?n=${before + 1}`);
    assert.equal(boot2.pageUrl, `http://127.0.0.1:${typePort}/slow/page/${id}/`);
    assert.equal(opens.length, before + 1, 'one open for the page and its boot');
  } finally {
    gate = null;
  }
  const sent = opens.at(-1)!;
  await finished(id);
  assert.equal(opens.length, before + 2, 'the boot had that open: the next one opens again');
  assert.equal(sent.shell, state.url);
  assert.equal(sent.viewer, `${state.url}/a/${id}`, "the Shell's own address reaches the type server");
});

test('artifacts.boot takes an open that settled a moment ago once; fresh=1 opens again', async () => {
  const id = await create('slow', 'Settled page');
  const start = opens.length;
  assert.equal((await shellPage(id)).pending, true);
  await until(() => opens.length === start + 1);
  await settle();
  const boot = await finished(id);
  assert.equal(boot.page, `http://127.0.0.1:${typePort}/slow/page/${id}/?n=${start + 1}`);
  assert.equal(opens.length, start + 1, 'the settled open is taken');
  const again = await finished(id);
  assert.equal(opens.length, start + 2, 'taken once: the next boot opens again');
  assert.equal(again.page, `http://127.0.0.1:${typePort}/slow/page/${id}/?n=${start + 2}`);

  await shellPage(id);
  await until(() => opens.length === start + 3);
  await settle();
  const fresh = await finished(id, true);
  assert.equal(opens.length, start + 4, 'fresh=1 does not take the settled open');
  assert.equal(fresh.page, `http://127.0.0.1:${typePort}/slow/page/${id}/?n=${start + 4}`);
});

test('a failed open shows as the problem once, and the next page load opens again', async () => {
  const id = await create('slow', 'Failing page');
  failWith = 'the server fell over';
  const start = opens.length;
  try {
    assert.equal((await shellPage(id)).pending, true);
    const boot = await finished(id);
    assert.equal(boot.page, null);
    assert.equal(boot.pending, undefined);
    assert.match(String(boot.problem), /the server fell over/);
    assert.equal(opens.length, start + 1);
  } finally {
    failWith = null;
  }
  assert.equal((await shellPage(id)).pending, true);
  const boot = await finished(id);
  assert.equal(boot.problem, null);
  assert.equal(boot.page, `http://127.0.0.1:${typePort}/slow/page/${id}/?n=${start + 2}`);
  assert.equal(opens.length, start + 2, 'the reload opened again');
});

test('artifacts.boot: unknown ids and writes are refused', async () => {
  assert.equal((await fetch(`${state.url}/api/open-artifact.artifacts.boot?id=art_nothere`)).status, 404);
  const post = await fetch(`${state.url}/api/open-artifact.artifacts.boot?id=art_nothere`, { method: 'POST', headers: { Authorization: `Bearer ${state.token}` } });
  assert.equal(post.status, 400);
});

/** A request to a static entry's own origin (fetch cannot set Host). */
function frameGet(id: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((done, fail) => {
    const req = request(`${state.url}${path}`, { headers: { Host: `${id}.frame.localhost:${daemon.port}`, ...headers } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

test("a static entry's framed address visited as a page goes to the Shell", async () => {
  const id = await create('plainpage', 'Plain page');
  const boot = await finished(id);
  assert.equal(boot.pageKind, 'static');
  const framed = `/?open_artifact_shell=${encodeURIComponent(state.url)}&open_artifact_id=${id}`;

  const top = await frameGet(id, framed, { 'Sec-Fetch-Dest': 'document' });
  assert.equal(top.status, 302);
  assert.equal(top.headers.location, `${state.url}/a/${id}`);
  assert.equal(top.headers['cache-control'], 'no-store');

  const inFrame = await frameGet(id, framed, { 'Sec-Fetch-Dest': 'iframe' });
  assert.equal(inFrame.status, 200);
  assert.match(inFrame.body, /static page/);
  assert.equal((await frameGet(id, framed)).status, 200, 'no Sec-Fetch-Dest: served as before');
  const bare = await frameGet(id, '/', { 'Sec-Fetch-Dest': 'document' });
  assert.equal(bare.status, 200, 'the page without the Shell (page_url) stays');
});
