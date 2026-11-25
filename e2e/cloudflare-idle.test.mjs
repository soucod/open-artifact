// End-to-end test that an artifact's Durable Object goes quiet (decision 30), on the product Worker under
// `wrangler dev` with `OA_DEBUG_STATS=1`: the room's SQLite counters and the isolate's live timers are read from
// `/__open-artifact/stats?id=`.
//
// (a) With one page connected (an event stream, then a WebSocket) and nothing happening for 60 s, the only live timers
//     are the connections' keep-alives, and the room reads and writes no rows. (Before the type server's events mode,
//     the DbHost rescanned every document every 10 s and the agent status was polled every 3 s.)
// (b) After the last page leaves and `OA_ROOM_IDLE_CLOSE_MS` passes, the room reports nothing open and the isolate no
//     live timer at all: the state in which Cloudflare may evict the object.
// (c) A request after that opens the artifact again, with every write made before.
//
// It also measures whether a departed event-stream client is noticed by the request's abort signal alone
// (`OA_SSE_HEARTBEAT_MS=0`), and prints what it finds.
//
// Skipped (with the reason) when deploy/cloudflare has no node_modules, or before `npm run build`. No browser needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { buildWorkers, d1, freePort, sqlValue, startWrangler, tokenHash, wranglerMissing, zipFolder } from './lib/cloudflare.mjs';
import { until } from './lib/http.mjs';
import { removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 300000 };
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'whiteboard', 'elements');
const OWNER_KEY = `owner-${randomBytes(12).toString('hex')}`;
const SIGNING_KEY = randomBytes(32).toString('hex');
/** How long the room waits after its last page before it closes the artifact, ms (the test's setting). */
const IDLE_CLOSE_MS = 3000;
/** How long a page stays connected with nothing happening, ms. */
const QUIET_MS = 60_000;
/** The type server's own keep-alive of an event stream (`server.ts`), ms. */
const SSE_KEEPALIVE_MS = 25_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function skip() {
  const missing = wranglerMissing();
  if (missing) return missing;
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/server/editors/whiteboard/index.html', 'dist/server/support.js'];
  const absent = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return absent.length ? `the host's pages are not built (npm run build): no ${absent.join(', ')}` : false;
}

/** The SQL a room did between two stats: statements, rows read and written. */
const delta = (a, b) => ({
  statements: b.statements - a.statements,
  rowsRead: b.rowsRead - a.rowsRead,
  rowsWritten: b.rowsWritten - a.rowsWritten,
});
const describeTimers = timers => timers.map(t => `${t.kind} ${t.ms} ms (${Math.round(t.ageMs / 1000)} s old) at ${t.site}`).join('\n') || 'none';

/** Starts `wrangler dev` with these extra variables, makes a user with a session and imports a whiteboard. */
async function site(label, vars = {}) {
  const port = await freePort();
  const s = { port, app: `http://localhost:${port}`, state: tmpDir(label) };
  s.server = await startWrangler({
    port,
    state: s.state,
    vars: {
      OA_APP_ORIGIN: s.app,
      OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`,
      OA_SIGNING_KEYS: SIGNING_KEY,
      OA_OWNER_KEY: OWNER_KEY,
      OA_DEBUG_STATS: '1',
      OA_ROOM_IDLE_CLOSE_MS: String(IDLE_CLOSE_MS),
      ...vars,
    },
    ready: async origin => (await fetch(`${origin}/__open-artifact/health`)).status === 200,
  });
  const user = { id: `usr_e2e${randomBytes(6).toString('hex')}`, token: randomBytes(32).toString('base64url') };
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 86400_000).toISOString();
  d1(s.state, `INSERT INTO users (id, name, email, email_verified, site_role, created_at) VALUES (${[user.id, 'Ida Idle', 'ida@example.com', 1, 'member', now].map(sqlValue).join(', ')}); INSERT INTO sessions (id_hash, user_id, created_at, seen_at, expires_at) VALUES (${[tokenHash(user.token), user.id, now, now, later].map(sqlValue).join(', ')});`);
  s.as = (route, init = {}) => fetch(`${s.app}${route}`, { ...init, headers: { cookie: `oa_session=${user.token}`, ...(init.headers ?? {}) } });
  const imported = await s.as('/api/open-artifact.artifacts.import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: await zipFolder(SAMPLE) });
  assert.equal(imported.status, 201, await imported.clone().text());
  s.id = (await imported.json()).id;
  const boot = await (await s.as(`/api/open-artifact.artifacts.boot?id=${s.id}`)).json();
  s.page = boot.pageUrl;
  assert.match(s.page, /^http:\/\/.*\.content\.localhost:\d+\/whiteboard\/[^/]+\/$/);
  s.origin = new URL(s.page).origin;
  s.stats = async () => {
    const res = await fetch(`${s.app}/__open-artifact/stats?id=${s.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.room && !body.room.error, JSON.stringify(body.room));
    return body.room;
  };
  /** A write through the page's API (as the whiteboard writes a note). */
  s.write = async (client, name) => {
    const res = await fetch(`${s.page}_api/db/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: s.origin },
      body: JSON.stringify({ client, writes: [{ op: 'set', path: `elements/${name}`, data: { type: 'note', x: 0, y: 0, text: name } }] }),
    });
    assert.equal(res.status, 200, await res.clone().text());
  };
  s.stop = () => s.server.stop();
  return s;
}

/** Opens the page's event stream; answers `{ close() }`. */
async function eventStream(s, client) {
  const controller = new AbortController();
  const res = await fetch(`${s.page}_api/events?client=${client}`, { headers: { accept: 'text/event-stream', origin: s.origin }, signal: controller.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  // Keep reading so the stream never stalls on backpressure.
  void (async () => {
    try {
      for (;;) if ((await reader.read()).done) break;
    } catch {}
  })();
  return { close: () => controller.abort() };
}

/** Opens the page's WebSocket; answers `{ messages, close() }`. */
async function socket(s, client) {
  const ws = new WebSocket(`${s.page.replace(/^http/, 'ws')}_api/events?client=${client}`);
  const messages = [];
  ws.addEventListener('message', e => messages.push(String(e.data)));
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('the WebSocket did not open')), { once: true });
  });
  return { messages, close: () => ws.close() };
}

describe('cloudflare: an artifact\'s object goes quiet', { skip: skip() }, () => {
  let s = null;
  before(async () => {
    buildWorkers();
    s = await site('cloudflare-idle');
  }, T);
  after(async () => {
    await s?.stop();
    removeTmp();
  });

  it('(a) reads and writes nothing, and runs only keep-alives, while one page sits idle for 60 s', T, async () => {
    // An event stream (what a page falls back to) and a WebSocket (what pages use): one at a time.
    for (const kind of ['event stream', 'WebSocket']) {
      const page = kind === 'event stream' ? await eventStream(s, 'quiet-sse') : await socket(s, 'quiet-ws');
      assert.ok(await until(async () => (await s.stats()).connections === 1, 10000, 200), `${kind}: not connected`);
      await sleep(3000); // let the first status, peers and scans settle
      const first = await s.stats();
      await sleep(QUIET_MS);
      const last = await s.stats();
      const sql = delta(first.storage, last.storage);
      const timers = last.isolate.timers;
      console.log(`# cloudflare-idle: ${kind}, ${QUIET_MS / 1000} s idle: SQL ${JSON.stringify(sql)}; live timers:\n${describeTimers(timers).replace(/^/gm, '#   ')}`);
      assert.deepEqual(sql, { statements: 0, rowsRead: 0, rowsWritten: 0 }, `${kind}: the room used SQL while idle (before: ${JSON.stringify({ storage: first.storage, open: first.open, connections: first.connections })}; after: ${JSON.stringify({ storage: last.storage, open: last.open, connections: last.connections })})`);
      // Only the connection's keep-alives: for an event stream, the bridge's heartbeat and the type server's own; for a
      // WebSocket, none (the platform keeps it alive).
      const allowed = kind === 'event stream' ? new Set([1000, SSE_KEEPALIVE_MS]) : new Set();
      const others = timers.filter(t => !(t.kind === 'interval' && allowed.has(t.ms)));
      assert.deepEqual(others, [], `${kind}: timers that are not keep-alives:\n${describeTimers(others)}`);
      assert.equal(last.open, 1, `${kind}: the artifact should be open while a page is`);
      page.close();
      assert.ok(await until(async () => (await s.stats()).connections === 0, 10000, 200), `${kind}: the page that left is still counted`);
    }
  });

  it('(b) closes the artifact after the last page leaves and stops every timer, (c) opens it again with nothing lost', T, async () => {
    const page = await socket(s, 'close-ws');
    assert.ok(await until(async () => (await s.stats()).connections === 1, 10000, 200));
    // A write right before the page leaves.
    await s.write('close-ws', 'kept-note');
    page.close();
    const left = Date.now();
    const closed = await until(async () => {
      const stats = await s.stats();
      return stats.connections === 0 && stats.open === 0 && stats.isolate.timers.length === 0;
    }, IDLE_CLOSE_MS + 15000, 250);
    const stats = await s.stats();
    console.log(`# cloudflare-idle: after the last page left: closed=${closed} after ~${Date.now() - left} ms; open=${stats.open}; connections=${stats.connections}; timers:\n${describeTimers(stats.isolate.timers).replace(/^/gm, '#   ')}`);
    assert.ok(closed, `the room did not go quiet: open=${stats.open}, timers:\n${describeTimers(stats.isolate.timers)}`);
    // Quiet for a while: still nothing, and no SQL.
    await sleep(5000);
    const later = await s.stats();
    assert.deepEqual(delta(stats.storage, later.storage), { statements: 0, rowsRead: 0, rowsWritten: 0 });
    assert.deepEqual(later.isolate.timers, []);

    // (c) A page's request opens it again, with the write.
    const list = await fetch(`${s.page}_api/db/list?collection=elements`, { headers: { origin: s.origin } });
    assert.equal(list.status, 200, await list.clone().text());
    const docs = (await list.json()).documents;
    assert.ok(docs.some(d => (d.path ?? d.id ?? '').endsWith('kept-note') || JSON.stringify(d).includes('kept-note')), `the write was lost: ${JSON.stringify(docs).slice(0, 400)}`);
    assert.equal((await s.stats()).open, 1);
    // ... and closes again once idle.
    assert.ok(await until(async () => (await s.stats()).open === 0, IDLE_CLOSE_MS + 15000, 250), 'it did not close again');
  });
});

describe('cloudflare: a departed event-stream client and the abort signal', { skip: skip() }, () => {
  let s = null;
  before(async () => {
    s = await site('cloudflare-idle-signal', { OA_SSE_HEARTBEAT_MS: '0' });
  }, T);
  after(async () => {
    await s?.stop();
  });

  it('measures whether the request signal alone ends the stream under wrangler dev (no bridge heartbeat)', T, async () => {
    const page = await eventStream(s, 'signal-sse');
    assert.ok(await until(async () => (await s.stats()).connections === 1, 10000, 200));
    const timers = (await s.stats()).isolate.timers;
    assert.ok(!timers.some(t => t.kind === 'interval' && t.ms === 1000), `the bridge heartbeat runs although OA_SSE_HEARTBEAT_MS=0:\n${describeTimers(timers)}`);
    page.close();
    const left = Date.now();
    const noticed = await until(async () => (await s.stats()).connections === 0, SSE_KEEPALIVE_MS + 10000, 200);
    const took = Date.now() - left;
    console.log(`# cloudflare-idle: with no bridge heartbeat, a departed event-stream client was ${noticed ? `noticed after ${took} ms` : `NOT noticed within ${took} ms`}`);
    // Either the signal ends it at once, or the type server's own keep-alive write does within its 25 s.
    assert.ok(noticed, 'a departed client was never noticed');
  });
});
