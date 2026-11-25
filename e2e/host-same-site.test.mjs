// End-to-end test of the cloud host's same-site mode (`OA_CONTENT_SAME_SITE=true`) in Chrome: one domain for both
// origins. The app is on `http://app.oa.localhost:<port>` and each artifact on `http://{id}.oa.localhost:<port>`, so
// the two are one site (`oa.localhost`), as on a LAN with one name or a zone with one domain. Chrome resolves every
// `*.localhost` name itself.
//
// The normal story first: the owner signs in with the owner key, opens a whiteboard from the home page, shares it by
// link, and a second Chrome joins as a commenter guest.
//
// Then a hostile artifact: a Design whose artboard logic (agent-written code, which runs in the artboard's frame on the
// artifact's content origin, the same site as the app) attacks Carol, a signed-in member who opens it (a viewer of it,
// an editor of another board):
//
// - a `fetch` POST with credentials (no-cors, and a CORS one) to rename and delete another artifact: refused, nothing
//   changes (Sec-Fetch-Site is same-site, and the app takes writes from its own origin only);
// - a form POST built in its parent document, to sign the owner out: refused, the owner stays signed in;
// - an `<img>` of a share link of someone else's artifact: no join (only a top-level visit joins);
// - reading the app's JSON with `fetch` and with `<script src>`: no CORS answer, and CORP blocks the script;
// - a raw `project/*.html` file runs in an opaque origin (`null`): no cookies, no same-site anything;
// - tossing an `oa_session` cookie on the parent domain: the owner's next request to the app carries two, which the app
//   refuses (signed out, both sessions ended, both cookies deleted, an `auth.duplicate_cookie` audit entry).
//
// What the review in docs/hosting.md ("One domain for both") says remains is checked too: a browser that is signed out
// takes a tossed session cookie as its own (here put in with DevTools, as a page on the parent domain could set it).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { clickOn, byText } from './lib/host-page.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 240000 };
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'whiteboard', 'elements');
const DESIGN = path.join(repoRoot, 'e2e', 'fixtures', 'design');
const TITLE = 'Whiteboard element test';
const OWNER_KEY = 'same-site-owner-key-0123456789';
const SIGNING_KEY = 'q'.repeat(48);
/** Problems every page here may have: no favicon on the host. */
const IGNORE = [/favicon\.ico/];

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/server/editors/whiteboard/index.html', 'dist/server/editors/design/index.html', 'dist/server/support.js'];
  const missing = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return missing.length ? `the host's pages are not built (npm run build): no ${missing.join(', ')}` : false;
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

/** True in a framed editor page on a content host (not the app host). */
const FRAMED = "location.hostname.endsWith('.oa.localhost') && !location.hostname.startsWith('app.') && /\\/[a-z-]+\\/v1\\.[^/]+\\/$/.test(location.pathname)";
const inFrame = (page, body) => page.evaluateAll(`${FRAMED} ? (${body})(location.origin + location.pathname) : undefined`).then(values => values.find(v => v !== undefined));
const role = page => inFrame(page, "async (base) => { const r = await fetch(base + '_api/session'); return r.ok ? (await r.json()).viewer.role : 'refused ' + r.status; }");

/**
 * The hostile artboard's logic. It runs in the artboard's frame (sandbox `allow-scripts allow-same-origin`, so on the
 * artifact's content origin) and keeps what happened in `window.__oaHostile`; `window.__oaToss()` tosses the cookie.
 */
const hostileLogic = ({ app, victim, bait }) => `
const OA_APP = ${JSON.stringify(app)};
async function oaAttack() {
  const r = { origin: self.origin };
  try {
    await fetch(OA_APP + '/api/open-artifact.artifacts.update', { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ id: ${JSON.stringify(victim)}, title: 'Renamed by a hostile page' }) });
    r.noCorsPost = 'sent';
  } catch (e) { r.noCorsPost = 'threw ' + e.message; }
  try {
    const res = await fetch(OA_APP + '/api/open-artifact.artifacts.delete', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(victim)} }) });
    r.corsPost = 'answered ' + res.status;
  } catch (e) { r.corsPost = 'blocked'; }
  try {
    const d = parent.document;
    const sink = d.createElement('iframe');
    sink.name = 'oa-sink';
    sink.style.display = 'none';
    d.body.append(sink);
    const form = d.createElement('form');
    form.method = 'POST';
    form.action = OA_APP + '/auth/sign-out';
    form.target = 'oa-sink';
    d.body.append(form);
    form.submit();
    r.formPost = 'submitted';
  } catch (e) { r.formPost = 'threw ' + e.message; }
  r.img = await new Promise((done) => { const i = new Image(); i.onload = () => done('loaded'); i.onerror = () => done('error'); i.src = OA_APP + '/s/' + ${JSON.stringify(bait)}; });
  try {
    const res = await fetch(OA_APP + '/api/open-artifact.artifacts', { credentials: 'include' });
    r.readJson = 'read ' + (await res.text()).slice(0, 60);
  } catch (e) { r.readJson = 'blocked'; }
  r.readScript = await new Promise((done) => { const s = document.createElement('script'); s.onload = () => done('loaded'); s.onerror = () => done('error'); s.src = OA_APP + '/api/open-artifact.artifacts'; document.head.append(s); });
  window.__oaHostile = r;
}
window.__oaToss = () => { document.cookie = 'oa_session=tossed-by-an-artifact; domain=oa.localhost; path=/'; return document.cookie; };
class Component extends DCLogic {
  renderVals() {
    if (!window.__oaStarted) { window.__oaStarted = true; oaAttack(); }
    return { accent: this.props.accent ?? '#666666' };
  }
}
`;

/** The design fixture with the hostile logic and a raw HTML file that reports its own origin to its parent. */
function hostileDesign(folder, values) {
  fs.cpSync(DESIGN, folder, { recursive: true });
  fs.writeFileSync(path.join(folder, '.artifact.json'), JSON.stringify({ type: 'design', title: 'Hostile design', release: null }));
  const main = path.join(folder, 'project', 'Main.dc.html');
  const html = fs.readFileSync(main, 'utf8').replace(/(<script type="text\/x-dc"[^>]*>)[\s\S]*?(<\/script>)/, (_, open, close) => `${open}${hostileLogic(values)}${close}`);
  assert.ok(html.includes('oaAttack'), 'the logic was put in');
  fs.writeFileSync(main, html);
  fs.writeFileSync(path.join(folder, 'project', 'raw.html'), "<!doctype html><script>let c; try { c = document.cookie; } catch (e) { c = 'threw'; } parent.postMessage({ oaRaw: true, origin: self.origin, cookie: c }, '*');</script>");
}

describe('cloud host in same-site mode, in Chrome', { skip: skip() }, () => {
  const ctx = {};

  before(async () => {
    const { parseConfig } = await import('../packages/host/src/core/config.ts');
    const { openCatalog, parseNodeEnv, startHost } = await import('../packages/host/src/node/index.ts');
    const dir = tmpDir('host-same-site');
    const data = path.join(dir, 'data');
    const port = await freePort();
    ctx.port = port;
    ctx.app = `http://app.oa.localhost:${port}`;
    const env = {
      OA_DATA_DIR: data,
      OA_PORT: String(port),
      OA_BIND: '127.0.0.1',
      OA_APP_ORIGIN: ctx.app,
      OA_CONTENT_ORIGIN: `http://{id}.oa.localhost:${port}`,
      OA_CONTENT_SAME_SITE: 'true',
      OA_SIGNING_KEYS: SIGNING_KEY,
      OA_OWNER_KEY: OWNER_KEY,
    };
    const cliEnv = { ...process.env, ...env };
    const importFolder = folder => {
      const imported = spawnSync(process.execPath, [MAIN, 'import', folder], { env: cliEnv, encoding: 'utf8', timeout: 60000 });
      assert.equal(imported.status, 0, `import failed: ${imported.stderr}`);
      const id = /as (art_[0-9a-z]+)/.exec(imported.stdout)?.[1];
      assert.ok(id, imported.stdout);
      return id;
    };

    // The whiteboard the story shares, and the one the hostile page goes after.
    ctx.id = importFolder(SAMPLE);
    ctx.victim = importFolder(SAMPLE);
    const config = parseConfig(env);
    // Bob's artifact, open to anyone with its editor link: the person the page attacks must not be made to join it.
    {
      const { catalog, driver } = await openCatalog(data, config);
      ctx.bob = await catalog.createUser({ name: 'Bob', email: 'bob@example.com', emailVerified: true });
      ctx.bait = await catalog.createArtifact({ type: 'whiteboard', title: 'Bait', ownerUser: ctx.bob.id, generalAccess: 'link' });
      ctx.baitLink = (await catalog.createLink(ctx.bait.id, 'editor')).token;
      ctx.bobSession = (await catalog.createSession({ userId: ctx.bob.id, ttlMs: 3600_000 })).token;
      driver.close();
    }
    const hostile = path.join(dir, 'hostile');
    hostileDesign(hostile, { app: ctx.app, victim: ctx.victim, bait: ctx.baitLink });
    ctx.hostile = importFolder(hostile);
    // Carol, a member (a site admin is owner of every artifact, so would prove nothing): an editor of the victim
    // board, a viewer of the hostile design, nothing on Bob's. Her session is put in her browser as sign-in would.
    {
      const { catalog, driver } = await openCatalog(data, config);
      const ownerId = (await catalog.getArtifact(ctx.victim)).ownerUser;
      ctx.carol = await catalog.createUser({ name: 'Carol', email: 'carol@example.com', emailVerified: true });
      await catalog.upsertGrant({ artifactId: ctx.victim, subjectKind: 'user', subject: ctx.carol.id, role: 'editor', createdBy: ownerId });
      await catalog.upsertGrant({ artifactId: ctx.hostile, subjectKind: 'user', subject: ctx.carol.id, role: 'viewer', createdBy: ownerId });
      ctx.carolSession = (await catalog.createSession({ userId: ctx.carol.id, ttlMs: 3600_000 })).token;
      driver.close();
    }

    ctx.log = [];
    ctx.host = await startHost({ config, env: parseNodeEnv(env), uiDir: path.join(repoRoot, 'dist', 'daemon'), log: line => ctx.log.push(line) });
    ctx.catalog = ctx.host.catalog;
    // What reached the host, with the answer it gave: proof that a refused attempt was sent, not stopped by Chrome.
    ctx.seen = [];
    ctx.host.server.on('request', (req, res) => {
      res.on('finish', () => ctx.seen.push({ method: req.method, host: req.headers.host, url: req.url, site: req.headers['sec-fetch-site'] ?? null, dest: req.headers['sec-fetch-dest'] ?? null, status: res.statusCode }));
    });
    ctx.owner = await launch();
    ctx.guest = await launch();
    ctx.member = await launch();
  });

  after(async () => {
    await ctx.owner?.close();
    await ctx.guest?.close();
    await ctx.member?.close();
    await ctx.host?.stop();
    removeTmp();
  });

  it('the normal story: the owner signs in, opens and shares; a guest joins as a commenter', T, async () => {
    const { owner, guest, app, id } = ctx;
    const page = await owner.load(`${app}/auth/sign-in#key=${OWNER_KEY}`, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    await clickOn(page, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await page.waitFor(`location.href === ${JSON.stringify(`${app}/`)} && document.body.innerText.includes(${JSON.stringify(TITLE)})`, 20000), `the home page does not list the artifact: ${await page.evaluate('location.href')}`);

    await clickOn(page, `[...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/a/${id}')`, 'the artifact on the home page');
    assert.ok(await page.waitFor(`location.pathname === '/a/${id}'`, 15000));
    assert.ok(await page.waitFor(`${FRAMED} && document.getElementById('root')?.childElementCount > 0`, 30000), 'the framed page did not draw');
    const frames = await page.evaluateAll('location.origin');
    assert.ok(frames.includes(`http://${id.replace('_', '-')}.oa.localhost:${ctx.port}`), frames.join(', '));
    assert.equal(await role(page), 'owner');
    // Both origins ask for an origin-keyed agent cluster; the Shell's own window is closed to openers.
    assert.equal(await page.evaluate('window.originAgentCluster'), true);
    assert.ok((await page.evaluateAll(`${FRAMED} ? window.originAgentCluster : undefined`)).includes(true));

    await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
    await clickOn(page, "document.querySelector('[aria-label=\"General access\"]')", 'General access');
    await clickOn(page, byText('Anyone with the link'), 'Anyone with the link');
    assert.ok(await page.waitFor("document.querySelector('[data-share-link=commenter]')?.title.includes('/s/')", 15000), 'the commenter link shows no address');
    const link = await page.evaluate("document.querySelector('[data-share-link=commenter]').title");
    assert.match(link, new RegExp(`^${app}/s/[A-Za-z0-9_-]{16,64}$`));

    const join = await guest.load(link, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    await clickOn(join, "document.querySelector('input[name=name]')", 'the name field');
    await join.type('Gus the guest');
    await clickOn(join, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await join.waitFor(`location.pathname === '/a/${id}'`, 20000), `the join did not open the artifact: ${await join.evaluate('location.href')}`);
    assert.ok(await join.waitFor(`${FRAMED} && document.getElementById('root')?.childElementCount > 0`, 30000), "the guest's framed page did not draw");
    assert.equal(await role(join), 'commenter');
    // The guest cookie is the app host's own (no Domain), so no sibling host sees it.
    const { cookies } = await join.cdp('Network.getCookies', { urls: [app] });
    const guestCookie = cookies.find(c => c.name.startsWith('oa_guest_'));
    assert.ok(guestCookie, cookies.map(c => c.name).join(', '));
    assert.equal(guestCookie.domain, 'app.oa.localhost');
    assert.equal(guestCookie.httpOnly, true);
    ctx.page = page;
  });

  it('a hostile artifact page cannot act as the person viewing it, read the app, or make them join; its cookie toss is refused', T, async () => {
    const { member, app, catalog } = ctx;
    // Carol signed in: her host-only session cookie, as the sign-in answer sets it.
    const start = await member.load(`${app}/auth/sign-in`, { ignore: IGNORE });
    await start.cdp('Network.setCookie', { name: 'oa_session', value: ctx.carolSession, url: app, path: '/', httpOnly: true, sameSite: 'Lax' });
    await start.close();
    const session = ctx.carolSession;
    const signedIn = await member.load(`${app}/api/open-artifact.auth.me`, { ignore: IGNORE });
    assert.equal(JSON.parse(await signedIn.evaluate('document.body.innerText')).principal.name, 'Carol');
    await signedIn.close();
    // Open the hostile design: its artboard logic runs on load.
    const page = await member.load(`${app}/a/${ctx.hostile}`, { ignore: [/.*/] });
    assert.ok(await page.waitFor('window.__oaHostile', 45000), `the artboard logic did not run: ${(await page.evaluateAll('location.href')).join(', ')}`);
    const results = (await page.evaluateAll('window.__oaHostile')).find(Boolean);
    const content = `http://${ctx.hostile.replace('_', '-')}.oa.localhost:${ctx.port}`;
    // It really ran on the artifact's content origin, the same site as the app.
    assert.equal(results.origin, content, JSON.stringify(results));
    // The no-cors POST is sent with Carol's cookie; its opaque answer is then withheld by CORP (a network error).
    assert.equal(results.noCorsPost, 'threw Failed to fetch', JSON.stringify(results));
    assert.equal(results.corsPost, 'blocked', JSON.stringify(results));
    assert.equal(results.formPost, 'submitted', JSON.stringify(results));
    assert.equal(results.img, 'error', 'the join link answered a page, not an image');
    assert.equal(results.readJson, 'blocked', JSON.stringify(results));
    assert.equal(results.readScript, 'error', 'CORP (and the JSON type) keep the answer from the page');
    await sleep(1500);
    // Each attempt reached the host, from the same site, and was refused (the join link answered its "ask" page).
    const app_ = new URL(app).host;
    const reached = (method, pathPrefix) => ctx.seen.filter(r => r.host === app_ && r.method === method && r.url.startsWith(pathPrefix));
    for (const [method, pathPrefix, status] of [['POST', '/api/open-artifact.artifacts.update', 403], ['POST', '/auth/sign-out', 403], ['GET', `/s/${ctx.baitLink}`, 200]]) {
      const seen = reached(method, pathPrefix);
      assert.ok(seen.length > 0, `${method} ${pathPrefix} never reached the host`);
      assert.ok(seen.every(r => r.site === 'same-site' && r.status === status), JSON.stringify(seen));
    }
    assert.equal(reached('POST', '/api/open-artifact.artifacts.delete').length, 0, 'the CORS POST stopped at its preflight');

    // Nothing happened on the app's side.
    const victim = await catalog.getArtifact(ctx.victim);
    assert.equal(victim.title, TITLE, 'the no-cors POST renamed nothing');
    assert.equal(victim.trashedAt, null, 'the CORS POST deleted nothing');
    assert.ok(await catalog.findSession(session), 'the form POST did not sign Carol out');
    assert.deepEqual(await catalog.listUserGuests(ctx.carol.id, ctx.bait.id), [], 'the <img> did not join Bob\'s artifact');
    assert.equal((await catalog.listAudit()).filter(e => e.action === 'share.join' && e.artifactId === ctx.bait.id).length, 0);
    // The control: the same rename, made by Carol (an editor) from the app's own page, goes through.
    const home = await member.load(`${app}/`, { ignore: IGNORE });
    const control = await home.evaluate(`fetch('/api/open-artifact.artifacts.update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(ctx.victim)}, title: 'Renamed by Carol' }) }).then(r => r.status)`);
    assert.equal(control, 200);
    assert.equal((await catalog.getArtifact(ctx.victim)).title, 'Renamed by Carol');
    await home.close();

    // A raw project file runs in an opaque origin: not the content origin, no cookies.
    const raw = await inFrame(
      page,
      `(base) => new Promise((done) => {
        const frame = document.createElement('iframe');
        addEventListener('message', (e) => { if (e.data && e.data.oaRaw) done(e.data); });
        frame.src = base + 'project/raw.html';
        document.body.append(frame);
        setTimeout(() => done({ timeout: true }), 10000);
      })`,
    );
    assert.deepEqual(raw, { oaRaw: true, origin: 'null', cookie: 'threw' });

    // The toss: an oa_session on the parent domain, beside Carol's host-only one.
    const tossed = (await page.evaluateAll('typeof window.__oaToss === "function" ? window.__oaToss() : undefined')).find(v => v !== undefined);
    assert.ok(tossed?.includes('oa_session=tossed-by-an-artifact'), `Chrome did not keep the tossed cookie: ${tossed}`);
    const { cookies: before } = await page.cdp('Network.getCookies', { urls: [app] });
    assert.deepEqual(before.filter(c => c.name === 'oa_session').map(c => c.domain).sort(), ['.oa.localhost', 'app.oa.localhost']);
    await page.close();

    // Carol's next visit carries both: refused, signed out, both deleted, written down.
    const next = await member.load(`${app}/`, { ignore: IGNORE });
    assert.ok(await next.waitFor("location.pathname === '/auth/sign-in'", 15000), `not sent to sign in: ${await next.evaluate('location.href')}`);
    assert.equal(await catalog.findSession(session), undefined, "Carol's session was ended");
    const { cookies: afterwards } = await next.cdp('Network.getCookies', { urls: [app] });
    assert.deepEqual(afterwards.filter(c => c.name === 'oa_session'), [], 'both copies were deleted');
    const audit = (await catalog.listAudit()).find(e => e.action === 'auth.duplicate_cookie');
    assert.ok(audit, 'an audit entry');
    assert.deepEqual(audit.detail.names, ['oa_session']);
    assert.ok(ctx.log.some(line => line.includes('refused duplicate cookies (oa_session)')), ctx.log.slice(-5).join('\n'));
    await next.close();
  });

  it('what remains: a signed-out browser takes a tossed session cookie as its own', T, async () => {
    const { guest, app } = ctx;
    const fresh = await guest.load(`${app}/auth/sign-in`, { ignore: IGNORE });
    await fresh.cdp('Network.clearBrowserCookies');
    // As a page on any host of oa.localhost could set it with `Domain=oa.localhost` while nobody is signed in here.
    await fresh.cdp('Network.setCookie', { name: 'oa_session', value: ctx.bobSession, domain: '.oa.localhost', path: '/', httpOnly: false });
    const me = await guest.load(`${app}/api/open-artifact.auth.me`, { ignore: IGNORE });
    const answer = JSON.parse(await me.evaluate('document.body.innerText'));
    assert.equal(answer.principal.kind, 'user');
    assert.equal(answer.principal.name, 'Bob', 'the browser is in the tosser\'s account: the residual risk the docs name');
    await me.close();
    await fresh.close();
  });
});
