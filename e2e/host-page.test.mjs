// End-to-end test of a `page` artifact published to the Node site (`packages/host`), in Chrome.
//
// The real host on a free port (its app on `localhost`, each artifact's inner shell on `art-<id>.content.localhost`,
// each viewer's page on its own `art-<id>--<opaque>.content.localhost`) and a real daemon (`open-artifact daemon run`,
// its own home and port). The owner signs in and links the daemon; the agent makes a page from the synthetic fixture
// (e2e/fixtures/page-site/: db rules, a file beside index.html) with the Artifact tool and publishes it.
//
// - The owner opens it on the site: the page renders on a page host whose address holds no page token, loads its
//   file, votes and sets the question (a db write each), and replaces a file from the page (a page-side publish):
//   all of it reaches the local folder. A db document written in the local folder shows on the open site page.
// - A second person joins by the share links, as viewer, then commenter, then editor: the db rules let every level
//   vote, only an editor changes the question, comments only from commenter up; their page host is their own.
// - The page host reads files only: no API there, the inner shell's API refuses the page's origin, and the page host
//   cannot read another artifact.
//
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 240000 };
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const FIXTURE = path.join(repoRoot, 'e2e', 'fixtures', 'page-site');
/** In the page's own frame (a page host: `<idlabel>--<24 base32>`). */
const IN_PAGE = "/^art-[0-9a-z]+--[a-z2-7]{24}\\.content\\.localhost$/.test(location.hostname)";

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/daemon/frame-host/client/shell.html', 'dist/daemon/frame-host/client/runtime.js'];
  const missing = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return missing.length ? `not built (npm run build): no ${missing.join(', ')}` : false;
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

const centerOf = selector => `(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;

async function clickOn(page, selector, what = selector) {
  assert.ok(await page.waitFor(selector, 15000), `nothing to click: ${what}`);
  const at = await page.evaluate(centerOf(selector));
  assert.ok(at, `nothing to click: ${what}`);
  await page.click(...at);
}

/** `expression` in the page's own frame (undefined while there is none). */
const inPage = (page, expression) => page.evaluateAll(`(${IN_PAGE}) ? (${expression}) : undefined`).then(values => values.find(v => v !== undefined && v !== null), () => undefined);
const ready = page => until(async () => (await inPage(page, "document.getElementById('status')?.textContent")) === 'ready', 60000);

/** A plain request to the site with a Host header of our choosing (a page host, an inner shell's). */
async function asHost(port, host, pathname) {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: pathname, headers: { host } }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const IGNORE = [/favicon\.ico/, /not_granted|forbidden|not available in this view/i, /HTTP 40[134]/, /Failed to load resource/, /Content Security Policy|Refused to connect/];

describe('a page artifact on the site in Chrome', { skip: skip() }, () => {
  const ctx = {};

  before(async () => {
    const data = path.join(tmpDir('host-page'), 'data');
    ctx.data = data;
    const port = await freePort();
    ctx.port = port;
    ctx.app = `http://localhost:${port}`;
    const env = { ...process.env, OA_DATA_DIR: data, OA_PORT: String(port), OA_BIND: '127.0.0.1', OA_APP_ORIGIN: ctx.app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}` };
    for (const name of ['OA_OWNER_KEY', 'OA_SIGNING_KEYS', 'OA_CONTENT_SAME_SITE', 'OA_PAGE_NETWORK']) delete env[name];
    ctx.log = '';
    ctx.host = spawn(process.execPath, [MAIN, 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.host.stdout.on('data', chunk => (ctx.log += chunk));
    ctx.host.stderr.on('data', chunk => (ctx.log += chunk));
    ctx.stopHost = () => ctx.host.exitCode === null && ctx.host.kill('SIGKILL');
    process.on('exit', ctx.stopHost);
    const signIn = () => /(http:\/\/\S+\/auth\/sign-in#key=\S+)/.exec(ctx.log)?.[1];
    await until(signIn, 30000);
    ctx.signIn = signIn();
    assert.ok(ctx.signIn, `the host printed no sign-in address:\n${ctx.log}`);
    assert.match(ctx.log, /pages: +on/, 'the start says pages run');
    ctx.owner = await launch();
    ctx.guest = await launch();
  });

  after(async () => {
    await ctx.owner?.close();
    await ctx.guest?.close();
    for (const name of ['daemon', 'host']) {
      const child = ctx[name];
      if (!child) continue;
      const exited = new Promise(resolve => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
      child.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (ctx.stopHost) process.off('exit', ctx.stopHost);
    removeTmp();
  });

  it('publishes a page, runs it for the owner and for each share role, and keeps the folder in step', T, async () => {
    const { owner, guest, app, port } = ctx;

    // 1. The owner signs in.
    const home = await owner.load(ctx.signIn, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    await clickOn(home, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await home.waitFor(`location.href === ${JSON.stringify(`${app}/`)}`, 20000));

    // 2. The agent's computer, linked: the owner approves the code in Chrome.
    const daemonHome = tmpDir('page-daemon-home');
    const workspace = tmpDir('page-agent');
    const daemonPort = await freePort();
    const env = { ...process.env, OPEN_ARTIFACT_HOME: daemonHome, OPEN_ARTIFACT_BROWSER: 'none', OPEN_ARTIFACT_IDLE_MS: '0', OPEN_ARTIFACT_HARNESS: 'cli', OPEN_ARTIFACT_SESSION: 'e2e-page' };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN']) delete env[name];
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
    // A second page, to show one page host cannot read another artifact.
    const second = await artifactTool({ action: 'publish', type_url: 'open-artifact://type/page', title: 'Other page', open: 'never' });
    await artifactTool({ action: 'publish', url: second.url, files: { 'index.html': '<!doctype html><title>Other page</title><p>other</p>', 'secret.txt': 'other artifact' } });
    const otherId = /art_[0-9a-z]+/.exec(second.url)?.[0];
    assert.equal((await cli(['publish', otherId])).code, 0);

    // 4. The owner opens it: the page on its own page host, no page token in its address, its file loaded.
    const page = await owner.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(page), `the page did not start: frames ${JSON.stringify(await page.evaluateAll('location.href + " " + (document.body?.innerText ?? "").slice(0, 200)'))}\nproblems: ${page.problems.slice(-10).join('\n')}\nsite: ${JSON.stringify(fs.readdirSync(ctx.data, { recursive: true }).filter(f => f.includes(id)))}\nlocal: ${JSON.stringify(fs.readdirSync(root, { recursive: true }))}\n${ctx.log.slice(-1500)}`);
    const href = await inPage(page, 'location.href');
    assert.match(href, /^http:\/\/art-[0-9a-z]+--[a-z2-7]{24}\.content\.localhost:\d+\/_f\/[^/]+\/$/, href);
    assert.equal(/v1\./.test(href), false, 'the page address holds no page token');
    assert.ok((await inPage(page, 'pageTest.logo()')) > 0, 'the file beside index.html loaded');
    assert.deepEqual(JSON.parse(await inPage(page, "document.getElementById('me').textContent")), { owner: true, canEdit: true });
    const ownerHost = new URL(href).host;

    // 5. Site writes reach the folder: a vote, the question, a file the page publishes.
    assert.equal(await inPage(page, "pageTest.vote('owner', 'noodles')"), 'ok');
    assert.equal(await inPage(page, "pageTest.ask('Lunch?')"), 'ok');
    assert.equal(await inPage(page, "pageTest.note('from the site page')"), 'ok');
    const local = rel => {
      try {
        return fs.readFileSync(path.join(root, rel), 'utf8');
      } catch {
        return null;
      }
    };
    assert.ok(await until(() => /noodles/.test(local('db/votes/owner.json') ?? ''), 30000), `the vote did not come home:\n${ctx.daemonLog.slice(-1500)}`);
    assert.ok(await until(() => /Lunch\?/.test(local('db/config/main.json') ?? ''), 30000), 'the question did not come home');
    assert.ok(await until(() => local('notes.txt') === 'from the site page', 30000), 'the page-side publish did not come home');

    // 6. A local edit shows on the open site page (pushed, then told to the open core).
    fs.writeFileSync(path.join(root, 'db', 'votes', 'agent.json'), JSON.stringify({ choice: 'rice' }));
    assert.ok(await until(async () => (await inPage(page, "document.querySelector('[data-vote=agent]')?.textContent")) === 'rice', 60000), `the local edit did not reach the open page:\n${ctx.daemonLog.slice(-1500)}`);

    // 7. The page host reads files only.
    const pageApi = await asHost(port, ownerHost, '/api/frame/session');
    assert.ok(pageApi.status >= 400 && !pageApi.body.includes('"grants"'), `the page host answered its API: ${pageApi.status}`);
    const opaque = ownerHost.split('.')[0].split('--')[1];
    const forged = `${otherId.replace('_', '-')}--${opaque}.content.localhost:${port}`;
    const otherRead = await asHost(port, forged, '/_f/x/secret.txt');
    assert.equal(otherRead.status, 403, 'a page host made for one artifact reads nothing of another');
    const shellOrigin = `http://${id.replace('_', '-')}.content.localhost:${port}`;
    const fromPage = await inPage(page, `pageTest.reach(${JSON.stringify(`${shellOrigin}/page/x/api/frame/session`)})`);
    assert.ok(fromPage === 'blocked' || fromPage >= 400, `the page reached the inner shell's API: ${fromPage}`);

    // 8. Share links; the second person joins as viewer.
    const share = async body => page.evaluate(`fetch('/api/open-artifact.artifact.share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ id, ...body }))} }).then(r => r.json())`);
    const view = await share({ access: 'link', links: { viewer: true, commenter: true, editor: true } });
    assert.ok(view.links?.viewer?.url, JSON.stringify(view));
    const join = await guest.load(view.links.viewer.url, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    await clickOn(join, "document.querySelector('input[name=name]')", 'the name field');
    await join.type('Vic');
    await clickOn(join, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await join.waitFor(`location.pathname === '/a/${id}'`, 20000));
    assert.ok(await ready(join), 'the viewer\'s page did not start');
    const guestHref = await inPage(join, 'location.href');
    assert.notEqual(new URL(guestHref).host, ownerHost, 'the viewer has a page host of their own');
    assert.ok(await until(async () => (await inPage(join, "document.querySelector('[data-vote=agent]')?.textContent")) === 'rice', 20000), 'the viewer does not see the votes');
    assert.deepEqual(JSON.parse(await inPage(join, "document.getElementById('me').textContent")), { owner: false, canEdit: false });
    assert.equal(await inPage(join, "pageTest.vote('vic', 'soup')"), 'ok', 'the db rules let a viewer vote');
    assert.notEqual(await inPage(join, "pageTest.ask('Dinner?')"), 'ok', 'a viewer does not change the question');
    assert.equal(await inPage(join, 'pageTest.comments()'), false, 'no comments for a viewer');
    assert.ok(await until(() => /soup/.test(local('db/votes/vic.json') ?? ''), 30000), 'the viewer\'s vote did not come home');

    // 9. The owner makes them a commenter, then an editor; each time their page opens again with the new level.
    const guestId = async () => (await share({})).guests?.find(g => g.name === 'Vic')?.id;
    const gid = await guestId();
    assert.ok(gid, 'the guest is listed');
    await share({ guests: { [gid]: 'commenter' } });
    await join.close();
    const asCommenter = await guest.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(asCommenter));
    assert.equal(await inPage(asCommenter, 'pageTest.comments()'), true, 'a commenter has comments');
    assert.notEqual(await inPage(asCommenter, "pageTest.ask('Dinner?')"), 'ok', 'a commenter does not change the question');
    assert.equal(new URL(await inPage(asCommenter, 'location.href')).host, new URL(guestHref).host, 'the page host stays while access lasts');
    await share({ guests: { [gid]: 'editor' } });
    await asCommenter.close();
    const asEditor = await guest.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(asEditor));
    assert.deepEqual(JSON.parse(await inPage(asEditor, "document.getElementById('me').textContent")), { owner: false, canEdit: true });
    assert.equal(await inPage(asEditor, "pageTest.ask('Dinner?')"), 'ok', 'an editor changes the question');
    assert.ok(await until(async () => (await inPage(page, "document.getElementById('question').textContent")) === 'Dinner?', 20000), 'the owner does not see the editor\'s change');
    assert.ok(await until(() => /Dinner\?/.test(local('db/config/main.json') ?? ''), 30000), 'the editor\'s change did not come home');

    // 10. Access gone: the guest's page host reads nothing.
    await share({ guests: { [gid]: null } });
    const gone = await asHost(port, new URL(guestHref).host, `${new URL(guestHref).pathname}logo.svg`);
    assert.equal(gone.status, 403, 'a removed guest\'s page host still reads');
    const still = await asHost(port, ownerHost, `${new URL(href).pathname}logo.svg`);
    assert.equal(still.status, 200, 'the owner\'s page host reads its files');

    await asEditor.close();
    await page.close();
  });
});
