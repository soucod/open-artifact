/**
 * Hosted mode (`hosting`): a cloud host embeds the type server, feeds it requests from its own listener
 * (`handle`, `upgrade`) and says who each path token is (`resolve`). Requests carry the content host names of a
 * deployment in their Host header, so they go out with `node:http` (fetch cannot set Host). The last test checks that
 * the same server without `hosting` is the loopback owner's, as before.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import { createTypeServer, type TypeServer, type TypeServerHosting } from '../src/index.ts';
import type { TypeName } from '../src/types.ts';

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** One request to `port` with any headers, Host included. */
function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string | Uint8Array): Promise<Answer> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** A WebSocket handshake: the open socket and the first text frame, or the refusal's status. */
/** A WebSocket to the event stream: `start`, the stream's opening `db` frame (where the store stands, when the artifact has one), and the first frame after it. */
function socketTo(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; socket?: Socket; start?: { event: string; data: unknown }; first?: { event: string; data: unknown } }> {
  return new Promise((resolvePromise, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': randomBytes(16).toString('base64'), 'sec-websocket-version': '13', ...headers },
    });
    req.on('upgrade', (res: IncomingMessage, socket: Socket, head: Buffer) => {
      let buffered = head;
      let start: { event: string; data: unknown } | undefined;
      const read = (chunk?: Buffer): void => {
        if (chunk) buffered = Buffer.concat([buffered, chunk]);
        for (;;) {
          if (buffered.length < 2) return;
          let length = buffered[1]! & 0x7f;
          let at = 2;
          if (length === 126) {
            if (buffered.length < 4) return;
            length = buffered.readUInt16BE(2);
            at = 4;
          }
          if (buffered.length < at + length) return;
          const frame = JSON.parse(buffered.subarray(at, at + length).toString('utf8')) as { event: string; data: unknown };
          buffered = buffered.subarray(at + length);
          if (!start && frame.event === 'db' && (frame.data as { resync?: boolean }).resync) {
            start = frame;
            continue;
          }
          socket.off('data', read);
          resolvePromise({ status: res.statusCode ?? 101, socket, ...(start ? { start } : {}), first: frame });
          return;
        }
      };
      socket.on('data', read);
      read();
    });
    req.on('response', (res) => {
      res.resume();
      resolvePromise({ status: res.statusCode ?? 0 });
    });
    req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' ? resolvePromise({ status: 0 }) : reject(error)));
    req.end();
  });
}

/** An event stream (`_api/events` over SSE) held open: `ended` settles when the server ends it. */
function stream(port: number, path: string, headers: Record<string, string>): Promise<{ ended: Promise<void>; close(): void }> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      assert.equal(res.statusCode, 200);
      const ended = new Promise<void>((done) => {
        res.on('end', done);
        res.on('close', done);
      });
      res.once('data', () => resolvePromise({ ended, close: () => req.destroy() }));
      res.on('data', () => undefined);
    });
    req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' ? undefined : reject(error)));
    req.end();
  });
}

const settled = (promise: Promise<void>, ms = 300): Promise<boolean> =>
  Promise.race([promise.then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), ms))]);

describe('hosted mode', () => {
  let dir: string;
  let server: TypeServer;
  /** The host's own listener, which hands requests to `server.handle` / `server.upgrade`. */
  let front: Server;
  let port: number;
  let internalPort: number;
  const secret = 'test-secret';
  const roots: Record<string, string> = {};
  /** Every `resolve` call, in order. */
  const uses: { token: string; use: string; type: TypeName }[] = [];
  const longToken = `v1.${'A'.repeat(180)}_x-y.${'b'.repeat(60)}`;
  /** Token -> artifact and viewer. */
  const tokens = new Map<string, { id: string; viewer: Viewer }>();
  const label = (id: string): string => id.replace('_', '-');
  const hostOf = (id: string): string => `${label(id)}.content.test`;
  const titles: Record<string, string> = { art_a: 'Retro', art_b: 'Plans', art_c: 'Poster' };
  const owners: Record<string, string> = { art_a: 'Ada', art_b: 'Bob', art_c: 'Ada' };
  /** Every `locate` call, in order. */
  const located: string[] = [];

  const hosting: TypeServerHosting = {
    hostAllowed: (host) => host === 'app.test' || Object.keys(titles).some((id) => host === hostOf(id)),
    async resolve(token, type, _req, use) {
      uses.push({ token, use, type });
      const held = tokens.get(token);
      if (!held) return null;
      return { id: held.id, root: roots[held.id]!, title: titles[held.id]!, viewer: held.viewer };
    },
    artifactOfHost: (host) => Object.keys(titles).find((id) => host === hostOf(id)) ?? null,
    async locate(id) {
      located.push(id);
      return titles[id] && id !== 'art_c' ? { root: roots[id]!, title: titles[id]! } : null;
    },
    pageBase: (id) => `https://${hostOf(id)}/`,
    shellUrl: (id) => `https://app.test/a/${id}`,
    ownerName: (id) => owners[id] ?? 'Someone',
  };

  /** A request to the host's listener for artifact `id`'s content host. */
  const at = (id: string, method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Answer> =>
    call(port, method, path, { host: hostOf(id), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body === undefined ? undefined : JSON.stringify(body));
  const json = (answer: Answer): Record<string, unknown> => JSON.parse(answer.body) as Record<string, unknown>;
  const note = { type: 'note', x: 0, y: 0, text: 'Hi', color: 'yellow' };
  const comment = { input: { anchor: '{"element":"n1"}', label: 'Note', text: 'Looks good' } };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-hosting-'));
    const assets = join(dir, 'assets');
    for (const type of ['whiteboard', 'design']) {
      await mkdir(join(assets, 'editors', type), { recursive: true });
      await writeFile(join(assets, 'editors', type, 'index.html'), `<!doctype html><html><head><title>${type}</title></head><body></body></html>`);
    }
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    for (const id of Object.keys(titles)) roots[id] = join(dir, 'artifacts', id);
    tokens.set('v1.owner-a', { id: 'art_a', viewer: { id: 'user:ada', name: 'Ada Lovelace', role: 'owner' } });
    tokens.set('v1.viewer-a', { id: 'art_a', viewer: { id: 'user:vic', name: 'Vic', role: 'viewer' } });
    tokens.set('v1.commenter-a', { id: 'art_a', viewer: { id: 'user:cam', name: 'Cam', role: 'commenter' } });
    tokens.set('v1.editor-a', { id: 'art_a', viewer: { id: 'user:eve', name: 'Eve', role: 'editor' } });
    tokens.set(longToken, { id: 'art_a', viewer: { id: 'guest:g1', name: 'Gus', role: 'editor' } });
    tokens.set('v1.spoof-a', { id: 'art_a', viewer: { id: 'owner', name: 'Mallory', role: 'editor' } });
    tokens.set('v1.owner-b', { id: 'art_b', viewer: { id: 'user:bob', name: 'Bob', role: 'owner' } });
    tokens.set('v1.owner-c', { id: 'art_c', viewer: { id: 'user:ada', name: 'Ada', role: 'owner' } });
    server = createTypeServer({ assetsDir: assets, secret, idleMs: 0, viewerName: 'Local', downloadsDir: join(dir, 'downloads'), lanAddresses: () => [], hosting });
    await server.listen(0);
    internalPort = Number(new URL(server.url).port);
    front = createServer((req, res) => server.handle(req, res));
    front.on('upgrade', (req, socket, head) => server.upgrade(req, socket, head));
    await new Promise<void>((done) => front.listen(0, '127.0.0.1', done));
    const address = front.address();
    port = typeof address === 'object' && address ? address.port : 0;
    // Artifact b is created by the host and opened by it before anyone asks.
    await server.open({ id: 'art_b', root: roots.art_b!, type: 'whiteboard', title: 'Plans' });
  });

  after(async () => {
    front.closeAllConnections();
    await new Promise<void>((done) => front.close(() => done()));
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('is whoever the host says holds the token, over loopback too, and opens the artifact on demand', async () => {
    // Through the host's listener: artifact a was not open; the token opens it.
    const viewer = await at('art_a', 'GET', '/whiteboard/v1.viewer-a/_api/session');
    assert.equal(viewer.status, 200, viewer.body);
    assert.deepEqual((json(viewer) as { viewer: Viewer }).viewer, { id: 'user:vic', name: 'Vic', role: 'viewer' });
    assert.equal((json(viewer) as { agent: { available: boolean } }).agent.available, false);
    // Straight to the loopback listener: still the viewer, never the owner.
    const direct = await call(internalPort, 'GET', '/whiteboard/v1.viewer-a/_api/session', { host: hostOf('art_a') });
    assert.equal(direct.status, 200);
    assert.equal((json(direct) as { viewer: Viewer }).viewer.role, 'viewer');
    // The long token alphabet of a signed token passes the route.
    const guest = await at('art_a', 'GET', `/whiteboard/${longToken}/_api/session`);
    assert.equal(guest.status, 200, guest.body);
    assert.deepEqual((json(guest) as { viewer: Viewer }).viewer, { id: 'guest:g1', name: 'Gus', role: 'editor' });
  });

  it('refuses a token the host does not know, and never hands out its own', async () => {
    const api = await at('art_a', 'GET', '/whiteboard/v1.nobody/_api/session');
    assert.equal(api.status, 403);
    assert.equal(json(api).code, 'not_granted');
    assert.equal(api.headers['access-control-allow-origin'], undefined);
    // The Shell's broker (the app origin) reads the refusal and gets its preflight, so it sees a 403, not a network error.
    const fromShell = await at('art_a', 'GET', '/whiteboard/v1.nobody/_api/session', { origin: 'https://app.test' });
    assert.equal(fromShell.status, 403);
    assert.equal(fromShell.headers['access-control-allow-origin'], 'https://app.test');
    const preflight = await at('art_a', 'OPTIONS', '/whiteboard/v1.nobody/_api/presence', { origin: 'https://app.test', 'access-control-request-method': 'POST' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'https://app.test');
    const elsewhere = await at('art_a', 'GET', '/whiteboard/v1.nobody/_api/session', { origin: 'https://evil.test' });
    assert.equal(elsewhere.headers['access-control-allow-origin'], undefined);
    const page =await at('art_a', 'GET', '/whiteboard/v1.nobody/', { accept: 'text/html' });
    assert.equal(page.status, 403);
    // A top-level visit goes to the Shell, which signs a new token.
    const visit = await at('art_a', 'GET', '/whiteboard/v1.nobody/', { 'sec-fetch-dest': 'document' });
    assert.equal(visit.status, 302);
    assert.equal(visit.headers.location, 'https://app.test/a/art_a');
    // Page addresses it hands out are the host's Shell, never its own token.
    const list = json(await call(internalPort, 'GET', '/__open-artifact/list', { authorization: `Bearer ${secret}` })) as { artifacts: { id: string; url: string }[] };
    assert.equal(list.artifacts.find((a) => a.id === 'art_b')?.url, 'https://app.test/a/art_b');
    const opened = await server.open({ id: 'art_b', root: roots.art_b!, type: 'whiteboard' });
    assert.equal(opened.pageUrl, 'https://app.test/a/art_b');
    // A non-owner the host calls `owner` is refused: that id is the owner's alone.
    assert.equal((await at('art_a', 'GET', '/whiteboard/v1.spoof-a/_api/session')).status, 403);
  });

  it('tells resolve what each request is: the page document, an api call, the WebSocket', async () => {
    uses.length = 0;
    assert.equal((await at('art_a', 'GET', '/whiteboard/v1.editor-a/')).status, 200);
    assert.equal((await at('art_a', 'GET', '/whiteboard/v1.editor-a/index.html')).status, 200);
    assert.equal((await at('art_a', 'GET', '/whiteboard/v1.editor-a/_api/files')).status, 200);
    assert.equal((await at('art_a', 'GET', '/whiteboard/v1.editor-a/support.js')).status, 200);
    const ws = await socketTo(port, '/whiteboard/v1.editor-a/_api/events?client=ws-1', { host: hostOf('art_a') });
    assert.equal(ws.status, 101);
    ws.socket!.destroy();
    assert.deepEqual(
      uses.map((u) => [u.token, u.use, u.type]),
      [
        ['v1.editor-a', 'document', 'whiteboard'],
        ['v1.editor-a', 'document', 'whiteboard'],
        ['v1.editor-a', 'api', 'whiteboard'],
        ['v1.editor-a', 'api', 'whiteboard'],
        ['v1.editor-a', 'socket', 'whiteboard'],
      ],
    );
  });

  it('holds each role to the role table: only the owner sends to the agent', async () => {
    const write = { client: 'p', writes: [{ op: 'set', path: 'elements/n1', data: note }] };
    // A viewer looks.
    assert.equal((await at('art_a', 'GET', '/whiteboard/v1.viewer-a/_api/comments')).status, 200);
    for (const [path, body] of [
      ['_api/db/write', write],
      ['_api/comments/create', comment],
      ['_api/agent/send', { request: { text: 'hi' } }],
    ] as const) {
      const res = await at('art_a', 'POST', `/whiteboard/v1.viewer-a/${path}`, {}, body);
      assert.equal(res.status, 403, path);
      assert.equal(json(res).code, 'not_writer');
    }
    // A commenter comments, under their name, and edits nothing.
    const created = await at('art_a', 'POST', '/whiteboard/v1.commenter-a/_api/comments/create', {}, comment);
    assert.equal(created.status, 200, created.body);
    assert.equal((json(created) as { thread: { messages: { author: { name: string } }[] } }).thread.messages[0]!.author.name, 'Cam');
    assert.equal((await at('art_a', 'POST', '/whiteboard/v1.commenter-a/_api/db/write', {}, write)).status, 403);
    // An editor edits, but does not reach the agent.
    assert.equal((await at('art_a', 'POST', '/whiteboard/v1.editor-a/_api/db/write', {}, write)).status, 200);
    assert.equal((await at('art_a', 'POST', '/whiteboard/v1.editor-a/_api/agent/send', {}, { request: { text: 'hi' } })).status, 403);
    // The owner does.
    const sent = await at('art_a', 'POST', '/whiteboard/v1.owner-a/_api/agent/send', {}, { request: { text: 'hi' } });
    assert.equal(sent.status, 200, sent.body);
    // Writes from another origin than the page's or the host's Shell are refused.
    assert.equal((await at('art_a', 'POST', '/whiteboard/v1.editor-a/_api/db/write', { origin: 'https://evil.test' }, write)).status, 403);
    // The host's Shell (its broker) may call, and read the answer.
    const brokered = await at('art_a', 'GET', '/whiteboard/v1.editor-a/_api/session', { origin: 'https://app.test' });
    assert.equal(brokered.headers['access-control-allow-origin'], 'https://app.test');
  });

  it("names the owner by the host's word, per artifact, keeping the id `owner`", async () => {
    const a = json(await at('art_a', 'GET', '/whiteboard/v1.owner-a/_api/session')) as { viewer: Viewer; agent: { available: boolean } };
    assert.deepEqual(a.viewer, { id: 'owner', name: 'Ada', role: 'owner' });
    const b = json(await at('art_b', 'GET', '/whiteboard/v1.owner-b/_api/session')) as { viewer: Viewer };
    assert.deepEqual(b.viewer, { id: 'owner', name: 'Bob', role: 'owner' });
    // The owner's comment is signed with that name.
    const created = await at('art_b', 'POST', '/whiteboard/v1.owner-b/_api/comments/create', {}, comment);
    assert.equal(created.status, 200, created.body);
    assert.equal((json(created) as { thread: { messages: { author: { name: string } }[] } }).thread.messages[0]!.author.name, 'Bob');
  });

  it("keeps to the deployment's Host names", async () => {
    assert.equal((await call(port, 'GET', '/whiteboard/v1.owner-a/_api/session', { host: 'evil.test' })).status, 403);
    assert.equal((await call(port, 'GET', '/whiteboard/v1.owner-a/_api/session', { host: '127.0.0.1' })).status, 403);
    assert.equal((await call(internalPort, 'GET', '/whiteboard/v1.owner-a/_api/session', { host: `127.0.0.1:${internalPort}` })).status, 403);
    const ws = await socketTo(port, '/whiteboard/v1.owner-a/_api/events', { host: 'evil.test' });
    assert.equal(ws.status, 403);
    // The daemon routes stay on the loopback listener, behind the secret.
    assert.equal((await call(port, 'GET', '/__open-artifact/health', { host: 'app.test', authorization: `Bearer ${secret}` })).status, 404);
    assert.equal((await call(internalPort, 'GET', '/__open-artifact/health')).status, 401);
    assert.equal((await call(internalPort, 'GET', '/__open-artifact/health', { authorization: `Bearer ${secret}` })).status, 200);
  });

  it("builds page addresses from the host's page base and the request's token", async () => {
    const slash = await at('art_a', 'GET', `/whiteboard/${longToken}?x=1`);
    assert.equal(slash.status, 308);
    assert.equal(slash.headers.location, `https://art-a.content.test/whiteboard/${longToken}/?x=1`);
    // A top-level visit to the page goes to the host's Shell.
    const visit = await at('art_a', 'GET', '/whiteboard/v1.owner-a/?open_artifact_shell=https%3A%2F%2Fapp.test', { 'sec-fetch-dest': 'document' });
    assert.equal(visit.status, 302);
    assert.equal(visit.headers.location, 'https://app.test/a/art_a');
    // The frame Shell's boot names the page at the content host, with this token.
    const boot = await at('art_c', 'GET', '/design/v1.owner-c/');
    assert.equal(boot.status, 200, boot.body);
    const parsed = JSON.parse(/window\.boot=(.*);<\/script>/.exec(boot.body)![1]!) as { page: string; pageUrl: string; userName: string; typeServer: Record<string, unknown> };
    assert.equal(parsed.page, 'https://art-c.content.test/design/v1.owner-c/index.html');
    assert.equal(parsed.userName, 'Ada');
    assert.equal(parsed.typeServer.sharePath, undefined);
    // Content answers send their Referer to their own origin only.
    assert.equal(boot.headers['referrer-policy'], 'same-origin');
    assert.equal(visit.headers['referrer-policy'], 'same-origin');
    assert.equal((await at('art_a', 'GET', '/whiteboard/v1.owner-a/_api/session')).headers['referrer-policy'], 'same-origin');
  });

  it('lets only the app origin (and the content host itself) frame its pages', async () => {
    const ancestors = (answer: Answer): string | undefined => /frame-ancestors ([^;]*)/.exec(String(answer.headers['content-security-policy'] ?? ''))?.[1];
    const want = "'self' https://app.test";
    // The editor page, and a type's own frame Shell.
    const page = await at('art_a', 'GET', '/whiteboard/v1.owner-a/index.html');
    assert.equal(page.status, 200, page.body);
    assert.equal(ancestors(page), want);
    const shell = await at('art_c', 'GET', '/design/v1.owner-c/');
    assert.equal(shell.status, 200, shell.body);
    assert.equal(ancestors(shell), want);
    // The page a frame gets when its token is refused.
    const refused = await at('art_a', 'GET', '/whiteboard/v1.nobody/', { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' });
    assert.equal(refused.status, 403);
    assert.match(refused.body, /frame_denied/);
    assert.equal(ancestors(refused), want);
  });

  it('turns off what acts on the host computer', async () => {
    const unsupported = async (answer: Promise<Answer>, what: string): Promise<void> => {
      const res = await answer;
      assert.equal(res.status, 400, `${what}: ${res.body}`);
      assert.equal(json(res).code, 'unsupported', what);
    };
    await unsupported(at('art_a', 'POST', '/whiteboard/v1.owner-a/_api/downloads?name=x.txt', {}, 'x'), 'downloads');
    await unsupported(at('art_a', 'GET', '/whiteboard/v1.owner-a/_api/mcp/tools'), 'mcp tools');
    await unsupported(at('art_a', 'POST', '/whiteboard/v1.owner-a/_api/mcp/call', {}, { server: 's', tool: 't' }), 'mcp call');
    await unsupported(at('art_a', 'GET', '/s/abcdefghijklmnop'), '/s/');
    const action = (name: string, args: Record<string, unknown>): Promise<Answer> =>
      call(internalPort, 'POST', `/__open-artifact/actions/${name}`, { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, JSON.stringify({ id: 'art_a', root: roots.art_a, args }));
    await unsupported(action('snapshot', {}), 'snapshot');
    await unsupported(action('upload', { file: join(dir, 'assets', 'support.js') }), 'upload');
    const check = await action('check', {});
    assert.equal(check.status, 200, check.body);
    await unsupported(call(internalPort, 'GET', '/__open-artifact/share?id=art_a', { authorization: `Bearer ${secret}` }), 'share');
  });

  it("serves uploads by the content host's artifact, checking a page Referer", async () => {
    const made = await call(port, 'POST', '/whiteboard/v1.editor-a/_api/assets?name=a.png', { host: hostOf('art_a'), 'content-type': 'image/png' }, new Uint8Array([1, 2, 3]));
    assert.equal(made.status, 200, made.body);
    const { id } = json(made) as { id: string };
    // No Referer: the id is the capability, within that artifact.
    assert.equal((await at('art_a', 'GET', `/_blob/${id}`)).status, 200);
    assert.equal((await at('art_b', 'GET', `/_blob/${id}`)).status, 404);
    assert.equal((await call(port, 'GET', `/_blob/${id}`, { host: 'app.test' })).status, 404);
    // A page Referer must carry a token that holds for this artifact.
    assert.equal((await at('art_a', 'GET', `/_blob/${id}`, { referer: 'https://art-a.content.test/whiteboard/v1.viewer-a/' })).status, 200);
    assert.equal((await at('art_a', 'GET', `/_blob/${id}`, { referer: `https://art-a.content.test/whiteboard/v1.nobody/` })).status, 403);
    assert.equal((await at('art_a', 'GET', `/_blob/${id}`, { referer: 'https://art-a.content.test/whiteboard/v1.owner-b/' })).status, 403);
    // Another site's Referer is no page of this artifact.
    assert.equal((await at('art_a', 'GET', `/_blob/${id}`, { referer: 'https://app.test/a/art_a' })).status, 200);
  });

  it('opens an artifact that is not open for an upload asked without a Referer, where the host locates it', async () => {
    const made = await call(port, 'POST', '/whiteboard/v1.editor-a/_api/assets?name=b.png', { host: hostOf('art_a'), 'content-type': 'image/png' }, new Uint8Array([4, 5, 6]));
    assert.equal(made.status, 200, made.body);
    const { id } = json(made) as { id: string };
    assert.equal(server.close('art_a'), true);
    located.length = 0;
    const blob = await at('art_a', 'GET', `/_blob/${id}`);
    assert.equal(blob.status, 200, blob.body);
    assert.deepEqual(located, ['art_a']);
    // Open now: no second lookup.
    assert.equal((await at('art_a', 'GET', `/_blob/${id}`)).status, 200);
    assert.deepEqual(located, ['art_a']);
    // Where the host does not locate it, it stays closed and unknown.
    server.close('art_c');
    assert.equal((await at('art_c', 'GET', `/_blob/${id}`)).status, 404);
    assert.deepEqual(located, ['art_a', 'art_c']);
  });

  it("ends the page connections of those the host's check refuses", async () => {
    const owner = await stream(port, '/whiteboard/v1.owner-a/_api/events?client=o1', { host: hostOf('art_a') });
    const viewer = await stream(port, '/whiteboard/v1.viewer-a/_api/events?client=v1', { host: hostOf('art_a') });
    server.disconnect('art_a', (who) => who.role === 'owner');
    assert.equal(await settled(viewer.ended, 2000), true);
    assert.equal(await settled(owner.ended), false);
    server.disconnect('art_a');
    assert.equal(await settled(owner.ended, 2000), true);
    owner.close();
    viewer.close();
  });

  it("carries the host's WebSocket through `upgrade`, as the viewer resolve gave", async () => {
    const ws = await socketTo(port, '/whiteboard/v1.viewer-a/_api/events?client=ws-2', { host: hostOf('art_a'), origin: 'https://app.test' });
    assert.equal(ws.status, 101);
    // The stream opens with where the board's documents stand.
    assert.equal((ws.start?.data as { resync?: boolean } | undefined)?.resync, true);
    assert.equal(ws.first?.event, 'agent');
    // Only the owner's page hears of an available agent.
    assert.equal((ws.first?.data as { available: boolean }).available, false);
    const closed = new Promise<void>((done) => ws.socket!.on('close', () => done()));
    server.disconnect('art_a', (who) => who.role !== 'viewer');
    assert.equal(await settled(closed, 2000), true);
    // Refused: an unknown token, another site's Origin.
    assert.equal((await socketTo(port, '/whiteboard/v1.nobody/_api/events', { host: hostOf('art_a') })).status, 403);
    assert.equal((await socketTo(port, '/whiteboard/v1.owner-a/_api/events', { host: hostOf('art_a'), origin: 'https://evil.test' })).status, 403);
  });
});

describe('without hosting', () => {
  it('is the loopback owner, as before', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'open-artifact-unhosted-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'whiteboard'), { recursive: true });
    await writeFile(join(assets, 'editors', 'whiteboard', 'index.html'), '<!doctype html><html><head></head><body></body></html>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    const server = createTypeServer({ assetsDir: assets, secret: 's', idleMs: 0, viewerName: 'Ada', downloadsDir: join(dir, 'downloads'), lanAddresses: () => [] });
    try {
      const base = await server.listen();
      const opened = await server.open({ root: join(dir, 'Retro'), type: 'whiteboard' });
      assert.ok(opened.pageUrl.startsWith(base));
      const port = Number(new URL(base).port);
      const path = new URL(opened.pageUrl).pathname;
      const session = await call(port, 'GET', `${path}_api/session`, { host: `127.0.0.1:${port}` });
      assert.equal(session.status, 200);
      assert.deepEqual((JSON.parse(session.body) as { viewer: Viewer }).viewer, { id: 'owner', name: 'Ada', role: 'owner' });
      assert.equal(session.headers['referrer-policy'], 'no-referrer');
      // Locally any page may frame it (the daemon's Shell, a LAN guest's browser, an app whose page is file://):
      // no frame-ancestors at all, since `*` leaves out file:// and an app's own scheme.
      const page = await call(port, 'GET', `${path}index.html`, { host: `127.0.0.1:${port}` });
      assert.equal(page.status, 200);
      assert.doesNotMatch(String(page.headers['content-security-policy']), /frame-ancestors/);
      const slash = await call(port, 'GET', path.slice(0, -1), { host: `127.0.0.1:${port}` });
      assert.equal(slash.status, 308);
      assert.equal(slash.headers.location, path);
      // A Host this computer does not answer to is refused.
      assert.equal((await call(port, 'GET', `${path}_api/session`, { host: 'evil.test' })).status, 403);
      // Downloads are saved here.
      const download = await call(port, 'POST', `${path}_api/downloads?name=x.txt`, { host: `127.0.0.1:${port}` }, 'x');
      assert.equal(download.status, 200, download.body);
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
