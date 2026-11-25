// The Shell's save state while a person edits by hand, on a real daemon (`open-artifact daemon run`, from source, a
// temporary OPEN_ARTIFACT_HOME on a free port) with the built Slides and Whiteboard types, in Chrome. Run twice: with
// type servers in worker threads of the daemon (`OPEN_ARTIFACT_NODE_CHILDREN=threads`, what an Electron host with its
// RunAsNode fuse off gets) and in child processes.
//
// 0.14.1 showed "Couldn't save — retry" for a moment after every hand edit: the pages reported an edit waiting out its
// save debounce as `unsaved`. No request failed, in either mode.
//
//  (a) Slides: retyping a slide's title never shows a failed save; the new title is in the slide's file.
//  (b) Whiteboard: dragging an element and adding a sticky note never shows a failed save; both are in the board's
//      store on disk.
//  (c) Whiteboard through a Shell older than `db.listing` (one left open while the daemon was upgraded to 0.14.3):
//      the Shell refuses the call as 0.14.2's broker did, and the board still loads and saves (0.14.3 before this fix
//      kept retrying the load and never showed the board).
//  (d) Neither type server logged a failed request.
//
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createHarness } from '@open-artifact/harness-kit';
import { findChrome, launch } from './lib/browser.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, skipFor, tmpDir, typePath } from './lib/target.mjs';

const T = { timeout: 120000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'whiteboard', 'elements');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const missing = skipFor('slides') || skipFor('whiteboard');
  if (missing) return missing;
  return fs.existsSync(path.join(repoRoot, 'dist', 'daemon', 'shell', 'index.html')) ? false : 'the Shell is not built (npm run build)';
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

/** The Shell's save indicator: `saving`, `reconnecting`, `unsaved` (a failed save, with or without its retry), or ''. */
const SAVE_STATE = "[...document.querySelectorAll('header [data-shell-save-state]')].map(e => e.dataset.shellSaveState).join(',')";

/** The save indicator sampled every few milliseconds while `action` runs and for `ms` after it. */
async function watchSave(page, ms, action) {
  const states = [];
  let acting = true;
  const done = action().finally(() => (acting = false));
  let end = Infinity;
  while (acting || Date.now() < end) {
    if (!acting && end === Infinity) end = Date.now() + ms;
    states.push(await page.evaluate(SAVE_STATE));
    await sleep(10);
  }
  await done;
  return states;
}

/** `expression` in the framed artifact page (the frame where it is not undefined). */
const framed = async (page, expression) => (await page.evaluateAll(expression).catch(() => [])).find(v => v !== undefined && v !== null);

/** Where the Shell's page draws its frame. */
const frameOrigin = page => page.evaluate("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.x, r.y]; })()");

for (const mode of ['threads', 'process']) {
  describe(`the Shell's save state during hand edits (type servers in ${mode})`, { skip: skip() }, () => {
    const ctx = {};
    const caller = () => ({ session: 'save-1', workspace: ctx.workspace });
    const call = async args => {
      const result = await ctx.host.call('Artifact', args, caller());
      assert.equal(result.error, undefined, `${args.action}: ${JSON.stringify(result.error)}`);
      return result;
    };

    before(async () => {
      const root = tmpDir(`shell-save-${mode}`);
      ctx.home = path.join(root, 'home');
      ctx.workspace = path.join(root, 'work');
      const builtin = path.join(root, 'builtin');
      const user = path.join(root, 'user');
      for (const dir of [builtin, ctx.workspace, user]) fs.mkdirSync(dir, { recursive: true });
      for (const type of ['slides', 'whiteboard']) fs.cpSync(typePath(type), path.join(builtin, type), { recursive: true });
      const env = {
        ...process.env,
        OPEN_ARTIFACT_HOME: ctx.home,
        OPEN_ARTIFACT_USER_TYPES: user,
        OPEN_ARTIFACT_BUILTIN_TYPES: builtin,
        OPEN_ARTIFACT_BROWSER: 'none',
        OPEN_ARTIFACT_IDLE_MS: '0',
        OPEN_ARTIFACT_NODE_CHILDREN: mode,
      };
      for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION', 'OPEN_ARTIFACT_DAEMON_BIN']) delete env[name];
      const port = await freePort();
      assert.notEqual(port, 4800);
      ctx.daemonOut = '';
      ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(port)], { env, cwd: ctx.workspace, stdio: ['ignore', 'pipe', 'pipe'] });
      ctx.daemon.stdout.on('data', chunk => (ctx.daemonOut += chunk));
      ctx.daemon.stderr.on('data', chunk => (ctx.daemonOut += chunk));
      ctx.exited = new Promise(resolve => ctx.daemon.once('exit', resolve));
      ctx.kill = () => ctx.daemon.exitCode === null && ctx.daemon.kill('SIGKILL');
      process.on('exit', ctx.kill);
      assert.ok(await until(() => fs.existsSync(path.join(ctx.home, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.daemonOut}`);
      ctx.host = await createHarness({ harness: 'save-e2e', agentName: 'Saver', home: ctx.home, autoStart: false, caps: { tools: 'native', library: 'own' }, wake: () => 'queued' });
      await ctx.host.ready();
      await ctx.host.attach({ ...caller(), title: 'Save chat', status: 'idle' });
      ctx.browser = await launch({ width: 1280, height: 800 });
    });

    after(async () => {
      await ctx.browser?.close();
      ctx.host?.close();
      if (ctx.daemon?.exitCode === null) {
        ctx.daemon.kill('SIGTERM');
        await Promise.race([ctx.exited, sleep(10000)]);
      }
      ctx.kill?.();
      if (ctx.kill) process.off('exit', ctx.kill);
      removeTmp();
    });

    it('(a) Slides: retyping a title shows no failed save, and the title is saved', T, async () => {
      const made = await call({ action: 'publish', type_url: 'open-artifact://type/slides', title: 'Save deck', open: 'never' });
      const opened = await call({ action: 'open', url: made.url });
      const deckFile = path.join(made.root, 'project', 'deck.json');
      assert.ok(await until(() => fs.existsSync(deckFile), 15000), 'the server scaffolds the deck');
      const deck = JSON.parse(fs.readFileSync(deckFile, 'utf8'));
      const slideFile = path.join(made.root, 'project', 'slides', 's1.html');
      await call({ action: 'publish', url: made.url, files: { 'project/slides/s1.html': '<section class="slide"><h1>First title</h1><p>Body</p></section>\n', 'project/deck.json': JSON.stringify({ ...deck, order: ['s1'] }, null, 2) } });
      const page = await ctx.browser.load(opened.view_url, { ready: "document.querySelector('iframe')" });
      try {
        const heading = "document.querySelector('[data-open-artifact-mode=\"edit\"] h1')";
        assert.ok(await until(() => framed(page, `${heading} ? true : undefined`), 20000), 'the slide did not show');
        const inner = await framed(page, `(() => { const h = ${heading}; if (!h) return undefined; const b = h.getBoundingClientRect(); return [b.x + 24, b.y + b.height / 2]; })()`);
        const [fx, fy] = await frameOrigin(page);
        const states = await watchSave(page, 3000, async () => {
          await page.clickTimes(fx + inner[0], fy + inner[1], 2);
          assert.ok(await until(() => framed(page, 'document.activeElement?.isContentEditable ? true : undefined'), 5000), 'the title did not open for typing');
          const mac = await page.evaluate("navigator.platform.includes('Mac')");
          await page.press('a', { meta: mac, ctrl: !mac, commands: ['selectAll'] });
          // Typed at a person's pace, so the save debounce runs out between keys and after the last one.
          for (const key of 'Retyped title') {
            await page.type(key);
            await sleep(80);
          }
          await page.press('Escape');
        });
        assert.ok(!states.some(s => s.includes('unsaved')), `a failed save showed: ${[...new Set(states)]}`);
        assert.ok(await until(() => fs.readFileSync(slideFile, 'utf8').includes('<h1>Retyped title</h1>'), 10000), fs.readFileSync(slideFile, 'utf8'));
        assert.ok(await page.waitFor(`${SAVE_STATE} === ''`, 10000), 'the save indicator did not settle');
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('(b) Whiteboard: dragging an element and adding a sticky show no failed save, and both are saved', T, async () => {
      const made = await call({ action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Save board', open: 'never' });
      fs.cpSync(path.join(SAMPLE, 'db'), path.join(made.root, 'db'), { recursive: true });
      const opened = await call({ action: 'open', url: made.url });
      const page = await ctx.browser.load(opened.view_url, { ready: "document.querySelector('iframe')" });
      try {
        const count = () => framed(page, "document.querySelector('.wb-elements') ? document.querySelectorAll('.wb-elements [data-wb-id]').length : undefined");
        assert.ok(await until(async () => (await count()) > 0 && (await framed(page, "document.querySelector('.wb-elements') ? !document.querySelector('[data-wb-veil]') : undefined")), 30000), 'the board did not show');
        const before = await count();
        // The largest element in view with nothing over its middle, and its id.
        const target = await framed(page, `(() => {
          if (!document.querySelector('.wb-elements')) return undefined;
          const all = [...document.querySelectorAll('.wb-elements [data-wb-id]')].map(e => [e, e.getBoundingClientRect()])
            .filter(([e, r]) => r.width > 8 && r.height > 8 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
              && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)));
          all.sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height);
          const [e, r] = all[0] ?? [];
          return e ? { id: e.dataset.wbId, at: [r.x + r.width / 2, r.y + r.height / 2] } : null;
        })()`);
        assert.ok(target, 'no element to move');
        const [fx, fy] = await frameOrigin(page);
        const [x, y] = [fx + target.at[0], fy + target.at[1]];
        const stored = () => JSON.stringify(readStore(path.join(made.root, 'db')));
        const start = stored();

        const dragged = await watchSave(page, 3000, async () => {
          await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          for (let i = 1; i <= 20; i++) {
            await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i * 3, y, button: 'left', buttons: 1 });
            await sleep(30);
          }
          await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 60, y, button: 'left', clickCount: 1 });
        });
        assert.ok(!dragged.some(s => s.includes('unsaved')), `a failed save showed during the drag: ${[...new Set(dragged)]}`);
        assert.ok(await until(() => stored() !== start, 10000), 'the move was not written to the store');
        const moved = stored();

        // A sticky from the board's own menu, on an empty spot.
        const empty = await framed(page, `(() => {
          if (!document.querySelector('.wb-elements')) return undefined;
          for (let py = 140; py < innerHeight - 140; py += 40) for (let px = 60; px < innerWidth - 60; px += 40) {
            const hit = document.elementFromPoint(px, py);
            if (hit?.matches('.wb-surface')) return [px, py];
          }
          return null;
        })()`);
        assert.ok(empty, 'no empty spot on the board');
        const added = await watchSave(page, 3000, async () => {
          await page.rightClick(fx + empty[0], fy + empty[1]);
          const item = "[...document.querySelectorAll('[role=menuitem]')].find(e => e.textContent.trim().startsWith('Add a note here'))";
          assert.ok(await until(() => framed(page, `${item} ? true : undefined`), 5000), 'no "Add a note here" in the board menu');
          const at = await framed(page, `(() => { const e = ${item}; if (!e) return undefined; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
          await page.click(fx + at[0], fy + at[1]);
          assert.ok(await until(async () => (await count()) === before + 1, 5000), 'the sticky was not added');
          await page.type('Hi');
          await page.press('Escape');
        });
        assert.ok(!added.some(s => s.includes('unsaved')), `a failed save showed when a sticky was added: ${[...new Set(added)]}`);
        assert.ok(await until(() => stored() !== moved, 10000), 'the sticky was not written to the store');
        assert.ok(await page.waitFor(`${SAVE_STATE} === ''`, 10000), 'the save indicator did not settle');
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('(c) Whiteboard: a Shell older than `db.listing` (left open across an upgrade) still loads the board and saves', T, async () => {
      const made = await call({ action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Old Shell board', open: 'never' });
      fs.cpSync(path.join(SAMPLE, 'db'), path.join(made.root, 'db'), { recursive: true });
      const opened = await call({ action: 'open', url: made.url });
      // The Shell answers `db.listing` as 0.14.2's broker did (a method it does not broker), before its own broker sees it.
      const oldBroker = `(() => {
        if (window !== window.top) return;
        window.__refusedListing = 0;
        window.addEventListener('message', (event) => {
          const data = event.data;
          if (!data || data.openArtifact !== 'cap' || data.cap !== 'db' || data.method !== 'listing') return;
          event.stopImmediatePropagation();
          window.__refusedListing += 1;
          event.source.postMessage({ openArtifact: 'cap_r', id: data.id, error: { code: 'invalid', message: 'unknown method db.listing' } }, event.origin);
        }, true);
      })()`;
      const page = await ctx.browser.load('about:blank', { ready: 'true' });
      try {
        await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: oldBroker });
        await page.cdp('Page.navigate', { url: opened.view_url });
        const count = () => framed(page, "document.querySelector('.wb-elements') ? document.querySelectorAll('.wb-elements [data-wb-id]').length : undefined");
        assert.ok(await until(async () => (await count()) > 0 && (await framed(page, "document.querySelector('.wb-elements') ? !document.querySelector('[data-wb-veil]') : undefined")), 30000),
          'the board did not show through a Shell that refuses db.listing');
        assert.ok((await page.evaluate('window.__refusedListing')) > 0, 'the page did not ask for db.listing');
        const target = await framed(page, `(() => {
          if (!document.querySelector('.wb-elements')) return undefined;
          const all = [...document.querySelectorAll('.wb-elements [data-wb-id]')].map(e => [e, e.getBoundingClientRect()])
            .filter(([e, r]) => r.width > 8 && r.height > 8 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
              && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)));
          all.sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height);
          const [, r] = all[0] ?? [];
          return r ? [r.x + r.width / 2, r.y + r.height / 2] : null;
        })()`);
        assert.ok(target, 'no element to move');
        const [fx, fy] = await frameOrigin(page);
        const [x, y] = [fx + target[0], fy + target[1]];
        const stored = () => JSON.stringify(readStore(path.join(made.root, 'db')));
        const start = stored();
        await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        for (let i = 1; i <= 10; i++) {
          await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i * 5, y, button: 'left', buttons: 1 });
          await sleep(30);
        }
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 50, y, button: 'left', clickCount: 1 });
        assert.ok(await until(() => stored() !== start, 10000), 'the move was not written to the store');
        assert.ok(await page.waitFor(`${SAVE_STATE} === ''`, 10000), 'the save indicator did not settle');
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('(d) neither type server logged a failed request', T, async () => {
      for (const type of ['slides', 'whiteboard']) {
        const log = fs.readFileSync(path.join(ctx.home, 'logs', 'servers', `${type}.log`), 'utf8');
        assert.doesNotMatch(log, /error|failed|refused| [45]\d\d /i, `${type}.log:\n${log}`);
      }
    });
  });
}

/** Every file of a store folder, by path. */
function readStore(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir, { recursive: true }).sort()) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isFile()) out[name] = fs.readFileSync(file, 'utf8');
  }
  return out;
}
