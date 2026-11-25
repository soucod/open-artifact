#!/usr/bin/env node
// Performance benchmark of the Whiteboard: a large generated board opened in headless Chrome.
//
//   node e2e/bench/whiteboard.mjs                          2,000 elements, artifact-types/ (build first)
//   node e2e/bench/whiteboard.mjs --elements 5000
//   node e2e/bench/whiteboard.mjs --shots shots/           screenshots of the smoke check and of each view
//   node e2e/bench/whiteboard.mjs --label before --out results.json
//   node e2e/bench/whiteboard.mjs --compare 800,2000       one run per size, as a table
//
// A stored board holds at most 800 elements, so the page opens a small stored board (the smoke check's) and then shows
// the generated one through its benchmark hook (`?open_artifact_bench=1`, packages/whiteboard-editor/src/services/bench.ts): in the
// page only, nothing saved. The board mixes sections, shapes and stickies with text, connectors, free text and ink.
//
// What it measures (see docs/zh-CN/rust-wasm-core.md §10, W2/W3):
//   smoke     on the stored board: click a shape, drag it (its connector must follow while dragging and the move must
//             reach the board's documents), a marquee over two items, Escape; each check passes or says why not
//   load      from showing the generated board until it is drawn and the page answers again (two frames later), then
//             DOM nodes, JS heap (after a GC) and the Chrome process tree's RSS
//   overview  wheel panning and Ctrl+wheel zooming with the whole board in view
//   mid       wheel panning at 50 % (text drawn, hundreds of items in view)
//   work      wheel panning at 100 %
// Each scroll scenario reports frames per second, the 95th percentile and worst frame interval, frames over 25 ms and
// long tasks (> 50 ms) of the editor page.
//
// E2E_HEADFUL=1 runs Chrome with a window (real GPU compositing; headless numbers are for comparing runs, not absolute).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from '../lib/browser.mjs';
import { cli } from '../lib/cli.mjs';
import { install, removeTmp, target, tmpDir } from '../lib/target.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ELEMENTS = Number(opt('elements', 2000));
const PARAMS = opt('params', '');
const LABEL = opt('label', PARAMS || 'default');
const OUT = opt('out', null);
const SHOTS = opt('shots', null);
const COMPARE = opt('compare', null);
/** Board cells per row; each cell holds one item (and the connector to its right-hand neighbour). */
const COLUMNS = 60;
const CELL = { w: 320, h: 260 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* -------------------------------- the boards ------------------------------- */

/** The stored board the smoke check runs on: a section, two shapes and a connector, a sticky, free text and ink. */
const SMOKE = {
  e1: { type: 'container', x: -60, y: -80, w: 900, h: 560, text: 'Section' },
  e2: { type: 'shape', kind: 'rounded', x: 0, y: 0, w: 220, h: 120, color: 'blue', text: 'Shape A' },
  e3: { type: 'shape', kind: 'ellipse', x: 520, y: 40, w: 200, h: 120, color: 'green', text: 'Shape B' },
  e4: { type: 'arrow', from: 'e2', to: 'e3', fromSide: 'right', toSide: 'left', label: 'writes' },
  e5: { type: 'note', x: 40, y: 240, w: 180, h: 180, color: 'yellow', text: 'A sticky note with some words', tilt: -2 },
  e6: { type: 'text', x: 320, y: 300, text: 'Free text', size: 'large' },
  e7: { type: 'stroke', x: 320, y: 380, points: [0, 0, 40, 20, 80, 0, 120, 30, 160, 10], color: 'terracotta', width: 5 },
};

function makeStoredBoard(root) {
  const db = path.join(root, 'db');
  fs.mkdirSync(path.join(db, 'board'), { recursive: true });
  fs.mkdirSync(path.join(db, 'elements'), { recursive: true });
  fs.writeFileSync(path.join(db, 'board', 'meta.json'), JSON.stringify({ v: 1, title: 'Benchmark board', order: Object.keys(SMOKE) }));
  for (const [id, element] of Object.entries(SMOKE)) fs.writeFileSync(path.join(db, 'elements', `${id}.json`), JSON.stringify(element));
}

const WORDS = 'plan ship test review idea risk goal user flow data team cost time scope draft launch'.split(' ');
const COLORS = ['yellow', 'peach', 'pink', 'green', 'blue', 'purple'];
const KINDS = ['rect', 'rounded', 'ellipse', 'diamond', 'pill', 'hexagon', 'database', 'cloud'];

/** `count` elements (with ids): a section per 30 cells, then per cell a sticky, a shape, free text or ink, and connectors. */
function generate(count) {
  const sections = [];
  const items = [];
  const arrows = [];
  const words = (i, n) => Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(' ');
  let id = 0;
  const next = () => `g${++id}`;
  let cell = 0;
  while (sections.length + items.length + arrows.length < count) {
    const col = cell % COLUMNS;
    const row = Math.floor(cell / COLUMNS);
    const x = col * CELL.w;
    const y = row * CELL.h;
    if (col % 30 === 0 && row % 4 === 0) sections.push({ id: next(), type: 'container', x: x - 30, y: y - 30, w: 30 * CELL.w, h: 4 * CELL.h, text: `Area ${sections.length + 1}` });
    const kind = cell % 10;
    if (kind < 4) items.push({ id: next(), type: 'note', x, y, w: 180, h: 180, color: COLORS[cell % COLORS.length], text: `${words(cell, 6)}\n${words(cell + 1, 4)}`, tilt: (cell % 5) - 2 });
    else if (kind < 7) items.push({ id: next(), type: 'shape', kind: KINDS[cell % KINDS.length], x, y: y + 20, w: 220, h: 120, color: COLORS[(cell + 2) % COLORS.length], text: words(cell, 3) });
    else if (kind < 8) items.push({ id: next(), type: 'text', x, y: y + 40, text: words(cell, 4), size: 'body' });
    else {
      const points = [];
      for (let k = 0; k <= 12; k++) points.push(k * 16, Math.round(30 * Math.sin((k + cell) * 0.7)));
      items.push({ id: next(), type: 'stroke', x, y: y + 80, points, color: ['ink', 'terracotta', 'blue'][cell % 3], width: 4 });
    }
    // A connector from the previous box item in the row, for two cells in five.
    const last = items[items.length - 1];
    const before = items[items.length - 2];
    if (col > 0 && cell % 5 < 2 && before && ['note', 'shape'].includes(last.type) && ['note', 'shape'].includes(before.type)) {
      arrows.push({ id: next(), type: 'arrow', from: before.id, to: last.id, fromSide: 'right', toSide: 'left' });
    }
    cell++;
  }
  return [...sections, ...items, ...arrows].slice(0, count);
}

/* ------------------------------ in the page ------------------------------- */

const RECORDER = `(() => {
  const b = (window.__bench = { frames: [], long: [], running: false });
  b.observer = new PerformanceObserver(list => { if (b.running) for (const e of list.getEntries()) b.long.push(e.duration); });
  try { b.observer.observe({ type: 'longtask' }); } catch {}
  let generation = 0;
  b.start = () => {
    b.frames = []; b.long = []; b.running = true;
    const mine = ++generation;
    const tick = t => { if (!b.running || mine !== generation) return; b.frames.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  b.stop = () => {
    b.running = false;
    const gaps = b.frames.slice(1).map((t, i) => t - b.frames[i]).sort((x, y) => x - y);
    const span = b.frames.length > 1 ? b.frames[b.frames.length - 1] - b.frames[0] : 0;
    const q = p => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] : 0;
    return {
      fps: span ? Math.round(((b.frames.length - 1) / span) * 1000 * 10) / 10 : 0,
      p95: Math.round(q(0.95) * 10) / 10,
      worst: Math.round((gaps[gaps.length - 1] ?? 0) * 10) / 10,
      slowFrames: gaps.filter(g => g > 25).length,
      longTasks: b.long.length,
      longTaskMs: Math.round(b.long.reduce((s, d) => s + d, 0)),
    };
  };
  return true;
})()`;

/** Resolves once the page has drawn twice (ms since `t0`). */
const SETTLED = t0 => `new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - ${t0})));
})`;

/* --------------------------------- driving -------------------------------- */

const surfaceBox = page => page.evaluate(`(() => { const r = document.querySelector('[data-testid="board-surface"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const wb = (page, call) => page.evaluate(`window.__openArtifactWhiteboard.${call}`);

/** Puts the camera so that board point (bx, by) is at the surface's centre, at `zoom`. */
async function look(page, bx, by, zoom) {
  const s = await surfaceBox(page);
  await wb(page, `setCamera(${JSON.stringify({ x: bx - s.w / 2 / zoom, y: by - s.h / 2 / zoom, zoom })})`);
  await sleep(600);
}

/** The page point of board point (bx, by). */
async function toPage(page, bx, by) {
  const s = await surfaceBox(page);
  const { camera } = await wb(page, 'state()');
  return { x: s.x + (bx - camera.x) * camera.zoom, y: s.y + (by - camera.y) * camera.zoom };
}

async function wheel(page, steps, { dx = 0, dy = 0, ctrl = false, flip = 0, at }) {
  for (let i = 0; i < steps; i++) {
    const sign = flip && Math.floor(i / flip) % 2 ? -1 : 1;
    const started = Date.now();
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: dx * sign, deltaY: dy * sign, modifiers: ctrl ? 2 : 0 });
    await sleep(Math.max(0, 16 - (Date.now() - started)));
  }
}

/** A left-button drag from `a` to `b` in `steps` moves; `during` runs before the release. */
async function drag(page, a, b, { steps = 12, during } = {}) {
  await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
  await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, button: 'left', buttons: 1 });
    await sleep(16);
  }
  await sleep(100);
  const seen = during ? await during() : undefined;
  await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
  return seen;
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, `${LABEL.replace(/[^\w.-]+/g, '_')}-${name}.png`), Buffer.from(data, 'base64'));
}

const BUSY = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'];
const metricsOf = async page => Object.fromEntries((await page.cdp('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));

/** Runs a scroll scenario; main-thread busy time (ms) comes from the renderer's own counters, frames from the page. */
async function scenario(page, run) {
  const before = await metricsOf(page);
  const t0 = Date.now();
  await page.evaluate('window.__bench.start()');
  await run();
  await sleep(300);
  const frames = await page.evaluate('window.__bench.stop()');
  const after = await metricsOf(page);
  const wall = Date.now() - t0;
  const busy = Object.fromEntries(BUSY.map(k => [k.replace('Duration', 'Ms').replace(/^./, c => c.toLowerCase()), Math.round((after[k] - before[k]) * 1000)]));
  return { ...frames, wallMs: wall, mainThreadBusyPct: Math.round((busy.taskMs / wall) * 100), ...busy };
}

function rssOfTree(rootPid) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
  const children = new Map();
  for (const [pid, ppid] of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const rss = new Map(rows.map(([pid, , kb]) => [pid, kb]));
  let total = 0;
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    total += rss.get(pid) ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return Math.round(total / 1024);
}

/* ---------------------------------- smoke ---------------------------------- */

/** Select, drag a shape (its connector follows), marquee and Escape on the stored board. */
async function smoke(page, root) {
  const checks = [];
  const check = (name, ok, why) => checks.push(ok ? { name, ok: true } : { name, ok: false, why });
  const selection = async () => (await wb(page, 'state()')).selection;
  await look(page, 360, 180, 1);
  await shot(page, 'smoke-0-board');

  // Click Shape A.
  const a = await toPage(page, 110, 60);
  await page.click(a.x, a.y);
  await sleep(300);
  const picked = await selection();
  check('click selects the shape', picked.length === 1 && picked[0] === 'e2', `selection ${JSON.stringify(picked)}`);
  await shot(page, 'smoke-1-selected');

  // Drag it 100 right and 160 down: the connector's start follows during the drag, the move is saved after.
  // The press lands off the label and after the double-click interval, so it is not a double click that edits the text.
  await sleep(600);
  const before = await wb(page, `arrowLine('e4')`);
  const from = await toPage(page, 30, 100);
  const to = { x: from.x + 100, y: from.y + 160 };
  const during = await drag(page, from, to, {
    during: async () => {
      await shot(page, 'smoke-2-dragging');
      return wb(page, `arrowLine('e4')`);
    },
  });
  const follows = before && during && Math.abs(during.x1 - before.x1 - 100) < 16 && Math.abs(during.y1 - before.y1 - 160) < 16;
  check('the connector follows while dragging', follows, `arrow start ${JSON.stringify(before)} → ${JSON.stringify(during)}`);
  const [moved] = await wb(page, `elements(['e2'])`);
  check('the drag moves the shape', moved && Math.abs(moved.x - 100) < 16 && Math.abs(moved.y - 160) < 16, `e2 at ${moved?.x}, ${moved?.y}`);
  let saved = null;
  for (let i = 0; i < 30 && !(saved && saved.x !== 0); i++) {
    await sleep(200);
    saved = JSON.parse(fs.readFileSync(path.join(root, 'db', 'elements', 'e2.json'), 'utf8'));
  }
  check('the move reaches the board documents', saved && saved.x === moved?.x && saved.y === moved?.y, `e2.json at ${saved?.x}, ${saved?.y}`);
  await shot(page, 'smoke-3-moved');

  // A marquee from open board over Shape B and the free text.
  const m0 = await toPage(page, 860, 20);
  const m1 = await toPage(page, 300, 340);
  await drag(page, m0, m1);
  const boxed = (await selection()).slice().sort();
  check('a marquee selects what it touches', boxed.includes('e3') && boxed.includes('e6') && !boxed.includes('e5'), `selection ${JSON.stringify(boxed)}`);
  await shot(page, 'smoke-4-marquee');

  await page.press('Escape');
  await sleep(200);
  check('Escape clears the selection', (await selection()).length === 0, `selection ${JSON.stringify(await selection())}`);
  return checks;
}

/* ---------------------------------- main ----------------------------------- */

async function main() {
  if (!fs.existsSync(path.join(target, 'whiteboard', 'scripts', 'editors', 'whiteboard', 'index.html'))) throw new Error(`${target} holds no built whiteboard type (npm run build)`);
  const { dir } = install(path.join(target, 'whiteboard'), 'whiteboard');
  const home = path.join(tmpDir('bench-state'), 'state');
  const userHome = tmpDir('bench-home');
  const run = cli(dir, { OPEN_ARTIFACT_TYPE_SERVER_HOME: home, HOME: userHome, OPEN_ARTIFACT_USER: 'Bench' });
  const root = path.join(tmpDir('bench-root'), 'board');
  makeStoredBoard(root);
  const opened = await run.json(['open', root, '--type', 'whiteboard', '--json']);
  const url = `${opened.url}?${['open_artifact_bench=1', PARAMS].filter(Boolean).join('&')}`;

  const browser = await launch();
  const result = { label: LABEL, elements: ELEMENTS, params: PARAMS };
  try {
    const page = await browser.load(url, { ready: `window.__openArtifactWhiteboard && window.__openArtifactWhiteboard.state().elements > 0`, settle: 500, timeout: 60000 });
    result.smoke = await smoke(page, root);

    // The generated board, the whole of it in view.
    const elements = generate(ELEMENTS);
    const rows = Math.ceil(elements.filter(e => e.type !== 'container' && e.type !== 'arrow').length / COLUMNS);
    const width = COLUMNS * CELL.w;
    const height = rows * CELL.h;
    const s = await surfaceBox(page);
    const fit = Math.min(s.w / width, s.h / height) * 0.95;
    await page.evaluate(RECORDER);
    await page.cdp('Performance.enable');
    await look(page, width / 2, height / 2, fit);
    const shown = await page.evaluate(`(() => { const t0 = performance.now(); const kept = window.__openArtifactWhiteboard.show(${JSON.stringify(elements)}); return ${SETTLED('t0')}.then(ms => ({ kept, ms: Math.round(ms) })); })()`);
    await sleep(1500);
    await page.cdp('HeapProfiler.enable').catch(() => {});
    await page.cdp('HeapProfiler.collectGarbage').catch(() => {});
    const metrics = await metricsOf(page);
    const state = await wb(page, 'state()');
    result.load = { shown: shown.kept, interactiveMs: shown.ms, zoom: Math.round(fit * 1000) / 1000, nodes: metrics.Nodes, elementViews: state.elementViews };
    result.memory = { jsHeapMB: Math.round(metrics.JSHeapUsedSize / 1048576), chromeRssMB: rssOfTree(browser.pid) };
    await shot(page, 'overview');

    const centre = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    // Scroll scenarios go out and back (an even number of segments), so the camera ends where it started.
    result.overviewPan = await scenario(page, () => wheel(page, 120, { dx: 24, dy: 12, flip: 30, at: centre }));
    result.overviewZoom = await scenario(page, () => wheel(page, 120, { dy: -12, ctrl: true, flip: 30, at: centre }));

    await look(page, width / 2, height / 2, 0.5);
    await sleep(1000);
    result.mid = { nodes: (await metricsOf(page)).Nodes, elementViews: (await wb(page, 'state()')).elementViews };
    await shot(page, 'mid');
    result.midPan = await scenario(page, () => wheel(page, 120, { dx: 30, dy: 15, flip: 30, at: centre }));

    await look(page, width / 2, height / 2, 1);
    await sleep(1000);
    await shot(page, 'work');
    result.workPan = await scenario(page, () => wheel(page, 120, { dx: 30, dy: 15, flip: 30, at: centre }));
    result.problems = page.problems.filter(p => !/favicon/.test(p)).slice(0, 10);
  } finally {
    await browser.close();
    await run.run(['stop']).catch(() => {});
    removeTmp();
  }
  console.log(JSON.stringify(result, null, 2));
  if (OUT) {
    const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
    fs.writeFileSync(OUT, JSON.stringify([...all, result], null, 2));
  }
}

/* -------------------------------- compare --------------------------------- */

/** Runs this script once per size, and prints the results side by side. */
function compare() {
  const sizes = COMPARE.split(',').map(Number);
  const rows = [];
  for (const elements of sizes) {
    console.error(`… ${elements} elements`);
    const argv = [process.argv[1], '--elements', String(elements), '--label', LABEL, ...(PARAMS ? ['--params', PARAMS] : []), ...(SHOTS ? ['--shots', SHOTS] : [])];
    const out = execFileSync(process.execPath, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 });
    rows.push(JSON.parse(out));
  }
  const pair = r => `${r.fps} / ${r.p95} / ${r.worst}`;
  const lines = [
    '| elements | interactive ms | DOM nodes (overview / 50 %) | heap MB | Chrome RSS MB | overview pan fps / p95 / worst ms | overview zoom | 50 % pan | 100 % pan | smoke |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(r =>
      `| ${r.elements} | ${r.load.interactiveMs} | ${r.load.nodes} / ${r.mid.nodes} | ${r.memory.jsHeapMB} | ${r.memory.chromeRssMB} | ${pair(r.overviewPan)} | ${pair(r.overviewZoom)} | ${pair(r.midPan)} | ${pair(r.workPan)} | ${r.smoke.filter(c => c.ok).length}/${r.smoke.length} |`,
    ),
  ];
  console.log(lines.join('\n'));
  const failed = rows.flatMap(r => r.smoke.filter(c => !c.ok).map(c => `${r.elements} ${r.label}: ${c.name} (${c.why})`));
  if (failed.length) console.log(`\nSmoke failures:\n${failed.join('\n')}`);
  const problems = rows.filter(r => r.problems?.length).map(r => `${r.elements} ${r.label}: ${r.problems.join('; ')}`);
  if (problems.length) console.log(`\nProblems:\n${problems.join('\n')}`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
}

if (COMPARE) compare();
else
  main().catch(e => {
    console.error(e);
    removeTmp();
    process.exit(1);
  });
