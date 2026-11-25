// End-to-end tests of the data type's command line: the fixture dashboard (fixtures/data) is written through write-db
// and passes check; a broken copy of each kind fails it with the finding the page would show; write-db refuses what
// the page would drop and writes nothing; history leaves out dash/settings; upload, read-db --text and delete-asset;
// open, wait and stop. In a browser: what a guest's page may save (a commenter only their own folder), the
// read-only embedded view of a dashboard another page frames through the Shell, and the empty dashboard's format
// picker and file import.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { cli, run } from './lib/cli.mjs';
import { until } from './lib/http.mjs';
import { browserOff, fixtures, install, removeTmp, tmpDir, typePath } from './lib/target.mjs';

const T = { timeout: 90000 };
const TYPE = 'data';

function skip() {
  const dir = typePath(TYPE);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return `${TYPE} is not in ${dir}`;
  const missing = ['scripts/cli.mjs', 'scripts/editors/data/index.html'].filter(f => !fs.existsSync(path.join(dir, f)));
  return missing.length ? `${TYPE} is not built (npm run build): no ${missing.join(', ')}` : false;
}

const docPath = (root, doc) => path.join(root, 'db', `${doc}.json`);
const readDoc = (root, doc) => JSON.parse(fs.readFileSync(docPath(root, doc), 'utf8'));
const writeDoc = (root, doc, value) => {
  fs.mkdirSync(path.dirname(docPath(root, doc)), { recursive: true });
  fs.writeFileSync(docPath(root, doc), typeof value === 'string' ? value : JSON.stringify(value));
};
const findingsOf = out => out.json.findings.map(f => `${f.level} ${f.file.replace(/^db\//, '').replace(/\.json$/, '')} ${f.message}`);

describe(TYPE, { skip: skip() }, () => {
  const ctx = {};

  /** A copy of the loaded fixture dashboard. */
  const copy = label => {
    const root = path.join(tmpDir(`data-${label}`), 'dashboard');
    fs.cpSync(ctx.root, root, { recursive: true });
    return root;
  };

  before(async () => {
    const { dir } = install(typePath(TYPE), TYPE);
    const home = tmpDir('data-home');
    ctx.connectors = path.join(home, 'connectors.json');
    fs.writeFileSync(ctx.connectors, JSON.stringify({ mcpServers: { sales: { command: 'true' } } }));
    ctx.cli = cli(dir, {
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-state'), 'state'),
      HOME: home,
      OPEN_ARTIFACT_USER: 'E2E',
      OPEN_ARTIFACT_CONNECTORS: ctx.connectors,
    });
    ctx.root = path.join(tmpDir('data-root'), 'dashboard');
    const load = await run(path.join(fixtures, 'data', 'load.mjs'), [ctx.cli.script, ctx.root], { env: ctx.cli.env() });
    assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
  });

  after(async () => {
    await ctx.cli?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('check passes the fixture, warning only of the dataset nothing names', T, async () => {
    const out = await ctx.cli.run(['check', ctx.root, '--json']);
    assert.equal(out.code, 0, out.stdout);
    assert.equal(out.json.type, TYPE);
    assert.deepEqual(findingsOf(out), ['warning datasets/unused nothing on the page names it; Sources labels it "Unused".']);
  });

  it('check says when a live query names a connector the owner has not set up', T, async () => {
    const out = await ctx.cli.run(['check', ctx.root, '--json'], { env: { OPEN_ARTIFACT_CONNECTORS: path.join(path.dirname(ctx.connectors), 'none.json') } });
    assert.equal(out.code, 0, out.stdout);
    const warnings = findingsOf(out).filter(line => line.includes('there is no connectors.json'));
    assert.deepEqual(warnings.map(line => line.split(' ')[1]), ['datasets/broken', 'datasets/orders', 'datasets/tickets']);
  });

  const broken = {
    'a file without updated': [root => { const d = readDoc(root, 'datasets/signups'); delete d.updated; writeDoc(root, 'datasets/signups', d); }, 'error datasets/signups needs updated'],
    'an old rows dataset': [root => writeDoc(root, 'datasets/old', { title: 'Old', source: { kind: 'rows', rows: [] } }), 'error datasets/old is an old rows dataset'],
    'a url that is no upload': [root => { const d = readDoc(root, 'datasets/signups'); d.source.url = 'https://example.com/a.csv'; writeDoc(root, 'datasets/signups', d); }, 'error datasets/signups source.url "https://example.com/a.csv" isn’t an attached file'],
    'a filter with no rule': [root => { const d = readDoc(root, 'datasets/orders'); delete d.source.rules; writeDoc(root, 'datasets/orders', d); }, 'error datasets/orders {{region}} is written into the query’s text with no rule'],
    'a rule with a word it does not know': [root => { const d = readDoc(root, 'datasets/orders'); d.source.rules.region.bogus = 1; writeDoc(root, 'datasets/orders', d); }, 'error datasets/orders source.rules are refused'],
    'a look with no set': [root => writeDoc(root, 'dash/look', { corners: '8px' }), 'error dash/look has no set the dashboard can use'],
    'a file named without its format': [root => { const d = readDoc(root, 'datasets/signups'); d.source.name = 'signups'; delete d.source.format; writeDoc(root, 'datasets/signups', d); }, 'warning datasets/signups source.format is left out'],
    'a mark of no dataset': [root => { const d = readDoc(root, 'files/index.html'); d.text += '\n<b data-source="nosuch" data-field="x">1</b>'; writeDoc(root, 'files/index.html', d); }, 'error files/index.html <b>: data-source="nosuch" names no dataset or dash.calc'],
    'a dataset read but not marked': [root => { const d = readDoc(root, 'files/app.js'); d.text += '\ndash.data("unused");'; writeDoc(root, 'files/app.js', d); }, 'error datasets/unused files/app.js reads it, but no element is marked'],
    'a token that does not exist': [root => { const d = readDoc(root, 'files/app.css'); d.text += '\n.x { color: var(--dash-nope); }'; writeDoc(root, 'files/app.css', d); }, 'error files/index.html var(--dash-nope) is no token of the dashboard'],
    'no dash/meta': [root => fs.rmSync(docPath(root, 'dash/meta')), 'error dash/meta is missing'],
    'saved rows kept outside data/': [root => writeDoc(root, 'datasets/notes', { title: 'Notes', source: { kind: 'store', path: 'notes/all' } }), 'error datasets/notes source.path "notes/all" isn’t under data/'],
    'saved rows in a person’s own reports': [root => writeDoc(root, 'datasets/notes', { title: 'Notes', source: { kind: 'store', path: 'data/users/me/check' } }), 'error datasets/notes source.path "data/users/me/check" is one of the page’s own reports'],
    'a page that failed in the owner’s browser': [
      root => writeDoc(root, 'data/users/owner/check', { v: 1, status: 'failed', at: Date.now(), page: [{ kind: 'error', name: 'TypeError', message: 'x', file: 'app.js', count: 1 }] }),
      'error data/users/owner/check the page\'s code threw: TypeError in app.js',
    ],
  };
  for (const [name, [edit, expected]] of Object.entries(broken))
    it(`check names ${name}`, T, async () => {
      const root = copy(name.replace(/[^a-z]+/gi, '-'));
      edit(root);
      const out = await ctx.cli.run(['check', root, '--json']);
      assert.ok(out.json, out.stdout + out.stderr);
      assert.equal(out.code, expected.startsWith('error') ? 1 : 0, out.stdout);
      assert.ok(findingsOf(out).some(line => line.startsWith(expected)), `${expected}\nnot in:\n${findingsOf(out).join('\n')}`);
    });

  it('check passes saved rows read and marked by the page before any row exists, and a form that saves them', T, async () => {
    const root = copy('saved-rows');
    writeDoc(root, 'datasets/notes', { title: 'Notes', source: { kind: 'store', path: 'data/users/me/notes/items' } });
    const page = readDoc(root, 'files/index.html');
    page.text += '\n<form id="note-form"><input name="text"><button>Save</button></form>\n<ul id="notes" data-source="notes"></ul>';
    writeDoc(root, 'files/index.html', page);
    const app = readDoc(root, 'files/app.js');
    app.text += '\ndash.onData(() => { const notes = dash.data("notes"); document.getElementById("notes").textContent = String(notes.rows.length); });';
    writeDoc(root, 'files/app.js', app);
    const out = await ctx.cli.run(['check', root, '--json']);
    assert.equal(out.code, 0, out.stdout);
    const about = findingsOf(out).filter(line => line.includes('notes') || line.includes('form'));
    assert.deepEqual(about, [], about.join('\n'));
  });

  it('write-db keeps shared saved rows and read-db lists them', T, async () => {
    const root = copy('saved-rows-write');
    await ctx.cli.json(['write-db', root, JSON.stringify([{ op: 'set', path: 'data/team/notes/n1', data: { text: 'hi' } }])]);
    assert.deepEqual(readDoc(root, 'data/team/notes/n1'), { text: 'hi' });
    const listed = await ctx.cli.json(['read-db', root, 'data/team/notes']);
    assert.ok(JSON.stringify(listed).includes('"hi"'), JSON.stringify(listed));
  });

  const refused = {
    'a person’s own document': [[{ op: 'set', path: 'data/users/owner/check', data: {} }], 'READ_ONLY_PATH'],
    'a dataset id the page ignores': [[{ op: 'set', path: 'dash/params', data: { region: 'North' } }, { op: 'set', path: 'datasets/a.b', data: { title: 'x' } }], 'REFUSED'],
    'a page file without its text': [[{ op: 'set', path: 'files/extra.js', data: { body: '' } }], 'REFUSED'],
    'a page file over 256 KB': [[{ op: 'set', path: 'files/extra.js', data: { text: 'x'.repeat(300 * 1024) } }], 'TOO_LARGE'],
  };
  for (const [name, [writes, code]] of Object.entries(refused))
    it(`write-db refuses ${name} and writes nothing`, T, async () => {
      const root = copy('refused');
      const before = fs.readFileSync(docPath(root, 'dash/params'), 'utf8');
      const out = await ctx.cli.run(['write-db', root, JSON.stringify(writes)]);
      assert.equal(out.code, 1, out.stdout);
      assert.equal(out.json?.error, code, out.stdout);
      assert.match(out.json.message, /Nothing was written\.$/);
      assert.equal(fs.readFileSync(docPath(root, 'dash/params'), 'utf8'), before);
      assert.ok(!fs.existsSync(docPath(root, 'files/extra.js')) && !fs.existsSync(docPath(root, 'data/users/owner/check')));
    });

  it('write-db starts a dashboard in an empty folder from its dash/meta, and update removes a key with __delete__', T, async () => {
    const root = path.join(tmpDir('data-new'), 'dashboard');
    const first = await ctx.cli.json(['write-db', root, JSON.stringify([{ op: 'set', path: 'dash/meta', data: { title: 'New' } }])]);
    assert.equal(first.writes[0].created, true);
    const refusedRoot = path.join(tmpDir('data-none'), 'dashboard');
    const none = await ctx.cli.run(['write-db', refusedRoot, JSON.stringify([{ op: 'set', path: 'notes/a', data: {} }])]);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /not a db-backed artifact/);
    await ctx.cli.json(['write-db', root, JSON.stringify([{ op: 'update', path: 'dash/meta', data: { title: { __delete__: true }, lang: 'en' } }])]);
    assert.deepEqual(readDoc(root, 'dash/meta'), { lang: 'en' });
  });

  it('history keeps no version for a change to dash/settings alone, and one for dash/meta', T, async () => {
    const root = copy('history');
    const paths = out => out.versions.flatMap(version => version.files.map(file => file.path));
    const before = await ctx.cli.json(['history', root, '--json']);
    assert.ok(fs.existsSync(docPath(root, 'dash/settings')), 'the fixture writes dash/settings');
    assert.ok(!paths(before).some(p => p.includes('dash/settings')), paths(before).join(', '));
    await ctx.cli.json(['write-db', root, JSON.stringify([{ op: 'set', path: 'dash/settings', data: { updates: 'day' } }])]);
    const settings = await ctx.cli.json(['history', root, '--json']);
    assert.deepEqual(settings.versions.map(version => version.n), before.versions.map(version => version.n));
    await ctx.cli.json(['write-db', root, JSON.stringify([{ op: 'update', path: 'dash/meta', data: { title: 'Renamed' } }])]);
    const meta = await ctx.cli.json(['history', root, '--json']);
    assert.equal(meta.versions.length, before.versions.length + 1);
    assert.deepEqual(meta.versions[0].files.map(file => file.path), ['db/dash/meta']);
  });

  it('upload stores a file under a name, read-db --text prints a page file, delete-asset refuses an upload in use', T, async () => {
    const root = copy('uploads');
    const src = path.join(tmpDir('data-src'), 'rows');
    fs.writeFileSync(src, 'a,b\n1,2\n');
    const up = await ctx.cli.run(['upload', root, src, '--name', 'rows.csv']);
    assert.equal(up.code, 0, up.stderr);
    const [url, type, size, name] = up.stdout.trim().split('\t');
    assert.match(url, /^\/_blob\/[0-9a-f]{32}$/);
    assert.deepEqual([type, size, name], ['text/csv', '8', 'rows.csv']);
    const missing = await ctx.cli.run(['upload', root, `${src}.gone`]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /No such file/);

    const text = await ctx.cli.run(['read-db', root, 'files/index.html', '--text']);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout, readDoc(root, 'files/index.html').text);
    const notText = await ctx.cli.run(['read-db', root, 'dash/meta', '--text']);
    assert.equal(notText.code, 1);

    const signups = readDoc(root, 'datasets/signups').source.url;
    const inUse = await ctx.cli.run(['delete-asset', root, signups]);
    assert.equal(inUse.code, 1);
    assert.equal(inUse.json?.error, 'IN_USE', inUse.stdout);
    const gone = await ctx.cli.json(['delete-asset', root, url]);
    assert.equal(gone.deleted, url);
  });

  it('open serves the dashboard, wait (and comments --wait) ends quietly with nothing sent, stop ends the server', T, async () => {
    const root = copy('open');
    const opened = await ctx.cli.json(['open', root, '--json']);
    assert.equal(opened.type, TYPE);
    const page = await fetch(opened.url);
    assert.equal(page.status, 200);
    const wait = await ctx.cli.run(['wait', root, '--timeout', '1']);
    assert.equal(wait.code, 2, wait.stdout);
    const commentsWait = await ctx.cli.run(['comments', root, '--wait', '--timeout', '1']);
    assert.equal(commentsWait.code, 2, commentsWait.stdout);
    const comments = await ctx.cli.run(['comments', root]);
    assert.equal(comments.code, 0);
    const stop = await ctx.cli.run(['stop']);
    assert.equal(stop.code, 0, stop.stderr);
  });
});

/**
 * A dashboard whose script, once the page is up, tries a save to the reader's own folder and one to the shared rows,
 * sets its own link (`#revenue`), and keeps what each save answered in `window.__writes`.
 */
function writeTryingDashboard(root) {
  writeDoc(root, 'dash/meta', { title: 'Saves' });
  writeDoc(root, 'files/index.html', { text: '<main><h1 id="saves">Saves</h1></main>\n<script src="app.js"></script>\n' });
  writeDoc(root, 'files/app.js', {
    text: `openartifact.use('db').then(async (db) => {
  const out = {};
  for (const [name, path] of [['own', 'data/users/me/notes'], ['team', 'data/team/notes/n1']]) {
    try { await db.write([{ op: 'set', path, data: { text: name } }]); out[name] = 'ok'; } catch (error) { out[name] = error.message; }
  }
  dash.setLink('revenue');
  window.__writes = out;
});
`,
  });
}

/** A page on an origin of its own that frames `src` (as a chat or a doc embeds a dashboard). */
async function framing(src) {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><iframe id="framed" src="${src}" style="width:900px;height:600px;border:0"></iframe>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}

const browserSkip = browserOff || !findChrome() ? 'no browser (E2E_BROWSER=0 or no Chrome)' : false;
const writes = `(window.__writes ? JSON.stringify(window.__writes) : null)`;
const answered = async page => (await page.evaluateAll(writes)).find(Boolean);
/** The address fragment of the frame the dashboard runs in. */
const pageHash = async page => (await page.evaluateAll(`window.__writes ? location.hash : null`)).find(hash => hash !== null);

describe(`${TYPE} in a browser`, { skip: skip() || browserSkip }, () => {
  let browser;
  before(async () => { browser = await launch(); });
  after(async () => {
    await browser?.close();
    removeTmp();
  });

  it('lets a commenter’s page save to their own folder only, and a viewer’s page nowhere', T, async () => {
    const { createTypeServer } = await import('../packages/type-server/src/index.ts');
    const server = createTypeServer({
      secret: 'data-guests', idleMs: 0, assetsDir: path.join(typePath(TYPE), 'scripts'),
      lanAddresses: () => [], isLocal: req => !req.headers['x-test-guest'],
    });
    let guest;
    try {
      const root = path.join(tmpDir('data-guests'), 'dashboard');
      writeTryingDashboard(root);
      await server.listen();
      const opened = await server.open({ root, type: TYPE, title: 'Saves' });
      const shared = await fetch(new URL('/__open-artifact/share', opened.url), {
        method: 'POST',
        headers: { authorization: 'Bearer data-guests', 'content-type': 'application/json' },
        body: JSON.stringify({ id: opened.id, lan: true }),
      });
      assert.equal(shared.status, 200);
      const { links } = await shared.json();
      // The test listener has no LAN interface: each invitation goes to its loopback address.
      const invite = role => new URL(new URL(links[role].url).pathname, opened.url).href;
      guest = await browser.load('about:blank');
      await guest.cdp('Network.setExtraHTTPHeaders', { headers: { 'x-test-guest': '1' } });
      const joinAs = async (role, name) => {
        await guest.cdp('Page.navigate', { url: invite(role) });
        assert.ok(await guest.waitFor("document.querySelector('input[name=name]')", 5000));
        await guest.evaluate(`document.querySelector('[name=name]').value = ${JSON.stringify(name)}; document.querySelector('form').requestSubmit()`);
        assert.ok(await guest.waitFor(writes, 15000), `${role}: the page never tried to save`);
        return JSON.parse(await answered(guest));
      };

      const commenter = await joinAs('commenter', 'Cam');
      assert.equal(commenter.own, 'ok');
      assert.match(commenter.team, /own folder/);
      const users = path.join(root, 'db', 'data', 'users');
      const folders = fs.readdirSync(users).filter(name => name.startsWith('guest-'));
      assert.equal(folders.length, 1);
      assert.deepEqual(readDoc(root, `data/users/${folders[0]}/notes`), { text: 'own' });
      assert.equal(fs.existsSync(docPath(root, 'data/team/notes/n1')), false);

      const viewer = await joinAs('viewer', 'Vic');
      assert.match(viewer.own, /owner and editors/);
      assert.match(viewer.team, /owner and editors/);
      assert.deepEqual(fs.readdirSync(users).filter(name => name.startsWith('guest-')), folders);
      assert.equal(fs.existsSync(docPath(root, 'data/team/notes/n1')), false);
    } finally {
      await guest?.close();
      await server.stop();
    }
  });

  it('offers the formats on an empty dashboard, tells the agent the pick, and hands it imported files', T, async () => {
    const { dir } = install(typePath(TYPE), 'data-empty-type');
    const empty = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-empty-state'), 'state'), OPEN_ARTIFACT_USER: 'E2E' });
    const root = path.join(tmpDir('data-empty'), 'dashboard');
    let page, waiter;
    try {
      const opened = await empty.json(['open', root, '--type', TYPE, '--title', 'Imports', '--json']);
      waiter = await empty.start(['wait', root, '--timeout', '60'], { firstLine: false });
      assert.ok(await until(() => fs.existsSync(path.join(root, '_agent', 'waiting')), 10000), 'wait wrote no heartbeat');
      page = await browser.load(opened.url, { ready: "document.querySelector('.dash-empty[data-forms]')", ignore: [/\/favicon\.ico$/] });
      const labels = await page.evaluateAll("[...document.querySelectorAll('.dash-forms label')].map(label => label.textContent.trim()).join('|')");
      assert.ok(labels.includes('Dashboard|Visual analysis|Scrollyteller|Visual short'), labels.join(' / '));
      await page.evaluateAll("document.querySelector('.dash-forms input[value=scroll-story]')?.click()");
      assert.ok(
        await until(async () => (await empty.json(['context', root, '--json'])).context?.form === 'scroll-story', 10000),
        'the picked format never reached the view context',
      );
      const handed = await page.evaluateAll(`(() => {
        const input = document.querySelector('.dash-empty input[type=file]');
        if (!input) return false;
        const files = new DataTransfer();
        files.items.add(new File(['month,sales\\n2026-01,120\\n'], 'sales.csv', { type: 'text/csv' }));
        files.items.add(new File([new Uint8Array([80, 75, 3, 4])], 'Budget.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        input.files = files.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      assert.ok(handed.includes(true), 'no file input on the empty page');
      const { code } = await waiter.exited;
      const said = waiter.stdout();
      assert.equal(code, 0, said);
      assert.match(said, /Build this dashboard as a Scrollyteller from the files I imported/);
      assert.match(said, /"sales\.csv" at \/_blob\/[0-9a-f]{32} \(CSV\)/);
      assert.match(said, /"Budget\.xlsx" at \/_blob\/[0-9a-f]{32} \(Excel workbook\)/);
      assert.deepEqual(fs.readdirSync(path.join(root, '_blobs')).map(name => path.extname(name)).sort(), ['.csv', '.xlsx']);
      assert.deepEqual(page.problems, []);
    } finally {
      waiter?.child.kill();
      await page?.close();
      await empty.run(['stop']).catch(() => {});
    }
  });

  it('shows a dashboard framed through the Shell at #view-inline read only, with no bar', T, async () => {
    const overrides = {
      OPEN_ARTIFACT_HOME: tmpDir('data-daemon'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('data-shell-state'),
      OPEN_ARTIFACT_USER_TYPES: tmpDir('data-user-types'),
      OPEN_ARTIFACT_BROWSER: 'none',
    };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    let daemon, shell, host, framed;
    try {
      const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
      const { api, readDaemon } = await import('../packages/daemon/src/client.ts');
      daemon = await startDaemon({ port: 0, idleMs: 0, quiet: true, builtinTypesDir: path.dirname(typePath(TYPE)) });
      const state = await readDaemon();
      const made = await api(state, 'tools.call', {
        name: 'Artifact', arguments: { action: 'publish', type_url: `open-artifact://type/${TYPE}`, title: 'Saves' },
        caller: { harness: 'e2e', session: 'data-inline', workspace: tmpDir('data-workspace') },
      });
      assert.equal(made.error, undefined, JSON.stringify(made.error));
      const id = made.url.split('/').at(-1);
      const root = daemon.store.require(id).root;
      writeTryingDashboard(root);
      const address = `${state.url}/a/${id}#view-inline`;
      const shareButton = `Boolean(document.querySelector('header button[aria-label="Share"]'))`;
      const inline = `document.documentElement.classList.contains('dash-inline-view')`;

      // Opened on its own, the same address is the Shell with its bar and the full editor, which saves.
      shell = await browser.load(address, { ready: writes });
      assert.ok((await shell.evaluateAll(shareButton)).includes(true));
      assert.deepEqual((await shell.evaluateAll(inline)).filter(Boolean), []);
      assert.deepEqual(JSON.parse(await answered(shell)), { own: 'ok', team: 'ok' });
      assert.equal(await pageHash(shell), '#revenue');
      await shell.close();
      shell = undefined;
      fs.rmSync(path.join(root, 'db', 'data'), { recursive: true, force: true });

      // Framed by another page: no bar, the embedded view, every save refused, and the fragment kept on the Shell and on
      // the page, whose own link leaves it as it was.
      host = await framing(address);
      framed = await browser.load(host.url, { ready: writes });
      assert.ok((await framed.evaluateAll(inline)).includes(true));
      assert.deepEqual((await framed.evaluateAll(shareButton)).filter(Boolean), []);
      assert.deepEqual(JSON.parse(await answered(framed)), { own: 'This embedded dashboard is view-only.', team: 'This embedded dashboard is view-only.' });
      assert.equal(fs.existsSync(path.join(root, 'db', 'data')), false);
      assert.ok((await framed.evaluateAll(`location.pathname === ${JSON.stringify(`/a/${id}`)} && location.hash`)).includes('#view-inline'));
      assert.equal(await pageHash(framed), '#view-inline');
      assert.deepEqual(framed.problems, []);
    } finally {
      await framed?.close();
      await host?.close();
      await shell?.close();
      await daemon?.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('prints the dashboard itself, not a blank sheet, beside nothing of the editor', T, async () => {
    // Issue #24: #dash-root carries the print path's mark too, and the rule hiding every unmarked child of a marked
    // element hid the dashboard's own content. The PDF button and the browser's Print both mark the path; `beforeprint`
    // does it here, under print media, as the dialog would lay the page out.
    const { dir } = install(typePath(TYPE), 'data-print-type');
    const printing = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('data-print-state'), 'state'), OPEN_ARTIFACT_USER: 'E2E' });
    const root = path.join(tmpDir('data-print'), 'dashboard');
    let page;
    try {
      const load = await run(path.join(fixtures, 'data', 'load.mjs'), [printing.script, root], { env: printing.env() });
      assert.equal(load.code, 0, `the fixture did not load: ${load.stderr}`);
      const opened = await printing.json(['open', root, '--json']);
      page = await browser.load(opened.url, { ready: "document.querySelector('#dash-root [data-source]')", timeout: 60000, settle: 1500, ignore: [/\/favicon\.ico$/] });
      await page.cdp('Emulation.setEmulatedMedia', { media: 'print' });
      const shown = `(() => {
        const root = document.getElementById('dash-root');
        const note = document.querySelector('[data-dash-print-note]');
        const beside = [...document.body.querySelectorAll('*')].filter(e => !e.contains(root) && !root.contains(e) && !e.closest('[data-dash-print-note]') && e.getClientRects().length > 0);
        return { height: Math.round(root.getBoundingClientRect().height), text: root.innerText.trim(), note: note?.getClientRects().length > 0 ? note.innerText.trim() : '', beside: beside.length };
      })()`;
      const before = await page.evaluate(shown);
      assert.match(before.text, /Sales and signups/, 'the fixture drew no title');
      await page.evaluate("window.dispatchEvent(new Event('beforeprint'))");
      assert.ok(await page.evaluate("document.getElementById('dash-root').hasAttribute('data-dash-print-path')"), 'beforeprint marked no path');
      const printed = await page.evaluate(shown);
      assert.match(printed.text, /Sales and signups/, `the printed dashboard is blank: ${JSON.stringify(printed)}`);
      assert.equal(printed.height, before.height, 'the dashboard printed at another length');
      assert.match(printed.note, /^Data as of /, 'the data note did not print under the dashboard');
      assert.equal(printed.beside, 0, 'the editor around the dashboard printed');
      await page.evaluate("window.dispatchEvent(new Event('afterprint'))");
      assert.equal(await page.evaluate("document.querySelectorAll('[data-dash-print-path]').length"), 0, 'afterprint left the path marked');
    } finally {
      await page?.close();
      await printing.run(['stop']).catch(() => {});
    }
  });
});
