// End-to-end test of host plugins on the real Node host (`packages/host`), behind a test proxy, the way a company runs
// it: the proxy signs people in (the `header-auth` example: it adds `x-forwarded-email` and a shared secret), the
// `static-groups` example makes a group editors of one person's artifacts, and a ten-line guard
// (`e2e/fixtures/host-plugins/no-export.mjs`) refuses archive downloads and brands the site.
//
// Over HTTP (always, E2E_BROWSER=0 too): the host started from `OA_PLUGINS` lists the three plugins in its admin API; a
// person who comes through the proxy is signed in; the same headers sent to the host directly, without the proxy's
// secret, sign nobody in; the session holds only while the proxy says the same person (another person replaces it, no
// one ends it: the next page is the sign-in page); the group member's role is editor; the archive is refused with the
// guard's sentence.
//
// In Chrome: the owner's home page shows the brand, the home link and, in the account menu, the plugin's link; the group
// member's home page lists the owner's artifact with Rename (an editor's); and "Whole folder (.zip)" in the Shell's
// Export tab says the guard's sentence instead of downloading.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { freePort, zipFolder } from './lib/cloudflare.mjs';
import { requestWithHost, until } from './lib/http.mjs';
import { startSignInProxy } from './lib/proxy.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 180000 };
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const EXAMPLES = path.join(repoRoot, 'examples', 'host-plugins');
const GUARD = path.join(repoRoot, 'e2e', 'fixtures', 'host-plugins', 'no-export.mjs');
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'whiteboard', 'elements');
const SECRET = randomBytes(24).toString('hex');
const REFUSAL = 'Downloads are turned off on this site; ask an administrator.';
const OWNER = 'ann@corp.example';
const MEMBER = 'bob@corp.example';
const DRAWN = "location.hostname.endsWith('.content.localhost') && document.getElementById('root')?.childElementCount > 0";
const IGNORE = [/favicon\.ico/, /HTTP 403/, /status of 403/];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function browserSkip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/server/editors/whiteboard/index.html', 'dist/server/support.js'];
  const missing = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return missing.length ? `the host's pages are not built (npm run build): no ${missing.join(', ')}` : false;
}

describe('host plugins on the Node host, behind a proxy', () => {
  const ctx = {};
  /** A request through the proxy as `email` (null: nobody), with that person's host session once they have one. */
  const as = async (email, route, init = {}) => {
    const cookies = [email ? `e2e_who=${encodeURIComponent(email)}` : '', email && ctx.sessions[email] ? ctx.sessions[email] : ''].filter(Boolean).join('; ');
    const write = init.method && init.method !== 'GET';
    return fetch(`${ctx.app}${route}`, { ...init, redirect: 'manual', headers: { ...(cookies ? { cookie: cookies } : {}), ...(write ? { origin: ctx.app } : {}), ...(init.headers ?? {}) } });
  };
  const signIn = async email => {
    const me = await as(email, '/api/open-artifact.auth.me');
    assert.equal(me.status, 200);
    const session = (me.headers.getSetCookie?.() ?? []).map(line => line.split(';')[0]).find(pair => pair.startsWith('oa_session='));
    const body = await me.json();
    if (session) ctx.sessions[email] = session;
    return body;
  };

  before(async () => {
    const dir = tmpDir('host-plugins');
    const hostPort = await freePort();
    const port = await freePort();
    ctx.hostPort = hostPort;
    ctx.app = `http://localhost:${port}`;
    ctx.sessions = {};
    const list = [
      { use: path.join(EXAMPLES, 'header-auth.mjs'), config: { secret: { env: 'PROXY_SECRET' } } },
      { use: path.join(EXAMPLES, 'static-groups.mjs'), config: { groups: { design: MEMBER }, roles: { design: `editor:${OWNER}` } } },
      { use: GUARD },
    ];
    ctx.env = {
      ...process.env,
      OA_DATA_DIR: path.join(dir, 'data'),
      OA_PORT: String(hostPort),
      OA_BIND: '127.0.0.1',
      OA_APP_ORIGIN: ctx.app,
      OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`,
      OA_SIGNUP: 'open',
      OA_OWNERS: OWNER,
      OA_PLUGINS: JSON.stringify(list),
      PROXY_SECRET: SECRET,
    };
    delete ctx.env.OA_OWNER_KEY;
    delete ctx.env.OA_SIGNING_KEYS;
    delete ctx.env.OA_PLUGINS_FILE;
    ctx.log = '';
    ctx.host = spawn(process.execPath, [MAIN, 'serve'], { env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.host.stdout.on('data', chunk => (ctx.log += chunk));
    ctx.host.stderr.on('data', chunk => (ctx.log += chunk));
    ctx.stopHost = () => ctx.host.exitCode === null && ctx.host.kill('SIGKILL');
    process.on('exit', ctx.stopHost);
    await until(() => /plugins: /.test(ctx.log) || ctx.host.exitCode !== null, 30000);
    assert.equal(ctx.host.exitCode, null, `the host did not start:\n${ctx.log}`);
    ctx.proxy = await startSignInProxy(port, hostPort, SECRET);
    console.log(`# host-plugins: ${/plugins: .*/.exec(ctx.log)?.[0]}`);

    // The owner's artifact, uploaded with the session the proxy's sign-in gave.
    await signIn(OWNER);
    const zip = await zipFolder(SAMPLE);
    const made = await as(OWNER, '/api/open-artifact.artifacts.import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip });
    assert.equal(made.status, 201, await made.clone().text());
    ctx.artifact = await made.json();
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

  it('the proxy signs people in; the same headers without its secret sign nobody in', T, async () => {
    const me = await signIn(MEMBER);
    assert.equal(me.principal.kind, 'user');
    assert.equal(me.principal.email, MEMBER);
    assert.deepEqual(me.site, { links: [{ label: 'Help desk', href: 'https://help.example.com/', where: 'account-menu' }, { label: 'Site policy', href: 'https://policy.example.com/', where: 'home' }], brand: { name: 'Acme Artifacts' } });
    // Straight to the host (under the app's name: fetch would send the listener's, which is not the site's), with the
    // email header but not the secret: nobody.
    const direct = await requestWithHost(`http://127.0.0.1:${ctx.hostPort}/api/open-artifact.auth.me`, new URL(ctx.app).host, { headers: { 'x-forwarded-email': 'ceo@corp.example' } });
    assert.equal(direct.status, 200, direct.body);
    assert.equal(JSON.parse(direct.body).principal.kind, 'anonymous');
    assert.equal(direct.headers['set-cookie'], undefined);
    // A guess at the secret: nobody either.
    const guessed = await requestWithHost(`http://127.0.0.1:${ctx.hostPort}/api/open-artifact.auth.me`, new URL(ctx.app).host, { headers: { 'x-forwarded-email': 'ceo@corp.example', 'x-proxy-secret': 'guess' } });
    assert.equal(JSON.parse(guessed.body).principal.kind, 'anonymous');
  });

  it('the session lasts only while the proxy says the same person: another person gets their own page, none the sign-in page', T, async () => {
    await signIn(MEMBER);
    const memberSession = ctx.sessions[MEMBER];
    const page = { accept: 'text/html', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
    // The proxy now sends the owner with the member's session cookie (someone else at this browser): the owner's.
    const other = await fetch(`${ctx.app}/api/open-artifact.auth.me`, { headers: { cookie: `e2e_who=${encodeURIComponent(OWNER)}; ${memberSession}` } });
    assert.equal((await other.json()).principal.email, OWNER);
    // The member signs in again; then the proxy stops sending anyone (signed out upstream): the next page is the
    // sign-in page, and the session cookie is cleared.
    await signIn(MEMBER);
    const gone = await fetch(`${ctx.app}/`, { redirect: 'manual', headers: { ...page, cookie: ctx.sessions[MEMBER] } });
    assert.equal(gone.status, 303);
    assert.match(gone.headers.get('location') ?? '', /^\/auth\/sign-in/);
    const me = await fetch(`${ctx.app}/api/open-artifact.auth.me`, { headers: { cookie: ctx.sessions[MEMBER] } });
    assert.equal((await me.json()).principal.kind, 'anonymous');
    // Back through the proxy: signed in again (a new session).
    assert.equal((await signIn(MEMBER)).principal.email, MEMBER);
  });

  it('the admin API lists the three plugins for the owner (a site admin), settings by name only', T, async () => {
    const answer = await as(OWNER, '/api/open-artifact.admin.plugins');
    assert.equal(answer.status, 200);
    const text = await answer.text();
    assert.ok(!text.includes(SECRET), 'no secret value in the list');
    assert.deepEqual(JSON.parse(text).plugins.map(p => [p.id, p.enabled]), [['header-auth', true], ['static-groups', true], ['no-export', true]]);
    assert.equal((await as(MEMBER, '/api/open-artifact.admin.plugins')).status, 403);
  });

  it("the group member is an editor of the owner's artifact; the archive is refused with the guard's sentence", T, async () => {
    const view = await as(MEMBER, `/api/open-artifact.artifact?id=${ctx.artifact.id}`);
    assert.equal(view.status, 200);
    assert.equal((await view.json()).role, 'editor');
    const archive = await as(OWNER, `/api/open-artifact.artifact.archive?id=${ctx.artifact.id}`);
    assert.equal(archive.status, 403);
    assert.deepEqual(await archive.json(), { code: 'not_granted', message: REFUSAL });
  });

  describe('in Chrome', { skip: browserSkip() }, () => {
    before(async () => {
      ctx.browser = await launch();
      // The member sees the artifact on their home page once it is shared with them (as a viewer: the plugin raises it).
      const shared = await as(OWNER, '/api/open-artifact.artifact.share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ctx.artifact.id, members: { [`email:${MEMBER}`]: 'viewer' } }) });
      assert.equal(shared.status, 200, await shared.clone().text());
    });

    it("shows the site's brand, its home link and its account-menu link", T, async () => {
      const page = await ctx.browser.load(`${ctx.app}/__as/${encodeURIComponent(OWNER)}`, { ready: "!!document.querySelector('[data-site-brand]')", ignore: IGNORE });
      assert.equal(await page.evaluate("document.querySelector('h1').innerText.trim()"), 'Acme Artifacts');
      assert.equal(await page.evaluate('document.title'), 'Acme Artifacts');
      assert.equal(await page.evaluate("document.querySelector('nav[aria-label=\"Site links\"] a')?.href"), 'https://policy.example.com/');
      const avatar = `document.querySelector('button[aria-label^="Account"]')`;
      assert.ok(await page.waitFor(avatar, 15000), 'no account button');
      const at = await page.evaluate(`(() => { const r = ${avatar}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      await page.click(...at);
      assert.ok(await page.waitFor("[...document.querySelectorAll('[role=menuitem]')].some(e => e.textContent.trim() === 'Help desk')", 10000), 'the account menu has no Help desk');
      await page.press('Escape');
      assert.deepEqual(page.problems, []);
      await page.close();
    });

    it("the group member's home page lists the owner's artifact with an editor's Rename", T, async () => {
      const card = `document.querySelector('a[href="/a/${ctx.artifact.id}"]')?.closest('.group')`;
      const page = await ctx.browser.load(`${ctx.app}/__as/${encodeURIComponent(MEMBER)}`, { ready: `!!(${card})`, ignore: IGNORE });
      const role = await page.evaluate(`fetch('/api/open-artifact.artifacts').then(r => r.json()).then(b => b.artifacts.find(a => a.id === ${JSON.stringify(ctx.artifact.id)})?.role)`);
      assert.equal(role, 'editor');
      const menu = `${card}?.querySelector('button[aria-label]')`;
      assert.ok(await page.waitFor(menu, 10000), 'the card has no menu button');
      const at = await page.evaluate(`(() => { const e = ${menu}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      await page.click(...at);
      assert.ok(await page.waitFor("[...document.querySelectorAll('[role=menuitem]')].some(e => e.textContent.trim().startsWith('Rename'))", 10000), "the card's menu has no Rename");
      await page.press('Escape');
      await page.close();
    });

    it('"Whole folder (.zip)" in the Shell says the guard\'s sentence instead of downloading', T, async () => {
      // Through the proxy's sign-in cookie: the owner's own browser session.
      const signedIn = await ctx.browser.load(`${ctx.app}/__as/${encodeURIComponent(OWNER)}`, { ready: "!!document.querySelector('[data-site-brand]')", ignore: IGNORE });
      await signedIn.close();
      const page = await ctx.browser.load(`${ctx.app}/a/${ctx.artifact.id}`, { ready: DRAWN, timeout: 60000, ignore: IGNORE });
      assert.ok(await page.waitFor("!!document.querySelector('header [data-site-brand]')", 10000), 'the top bar shows no brand');
      const row = "[...document.querySelectorAll('[data-export-row]')].find(e => e.dataset.exportRow === 'Whole folder (.zip)' && !e.disabled)";
      const centre = sel => `(() => { const e = ${sel}; if (!e || !e.getClientRects().length) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;
      for (let i = 0; i < 10 && !(await page.evaluate(`!!(${row})`)); i++) {
        const share = await page.evaluate(centre("document.querySelector('header button[aria-label=\"Share\"]')"));
        if (share) await page.click(...share);
        await sleep(400);
        const tab = await page.evaluate(centre("[...document.querySelectorAll('[role=tab],button')].find(e => e.textContent.trim() === 'Export' && e.getClientRects().length)"));
        if (tab) await page.click(...tab);
        if (await page.waitFor(row, 2000)) break;
        await page.press('Escape');
        await sleep(500);
      }
      await sleep(400);
      const at = await page.evaluate(centre(row));
      assert.ok(at, 'no "Whole folder (.zip)" row in the Export tab');
      await page.click(...at);
      const said = `[...document.querySelectorAll('[data-sonner-toast],[role=status],[role=alert],[data-toast],li[aria-live]')].some(e => e.innerText.includes(${JSON.stringify(REFUSAL)}))`;
      assert.ok(await page.waitFor(said, 15000), `the page did not say the guard's sentence: ${await page.evaluate("document.body.innerText.slice(0, 600)")}`);
      await page.close();
    });
  });
});
