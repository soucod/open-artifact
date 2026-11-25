// End-to-end test of the product Worker (`packages/host-cloudflare/src/worker.ts`, `deploy/cloudflare/wrangler.jsonc`)
// under `wrangler dev`, in Chrome, the way people use it: the catalog in local D1, each artifact in its own Durable
// Object, the app on `localhost:<port>` and each artifact on `<id>.content.localhost:<port>`.
//
// The owner signs in with the owner key (the sign-in address with `#key=` fills the form), uploads a whiteboard's zip
// (from the signed-in page, with its own session: the home page has no upload control), sees it listed on the home
// page without a reload (the Library stream, served by the site hub), and opens it: the framed page draws and its
// session says owner. In the Share panel the owner sets "Anyone with the link" and reads the commenter link; a second
// Chrome joins with it and can comment but not edit. The owner removes the guest: the guest's page loses access, and
// the owner's page does not reload. A second user (put in local D1 with `wrangler d1 execute`, with a session cookie)
// is added as an editor in the Share panel by email: they can edit, and a note either writes shows on the other's
// page with no reload. The owner comments with "Send to <agent>" on: the wake is in the D1 outbox. Then `wrangler dev`
// restarts on the same state folder, and everything is still there.
//
// It prints the D1 cost of a page load and of `_api` calls (`OA_DEBUG_STATS=1`) and the room's rows, and how the
// home page's cost grows with the number of artifacts.
//
// Skipped (with the reason) when deploy/cloudflare has no node_modules, with E2E_BROWSER=0, without Chrome, or before
// `npm run build`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { buildWorkers, d1, d1Cost, freePort, sqlValue, startWrangler, tokenHash, wranglerMissing, zipFolder } from './lib/cloudflare.mjs';
import { abilities, byText, clickInFrame, clickOn, cookieOf, COMPOSER_TEXTAREA, inFrameLayer, SEND_BOX, writeNote } from './lib/host-page.mjs';
import { requestWithHost, until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 300000 };
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'whiteboard', 'elements');
const TITLE = 'Whiteboard element test';
const OWNER_KEY = `owner-${randomBytes(12).toString('hex')}`;
const SIGNING_KEY = randomBytes(32).toString('hex');
const IMPORT = '/api/open-artifact.artifacts.import';
/** Problems every page here may have: no favicon on the host. */
const IGNORE = [/favicon\.ico/];
const DRAWN = "location.hostname.endsWith('.content.localhost') && document.getElementById('root')?.childElementCount > 0";
const sleep = ms => new Promise(r => setTimeout(r, ms));

function skip() {
  const missing = wranglerMissing();
  if (missing) return missing;
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/server/editors/whiteboard/index.html', 'dist/server/support.js'];
  const absent = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return absent.length ? `the host's pages are not built (npm run build): no ${absent.join(', ')}` : false;
}

// The browser harness itself: a call waiting on a frame that goes away fails at once (Chrome never answers it). This
// suite's guest check is where a hang showed: the guest's framed page went away while it was asked, and the call
// waited until the test timed out.
describe('the browser harness: a frame removed while it is asked', { skip: browserOff || !findChrome() ? 'no browser (E2E_BROWSER=0 or no Chrome)' : false }, () => {
  it('fails the waiting evaluate within a second, naming the frame and the expression', { timeout: 60000 }, async () => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      const port = server.address().port;
      // The frame is on another site (127.0.0.1, not localhost), so it runs in a process and session of its own.
      res.end(req.url === '/frame' ? '<!doctype html><p>frame</p>' : `<!doctype html><iframe src="http://127.0.0.1:${port}/frame"></iframe>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await launch({ args: ['--site-per-process'] });
    try {
      const page = await browser.load(`http://localhost:${server.address().port}/`, { ready: "location.hostname === '127.0.0.1'", settle: 200 });
      const started = Date.now();
      const asked = page.evaluateFrames("location.hostname === '127.0.0.1' ? new Promise(() => {}) : 'top'");
      await sleep(300);
      await page.evaluate("document.querySelector('iframe').remove()");
      const { values, detached } = await Promise.race([asked, sleep(5000).then(() => ({ values: ['still waiting after 5 s'], detached: [] }))]);
      const took = Date.now() - started - 300;
      assert.deepEqual(values, ['top']);
      assert.equal(detached.length, 1, JSON.stringify(detached));
      assert.match(detached[0], /the frame was detached.* while evaluating: location\.hostname === '127\.0\.0\.1'/);
      assert.ok(took < 1000, `it took ${took} ms`);
      await page.close();
    } finally {
      await browser.close();
      server.close();
    }
  });
});

describe('cloudflare: the product Worker under wrangler dev, in Chrome', { skip: skip() }, () => {
  const ctx = {};
  const costs = [];

  const start = async () => {
    ctx.server = await startWrangler({
      port: ctx.port,
      state: ctx.state,
      vars: {
        OA_APP_ORIGIN: ctx.app,
        OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${ctx.port}`,
        OA_SIGNING_KEYS: SIGNING_KEY,
        OA_OWNER_KEY: OWNER_KEY,
        OA_DEBUG_STATS: '1',
      },
      ready: async origin => (await fetch(`${origin}/__open-artifact/health`)).status === 200,
    });
  };
  /** A request from Node with the owner's session (its cost is read from the answer). */
  const asOwner = (route, init = {}) => fetch(`${ctx.app}${route}`, { ...init, headers: { cookie: `oa_session=${ctx.ownerSession}`, ...(init.headers ?? {}) } });
  const note = (what, value) => {
    costs.push(`${what}: ${JSON.stringify(value)}`);
    console.log(`# cloudflare-host: ${what}: ${JSON.stringify(value)}`);
  };

  before(async () => {
    buildWorkers();
    ctx.state = tmpDir('cloudflare-host');
    ctx.port = await freePort();
    ctx.app = `http://localhost:${ctx.port}`;
    await start();
    ctx.zip = await zipFolder(SAMPLE);
    ctx.owner = await launch();
    ctx.guest = await launch();
    ctx.editor = await launch();
  });

  after(async () => {
    for (const browser of [ctx.owner, ctx.guest, ctx.editor]) await browser?.close();
    await ctx.server?.stop();
    removeTmp();
  });

  it('answers the app only on its own host: a stray name under the content domain is 421, with no cookie', T, async () => {
    const port = ctx.port;
    const listener = `http://127.0.0.1:${port}`;
    assert.equal((await requestWithHost(`${listener}/auth/sign-in`, `localhost:${port}`)).status, 200, 'the app host');
    for (const host of [`login.content.localhost:${port}`, `content.localhost:${port}`, `127.0.0.1:${port}`]) {
      for (const route of ['/', '/auth/sign-in', '/api/open-artifact.auth.me', '/mcp']) {
        const answer = await requestWithHost(`${listener}${route}`, host);
        assert.equal(answer.status, 421, `${host}${route}: ${answer.body.slice(0, 200)}`);
        assert.equal(answer.headers['set-cookie'], undefined, `${host}${route}`);
        assert.equal(answer.headers.location, undefined, `${host}${route}`);
      }
      const signIn = await requestWithHost(`${listener}/auth/owner-key`, host, { method: 'POST', headers: { origin: `http://${host}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key: OWNER_KEY, return_to: '/' }).toString() });
      assert.equal(signIn.status, 421, `${host}: the owner-key POST`);
      assert.equal(signIn.headers['set-cookie'], undefined);
    }
    assert.equal((await requestWithHost(`${listener}/__open-artifact/health`, `login.content.localhost:${port}`)).status, 200);
    assert.equal((await requestWithHost(`${listener}/`, `art-0000000000000000.content.localhost:${port}`)).status, 404);
  });

  it('signs in, uploads, shares, puts a guest out, adds an editor, wakes the agent, and keeps it all across a restart', T, async () => {
    const { owner, guest, editor, app } = ctx;

    // 1. The owner-key sign-in: the address's fragment fills the form; the person submits it.
    const page = await owner.load(`${app}/auth/sign-in#key=${OWNER_KEY}`, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    assert.equal(await page.evaluate('location.hash'), '');
    await clickOn(page, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await page.waitFor(`location.href === ${JSON.stringify(`${app}/`)}`, 20000), `not signed in: ${await page.evaluate('location.href')}`);
    ctx.ownerSession = await cookieOf(page, app, 'oa_session');
    assert.ok(ctx.ownerSession, 'no session cookie');

    // 2. Upload the zip from the signed-in home page (same origin, its own session cookie).
    const uploaded = await page.evaluate(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(ctx.zip.toString('base64'))}), c => c.charCodeAt(0));
      const res = await fetch('${IMPORT}', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: bytes });
      return { status: res.status, body: await res.json() };
    })()`);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.title, TITLE);
    assert.equal(uploaded.body.role, 'owner');
    const id = (ctx.id = uploaded.body.id);

    // 3. The home page lists it with its title, without a reload (the Library stream from the site hub).
    assert.ok(await page.waitFor(`[...document.querySelectorAll('a')].some(a => a.getAttribute('href') === '/a/${id}' && a.innerText.includes(${JSON.stringify(TITLE)}))`, 20000), `the home page does not list the artifact: ${await page.evaluate('document.body.innerText.slice(0, 500)')}`);

    // 4. Open it from the home page: the framed page draws on its content origin; its session says owner.
    await clickOn(page, `[...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/a/${id}')`, 'the artifact on the home page');
    assert.ok(await page.waitFor(`location.pathname === '/a/${id}'`, 15000));
    assert.ok(await page.waitFor(DRAWN, 45000), 'the framed page did not draw');
    const frames = await page.evaluateAll('location.origin');
    assert.ok(frames.includes(`http://${id.replace('_', '-')}.content.localhost:${ctx.port}`), frames.join(', '));
    assert.deepEqual(await abilities(page), { role: 'owner', comment: 200, edit: 200 });
    const ownerLoadedAt = await page.evaluate('performance.timeOrigin');

    // 5. Share: "Anyone with the link"; the commenter link is on at once.
    await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
    await clickOn(page, "document.querySelector('[aria-label=\"General access\"]')", 'General access');
    await clickOn(page, byText('Anyone with the link'), 'Anyone with the link');
    assert.ok(await page.waitFor("document.querySelector('[data-share-link=commenter]')?.title.includes('/s/')", 15000), 'the commenter link shows no address');
    const link = await page.evaluate("document.querySelector('[data-share-link=commenter]').title");
    assert.match(link, new RegExp(`^${app}/s/[A-Za-z0-9_-]{16,64}$`));

    // 6. A browser with nothing in it joins with the link: it may comment, not edit.
    const join = await guest.load(link, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    await clickOn(join, "document.querySelector('input[name=name]')", 'the name field');
    await join.type('Gus the guest');
    await clickOn(join, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await join.waitFor(`location.pathname === '/a/${id}'`, 20000), `the join did not open the artifact: ${await join.evaluate('location.href')}`);
    assert.ok(await join.waitFor(DRAWN, 45000), "the guest's framed page did not draw");
    assert.deepEqual(await abilities(join), { role: 'commenter', comment: 200, edit: 403 });

    // 7. The owner removes the guest (the panel lists who joined; it polls): the guest's access ends, the owner's page
    // does not reload.
    assert.ok(await page.waitFor("[...document.querySelectorAll('[data-share-guest]')].some(e => e.innerText.includes('Gus the guest'))", 20000), 'the guest is not listed');
    await clickOn(page, "document.querySelector('[data-share-guest] button[aria-label=\"Remove Gus the guest\"]')", 'Remove Gus');
    await sleep(300);
    await clickOn(page, byText('Remove', "(document.querySelector('[role=alertdialog],[role=dialog]:last-of-type') ?? document)"), 'the confirmation');
    // Lost means the guest's page went to the sign-in page, or its framed page's session is refused (403) and so are
    // its comment and its edit. The framed page may go away while it is asked (the Shell sends the guest to sign in):
    // then it is asked again on the next round, and the sign-in page is seen.
    let latest;
    const lost = await until(async () => {
      const at = await join.evaluate('location.pathname').catch(() => null);
      if (at?.startsWith('/auth/sign-in')) {
        latest = { at };
        return true;
      }
      latest = await abilities(join).catch(e => ({ error: e.message }));
      return latest?.role === 'refused 403';
    }, 15000);
    assert.ok(lost, `the guest kept access: ${JSON.stringify(latest)}`);
    if (latest.role) assert.deepEqual(latest, { role: 'refused 403', comment: 403, edit: 403 });
    assert.equal(await page.evaluate('performance.timeOrigin'), ownerLoadedAt, "the owner's page reloaded");

    // 8. A second user, put in the catalog directly (no sign-in provider here): a user with a verified email and a
    // session. The owner adds them as an editor by email in the Share panel.
    const eda = { id: `usr_e2e${randomBytes(6).toString('hex')}`, token: randomBytes(32).toString('base64url') };
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 86400_000).toISOString();
    d1(ctx.state, `INSERT INTO users (id, name, email, email_verified, site_role, created_at) VALUES (${[eda.id, 'Eda Editor', 'eda@example.com', 1, 'member', now].map(sqlValue).join(', ')}); INSERT INTO sessions (id_hash, user_id, created_at, seen_at, expires_at) VALUES (${[tokenHash(eda.token), eda.id, now, now, later].map(sqlValue).join(', ')});`);
    await clickOn(page, "document.querySelector('input[aria-label=\"Add people\"]')", 'Add people');
    await page.type('eda@example.com');
    await clickOn(page, "document.querySelector('[aria-label=\"Role for the people you add\"]')", 'the role for new people');
    await clickOn(page, byText('Editor'), 'Editor');
    await clickOn(page, "[...document.querySelectorAll('form button[type=submit]')].find(b => b.textContent.trim() === 'Add')", 'Add');
    assert.ok(await page.waitFor("[...document.querySelectorAll('[data-share-member]')].some(e => e.innerText.includes('Eda'))", 15000), 'Eda is not listed as a member');
    await page.press('Escape');

    const blank = await editor.load('about:blank');
    await blank.cdp('Network.setCookie', { name: 'oa_session', value: eda.token, url: app, httpOnly: true, sameSite: 'Lax' });
    await blank.close();
    const edaPage = await editor.load(`${app}/a/${id}`, { ready: DRAWN, timeout: 45000, ignore: IGNORE });
    assert.ok(await edaPage.waitFor(DRAWN, 45000), "the editor's framed page did not draw");
    assert.deepEqual(await abilities(edaPage), { role: 'editor', comment: 200, edit: 200 });
    // Both see the other's change live.
    const edaLoadedAt = await edaPage.evaluate('performance.timeOrigin');
    assert.equal(await writeNote(edaPage, 'e2eeda', 'Written by Eda'), 200);
    assert.ok(await page.waitFor("document.querySelector('#wb-e2eeda')?.innerText.includes('Written by Eda')", 20000), "Eda's note did not show on the owner's page");
    assert.equal(await writeNote(page, 'e2eowner', 'Written by the owner', [320, 60]), 200);
    assert.ok(await edaPage.waitFor("document.querySelector('#wb-e2eowner')?.innerText.includes('Written by the owner')", 20000), "the owner's note did not show on Eda's page");
    assert.equal(await page.evaluate('performance.timeOrigin'), ownerLoadedAt, "the owner's page reloaded");
    assert.equal(await edaPage.evaluate('performance.timeOrigin'), edaLoadedAt, "Eda's page reloaded");

    // 9. "Send to <agent>": the owner comments with the box on; the wake is in the D1 outbox for the owner.
    await clickOn(page, "document.querySelector('header [data-comments-button] button[aria-label=\"Comments\"]')", 'Comments');
    assert.ok(await page.waitFor("document.querySelector('header [data-comments-button] button[aria-pressed=true]')", 15000), 'no comment mode');
    const center = await page.evaluate("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2 + 120]; })()");
    await page.click(...center);
    assert.ok(await page.waitFor(COMPOSER_TEXTAREA, 15000), 'no comment composer');
    await page.type('Make the title bigger, please');
    assert.equal(await inFrameLayer(page, `(${SEND_BOX})?.getAttribute('aria-checked')`), 'false');
    await clickInFrame(page, SEND_BOX, 'Send to the agent');
    assert.equal(await inFrameLayer(page, `(${SEND_BOX})?.getAttribute('aria-checked')`), 'true');
    await clickInFrame(page, "layer.querySelector('[data-comment-card] button[data-cds-part=send]:not(:disabled)')", 'Send');
    let rows = [];
    const woken = await until(() => {
      rows = d1(ctx.state, `SELECT kind, to_user, payload_json FROM outbox WHERE artifact_id = ${sqlValue(id)} ORDER BY id`);
      return rows.some(r => r.kind === 'wake' && r.payload_json.includes('Make the title bigger, please'));
    }, 20000, 500);
    assert.ok(woken, `no wake in the outbox: ${JSON.stringify(rows)}`);
    const ownerId = d1(ctx.state, `SELECT owner_user FROM artifacts WHERE id = ${sqlValue(id)}`)[0].owner_user;
    assert.equal(rows.find(r => r.payload_json.includes('Make the title bigger')).to_user, ownerId);

    // Costs (OA_DEBUG_STATS=1): a page load, `_api` calls, the room's rows.
    const shellLoad = await asOwner(`/a/${id}`);
    note('GET /a/<id> (Shell page)', d1Cost(shellLoad));
    note('GET / (home)', d1Cost(await asOwner('/')));
    note('GET /api/open-artifact.artifacts (list)', d1Cost(await asOwner('/api/open-artifact.artifacts')));
    note('GET /api/open-artifact.artifact?id=', d1Cost(await asOwner(`/api/open-artifact.artifact?id=${id}`)));
    const room = await (await asOwner(`/__open-artifact/stats?id=${id}`)).json();
    note('room storage and D1 (since the object started)', { storage: room.room?.storage, usage: room.room?.usage, d1: room.room?.d1, connections: room.room?.connections });
    note('hub', room.hub);

    // 10. Restart wrangler dev on the same state: everything is still there.
    await ctx.server.stop();
    await start();
    const back = await owner.load(`${app}/a/${id}`, { ready: DRAWN, timeout: 45000, ignore: [...IGNORE, /ERR_CONNECTION_REFUSED|failed \(net::/] });
    assert.ok(await back.waitFor("document.querySelector('#wb-e2eeda')?.innerText.includes('Written by Eda')", 30000), 'the notes are gone after the restart');
    assert.deepEqual(await abilities(back), { role: 'owner', comment: 200, edit: 200 });
    const edaBack = await editor.load(`${app}/a/${id}`, { ready: DRAWN, timeout: 45000, ignore: IGNORE });
    assert.equal((await abilities(edaBack))?.role, 'editor');
    const home = await owner.load(`${app}/`, { ready: `document.body.innerText.includes(${JSON.stringify(TITLE)})`, ignore: IGNORE });
    assert.ok(await home.waitFor(`document.body.innerText.includes(${JSON.stringify(TITLE)})`, 15000), 'the home page lost the artifact');
    assert.ok(d1(ctx.state, `SELECT kind FROM outbox WHERE artifact_id = ${sqlValue(id)}`).some(r => r.kind === 'wake'), 'the outbox lost the wake');
    const guestBack = await abilities(join).catch(() => undefined);
    if (guestBack) assert.notEqual(guestBack.role, 'commenter', 'the removed guest is back after the restart');

    // How the cost of the home page and the list grows with the number of artifacts.
    const before = { home: d1Cost(await asOwner('/')), list: d1Cost(await asOwner('/api/open-artifact.artifacts')) };
    for (let n = 0; n < 10; n++) {
      const res = await asOwner(IMPORT, { method: 'POST', headers: { 'content-type': 'application/zip', origin: app }, body: ctx.zip });
      assert.equal(res.status, 201, await res.text());
    }
    const afterTen = { home: d1Cost(await asOwner('/')), list: d1Cost(await asOwner('/api/open-artifact.artifacts')) };
    note('home and list with 1 artifact', before);
    note('home and list with 11 artifacts', afterTen);

    for (const p of [page, join, edaPage, back]) {
      assert.deepEqual(
        p.problems.filter(x => !/HTTP 40[134]: .*\/_?api\//.test(x) && !/frame_denied|not_granted|no longer|lost access|ERR_CONNECTION_REFUSED|net::ERR/i.test(x)),
        [],
      );
    }
  });
});
