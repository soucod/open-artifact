// End-to-end tests of the docs type's command line and editor: create a doc from markdown, read its tabs
// and outline, edit a tab and suggest an edit, add and remove tabs and a dropdown list in one batch, export markdown,
// Word and a page to print (and PDF when Chrome is here), import them back as tabs, archive the folder; open, wait
// and stop.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { cli } from './lib/cli.mjs';
import { png, until } from './lib/http.mjs';
import { buttonNamed, chromeSkip, clickOn, startWait, textIn } from './lib/editor.mjs';
import { browserOff, install, removeTmp, tmpDir, typePath } from './lib/target.mjs';

const T = { timeout: 90000 };
const TYPE = 'docs';
const SOURCE = ['# Plan', '', 'Intro words with a [link](https://example.com).', '', '## Goals', '', '- One', '- Two', '', '| Owner | Task |', '| --- | --- |', '| Ana | Design |', ''].join('\n');

async function clickInEditor(page, element) {
  let point;
  assert.ok(await until(async () => (point = await page.evaluate(`(() => {
    const frame = document.querySelector('iframe[name="open-artifact-shell"]');
    const rect = (document => (${element})?.getBoundingClientRect())(frame.contentDocument);
    const outer = frame.getBoundingClientRect();
    return rect?.width ? [outer.x + rect.x + rect.width / 2, outer.y + rect.y + rect.height / 2] : null;
  })()`))), 'Missing editor control: ' + element);
  await page.click(...point);
}

function skip() {
  const dir = typePath(TYPE);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return `${TYPE} is not in ${dir}`;
  const missing = ['scripts/cli.mjs', 'scripts/editors/docs/index.html', 'scripts/pdf-reader.mjs'].filter(f => !fs.existsSync(path.join(dir, f)));
  return missing.length ? `${TYPE} is not built (npm run build): no ${missing.join(', ')}` : false;
}

describe(TYPE, { skip: skip() }, () => {
  const ctx = {};
  const tabs = async root => (await ctx.cli.json(['read', root])).files;
  const call = (verb, root, body) => ctx.cli.json([verb, root, JSON.stringify(body)]);

  before(async () => {
    const { dir } = install(typePath(TYPE), TYPE);
    ctx.home = tmpDir('docs-home');
    ctx.cli = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('docs-state'), 'state'), HOME: ctx.home, OPEN_ARTIFACT_USER: 'E2E' });
    ctx.root = path.join(tmpDir('docs-root'), 'plan');
    const source = path.join(tmpDir('docs-src'), 'plan.md');
    fs.writeFileSync(source, SOURCE);
    const created = await ctx.cli.json(['create', ctx.root, '--markdown', source, '--name', 'Plan']);
    assert.equal(created.created.name, 'Plan');
    ctx.tab = created.lids.f;
  });

  after(async () => {
    await ctx.cli?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('create writes doc/doc.json and a tab, check passes it, read gives the outline', T, async () => {
    assert.ok(fs.existsSync(path.join(ctx.root, 'doc', 'doc.json')));
    const check = await ctx.cli.run(['check', ctx.root, '--json']);
    assert.equal(check.code, 0, check.stdout);
    assert.equal(check.json.type, TYPE);
    assert.deepEqual((await tabs(ctx.root)).map(file => file.id), [ctx.tab]);
    const outline = await ctx.cli.run(['read', ctx.root, ctx.tab]);
    assert.equal(outline.code, 0, outline.stderr);
    assert.match(outline.stdout, /heading='1'>Plan</);
    assert.match(outline.stdout, /<list [^>]*kind='bullet'/);
    const markdown = await ctx.cli.run(['read', ctx.root, ctx.tab, '--markdown']);
    assert.match(markdown.stdout, /\| Ana \| Design \|/);
  });

  it('update writes blocks from markdown; a suggested edit stays out of exports until it is accepted', T, async () => {
    const plain = await call('update', ctx.root, { tab: ctx.tab, ops: [{ op: 'insert', target: { kind: 'root' }, source: { markdown: '## Risks\n\nNone yet, **so far**.' } }] });
    assert.match(plain.xml, /heading='2'>Risks</);
    const suggested = await call('update', ctx.root, { tab: ctx.tab, suggest: true, ops: [{ op: 'insert', target: { kind: 'root' }, source: { markdown: 'A suggested line.' } }] });
    assert.match(suggested.suggestId, /^sg_/);
    const open = await ctx.cli.json(['read', ctx.root, ctx.tab, '--suggestions']);
    assert.deepEqual(open.suggestions.map(s => [s.id, s.via]), [[suggested.suggestId, 'agent']]);
    const exported = await ctx.cli.run(['export', ctx.root, '--tab', ctx.tab]);
    assert.match(exported.stdout, /None yet, \*\*so far\*\*\./);
    assert.doesNotMatch(exported.stdout, /A suggested line/);
    const refused = await ctx.cli.run(['update', ctx.root, JSON.stringify({ tab: ctx.tab, ops: [{ op: 'delete', target: { kind: 'blocks', ids: ['nope.1'] } }] })]);
    assert.equal(refused.code, 1, refused.stdout);
  });

  it('batch adds a tab and a dropdown list at once; delete removes a tab but never the last', T, async () => {
    const out = await call('batch', ctx.root, {
      batch: [
        { verb: 'create', object: 'file', payload: { birthName: 'Notes' } },
        { verb: 'create', object: 'enum', payload: { name: 'Status', options: [{ name: 'Open' }, { name: 'Done' }] } },
      ],
    });
    assert.equal(out.acks.length, 2);
    const notes = out.acks[0].minted;
    assert.match(notes, /^[0-9a-f]{8}-[0-9a-f]{4}$/);
    assert.deepEqual((await tabs(ctx.root)).map(file => file.name), ['Tab 1', 'Notes']);
    await call('delete', ctx.root, { ref: { object: 'file', id: notes } });
    assert.deepEqual((await tabs(ctx.root)).map(file => file.id), [ctx.tab]);
    const last = await ctx.cli.run(['delete', ctx.root, JSON.stringify({ ref: { object: 'file', id: ctx.tab } })]);
    assert.equal(last.code, 1);
  });

  it('export writes Word and a page to print; import brings markdown and Word back as new tabs', T, async () => {
    const out = tmpDir('docs-out');
    const docx = path.join(out, 'plan.docx');
    const html = path.join(out, 'plan.html');
    assert.equal((await ctx.cli.run(['export', ctx.root, '--format', 'docx', '--out', docx])).code, 0);
    assert.equal(fs.readFileSync(docx).subarray(0, 2).toString(), 'PK');
    assert.equal((await ctx.cli.run(['export', ctx.root, '--format', 'html', '--out', html])).code, 0);
    assert.match(fs.readFileSync(html, 'utf8'), /<h1[^>]*>Plan<\/h1>/);
    const md = path.join(out, 'extra.md');
    fs.writeFileSync(md, '# Extra\n\n- [ ] A task\n- [x] Done\n');
    const fromMarkdown = await ctx.cli.json(['import', ctx.root, md, '--name', 'Extra']);
    assert.equal(fromMarkdown.format, 'markdown');
    const fromWord = await ctx.cli.json(['import', ctx.root, docx, '--name', 'From Word']);
    assert.equal(fromWord.format, 'docx');
    const names = (await tabs(ctx.root)).map(file => file.name);
    assert.deepEqual(names, ['Tab 1', 'Extra', 'From Word']);
    const word = (await tabs(ctx.root)).find(file => file.name === 'From Word');
    const back = await ctx.cli.run(['export', ctx.root, '--tab', word.id]);
    assert.match(back.stdout, /None yet, \*\*so far\*\*\./);
  });

  it('export prints a PDF with Chrome, and import reads its words back', { ...T, skip: browserOff ? 'E2E_BROWSER=0' : findChrome() ? false : 'no Chrome found' }, async () => {
    const pdf = path.join(tmpDir('docs-pdf'), 'plan.pdf');
    const out = await ctx.cli.run(['export', ctx.root, '--tab', ctx.tab, '--format', 'pdf', '--paper', 'a4', '--out', pdf], { env: { CHROME_PATH: findChrome() } });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(fs.readFileSync(pdf).subarray(0, 4).toString(), '%PDF');
    const imported = await ctx.cli.json(['import', ctx.root, pdf, '--name', 'From PDF']);
    assert.equal(imported.format, 'pdf');
    const tab = (await tabs(ctx.root)).find(file => file.name === 'From PDF');
    const words = await ctx.cli.run(['export', ctx.root, '--tab', tab.id]);
    assert.match(words.stdout, /Intro words/);
  });

  it('a selection comment can be written and posted with the comments list open', { ...T, skip: chromeSkip() }, async () => {
    const { url } = await ctx.cli.json(['open', ctx.root, '--json']);
    const browser = await launch();
    try {
      const page = await browser.load(url, { ready: textIn('Intro words'), ignore: [/\/favicon\.ico$/] });
      await clickOn(page, buttonNamed('Comment options'));
      await clickOn(page, buttonNamed('Show all comments'));
      await clickInEditor(page, "document.querySelector('.doc-text h1')");
      await page.press('Home');
      await page.press('End', { shift: true });
      await clickInEditor(page, buttonNamed('Comment'));
      const field = 'aside[aria-label="Comments"] textarea[aria-label="Add a comment"]';
      assert.ok(await page.waitFor(`document.activeElement.matches('${field}')`, 5000), 'the list did not focus the new comment');
      await page.type('Ready for review');
      await page.press('Enter');
      assert.ok(await page.waitFor(`document.querySelector('aside')?.innerText.includes('Ready for review') && !document.querySelector('${field}')`, 5000));
      const { threads } = await ctx.cli.json(['comments', ctx.root, '--json']);
      assert.equal(threads[0].messages[0].text, 'Ready for review');
      assert.equal((await page.evaluateAll(`document.querySelector('.doc-text h1')?.textContent`)).find(Boolean), 'Plan');
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
    }
  });

  it('exports from the shell and duplicates the live document under an independent identity', { ...T, skip: chromeSkip() }, async () => {
    const { putDocBlob } = await import('../packages/type-server/src/docs/blobs.ts');
    const picture = png();
    const ref = putDocBlob(ctx.root, picture);
    await call('update', ctx.root, { tab: ctx.tab, ops: [{ op: 'insert', target: { kind: 'root' }, source: { markdown: '![Review diagram](' + ref + ')' } }] });
    const { url } = await ctx.cli.json(['open', ctx.root, '--json']);
    const browser = await launch();
    try {
      const page = await browser.load(url, { ready: textIn('Intro words'), ignore: [/\/favicon\.ico$/] });
      await clickOn(page, buttonNamed('Artifact options'));
      await clickOn(page, buttonNamed('Export'));
      const rows = await page.evaluate("[...document.querySelectorAll('[data-export-row]')].map(b => b.dataset.exportRow)");
      assert.ok(rows.includes('PDF (.pdf) · Whole document · US Letter'));
      assert.ok(rows.includes('PDF (.pdf) · This tab · A4'));
      await clickOn(page, buttonNamed('Markdown (.md) · This tab'));
      const dir = path.join(ctx.home, 'Downloads');
      assert.ok(await until(() => fs.existsSync(dir) && fs.readdirSync(dir).some(file => file.endsWith('.md'))),
        `no .md in ${dir}: ${fs.existsSync(dir) ? fs.readdirSync(dir).join(', ') : 'no folder'}`);
      const file = fs.readdirSync(dir).find(name => name.endsWith('.md'));
      assert.match(fs.readFileSync(path.join(dir, file), 'utf8'), /None yet, \*\*so far/);
      await clickOn(page, buttonNamed('Artifact options'));
      await clickOn(page, buttonNamed('Duplicate'));
      assert.ok(await page.waitFor("document.activeElement.getAttribute('aria-label') === 'Name of the copy'"));
      await page.type('Independent review');
      await page.press('Enter');
      assert.ok(await page.waitFor("document.querySelector('header')?.innerText.includes('Independent review')"));
      const copy = path.join(path.dirname(ctx.root), 'Independent review');
      const manifest = root => JSON.parse(fs.readFileSync(path.join(root, 'doc/doc.json')));
      assert.notEqual(manifest(copy).id, manifest(ctx.root).id);
      assert.deepEqual(await tabs(copy), await tabs(ctx.root));
      assert.deepEqual((await ctx.cli.json(['read', copy, ctx.tab, '--suggestions'])).suggestions,
        (await ctx.cli.json(['read', ctx.root, ctx.tab, '--suggestions'])).suggestions);
      assert.deepEqual((await ctx.cli.json(['comments', copy, '--json'])).threads, []);
      assert.equal(fs.existsSync(path.join(copy, 'doc/tabs/.deleted')), false);
      assert.deepEqual(fs.readFileSync(path.join(copy, '_blobs', ref.slice(5) + '.png')), picture);
      await call('update', copy, { tab: ctx.tab, ops: [{ op: 'insert', target: { kind: 'root' }, source: { markdown: 'Only in the copy' } }] });
      assert.doesNotMatch((await ctx.cli.run(['export', ctx.root])).stdout, /Only in the copy/);
      assert.deepEqual(page.problems, []);
    } finally { await browser.close(); }
  });

  it('opens a linked tab through each guest role, and enforces its editing and commenting permissions', { ...T, skip: chromeSkip() }, async () => {
    const { createTypeServer } = await import('../packages/type-server/src/index.ts');
    const server = createTypeServer({
      secret: 'docs-roles', idleMs: 0, assetsDir: path.join(typePath('docs'), 'scripts'),
      lanAddresses: () => [], isLocal: req => !req.headers['x-test-guest'],
    });
    const browser = await launch();
    let threadId;
    try {
      const root = tmpDir('docs-guests');
      fs.cpSync(path.join(ctx.root, 'doc'), path.join(root, 'doc'), { recursive: true });
      await server.listen();
      const { url } = await server.open({ root, type: 'docs', title: 'Guest review' });
      const tab = (await tabs(ctx.root)).find(file => file.name === 'Extra');
      const owner = await browser.load(url + '#' + tab.id, { ready: "document.querySelector('.doc-text h1')?.textContent === 'Extra'" });
      assert.ok(await until(() => {
        try { return JSON.parse(fs.readFileSync(path.join(root, '_agent/view-context.json'))).context.tab === tab.id; } catch { return false; }
      }), 'active tab was not published to the agent');
      await clickOn(owner, buttonNamed('Share'));
      await owner.evaluate("Object.defineProperty(navigator.clipboard, 'writeText', {configurable:true,value:async text=>{window.invite=text}})");
      const guest = await browser.load('about:blank');
      await guest.cdp('Network.setExtraHTTPHeaders', { headers: { 'x-test-guest': '1' } });
      for (const role of ['commenter', 'viewer', 'editor']) {
        const link = `document.querySelector('[data-share-link=${role}]')`;
        assert.ok(await owner.waitFor(link));
        if (!(await owner.evaluate(link + '.title'))) {
          await owner.evaluate(link + ".querySelector('button').click()");
          assert.ok(await owner.waitFor(link + '.title'));
        }
        await owner.evaluate(link + ".querySelector('button').click()");
        assert.ok(await owner.waitFor(`window.invite?.startsWith(${link}.title) && document.querySelector('[data-share-security]')`));
        const invite = new URL(await owner.evaluate('window.invite'));
        invite.host = new URL(url).host;
        assert.equal(invite.hash, '#' + tab.id);
        if (role === 'viewer') {
          invite.hash = '';
          invite.searchParams.set('tab', tab.id);
          invite.searchParams.set('comment', threadId);
        }
        await guest.cdp('Page.navigate', { url: invite.href });
        assert.ok(await guest.waitFor("document.querySelector('input[name=name]')"));
        await guest.evaluate("document.querySelector('[name=name]').value = 'Guest'; document.querySelector('form').requestSubmit()");
        assert.ok(await guest.waitFor("document.querySelector('.doc-text h1')?.textContent === 'Extra'"), role + ' failed to open the linked tab');
        assert.equal(await guest.evaluate('window.__OPEN_ARTIFACT_BOOT__.typeServer.role'), role);
        if (role === 'viewer') {
          const card = `document.querySelector('[data-comment-card="${threadId}"][data-open]')`;
          assert.ok(await guest.waitFor(card + "?.innerText.includes('Guest feedback on Extra')", 5000), 'linked comment did not open');
        }
        const editor = "document.querySelector('iframe').contentDocument.querySelector('.doc-text')";
        assert.equal(await guest.evaluate(editor + '.isContentEditable'), role === 'editor');
        await clickOn(guest, buttonNamed('Share'));
        assert.equal(await guest.evaluate(`!!(${buttonNamed('Export')})`), false);
        await clickOn(guest, buttonNamed('Close'));
        assert.ok(await until(() => guest.evaluate("document.querySelector('[role=dialog]') === null")));
        assert.equal(await guest.evaluate("fetch('_api/doc/export?format=markdown').then(r=>r.status)"), 403);
        assert.equal(await guest.evaluate("fetch('_api/frame/duplicate', {method:'POST'}).then(r=>r.status)"), 403);
        if (role === 'editor') {
          await clickInEditor(guest, "document.querySelector('.doc-text h1')");
          await guest.press('End');
          await guest.type(' reviewed');
          assert.ok(await until(() => fs.readFileSync(path.join(root, 'doc/tabs', tab.id + '.json'), 'utf8').includes('reviewed')));
        } else {
          assert.equal(await guest.evaluate("fetch('_api/doc/import', {method:'POST'}).then(r=>r.status)"), 403);
          const session = await guest.evaluate("fetch('_api/doc/session', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client:'guest-permissions'})}).then(r=>r.json())");
          if (role === 'commenter') {
            const [x, y, end] = await guest.evaluate(`(() => {
              const frame = document.querySelector('iframe'), doc = frame.contentDocument;
              const heading = doc.querySelector('.doc-text h1');
              const range = doc.createRange();
              range.selectNodeContents([...heading.childNodes].find(n => n.nodeType === Node.TEXT_NODE));
              const r = range.getBoundingClientRect(), f = frame.getBoundingClientRect();
              return [f.x + r.left + 1, f.y + r.top + r.height / 2, f.x + r.right - 1];
            })()`);
            const point = { x: (x + end) / 2, y, button: 'left', clickCount: 2 };
            await guest.cdp('Input.dispatchMouseEvent', { ...point, type: 'mousePressed' });
            await guest.cdp('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased' });
            assert.ok(await guest.waitFor("document.getSelection()?.toString().includes('Extra')", 3000));
            await clickInEditor(guest, buttonNamed('Comment'));
            assert.ok(await guest.waitFor("document.activeElement.matches('textarea')"));
            await guest.type('Guest feedback on Extra');
            await guest.press('Enter');
            assert.ok(await until(async () => {
              const { threads } = await (await fetch(new URL('_api/comments', url))).json();
              threadId = threads.find(t => t.messages.some(m => m.text === 'Guest feedback on Extra'))?.id;
              return threadId;
            }));
          } else {
            await clickOn(guest, buttonNamed('Comments'));
            assert.ok(await guest.waitFor("document.querySelector('aside')?.innerText.includes('Guest feedback on Extra')"));
          }
          assert.equal(session.commentable, role === 'commenter');
          assert.equal(session.writable, false);
        }
      }
    } finally { await browser.close(); await server.stop(); }
  });

  it('keeps the daemon library, editor title and tab links in sync when renaming and copying', { ...T, skip: chromeSkip() }, async () => {
    const overrides = {
      OPEN_ARTIFACT_HOME: tmpDir('docs-daemon'), OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('docs-daemon-state'),
      OPEN_ARTIFACT_USER_TYPES: tmpDir('docs-user-types'), OPEN_ARTIFACT_BROWSER: 'none',
    };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    let daemon, browser;
    try {
      const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
      const { api, readDaemon } = await import('../packages/daemon/src/client.ts');
      daemon = await startDaemon({ port: 0, idleMs: 0, quiet: true, builtinTypesDir: path.dirname(typePath('docs')) });
      const state = await readDaemon();
      const made = await api(state, 'tools.call', {
        name: 'Artifact', arguments: { action: 'publish', type_url: 'open-artifact://type/docs', title: 'Library review' },
        caller: { harness: 'e2e', session: 'docs-library', workspace: tmpDir('docs-workspace') },
      });
      assert.equal(made.error, undefined, JSON.stringify(made.error));
      const id = made.url.split('/').at(-1);
      const source = daemon.store.require(id).root;
      fs.cpSync(path.join(ctx.root, 'doc'), path.join(source, 'doc'), { recursive: true });
      const tab = (await tabs(ctx.root)).find(file => file.name === 'Extra');
      browser = await launch();
      const page = await browser.load(state.url + '/a/' + id + '#' + tab.id, { ready: "document.querySelector('.doc-text h1')?.textContent === 'Extra'" });
      await page.evaluate("location.hash = " + JSON.stringify('#' + ctx.tab));
      assert.ok(await page.waitFor("document.querySelector('.doc-text h1')?.textContent === 'Plan'"));
      await clickOn(page, buttonNamed('Artifact options'));
      await clickOn(page, buttonNamed('Rename'));
      assert.ok(await page.waitFor("document.activeElement.getAttribute('aria-label') === 'Document name'"));
      await page.type('Renamed review');
      await page.press('Enter');
      assert.ok(await until(() => daemon.store.require(id).title === 'Renamed review'));
      await clickOn(page, buttonNamed('Version history'));
      assert.ok(await page.waitFor("document.querySelector('[data-testid=history-panel]')"));
      await clickOn(page, buttonNamed('Artifact options'));
      await clickOn(page, buttonNamed('Duplicate'));
      assert.ok(await page.waitFor("document.activeElement.getAttribute('aria-label') === 'Name of the copy'"));
      await page.type('Library copy');
      await page.press('Enter');
      assert.ok(await page.waitFor("document.querySelector('header')?.innerText.includes('Library copy')"));
      const copyId = new URL(await page.evaluate('location.href')).pathname.split('/').at(-1);
      assert.notEqual(copyId, id);
      assert.equal(daemon.store.require(copyId).title, 'Library copy');
      assert.ok(await page.waitFor("document.querySelector('.doc-text h1')?.textContent === 'Plan'"));
    } finally {
      await browser?.close();
      await daemon?.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('opens the tab picker from the phone toolbar and navigates without losing the public address', { ...T, skip: chromeSkip() }, async () => {
    const { url } = await ctx.cli.json(['open', ctx.root, '--json']);
    const browser = await launch();
    try {
      const page = await browser.load(url, { ready: textIn('Intro words') });
      await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      assert.ok(await page.waitFor("document.querySelector('[data-doc-phone-bar]')"));
      await clickOn(page, buttonNamed('Document tabs'));
      assert.ok(await page.waitFor("document.querySelector('[role=tree]')?.offsetWidth > 0"));
      await clickInEditor(page, "[...document.querySelectorAll('[role=treeitem]')].find(row => row.innerText.trim() === 'Extra')");
      const tab = (await tabs(ctx.root)).find(file => file.name === 'Extra');
      assert.ok(await page.waitFor("document.querySelector('.doc-text h1')?.textContent === 'Extra'"));
      assert.equal(await page.evaluate('location.hash'), '#' + tab.id);
    } finally { await browser.close(); }
  });

  it('archive zips the folder beside it', T, async () => {
    const out = await ctx.cli.json(['archive', ctx.root, '--json']);
    assert.ok(fs.existsSync(out.file), JSON.stringify(out));
    const zip = fs.readFileSync(out.file);
    assert.equal(zip.subarray(0, 2).toString(), 'PK');
    for (const name of ['doc/.sessions.json', 'doc/.people.json', 'doc/tabs/.deleted/']) assert.ok(zip.includes(Buffer.from(name)), name);
  });

  it('open serves the doc, its calls go through the server, wait ends quietly with nothing sent, stop ends it', T, async () => {
    const opened = await ctx.cli.json(['open', ctx.root, '--json']);
    assert.equal(opened.type, TYPE);
    const page = await fetch(opened.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root">/);
    const viaServer = await call('update', ctx.root, { tab: ctx.tab, ops: [{ op: 'insert', target: { kind: 'root' }, source: { markdown: 'Written while open.' } }] });
    assert.ok(viaServer.rev > 0);
    assert.match((await ctx.cli.run(['export', ctx.root, '--tab', ctx.tab])).stdout, /Written while open\./);
    const wait = await ctx.cli.run(['wait', ctx.root, '--timeout', '1']);
    assert.equal(wait.code, 2, wait.stdout);
    const comments = await ctx.cli.run(['comments', ctx.root]);
    assert.equal(comments.code, 0, comments.stderr);
    const stop = await ctx.cli.run(['stop']);
    assert.equal(stop.code, 0, stop.stderr);
  });

  it('find counts dropdown chips here and in other tabs, Replace all leaves them, and a renamed option is found by its new name', { ...T, skip: chromeSkip() }, async () => {
    const root = path.join(tmpDir('docs-chips'), 'orchard');
    const born = await ctx.cli.json(['create', root, JSON.stringify({
      name: 'Orchard',
      doc: {
        markdown: '# Orchard\n\nPruning waits for a dry week. Stage: <?oa block stage?>',
        blocks: { stage: { type: 'dropdown', enum: '$lid:stages', index: 0 } },
      },
      batch: [
        { $lid: 'stages', verb: 'create', object: 'enum', payload: { name: 'Stage', options: [{ name: 'Pruning' }, { name: 'Picking' }] } },
        { $lid: 'rows', verb: 'create', object: 'file', payload: { name: 'Rows' } },
        { verb: 'create', object: 'node', payload: { parent: { object: 'file', id: '$lid:rows' }, markdown: 'East row: <?oa block east?>', blocks: { east: { type: 'dropdown', enum: '$lid:stages', index: 0 } } } },
      ],
    })]);
    const { f: tab, stages } = born.lids;
    const { url } = await ctx.cli.json(['open', root, '--json']);
    const mod = process.platform === 'darwin' ? { meta: true } : { ctrl: true };
    const bar = "document.querySelector('[aria-label=\"Find and replace\"]')";
    const shows = (status, others) =>
      `document.querySelector('#doc-find-query')?.nextElementSibling?.textContent === ${JSON.stringify(status)} && ${bar}.querySelector(${JSON.stringify(`[aria-label="${others}"]`)})`;
    const nowhereElse = `${bar}?.innerText.includes('No matches in other tabs')`;
    const search = async text => {
      await clickInEditor(page, "document.querySelector('#doc-find-query')");
      await page.press('a', { ...mod, commands: ['selectAll'] });
      await page.type(text);
    };
    const browser = await launch();
    let page;
    try {
      page = await browser.load(url + '#' + tab, { ready: textIn('dry week'), ignore: [/\/favicon\.ico$/] });
      await clickInEditor(page, "document.querySelector('.doc-text p')");
      await page.press('h', { ...mod, shift: true });
      assert.ok(await page.waitFor(bar));
      await search('pruning');
      assert.ok(await page.waitFor(shows('1 of 2', '1 tab with matches')), 'the chip here and the one in Rows are counted');
      assert.ok(await page.waitFor("document.querySelector('.doc-dropdown.doc-find-match')"));

      await clickInEditor(page, "document.querySelector('#doc-find-replacement')");
      await page.type('Thinning');
      await clickInEditor(page, buttonNamed('Replace all'));
      assert.ok(await page.waitFor(`${shows('1 of 1', '1 tab with matches')} && (${buttonNamed('Replace all')})?.disabled`), 'only the chip is left, and it cannot be replaced');
      const text = (await ctx.cli.run(['export', root, '--tab', tab])).stdout;
      assert.match(text, /Thinning waits for a dry week/);
      assert.match(text, /Stage: Pruning/);

      await call('batch', root, { batch: [{ verb: 'update', ref: { object: 'enum', id: stages }, payload: { kind: 'value', value: { name: 'Stage', options: [{ name: 'Shaping' }, { name: 'Picking' }] } } }] });
      assert.ok(await page.waitFor(`document.querySelector('#doc-find-query')?.nextElementSibling?.textContent === 'No matches' && ${nowhereElse}`), 'the old name is gone here and in Rows');
      await search('shaping');
      assert.ok(await page.waitFor(shows('1 of 1', '1 tab with matches')), 'the new name is found here and in Rows');
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
    }
  });
});

describe(`${TYPE} in Chrome: wide tables and folded sections`, { skip: skip() || chromeSkip() }, () => {
  const ctx = {};
  /** The first non-null answer of `expression` among the page's frames (the editor is in the Shell's frame). */
  const inEditor = async (page, expression) => (await page.evaluateAll(expression)).find(value => value !== null && value !== undefined) ?? null;
  /** Click `element` in the editor once it holds still: the page moves its lines while its fonts and cards come in. */
  const clickStill = async (page, element) => {
    const middle = `(() => {
      const frame = document.querySelector('iframe[name="open-artifact-shell"]');
      const rect = (document => (${element})?.getBoundingClientRect())(frame.contentDocument);
      const outer = frame.getBoundingClientRect();
      return rect?.width ? [outer.x + rect.x + rect.width / 2, outer.y + rect.y + rect.height / 2] : null;
    })()`;
    let at = null;
    const still = async () => {
      const was = at;
      at = await page.evaluate(middle);
      return at && was && at[0] === was[0] && at[1] === was[1];
    };
    assert.ok(await until(still, 10000), `nothing to click: ${element}`);
    await page.click(...at);
  };

  before(() => {
    const { dir } = install(typePath(TYPE), TYPE);
    ctx.cli = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('docs-dock-state'), 'state'), HOME: tmpDir('docs-dock-home'), OPEN_ARTIFACT_USER: 'E2E' });
  });

  after(async () => {
    await ctx.cli?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('a tall table too wide for the page keeps a scrollbar at the foot of the window, in step with the table', T, async () => {
    const root = path.join(tmpDir('docs-dock'), 'wide');
    const columns = Array.from({ length: 16 }, (_, i) => i + 1);
    const row = cells => `| ${cells.join(' | ')} |`;
    const markdown = ['# Wide', '', 'Above the table.', '', row(columns.map(c => `Heading ${c}`)), row(columns.map(() => '---')),
      ...Array.from({ length: 40 }, (_, r) => row(columns.map(c => `Cell ${r + 1}.${c}`))), '', 'After the table.', ''].join('\n');
    const source = path.join(tmpDir('docs-dock-src'), 'wide.md');
    fs.writeFileSync(source, markdown);
    await ctx.cli.json(['create', root, '--markdown', source, '--name', 'Wide']);
    const { url } = await ctx.cli.json(['open', root, '--json']);
    const browser = await launch();
    const scrolls = `(() => {
      const bar = document.querySelector('[data-table-dock]');
      const wrapper = document.querySelector('.doc-text > .tableWrapper');
      return bar && wrapper ? { bar: bar.scrollLeft, table: wrapper.scrollLeft, clip: wrapper.dataset.clip ?? null } : null;
    })()`;
    try {
      const page = await browser.load(url, { ready: textIn('Above the table.'), ignore: [/\/favicon\.ico$/] });
      assert.ok(await page.waitFor("document.querySelector('[data-table-dock]')", 10000), 'no scrollbar docked under the wide table');
      const placed = await inEditor(page, `(() => {
        const bar = document.querySelector('[data-table-dock]').getBoundingClientRect();
        const scroller = document.querySelector('[data-doc-scroll]').getBoundingClientRect();
        const wrapper = document.querySelector('.doc-text > .tableWrapper').getBoundingClientRect();
        return { bottomGap: Math.round(scroller.bottom - bar.bottom), inside: bar.left >= wrapper.left - 1 && bar.right <= wrapper.right + 1 };
      })()`);
      assert.deepEqual(placed, { bottomGap: 0, inside: true });

      await inEditor(page, "(() => { document.querySelector('[data-table-dock]').scrollLeft = 150; return true; })()");
      assert.ok(await until(async () => {
        const now = await inEditor(page, scrolls);
        return now?.bar === 150 && now.table === 150;
      }, 5000), `the docked scrollbar did not move the table: ${JSON.stringify(await inEditor(page, scrolls))}`);

      // The table scrolled by itself (as the caret or a trackpad does) takes the docked bar along, and at its right end
      // nothing is cut off any more.
      await inEditor(page, "(() => { const w = document.querySelector('.doc-text > .tableWrapper'); w.scrollLeft = w.scrollWidth; return true; })()");
      assert.ok(await until(async () => {
        const now = await inEditor(page, scrolls);
        return now && now.table > 150 && now.bar === now.table && now.clip === null;
      }, 5000), `the docked scrollbar did not follow the table: ${JSON.stringify(await inEditor(page, scrolls))}`);

      await inEditor(page, "(() => { [...document.querySelectorAll('.doc-text p')].find(p => p.textContent === 'After the table.').scrollIntoView({ block: 'center' }); return true; })()");
      assert.ok(await until(async () => !(await inEditor(page, "document.querySelector('[data-table-dock]') ? true : null")), 5000),
        'the docked scrollbar stayed once the foot of the table was in sight');
      assert.deepEqual(page.problems, []);
    } finally {
      await Promise.all([browser.close(), ctx.cli.run(['stop', root])]);
    }
  });

  it('suggestions in a folded section gather at its heading, and choosing them unfolds it', T, async () => {
    const root = path.join(tmpDir('docs-fold'), 'notes');
    const source = path.join(tmpDir('docs-fold-src'), 'notes.md');
    fs.writeFileSync(source, ['# Notes', '', 'An opening line.', '', '## Plan', '', 'Save the draft every hour.', '', 'Comment on the open questions.', '', '## Later', '', 'Words after the plan.', ''].join('\n'));
    const made = await ctx.cli.json(['create', root, '--markdown', source, '--name', 'Notes']);
    const tab = made.lids.f;
    for (const [text, by] of [['Save', 'Store'], ['Comment', 'Review']])
      await ctx.cli.json(['update', root, JSON.stringify({ tab, suggest: true, ops: [{ op: 'replace', target: { kind: 'find', text }, source: { text: by } }] })]);
    const { url } = await ctx.cli.json(['open', root, '--json']);
    const browser = await launch();
    const folded = "document.querySelector('[aria-label=\"Expand section, Plan\"]')";
    const group = '[data-folded-suggestions]';
    const atHeading = selector => `(() => {
      const item = document.querySelector(${JSON.stringify(selector)});
      const heading = document.querySelector('.doc-heading-folded');
      if (!item || !heading) return null;
      return { ids: item.dataset.foldedSuggestions ?? item.dataset.marginMarker, gap: Math.round(Math.abs(item.getBoundingClientRect().top - heading.getBoundingClientRect().top)) };
    })()`;
    try {
      const page = await browser.load(url, { ready: textIn('An opening line.'), settle: 1500, ignore: [/\/favicon\.ico$/] });
      // The heading's own button folds it (the block handle shown on hover lies over it, and folding is not what's tested).
      const fold = name => inEditor(page, `(() => { const button = ${buttonNamed(`Collapse section, ${name}`)}; button?.click(); return button ? true : null; })()`);
      assert.ok(await page.waitFor("document.querySelectorAll('[data-suggest-card]').length === 2", 10000), 'no cards for the two suggestions');

      // Wide: the column holds one card for the folded section, level with its heading.
      assert.ok(await until(() => fold('Plan'), 5000), 'no button folds Plan');
      assert.ok(await page.waitFor(folded, 5000), 'the section did not fold');
      assert.ok(await until(async () => (await inEditor(page, atHeading(group)))?.gap <= 24, 5000),
        `the folded section's suggestions are not at its heading: ${JSON.stringify(await inEditor(page, atHeading(group)))}`);
      assert.equal((await inEditor(page, atHeading(group))).ids.split(' ').length, 2);
      assert.equal(await inEditor(page, "document.querySelectorAll('[data-suggest-card]').length"), 0);
      await clickStill(page, `document.querySelector('${group}')`);
      assert.ok(await page.waitFor(`!${folded} && document.querySelector('[aria-label="Collapse section, Plan"]')`, 5000), 'the card did not unfold the section');
      assert.ok(await page.waitFor("document.querySelectorAll('[data-suggest-card]').length === 2", 5000), 'the two cards did not come back');

      // Narrow (no room for the column's cards): one marker by the heading counts both and unfolds the section.
      await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1050, height: 800, deviceScaleFactor: 1, mobile: false });
      assert.ok(await until(() => fold('Plan'), 5000), 'no button folds Plan');
      assert.ok(await page.waitFor(folded, 5000), 'the section did not fold in the narrow window');
      const marker = '[data-margin-marker^="folded:"]';
      assert.ok(await until(async () => (await inEditor(page, atHeading(marker)))?.gap <= 24, 5000),
        `no marker by the folded heading: ${JSON.stringify(await inEditor(page, "[...document.querySelectorAll('[data-margin-marker]')].map(m => m.outerHTML)"))}`);
      assert.deepEqual(await inEditor(page, `(button => button && [button.getAttribute('aria-label'), button.textContent.trim()])(document.querySelector('${marker} button'))`), ['2 suggestions on this line', '2']);
      await clickStill(page, `document.querySelector('${marker} button')`);
      assert.ok(await page.waitFor(`!${folded} && document.querySelector('[aria-label="Collapse section, Plan"]')`, 5000), 'the marker did not unfold the section');
      await page.cdp('Emulation.clearDeviceMetricsOverride', {});
      assert.deepEqual(page.problems, []);
      const { suggestions } = await ctx.cli.json(['read', root, tab, '--suggestions']);
      assert.equal(suggestions.length, 2, 'folding and unfolding changed the suggestions in the file');
    } finally {
      await Promise.all([browser.close(), ctx.cli.run(['stop', root])]);
    }
  });

  it('a suggestion only partly in a folded section keeps its own card, by its words still in sight', T, async () => {
    const root = path.join(tmpDir('docs-part'), 'part');
    const source = path.join(tmpDir('docs-part-src'), 'part.md');
    fs.writeFileSync(source, ['# Notes', '', 'An opening line.', '', '## Plan', '', 'Save the draft every hour.', '', '## Later', '', 'Save the notes at the end.', ''].join('\n'));
    const made = await ctx.cli.json(['create', root, '--markdown', source, '--name', 'Part']);
    const tab = made.lids.f;
    const ops = ['Save the draft', 'Save the notes'].map(text => ({ op: 'replace', target: { kind: 'find', text }, source: { text: text.replace('Save', 'Store') } }));
    await ctx.cli.json(['update', root, JSON.stringify({ tab, suggest: true, ops })]);
    const { url } = await ctx.cli.json(['open', root, '--json']);
    const browser = await launch();
    const placed = `(() => {
      const card = document.querySelector('[data-suggest-card]');
      const line = [...document.querySelectorAll('.doc-text p')].find(p => p.textContent.includes('at the end'));
      return card && line ? { cards: document.querySelectorAll('[data-suggest-card]').length, gap: Math.round(Math.abs(card.getBoundingClientRect().top - line.getBoundingClientRect().top)) } : null;
    })()`;
    try {
      const page = await browser.load(url, { ready: textIn('An opening line.'), settle: 1500, ignore: [/\/favicon\.ico$/] });
      assert.ok(await page.waitFor("document.querySelectorAll('[data-suggest-card]').length === 1", 10000), 'no card for the suggestion');
      assert.ok(await inEditor(page, `(() => { const button = ${buttonNamed('Collapse section, Plan')}; button?.click(); return button ? true : null; })()`));
      assert.ok(await page.waitFor("document.querySelector('[aria-label=\"Expand section, Plan\"]')", 5000), 'the section did not fold');
      assert.ok(await until(async () => (await inEditor(page, placed))?.gap <= 24, 5000), `the card is not by the words in sight: ${JSON.stringify(await inEditor(page, placed))}`);
      assert.equal((await inEditor(page, placed)).cards, 1);
      assert.equal(await inEditor(page, "document.querySelector('[data-folded-suggestions]') ? true : null"), null);
      assert.deepEqual(page.problems, []);
    } finally {
      await Promise.all([browser.close(), ctx.cli.run(['stop', root])]);
    }
  });
});

describe(`${TYPE}: long links and refused comments`, { skip: skip() }, () => {
  const ctx = {};
  const LONG = `https://atlas.example.org/trip?legs=${'n12e7-'.repeat(900)}#day-four`;
  const mod = process.platform === 'darwin' ? { meta: true } : { ctrl: true };

  /** Clicks `element` of the editor's frame at `dy` px from its top (its middle when null), once it holds still. */
  async function clickSteady(page, element, dy = null) {
    const where = () =>
      page.evaluate(`(() => {
        const frame = document.querySelector('iframe[name="open-artifact-shell"]');
        const el = (document => (${element}))(frame.contentDocument);
        el?.scrollIntoView({ block: 'nearest' });
        const rect = el?.getBoundingClientRect();
        if (!rect?.width) return null;
        const x = rect.x + rect.width / 2, y = rect.y + (${dy} ?? rect.height / 2);
        const hit = frame.contentDocument.elementFromPoint(x, y);
        if (!hit || !(hit === el || el.contains(hit))) return null;
        const outer = frame.getBoundingClientRect();
        return [outer.x + x, outer.y + y];
      })()`);
    let last = null;
    let at = null;
    assert.ok(await until(async () => {
      [last, at] = [at, await where()];
      return at && last && at[0] === last[0] && at[1] === last[1];
    }, 10000), `nothing steady to click: ${element}`);
    await page.click(...at);
  }

  before(async () => {
    const { dir } = install(typePath(TYPE), TYPE);
    ctx.cli = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('docs-links-state'), 'state'), HOME: tmpDir('docs-links-home'), OPEN_ARTIFACT_USER: 'E2E' });
    ctx.root = path.join(tmpDir('docs-links-root'), 'route');
    const source = path.join(tmpDir('docs-links-src'), 'route.md');
    fs.writeFileSync(source, '# Route\n\nwhole route\n\nThe ferry leaves at nine.\n');
    const created = await ctx.cli.json(['create', ctx.root, '--markdown', source, '--name', 'Route']);
    ctx.tab = created.lids.f;
  });

  after(async () => {
    await ctx.cli?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('keeps the full address of a long web link from the link box to disk and the exports', { ...T, skip: chromeSkip() }, async () => {
    assert.ok(Buffer.byteLength(LONG) > 5000);
    const { url } = await ctx.cli.json(['open', ctx.root, '--json']);
    const browser = await launch();
    try {
      const page = await browser.load(url, { ready: textIn('whole route'), ignore: [/\/favicon\.ico$/] });
      const words = "[...document.querySelectorAll('.doc-text p')].find(p => p.textContent === 'whole route')";
      await clickSteady(page, words);
      await page.press('Home');
      await page.press('End', { shift: true });
      assert.ok(await page.waitFor(`getSelection().toString() === 'whole route'`, 3000), 'the words are not selected');
      // The editor takes the selection from the page a moment after the keys.
      await new Promise(resolve => setTimeout(resolve, 300));
      await page.press('k', mod);
      const field = `document.querySelector('input[aria-label="Link URL"]')`;
      assert.ok(await page.waitFor(`document.querySelector('input[aria-label="Link text"]')?.value === 'whole route'`, 5000), 'Mod-k opened no link box on the words');
      await clickSteady(page, field);
      assert.ok(await page.waitFor(`document.activeElement === ${field}`, 3000), 'the address field has no focus');

      await page.cdp('Input.insertText', { text: `https://atlas.example.org/trip?legs=${'x'.repeat(8200)}` });
      await page.press('Enter');
      assert.ok(await page.waitFor(`document.querySelector('[data-testid="link-url-problem"]')?.textContent === 'Web addresses can be at most 8,192 bytes long'`, 5000), 'no limit named for a web address over 8,192 bytes');

      await page.evaluateAll(`document.activeElement?.select?.()`);
      await page.cdp('Input.insertText', { text: LONG });
      await page.press('Enter');
      assert.ok(await page.waitFor(`document.querySelector('.doc-text a')?.getAttribute('href') === ${JSON.stringify(LONG)} && document.querySelector('.doc-text a').textContent === 'whole route'`, 5000), 'the link was not set whole on the words');

      const exported = async format => (await ctx.cli.run(['export', ctx.root, '--tab', ctx.tab, '--format', format, '--out', path.join(tmpDir(`docs-links-${format}`), `route.${format === 'markdown' ? 'md' : format}`)])).json;
      let markdown = '';
      assert.ok(await until(async () => {
        const out = await exported('markdown');
        markdown = out?.out ? fs.readFileSync(out.out, 'utf8') : '';
        return markdown.includes(`[whole route](${LONG})`);
      }, 15000), `the markdown export lacks the whole address: ${markdown.slice(0, 200)}`);
      const html = fs.readFileSync((await exported('html')).out, 'utf8');
      assert.ok(html.includes(`href="${LONG}"`), 'the print page lacks the whole address');
      assert.ok(html.includes('#day-four"'), 'the print page lost the fragment');

      await clickInEditor(page, `document.querySelector('.doc-text a')`);
      const card = `document.querySelector('[aria-label="Open link"]')`;
      assert.ok(await page.waitFor(card, 5000), 'no link card');
      const shown = (await page.evaluateAll(`${card} && ${card}.closest('[role="dialog"], [data-link-card], div')?.parentElement?.innerText`)).find(Boolean) ?? '';
      assert.match(shown, /atlas\.example\.org.*…day-four/s, `the card shows a short address: ${shown.slice(0, 120)}`);
      await page.evaluateAll(`window.__opened = []; window.open = (href) => { window.__opened.push(href); return null; }`);
      await clickInEditor(page, card);
      assert.ok(await page.waitFor(`window.__opened?.[0] === ${JSON.stringify(LONG)}`, 5000), 'Open link did not open the whole address');
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
    }
  });

  it('copies a refused comment draft, and the same text goes through when sent again', { ...T, skip: chromeSkip() }, async () => {
    const added = await ctx.cli.run(['comment-add', ctx.root, 'Is nine still right?', '--on', 'ferry']);
    assert.equal(added.code, 0, added.stderr);
    const { url } = await ctx.cli.json(['open', ctx.root, '--json']);
    const browser = await launch();
    try {
      const page = await browser.load(url, { ready: textIn('The ferry leaves'), ignore: [/\/favicon\.ico$/, /^HTTP 404: .*\/_api\/comments\/reply$/] });
      await clickSteady(page, `document.querySelector('[data-comment-card]')`, 12);
      const box = `document.querySelector('[data-comment-card] [data-comment-composer] textarea')`;
      assert.ok(await page.waitFor(box, 5000), 'no reply box');
      await clickSteady(page, box);
      assert.ok(await page.waitFor(`document.activeElement === ${box}`, 3000), 'the reply box has no focus');
      // One reply goes out naming a thread the server has no record of: it answers 404, a refusal, not a lost connection.
      await page.evaluateAll(`(() => {
        if (window.__refuseNext) return;
        const send = window.fetch;
        window.__refuseNext = true;
        window.fetch = function (input, init) {
          const where = typeof input === 'string' ? input : input?.url ?? String(input);
          if (window.__refuseNext && where.includes('_api/comments/reply') && typeof init?.body === 'string') {
            window.__refuseNext = false;
            init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), threadId: 'no-such-thread' }) };
            return send.call(this, input, init).then(answer => ((window.__refusedWith = answer.status), answer));
          }
          return send.call(this, input, init);
        };
      })()`);
      const draft = `Moved to ten: the harbour posted a new timetable. ${'Bring the printed tickets, the app ones failed last week. '.repeat(4)}Check again on Friday.`;
      await page.cdp('Input.insertText', { text: draft });
      await page.press('Enter');
      const note = `document.querySelector('[data-testid="refused-draft"]')`;
      assert.ok(await page.waitFor(`${note}?.innerText.includes('The reply could not be saved')`, 8000), 'no note for the refused reply');
      assert.deepEqual((await page.evaluateAll('window.__refusedWith')).filter(Boolean), [404]);
      assert.ok(await page.waitFor(`${note}.innerText.includes('deleted')`, 1000), 'the note gives no advice for a missing thread');
      assert.ok(await page.waitFor(`${box}?.value === ${JSON.stringify(draft)}`, 1000), 'the reply box lost the draft');

      await page.cdp('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
      const copyDraft = `[...document.querySelectorAll('[data-testid="refused-draft"] button')].find(b => b.textContent.trim() === 'Copy draft')`;
      await clickSteady(page, copyDraft);
      assert.ok(await page.waitFor(`${note}?.dataset.copy === 'copied' && ${note}.innerText.includes('Copied the whole draft')`, 5000), 'Copy draft did not say it copied');
      const held = (await page.evaluateAll(`${note} ? navigator.clipboard.readText() : null`)).find(text => typeof text === 'string');
      assert.equal(held, draft);

      // Where the page has no clipboard, the whole draft is shown, selected, to copy by hand.
      await page.evaluateAll(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })`);
      await clickSteady(page, copyDraft);
      const manual = `${note}?.querySelector('textarea')`;
      assert.ok(await page.waitFor(`${note}?.dataset.copy === 'manual' && ${manual}?.value === ${JSON.stringify(draft)}`, 5000), 'the draft is not shown to copy by hand');
      assert.ok(await page.waitFor(`${manual}.selectionEnd - ${manual}.selectionStart === ${draft.length}`, 2000), 'the shown draft is not selected');

      await clickSteady(page, box);
      await page.press('Enter');
      assert.ok(await until(async () => {
        const { threads } = await ctx.cli.json(['comments', ctx.root, '--json']);
        return threads.some(thread => thread.messages.some(message => message.text === draft));
      }, 10000), 'the same text was not saved when sent again');
      assert.ok(await page.waitFor(`!${box}?.value`, 5000), 'the reply box kept the sent text');
      await clickInEditor(page, `document.querySelector('[data-testid="refused-draft"] button[aria-label="Close"]')`);
      assert.ok(await page.waitFor(`!${note}`, 3000), 'the note did not close');
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
    }
  });
});

describe(`${TYPE} in Chrome: Ask Agent as a comment on an agent chip`, { skip: skip() || chromeSkip() }, () => {
  const ctx = {};
  const AGENT_CHIP = `.doc-text [data-mention="agent"]`;
  const PROMPT = `document.querySelector('[data-testid="ask-prompt"] input')`;
  const firstOption = `document.querySelector('[role="listbox"] [role="option"]')?.textContent`;
  const chips = async page => Math.max(0, ...(await page.evaluateAll(`document.querySelectorAll('${AGENT_CHIP}').length`)));

  async function make(name, markdown) {
    const root = path.join(tmpDir(`docs-ask-${name}`), name);
    const source = path.join(tmpDir(`docs-ask-${name}-src`), `${name}.md`);
    fs.writeFileSync(source, markdown);
    const created = await ctx.cli.json(['create', root, '--markdown', source, '--name', name]);
    return { root, tab: created.lids.f };
  }

  async function opened(root, ready) {
    const { url } = await ctx.cli.json(['open', root, '--json']);
    const browser = await launch();
    const page = await browser.load(url, { ready: textIn(ready), ignore: [/\/favicon\.ico$/, /^HTTP 400: .*\/_api\/comments\/create$/] });
    return { browser, page };
  }

  /** Puts the caret at the end of the paragraph starting with `line` and types ` @` until the menu offers Ask Agent. */
  async function atMenu(page, line, offered = true) {
    await clickInEditor(page, `[...document.querySelectorAll('.doc-text p')].find(p => p.textContent.startsWith(${JSON.stringify(line)}))`);
    await page.press('End');
    for (let tries = 0; tries < 15; tries++) {
      await page.type(' @');
      const shown = await page.waitFor(`${firstOption}`, 2000);
      if (shown && (!offered || (await page.waitFor(`${firstOption}?.startsWith('Ask Agent')`, 500)))) return;
      await page.press('Backspace');
      await page.press('Backspace');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.fail(offered ? 'the @ menu never offered Ask Agent first' : 'the @ menu did not open');
  }

  async function prompt(page, line) {
    await atMenu(page, line);
    await page.press('Enter');
    assert.ok(await page.waitFor(`document.activeElement === ${PROMPT}`, 5000), 'Ask Agent opened no prompt');
  }

  before(async () => {
    const { dir } = install(typePath(TYPE), TYPE);
    ctx.cli = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('docs-ask-state'), 'state'), HOME: tmpDir('docs-ask-home'), OPEN_ARTIFACT_USER: 'E2E' });
    Object.assign(ctx, await make('harbour', '# Harbour\n\nThe ferry leaves at nine.\n\nTickets are sold on board.\n\nBikes ride free.\n'));
  });

  after(async () => {
    await ctx.cli?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('puts Ask Agent first in the @ menu while an agent waits; Enter puts the agent chip in and wait gets an @agent thread on it', T, async () => {
    const w = await startWait(ctx, ctx.root, 60);
    const { browser, page } = await opened(ctx.root, 'The ferry leaves');
    try {
      await prompt(page, 'The ferry');
      await page.cdp('Input.insertText', { text: 'Say when the last ferry leaves' });
      await page.press('Enter');
      const got = await w.done;
      assert.equal(got.code, 0, got.stderr);
      assert.match(got.stdout, /"where":"@Agent"/);
      assert.match(got.stdout, /"text":"@Agent Say when the last ferry leaves"/);
      assert.ok(await page.waitFor(`document.querySelector('${AGENT_CHIP}')?.closest('p')?.textContent.startsWith('The ferry leaves at nine.')`, 5000), 'no agent chip in the line');
      assert.ok(await page.waitFor(`!${PROMPT}`, 3000), 'the prompt stayed open');

      const { threads } = await ctx.cli.json(['comments', ctx.root, '--json']);
      assert.equal(threads.length, 1);
      const [thread] = threads;
      assert.equal(thread.where, '@Agent');
      assert.equal(thread.detail, 'On “@Agent” in: The ferry leaves at nine. @Agent');
      const view = await ctx.cli.run(['read', ctx.root, ctx.tab, '--parent', thread.location.block]);
      const chip = /<mention id='([^']+)' principal='agent'/.exec(view.stdout)?.[1];
      assert.ok(chip, `no agent chip in the block: ${view.stdout}`);
      const stored = JSON.parse(fs.readFileSync(path.join(ctx.root, 'comments.json'), 'utf8'));
      const anchor = JSON.parse((stored.threads ?? stored).find(t => t.id === thread.id).anchor);
      assert.deepEqual(anchor.range, [chip, chip]);
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
    }
  });

  it('Escape closes the prompt and leaves no chip and no thread', T, async () => {
    const w = await startWait(ctx, ctx.root, 60);
    const { browser, page } = await opened(ctx.root, 'Tickets are sold');
    try {
      const before = await chips(page);
      await prompt(page, 'Tickets');
      await page.cdp('Input.insertText', { text: 'Add the prices' });
      await page.press('Escape');
      assert.ok(await page.waitFor(`!${PROMPT}`, 3000), 'Escape left the prompt open');
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal(await chips(page), before);
      assert.equal((await page.evaluateAll(`[...document.querySelectorAll('.doc-text p')].find(p => p.textContent.startsWith('Tickets'))?.textContent`)).find(Boolean), 'Tickets are sold on board. ');
      assert.equal((await ctx.cli.json(['comments', ctx.root, '--json'])).threads.length, 1);
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
      w.child.kill();
      await w.exited;
    }
  });

  it('a refused ask takes its chip out again and keeps the words in the prompt', T, async () => {
    const w = await startWait(ctx, ctx.root, 60);
    const { browser, page } = await opened(ctx.root, 'Tickets are sold');
    try {
      const before = await chips(page);
      // The comment goes out without an anchor: the server answers 400, a refusal, not a lost connection.
      await page.evaluateAll(`(() => {
        if (window.__refuseCreate !== undefined) return;
        const send = window.fetch;
        window.__refuseCreate = true;
        window.fetch = function (input, init) {
          const where = typeof input === 'string' ? input : input?.url ?? String(input);
          if (window.__refuseCreate && where.includes('_api/comments/create') && typeof init?.body === 'string') {
            window.__refuseCreate = false;
            const body = JSON.parse(init.body);
            init = { ...init, body: JSON.stringify({ ...body, input: { ...body.input, anchor: 42 } }) };
            return send.call(this, input, init).then(answer => ((window.__refusedWith = answer.status), answer));
          }
          return send.call(this, input, init);
        };
      })()`);
      await prompt(page, 'Tickets');
      await page.cdp('Input.insertText', { text: 'Add the prices' });
      await page.press('Enter');
      assert.ok(await page.waitFor(`document.querySelector('[data-testid="refused-draft"]')?.innerText.includes('The comment could not be saved')`, 8000), 'no note for the refused ask');
      assert.deepEqual((await page.evaluateAll('window.__refusedWith')).filter(Boolean), [400]);
      assert.ok(await page.waitFor(`document.querySelectorAll('${AGENT_CHIP}').length === ${before}`, 5000), 'the chip stayed in the text');
      assert.ok(await page.waitFor(`${PROMPT}?.value === 'Add the prices'`, 2000), 'the prompt lost the words');
      await page.press('Escape');
      assert.equal((await ctx.cli.json(['comments', ctx.root, '--json'])).threads.length, 1);
      const outline = (await ctx.cli.run(['read', ctx.root, ctx.tab])).stdout;
      assert.equal(outline.match(/<mention user='agent'/g)?.length ?? 0, before, outline);
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
      w.child.kill();
      await w.exited;
    }
  });

  it('an ask made while the server cannot be reached is kept to send later, with its chip in the text', T, async () => {
    const w = await startWait(ctx, ctx.root, 60);
    const { browser, page } = await opened(ctx.root, 'Bikes ride free');
    try {
      const before = await chips(page);
      await page.evaluateAll(`(() => {
        if (window.__offline !== undefined) return;
        const send = window.fetch;
        window.__offline = true;
        window.fetch = function (input, init) {
          const where = typeof input === 'string' ? input : input?.url ?? String(input);
          if (window.__offline && where.includes('_api/comments/create')) return Promise.reject(new TypeError('Failed to fetch'));
          return send.call(this, input, init);
        };
      })()`);
      await prompt(page, 'Bikes');
      await page.cdp('Input.insertText', { text: 'Say where bikes go' });
      await page.press('Enter');
      assert.ok(await page.waitFor(`(document.body?.innerText || '').includes('Couldn’t reach the server')`, 15000), 'no word that the ask was kept');
      assert.ok(await page.waitFor(`!${PROMPT}`, 3000), 'the prompt stayed open');
      assert.equal(await chips(page), before + 1);
      assert.ok(await page.waitFor(`[...document.querySelectorAll('${AGENT_CHIP}')].some(chip => chip.closest('p')?.textContent.startsWith('Bikes ride free.'))`, 2000), 'the chip is not in the line');
      assert.equal((await ctx.cli.json(['comments', ctx.root, '--json'])).threads.length, 1);
      await page.evaluateAll(`window.__offline = false`);
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
      w.child.kill();
      await w.exited;
    }
  });

  it('offers no Ask Agent without an agent waiting, then shows it without a reload once an agent starts waiting', T, async () => {
    const quiet = await make('quiet', '# Quiet\n\nNobody is listening here.\n');
    const { browser, page } = await opened(quiet.root, 'Nobody is listening');
    let w;
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await atMenu(page, 'Nobody', false);
      const shown = (await page.evaluateAll(`[...document.querySelectorAll('[role="listbox"] [role="option"]')].map(option => option.textContent)`)).find(list => list.length) ?? [];
      assert.ok(shown.includes('Agent'), `no plain Agent mention: ${shown}`);
      assert.ok(!shown.some(label => label.startsWith('Ask Agent')), `Ask Agent offered with no agent: ${shown}`);
      assert.ok(!(await page.waitFor(`document.querySelector('[data-testid="ask-dock"]')`, 500)));
      await page.press('Escape');
      await page.press('Backspace');
      await page.press('Backspace');

      w = await startWait(ctx, quiet.root, 60);
      await atMenu(page, 'Nobody', true);
      await page.press('Escape');
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
      if (w) {
        w.child.kill();
        await w.exited;
      }
    }
  });

  it('an empty doc docks a prompt with ways to start; a suggestion fills it and Enter sends it on a chip under the title', T, async () => {
    const empty = await make('blank', '# Timetable\n');
    const w = await startWait(ctx, empty.root, 60);
    const { browser, page } = await opened(empty.root, 'Timetable');
    try {
      const dock = `document.querySelector('[data-testid="ask-dock"]')`;
      assert.ok(await page.waitFor(dock, 10000), 'no prompt under the empty doc');
      await clickInEditor(page, `[...document.querySelectorAll('[data-testid="ask-dock"] button')].find(b => b.textContent.trim() === 'Write a first draft')`);
      const field = `${dock}?.querySelector('input')`;
      assert.ok(await page.waitFor(`${field}?.value === 'Write a first draft of a doc about ' && document.activeElement === ${field}`, 3000), 'the suggestion did not fill the prompt');
      await page.cdp('Input.insertText', { text: 'the winter timetable' });
      await page.press('Enter');
      const got = await w.done;
      assert.equal(got.code, 0, got.stderr);
      assert.match(got.stdout, /"text":"@Agent Write a first draft of a doc about the winter timetable"/);
      assert.ok(await page.waitFor(`!${dock}`, 5000), 'the empty-doc prompt stayed');
      const outline = (await ctx.cli.run(['read', empty.root, empty.tab])).stdout;
      assert.match(outline, /heading='1'>Timetable<\/paragraph>\n<paragraph id='[^']+' h='[^']+'><mention user='agent' label='Agent'\/><\/paragraph>/);
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
    }
  });

  it('the selection toolbar has no Edit with Agent while an agent waits', T, async () => {
    const w = await startWait(ctx, ctx.root, 60);
    const { browser, page } = await opened(ctx.root, 'Tickets are sold');
    try {
      // The page hears that an agent listens within its next status check (every 3 s).
      await new Promise(resolve => setTimeout(resolve, 4000));
      await clickInEditor(page, `[...document.querySelectorAll('.doc-text p')].find(p => p.textContent.startsWith('Tickets'))`);
      await page.press('Home');
      await page.press('End', { shift: true });
      assert.ok(await page.waitFor(`document.querySelector('[role="toolbar"][aria-label="Formatting"]') && ${buttonNamed('Comment')}`, 5000), 'no selection toolbar');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const names = (await page.evaluateAll(`[...(document.querySelector('[role="toolbar"][aria-label="Formatting"]')?.querySelectorAll('button') ?? [])].map(b => b.getAttribute('aria-label') || b.textContent.trim())`)).find(list => list.length) ?? [];
      assert.ok(names.includes('Comment'), `toolbar: ${names}`);
      assert.ok(!names.includes('Edit with Agent'), `toolbar: ${names}`);
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
      w.child.kill();
      await w.exited;
    }
  });
});
