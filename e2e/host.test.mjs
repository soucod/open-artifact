// End-to-end test of the cloud host (`packages/host`) in Chrome, the way people use it: the real host on a free port
// with a data folder of its own and an imported whiteboard, its app origin on `localhost` and each artifact on its own
// `*.content.localhost` origin (Chrome resolves those itself, so the two-origin setup is the real one).
//
// The owner opens the sign-in address the host printed (the key comes in the fragment and fills the form), signs in,
// finds the artifact on the home page and opens it: the framed page on the content origin draws and its session says
// owner. In the Share panel the owner sets general access to "Anyone with the link" and reads the commenter link. A
// second Chrome with nothing in it opens that link, types a name and joins: its page is a commenter's (a comment is
// written, an edit refused). The owner resets the commenter link, and the guest's page loses access.
//
// Everything a person does goes through the real mouse and keyboard; the checks of what a page may do run inside the
// framed page itself, on its own origin, with its own token.
//
// The app answers only on its own host: a stray name under the content domain (`login.content.localhost`), the bare
// content domain and the listener's address get a 421 with no cookie, also for the owner-key form's POST.
//
// Then the agent's computer: a real daemon (`open-artifact daemon run`, its own home and port) is linked to the host
// with `open-artifact remote add`, the owner approving the code in Chrome. A local whiteboard folder is published with
// `open-artifact publish <folder>`. On the cloud page the owner comments with "Send to <agent>" on, and the comment
// reaches the agent's session (`open-artifact wait`). A file written in the local folder shows on the open cloud page:
// the daemon's folder watcher pushes it (`link.files`), the host's type server sees an outside change in the artifact's
// folder and tells the open page over its event stream, and the page draws it with no reload.
//
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { requestWithHost, until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 180000 };
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
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

/** A button (or menu item) by its text, in the last open dialog or menu when there is one. */
const byText = (text, scope = 'document') => `[...${scope}.querySelectorAll('button,[role=menuitem],[role=menuitemradio],a')].reverse().find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) && e.getClientRects().length)`;

/** Run `body` (an async function's source taking the page's own base URL) in the framed page on the content origin. */
const inFrame = (page, body) =>
  page.evaluateAll(`location.hostname.endsWith('.content.localhost') && /\\/[a-z-]+\\/v1\\.[^/]+\\/$/.test(location.pathname) ? (${body})(location.origin + location.pathname) : undefined`).then(values => values.find(v => v !== undefined));

/** What the framed page may do now: its session's role (or the status), whether a comment and an edit are taken. */
const abilities = page =>
  inFrame(
    page,
    `async (base) => {
      const session = await fetch(base + '_api/session');
      const role = session.ok ? (await session.json()).viewer.role : 'refused ' + session.status;
      const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
      const comment = await post('_api/comments/create', { input: { anchor: '{"element":"e1"}', label: 'Note', text: 'From the e2e guest' } });
      const edit = await post('_api/db/write', { client: 'e2e', writes: [{ op: 'set', path: 'elements/e2e-' + Date.now(), data: { type: 'note', x: 0, y: 0, text: 'Hi', color: 'yellow' } }] });
      return { role, comment, edit };
    }`,
  );

/** The framed page's comments layer (its shadow root), where the board draws its comment composer. */
const LAYER = "document.querySelector('[data-comment-layer]')?.shadowRoot";
/** The composer's text box has the focus. */
const COMPOSER_TEXTAREA = `${LAYER}?.activeElement?.matches('textarea[aria-label=Comment]')`;
/** The composer's "Send to <agent>" box (`layer`: the comments layer). */
const SEND_BOX = "[...layer.querySelectorAll('[data-comment-card] [role=checkbox]')].find(e => /^Send to /.test(e.textContent.trim()))";

/** `expression` (which may use `layer`) evaluated in the framed page that has a comments layer. */
const inFrameLayer = (page, expression) => page.evaluateAll(`(() => { const layer = ${LAYER}; return layer ? (${expression}) : undefined; })()`).then(values => values.find(v => v !== undefined));

/** Clicks, with the real mouse, the element `selector` (using `layer`) finds in the framed page's comments layer. */
async function clickInFrame(page, selector, what) {
  const inner = await inFrameLayer(page, `(() => { const e = ${selector}; if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  assert.ok(inner, `nothing to click: ${what}`);
  const frame = await page.evaluate("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.left, r.top]; })()");
  await page.click(frame[0] + inner[0], frame[1] + inner[1]);
}

/** Problems every page here may have: no favicon on the host. */
const IGNORE = [/favicon\.ico/];

describe('cloud host in Chrome', { skip: skip() }, () => {
  const ctx = {};

  before(async () => {
    const data = path.join(tmpDir('host'), 'data');
    const port = await freePort();
    ctx.app = `http://localhost:${port}`;
    ctx.env = {
      ...process.env,
      OA_DATA_DIR: data,
      OA_PORT: String(port),
      OA_BIND: '127.0.0.1',
      OA_APP_ORIGIN: ctx.app,
      OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`,
    };
    delete ctx.env.OA_OWNER_KEY;
    delete ctx.env.OA_SIGNING_KEYS;
    const imported = spawnSync(process.execPath, [MAIN, 'import', SAMPLE], { env: ctx.env, encoding: 'utf8', timeout: 60000 });
    assert.equal(imported.status, 0, `import failed: ${imported.stderr}`);
    ctx.id = /as (art_[0-9a-z]+)/.exec(imported.stdout)?.[1];
    assert.ok(ctx.id, imported.stdout);
    // The imported title is the one the artifact keeps (the type's titleFrom), not the folder's name.
    assert.match(imported.stdout, new RegExp(`Imported "${TITLE}"`));

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
    ctx.owner = await launch();
    ctx.guest = await launch();
  });

  after(async () => {
    await ctx.owner?.close();
    await ctx.guest?.close();
    if (ctx.daemon) {
      const exited = new Promise(resolve => (ctx.daemon.exitCode !== null ? resolve() : ctx.daemon.once('exit', resolve)));
      ctx.daemon.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      if (ctx.daemon.exitCode === null) ctx.daemon.kill('SIGKILL');
    }
    if (ctx.host) {
      const exited = new Promise(resolve => (ctx.host.exitCode !== null ? resolve() : ctx.host.once('exit', resolve)));
      ctx.host.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      ctx.stopHost();
      process.off('exit', ctx.stopHost);
    }
    removeTmp();
  });

  it('answers the app only on its own host: a stray name under the content domain is 421, with no cookie', T, async () => {
    const port = new URL(ctx.app).port;
    const listener = `http://127.0.0.1:${port}`;
    const OWNER = /#key=(\S+)$/.exec(ctx.signIn)[1];
    assert.equal((await requestWithHost(`${listener}/auth/sign-in`, `localhost:${port}`)).status, 200, 'the app host');
    for (const host of [`login.content.localhost:${port}`, `content.localhost:${port}`, `127.0.0.1:${port}`, `localhost.:${port}`]) {
      for (const route of ['/', '/auth/sign-in', '/api/open-artifact.auth.me', '/mcp']) {
        const answer = await requestWithHost(`${listener}${route}`, host);
        assert.equal(answer.status, 421, `${host}${route}`);
        assert.equal(answer.headers['set-cookie'], undefined, `${host}${route}`);
        assert.equal(answer.headers.location, undefined, `${host}${route}`);
      }
      const form = new URLSearchParams({ key: OWNER, return_to: '/' }).toString();
      const signIn = await requestWithHost(`${listener}/auth/owner-key`, host, { method: 'POST', headers: { origin: `http://${host}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' }, body: form });
      assert.equal(signIn.status, 421, `${host}: the owner-key POST`);
      assert.equal(signIn.headers['set-cookie'], undefined);
    }
    // A malformed Host is a 400, not a 500; the health check answers on any name; a well-formed name of an artifact
    // that does not exist is a content host (not 421): its page session is 404.
    assert.equal((await requestWithHost(`${listener}/`, `www.127.0.0.1:${port}`)).status, 400);
    assert.equal((await requestWithHost(`${listener}/__open-artifact/health`, `login.content.localhost:${port}`)).status, 200);
    assert.equal((await requestWithHost(`${listener}/_api/session`, `art-0000000000000000.content.localhost:${port}`)).status, 404);
  });

  it('the owner signs in, shares by link, a guest joins as a commenter, and a reset puts the guest out', T, async () => {
    const { owner, guest, app, id } = ctx;

    // 1. The printed address: the page's script fills the key from the fragment and takes the fragment away.
    const page = await owner.load(ctx.signIn, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    assert.equal(await page.evaluate('location.hash'), '');
    assert.equal(await page.evaluate("document.querySelector('meta[name=referrer]').content"), 'same-origin');

    // 2. Submit the form as a person does. (A `no-referrer` page made Chromium post `Origin: null`, refused as cross-site.)
    await clickOn(page, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await page.waitFor(`location.href === ${JSON.stringify(`${app}/`)} && document.body.innerText.includes(${JSON.stringify(TITLE)})`, 20000), `the home page does not list the artifact: ${await page.evaluate('location.href + "\\n" + document.body.innerText.slice(0, 500)')}`);

    // 3. Open it from the home page: the Shell frames the page on the artifact's content origin.
    await clickOn(page, `[...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/a/${id}')`, 'the artifact on the home page');
    assert.ok(await page.waitFor(`location.pathname === '/a/${id}'`, 15000));
    assert.ok(await page.waitFor("location.hostname.endsWith('.content.localhost') && document.getElementById('root')?.childElementCount > 0", 30000), 'the framed page did not draw');
    const frames = await page.evaluateAll('location.origin');
    assert.ok(frames.includes(`http://${id.replace('_', '-')}.content.localhost:${new URL(app).port}`), frames.join(', '));
    const ownerCan = await abilities(page);
    assert.equal(ownerCan?.role, 'owner', JSON.stringify(ownerCan));

    // 4. Share: general access "Anyone with the link"; the commenter link is on at once (decision 23).
    await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
    await clickOn(page, "document.querySelector('[aria-label=\"General access\"]')", 'General access');
    await clickOn(page, byText('Anyone with the link'), 'Anyone with the link');
    assert.ok(await page.waitFor("document.querySelector('[data-share-link=commenter]')?.title.includes('/s/')", 15000), 'the commenter link shows no address');
    const link = await page.evaluate("document.querySelector('[data-share-link=commenter]').title");
    assert.match(link, new RegExp(`^${app}/s/[A-Za-z0-9_-]{16,64}$`));
    assert.ok(!(await page.evaluate("document.querySelector('[data-share-link=commenter]').innerText")).includes('nobody can join'));

    // 5. A browser with nothing in it opens the link, types a name and joins.
    const join = await guest.load(link, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    assert.ok((await join.evaluate('document.body.innerText')).includes(TITLE));
    await clickOn(join, "document.querySelector('input[name=name]')", 'the name field');
    await join.type('Gus the guest');
    await clickOn(join, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await join.waitFor(`location.pathname === '/a/${id}'`, 20000), `the join did not open the artifact: ${await join.evaluate('location.href + "\\n" + document.body.innerText.slice(0, 300)')}`);
    assert.ok(await join.waitFor("location.hostname.endsWith('.content.localhost') && document.getElementById('root')?.childElementCount > 0", 30000), "the guest's framed page did not draw");
    const guestCan = await abilities(join);
    assert.deepEqual(guestCan, { role: 'commenter', comment: 200, edit: 403 });

    // 6. The owner resets the commenter link (⋯ → Reset link → confirm).
    await clickOn(page, "document.querySelector('[data-share-link=commenter] button[aria-label^=\"More\"]')", "the commenter link's menu");
    await clickOn(page, byText('Reset link'), 'Reset link');
    await sleep(300);
    await clickOn(page, byText('Reset link', "(document.querySelector('[role=alertdialog],[role=dialog]:last-of-type') ?? document)"), 'the confirmation');
    assert.ok(await page.waitFor(`document.querySelector('[data-share-link=commenter]')?.title && document.querySelector('[data-share-link=commenter]').title !== ${JSON.stringify(link)}`, 15000), 'the commenter link did not change');

    // 7. The guest's page loses access, and the old address does not work any more.
    let latest;
    const lost = await until(async () => {
      latest = await abilities(join).catch(() => undefined);
      return latest === undefined || latest.role !== 'commenter';
    }, 15000);
    assert.ok(lost, `the guest kept access after the reset: ${JSON.stringify(latest)}`);
    if (latest) assert.equal(latest.edit === 200 || latest.comment === 200, false, JSON.stringify(latest));
    const again = await guest.load(link, { ignore: [...IGNORE, /HTTP 404/] });
    assert.ok((await again.evaluate('document.body.innerText')).includes('This link does not work'));

    for (const p of [page, join]) {
      assert.deepEqual(
        p.problems.filter(x => !/HTTP 40[13]: .*\/_?api\//.test(x) && !/frame_denied|not_granted|no longer|lost access/i.test(x)),
        [],
      );
    }
  });

  it('a linked daemon publishes a local folder; a comment sent on the cloud page reaches the agent, a local write shows on it', T, async () => {
    const { owner, app } = ctx;
    // The agent's computer: its own Open Artifact home and port, no browser opening, no idle exit, and no periodic
    // rescan of published folders (so a push below can only come from the folder watcher).
    const home = tmpDir('daemon-home');
    const workspace = tmpDir('agent');
    const daemonPort = await freePort();
    const env = { ...process.env, OPEN_ARTIFACT_HOME: home, OPEN_ARTIFACT_BROWSER: 'none', OPEN_ARTIFACT_IDLE_MS: '0', OPEN_ARTIFACT_LINK_RESCAN_MS: '0', OPEN_ARTIFACT_HARNESS: 'cli', OPEN_ARTIFACT_SESSION: 'e2e-agent' };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR']) delete env[name];
    ctx.daemonLog = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(daemonPort)], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (ctx.daemonLog += chunk));
    ctx.daemon.stderr.on('data', chunk => (ctx.daemonLog += chunk));
    assert.ok(await until(() => fs.existsSync(path.join(home, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.daemonLog}`);
    const cli = (args, onStderr) =>
      new Promise(resolve => {
        const child = spawn(process.execPath, [CLI, ...args], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => (stdout += chunk));
        child.stderr.on('data', chunk => {
          stderr += chunk;
          onStderr?.(stderr);
        });
        const timer = setTimeout(() => child.kill(), 90000);
        child.on('close', code => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });

    // 1. remote add: the CLI prints the approval address; the owner opens it in Chrome and presses Approve.
    let approval = null;
    const linking = cli(['remote', 'add', 'cloud', app], text => {
      approval ??= /^Open(?:ed)? (\S+) in (?:your|a) browser/m.exec(text)?.[1] ?? null;
    });
    assert.ok(await until(() => approval, 20000), 'remote add printed no address');
    assert.match(approval, new RegExp(`^${app}/link/device\\?`));
    const approve = await owner.load(approval, { ready: "document.querySelector('button[name=decision][value=approve]')", ignore: IGNORE });
    await clickOn(approve, "document.querySelector('button[name=decision][value=approve]')", 'Approve');
    const linked = await linking;
    assert.equal(linked.code, 0, linked.stderr);
    assert.match(linked.stdout, /^Linked cloud \(http:\/\/localhost:\d+\) as /);
    await approve.close();

    // 2. A local whiteboard folder (the sample, renamed), made an artifact and published from its folder.
    const folder = path.join(workspace, 'linked-board');
    fs.cpSync(SAMPLE, folder, { recursive: true, filter: src => !/[\\/](_agent|history)([\\/]|$)/.test(src.slice(SAMPLE.length)) });
    const meta = path.join(folder, 'db', 'board', 'meta.json');
    fs.writeFileSync(meta, JSON.stringify({ ...JSON.parse(fs.readFileSync(meta, 'utf8')), title: 'Linked board' }));
    const adopted = await cli(['artifact', JSON.stringify({ action: 'adopt', folder, type_url: 'open-artifact://type/whiteboard' })]);
    assert.equal(adopted.code, 0, adopted.stdout + adopted.stderr);
    const id = /art_[0-9a-z]+/.exec(JSON.parse(adopted.stdout).url)?.[0];
    assert.ok(id, adopted.stdout);
    const published = await cli(['publish', folder]);
    assert.equal(published.code, 0, published.stderr);
    assert.equal(published.stdout.trim(), `Published to cloud: ${app}/a/${id}`);

    // 3. The cloud page, in the owner's Chrome.
    const page = await owner.load(`${app}/a/${id}`, { ready: "location.hostname.endsWith('.content.localhost') && document.getElementById('root')?.childElementCount > 0", ignore: IGNORE });
    assert.ok(await page.waitFor("location.hostname.endsWith('.content.localhost') && document.querySelector('#wb-e1')", 30000), 'the cloud page did not draw the board');

    // 4. Comment with "Send to <agent>" on: the comment reaches the agent's session.
    await clickOn(page, "document.querySelector('header [data-comments-button] button[aria-label=\"Comments\"]')", 'Comments');
    // The Shell's Comments button puts the framed board in comment mode (the board places comments itself).
    assert.ok(await page.waitFor("document.querySelector('header [data-comments-button] button[aria-pressed=true]')", 15000), 'no comment mode');
    const center = await page.evaluate(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await page.click(...center);
    assert.ok(await page.waitFor(COMPOSER_TEXTAREA, 15000), 'no comment composer');
    await page.type('Make the title bigger, please');
    // The box starts off; on, the comment is sent to the agent as it is posted.
    assert.equal(await inFrameLayer(page, `(${SEND_BOX})?.getAttribute('aria-checked')`), 'false');
    await clickInFrame(page, SEND_BOX, 'Send to Open Artifact daemon');
    assert.equal(await inFrameLayer(page, `(${SEND_BOX})?.getAttribute('aria-checked')`), 'true');
    await clickInFrame(page, "layer.querySelector('[data-comment-card] button[data-cds-part=send]:not(:disabled)')", 'Send');
    const waited = await cli(['wait', '--timeout', '30000']);
    assert.equal(waited.code, 0, waited.stdout + waited.stderr);
    assert.match(waited.stdout, /Make the title bigger, please/);
    assert.match(waited.stdout, new RegExp(`open-artifact://artifact/${id}`));

    // 5. A file written in the local folder shows on the open cloud page (pushed by the daemon, seen by the host's
    // type server as an outside change, sent to the page over its event stream): no reload.
    const before = await inFrameLayer(page, 'performance.timeOrigin');
    assert.ok(before);
    fs.writeFileSync(path.join(folder, 'db', 'elements', 'e2e-live.json'), JSON.stringify({ type: 'note', x: 40, y: 40, w: 220, h: 120, text: 'Written on the computer', color: 'yellow' }));
    fs.writeFileSync(meta, JSON.stringify({ ...JSON.parse(fs.readFileSync(meta, 'utf8')), order: [...JSON.parse(fs.readFileSync(meta, 'utf8')).order, 'e2e-live'] }));
    assert.ok(
      await page.waitFor("document.querySelector('#wb-e2e-live')?.innerText.includes('Written on the computer')", 30000),
      `the local write did not show on the cloud page\n${ctx.daemonLog.slice(-1500)}`,
    );
    assert.equal(await inFrameLayer(page, 'performance.timeOrigin'), before, 'the framed page reloaded');
    assert.deepEqual(page.problems, []);
    await page.close();
  });
});
