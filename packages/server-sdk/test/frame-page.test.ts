import type { FramePageRuntime } from '@open-artifact/server-sdk/frame/page-api';
/**
 * frame-host in page mode (the built-in `page` type): each artifact's own root index.html is its page, the
 * capabilities come from its `.artifact.json` only, a page with no index.html shows an empty state, `publish(html)`
 * replaces the page, and its `<title>` becomes the artifact's. Also the runtime's `window.claude` alias, run in a vm.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import vm from 'node:vm';
import { FrameSite, frameActions, mountFrameSite, pageDeclaration, type FrameSession } from '../src/frame/index.ts';
import { TypeApi, TypeServer } from '../src/index.ts';

const SECRET = 'test-secret-0123456789';
const WITH_CAPS = 'art_pagecaps01';
const BARE = 'art_pagebare01';
const RUNTIME = join(import.meta.dirname, '..', 'src', 'frame', 'client', 'runtime.ts');

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function http(port: number, opts: { method?: string; path: string; host?: string; headers?: Record<string, string | number>; body?: unknown }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path,
        headers: { Host: opts.host ?? `127.0.0.1:${port}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const marker = (root: string, capabilities?: Record<string, unknown>): void =>
  writeFileSync(join(root, '.artifact.json'), JSON.stringify({ id: 'x', type: 'page', ...(capabilities ? { capabilities } : {}) }));

describe('frame-host page mode', () => {
  let tmp: string;
  let typeDir: string;
  let capsRoot: string;
  let bareRoot: string;
  let daemon: Server;
  let server: TypeServer;
  let port: number;
  const sites = new Map<string, FrameSite>();
  const pages = new Map<string, string>();
  const touches: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'open-artifact-frame-page-'));
    // The type folder holds no index.html: a page type is only its manifest and skill.
    typeDir = join(tmp, 'page');
    mkdirSync(typeDir, { recursive: true });
    writeFileSync(join(typeDir, 'artifact-type.json'), JSON.stringify({ name: 'Page', openArtifact: { style: 'page' } }));
    writeFileSync(join(typeDir, 'SKILL.md'), '---\nname: page\ndescription: test\n---\n');

    capsRoot = join(tmp, 'caps');
    mkdirSync(capsRoot, { recursive: true });
    marker(capsRoot, { db: true, assets: {}, mcp: true, comments: false });
    // The page's own declaration block is ignored in page mode: only the marker counts.
    writeFileSync(
      join(capsRoot, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"><title>Lunch &amp; poll</title><script>\n  // artifact.json\n  var key = "mine";\n  var capabilities = { room: {}, user: {} };\n</script></head><body><p id="hi">hi</p></body></html>\n',
    );

    bareRoot = join(tmp, 'bare');
    mkdirSync(bareRoot, { recursive: true });
    marker(bareRoot);

    daemon = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
        const url = new URL(req.url ?? '/', 'http://x');
        res.setHeader('Content-Type', 'application/json');
        if (req.headers.authorization !== 'Bearer type-token') return res.writeHead(401).end('{}');
        if (url.pathname === '/api/open-artifact.type.touch') {
          touches.push(body);
          return res.end('{}');
        }
        if (url.pathname === '/api/open-artifact.type.artifact') return res.end(JSON.stringify({ id: url.searchParams.get('id'), agentName: 'Agent' }));
        if (url.pathname === '/api/open-artifact.type.presence') return res.end(JSON.stringify({ presence: 'online', canSend: true, canSendSession: true, busy: false, agentName: 'Agent' }));
        res.writeHead(404).end('{}');
      });
    });
    await new Promise<void>((r) => daemon.listen(0, '127.0.0.1', r));

    server = new TypeServer({
      mountSite: async (r, ctx) => {
        const site = await mountFrameSite(r, { ...ctx, typeDir, page: true });
        sites.set(r, site);
        return site;
      },
      actions: frameActions,
      type: 'page',
      port: 0,
      secret: SECRET,
      idleMs: 0,
      contentHosts: true,
      daemon: new TypeApi({ url: `http://127.0.0.1:${(daemon.address() as AddressInfo).port}`, token: 'type-token' }),
      log: () => undefined,
    });
    await server.listen();
    port = server.port;
    for (const [id, root] of [
      [WITH_CAPS, capsRoot],
      [BARE, bareRoot],
    ]) {
      const r = await http(port, { method: 'POST', path: '/__open-artifact/open', headers: { Authorization: `Bearer ${SECRET}` }, body: { id, root, title: 'Untitled page' } });
      assert.equal(r.status, 200, r.text);
      pages.set(id, new URL(r.json.url).pathname);
    }
  });

  after(async () => {
    server.close();
    await new Promise((r) => daemon.close(r));
    rmSync(tmp, { recursive: true, force: true });
  });

  const shellApi = (id: string, name: string, body?: unknown): Promise<Reply> =>
    http(port, { method: body ? 'POST' : 'GET', path: `${pages.get(id)}api/frame/${name}`, headers: { Origin: `http://127.0.0.1:${port}` }, body });
  const session = async (id: string): Promise<FrameSession> => {
    const r = await shellApi(id, 'session');
    assert.equal(r.status, 200, r.text);
    return r.json;
  };
  const capCall = async (id: string, cap: string, method: string, arg: unknown): Promise<any> => {
    const r = await shellApi(id, 'cap', { cap, method, args: [arg], client: 'testclient01', brokerGen: (await session(id)).brokerGen });
    assert.equal(r.status, 200, r.text);
    return r.json;
  };
  const index = (id: string): Promise<Reply> =>
    http(port, { path: '/_f/v/', host: `${id}.frame.localhost:${port}`, headers: { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'cross-site', Referer: `http://127.0.0.1:${port}/` } });

  it('pageDeclaration reads the marker, drops false values, and is empty without one', () => {
    assert.deepEqual(pageDeclaration(capsRoot).capabilities, { db: true, assets: {}, mcp: true });
    assert.equal(pageDeclaration(capsRoot).key, 'page');
    assert.deepEqual(pageDeclaration(bareRoot).capabilities, {});
    assert.deepEqual(pageDeclaration(join(tmp, 'nowhere')).capabilities, {});
  });

  it("serves the artifact's own index.html, the runtime injected first", async () => {
    const r = await index(WITH_CAPS);
    assert.equal(r.status, 200, r.text);
    assert.match(r.text, /<p id="hi">hi<\/p>/);
    const runtime = r.text.indexOf('/_runtime/open-artifact-frame.js');
    assert.ok(runtime > 0 && runtime < r.text.indexOf('// artifact.json'), "the runtime comes before the page's own scripts");
  });

  it('serves capability modules on the content origin for this contract', async () => {
    const host = `${WITH_CAPS}.frame.localhost:${port}`;
    const get = (name: string, method = 'GET') => http(port, { method, host, path: `/_/openartifact:${name}` });
    const loader = await get('use');
    assert.equal(loader.status, 200);
    assert.match(String(loader.headers['content-type']), /javascript/);
    assert.match(loader.text, /export/);
    const version = (await session(WITH_CAPS)).contract;
    const db = await get(`db@${version}`);
    assert.equal(db.status, 200);
    assert.equal(db.text, (await get('db')).text);
    assert.equal((await get('db', 'HEAD')).text, '');
    assert.equal((await get(`use@${version}`)).status, 200);
    for (const name of ['db@9.9.9', 'db@00.2.92', 'db/child', 'constructor', 'arbitrary']) {
      assert.equal((await get(name)).status, 404, name);
    }
  });

  it('a page with no index.html shows a neutral empty state, not an error', async () => {
    const r = await index(BARE);
    assert.equal(r.status, 200, r.text);
    assert.match(r.text, /data-open-artifact-empty/);
    assert.match(r.text, /\/_runtime\/open-artifact-frame\.js/);
    assert.doesNotMatch(r.text, /error/i);
  });

  it('grants come from the marker only; with nothing declared, only artifact and permissions', async () => {
    const caps = await session(WITH_CAPS);
    assert.equal(caps.key, 'page');
    for (const cap of ['artifact', 'permissions', 'db', 'assets']) assert.ok(caps.grants.includes(cap), cap);
    for (const cap of ['room', 'user', 'comments']) assert.ok(!caps.grants.includes(cap), `${cap} is not granted`);
    assert.equal(caps.stubs.mcp, 'server_not_connected');
    const bare = await session(BARE);
    assert.deepEqual([...bare.grants].sort(), ['artifact', 'permissions']);
    assert.equal((await capCall(BARE, 'db', 'get', { path: 'a/b' })).error.code, 'not_granted');
  });

  it('a changed marker rewires the site with the new set', async () => {
    const site = sites.get(bareRoot)!;
    const gen = (await session(BARE)).brokerGen;
    marker(bareRoot, { db: true });
    assert.equal(site.capabilitiesChanged(), true);
    assert.equal(site.capabilitiesChanged(), false, 'nothing new the second time');
    const s = await session(BARE);
    assert.ok(s.brokerGen > gen);
    assert.ok(s.grants.includes('db'));
    const put = await capCall(BARE, 'db', 'set', { path: 'votes/one', data: { n: 1 } });
    assert.ok(!put.error, JSON.stringify(put));
    assert.deepEqual(JSON.parse(readFileSync(join(bareRoot, 'db', 'votes', 'one.json'), 'utf8')), { n: 1 });
    // A session request also re-checks, in case a watcher missed the change.
    marker(bareRoot, {});
    assert.deepEqual([...(await session(BARE)).grants].sort(), ['artifact', 'permissions']);
  });

  it("artifact.publish(html) replaces the root index.html; a stale ver is a conflict and writes nothing", async () => {
    const site = sites.get(bareRoot)!;
    const ver = site.ver;
    const html = '<!doctype html><html><head><title>Fresh page</title></head><body>new</body></html>';
    const ok = await capCall(BARE, 'artifact', 'publish', { html, ver });
    assert.ok(!ok.error, JSON.stringify(ok));
    assert.equal(readFileSync(join(bareRoot, 'index.html'), 'utf8'), html);
    assert.notEqual(site.ver, ver);
    assert.match((await index(BARE)).text, /<body>new<\/body>/);
    const stale = await capCall(BARE, 'artifact', 'publish', { html: '<p>old view</p>', ver });
    assert.equal(stale.error.code, 'conflict');
    assert.equal(readFileSync(join(bareRoot, 'index.html'), 'utf8'), html, 'nothing written');
    // Files beside the page still publish as before; index.html is now the artifact's own.
    const beside = await capCall(BARE, 'artifact', 'publish', { files: { 'notes.txt': { text: 'n' } } });
    assert.ok(!beside.error, JSON.stringify(beside));
    assert.equal(readFileSync(join(bareRoot, 'notes.txt'), 'utf8'), 'n');
  });

  it("the page's <title> becomes the artifact's title, with no author", async () => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !touches.some((t) => t.title === 'Fresh page')) await new Promise((r) => setTimeout(r, 20));
    const mounted = touches.find((t) => t.title === 'Lunch & poll');
    assert.ok(mounted, `the mounted page's title: ${JSON.stringify(touches)}`);
    assert.equal(mounted.author, '');
    assert.ok(touches.some((t) => t.title === 'Fresh page'), 'the published page’s title');
  });
});

describe('window.claude', () => {
  const src = stripTypeScriptTypes(readFileSync(RUNTIME, 'utf8'));

  /** Runs the frame runtime in a vm against a small fake window. */
  function run(prepare?: (win: Record<string, unknown>) => void, after?: string): Record<string, any> {
    const noop = (): void => undefined;
    const el = (): Record<string, unknown> => ({ style: {}, appendChild: noop, remove: noop, setAttribute: noop, addEventListener: noop, click: noop });
    const win: Record<string, unknown> = {
      __OPEN_ARTIFACT_FRAME: { shellOrigin: 'http://127.0.0.1:1', id: 'art_x', grants: ['artifact', 'permissions'], stubs: [], contract: '0.2.92' },
      parent: { postMessage: noop },
      location: { pathname: '/_f/abc/' },
      document: { readyState: 'complete', addEventListener: noop, removeEventListener: noop, createElement: el, documentElement: el(), body: el(), querySelectorAll: () => [] },
      addEventListener: noop,
      removeEventListener: noop,
      navigator: {},
      crypto: globalThis.crypto,
      TextEncoder,
      TextDecoder,
      queueMicrotask,
      URL,
      Blob,
      MessageChannel,
      structuredClone,
      setTimeout,
      clearTimeout,
      console,
      requestAnimationFrame: noop,
    };
    win.window = win;
    win.self = win;
    prepare?.(win);
    const ctx = vm.createContext(win);
    vm.runInContext(src, ctx);
    // A page's own classic script, after the runtime (a separate script: its top-level declarations are global).
    if (after) win.__after = vm.runInContext(after, ctx);
    return win;
  }

  it('collects a page reply and context independently and discards both when a later listener handles the send', async () => {
    type Packet = Record<string, any>;
    const replies: Packet[] = [];
    const parent = { postMessage: (packet: Packet) => { if (packet.__open_artifact_comments_sent && !packet.pending) replies.push(packet); } };
    let dispatch: (event: Packet) => void;
    const win = run(w => {
      w.parent = parent;
      w.addEventListener = (name: string, callback: (event: Packet) => void) => { if (name === 'message') dispatch = callback; };
    });
    const receive = (data: Packet) => dispatch({ data, origin: 'http://127.0.0.1:1', source: parent });
    receive({ __frame_init: { capabilities: { comments: {} } } });
    const comments = await win.openArtifact.use('comments');
    comments.onSendToAgent(() => { throw new Error('listener exited'); });
    comments.onSendToAgent(async () => { throw new Error('listener rejected'); });
    comments.onSendToAgent(() => ({ handoffNote: '界'.repeat(667), reply: '   ' }));
    comments.onSendToAgent(() => ({ handoffNote: 'page context' }));
    comments.onSendToAgent(() => ({ handoffNote: 'later context', reply: 'the first reply' }));
    const send = async () => {
      receive({ __open_artifact_comments: true, op: 'send', ticket: 't', payload: { text: 'user comment' } });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(replies.length, 1);
      return replies.pop()!;
    };
    const unhandled = await send();
    assert.equal(unhandled.handled, false);
    assert.equal(unhandled.handoffNote, 'page context');
    assert.equal(unhandled.reply, 'the first reply');
    comments.onSendToAgent(() => ({ handled: true, reply: 'handled locally', handoffNote: 'discard' }));
    const handled = await send();
    assert.equal(handled.handled, true);
    assert.equal(handled.reply, 'handled locally');
    assert.equal(handled.handoffNote, undefined);
  });

  it('shares the deferred grant between the artifact name and its self alias', async () => {
    const origin = 'http://127.0.0.1:1';
    let dispatch!: (event: { origin: string; source: object; data: unknown }) => void;
    let requests = 0;
    const parent = { postMessage(message: { __frame_cap_want?: boolean; cap?: string }) {
      if (!message.__frame_cap_want) return;
      requests++;
      assert.equal(message.cap, 'self');
      queueMicrotask(() => emit({ __frame_cap_grant: true, cap: message.cap, grant: { config: {} } }));
    } };
    const emit = (data: unknown) => dispatch({ source: parent, origin, data });
    const win = run(window => {
      window.parent = parent;
      window.addEventListener = (type: string, listener: typeof dispatch) => { if (type === 'message') dispatch = listener; };
    });
    emit({ __frame_init: { capabilities: {}, capWants: true, usable: ['artifact'] } });
    const runtime: FramePageRuntime = win.openArtifact;
    const pending = runtime.use('artifact');
    assert.equal(runtime.use('self'), pending);
    const self = await pending;
    assert.ok(self);
    assert.equal(typeof self.publish, 'function');
    assert.equal(requests, 1);
  });

  it('revokes only the watches that existed when the host sent the update', async () => {
    const origin = 'http://127.0.0.1:1';
    let dispatch!: (ev: { source: object; origin: string; data: unknown }) => void;
    const emit = (data: unknown) => dispatch({ source: parent, origin, data });
    const parent = { postMessage(packet: { __frame_cap?: boolean; id?: string }) {
      if (packet.__frame_cap) queueMicrotask(() => emit({ __frame_cap_r: true, id: packet.id, result: {} }));
    } };
    const win = run(window => {
      window.parent = parent;
      window.addEventListener = (type: string, listener: typeof dispatch) => { if (type === 'message') dispatch = listener; };
    });
    emit({ __frame_init: { capabilities: { db: {} } } });
    const runtime: FramePageRuntime = win.openArtifact;
    const db = await runtime.use('db');
    assert.ok(db);
    const doc = db.doc('notes/one');
    const errors: string[] = [];
    doc.onSnapshot(() => {}, error => {
      errors.push(error.code);
      doc.onSnapshot(() => {}, subsequent => errors.push(subsequent.code));
    });
    await Promise.resolve();
    const revoke = () => emit({ __frame_cap_rewired: true, caps: [] });
    revoke();
    assert.deepEqual(errors, ['revoked']);
    await Promise.resolve();
    revoke();
    assert.deepEqual(errors, ['revoked', 'revoked']);
  });

  it('replays ordered db changes with immutable snapshots and reports network origins by value', async () => {
    type Packet = Record<string, any>;
    const messages: Packet[] = [];
    const listeners = new Map<string, (event: Packet) => void>();
    const parent = { postMessage: (packet: Packet) => messages.push(packet) };
    const host = 'http://127.0.0.1:1';
    const receive = (data: Packet) => listeners.get('message')!({ data, origin: host, source: parent });
    const win = run((w) => {
      w.parent = parent;
      w.addEventListener = (name: string, callback: (event: Packet) => void) => listeners.set(name, callback);
    });
    receive({ __frame_init: { capabilities: { db: {}, network: { config: { origins: ['https://permitted.example'] } } } } });
    const net = await win.openArtifact.use('network');
    (await net.origins()).push('https://discard.example');
    assert.deepEqual(Array.from(await net.origins()), ['https://permitted.example']);

    const db = await win.openArtifact.use('db');
    const docs = db.collection('notes');
    assert.throws(() => db.doc('/notes/a'));
    assert.throws(() => docs.doc('a/nested/b'));
    assert.match(docs.doc().id, /^[a-z0-9]{20}$/);

    const delivered: Packet[] = [];
    const stop = docs.onSnapshot((snapshot: Packet) => delivered.push(snapshot));
    const subscribe = messages.find((m) => m.method === 'subscribe')!;
    const sub = subscribe.args[0].sub;
    receive({ __frame_cap_r: true, id: subscribe.id, result: {} });
    const snapshot = (ids: string[]) => receive({ __frame_db_ev: true, sub, docs: ids.map((id) => ({ id, data: { nested: [id] } })) });
    snapshot(['a', 'b', 'c', 'd', 'e']);
    listeners.get('pagehide')!({ persisted: true });
    snapshot(['e', 'd', 'f']);
    const [first, second] = delivered;
    assert.ok(first && second);
    assert.ok(Object.isFrozen(second) && Object.isFrozen(second.docs) && Object.isFrozen(second.docChanges()));
    assert.ok(Object.isFrozen(second.docs[0]) && Object.isFrozen(second.docs[0].data().nested));
    assert.equal(first.docs[4], second.docs[0]);
    assert.equal(second.docs[0].data(), second.docs[0].data());
    const order = Array.from(first.docs, (doc: any) => doc.id);
    for (const change of second.docChanges()) {
      if (change.oldIndex >= 0) assert.equal(order.splice(change.oldIndex, 1)[0], change.doc.id);
      if (change.newIndex >= 0) order.splice(change.newIndex, 0, change.doc.id);
    }
    assert.deepEqual(order, ['e', 'd', 'f']);
    snapshot(order);
    assert.equal(delivered.length, 2);
    stop();
    const unsubscribe = messages.find((m) => m.method === 'unsubscribe')!;
    receive({ __frame_cap_r: true, id: unsubscribe.id, result: {} });
    let failure: string | undefined;
    docs.onSnapshot(() => assert.fail('the failed watch delivered again'), (e: Error & { code: string }) => { failure = e.code; });
    const last = messages.filter((m) => m.method === 'subscribe').at(-1)!;
    receive({ __frame_cap_r: true, id: last.id, result: {} });
    receive({ __frame_db_ev: true, sub: last.args[0].sub, error: { code: 'revoked', message: 'Watch closed' } });
    assert.equal(failure, 'revoked');
    receive({ __frame_db_ev: true, sub: last.args[0].sub, docs: [] });
    const cleanup = messages.at(-1)!;
    assert.equal(cleanup.method, 'unsubscribe');
    receive({ __frame_cap_r: true, id: cleanup.id, result: {} });
  });

  it('is the same frozen object as window.openArtifact: not writable, but configurable', () => {
    const win = run();
    assert.equal(win.claude, win.openArtifact);
    assert.ok(Object.isFrozen(win.claude));
    assert.equal(typeof win.claude.use, 'function');
    const d = Object.getOwnPropertyDescriptor(win, 'claude')!;
    assert.equal(d.writable, false);
    assert.equal(d.configurable, true);
    assert.equal(d.enumerable, false);
    const own = Object.getOwnPropertyDescriptor(win, 'openArtifact')!;
    assert.equal(own.configurable, false, 'window.openArtifact is unchanged');
    assert.equal(own.writable, false);
  });

  it('lets a classic script declare a top-level claude of its own', () => {
    const win = run(undefined, 'const claude = window.claude; claude === window.openArtifact && typeof claude.use === "function"');
    assert.equal(win.__after, true);
    for (const decl of ['let claude = 1; claude', 'function claude() { return 2; }', 'class claude {} typeof claude']) {
      assert.doesNotThrow(() => run(undefined, decl), decl);
    }
  });

  it('leaves a window.claude the page already defined alone', () => {
    const mine = { mine: true };
    const win = run((w) => {
      w.claude = mine;
    });
    assert.equal(win.claude, mine);
    assert.notEqual(win.openArtifact, mine);
    assert.equal(typeof win.openArtifact.use, 'function');
  });
});
