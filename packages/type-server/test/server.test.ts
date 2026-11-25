import assert from 'node:assert/strict';
import type { IncomingHttpHeaders } from 'node:http';
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createTypeServer, pending, sha256, type TypeServer } from '../src/index.ts';
import { findChrome } from '../src/snapshot.ts';

/** Reads SSE frames from a stream until `predicate` matches one. */
async function nextEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (name: string, data: unknown) => boolean,
  timeoutMs = 4000,
): Promise<{ name: string; data: unknown }> {
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<null>((done) => setTimeout(() => done(null), deadline - Date.now())),
    ]);
    if (!chunk || chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const name = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (name && data) {
        const parsed = JSON.parse(data) as unknown;
        if (predicate(name, parsed)) return { name, data: parsed };
      }
    }
  }
  throw new Error('timed out waiting for event');
}

describe('type server', () => {
  let dir: string;
  let root: string;
  let server: TypeServer;
  let page: string;
  const secret = 'test-secret';

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-type-server-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'design'), { recursive: true });
    await writeFile(join(assets, 'editors', 'design', 'index.html'), '<!doctype html><title>Design</title>');
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell/index.html'), '<script>window.boot = /*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    root = join(dir, 'My Design');
    server = createTypeServer({ assetsDir: assets, secret, idleMs: 0, downloadsDir: join(dir, 'downloads') });
    await server.listen();
    page = (await server.open({ root, type: 'design', title: 'My Design' })).url;
  });

  after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('scaffolds a new artifact and serves the editor', async () => {
    const canvas = JSON.parse(await readFile(join(root, 'project', 'canvas.json'), 'utf8')) as { v: number };
    assert.equal(canvas.v, 3);
    const html = await (await fetch(page)).text();
    assert.match(html, /"typeServer":\{"role":"owner"\}/);
    assert.match(await (await fetch(new URL('index.html', page))).text(), /<title>Design<\/title>/);
    assert.equal(await (await fetch(new URL('project/Deep/support.js', page))).text(), '/* runtime */');
    const session = (await (await fetch(new URL('_api/session', page))).json()) as { artifact: { title: string; type: string }; viewer: { role: string } };
    assert.equal(session.artifact.title, 'My Design');
    assert.equal(session.viewer.role, 'owner');
  });

  it('is idempotent and refuses unknown tokens', async () => {
    const again = await server.open({ root, type: 'design' });
    assert.equal(again.url, page);
    const res = await fetch(new URL('/design/nope/_api/session', page));
    assert.equal(res.status, 404);
  });

  it('publishes with ifMatch and reports conflicts', async () => {
    const files = (await (await fetch(new URL('_api/files', page))).json()) as { files: Record<string, { sha256: string }> };
    const canvasHash = files.files['project/canvas.json']!.sha256;
    const ok = await fetch(new URL('_api/publish', page), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: 'a', files: { 'project/A.dc.html': { content: '<x-dc></x-dc>', ifMatch: null } } }),
    });
    assert.equal(ok.status, 200);
    const { hashes } = (await ok.json()) as { hashes: Record<string, string> };
    assert.equal(hashes['project/A.dc.html'], sha256('<x-dc></x-dc>'));

    const stale = await fetch(new URL('_api/publish', page), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: 'a',
        files: {
          'project/A.dc.html': { content: 'new', ifMatch: null },
          'project/canvas.json': { content: '{}', ifMatch: canvasHash },
        },
      }),
    });
    assert.equal(stale.status, 409);
    const body = (await stale.json()) as { code: string; paths: { path: string }[] };
    assert.equal(body.code, 'conflict');
    assert.deepEqual(body.paths.map((p) => p.path), ['project/A.dc.html']);
    // Nothing of the batch was written.
    assert.notEqual(await readFile(join(root, 'project', 'canvas.json'), 'utf8'), '{}');
  });

  it('refuses paths outside project/ and cross-origin writes', async () => {
    const bad = await fetch(new URL('_api/publish', page), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: 'a', files: { '../x': { content: 'x' } } }),
    });
    assert.equal(bad.status, 400);
    const cross = await fetch(new URL('_api/publish', page), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ client: 'a', files: {} }),
    });
    assert.equal(cross.status, 403);
  });

  it('pushes outside changes and suppresses the publisher’s echo', async () => {
    const response = await fetch(new URL('_api/events?client=watcher', page));
    const reader = response.body!.getReader();
    await nextEvent(reader, (name) => name === 'peers');

    // Our own client's publish is not echoed to it, but another client's is.
    await fetch(new URL('_api/publish', page), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: 'other', files: { 'project/B.dc.html': { content: 'b' } } }),
    });
    const owner = await nextEvent(reader, (name) => name === 'files');
    assert.deepEqual(owner.data, { changes: { 'project/B.dc.html': sha256('b') }, author: 'owner' });

    // A write straight to disk (the agent) arrives as an agent change.
    await writeFile(join(root, 'project', 'C.dc.html'), 'c');
    const agent = await nextEvent(reader, (name, data) => name === 'files' && (data as { author: string }).author === 'agent');
    assert.deepEqual((agent.data as { changes: Record<string, string> }).changes, { 'project/C.dc.html': sha256('c') });
    await reader.cancel();
  });

  it('streams the same events over a WebSocket', async () => {
    const target = new URL('_api/events?client=socket', page);
    target.protocol = 'ws:';
    const socket = new WebSocket(target);
    const messages: { event: string; data: unknown }[] = [];
    socket.onmessage = (event) => messages.push(JSON.parse(String(event.data)) as { event: string; data: unknown });
    const next = async (match: (m: { event: string; data: unknown }) => boolean): Promise<{ event: string; data: unknown }> => {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const found = messages.find(match);
        if (found) return found;
        await new Promise((done) => setTimeout(done, 20));
      }
      throw new Error('timed out waiting for a message');
    };
    try {
      await next((m) => m.event === 'agent');
      await next((m) => m.event === 'peers');
      // The page's own publish is not echoed back to it; another page's is.
      await fetch(new URL('_api/publish', page), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client: 'socket', files: { 'project/Mine.dc.html': { content: 'mine' } } }),
      });
      await fetch(new URL('_api/publish', page), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client: 'other', files: { 'project/Theirs.dc.html': { content: 'theirs' } } }),
      });
      const files = await next((m) => m.event === 'files');
      assert.deepEqual(files.data, { changes: { 'project/Theirs.dc.html': sha256('theirs') }, author: 'owner' });
      const listed = (await (await fetch(new URL('/__open-artifact/list', page), { headers: { authorization: `Bearer ${secret}` } })).json()) as { artifacts: { pages: number }[] };
      assert.equal(listed.artifacts[0]!.pages, 1, 'the socket does not count as an open page');
    } finally {
      socket.close();
    }
  });

  it('refuses event sockets from another origin, an artboard, or an unknown token', async () => {
    const { request } = await import('node:http');
    const upgrade = (path: string, headers: Record<string, string> = {}): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = request(new URL(path, page), {
          headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
        });
        req.on('upgrade', (res, socket) => {
          socket.destroy();
          resolve(res.statusCode ?? 0);
        });
        req.on('response', (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
    const own = new URL(page).origin;
    assert.equal(await upgrade('_api/events', { origin: own }), 101);
    assert.equal(await upgrade('_api/events', { origin: 'http://evil.example' }), 403);
    assert.equal(await upgrade('_api/events', { origin: 'null' }), 403);
    assert.equal(await upgrade('_api/events', { origin: own, 'sec-fetch-site': 'cross-site' }), 403);
    assert.equal(await upgrade('_api/events', { origin: own, host: 'evil.example' }), 403);
    assert.equal(await upgrade('_api/files', { origin: own }), 404);
    assert.equal(await upgrade(new URL('_api/events', page).pathname.replace(/[0-9a-f]{32}/, '0'.repeat(32)), { origin: own }), 404);
  });

  it("lets the Shell that framed the page broker its calls", async () => {
    const shell = 'http://127.0.0.1:4999';
    const framed = await server.open({ root, type: 'design', shell });
    assert.equal(new URL(framed.url).searchParams.get('open_artifact_shell'), shell);
    const preflight = await fetch(new URL('_api/publish', page), {
      method: 'OPTIONS',
      headers: { origin: shell, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), shell);
    const session = await fetch(new URL('_api/session', page), { headers: { origin: shell } });
    assert.equal(session.headers.get('access-control-allow-origin'), shell);
    const write = await fetch(new URL('_api/publish', page), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: shell, 'sec-fetch-site': 'same-site' },
      body: JSON.stringify({ client: 'shell', files: { 'project/Shell.txt': { content: 'brokered' } } }),
    });
    assert.equal(write.status, 200);
    assert.equal(write.headers.get('access-control-allow-origin'), shell);
    // Another origin gets no CORS answer and may not write.
    const other = await fetch(new URL('_api/session', page), { headers: { origin: 'http://127.0.0.1:5000' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    const refused = await fetch(new URL('_api/publish', page), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5000' },
      body: JSON.stringify({ client: 'x', files: {} }),
    });
    assert.equal(refused.status, 403);
  });

  it('stores uploads content-addressed', async () => {
    const res = await fetch(new URL('_api/assets?name=a.png', page), { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3]) });
    const record = (await res.json()) as { id: string; url: string; contentType: string };
    assert.equal(record.url, `/_blob/${record.id}`);
    assert.equal(record.contentType, 'image/png');
    const blob = await fetch(new URL(record.url, page));
    assert.equal(blob.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.equal(blob.headers.get('accept-ranges'), 'bytes');
    // A span (how a video seeks), and one past the end.
    const part = await fetch(new URL(record.url, page), { headers: { range: 'bytes=1-' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 1-2/3');
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()), new Uint8Array([2, 3]));
    const past = await fetch(new URL(record.url, page), { headers: { range: 'bytes=9-' } });
    assert.equal(past.status, 416);
    assert.equal(past.headers.get('content-range'), 'bytes */3');
  });

  it('queues requests for the agent and records the view context', async () => {
    const sent = await fetch(new URL('_api/agent/send', page), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: { text: 'Make the title larger', title: 'Send to agent' }, deliver: 'send' }),
    });
    assert.deepEqual(await sent.json(), { status: 'queued' });
    const items = await pending(root);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.request.text, 'Make the title larger');

    const context = { mode: 'canvas', page: null, visibleArtboards: ['A.dc.html'], selectedArtboards: [], dirty: false, selected: [] };
    await fetch(new URL('_api/presence', page), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: 'x', patch: { viewContext: context } }),
    });
    const saved = JSON.parse(await readFile(join(root, '_agent', 'view-context.json'), 'utf8')) as { context: unknown };
    assert.deepEqual(saved.context, context);
  });

  it('guards the daemon routes with the bearer secret', async () => {
    assert.equal((await fetch(new URL('/__open-artifact/health', page))).status, 401);
    const health = await fetch(new URL('/__open-artifact/health', page), { headers: { authorization: `Bearer ${secret}` } });
    assert.equal(((await health.json()) as { openArtifact: number }).openArtifact, 1);
    const action = await fetch(new URL('/__open-artifact/actions', page), { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: '{}' });
    assert.equal(action.status, 404);
    assert.equal(((await action.json()) as { code: string }).code, 'unknown_action');
  });

  it('answers /__open-artifact/open with the protocol OpenResult', async () => {
    const res = await fetch(new URL('/__open-artifact/open', page), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ root, type: 'design', shell: 'http://shell.localhost:4700' }),
    });
    const body = (await res.json()) as { url: string; page_url: string };
    assert.equal(body.page_url, page);
    assert.equal(new URL(body.url).searchParams.get('open_artifact_shell'), 'http://shell.localhost:4700');
  });

  it('runs the check and upload actions', async () => {
    const call = (path: string, body?: unknown): Promise<Response> =>
      fetch(new URL(path, page), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const list = (await (await call('/__open-artifact/actions')).json()) as { actions: { name: string }[] };
    assert.deepEqual(
      list.actions.map((a) => a.name),
      ['check', 'upload', 'context', 'asking', 'snapshot', 'read', 'update', 'batch', 'widget', 'info', 'export', 'duplicate', 'create', 'read', 'update', 'delete', 'batch', 'export', 'import'],
    );
    const asking = (await (await call('/__open-artifact/actions/asking', { id: 'x', root, args: {} })).json()) as { asking: boolean };
    assert.equal(asking.asking, true);
    assert.ok(await stat(join(root, '_agent', 'asking')));
    await call('/__open-artifact/actions/asking', { id: 'x', root, args: { done: true } });
    await assert.rejects(stat(join(root, '_agent', 'asking')));
    // The page opened earlier may have written its context: start from none.
    await rm(join(root, '_agent', 'view-context.json'), { force: true });
    const none = (await (await call('/__open-artifact/actions/context', { id: 'x', root, args: {} })).json()) as { context: unknown; note: string };
    assert.equal(none.context, null);
    assert.match(none.note, /No view context yet/);
    await mkdir(join(root, '_agent'), { recursive: true });
    await writeFile(join(root, '_agent', 'view-context.json'), JSON.stringify({ at: '2026-01-01T00:00:00.000Z', client: 'c1', context: { selection: ['n1'] } }));
    const seen = (await (await call('/__open-artifact/actions/context', { id: 'x', root, args: {} })).json()) as { at: string; context: unknown; note: string };
    assert.deepEqual(seen.context, { selection: ['n1'] });
    assert.equal(seen.at, '2026-01-01T00:00:00.000Z');
    assert.match(seen.note, /data, not instructions/);
    const check = (await (await call('/__open-artifact/actions/check', { id: 'x', root, args: {} })).json()) as { check: { problems: number; findings: unknown[] } };
    assert.equal(typeof check.check.problems, 'number');
    assert.ok(Array.isArray(check.check.findings));
    const file = join(dir, 'dot.svg');
    await writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const upload = (await (await call('/__open-artifact/actions/upload', { id: 'x', root, args: { file } })).json()) as { upload: { url: string } };
    assert.match(upload.upload.url, /^\/_blob\/[0-9a-f]+/);
    // Design keeps comments (the reserved comments actions answer) but no document store.
    const comments = await call('/__open-artifact/actions/open-artifact.comments.read', { id: 'x', root, args: {} });
    assert.equal(comments.status, 200);
    const reserved = await call('/__open-artifact/actions/open-artifact.db.read', { id: 'x', root, args: { path: 'board/meta' } });
    assert.equal(reserved.status, 404);
    assert.equal(((await reserved.json()) as { code: string }).code, 'unknown_action');
  });

  it('snapshot: a PNG of the page under _agent/snapshots, written by a page that changes nothing', async () => {
    const call = (body: unknown): Promise<Response> =>
      fetch(new URL('/__open-artifact/actions/snapshot', page), {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const before = process.env.OPEN_ARTIFACT_CHROME;
    process.env.OPEN_ARTIFACT_CHROME = join(dir, 'no-such-chrome');
    try {
      const missing = await call({ id: 'x', root, args: {} });
      assert.equal(missing.status, 400);
      const body = (await missing.json()) as { code: string; fix: string };
      assert.equal(body.code, 'unsupported');
      assert.match(body.fix, /OPEN_ARTIFACT_CHROME/);
    } finally {
      if (before === undefined) delete process.env.OPEN_ARTIFACT_CHROME;
      else process.env.OPEN_ARTIFACT_CHROME = before;
    }
    const bad = await call({ id: 'x', root, args: { width: 10 } });
    assert.equal(bad.status, 400);

    if (!findChrome()) return; // no browser here: the rest needs one
    const context = JSON.stringify({ at: '2026-01-02T00:00:00.000Z', client: 'c1', context: { selection: ['keep'] } });
    await mkdir(join(root, '_agent'), { recursive: true });
    await writeFile(join(root, '_agent', 'view-context.json'), context);
    const res = await call({ id: 'x', root, args: { width: 800, height: 600 } });
    const shot = (await res.json()) as { image: string; width: number; bytes: number; note: string };
    assert.equal(res.status, 200, JSON.stringify(shot));
    assert.ok(shot.image.startsWith(join(root, '_agent', 'snapshots')));
    const png = await readFile(shot.image);
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'a PNG');
    assert.equal(png.readUInt32BE(16), 800, 'as wide as asked');
    assert.match(shot.note, /Look at it/);
    assert.equal(await readFile(join(root, '_agent', 'view-context.json'), 'utf8'), context, "the snapshot page did not overwrite the person's view context");
  });

  it('sandboxes raw artifact HTML', async () => {
    const res = await fetch(new URL('project/A.dc.html', page));
    assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
  });
});

/** A request with the headers a browser sets and `fetch` may not (`Sec-Fetch-Dest`, Host), redirects not followed. */
async function raw(url: string | URL, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('type server: top-level visits, stale frames and cached editor files', () => {
  let dir: string;
  let server: TypeServer;
  /** The Design and the Whiteboard pages, without a Shell. */
  let design: string;
  let board: string;
  let own: string;
  let boardId: string;
  const secret = 'test-secret';
  const shell = 'http://127.0.0.1:4800';
  const viewer = `${shell}/a/art_design00001`;
  const document = { 'sec-fetch-dest': 'document' };
  const guest = { 'x-test-guest': '1' };
  /** A page address as a Shell frames it. */
  const framed = (page: string, rel = '', from = shell, id = 'art_design00001'): string => {
    const url = new URL(rel, page);
    url.searchParams.set('open_artifact_shell', from);
    url.searchParams.set('open_artifact_id', id);
    return url.href;
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-type-server-frames-'));
    const assets = join(dir, 'assets');
    for (const type of ['design', 'whiteboard']) {
      await mkdir(join(assets, 'editors', type, 'assets'), { recursive: true });
      await writeFile(
        join(assets, 'editors', type, 'index.html'),
        `<!doctype html><html><head><title>${type}</title><script type="module" crossorigin src="./assets/index-AbCd_123.js"></script><link rel="stylesheet" crossorigin href="./assets/index-XyZw-567.css"></head><body></body></html>`,
      );
      await writeFile(join(assets, 'editors', type, 'assets', 'index-AbCd_123.js'), `/* ${type} */`);
      await writeFile(join(assets, 'editors', type, 'assets', 'chart-frame.txt'), 'frame');
    }
    await mkdir(join(assets, 'shell', 'assets'), { recursive: true });
    await writeFile(join(assets, 'shell/index.html'), '<script>window.boot = /*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'shell/assets/index-QwEr7890.js'), '/* shell */');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    server = createTypeServer({
      assetsDir: assets,
      secret,
      idleMs: 0,
      downloadsDir: join(dir, 'downloads'),
      lanAddresses: () => [],
      isLocal: (req) => req.headers['x-test-guest'] === undefined,
    });
    await server.listen();
    own = new URL(server.url).origin;
    design = (await server.open({ root: join(dir, 'Design'), type: 'design', title: 'Design', shell, viewer })).pageUrl;
    const opened = await server.open({ root: join(dir, 'Board'), type: 'whiteboard', title: 'Board', shell, viewer: `${shell}/a/art_board000001` });
    board = opened.pageUrl;
    boardId = opened.id;
  });

  after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('sends the owner who opens the framed page as a page of its own to the Shell that framed it', async () => {
    for (const rel of ['', 'index.html']) {
      const res = await raw(framed(design, rel), document);
      assert.equal(res.status, 302, rel);
      assert.equal(res.headers.location, viewer, 'the Shell address, without query or fragment');
      assert.equal(res.headers['cache-control'], 'no-store');
    }
    const other = await raw(framed(board), document);
    assert.equal(other.status, 302);
    assert.equal(other.headers.location, `${shell}/a/art_board000001`);
    assert.equal((await raw(framed(design), document, 'HEAD')).status, 302);
  });

  it('serves the framed page as before to everything but a top-level visit', async () => {
    for (const headers of [{}, { 'sec-fetch-dest': 'iframe' }, { 'sec-fetch-dest': 'frame' }, { 'sec-fetch-dest': 'empty' }, { 'sec-fetch-dest': 'Document' }] as Record<string, string>[]) {
      const res = await raw(framed(design, 'index.html'), headers);
      assert.equal(res.status, 200, JSON.stringify(headers));
      assert.match(res.body, /<title>design<\/title>/);
    }
    // Snapshots load the page without a Shell in the address: nothing to redirect to.
    assert.equal((await raw(new URL('index.html', design), document)).status, 200);
  });

  it('serves a Shell it was not told the address of, and a page the CLI opened with --shell', async () => {
    // An origin that never framed the page.
    assert.equal((await raw(framed(design, '', 'http://127.0.0.1:4801'), document)).status, 200);
    // `open --shell <origin>` from the CLI gives no address: its page is served.
    const cli = 'http://127.0.0.1:4900';
    const opened = await server.open({ root: join(dir, 'Design'), type: 'design', shell: cli });
    assert.equal(new URL(opened.url).searchParams.get('open_artifact_shell'), cli);
    const res = await raw(opened.url, document);
    assert.equal(res.status, 200);
    assert.match(res.body, /<title>design<\/title>/);
    // …and an open without an address keeps the one the Shell gave.
    await server.open({ root: join(dir, 'Design'), type: 'design', shell });
    assert.equal((await raw(framed(design), document)).headers.location, viewer);
    // An address that is not on the Shell's origin, or not a plain http(s) URL, is not taken.
    for (const [origin, given] of [
      ['http://127.0.0.1:4901', 'http://evil.example/a/art_design00001'],
      ['http://127.0.0.1:4902', 'http://user@127.0.0.1:4902/a/art_design00001'],
      ['http://127.0.0.1:4903', 'javascript:alert(1)'],
      ['http://127.0.0.1:4904', '/a/art_design00001'],
    ] as const) {
      await server.open({ root: join(dir, 'Design'), type: 'design', shell: origin, viewer: given });
      assert.equal((await raw(framed(design, '', origin), document)).status, 200, given);
    }
    // The query and fragment of a given address are left out.
    await server.open({ root: join(dir, 'Design'), type: 'design', shell: 'http://localhost:4905', viewer: 'http://localhost:4905/a/art_design00001?x=1#y' });
    assert.equal((await raw(framed(design, '', 'http://localhost:4905'), document)).headers.location, 'http://localhost:4905/a/art_design00001');
  });

  it('keeps the public address, and sends the frame of its own Shell back to that Shell', async () => {
    const shellPage = await raw(design, document);
    assert.equal(shellPage.status, 200);
    assert.match(shellPage.body, /"typeServer":\{"role":"owner"/);
    // The own Shell frames `index.html?open_artifact_shell=<this origin>`; opened on its own, it goes to that Shell.
    const frame = await raw(framed(design, 'index.html', own), document);
    assert.equal(frame.status, 302);
    assert.equal(frame.headers.location, new URL(design).pathname);
    assert.equal(frame.headers['cache-control'], 'no-store');
    // In the frame it is the editor.
    assert.equal((await raw(framed(design, 'index.html', own), { 'sec-fetch-dest': 'iframe' })).status, 200);
    // A type without a Shell of its own here shows its page.
    assert.equal((await raw(framed(board, 'index.html', own), document)).status, 200);
  });

  it('sends no guest to the Shell of the owner', async () => {
    const view = (await (
      await fetch(new URL('/__open-artifact/share', board), {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: boardId, lan: true }),
      })
    ).json()) as { links: { viewer: { url: string } } };
    const link = new URL(new URL(view.links.viewer.url).pathname, board);
    const res = await fetch(link, { method: 'POST', redirect: 'manual', headers: { ...guest, 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Ann' });
    assert.equal(res.status, 303);
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    const visit = await raw(framed(board), { ...document, ...guest, cookie });
    assert.equal(visit.status, 200);
    assert.match(visit.body, /<title>whiteboard<\/title>/);
    // A guest's page: the secure-context shim first, and the editor's files at their shared address.
    assert.match(visit.body, /<head><script>if\(window\.crypto/);
    assert.match(visit.body, /src="\/_open-artifact\/editors\/whiteboard\/assets\/index-AbCd_123\.js"/);
    assert.equal(visit.headers['cache-control'], 'private, no-store');
    // Nobody's: a framed page says so to its Shell; anything else gets what it got before.
    const framedDenied = await raw(framed(board), { 'sec-fetch-dest': 'iframe', ...guest });
    assert.equal(framedDenied.status, 403);
    assert.match(framedDenied.body, /openArtifact: 'frame_denied', reason: "not_granted"/);
    assert.match(framedDenied.body, /not shared with you/);
    assert.equal(framedDenied.headers['content-security-policy'], "default-src 'none'; script-src 'unsafe-inline'");
    const api = await raw(new URL('_api/session', board), { 'sec-fetch-dest': 'iframe', ...guest });
    assert.equal(api.status, 403);
    assert.equal((JSON.parse(api.body) as { code: string }).code, 'not_granted');
    const page = await raw(framed(board), { ...document, ...guest, accept: 'text/html' });
    assert.equal(page.status, 403);
    assert.doesNotMatch(page.body, /frame_denied/);
  });

  it('sends a top-level visit to a page that is no longer open back to the daemon Shell on this computer', async () => {
    const stale = new URL('/design/' + '0'.repeat(32) + '/', design).href;
    const id = 'art_abcdefghij';
    for (const [from, to] of [
      ['http://127.0.0.1:4800', 'http://127.0.0.1:4800/a/art_abcdefghij'],
      ['http://localhost:65535', 'http://localhost:65535/a/art_abcdefghij'],
      ['http://[::1]:4800', 'http://[::1]:4800/a/art_abcdefghij'],
      ['http://localhost', 'http://localhost/a/art_abcdefghij'],
    ] as const) {
      for (const rel of ['', 'index.html']) {
        const res = await raw(framed(stale, rel, from, id), document);
        assert.equal(res.status, 302, from);
        assert.equal(res.headers.location, to);
        assert.equal(res.headers['cache-control'], 'no-store');
      }
    }
    // The values arrive URL-encoded, as the Shell sets them.
    assert.equal((await raw(`${stale}?open_artifact_shell=http%3A%2F%2F127.0.0.1%3A4800&open_artifact_id=${id}`, document)).status, 302);
  });

  it('refuses to send a stale page anywhere else', async () => {
    const stale = new URL('/design/' + '0'.repeat(32) + '/', design).href;
    const refused = (from: string, id = 'art_abcdefghij', headers: Record<string, string> = document, rel = '') => raw(framed(stale, rel, from, id), headers);
    for (const from of [
      'https://127.0.0.1:4800',
      'http://user@127.0.0.1:4800',
      'http://user:pw@localhost:4800',
      'http://127.0.0.1.evil.example:4800',
      'http://evil.example',
      'http://evil.example:4800',
      'http://127.0.0.2:4800',
      'http://192.168.1.5:4800',
      'http://sub.localhost:4800',
      'http://127.0.0.1:4800/a/x',
      'http://127.0.0.1:4800/',
      'http://127.0.0.1:99999',
      'http://127.0.0.1:080',
      'http://127.0.0.1:80',
      'http://127.0.0.1:0',
      'http://LOCALHOST:4800',
      'http%3A%2F%2F127.0.0.1%3A4800',
      '//127.0.0.1:4800',
      'http:\\\\127.0.0.1:4800',
      'http://127.0.0.1:4800\n',
      ' http://127.0.0.1:4800',
      'null',
      '',
    ]) {
      const res = await refused(from);
      assert.equal(res.status, 404, JSON.stringify(from));
      assert.equal(res.headers.location, undefined);
    }
    for (const id of ['art_ABCDEFGHIJ', 'art_short', 'art_abcdefghij/../x', '../art_abcdefghij', 'art_abcdefghij?x', '']) {
      assert.equal((await refused(shell, id)).status, 404, id);
    }
    // Not a top-level visit, not this computer, not the page.
    assert.equal((await refused(shell, undefined, {})).status, 404);
    assert.equal((await refused(shell, undefined, { 'sec-fetch-dest': 'empty' })).status, 404);
    assert.equal((await refused(shell, undefined, { ...document, ...guest })).status, 404);
    assert.equal((await refused(shell, undefined, document, '_api/session')).status, 404);
    assert.equal((await refused(shell, undefined, document, 'assets/index-AbCd_123.js')).status, 404);
    // Not a type.
    assert.equal((await raw(framed(new URL('/nope/' + '0'.repeat(32) + '/', design).href), document)).status, 404);
  });

  it('tells the Shell when its frame is no longer open, and answers calls with JSON as before', async () => {
    const stale = new URL('/design/' + '0'.repeat(32) + '/', design).href;
    for (const dest of ['iframe', 'frame']) {
      for (const rel of ['', 'index.html']) {
        const res = await raw(framed(stale, rel), { 'sec-fetch-dest': dest });
        assert.equal(res.status, 404);
        assert.match(String(res.headers['content-type']), /^text\/html/);
        assert.equal(res.headers['cache-control'], 'no-store');
        assert.equal(res.headers['content-security-policy'], "default-src 'none'; script-src 'unsafe-inline'");
        assert.match(res.body, /This artifact is not open here\. Open it again\./);
        assert.match(res.body, /<script>parent\.postMessage\(\{ openArtifact: 'frame_denied', reason: "not_open" \}, '\*'\);<\/script>/);
      }
    }
    for (const headers of [{}, { 'sec-fetch-dest': 'empty' }, { 'sec-fetch-dest': 'script' }] as Record<string, string>[]) {
      const res = await raw(framed(stale), headers);
      assert.equal(res.status, 404);
      assert.deepEqual(JSON.parse(res.body), { code: 'not_found', message: 'This artifact is not open here. Open it again.' });
    }
    // A file of a stale page in a frame (an artboard) is not the page.
    const file = await raw(new URL('project/A.dc.html', stale), { 'sec-fetch-dest': 'iframe' });
    assert.equal(file.status, 404);
    assert.equal((JSON.parse(file.body) as { code: string }).code, 'not_found');
  });

  it('serves the editors’ built files at one address for every artifact, kept for good', async () => {
    const at = new URL('/_open-artifact/editors/design/assets/index-AbCd_123.js', design);
    const res = await raw(at);
    assert.equal(res.status, 200);
    assert.equal(res.body, '/* design */');
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.match(String(res.headers['content-type']), /^text\/javascript/);
    assert.equal((await raw(at, {}, 'HEAD')).status, 200);
    assert.equal((await raw(at, {}, 'POST')).status, 405);
    // A name without its hash may change under it.
    const unhashed = await raw(new URL('/_open-artifact/editors/design/assets/chart-frame.txt', design));
    assert.equal(unhashed.status, 200);
    assert.equal(unhashed.headers['cache-control'], 'no-store');
    // Only an editor's assets folder, of a type this server hosts, at a local Host.
    for (const path of [
      '/_open-artifact/editors/design/assets/..%2Findex.html',
      '/_open-artifact/editors/design/assets/..%2F..%2F..%2Fsupport.js',
      '/_open-artifact/editors/design/assets/%2E%2E/index.html',
      '/_open-artifact/editors/design/assets/',
      '/_open-artifact/editors/design/index.html',
      '/_open-artifact/editors/nope/assets/index-AbCd_123.js',
      '/_open-artifact/editors/..%2Fshell/assets/index-QwEr7890.js',
    ]) {
      assert.equal((await raw(new URL(path, design))).status, 404, path);
    }
    assert.equal((await raw(at, { host: 'evil.example' })).status, 403);
    // The address of a page loaded earlier still works.
    const old = await raw(new URL('assets/index-AbCd_123.js', design));
    assert.equal(old.status, 200);
    assert.equal(old.headers['cache-control'], 'public, max-age=31536000, immutable');
    // The Shell's built files too.
    const shellFile = await raw(new URL('/_open-artifact/shell/assets/index-QwEr7890.js', design));
    assert.equal(shellFile.status, 200);
    assert.equal(shellFile.headers['cache-control'], 'public, max-age=31536000, immutable');
    // What is not content-hashed is not kept.
    assert.equal((await raw(new URL('support.js', design))).headers['cache-control'], 'no-store');
  });

  it('links the editor page to those files', async () => {
    const res = await raw(new URL('index.html', design));
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['content-security-policy'], "object-src 'none'");
    assert.match(res.body, /<script type="module" crossorigin src="\/_open-artifact\/editors\/design\/assets\/index-AbCd_123\.js"><\/script>/);
    assert.match(res.body, /<link rel="stylesheet" crossorigin href="\/_open-artifact\/editors\/design\/assets\/index-XyZw-567\.css">/);
    assert.doesNotMatch(res.body, /\.\/assets\//);
    const boardPage = await raw(new URL('index.html', board));
    assert.match(boardPage.body, /src="\/_open-artifact\/editors\/whiteboard\/assets\/index-AbCd_123\.js"/);
  });
});

describe('actionsOfType', () => {
  it('lists the server\'s actions for every type, and a Sheet\'s or a doc\'s own after them', async () => {
    const { actionsOfType, SERVER_ACTIONS } = await import('../src/index.ts');
    const server = SERVER_ACTIONS.map((a) => a.name);
    assert.deepEqual(actionsOfType('whiteboard').map((a) => a.name), server);
    assert.deepEqual(actionsOfType('design').map((a) => a.name), server);
    assert.deepEqual(actionsOfType('sheets').map((a) => a.name), [...server, 'read', 'update', 'batch', 'widget', 'info', 'export']);
    // A doc's list starts with duplicate: nothing depends on where one list ends any more.
    assert.deepEqual(actionsOfType('docs').map((a) => a.name), [...server, 'duplicate', 'create', 'read', 'update', 'delete', 'batch', 'export', 'import']);
    for (const action of actionsOfType('sheets')) {
      assert.ok(action.effect === 'read' || action.effect === 'write', action.name);
      assert.equal(typeof action.schema, 'object', action.name);
    }
  });
});
