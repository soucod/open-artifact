// End-to-end test of the types people make, in Chrome: a real daemon (in this process, from source, in a temporary
// home and user types folder). `open-artifact types new` (the command line, from source) scaffolds a `page` and a
// `data` type; an artifact of each opens in the Shell, renders, and uses the capability it declares (the page
// template saves content.json through `artifact`, the data template adds a record through `db`). Then the home page's
// Types tab makes a type from its "New type" dialog and turns a type off and on with its switch.
//
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { browserOff, fixtures, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 60000 };
const BIN = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const CONTENT = path.join(fixtures, 'custom-types', 'content.json');
/** In the page's own frame. */
const IN_PAGE = "location.hostname.endsWith('.frame.localhost')";

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  for (const ui of ['shell', 'home']) {
    if (!fs.existsSync(path.join(repoRoot, 'dist', 'daemon', ui, 'index.html'))) return `the ${ui} page is not built (npm run build)`;
  }
  return false;
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

describe('types people make', { skip: skip() }, () => {
  const ctx = {};
  const tool = async args => {
    const out = await ctx.daemon.tools.call('Artifact', args, ctx.caller);
    assert.equal(out.error, undefined, JSON.stringify(out.error));
    return out;
  };
  /** `open-artifact …` from source, as the person's terminal, against this daemon. JSON out, or the failure. */
  const cli = async (...args) => {
    try {
      const { stdout } = await promisify(execFile)(process.execPath, [BIN, ...args], { cwd: ctx.workspace, env: ctx.env, timeout: 30000 });
      return { code: 0, json: JSON.parse(stdout) };
    } catch (e) {
      let json;
      try {
        json = JSON.parse(e.stdout);
      } catch {}
      return { code: e.code, json, stderr: String(e.stderr ?? '') };
    }
  };
  /** The page's own frame answers `expression`, or undefined. */
  const inPage = async (page, expression) => (await page.evaluateAll(`${IN_PAGE} ? (${expression}) : undefined`).catch(() => [])).find(v => v !== undefined);
  /** A real click in the middle of the element `selector` of the top page (the home page). */
  // Clicks the middle of the element once it has stopped moving (two frames apart): under load the page may still be
  // laying out after a tab switch, and a click measured before that lands somewhere else.
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
  const settings = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ctx.home, 'settings.json'), 'utf8'));
    } catch {
      return {};
    }
  };

  before(async () => {
    const tmp = tmpDir('custom-types');
    ctx.workspace = path.join(tmp, 'workspace');
    ctx.home = path.join(tmp, 'home');
    ctx.types = path.join(tmp, 'types');
    fs.mkdirSync(ctx.workspace, { recursive: true });
    // The home page creates in the home workspace: here, not ~/OpenArtifact.
    fs.mkdirSync(ctx.home, { recursive: true });
    fs.writeFileSync(path.join(ctx.home, 'settings.json'), JSON.stringify({ homeWorkspace: path.join(tmp, 'home-workspace') }));
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION', 'OPEN_ARTIFACT_TRUST_PROJECTS']) delete process.env[name];
    const port = await freePort();
    Object.assign(process.env, {
      OPEN_ARTIFACT_HOME: ctx.home,
      OPEN_ARTIFACT_USER_TYPES: ctx.types,
      OPEN_ARTIFACT_INSTALLED_TYPES: path.join(tmp, 'installed-types'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmp, 'servers'),
      OPEN_ARTIFACT_PORT: String(port),
    });
    ctx.env = { ...process.env };
    delete ctx.env.NODE_TEST_CONTEXT;
    delete ctx.env.NODE_OPTIONS;
    const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
    ctx.daemon = await startDaemon({ port, idleMs: 0, quiet: true, browse: null });
    ctx.caller = { harness: 'dsh', session: 'e2e-custom-types', workspace: ctx.workspace };
    ctx.browser = await launch({ width: 1100, height: 800 });
  });

  after(async () => {
    await ctx.browser?.close();
    await ctx.daemon?.close();
    removeTmp();
  });

  it('types new scaffolds both templates into the user folder, and both pass types check', T, async () => {
    const notes = await cli('types', 'new', 'trip-notes', '--name', 'Trip notes');
    assert.equal(notes.code, 0, notes.stderr);
    assert.equal(notes.json.scope, 'user');
    assert.equal(notes.json.dir, path.join(ctx.types, 'trip-notes'));
    assert.equal(notes.json.check.ok, true, JSON.stringify(notes.json.check.errors));
    assert.deepEqual(notes.json.check.warnings, []);
    const todo = await cli('types', 'new', 'chores', '--template', 'data');
    assert.equal(todo.code, 0, todo.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(todo.json.dir, 'artifact-type.json'), 'utf8')).openArtifact.store, 'db');
    const checked = await cli('types', 'check', 'chores');
    assert.equal(checked.code, 0, checked.stderr);
    assert.equal(checked.json.ok, true);
    assert.deepEqual(checked.json.capabilities.backed, ['db']);
    const listed = (await cli('types', 'list')).json.filter(t => t.source === 'local').map(t => [t.id, t.runtime, t.runnable, t.version]);
    assert.deepEqual(listed.sort(), [
      ['chores', 'frame', true, '0.1.0'],
      ['trip-notes', 'frame', true, '0.1.0'],
    ]);
    const again = await cli('types', 'new', 'trip-notes');
    assert.notEqual(again.code, 0, 'an existing folder is refused');
    const builtin = await cli('types', 'new', 'slides');
    assert.notEqual(builtin.code, 0, 'a built-in id is refused');
  });

  it('a page-template artifact renders its content.json and saves the person\'s edit through artifact', T, async () => {
    const made = await tool({ action: 'publish', type_url: 'open-artifact://type/trip-notes', title: 'Lisbon', open: 'never' });
    await tool({ action: 'publish', url: made.url, files: { 'content.json': fs.readFileSync(CONTENT, 'utf8') } });
    const id = ctx.daemon.store.require(made.url).id;
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${id}`, {
      ready: `${IN_PAGE} && document.querySelectorAll('#sections section').length === 2`,
      ignore: [/favicon\.ico/],
    });
    try {
      assert.deepEqual(page.problems, []);
      assert.equal(await inPage(page, "document.getElementById('title').textContent"), 'Trip to Lisbon');
      assert.equal(await inPage(page, "getComputedStyle(document.querySelector('main')).maxWidth"), '720px', 'artifact-type/style.css loads from the type');
      // The person edits the title and presses Save: `artifact.publish` writes content.json into the artifact.
      await inPage(page, "(document.getElementById('title').textContent = 'Lisbon, edited', document.getElementById('save').click(), true)");
      assert.ok(await page.waitFor(`${IN_PAGE} && document.getElementById('status')?.textContent === 'Saved'`, 15000), `not saved: ${await inPage(page, "document.getElementById('status')?.textContent")}`);
      const saved = JSON.parse(fs.readFileSync(path.join(made.root, 'content.json'), 'utf8'));
      assert.equal(saved.title, 'Lisbon, edited');
      assert.equal(saved.sections.length, 2);
      assert.equal(fs.existsSync(path.join(made.root, 'index.html')), false, 'the page stays the type\'s');
    } finally {
      await page.close();
    }
  });

  it('a data-template artifact adds a record through db', T, async () => {
    const made = await tool({ action: 'publish', type_url: 'open-artifact://type/chores', title: 'Chores', open: 'never' });
    const id = ctx.daemon.store.require(made.url).id;
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${id}`, {
      ready: `${IN_PAGE} && !document.getElementById('empty').hidden`,
      ignore: [/favicon\.ico/],
    });
    try {
      assert.deepEqual(page.problems, []);
      await inPage(page, "(document.getElementById('text').value = 'Water the plants', document.getElementById('add').requestSubmit(), true)");
      assert.ok(await page.waitFor(`${IN_PAGE} && document.querySelector('#items li span')?.textContent === 'Water the plants'`, 15000), 'the snapshot did not list the item');
      const dir = path.join(made.root, 'db', 'items');
      const docs = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      assert.equal(docs.length, 1);
      const doc = JSON.parse(fs.readFileSync(path.join(dir, docs[0]), 'utf8'));
      assert.equal(doc.text, 'Water the plants');
      assert.equal(doc.done, false);
    } finally {
      await page.close();
    }
  });

  it('the home page\'s Types tab makes a type from its dialog, and turns a type off and on', T, async () => {
    const page = await ctx.browser.load(`${ctx.daemon.origin}/`, { ready: "!!document.querySelector('[role=tab]')", ignore: [/favicon\.ico/] });
    try {
      assert.deepEqual(page.problems, []);
      const types = "[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Types')";
      const box = await page.evaluate(`(() => { const r = ${types}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await page.click(box.x, box.y);
      assert.ok(await page.waitFor("!!document.querySelector('[data-type-id=\"trip-notes\"]')", 10000), 'the Types tab lists the user types');
      // A user type that runs gets "New …"; the explanation names the user folder.
      assert.equal(await page.evaluate("[...document.querySelectorAll('[data-type-id=\"trip-notes\"] button')].some(b => b.textContent === 'New Trip notes')"), true);
      assert.equal(await page.evaluate(`document.body.innerText.includes(${JSON.stringify(ctx.types)})`), true);

      // New type: id, Data, Create.
      await clickOn(page, '[data-testid=new-type]');
      assert.ok(await page.waitFor("!!document.querySelector('[data-testid=new-type-form] input[name=id]')", 10000), 'the dialog opened');
      await clickOn(page, '[data-testid=new-type-form] input[name=id]');
      await page.type('Reading-Log');
      await clickOn(page, '[aria-label=Template] button:nth-child(2)');
      await clickOn(page, '[data-testid=new-type-form] button[type=submit]');
      assert.ok(await page.waitFor("!!document.querySelector('[data-testid=type-made-dir]')", 15000), `not made: ${await page.evaluate("document.querySelector('[role=alert]')?.textContent ?? ''")}`);
      const dir = path.join(ctx.types, 'reading-log');
      assert.equal(await page.evaluate("document.querySelector('[data-testid=type-made-dir]').textContent"), dir);
      assert.match(await page.evaluate("document.querySelector('[data-testid=type-made-prompt]').textContent"), /types check reading-log/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'artifact-type.json'), 'utf8')).openArtifact.store, 'db', 'the Data template');
      await clickOn(page, '[data-testid=type-made-done]');
      assert.ok(await page.waitFor("!document.querySelector('[data-testid=type-made]') && !!document.querySelector('[data-type-id=\"reading-log\"]')", 10000), 'the new type is listed');

      // Off: the switch writes disabledTypes, and no artifact of it can be made.
      const toggle = '[data-type-id="reading-log"] [role=switch]';
      await clickOn(page, toggle);
      assert.ok(await page.waitFor(`document.querySelector(${JSON.stringify(toggle)})?.getAttribute('aria-checked') === 'false'`, 10000), 'switched off');
      assert.deepEqual(settings().disabledTypes, ['reading-log']);
      const refused = await ctx.daemon.tools.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/reading-log', title: 'x', open: 'never' }, ctx.caller);
      assert.equal(refused.error?.code, 'unsupported');
      assert.equal(await page.evaluate("[...document.querySelectorAll('[data-type-id=\"reading-log\"] button')].some(b => b.textContent.startsWith('New '))"), false, 'no "New" while off');
      // On again.
      await clickOn(page, toggle);
      assert.ok(await page.waitFor(`document.querySelector(${JSON.stringify(toggle)})?.getAttribute('aria-checked') === 'true'`, 10000), 'switched on');
      assert.deepEqual(settings().disabledTypes, []);
      // "New Reading log" on the home page: `artifacts.create`, from the home page's own origin, makes one.
      const created = await page.evaluate(`fetch('/api/open-artifact.artifacts.create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'reading-log', title: 'Books' }) }).then(async r => ({ status: r.status, body: await r.json() }))`);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.type, 'reading-log');
      assert.equal(ctx.daemon.store.require(created.body.id).type, 'reading-log');
      assert.ok(created.body.root.startsWith(path.join(path.dirname(ctx.home), 'home-workspace')), created.body.root);
    } finally {
      await page.close();
    }
  });
});
