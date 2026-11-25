// End-to-end test of a published Data dashboard's live data on the cloud host (`packages/host`), in Chrome.
//
// The real host on a free port (its app origin on `localhost`, each artifact on its own `*.content.localhost` origin)
// and a real daemon (`open-artifact daemon run`, its own home and port) with the fake sales connector
// (`test-artifacts/test-connectors.mjs`). The owner signs in, links the daemon (approving the code in Chrome) and
// publishes the `sales-and-signups` dashboard with `open-artifact publish <folder>`. Run without a terminal, that
// publishes the page without its rows and says so; the owner then publishes its data (the Share panel's "Publish its
// data", here its route): the daemon runs the live queries on this computer and pushes the answers as saved rows.
//
// On the cloud page the owner sees real figures under "Data as of <time>, from <owner>'s computer". The connector's
// answer changes; the owner presses Refresh on the page and the figures change with no reload (the request goes to the
// daemon as a Link event, the daemon pushes new rows, the host's type server tells the open page). A guest who joins
// by the viewer link sees the figures and has no Refresh. An editor who joins by the editor link has no Refresh until
// the owner lets editors ask the agent (`editorsCanAskAgent`); then Refresh shows on the editor's open page and pressing
// it changes the figures for everyone.
//
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';
import { writeTestConnectors } from '../test-artifacts/test-connectors.mjs';

const T = { timeout: 240000 };
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'data', 'sales-and-signups');

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/server/editors/data/index.html', 'dist/server/support.js', 'artifact-types/data/scripts/cli.mjs'];
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

const byText = (text, scope = 'document') => `[...${scope}.querySelectorAll('button,[role=menuitem],[role=menuitemradio],a')].reverse().find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) && e.getClientRects().length)`;

/** `expression` in the frame where `where` holds (the first such frame's value). */
const inFrame = (page, where, expression) => page.evaluateAll(`(${where}) ? (${expression}) : undefined`).then(values => values.find(v => v !== undefined && v !== null));

/** The editor's frame: the one with the dashboard toolbar. */
const TOOLBAR = "document.querySelector('header.dash-toolbar')";
/** The "Data as of" line in the toolbar. */
const asOf = page => inFrame(page, TOOLBAR, "document.querySelector('[data-dash-snapshot]')?.textContent ?? ''");
/** Whether the toolbar has the snapshot's Refresh. */
const hasRefresh = page => inFrame(page, TOOLBAR, "Boolean(document.querySelector('[data-dash-snapshot-refresh] button'))");
/** The revenue total the dashboard draws (in whichever frame draws it). */
const REVENUE = "document.querySelector('[data-draw=\"revenue-total\"]')";
const revenue = page => inFrame(page, REVENUE, `${REVENUE}.textContent.trim()`);
const shown = text => typeof text === 'string' && /\d/.test(text);

/** Clicks the toolbar's Refresh with the real mouse: the editor frame's place in the page plus the button's in it. */
async function clickRefresh(page) {
  const inner = await inFrame(page, TOOLBAR, "(() => { const r = document.querySelector('[data-dash-snapshot-refresh] button').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, innerWidth, innerHeight]; })()");
  assert.ok(inner, 'no Refresh');
  // The editor is the Shell's only iframe whose size is the editor frame's viewport.
  const frame = await page.evaluate(`(() => { const f = [...document.querySelectorAll('iframe')].find(f => Math.round(f.getBoundingClientRect().width) === ${inner[2]}) ?? document.querySelector('iframe'); const r = f.getBoundingClientRect(); return [r.left, r.top]; })()`);
  await page.click(frame[0] + inner[0], frame[1] + inner[1]);
}

const IGNORE = [/favicon\.ico/, /not_granted|not available in this view|noLiveData/i, /HTTP 40[134]: .*\/_?api\//];

describe('published dashboard live data in Chrome', { skip: skip() }, () => {
  const ctx = {};

  before(async () => {
    const data = path.join(tmpDir('host-data'), 'data');
    const port = await freePort();
    ctx.app = `http://localhost:${port}`;
    const env = { ...process.env, OA_DATA_DIR: data, OA_PORT: String(port), OA_BIND: '127.0.0.1', OA_APP_ORIGIN: ctx.app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}` };
    delete env.OA_OWNER_KEY;
    delete env.OA_SIGNING_KEYS;
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
    ctx.owner = await launch();
    ctx.guest = await launch();
  });

  after(async () => {
    await ctx.owner?.close();
    await ctx.guest?.close();
    await ctx.editor?.close();
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

  it('the owner sees the figures and refreshes them; a guest viewer sees them with no Refresh', T, async () => {
    const { owner, guest, app } = ctx;

    // 1. The owner signs in.
    const home = await owner.load(ctx.signIn, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    await clickOn(home, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await home.waitFor(`location.href === ${JSON.stringify(`${app}/`)}`, 20000));

    // 2. The agent's computer: a daemon with the fake sales connector, whose answers a file can change.
    const daemonHome = tmpDir('data-daemon-home');
    const workspace = tmpDir('data-agent');
    const bonus = path.join(workspace, 'bonus');
    fs.writeFileSync(bonus, '0');
    const daemonPort = await freePort();
    const env = {
      ...process.env,
      OPEN_ARTIFACT_HOME: daemonHome,
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
      OPEN_ARTIFACT_HARNESS: 'cli',
      OPEN_ARTIFACT_SESSION: 'e2e-data',
      OPEN_ARTIFACT_CONNECTORS: writeTestConnectors(path.join(daemonHome, 'connectors')),
      SALES_MCP_BONUS_FILE: bonus,
    };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR']) delete env[name];
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

    // 3. Link it: the owner approves the code in Chrome.
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

    // 4. The dashboard, made an artifact and published from its folder. No terminal to ask at: the page goes up without
    //    its rows, and the command says how to add them. The owner then publishes its data, as the Share panel does.
    const folder = path.join(workspace, 'sales-and-signups');
    fs.cpSync(SAMPLE, folder, { recursive: true, filter: src => !/[\\/](_agent|history|data)([\\/]|$)/.test(src.slice(SAMPLE.length)) });
    const adopted = await cli(['artifact', JSON.stringify({ action: 'adopt', folder, type_url: 'open-artifact://type/data' })]);
    assert.equal(adopted.code, 0, adopted.stdout + adopted.stderr);
    const id = /art_[0-9a-z]+/.exec(JSON.parse(adopted.stdout).url)?.[0];
    assert.ok(id, adopted.stdout);
    const published = await cli(['publish', folder]);
    assert.equal(published.code, 0, published.stderr);
    const [said, dataSaid] = published.stdout.trim().split('\n');
    assert.equal(said, `Published to cloud: ${app}/a/${id}`);
    assert.match(dataSaid ?? '', /^Its live data was not published: /);
    await sleep(1000);
    assert.equal(fs.existsSync(path.join(folder, 'db', 'data', 'live.json')), false, 'rows were taken without the owner’s word');
    const daemonState = JSON.parse(fs.readFileSync(path.join(daemonHome, 'daemon.json'), 'utf8'));
    const confirmed = await fetch(`${daemonState.url}/api/open-artifact.artifacts.data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${daemonState.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, publish: true }),
    });
    assert.equal(confirmed.status, 200, await confirmed.text());
    assert.ok(await until(() => fs.existsSync(path.join(folder, 'db', 'data', 'live.json')), 60000), `no snapshot was taken:\n${ctx.daemonLog.slice(-2000)}`);

    // 5. The cloud page: real figures and the "Data as of" line, with Refresh.
    const page = await owner.load(`${app}/a/${id}`, { ready: "location.hostname.endsWith('.content.localhost') && document.getElementById('root')?.childElementCount > 0", ignore: IGNORE });
    let line = '';
    assert.ok(
      await until(async () => /^Data as of .+, from .+’s computer/.test((line = (await asOf(page)) ?? '')), 60000),
      `no "Data as of" line: ${JSON.stringify(line)}\n${ctx.daemonLog.slice(-1500)}`,
    );
    let first = '';
    assert.ok(await until(async () => shown((first = await revenue(page))), 30000), `the revenue total did not draw: ${JSON.stringify(first)}`);
    assert.equal(await hasRefresh(page), true);
    // The broken query's failure is the owner's to see.
    assert.match(line, /couldn’t refresh: .*broken/);
    const before = await inFrame(page, TOOLBAR, 'performance.timeOrigin');

    // 6. The connector answers otherwise; the owner presses Refresh and the figures change with no reload.
    fs.writeFileSync(bonus, '1000');
    await clickRefresh(page);
    let next = first;
    assert.ok(await until(async () => shown((next = await revenue(page))) && next !== first, 60000), `the figures did not change: ${first} → ${next}\n${ctx.daemonLog.slice(-1500)}`);
    assert.notEqual(await asOf(page), '');
    assert.equal(await inFrame(page, TOOLBAR, 'performance.timeOrigin'), before, 'the editor frame reloaded');

    // 7. A guest joins by the viewer link: the figures, the line, and no Refresh.
    await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
    assert.ok(await page.waitFor("document.querySelector('[data-publish-data-note]') || true", 5000));
    await clickOn(page, "document.querySelector('[aria-label=\"General access\"]')", 'General access');
    await clickOn(page, byText('Anyone with the link'), 'Anyone with the link');
    assert.ok(await page.waitFor("document.querySelector('[data-share-link=viewer]')?.title.includes('/s/')", 15000), 'the viewer link shows no address');
    const link = await page.evaluate("document.querySelector('[data-share-link=viewer]').title");
    const join = await guest.load(link, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    await clickOn(join, "document.querySelector('input[name=name]')", 'the name field');
    await join.type('Vera the viewer');
    await clickOn(join, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await join.waitFor(`location.pathname === '/a/${id}'`, 20000));
    let seen = '';
    assert.ok(await until(async () => (seen = await revenue(join)) === next, 60000), `the guest does not see the figures: ${JSON.stringify(seen)} (owner: ${next})`);
    let guestLine = '';
    assert.ok(await until(async () => /^Data as of /.test((guestLine = (await asOf(join)) ?? '')), 30000), JSON.stringify(guestLine));
    assert.doesNotMatch(guestLine, /couldn’t refresh/, 'only the owner sees why a refresh failed');
    assert.equal(await hasRefresh(join), false);
    const refused = await inFrame(join, TOOLBAR, "fetch(new URL('_api/data/refresh', location.href), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.status)");
    assert.equal(refused, 403);

    // 8. An editor joins by the editor link: no Refresh while the owner keeps the agent to themselves; once the owner
    //    lets editors ask the agent, the editor's page shows Refresh (no reload) and pressing it changes the figures.
    const shareOpen = "document.querySelector('[data-share-link=editor]')";
    if (!(await page.evaluate(`Boolean(${shareOpen})`))) await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
    assert.ok(await page.waitFor(shareOpen, 15000), 'no editor link row');
    if (!(await page.evaluate("document.querySelector('[data-share-link=editor]').title.includes('/s/')")))
      await clickOn(page, "[...document.querySelectorAll('[data-share-link=editor] button')].find(b => b.textContent.trim() === 'Turn on')", "the editor link's Turn on");
    assert.ok(await page.waitFor("document.querySelector('[data-share-link=editor]')?.title.includes('/s/')", 15000), 'the editor link shows no address');
    const editorLink = await page.evaluate("document.querySelector('[data-share-link=editor]').title");
    const ask = "document.querySelector('[role=switch][aria-label^=\"Editors can ask\"], input[aria-label^=\"Editors can ask\"]')";
    assert.ok(await page.waitFor(ask, 15000), 'no "Editors can ask" setting');
    assert.equal(await page.evaluate(`${ask}.getAttribute('aria-checked') === 'true' || ${ask}.checked === true`), false, 'editors may ask the agent before the owner said so');

    const editor = (ctx.editor = await launch());
    const enter = await editor.load(editorLink, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    await clickOn(enter, "document.querySelector('input[name=name]')", 'the name field');
    await enter.type('Eddie the editor');
    await clickOn(enter, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await enter.waitFor(`location.pathname === '/a/${id}'`, 20000));
    let editorSees = '';
    assert.ok(await until(async () => (editorSees = await revenue(enter)) === next, 60000), `the editor does not see the figures: ${JSON.stringify(editorSees)} (owner: ${next})`);
    assert.ok(await until(async () => /^Data as of /.test((await asOf(enter)) ?? ''), 30000), 'the editor has no "Data as of" line');
    assert.equal(await hasRefresh(enter), false, 'an editor has Refresh while the owner keeps the agent to themselves');

    await clickOn(page, ask, 'Editors can ask');
    assert.ok(await page.waitFor(`${ask}.getAttribute('aria-checked') === 'true' || ${ask}.checked === true`, 15000), 'the setting did not turn on');
    assert.ok(await until(async () => (await hasRefresh(enter)) === true, 30000), 'the editor got no Refresh once the owner let editors ask the agent');

    fs.writeFileSync(bonus, '2000');
    await clickRefresh(enter);
    let third = next;
    assert.ok(await until(async () => shown((third = await revenue(enter))) && third !== next, 60000), `the editor's Refresh did not change the figures: ${next} → ${third}\n${ctx.daemonLog.slice(-1500)}`);
    assert.ok(await until(async () => (await revenue(page)) === third, 30000), 'the owner does not see the figures the editor refreshed');

    await page.close();
    await join.close();
    await enter.close();
  });
});
