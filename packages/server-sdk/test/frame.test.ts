/**
 * frame-host: a FrameSite on a TypeServer with content hosts, against a small
 * original-style type written here (no third-party content), with a fake
 * daemon standing in for the Type API. The bin itself is started once at the
 * end to check its ready line.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { after, before, describe, it } from 'node:test';
import { DbStore, docSha256, mergePatch } from '../src/frame/db.ts';
import { FrameSite, frameActions, mountFrameSite, parseDeclaration, type FrameEvent, type FrameSession } from '../src/frame/index.ts';
import { TypeApi, TypeServer } from '../src/index.ts';

const SECRET = 'test-secret-0123456789';
const ID = 'art_frametest1';
const BIN = join(import.meta.dirname, '..', 'bin', 'frame-host.ts');

/** A small original-style type: the declaration block and a page. */
function writeFixtureType(dir: string): void {
  mkdirSync(join(dir, 'artifact-type'), { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>t</title><script>(() => {
  // artifact.json
  var key = "fixture";
  var capabilities = { artifact: {}, db: { rules: [{ path: "", write: "admin" }] }, comments: { customAnchors: true }, assets: {}, user: {}, mcp: {}, flags: { keys: ["fixture_flag"] } };
  var monitoring = { readyTimeoutS: 30 };

  // the rest of the page
  window.fixture = true;
})();</script><script src="artifact-type/app.js" defer></script></head><body><div id="root"></div></body></html>
`,
  );
  writeFileSync(join(dir, 'artifact-type', 'app.js'), 'document.getElementById("root").textContent = "fixture";\n');
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: fixture\ndescription: test\n---\n');
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function http(port: number, opts: { method?: string; path: string; host?: string; headers?: Record<string, string | number>; body?: unknown; raw?: Buffer }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = opts.raw ?? (opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body)));
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path,
        headers: { Host: opts.host ?? `127.0.0.1:${port}`, ...(data && !opts.raw ? { 'Content-Type': 'application/json' } : {}), ...(data ? { 'Content-Length': data.length } : {}), ...opts.headers },
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

describe('frame-host', () => {
  let tmp: string;
  let typeDir: string;
  let root: string;
  let daemon: Server;
  let server: TypeServer;
  let port: number;
  let page: string;
  let site: FrameSite;
  const wakes: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'open-artifact-frame-'));
    typeDir = join(tmp, 'type');
    writeFixtureType(typeDir);
    root = join(tmp, 'artifact');
    mkdirSync(join(root, 'project'), { recursive: true });
    writeFileSync(join(root, 'project', 'hello.txt'), 'hello\n');
    writeFileSync(join(root, '.secret'), 'no');
    mkdirSync(join(root, 'db', 'notes'), { recursive: true });
    writeFileSync(join(root, 'db', 'notes', 'seed.json'), '{"n":1}\n');

    daemon = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
        const url = new URL(req.url ?? '/', 'http://x');
        res.setHeader('Content-Type', 'application/json');
        if (req.headers.authorization !== 'Bearer type-token') return res.writeHead(401).end('{}');
        if (url.pathname === '/api/open-artifact.type.wake') {
          wakes.push(body);
          return res.end(JSON.stringify({ status: 'delivered', via: 'hook' }));
        }
        if (url.pathname === '/api/open-artifact.type.artifact') return res.end(JSON.stringify({ id: url.searchParams.get('id'), agentName: 'Agent' }));
        if (url.pathname === '/api/open-artifact.type.presence') return res.end(JSON.stringify({ presence: 'online', canSend: true, canSendSession: true, busy: false, agentName: 'Agent' }));
        if (url.pathname === '/api/open-artifact.type.touch') return res.end('{}');
        res.writeHead(404).end('{}');
      });
    });
    await new Promise<void>((r) => daemon.listen(0, '127.0.0.1', r));

    server = new TypeServer({
      mountSite: async (r, ctx) => (site = await mountFrameSite(r, { ...ctx, typeDir })),
      actions: frameActions,
      type: 'fixture',
      port: 0,
      secret: SECRET,
      idleMs: 0,
      contentHosts: true,
      daemon: new TypeApi({ url: `http://127.0.0.1:${(daemon.address() as AddressInfo).port}`, token: 'type-token' }),
      log: () => undefined,
    });
    await server.listen();
    port = server.port;
  });

  after(async () => {
    server.close();
    await new Promise((r) => daemon.close(r));
    rmSync(tmp, { recursive: true, force: true });
  });

  const openArtifact = (name: string, body?: unknown): Promise<Reply> => http(port, { method: body ? 'POST' : 'GET', path: `/__open-artifact/${name}`, headers: { Authorization: `Bearer ${SECRET}` }, body });
  const action = async (name: string, args: unknown): Promise<any> => {
    const r = await openArtifact(`actions/${name}`, { id: ID, args });
    assert.equal(r.status, 200, r.text);
    return r.json;
  };
  const shellApi = (name: string, body?: unknown, origin = `http://127.0.0.1:${port}`): Promise<Reply> =>
    http(port, { method: body ? 'POST' : 'GET', path: `${page}api/frame/${name}`, headers: { Origin: origin }, body });
  const capCall = async (cap: string, method: string, arg: unknown, brokerGen?: number): Promise<any> => {
    const r = await shellApi('cap', { cap, method, args: [arg], client: 'testclient01', ...(brokerGen !== undefined ? { brokerGen } : {}) });
    assert.equal(r.status, 200, r.text);
    return r.json;
  };
  const content = (path: string, id = ID): Promise<Reply> => http(port, { path, host: `${id}.frame.localhost:${port}` });

  it('/__open-artifact/open mounts the artifact at an inner shell page', async () => {
    const denied = await http(port, { method: 'POST', path: '/__open-artifact/open', body: { id: ID, root } });
    assert.equal(denied.status, 401);
    const r = await openArtifact('open', { id: ID, root, title: 'Frame test' });
    assert.equal(r.status, 200, r.text);
    const url = new URL(r.json.url);
    assert.match(url.pathname, /^\/f\/[A-Za-z0-9_-]{20,}\/$/);
    page = url.pathname;
    assert.ok(site instanceof FrameSite);
    const actions = await openArtifact('actions');
    assert.deepEqual(
      actions.json.actions.map((a: { name: string }) => a.name),
      ['info'],
    );
  });

  it('the inner shell and its session', async () => {
    const html = await http(port, { path: page });
    assert.equal(html.status, 200);
    assert.match(html.text, /shell\.js/);
    assert.match(String(html.headers['content-security-policy']), new RegExp(`frame-src http://\\*\\.frame\\.localhost:${port}`));
    const js = await http(port, { path: `${page}shell.js` });
    assert.equal(js.status, 200);
    assert.match(String(js.headers['content-type']), /javascript/);
    assert.doesNotMatch(js.text, /^import /m, 'served as a classic script');
    const s = await shellApi('session');
    assert.equal(s.status, 200, s.text);
    const session = s.json as FrameSession;
    assert.equal(session.contentOrigin, `http://${ID}.frame.localhost:${port}`);
    assert.equal(session.key, 'fixture');
    assert.equal(session.brokerGen, 1);
    for (const cap of ['artifact', 'db', 'comments', 'assets', 'user', 'permissions']) assert.ok(session.grants.includes(cap), cap);
    assert.deepEqual(session.flags, { fixture_flag: false });
    assert.equal(session.stubs.mcp, 'server_not_connected');
    assert.equal(session.readyTimeoutS, 30);
    assert.equal(session.agent.available, true);
    assert.deepEqual(session.configs.artifact, { id: ID, key: 'fixture', publish: true });
    const evil = await shellApi('cap', { cap: 'db', method: 'get', args: [{ path: 'notes/seed' }] }, 'http://evil.example');
    assert.equal(evil.status, 403);
  });

  it('serves the page to the inner shell’s frame, the page itself and a typed-in visit, and to no other frame', async () => {
    const index = (headers: Record<string, string>) => http(port, { path: '/_f/v/', host: `${ID}.frame.localhost:${port}`, headers });
    const frame = { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'cross-site' };
    assert.equal((await index({ ...frame, Referer: `http://127.0.0.1:${port}/` })).status, 200, 'the inner shell');
    assert.equal((await index({ ...frame, Referer: `http://localhost:${port}/` })).status, 200, 'the inner shell at localhost');
    assert.equal((await index({ 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin' })).status, 200, 'the page reloading itself');
    assert.equal((await index({ 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'none' })).status, 200, 'a typed-in visit');
    assert.equal((await index({})).status, 200, 'no fetch metadata');
    assert.equal((await index({ ...frame, Referer: 'https://evil.example/' })).status, 403, 'a website');
    assert.equal((await index({ ...frame, Referer: 'http://127.0.0.1:1/' })).status, 403, 'another server on this computer');
    assert.equal((await index(frame)).status, 403, 'a frame that hides its Referer');
    assert.equal((await index({ Referer: 'https://evil.example/' })).status, 403, 'no fetch metadata, a foreign Referer');
  });

  it('the content origin serves the page with the runtime first, and only this artifact', async () => {
    const root302 = await content('/');
    assert.equal(root302.status, 302);
    assert.match(String(root302.headers.location), /^\/_f\/[0-9a-f]{12}\/$/);
    const idx = await content('/_f/anything/');
    assert.equal(idx.status, 200);
    const head = idx.text.indexOf('<head>');
    const preamble = idx.text.indexOf('window.__FRAME_PREAMBLE');
    const runtime = idx.text.indexOf('/_runtime/open-artifact-frame.js');
    assert.equal(preamble, head + '<head>'.length + '<script>'.length, 'injected right after <head>');
    assert.ok(runtime > preamble && runtime < idx.text.indexOf('// artifact.json'), "before the page's own scripts");
    assert.match(idx.text, new RegExp(`"origins":\\["http://127\\.0\\.0\\.1:${port}"\\]`));
    // Every ancestor counts for frame-ancestors, the app around the Shell too (file://, app://): none is sent.
    assert.doesNotMatch(String(idx.headers['content-security-policy'] ?? ''), /frame-ancestors/);
    const js = await content('/_runtime/open-artifact-frame.js');
    assert.equal(js.status, 200);
    assert.match(String(js.headers['content-type']), /javascript/);
    assert.match(js.text, /__frame_cap_rewired/);
    assert.equal((await content('/_f/v/project/hello.txt')).text, 'hello\n');
    assert.equal((await content('/_f/v/artifact-type/app.js')).status, 200);
    for (const p of ['/_f/v/.secret', '/_f/v/db/notes/seed.json', '/_f/v/comments.json', '/_f/v/.artifact-server.json', '/_f/v/%2e%2e/etc/passwd', '/_f/v/_blobs/x', '/_f/v/SKILL.md']) {
      assert.equal((await content(p)).status, 404, p);
    }
    const files = await content('/_f/v/_files.json');
    assert.equal(files.status, 200);
    assert.ok(files.json.files['project/hello.txt']);
    assert.equal(files.json.files['.secret'], undefined);
    assert.equal(files.json.files['db/notes/seed.json'], undefined);
    assert.equal((await content('/_f/v/', 'art_someoneelse')).status, 404);
    assert.equal((await http(port, { path: '/_f/v/', host: `${ID}.frame.localhost:1` })).status, 421);
    assert.equal((await http(port, { method: 'POST', path: '/_f/v/', host: `${ID}.frame.localhost:${port}`, body: {} })).status, 405);
    // The inner shell's routes are not on the content origin.
    assert.equal((await content(`${page}api/frame/session`)).status, 404);
  });

  it('db: an agent write through the action reads back, and the page sees it', async () => {
    const w = await action('open-artifact.db.write', {
      writes: [
        { op: 'set', path: 'notes/a', data: { title: 'A', n: 2 } },
        { op: 'update', collection: 'notes', doc_id: 'seed', data: { m: 3 } },
      ],
    });
    assert.deepEqual(
      w.writes.map((x: { op: string; path: string }) => [x.op, x.path]),
      [
        ['set', 'notes/a'],
        ['update', 'notes/seed'],
      ],
    );
    assert.deepEqual(await action('open-artifact.db.read', { path: 'notes/a' }), { path: 'notes/a', exists: true, sha256: docSha256({ title: 'A', n: 2 }), data: { title: 'A', n: 2 } });
    // An if_match that no longer holds: 409 conflict, with the document as it is now.
    const stale = await openArtifact('actions/open-artifact.db.write', { id: ID, args: { writes: [{ op: 'set', path: 'notes/a', data: { n: 9 }, if_match: docSha256({ old: true }) }] } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'conflict');
    assert.deepEqual(stale.json.current['notes/a'].data, { title: 'A', n: 2 });
    assert.match(stale.json.fix, /if_match/);
    const coll = await action('open-artifact.db.read', { path: 'notes' });
    assert.deepEqual(
      coll.docs.map((d: { id: string }) => d.id),
      ['a', 'seed'],
    );
    assert.deepEqual(coll.docs[1].data, { n: 1, m: 3 });
    assert.equal((await action('open-artifact.db.read', {})).documents.length, 2);
    assert.equal((await openArtifact('actions/open-artifact.db.write', { id: ID, args: { writes: [{ op: 'set', path: 'notes', data: {} }] } })).status, 400);
    const viaPage = await capCall('db', 'query', { path: 'notes', spec: { where: [{ field: 'n', op: '>=', value: 2 }], orderBy: { field: 'n', dir: 'desc' } } });
    assert.deepEqual(
      viaPage.result.docs.map((d: { id: string }) => d.id),
      ['a'],
    );
    await capCall('db', 'set', { path: 'notes/b', data: { n: 5 } });
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'db', 'notes', 'b.json'), 'utf8')), { n: 5 });
    assert.equal((await capCall('db', 'update', { path: 'notes/none', data: { n: 1 } })).error.code, 'invalid_argument');
  });

  it('self.publish writes files with ifMatch and answers conflict', async () => {
    const first = await capCall('self', 'publish', { files: { 'project/new.txt': { text: 'one', ifMatch: null } } });
    assert.ok(first.result, JSON.stringify(first));
    assert.equal(first.result.changed[0].path, 'project/new.txt');
    const sha = first.result.changed[0].sha256;
    assert.equal(readFileSync(join(root, 'project', 'new.txt'), 'utf8'), 'one');
    const again = await capCall('artifact', 'publish', { files: { 'project/new.txt': { text: 'two', ifMatch: null } } });
    assert.equal(again.error.code, 'conflict');
    assert.equal(again.error.paths[0].actual, sha);
    assert.equal(again.error.live, first.result.version);
    const ok = await capCall('artifact', 'publish', { files: { 'project/new.txt': { text: 'two', ifMatch: sha } } });
    assert.ok(ok.result.version);
    assert.equal((await content('/_f/v/project/new.txt')).text, 'two');
    // The page's own publish moves the version without a new broker generation.
    assert.equal(site.brokerGen, 1);
    assert.equal((await capCall('artifact', 'publish', { files: { 'index.html': { text: 'x' } } })).error.code, 'read_only_path');
    assert.equal((await capCall('artifact', 'publish', { html: '<p>x</p>' })).error.code, 'read_only_path');
    assert.equal((await capCall('artifact', 'publish', { files: { '_x/y': { text: 'x' } } })).error.code, 'invalid_content');
    const del = await capCall('artifact', 'publish', { files: { 'project/new.txt': { delete: true, ifMatch: ok.result.shas['project/new.txt'] } } });
    assert.equal(del.result.changed[0].sha256, null);
    assert.equal(existsSync(join(root, 'project', 'new.txt')), false);
  });

  it('unsupported and undeclared capabilities return protocol error codes', async () => {
    assert.equal((await capCall('mcp', 'callTool', {})).error.code, 'server_not_connected');
    const files = await capCall('files', 'list', {});
    assert.equal(files.error.code, 'not_granted');
    assert.match(files.error.message, /does not declare it/);
    assert.equal((await capCall('db', 'nope', {})).error.code, 'invalid_request');
    const me = await capCall('user', 'me', {});
    assert.equal(me.result.id, 'local');
  });

  it('comments: the page creates, the agent replies and reads, and sending wakes the agent', async () => {
    const created = await capCall('comments', 'create', { anchor: { slide: 's1', x: 0.5, y: 0.5 }, text: 'Make this bigger', label: 'Slide 1' });
    const threadId = created.result.threadId;
    assert.match(threadId, /^c_[0-9a-f]{10}$/);
    const stored = JSON.parse(readFileSync(join(root, 'comments.json'), 'utf8'));
    assert.equal(stored.version, 1);
    assert.equal(stored.threads[0].messages[0].author.kind, 'user');
    const reply = await action('open-artifact.comments.reply', { thread_id: threadId, text: 'Done.', resolve: false });
    assert.equal(reply.thread.messages.at(-1).from, 'agent');
    assert.equal(reply.thread.agent.status, 'replied');
    const read = await action('open-artifact.comments.read', { all: false });
    assert.equal(read.threads.length, 1);
    assert.equal(read.threads[0].where, 'Slide 1');
    assert.deepEqual(
      read.threads[0].messages.map((m: { text: string }) => m.text),
      ['Make this bigger', 'Done.'],
    );
    assert.deepEqual((await capCall('comments', 'list', {})).result.threads[0].anchor, { slide: 's1', x: 0.5, y: 0.5 });

    const sent = await capCall('comments', 'sendToAgent', { threadId, text: 'Also the title', handoffNote: 'The selected item is the header' });
    assert.equal(sent.result.status, 'delivered');
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].id, ID);
    assert.equal(wakes[0].threads[0].id, threadId);
    assert.equal(wakes[0].threads[0].messages.at(-1).text, 'Also the title');
    assert.equal(wakes[0].threads[0].pageContext, 'The selected item is the header');
    assert.ok(!readFileSync(join(root, 'comments.json'), 'utf8').includes('The selected item is the header'));
    assert.equal((await action('open-artifact.comments.read', {})).threads[0].agent.status, 'delivered');

    const resolved = await action('open-artifact.comments.resolve', { thread_id: threadId, reopen: false });
    assert.equal(resolved.thread.status, 'resolved');
    assert.equal((await action('open-artifact.comments.read', { all: false })).threads.length, 0);
    assert.equal((await action('open-artifact.comments.read', { all: true })).threads.length, 1);
  });

  it('assets upload, list, serve and delete', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a65f0000000049454e44ae426082', 'hex');
    const up = await http(port, {
      method: 'POST',
      path: `${page}api/frame/upload?type=image/png&gen=1`,
      headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/octet-stream' },
      raw: png,
    });
    const { id, url } = up.json.result;
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.equal(url, `/_blob/${id}`);
    const served = await content(url);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.ok((await capCall('assets', 'list', {})).result.assets.some((a: { id: string }) => a.id === id));
    assert.equal((await capCall('assets', 'delete', { ref: url })).result.deleted, true);
    assert.equal((await content(url)).status, 404);
    const bad = await http(port, { method: 'POST', path: `${page}api/frame/upload?type=application/x-msdownload`, headers: { Origin: `http://127.0.0.1:${port}` }, raw: png });
    assert.equal(bad.json.error.code, 'unsupported_type');
  });

  it('rewires: a changed type or files bumps brokerGen, stale calls are not run', async () => {
    const events: FrameEvent[] = [];
    const stream = request({
      host: '127.0.0.1',
      port,
      path: `${page}api/frame/events?c=testclient02`,
      headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` },
    });
    stream.on('response', (res) => {
      let buf = '';
      res.on('data', (c: Buffer) => {
        buf += c.toString('utf8');
        for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)) as FrameEvent);
        }
      });
    });
    stream.end();
    const wait = async (pred: (e: FrameEvent) => boolean): Promise<FrameEvent> => {
      for (let n = 0; n < 150; n++) {
        const hit = events.find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`no such event in ${JSON.stringify(events)}`);
    };
    try {
      const hello = await wait((e) => e.t === 'hello');
      assert.equal(hello.t === 'hello' && hello.brokerGen, 1);

      // The type changes under the open page: a new generation, the grants it serves now.
      writeFileSync(join(typeDir, 'artifact-type', 'app.js'), 'document.body.dataset.v = "2";\n');
      // Called directly: the folder watcher would get there too, a little later (whichever runs first rewires).
      site.typeChanged();
      const r1 = await wait((e) => e.t === 'rewired' && e.brokerGen === 2);
      assert.equal(r1.t === 'rewired' && r1.reason, 'type');
      assert.ok(r1.t === 'rewired' && r1.caps.includes('db'));
      assert.equal(site.typeChanged(), false, 'nothing new');

      
      const stale = await capCall('db', 'set', { path: 'notes/stale', data: { n: 1 } }, 1);
      assert.deepEqual(stale.error, { code: 'unavailable', message: 'not run: the artifact was updated' });
      assert.equal(existsSync(join(root, 'db', 'notes', 'stale.json')), false);
      assert.equal((await capCall('comments', 'list', {}, 1)).error.code, 'upstream_error');
      assert.deepEqual(await capCall('user', 'me', {}, 1), { result: null });
      assert.equal((await capCall('mcp', 'callTool', {}, 1)).error.retryable, true);
      const stalePut = await http(port, { method: 'POST', path: `${page}api/frame/upload?type=image/png&gen=1`, headers: { Origin: `http://127.0.0.1:${port}` }, raw: Buffer.from('x') });
      assert.equal(stalePut.json.error.code, 'upstream_error');
      assert.ok((await capCall('db', 'get', { path: 'notes/a' }, 2)).result.exists);

      // Files changed on disk (not by the page): another generation, and a files event.
      writeFileSync(join(root, 'project', 'other.txt'), 'from the agent\n');
      site.filesChanged(['project/other.txt']);
      const r2 = await wait((e) => e.t === 'rewired' && e.brokerGen === 3);
      assert.equal(r2.t === 'rewired' && r2.reason, 'files');
      const f = await wait((e) => e.t === 'files' && e.paths.includes('project/other.txt'));
      assert.equal(f.t === 'files' && f.ver, site.ver);
      assert.equal((await action('info', {})).info.brokerGen, 3);
      assert.equal((await shellApi('session')).json.brokerGen, 3);
    } finally {
      stream.destroy();
    }
  });

  it('info action, and closing unmounts', async () => {
    const info = await action('info', {});
    assert.ok(info.info.files.some((f: { path: string }) => f.path === 'project/hello.txt'));
    const closed = await openArtifact('close', { id: ID });
    assert.equal(closed.json.closed, true);
    assert.equal((await content('/_f/v/')).status, 404);
  });
});

describe('frame-host units', () => {
  it('parseDeclaration reads the block in any order and ignores the rest', () => {
    const d = parseDeclaration('<script>\n  // artifact.json\n  var monitoring = { readyTimeoutS: 9 };\n  var key = "k";\n  // ../next/module.ts\n  var capabilities = { db: {} };\n</script>');
    assert.ok(d);
    assert.equal(d.key, 'k');
    assert.deepEqual(d.capabilities, {});
    assert.equal(d.monitoring.readyTimeoutS, 9);
    assert.equal(parseDeclaration('<html></html>'), null);
  });

  it('db merge, queries, leases', () => {
    assert.deepEqual(mergePatch({ a: { b: 1, c: 2 }, d: [1] }, { a: { c: { __delete__: true }, e: 3 }, d: [2] }), { a: { b: 1, e: 3 }, d: [2] });
    const dir = mkdtempSync(join(tmpdir(), 'open-artifact-frame-db-'));
    try {
      const db = new DbStore(dir);
      db.set('c/x', { n: 1, tags: ['a'] });
      db.set('c/y', { n: 3 });
      db.set('c/z', { tags: ['a', 'b'] });
      const ids = (spec: unknown): string[] => db.query('c', spec).map((d: { id: string }) => d.id);
      assert.deepEqual(ids({ orderBy: { field: 'n', dir: 'asc' } }), ['x', 'y', 'z']);
      assert.deepEqual(ids({ orderBy: { field: 'n', dir: 'desc' } }), ['y', 'x', 'z']);
      assert.deepEqual(ids({ where: [{ field: 'tags', op: 'array-contains', value: 'a' }] }), ['x', 'z']);
      assert.deepEqual(ids({ where: [{ field: 'n', op: 'in', value: [3] }], limit: 1 }), ['y']);
      assert.throws(() => db.set('c', {}), /collection/);
      assert.throws(() => db.set('c/../x', {}), /segment/);
      assert.equal(db.acquire('c/x', { holder: 'h1', ttlMs: 5000 }).acquired, true);
      assert.equal(db.acquire('c/x', { holder: 'h2', ttlMs: 5000 }).acquired, false);
      assert.equal(db.acquire('c/x', { holder: 'h1', ttlMs: 5000 }).version, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('db agent view: sha256, paging, queries, if_match and str_replace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-artifact-frame-db-'));
    try {
      const db = new DbStore(dir);
      for (const [id, n] of [['a', 1], ['b', 2], ['c', 3]] as const) db.set(`c/${id}`, { n, body: `Doc ${id}. The end.` });
      type Coll = { docs: { id: string; path: string; sha256: string }[]; total: number; next_cursor?: string; query?: boolean };
      const first = db.readDb('c', { limit: 2 }) as Coll;
      assert.deepEqual(first.docs.map((d) => d.path), ['c/a', 'c/b']);
      assert.equal(first.total, 3);
      assert.equal(first.docs[0]!.sha256, docSha256({ n: 1, body: 'Doc a. The end.' }));
      const rest = db.readDb('c', { limit: 2, cursor: first.next_cursor }) as Coll;
      assert.deepEqual(rest.docs.map((d) => d.id), ['c']);
      assert.equal(rest.next_cursor, undefined);
      const found = db.readDb('c', { query: { where: [{ field: 'n', op: '>=', value: 2 }], orderBy: { field: 'n', dir: 'desc' } } }) as Coll;
      assert.equal(found.query, true);
      assert.deepEqual(found.docs.map((d) => d.id), ['c', 'b']);
      assert.throws(() => db.readDb('c/a', { query: {} }), /collection/);
      assert.throws(() => db.readDb('c', { cursor: 'x' }), /cursor/);

      const shaA = (db.readDb('c/a') as { sha256: string }).sha256;
      // Replacing or deleting an existing document needs if_match when asked to.
      assert.throws(() => db.writeDb([{ op: 'set', path: 'c/a', data: { n: 0 } }], { requireIfMatch: true }), /needs if_match/);
      assert.throws(() => db.writeDb([{ op: 'delete', path: 'c/b' }], { requireIfMatch: true }), /needs if_match/);
      // A new document, an update and an explicit "*" do not.
      db.writeDb([{ op: 'set', path: 'c/new', data: { n: 9 } }, { op: 'update', path: 'c/b', data: { m: 1 } }, { op: 'delete', path: 'c/c', if_match: '*' }], { requireIfMatch: true });
      assert.equal(db.readDoc('c/c'), null);
      // One stale if_match fails the whole batch, and nothing is written.
      try {
        db.writeDb([{ op: 'set', path: 'c/a', data: { n: 5 }, if_match: shaA }, { op: 'set', path: 'c/new', data: { n: 10 }, if_match: docSha256({ n: 0 }) }]);
        assert.fail('expected a conflict');
      } catch (error) {
        const e = error as { code: string; status: number; extra: { current: Record<string, { data: unknown }> } };
        assert.equal(e.code, 'conflict');
        assert.equal(e.status, 409);
        assert.deepEqual(Object.keys(e.extra.current), ['c/new']);
        assert.deepEqual(e.extra.current['c/new']!.data, { n: 9 });
      }
      assert.equal(db.readDoc('c/a')!.n, 1);
      assert.throws(() => db.writeDb([{ op: 'set', path: 'c/new2', data: {}, if_match: shaA }]), /changed/);
      assert.throws(() => db.writeDb([{ op: 'set', path: 'c/a', data: {}, if_match: null }]), /changed/);
      assert.throws(() => db.writeDb([{ op: 'set', path: 'c/a', data: {}, if_match: 'nope' }]), /if_match/);

      const [replaced] = db.writeDb([{ op: 'str_replace', path: 'c/a', field: 'body', old: 'The end.', new: 'Fin.', if_match: shaA }]);
      assert.deepEqual(db.readDoc('c/a'), { n: 1, body: 'Doc a. Fin.' });
      assert.equal(replaced!.sha256, docSha256({ n: 1, body: 'Doc a. Fin.' }));
      assert.throws(() => db.writeDb([{ op: 'str_replace', path: 'c/a', field: 'body', old: 'missing', new: 'x' }]), /does not occur/);
      db.set('c/d', { note: { text: 'la la' } });
      assert.throws(() => db.writeDb([{ op: 'str_replace', path: 'c/d', field: 'note.text', old: 'la', new: 'x' }]), /2 times/);
      db.writeDb([{ op: 'str_replace', path: 'c/d', field: 'note.text', old: 'la la', new: 'ok' }]);
      assert.deepEqual(db.readDoc('c/d'), { note: { text: 'ok' } });
      assert.throws(() => db.writeDb([{ op: 'str_replace', path: 'c/d', field: 'note', old: 'a', new: 'b' }]), /not a text field/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('frame-host bin', () => {
  it('prints the ready line for a declared type, and exits 2 for a folder without one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-artifact-frame-bin-'));
    try {
      writeFixtureType(join(dir, 'type'));
      const env = { ...process.env, OPEN_ARTIFACT_PORT: '0', OPEN_ARTIFACT_TYPE: 'fixture', OPEN_ARTIFACT_SECRET: 'bin-secret', OPEN_ARTIFACT_DAEMON_URL: '', OPEN_ARTIFACT_TYPE_TOKEN: '' };
      const child = spawn(process.execPath, ['--no-warnings', BIN], { env: { ...env, OPEN_ARTIFACT_TYPE_DIR: join(dir, 'type') }, stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        const line = await new Promise<string>((resolve, reject) => {
          createInterface({ input: child.stdout }).once('line', resolve);
          child.once('exit', (code) => reject(new Error(`exited with ${code}`)));
          setTimeout(() => reject(new Error('no ready line')), 10_000).unref();
        });
        const ready = JSON.parse(line) as { openArtifact: string; url: string };
        assert.equal(ready.openArtifact, 'ready');
        const health = await fetch(new URL('__open-artifact/health', ready.url), { headers: { authorization: 'Bearer bin-secret' } });
        assert.equal(((await health.json()) as { type: string }).type, 'fixture');
      } finally {
        child.kill('SIGTERM');
      }
      mkdirSync(join(dir, 'plain'));
      writeFileSync(join(dir, 'plain', 'index.html'), '<!doctype html><p>no declaration</p>');
      const plain = spawn(process.execPath, ['--no-warnings', BIN], { env: { ...env, OPEN_ARTIFACT_TYPE_DIR: join(dir, 'plain') }, stdio: 'ignore' });
      assert.equal(await new Promise((r) => plain.once('exit', r)), 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
