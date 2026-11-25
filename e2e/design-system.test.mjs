// End-to-end tests of the design-system type: the shared main path (lib/editor.mjs), plus what only a design
// system has: `generate`, uploads into an asset group, `list`, the Welcome page of an empty system, and files dropped
// on an asset group.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { buttonNamed, clickOn, editorSuite, serverRecord, startWait, textIn } from './lib/editor.mjs';
import { png, until } from './lib/http.mjs';
import { copyFixture, tmpDir } from './lib/target.mjs';

const T = { timeout: 90000 };
const README = 'project/README.md';
const indexOf = root => JSON.parse(fs.readFileSync(path.join(root, 'project', 'design-system.json'), 'utf8'));

editorSuite({
  type: 'design-system',
  make: (ctx, root) => copyFixture('design-system', root),
  broken: (ctx, root) => {
    copyFixture('design-system', root);
    const file = path.join(root, 'project', 'design-system.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), namespace: 'Smoke System' }));
  },
  pageText: 'Smoke System',
  save: { file: README, edit: text => `${text}\nSaved by the page.\n` },
  diskEdit: {
    apply: ctx => fs.appendFileSync(path.join(ctx.root, README), '\nEdited on disk, shown on the overview.\n'),
    text: 'Edited on disk, shown on the overview.',
  },

  offline(ctx) {
    it('check refuses a namespace that is no JavaScript name, and design-system.json that is no JSON', T, async () => {
      const bad = path.join(tmpDir('ds-namespace'), 'artifact');
      ctx.spec.broken(ctx, bad);
      const out = await ctx.cli.run(['check', bad, '--json']);
      assert.equal(out.code, 1);
      assert.ok(out.json.findings.some(f => f.level === 'error' && /namespace/i.test(f.message)), out.stdout);
      fs.writeFileSync(path.join(bad, 'project', 'design-system.json'), '{ not json');
      const json = await ctx.cli.run(['check', bad]);
      assert.equal(json.code, 1, json.stdout);
    });

    it('generate writes the generated files, then finds them up to date', T, async () => {
      const root = path.join(tmpDir('ds-generate'), 'artifact');
      copyFixture('design-system', root);
      const first = await ctx.cli.run(['generate', root]);
      assert.equal(first.code, 0, first.stderr);
      assert.match(first.stdout, /^wrote {3}project\/tokens\.css$/m, first.stdout);
      assert.ok(fs.existsSync(path.join(root, 'project', 'tokens.css')));
      const again = await ctx.cli.run(['generate', root]);
      assert.equal(again.code, 0);
      assert.equal(again.stdout.trim(), 'Generated files are up to date.');
    });

    it('upload --group prints the record for an asset group, which the index then takes', T, async () => {
      const root = path.join(tmpDir('ds-upload'), 'artifact');
      copyFixture('design-system', root);
      const file = path.join(tmpDir('ds-upload-src'), 'Mark.png');
      fs.writeFileSync(file, png([9, 8, 7]));
      const out = await ctx.cli.json(['upload', root, file, '--group', 'Logos']);
      assert.equal(out.record.name, 'Mark.png');
      assert.match(out.url, /^\/_blob\/[0-9a-f]{32}$/);
      assert.equal(out.record.type, 'image/png');
      assert.deepEqual(out.indexPath.slice(0, 3), ['assetGroups', 'Logos', 'files']);
      assert.equal(out.shownAs, 'assets/Logos/Mark.png');
      assert.ok(fs.readdirSync(path.join(root, '_blobs')).some(f => f.startsWith(out.record.blob)), 'nothing under _blobs/');
      // As `next` says, the agent writes the record into the index.
      const index = indexOf(root);
      index.assetGroups.Logos.files[out.indexPath[3]] = out.record;
      index.assetGroups.Logos.order.push(out.record.name);
      fs.writeFileSync(path.join(root, 'project', 'design-system.json'), JSON.stringify(index, null, 2));
      const check = await ctx.cli.run(['check', root]);
      assert.equal(check.code, 0, check.stdout);
      const noGroup = await ctx.cli.run(['upload', root, file]);
      assert.notEqual(noGroup.code, 0);
      assert.match(noGroup.stderr + noGroup.stdout, /MISSING_GROUP/);
      const slash = await ctx.cli.run(['upload', root, file, '--group', 'a/b']);
      assert.equal(slash.code, 1, slash.stdout);
    });

    it('list finds the design system', T, async () => {
      const found = await ctx.cli.json(['list', path.dirname(ctx.root)]);
      assert.equal(found.systems.length, 1, JSON.stringify(found));
      assert.equal(found.systems[0].namespace, 'SmokeSystem');
      assert.equal(found.systems[0].root, ctx.root);
    });
  },

  online(ctx) {
    it('the host and CLI agree on encoded groups and imported blobs resolve by logical path', T, async () => {
      const { root, url } = await ctx.openNew('unicode');
      const { secret } = serverRecord(ctx);
      const file = path.join(tmpDir('ds-unicode'), '标记 1.png');
      const bytes = png([4, 6, 8]);
      fs.writeFileSync(file, bytes);
      const group = '品牌 A';
      const groupKey = '~e5~93~81~e7~89~8c~20A';
      const cli = await ctx.cli.json(['upload', root, file, '--group', group]);
      assert.equal(cli.indexPath[1], groupKey);
      const action = await fetch(new URL('/__open-artifact/actions/upload', url), {
        method: 'POST', headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
        body: JSON.stringify({ root, args: { group, file } }),
      });
      assert.equal(action.status, 200);
      const { upload } = await action.json();
      assert.deepEqual(upload.indexPath, cli.indexPath);
      assert.deepEqual(upload.record, cli.record);
      const index = indexOf(root);
      index.assetGroups[groupKey] = { name: group, files: { [cli.indexPath[3]]: cli.record } };
      fs.writeFileSync(path.join(root, 'project/design-system.json'), JSON.stringify(index));
      fs.renameSync(path.join(root, '_blobs'), path.join(root, 'project/_blobs'));
      const logical = new URL('project/assets/' + encodeURIComponent(group) + '/' + encodeURIComponent(cli.record.name), url);
      for (const target of [logical, new URL(cli.url, url)]) {
        const response = await fetch(target);
        assert.equal(response.status, 200, target.href);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      }
      fs.mkdirSync(path.join(root, 'project/assets', group), { recursive: true });
      const replacement = png([6, 8, 1]);
      fs.writeFileSync(path.join(root, 'project/assets', group, cli.record.name), replacement);
      assert.deepEqual(Buffer.from(await (await fetch(logical)).arrayBuffer()), replacement);
    });
  },

  chrome(ctx) {
    it('the global shell shares, exports the project ZIP and anchors comments on tokens', T, async (t) => {
      const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
      const workspace = tmpDir('ds-frame');
      const root = path.join(workspace, 'system');
      copyFixture('design-system', root);
      const previous = process.env.OPEN_ARTIFACT_HOME;
      process.env.OPEN_ARTIFACT_HOME = path.join(workspace, 'daemon');
      t.after(() => {
        if (previous === undefined) delete process.env.OPEN_ARTIFACT_HOME;
        else process.env.OPEN_ARTIFACT_HOME = previous;
      });
      const daemon = await startDaemon({ port: 0, quiet: true, builtinTypesDir: ctx.work });
      const browser = await ctx.browser();
      let page;
      try {
        const artifact = await daemon.tools.call('Artifact', { action: 'adopt', folder: root, type_url: 'open-artifact://type/design-system' }, { harness: 'cli', session: null, workspace });
        page = await browser.load(artifact.view_url, { ready: "document.querySelector('[data-comments-button]')" });
        const shellButton = "document.querySelector('[data-comments-button] button')";
        assert.ok(await page.evaluate(shellButton + ' !== null'), 'the shell owns the comment button');
        assert.ok(await page.waitFor("document.querySelector('.ds-pages')"));
        const editorControls = await page.evaluateAll("document.querySelector('.ds-pages') ? document.querySelectorAll('header [data-comments-button], header button[aria-label=Share], [data-export-row], [data-comment-badge]').length : null");
        assert.deepEqual(editorControls.filter(value => value !== null), [0], 'the framed editor has no duplicate controls or new-thread badges in browse mode');
        await clickOn(page, buttonNamed('Share'));
        assert.ok(await page.waitFor("document.querySelector('[aria-label=\"General access\"]')"));
        await clickOn(page, buttonNamed('Export'));
        const downloadDir = tmpDir('ds-frame-zip');
        await browser.downloadsTo(downloadDir);
        await clickOn(page, "document.querySelector('[data-export-row]')");
        const zip = () => fs.readdirSync(downloadDir).find(f => f.endsWith('.zip'));
        assert.ok(await until(zip, 15000), 'the shell downloaded the project archive');
        const bytes = fs.readFileSync(path.join(downloadDir, zip()));
        assert.equal(bytes.readUInt32LE(0), 0x04034b50);
        assert.ok(bytes.includes(Buffer.from('project/design-system.json')));

        await clickOn(page, shellButton);
        assert.ok(await page.waitFor("document.querySelector('main[data-commenting]')"));
        await page.evaluateAll("document.querySelector('button[aria-label^=\"ink in light\"]')?.click()");
        const layer = "document.querySelector('[data-comments-layer]')?.shadowRoot";
        assert.ok(await page.waitFor(layer + "?.querySelector('[data-comment-card] textarea')"));
        assert.ok(!(await page.evaluateAll("!!document.querySelector('button[aria-label^=\"ink in light\"][aria-expanded=true]')")).includes(true), 'commenting on the swatch also opened its color picker');
        await page.type('Review this token');
        await page.press('Enter');
        const commentFile = path.join(root, 'comments.json');
        assert.ok(await until(() => fs.existsSync(commentFile) && fs.readFileSync(commentFile, 'utf8').includes('Review this token'), 10000));
        const { threads } = JSON.parse(fs.readFileSync(commentFile, 'utf8'));
        assert.deepEqual(JSON.parse(threads[0].anchor), { kind: 'token', family: 'color', name: 'ink' });
        await clickOn(page, shellButton);
        assert.ok(await page.waitFor("document.querySelector('[data-comments-dot]')"), 'the shell shows the new comment');
        assert.ok(await page.waitFor("document.querySelector('.ds-pages') && !document.querySelector('[data-comments-layer]')"), 'leaving comment mode closes the thread card');
        await clickOn(page, buttonNamed('Comment options'));
        await clickOn(page, "[...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.includes('Show all comments'))");
        assert.ok(await page.waitFor("document.querySelector('[data-comments-panel-layer]')?.shadowRoot?.querySelector('[data-comments-panel]')?.textContent.includes('Review this token')"));
      } finally {
        await page?.close();
        await browser.dropDownloads();
        daemon.close();
      }
    });

    it('the overview shows the README, and opening the page writes the generated files', T, async () => {
      const page = ctx.page();
      assert.ok(page, 'the page did not open');
      assert.ok(await page.waitFor(textIn('Warm paper surfaces, one terracotta accent.'), 10000), 'the overview does not show the README');
      for (const file of ['tokens.css', 'manifest.json']) {
        assert.ok(await until(() => fs.existsSync(path.join(ctx.root, 'project', file)), 10000), `opening the page did not write project/${file}`);
      }
    });

    it('an empty system offers to start from code, and that request reaches wait', T, async () => {
      const root = path.join(tmpDir('ds-empty'), 'Empty System');
      fs.mkdirSync(root);
      const out = await ctx.cli.json(['open', root, '--type', 'design-system', '--title', 'Empty System', '--json']);
      const w = await startWait(ctx, root, 60);
      const page = await (await ctx.browser()).load(out.url, { ready: textIn('Sync from GitHub'), settle: 800 });
      try {
        await clickOn(page, `[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Sync from GitHub'))`, 'Sync from GitHub');
        const { code, stdout } = await w.done;
        assert.equal(code, 0, stdout);
        assert.match(stdout, /GitHub repository/);
        assert.deepEqual(page.problems, []);
      } finally {
        w.child.kill('SIGTERM');
        await page.close();
      }
    });

    it('hands the connector route to the agent with its source-selection instructions', T, async () => {
      const root = path.join(tmpDir('ds-connectors'), 'Empty System');
      fs.mkdirSync(root);
      const out = await ctx.cli.json(['open', root, '--type', 'design-system', '--json']);
      const w = await startWait(ctx, root, 60);
      const page = await (await ctx.browser()).load(out.url, { ready: textIn('Build from connectors') });
      try {
        await clickOn(page, `[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Build from connectors'))`, 'Build from connectors');
        const { code, stdout } = await w.done;
        assert.equal(code, 0, stdout);
        assert.match(stdout, /which sources are available/);
        assert.deepEqual(page.problems, []);
      } finally {
        w.child.kill('SIGTERM');
        await page.close();
      }
    });

    it('keeps the brand book mounted while navigating and renders the selected preview theme', T, async () => {
      const { url } = await ctx.openNew('theme');
      const page = await (await ctx.browser()).load(url, { ready: textIn('Warm paper surfaces') });
      try {
        await clickOn(page, `[...document.querySelectorAll('nav button')].find(b => b.textContent.startsWith('Components'))`, 'Components');
        assert.ok(await page.waitFor(`document.querySelector('iframe[title="Button preview"]')?.contentDocument?.documentElement.dataset.theme === 'light'`, 8000));
        await page.evaluate(`(() => {
          const select = document.querySelector('[aria-label="Component preview theme"]');
          select.value = 'dark';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        assert.ok(await page.waitFor(`document.querySelector('iframe[title="Button preview"]')?.contentDocument?.documentElement.dataset.theme === 'dark'`, 8000));
        assert.ok(await page.evaluate(textIn('Warm paper surfaces')));
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('creates from selected brand files after the asset record is saved', T, async () => {
      const root = path.join(tmpDir('ds-intake'), 'Brand intake');
      fs.mkdirSync(root);
      const out = await ctx.cli.json(['open', root, '--type', 'design-system', '--json']);
      const w = await startWait(ctx, root, 60);
      const page = await (await ctx.browser()).load(out.url, { ready: textIn('Upload brand files') });
      try {
        await clickOn(page, `[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Upload brand files'))`, 'Upload brand files');
        await page.evaluate(`(() => {
          const dt = new DataTransfer();
          dt.items.add(new File([new Uint8Array(${JSON.stringify([...png([8, 6, 4])])})], 'mark.png', { type: 'image/png' }));
          document.querySelector('input[type=file]').files = dt.files;
          document.querySelector('input[type=file]').dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        assert.ok(await until(() => indexOf(root).assetGroups?.Other?.files?.['mark.png'], 10000), 'selecting a file should save it before the handoff');
        await clickOn(page, buttonNamed('Create design system'), 'Create design system');
        const { code, stdout } = await w.done;
        assert.equal(code, 0, stdout);
        assert.match(stdout, /uploaded brand files/);
        assert.equal(indexOf(root).assetGroups.Other.files['mark.png'].name, 'mark.png');
        assert.deepEqual(page.problems, []);
      } finally {
        w.child.kill('SIGTERM');
        await page.close();
      }
    });

    it('edits the rendered brand book, preserves untouched Markdown and recovers an unsaved edit on reload', T, async () => {
      const { root, url } = await ctx.openNew('rich');
      const page = await (await ctx.browser()).load(url, { ready: textIn('Warm paper surfaces') });
      const readme = path.join(root, README);
      const editor = `document.querySelector('[contenteditable=true][aria-label="README.md"]')`;
      try {
        await page.evaluate(`(() => {
          const box = ${editor};
          box.focus();
          const range = document.createRange();
          range.selectNodeContents(box.querySelector('p'));
          const selection = getSelection();
          selection.removeAllRanges(); selection.addRange(range);
          document.execCommand('bold');
        })()`);
        assert.ok(await until(() => /\*\*The design system the smoke test opens\. Warm paper surfaces, one terracotta accent\.\*\*/.test(fs.readFileSync(readme, 'utf8')), 10000), 'formatted text did not reach README.md');
        assert.match(fs.readFileSync(readme, 'utf8'), /^# Smoke System/m);
        await page.cdp('Network.setBlockedURLs', { urls: ['*/_api/publish*'] });
        await page.evaluate(`(() => {
          const range = document.createRange(); range.selectNodeContents((${editor}).querySelector('p')); range.collapse(false);
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
          document.execCommand('insertText', false, ' Restored draft.');
        })()`);
        assert.ok(await page.waitFor(textIn('Restored draft.'), 3000));
        await page.cdp('Page.reload', { ignoreCache: true });
        assert.ok(await page.waitFor(textIn('has unsaved edits recovered from this tab'), 10000), 'unsaved work was not offered after reload');
        await page.cdp('Network.setBlockedURLs', { urls: [] });
        await clickOn(page, buttonNamed('Keep mine'), 'Keep mine');
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('Restored draft.'), 10000));
      } finally {
        await page.close();
      }
    });

    it('unlocks the editor when an invalid creation marker is repaired on disk', T, async () => {
      const { root, url } = await ctx.openNew('marker', (ctx, root) => {
        ctx.spec.make(ctx, root);
        fs.writeFileSync(path.join(root, 'project/design-system.json'), JSON.stringify({ ...indexOf(root), createdOnFiles: true }));
      });
      const page = await (await ctx.browser()).load(url, { ready: textIn('Editing is paused') });
      try {
        assert.equal(await page.evaluate(`document.querySelectorAll('[contenteditable=true]').length`), 0);
        fs.writeFileSync(path.join(root, 'project/design-system.json'), JSON.stringify({ ...indexOf(root), createdOnFiles: { v: 1, at: new Date().toISOString() } }));
        assert.ok(await page.waitFor(`document.querySelector('[contenteditable=true][aria-label="README.md"]')`, 10000));
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('moves a selection and renames its group with the physical files and group notes', T, async () => {
      const { root, url } = await ctx.openNew('groups', (ctx, root) => {
        ctx.spec.make(ctx, root);
        fs.mkdirSync(path.join(root, 'project/assets/Logos'), { recursive: true });
        fs.mkdirSync(path.join(root, 'project/assets/目标'), { recursive: true });
        fs.writeFileSync(path.join(root, 'project/assets/目标/README.md'), 'Group note');
        for (const file of ['first.png', 'second.png']) fs.writeFileSync(path.join(root, 'project/assets/Logos', file), png([6, 7, 8]));
      });
      const page = await (await ctx.browser()).load(url, { ready: textIn('Warm paper surfaces') });
      try {
        await clickOn(page, `[...document.querySelectorAll('nav button')].find(b => b.textContent.startsWith('Assets'))`, 'Assets');
        await page.evaluate(`(async () => {
          const tiles = [...document.querySelectorAll('figure')].filter(el => /first\\.png|second\\.png/.test(el.innerText));
          for (const [i, tile] of tiles.entries()) {
            tile.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: i > 0 }));
            await new Promise(requestAnimationFrame);
          }
        })()`);
        assert.ok(await page.waitFor(textIn('2 selected'), 5000));
        await page.evaluate(`(() => {
          const select = document.querySelector('[aria-label="Move selected files to group"]');
          select.value = '目标'; select.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        const dir = path.join(root, 'project/assets');
        assert.ok(await until(() => fs.existsSync(path.join(dir, '目标/second.png')), 8000));
        await page.evaluate(`document.querySelector('[aria-label="Rename group 目标"]').click()`);
        await page.evaluate(`document.querySelector('[aria-label="Group name"]').select()`);
        await page.type('Library');
        await page.press('Enter');
        assert.ok(await until(() => fs.existsSync(path.join(dir, 'Library/README.md')), 8000));
        assert.equal(fs.readFileSync(path.join(dir, 'Library/README.md'), 'utf8'), 'Group note');
        assert.deepEqual(fs.readFileSync(path.join(dir, 'Library/first.png')), png([6, 7, 8]));
        assert.ok(indexOf(root).assetGroups.Library);
        assert.ok(!fs.existsSync(path.join(dir, 'Logos/first.png')));
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('drops a folder on the overview and keeps nested documents readable at their project paths', T, async () => {
      const { root, url } = await ctx.openNew('folder');
      const page = await (await ctx.browser()).load(url, { ready: textIn('Warm paper surfaces') });
      try {
        await page.evaluate(`(() => {
          const file = new File(['Brand guidance'], 'guide.md', { type: 'text/markdown' });
          Object.defineProperty(file, 'webkitRelativePath', { value: '手册/notes/guide.md' });
          const dt = new DataTransfer(); dt.items.add(file);
          document.querySelector('[data-system-section=overview]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        })()`);
        const guide = path.join(root, 'project/assets/手册/notes/guide.md');
        assert.ok(await until(() => fs.existsSync(guide), 8000));
        assert.equal(fs.readFileSync(guide, 'utf8'), 'Brand guidance');
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('files dropped on an asset group are uploaded into it', T, async () => {
      const { root, url } = await ctx.openNew('drop');
      const page = await (await ctx.browser()).load(url, { ready: textIn('Smoke System'), settle: 800 });
      try {
        await clickOn(page, `[...document.querySelectorAll('nav button, nav a, aside button, aside a')].find(b => b.textContent.trim().startsWith('Assets'))`, 'Assets in the sidebar');
        const section = `[...document.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent.trim().startsWith('Logos'))`;
        assert.ok(await page.waitFor(section, 10000), 'no Logos group on the Assets page');
        const bytes = [...png([4, 5, 6])];
        await page.evaluate(`(() => {
          const dt = new DataTransfer();
          dt.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})], 'Dropped.png', { type: 'image/png' }));
          const target = ${section};
          target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
          target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        })()`);
        let record;
        assert.ok(
          await until(() => (record = Object.values(indexOf(root).assetGroups.Logos.files).find(r => r.name === 'Dropped.png')), 15000),
          `nothing added to Logos: ${JSON.stringify(indexOf(root).assetGroups.Logos)}`,
        );
        assert.equal(record.type, 'image/png');
        assert.match(record.blob, /^[0-9a-f]{32}$/);
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('a link in the README opens a card that edits and removes it, and saves the Markdown', T, async () => {
      const { root, url } = await ctx.openNew('link-card');
      const readme = path.join(root, README);
      fs.appendFileSync(readme, '\nSee [the guide](https://example.com/guide) first.\n');
      const page = await (await ctx.browser()).load(url, { ready: textIn('See the guide first.') });
      const link = `document.querySelector('[role=textbox] a[data-target]')`;
      const card = `document.querySelector('[data-link-card]')`;
      try {
        await clickOn(page, link, 'the README link');
        assert.ok(await page.waitFor(`${card}?.textContent.includes('example.com/guide')`, 5000), 'no link card at the caret');
        assert.ok(await page.evaluate(`!!${card}.querySelector('button[aria-label="Open link"]')`));
        await clickOn(page, `${card}.querySelector('button[aria-label="Edit link"]')`, 'Edit link');
        assert.ok(await page.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Link address'`, 5000));
        await page.evaluate(`document.activeElement.select()`);
        await page.type('javascript:alert(1)');
        await page.press('Enter');
        assert.ok(await page.waitFor(`${card}?.querySelector('[role=alert]')`, 3000), 'an unsafe address was taken');
        await page.evaluate(`document.activeElement.select()`);
        await page.type('Example.org/new page');
        await page.press('Escape');
        assert.ok(await page.waitFor(`document.activeElement?.getAttribute('role') === 'textbox' && ${card}?.textContent.includes('example.com/guide')`, 5000), 'Escape did not put the address back');
        await clickOn(page, `${card}.querySelector('button[aria-label="Edit link"]')`, 'Edit link');
        await page.evaluate(`document.activeElement.select()`);
        await page.type('example.org/new');
        await page.press('Enter');
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('See [the guide](https://example.org/new) first.'), 10000), fs.readFileSync(readme, 'utf8'));
        await clickOn(page, link, 'the edited link');
        await clickOn(page, `${card}.querySelector('button[aria-label="Remove link"]')`, 'Remove link');
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('See the guide first.'), 10000), fs.readFileSync(readme, 'utf8'));
        assert.ok(await page.waitFor(`!${card}`, 3000), 'the card stayed after the link went');
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    const linkPage = async (label) => {
      const { root, url } = await ctx.openNew(label);
      const readme = path.join(root, README);
      fs.appendFileSync(readme, '\nSee [the guide](https://example.com/guide) first.\n');
      const page = await (await ctx.browser()).load(url, { ready: textIn('See the guide first.') });
      return { readme, page };
    };
    const readmeLink = `document.querySelector('[role=textbox] a[data-target]')`;
    const linkCard = `document.querySelector('[data-link-card]')`;
    const undoKey = process.platform === 'darwin' ? { meta: true } : { ctrl: true };
    const redoKey = undoKey;

    it('in comment mode a README link opens no link card', T, async (t) => {
      const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
      const workspace = tmpDir('ds-link-comment');
      const root = path.join(workspace, 'system');
      copyFixture('design-system', root);
      fs.appendFileSync(path.join(root, README), '\nSee [the guide](https://example.com/guide) first.\n');
      const previous = process.env.OPEN_ARTIFACT_HOME;
      process.env.OPEN_ARTIFACT_HOME = path.join(workspace, 'daemon');
      t.after(() => {
        if (previous === undefined) delete process.env.OPEN_ARTIFACT_HOME;
        else process.env.OPEN_ARTIFACT_HOME = previous;
      });
      const daemon = await startDaemon({ port: 0, quiet: true, builtinTypesDir: ctx.work });
      const browser = await ctx.browser();
      let page;
      // The editor runs in the Shell's frame: put the caret at the end of the link there.
      const caretInLink = `(() => { const link = ${readmeLink}; if (!link) return null; const box = link.closest('[role=textbox]'); box.focus(); const range = document.createRange(); range.selectNodeContents(link); range.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(range); return true; })()`;
      try {
        const artifact = await daemon.tools.call('Artifact', { action: 'adopt', folder: root, type_url: 'open-artifact://type/design-system' }, { harness: 'cli', session: null, workspace });
        page = await browser.load(artifact.view_url, { ready: "document.querySelector('[data-comments-button]')" });
        assert.ok(await page.waitFor(readmeLink, 10000), 'no README link');
        const shellButton = "document.querySelector('[data-comments-button] button')";
        await clickOn(page, shellButton, 'Comments');
        assert.ok(await page.waitFor("document.querySelector('main[data-commenting]')", 5000), 'comment mode did not start');
        assert.ok((await page.evaluateAll(caretInLink)).includes(true));
        await new Promise(resolve => setTimeout(resolve, 500));
        assert.ok(!(await page.evaluateAll(`!!${linkCard}`)).includes(true), 'a link card showed in comment mode');
        await clickOn(page, shellButton, 'Comments');
        assert.ok(await page.waitFor("document.querySelector('.ds-pages') && !document.querySelector('main[data-commenting]')", 5000));
        assert.ok((await page.evaluateAll(caretInLink)).includes(true));
        assert.ok(await page.waitFor(linkCard, 5000), 'no link card after comment mode ended');
      } finally {
        await page?.close();
        daemon.close();
      }
    });

    it('undo puts back a link address changed in the card, and redo makes the change again', T, async () => {
      const { readme, page } = await linkPage('link-undo');
      try {
        await clickOn(page, readmeLink, 'the README link');
        assert.ok(await page.waitFor(linkCard, 5000), 'no link card');
        await clickOn(page, `${linkCard}.querySelector('button[aria-label="Edit link"]')`, 'Edit link');
        assert.ok(await page.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Link address'`, 5000));
        await page.evaluate(`document.activeElement.select()`);
        await page.type('example.org/new');
        await page.press('Enter');
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('(https://example.org/new)'), 10000), fs.readFileSync(readme, 'utf8'));
        assert.ok(await page.waitFor(`document.activeElement?.getAttribute('role') === 'textbox'`, 3000), 'the text did not get focus back');
        await page.press('z', undoKey);
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('See [the guide](https://example.com/guide) first.'), 10000), fs.readFileSync(readme, 'utf8'));
        // The card shows again for the restored address.
        assert.ok(await page.waitFor(linkCard, 3000), 'no link card after undo');
        await page.press('z', { ...redoKey, shift: true });
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('(https://example.org/new)'), 10000), `redo: ${fs.readFileSync(readme, 'utf8')}`);
        assert.ok(await page.waitFor(`${linkCard}?.textContent.includes('example.org/new')`, 3000), 'the card shows the redone address');
        await page.press('z', undoKey);
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('See [the guide](https://example.com/guide) first.'), 10000), `undo after redo: ${fs.readFileSync(readme, 'utf8')}`);
        assert.ok(await page.waitFor(linkCard, 3000), 'no link card after the second undo');
        await clickOn(page, `${linkCard}.querySelector('button[aria-label="Remove link"]')`, 'Remove link');
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('See the guide first.'), 10000), fs.readFileSync(readme, 'utf8'));
        await page.press('z', undoKey);
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('See [the guide](https://example.com/guide) first.'), 10000), `undo after Remove: ${fs.readFileSync(readme, 'utf8')}`);
        await page.press('z', { ...redoKey, shift: true });
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('See the guide first.'), 10000), `redo of Remove: ${fs.readFileSync(readme, 'utf8')}`);
        assert.ok(await page.waitFor(`!${linkCard}`, 3000), 'the card stayed after the redone Remove');
        await page.press('z', undoKey);
        assert.ok(await until(() => fs.readFileSync(readme, 'utf8').includes('See [the guide](https://example.com/guide) first.'), 10000), `undo of the redone Remove: ${fs.readFileSync(readme, 'utf8')}`);
        // Typing ends the card's undo: redo has nothing left to make again.
        await page.type('!');
        await page.press('z', { ...redoKey, shift: true });
        await new Promise(resolve => setTimeout(resolve, 600));
        assert.ok(await until(() => /See \[the guide!?\]\(https:\/\/example\.com\/guide\)!? first\./.test(fs.readFileSync(readme, 'utf8')) && fs.readFileSync(readme, 'utf8').includes('!'), 10000), `redo after typing: ${fs.readFileSync(readme, 'utf8')}`);
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('a modifier click on a link while editing opens it', T, async () => {
      const { page } = await linkPage('link-open');
      try {
        await page.evaluate(`window.opened = []; window.open = (href) => { window.opened.push(href); return null; };`);
        const middle = `(() => { const r = ${readmeLink}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;
        let at = await page.evaluate(middle);
        await page.click(at.x, at.y);
        assert.ok(await page.waitFor(linkCard, 5000));
        assert.deepEqual(await page.evaluate('window.opened'), [], 'a plain click opened the link');
        // The format bar shows above the text once it is being edited, so the link moved.
        at = await page.evaluate(middle);
        await page.click(at.x, at.y, undoKey);
        assert.ok(await page.waitFor(`window.opened.length === 1`, 3000), 'the modifier click did not open the link');
        assert.equal(await page.evaluate('window.opened[0]'), 'https://example.com/guide');
      } finally {
        await page.close();
      }
    });

    it('a typed color previews in the picker, and Escape puts the color back without saving', T, async () => {
      const { root, url } = await ctx.openNew('picker-draft');
      const tokens = path.join(root, 'project', 'tokens.json');
      const page = await (await ctx.browser()).load(url, { ready: `document.querySelector('button[aria-label^="ink in light"]')` });
      const swatch = `document.querySelector('input[aria-label="Color value"]')?.previousElementSibling?.style.background ?? ''`;
      try {
        await page.evaluate(`document.querySelector('button[aria-label^="ink in light"]').scrollIntoView({ block: 'center' })`);
        await clickOn(page, `document.querySelector('button[aria-label^="ink in light"]')`, 'the ink swatch');
        assert.ok(await page.waitFor(`document.querySelector('input[aria-label="Color value"]')`, 5000), 'no color picker');
        const before = fs.readFileSync(tokens, 'utf8');
        const shown = await page.evaluate(swatch);
        await page.evaluate(`(() => { const input = document.querySelector('input[aria-label="Color value"]'); input.focus(); input.select(); })()`);
        await page.type('00ff00');
        assert.ok(await page.waitFor(`(${swatch}).includes('rgb(0, 255, 0)')`, 3000), 'the typed color did not preview');
        await page.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 600));
        assert.equal(fs.readFileSync(tokens, 'utf8'), before, 'Escape saved the draft');
        if (!(await page.evaluate(`!!document.querySelector('input[aria-label="Color value"]')`))) {
          await clickOn(page, `document.querySelector('button[aria-label^="ink in light"]')`, 'the ink swatch again');
        }
        assert.ok(await page.waitFor(`(${swatch}) === ${JSON.stringify(shown)}`, 3000), `Escape did not restore the picker: ${shown} → ${await page.evaluate(swatch)}`);
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('a component preview cannot take focus from the page before it is used', T, async () => {
      const { root, url } = await ctx.openNew('preview-focus');
      const dir = path.join(root, 'project', 'components', 'Grabby');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'preview.html'), '<!-- @dsCard group="Inputs" height=80 -->\n<input id="grab"><dialog id="pop"><button>Close</button></dialog><script>window.tries = 0; setInterval(function () { window.tries++; document.getElementById("grab").focus(); if (window.tries === 10) document.getElementById("pop").showModal(); }, 40);</script>\n');
      const page = await (await ctx.browser()).load(url, { ready: textIn('Warm paper surfaces') });
      const frame = `document.querySelector('iframe[title="Grabby preview"]')`;
      try {
        await clickOn(page, `[...document.querySelectorAll('nav button')].find(b => b.textContent.startsWith('Components'))`, 'Components');
        assert.ok(await page.waitFor(`${frame}?.contentWindow?.tries > 0`, 10000), 'the preview never ran');
        await page.evaluate(`(() => { const field = document.createElement('input'); field.id = 'typing-here'; document.body.append(field); field.focus(); })()`);
        const tries = await page.evaluate(`${frame}.contentWindow.tries`);
        assert.ok(await page.waitFor(`${frame}.contentWindow.tries > ${tries + 5}`, 5000));
        assert.ok(await page.waitFor(`${frame}.contentWindow.tries > 12`, 5000));
        assert.equal(await page.evaluate(`document.activeElement?.id`), 'typing-here', 'the preview took focus');
        assert.equal(await page.evaluate(`${frame}.contentDocument.getElementById('pop').open`), true, 'the dialog did not show');
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('starting a scrub commits the number typed into another field first', T, async () => {
      const { root, url } = await ctx.openNew('scrub-commit', (c, dir) => {
        copyFixture('design-system', dir);
        const file = path.join(dir, 'project', 'tokens.json');
        const tokens = JSON.parse(fs.readFileSync(file, 'utf8'));
        tokens.shadow = { tokens: [{ name: 'shadow-sm', value: '0 1px 2px #00000033', usage: 'Cards.' }] };
        fs.writeFileSync(file, JSON.stringify(tokens));
      });
      const file = path.join(root, 'project', 'tokens.json');
      const saved = () => JSON.parse(fs.readFileSync(file, 'utf8')).shadow.tokens[0].value;
      const page = await (await ctx.browser()).load(url, { ready: `document.querySelector('button[aria-label^="Edit shadow-sm"]')` });
      const blur = `document.querySelector('input[aria-label="Shadow 1 blur"]')`;
      const spread = `document.querySelector('[data-scrub-for="' + document.querySelector('input[aria-label="Shadow 1 spread"]').id + '"]')`;
      try {
        await page.evaluate(`document.querySelector('button[aria-label^="Edit shadow-sm"]').scrollIntoView({ block: 'center' })`);
        await clickOn(page, `document.querySelector('button[aria-label^="Edit shadow-sm"]')`, 'the shadow');
        assert.ok(await page.waitFor(blur, 5000), 'no shadow editor');
        await page.evaluate(`(() => { const input = ${blur}; input.focus(); input.select(); })()`);
        await page.type('9');
        const at = await page.evaluate(`(() => { const r = ${spread}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
        await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
        for (let step = 1; step <= 5; step++) await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + step * 4, y: at.y, button: 'left', buttons: 1 });
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x + 20, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
        assert.ok(await until(() => /^0(?:px)? 1px 9px [1-9]\d*px /.test(saved()), 10000), `saved ${saved()}`);
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });
  },
});
