// Exports on a cloud host, in Chrome, the way people make them (decision 26: the host never runs a browser). The real
// host (`packages/host`) on a free port with a data folder of its own, one sample of each type imported, the app on
// `localhost` and each artifact framed from its own `*.content.localhost` origin.
//
// The owner signs in and opens each artifact. Every export the page offers in the Shell's Export tab (and Motion's and
// the design system's own buttons) is started with the real mouse, and the file must arrive as this browser's own
// download (Browser.setDownloadBehavior into a temporary folder): the right name, a plausible size, and the right
// first bytes (`%PDF`, the PNG signature, `PK` with the Office parts for .pptx/.docx/.xlsx, `ftyp` for MP4, `GIF8`).
// A PDF the page prints (Docs, Data) opens the print view and calls `print()`, stubbed in the page before the click:
// the native dialog is not driven.
//
// Then sharing: with "Viewers can download and export" off, a viewer who joined by link is refused with a readable
// message and gets no file; once the owner turns it on, the same export downloads. A Doc's editor and commenter export
// whatever the switch says; a viewer's Docs PDF and Data PDF (prints, not downloads) follow the switch too.
//
// Last, the remote agent's snapshot: an MCP client (the OAuth code flow over plain HTTP, with a client configured by
// OA_OAUTH_CLIENTS and the owner's session cookie read from Chrome) calls Artifact {action: "call", name: "snapshot"};
// the page address it gets opens in a new Chrome with no cookies, stands alone (no Shell, no frame), draws, screenshots,
// writes nothing, and stops working when it expires (OA_TEST_SNAPSHOT_TTL_SECONDS shortens that for this run).
//
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { kindOf, nextDownload, filesIn, noDownload, zipNames } from './lib/downloads.mjs';
import { until } from './lib/http.mjs';
import { browserOff, fixtures, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 300000 };
const MCP_REDIRECT = 'http://127.0.0.1:9/callback';
/** How long a snapshot address lives in this run (seconds): enough to open and look, short enough to wait out. */
const SNAPSHOT_TTL = 30;
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const SAMPLES = {
  slides: path.join(repoRoot, 'test-artifacts', 'slides', 'browser-smoke'),
  design: path.join(fixtures, 'design'),
  'design-system': path.join(fixtures, 'design-system'),
  whiteboard: path.join(repoRoot, 'test-artifacts', 'whiteboard', 'elements'),
  data: path.join(repoRoot, 'test-artifacts', 'data', 'sales-and-signups'),
  sheets: path.join(repoRoot, 'test-artifacts', 'sheets', 'sales'),
  docs: path.join(repoRoot, 'test-artifacts', 'docs', 'browser-qa'),
  motion: path.join(repoRoot, 'test-artifacts', 'motion', 'playback'),
};

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/server/support.js', ...Object.keys(SAMPLES).map(t => `dist/server/editors/${t}/index.html`)];
  const missing = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return missing.length ? `the host's pages are not built (npm run build): no ${missing.join(', ')}` : false;
}

/** A TCP port nobody listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The middle of the element `selector` (an expression) finds, scrolled into view; null when there is none. */
const centerOf = selector => `(() => { const e = ${selector}; if (!e || !e.getClientRects().length) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;

/** Where `selector`'s element is once it has stopped moving (a panel that slides open moves its rows): null if none. */
async function settledAt(read) {
  let at = await read();
  for (let i = 0; i < 20 && at; i++) {
    await sleep(120);
    const now = await read();
    if (now && Math.abs(now[0] - at[0]) < 0.5 && Math.abs(now[1] - at[1]) < 0.5) return now;
    at = now;
  }
  return at;
}

/** Click the element `selector` finds in the Shell with the real mouse, once it is there and still. */
async function clickOn(page, selector, what = selector) {
  assert.ok(await page.waitFor(selector, 15000), `nothing to click: ${what}`);
  const at = await settledAt(() => page.evaluate(centerOf(selector)));
  assert.ok(at, `nothing to click: ${what}`);
  await page.click(...at);
}

/** A button (or menu item, tab, link) by its text, the last one shown. */
const byText = (text, scope = 'document') => `[...${scope}.querySelectorAll('button,[role=menuitem],[role=menuitemradio],[role=tab],[role=option],a')].reverse().find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) && e.getClientRects().length)`;

/** True in the framed page on the artifact's content origin (not the Shell, not a blob: print frame). */
const IN_PAGE = "(location.hostname.endsWith('.content.localhost') && location.protocol === 'http:')";

/** `expression` evaluated in the framed page; the first value it gives there. */
const inPage = (page, expression) => page.evaluateAll(`${IN_PAGE} ? (${expression}) : undefined`).then(values => values.find(v => v !== undefined && v !== null) ?? null);

/** Click, with the real mouse, the element `selector` finds in the framed page (Chrome routes the click into the frame). */
async function clickInPage(page, selector, what = selector) {
  let inner = null;
  await until(async () => (inner = await inPage(page, centerOf(selector))), 20000, 250);
  assert.ok(inner, `nothing to click in the page: ${what}`);
  inner = await settledAt(() => inPage(page, centerOf(selector)));
  assert.ok(inner, `nothing to click in the page: ${what}`);
  const frame = await page.evaluate("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.left, r.top]; })()");
  await page.click(frame[0] + inner[0], frame[1] + inner[1]);
}

/** The Shell's toasts and the page's, as text. */
const toasts = page => page.evaluateAll("[...document.querySelectorAll('[data-sonner-toast],[role=status],[role=alert],[data-toast],li[aria-live],[class*=toast]')].map(e => e.innerText).join(' | ')").then(v => v.join(' | '));

/** Where a page is and what it shows, for a failure's message. */
const pageState = page => page.evaluateAll("location.href + ' :: ' + (document.body?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 300)").then(v => `${v.join(' || ')} (problems: ${page.problems.join('; ').slice(0, 500)})`, e => String(e));

/** The invite link for `role` in the open Share panel, turned on when it is off. */
async function roleLink(page, role) {
  const row = `document.querySelector('[data-share-link=${role}]')`;
  assert.ok(await page.waitFor(row, 15000), `no ${role} link row`);
  if (!(await page.evaluate(`${row}.title.includes('/s/')`))) await clickOn(page, `[...${row}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Turn on')`, `turn on the ${role} link`);
  assert.ok(await page.waitFor(`${row}?.title.includes('/s/')`, 15000), `the ${role} link did not turn on`);
  return page.evaluate(`${row}.title`);
}

/**
 * The Export tab's rows in a Share panel that is open. A panel closing (Escape, a click outside) keeps its rows in the
 * page until its fade-out ends: 100 ms, longer on a busy machine. A click on one of them lands on what is under the
 * panel (the framed page), so a row counts only inside a popup that is open and not animating out.
 */
const OPEN_ROWS = "[...document.querySelectorAll('[data-export-row]')].filter(e => e.closest('[data-open]') && !e.closest('[data-ending-style]'))";

/** Opens the Share panel on its Export tab and waits until the row `label` is there and can be picked. */
async function exportTab(page, label) {
  const ready = `${OPEN_ROWS}.find(e => e.dataset.exportRow === ${JSON.stringify(label)} && !e.disabled)`;
  for (let i = 0; i < 20; i++) {
    if (!(await page.evaluate(`${OPEN_ROWS}.length > 0`))) {
      // A panel still closing goes first, so the Share click below opens a new one.
      await page.waitFor("!document.querySelector('[data-export-row]')", 5000);
      await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
      await sleep(300);
      await clickOn(page, byText('Export'), 'the Export tab');
    }
    if (await page.waitFor(ready, 2000)) return ready;
    await page.press('Escape');
    await sleep(1000);
  }
  const rows = await page.evaluate("[...document.querySelectorAll('[data-export-row]')].map(e => e.dataset.exportRow + (e.disabled ? ' (off)' : ''))");
  assert.fail(`no export row ${label}; rows: ${JSON.stringify(rows)}`);
}

/** Picks the Export tab's row `label` (again if the panel was still closing when it was found). */
async function pickExport(page, label) {
  for (let i = 0; ; i++) {
    const row = await exportTab(page, label);
    const at = await settledAt(() => page.evaluate(centerOf(row)));
    if (at) return page.click(...at);
    assert.ok(i < 5, `the export row ${label} would not stay to be clicked`);
    await sleep(500);
  }
}

/** The Export tab's rows now (labels), the panel closed again. */
async function exportRows(page, waitFor) {
  await exportTab(page, waitFor);
  const rows = await page.evaluate("[...document.querySelectorAll('[data-export-row]')].filter(e => !e.disabled).map(e => e.dataset.exportRow)");
  await page.press('Escape');
  await sleep(300);
  return rows;
}

/** Problems every page here may have: no favicon on the host. */
const IGNORE = [/favicon\.ico/];

describe('exports on a cloud host, made in the browser', { skip: skip() }, () => {
  const ctx = { ids: {} };

  /** The next download, checked: its extension, its kind by its first bytes, at least `min` bytes. */
  async function expectFile(page, what, { ext, kind, min = 64, parts = [], ms = 90000 }) {
    const file = await nextDownload(ctx.dl, ctx.seen, ms);
    assert.ok(file, `${what}: no download after ${ms} ms; the page said: ${await toasts(page)}`);
    assert.ok(file.name.toLowerCase().endsWith(`.${ext}`), `${what}: downloaded ${file.name}, not a .${ext}`);
    assert.equal(kindOf(file.bytes), kind, `${what}: ${file.name} does not start like a ${kind} file`);
    assert.ok(file.bytes.length >= min, `${what}: ${file.name} has only ${file.bytes.length} bytes`);
    if (parts.length) {
      const names = zipNames(file.bytes);
      for (const part of parts) assert.ok(names.some(n => n.startsWith(part)), `${what}: ${file.name} has no ${part} (${names.slice(0, 8).join(', ')})`);
    }
    ctx.made.push(`${what} -> ${file.name} (${file.bytes.length} bytes)`);
    return file;
  }

  /** The artifact's Shell, its framed page drawn. */
  async function open(browser, type, ready = 'document.body.childElementCount > 0') {
    const page = await browser.load(`${ctx.app}/a/${ctx.ids[type]}`, { ready: `${IN_PAGE} && document.readyState === 'complete' && ${ready}`, timeout: 60000, settle: 1500, ignore: IGNORE });
    assert.ok(await page.waitFor(`${IN_PAGE} && ${ready}`, 60000), `the ${type} page did not draw`);
    return page;
  }

  /** Stubs `print()` in the framed page and in any frame it opens (the print view), recording what it would print. */
  const stubPrint = page =>
    inPage(
      page,
      `(() => {
        const record = w => () => { window.__e2ePrinted = { title: w.document.title, text: w.document.body?.innerText.length ?? 0, html: w.document.documentElement.outerHTML.length, own: w === window }; };
        window.print = record(window);
        const frameWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { configurable: true, get() { const w = frameWindow.get.call(this); try { if (w) w.print = record(w); } catch {} return w; } });
        window.__e2ePrinted = null;
        return true;
      })()`,
    );

  before(async () => {
    const data = path.join(tmpDir('host-exports'), 'data');
    const port = await freePort();
    ctx.app = `http://localhost:${port}`;
    ctx.env = {
      ...process.env, OA_DATA_DIR: data, OA_PORT: String(port), OA_BIND: '127.0.0.1', OA_APP_ORIGIN: ctx.app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`,
      // The snapshot case: an MCP client of our own, and page addresses that expire in seconds, not minutes.
      OA_OAUTH_CLIENTS: JSON.stringify([{ client_id: 'e2e', client_name: 'E2E agent', redirect_uris: [MCP_REDIRECT] }]),
      OA_TEST_SNAPSHOT_TTL_SECONDS: String(SNAPSHOT_TTL),
    };
    delete ctx.env.OA_OWNER_KEY;
    delete ctx.env.OA_SIGNING_KEYS;
    for (const [type, folder] of Object.entries(SAMPLES)) {
      const imported = spawnSync(process.execPath, [MAIN, 'import', folder], { env: ctx.env, encoding: 'utf8', timeout: 60000 });
      assert.equal(imported.status, 0, `import of ${type} failed: ${imported.stderr}`);
      ctx.ids[type] = /as (art_[0-9a-z]+)/.exec(imported.stdout)?.[1];
      assert.ok(ctx.ids[type], imported.stdout);
      assert.match(imported.stdout, new RegExp(`\\(${type}\\)`));
    }
    ctx.log = '';
    ctx.host = spawn(process.execPath, [MAIN, 'serve'], { env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.host.stdout.on('data', chunk => (ctx.log += chunk));
    ctx.host.stderr.on('data', chunk => (ctx.log += chunk));
    ctx.stopHost = () => ctx.host.exitCode === null && ctx.host.kill('SIGKILL');
    process.on('exit', ctx.stopHost);
    const signIn = () => /(http:\/\/\S+\/auth\/sign-in#key=\S+)/.exec(ctx.log)?.[1];
    await until(signIn, 30000);
    assert.ok(signIn(), `the host printed no sign-in address:\n${ctx.log}`);
    ctx.dl = tmpDir('host-exports-downloads');
    ctx.seen = filesIn(ctx.dl);
    ctx.made = [];
    ctx.owner = await launch();
    await ctx.owner.downloadsTo(ctx.dl);
    const page = await ctx.owner.load(signIn(), { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    await clickOn(page, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await page.waitFor(`location.href === ${JSON.stringify(`${ctx.app}/`)}`, 20000), 'the owner did not get signed in');
    await page.close();
  });

  after(async () => {
    if (ctx.made?.length) console.log(`# downloads:\n#   ${ctx.made.join('\n#   ')}`);
    await ctx.owner?.close();
    await ctx.viewer?.close();
    if (ctx.host) {
      const exited = new Promise(resolve => (ctx.host.exitCode !== null ? resolve() : ctx.host.once('exit', resolve)));
      ctx.host.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      ctx.stopHost();
      process.off('exit', ctx.stopHost);
    }
    removeTmp();
  });

  it('Slides: PDF, three PowerPoints, a web page, a slide picture and the folder', T, async () => {
    const page = await open(ctx.owner, 'slides');
    const title = 'Slides Browser Smoke';
    // PDF and the web page ask first, in a dialog of the page's own.
    await pickExport(page, 'PDF');
    await clickInPage(page, `[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Download')`, 'Download PDF');
    assert.equal((await expectFile(page, 'Slides PDF', { ext: 'pdf', kind: 'pdf', min: 1000 })).name, `${title}.pdf`);
    for (const variant of ['current fonts', 'basic fonts', 'slides as pictures']) {
      await pickExport(page, `PowerPoint · PowerPoint, ${variant}`);
      await expectFile(page, `Slides PowerPoint (${variant})`, { ext: 'pptx', kind: 'zip', min: 1000, parts: ['ppt/presentation.xml', '[Content_Types].xml'] });
    }
    await pickExport(page, 'Web page (.html)');
    await clickInPage(page, `[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Download')`, 'Download web page');
    await expectFile(page, 'Slides web page', { ext: 'html', kind: 'html', min: 1000 });
    await pickExport(page, 'Current slide as image (.png)');
    await expectFile(page, 'Slides PNG', { ext: 'png', kind: 'png', min: 1000 });
    await pickExport(page, 'Whole folder (.zip)');
    await expectFile(page, 'Slides folder', { ext: 'zip', kind: 'zip', min: 200 });
    await page.close();
  });

  it('Design: every artboard as PNGs, a PDF, the web pages and the canvas, and the folder', T, async () => {
    const page = await open(ctx.owner, 'design');
    await pickExport(page, 'PNG · All artboards on this page (.zip)');
    await expectFile(page, 'Design PNGs', { ext: 'zip', kind: 'zip', min: 200, parts: [] });
    await pickExport(page, 'PDF · All artboards on this page');
    await expectFile(page, 'Design PDF', { ext: 'pdf', kind: 'pdf', min: 1000 });
    await pickExport(page, 'HTML · Standalone web page (all artboards on this page)');
    await expectFile(page, 'Design web page', { ext: 'html', kind: 'html', min: 1000 });
    await pickExport(page, 'HTML · All artboards on this page for Figma');
    await expectFile(page, 'Design for Figma', { ext: 'html', kind: 'html', min: 200 });
    await pickExport(page, 'HTML · The whole canvas with an index and a README (.zip)');
    await expectFile(page, 'Design canvas', { ext: 'zip', kind: 'zip', min: 200 });
    await pickExport(page, 'Whole folder (.zip)');
    await expectFile(page, 'Design folder', { ext: 'zip', kind: 'zip', min: 200 });
    await page.close();
  });

  it('Design system: a file from the Files view, and the folder', T, async () => {
    const page = await open(ctx.owner, 'design-system');
    await clickInPage(page, `[...document.querySelectorAll('a,button,[role=tab],[role=treeitem]')].find(e => /^Files\\s*\\d*$/.test(e.textContent.trim()))`, 'the Files view');
    await clickInPage(page, `[...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'tokens.json')`, 'tokens.json');
    await clickInPage(page, `document.querySelector('button[aria-label="Download"]')`, 'Download');
    const file = await expectFile(page, 'Design system file', { ext: 'json', kind: 'json', min: 20 });
    assert.equal(file.name, 'tokens.json');
    await pickExport(page, 'Whole folder (.zip)');
    await expectFile(page, 'Design system folder', { ext: 'zip', kind: 'zip', min: 200 });
    await page.close();
  });

  it('Whiteboard: the board as a PNG and as a file, and the folder', T, async () => {
    const page = await open(ctx.owner, 'whiteboard', "document.querySelector('#wb-e1')");
    await pickExport(page, 'PNG image');
    assert.equal((await expectFile(page, 'Whiteboard PNG', { ext: 'png', kind: 'png', min: 10000 })).name, 'Whiteboard element test.png');
    await pickExport(page, 'Board file');
    await expectFile(page, 'Whiteboard board file', { ext: 'json', kind: 'json', min: 100 });
    await pickExport(page, 'Whole folder (.zip)');
    await expectFile(page, 'Whiteboard folder', { ext: 'zip', kind: 'zip', min: 200 });
    // Nothing went wrong on the way: the page said no "Could not export".
    assert.doesNotMatch(await toasts(page), /Could not export|Illegal invocation/);
    await page.close();
  });

  it('Data: the PDF prints the dashboard; the web page, the JSON and the folder download', T, async () => {
    const page = await open(ctx.owner, 'data');
    await exportTab(page, 'Web page (HTML)');
    await page.press('Escape');
    assert.ok(await stubPrint(page));
    await pickExport(page, 'PDF');
    assert.ok(await page.waitFor(`${IN_PAGE} && window.__e2ePrinted`, 30000), `the dashboard did not print; the page said: ${await toasts(page)}`);
    // The stubbed print sends no `afterprint`, so the page counts its dialog open for one more second (`PRINT_SETTLE_MS`)
    // and answers an export asked meanwhile with "Another export is running" (a toast long gone by the timeout below).
    await sleep(1500);
    await pickExport(page, 'Web page (HTML)');
    await expectFile(page, 'Data web page', { ext: 'html', kind: 'html', min: 500 });
    await pickExport(page, 'Sources and page (JSON)');
    await expectFile(page, 'Data JSON', { ext: 'json', kind: 'json', min: 100 });
    await pickExport(page, 'Whole folder (.zip)');
    await expectFile(page, 'Data folder', { ext: 'zip', kind: 'zip', min: 200 });
    assert.doesNotMatch(await toasts(page), /Could not export|Illegal invocation/);
    await page.close();
  });

  it('Sheets: Excel, CSV and the folder', T, async () => {
    const page = await open(ctx.owner, 'sheets');
    await pickExport(page, 'Excel');
    await expectFile(page, 'Sheets Excel', { ext: 'xlsx', kind: 'zip', min: 1000, parts: ['xl/workbook.xml'] });
    await pickExport(page, 'CSV');
    await expectFile(page, 'Sheets CSV', { ext: 'csv', kind: 'text', min: 20 });
    await pickExport(page, 'Whole folder (.zip)');
    await expectFile(page, 'Sheets folder', { ext: 'zip', kind: 'zip', min: 200 });
    await page.close();
  });

  it('Docs: Word, Markdown, HTML and the folder download; a PDF opens the print view with "Save as PDF"', T, async () => {
    const page = await open(ctx.owner, 'docs', "document.querySelector('.ProseMirror')");
    await pickExport(page, 'Word (.docx) · Whole document');
    await expectFile(page, 'Docs Word', { ext: 'docx', kind: 'zip', min: 1000, parts: ['word/document.xml'] });
    await pickExport(page, 'Markdown (.md) · Whole document');
    await expectFile(page, 'Docs Markdown', { ext: 'md', kind: 'text', min: 20 });
    await pickExport(page, 'HTML (.html) · Whole document');
    await expectFile(page, 'Docs HTML', { ext: 'html', kind: 'html', min: 500 });
    // The host prints no PDF: the page opens its print view and the browser's print dialog, and says what to pick.
    assert.ok(await stubPrint(page));
    await pickExport(page, 'PDF (.pdf) · Whole document · A4');
    assert.ok(await page.waitFor(`${IN_PAGE} && window.__e2ePrinted`, 30000), `the print view did not print; the page said: ${await toasts(page)}`);
    const printed = await inPage(page, 'window.__e2ePrinted');
    assert.equal(printed.own, false, 'the print view, not the editor, prints');
    assert.ok(printed.text > 20, `the print view is empty: ${JSON.stringify(printed)}`);
    assert.match(await toasts(page), /Save as PDF/);
    assert.equal(await noDownload(ctx.dl, ctx.seen, 2000), true, 'a PDF from the browser is not a download');
    await pickExport(page, 'Whole folder (.zip)');
    await expectFile(page, 'Docs folder', { ext: 'zip', kind: 'zip', min: 200 });
    assert.doesNotMatch(await toasts(page), /Couldn’t export|Illegal invocation/);
    await page.close();
  });

  it('Docs: the exported file keeps the doc’s name', T, async () => {
    // The Shell's broker reads the doc export cross-origin: without the header it cannot see the name, and calls it doc.md.
    const page = await open(ctx.owner, 'docs', "document.querySelector('.ProseMirror')");
    await pickExport(page, 'Markdown (.md) · Whole document');
    const file = await expectFile(page, 'Docs Markdown (named)', { ext: 'md', kind: 'text', min: 20 });
    await page.close();
    assert.equal(file.name, 'Docs Browser QA.md');
  });

  it('Motion: MP4, GIF, a page and the code from its Export dialog', T, async () => {
    const page = await open(ctx.owner, 'motion');
    const formats = { MP4: ['mp4', 'mp4'], GIF: ['gif', 'gif'], Page: ['html', 'html'], Code: ['zip', 'zip'] };
    const skipped = [];
    for (const [label, [ext, kind]] of Object.entries(formats)) {
      await clickInPage(page, `document.querySelector('button[aria-label="Export"]:not(:disabled)')`, 'Export');
      await clickInPage(page, `[...document.querySelectorAll('[role=dialog] [aria-label="Format"] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`, label);
      await sleep(1500);
      const exportButton = `[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Export' && !b.disabled)`;
      if (label === 'MP4' && !(await until(() => inPage(page, `!!(${exportButton})`), 20000, 250))) {
        // No H.264 encoder in this Chrome (WebCodecs): the dialog says so and offers no export.
        skipped.push(`MP4 (${(await inPage(page, "document.querySelector('[role=dialog]')?.innerText"))?.replace(/\s+/g, ' ').slice(0, 160)})`);
        await page.press('Escape');
        await until(() => page.evaluateAll("!document.querySelector('[role=dialog]')").then(all => all.every(Boolean)), 10000, 200);
        continue;
      }
      await clickInPage(page, exportButton, `Export ${label}`);
      await expectFile(page, `Motion ${label}`, { ext, kind, min: 1000, ms: 240000 });
      assert.ok(await until(() => inPage(page, "/Your browser saves it to its downloads/.test(document.querySelector('[role=dialog]')?.innerText ?? '')"), 10000), 'the dialog does not say where the file went');
      await clickInPage(page, `[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Done')`, 'Done');
      // The dialog fades out; the next Export click must not land on it.
      assert.ok(await until(() => page.evaluateAll("!document.querySelector('[role=dialog]')").then(all => all.every(Boolean)), 10000, 200), 'the export dialog did not close');
    }
    if (skipped.length) console.log(`# skipped in this Chrome: ${skipped.join('; ')}`);
    await pickExport(page, 'Whole folder (.zip)');
    await expectFile(page, 'Motion folder', { ext: 'zip', kind: 'zip', min: 200 });
    await page.close();
  });

  /** A person who joins by `link` in a Chrome of their own, named `name`: the browser, its download folder, the page. */
  async function join(link, name, ready, people) {
    const browser = await launch();
    people.push({ browser });
    const dl = tmpDir(`host-exports-${name.split(' ')[0].toLowerCase()}`);
    await browser.downloadsTo(dl);
    const seen = filesIn(dl);
    const page = await browser.load(link, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    await clickOn(page, "document.querySelector('input[name=name]')", 'the name field');
    await page.type(name);
    await clickOn(page, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await page.waitFor(`${IN_PAGE} && ${ready}`, 60000), `${name}'s page did not draw: ${await pageState(page)}`);
    return { browser, dl, seen, page };
  }

  /** Sets the owner's "Viewers can download and export" switch in the open Shell of `page`. */
  async function viewersMayExport(page, on) {
    const setting = "document.querySelector('[aria-label=\"Viewers can download and export\"]')";
    const state = `(${setting}.getAttribute('aria-checked') ?? String(${setting}.checked))`;
    if (!(await page.evaluate(`!!${setting}`))) await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
    assert.ok(await page.waitFor(setting, 15000), 'no export setting');
    if ((await page.evaluate(state)) !== String(on)) await clickOn(page, setting, 'Viewers can download and export');
    assert.ok(await page.waitFor(`${state} === '${on}'`, 10000), `the setting did not turn ${on ? 'on' : 'off'}`);
  }

  /** Opens `type`'s Share panel as the owner, sets anyone with the link, and returns the page and the role links. */
  async function shareByLinks(type, ready, roles) {
    const page = await open(ctx.owner, type, ready);
    await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
    await clickOn(page, "document.querySelector('[aria-label=\"General access\"]')", 'General access');
    await clickOn(page, byText('Anyone with the link'), 'Anyone with the link');
    const links = {};
    for (const role of roles) links[role] = await roleLink(page, role);
    return { page, links };
  }

  it('Docs: an editor and a commenter export; a viewer, Data too, by the owner’s switch, the print buttons included', T, async () => {
    const DOC = "document.querySelector('.ProseMirror')";
    const { page: owner, links } = await shareByLinks('docs', DOC, ['editor', 'commenter', 'viewer']);
    await viewersMayExport(owner, false);
    await owner.press('Escape');
    const people = [];
    try {
      // The switch is for viewers: an editor and a commenter download a Doc either way, under its own name.
      for (const role of ['editor', 'commenter']) {
        const person = await join(links[role], `Pat the ${role}`, DOC, people);
        await pickExport(person.page, 'Markdown (.md) · Whole document');
        const file = await nextDownload(person.dl, person.seen, 60000);
        assert.ok(file, `the ${role} got no file: ${await toasts(person.page)}`);
        assert.equal(file.name, 'Docs Browser QA.md', `the ${role}'s file`);
        assert.equal(kindOf(file.bytes), 'text');
        ctx.made.push(`Docs Markdown as ${role} -> ${file.name} (${file.bytes.length} bytes)`);
        await person.browser.close();
      }

      // A viewer is refused a download and the PDF print alike, in words they can read, and gets nothing.
      const viewer = await join(links.viewer, 'Vic the viewer', DOC, people);
      await pickExport(viewer.page, 'Markdown (.md) · Whole document');
      assert.ok(await until(async () => /not let viewers download or export/.test(await toasts(viewer.page)), 20000), `no readable refusal: ${await toasts(viewer.page)}`);
      assert.ok(await stubPrint(viewer.page));
      await pickExport(viewer.page, 'PDF (.pdf) · Whole document · A4');
      await sleep(3000);
      assert.equal(await inPage(viewer.page, 'window.__e2ePrinted'), null, 'the Docs PDF printed for a viewer while the owner says no');
      assert.equal(await noDownload(viewer.dl, viewer.seen, 2000), true, 'the viewer got a file');

      // On: the viewer's Doc downloads, and its PDF prints.
      await viewersMayExport(owner, true);
      await owner.press('Escape');
      let file = null;
      for (let i = 0; i < 5 && !file; i++) {
        await sleep(2000);
        await pickExport(viewer.page, 'Markdown (.md) · Whole document');
        file = await nextDownload(viewer.dl, viewer.seen, 15000);
      }
      assert.ok(file, `the viewer still got no file: ${await toasts(viewer.page)}`);
      assert.equal(file.name, 'Docs Browser QA.md');
      ctx.made.push(`Docs Markdown as viewer (allowed) -> ${file.name} (${file.bytes.length} bytes)`);
      assert.ok(await stubPrint(viewer.page));
      await pickExport(viewer.page, 'PDF (.pdf) · Whole document · A4');
      assert.ok(await viewer.page.waitFor(`${IN_PAGE} && window.__e2ePrinted`, 30000), `the viewer's PDF did not print: ${await toasts(viewer.page)}`);

      // The Data PDF (a print too) follows the same switch (last: it needs the dashboard settled, see the Data case).
      const data = await shareByLinks('data', 'document.body.childElementCount > 0', ['viewer']);
      await viewersMayExport(data.page, false);
      await data.page.press('Escape');
      const dataViewer = await viewer.browser.load(data.links.viewer, { ready: `document.querySelector('input[name=name]') || (${IN_PAGE})`, ignore: IGNORE });
      if (await dataViewer.evaluate("!!document.querySelector('input[name=name]')")) {
        await clickOn(dataViewer, "document.querySelector('input[name=name]')", 'the name field');
        await dataViewer.type('Vic the viewer');
        await clickOn(dataViewer, "document.querySelector('form button[type=submit]')", 'Open it');
      }
      assert.ok(await dataViewer.waitFor(`${IN_PAGE} && document.body.childElementCount > 0`, 60000), "the viewer's dashboard did not draw");
      await exportTab(dataViewer, 'PDF');
      await dataViewer.press('Escape');
      assert.ok(await stubPrint(dataViewer));
      await pickExport(dataViewer, 'PDF');
      assert.ok(await until(async () => /not let viewers download or export/.test(await toasts(dataViewer)), 20000), `no readable Data PDF refusal: ${await toasts(dataViewer)}`);
      assert.equal(await inPage(dataViewer, 'window.__e2ePrinted'), null, 'the dashboard printed for a viewer while the owner says no');
      await dataViewer.close();
      await viewersMayExport(data.page, true);
      await data.page.close();

    } finally {
      for (const person of people) await person.browser.close().catch(() => {});
      await owner.close();
    }
  });

  /** One JSON-RPC call to `/mcp` with `token`; the answer's `result` (a JSON or event-stream answer). */
  async function mcp(token, method, params) {
    const response = await fetch(`${ctx.app}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const text = await response.text();
    assert.equal(response.status, 200, `${method}: HTTP ${response.status} ${text}`);
    const json = text.trimStart().startsWith('{') ? text : /^data: (.*)$/m.exec(text)?.[1];
    const body = JSON.parse(json);
    assert.ok(!body.error, `${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  }

  /** An MCP access token for the signed-in owner: the OAuth code flow over HTTP with the owner's session cookie. */
  async function ownerMcpToken() {
    const probe = await ctx.owner.load(`${ctx.app}/`, { ready: "document.readyState === 'complete'", ignore: IGNORE });
    const { cookies } = await probe.cdp('Network.getCookies', { urls: [ctx.app] });
    await probe.close();
    const cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    assert.ok(cookie, 'the owner has no session cookie');
    const refused = await fetch(`${ctx.app}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' });
    assert.equal(refused.status, 401);
    const resource = await (await fetch(/resource_metadata="([^"]+)"/.exec(refused.headers.get('www-authenticate') ?? '')[1])).json();
    const server = await (await fetch(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
    const verifier = randomBytes(32).toString('base64url');
    const params = { response_type: 'code', client_id: 'e2e', redirect_uri: MCP_REDIRECT, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 's1', resource: resource.resource, scope: 'artifacts.read' };
    const consent = await fetch(`${server.authorization_endpoint}?${new URLSearchParams(params)}`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(consent.status, 200, 'no consent page for the signed-in owner');
    const approved = await fetch(server.authorization_endpoint, {
      method: 'POST',
      headers: { cookie, origin: ctx.app, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, decision: 'approve' }),
      redirect: 'manual',
    });
    const code = new URL(approved.headers.get('location')).searchParams.get('code');
    assert.ok(code, `no code: ${approved.status} ${approved.headers.get('location')}`);
    const token = await fetch(server.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: 'e2e', redirect_uri: MCP_REDIRECT, code_verifier: verifier }),
    });
    assert.equal(token.status, 200);
    return (await token.json()).access_token;
  }

  it('an agent’s snapshot address opens alone in a browser with no cookies, writes nothing, and expires', T, async () => {
    const token = await ownerMcpToken();
    await mcp(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
    const url = `open-artifact://artifact/${ctx.ids.whiteboard}`;
    const call = async args => JSON.parse((await mcp(token, 'tools/call', { name: 'Artifact', arguments: args })).content[0].text);
    const before = await call({ action: 'read', url });
    assert.ok(before.actions.some(a => a.name === 'snapshot'), `snapshot is not among the actions: ${before.actions.map(a => a.name)}`);
    const snap = await call({ action: 'call', url, name: 'snapshot', args: { width: 1200, height: 800 } });
    assert.ok(!snap.error, JSON.stringify(snap));
    assert.equal(snap.read_only, true);
    assert.equal(snap.expires_in, SNAPSHOT_TTL);
    assert.match(snap.page_url, /^http:\/\/art-[0-9a-z]+\.content\.localhost:\d+\/whiteboard\/v1\./);
    const expiresAt = Date.parse(snap.expires_at);

    // A browser of its own: no cookies, no Shell.
    const agent = await launch({ width: snap.width, height: snap.height });
    try {
      const page = await agent.load(snap.page_url, { ready: `${IN_PAGE} && document.querySelector('#wb-e1')`, timeout: 60000, settle: 1000, ignore: IGNORE });
      assert.ok(await page.waitFor("document.querySelector('#wb-e1')", 30000), `the snapshot page did not draw: ${page.problems.join('; ')}`);
      assert.equal(await page.evaluate('window.top === window && !document.querySelector("iframe[src*=\'content.localhost\']")'), true, 'the snapshot page is not standing alone');
      assert.equal(await page.evaluate('location.href'), snap.page_url, 'the snapshot page went somewhere else');
      assert.equal((await page.cdp('Network.getCookies', { urls: [ctx.app, snap.page_url] })).cookies.length, 0, 'the snapshot browser has cookies');
      const shot = Buffer.from((await page.cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64');
      assert.equal(kindOf(shot), 'png');
      assert.ok(shot.length > 5000, `the screenshot is ${shot.length} bytes`);
      ctx.made.push(`snapshot screenshot (${shot.length} bytes)`);

      // A write from the page is answered and dropped.
      const write = await page.evaluate(`fetch('_api/db/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client: 'e2e-snap', writes: [{ op: 'set', path: 'elements/e2e-snap', data: { type: 'note', x: 0, y: 0, text: 'from a snapshot', color: 'yellow' } }] }) }).then(r => r.status)`);
      assert.equal(write, 200);
      const got = await page.evaluate("fetch('_api/db/get?path=elements%2Fe2e-snap').then(r => r.json()).then(b => b.data ?? null)");
      assert.equal(got, null, 'the snapshot page wrote to the artifact');
      const after = await call({ action: 'read', url });
      assert.ok(!after.files.some(f => f.path.includes('e2e-snap')), 'a file of the snapshot write is on the host');

      // Past its expiry: the page's calls are refused, and the address no longer opens the page.
      await sleep(Math.max(0, expiresAt - Date.now()) + 1500);
      // (Asked from here: the page itself may already be gone, its event stream closed at the expiry.)
      const target = new URL(snap.page_url);
      const status = await new Promise((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port: target.port, path: `${target.pathname}_api/session`, headers: { host: target.host } }, res => (res.resume(), resolve(res.statusCode)));
        req.on('error', reject);
        req.end();
      });
      assert.equal(status, 403, 'the snapshot address still reads after it expired');
      const late = await agent.load(snap.page_url, { ready: "document.readyState === 'complete'", timeout: 30000, ignore: [...IGNORE, /403|401|sign-in|Failed to load/] });
      assert.equal(await late.evaluate("!!document.querySelector('#wb-e1')"), false, 'the expired address still drew the board');
    } finally {
      await agent.close();
    }
  });

  it('a viewer is refused while "Viewers can download and export" is off, and downloads once it is on', T, async () => {
    const page = await open(ctx.owner, 'whiteboard', "document.querySelector('#wb-e1')");
    // The owner: anyone with the link, and viewers may not export.
    await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
    await clickOn(page, "document.querySelector('[aria-label=\"General access\"]')", 'General access');
    await clickOn(page, byText('Anyone with the link'), 'Anyone with the link');
    assert.ok(await page.waitFor("document.querySelector('[data-share-link=viewer]')?.title.includes('/s/')", 15000), 'no viewer link');
    const link = await page.evaluate("document.querySelector('[data-share-link=viewer]').title");
    const setting = "document.querySelector('[aria-label=\"Viewers can download and export\"]')";
    assert.equal(await page.evaluate(`${setting}.getAttribute('aria-checked') ?? String(${setting}.checked)`), 'true', 'viewers may export by default');
    await clickOn(page, setting, 'Viewers can download and export');
    assert.ok(await page.waitFor(`(${setting}.getAttribute('aria-checked') ?? String(${setting}.checked)) === 'false'`, 10000), 'the setting did not turn off');
    await page.press('Escape');

    // A viewer joins by the link and tries the PNG export.
    ctx.viewer = await launch();
    const viewerDl = tmpDir('host-exports-viewer');
    await ctx.viewer.downloadsTo(viewerDl);
    const seen = filesIn(viewerDl);
    const join = await ctx.viewer.load(link, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    await clickOn(join, "document.querySelector('input[name=name]')", 'the name field');
    await join.type('Vera the viewer');
    await clickOn(join, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await join.waitFor(`${IN_PAGE} && document.querySelector('#wb-e1')`, 60000), `the viewer's page did not draw: ${await pageState(join)}`);
    await pickExport(join, 'PNG image');
    assert.ok(await until(async () => /not let viewers download or export/.test(await toasts(join)), 20000), `no readable refusal: ${await toasts(join)}`);
    assert.equal(await noDownload(viewerDl, seen, 4000), true, 'the viewer got a file');

    // The owner turns it on; the viewer's export downloads.
    await clickOn(page, "document.querySelector('header button[aria-label=\"Share\"]')", 'Share');
    await clickOn(page, setting, 'Viewers can download and export');
    assert.ok(await page.waitFor(`(${setting}.getAttribute('aria-checked') ?? String(${setting}.checked)) === 'true'`, 10000), 'the setting did not turn on');
    await page.press('Escape');
    let file = null;
    for (let i = 0; i < 5 && !file; i++) {
      await sleep(2000);
      await pickExport(join, 'PNG image');
      file = await nextDownload(viewerDl, seen, 15000);
    }
    assert.ok(file, `the viewer still got no file: ${await toasts(join)}`);
    assert.equal(kindOf(file.bytes), 'png');
    await join.close();
    await page.close();
  });
});
