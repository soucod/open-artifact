// End-to-end test of a `page` artifact on the product Worker (`packages/host-cloudflare`) under `wrangler dev`, in Chrome:
// the catalog in local D1, the page in its own Durable Object, a real daemon (`open-artifact daemon run`, its own home
// and a free port) linked to it. The same flow as `e2e/host-page.test.mjs` on the Node site, with the synthetic fixture
// e2e/fixtures/page-site/ (db rules, a file beside index.html).
//
// - The agent makes the page with the Artifact tool and publishes it.
// - The owner opens it: the page renders on a page host (`art-<id>--<opaque>.content.localhost`) whose address holds no
//   page token, loads its file, votes, sets the question and replaces a file from the page: all of it reaches the local
//   folder. A db document written in the local folder shows on the open cloud page (pushed, then told to the object's
//   open core).
// - The page host reads files only: no API there, and its opaque part opens nothing of another artifact.
// - The Link says pages run (`hello.features.pages`) and takes a page's capabilities (`link.capabilities`); a change
//   made over remote MCP (OAuth) reaches the computer's `.artifact.json`; an uploaded zip that is a page's marker alone
//   is a page.
// - A second person joins by the viewer share link: their own page host, they vote (the db rules let every level), do
//   not change the question and have no comments. Made a commenter, they have comments and the same page host. Their
//   access removed, their page host reads nothing; the owner's still does.
//
// Skipped (with the reason) when deploy/cloudflare has no node_modules, with E2E_BROWSER=0, without Chrome, or before
// `npm run build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { buildWorkers, freePort, startWrangler, wranglerMissing, zipFolder } from './lib/cloudflare.mjs';
import { clickOn, cookieOf } from './lib/host-page.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 300000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const FIXTURE = path.join(repoRoot, 'e2e', 'fixtures', 'page-site');
const OWNER_KEY = `owner-${randomBytes(12).toString('hex')}`;
const SIGNING_KEY = randomBytes(32).toString('hex');
const REDIRECT = 'http://127.0.0.1:9/callback';
/** In the page's own frame (a page host: `<idlabel>--<24 base32>`). */
const IN_PAGE = "/^art-[0-9a-z]+--[a-z2-7]{24}\\.content\\.localhost$/.test(location.hostname)";
const IGNORE = [/favicon\.ico/, /not_granted|forbidden|not available in this view/i, /HTTP 40[134]/, /Failed to load resource/, /Content Security Policy|Refused to connect/];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function skip() {
  const missing = wranglerMissing();
  if (missing) return missing;
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/daemon/frame-host/client/shell.html', 'dist/daemon/frame-host/client/runtime.js'];
  const absent = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return absent.length ? `not built (npm run build): no ${absent.join(', ')}` : false;
}

/** `expression` in the page's own frame (undefined while there is none). */
const inPage = (page, expression) => page.evaluateAll(`(${IN_PAGE}) ? (${expression}) : undefined`).then(values => values.find(v => v !== undefined && v !== null), () => undefined);
const ready = page => until(async () => (await inPage(page, "document.getElementById('status')?.textContent")) === 'ready', 60000);

/** A plain request to the Worker with a Host header of our choosing (a page host). */
function asHost(port, host, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, headers: { host } }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

describe('cloudflare: a page artifact on the product Worker under wrangler dev, in Chrome', { skip: skip() }, () => {
  const ctx = {};

  before(async () => {
    buildWorkers();
    ctx.state = tmpDir('cloudflare-page');
    ctx.port = await freePort();
    ctx.app = `http://localhost:${ctx.port}`;
    ctx.server = await startWrangler({
      port: ctx.port,
      state: ctx.state,
      vars: { OA_APP_ORIGIN: ctx.app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${ctx.port}`, OA_SIGNING_KEYS: SIGNING_KEY, OA_OWNER_KEY: OWNER_KEY, OA_OAUTH_CLIENTS: JSON.stringify([{ client_id: 'e2e', client_name: 'E2E client', redirect_uris: [REDIRECT] }]) },
      ready: async origin => (await fetch(`${origin}/__open-artifact/health`)).status === 200,
    });
    ctx.owner = await launch();
    ctx.guest = await launch();
  });

  after(async () => {
    await ctx.owner?.close();
    await ctx.guest?.close();
    await stop(ctx.daemon);
    await ctx.server?.stop();
    removeTmp();
  });

  it('publishes a page from a local daemon, runs it for the owner and for a share-link guest, and keeps the folder in step', T, async () => {
    const { owner, guest, app, port } = ctx;
    const wrangler = () => ctx.server.log().slice(-2500);

    // 1. The owner signs in.
    const home = await owner.load(`${app}/auth/sign-in#key=${OWNER_KEY}`, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    await clickOn(home, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await home.waitFor(`location.href === ${JSON.stringify(`${app}/`)}`, 20000), `not signed in: ${await home.evaluate('location.href')}`);

    // 2. The agent's computer, linked: the owner approves the code in Chrome.
    const daemonHome = tmpDir('cf-page-daemon-home');
    const workspace = tmpDir('cf-page-agent');
    const daemonPort = await freePort();
    assert.notEqual(daemonPort, 4800);
    const env = { ...process.env, OPEN_ARTIFACT_HOME: daemonHome, OPEN_ARTIFACT_BROWSER: 'none', OPEN_ARTIFACT_IDLE_MS: '0', OPEN_ARTIFACT_LINK_RESCAN_MS: '0', OPEN_ARTIFACT_LINK_RETRY_MS: '200', OPEN_ARTIFACT_HARNESS: 'cli', OPEN_ARTIFACT_SESSION: 'e2e-cf-page' };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_REMOTE_NAME', 'OPEN_ARTIFACT_PUBLISH', 'OPEN_ARTIFACT_PLUGIN_REMOTE']) delete env[name];
    ctx.daemonLog = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(daemonPort)], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (ctx.daemonLog += chunk));
    ctx.daemon.stderr.on('data', chunk => (ctx.daemonLog += chunk));
    assert.ok(await until(() => fs.existsSync(path.join(daemonHome, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.daemonLog}`);
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
    const artifactTool = async args => {
      const out = await cli(['artifact', JSON.stringify(args)]);
      assert.equal(out.code, 0, out.stdout + out.stderr);
      return JSON.parse(out.stdout);
    };
    let approval = null;
    const linking = cli(['remote', 'add', 'cloud', app], text => {
      approval ??= /^Open(?:ed)? (\S+) in (?:your|a) browser/m.exec(text)?.[1] ?? null;
    });
    assert.ok(await until(() => approval, 20000), 'remote add printed no address');
    const approve = await owner.load(approval, { ready: "document.querySelector('button[name=decision][value=approve]')", ignore: IGNORE });
    await clickOn(approve, "document.querySelector('button[name=decision][value=approve]')", 'Approve');
    const linked = await linking;
    assert.equal(linked.code, 0, linked.stderr);
    await approve.close();

    // 3. The page, from the fixture, with db rules: every level writes votes/, the root keeps its defaults.
    const made = await artifactTool({
      action: 'publish',
      type_url: 'open-artifact://type/page',
      title: 'Team poll',
      open: 'never',
      capabilities: { db: { rules: [{ path: 'votes', write: 'view' }] }, comments: true, user: true, artifact: true },
    });
    const id = /art_[0-9a-z]+/.exec(made.url)?.[0];
    const root = made.root;
    assert.ok(id && root, JSON.stringify(made));
    await artifactTool({ action: 'publish', url: made.url, files: { 'index.html': fs.readFileSync(path.join(FIXTURE, 'index.html'), 'utf8'), 'logo.svg': fs.readFileSync(path.join(FIXTURE, 'logo.svg'), 'utf8') } });
    const published = await cli(['publish', id]);
    assert.equal(published.code, 0, published.stdout + published.stderr);
    assert.equal(published.stdout.trim().split('\n')[0], `Published to cloud: ${app}/a/${id}`);
    const second = await artifactTool({ action: 'publish', type_url: 'open-artifact://type/page', title: 'Other page', open: 'never' });
    await artifactTool({ action: 'publish', url: second.url, files: { 'index.html': '<!doctype html><title>Other page</title><p>other</p>', 'secret.txt': 'other artifact' } });
    const otherId = /art_[0-9a-z]+/.exec(second.url)?.[0];
    assert.equal((await cli(['publish', otherId])).code, 0);

    // 4. The owner opens it: the page on its own page host, no page token in its address, its file loaded.
    const page = await owner.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(page), `the page did not start: frames ${JSON.stringify(await page.evaluateAll('location.href + " " + (document.body?.innerText ?? "").slice(0, 200)'))}\nproblems: ${page.problems.slice(-10).join('\n')}\n${wrangler()}`);
    const href = await inPage(page, 'location.href');
    assert.match(href, /^http:\/\/art-[0-9a-z]+--[a-z2-7]{24}\.content\.localhost:\d+\/_f\/[^/]+\/$/, href);
    assert.equal(/v1\./.test(href), false, 'the page address holds no page token');
    assert.ok((await inPage(page, 'pageTest.logo()')) > 0, 'the file beside index.html loaded');
    assert.deepEqual(JSON.parse(await inPage(page, "document.getElementById('me').textContent")), { owner: true, canEdit: true });
    const ownerHost = new URL(href).host;

    // 5. Writes on the cloud page reach the folder: a vote, the question, a file the page publishes.
    assert.equal(await inPage(page, "pageTest.vote('owner', 'noodles')"), 'ok');
    assert.equal(await inPage(page, "pageTest.ask('Lunch?')"), 'ok');
    assert.equal(await inPage(page, "pageTest.note('from the cloud page')"), 'ok');
    const local = rel => {
      try {
        return fs.readFileSync(path.join(root, rel), 'utf8');
      } catch {
        return null;
      }
    };
    assert.ok(await until(() => /noodles/.test(local('db/votes/owner.json') ?? ''), 30000), `the vote did not come home:\n${ctx.daemonLog.slice(-1500)}`);
    assert.ok(await until(() => /Lunch\?/.test(local('db/config/main.json') ?? ''), 30000), 'the question did not come home');
    assert.ok(await until(() => local('notes.txt') === 'from the cloud page', 30000), 'the page-side publish did not come home');

    // 6. A local edit shows on the open cloud page.
    fs.writeFileSync(path.join(root, 'db', 'votes', 'agent.json'), JSON.stringify({ choice: 'rice' }));
    assert.ok(await until(async () => (await inPage(page, "document.querySelector('[data-vote=agent]')?.textContent")) === 'rice', 60000), `the local edit did not reach the open page:\n${ctx.daemonLog.slice(-1500)}\n${wrangler()}`);

    // 7. The page host reads files only.
    const pageApi = await asHost(port, ownerHost, '/api/frame/session');
    assert.ok(pageApi.status >= 400 && !pageApi.body.includes('"grants"'), `the page host answered its API: ${pageApi.status}`);
    const appApi = await asHost(port, ownerHost, '/api/open-artifact.artifacts.list');
    assert.ok(appApi.status >= 400 && !appApi.body.includes('"artifacts"'), `the page host answered the app's API: ${appApi.status}`);
    const opaque = ownerHost.split('.')[0].split('--')[1];
    const forged = `${otherId.replace('_', '-')}--${opaque}.content.localhost:${port}`;
    const otherRead = await asHost(port, forged, '/_f/x/secret.txt');
    assert.equal(otherRead.status, 403, 'a page host made for one artifact reads nothing of another');
    const shellOrigin = `http://${id.replace('_', '-')}.content.localhost:${port}`;
    const fromPage = await inPage(page, `pageTest.reach(${JSON.stringify(`${shellOrigin}/page/x/api/frame/session`)})`);
    assert.ok(fromPage === 'blocked' || fromPage >= 400, `the page reached the inner shell's API: ${fromPage}`);

    // 8. Share links; the second person joins as viewer.
    const share = async body => page.evaluate(`fetch('/api/open-artifact.artifact.share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ id, ...body }))} }).then(r => r.json())`);
    const view = await share({ access: 'link', links: { viewer: true } });
    assert.ok(view.links?.viewer?.url, JSON.stringify(view));
    const join = await guest.load(view.links.viewer.url, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    await clickOn(join, "document.querySelector('input[name=name]')", 'the name field');
    await join.type('Vic');
    await clickOn(join, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await join.waitFor(`location.pathname === '/a/${id}'`, 20000), `the guest did not get to the page: ${await join.evaluate('location.href')}`);
    assert.ok(await ready(join), `the viewer's page did not start:\n${wrangler()}`);
    const guestHref = await inPage(join, 'location.href');
    assert.notEqual(new URL(guestHref).host, ownerHost, 'the viewer has a page host of their own');
    assert.ok(await until(async () => (await inPage(join, "document.querySelector('[data-vote=agent]')?.textContent")) === 'rice', 20000), 'the viewer does not see the votes');
    assert.deepEqual(JSON.parse(await inPage(join, "document.getElementById('me').textContent")), { owner: false, canEdit: false });
    assert.equal(await inPage(join, "pageTest.vote('vic', 'soup')"), 'ok', 'the db rules let a viewer vote');
    assert.notEqual(await inPage(join, "pageTest.ask('Dinner?')"), 'ok', 'a viewer does not change the question');
    assert.equal(await inPage(join, 'pageTest.comments()'), false, 'no comments for a viewer');
    assert.ok(await until(() => /soup/.test(local('db/votes/vic.json') ?? ''), 30000), 'the viewer\'s vote did not come home');
    assert.ok(await until(async () => (await inPage(page, "document.querySelector('[data-vote=vic]')?.textContent")) === 'soup', 20000), 'the owner does not see the viewer\'s vote');

    // 9. The owner makes them a commenter: their page opens again with comments, on the same page host.
    const gid = (await share({})).guests?.find(g => g.name === 'Vic')?.id;
    assert.ok(gid, 'the guest is listed');
    await share({ guests: { [gid]: 'commenter' } });
    await join.close();
    const asCommenter = await guest.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(asCommenter));
    assert.equal(await inPage(asCommenter, 'pageTest.comments()'), true, 'a commenter has comments');
    assert.notEqual(await inPage(asCommenter, "pageTest.ask('Dinner?')"), 'ok', 'a commenter does not change the question');
    assert.equal(new URL(await inPage(asCommenter, 'location.href')).host, new URL(guestHref).host, 'the page host stays while access lasts');

    // 10. Access gone: the guest's page host reads nothing; the owner's still does.
    await share({ guests: { [gid]: null } });
    const gone = await asHost(port, new URL(guestHref).host, `${new URL(guestHref).pathname}logo.svg`);
    assert.equal(gone.status, 403, 'a removed guest\'s page host still reads');
    const still = await asHost(port, ownerHost, `${new URL(href).pathname}logo.svg`);
    assert.equal(still.status, 200, 'the owner\'s page host reads its files');

    // 11. The Link: the site says pages run, and takes a page's capabilities from the computer.
    const remotes = JSON.parse(fs.readFileSync(path.join(daemonHome, 'remotes.json'), 'utf8')).remotes;
    const linkToken = Object.values(remotes)[0]?.accessToken;
    assert.ok(linkToken, 'the daemon keeps no Link token');
    const link = (name, body) =>
      fetch(`${app}/api/open-artifact.link.${name}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${linkToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const hello = await (await link('hello')).json();
    assert.deepEqual(hello.features, { pages: 1 }, JSON.stringify(hello));
    const declared = () => JSON.parse(local('.artifact.json') ?? '{}').capabilities;
    const now = declared();
    assert.equal((await link('capabilities', { id, capabilities: now })).status, 200);
    assert.equal((await link('capabilities', { id, capabilities: [1] })).status, 400);
    assert.equal((await link('capabilities', { id: 'art_0000000000nobody0000000a', capabilities: {} })).status, 404);

    // 12. Remote MCP (OAuth in the owner's Chrome): a capabilities change on the site reaches the computer's folder.
    const server = await (await fetch(`${app}/.well-known/oauth-authorization-server`)).json();
    const verifier = randomBytes(32).toString('base64url');
    const resource = (await (await fetch(`${app}/.well-known/oauth-protected-resource/mcp`)).json()).resource;
    const params = { response_type: 'code', client_id: 'e2e', redirect_uri: REDIRECT, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 's1', resource };
    const consent = await owner.load(`${server.authorization_endpoint}?${new URLSearchParams(params)}`, { ready: "document.querySelector('button[name=decision][value=approve]')", ignore: [...IGNORE, /127\.0\.0\.1:9|ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|net::ERR/] });
    await clickOn(consent, "document.querySelector('button[name=decision][value=approve]')", 'Approve');
    let redirected = null;
    assert.ok(
      await until(async () => {
        const { targetInfos } = await consent.cdp('Target.getTargets').catch(() => ({ targetInfos: [] }));
        const target = targetInfos.map(t => t.url).find(u => u.startsWith(REDIRECT)) ?? (await consent.evaluate('location.href').catch(() => ''));
        redirected = target.startsWith(REDIRECT) ? new URL(target) : null;
        return redirected;
      }, 15000),
      'the consent did not redirect to the client',
    );
    await consent.close().catch(() => undefined);
    const tokenRes = await fetch(server.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: redirected.searchParams.get('code'), client_id: 'e2e', redirect_uri: REDIRECT, code_verifier: verifier }) });
    assert.equal(tokenRes.status, 200);
    const access = (await tokenRes.json()).access_token;
    const mcp = async (method, params = {}) => {
      const res = await fetch(`${app}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e9), method, params }) });
      const text = await res.text();
      const body = (res.headers.get('content-type') ?? '').includes('event-stream') ? JSON.parse(/^data: (.*)$/m.exec(text)[1]) : JSON.parse(text);
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    };
    await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    const call = async (name, args) => JSON.parse((await mcp('tools/call', { name, arguments: args })).content[0].text);
    const types = (await call('Artifact', { action: 'list', scope: 'types' })).types.map(t => t.id);
    assert.ok(types.includes('page'), types.join(','));
    const wanted = { ...now, downloads: true };
    const changed = await call('Artifact', { action: 'publish', url: `open-artifact://artifact/${id}`, capabilities: wanted });
    assert.ok(!changed.error, JSON.stringify(changed));
    assert.ok(await until(() => declared()?.downloads === true, 30000), `the MCP change did not reach the folder: ${local('.artifact.json')}\n${ctx.daemonLog.slice(-1500)}`);

    // 13. An uploaded zip that is a page's marker and its index.html is a page.
    const folder = tmpDir('cf-page-upload');
    fs.writeFileSync(path.join(folder, '.artifact.json'), JSON.stringify({ type: 'page', title: 'Uploaded page', capabilities: {} }));
    fs.writeFileSync(path.join(folder, 'index.html'), '<!doctype html><title>Uploaded page</title><p>uploaded</p>');
    const session = await cookieOf(page, app, 'oa_session');
    const uploaded = await fetch(`${app}/api/open-artifact.artifacts.import`, { method: 'POST', headers: { cookie: `oa_session=${session}`, 'content-type': 'application/zip', origin: app }, body: await zipFolder(folder) });
    const upload = await uploaded.json();
    assert.equal(uploaded.status, 201, JSON.stringify(upload));
    assert.equal(upload.type ?? upload.artifact?.type, 'page', JSON.stringify(upload));

    await asCommenter.close();
    await page.close();
  });
});
