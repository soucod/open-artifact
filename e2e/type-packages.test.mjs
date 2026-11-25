// End-to-end test of sharing a type between two computers, in Chrome: two daemons (each its own process, from source,
// with its own temporary home, user and installed types folders, home workspace and port). On A, `open-artifact types
// new` scaffolds a page type that declares one network origin, `types check --for-share` passes and `types pack`
// writes the package. On B, `types install <file> --yes` installs it (source: installed), an artifact of it opens in
// the Shell, renders, and saves through the `artifact` capability; its page may reach the declared origin and is
// stopped (Content-Security-Policy) from reaching another. B's home page installs the same package again from its
// address, under another id, through the Install dialog that shows the SKILL.md in full. Then B's artifact is zipped
// and `open-artifact import` brings it into A, where it opens with A's own type of the same uid.
//
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { browserOff, fixtures, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 90000 };
const BIN = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const CONTENT = path.join(fixtures, 'custom-types', 'content.json');
const IN_PAGE = "location.hostname.endsWith('.frame.localhost')";
const DECLARED = 'https://declared.invalid';
const UNDECLARED = 'https://undeclared.invalid';

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  for (const ui of ['shell', 'home']) {
    if (!fs.existsSync(path.join(repoRoot, 'dist', 'daemon', ui, 'index.html'))) return `the ${ui} page is not built (npm run build)`;
  }
  return false;
}

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

/** The environment of one computer: everything it writes is under `root`. Agent session variables are left out (this is the person's terminal). */
async function computer(root, agentVariables) {
  const c = { root, home: path.join(root, 'home'), types: path.join(root, 'user-types'), installed: path.join(root, 'installed-types'), workspace: path.join(root, 'home-workspace'), cwd: path.join(root, 'cwd') };
  for (const dir of [c.home, c.types, c.installed, c.workspace, c.cwd]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(c.home, 'settings.json'), JSON.stringify({ homeWorkspace: c.workspace }));
  c.port = await freePort();
  const env = { ...process.env };
  for (const name of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION', 'OPEN_ARTIFACT_TRUST_PROJECTS', ...agentVariables]) delete env[name];
  Object.assign(env, {
    OPEN_ARTIFACT_HOME: c.home,
    OPEN_ARTIFACT_USER_TYPES: c.types,
    OPEN_ARTIFACT_INSTALLED_TYPES: c.installed,
    OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(root, 'servers'),
    OPEN_ARTIFACT_PORT: String(c.port),
    OPEN_ARTIFACT_IDLE_MS: '0',
    OPEN_ARTIFACT_BROWSER: 'none',
  });
  c.env = env;
  return c;
}

/** Starts `c`'s daemon (`open-artifact daemon run`) and waits for its daemon.json. */
async function startDaemon(c) {
  c.child = spawn(process.execPath, [BIN, 'daemon', 'run', '--port', String(c.port)], { cwd: c.cwd, env: c.env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  c.child.stderr.on('data', chunk => (stderr += chunk));
  const end = Date.now() + 30000;
  for (;;) {
    try {
      c.state = JSON.parse(fs.readFileSync(path.join(c.home, 'daemon.json'), 'utf8'));
      const r = await fetch(`${c.state.url}/api/open-artifact.types`, { headers: { Authorization: `Bearer ${c.state.token}` } });
      if (r.ok) return;
    } catch {}
    if (c.child.exitCode !== null || Date.now() > end) throw new Error(`the daemon of ${c.root} did not start: ${stderr}`);
    await new Promise(done => setTimeout(done, 100));
  }
}

function stopDaemon(c) {
  if (!c?.child || c.child.exitCode !== null) return Promise.resolve();
  return new Promise(done => {
    c.child.once('exit', done);
    c.child.kill('SIGTERM');
    setTimeout(() => (c.child.kill('SIGKILL'), done()), 5000).unref();
  });
}

/** `open-artifact …` from source as the person of `c`, in its own working folder. JSON out, or the failure. */
const cli = async (c, ...args) => {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [BIN, ...args], { cwd: c.cwd, env: c.env, timeout: 60000 });
    return { code: 0, json: JSON.parse(stdout), stderr };
  } catch (e) {
    let json;
    try {
      json = JSON.parse(e.stdout);
    } catch {}
    return { code: e.code, json, stderr: String(e.stderr ?? '') };
  }
};
const call = async (c, name, body) => {
  const r = await fetch(`${c.state.url}/api/open-artifact.${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.state.token}` }, body: JSON.stringify(body) });
  return r.json();
};
const tool = async (c, args) => {
  const out = await call(c, 'tools.call', { name: 'Artifact', arguments: args, caller: { harness: 'dsh', session: 'e2e-type-packages', workspace: c.workspace } });
  assert.equal(out.error, undefined, JSON.stringify(out.error));
  return out;
};

describe('a type shared between two computers', { skip: skip() }, () => {
  const ctx = {};
  const idOf = url => url.split('/').pop();
  const inPage = async (page, expression) => (await page.evaluateAll(`${IN_PAGE} ? (${expression}) : undefined`).catch(() => [])).find(v => v !== undefined);
  // Clicks the middle of the element once it has stopped moving (two frames apart), so a page still laying out
  // after a tab switch does not take the click somewhere else.
  const clickOn = async (page, selector) => {
    const box = await page.evaluate(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      let last = null;
      for (let i = 0; i < 20; i++) {
        await frame();
        const r = el.getBoundingClientRect();
        const now = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        if (last && last.x === now.x && last.y === now.y) return now;
        last = now;
      }
      return last;
    })()`);
    assert.ok(box, `nothing matches ${selector}`);
    await page.click(box.x, box.y);
  };

  before(async () => {
    const { agentVariables } = await import('../packages/daemon/src/agent-session.ts');
    const agents = [...agentVariables([path.join(repoRoot, 'packages', 'daemon', 'harnesses')]).keys()];
    ctx.a = await computer(tmpDir('type-packages-a'), agents);
    ctx.b = await computer(tmpDir('type-packages-b'), agents);
    await Promise.all([startDaemon(ctx.a), startDaemon(ctx.b)]);
    ctx.browser = await launch({ width: 1100, height: 800 });
  });

  after(async () => {
    await ctx.browser?.close();
    ctx.packageServer?.close();
    await Promise.all([stopDaemon(ctx.a), stopDaemon(ctx.b)]);
    removeTmp();
  });

  it('A: types new, types check --for-share, types pack', T, async () => {
    const made = await cli(ctx.a, 'types', 'new', 'trip-kit', '--name', 'Trip kit');
    assert.equal(made.code, 0, made.stderr);
    const manifestFile = path.join(made.json.dir, 'artifact-type.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.openArtifact = { ...manifest.openArtifact, network: [DECLARED] };
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    ctx.uid = manifest.uid;
    ctx.skill = fs.readFileSync(path.join(made.json.dir, 'SKILL.md'), 'utf8');
    const checked = await cli(ctx.a, 'types', 'check', 'trip-kit', '--for-share');
    assert.equal(checked.code, 0, checked.stderr);
    assert.equal(checked.json.ok, true, JSON.stringify(checked.json.errors));
    const packed = await cli(ctx.a, 'types', 'pack', 'trip-kit');
    assert.equal(packed.code, 0, packed.stderr);
    assert.equal(packed.json.file, path.join(ctx.a.cwd, 'trip-kit-0.1.0.oatype'));
    assert.match(packed.json.sha256, /^[0-9a-f]{64}$/);
    ctx.packageFile = packed.json.file;
    ctx.sha256 = packed.json.sha256;
  });

  it('B: types install --yes; it lists as installed, with its sha256 recorded', T, async () => {
    // Without --yes and no terminal to ask at, nothing is installed.
    const asked = await cli(ctx.b, 'types', 'install', ctx.packageFile);
    assert.notEqual(asked.code, 0);
    assert.match(asked.stderr, /no terminal to ask at/);
    assert.match(asked.stderr, /capabilities: artifact, downloads/);
    assert.match(asked.stderr, new RegExp(`network: +${DECLARED.replace(/[.]/g, '\\.')}`));
    assert.equal(fs.existsSync(path.join(ctx.b.installed, 'trip-kit')), false);

    const installed = await cli(ctx.b, 'types', 'install', ctx.packageFile, '--yes');
    assert.equal(installed.code, 0, installed.stderr);
    assert.equal(installed.json.id, 'trip-kit');
    assert.equal(installed.json.sha256, ctx.sha256);
    assert.equal(installed.json.dir, path.join(ctx.b.installed, 'trip-kit'));
    const index = JSON.parse(fs.readFileSync(path.join(ctx.b.home, 'types.json'), 'utf8'));
    assert.equal(index.types['trip-kit'].sha256, ctx.sha256);
    assert.equal(index.types['trip-kit'].uid, ctx.uid);
    const listed = (await cli(ctx.b, 'types', 'list')).json.find(t => t.id === 'trip-kit');
    assert.equal(listed.source, 'installed');
    assert.equal(listed.installedFrom, ctx.packageFile);
  });

  it("B: an artifact of it renders, saves through artifact, and its page reaches only the declared origin", T, async () => {
    const made = await tool(ctx.b, { action: 'publish', type_url: 'open-artifact://type/trip-kit', title: 'Porto', open: 'never' });
    assert.equal(made.source, 'installed');
    assert.match(made.third_party_notice, /written by the type's publisher/);
    await tool(ctx.b, { action: 'publish', url: made.url, files: { 'content.json': fs.readFileSync(CONTENT, 'utf8') } });
    ctx.bArtifact = made;
    const page = await ctx.browser.load(`${ctx.b.state.url}/a/${idOf(made.url)}`, { ready: `${IN_PAGE} && document.querySelectorAll('#sections section').length === 2`, ignore: [/favicon\.ico/, /Content Security Policy|Refused to connect|ERR_NAME_NOT_RESOLVED|Failed to fetch/i] });
    try {
      assert.deepEqual(page.problems, []);
      assert.equal(await inPage(page, "document.getElementById('title').textContent"), 'Trip to Lisbon');
      await inPage(page, "(document.getElementById('title').textContent = 'Porto, edited', document.getElementById('save').click(), true)");
      assert.ok(await page.waitFor(`${IN_PAGE} && document.getElementById('status')?.textContent === 'Saved'`, 15000), 'not saved');
      assert.equal(JSON.parse(fs.readFileSync(path.join(made.root, 'content.json'), 'utf8')).title, 'Porto, edited');

      // The policy: a fetch to an origin it did not declare is stopped by the browser (a violation), the declared one is not.
      const blocked = await inPage(
        page,
        `new Promise(resolve => {
          const seen = [];
          document.addEventListener('securitypolicyviolation', e => seen.push({ uri: e.blockedURI, directive: e.effectiveDirective }));
          Promise.allSettled([fetch(${JSON.stringify(`${UNDECLARED}/x`)}), fetch(${JSON.stringify(`${DECLARED}/x`)})]).then(() => setTimeout(() => resolve(seen), 300));
        })`,
      );
      assert.ok(Array.isArray(blocked), 'the probe ran in the page');
      assert.ok(blocked.some(v => v.uri.startsWith(UNDECLARED) && v.directive === 'connect-src'), `the undeclared origin was not blocked: ${JSON.stringify(blocked)}`);
      assert.equal(blocked.some(v => v.uri.startsWith(DECLARED)), false, `the declared origin was blocked: ${JSON.stringify(blocked)}`);
    } finally {
      await page.close();
    }
  });

  it("B's home page installs it again from its address under another id, after showing the SKILL.md in full", T, async () => {
    const bytes = fs.readFileSync(ctx.packageFile);
    ctx.packageServer = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'application/zip' }).end(bytes));
    await new Promise(done => ctx.packageServer.listen(0, '127.0.0.1', done));
    const address = `http://127.0.0.1:${ctx.packageServer.address().port}/trip-kit-0.1.0.oatype`;
    const page = await ctx.browser.load(`${ctx.b.state.url}/`, { ready: "!!document.querySelector('[role=tab]')", ignore: [/favicon\.ico/] });
    try {
      const types = "[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Types')";
      const box = await page.evaluate(`(() => { const r = ${types}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await page.click(box.x, box.y);
      assert.ok(await page.waitFor("!!document.querySelector('[data-type-id=\"trip-kit\"]')", 10000), 'the installed type is listed');
      assert.match(await page.evaluate("document.querySelector('[data-type-id=\"trip-kit\"]').innerText"), /\binstalled\b/i);
      assert.match(await page.evaluate("document.querySelector('[data-type-id=\"trip-kit\"] [data-testid=type-network]').textContent"), /declared\.invalid/);

      // Counts the clicks the button gets, for the message below; a click sent again only when none arrived.
      await page.evaluate("(window.__clicks = 0, document.querySelector('[data-testid=install-type]').addEventListener('click', () => window.__clicks++), true)");
      let opened = false;
      for (let attempt = 0; attempt < 3 && !opened; attempt++) {
        await clickOn(page, '[data-testid=install-type]');
        opened = await page.waitFor("!!document.querySelector('[data-testid=install-type-form] input[name=url]')", 5000);
        if (!opened && await page.evaluate('window.__clicks') > 0) break;
      }
      assert.ok(opened, `the dialog did not open: ${await page.evaluate("(() => { const b = document.querySelector('[data-testid=install-type]').getBoundingClientRect(); const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return JSON.stringify({ clicks: window.__clicks, at: at && (at.outerHTML || '').slice(0, 200), dialogs: document.querySelectorAll('[role=dialog]').length, body: document.body.innerText.slice(0, 300) }); })()")}`);
      await clickOn(page, '[data-testid=install-type-form] input[name=as]');
      await page.type('trip-kit-web');
      await clickOn(page, '[data-testid=install-type-form] input[name=url]');
      await page.type(address);
      await clickOn(page, '[data-testid=install-type-form] button[type=submit]');
      assert.ok(await page.waitFor("!!document.querySelector('[data-testid=type-preview-skill]')", 15000), `no preview: ${await page.evaluate("document.querySelector('[role=alert]')?.textContent ?? ''")}`);
      assert.equal(await page.evaluate("document.querySelector('[data-testid=type-preview-skill]').textContent"), ctx.skill, 'the SKILL.md in full');
      assert.equal(await page.evaluate("document.querySelector('[data-testid=type-preview-source]').textContent"), address);
      assert.equal(await page.evaluate("document.querySelector('[data-testid=type-preview-network]').textContent"), DECLARED);
      assert.equal(fs.existsSync(path.join(ctx.b.installed, 'trip-kit-web')), false, 'nothing is installed before the confirm');
      await clickOn(page, '[data-testid=type-install-confirm]');
      assert.ok(await page.waitFor("!!document.querySelector('[data-type-id=\"trip-kit-web\"]')", 15000), `not installed: ${await page.evaluate("document.querySelector('[role=alert]')?.textContent ?? ''")}`);
      const index = JSON.parse(fs.readFileSync(path.join(ctx.b.home, 'types.json'), 'utf8'));
      assert.equal(index.types['trip-kit-web'].source, address);
      assert.equal(index.types['trip-kit-web'].sha256, ctx.sha256);

      // Uninstall from the card: its confirm answered yes (a headless page has no one to click it).
      await page.evaluate('(window.confirm = () => true, true)');
      await clickOn(page, '[data-type-id="trip-kit-web"] [data-testid=type-uninstall]');
      assert.ok(await page.waitFor("!document.querySelector('[data-type-id=\"trip-kit-web\"]')", 15000), 'still listed after uninstall');
      assert.equal(fs.existsSync(path.join(ctx.b.installed, 'trip-kit-web')), false, 'its folder is gone');
      assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.b.home, 'types.json'), 'utf8')).types['trip-kit-web'], undefined);
    } finally {
      await page.close();
    }
  });

  it("B's artifact, zipped and imported into A, opens there with A's own type of the same uid", T, async () => {
    const r = await fetch(`${ctx.b.state.url}/api/open-artifact.artifact.archive?id=${idOf(ctx.bArtifact.url)}`, { headers: { Authorization: `Bearer ${ctx.b.state.token}` } });
    assert.equal(r.status, 200);
    const zip = path.join(ctx.a.cwd, 'porto.zip');
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    const imported = await cli(ctx.a, 'import', zip);
    assert.equal(imported.code, 0, imported.stderr);
    assert.equal(imported.json.type, 'trip-kit');
    assert.ok(imported.json.root.startsWith(ctx.a.workspace), imported.json.root);
    const marker = JSON.parse(fs.readFileSync(path.join(imported.json.root, '.artifact.json'), 'utf8'));
    assert.equal(marker.typeUid, ctx.uid);
    assert.equal(marker.typeSource, 'trip-kit-0.1.0.oatype', 'where B got the type, by the package name');
    const page = await ctx.browser.load(`${ctx.a.state.url}/a/${imported.json.id}`, { ready: `${IN_PAGE} && document.querySelectorAll('#sections section').length === 2`, ignore: [/favicon\.ico/] });
    try {
      assert.deepEqual(page.problems, []);
      assert.equal(await inPage(page, "document.getElementById('title').textContent"), 'Porto, edited');
    } finally {
      await page.close();
    }
  });

  it('B: uninstall; the archive then has no type on B to open with (type_missing), and nothing is left', T, async () => {
    const removed = await cli(ctx.b, 'types', 'uninstall', 'trip-kit');
    assert.equal(removed.code, 0, removed.stderr);
    const removedWeb = await cli(ctx.b, 'types', 'uninstall', 'trip-kit-web');
    assert.notEqual(removedWeb.code, 0, 'the home page uninstalled it already');
    assert.deepEqual(fs.readdirSync(ctx.b.installed), []);
    const before = fs.readdirSync(ctx.b.workspace).sort();
    const missing = await cli(ctx.b, 'import', path.join(ctx.a.cwd, 'porto.zip'));
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /trip-kit/);
    assert.match(missing.stderr, new RegExp(ctx.uid));
    assert.deepEqual(fs.readdirSync(ctx.b.workspace).sort(), before);
  });
});

// What the page of a type from an untrusted root (here: installed) can still reach on another origin, measured in
// Chrome, next to the same pages as types of this computer (trusted: nothing changes for them). The other origin is a
// local server on its own port that records what reaches it; each attempt runs in a page of its own, with a click's
// activation (a popup or a top navigation may need one), and counts as reached when its path arrives within the wait.
const PROBES = {
  navigate: u => `(setTimeout(() => { location.href = ${u}; }, 0), true)`,
  metaRefresh: u => `(document.head.insertAdjacentHTML('beforeend', '<meta http-equiv="refresh" content="0;url=' + ${u} + '">'), true)`,
  windowOpen: u => `(window.open(${u}), true)`,
  linkBlank: u => `(() => { const a = document.createElement('a'); a.href = ${u}; a.target = '_blank'; document.body.append(a); a.click(); return true; })()`,
  topLocation: u => `(() => { try { top.location.href = ${u}; } catch {} return true; })()`,
  linkDownload: u => `(() => { const a = document.createElement('a'); a.href = ${u}; a.download = 'probe.txt'; document.body.append(a); a.click(); return true; })()`,
  formPost: u => `(() => { const f = document.createElement('form'); f.method = 'post'; f.action = ${u}; document.body.append(f); f.submit(); return true; })()`,
  fetch: u => `(fetch(${u}, { mode: 'no-cors' }).catch(() => {}), true)`,
  img: u => `(() => { new Image().src = ${u}; return true; })()`,
};
const STATIC_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Probe</title></head><body data-ready="1"><p>A static probe page.</p></body></html>\n';

describe("a restricted type's page and other origins", { skip: skip() }, () => {
  const ctx = { results: {} };
  const sinkHits = new Set();
  const idOf = url => url.split('/').pop();

  before(async () => {
    const { agentVariables } = await import('../packages/daemon/src/agent-session.ts');
    ctx.c = await computer(tmpDir('type-probes'), [...agentVariables([path.join(repoRoot, 'packages', 'daemon', 'harnesses')]).keys()]);
    await startDaemon(ctx.c);
    ctx.sink = http.createServer((req, res) => {
      sinkHits.add(req.url.split('?')[0]);
      req.resume();
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>sink</p>');
    });
    await new Promise(done => ctx.sink.listen(0, '127.0.0.1', done));
    ctx.sinkOrigin = `http://127.0.0.1:${ctx.sink.address().port}`;
    ctx.browser = await launch({ width: 1000, height: 700 });

    // A frame type (types new) and a static one, each a user type of this computer and installed from its package.
    const made = await cli(ctx.c, 'types', 'new', 'probe-frame', '--name', 'Probe frame');
    assert.equal(made.code, 0, made.stderr);
    // It declares db and assets too, for the capabilities test.
    const frameIndex = path.join(ctx.c.types, 'probe-frame', 'index.html');
    const declared = fs.readFileSync(frameIndex, 'utf8').replace(/var capabilities = [^;]*;/, 'var capabilities = { artifact: {}, downloads: {}, db: {}, assets: {} };');
    assert.match(declared, /db: \{\}, assets/);
    fs.writeFileSync(frameIndex, declared);
    const staticDir = path.join(ctx.c.types, 'probe-static');
    fs.mkdirSync(staticDir, { recursive: true });
    fs.writeFileSync(path.join(staticDir, 'artifact-type.json'), `${JSON.stringify({ slug: 'probe-static', uid: '6f1b7c2e-0d3a-4f5b-9c8d-7e6f5a4b3c2d', name: 'Probe static', title: 'Probe static', description: 'A static page for the probes.', version: '1.0.0', skill: 'SKILL.md' }, null, 2)}\n`);
    fs.writeFileSync(path.join(staticDir, 'index.html'), STATIC_PAGE);
    fs.writeFileSync(path.join(staticDir, 'SKILL.md'), '---\nname: probe-static\ndescription: A static page for the probes.\n---\n\nNothing to write.\n');
    for (const id of ['probe-frame', 'probe-static']) {
      const packed = await cli(ctx.c, 'types', 'pack', id);
      assert.equal(packed.code, 0, packed.stderr);
      const installed = await cli(ctx.c, 'types', 'install', packed.json.file, '--as', `${id}-i`, '--yes');
      assert.equal(installed.code, 0, installed.stderr);
    }
  });

  after(async () => {
    if (Object.keys(ctx.results).length) console.log(`# probes: ${JSON.stringify(ctx.results)}`);
    await ctx.browser?.close();
    ctx.sink?.close();
    await stopDaemon(ctx.c);
    removeTmp();
  });

  /** Every probe against an artifact of `type`, each in a page of its own: probe → reached the other origin. */
  async function probe(type) {
    const made = await tool(ctx.c, { action: 'publish', type_url: `open-artifact://type/${type}`, title: `Probe ${type}`, open: 'never' });
    const address = `${ctx.c.state.url}/a/${idOf(made.url)}`;
    await ctx.browser.downloadsTo(tmpDir(`probe-downloads-${type}`));
    const out = {};
    for (const [name, attempt] of Object.entries(PROBES)) {
      const hit = `/hit/${type}-${name}`;
      const page = await ctx.browser.load(address, { ready: `${IN_PAGE} && document.readyState === 'complete'`, ignore: [/.*/] });
      try {
        const ran = await page.evaluateAll(`${IN_PAGE} ? (${attempt(JSON.stringify(ctx.sinkOrigin + hit))}) : undefined`, { userGesture: true }).catch(() => []);
        assert.ok(ran.includes(true), `${type} ${name}: the probe did not run in the page`);
        const until = Date.now() + 2000;
        while (!sinkHits.has(hit) && Date.now() < until) await new Promise(done => setTimeout(done, 100));
        out[name] = sinkHits.has(hit);
      } finally {
        await page.close();
      }
    }
    ctx.results[type] = out;
    return out;
  }

  /** The page frame's `sandbox` attribute as the frame around it has it (null: none), and its CSP header. */
  async function frameFacts(type) {
    const made = await tool(ctx.c, { action: 'publish', type_url: `open-artifact://type/${type}`, title: `Facts ${type}`, open: 'never' });
    const page = await ctx.browser.load(`${ctx.c.state.url}/a/${idOf(made.url)}`, { ready: `${IN_PAGE} && document.readyState === 'complete'`, ignore: [/.*/] });
    try {
      const sandbox = (await page.evaluateAll(`(() => { const f = [...document.querySelectorAll('iframe')].find(f => /\\.frame\\.localhost/.test(f.src)); return f ? (f.getAttribute('sandbox') ?? 'none') : undefined; })()`)).find(v => v !== undefined);
      const csp = (await page.evaluateAll(`${IN_PAGE} ? fetch(location.href).then(r => r.headers.get('content-security-policy') ?? 'none') : undefined`)).find(v => v !== undefined);
      return { sandbox, csp };
    } finally {
      await page.close();
    }
  }

  const NOTHING = Object.fromEntries(Object.keys(PROBES).map(name => [name, false]));

  it('an installed frame type: no attempt reaches the other origin', { timeout: 180000 }, async () => {
    assert.deepEqual(await probe('probe-frame-i'), NOTHING);
  });

  it('an installed static type: no attempt reaches the other origin', { timeout: 180000 }, async () => {
    assert.deepEqual(await probe('probe-static-i'), NOTHING);
  });

  /** Uses artifact, db, assets and downloads in an artifact of `type`'s page, and reads what its frame is allowed. */
  async function useCapabilities(type) {
    const made = await tool(ctx.c, { action: 'publish', type_url: `open-artifact://type/${type}`, title: `Capabilities ${type}`, open: 'never' });
    const downloads = tmpDir(`downloads-${type}`);
    await ctx.browser.downloadsTo(downloads);
    const page = await ctx.browser.load(`${ctx.c.state.url}/a/${idOf(made.url)}`, { ready: `${IN_PAGE} && document.readyState === 'complete'`, ignore: [/favicon\.ico/] });
    try {
      const sandbox = (await page.evaluateAll(`(() => { const f = [...document.querySelectorAll('iframe')].find(f => /\\.frame\\.localhost/.test(f.src)); return f ? (f.getAttribute('sandbox') ?? 'none') : undefined; })()`)).find(v => v !== undefined);
      const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const used = (await page.evaluateAll(
        `${IN_PAGE} ? (async () => {
          const r = {};
          try {
            const self = await openArtifact.use('artifact');
            r.artifact = !!(await self.publish({ 'probe.json': '{"ok":true}' }));
            const db = await openArtifact.use('db');
            await db.doc('notes/a').set({ text: 'hi' });
            r.db = (await db.doc('notes/a').get()).data()?.text === 'hi';
            const assets = await openArtifact.use('assets');
            const bytes = Uint8Array.from(atob(${JSON.stringify(PNG)}), c => c.charCodeAt(0));
            const up = await assets.upload(new Blob([bytes], { type: 'image/png' }));
            r.assets = typeof (up?.url ?? up?.id) === 'string';
            const d = await openArtifact.use('downloads');
            r.download = (await d.save({ filename: 'probe.txt', data: 'downloaded' }))?.status === 'saved';
            // Writing needs a focused document, which a background tab is not: what the frame is allowed is compared.
            const policy = document.permissionsPolicy ?? document.featurePolicy;
            r.clipboard = policy.allowsFeature('clipboard-write') && policy.allowsFeature('clipboard-read');
            r.fullscreen = document.fullscreenEnabled;
          } catch (e) {
            r.error = String(e?.message ?? e);
          }
          return r;
        })() : undefined`,
        { userGesture: true },
      )).find(v => v !== undefined);
      const file = path.join(downloads, 'probe.txt');
      const until = Date.now() + 15000;
      while (!fs.existsSync(file) && Date.now() < until) await new Promise(done => setTimeout(done, 100));
      const saved = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      const written = JSON.parse(fs.readFileSync(path.join(made.root, 'probe.json'), 'utf8')).ok === true;
      return { sandbox, used, saved, written };
    } finally {
      await page.close();
    }
  }

  it("an installed frame type's capabilities work in the sandbox: artifact, db, assets, a download; clipboard and fullscreen as for a local type", { timeout: 180000 }, async () => {
    const restricted = await useCapabilities('probe-frame-i');
    const local = await useCapabilities('probe-frame');
    console.log(`# capabilities: ${JSON.stringify({ restricted, local })}`);
    assert.equal(restricted.sandbox, 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads');
    assert.equal(local.sandbox, 'none');
    const { clipboard, fullscreen, ...rest } = restricted.used;
    assert.deepEqual(rest, { artifact: true, db: true, assets: true, download: true });
    assert.equal(restricted.saved, 'downloaded', 'the download from the sandboxed page was saved');
    assert.equal(restricted.written, true);
    // The sandbox changes neither: the frame is allowed what a local type's frame is, and both are allowed these.
    assert.equal(clipboard, true, 'the page frame is allowed the clipboard');
    assert.equal(fullscreen, true, 'the page frame is allowed fullscreen');
    assert.equal(clipboard, local.used.clipboard);
    assert.equal(fullscreen, local.used.fullscreen);
    assert.deepEqual(local.used, restricted.used);
  });

  it('the same types of this computer are as before: no sandbox, no policy, and the page may navigate itself', { timeout: 180000 }, async () => {
    for (const type of ['probe-frame', 'probe-static']) {
      const facts = await frameFacts(type);
      assert.equal(facts.sandbox, 'none', `${type}: ${JSON.stringify(facts)}`);
      assert.equal(facts.csp, 'none', `${type}: ${JSON.stringify(facts)}`);
      const reached = await probe(type);
      assert.equal(reached.fetch, true, `${type}: the control did not reach the other origin: ${JSON.stringify(reached)}`);
    }
  });
});
