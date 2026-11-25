// Harness compatibility: a host built from the reference host's modules (examples/harness-node: connectHarness,
// ScriptedAgent, wakeHandler, registerTools) against a real daemon (`open-artifact daemon run`, from source) in a
// temporary OPEN_ARTIFACT_HOME, with two user types: `note` (a static page) and `farstub` (a URL type at
// `http://0.0.0.0:<port>/far/{id}`: remote, since 0.0.0.0 is not a loopback name, yet answered by a stub on this
// computer). Two hosts connect: `compat-frame` frames the Shell from page origin A (`embed.mode: frame`,
// `embed.remote: deny`) and `compat-view` shows top-level views (`embed.mode: view`, `embed.remote: allow`).
//
//  (a) `open-artifact doctor --harness compat-frame --session compat-1 --json` (the conformance script) passes every
//      step end to end, as a separate process; the host gets one host.open and one wake from the owner; the
//      remote-type check warns that compat-frame denies the remote type and names the fallback.
//  (b) In Chrome, frame cases (host pages on two 127.0.0.1 ports; each frames the Shell and answers `shell_hello`):
//      - origin A (declared): the Shell takes `host_hello`, says `shell_ready`, and the Ask sends `comment_summon`
//        with the text (and wakes the owner session);
//      - origin B while A is declared: nothing after `shell_hello`, not even after an Ask;
//      - origin B with no origin declared at all (compat-frame gone): the parent is taken (`shell_ready`) but the Ask's
//        `comment_summon` comes with no text.
//  (c) Top-level view: `host.open` with `embed: 'view'` carries a ticket and `embed_url`; the Shell claims it (in
//      Chrome: loaded at `embed_url`; without a browser: claimed from Node, as the Shell would), the ticket leaves the
//      address bar (Chrome only), `shell.command` reaches the Shell and `shell.event` the adapter, and the ticket cannot
//      be claimed twice.
//  (d) Remote type: `host.open` for a farstub artifact carries `remote` {type, origins}; the `deny` host's `open` is
//      never called for it.
//  (e) The DSH plugin's runtime: a host saying in `hello` the runtime the plugin declares (`runtimeOf()` of
//      plugins/dsh, the built plugin folder) is recorded by the daemon in `runtimes.json` and listed by
//      `runtime status` as a registered runtime; nothing is logged as "not recorded". Skipped when plugins/dsh is not built.
//
// With --no-browser the Chrome cases are skipped (each says so) and the rest runs. The run against the two previous
// minor versions of @open-artifact/harness-kit from npm has a place of its own at the end, skipped: the kit is not
// published yet.
//
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { api, createHarness, readDaemon } from '@open-artifact/harness-kit';
import { ScriptedAgent } from '../examples/harness-node/agent.mjs';
import { callerOf, connectHarness } from '../examples/harness-node/harness.mjs';
import { registerTools } from '../examples/harness-node/tools.mjs';
import { wakeHandler } from '../examples/harness-node/wakes.mjs';
import { findChrome, launch } from './lib/browser.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 180000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const SHELL_BUILT = path.join(repoRoot, 'dist', 'daemon', 'shell', 'index.html');
const AGENT = 'Compat';

/** Why the Chrome cases cannot run here, or false. */
function noBrowser() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  if (!fs.existsSync(SHELL_BUILT)) return 'the Shell is not built (npm run build): no dist/daemon/shell/index.html';
  return false;
}
const browserSkip = noBrowser();
const DSH_PLUGIN = path.join(repoRoot, 'plugins', 'dsh');
const dshSkip = fs.existsSync(path.join(DSH_PLUGIN, 'vendor', 'open-artifact.mjs')) ? false : 'plugins/dsh is not built (npm run build): no vendor/open-artifact.mjs';
if (dshSkip) console.log(`# harness-compat: the DSH runtime case skipped: ${dshSkip}`);
if (browserSkip) console.log(`# harness-compat: Chrome cases skipped: ${browserSkip}`);

/** A TCP port nobody listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
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

/** Runs the CLI (asynchronously: the hosts in this process keep answering the daemon meanwhile). */
function cli(args, env, cwd) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), 150000);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Listens on 127.0.0.1 with `handler`; resolves with the server and its port. */
function serve(handler) {
  return new Promise(resolve => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * The host page: frames the Shell given as `?shell=`, keeps every message the Shell posts (`window.got`), and answers
 * `shell_hello` with `host_hello`, as a host app's web view would. The frame sits at the page's top left, so a point
 * in the frame is the same point in the page.
 */
const HOST_PAGE = `<!doctype html><meta charset="utf-8"><title>host</title>
<body style="margin:0">
<iframe id="shell" style="position:absolute;left:0;top:0;width:1200px;height:800px;border:0"></iframe>
<script>
  window.got = [];
  const frame = document.getElementById('shell');
  addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return;
    window.got.push({ origin: event.origin, data: event.data });
    if (event.data && event.data.openArtifact === 'shell_hello') {
      frame.contentWindow.postMessage({ openArtifact: 'host_hello', caps: {}, agentName: ${JSON.stringify(AGENT)}, protocol: event.data.protocol }, event.origin);
    }
  });
  frame.src = new URLSearchParams(location.search).get('shell');
</script>`;

/** What the host page has heard from the Shell so far, by message type. */
const heard = page => page.evaluate('window.got.map(m => m.data && m.data.openArtifact)');

/** In the Shell's frame only: the middle of the element `selector` finds, or null. */
const shellPoint = selector =>
  `(() => { if (!location.pathname.startsWith('/a/')) return undefined; const e = ${selector}; if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()`;
const ASK_BUTTON = `[...document.querySelectorAll('button[aria-expanded]')].find(b => /^(Ask|问) /.test(b.textContent.trim()))`;
const ASK_TEXT = `document.querySelector('aside textarea') || document.querySelector('textarea')`;

/** Clicks the Shell's Ask, types `text` in the pane and sends it with Enter: real mouse and keys. */
async function askFromPage(page, text) {
  let at = null;
  await until(async () => (at = (await page.evaluateAll(shellPoint(ASK_BUTTON))).find(Array.isArray)), 20000, 200);
  assert.ok(at, 'the Shell shows no Ask button');
  await page.click(...at);
  // The pane slides in: click the text box where it is now until it has the focus.
  const focused = `location.pathname.startsWith('/a/') ? document.activeElement === (${ASK_TEXT}) : undefined`;
  const inBox = await until(async () => {
    const box = (await page.evaluateAll(shellPoint(ASK_TEXT))).find(Array.isArray);
    if (!box) return false;
    await page.click(...box);
    return (await page.evaluateAll(focused)).includes(true);
  }, 10000, 300);
  assert.ok(inBox, 'the Ask pane has no text box to type in');
  await page.type(text);
  await page.press('Enter');
}

describe('harness compatibility: the reference host against a real daemon', () => {
  const ctx = { opened: { frame: [], view: [] }, shellEvents: [] };

  before(async () => {
    const root = tmpDir('harness-compat');
    ctx.home = path.join(root, 'home');
    const types = path.join(root, 'types');
    const builtin = path.join(root, 'builtin');
    ctx.workspace = path.join(root, 'work');
    for (const dir of [types, builtin, ctx.workspace]) fs.mkdirSync(dir, { recursive: true });

    // The remote type's server: any page, and its health and actions routes. It records what it is sent.
    ctx.stubHits = [];
    const stub = await serve((req, res) => {
      ctx.stubHits.push({ method: req.method, url: req.url, auth: req.headers.authorization });
      const p = new URL(req.url, 'http://x').pathname;
      if (p.endsWith('/__open-artifact/health')) return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"openArtifact":1}');
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>far</title><p>A page from another computer.</p>');
    });
    ctx.stub = stub.server;
    ctx.stubPort = stub.port;
    const note = path.join(types, 'note');
    fs.mkdirSync(note);
    fs.writeFileSync(path.join(note, 'artifact-type.json'), JSON.stringify({ name: 'Note', description: 'A one-page note as a local HTML file.', when: 'The person wants a short note.' }));
    fs.writeFileSync(path.join(note, 'index.html'), '<!doctype html><meta charset="utf-8"><title>note</title><h1>A note</h1>\n');
    const far = path.join(types, 'farstub');
    fs.mkdirSync(far);
    fs.writeFileSync(path.join(far, 'artifact-type.json'), JSON.stringify({ name: 'Far stub', description: 'A URL type served by another computer.', entry: { url: `http://0.0.0.0:${stub.port}/far/{id}` } }));

    // The host pages, on two origins.
    const pageA = await serve((req, res) => (req.url.startsWith('/favicon') ? res.writeHead(204).end() : res.writeHead(200, { 'content-type': 'text/html' }).end(HOST_PAGE)));
    const pageB = await serve((req, res) => (req.url.startsWith('/favicon') ? res.writeHead(204).end() : res.writeHead(200, { 'content-type': 'text/html' }).end(HOST_PAGE)));
    ctx.pages = [pageA.server, pageB.server];
    ctx.originA = `http://127.0.0.1:${pageA.port}`;
    ctx.originB = `http://127.0.0.1:${pageB.port}`;

    ctx.env = {
      ...process.env,
      OPEN_ARTIFACT_HOME: ctx.home,
      OPEN_ARTIFACT_USER_TYPES: types,
      OPEN_ARTIFACT_BUILTIN_TYPES: builtin,
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
      OPEN_ARTIFACT_WAKE_MERGE_MS: '20',
    };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION']) delete ctx.env[name];
    ctx.daemonLog = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(await freePort())], { env: ctx.env, cwd: ctx.workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (ctx.daemonLog += chunk));
    ctx.daemon.stderr.on('data', chunk => (ctx.daemonLog += chunk));
    ctx.stopDaemon = () => ctx.daemon.exitCode === null && ctx.daemon.kill('SIGKILL');
    process.on('exit', ctx.stopDaemon);
    assert.ok(await until(() => fs.existsSync(path.join(ctx.home, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.daemonLog}`);
    ctx.state = await readDaemon(ctx.home);

    // compat-frame: the reference host, framing the Shell from origin A; remote pages denied.
    ctx.frameAgent = new ScriptedAgent({ id: 'compat-1', workspace: ctx.workspace, title: 'Compat chat' });
    ctx.frameWakes = [];
    ctx.frame = await connectHarness({
      name: 'compat-frame',
      agentName: AGENT,
      home: ctx.home,
      autoStart: false,
      // The display name the Shell's Ask pane uses for the owner session, in place of the id `compat-frame`.
      profile: { title: 'Compat Frame' },
      rules: 'Ask the person before publishing anything in this app.',
      policy: { roles: { subagent: { create: false } } },
      embed: { origins: [ctx.originA], mode: 'frame', remote: 'deny' },
      open: request => void ctx.opened.frame.push(request),
      wake: wakeHandler(new Map([[ctx.frameAgent.id, ctx.frameAgent]]), { onWake: params => ctx.frameWakes.push(params) }),
    });
    await ctx.frame.attach({ ...callerOf(ctx.frameAgent), title: ctx.frameAgent.title, status: 'idle' });
    await registerTools(ctx.frame, ctx.frameAgent);

    // compat-view: top-level views, remote pages allowed.
    ctx.viewAgent = new ScriptedAgent({ id: 'view-1', workspace: ctx.workspace, title: 'Viewer chat' });
    ctx.view = await connectHarness({
      name: 'compat-view',
      agentName: 'Viewer',
      home: ctx.home,
      autoStart: false,
      embed: { origins: [], mode: 'view', remote: 'allow' },
      open: request => void ctx.opened.view.push(request),
      wake: wakeHandler(new Map([[ctx.viewAgent.id, ctx.viewAgent]])),
    });
    ctx.view.on('shell', event => ctx.shellEvents.push(event));
    await ctx.view.attach({ ...callerOf(ctx.viewAgent), title: ctx.viewAgent.title, status: 'idle' });
    await registerTools(ctx.view, ctx.viewAgent);

    /** Makes an artifact of `type` as `agent`'s session, not shown yet. */
    ctx.make = async (agent, type, title) => {
      const quick = await agent.runTool('Artifact', { action: 'quickstart', type });
      assert.ok(quick.create, `quickstart ${type}: ${JSON.stringify(quick).slice(0, 400)}`);
      const made = await agent.runTool('Artifact', { ...quick.create, title, open: 'never' });
      assert.equal(made.error, undefined, JSON.stringify(made.error));
      return made;
    };
  });

  after(async () => {
    await ctx.browser?.close();
    ctx.frame?.close();
    ctx.view?.close();
    for (const server of [ctx.stub, ...(ctx.pages ?? [])]) server?.close();
    await stop(ctx.daemon);
    if (ctx.stopDaemon) process.off('exit', ctx.stopDaemon);
    removeTmp();
  });

  it('(a) the conformance script passes every step against the host, end to end', T, async t => {
    const run = await cli(['doctor', '--harness', 'compat-frame', '--session', 'compat-1', '--json'], ctx.env, ctx.workspace);
    let report;
    try {
      report = JSON.parse(run.stdout);
    } catch {
      assert.fail(`doctor printed no JSON (exit ${run.code}):\n${run.stdout}\n${run.stderr}`);
    }
    const lines = report.findings.map(f => `${f.status.padEnd(4)} ${f.id}: ${f.message}${f.fix ? ` (${f.fix})` : ''}`).join('\n');
    t.diagnostic(`doctor exit ${run.code}:\n${lines}`);
    assert.equal(report.harness, 'compat-frame');
    assert.equal(report.session, 'compat-1');
    const steps = report.findings.filter(f => f.id.startsWith('conformance.'));
    const order = [...new Set(steps.map(f => f.id))];
    assert.deepEqual(order, ['discovery', 'profile', 'session', 'tools', 'commands', 'open', 'wake', 'rules', 'context', 'registration', 'cleanup'].map(s => `conformance.${s}`), lines);
    assert.deepEqual(steps.filter(f => f.status === 'fail'), [], lines);
    // Each step's verdict (its first finding) is ok: the host declared everything the steps check.
    for (const id of order) assert.equal(steps.find(f => f.id === id).status, 'ok', `${id}\n${lines}`);
    // What needs a person or a real browser is n/a, with why.
    assert.ok(steps.some(f => f.id === 'conformance.open' && f.status === 'n/a' && f.fix), lines);
    assert.ok(steps.some(f => f.id === 'conformance.wake' && f.status === 'n/a'), lines);
    // The host saw exactly what doctor did: one host.open, one wake from the owner; its session is still attached.
    assert.equal(ctx.opened.frame.length, 1, 'one host.open');
    assert.equal(ctx.frameWakes.length, 1, 'one wake');
    assert.equal(ctx.frameWakes[0].source?.from?.kind, 'owner');
    const harnesses = await api(ctx.state, 'harnesses');
    assert.ok(JSON.stringify(harnesses).includes('compat-1'), 'the session is still known');
    const left = (await api(ctx.state, 'artifacts')).artifacts?.filter(a => a.title?.startsWith('open-artifact doctor test')) ?? [];
    assert.deepEqual(left, [], 'doctor removed its test artifact');
    // The remote-type check: the stub answers, and compat-frame (deny) is warned with the fallback.
    const remote = report.findings.filter(f => f.id === 'remote-types');
    assert.ok(remote.some(f => f.status === 'ok' && /farstub/.test(f.message)), lines);
    assert.ok(remote.some(f => f.status === 'warn' && /farstub/.test(f.message) && /deny/.test(f.message)), lines);
    assert.ok(ctx.stubHits.every(h => !h.auth), 'the remote type was sent no token');
  });

  it('(d) host.open for a remote type carries `remote`; the deny host is not asked to open it', T, async () => {
    const before = ctx.opened.frame.length;
    const far = await ctx.make(ctx.frameAgent, 'farstub', 'A far page');
    const opened = await ctx.frame.open(far.url, callerOf(ctx.frameAgent));
    assert.equal(ctx.opened.frame.length, before, `the deny host's open was called: ${JSON.stringify(ctx.opened.frame.at(-1))}`);
    assert.notEqual(opened.opened, true, `not shown in the host: ${JSON.stringify(opened)}`);

    const mine = await ctx.make(ctx.viewAgent, 'farstub', 'A far page for the viewer');
    await ctx.view.open(mine.url, callerOf(ctx.viewAgent));
    const request = ctx.opened.view.find(r => r.url === mine.url);
    assert.ok(request, 'the allow host was asked to open it');
    assert.deepEqual(request.remote, { type: 'farstub', origins: [`http://0.0.0.0:${ctx.stubPort}`] });
  });

  it('(e) the runtime the DSH plugin declares in hello is recorded and listed as registered', { ...T, skip: dshSkip }, async () => {
    const { runtimeOf } = await import('../plugins/dsh/src/server/vendor.ts');
    const runtime = runtimeOf();
    assert.equal(runtime.dir, DSH_PLUGIN);
    const host = await createHarness({ harness: 'compat-dsh', agentName: 'Agent', home: ctx.home, autoStart: false, runtime, caps: { tools: 'native', library: 'own' }, wake: () => 'queued' });
    try {
      await host.ready();
      const recorded = () => JSON.parse(fs.readFileSync(path.join(ctx.home, 'runtimes.json'), 'utf8')).runtimes.find(r => r.harness === 'compat-dsh');
      assert.ok(await until(() => fs.existsSync(path.join(ctx.home, 'runtimes.json')) && recorded(), 15000), `not recorded:\n${ctx.daemonLog}`);
      assert.deepEqual({ dir: recorded().dir, version: recorded().version, update: recorded().update }, { dir: DSH_PLUGIN, version: runtime.version, update: 'bundled' });
      const log = fs.readFileSync(path.join(ctx.home, 'logs', 'daemon.log'), 'utf8');
      assert.match(log, /adapter compat-dsh connected/);
      assert.doesNotMatch(log, /compat-dsh.*not recorded/);
      const status = await cli(['runtime', 'status', '--json'], ctx.env, ctx.workspace);
      const listed = JSON.parse(status.stdout).runtimes.find(r => r.source === 'registered' && r.dir === DSH_PLUGIN);
      assert.ok(listed, status.stdout);
      assert.equal(listed.version, runtime.version);
      assert.equal(listed.harness, 'compat-dsh');
    } finally {
      host.close();
    }
  });

  it('(c) a top-level view without a browser: the ticket is claimed once, commands and events pass', T, async () => {
    const made = await ctx.make(ctx.viewAgent, 'note', 'A view note');
    const id = made.url.split('/').pop();
    await ctx.view.open(made.url, callerOf(ctx.viewAgent));
    const request = ctx.opened.view.find(r => r.url === made.url);
    assert.ok(request?.view, `host.open carries a ticket: ${JSON.stringify(request)}`);
    assert.equal(request.embedUrl, `${ctx.state.url}/a/${id}?oa_view=${request.view}`);

    // The claim, as the Shell makes it (no Origin header: a same-origin GET may send none).
    const claim = `${ctx.state.url}/api/open-artifact.view?view=${encodeURIComponent(request.view)}&id=${id}`;
    const controller = new AbortController();
    const stream = await fetch(claim, { signal: controller.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    let text = '';
    const read = async word => until(async () => {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
      return text.includes(word);
    }, 10000, 0);
    assert.ok(await read('event: view'), text);
    const { key } = JSON.parse(/event: view\ndata: (.*)\n/.exec(text)[1]);
    assert.ok(key);
    assert.equal((await fetch(claim)).status, 404, 'the ticket is used once');

    await ctx.view.shellCommand(request.view, { openArtifact: 'host_hello', caps: {}, agentName: 'Viewer' });
    assert.ok(await read('host_hello'), `the command came down the stream: ${text}`);
    const sent = await fetch(`${ctx.state.url}/api/open-artifact.view`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx.state.url },
      body: JSON.stringify({ view: request.view, key, event: { openArtifact: 'shell_ready', artifact: made.url } }),
    });
    assert.equal(sent.status, 200);
    assert.ok(await until(() => ctx.shellEvents.some(e => e.view === request.view && e.event.openArtifact === 'shell_ready'), 5000), 'shell.event reached the adapter');
    controller.abort();
  });

  it('(c) a top-level view in Chrome: the Shell claims the ticket, which leaves the address; command and event pass', { ...T, skip: browserSkip }, async () => {
    ctx.browser ??= await launch();
    const made = await ctx.make(ctx.viewAgent, 'note', 'A view note in Chrome');
    await ctx.view.open(made.url, callerOf(ctx.viewAgent));
    const request = ctx.opened.view.find(r => r.url === made.url);
    assert.ok(request?.view && request.embedUrl.includes('oa_view='), JSON.stringify(request));
    const page = await ctx.browser.load(request.embedUrl, { ready: "document.querySelector('header') !== null" });
    assert.ok(await until(() => ctx.shellEvents.some(e => e.view === request.view && e.event.openArtifact === 'shell_hello'), 15000), 'the Shell said shell_hello through the view channel');
    assert.equal(await page.evaluate(`new URLSearchParams(location.search).has('oa_view')`), false, 'the ticket left the address bar');
    await ctx.view.shellCommand(request.view, { openArtifact: 'host_hello', caps: {}, agentName: 'Viewer' });
    assert.ok(await until(() => ctx.shellEvents.some(e => e.view === request.view && e.event.openArtifact === 'shell_ready'), 15000), 'the Shell took the command and its answer reached the adapter');
    const again = await fetch(`${ctx.state.url}/api/open-artifact.view?view=${encodeURIComponent(request.view)}&id=${made.url.split('/').pop()}`);
    assert.equal(again.status, 404, 'the ticket is used once');
    await page.close();
  });

  it('(c) a ticketed Shell in another page\'s frame talks through the daemon, not to its parent', { ...T, skip: browserSkip }, async () => {
    ctx.browser ??= await launch();
    const made = await ctx.make(ctx.viewAgent, 'note', 'A framed view note');
    await ctx.view.open(made.url, callerOf(ctx.viewAgent));
    const request = ctx.opened.view.find(r => r.url === made.url);
    assert.ok(request?.view && request.embedUrl.includes('oa_view='), JSON.stringify(request));
    // A host whose origin cannot be declared (a file:// app) frames the ticketed address.
    const page = await ctx.browser.load(`${ctx.originB}/?shell=${encodeURIComponent(request.embedUrl)}`, { ready: 'Array.isArray(window.got)' });
    assert.ok(await until(() => ctx.shellEvents.some(e => e.view === request.view && e.event.openArtifact === 'shell_hello'), 15000), 'the framed Shell said shell_hello through the view channel');
    await ctx.view.shellCommand(request.view, { openArtifact: 'host_hello', caps: {}, agentName: 'Viewer' });
    assert.ok(await until(() => ctx.shellEvents.some(e => e.view === request.view && e.event.openArtifact === 'shell_ready'), 15000), 'the command reached the framed Shell and its answer the adapter');
    assert.deepEqual(await heard(page), [], 'the parent page is not the host: it hears nothing');
    await page.close();
  });

  it('(b) a page on the declared origin frames the Shell, is taken, and gets the prompt text', { ...T, skip: browserSkip }, async () => {
    ctx.browser ??= await launch();
    ctx.framed = await ctx.make(ctx.frameAgent, 'note', 'A framed note');
    const shell = `${ctx.state.url}/a/${ctx.framed.url.split('/').pop()}`;
    ctx.hostPage = origin => `${origin}/?shell=${encodeURIComponent(shell)}`;
    const page = await ctx.browser.load(ctx.hostPage(ctx.originA), { ready: "window.got && window.got.some(m => m.data && m.data.openArtifact === 'shell_hello')" });
    assert.ok(await page.waitFor("window.got.some(m => m.data && m.data.openArtifact === 'shell_ready')", 15000), `taken: ${JSON.stringify(await heard(page))}`);
    const wakes = ctx.frameWakes.length;
    await askFromPage(page, 'Make the heading blue');
    // The pane names the owner session by the harness's title from its profile, not by its id.
    const paneText = async () => (await page.evaluateAll("location.pathname.startsWith('/a/') ? document.querySelector('aside')?.innerText ?? '' : undefined")).find(text => typeof text === 'string') ?? '';
    assert.ok(await until(async () => (await paneText()).includes('Compat Frame'), 10000, 200), `the Ask pane does not name the harness by its title: ${JSON.stringify(await paneText())}`);
    assert.ok(!(await paneText()).includes('compat-frame'), 'the Ask pane shows the harness id');
    assert.ok(await page.waitFor("window.got.some(m => m.data && m.data.openArtifact === 'comment_summon')", 15000), `no comment_summon: ${JSON.stringify(await heard(page))} ${JSON.stringify(await page.evaluateAll("location.pathname.startsWith('/a/') ? [document.activeElement?.tagName, (document.querySelector('textarea')||{}).value, document.querySelector('aside [role=status]')?.textContent, document.querySelector('aside')?.innerText.slice(0,300)] : undefined"))} ${JSON.stringify(page.problems)}`);
    const summon = await page.evaluate("window.got.find(m => m.data.openArtifact === 'comment_summon').data");
    assert.equal(summon.text, 'Make the heading blue');
    assert.ok(await until(() => ctx.frameWakes.length > wakes, 10000), 'the Ask woke the owner session');
    await page.close();
  });

  it('(b) a page on another origin, while one is declared, gets nothing after shell_hello', { ...T, skip: browserSkip }, async () => {
    assert.ok(ctx.hostPage, 'the declared-origin case ran first');
    const page = await ctx.browser.load(ctx.hostPage(ctx.originB), { ready: "window.got && window.got.some(m => m.data && m.data.openArtifact === 'shell_hello')" });
    const wakes = ctx.frameWakes.length;
    await askFromPage(page, 'This should not reach the host');
    // The Ask itself went through (the owner session was woken); only the host page heard nothing of it.
    assert.ok(await until(() => ctx.frameWakes.length > wakes, 10000), 'the Ask was sent');
    await sleep(2000);
    assert.deepEqual(await heard(page), ['shell_hello'], 'nothing after shell_hello');
    await page.close();
  });

  it('(b) with no origin declared at all, the parent is taken but gets no prompt or comment text', { ...T, skip: browserSkip }, async () => {
    assert.ok(ctx.hostPage, 'the declared-origin case ran first');
    // The only host that declared an origin goes; compat-view declared none.
    ctx.frame.close();
    ctx.frame = null;
    assert.ok(await until(async () => (await api(ctx.state, 'embed')).hosts?.length === 0, 10000), 'no declared host origins left');
    const page = await ctx.browser.load(ctx.hostPage(ctx.originB), { ready: "window.got && window.got.some(m => m.data && m.data.openArtifact === 'shell_hello')" });
    assert.ok(await page.waitFor("window.got.some(m => m.data && m.data.openArtifact === 'shell_ready')", 15000), `taken: ${JSON.stringify(await heard(page))}`);
    await askFromPage(page, 'Secret words for the agent only');
    assert.ok(await page.waitFor("window.got.some(m => m.data && m.data.openArtifact === 'comment_summon')", 15000), `no comment_summon: ${JSON.stringify(await heard(page))}`);
    const summon = await page.evaluate("window.got.find(m => m.data.openArtifact === 'comment_summon').data");
    assert.equal(summon.text, '', 'an undeclared host gets no comment text');
    await page.close();
  });
});

// The same cases against the two previous minor versions of @open-artifact/harness-kit from npm (design 18.3). It
// plugs in here: install `@open-artifact/harness-kit@~<minor>` for each of the two minors before this one into a
// temporary folder, import its `createHarness` in place of the workspace kit (connectHarness takes it as an option
// once that exists, or a copy of examples/harness-node/harness.mjs imports from that folder), and run the describe above
// with it. Until the kit is published there is nothing to install, so it is skipped, saying so.
describe('harness compatibility: the two previous minor versions of harness-kit from npm', { skip: 'not run: @open-artifact/harness-kit is not published to npm yet (and this run makes no network requests)' }, () => {
  it('runs (a)-(d) with each of the two previous minors of the kit', () => {});
});
