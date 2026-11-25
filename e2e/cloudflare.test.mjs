// End-to-end test of the Cloudflare host's rooms (`packages/host-cloudflare`) under `wrangler dev`: the test Worker
// (`src/dev-worker.ts`, built by `deploy/cloudflare/build.mjs`, run with `wrangler.rooms.jsonc`; the product Worker's
// test is `cloudflare-host.test.mjs`) runs every artifact as a Durable Object whose SQLite is
// the artifact's folder, with the unmodified type server on top. Its permissive test host lets any token in, so this
// checks the platform layer, not who may do what.
//
// One artifact of each type it runs is seeded from the samples (whiteboard, docs, sheets, slides, design, design
// system, data; Motion is left out: its renderer and checks need `node:vm` and child processes, decision 26), and
// each one's page draws in real Chrome inside a frame on `localhost` from its own `<id>.localhost` origin. Then:
// `_api/session`; a write survives a full restart of `wrangler dev` (same `--persist-to`); an event stream and a
// WebSocket each get the write; an event stream whose page left is noticed in about a second; the export archive
// unpacks into a second object with the same files; and the common reads take no chunk rows (no scan of the chunk
// table).
//
// Skipped (with the reason) when deploy/cloudflare has no node_modules (`cd deploy/cloudflare && npm install`), with
// E2E_BROWSER=0, without Chrome, or before `npm run build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { buildWorkers } from './lib/cloudflare.mjs';
import { until } from './lib/http.mjs';
import { browserOff, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 240000 };
const DEPLOY = path.join(repoRoot, 'deploy', 'cloudflare');
const WRANGLER = path.join(DEPLOY, 'node_modules', '.bin', 'wrangler');

/** The artifacts seeded, one per type: id → [type, sample folder, text the drawn page shows]. */
const SAMPLES = {
  'cf-whiteboard': ['whiteboard', 'test-artifacts/whiteboard/elements'],
  'cf-docs': ['docs', 'test-artifacts/docs/browser-qa'],
  'cf-sheets': ['sheets', 'test-artifacts/sheets/sales'],
  'cf-slides': ['slides', 'test-artifacts/slides/browser-smoke'],
  'cf-design': ['design', 'e2e/fixtures/design'],
  'cf-design-system': ['design-system', 'e2e/fixtures/design-system'],
  'cf-data': ['data', 'test-artifacts/data/sales-and-signups'],
};

function skip() {
  if (!fs.existsSync(WRANGLER)) return 'deploy/cloudflare has no node_modules (cd deploy/cloudflare && npm install)';
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/server/editors/whiteboard/index.html', 'dist/server/shell/index.html', 'dist/server/support.js'];
  const missing = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return missing.length ? `the editors are not built (npm run build): no ${missing.join(', ')}` : false;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A sample folder as {path: base64} (what an export carries: no `.gitignore`). */
function folderJson(dir) {
  const out = {};
  const walk = at => {
    for (const name of fs.readdirSync(at)) {
      const file = path.join(at, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else if (name !== '.gitignore') out[path.relative(dir, file)] = fs.readFileSync(file).toString('base64');
    }
  };
  walk(dir);
  return out;
}

describe('cloudflare: rooms under wrangler dev', { skip: skip() }, () => {
  let port;
  let state;
  let wrangler = null;
  let log = '';
  let browser = null;
  const app = () => `http://localhost:${port}`;
  const content = id => `http://${id}.localhost:${port}`;
  const dev = (id, call, init) => fetch(`${app()}/_dev/${id}/${call}`, init);
  const json = async (id, call, init) => {
    const res = await dev(id, call, init);
    const body = await res.json();
    assert.ok(res.ok, `${call}: ${res.status} ${JSON.stringify(body)}`);
    return body;
  };
  const stats = id => json(id, 'stats');

  async function start() {
    log = '';
    wrangler = spawn(WRANGLER, ['dev', '--config', 'wrangler.rooms.jsonc', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state, '--log-level', 'log', '--show-interactive-dev-session=false'], {
      cwd: DEPLOY,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    });
    wrangler.stdout.on('data', d => (log += d));
    wrangler.stderr.on('data', d => (log += d));
    const up = await until(async () => {
      try {
        return (await fetch(`${app()}/`)).status === 404;
      } catch {
        return false;
      }
    }, 60000, 250);
    assert.ok(up, `wrangler dev did not start:\n${log.slice(-2000)}`);
  }

  async function stop() {
    if (!wrangler) return;
    const child = wrangler;
    wrangler = null;
    const exited = new Promise(r => child.once('exit', r));
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
    await Promise.race([exited, sleep(5000)]);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }

  before(async () => {
    buildWorkers();
    state = tmpDir('cloudflare');
    port = await freePort();
    await start();
    for (const [id, [, dir]] of Object.entries(SAMPLES)) {
      await json(id, 'seed', { method: 'POST', body: JSON.stringify(folderJson(path.join(repoRoot, dir))) });
    }
  }, T);

  after(async () => {
    await browser?.close().catch(() => {});
    await stop();
  });

  it('answers each artifact\'s session on its own origin', T, async () => {
    for (const [id, [type]] of Object.entries(SAMPLES)) {
      const res = await fetch(`${content(id)}/${type}/owner/_api/session`);
      assert.equal(res.status, 200, `${id}: ${await res.clone().text()}`);
      const session = await res.json();
      assert.equal(session.artifact.id, id);
      assert.equal(session.artifact.type, type);
      assert.equal(session.viewer.role, 'owner');
    }
    // Another type's address for the artifact is refused.
    assert.notEqual((await fetch(`${content('cf-docs')}/slides/owner/_api/session`)).status, 200);
  });

  it('draws every page in Chrome', T, async () => {
    browser = await launch();
    const drawn = `location.hostname.endsWith('.localhost') && document.body && document.body.innerText.trim().length > 0 && document.querySelectorAll('body *').length > 20`;
    for (const [id, [type]] of Object.entries(SAMPLES)) {
      // A dashboard's connectors are refused on a hosted server (400 `unsupported`), as on the Node host.
      const ignore = [/\/favicon\.ico$/, ...(type === 'data' ? [/HTTP 400: .*\/_api\/mcp\/call$/] : [])];
      const page = await browser.load(`${app()}/_dev/shell/${id}/${type}/owner`, { ready: drawn, timeout: 45000, settle: 1500, ignore });
      const crashed = await page.crashed();
      assert.ok(!crashed, `${id} crashed: ${crashed}`);
      assert.deepEqual(page.problems, [], `${id}: ${page.problems.join('\n')}`);
      await page.close();
    }
  });

  it('delivers a write to an event stream and a WebSocket, and notices a page that left', T, async () => {
    const id = 'cf-slides';
    const controller = new AbortController();
    const sse = await fetch(`${content(id)}/slides/owner/_api/events`, { headers: { accept: 'text/event-stream' }, signal: controller.signal });
    assert.equal(sse.status, 200);
    const socket = new WebSocket(`ws://${id}.localhost:${port}/slides/ed/_api/events`);
    const messages = [];
    socket.addEventListener('message', e => messages.push(String(e.data)));
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('the WebSocket did not open')), { once: true });
    });
    assert.ok(await until(async () => (await stats(id)).connections === 2, 5000), 'two connections');
    const connected = await json(id, 'connected');
    assert.deepEqual(new Set(connected.map(p => p.id)), new Set(['dev-owner', 'ed']));

    await json(id, 'files', { method: 'POST', body: JSON.stringify({ writes: [{ path: 'project/note.txt', content: Buffer.from('from the test').toString('base64') }] }) });
    const reader = sse.body.getReader();
    let text = '';
    const seen = await until(async () => {
      const next = await Promise.race([reader.read(), sleep(500).then(() => null)]);
      if (next && !next.done) text += Buffer.from(next.value).toString('utf8');
      return /event: files/.test(text);
    }, 8000, 0);
    assert.ok(seen, `the event stream got no files event: ${text}`);
    assert.ok(await until(() => messages.some(m => m.includes('"event":"files"')), 8000), `the WebSocket got no files event: ${messages.join('\n')}`);

    // The event stream's page leaves: noticed within a moment (the bridge writes an idle stream every second).
    controller.abort();
    const left = Date.now();
    assert.ok(await until(async () => (await stats(id)).connections === 1, 5000, 50), 'the event stream that left is still counted');
    const took = Date.now() - left;
    console.log(`# cloudflare: a page that left was noticed after ${took} ms`);
    assert.ok(took < 3000, `noticed only after ${took} ms`);
    socket.close();
    assert.ok(await until(async () => (await stats(id)).connections === 0, 5000, 50), 'the WebSocket that closed is still counted');
  });

  it('reads without touching the chunk table', T, async () => {
    const id = 'cf-design';
    // Boot the room and fill the caches first.
    await fetch(`${content(id)}/design/owner/_api/session`);
    const before = (await stats(id)).storage;
    await fetch(`${content(id)}/design/owner/_api/session`);
    await fetch(`${content(id)}/design/owner/_api/files`);
    await json(id, 'manifest');
    const now = (await stats(id)).storage;
    const delta = { statements: now.statements - before.statements, rowsRead: now.rowsRead - before.rowsRead, rowsWritten: now.rowsWritten - before.rowsWritten, chunkRowsRead: now.chunkRowsRead - before.chunkRowsRead };
    console.log(`# cloudflare: session + files + manifest of a small artifact: ${JSON.stringify(delta)}`);
    assert.equal(delta.chunkRowsRead, 0);
    assert.ok(delta.rowsRead < 500, `read ${delta.rowsRead} rows`);
  });

  it('unpacks its export archive into a second object', T, async () => {
    const zip = new Uint8Array(await (await dev('cf-slides', 'archive')).arrayBuffer());
    assert.equal(Buffer.from(zip.subarray(0, 2)).toString('latin1'), 'PK');
    const imported = await json('cf-slides-copy', 'import', { method: 'POST', body: zip });
    assert.equal(imported.type, 'slides');
    const a = await json('cf-slides', 'manifest');
    const b = await json('cf-slides-copy', 'manifest');
    delete b['.artifact.json'];
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort());
    for (const [file, { etag }] of Object.entries(a)) assert.equal(b[file].etag, etag, file);
    assert.equal((await fetch(`${content('cf-slides-copy')}/slides/owner/_api/session`)).status, 200);
  });

  it('keeps a write across a restart of wrangler dev', T, async () => {
    const id = 'cf-whiteboard';
    const bytes = Buffer.from(`kept ${Date.now()}`);
    await json(id, 'files', { method: 'POST', body: JSON.stringify({ writes: [{ path: 'project/kept.txt', content: bytes.toString('base64') }] }) });
    await stop();
    await start();
    const res = await dev(id, `file?path=${encodeURIComponent('project/kept.txt')}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
    const session = await fetch(`${content(id)}/whiteboard/owner/_api/session`);
    assert.equal(session.status, 200);
  });
});
