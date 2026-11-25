// End-to-end tests of the design type: the shared main path (lib/editor.mjs), plus what only a design has: boards
// in canvas.json, pages, image notes, the "Ask agent to fix" button on a board that throws, and an unreadable
// canvas.json the editor must leave alone.
//
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createTypeServer } from '../packages/type-server/src/server.ts';
import { buttonNamed, clickOn, editorSuite, startWait, textIn, typeInto } from './lib/editor.mjs';
import { blockFont } from './lib/font.mjs';
import { png, until } from './lib/http.mjs';
import { copyFixture, fixtures, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 90000 };
const BOARD = 'project/Main.dc.html';
const canvasOf = root => JSON.parse(fs.readFileSync(path.join(root, 'project', 'canvas.json'), 'utf8'));

// Run the real frame shell and its daemon with the installed type under test.
async function withDesignShell(ctx, root, ready, check) {
  const home = tmpDir('design-frame-shell');
  const env = {
    ...process.env, HOME: ctx.userHome, OPEN_ARTIFACT_HOME: home, OPEN_ARTIFACT_PORT: '0',
    OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(home, 'type-server'),
    OPEN_ARTIFACT_BUILTIN_TYPES: path.dirname(ctx.typeDir),
    OPEN_ARTIFACT_SHELL_DIR: path.join(repoRoot, 'dist/daemon/shell'),
  };
  const bin = path.join(repoRoot, 'packages/daemon/src/bin/open-artifact.ts');
  const run = (...args) => promisify(execFile)(process.execPath, [bin, ...args], { cwd: repoRoot, env, timeout: 30000 });
  try {
    const { stdout } = await run('artifact', JSON.stringify({ action: 'publish', type_url: 'open-artifact://type/design', folder: root, title: 'Design test' }), '--workspace', path.dirname(root));
    const browser = await ctx.browser();
    await browser.downloadsTo(ctx.downloads);
    const page = await browser.load(JSON.parse(stdout).view_url, { ready });
    try {
      assert.ok(await page.waitFor(ready), 'Design loaded in the frame shell');
      await check(page);
    } finally { await page.close(); }
  } finally { await run('daemon', 'stop'); }
}

// An artboard whose first line, "....", is set in the block font (lib/font.mjs) from the project's own files, through an
// inline @font-face: a solid bar from (20, 20) to (180, 60) in INK. In a fallback font the dots sit at the foot of the
// line and the top of it stays PAPER. With `han`, the font also draws 2000 ideographs and the bar is "丂丂丂丂" (U+4E02,
// which no list counter makes), so a picture of it carries a subset of the font.
const INK = [200, 20, 50];
const PAPER = [255, 247, 214];
function webFontBoard(root, entry = {}, { han = false } = {}) {
  copyFixture('design', root);
  fs.mkdirSync(path.join(root, 'project/fonts'));
  fs.writeFileSync(path.join(root, 'project/fonts/Block.ttf'), blockFont('Block', { han }));
  const index = canvasOf(root);
  Object.assign(index.boards['Main.dc.html'], { title: 'Web font', ...entry });
  fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
  const template = `<x-dc><helmet><style>
    @font-face{font-family:"Block";src:url("fonts/Block.ttf") format("truetype")}
    body{margin:0}
  </style></helmet><div style="width:880px;height:560px;background:rgb(${PAPER});position:relative">
    <p id="block" style="position:absolute;left:20px;top:20px;margin:0;font:40px/40px Block,monospace;color:rgb(${INK})">${han ? '丂丂丂丂' : '....'}</p>
    <p style="position:absolute;left:20px;top:100px;margin:0;font:16px sans-serif">Set in a web font</p></div></x-dc>`;
  const file = path.join(root, BOARD);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
}
// The artboard's frame loaded the block font (so a picture without it lost it on the way).
const WEB_FONT_LOADED = `[...(document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.fonts ?? [])].some(face => face.family.replace(/["']/g, '') === 'Block' && face.status === 'loaded')`;
// Whether a pixel is nearly a colour (JPEG moves it a little).
const near = (pixel, colour) => pixel.every((value, i) => Math.abs(value - colour[i]) <= 24);
// Pixels of a picture (a `source` expression for an image: a URL in quotes, or an element), at points given at 1×.
const pixelsOf = (page, source, points, scale = 1) => page.evaluate(`(async () => {
  let image = ${source};
  if (typeof image === 'string') { const url = image; image = new Image(); image.src = url; }
  await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const g = canvas.getContext('2d'); g.drawImage(image, 0, 0);
  return { width: canvas.width, height: canvas.height, pixels: ${JSON.stringify(points)}.map(([x, y]) => [...g.getImageData(x * ${scale}, y * ${scale}, 1, 1).data].slice(0, 3)) };
})()`);
// The first page of an exported PDF: its picture is stored as the JPEG it was drawn as.
function pdfPagePicture(file) {
  const pdf = fs.readFileSync(file);
  const at = pdf.indexOf('/DCTDecode');
  assert.ok(at > 0, 'the PDF holds no JPEG page');
  const length = Number(/\/Length (\d+)/.exec(pdf.subarray(at, at + 200).toString('latin1'))?.[1]);
  const start = pdf.indexOf('stream\n', at) + 'stream\n'.length;
  return `'data:image/jpeg;base64,${pdf.subarray(start, start + length).toString('base64')}'`;
}

async function shellExport(page, label) {
  await clickOn(page, buttonNamed('Share'));
  assert.ok(await page.waitFor("document.querySelector('[data-share-link=viewer]')"), 'global Share panel has role links');
  await clickOn(page, buttonNamed('Export'));
  const row = `document.querySelector('[data-export-row="' + ${JSON.stringify(label)} + '"]:not(:disabled)')`;
  assert.ok(await page.waitFor(row), label);
  await page.evaluate(`(${row}).scrollIntoView({block: 'center'})`);
  await clickOn(page, row, label);
}

async function postShellComment(shell, root) {
  assert.ok(await shell.waitFor("document.querySelector('[data-comments-button]')"));
  await clickOn(shell, buttonNamed('Comments'));
  assert.ok(await shell.waitFor("document.querySelector('[data-comment-capture]')"));
  const point = await shell.evaluate(`(() => {
    const r = document.querySelector('iframe').getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  })()`);
  await shell.click(...point);
  assert.ok(await shell.waitFor("document.activeElement?.shadowRoot?.activeElement?.matches('textarea')"));
  await shell.type('Frame shell review');
  await shell.press('Enter');
  const file = path.join(root, 'comments.json');
  assert.ok(await until(() => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('Frame shell review')), 'anchored comment saved');
  await clickOn(shell, buttonNamed('Comment options'));
  await clickOn(shell, "[...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.includes('Show all comments'))");
  assert.ok(await shell.waitFor("document.querySelector('[data-comments-panel-layer]')?.shadowRoot?.querySelector('[data-comments-panel]')?.innerText.includes('Frame shell review')"));
}

editorSuite({
  type: 'design',
  make: (ctx, root) => copyFixture('design', root),
  broken: (ctx, root) => {
    copyFixture('design', root);
    const board = path.join(root, BOARD);
    fs.writeFileSync(board, fs.readFileSync(board, 'utf8').replace('<script src="./support.js"></script>\n', ''));
  },
  pageText: 'Smoke canvas',
  save: { file: BOARD, edit: text => text.replace('An artboard the smoke test opens.', 'An artboard the page saved.') },
  diskEdit: {
    apply: ctx => {
      const board = path.join(ctx.root, BOARD);
      fs.writeFileSync(board, fs.readFileSync(board, 'utf8').replace('>Smoke canvas</h1>', '>Edited on disk</h1>'));
    },
    text: 'Edited on disk',
  },

  offline(ctx) {
    it('check names the support.js line a board leaves out', T, async () => {
      const bad = path.join(tmpDir('design-nosupport'), 'artifact');
      ctx.spec.broken(ctx, bad);
      const out = await ctx.cli.run(['check', bad, '--json']);
      assert.equal(out.code, 1);
      const error = out.json.findings.find(f => f.level === 'error' && f.file === 'Main.dc.html');
      assert.ok(error, out.stdout);
      assert.match(error.message, /<script src="\.\/support\.js"><\/script>/);
    });

    it('check flags a board that canvas.json does not place', T, async () => {
      const root = path.join(tmpDir('design-unplaced'), 'artifact');
      copyFixture('design', root);
      fs.copyFileSync(path.join(root, BOARD), path.join(root, 'project', 'Loose.dc.html'));
      const out = await ctx.cli.run(['check', root, '--json']);
      assert.equal(out.code, 1, out.stdout);
      assert.ok(out.json.findings.some(f => f.level === 'error' && /Loose\.dc\.html/.test(`${f.file} ${f.message}`)), out.stdout);
    });

    it('list finds the design systems under the folders given, and none where there are none', T, async () => {
      const shelf = tmpDir('design-shelf');
      copyFixture('design-system', path.join(shelf, 'Smoke System'));
      const found = await ctx.cli.json(['list', shelf]);
      assert.equal(found.systems.length, 1, JSON.stringify(found));
      const [system] = found.systems;
      assert.equal(system.title, 'Smoke System');
      assert.equal(system.namespace, 'SmokeSystem');
      assert.equal(system.root, path.join(shelf, 'Smoke System'));
      const none = await ctx.cli.json(['list', tmpDir('design-noshelf')]);
      assert.deepEqual(none.systems, []);
    });
  },

  chrome(ctx) {
    for (const renderer of ['default', 'dom']) {
      it(`link cards and prototype navigation in the ${renderer} canvas`, T, async () => {
        const { root, url } = await ctx.openNew('prototype', (_ctx, root) => {
          copyFixture('design', root);
          const canvas = canvasOf(root);
          const entry = canvas.boards['Main.dc.html'];
          Object.assign(entry, { is_interactive: true, guides: [{ kind: 'columns', count: 3 }, { kind: 'rows', hidden: true }] });
          canvas.boards['Next.dc.html'] = { ...entry, title: 'Next', x: 960, guides: [] };
          canvas.order.push('Next.dc.html');
          canvas.notes.deck = { x: 0, y: 660, kind: 'link', title: 'Menu deck', href: 'https://example.com/menu' };
          fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(canvas));
          const source = fs.readFileSync(path.join(root, BOARD), 'utf8');
          fs.writeFileSync(path.join(root, BOARD), source.replace('</p>', '</p><a href="Next.dc.html">Continue</a>'));
          fs.writeFileSync(path.join(root, 'project/Next.dc.html'), source.replace('>Smoke canvas</h1>', '>Next screen</h1><a href="#end">Jump down</a><div style="height:1500px"></div><p id="end">End</p>'));
        });
        const browser = await ctx.browser();
        const address = new URL('index.html', url);
        if (renderer === 'dom') address.searchParams.set('open_artifact_engine', 'off');
        const page = await browser.load(address.href, { ready: textIn('Smoke canvas') });
        try {
          assert.ok(await page.waitFor(textIn('Menu deck')));
          assert.equal(await page.evaluate("document.querySelectorAll('[data-layout-guide]').length"), 1);
          const clickTitle = name => page.evaluate(`document.querySelector('[data-board-title="Main.dc.html"] button[aria-label="${name}"]').click()`);
          await clickTitle('Play on canvas');
          assert.ok(await page.waitFor(`document.querySelector('[aria-label="Stop playing"]') && !document.querySelector('[data-layout-guide]')`));
          const at = await page.evaluate(`(() => {
            const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
            const rect = frame.getBoundingClientRect();
            const link = frame.contentDocument.querySelector('a[href="Next.dc.html"]').getBoundingClientRect();
            const zoom = rect.width / frame.offsetWidth;
            return { x: rect.left + (link.left + 10) * zoom, y: rect.top + (link.top + link.height / 2) * zoom };
          })()`);
          await page.click(at.x, at.y);
          assert.ok(await page.waitFor(`document.querySelector('[data-board-title="Next.dc.html"] button[aria-label="Stop playing"]')`));
          await clickOn(page, buttonNamed('Stop playing'));
          assert.ok(await page.waitFor(`document.querySelector('[data-layout-guide="columns"]')`));
          await clickTitle('Tweaks');
          await clickOn(page, buttonNamed('Properties'));
          await clickOn(page, buttonNamed('Hide guide'));
          assert.ok(await until(() => canvasOf(root).boards['Main.dc.html'].guides[0].hidden, 10000));
          await page.evaluate(`(${buttonNamed('Add guide')}).scrollIntoView({ block: 'center' })`);
          await clickOn(page, buttonNamed('Add guide'));
          assert.ok(await until(() => canvasOf(root).boards['Main.dc.html'].guides.length === 3, 10000));
          await clickOn(page, buttonNamed('Close panel'));
          if (renderer === 'dom') return;
          assert.equal(await page.evaluate(`document.querySelector('[aria-label="Export"],[aria-label="Export canvas"],[aria-label="Comment"]') !== null`), false);
          await withDesignShell(ctx, root, textIn('Menu deck'), async shell => {
            const dir = ctx.downloads;
            await shellExport(shell, 'HTML · Standalone web page (all artboards on this page)');
            const file = path.join(dir, 'Smoke canvas.html');
            assert.ok(await until(() => fs.existsSync(file), 30000), 'the standalone export was not saved');
            const server = createServer((_req, res) => {
              res.setHeader('content-type', 'text/html');
              fs.createReadStream(file).pipe(res);
            });
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            try {
              for (const address of [pathToFileURL(file).href, `http://127.0.0.1:${server.address().port}/design.html`]) {
                const exported = await browser.load(address, { ready: textIn('Next screen') });
                try {
                  assert.equal(await exported.evaluate("document.querySelectorAll('iframe').length"), 2);
                  await exported.evaluateAll(`document.querySelector('a[href="Next.dc.html"]')?.click()`);
                  assert.ok(await exported.waitFor(`document.querySelector('iframe')?.srcdoc.includes('Jump down')`));
                  await exported.evaluateAll(`document.querySelector('a[href="#end"]')?.click()`);
                  assert.ok(await exported.waitFor('document.scrollingElement.scrollTop > 100'));
                  assert.deepEqual(exported.problems, []);
                } finally { await exported.close(); }
              }
            } finally { await new Promise(resolve => server.close(resolve)); }
            await shellExport(shell, 'HTML · All artboards on this page for Figma');
            const figma = path.join(dir, 'Smoke canvas.figma.html');
            assert.ok(await until(() => fs.existsSync(figma), 30000));
            const flat = fs.readFileSync(figma, 'utf8');
            assert.equal((flat.match(/<section class="artboard"/g) ?? []).length, 2);
            assert.doesNotMatch(flat, /<iframe|<script|data-layout-guide/i);
            assert.match(flat, /Next screen/);
            await postShellComment(shell, root);
          });
          assert.deepEqual(page.problems, []);
        } finally { await page.close(); }
      });
    }

    it('the CLI opens the global shell and copies a link to the selected design page', T, async () => {
      const { url } = await ctx.openNew('design-page-share', (_ctx, root) => {
        copyFixture('design', root);
        const index = canvasOf(root);
        index.pages = [{ id: 'first', name: 'First page' }, { id: 'review', name: 'Review page' }];
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
      });
      const browser = await ctx.browser();
      const pageButton = 'button[aria-label^="Pages:"]';
      const onPage = name => `document.querySelector('${pageButton}')?.innerText.includes(${JSON.stringify(name)})`;
      const shell = await browser.load(url + '#page=review', { ready: onPage('Review page') });
      try {
        assert.ok(await shell.waitFor(onPage('Review page')), 'opened the linked page');
        const clickEditorButton = async expression => {
          const point = await shell.evaluate(`(() => {
            const frame = document.querySelector('iframe[name="open-artifact-shell"]');
            const doc = frame.contentDocument;
            const button = ${expression};
            const bounds = button.getBoundingClientRect();
            const offset = frame.getBoundingClientRect();
            return [bounds.x + offset.x + bounds.width / 2, bounds.y + offset.y + bounds.height / 2];
          })()`);
          await shell.click(...point);
        };
        await clickEditorButton(`doc.querySelector('${pageButton}')`);
        const first = `[...doc.querySelectorAll('button')].find(el => el.textContent.trim() === 'First page')`;
        assert.ok(await shell.waitFor(buttonNamed('First page')));
        await clickEditorButton(first);
        assert.ok(await shell.waitFor("window === top && location.hash === '#page=first'"));
        await shell.cdp('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
        await clickOn(shell, buttonNamed('Share'));
        await clickOn(shell, buttonNamed('Copy link'));
        assert.ok(await shell.waitFor(buttonNamed('Copied')));
        const link = await shell.evaluate('navigator.clipboard.readText()');
        assert.equal(link, url + '#page=first');
        const reopened = await browser.load(link, { ready: onPage('First page') });
        try {
          assert.ok(await reopened.waitFor(onPage('First page')));
          assert.ok(await reopened.evaluate("Boolean(document.querySelector('header [data-comments-button]'))"));
        } finally { await reopened.close(); }
      } finally { await shell.close(); }
    });

    it('readable links open an artboard on its page, or run it, and settle on the page link', T, async () => {
      const { url } = await ctx.openNew('design-place-links', (_ctx, root) => {
        copyFixture('design', root);
        const index = canvasOf(root);
        index.pages = [{ id: 'first', name: 'First page' }, { id: 'review', name: 'Review page' }];
        index.boards['Main.dc.html'].page = 'review';
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
      });
      const browser = await ctx.browser();
      const onPage = name => `document.querySelector('button[aria-label^="Pages:"]')?.innerText.includes(${JSON.stringify(name)})`;
      const shell = await browser.load(url + '#artboard-main', { ready: onPage('Review page') });
      try {
        assert.ok(await shell.waitFor(onPage('Review page')), 'opened the artboard\'s page');
        assert.ok(await shell.waitFor("window === top && location.hash === '#page=review'"), 'the address names the page');
        assert.ok(await shell.waitFor(`document.querySelector('[data-board-title="Main.dc.html"] .text-accent')`), 'the artboard is selected');
        assert.deepEqual(shell.problems, []);
      } finally { await shell.close(); }
      const playing = await browser.load(url + '#play-main-dc-html', { ready: onPage('Review page') });
      try {
        assert.ok(await playing.waitFor(buttonNamed('Stop playing')), 'the artboard runs on the canvas');
      } finally { await playing.close(); }
      const unknown = await browser.load(url + '#artboard-nowhere', { ready: onPage('First page') });
      try {
        assert.ok(await unknown.waitFor(onPage('First page')), 'an unknown name opens the canvas as usual');
      } finally { await unknown.close(); }
    });

    it('guest links open the global comment controls with the guest role', T, async () => {
      const root = tmpDir('design-guest-frame');
      copyFixture('design', root);
      const index = canvasOf(root);
      index.pages = [{ id: 'first', name: 'First page' }, { id: 'review', name: 'Review page' }];
      fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
      const server = createTypeServer({ assetsDir: path.join(ctx.typeDir, 'scripts'), idleMs: 0, secret: 'test-owner',
        lanAddresses: () => [], isLocal: req => req.headers['x-test-owner'] === 'yes' });
      await server.listen();
      try {
        const opened = await server.open({ root, type: 'design' });
        const response = await fetch(new URL('/__open-artifact/share', opened.url), { method: 'POST',
          headers: { authorization: 'Bearer test-owner', 'content-type': 'application/json', 'x-test-owner': 'yes' },
          body: JSON.stringify({ id: opened.id, lan: true }) });
        assert.equal(response.status, 200);
        const { links } = await response.json();
        for (const role of ['commenter', 'viewer']) {
          const page = await (await ctx.browser()).load(links[role].url + '#page=review', { ready: "document.querySelector('input[name=name]')" });
          try {
            await typeInto(page, "document.querySelector('input[name=name]')", role);
            await page.press('Enter');
            assert.ok(await page.waitFor("document.querySelector('header [data-comments-button]')"));
            assert.ok(await page.waitFor("document.querySelector('button[aria-label^=Pages]')?.innerText.includes('Review page')"), 'invite retains the page through sign-in');
            await clickOn(page, buttonNamed('Share'));
            assert.ok(await page.waitFor(buttonNamed('Copy link')));
            assert.equal(await page.evaluate("Boolean(document.querySelector('[data-share-link=viewer]'))"), false);
            assert.equal(await page.evaluate(`Boolean(${buttonNamed('Export')})`), false);
            await page.press('Escape');
            if (role === 'commenter') await postShellComment(page, root);
            else {
              await clickOn(page, buttonNamed('Comments'));
              assert.ok(await page.waitFor("document.querySelector('[data-comments-panel-layer]')?.shadowRoot?.querySelector('[data-comments-panel]')?.innerText.includes('Frame shell review')"));
            }
          } finally { await page.close(); }
        }
      } finally { await server.stop(); }
    });

    it('a served board in a nested export folder follows a prototype link up one level', T, async () => {
      const source = fs.readFileSync(path.join(fixtures, 'design', BOARD), 'utf8');
      const runtime = fs.readFileSync(path.join(ctx.typeDir, 'scripts/support.js'));
      const server = createServer((req, res) => {
        const url = req.url;
        if (url === '/site/flow/support.js' || url === '/site/support.js') {
          res.setHeader('content-type', 'text/javascript');
          return res.end(runtime);
        }
        res.setHeader('content-type', 'text/html');
        if (url === '/site/flow/Start.dc.html') return res.end(source.replace('</p>', '</p><a href="../End.dc.html">Go up</a>'));
        if (url === '/site/End.dc.html') return res.end(source.replace('>Smoke canvas</h1>', '>End screen</h1>'));
        res.writeHead(404); res.end();
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const page = await (await ctx.browser()).load(`http://127.0.0.1:${server.address().port}/site/flow/Start.dc.html`, { ready: "document.querySelector('a[href]')" });
        try {
          await page.evaluate('document.querySelector("a[href]").click()');
          assert.ok(await page.waitFor("location.pathname === '/site/End.dc.html' && document.querySelector('h1')?.textContent === 'End screen'"));
        } finally { await page.close(); }
      } finally { await new Promise(resolve => server.close(resolve)); }
    });

    it('PNG and Figma exports preserve SVG use colours, CSS masks and label positions', T, async () => {
      const { root } = await ctx.openNew('design-icon-export', (_ctx, root) => {
        copyFixture('design', root);
        const index = canvasOf(root);
        index.launch = { view: 'focused', file: 'Main.dc.html' };
        Object.assign(index.boards['Main.dc.html'], { title: 'Icon samples', w: 180, h: 60 });
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 40 40"><path fill-rule="evenodd" d="M0 0h40v40H0z M10 10v20h20V10z"/></svg>';
        const id = 'abcdeabcdeabcdeabcdeabcdeabcde12';
        fs.mkdirSync(path.join(root, 'project/assets'));
        fs.writeFileSync(path.join(root, 'project/assets', id + '.svg'), svg);
        const file = path.join(root, BOARD);
        const template = `<x-dc><helmet><style>
          body{margin:0}.icon{position:absolute;top:0;width:40px;height:40px}
          .outline{fill:none;stroke:currentColor;stroke-width:4}.disc path{fill:currentColor}
          .mask,.pseudo::before{background:#1674c8;mask:url("/_blob/${id}") center / contain no-repeat}
          .pseudo::before{content:"";position:absolute;inset:0}
        </style></helmet><div style="width:180px;height:60px;background:#fff7d6;color:#333;position:relative">
          <svg class="icon" viewBox="0 0 40 40"><defs><symbol id="outline" class="outline"><rect x="4" y="4" width="32" height="32"/></symbol></defs><use href="#outline" style="color:#c81432"/></svg>
          <div class="icon mask" style="left:40px"></div><div class="icon pseudo" style="left:80px"></div>
          <svg class="icon" style="left:120px" viewBox="0 0 40 40"><defs><symbol id="disc" class="disc"><path d="M0 0h40v40H0z"/></symbol></defs><use href="#disc" style="color:#1e8c3c"/></svg>
          <span id="caption" style="position:absolute;left:6px;top:40px">Icon labels</span></div></x-dc>`;
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
      });
      const browser = await ctx.browser();
      await withDesignShell(ctx, root, textIn('Icon labels'), async page => {
        const download = async (label, name) => {
          await shellExport(page, label);
          const file = path.join(ctx.downloads, name);
          assert.ok(await until(() => fs.existsSync(file), 30000), name);
          return file;
        };
        const file = await download('PNG · Selected artboard, 1×', 'Icon samples.png');
        const png = fs.readFileSync(file).toString('base64');
        const pixels = await page.evaluate(`(async () => {
          const image = new Image(); image.src = 'data:image/png;base64,${png}'; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const g = canvas.getContext('2d'); g.drawImage(image, 0, 0);
          return [4,20,45,60,85,100,140].map(x => [...g.getImageData(x,20,1,1).data].slice(0,3));
        })()`);
        const paper = [255,247,214], blue = [22,116,200];
        assert.deepEqual(pixels, [[200,20,50], paper, blue, paper, blue, paper, [30,140,60]]);
        await page.evaluateAll(`(${buttonNamed('Fill')})?.click()`);
        assert.ok(await page.waitFor(buttonNamed('Preview width')));
        const [width] = (await page.evaluateAll(`parseInt((${buttonNamed('Preview width')})?.textContent)`)).filter(Number.isFinite);
        assert.ok(width > 180);
        const preview = await download(`PNG · Preview width (${width} px), 2×`, `Icon samples ${width}w@2x.png`);
        assert.equal(fs.readFileSync(preview).readUInt32BE(16), 2 * width, 'PNG matches the focused viewport at 2×');
        const flat = await download('HTML · Selected artboard as one page for Figma’s capture extension', 'Icon samples.figma.html');
        assert.doesNotMatch(fs.readFileSync(flat, 'utf8'), /<iframe|<script|\/_blob\//i);
        const capture = await browser.load(pathToFileURL(flat).href, { ready: "document.querySelector('#caption')" });
        try {
          const state = await capture.evaluate(`(async () => {
            const section = document.querySelector('section.artboard'), r = section.getBoundingClientRect();
            const label = document.querySelector('#caption').getBoundingClientRect();
            const symbols = [...section.querySelectorAll('use')].map(use => document.querySelector(use.getAttribute('href')));
            const masks = [...section.querySelectorAll('div,span')].map(el => getComputedStyle(el).maskImage).filter(mask => mask.startsWith('url('));
            const sizes = await Promise.all(masks.map(async mask => {
              const url = mask.slice(5, -2);
              const svg = new DOMParser().parseFromString(await (await fetch(url)).text(), 'image/svg+xml').documentElement;
              return [svg.getAttribute('width'), svg.getAttribute('height'), svg.getAttribute('viewBox')];
            }));
            return { label: [label.x-r.x, label.y-r.y], stroke: symbols[0].style.stroke, fill: symbols[1].querySelector('path').style.fill, sizes };
          })()`);
          assert.deepEqual(state, {
            label: [6, 40], stroke: 'rgb(200, 20, 50)', fill: 'rgb(30, 140, 60)',
            sizes: [['40', '40', '0 0 40 40'], ['40', '40', '0 0 40 40']],
          });
        } finally { await capture.close(); }
      });
    });
    
    it('PNG and PDF exports draw an artboard in its web font', T, async () => {
      const browser = await ctx.browser();
      fs.mkdirSync(ctx.downloads, { recursive: true });
      await browser.downloadsTo(ctx.downloads);
      const menuItem = text => `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.trim().endsWith(${JSON.stringify(text)}) && item.getAttribute('aria-disabled') !== 'true')`;
      // Inside the bar at both ends, and the paper under it.
      const points = [[30, 26], [170, 26], [30, 80]];
      const exported = async (page, item, name) => {
        const file = path.join(ctx.downloads, name);
        fs.rmSync(file, { force: true });
        await clickOn(page, buttonNamed('Export'));
        assert.ok(await page.waitFor(menuItem(item)), `the Export menu lists ${item}`);
        await clickOn(page, menuItem(item), item);
        assert.ok(await until(() => fs.existsSync(file) && fs.statSync(file).size > 0, 30000), `${name} was not saved: ${fs.readdirSync(ctx.downloads)}`);
        return file;
      };
      const focus = async url => {
        const page = await browser.load(new URL('index.html', url).href, { ready: `document.querySelector('[data-board-title="Main.dc.html"]')`, settle: 800 });
        assert.ok(await page.waitFor(WEB_FONT_LOADED, 20000), 'the artboard loaded its web font');
        await clickOn(page, `document.querySelector('[data-board-title="Main.dc.html"] button[aria-label="Focus"], [data-board-title="Main.dc.html"] button[aria-label="Play full screen"]')`, 'Focus');
        assert.ok(await page.waitFor(buttonNamed('Back to canvas')), 'the focused view opened');
        return page;
      };

      const { url } = await ctx.openNew('web-font-export', (_ctx, root) => webFontBoard(root));
      const page = await focus(url);
      try {
        const png = await exported(page, 'Selected artboard, 1×', 'Web font.png');
        const image = await pixelsOf(page, `'data:image/png;base64,${fs.readFileSync(png).toString('base64')}'`, points);
        assert.deepEqual(image, { width: 880, height: 560, pixels: [INK, INK, PAPER] }, 'the PNG lost the web font');
        // A PDF page is the artboard at 2×.
        const pdf = await pixelsOf(page, pdfPagePicture(await exported(page, 'Selected artboard', 'Web font.pdf')), points, 2);
        assert.equal(pdf.width, 1760);
        assert.ok(near(pdf.pixels[0], INK) && near(pdf.pixels[1], INK) && near(pdf.pixels[2], PAPER), `the PDF lost the web font: ${JSON.stringify(pdf.pixels)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }

      // A Flow artboard is cut into paper pages, each rebuilt as SVG shapes: those carry the font too.
      const flow = await ctx.openNew('web-font-flow', (_ctx, root) => webFontBoard(root, { print: 'flow', paper: 'letter' }));
      const paged = await focus(flow.url);
      try {
        const pdf = await pixelsOf(paged, pdfPagePicture(await exported(paged, 'Selected artboard', 'Web font.pdf')), points, 2);
        assert.ok(near(pdf.pixels[0], INK) && near(pdf.pixels[1], INK) && near(pdf.pixels[2], PAPER), `the paged PDF lost the web font: ${JSON.stringify(pdf.pixels)}`);
        assert.deepEqual(paged.problems, []);
      } finally { await paged.close(); }
    });

    it('zoomed out, an artboard shows a sharp snapshot in its web font, and keeps its frame for zooming back in', T, async () => {
      const { url } = await ctx.openNew('web-font-snapshot', (_ctx, root) => webFontBoard(root));
      // The DOM canvas shows a snapshot as an image the test can read (the engine draws it into its own canvas).
      const page = await (await ctx.browser()).load(new URL('index.html?open_artifact_engine=off', url).href, { ready: 'window.__openArtifactLive', settle: 0 });
      const live = expression => `(live => ${expression})(window.__openArtifactLive())`;
      const frame = `document.querySelector('iframe[data-board="Main.dc.html"]')`;
      const snapshot = `document.querySelector('[data-board="Main.dc.html"] img[data-board-snapshot]')`;
      const zoomUntil = async (deltaY, done) => {
        for (let i = 0; i < 120 && !(await page.evaluate(live(done))); i++) await page.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY, modifiers: 2 });
        assert.ok(await page.evaluate(live(done)), `the canvas did not zoom: ${JSON.stringify(await page.evaluate(live('live.camera')))}`);
      };
      try {
        assert.ok(await page.waitFor(WEB_FONT_LOADED, 20000), 'the artboard loaded its web font');
        assert.ok(await page.waitFor(live('live.snapshots === 1 && live.live.length === 1 && live.resting.length === 0'), 20000), 'the live artboard got its snapshot');
        const booted = await page.evaluate(`${frame}.contentWindow.performance.timeOrigin`);

        // Below 30 % the snapshot stands for the artboard; its frame rests behind it.
        await zoomUntil(12, 'live.camera.zoom < 0.25');
        assert.ok(await page.waitFor(`${live('live.resting.length === 1')} && ${snapshot}?.complete`, 10000), 'the artboard did not go to its snapshot');
        assert.equal(await page.evaluate(`getComputedStyle(${frame}).visibility`), 'hidden', 'the resting frame is hidden');
        // At the artboard's own size (880 × 560 is small enough), in the web font.
        assert.deepEqual((await pixelsOf(page, snapshot, [[30, 26], [170, 26], [30, 80]])).width, 880);
        const { pixels } = await pixelsOf(page, snapshot, [[30, 26], [170, 26], [30, 80]]);
        assert.ok(near(pixels[0], INK) && near(pixels[1], INK) && near(pixels[2], PAPER), `the snapshot lost the web font: ${JSON.stringify(pixels)}`);

        // Back in: the same frame shows again, nothing loaded a second time.
        await zoomUntil(-12, 'live.camera.zoom > 0.4');
        assert.ok(await page.waitFor(`${live('live.resting.length === 0 && live.live.length === 1')} && !${snapshot}`, 10000), 'the frame did not take over again');
        assert.equal(await page.evaluate(`getComputedStyle(${frame}).visibility`), 'visible');
        assert.equal(await page.evaluate(`${frame}.contentWindow.performance.timeOrigin`), booted, 'the artboard booted again');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('zoomed out, an artboard set in a big CJK web font shows its snapshot in a subset of the font', T, async () => {
      const { url } = await ctx.openNew('web-font-subset', (_ctx, root) => webFontBoard(root, {}, { han: true }));
      const page = await (await ctx.browser()).load(new URL('index.html?open_artifact_engine=off', url).href, { ready: 'window.__openArtifactLive', settle: 0 });
      const live = expression => `(live => ${expression})(window.__openArtifactLive())`;
      const snapshot = `document.querySelector('[data-board="Main.dc.html"] img[data-board-snapshot]')`;
      try {
        assert.ok(await page.waitFor(WEB_FONT_LOADED, 20000), 'the artboard loaded its web font');
        assert.ok(await page.waitFor(live('live.snapshots === 1'), 20000), 'the artboard got its snapshot');
        for (let i = 0; i < 120 && !(await page.evaluate(live('live.camera.zoom < 0.25'))); i++) await page.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: 12, modifiers: 2 });
        assert.ok(await page.waitFor(`${live('live.resting.length === 1')} && ${snapshot}?.complete`, 10000), 'the artboard did not go to its snapshot');
        // The ideographs of the bar are in the subset: a solid bar, as on the page.
        const { pixels } = await pixelsOf(page, snapshot, [[30, 26], [170, 26], [30, 80]]);
        assert.ok(near(pixels[0], INK) && near(pixels[1], INK) && near(pixels[2], PAPER), `the snapshot lost the web font: ${JSON.stringify(pixels)}`);
        const fonts = await page.evaluate(live('live.fonts'));
        assert.ok(fonts.subsets >= 1, `the font was not inlined as a subset: ${JSON.stringify(fonts)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('pastes foreign artboards with their display names and connected imports', T, async () => {
      const { root, url } = await ctx.openNew('paste-artboards');
      const original = fs.readFileSync(path.join(root, BOARD), 'utf8');
      const wrap = original.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '<dc-import name="Hero 2"></dc-import>');
      const boards = [{ stem: 'Hero 2', src: original, dx: 0 }, { stem: 'Wrap', src: wrap, dx: 960 }].map(b => ({ ...b, dy: 0, w: 880, h: 560 }));
      const encoded = Buffer.from(JSON.stringify({ appifact: 1, kind: 'design-artboards', data: { artboards: boards } })).toString('base64');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas') });
      try {
        await page.evaluate(`(() => { const data = new DataTransfer(); data.setData('text/html', '<span data-appifact-object="${encoded}">Boards</span>'); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data })); })()`);
        await clickOn(page, buttonNamed('Paste with code'));
        assert.ok(await until(() => canvasOf(root).boards['Wrap.dc.html'], 10000));
        assert.equal(canvasOf(root).boards['Hero-2.dc.html'].title, 'Hero 2');
        assert.match(fs.readFileSync(path.join(root, 'project/Wrap.dc.html'), 'utf8'), /<dc-import name="Hero-2">/);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('Send to agent: the composer’s request reaches wait', T, async () => {
      const page = ctx.page();
      assert.ok(page, 'the page did not open');
      const w = await startWait(ctx, ctx.root, 60);
      try {
        await clickOn(page, `[...document.querySelectorAll('button')].find(b => /^Ask /.test(b.textContent.trim()))`, 'the Ask button');
        const area = `document.querySelector('textarea[placeholder^="Describe the change"]')`;
        assert.ok(await page.waitFor(area, 10000), 'the composer did not open, or does not see the waiting agent');
        await typeInto(page, area, 'Make the heading terracotta.');
        await clickOn(page, buttonNamed('Send'));
        const { code, stdout } = await w.done;
        assert.equal(code, 0, stdout);
        assert.match(stdout, /^\[Artifact edit request sent to agent\] /m);
        assert.match(stdout, /^Make the heading terracotta\.$/m);
        assert.ok(await page.waitFor(`!(${area})`, 5000), 'the composer stayed open after sending');
      } finally {
        w.child.kill('SIGTERM');
      }
    });

    const throwing = (ctx_, root) => {
      copyFixture('design', root);
      const board = path.join(root, BOARD);
      fs.writeFileSync(board, fs.readFileSync(board, 'utf8').replace("return { accent: this.props.accent ?? '#666666' };", "throw new Error('e2e board error');"));
    };

    it('a board that throws shows its error, and "Ask agent to fix" sends it', { timeout: 120000 }, async () => {
      const { root, url } = await ctx.openNew('throwing', throwing);
      const w = await startWait(ctx, root, 90);
      // A board that throws draws nothing: the page is ready once it shows the board's error.
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Ask agent to fix'), settle: 1000, ignore: [/e2e board error/] });
      try {
        assert.ok(await page.waitFor(textIn('Ask agent to fix'), 1000), 'the board shows no error, or no "Ask agent to fix"');
        await clickOn(page, buttonNamed('Ask agent to fix'));
        const { code, stdout } = await w.done;
        assert.equal(code, 0, stdout);
        assert.match(stdout, /^\[Artifact edit request sent to agent\] Ask agent to fix$/m);
        assert.match(stdout, /Fix the errors in Main\.dc\.html\./);
        assert.match(stdout, /e2e board error/);
        assert.deepEqual(page.problems, []);
      } finally {
        w.child.kill('SIGTERM');
        await page.close();
      }
    });

    it('"1 error" lists the artboards with errors and asks for all of them; a closed notice leaves a mark that brings it back', { timeout: 120000 }, async () => {
      const { root, url } = await ctx.openNew('throwing-list', throwing);
      const notice = `document.querySelector('[data-error-notice="Main.dc.html"]')`;
      const mark = `document.querySelector('[data-error-mark="Main.dc.html"]')`;
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `Boolean(${notice})`, settle: 1000, ignore: [/e2e board error/] });
      let w = null;
      try {
        // The notice under the artboard, and the count at the top right.
        assert.match(await page.evaluate(`${notice}.textContent`), /1 error/);
        assert.ok(await page.evaluate(`Boolean(${buttonNamed('1 error on 1 artboard')})`), 'no "1 error" at the top right');

        // Closing the notice leaves a mark in the artboard's name strip; the mark brings it back.
        await clickOn(page, buttonNamed('Dismiss error notice on artboard Main'));
        assert.ok(await page.waitFor(`!${notice} && Boolean(${mark})`, 5000), 'the notice did not close into a mark');
        await clickOn(page, mark);
        assert.ok(await page.waitFor(`Boolean(${notice}) && !${mark}`, 5000), 'the mark did not bring the notice back');

        // The list names the artboard and its message, and asks for all of them.
        await clickOn(page, buttonNamed('1 error on 1 artboard'));
        assert.ok(await page.waitFor(`${textIn('Artboards with errors')} && [...document.querySelectorAll('[role="menu"]')].some(m => m.textContent.includes('e2e board error'))`, 5000), 'the list shows no error');
        w = await startWait(ctx, root, 90);
        await clickOn(page, `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(b => b.textContent.trim() === 'Ask agent to fix')`, 'the list\'s "Ask agent to fix"');
        const { code, stdout } = await w.done;
        assert.equal(code, 0, stdout);
        assert.match(stdout, /^\[Artifact edit request sent to agent\] Ask agent to fix$/m);
        assert.match(stdout, /Fix the errors in Main\.dc\.html\./);
        assert.match(stdout, /\[\w+\] e2e board error/, 'each message goes with its kind in brackets');
        assert.deepEqual(page.problems, []);
      } finally {
        w?.child.kill('SIGTERM');
        await page.close();
      }
    });

    it('a pasted image becomes an image note, uploaded and saved in canvas.json', T, async () => {
      const { root, url } = await ctx.openNew('paste');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        const bytes = [...png([1, 2, 3])];
        await page.evaluate(`(() => {
          const dt = new DataTransfer();
          dt.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})], 'pasted.png', { type: 'image/png' }));
          document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        })()`);
        let note;
        assert.ok(
          await until(() => (note = Object.values(canvasOf(root).notes).find(n => n.kind === 'image' || n.type === 'image' || n.src)), 15000),
          `no image note in canvas.json: ${JSON.stringify(canvasOf(root).notes)}`,
        );
        assert.match(note.src, /^\/_blob\/[0-9a-f]{32}$/, JSON.stringify(note));
        const served = await fetch(new URL(note.src, url));
        assert.equal(served.status, 200);
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('pastes a clipboard image at the clicked point inside an artboard', T, async () => {
      const { root, url } = await ctx.openNew('board-image-paste');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas') });
      try {
        await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          read: async () => [{ types: ['image/png'], getType: async () => new Blob([new Uint8Array(${JSON.stringify([...png([4, 5, 6])])})], {type:'image/png'}) }]
        } })`);
        const at = await page.evaluate(`(() => {
          const rect = document.querySelector('iframe[data-board="Main.dc.html"]').getBoundingClientRect();
          return { x: rect.x + rect.width * 0.4, y: rect.y + rect.height * 0.5 };
        })()`);
        await page.rightClick(at.x, at.y);
        await clickOn(page, `[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim().startsWith('Paste⌘V'))`);
        assert.ok(await until(() => /<img src="\/_blob\//.test(fs.readFileSync(path.join(root, BOARD), 'utf8')), 10000));
        assert.equal(Object.keys(canvasOf(root).notes).length, 0);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('property fields: font search, Enter keeps focus, ⌘Z undoes; a linked element shows its link; menus fit a short window', T, async () => {
      const { root, url } = await ctx.openNew('fields', (_ctx, root) => {
        copyFixture('design', root);
        const board = path.join(root, BOARD);
        fs.writeFileSync(board, fs.readFileSync(board, 'utf8').replace('</p>', '</p><a href="https://example.com/docs?ref=1" style="font-size: 24px">Read the docs</a>'));
      });
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const pointAt = selector => page.evaluate(`(() => {
        const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
        const rect = frame.getBoundingClientRect();
        const box = frame.contentDocument.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        const zoom = rect.width / frame.offsetWidth;
        return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
      })()`);
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      try {
        // A linked element shows a card with its address; an unlinked one shows none.
        await page.hover(...await pointAt('a'));
        assert.ok(await page.waitFor(`document.querySelector('[data-hover-link]')?.innerText.includes('example.com/docs')`), 'the link card shows');
        assert.ok(await page.evaluate(`!!document.querySelector('[data-hover-link] [aria-label="Open https://example.com/docs?ref=1"]')`));
        await page.hover(...await pointAt('p'));
        assert.ok(await page.waitFor(`!document.querySelector('[data-hover-link]')`, 5000), 'the card goes once the pointer leaves the link');

        await page.click(...await pointAt('h1'));
        await clickOn(page, buttonNamed('Properties'));
        assert.ok(await page.waitFor(buttonNamed('Font')), 'the properties panel shows the text fields');
        await clickOn(page, buttonNamed('Font'));
        assert.ok(await page.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Search fonts'`));
        await page.type('Helv');
        assert.ok(await page.waitFor(`(() => { const shown = [...document.querySelectorAll('[role=option]')]; return shown.length === 1 && /helv/i.test(shown[0].textContent); })()`), 'the search narrows the list');
        await page.press('Enter');
        assert.ok(await until(() => /<h1 style=.[^>]*font-family:[^;>]*Helvetica Neue/.test(boardText()), 10000), 'the font searched for is saved');

        const size = `document.querySelector('input[aria-label="Font size"]')`;
        await clickOn(page, size);
        await page.evaluate(`${size}.select()`);
        await page.type('40');
        await page.press('Enter');
        assert.ok(await until(() => /<h1 style=.[^>]*font-size: 40px/.test(boardText()), 10000), 'Enter commits the size');
        assert.ok(await page.waitFor(`document.activeElement === ${size}`), 'Enter keeps the field focused');
        await page.press('z', mod);
        assert.ok(await until(() => !/font-size: 40px/.test(boardText()), 10000), '⌘Z in the committed field undoes the edit');
        assert.ok(await until(() => /font-family:[^;>]*Helvetica Neue/.test(boardText()), 2000), 'only the last edit is undone');

        await page.press('Escape');
        await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1000, height: 273, deviceScaleFactor: 1, mobile: false });
        await page.waitFor('innerHeight === 273');
        const inBoard = await page.evaluate(`(() => {
          const rect = document.querySelector('iframe[data-board="Main.dc.html"]').getBoundingClientRect();
          const top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight);
          return [Math.max(rect.left, 0) + 40, (top + bottom) / 2];
        })()`);
        await page.rightClick(...inBoard);
        const menu = `document.querySelector('[role=menu]')`;
        assert.ok(await page.waitFor(menu));
        const fit = await page.evaluate(`(() => { const el = ${menu}; return { bottom: el.getBoundingClientRect().bottom, top: el.getBoundingClientRect().top, overflow: getComputedStyle(el).overflowY, scrolls: el.scrollHeight > el.clientHeight }; })()`);
        assert.ok(fit.top >= -1 && fit.bottom <= 274, JSON.stringify(fit));
        assert.equal(fit.overflow, 'auto');
        assert.ok(fit.scrolls, 'the long menu scrolls inside the short window');
        await page.cdp('Emulation.clearDeviceMetricsOverride', {});
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('an artboard link selects the artboard, and Shift+Cmd+C copies it as a PNG', T, async () => {
      const { url } = await ctx.openNew('copy-png');
      const editor = new URL('index.html', url);
      const page = await (await ctx.browser()).load(editor.href + '#artboard-main', { ready: `document.querySelector('[data-board-title="Main.dc.html"] .text-accent')`, settle: 800 });
      try {
        assert.equal(await page.evaluate('location.hash'), '');
        await page.cdp('Browser.grantPermissions', { origin: editor.origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
        await page.press('c', { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin', shift: true });
        assert.ok(await page.waitFor(textIn('Copied as PNG'), 20000), 'the copy finished');
        const types = await page.evaluate('navigator.clipboard.read().then(items => items.flatMap(item => item.types))');
        assert.deepEqual(types, ['image/png']);
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('without a Shell, the focused artboard has its own Export menu', T, async () => {
      const { url } = await ctx.openNew('focused-export');
      const browser = await ctx.browser();
      // The host saves exports to the Downloads folder; a browser download lands there too.
      const dir = ctx.downloads;
      fs.mkdirSync(dir, { recursive: true });
      await browser.downloadsTo(dir);
      const pngs = () => fs.readdirSync(dir).filter(name => name.endsWith('.png'));
      const before = pngs().length;
      const page = await browser.load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        await clickOn(page, `document.querySelector('[data-board-title="Main.dc.html"] button[aria-label="Focus"], [data-board-title="Main.dc.html"] button[aria-label="Play full screen"]')`, 'Focus');
        assert.ok(await page.waitFor(buttonNamed('Back to canvas')), 'the focused view opened');
        await clickOn(page, buttonNamed('Export'));
        const item = `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.includes('Selected artboard, 1×') && item.getAttribute('aria-disabled') !== 'true')`;
        assert.ok(await page.waitFor(item), 'the menu lists the PNG of this artboard');
        await clickOn(page, item, 'PNG 1×');
        assert.ok(await until(() => pngs().length > before, 30000), `no PNG saved: ${fs.readdirSync(dir)}`);
        await clickOn(page, buttonNamed('Back to canvas'));
        assert.ok(await page.waitFor(`!(${buttonNamed('Export')})`), 'the canvas has no Export menu');
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('where the browser keeps the clipboard from the framed editor, the Shell copies the PNG', T, async () => {
      const { url } = await ctx.openNew('copy-png-shell');
      const browser = await ctx.browser();
      const shell = await browser.load(url + '#artboard-main', { ready: `document.querySelector('[data-board-title="Main.dc.html"] .text-accent')` });
      const frame = `document.querySelector('iframe[name="open-artifact-shell"]')`;
      try {
        assert.ok(await shell.waitFor(`document.querySelector('[data-board-title="Main.dc.html"] .text-accent')`), 'the artboard is selected');
        await shell.cdp('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
        // Act like a browser that refuses framed pages whatever the frame's allow says.
        await shell.evaluate(`(() => {
          const win = ${frame}.contentWindow;
          win.refused = 0;
          const refuse = async () => { win.refused++; throw new win.DOMException('Write permission denied.', 'NotAllowedError'); };
          win.navigator.clipboard.write = refuse;
          win.navigator.clipboard.writeText = refuse;
          win.focus();
        })()`);
        await shell.evaluate('navigator.clipboard.writeText("before")');
        await shell.press('c', { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin', shift: true });
        assert.ok(await shell.waitFor(textIn('Copied as PNG'), 20000), 'the copy finished');
        assert.equal(await shell.evaluate(`${frame}.contentWindow.refused`), 1, 'the editor tried the clipboard itself first');
        const types = await shell.evaluate('navigator.clipboard.read().then(items => items.flatMap(item => item.types))');
        assert.deepEqual(types, ['image/png']);
        const size = await shell.evaluate(`navigator.clipboard.read().then(items => items[0].getType('image/png')).then(blob => blob.size)`);
        assert.ok(size > 1000, `a real image (${size} bytes)`);
        assert.deepEqual(shell.problems, []);
      } finally { await shell.close(); }
    });

    it('Pages → Add page writes the page to canvas.json', T, async () => {
      const { root, url } = await ctx.openNew('pages');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        await clickOn(page, `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Page 1')`, 'the Pages menu');
        await clickOn(page, buttonNamed('New page'), 'New page');
        assert.ok(await until(() => canvasOf(root).pages.length === 2, 10000), `canvas.json pages: ${JSON.stringify(canvasOf(root).pages)}`);
        assert.deepEqual(
          canvasOf(root).pages.map(p => p.name),
          ['Page 1', 'Page 2'],
        );
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('an unreadable canvas.json is shown as such, and left as it is', T, async () => {
      const broken = (ctx_, root) => {
        copyFixture('design', root);
        fs.writeFileSync(path.join(root, 'project', 'canvas.json'), '{"v":3, "boards": {');
      };
      const root = path.join(tmpDir('design-unreadable'), 'artifact');
      fs.mkdirSync(root);
      broken(ctx, root);
      const out = await ctx.cli.json(['open', root, '--type', 'design', '--json']);
      const page = await (await ctx.browser()).load(new URL('index.html', out.url).href, { ready: textIn('could not be read'), settle: 1500, ignore: [/canvas\.json/i] });
      try {
        assert.ok(await page.waitFor(textIn('The editor will not change it until it is fixed.'), 5000), 'no banner for the unreadable canvas.json');
        const waiting = await startWait(ctx, root, 45);
        try {
          await clickOn(page, buttonNamed('Ask agent to fix'));
          const answer = await waiting.done;
          assert.equal(answer.code, 0);
          assert.match(answer.stdout, /Fix project\/canvas\.json/);
        } finally { waiting.child.kill('SIGTERM'); }
        assert.equal(fs.readFileSync(path.join(root, 'project', 'canvas.json'), 'utf8'), '{"v":3, "boards": {', 'the editor rewrote a canvas.json it could not read');
      } finally {
        await page.close();
      }
    });
  },
});
