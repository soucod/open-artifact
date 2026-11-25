// Exercise the installed Slides editor and its global Shell and the files the Shell exports.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { crashes, findChrome, launch } from './lib/browser.mjs';
import { cli } from './lib/cli.mjs';
import { browserOff, install, removeTmp, skipFor, tmpDir, typePath } from './lib/target.mjs';
import { until } from './lib/http.mjs';

const rail = '[data-open-artifact-thumbs] [data-slide-index]';
const fileNames = ['cover', 'plan', 'end'];
const browserSkip = browserOff || !findChrome();
const inlineSlide = id => `document.querySelector('[data-open-artifact-inline-view] [data-open-artifact-slide="${id}"]')`;
const inlinePager = `document.querySelector('nav[aria-label="Slides"]')`;

/** A page on an origin of its own that frames `src` (as a chat or a doc embeds a deck), running `script` beside it. */
async function framing(src, script = '') {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><script>${script}</script><iframe id="framed" src="${src}" style="width:800px;height:520px;border:0"></iframe>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}

describe('slides', { skip: skipFor('slides') }, () => {
  let run, root, downloads, url, publicUrl, browser, page, wrapped;
  before(async () => {
    const { dir } = install(typePath('slides'));
    const home = tmpDir('slides-home');
    downloads = path.join(home, 'Downloads');
    run = cli(dir, { HOME: home, OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('slides-state') });
    root = tmpDir('slides-deck');
    const project = path.join(root, 'project');
    fs.mkdirSync(path.join(project, 'slides'), { recursive: true });
    const brand = 'project/ds/fixture';
    fs.mkdirSync(path.join(root, brand), { recursive: true });
    fs.writeFileSync(path.join(root, brand, 'photo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#1870e0"/></svg>');
    fs.writeFileSync(path.join(project, 'deck.json'), JSON.stringify({
      v: 5, lists: 'css', size: '4:3', title: 'Quarterly review', order: fileNames, cover: 'cover',
      format: { v: 1, shared: ['project/deck.css'] }, createdOnFiles: { v: 1, at: '2026-11-15T00:00:00Z' },
      sections: {}, faces: {}, designSystems: [],
    }));
    fs.writeFileSync(path.join(project, 'deck.css'), 'section { background: #ffffff; padding: 128px; } h1 { color: #123456; } ' +
      '@property --total { syntax: "<number>"; inherits: false; initial-value: 0; } ' +
      '@keyframes count { from { --total: 0; } to { --total: 100; } } .metric { animation: count 2s ease-out both; } .gaps li { margin: 12px 0; } ' +
      ':root { --cut: 12px; } .chamfer { position:absolute; top:650px; height:160px; clip-path:polygon(0 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% 100%, 0 100%); } ' +
      '.polygon { position:absolute; top:850px; width:160px; height:160px; background:#2670a0; }');
    const contents = [
      '<h1>季度回顾</h1><div><p class="fragment">Details after a click</p></div><aside>Opening notes</aside>' +
        '<x-embed style="position:absolute;left:800px;top:600px;width:400px;height:200px"><canvas width="40" height="40"></canvas><script>document.body.style.background="#18aa44";const ctx=document.querySelector("canvas").getContext("2d");ctx.fillStyle="#1122ee";ctx.fillRect(0,0,40,40)</script></x-embed>',
      '<h1>Plan</h1><p class="metric">100%</p><p>Read through the shared sheet.</p>' +
        '<div class="chamfer" style="left:128px;width:160px;background:#2670a0"></div><div class="chamfer" style="left:320px;width:280px;background:#2670a0"></div>' +
        `<img class="chamfer" src="${brand}/photo.svg" alt="Clipped photo" style="left:632px;width:160px;object-fit:cover">` +
        '<div class="chamfer" style="left:824px;width:240px;background:#f3f1eb"><p style="font-size:24px">Clipped group</p></div>' +
        '<div class="polygon" style="left:128px;clip-path:polygon(50% 0, 100% 100%, 0 100%)"></div>' +
        '<div class="polygon" style="left:320px;clip-path:polygon(0 25%, 65% 25%, 65% 0, 100% 50%, 65% 100%, 65% 75%, 0 75%)"></div>',
      '<h1>Close</h1><ul class="gaps"><li>First step</li><li>Second step</li></ul>',
    ];
    for (const [i, id] of fileNames.entries()) fs.writeFileSync(path.join(project, 'slides', id + '.html'), `<section id="${id}">${contents[i]}</section>`);
    ({ url: publicUrl } = await run.json(['open', root, '--json']));
    url = new URL('index.html', publicUrl).href;
    if (!browserSkip) {
      browser = await launch();
      page = await browser.load(url, { ready: `document.querySelectorAll('${rail}').length === 3` });
    }
  });
  after(async () => {
    await browser?.close();
    await run?.run(['stop', root]);
    removeTmp();
  });

  it('checks a shared-CSS 4:3 deck with a live embed and an in-flow build', async () => {
    const checked = await run.run(['check', root]);
    assert.equal(checked.code, 0, checked.stdout);
  });

  it('reports the initial slide, preserves links across reordering, and follows historical page numbers', { skip: browserSkip }, async () => {
    assert.match(await page.evaluate('location.hash'), /^#slide-.+/);
    const count = await page.evaluate('history.length');
    const go = async hash => page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
    const showing = id => page.waitFor(`document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="${id}"]')`);
    const point = await page.evaluate(`(() => {
      const box = document.querySelectorAll('${rail}')[1].getBoundingClientRect();
      return [box.x + box.width / 2, box.y + box.height / 2];
    })()`);
    await page.click(...point);
    assert.ok(await showing('plan'));
    assert.equal(await page.evaluate('history.length'), count);
    const link = await page.evaluate('location.hash');
    const index = path.join(root, 'project/deck.json');
    const original = fs.readFileSync(index, 'utf8');
    try {
      fs.writeFileSync(index, JSON.stringify({ ...JSON.parse(original), order: ['end', 'cover', 'plan'] }));
      // Open the link in a fresh tab after the order changed on disk.
      const reopened = await browser.load(url + link, { ready: 'document.querySelector(\'[data-open-artifact-mode="edit"][data-open-artifact-slide="plan"]\')' });
      try { assert.deepEqual(reopened.problems, []); } finally { await reopened.close(); }
    } finally {
      fs.writeFileSync(index, original);
    }
    await page.cdp('Page.reload', { ignoreCache: true });
    assert.ok(await page.waitFor(`document.querySelectorAll('${rail}').length === 3`));
    await go('#slide-2');
    assert.ok(await showing('plan'));
    await go('#slide-1');
    assert.ok(await showing('cover'));
  });

  it('remembers the last slide and follows an external link while presenting', { skip: browserSkip }, async () => {
    const mac = await page.evaluate("navigator.platform.includes('Mac')");
    await page.press('Enter', { meta: mac, ctrl: !mac });
    assert.ok(await page.waitFor(`document.querySelector('[aria-label="Presentation"]')`));
    await page.press('ArrowRight');
    await page.press('ArrowRight');
    assert.ok(await page.waitFor("location.hash === '#slide-~plan'"));
    await page.evaluate("location.hash = '#slide-~end'");
    assert.ok(await page.waitFor(`!document.querySelector('[aria-label="Presentation"]') && document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="end"]')`));
    const reopened = await browser.load(url, { ready: `document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="end"]')` });
    try { assert.deepEqual(reopened.problems, []); } finally { await reopened.close(); }
    await page.evaluate("location.hash = '#slide-1'");
    assert.ok(await page.waitFor(`document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="cover"]')`));
  });

  it('opens one slide on its own from a .only link, pages whole slides, and returns to the editor', { skip: browserSkip }, async () => {
    const only = `document.querySelector('[data-presenter-only]')`;
    const alone = id => `${only}?.querySelector('[data-open-artifact-slide="${id}"]')`;
    const editing = id => `!${only} && document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="${id}"]')`;
    const viewer = await browser.load(url + '#slide-~cover.only', { ready: alone('cover') });
    try {
      assert.ok(await viewer.waitFor(`location.hash === '#slide-~cover.only.1.3' && /^Slide 1 of 3/.test(${only}.getAttribute('aria-label')) && ${only}.getAttribute('role') === 'group'`));
      assert.equal(await viewer.evaluate(`Boolean(document.querySelector('[data-presenter-controls]'))`), false);
      // Every build is shown at once.
      assert.ok(await viewer.waitFor(`[...${alone('cover')}.querySelectorAll('p')].some(p => p.textContent === 'Details after a click' && getComputedStyle(p).opacity === '1' && getComputedStyle(p).visibility === 'visible')`));
      await viewer.press('ArrowRight');
      assert.ok(await viewer.waitFor(`${alone('plan')} && location.hash === '#slide-~plan.only.2.3'`));
      await viewer.type('f');
      assert.ok(await viewer.waitFor(`!document.fullscreenElement && ${alone('plan')}`));
      await viewer.evaluate(`location.hash = '#slide-~end.only'`);
      assert.ok(await viewer.waitFor(`${alone('end')} && location.hash === '#slide-~end.only.3.3'`));
      await viewer.evaluate(`location.hash = '#slide-~plan'`);
      assert.ok(await viewer.waitFor(editing('plan')));
      // Back returns to the slide on its own.
      await viewer.evaluate('history.back()');
      assert.ok(await viewer.waitFor(`${alone('end')} && location.hash === '#slide-~end.only.3.3'`));
      await viewer.evaluate(`location.hash = '#slide-~gone.only'`);
      assert.ok(await viewer.waitFor(`${alone('end')} && location.hash === '#slide-~end.only.3.3'`));
      await viewer.press('Escape');
      assert.ok(await viewer.waitFor(`${editing('end')} && location.hash === '#slide-~end'`));
      assert.deepEqual(viewer.problems, []);
    } finally {
      await viewer.close();
    }
  });

  async function chooseExport(item) {
    wrapped ??= await browser.load(publicUrl + '#slide-~cover', { ready: `document.querySelector('[data-comments-button]')` });
    const share = 'header button[aria-label="Share"]';
    await wrapped.evaluate(`document.querySelector('${share}').click()`);
    const exportTab = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export')`;
    assert.ok(await wrapped.waitFor(exportTab, 4000), await wrapped.evaluate('document.body.innerText'));
    await wrapped.evaluate(exportTab + '.click()');
    const choice = `[...document.querySelectorAll('[data-export-row]')].find(el => el.dataset.exportRow.includes(${JSON.stringify(item)}))`;
    assert.ok(await wrapped.waitFor(choice, 4000), await wrapped.evaluate('document.body.innerText'));
    await wrapped.evaluate(choice + '.click()');
  }

  async function download(item, ext, dialog = false) {
    const previous = new Set(fs.existsSync(downloads) ? fs.readdirSync(downloads) : []);
    await chooseExport(item);
    if (dialog) {
      const submit = `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Download')`;
      assert.ok(await wrapped.waitFor(submit));
      if (dialog === 'notes') await wrapped.evaluateAll(`document.querySelector('[aria-label="Include speaker notes"]')?.click()`);
      await wrapped.evaluateAll(submit + '?.click()');
    }
    const file = () => fs.existsSync(downloads) && fs.readdirSync(downloads).find(name => name.endsWith(ext) && !previous.has(name));
    assert.ok(await until(file, 30000), await page.evaluate('document.body.innerText'));
    const saved = path.join(downloads, file());
    // Some formats explain which elements were converted.
    await wrapped.evaluateAll(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'OK')?.click()`);
    return saved;
  }

  it('returns cancellation to the global export menu for both option dialogs', { skip: browserSkip }, async () => {
    for (const item of ['PDF', 'Web page']) {
      await chooseExport(item);
      await wrapped.evaluate(`window.lastExport = null; window.addEventListener('message', e => {
        if (e.data?.openArtifact === 'chrome_export') window.lastExport = e.data.state;
      }, { signal: AbortSignal.timeout(5000) })`);
      const cancel = `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Cancel')`;
      assert.ok(await wrapped.waitFor(cancel));
      await wrapped.evaluateAll(cancel + '?.click()');
      assert.ok(await wrapped.waitFor("window.lastExport === 'declined'", 4000));
    }
  });

  it('exports a navigable HTML deck with the same build order', { skip: browserSkip }, async () => {
    const file = await download('Web page', '.html', true);
    const player = await browser.load(pathToFileURL(file).href, { ready: 'document.querySelector(".open-artifact-on")' });
    try {
      const visible = `getComputedStyle([...document.querySelectorAll('p')].find(p => p.textContent === 'Details after a click')).visibility`;
      assert.equal(await player.evaluate(visible), 'hidden');
      await player.press('ArrowRight');
      assert.equal(await player.evaluate(visible), 'visible');
      assert.equal(await player.evaluate('document.querySelector(".open-artifact-on").getAttribute("aria-label")'), 'Slide 1');
      await player.press('ArrowRight');
      assert.equal(await player.evaluate('location.hash'), '#2');
      assert.ok(await player.waitFor("Number.parseFloat(document.querySelector('[data-count]')?.textContent) < 100"));
      assert.ok(await player.waitFor("document.querySelector('[data-count]')?.textContent === '100%'"));
      assert.match(await player.evaluate(`getComputedStyle(document.querySelector('[aria-label="Clipped photo"]')).clipPath`), /calc\(100% - 12px\)/);
      await player.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      assert.ok(await player.waitFor("document.documentElement.classList.contains('open-artifact-reader')"));
      assert.equal(await player.evaluate(visible), 'visible');
      const rectangles = await player.evaluate("Array.from(document.querySelectorAll('.open-artifact-frame'), el => { const r = el.getBoundingClientRect(); return [r.top, r.height, r.width]; })");
      assert.ok(rectangles.every(([, height, width]) => Math.abs(height - width * 3 / 4) < 1), JSON.stringify(rectangles));
      assert.ok(rectangles[2][0] > rectangles[1][0] && rectangles[1][0] > rectangles[0][0]);
      await player.cdp('Emulation.clearDeviceMetricsOverride');
      assert.ok(await player.waitFor("!document.documentElement.classList.contains('open-artifact-reader')"));
      assert.deepEqual(player.problems, []);
    } finally { await player.close(); }
  });

  it('exports the rendered embed into the 4:3 PNG', { skip: browserSkip }, async () => {
    const file = await download('Current slide as image', '.png');
    const data = fs.readFileSync(file);
    assert.deepEqual([data.readUInt32BE(16), data.readUInt32BE(20)], [1440, 1080]);
    const pixels = await page.evaluate(`(async () => {
      const image = new Image(); image.src = 'data:image/png;base64,${data.toString('base64')}'; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d'); return [[900,650],[820,620]].map(([x,y]) => {
        ctx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      });
    })()`);
    assert.deepEqual(pixels, [[24, 170, 68, 255], [17, 34, 238, 255]], await page.evaluate('document.body.innerText'));
  });
  it('downloads editable PowerPoint with East Asian text, notes and a 4:3 picture deck', { skip: browserSkip }, async () => {
    const xml = (file, name) => execFileSync('unzip', ['-p', file, name], { encoding: 'utf8' });
    for (const option of ['current fonts', 'basic fonts', 'slides as pictures']) {
      const file = await download('PowerPoint, ' + option, '.pptx');
      const first = xml(file, 'ppt/slides/slide1.xml');
      assert.match(first, /<p:pic>/);
      if (option !== 'slides as pictures') {
        assert.match(first, /<a:t>季度回顾<\/a:t>/);
        assert.match(first, /<a:ea typeface="Microsoft YaHei"/);
        // 12px between the items, and the 12px above the first and below the last inside the list's box.
        const list = [1, 2, 3].map(n => xml(file, `ppt/slides/slide${n}.xml`)).join('').match(/<p:sp>(?:(?!<\/p:sp>)[^])*?<a:t>Second step<\/a:t>[^]*?<\/p:sp>/)?.[0] ?? '';
        assert.match(list, /tIns="76200"[^>]*bIns="76200"/);
        assert.match(list, /<a:spcAft><a:spcPts val="600"\/><\/a:spcAft>[^]*?<a:t>First step/);
        const plan = xml(file, 'ppt/slides/slide2.xml');
        // Polygon clips: plain panels become custom shapes, the photo a picture cut to the polygon.
        const custom = [...plan.matchAll(/<p:sp>[^]*?<\/p:sp>/g)].map(([shape]) => shape).filter(shape => shape.includes('<a:custGeom>'));
        const vertices = shape => [...shape.matchAll(/<a:pt x="(-?\d+)" y="(-?\d+)"\/>/g)].map(([, x, y]) => [Number(x), Number(y)]);
        const cut = 12 * 6350;
        const widths = custom.map(shape => Number(/<a:path w="(\d+)"/.exec(shape)[1]))
          .filter((width, i) => custom[i].includes(`<a:lnTo><a:pt x="${width - cut}" y="0"/></a:lnTo>`) && custom[i].includes(`<a:pt x="${width}" y="${cut}"/>`));
        assert.deepEqual(widths.sort((a, b) => a - b), [160 * 6350, 280 * 6350]); // the same 12px cut on both widths
        const outlines = custom.map(shape => JSON.stringify(vertices(shape)));
        assert.ok(outlines.includes(JSON.stringify([[508000, 0], [1016000, 1016000], [0, 1016000]])), 'the triangle');
        assert.ok(outlines.includes(JSON.stringify([[0, 254000], [660400, 254000], [660400, 0], [1016000, 508000], [660400, 1016000], [660400, 762000], [0, 762000]])), 'the concave arrow');
        const pictures = [...plan.matchAll(/<p:pic>[^]*?<\/p:pic>/g)].map(([picture]) => picture);
        const photo = pictures.find(picture => picture.includes('descr="Clipped photo"')) ?? '';
        assert.match(photo, /<a:srcRect l="25000" t="0" r="25000" b="0"\/>/);
        assert.match(photo, new RegExp(`<a:custGeom>[^]*?<a:pt x="1016000" y="${cut}"`));
        assert.ok(pictures.some(picture => picture.includes('name="Clipped element 1"')));
        assert.doesNotMatch(plan, /<a:t>Clipped group<\/a:t>/);
      }
      assert.match(xml(file, 'ppt/notesSlides/notesSlide1.xml'), /Opening notes/);
      const size = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(xml(file, 'ppt/presentation.xml'));
      assert.equal(Number(size[1]) / Number(size[2]), 4 / 3);
    }
  });

  it('downloads a 4:3 PDF with a separate notes page', { skip: browserSkip }, async () => {
    const file = await download('PDF', '.pdf', 'notes');
    const pdf = fs.readFileSync(file).toString('latin1');
    assert.match(pdf, /^%PDF/);
    assert.match(pdf, /\/Count\s+4\b/);
    const boxes = [...pdf.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map(match => match[1].trim().split(/\s+/).map(Number));
    assert.deepEqual(boxes, Array(4).fill([0, 0, 720, 540]));
  });

  it('previews a historical slide and restores that slide from the editor', { skip: browserSkip }, async () => {
    const file = path.join(root, 'project/slides/cover.html');
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, original.replace('季度回顾', 'Updated cover'));
    const showing = text => `document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="cover"]')?.textContent.includes(${JSON.stringify(text)})`;
    assert.ok(await page.waitFor(showing('Updated cover')));
    await page.evaluate(`document.querySelector('button[aria-label="Version history"]').click()`);
    const versions = '[role="dialog"] button[aria-expanded]';
    assert.ok(await page.waitFor(`document.querySelectorAll('${versions}').length > 1`));
    // The original version holds every file in the deck.
    await page.evaluate(`[...document.querySelectorAll('${versions}')].at(-1).click()`);
    const button = label => `[...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
    assert.ok(await page.waitFor(button('Preview')));
    await page.evaluate(button('Preview') + '.click()');
    assert.ok(await page.waitFor(`document.querySelector('[aria-label="Read-only slide preview"]')?.innerText.includes('季度回顾')`));
    const restore = `document.querySelector('[aria-label^="Restore "][aria-label*="cover"]')`;
    assert.ok(await page.waitFor(restore));
    await page.evaluate(restore + '.click()');
    assert.ok(await page.waitFor(button('Restore')));
    await page.evaluate(button('Restore') + '.click()');
    assert.ok(await until(() => fs.readFileSync(file, 'utf8') === original));
    await page.press('Escape');
    assert.ok(await page.waitFor(showing('季度回顾')));
  });

  it('edits source text on the stage, saves the same HTML and undoes the change', { skip: browserSkip }, async () => {
    const file = path.join(root, 'project/slides/plan.html');
    const original = fs.readFileSync(file, 'utf8');
    await page.evaluate("location.hash = '#slide-2'");
    const heading = '[data-open-artifact-mode="edit"][data-open-artifact-slide="plan"] h1';
    assert.ok(await page.waitFor(`document.querySelector('${heading}')`));
    const point = await page.evaluate(`(() => {
      const box = document.querySelector('${heading}').getBoundingClientRect();
      return [box.x + 24, box.y + box.height / 2];
    })()`);
    await page.clickTimes(...point, 2);
    assert.ok(await page.waitFor(`document.activeElement?.isContentEditable`));
    const mac = await page.evaluate("navigator.platform.includes('Mac')");
    await page.press('a', { meta: mac, ctrl: !mac, commands: ['selectAll'] });
    await page.type('Revised plan');
    await page.press('Escape');
    assert.ok(await until(() => fs.readFileSync(file, 'utf8') === original.replace('>Plan<', '>Revised plan<')));
    await page.press('z', { meta: mac, ctrl: !mac });
    assert.ok(await until(() => fs.readFileSync(file, 'utf8') === original), fs.readFileSync(file, 'utf8'));
  });

  it('sets a source paragraph’s margin from the properties panel, saves it on the tag and undoes it', { skip: browserSkip }, async () => {
    const file = path.join(root, 'project/slides/plan.html');
    const original = fs.readFileSync(file, 'utf8');
    await page.evaluate("location.hash = '#slide-2'");
    const line = `[...document.querySelectorAll('[data-open-artifact-mode="edit"][data-open-artifact-slide="plan"] p')].find((p) => p.textContent === 'Read through the shared sheet.')`;
    assert.ok(await page.waitFor(line));
    const point = await page.evaluate(`(() => {
      const box = (${line}).getBoundingClientRect();
      return [box.x + box.width / 2, box.y + box.height / 2];
    })()`);
    await page.click(...point);
    const margin = `document.querySelector('input[aria-label="Margin"]')`;
    assert.ok(await page.waitFor(margin), 'a flow child shows the margin field');
    const field = await page.evaluate(`(() => { const box = ${margin}.getBoundingClientRect(); return [box.x + box.width / 2, box.y + box.height / 2]; })()`);
    await page.click(...field);
    await page.evaluate(`${margin}.select()`);
    await page.type('24');
    await page.press('Enter');
    const spaced = original.replace('<p>Read through', '<p style="margin:24px">Read through');
    assert.notEqual(spaced, original);
    assert.ok(await until(() => fs.readFileSync(file, 'utf8') === spaced), fs.readFileSync(file, 'utf8'));
    await page.evaluate('document.activeElement?.blur()');
    const mac = await page.evaluate("navigator.platform.includes('Mac')");
    await page.press('z', { meta: mac, ctrl: !mac });
    assert.ok(await until(() => fs.readFileSync(file, 'utf8') === original), fs.readFileSync(file, 'utf8'));
    await page.press('Escape');
  });

  it('reaches the card of a link in edited text by keyboard and changes its address', { skip: browserSkip }, async () => {
    const file = path.join(root, 'project/slides/end.html');
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, '<section id="end"><h1>Close</h1><p>Read <a href="https://example.com/docs">the guide</a> first.</p></section>');
    try {
      await page.evaluate("location.hash = '#slide-~end'");
      const link = '[data-open-artifact-mode="edit"][data-open-artifact-slide="end"] a';
      assert.ok(await page.waitFor(`document.querySelector('${link}')`));
      const point = await page.evaluate(`(() => {
        const box = document.querySelector('${link}').getBoundingClientRect();
        return [box.x + box.width / 2, box.y + box.height / 2];
      })()`);
      await page.clickTimes(...point, 2);
      const card = '[data-open-artifact-link-card]';
      assert.ok(await page.waitFor(`document.querySelector('${card} [aria-label="Edit link"]')`), 'no card for the link');
      await page.press('Tab');
      assert.ok(await page.waitFor(`document.activeElement?.closest('${card}')`), 'Tab did not reach the card');
      await page.press('Escape');
      if (!(await page.waitFor('document.activeElement?.isContentEditable', 500))) await page.press('Escape');
      assert.ok(await page.waitFor('document.activeElement?.isContentEditable'), 'Escape did not give the text the focus back');
      await page.press('Tab');
      assert.ok(await page.waitFor(`document.activeElement?.closest('${card}')`));
      await page.evaluate(`document.querySelector('${card} [aria-label="Edit link"]').click()`);
      assert.ok(await page.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Link address'`));
      await page.evaluate('document.activeElement.select()');
      await page.type('example.org/start');
      await page.press('Enter');
      assert.ok(await page.waitFor('document.activeElement?.isContentEditable'));
      await page.press('Escape');
      assert.ok(await until(() => fs.readFileSync(file, 'utf8').includes('<a href="https://example.org/start">the guide</a>')), fs.readFileSync(file, 'utf8'));
    } finally {
      fs.writeFileSync(file, original);
    }
  });

  it('uses the frame to comment on selected text and a dragged slide area', { skip: browserSkip }, async () => {
    const shell = await browser.load(publicUrl + '#slide-~plan', { ready: "document.querySelector('[data-comments-button]')" });
    try {
      const focused = "document.activeElement?.shadowRoot?.activeElement?.matches('textarea')";
      const point = await shell.evaluate(`(() => {
        const frame = document.querySelector('iframe[name="open-artifact-shell"]');
        const heading = frame.contentDocument.querySelector('[data-open-artifact-mode="edit"] h1');
        const outer = frame.getBoundingClientRect(), box = heading.getBoundingClientRect();
        return [outer.left + box.left + 16, outer.top + box.top + box.height / 2];
      })()`);
      await shell.click(...point);
      await shell.evaluate("document.querySelector('[data-comments-button] button[aria-haspopup]').click()");
      const selection = "[...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.trim() === 'Comment on selection')";
      assert.ok(await shell.waitFor(selection, 4000));
      await shell.evaluate(selection + '.click()');
      assert.ok(await shell.waitFor(focused, 4000));
      await shell.type('Review this heading');
      await shell.press('Enter');
      const readThread = async text => {
        const result = await (await fetch(new URL('_api/comments', publicUrl))).json();
        return result.threads.find(t => t.messages.some(m => m.text === text));
      };
      assert.ok(await until(() => readThread('Review this heading')));
      const heading = JSON.parse((await readThread('Review this heading')).anchor);
      assert.equal(heading.slide, 'plan');
      assert.ok(heading.el);

      const start = await shell.evaluate(`(() => {
        const frame = document.querySelector('iframe[name="open-artifact-shell"]');
        const outer = frame.getBoundingClientRect(), box = frame.contentDocument.querySelector('[data-comment-capture]').getBoundingClientRect();
        return [outer.left + box.left + box.width / 4, outer.top + box.top + box.height * 0.72];
      })()`);
      const [x, y] = start;
      await shell.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await shell.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 60, y: y + 32, buttons: 1 });
      await shell.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 60, y: y + 32, button: 'left', clickCount: 1 });
      assert.ok(await shell.waitFor(focused, 4000));
      await shell.type('Review this area');
      await shell.press('Enter');
      assert.ok(await until(() => readThread('Review this area')));
      const area = JSON.parse((await readThread('Review this area')).anchor);
      assert.equal(area.slide, 'plan');
      assert.ok(area.w > 0 && area.h > 0);
      assert.ok(Math.abs(area.w / area.h - 60 / 32) < 0.05);
    } finally { await shell.close(); }
  });

  it('opens a guest invite in the global frame with the guest’s original role', { skip: browserSkip }, async () => {
    const { createTypeServer } = await import('../packages/type-server/src/index.ts');
    const server = createTypeServer({
      secret: 'guest-flow', idleMs: 0, assetsDir: path.join(typePath('slides'), 'scripts'),
      lanAddresses: () => [], isLocal: req => !req.headers['x-test-guest'],
    });
    let guest, owner;
    try {
      const guestRoot = tmpDir('slides-guest-deck');
      fs.cpSync(path.join(root, 'project'), path.join(guestRoot, 'project'), { recursive: true });
      await server.listen();
      const opened = await server.open({ root: guestRoot, type: 'slides', title: 'Guest review' });
      owner = await browser.load(opened.url + '#slide-~plan', { ready: "document.querySelector('[data-comments-button]')" });
      await owner.evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.copied = text } })`);
      await owner.evaluate(`document.querySelector('header button[aria-label="Share"]').click()`);
      const invite = "document.querySelector('[data-share-link=commenter] button')";
      assert.ok(await owner.waitFor(invite, 4000));
      await owner.evaluate(invite + '.click()');
      assert.ok(await owner.waitFor("window.copied?.includes('/s/') && document.querySelector('[data-share-security]')", 5000));
      const join = new URL(await owner.evaluate('window.copied'));
      assert.equal(join.hash, '#slide-~plan');
      const viewerUrl = await owner.evaluate("document.querySelector('[data-share-link=viewer]').title");
      // The test listener has no LAN interface. Deliver the copied invitation to its loopback address.
      join.host = new URL(opened.url).host;
      guest = await browser.load('about:blank');
      await guest.cdp('Network.setExtraHTTPHeaders', { headers: { 'x-test-guest': '1' } });
      await guest.cdp('Page.navigate', { url: join.href });
      assert.ok(await guest.waitFor("document.querySelector('input[name=name]')", 5000));
      await guest.evaluate("document.querySelector('[name=name]').value = 'Reviewer'; document.querySelector('form').requestSubmit()");
      const comment = '[data-comments-button] button[aria-pressed]';
      assert.ok(await guest.waitFor(`document.querySelector('${comment}')`, 5000));
      await guest.evaluate(`document.querySelector('${comment}').click()`);
      assert.ok(await guest.waitFor(`document.querySelector('${comment}')?.getAttribute('aria-pressed') === 'true'`));
      const target = '[data-open-artifact-mode="edit"][data-open-artifact-slide="plan"]';
      assert.ok(await guest.waitFor(`document.querySelector('${target}')`));
      const point = await guest.evaluate(`(() => {
        const frame = document.querySelector('iframe[name="open-artifact-shell"]');
        const outer = frame.getBoundingClientRect(), slide = frame.contentDocument.querySelector('${target}').getBoundingClientRect();
        return [outer.x + slide.x + slide.width / 2, outer.y + slide.y + slide.height / 2];
      })()`);
      await guest.click(...point);
      assert.ok(await guest.waitFor("document.activeElement?.shadowRoot?.activeElement?.matches('textarea')", 4000));
      await guest.type('Check the plan with finance');
      await guest.press('Enter');
      const list = "document.querySelector('[data-comments-panel-layer]')?.shadowRoot?.querySelector('[data-comments-panel]')";
      await guest.evaluate(`document.querySelector('[data-comments-button] button[aria-haspopup]').click()`);
      const showAll = `[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.includes('Show all comments'))`;
      assert.ok(await guest.waitFor(showAll));
      await guest.evaluate(showAll + '.click()');
      assert.ok(await guest.waitFor(`${list}?.textContent.includes('Check the plan with finance')`, 5000));
      const threads = await (await fetch(new URL('_api/comments', opened.url))).json();
      const thread = threads.threads.find(t => t.messages.some(m => m.text === 'Check the plan with finance'));
      assert.ok(thread);
      assert.equal(JSON.parse(thread.anchor).slide, 'plan');
      await guest.evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.copied = text } })`);
      await guest.evaluate(`document.querySelector('header button[aria-label="Share"]').click()`);
      assert.ok(await guest.waitFor(`document.querySelector('[role="dialog"]')`));
      assert.equal(await guest.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Export')`), false);
      const copy = `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Copy link')`;
      await guest.evaluate(copy + '.click()');
      assert.ok(await guest.waitFor(`window.copied === ${JSON.stringify(join.href)}`));
      assert.equal(await guest.evaluate("window.__OPEN_ARTIFACT_BOOT__.typeServer.role"), 'commenter');
      assert.equal(await guest.evaluate("fetch('_api/frame/share').then(r => r.status)"), 403);

      // Joining the read-only link must switch this browser from commenter to viewer.
      const viewerLink = new URL(new URL(viewerUrl).pathname, opened.url);
      await guest.cdp('Page.navigate', { url: viewerLink.href });
      assert.ok(await guest.waitFor("document.querySelector('input[name=name]')", 5000));
      await guest.evaluate("document.querySelector('form').requestSubmit()");
      assert.ok(await guest.waitFor(`document.querySelector('${comment}')`, 5000));
      await guest.evaluate(`document.querySelector('${comment}').click()`);
      assert.ok(await guest.waitFor(`${list}?.textContent.includes('Check the plan with finance')`, 5000));
      assert.equal(await guest.evaluate("window.__OPEN_ARTIFACT_BOOT__.typeServer.role"), 'viewer');
      await guest.click(...point);
      assert.ok((await guest.evaluateAll("!!document.activeElement?.shadowRoot?.activeElement?.matches('textarea')")).every(focused => !focused));
    } finally { await guest?.close(); await owner?.close(); await server.stop(); }
  });

  it('opens a linked deck in the real Shell, keeps the frame and address bar in sync, and frames it inline', { skip: browserSkip }, async () => {
    const overrides = {
      OPEN_ARTIFACT_HOME: tmpDir('slides-daemon'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('slides-shell-state'),
      OPEN_ARTIFACT_USER_TYPES: tmpDir('slides-user-types'),
      OPEN_ARTIFACT_BROWSER: 'none',
    };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    let daemon, shell;
    try {
      const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
      const { api, readDaemon } = await import('../packages/daemon/src/client.ts');
      daemon = await startDaemon({ port: 0, idleMs: 0, quiet: true, builtinTypesDir: path.dirname(typePath('slides')) });
      const state = await readDaemon();
      const made = await api(state, 'tools.call', {
        name: 'Artifact', arguments: { action: 'publish', type_url: 'open-artifact://type/slides', title: 'Slide links' },
        caller: { harness: 'e2e', session: 'slide-links', workspace: tmpDir('slides-workspace') },
      });
      assert.equal(made.error, undefined, JSON.stringify(made.error));
      const id = made.url.split('/').at(-1);
      fs.cpSync(path.join(root, 'project'), path.join(daemon.store.require(id).root, 'project'), { recursive: true });
      const stage = slide => `document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="${slide}"]')`;
      shell = await browser.load(state.url + '/a/' + id + '#slide-~plan', { ready: stage('plan') });
      assert.ok(await shell.waitFor(stage('plan')));
      const initial = await shell.evaluate('history.length');
      await shell.evaluateAll(`if (document.querySelector('${rail}')) document.querySelector('${rail}').focus()`);
      await shell.evaluateAll(`if (document.querySelector('${rail}')) location.hash = '#slide-~end'`);
      assert.ok(await until(async () => (await shell.evaluate('location.hash')) === '#slide-~end'));
      assert.equal(await shell.evaluate('history.length'), initial + 1); // The explicit frame hash navigation added one entry.
      await shell.evaluate("location.hash = '#slide-1'");
      assert.ok(await shell.waitFor(stage('cover')));
      assert.equal(await shell.evaluate('location.hash'), '#slide-~cover');
      await shell.evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.copied = text } })`);
      // Copy link to slide (⌘⌥L) gives the Export tab's link with the slide: an invite link at the network address, not
      // this computer's 127.0.0.1 page, and copying it shares the deck on the network (the note says so).
      await shell.evaluateAll(`document.querySelector('${rail}')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', metaKey: true, altKey: true, bubbles: true }))`);
      assert.ok(await shell.waitFor(`window.copied?.includes('/s/') && document.body.innerText.includes('shared on your network now')`, 8000), 'the slide link is ' + await shell.evaluate('window.copied'));
      const slideLink = await shell.evaluate('window.copied');
      assert.ok(!slideLink.includes('/a/'), slideLink);
      assert.equal(new URL(slideLink).hash, '#slide-~cover');
      // The title menu's Copy link gives the same link.
      await shell.evaluate(`window.copied = ''; document.querySelector('header button[aria-label="Artifact options"]').click()`);
      const menuCopy = `[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === 'Copy link')`;
      assert.ok(await shell.waitFor(menuCopy));
      await shell.evaluate(menuCopy + '.click()');
      assert.ok(await shell.waitFor('window.copied', 8000));
      const fromMenu = await shell.evaluate('window.copied');
      assert.equal(fromMenu, slideLink);
      await shell.evaluate(`document.querySelector('header button[aria-label="Share"]').click()`);
      assert.ok(await shell.waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.trim() === 'Export')`));
      await shell.evaluate(`window.copied = ''; [...document.querySelectorAll('[role="dialog"] [role="tab"], [role="dialog"] button')].find(b => b.textContent.trim() === 'Export').click()`);
      const exportCopy = `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Copy link')`;
      assert.ok(await shell.waitFor(exportCopy));
      await shell.evaluate(exportCopy + '.click()');
      assert.ok(await shell.waitFor('window.copied'));
      assert.equal(await shell.evaluate('window.copied'), fromMenu);
      await shell.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      assert.deepEqual(shell.problems, []);
      // Framed by another page at #view-inline: no bar, the read-only view, and slide links the framing page follows.
      const host = await framing(`${state.url}/a/${id}#view-inline`);
      try {
        const framed = await browser.load(host.url, { ready: inlineSlide('cover') });
        try {
          assert.deepEqual((await framed.evaluateAll(`Boolean(document.querySelector('header button[aria-label="Share"]'))`)).filter(Boolean), []);
          await framed.evaluate(`document.getElementById('framed').src = ${JSON.stringify(`${state.url}/a/${id}#slide-~end`)}`);
          assert.ok(await framed.waitFor(`${inlineSlide('end')} && ${inlinePager}?.textContent.includes('3 / 3')`));
          assert.deepEqual(framed.problems, []);
        } finally {
          await framed.close();
        }
      } finally {
        await host.close();
      }
      // A host that said hello hears where the deck is, and can send it to a place.
      const placing = await framing(`${state.url}/a/${id}#slide-~plan`, `window.places = [];
        addEventListener('message', event => {
          const message = event.data;
          if (message?.openArtifact === 'shell_hello') event.source.postMessage({ openArtifact: 'host_hello', caps: {} }, event.origin);
          if (message?.openArtifact === 'place') places.push(message.hash);
        });
        window.goto = hash => document.getElementById('framed').contentWindow.postMessage({ openArtifact: 'goto', hash }, '*');`);
      try {
        const hosted = await browser.load(placing.url, { ready: `window.places?.at(-1) === '#slide-~plan'` });
        try {
          await hosted.evaluate(`goto('#slide-~end.only')`);
          assert.ok(await hosted.waitFor(`places.at(-1) === '#slide-~end.only.3.3'`));
          const heard = await hosted.evaluate('places.length');
          await hosted.evaluate(`goto('#slide-~gone')`);
          assert.ok(await hosted.waitFor(`places.length > ${heard} && places.at(-1) === '#slide-~end.only.3.3'`));
          const again = await hosted.evaluate('places.length');
          await hosted.evaluate(`goto('#view-inline')`);
          assert.ok(await hosted.waitFor(`places.length > ${again} && places.at(-1) === '#slide-~end.only.3.3'`));
          await hosted.evaluate(`goto('#slide-~cover')`);
          assert.ok(await hosted.waitFor(`places.at(-1) === '#slide-~cover'`));
          assert.deepEqual(hosted.problems, []);
        } finally {
          await hosted.close();
        }
      } finally {
        await placing.close();
      }
    } finally {
      await shell?.close();
      await daemon?.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('shows a framed deck read only at #view-inline: one slide with every build, a pager, and changes on disk in place', { skip: browserSkip }, async () => {
    const project = path.join(root, 'project');
    const names = ['deck.json', ...fileNames.map(id => `slides/${id}.html`)];
    const files = () => Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(project, name), 'utf8')]));
    const original = files();
    const host = await framing(url + '#view-inline');
    const viewer = await browser.load(host.url, { ready: inlineSlide('cover') });
    try {
      assert.deepEqual((await viewer.evaluateAll(`document.querySelectorAll('${rail}').length`)).filter(n => n > 0), []);
      // The in-flow build is shown, not waiting for a click.
      assert.ok(await viewer.waitFor(`[...(${inlineSlide('cover')}?.querySelectorAll('p') ?? [])].some(p => p.textContent === 'Details after a click' && getComputedStyle(p).opacity === '1' && getComputedStyle(p).visibility === 'visible')`));
      assert.ok(await viewer.waitFor(`${inlinePager}?.textContent.includes('1 / 3') && ${inlinePager}.querySelector('[aria-label="Previous slide"]').disabled`));
      await viewer.evaluateAll(`document.querySelector('[aria-label="Next slide"]')?.click()`);
      assert.ok(await viewer.waitFor(inlineSlide('plan')));
      await viewer.evaluateAll(`document.querySelector('[aria-label="Next slide"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
      assert.ok(await viewer.waitFor(`${inlineSlide('end')} && ${inlinePager}.querySelector('[aria-label="Next slide"]').disabled && /^Slide 3 of 3/.test(${inlinePager}.querySelector('[role="status"]').textContent)`));
      assert.deepEqual(files(), original);
      // An agent's change shows on the same slide, without reloading the page; a skipped slide leaves the pager.
      await viewer.evaluateAll(`if (document.querySelector('[data-open-artifact-inline-view]')) window.inlineMarker = true`);
      fs.writeFileSync(path.join(project, 'slides/end.html'), '<section id="end"><h1>Thanks</h1></section>');
      assert.ok(await viewer.waitFor(`window.inlineMarker && ${inlineSlide('end')}?.textContent.includes('Thanks')`));
      fs.writeFileSync(path.join(project, 'slides/plan.html'), original['slides/plan.html'].replace('<section id="plan"', '<section id="plan" hidden'));
      assert.ok(await viewer.waitFor(`window.inlineMarker && ${inlineSlide('end')} && ${inlinePager}?.textContent.includes('2 / 2')`));
      assert.deepEqual(viewer.problems, []);
    } finally {
      for (const [name, text] of Object.entries(original)) fs.writeFileSync(path.join(project, name), text);
      await viewer.close();
      await host.close();
    }
  });

  it('shows a reload card, not a blank page, when the editor fails to draw', { skip: browserSkip }, async () => {
    const broken = await browser.load(url, { ready: `document.querySelectorAll('${rail}').length === 3` });
    try {
      // A state update whose updater throws fails the render of a component inside the editor.
      await broken.evaluate(`(() => {
        const root = document.getElementById('root');
        let fiber = root[Object.keys(root).find((k) => k.startsWith('__reactContainer$'))].child;
        while (fiber && !(fiber.tag === 1 && fiber.memoizedState && 'crashed' in fiber.memoizedState)) fiber = fiber.child;
        const stack = [fiber.child];
        while (stack.length) {
          const node = stack.pop();
          if (!node) continue;
          for (let hook = typeof node.type === 'function' ? node.memoizedState : null; hook && typeof hook === 'object' && 'next' in hook; hook = hook.next) {
            if (hook.queue?.dispatch) return hook.queue.dispatch(() => { throw new Error('render failed on purpose'); });
          }
          stack.push(node.sibling, node.child);
        }
      })()`);
      assert.ok(await broken.waitFor(`document.querySelector('[data-testid="slides-crashed"] button')?.textContent.trim() === 'Reload'`));
      assert.match(await broken.crashed(), /slides-crashed/);
      assert.ok((await crashes()).some((what) => what.includes('slides-crashed')));
    } finally {
      await broken.close();
    }
  });

});
