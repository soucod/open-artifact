// End-to-end test of a published Data dashboard's live data on the product Worker (`packages/host-cloudflare`) under
// `wrangler dev` (local only, never deployed): a real daemon with the fake sales connector
// (`test-artifacts/test-connectors.mjs`), linked with the owner approving in Chrome, publishes `sales-and-signups`
// (without a terminal: the page goes up without its rows), and the owner publishes its data (the Share panel's route).
// The cloud page shows real figures under "Data as of"; the connector's answer changes, the owner presses Refresh, and
// the figures change with no reload: the request went through the Worker's outbox as a `data-refresh` Link event, the
// same outbox the Node host uses. An editor who joins by the editor link has no Refresh until the owner lets editors
// ask the agent (`editorsCanAskAgent`); then Refresh shows on the editor's open page and pressing it changes the figures.
//
// Skipped (with the reason) when deploy/cloudflare has no node_modules, with E2E_BROWSER=0, without Chrome, or before
// `npm run build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { buildWorkers, d1, freePort, startWrangler, wranglerMissing } from './lib/cloudflare.mjs';
import { byText, clickOn } from './lib/host-page.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';
import { writeTestConnectors } from '../test-artifacts/test-connectors.mjs';

const T = { timeout: 300000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'data', 'sales-and-signups');
const OWNER_KEY = `owner-${randomBytes(12).toString('hex')}`;
const SIGNING_KEY = randomBytes(32).toString('hex');
const IGNORE = [/favicon\.ico/, /not_granted|not available in this view|noLiveData/i, /HTTP 40[134]: .*\/_?api\//];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function skip() {
  const missing = wranglerMissing();
  if (missing) return missing;
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/server/editors/data/index.html', 'dist/server/support.js', 'artifact-types/data/scripts/cli.mjs'];
  const absent = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return absent.length ? `not built (npm run build): no ${absent.join(', ')}` : false;
}

const inFrame = (page, where, expression) => page.evaluateAll(`(${where}) ? (${expression}) : undefined`).then(values => values.find(v => v !== undefined && v !== null));
const TOOLBAR = "document.querySelector('header.dash-toolbar')";
const asOf = page => inFrame(page, TOOLBAR, "document.querySelector('[data-dash-snapshot]')?.textContent ?? ''");
const REVENUE = "document.querySelector('[data-draw=\"revenue-total\"]')";
const revenue = page => inFrame(page, REVENUE, `${REVENUE}.textContent.trim()`);
const hasRefresh = page => inFrame(page, TOOLBAR, "Boolean(document.querySelector('[data-dash-snapshot-refresh] button'))");
const shown = text => typeof text === 'string' && /\d/.test(text);

async function clickRefresh(page) {
  const inner = await inFrame(page, TOOLBAR, "(() => { const r = document.querySelector('[data-dash-snapshot-refresh] button').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, innerWidth]; })()");
  assert.ok(inner, 'no Refresh');
  const frame = await page.evaluate(`(() => { const f = [...document.querySelectorAll('iframe')].find(f => Math.round(f.getBoundingClientRect().width) === ${inner[2]}) ?? document.querySelector('iframe'); const r = f.getBoundingClientRect(); return [r.left, r.top]; })()`);
  await page.click(frame[0] + inner[0], frame[1] + inner[1]);
}

describe('cloudflare: published dashboard live data under wrangler dev', { skip: skip() }, () => {
  const ctx = {};

  before(async () => {
    buildWorkers();
    ctx.state = tmpDir('cloudflare-data');
    ctx.port = await freePort();
    ctx.app = `http://localhost:${ctx.port}`;
    ctx.server = await startWrangler({
      port: ctx.port,
      state: ctx.state,
      vars: { OA_APP_ORIGIN: ctx.app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${ctx.port}`, OA_SIGNING_KEYS: SIGNING_KEY, OA_OWNER_KEY: OWNER_KEY },
      ready: async origin => (await fetch(`${origin}/__open-artifact/health`)).status === 200,
    });
    ctx.owner = await launch();
  });

  after(async () => {
    await ctx.owner?.close();
    await ctx.editor?.close();
    if (ctx.daemon && ctx.daemon.exitCode === null) {
      const exited = new Promise(resolve => ctx.daemon.once('exit', resolve));
      ctx.daemon.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      if (ctx.daemon.exitCode === null) ctx.daemon.kill('SIGKILL');
    }
    await ctx.server?.stop();
    removeTmp();
  });

  it('publishes the dashboard, then its data; the owner refreshes it from the cloud page; an editor may once allowed', T, async () => {
    const { owner, app } = ctx;
    const signIn = await owner.load(`${app}/auth/sign-in#key=${OWNER_KEY}`, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    await clickOn(signIn, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await signIn.waitFor(`location.href === ${JSON.stringify(`${app}/`)}`, 20000));

    const home = tmpDir('cf-data-home');
    const workspace = tmpDir('cf-data-agent');
    const bonus = path.join(workspace, 'bonus');
    fs.writeFileSync(bonus, '0');
    const port = await freePort();
    const env = {
      ...process.env,
      OPEN_ARTIFACT_HOME: home,
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
      OPEN_ARTIFACT_LINK_RETRY_MS: '200',
      OPEN_ARTIFACT_HARNESS: 'cli',
      OPEN_ARTIFACT_SESSION: 'e2e-cf-data',
      OPEN_ARTIFACT_CONNECTORS: writeTestConnectors(path.join(home, 'connectors')),
      SALES_MCP_BONUS_FILE: bonus,
    };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_PUBLISH']) delete env[name];
    let log = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(port)], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (log += chunk));
    ctx.daemon.stderr.on('data', chunk => (log += chunk));
    assert.ok(await until(() => fs.existsSync(path.join(home, 'daemon.json')), 30000), `the daemon did not start:\n${log}`);
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

    let approval = null;
    const linking = cli(['remote', 'add', 'cloud', app], text => {
      approval ??= /^Open(?:ed)? (\S+) in (?:your|a) browser/m.exec(text)?.[1] ?? null;
    });
    assert.ok(await until(() => approval, 20000), 'remote add printed no address');
    const approve = await owner.load(approval, { ready: "document.querySelector('button[name=decision][value=approve]')", ignore: IGNORE });
    await clickOn(approve, "document.querySelector('button[name=decision][value=approve]')", 'Approve');
    const linked = await linking;
    assert.equal(linked.code, 0, linked.stderr + log.slice(-1500));
    await approve.close();

    const folder = path.join(workspace, 'sales-and-signups');
    fs.cpSync(SAMPLE, folder, { recursive: true, filter: src => !/[\\/](_agent|history|data)([\\/]|$)/.test(src.slice(SAMPLE.length)) });
    const adopted = await cli(['artifact', JSON.stringify({ action: 'adopt', folder, type_url: 'open-artifact://type/data' })]);
    assert.equal(adopted.code, 0, adopted.stdout + adopted.stderr);
    const id = /art_[0-9a-z]+/.exec(JSON.parse(adopted.stdout).url)?.[0];
    const published = await cli(['publish', folder]);
    assert.equal(published.code, 0, published.stderr);
    assert.match(published.stdout, /^Its live data was not published: /m);
    const daemonState = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
    const confirmed = await fetch(`${daemonState.url}/api/open-artifact.artifacts.data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${daemonState.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, publish: true }),
    });
    assert.equal(confirmed.status, 200, await confirmed.text());
    assert.ok(await until(() => fs.existsSync(path.join(folder, 'db', 'data', 'live.json')), 60000), `no snapshot was taken:\n${log.slice(-2000)}`);

    const page = await owner.load(`${app}/a/${id}`, { ready: "location.hostname.endsWith('.content.localhost') && document.getElementById('root')?.childElementCount > 0", timeout: 45000, ignore: IGNORE });
    let line = '';
    assert.ok(await until(async () => /^Data as of .+’s computer/.test((line = (await asOf(page)) ?? '')), 60000), `no "Data as of" line: ${JSON.stringify(line)}\n${log.slice(-1500)}`);
    let first = '';
    assert.ok(await until(async () => shown((first = await revenue(page))), 30000), `the revenue total did not draw: ${JSON.stringify(first)}`);
    const before = await inFrame(page, TOOLBAR, 'performance.timeOrigin');

    fs.writeFileSync(bonus, '1000');
    await clickRefresh(page);
    let next = first;
    assert.ok(await until(async () => shown((next = await revenue(page))) && next !== first, 90000), `the figures did not change: ${first} → ${next}\n${log.slice(-1500)}`);
    assert.equal(await inFrame(page, TOOLBAR, 'performance.timeOrigin'), before, 'the editor frame reloaded');
    // The request went through the Worker's outbox, and was acknowledged.
    const rows = d1(ctx.state, `SELECT kind, acked_at FROM outbox WHERE kind = 'data-refresh'`);
    assert.ok(rows.length >= 1, JSON.stringify(rows));

    // An editor joins by the editor link: no Refresh while the owner keeps the agent to themselves; once the owner lets
    // editors ask the agent, the editor's page shows Refresh (no reload) and pressing it changes the figures.
    await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
    const editorRow = "document.querySelector('[data-share-link=editor]')";
    if (!(await page.waitFor(editorRow, 5000))) {
      await clickOn(page, "document.querySelector('[aria-label=\"General access\"]')", 'General access');
      await clickOn(page, byText('Anyone with the link'), 'Anyone with the link');
    }
    assert.ok(await page.waitFor(editorRow, 15000), 'no editor link row');
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
    assert.ok(await until(async () => shown((third = await revenue(enter))) && third !== next, 90000), `the editor's Refresh did not change the figures: ${next} → ${third}\n${log.slice(-1500)}`);
    assert.ok(await until(async () => (await revenue(page)) === third, 30000), 'the owner does not see the figures the editor refreshed');
    await enter.close();
    await page.close();
  });
});
