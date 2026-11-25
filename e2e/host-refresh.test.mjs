// End-to-end test of opening and reloading a whiteboard on the cloud host (`packages/host`) in Chrome, with the host's
// page API made slow: the real host on a free port behind a small proxy that holds `_api/db` and `_api/session`
// requests for a while, its app on `localhost` and the artifact on its own `*.content.localhost` origin. A cloud page's
// address carries a page token that is new on every load (`/whiteboard/v1.<token>/`).
//
// While the board loads, the Shell's cover stays over the page: it is never lifted on an empty board at the default
// camera. The camera the owner left survives a reload. The board's memory in the browser is filed by artifact, not by
// page token: reloads keep one camera and one saved copy, and copies earlier pages left under their tokens are dropped.
// Moving an element never shows "Couldn't save" while the edit waits out the write debounce. A page whose board never
// loads is still shown after the Shell's cap (`CHROME_READY_TIMEOUT_MS`).
//
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { FRAMED_PAGE, byText, clickOn } from './lib/host-page.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 120000 };
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'whiteboard', 'elements');
/** How long the proxy holds the page API while the board opens. */
const SLOW_MS = 800;
/** The Shell's cap on `ready: false` (`CHROME_READY_TIMEOUT_MS` in @open-artifact/protocol). */
const READY_CAP_MS = 10_000;

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/server/editors/whiteboard/index.html', 'dist/server/support.js'];
  const missing = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return missing.length ? `the host's pages are not built (npm run build): no ${missing.join(', ')}` : false;
}

/** A TCP port nobody listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * A proxy on `port` to the host on `hostPort` that holds requests matching `slow.pattern` for `slow.ms`, or for what
 * `slow.delay(url)` says when it is set (all can change between steps). WebSocket upgrades pass straight through.
 */
function startSlowProxy(port, hostPort, slow) {
  const server = http.createServer((req, res) => {
    const forward = () => {
      const upstream = http.request({ host: '127.0.0.1', port: hostPort, method: req.method, path: req.url, headers: req.headers }, answer => {
        res.writeHead(answer.statusCode, answer.headers);
        answer.pipe(res);
      });
      upstream.on('error', () => res.destroy());
      req.pipe(upstream);
    };
    const ms = slow.delay ? slow.delay(req.url) : slow.ms && slow.pattern.test(req.url) ? slow.ms : 0;
    if (ms) setTimeout(forward, ms);
    else forward();
  });
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(hostPort, '127.0.0.1', () => {
      const headers = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
      upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** The Shell's side: its cover over the page, its save state, and where its header buttons are. */
const SHELL_STATE = `(() => {
  const cover = document.querySelector('[data-shell-loading]');
  const x = label => { const b = document.querySelector('header [aria-label="' + label + '"]'); return b ? Math.round(b.getBoundingClientRect().x) : null; };
  return { cover: !!cover, save: [...document.querySelectorAll('header [data-shell-save-state]')].map(e => e.dataset.shellSaveState).join(','), share: x('Share') };
})()`;

/** The board's side, in the framed page: its elements, its zoom, its veil, and its keys in storage. */
const BOARD_STATE = `${FRAMED_PAGE} ? (() => {
  const layer = document.querySelector('.wb-layer');
  const keys = s => Object.keys(s).filter(k => k.startsWith('wb-'));
  return {
    page: performance.timeOrigin,
    elements: document.querySelectorAll('.wb-elements [data-wb-id]').length,
    zoom: layer ? +new DOMMatrixReadOnly(getComputedStyle(layer).transform).a.toFixed(4) : null,
    veil: !!document.querySelector('[data-wb-veil]'),
    local: keys(localStorage), session: keys(sessionStorage),
  };
})() : undefined`;

/** Both sides at once (the board's is `null` before its page answers). */
async function snapshot(page) {
  const shell = await page.evaluate(SHELL_STATE).catch(() => null);
  const board = (await page.evaluateAll(BOARD_STATE).catch(() => [])).find(v => v !== undefined) ?? null;
  return { at: Date.now(), shell, board };
}

/** Samples both sides every few milliseconds for `ms` after `action`. */
async function watch(page, ms, action) {
  const rows = [];
  const start = Date.now();
  await action?.();
  while (Date.now() - start < ms) {
    const row = await snapshot(page);
    rows.push({ ...row, t: row.at - start });
    await sleep(10);
  }
  return rows;
}

/** Where the largest element in view is, under nothing else, in the Shell's page. */
async function elementToMove(page) {
  const at = (await page.evaluateAll(`${FRAMED_PAGE} ? (() => {
    const all = [...document.querySelectorAll('.wb-elements [data-wb-id]')].map(e => [e, e.getBoundingClientRect()])
      .filter(([e, r]) => r.width > 8 && r.height > 8 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
        && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)));
    all.sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height);
    const r = all[0]?.[1];
    return r ? [r.x + r.width / 2, r.y + r.height / 2] : null;
  })() : undefined`)).find(v => v !== undefined);
  assert.ok(at, 'no element to move');
  const frame = await page.evaluate("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.x, r.y]; })()");
  return [frame[0] + at[0], frame[1] + at[1]];
}

/** Drags with the real mouse from (`x`, `y`) 50 px to the right. */
async function dragRight(page, x, y) {
  await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 5; i++) {
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i * 10, y, button: 'left', buttons: 1 });
    await sleep(20);
  }
  await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 50, y, button: 'left', clickCount: 1 });
}

/** The rows as a timeline of what changed: `<ms> cover|shown <page> <elements> veil`. */
function timeline(rows, before) {
  const out = [];
  for (const r of rows) {
    const what = `${r.shell?.cover ? 'cover' : 'shown'} ${!r.board ? 'no page' : r.board.page === before ? 'old page' : 'new page'} ${r.board?.elements ?? '-'}${r.board?.veil ? ' veil' : ''} ${r.shell?.save ?? ''}`;
    if (out.at(-1)?.what !== what) out.push({ t: r.t, what });
  }
  return out.map(o => `${o.t}ms ${o.what}`).join('\n');
}

/** The rows sampled once the Shell's cover was gone (from the new page on: the old one had none). */
function uncovered(rows) {
  const first = rows.findIndex(r => r.shell?.cover);
  return first < 0 ? [] : rows.slice(first).filter(r => !r.shell.cover);
}

describe('a whiteboard reloads on a slow cloud host', { skip: skip() }, () => {
  const ctx = { slow: { ms: 0, pattern: /\/_api\/(db|session)/ } };

  before(async () => {
    const data = path.join(tmpDir('host-refresh'), 'data');
    const [port, hostPort] = [await freePort(), await freePort()];
    ctx.app = `http://localhost:${port}`;
    const env = {
      ...process.env,
      OA_DATA_DIR: data,
      OA_PORT: String(hostPort),
      OA_BIND: '127.0.0.1',
      OA_APP_ORIGIN: ctx.app,
      OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`,
    };
    delete env.OA_OWNER_KEY;
    delete env.OA_SIGNING_KEYS;
    const imported = spawnSync(process.execPath, [MAIN, 'import', SAMPLE], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(imported.status, 0, `import failed: ${imported.stderr}`);
    ctx.id = /as (art_[0-9a-z]+)/.exec(imported.stdout)?.[1];
    assert.ok(ctx.id, imported.stdout);
    ctx.proxy = await startSlowProxy(port, hostPort, ctx.slow);
    ctx.log = '';
    ctx.host = spawn(process.execPath, [MAIN, 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.host.stdout.on('data', chunk => (ctx.log += chunk));
    ctx.host.stderr.on('data', chunk => (ctx.log += chunk));
    ctx.stopHost = () => ctx.host.exitCode === null && ctx.host.kill('SIGKILL');
    process.on('exit', ctx.stopHost);
    const signIn = () => /(http:\/\/\S+\/auth\/sign-in#key=\S+)/.exec(ctx.log)?.[1];
    await until(signIn, 30000);
    assert.ok(signIn(), `the host printed no sign-in address:\n${ctx.log}`);
    ctx.browser = await launch({ width: 1280, height: 800 });
    ctx.page = await ctx.browser.load(signIn(), { ready: "document.getElementById('key')?.value.length > 0", ignore: [/./] });
    await ctx.page.evaluate("document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]').click()");
    assert.ok(await ctx.page.waitFor(`location.href === '${ctx.app}/'`, 20000), 'the owner was not signed in');
  });

  after(async () => {
    await ctx.browser?.close();
    ctx.proxy?.close();
    if (ctx.host) {
      const exited = new Promise(resolve => (ctx.host.exitCode !== null ? resolve() : ctx.host.once('exit', resolve)));
      ctx.host.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      ctx.stopHost();
      process.off('exit', ctx.stopHost);
    }
    removeTmp();
  });

  it('keeps the cover over the page until the board shows, on first open and on reload', T, async () => {
    const { page } = ctx;
    ctx.slow.ms = SLOW_MS;
    for (const [what, go] of [
      ['first open', () => page.evaluate(`location.href = '/a/${ctx.id}'`)],
      ['reload', () => page.cdp('Page.reload', {})],
    ]) {
      const rows = await watch(page, 6000, go);
      const shown = uncovered(rows);
      assert.ok(shown.length, `${what}: the cover never went`);
      const empty = shown.filter(r => !r.board || r.board.veil || r.board.elements === 0);
      assert.deepEqual(empty.map(r => r.t), [], `${what}: the cover went before the board showed`);
      // The header's buttons do not move once the page shows.
      const shares = new Set(shown.map(r => r.shell.share));
      assert.equal(shares.size, 1, `${what}: the Share button moved: ${[...shares]}`);
    }
  });

  it('keeps the camera the owner left across reloads, filed under one key however the page token changes', T, async () => {
    const { page } = ctx;
    ctx.slow.ms = 0;
    // Zoom out with ⌘/ctrl + wheel over the board.
    const center = await page.evaluate("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()");
    for (let i = 0; i < 3; i++) {
      await page.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: center[0], y: center[1], deltaX: 0, deltaY: 200, modifiers: 2 });
      await sleep(100);
    }
    await sleep(600);
    const left = (await snapshot(page)).board;
    assert.ok(left?.zoom && left.zoom < 0.9, `the board did not zoom out: ${JSON.stringify(left)}`);
    // An older page's whole-board copy and camera, filed under its own page token.
    await page.evaluateAll(`${FRAMED_PAGE} ? (localStorage.setItem('wb-saved-copy:/whiteboard/v1.old.mac/', '[]'), sessionStorage.setItem('wb-camera:/whiteboard/v1.old.mac/', '{}'), true) : undefined`);

    ctx.slow.ms = SLOW_MS;
    for (let reload = 1; reload <= 2; reload++) {
      const rows = await watch(page, 5000, () => page.cdp('Page.reload', {}));
      const shown = uncovered(rows).filter(r => r.board);
      assert.ok(shown.length, `reload ${reload}: the board never showed`);
      const zooms = new Set(shown.map(r => r.board.zoom));
      assert.deepEqual([...zooms], [left.zoom], `reload ${reload}: the camera was not kept`);
      const { local, session } = shown.at(-1).board;
      assert.deepEqual(local.filter(k => k.startsWith('wb-saved-copy:')), [], `reload ${reload}: old saved copies are left: ${local}`);
      assert.equal(local.filter(k => k.startsWith('wb-copy:')).length, 1, `reload ${reload}: saved copies: ${local}`);
      assert.deepEqual(session.filter(k => k.startsWith('wb-camera:')), [`wb-camera:artifact:${ctx.id}`], `reload ${reload}: cameras: ${session}`);
    }
  });

  it('shows no failure while a moved element waits to be written', T, async () => {
    const { page } = ctx;
    ctx.slow.ms = 0;
    const [x, y] = await elementToMove(page);
    ctx.slow.ms = SLOW_MS;
    const rows = await watch(page, 3000, () => dragRight(page, x, y));
    const states = rows.map(r => r.shell?.save ?? '');
    assert.ok(!states.some(s => s.includes('unsaved')), `a failure showed: ${[...new Set(states)]}`);
    assert.ok(states.some(s => s.includes('saving')), `"Saving…" never showed for a slow write: ${[...new Set(states)]}`);
    assert.ok(await page.waitFor("!document.querySelector('header [data-shell-save-state]')", 10000), 'the move was not saved');
  });

  it('keeps the cover when the Shell reloads a page whose move is still being written', T, async () => {
    const { page } = ctx;
    ctx.slow.ms = 0;
    const [x, y] = await elementToMove(page);
    const before = (await snapshot(page)).board?.page;
    assert.ok(before, 'the board is not open');
    // The move's write lands while the old page is still there: the new page takes longer to come.
    ctx.slow.delay = url => (/\/_api\/db\//.test(url) ? 400 : /^\/whiteboard\/v1\.[^/?]+\/(\?|$)/.test(url) ? 2500 : 0);
    try {
      await dragRight(page, x, y);
      await clickOn(page, "document.querySelector('header [aria-label=\"Artifact options\"]')", 'the artifact options');
      const refresh = byText('Refresh');
      assert.ok(await page.waitFor(refresh, 5000), 'no Refresh in the artifact options');
      const rows = await watch(page, 9000, () => clickOn(page, refresh, 'Refresh'));
      const shown = uncovered(rows);
      assert.ok(shown.length, `the cover never went:\n${timeline(rows, before)}`);
      // The old page saying its move was saved does not lift the cover: only the new page, once its board shows.
      const early = shown.filter(r => !r.board || r.board.page === before || r.board.veil || r.board.elements === 0);
      assert.ok(!early.length, `the cover went before the new board showed:\n${timeline(rows, before)}`);
    } finally {
      delete ctx.slow.delay;
    }
    assert.ok(await page.waitFor("!document.querySelector('header [data-shell-save-state]')", 10000), 'the reloaded page did not settle');
  });

  it('shows the page after the cap when its board does not load', { timeout: 60000 }, async () => {
    const { page } = ctx;
    ctx.slow.ms = READY_CAP_MS + 5000;
    ctx.slow.pattern = /\/_api\/db\//;
    try {
      const rows = await watch(page, READY_CAP_MS + 2500, () => page.cdp('Page.reload', {}));
      const shown = uncovered(rows);
      assert.ok(shown.length, 'the cover stayed past the cap');
      // Shown by the cap: still under its veil, or by then on the saved copy (the store's own wait ends about then).
      assert.ok(shown[0].t >= READY_CAP_MS - 1000 && shown[0].t <= READY_CAP_MS + 1500, `the cover went at ${shown[0].t}ms`);
    } finally {
      ctx.slow.ms = 0;
      ctx.slow.pattern = /\/_api\/(db|session)/;
    }
  });
});
