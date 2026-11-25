// End-to-end test of a computer set up in advance to publish to a cloud host on the LAN, over plain http.
//
// The host (`packages/host`, real, its own data folder and free port) is reached by made-up private names, the way a
// home or office network names it: the app at `http://oa.lan:<port>`, each artifact at `http://<id>.oa-content.lan:<port>`.
// Nothing resolves `.lan` here, so the daemon gets a `dns.lookup` that maps `*.lan` to 127.0.0.1 (a `--import` preload
// in NODE_OPTIONS) and Chrome gets `--host-resolver-rules`; the names themselves, which decide whether http is allowed,
// are the real ones.
//
// The administrator mints a Link token with `open-artifact-host link-token --user <email>`. A real daemon starts with
// only environment presets: OPEN_ARTIFACT_REMOTE (the http LAN address), OPEN_ARTIFACT_REMOTE_TOKEN and
// OPEN_ARTIFACT_PUBLISH=auto. With no browser and no `remote add`, it adds the remote, signs in with the token and makes
// the remote the default. An artifact created through the CLI's Artifact tool is answered at once with its local
// address and a note, appears on the host by itself, and opens in Chrome at its web address on the LAN name.
//
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 180000 };
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const TITLE = 'Published by itself';
const EMAIL = 'ada@example.com';

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

/** Stops a child process: SIGTERM, then SIGKILL after five seconds. */
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

/** The middle of the element `selector` (an expression) finds, scrolled into view; null when there is none. */
const centerOf = selector => `(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;

/** Click the element `selector` finds with the real mouse, once it is there. */
async function clickOn(page, selector, what = selector) {
  assert.ok(await page.waitFor(selector, 15000), `nothing to click: ${what}`);
  const at = await page.evaluate(centerOf(selector));
  assert.ok(at, `nothing to click: ${what}`);
  await page.click(...at);
}

/** Problems every page here may have: no favicon on the host. */
const IGNORE = [/favicon\.ico/];

describe('a computer set up in advance publishes to a LAN host by itself', { skip: skip() }, () => {
  const ctx = {};

  before(async () => {
    const data = path.join(tmpDir('host-auto'), 'data');
    const port = await freePort();
    ctx.app = `http://oa.lan:${port}`;
    ctx.env = {
      ...process.env,
      OA_DATA_DIR: data,
      OA_PORT: String(port),
      OA_BIND: '127.0.0.1',
      OA_APP_ORIGIN: ctx.app,
      OA_CONTENT_ORIGIN: `http://{id}.oa-content.lan:${port}`,
    };
    // A host on a private name may generate its own signing key; none is given.
    for (const name of ['OA_OWNER_KEY', 'OA_SIGNING_KEYS', 'OA_ALLOW_HTTP']) delete ctx.env[name];

    // The administrator mints a Link token for the person (before the host serves: the same data folder).
    const minted = spawnSync(process.execPath, [MAIN, 'link-token', '--user', EMAIL, '--label', 'e2e laptop'], { env: ctx.env, encoding: 'utf8', timeout: 60000 });
    assert.equal(minted.status, 0, `link-token failed: ${minted.stderr}`);
    assert.match(minted.stdout, new RegExp(`OPEN_ARTIFACT_REMOTE=${ctx.app.replace(/\./g, '\\.')}$`, 'm'));
    ctx.token = /OPEN_ARTIFACT_REMOTE_TOKEN=(\S+)/.exec(minted.stdout)?.[1];
    assert.ok(ctx.token?.startsWith('oa_rt_'), 'link-token printed no token');

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
    assert.ok(ctx.signIn.startsWith(`${ctx.app}/`), ctx.signIn);
    ctx.owner = await launch({ args: ['--host-resolver-rules=MAP *.lan 127.0.0.1'] });
  });

  after(async () => {
    await ctx.owner?.close();
    await stop(ctx.daemon);
    if (ctx.host) {
      await stop(ctx.host);
      ctx.stopHost();
      process.off('exit', ctx.stopHost);
    }
    removeTmp();
  });

  it('env presets link the daemon with no browser; a new artifact is published by itself and opens at its LAN web address', T, async () => {
    const { owner, app, token } = ctx;
    // The agent's computer: its own home and port, no browser opening, no idle exit; `.lan` names resolve to this
    // computer through a preload (Node has nothing that resolves them otherwise).
    const home = tmpDir('host-auto-daemon');
    const workspace = tmpDir('host-auto-agent');
    const preload = path.join(tmpDir('host-auto-dns'), 'lan-dns.mjs');
    fs.writeFileSync(
      preload,
      `import dns from 'node:dns';
const lookup = dns.lookup;
dns.lookup = function (host, options, callback) {
  return lookup.call(this, /\\.lan$/i.test(String(host)) ? '127.0.0.1' : host, options, callback);
};
`,
    );
    const daemonPort = await freePort();
    const env = {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}`.trim(),
      OPEN_ARTIFACT_HOME: home,
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
      OPEN_ARTIFACT_HARNESS: 'cli',
      OPEN_ARTIFACT_SESSION: 'e2e-auto',
      OPEN_ARTIFACT_REMOTE: app,
      OPEN_ARTIFACT_REMOTE_TOKEN: token,
      OPEN_ARTIFACT_PUBLISH: 'auto',
    };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE_NAME', 'OPEN_ARTIFACT_REMOTE_INSECURE_HTTP', 'OPEN_ARTIFACT_PLUGIN_REMOTE']) delete env[name];
    ctx.daemonLog = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(daemonPort)], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (ctx.daemonLog += chunk));
    ctx.daemon.stderr.on('data', chunk => (ctx.daemonLog += chunk));
    assert.ok(await until(() => fs.existsSync(path.join(home, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.daemonLog}`);
    const cli = args =>
      new Promise(resolve => {
        const child = spawn(process.execPath, [CLI, ...args], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => (stdout += chunk));
        child.stderr.on('data', chunk => (stderr += chunk));
        const timer = setTimeout(() => child.kill(), 90000);
        child.on('close', code => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });

    // 1. The preset remote is added, signed in with the token (no approval, no browser) and made the default.
    let linked = '';
    await until(async () => {
      linked = (await cli(['remote', 'list'])).stdout;
      return linked.includes(`\t${EMAIL}\t`);
    }, 30000);
    assert.ok(linked.includes(`\t${EMAIL}\t`), `the preset remote did not sign in:\n${(await cli(['remote', 'status'])).stdout}\n${ctx.daemonLog.slice(-1500)}`);
    // Named after the host; the only remote, and the default.
    assert.equal(linked.trim(), `oa\t${app}\t${EMAIL}\t0 published\tdefault`);
    const status = await cli(['remote', 'status']);
    assert.equal(status.code, 0, status.stderr);
    assert.match(status.stdout, /ada@example\.com/);
    assert.match(status.stdout, /plain http/i, 'status says the remote is not encrypted');
    assert.match(status.stdout, /automatic/i, 'status says publishing is automatic');

    // 2. An artifact created through the Artifact tool: answered at once, locally, with a note; published by itself.
    const created = await cli(['artifact', JSON.stringify({ action: 'publish', type_url: 'open-artifact://type/whiteboard', title: TITLE })]);
    assert.equal(created.code, 0, created.stdout + created.stderr);
    const result = JSON.parse(created.stdout);
    const id = /art_[0-9a-z]+/.exec(result.url)?.[0];
    assert.ok(id, created.stdout);
    assert.match(result.view_url, /^http:\/\/127\.0\.0\.1:/, 'the answer keeps the local address');
    assert.ok(result.notes?.some(n => /by itself/.test(n)), `no note about publishing: ${created.stdout}`);
    let webUrl = '';
    await until(async () => {
      const read = await cli(['artifact', JSON.stringify({ action: 'read', url: `open-artifact://artifact/${id}` })]);
      webUrl = read.code === 0 ? JSON.parse(read.stdout).view_url : '';
      return webUrl.startsWith(app);
    }, 30000);
    assert.equal(webUrl, `${app}/a/${id}`, `the artifact was not published by itself:\n${(await cli(['remote', 'status'])).stdout}\n${ctx.daemonLog.slice(-1500)}`);
    assert.ok(!fs.readFileSync(path.join(home, 'logs', 'daemon.log'), 'utf8').includes(token), 'the token is not in the log');

    // 3. In Chrome: the owner signs in with the printed key, then opens the web address; the Shell frames the page on
    // the artifact's own LAN content name, and it draws.
    const signIn = await owner.load(ctx.signIn, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    await clickOn(signIn, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    // The home page lists the person's own artifacts; this one is Ada's, which the owner (a site admin) may open.
    assert.ok(await signIn.waitFor(`location.href === ${JSON.stringify(`${app}/`)} && document.body.innerText.includes('Artifacts')`, 20000), `the owner did not sign in: ${await signIn.evaluate('location.href + "\\n" + document.body.innerText.slice(0, 500)')}`);
    await signIn.close();
    const page = await owner.load(webUrl, { ready: "location.hostname.endsWith('.oa-content.lan') && document.getElementById('root')?.childElementCount > 0", ignore: IGNORE });
    const frames = (await page.evaluateAll("location.hostname.endsWith('.oa-content.lan') ? location.origin : undefined")).filter(Boolean);
    assert.ok(frames.some(origin => /^http:\/\/[a-z0-9-]+\.oa-content\.lan:\d+$/.test(origin)), `no framed page on a LAN content name: ${JSON.stringify(frames)}`);
    assert.equal(await page.evaluate('location.href'), webUrl);
    assert.ok((await page.evaluate('document.title')).includes(TITLE) || (await page.evaluate('document.body.innerText')).includes(TITLE), 'the Shell shows the title');
    assert.deepEqual(page.problems, []);
    await page.close();
  });
});
