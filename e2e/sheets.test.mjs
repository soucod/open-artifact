// End-to-end tests of the sheets type: update and read on a folder with no server (a read there is refused, a
// first update makes the Sheet), refusals as JSON on stderr, check, export to Excel and CSV, then open: the page shows the workbook, an
// update sent while it is open reaches it at once, a chart made with batch is drawn in its frame, comments, and stop.
// In the page as a person uses it: an interactive tab's controls, its defaults kept and brought back, and the keys in and
// out of it; a link to cells and a walkthrough from the agent; a page opened again on an edited workbook, a copy, and a
// value cleared from a drawn row; columns of a table dragged and undone; a pivot table and its aggregate; saved views,
// kept over a reload, updated after their sort was left out; and undo of a sort of one's own.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expectStatus, postJson, until } from './lib/http.mjs';
import { after, before, describe, it } from 'node:test';
import { launch } from './lib/browser.mjs';
import { cli } from './lib/cli.mjs';
import { textIn } from './lib/editor.mjs';
import { browserOff, install, removeTmp, tmpDir, typePath } from './lib/target.mjs';

const T = { timeout: 90000 };
const TYPE = 'sheets';

function skip() {
  const dir = typePath(TYPE);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return `${TYPE} is not in ${dir}`;
  const missing = ['scripts/cli.mjs', 'scripts/sheets.wasm', 'scripts/editors/sheets/index.html', 'scripts/editors/sheets/assets/chart-frame.txt', 'scripts/editors/sheets/assets/interactive-frame.txt'].filter(f => !fs.existsSync(path.join(dir, f)));
  return missing.length ? `${TYPE} is not built (npm run build): no ${missing.join(', ')}` : false;
}

const edits = (base, list) => JSON.stringify({ kind: 'applyEdits', base, edits: list });
const refusalOf = out => JSON.parse(out.stderr.trim().split('\n').pop()).data.refusal;
const formulaBar = `document.querySelector('textarea[aria-label="Formula bar"]')`;

describe(TYPE, { skip: skip() }, () => {
  const ctx = {};

  before(() => {
    const { dir } = install(typePath(TYPE), TYPE);
    ctx.cli = cli(dir, {
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmpDir('sheets-state'), 'state'),
      HOME: tmpDir('sheets-home'),
      OPEN_ARTIFACT_USER: 'E2E',
    });
    ctx.root = path.join(tmpDir('sheets-root'), 'budget');
    fs.mkdirSync(ctx.root, { recursive: true });
  });

  after(async () => {
    await ctx.browserPromise?.then(b => b.close()).catch(() => {});
    await ctx.cli?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('a read on a folder with no Sheet says to start it with an update', T, async () => {
    const out = await ctx.cli.run(['read', ctx.root]);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout + out.stderr, /NOT_A_SHEET/);
    assert.ok(!fs.existsSync(path.join(ctx.root, 'sheet')));
  });

  it('a first update makes a Sheet of one blank sheet, Sheet1, and applies its edits to it', T, async () => {
    const out = await ctx.cli.json(['update', ctx.root, edits(1, [
      { kind: 'renameSheet', sheet: 'Sheet1', name: 'Budget' },
      { kind: 'writeCells', sheet: 'Budget', topLeft: 'A1', rows: [['Item', 'Cost'], ['Rent', 1200], ['Food', 300], ['Total', '=SUM(B2:B3)']] },
    ])]);
    assert.equal(out.revision, 2);
    assert.ok(fs.existsSync(path.join(ctx.root, 'sheet', 'sheet.json')));
    const info = await ctx.cli.json(['info', ctx.root, '--json']);
    assert.deepEqual([info.revision, info.title], [2, 'Untitled sheet']);
    const sheets = await ctx.cli.json(['read', ctx.root]);
    assert.deepEqual(sheets.sheets.map(s => s.name), ['Budget']);
  });

  it('read gives what cells hold: values, and formulas with what they work out to', T, async () => {
    const cells = await ctx.cli.json(['read', ctx.root, JSON.stringify({ kind: 'readCells', sheet: 'Budget', range: 'A1:B4' })]);
    assert.deepEqual(cells.rows['2'], ['Rent', 1200]);
    assert.deepEqual(cells.rows['4'], ['Total', { formula: '=SUM(B2:B3)', value: 1500 }]);
  });

  // JimLiu/open-artifact#17: the page shows a formula with many words of its own to the person before pasting it
  // (toBeShownFirst, and more than 50 such texts refuse); an agent's writeCells shows nothing first.
  it('writeCells takes formulas with many words of their own, in any script, and more than 50 of them at once', T, async () => {
    const root = path.join(tmpDir('sheets-long-texts'), 'orders');
    fs.mkdirSync(root, { recursive: true });
    const summary = '="数据区间 "&TEXT(MIN(A:A),"yyyy-mm-dd")&" 至 "&TEXT(MAX(A:A),"yyyy-mm-dd")&" · 共 "&C1&" 笔订单"';
    const cjk = '=IF(C1>=40,"高毛利核心产品线","常规需优化产品线")';
    const ascii = '=IF(C1>=40,"a high margin core product line","a regular line to optimize")';
    const many = Array.from({ length: 60 }, (_, i) => [`=IF(C1>=40,"第${i + 1}组高毛利核心产品线","常规需优化产品线")`]);
    const out = await ctx.cli.run(['update', root, edits(1, [
      { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: [[{ date: '2026-01-05' }, summary, 42], [{ date: '2026-03-31' }, cjk, null], [null, ascii, null]] },
      { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'E1', rows: many },
    ])]);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).revision, 2);
    const cells = await ctx.cli.json(['read', root, JSON.stringify({ kind: 'readCells', sheet: 'Sheet1', range: 'B1:B3' })]);
    assert.deepEqual(cells.rows, {
      1: [{ formula: summary, value: '数据区间 2026-01-05 至 2026-03-31 · 共 42 笔订单' }],
      2: [{ formula: cjk, value: '高毛利核心产品线' }],
      3: [{ formula: ascii, value: 'a high margin core product line' }],
    });
    const last = await ctx.cli.json(['read', root, JSON.stringify({ kind: 'readCells', sheet: 'Sheet1', range: 'E60' })]);
    assert.deepEqual(last.rows, { 60: [{ formula: many[59][0], value: '第60组高毛利核心产品线' }] });
  });

  it('formats go in and read back as formatCells takes them', T, async () => {
    await ctx.cli.json(['update', ctx.root, edits(2, [{ kind: 'formatCells', sheet: 'Budget', ranges: ['B2:B4'], format: { numberFormat: { pattern: '$#,##0.00' } } }])]);
    const read = await ctx.cli.json(['read', ctx.root, JSON.stringify({ kind: 'readCellFormats', sheet: 'Budget', range: 'B2:B4' })]);
    assert.ok(read.formats.some(f => f.format.numberFormat?.pattern === '$#,##0.00'), JSON.stringify(read));
  });

  it('a stale base, an unknown edit and an unknown key are refused with JSON on stderr, writing nothing', T, async () => {
    const stale = await ctx.cli.run(['update', ctx.root, edits(1, [{ kind: 'addSheet', name: 'Late' }])]);
    assert.equal(stale.code, 1);
    assert.equal(refusalOf(stale), 'baseIsNotTheRevision');
    const unknown = await ctx.cli.run(['update', ctx.root, edits(3, [{ kind: 'paintCells', sheet: 'Budget' }])]);
    assert.equal(unknown.code, 1);
    assert.equal(refusalOf(unknown), 'unreadableEdit');
    const extra = await ctx.cli.run(['update', ctx.root, edits(3, [{ kind: 'addSheet', name: 'X', color: 'red' }])]);
    assert.equal(extra.code, 1);
    const info = await ctx.cli.json(['info', ctx.root, '--json']);
    assert.equal(info.revision, 3);
  });

  it('check passes the Sheet', T, async () => {
    const out = await ctx.cli.json(['check', ctx.root, '--json']);
    assert.equal(out.type, TYPE);
    assert.deepEqual(out.findings, []);
  });

  it('export writes an Excel file and a CSV of one sheet with the worked-out values', T, async () => {
    const xlsx = await ctx.cli.json(['export', ctx.root]);
    assert.match(xlsx.file, /\.xlsx$/);
    assert.equal(fs.readFileSync(xlsx.file).subarray(0, 2).toString(), 'PK');
    const csv = await ctx.cli.json(['export', ctx.root, '--csv', '--sheet', 'Budget']);
    assert.equal(fs.readFileSync(csv.file, 'utf8').trim().split(/\r?\n/).join('|'), 'Item,Cost|Rent,"$1,200.00"|Food,$300.00|Total,"$1,500.00"');
  });

  it('open serves the page, and an update while it is open reaches it at once', T, async () => {
    const opened = await ctx.cli.json(['open', ctx.root, '--json']);
    assert.equal(opened.type, TYPE);
    const again = await ctx.cli.json(['open', ctx.root, '--json']);
    assert.equal(again.url, opened.url, 'open again gave another address');
    const response = await fetch(opened.url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /__OPEN_ARTIFACT_BOOT__/);
    if (browserOff) return;
    ctx.browserPromise ??= launch();
    const page = await (await ctx.browserPromise).load(opened.url, { ready: `document.querySelector('[role=grid][aria-label="Budget"]') !== null && ${formulaBar}?.value === 'Item'`, settle: 800, ignore: [/\/favicon\.ico$/] });
    try {
      assert.ok(await page.waitFor(`${formulaBar}?.value === 'Item'`, 1000), 'the page does not show Budget with A1 selected');
      await ctx.cli.json(['update', ctx.root, edits(3, [{ kind: 'writeCells', sheet: 'Budget', topLeft: 'A1', rows: [['Line']] }])]);
      assert.ok(await page.waitFor(`${formulaBar}?.value === 'Line'`, 10000), 'the open page did not get the update');
      await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      assert.ok(await page.waitFor(`(() => {
        const picker = document.querySelector('[aria-label="All sheets"]')?.getBoundingClientRect();
        const tab = document.querySelector('[role="tab"]')?.getBoundingClientRect();
        return picker?.width === 52 && picker.height === 32 && tab?.height === 32;
      })()`), 'the sheet picker and tabs should use the touch layout');
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });

  it('a chart made with batch is drawn in its sandboxed frame on the open page', T, async () => {
    const code = "export default () => <sheet.Visualize data-component='costs' sources={{rows:{kind:'ref', ref:'input/rows', adapter:{kind:'cells'}}, chartSize:{kind:'data', data:[{width:320, height:200}]}}}>{({rows, chartSize}) => { const {width, height} = chartSize.at(0); const body = rows.slice(1).filter(r => typeof r.at(1).value === 'number'); const most = Math.max(1, ...body.map(r => r.at(1).value)); const band = width / Math.max(1, body.length); return <svg width='320' height='200' viewBox={`0 0 ${width} ${height}`} role='img' aria-label='Costs'>{body.map((r, i) => <Tooltip key={i} content={r.at(0).text} detail={r.at(1).text}><rect x={i * band + 4} y={height - height * r.at(1).value / most} width={band - 8} height={height * r.at(1).value / most} fill='var(--chart-categorical-1)'/></Tooltip>)}</svg>; }}</sheet.Visualize>;";
    const file = path.join(tmpDir('sheets-chart'), 'chart.json');
    fs.writeFileSync(file, JSON.stringify([
      { $lid: 'w', verb: 'create', payload: { code } },
      { verb: 'update', payload: { kind: 'applyEdits', base: 4, edits: [{ kind: 'addChart', chart: { name: 'Costs', caption: '', widget: '$lid:w', inputs: [{ name: 'rows', cells: { sheet: 'Budget', range: 'A1:B3' } }], sheet: 'Budget', topLeft: 'D1', widthInPixels: 320, heightInPixels: 200 } }] } },
    ]));
    const out = await ctx.cli.json(['batch', ctx.root, file]);
    assert.equal(out.acks[0].outcome, 'published', JSON.stringify(out));
    assert.equal(out.acks[1].data.revision, 5);
    const charts = await ctx.cli.json(['read', ctx.root, JSON.stringify({ kind: 'readCharts', sheet: 'Budget' })]);
    assert.equal(charts.charts.length, 1);
    if (browserOff) return;
    const opened = await ctx.cli.json(['open', ctx.root, '--json']);
    ctx.browserPromise ??= launch();
    const page = await (await ctx.browserPromise).load(opened.url, { ready: `document.querySelector('[role=grid][aria-label="Budget"]') !== null`, settle: 800, ignore: [/\/favicon\.ico$/] });
    try {
      assert.ok(await page.waitFor(`document.querySelector('iframe.sheet-chart-frame[data-is-on-show="true"]') !== null`, 20000), 'the chart was not drawn');
      assert.equal((await page.evaluateAll(`document.querySelector('iframe.sheet-chart-frame')?.getAttribute('sandbox')`)).find(Boolean), 'allow-scripts');
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });

  it('hands an Excel upload to a listening agent and removes a declined upload', T, async () => {
    const root = tmpDir('sheets-import');
    const opened = await ctx.cli.json(['open', root, '--type', 'sheets', '--json']);
    await ctx.cli.json(['update', root, edits(1, [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: [['Costs'], [24]] }])]);
    const exported = await ctx.cli.json(['export', root]);
    const bytes = fs.readFileSync(exported.file);
    const upload = async () => {
      const response = await fetch(new URL('_api/sheet/import?name=Costs.xlsx', opened.url), { method: 'POST', body: bytes });
      assert.equal(response.status, 200);
      return response.json();
    };
    const declined = await upload();
    assert.equal(declined.sentToAgent, false);
    assert.equal(fs.existsSync(path.join(root, declined.path)), false);
    const waiter = await ctx.cli.start(['wait', root, '--timeout', '12'], { firstLine: false });
    try {
      assert.ok(await until(() => fs.existsSync(path.join(root, '_agent', 'waiting'))));
      const reply = await upload();
      assert.equal(reply.sentToAgent, true);
      assert.deepEqual(fs.readFileSync(path.join(root, reply.path)), bytes);
      assert.equal((await waiter.exited).code, 0);
      assert.match(waiter.stdout(), /sheet\/imports\/Costs\.xlsx/);
    } finally { waiter.child.kill(); }
  });

  it('publishes the selected cell to the agent, and follows a guest editing over HTTP', {
    ...T, skip: browserOff || !Object.values(os.networkInterfaces()).flat().some(nic => nic?.family === 'IPv4' && !nic.internal),
  }, async () => {
    const root = path.join(tmpDir('sheets-coedit'), 'book');
    const opened = await ctx.cli.json(['open', root, '--type', 'sheets', '--json']);
    const browser = await (ctx.browserPromise ??= launch());
    const grid = "document.querySelector('[role=gridcell]')";
    const owner = await browser.load(opened.url, { ready: grid, ignore: [/\/favicon\.ico$/] });
    let guest;
    const frame = "document.querySelector('iframe[name=open-artifact-shell]')";
    const click = async (page, expr, inSheet = true) => {
      assert.ok(await page.waitFor(expr, 8000), expr);
      const point = await page.evaluate(`(() => {
        const frame = ${frame};
        const element = (document => ${expr})(${inSheet ? 'frame.contentDocument' : 'document'});
        const box = element.getBoundingClientRect(), offset = frame.getBoundingClientRect();
        return [box.x + box.width/2 + ${inSheet ? 'offset.x' : '0'}, box.y + box.height/2 + ${inSheet ? 'offset.y' : '0'}];
      })()`);
      await page.click(...point);
    };
    try {
      await click(owner, "document.querySelector('button[aria-label=Share]')", false);
      await click(owner, "document.querySelector('[aria-label=\"General access\"]')", false);
      await click(owner, "[...document.querySelectorAll('[data-share-menu] [role^=menuitem]')].find(el => el.textContent.includes('Anyone on your network'))", false);
      assert.ok(await owner.waitFor("document.querySelector('[data-share-dot]')"));
      const { links } = await (await fetch(new URL('_api/frame/share', opened.url))).json();
      await owner.press('Escape');
      guest = await browser.load(links.editor.url, { ready: 'document.querySelector("form input[name=name]")', ignore: [/\/favicon\.ico$/] });
      await guest.evaluate(`(() => { const form = document.querySelector('form'); form.elements.name.value = 'Sheet guest'; form.submit() })()`);
      assert.ok(await guest.waitFor("document.querySelector('iframe[name=open-artifact-shell]')"));
      assert.equal(await guest.evaluate("fetch('_api/frame/share').then(r => r.status)"), 403);
      await click(guest, grid);
      await guest.type('Guest edit');
      await guest.press('Enter');
      assert.ok(await until(async () => {
        const answer = await ctx.cli.json(['read', root, JSON.stringify({ kind: 'readCells', sheet: 'Sheet1', range: 'A1' })]);
        return answer.rows[1]?.[0] === 'Guest edit';
      }), 'guest edit was not saved');
      for (let i = 0; i < 64; i++) await guest.press('ArrowDown');
      await owner.press('Escape');
      await click(owner, grid);
      await owner.press('ArrowRight');
      assert.ok(await until(async () => (await ctx.cli.json(['context', root, '--json'])).context?.activeCell === 'B1'), 'owner selection was not published');
      const row66 = "[...document.querySelectorAll('[role=rowheader]')].some(el => el.textContent.trim() === '66')";
      assert.ok(!(await owner.evaluateAll(row66)).includes(true));
      await click(owner, `document.querySelector('.sheet-peers-overlay [aria-label^="People here"]')`);
      await click(owner, `document.querySelector('[aria-label="Follow Sheet guest"]:not(:disabled)')`);
      assert.ok(await owner.waitFor(row66, 5000), 'following did not scroll to the guest');
      const note = "document.querySelector('.sheet-peers-overlay [role=status]')";
      assert.ok(await owner.waitFor(note + "?.textContent.includes('Following Sheet guest')"));
      await owner.press('Escape');
      assert.ok(await owner.waitFor("document.querySelector('[role=grid]') && " + note + ' === null'));
      assert.deepEqual(owner.problems, []);
    } finally {
      await guest?.close();
      await owner.close();
      await ctx.cli.json(['share', root, '--off', '--json']);
    }
  });

  it('takes a snapshot after the workbook is visible without changing the active selection', { ...T, skip: browserOff }, async () => {
    const { createTypeServer } = await import('../packages/type-server/src/server.ts');
    const root = tmpDir('sheets-snapshot');
    await ctx.cli.json(['update', root, edits(1, [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: [['Snapshot cell']] }])]);
    const secret = 'sheet-camera-test';
    const server = createTypeServer({ assetsDir: path.join(typePath(TYPE), 'scripts'), types: [TYPE], secret, idleMs: 0, log: () => {} });
    try {
      await server.listen();
      const opened = await server.open({ root, type: TYPE });
      const context = path.join(root, '_agent', 'view-context.json');
      fs.mkdirSync(path.dirname(context), { recursive: true });
      const selection = JSON.stringify({ context: { activeCell: 'B2' } });
      fs.writeFileSync(context, selection);
      const response = await fetch(new URL('/__open-artifact/actions/snapshot', opened.url), {
        method: 'POST', headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
        body: JSON.stringify({ id: opened.id, root, args: { width: 800, height: 600 } }),
      });
      const result = await response.json();
      assert.ok(response.ok, JSON.stringify(result));
      const png = fs.readFileSync(result.image);
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), 800);
      assert.equal(fs.readFileSync(context, 'utf8'), selection);
    } finally { await server.stop(); }
  });

  it('shares, downloads both formats and posts a cell comment through the global frame', { ...T, skip: browserOff }, async () => {
    const browser = await (ctx.browserPromise ??= launch());
    const overrides = {
      HOME: tmpDir('sheets-shell-home'),
      OPEN_ARTIFACT_HOME: tmpDir('sheets-daemon'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('sheets-shell-state'),
      OPEN_ARTIFACT_USER_TYPES: tmpDir('sheets-user-types'),
      OPEN_ARTIFACT_BROWSER: 'none',
    };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    let daemon, shell;
    try {
      const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
      const { api, readDaemon } = await import('../packages/daemon/src/client.ts');
      daemon = await startDaemon({ port: 0, quiet: true, idleMs: 0, builtinTypesDir: path.dirname(typePath(TYPE)) });
      const state = await readDaemon();
      const made = await api(state, 'tools.call', {
        name: 'Artifact', arguments: { action: 'publish', type_url: 'open-artifact://type/sheets', title: 'Frame workbook' },
        caller: { harness: 'e2e', session: 'sheet-frame', workspace: tmpDir('sheets-workspace') },
      });
      assert.equal(made.error, undefined, JSON.stringify(made));
      const id = made.url.split('/').at(-1);
      const root = daemon.store.require(id).root;
      await ctx.cli.json(['update', root, edits(1, [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: [['Item', 'Price'], ['Book', 4]] }, { kind: 'addSheet', name: 'Archive' }])]);
      shell = await browser.load(state.url + '/a/' + id, { ready: "document.querySelector('[role=gridcell]')?.textContent === 'Item'" });
      const click = async expr => {
        assert.ok(await shell.waitFor(expr, 5000), expr + ' ' + await shell.evaluate('document.body.innerText'));
        const point = await shell.evaluate(`(() => { const r = (${expr}).getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2] })()`);
        await shell.click(...point);
      };
      const share = "document.querySelector('button[aria-label=Share]')";
      const textButton = label => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
      await click(share);
      await click("document.querySelector('[aria-label=\"General access\"]')");
      await click("[...document.querySelectorAll('[data-share-menu] [role^=menuitem]')].find(el => el.textContent.includes('Anyone on your network'))");
      assert.ok(await shell.waitFor("document.querySelector('[data-share-dot]')"), 'sharing was not enabled');
      await click("document.querySelector('[aria-label=\"General access\"]')");
      await click("[...document.querySelectorAll('[data-share-menu] [role^=menuitem]')].find(el => el.textContent.includes('Only this computer'))");
      assert.ok(await shell.waitFor("!document.querySelector('[data-share-dot]')"));
      const downloads = path.join(overrides.HOME, 'Downloads');
      for (const [label, suffix] of [['Excel', '.xlsx'], ['CSV', '.csv']]) {
        if (label === 'CSV') await click(share);
        await click(textButton('Export'));
        await click(`document.querySelector('[data-export-row="${label}"]')`);
        const file = () => fs.existsSync(downloads) && fs.readdirSync(downloads).find(f => f.endsWith(suffix));
        assert.ok(await until(file), label + ' was not downloaded');
        const saved = path.join(downloads, file());
        if (label === 'CSV') assert.equal(fs.readFileSync(saved, 'utf8').trim(), 'Item,Price\r\nBook,4');
        else {
          const { execFileSync } = await import('node:child_process');
          const output = await ctx.cli.json(['export', root]);
          for (const part of ['xl/workbook.xml', 'xl/worksheets/sheet1.xml']) {
            const extract = file => execFileSync('unzip', ['-p', file, part], { encoding: 'utf8' });
            assert.equal(extract(saved), extract(output.file));
          }
        }
      }
      await click("document.querySelector('[data-comments-button] button[aria-label=Comments]')");
      assert.ok(await shell.waitFor("document.documentElement.hasAttribute('data-comment-mode')"));
      const [offsetX, offsetY] = await shell.evaluate("(() => {const r = document.querySelector('iframe').getBoundingClientRect(); return [r.x, r.y]})()");
      const points = await shell.evaluateAll("(() => {const r = document.querySelector('[role=gridcell]')?.getBoundingClientRect(); return r && [r.x+r.width/2, r.y+r.height/2]})()");
      const [x, y] = points.find(Array.isArray);
      await shell.click(x + offsetX, y + offsetY);
      assert.ok(await shell.waitFor("[...document.querySelectorAll('[data-comments-layer]')].some(layer => layer.shadowRoot?.querySelector('[data-cds=CommentComposer] textarea'))", 5000));
      await shell.type('Check this price');
      await shell.press('Enter');
      assert.ok(await until(async () => (await ctx.cli.json(['comments', root, '--json'])).threads.some(thread =>
        thread.messages.some(m => m.text === 'Check this price') && thread.where.includes('A1'))), 'cell comment was not saved at A1');
      await shell.press('Escape');
      const nextTab = "[...document.querySelectorAll('[role=tab]')].find(tab => (tab.ariaLabel ?? '').includes('Archive') || tab.textContent.includes('Archive'))";
      assert.ok(await shell.waitFor(nextTab, 5000), JSON.stringify(await shell.evaluateAll("[...document.querySelectorAll('[role=tab]')].map(t => [t.textContent,t.ariaLabel])")));
      const originalHash = await shell.evaluate('location.hash');
      await shell.evaluateAll(nextTab + '?.click()');
      assert.ok(await until(async () => {
        const hash = await shell.evaluate('location.hash');
        return hash.startsWith('#page=') && hash !== originalHash;
      }), 'The frame address did not follow the selected sheet');
      const linked = await browser.load(await shell.evaluate('location.href'), { ready: "document.querySelector('[role=grid][aria-label=Archive]')" });
      try {
        assert.ok(await linked.waitFor("document.querySelector('[role=grid][aria-label=Archive]')"));
        assert.deepEqual(linked.problems, []);
      } finally { await linked.close(); }
      assert.deepEqual(shell.problems, []);
    } finally {
      await shell?.close();
      await daemon?.close();
      for (const [key, original] of Object.entries(previous)) {
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      }
    }
  });

  // The cases below drive the page as a person does. `open` serves the Shell, and the sheet page runs in its frame.
  const SHELL = "document.querySelector('iframe[name=open-artifact-shell]')";
  /** Statements run in the tab, with `shell` the Shell's frame and `document` the sheet page's own. */
  const inShellFrame = body => `((shell) => ((document) => { ${body} })(shell?.contentDocument))(${SHELL})`;
  /** `expression`, asked of the sheet page alone: the Shell around it has no cells, so a check that something is gone needs it. */
  const onGrid = expression => `(document.querySelector('[role=grid]') !== null && (${expression}))`;
  const cellWith = text => `[...document.querySelectorAll('[role=gridcell]')].find(cell => cell.textContent === ${JSON.stringify(text)})`;
  const tabNamed = name => `[...document.querySelectorAll('[role=tab]')].find(tab => tab.textContent.includes(${JSON.stringify(name)}))`;
  const menuItem = label => `[...document.querySelectorAll('[role^=menuitem]')].find(item => item.textContent.trim() === ${JSON.stringify(label)})`;
  const VIEWS_BUTTON = "[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent.trim()).startsWith('Views'))";
  const commandKey = process.platform === 'darwin' ? { meta: true } : { ctrl: true };
  const SALES = [['City', 'Amount'], ['Leeds', 10], ['Leeds', 25], ['York', 30], ['Bath', 20]];
  const linesOf = root => fs.readFileSync(path.join(root, 'sheet', 'edits.jsonl'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const opsOf = root => linesOf(root).flatMap(line => line.ops);
  /** The table of a Sheet's one sheet, as the log has it: {sheetId, cellTableId, cellTable}. */
  const tableOf = root => {
    const { sheetId, cellTables: [table] } = opsOf(root).findLast(op => op.kind === 'setCellTables');
    return { sheetId, ...table };
  };

  const openSheet = async (url, ready = "document.querySelector('[role=gridcell]')") =>
    (await (ctx.browserPromise ??= launch())).load(url, { ready, settle: 500, ignore: [/\/favicon\.ico$/] });

  /** Click `element` (an expression on the sheet page) with the real mouse, once it holds still and nothing covers it. */
  async function clickOnSheet(page, element, { right = false, shift = false } = {}) {
    let at = null;
    const steady = async () => {
      const was = at;
      at = await page.evaluate(inShellFrame(`
        const el = document && (${element});
        const r = el?.getBoundingClientRect();
        if (!r?.width) return null;
        const x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y);
        if (!hit || !(hit === el || el.contains(hit))) return null;
        const offset = shell.getBoundingClientRect();
        return [offset.x + x, offset.y + y];`));
      return at && was && at[0] === was[0] && at[1] === was[1];
    };
    assert.ok(await until(steady, 10000), `nothing to click: ${element}`);
    if (right) await page.rightClick(...at);
    else await page.click(...at, { shift });
  }

  /** Pick a saved view from the Filter card of the table, as its list of saved views offers it. */
  async function pickView(page, name) {
    await clickOnSheet(page, cellWith('Leeds'), { right: true });
    await clickOnSheet(page, menuItem('Filter'));
    await clickOnSheet(page, `[...document.querySelectorAll('[role=option]')].find(option => option.textContent.trim() === ${JSON.stringify(name)})`);
  }

  /**
   * Save views of the table on `root`'s sheet the way a page does once a person has saved them: one edit of the page's
   * own, sent to the server. No call of the agent's makes a view. Returns the revision it made.
   */
  async function saveViews(root, url, views) {
    const { revision, newestFormatVersion: v } = await expectStatus(await postJson(new URL('_api/sheet/read', url).href, { kind: 'snapshot' }), 200);
    const { sheetId, cellTableId } = tableOf(root);
    const namedViews = views.map((namedView, n) => ({ namedViewId: `nvw_testviewsa.${n}`, namedView: { cellTableId, ...namedView } }));
    const response = await postJson(new URL('_api/sheet/send', url).href, { opId: `views-${revision}`, v, base: revision, ops: [{ kind: 'setNamedViews', sheetId, namedViews }] });
    const answer = await expectStatus(response, 200);
    assert.equal(answer.kind, 'saved', JSON.stringify(answer));
    return answer.revision;
  }

  it('an interactive tab writes its cells from its controls, and keeps or brings back their defaults', { ...T, skip: browserOff }, async () => {
    const dir = tmpDir('sheets-interactive');
    const root = path.join(dir, 'book');
    const opened = await ctx.cli.json(['open', root, '--type', 'sheets', '--json']);
    const { revision } = await ctx.cli.json(['update', root, edits(1, [
      { kind: 'renameSheet', sheet: 'Sheet1', name: 'Inputs' },
      { kind: 'writeCells', sheet: 'Inputs', topLeft: 'A1', rows: [[7]] },
      { kind: 'addSheet', name: 'Panel' },
    ])]);
    // `presses` counts every click the button hears, so a click the page refuses to write still shows.
    fs.writeFileSync(path.join(dir, 'stepper.jsx'), `export default () => <sheet.Visualize data-component='stepper' sources={{count:{kind:'ref', ref:'input/count', adapter:{kind:'cells'}}, interactive:{kind:'data', data:[]}}}>{({count, interactive}) => {
      const panel = interactive.at(0);
      const held = count.at(0)?.at(0)?.value;
      const n = typeof held === 'number' ? held : 0;
      const [presses, setPresses] = useState(0);
      return <div role='group' aria-label='Stepper'><button id='step' data-presses={presses} disabled={panel?.canWrite !== true} onClick={() => { setPresses(presses + 1); panel.setCells({count: n + 1}); }}>Count {n}</button></div>;
    }}</sheet.Visualize>;`);
    const inputs = [{ name: 'count', cells: { sheet: 'Inputs', range: 'A1' } }];
    const calls = path.join(dir, 'stepper.json');
    fs.writeFileSync(calls, JSON.stringify([
      { $lid: 'w', verb: 'create', payload: { codeFile: 'stepper.jsx' } },
      { verb: 'update', payload: { kind: 'applyEdits', base: revision, edits: [{ kind: 'addInteractive', interactive: { sheet: 'Panel', name: 'Stepper', caption: '', widget: '$lid:w', inputs, writable: ['count'] } }] } },
    ]));
    const made = await ctx.cli.json(['batch', root, calls]);
    assert.equal(made.acks[1].data.revision, revision + 1, JSON.stringify(made));
    const { interactive } = await ctx.cli.json(['read', root, JSON.stringify({ kind: 'readInteractive', sheet: 'Panel' })]);
    assert.deepEqual([interactive.widget, interactive.inputs, interactive.writable], [made.lids.w, inputs, ['count']]);

    const page = await openSheet(opened.url, tabNamed('Panel'));
    const countIs = async () => (await ctx.cli.json(['read', root, JSON.stringify({ kind: 'readCells', sheet: 'Inputs', range: 'A1' })])).rows['1']?.[0];
    const step = "document.querySelector('#step')";
    const shows = n => `${step}?.textContent === 'Count ${n}'`;
    const footButton = label => `Array.from(document.querySelectorAll('[data-stands=footBar] button')).find(button => button.textContent.trim() === ${JSON.stringify(label)})`;
    const panelTab = "document.querySelector('.sheet-interactive')";
    const panelFrame = "document.querySelector('.sheet-interactive-frame')";
    const pressStep = async () => {
      const frame = await page.evaluate(inShellFrame(`
        const a = shell.getBoundingClientRect(), b = (${panelFrame}).getBoundingClientRect();
        return [a.x + b.x, a.y + b.y];`));
      const button = (await page.evaluateAll(`(() => { const r = ${step}?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()`)).find(Array.isArray);
      assert.ok(button, 'the panel draws no button');
      await page.click(frame[0] + button[0], frame[1] + button[1]);
    };
    const expectCount = async n => {
      assert.ok(await page.waitFor(shows(n), 8000), `the panel does not show ${n}`);
      assert.ok(await until(async () => (await countIs()) === n, 8000), `Inputs!A1 is not ${n}`);
    };
    try {
      await clickOnSheet(page, tabNamed('Panel'));
      assert.ok(await page.waitFor(panelFrame, 15000), 'the interactive tab shows no panel');
      assert.ok(await page.waitFor(`${shows(7)} && !${step}.disabled`, 15000), 'the panel did not get its input');
      // A click made by a script in the panel, with no person behind it, writes nothing.
      await page.evaluateAll(`${step}?.click()`);
      assert.ok(await page.waitFor(`${step}?.dataset.presses === '1' && ${shows(7)}`, 8000), 'a scripted click was not taken back');
      assert.equal(await countIs(), 7);

      await pressStep();
      await expectCount(8);
      await clickOnSheet(page, footButton('Save as default'));
      assert.ok(await page.waitFor(`${footButton('Save as default')}?.disabled`, 8000), 'Save as default stayed on after saving');
      await pressStep();
      await expectCount(9);
      await clickOnSheet(page, footButton('Reset'));
      await expectCount(8);
      assert.ok(await page.waitFor(`${footButton('Reset')}?.disabled`, 8000), 'Reset stayed on with the defaults back');

      // Enter on the panel's tab hands the keys to the panel, and Escape takes them back.
      await page.evaluate(inShellFrame(`${panelTab}.focus();`));
      assert.ok(await page.waitFor(`document.activeElement === ${panelTab}`, 5000), 'the panel\'s tab did not take focus');
      await page.press('Enter');
      assert.ok(await page.waitFor(`document.activeElement === ${panelFrame}`, 5000), 'Enter did not go into the panel');
      await page.press('Escape');
      assert.ok(await page.waitFor(`document.activeElement === ${panelTab}`, 5000), 'Escape did not leave the panel');
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });

  it('a link to cells selects them without editing, and a walkthrough the agent sends steps through its stops', { ...T, skip: browserOff }, async () => {
    const root = path.join(tmpDir('sheets-links'), 'book');
    await ctx.cli.json(['open', root, '--type', 'sheets', '--json']);
    await ctx.cli.json(['update', root, edits(1, [
      { kind: 'addSheet', name: 'Summary' },
      { kind: 'writeCells', sheet: 'Summary', topLeft: 'B10', rows: [['Profit', 420]] },
    ])]);
    const book = await ctx.cli.json(['read', root]);
    const [sheet1, summary] = book.sheets;
    const stops = [
      { at: `#${summary.linkFragment}~B10-C10~E14`, say: 'The profit, worked out below.' },
      { at: `#${sheet1.linkFragment}~A3`, say: 'The assumptions go here.' },
    ];
    const showGuide = () => ctx.cli.json(['read', root, JSON.stringify({ kind: 'showGuide', guide: { stops } })]);
    assert.deepEqual(await showGuide(), { shown: false }, 'a walkthrough with no page open was shown');
    const page = await openSheet(book.frame.artifactUrl + stops[0].at);
    const marked = "document.querySelectorAll('.sheet-cells-lit-by-link')";
    const tabOnShow = "document.querySelector('[role=tab][aria-selected=true]')?.textContent";
    const guide = "document.querySelector('[data-guide-card]')";
    const guideButton = label => `[...(${guide}?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
    try {
      assert.ok(await page.waitFor(`${tabOnShow}?.includes('Summary') && ${marked}.length === 2`, 15000), 'the link did not mark its two ranges on Summary');
      assert.ok(await page.waitFor(`${formulaBar}?.value === 'Profit'`, 5000), 'the link did not select B10');
      assert.ok(await page.waitFor(`(() => {
        const r = ${cellWith('Profit')}?.getBoundingClientRect();
        return r && [...${marked}].some(box => { const b = box.getBoundingClientRect(); return b.left <= r.x + 1 && b.right >= r.right - 1 && b.top <= r.y + 1 && b.bottom >= r.bottom - 1; });
      })()`, 5000), 'no marked range covers B10');
      // The keys go to the Shell until the person is in the sheet: a press on its own tab puts them there and leaves the
      // marks (a press on a cell would select it, and clear them).
      await clickOnSheet(page, tabNamed('Summary'));
      assert.equal((await page.evaluateAll(onGrid(`${marked}.length`))).find(Number.isInteger), 2, 'a press on the tab on show cleared the marks');
      await page.press('Escape');
      assert.ok(await page.waitFor(onGrid(`${marked}.length === 0`), 5000), 'Escape did not clear the marks');

      assert.deepEqual(await showGuide(), { shown: true });
      assert.ok(await page.waitFor(`${guide}?.textContent.includes('The profit, worked out below.')`, 10000), 'the guide guide did not show its first stop');
      // A stop that is not on screen yet offers to go to its cells first.
      if ((await page.evaluateAll(`Boolean(${guideButton('Go to cells')})`)).includes(true)) await clickOnSheet(page, guideButton('Go to cells'));
      await clickOnSheet(page, guideButton('Next'));
      assert.ok(await page.waitFor(`${guide}?.textContent.includes('The assumptions go here.') && ${tabOnShow}?.includes('Sheet1')`, 10000), 'Next did not go to the stop on Sheet1');
      await clickOnSheet(page, guideButton('Done'));
      assert.ok(await page.waitFor(onGrid(`!${guide} && ${marked}.length === 0`), 5000), 'the guide guide or its marks stayed after Done');
      assert.equal((await ctx.cli.json(['info', root, '--json'])).revision, book.revision, 'the link or the walkthrough edited the workbook');
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });

  it('a page opened again on an edited workbook shows it, copies a cell, and clears a value from a drawn row', { ...T, skip: browserOff }, async () => {
    const root = path.join(tmpDir('sheets-reopen'), 'book');
    const opened = await ctx.cli.json(['open', root, '--type', 'sheets', '--json']);
    const label = 'Groceries 🧺';
    let { revision } = await ctx.cli.json(['update', root, edits(1, [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: [[label, 5, '=B1+7']] }])]);
    const rowOne = "Array.from(document.querySelectorAll('[role=gridcell]'), cell => cell.textContent).slice(0, 3)";
    const shows = values => `JSON.stringify(${rowOne}) === ${JSON.stringify(JSON.stringify(values))}`;
    const before = await openSheet(opened.url, shows([label, '5', '12']));
    assert.deepEqual(before.problems, []);
    await before.close();
    ({ revision } = await ctx.cli.json(['update', root, edits(revision, [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'B1', rows: [[6]] }])]));
    const page = await openSheet(opened.url, shows([label, '6', '13']));
    try {
      assert.ok(await page.waitFor(shows([label, '6', '13']), 5000), 'the page opened again does not show the edit made while it was shut');
      await clickOnSheet(page, cellWith(label));
      assert.ok(await page.waitFor(`${formulaBar}?.value === ${JSON.stringify(label)}`, 5000), 'A1 is not selected');
      // Keep what the page puts on the clipboard when the copy key is pressed; a headless browser has no clipboard to read.
      await page.evaluateAll(`document.querySelector('[role=grid]') && window.addEventListener('copy', event => { window.__copiedText = event.clipboardData?.getData('text/plain'); })`);
      await page.press('c', { ...commandKey, commands: ['copy'] });
      assert.ok(await page.waitFor(`window.__copiedText === ${JSON.stringify(label)}`, 5000), `the copy key did not copy A1: ${JSON.stringify(await page.evaluateAll('window.__copiedText'))}`);
      await ctx.cli.json(['update', root, edits(revision, [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'B1', rows: [[null]] }])]);
      assert.ok(await page.waitFor(shows([label, '', '7']), 10000), `B1 was not cleared on the page: ${JSON.stringify((await page.evaluateAll(rowOne)).find(Array.isArray))}`);
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });

  it('dragging columns of a table moves them, leaving cells outside the table in place, and undo puts them back', { ...T, skip: browserOff }, async () => {
    const headings = ['First', 'Second', 'Third'];
    const outside = ['Note A', 'Note B', 'Note C'];
    for (const withCellsAbove of [true, false]) {
      const root = path.join(tmpDir('sheets-column-drag'), 'book');
      const opened = await ctx.cli.json(['open', root, '--type', 'sheets', '--json']);
      const { revision } = await ctx.cli.json(['update', root, edits(1, [
        ...(withCellsAbove ? [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: [outside] }] : []),
        { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A3', rows: [headings, [1, 2, 3], [4, 5, 6]] },
        { kind: 'setCellTable', sheet: 'Sheet1', cellTable: { columns: 'A:C', headerRows: '3', footerRows: null } },
      ])]);
      const columnGrips = "[...document.querySelectorAll('.sheet-grip-of-column')]";
      const order = `[...document.querySelectorAll('[role=gridcell]')].map(cell => cell.textContent).filter(text => ${JSON.stringify(headings)}.includes(text))`;
      const inOrder = names => `JSON.stringify(${order}) === ${JSON.stringify(JSON.stringify(names))}`;
      const page = await openSheet(opened.url, `${inOrder(headings)} && ${columnGrips}.length === 3`);
      try {
        const [from, to] = await page.evaluate(inShellFrame(`
          const at = shell.getBoundingClientRect(), grip = ${columnGrips}[0].getBoundingClientRect(), last = ${cellWith('Third')}.getBoundingClientRect();
          return [[at.x + grip.x + grip.width / 2, at.y + grip.y + grip.height / 2], [at.x + last.right - 8, at.y + grip.y + grip.height / 2]];`));
        await page.hover(...from);
        assert.ok(await page.waitFor("document.querySelector('.sheet-grip-of-column[data-is-called]')", 5000), 'the grip of the first column did not show under the pointer');
        await page.dragMouse(from, to);
        assert.ok(await page.waitFor(inOrder(['Second', 'Third', 'First']), 10000), `the columns did not move: ${JSON.stringify((await page.evaluateAll(order)).find(Array.isArray))}`);
        assert.ok(await until(async () => (await ctx.cli.json(['info', root, '--json'])).revision > revision, 10000), 'the move was not saved');
        const lastOps = JSON.parse(fs.readFileSync(path.join(root, 'sheet', 'edits.jsonl'), 'utf8').trimEnd().split('\n').at(-1)).ops;
        // With cells above the table, only the table's own cells move; with none, whole columns do.
        assert.ok(lastOps.some(op => op.kind === (withCellsAbove ? 'setCells' : 'moveColumns')), JSON.stringify(lastOps.map(op => op.kind)));
        const cells = await ctx.cli.json(['read', root, JSON.stringify({ kind: 'readCells', sheet: 'Sheet1', range: 'A1:C3' })]);
        assert.deepEqual(cells.rows['3'], ['Second', 'Third', 'First']);
        if (withCellsAbove) assert.deepEqual(cells.rows['1'], outside);
        await page.press('z', commandKey);
        assert.ok(await page.waitFor(inOrder(headings), 10000), 'undo did not put the columns back');
        assert.ok(await until(async () => (await ctx.cli.json(['read', root, JSON.stringify({ kind: 'readCells', sheet: 'Sheet1', range: 'A3:C3' })])).rows['3']?.join() === headings.join(), 10000), 'undo was not saved');
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    }
  });

  it('a pivot table made from selected data lands on a sheet named Pivot table and follows its aggregate', { ...T, skip: browserOff }, async () => {
    const root = path.join(tmpDir('sheets-pivot'), 'book');
    const opened = await ctx.cli.json(['open', root, '--type', 'sheets', '--json']);
    await ctx.cli.json(['update', root, edits(1, [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: SALES }])]);
    const page = await openSheet(opened.url, cellWith('City'));
    try {
      await clickOnSheet(page, cellWith('City'));
      await clickOnSheet(page, cellWith('20'), { shift: true });
      await clickOnSheet(page, cellWith('City'), { right: true });
      await clickOnSheet(page, menuItem('Pivot table'));
      const summarize = `document.querySelector('button[aria-label="Summarize by, Amount: Sum"]')`;
      assert.ok(await page.waitFor(summarize, 10000), 'no pivot table pane came up with the sum');
      assert.ok(await page.waitFor(cellWith('35'), 10000), 'the pivot table does not sum Leeds');
      await clickOnSheet(page, summarize);
      await clickOnSheet(page, `[...document.querySelectorAll('[role=menuitemradio], [role=menuitem], [role=option]')].find(el => el.textContent.trim().startsWith('Average'))`);
      assert.ok(await page.waitFor(cellWith('17.5'), 10000), 'the pivot table does not show the average of Leeds');
      assert.ok(await page.waitFor(`document.querySelector('button[aria-label="Summarize by, Amount: Average"]')`, 5000));
      const { sheets } = await ctx.cli.json(['read', root]);
      assert.deepEqual(sheets.map(sheet => sheet.name), ['Sheet1', 'Pivot table']);
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });

  it('a saved view is kept with the workbook, and picking it after a reload filters the rows again', { ...T, skip: browserOff }, async () => {
    const root = path.join(tmpDir('sheets-views'), 'book');
    const opened = await ctx.cli.json(['open', root, '--type', 'sheets', '--json']);
    await ctx.cli.json(['update', root, edits(1, [
      { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: SALES },
      { kind: 'setCellTable', sheet: 'Sheet1', cellTable: { columns: 'A:B', headerRows: '1', footerRows: null } },
    ])]);
    const viewsSaved = () => opsOf(root).filter(op => op.kind === 'setNamedViews');
    let page = await openSheet(opened.url, cellWith('Leeds'));
    try {
      await clickOnSheet(page, cellWith('Leeds'), { right: true });
      await clickOnSheet(page, menuItem('Show only Leeds'));
      assert.ok(await page.waitFor(onGrid(`!${cellWith('York')}`), 5000), 'the filter did not leave York out');
      await clickOnSheet(page, VIEWS_BUTTON);
      await clickOnSheet(page, menuItem('Save as new view'));
      assert.ok(await page.waitFor("document.activeElement?.closest('[role=dialog]')", 5000), 'the name of the new view has no field');
      await page.type('Leeds alone');
      await page.press('Enter');
      assert.ok(await page.waitFor(`${VIEWS_BUTTON}?.getAttribute('aria-label') === 'Views: Leeds alone'`, 10000), 'the new view is not the one on show');
      assert.ok(await until(() => viewsSaved().length === 1, 10000), 'the view was not saved to the workbook');
      await clickOnSheet(page, "document.querySelector('[aria-label=\"Clear all filters\"]')");
      assert.ok(await page.waitFor(cellWith('York'), 5000), 'clearing the filter did not bring York back');
      await page.close();

      page = await openSheet(opened.url, cellWith('Leeds'));
      assert.ok(await page.waitFor(cellWith('York'), 5000), 'the filter that was cleared came back');
      await pickView(page, 'Leeds alone');
      assert.ok(await page.waitFor(onGrid(`!${cellWith('York')}`), 10000), 'the saved view did not filter the rows');
      assert.ok(await page.waitFor(cellWith('Leeds'), 5000));
      assert.equal(viewsSaved().length, 1, 'picking a view saved it again');
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });

  it('updating a saved view whose sort the page could not use keeps that sort', { ...T, skip: browserOff }, async () => {
    const root = path.join(tmpDir('sheets-view-sort'), 'book');
    const opened = await ctx.cli.json(['open', root, '--type', 'sheets', '--json']);
    const { revision } = await ctx.cli.json(['update', root, edits(1, [
      { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: SALES },
      { kind: 'setCellTable', sheet: 'Sheet1', cellTable: { columns: 'A:B', headerRows: '1', footerRows: null } },
      // A merged range in the table's rows: the page can filter them, but not sort them.
      { kind: 'mergeCells', sheet: 'Sheet1', ranges: ['D2:D3'] },
    ])]);
    const { cellTable } = tableOf(root);
    const sortBy = [{ c: cellTable.lastColumn, direction: 'descending' }];
    // The view filters too: one with a sort alone would not stay on once its sort is left out.
    const filter = { allOf: [{ anyOf: [{ c: cellTable.firstColumn, asked: { kind: 'isOneOf', values: [{ kind: 'text', value: 'Leeds' }, { kind: 'text', value: 'York' }] } }] }] };
    assert.equal(await saveViews(root, opened.url, [{ name: 'Largest first', filter, sortBy }]), revision + 1);
    const views = () => opsOf(root).filter(op => op.kind === 'setNamedViews');
    const amountsShown = `[...document.querySelectorAll('[role=gridcell]')].map(cell => cell.textContent).filter(text => /^(10|20|25|30)$/.test(text))`;
    const amountsShownAre = list => `JSON.stringify(${amountsShown}) === ${JSON.stringify(JSON.stringify(list))}`;
    let page = await openSheet(opened.url, cellWith('Leeds'));
    try {
      await pickView(page, 'Largest first');
      assert.ok(await page.waitFor(textIn('but not its sort'), 5000), 'the page did not say it left the sort out');
      assert.ok(await page.waitFor(amountsShownAre(['10', '25', '30']), 5000), `the rows are not filtered and unsorted: ${JSON.stringify((await page.evaluateAll(amountsShown)).find(Array.isArray))}`);
      await clickOnSheet(page, cellWith('Leeds'), { right: true });
      await clickOnSheet(page, menuItem('Show only Leeds'));
      assert.ok(await page.waitFor(amountsShownAre(['10', '25']), 5000), 'the filter did not leave York out');
      assert.ok(await page.waitFor(`/Largest first/.test(${VIEWS_BUTTON}?.getAttribute('aria-label') ?? '')`, 5000), 'the view went off when its filter changed');

      const { revision: now } = await ctx.cli.json(['info', root, '--json']);
      await ctx.cli.json(['update', root, edits(now, [
        { kind: 'unmergeCells', sheet: 'Sheet1', ranges: ['D2:D3'] },
        { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'D2', rows: [['Split']] },
      ])]);
      assert.ok(await page.waitFor(cellWith('Split'), 10000), 'the page did not get the unmerge');
      assert.ok(await page.waitFor(amountsShownAre(['10', '25']), 5000), 'the unmerge changed the rows on show');
      await clickOnSheet(page, VIEWS_BUTTON);
      await clickOnSheet(page, menuItem('Update “Largest first”'));
      assert.ok(await until(() => views().length === 2, 10000), 'the update of the view was not saved');
      const updated = views().at(-1).namedViews[0].namedView;
      assert.notDeepEqual(updated.filter, filter, 'the update did not take the filter on show');
      assert.deepEqual(updated.sortBy, sortBy, 'the update dropped the sort the page had left out');

      await clickOnSheet(page, "document.querySelector('[aria-label=\"Clear all filters\"]')");
      await page.close();
      page = await openSheet(opened.url, cellWith('Leeds'));
      await pickView(page, 'Largest first');
      assert.ok(await page.waitFor(amountsShownAre(['25', '10']), 10000), 'the updated view does not filter and sort');
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });

  it('undo after a sort of one\'s own brings back the sort before it and leaves the workbook as it was', { ...T, skip: browserOff }, async () => {
    const root = path.join(tmpDir('sheets-undo-sort'), 'book');
    const opened = await ctx.cli.json(['open', root, '--type', 'sheets', '--json']);
    await ctx.cli.json(['update', root, edits(1, [
      { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: SALES },
      { kind: 'setCellTable', sheet: 'Sheet1', cellTable: { columns: 'A:B', headerRows: '1', footerRows: null } },
    ])]);
    const { cellTable } = tableOf(root);
    const revision = await saveViews(root, opened.url, [
      { name: 'Cities Z to A', filter: null, sortBy: [{ c: cellTable.firstColumn, direction: 'descending' }] },
      { name: 'Largest first', filter: null, sortBy: [{ c: cellTable.lastColumn, direction: 'ascending' }] },
    ]);
    const regions = `[...document.querySelectorAll('[role=gridcell]')].map(cell => cell.textContent).filter(text => /^(Leeds|York|Bath)$/.test(text))`;
    const regionsAre = list => `JSON.stringify(${regions}) === ${JSON.stringify(JSON.stringify(list))}`;
    const page = await openSheet(opened.url, cellWith('City'));
    try {
      await pickView(page, 'Cities Z to A');
      assert.ok(await page.waitFor(regionsAre(['York', 'Leeds', 'Leeds', 'Bath']), 10000), 'the rows are not sorted by city');
      await pickView(page, 'Largest first');
      assert.ok(await page.waitFor(regionsAre(['Leeds', 'Bath', 'Leeds', 'York']), 10000), 'the rows are not sorted by amount');
      await clickOnSheet(page, cellWith('City'));
      await page.press('z', commandKey);
      assert.ok(await page.waitFor(regionsAre(['York', 'Leeds', 'Leeds', 'Bath']), 10000), `undo did not bring back the sort by city: ${JSON.stringify((await page.evaluateAll(regions)).find(Array.isArray))}`);
      // An edit the undo sent by mistake reaches the log a moment later, so watch it for a while.
      const edited = await until(async () => (await ctx.cli.json(['info', root, '--json'])).revision !== revision, 1500, 250);
      assert.ok(!edited, 'the sorts or the undo edited the workbook');
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });

  it('comments lists no threads on a new Sheet, and stop stops the server', T, async () => {
    const comments = await ctx.cli.json(['comments', ctx.root, '--json']);
    assert.deepEqual(comments.threads, []);
    const stop = await ctx.cli.run(['stop']);
    assert.equal(stop.code, 0, stop.stderr);
    assert.match(stop.stdout, /Stopped the server/);
  });
});
