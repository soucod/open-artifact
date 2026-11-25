// End-to-end test of the MCP App view (`ShowArtifact`) in an MCP Apps host that keeps apps on a public address, as
// Codex does, in Chrome: a real daemon (in this process, from source, in a temporary home) with a user type `linked`,
// a static page.
//
// Chrome's Local Network Access blocks a page on a public address from framing one on this computer unless the
// top-level page holds the `loopback-network` permission, and such a host grants only the permissions an app
// declares. The host here is a page on 127.0.0.1 that Chrome is told is public (`--ip-address-space-overrides`); it
// frames the view from another such origin, with the CSP of the view's `_meta.ui.csp`, and speaks the host side of
// MCP Apps. It grants what the view's `_meta["openai/ui"].permissions` asks for, or denies it.
//
// Codex also keeps every http origin out of a card's `frame-src` (it frames only https pages there), so its cards
// refuse the daemon's page outright. `?csp=codex` serves the view with the CSP Codex builds.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 90000 };
/** The view's waits (`HELLO_MS`, `LINK_MS` in packages/daemon/src/mcp-app.ts). */
const HELLO_MS = 4000;
const LINK_MS = 3000;
/** Chrome's permission for each network permission an MCP App declares (as Codex maps them). */
const FEATURES = { loopbackNetwork: 'loopback-network', localNetwork: 'local-network' };
/** In the view's frame. */
const IN_VIEW = "location.pathname === '/view.html'";
/** In the static page, inside the Shell, inside the view: the page shows. */
const IN_PAGE = "location.hostname.endsWith('.frame.localhost') && !!document.querySelector('h1')";
/** Chrome's own lines about the blocked frame. */
const BLOCKED = [/LOCAL_NETWORK/, /favicon\.ico/];
/** Chrome's lines about a frame the CSP refused. */
const REFUSED = [/Content Security Policy/, /ERR_BLOCKED_BY_CSP/];

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  return fs.existsSync(path.join(repoRoot, 'dist', 'daemon', 'shell', 'index.html')) ? false : 'the Shell is not built (npm run build)';
}

/** A TCP port nobody listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** An http server on 127.0.0.1 at a free port. */
function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** A JSON value inside a <script>. */
const inScript = value => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * The host page: frames the view from `viewOrigin` and answers it as an MCP Apps host. `links`: how it answers
 * `ui/open-link` — `ok`, `error` (`isError`), `silent` (never), `none` (it offers no `openLinks`).
 */
function hostPage(viewOrigin, result, links, csp) {
  return `<!doctype html><meta charset="utf-8"><title>MCP Apps host</title>
<style>body{margin:0;font:14px sans-serif}iframe{display:block;border:0;width:100%;height:720px}</style>
<iframe id="view" src="${viewOrigin}/view.html${csp ? `?csp=${csp}` : ''}"></iframe>
<script>
const LINKS = ${inScript(links)}, RESULT = ${inScript(result)};
window.opened = [];
const view = document.getElementById('view');
addEventListener('message', (e) => {
  if (e.source !== view.contentWindow) return;
  const m = e.data;
  if (!m || m.jsonrpc !== '2.0' || m.method === undefined) return;
  const reply = (answer) => view.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, ...answer }, '*');
  if (m.method === 'ui/initialize') {
    reply({ result: { protocolVersion: m.params.protocolVersion, hostInfo: { name: 'e2e-host', version: '1' }, hostCapabilities: LINKS === 'none' ? {} : { openLinks: {} }, hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline'] } } });
  } else if (m.method === 'ui/notifications/initialized') {
    view.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [], structuredContent: RESULT } }, '*');
  } else if (m.method === 'ui/open-link') {
    window.opened.push(m.params.url);
    if (LINKS === 'ok') reply({ result: {} });
    else if (LINKS === 'error') reply({ result: { isError: true } });
  } else if (m.id !== undefined) reply({ result: {} });
});
</script>`;
}

/** The view's CSP, as a host builds it from `_meta.ui.csp`. */
function viewCsp(csp) {
  const list = domains => (domains?.length ? domains.join(' ') : "'none'");
  return `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src ${list(csp.connectDomains)}; frame-src ${list(csp.frameDomains)}`;
}

/**
 * The view's CSPs in a Codex card: its sandbox's own (https frames only), and the app's, from `_meta.ui.csp` with the
 * frame domains that are not https left out.
 */
function codexCsp(csp) {
  return ["frame-src 'self' https: data: blob:", viewCsp({ ...csp, frameDomains: (csp.frameDomains ?? []).filter(d => d.startsWith('https:')) })];
}

/** What the view shows: its notice and the buttons and address in it. */
async function viewState(page) {
  const expression = `${IN_VIEW} ? (() => {
    const $ = (id) => document.getElementById(id);
    const on = (id) => !$(id).hidden && $(id).getClientRects().length > 0;
    return { notice: on('notice'), why: $('why').textContent, retry: on('retry'), open: on('open2'), close: on('close'), where: on('where'), addr: $('addr').value, blocked: $('stage').classList.contains('blocked'), frame: getComputedStyle($('page')).visibility };
  })() : undefined`;
  return (await page.evaluateAll(expression)).find(v => v !== undefined) ?? null;
}

/** Whether the static page shows inside the view. */
async function pageShows(page) {
  return (await page.evaluateAll(`${IN_PAGE} ? true : undefined`)).includes(true);
}

/**
 * Clicks a button of the view with the real mouse, once the view has drawn it: Chrome picks the frame a click goes to
 * from what was last drawn, so a click on a notice that showed a moment ago would go to the page under it.
 */
async function clickInView(page, id) {
  await page.evaluateAll(`${IN_VIEW} ? new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))) : undefined`);
  const inner = (
    await page.evaluateAll(`${IN_VIEW} ? (() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null; })() : undefined`)
  ).find(v => v !== undefined);
  assert.ok(inner, `no #${id} to click in the view`);
  const at = await page.evaluate("(() => { const r = document.getElementById('view').getBoundingClientRect(); return [r.x, r.y]; })()");
  await page.click(at[0] + inner[0], at[1] + inner[1]);
}

describe('the MCP App view in a host on a public address', { skip: skip() }, () => {
  const ctx = {};

  /** Grants (or denies) the host page what the view declares, as the host would. */
  async function permit(setting) {
    for (const feature of ctx.features) await ctx.blank.cdp('Browser.setPermission', { permission: { name: feature }, setting, origin: ctx.hostOrigin });
  }

  /** Opens the host page; `ready` is when it is up. `csp`: `codex` for the CSP of a Codex card. */
  function openHost(links, ready, ignore = [], csp = '') {
    return ctx.browser.load(`${ctx.hostOrigin}/host?links=${links}${csp ? `&csp=${csp}` : ''}`, { ready, ignore: [/favicon\.ico/, ...ignore], settle: 200 });
  }

  before(async () => {
    const tmp = tmpDir('mcp-app');
    const type = path.join(tmp, 'types', 'linked');
    fs.mkdirSync(type, { recursive: true });
    fs.writeFileSync(path.join(type, 'artifact-type.json'), JSON.stringify({ name: 'Linked', description: 'A static page.', when: 'Never.' }));
    fs.writeFileSync(path.join(type, 'index.html'), '<!doctype html><meta charset="utf-8"><title>One</title><h1>One</h1>\n');
    const root = path.join(tmp, 'artifact');
    fs.mkdirSync(root);
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION']) delete process.env[name];
    Object.assign(process.env, {
      OPEN_ARTIFACT_HOME: path.join(tmp, 'home'),
      OPEN_ARTIFACT_USER_TYPES: path.join(tmp, 'types'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmp, 'servers'),
    });
    const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
    ctx.daemon = await startDaemon({ port: await freePort(), idleMs: 0, quiet: true, browse: null });
    const id = ctx.daemon.store.create({ root, type: 'linked', title: 'Shown in the chat' }).id;

    // What an MCP Apps client gets: the view resource and ShowArtifact's result.
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.daemon.token}`, 'X-Open-Artifact-UI': '1', 'X-Open-Artifact-Harness': 'dsh', 'X-Open-Artifact-Session': 'mcp-app-e2e' };
    const rpc = async (method, params) => {
      const body = await (await fetch(`${ctx.daemon.origin}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
      assert.equal(body.error, undefined, `${method}: ${body.error?.message}`);
      return body.result;
    };
    ctx.view = (await rpc('resources/read', { uri: 'ui://open-artifact/view.html' })).contents[0];
    const shown = await rpc('tools/call', { name: 'ShowArtifact', arguments: { url: `open-artifact://artifact/${id}` } });
    assert.equal(shown.isError, false);
    ctx.result = shown.structuredContent;
    assert.equal(ctx.result.view_url, `${ctx.daemon.origin}/a/${id}`);
    const declared = Object.keys(ctx.view._meta?.['openai/ui']?.permissions ?? {});
    ctx.features = declared.map(name => FEATURES[name]).filter(Boolean);

    // The host's page and the view's own origin, both on addresses Chrome takes for public ones.
    const viewServer = await listen((req, res) => {
      const url = new URL(req.url, 'http://view');
      if (url.pathname !== '/view.html') return res.writeHead(404).end();
      const csp = url.searchParams.get('csp') === 'codex' ? codexCsp(ctx.view._meta.ui.csp) : viewCsp(ctx.view._meta.ui.csp);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp }).end(ctx.view.text);
    });
    ctx.viewOrigin = `http://127.0.0.1:${viewServer.address().port}`;
    const hostServer = await listen((req, res) => {
      const url = new URL(req.url, 'http://host');
      if (url.pathname === '/blank') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>blank</title>');
      if (url.pathname !== '/host') return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(hostPage(ctx.viewOrigin, ctx.result, url.searchParams.get('links') ?? 'ok', url.searchParams.get('csp') ?? ''));
    });
    ctx.hostOrigin = `http://127.0.0.1:${hostServer.address().port}`;
    ctx.servers = [viewServer, hostServer];
    ctx.browser = await launch({ width: 1100, height: 820, args: [`--ip-address-space-overrides=127.0.0.1:${hostServer.address().port}=public,127.0.0.1:${viewServer.address().port}=public`] });
    ctx.blank = await ctx.browser.load(`${ctx.hostOrigin}/blank`, { settle: 100 });
  });

  after(async () => {
    await ctx.browser?.close();
    for (const server of ctx.servers ?? []) server.close();
    await ctx.daemon?.close();
    removeTmp();
  });

  it('declares the loopback permission, and a host that grants it shows the page', T, async () => {
    assert.deepEqual(ctx.view._meta['openai/ui'], { permissions: { loopbackNetwork: {} } }, 'the view does not ask for the network permission its frame needs');
    await permit('granted');
    const page = await openHost('ok', IN_PAGE);
    try {
      assert.ok(await pageShows(page), `the page did not show in the view: ${page.problems.join('; ')}`);
      await sleep(HELLO_MS + 1000);
      const state = await viewState(page);
      assert.equal(state.notice, false, `the view says the page did not show: ${state.why}`);
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });

  it('says when the host blocks the page, opens it through the host, and shows it on Retry once allowed', T, async () => {
    await permit('denied');
    const page = await openHost('ok', `${IN_VIEW} && !document.getElementById('notice').hidden`, BLOCKED);
    try {
      let state = await viewState(page);
      assert.ok(state?.notice, 'the view never said the page did not show');
      assert.ok(state.why.includes(new URL(ctx.result.view_url).host), `the notice does not name the page's address: ${state.why}`);
      assert.deepEqual([state.retry, state.open, state.where, state.close, state.blocked], [true, true, true, false, false]);
      assert.equal(state.addr, ctx.result.view_url);
      assert.equal(await pageShows(page), false, 'the blocked page shows anyway');

      await clickInView(page, 'open2');
      assert.ok(await page.waitFor(`(window.opened || []).length === 1`, 5000), 'Open in browser did not ask the host to open the page');
      assert.deepEqual(await page.evaluate('window.opened'), [ctx.result.view_url]);
      await sleep(LINK_MS + 500);
      state = await viewState(page);
      assert.doesNotMatch(state.why, /did not open/, 'the host opened the page, yet the view says it may not have');

      // The person allows the app in the host, then presses Retry.
      await permit('granted');
      await clickInView(page, 'retry');
      assert.ok(await page.waitFor(IN_PAGE, 20000), 'Retry did not show the page');
      assert.ok(await page.waitFor(`${IN_VIEW} && document.getElementById('notice').hidden`, 5000), 'the notice stayed after the page showed');
    } finally {
      await page.close();
    }
  });

  it('shows the address to copy when the host does not open the link', T, async () => {
    await permit('granted');
    for (const links of ['error', 'silent', 'none']) {
      const page = await openHost(links, IN_PAGE);
      try {
        const started = Date.now();
        await clickInView(page, 'open');
        assert.ok(await page.waitFor(`${IN_VIEW} && !document.getElementById('where').hidden`, LINK_MS + 3000), `${links}: the view never showed the address`);
        const waited = Date.now() - started;
        if (links === 'silent') assert.ok(waited >= LINK_MS - 500, `${links}: the address showed after ${waited} ms, before the host had time to answer`);
        else assert.ok(waited < LINK_MS - 500, `${links}: the address showed after ${waited} ms, at the timeout rather than on the host's answer`);
        const state = await viewState(page);
        assert.equal(state.addr, ctx.result.view_url, links);
        assert.deepEqual([state.retry, state.open, state.close], [false, false, true], links);
        assert.deepEqual(await page.evaluate('window.opened'), links === 'none' ? [] : [ctx.result.view_url], links);
        await clickInView(page, 'close');
        assert.ok(await page.waitFor(`${IN_VIEW} && document.getElementById('notice').hidden`, 3000), `${links}: Close left the notice`);
        assert.ok(await pageShows(page), `${links}: the page went away`);
      } finally {
        await page.close();
      }
    }
  });

  it('says at once when the host refuses to frame the page, as a Codex card does, and opens it through the host', T, async () => {
    await permit('granted');
    const started = Date.now();
    const page = await openHost('ok', `${IN_VIEW} && !document.getElementById('notice').hidden`, REFUSED, 'codex');
    try {
      const waited = Date.now() - started;
      let state = await viewState(page);
      assert.ok(state?.notice, `the view never said the page did not show: ${page.problems.join('; ')}`);
      assert.ok(waited < HELLO_MS, `the notice showed after ${waited} ms, by the timeout rather than on the refusal`);
      assert.ok(state.blocked, 'the view did not see the refusal');
      assert.match(state.why, /does not let/);
      assert.ok(state.why.includes(new URL(ctx.result.view_url).host), `the notice does not name the page's address: ${state.why}`);
      assert.deepEqual([state.retry, state.open, state.where, state.close], [false, true, true, false], 'a refused page needs no Retry');
      assert.equal(state.addr, ctx.result.view_url);
      assert.equal(state.frame, 'hidden', "the browser's own error page shows under the notice");
      assert.equal(await pageShows(page), false);

      await clickInView(page, 'open2');
      assert.ok(await page.waitFor(`(window.opened || []).length === 1`, 5000), 'Open in browser did not ask the host to open the page');
      assert.deepEqual(await page.evaluate('window.opened'), [ctx.result.view_url]);
      await sleep(HELLO_MS + 500);
      state = await viewState(page);
      assert.deepEqual([state.notice, state.blocked, state.retry], [true, true, false], 'the notice changed after the timeout');
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });
});
