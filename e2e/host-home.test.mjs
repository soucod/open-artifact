// End-to-end test of the cloud home page (`packages/shell/src/home`) on the real single-process host, in Chrome: what a
// person does there without an agent.
//
// The owner signs in with the address the host printed and lands on an empty home page. They press Upload and pick a
// zip of `test-artifacts/whiteboard/elements` (made by the type server's own archive code, the "Whole folder (.zip)"
// of the local Export tab): the file goes in through the page's file input (the chooser is intercepted, the file set
// with DevTools' `DOM.setFileInputFiles`, as a person picking it would), the page uploads it and opens the new
// artifact, whose framed page draws. A zip that is not an artifact gets the plain-words refusal.
//
// Then the trash: the card's menu moves the artifact to the trash; the Trash tab lists it with its type; Restore brings
// it back to the list; it goes to the trash again and "Delete forever" asks first. The Node host answers that with 501
// until `removeArtifact` is wired there: the page then stops offering it and the artifact stays in the trash. A host
// that deletes it takes it out of the trash for good. The test accepts both and logs which it saw.
//
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { zipFolder } from './lib/cloudflare.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 180000 };
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'whiteboard', 'elements');
const TITLE = 'Whiteboard element test';

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/server/editors/whiteboard/index.html', 'dist/server/support.js'];
  const missing = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return missing.length ? `the host's pages are not built (npm run build): no ${missing.join(', ')}` : false;
}

/** A TCP port nobody listens on now. */
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

/** The middle of the element `selector` (an expression) finds, scrolled into view; null when there is none. */
const centerOf = selector => `(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;

/** Click the element `selector` finds with the real mouse, once it is there. */
async function clickOn(page, selector, what = selector) {
  assert.ok(await page.waitFor(selector, 15000), `nothing to click: ${what}`);
  const at = await page.evaluate(centerOf(selector));
  assert.ok(at, `nothing to click: ${what}`);
  await page.click(...at);
}

/** A button (or menu item, tab, link) by its text, in `scope`. */
const byText = (text, scope = 'document') => `[...${scope}.querySelectorAll('button,[role=menuitem],[role=tab],a')].reverse().find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) && e.getClientRects().length)`;

/** The home page's card of artifact `id`. */
const cardOf = id => `document.querySelector('a[href="/a/${id}"]')?.closest('.group')`;

/** Press Upload and pick `file`: the chooser is intercepted, and the file goes in through the page's own input. */
async function upload(page, file) {
  await page.cdp('Page.setInterceptFileChooserDialog', { enabled: true });
  await clickOn(page, byText('Upload'), 'Upload');
  const { result } = await page.cdp('Runtime.evaluate', { expression: "document.querySelector('input[type=file][data-home-upload]')" });
  assert.ok(result.objectId, 'the home page has no file input');
  await page.cdp('DOM.setFileInputFiles', { files: [file], objectId: result.objectId });
}

/** Problems every page here may have: no favicon on the host; the refused uploads and the 501 purge are expected. */
const IGNORE = [/favicon\.ico/, /HTTP (400|501): .*artifacts\.(import|purge)/, /HTTP 404: .*artifacts\.restore/];

describe('cloud home page in Chrome', { skip: skip() }, () => {
  const ctx = {};

  before(async () => {
    const dir = tmpDir('host-home');
    const port = await freePort();
    ctx.app = `http://localhost:${port}`;
    ctx.env = {
      ...process.env,
      OA_DATA_DIR: path.join(dir, 'data'),
      OA_PORT: String(port),
      OA_BIND: '127.0.0.1',
      OA_APP_ORIGIN: ctx.app,
      OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`,
    };
    delete ctx.env.OA_OWNER_KEY;
    delete ctx.env.OA_SIGNING_KEYS;

    // The zips: the whiteboard sample as the Export tab makes it, and a folder that is no artifact.
    ctx.zip = path.join(dir, 'Whiteboard element test.zip');
    fs.writeFileSync(ctx.zip, await zipFolder(SAMPLE));
    const notes = path.join(dir, 'notes');
    fs.mkdirSync(notes);
    fs.writeFileSync(path.join(notes, 'readme.txt'), 'Just some notes, not an artifact.\n');
    ctx.notArtifact = path.join(dir, 'notes.zip');
    fs.writeFileSync(ctx.notArtifact, await zipFolder(notes));

    ctx.log = '';
    ctx.host = spawn(process.execPath, [MAIN, 'serve'], { env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.host.stdout.on('data', chunk => (ctx.log += chunk));
    ctx.host.stderr.on('data', chunk => (ctx.log += chunk));
    ctx.stopHost = () => ctx.host.exitCode === null && ctx.host.kill('SIGKILL');
    process.on('exit', ctx.stopHost);
    const signIn = () => /(http:\/\/\S+\/auth\/sign-in#key=\S+)/.exec(ctx.log)?.[1];
    await until(signIn, 30000);
    ctx.signIn = signIn();
    assert.ok(ctx.signIn, `the host printed no sign-in address:\n${ctx.log}`);
    ctx.browser = await launch();
  });

  after(async () => {
    await ctx.browser?.close();
    if (ctx.host) {
      const exited = new Promise(resolve => (ctx.host.exitCode !== null ? resolve() : ctx.host.once('exit', resolve)));
      ctx.host.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      ctx.stopHost();
      process.off('exit', ctx.stopHost);
    }
    removeTmp();
  });

  it('uploads an artifact zip and opens it; a zip that is not one is refused in plain words', T, async () => {
    const { browser, app } = ctx;
    const page = await browser.load(ctx.signIn, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    await clickOn(page, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await page.waitFor(`location.href === ${JSON.stringify(`${app}/`)} && !!document.querySelector('input[data-home-upload]')`, 20000), `no home page with Upload: ${await page.evaluate('location.href + "\\n" + document.body.innerText.slice(0, 400)')}`);

    // 1. Upload → the Shell of the new artifact, its page drawn on its content origin.
    await upload(page, ctx.zip);
    assert.ok(await page.waitFor("/^\\/a\\/art_[0-9a-z]+$/.test(location.pathname)", 30000), `the upload did not open the artifact: ${await page.evaluate('location.href + "\\n" + document.body.innerText.slice(0, 400)')}`);
    ctx.id = await page.evaluate('location.pathname.slice(3)');
    assert.ok(await page.waitFor("location.hostname.endsWith('.content.localhost') && document.getElementById('root')?.childElementCount > 0", 30000), 'the uploaded whiteboard did not draw');
    assert.ok(await page.waitFor(`document.title.includes(${JSON.stringify(TITLE)}) || document.body.innerText.includes(${JSON.stringify(TITLE)})`, 15000), 'the Shell does not show the uploaded title');

    // 2. Home again: the artifact is listed; a zip that is no artifact is refused with the words a person can act on.
    const home = await browser.load(`${app}/`, { ready: `!!document.querySelector('a[href="/a/${ctx.id}"]')`, ignore: IGNORE });
    await upload(home, ctx.notArtifact);
    assert.ok(await home.waitFor("!!document.querySelector('[data-home-upload-error]')", 20000), 'no refusal shown');
    const said = await home.evaluate("document.querySelector('[data-home-upload-error]').innerText");
    assert.match(said, /That zip is not an Open Artifact folder\. Use “Whole folder \(\.zip\)” from an artifact’s Export tab\./);
    assert.equal(await home.evaluate('location.pathname'), '/');
    // Dismissed, it goes.
    await clickOn(home, "document.querySelector('[data-home-upload-error] button[aria-label=Dismiss]')", 'Dismiss');
    assert.ok(await home.waitFor("!document.querySelector('[data-home-upload-error]')", 5000));
    ctx.home = home;
    for (const p of [page, home]) assert.deepEqual(p.problems, []);
    await page.close();
  });

  it('moves it to the trash, lists it there, restores it, and asks before deleting it forever', T, async () => {
    const { home, id } = ctx;
    assert.ok(home && id, 'the upload case did not run');

    // 1. The card's menu → Move to trash: the card goes, the undo bar says where it went.
    await clickOn(home, `${cardOf(id)}?.querySelector('button[aria-label="More actions"]')`, "the card's menu");
    await clickOn(home, byText('Move to trash'), 'Move to trash');
    assert.ok(await home.waitFor(`!document.querySelector('a[href="/a/${id}"]')`, 10000), 'the card is still listed');
    assert.ok(await home.waitFor(`document.querySelector('[role=status]')?.innerText.includes('to the trash')`, 5000), 'no "moved to the trash" bar');

    // 2. Trash: listed with its type.
    await clickOn(home, byText('Trash'), 'the Trash tab');
    assert.ok(await home.waitFor(`!!document.querySelector('[data-home-trashed="${id}"]')`, 10000), 'the Trash tab does not list it');
    const row = await home.evaluate(`document.querySelector('[data-home-trashed="${id}"]').innerText`);
    assert.match(row, new RegExp(TITLE));
    assert.match(row, /Whiteboard/);

    // 3. Restore: out of the trash, back in the list.
    await clickOn(home, byText('Restore', `document.querySelector('[data-home-trashed="${id}"]')`), 'Restore');
    assert.ok(await home.waitFor(`!document.querySelector('[data-home-trashed="${id}"]')`, 10000), 'still in the trash after Restore');
    await clickOn(home, byText('Artifacts'), 'the Artifacts tab');
    assert.ok(await home.waitFor(`!!document.querySelector('a[href="/a/${id}"]')`, 10000), 'not back in the list after Restore');

    // 4. Trash again, then Delete forever: a confirmation that says it cannot be undone and who loses it.
    await clickOn(home, `${cardOf(id)}?.querySelector('button[aria-label="More actions"]')`, "the card's menu");
    await clickOn(home, byText('Move to trash'), 'Move to trash');
    assert.ok(await home.waitFor(`!document.querySelector('a[href="/a/${id}"]')`, 10000));
    await clickOn(home, byText('Trash'), 'the Trash tab');
    await clickOn(home, byText('Delete forever', `document.querySelector('[data-home-trashed="${id}"]')`), 'Delete forever');
    // (Toasts are dialogs too: the confirmation is the one with a Delete forever button.)
    const CONFIRM = "[...document.querySelectorAll('[role=dialog]')].find(d => [...d.querySelectorAll('button')].some(b => b.textContent.trim() === 'Delete forever'))";
    assert.ok(await home.waitFor(`!!${CONFIRM}`, 5000), 'no confirmation');
    const dialog = await home.evaluate(`${CONFIRM}.innerText`);
    assert.match(dialog, /cannot be undone/);
    assert.match(dialog, /everyone it was shared with loses access/);
    await clickOn(home, byText('Delete forever', CONFIRM), 'the confirmation');

    // 5. Either the host deleted it (gone from the trash), or it cannot (501): the action goes, the artifact stays.
    let seen = null;
    assert.ok(
      await until(async () => {
        const state = await home.evaluate(`(() => { const row = document.querySelector('[data-home-trashed="${id}"]'); if (!row) return 'purged'; return [...row.querySelectorAll('button')].some(b => b.textContent.includes('Delete forever')) ? null : 'unsupported'; })()`);
        seen = state;
        return state;
      }, 10000),
      'Delete forever neither deleted it nor went away',
    );
    console.log(`# Delete forever on the Node host: ${seen === 'purged' ? 'deleted for good (purge is wired)' : '501, the action is no longer offered and the artifact stays in the trash'}`);
    if (seen === 'purged') {
      // Gone for good: not in the trash any more, and not restorable.
      const after = await home.evaluate(`fetch('/api/open-artifact.artifacts?trashed=1').then(r => r.json()).then(o => o.artifacts.map(a => a.id))`);
      assert.ok(!after.includes(id), `still in the trash list: ${after}`);
      const restore = await home.evaluate(`fetch('/api/open-artifact.artifacts.restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(id)} }) }).then(r => r.status)`);
      assert.equal(restore, 404);
    }
    if (seen === 'unsupported') {
      // Nothing claims it was deleted; it can still be restored.
      assert.ok(!(await home.evaluate("document.body.innerText")).includes(`Deleted "${TITLE}" forever`), 'a message claims it was deleted');
      assert.ok(await home.evaluate(`[...document.querySelector('[data-home-trashed="${id}"]').querySelectorAll('button')].some(b => b.textContent.includes('Restore'))`));
    }
    assert.deepEqual(home.problems, []);
  });
});
