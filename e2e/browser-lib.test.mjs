// The Chrome harness itself (`e2e/lib/browser.mjs`), against a page of its own on a local server: no artifact type, no
// daemon.
//
// `waitFor`, `evaluateAll` and `load`'s `ready` ask every frame of a tab. They must not ask a worker: Chrome 157 stops
// the renderer (a CHECK of its own, in `WorkerGlobalScope.location`) when `location` is read in a module worker whose
// script has not arrived yet, and the suites' usual question starts with `location.hostname…`. That was the
// `renderer crashed: iframe …/whiteboard/…` of the Cloudflare suites: the whiteboard starts a module worker
// (`whiteboard-looks`) while the test is still waiting for the board, and under `wrangler dev` its script takes long
// enough to arrive for the question to land in between, about one first load in four.
//
// Here the server sends the start of the worker's script and holds the rest back for as long as the test likes (the
// worker exists and has its context once the response has begun), so the question always lands in between.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { browserOff } from './lib/target.mjs';

const T = { timeout: 60000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const skip = browserOff || !findChrome() ? 'no browser (E2E_BROWSER=0 or no Chrome)' : false;

const PAGE = `<!doctype html><title>harness</title><div id="root"><p>Drawn</p></div>
<script type="module">
  const worker = new Worker('/worker.js', { type: 'module', name: 'held-back' });
  worker.addEventListener('message', event => { document.title = event.data; });
</script>`;

describe('the Chrome harness asks frames, not workers', { skip }, () => {
  const ctx = { release: null };

  before(async () => {
    ctx.held = new Promise(resolve => (ctx.release = resolve));
    ctx.server = http.createServer(async (req, res) => {
      if (req.url === '/worker.js') {
        // The worker has its context once the response begins; the rest of its script arrives when the test lets it.
        ctx.asked = true;
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.write('// The start of the script.\n');
        await ctx.held;
        res.end("postMessage('worker up: ' + self.name);");
      } else if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PAGE);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise(resolve => ctx.server.listen(0, '127.0.0.1', resolve));
    ctx.url = `http://127.0.0.1:${ctx.server.address().port}/`;
    ctx.browser = await launch({ width: 800, height: 600 });
  });

  after(async () => {
    ctx.release?.();
    await ctx.browser?.close();
    ctx.server?.closeAllConnections?.();
    ctx.server?.close();
  });

  it('reads location while a module worker waits for its script, and the renderer lives', T, async () => {
    const page = await ctx.browser.load(ctx.url, { ready: "location.pathname === '/' && document.getElementById('root')?.childElementCount > 0", ignore: [/favicon/] });
    try {
      const start = Date.now();
      while (!ctx.asked && Date.now() - start < 10000) await sleep(20);
      assert.ok(ctx.asked, 'the page did not start its worker');
      // What the suites ask while a page loads, over and over, with the rest of the worker's script still on its way.
      await sleep(300);
      for (let i = 0; i < 40; i++) {
        const answers = await page.evaluateAll("location.hostname + ' ' + (typeof WorkerGlobalScope === 'undefined' ? 'frame' : 'worker')");
        assert.deepEqual(answers, ['127.0.0.1 frame'], 'only the page answers');
        await sleep(25);
      }
      assert.equal(await page.waitFor("location.hostname === '127.0.0.1' && document.querySelector('#root p')", 2000), true);
      assert.deepEqual(page.crashedFrames, []);
      assert.deepEqual(page.problems, []);
      // The worker was only waiting: once its script arrives it runs, and the page hears from it.
      ctx.release();
      assert.ok(await page.waitFor("document.title === 'worker up: held-back'", 10000), `the worker never ran: ${await page.evaluate('document.title')}`);
      assert.deepEqual(await page.evaluateAll("typeof WorkerGlobalScope === 'undefined' ? 'frame' : 'worker'"), ['frame'], 'a running worker is not asked either');
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });
});
