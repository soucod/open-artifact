#!/usr/bin/env node
// Rebuilds whiteboard/elements: a board with one of every element kind, style and option,
// then runs the whiteboard check on it.
//   node test-artifacts/whiteboard/elements.gen.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const BY = 'agent';
const els = [];
let n = 0;
const add = (data) => { const id = `e${++n}`; els.push([id, data]); return id; };

// ---------- title ----------
add({ type: 'text', x: 0, y: -190, text: 'Whiteboard element test', size: 'title', by: BY });
add({ type: 'text', x: 0, y: -116, text: 'Every element kind, style and option on one board', size: 'large', color: 'terracotta', by: BY });

// ---------- shapes section ----------
add({ type: 'container', x: 0, y: 0, w: 1180, h: 470, color: 'blue', text: 'Shapes, notes, stickers, arrows' });
const kinds = ['rect', 'rounded', 'ellipse', 'diamond', 'pill', 'hexagon', 'parallelogram', 'database', 'queue', 'document', 'cloud', 'person'];
const colors = ['yellow', 'peach', 'pink', 'green', 'blue', 'purple', 'white', 'yellow', 'peach', 'pink', 'green', 'blue'];
const shapeIds = kinds.map((kind, i) => add({
  type: 'shape', kind, x: 32 + (i % 6) * 190, y: 32 + Math.floor(i / 6) * 150, w: 150, h: 96,
  color: colors[i], size: 'body', text: kind, by: BY,
}));
const hollow = add({ type: 'shape', kind: 'rounded', x: 32, y: 332, w: 170, h: 96, color: 'white', hollow: true, stroke: 'terracotta', text: 'hollow + stroke', by: BY });
const left = add({ type: 'shape', kind: 'rect', x: 252, y: 332, w: 200, h: 96, color: '#ffd6a5', stroke: 'purple', textAlign: 'left', size: 'small', text: '**Left** aligned, *small*, custom `#ffd6a5` fill', by: BY });
const note = add({ type: 'note', x: 502, y: 320, w: 160, h: 120, color: 'yellow', tilt: -3, text: 'A person\'s sticky note', author: 'Tester' });
add({ type: 'sticker', x: 630, y: 300, w: 44, h: 44, glyph: '⭐', on: undefined });
add({ type: 'note', x: 712, y: 320, w: 160, h: 120, color: 'pink', tilt: 2, text: 'Second note\n- list item\n- another' });
const big = add({ type: 'shape', kind: 'pill', x: 922, y: 340, w: 220, h: 80, color: 'green', size: 'large', text: 'Large text', turn: -6, by: BY });

// arrows
add({ type: 'arrow', from: shapeIds[0], to: shapeIds[1], fromSide: 'right', toSide: 'left', label: 'labelled', by: BY });
add({ type: 'arrow', from: shapeIds[1], to: shapeIds[2], fromSide: 'right', toSide: 'left', dash: true, color: 'blue', by: BY });
add({ type: 'arrow', from: shapeIds[2], to: shapeIds[3], fromSide: 'right', toSide: 'left', head: 'both', color: 'terracotta', by: BY });
add({ type: 'arrow', from: shapeIds[3], to: shapeIds[4], fromSide: 'right', toSide: 'left', heads: ['circle', 'arrow'], color: 'purple', by: BY });
add({ type: 'arrow', from: shapeIds[4], to: shapeIds[5], fromSide: 'right', toSide: 'left', head: 'none', color: 'green', by: BY });
add({ type: 'arrow', from: shapeIds[0], to: shapeIds[6], fromSide: 'bottom', toSide: 'top', by: BY });
add({ type: 'arrow', from: shapeIds[6], to: shapeIds[11], bends: ['v', 70, 0, 0], label: 'with bends', color: 'blue', by: BY });
add({ type: 'arrow', from: shapeIds[5], to: [1250, 80], fromSide: 'right', label: 'free end', color: 'terracotta', by: BY });
add({ type: 'arrow', from: hollow, to: left, fromSide: 'right', toSide: 'left', by: BY });

// ---------- text and ink section ----------
add({ type: 'container', x: 1300, y: 0, w: 620, h: 470, color: 'peach', text: 'Text and pen' });
add({ type: 'text', x: 1332, y: 32, text: 'small 14', size: 'small', by: BY });
add({ type: 'text', x: 1450, y: 28, text: 'body 16', size: 'body', color: 'blue', by: BY });
add({ type: 'text', x: 1560, y: 18, text: 'large 28', size: 'large', color: 'green', by: BY });
add({ type: 'text', x: 1332, y: 80, wrap: 360, by: BY, size: 'body',
  text: 'Wrapped text with **bold**, *italic*, ***both***, `code` and a [link](https://example.com).\n- bullet one\n- bullet two\n1. numbered\n2. numbered' });
add({ type: 'text', x: 1720, y: 80, wrap: 170, text: 'Right aligned in purple', textAlign: 'right', color: 'purple', by: BY });
add({ type: 'text', x: 1332, y: 260, text: '', placeholder: 'Type your answer here…', size: 'large', by: BY });
add({ type: 'stroke', x: 1340, y: 330, points: [0, 0, 220, 10], color: 'terracotta', width: 5 });
const wave = [];
for (let i = 0; i <= 14; i++) wave.push(i * 20, Math.round(Math.sin(i / 2) * 26));
add({ type: 'stroke', x: 1340, y: 400, points: wave, color: 'blue', width: 3 });
add({ type: 'stroke', x: 1680, y: 320, points: [0, 100, 60, 0, 60, 0, 120, 100, 120, 100, 0, 100], color: 'green', width: 4 });

// ---------- table, embed, link, timer, picture ----------
add({ type: 'container', x: 0, y: 540, w: 1920, h: 400, color: 'green', text: 'Table, embed, link, timer, picture' });
add({
  type: 'table', x: 32, y: 572, head: true, color: 'white', by: BY,
  cols: { c1: { at: 1, w: 140 }, c2: { at: 2, w: 100 }, c3: { at: 3, w: 100 }, c4: { at: 4, w: 100 } },
  rows: {
    r1: { at: 1, c1: 'Region', c2: 'Q1', c3: 'Q2', c4: 'Q3' },
    r2: { at: 2, c1: 'North', c2: 12, c3: 30, c4: 18 },
    r3: { at: 3, c1: 'South', c2: 25, c3: 8, c4: 40 },
    r4: { at: 4, c1: 'East', c2: 5, c3: 22, c4: 33 },
    r5: { at: 5, c1: 'West', c2: 41, c3: 15, c4: 9 },
  },
  fills: { r2: { c1: 'yellow' }, r3: { c1: '#1e3a8a' }, r5: { c1: 'pink' } },
  heat: { cols: { c2: 'blue', c3: 'green', c4: 'purple' } },
});
const embedHtml = `<title>Vote</title><style>body{font:14px system-ui;margin:12px}button{margin:4px;padding:6px 10px}#t{font-weight:600}</style>
<div id='t'>Which idea first?</div>
<div><button type='button' id='a'>Idea A</button><span id='va'>0</span></div>
<div><button type='button' id='b'>Idea B</button><span id='vb'>0</span></div>
<script>
var data = Object.assign({votes: [0, 0]}, boardEmbed.load());
function draw() { document.getElementById('va').textContent = ' ' + data.votes[0]; document.getElementById('vb').textContent = ' ' + data.votes[1]; }
function changed() { draw(); boardEmbed.save(data); }
boardEmbed.onLoad(function (theirs) { if (theirs) { data = theirs; draw(); } });
document.getElementById('a').addEventListener('click', function () { data.votes[0]++; changed(); });
document.getElementById('b').addEventListener('click', function () { data.votes[1]++; changed(); });
draw();
</script>`;
add({ type: 'html', x: 540, y: 572, w: 300, h: 200, html: embedHtml, state: '{"votes":[2,1]}', by: BY });
add({ type: 'link', x: 880, y: 572, href: 'https://example.com', title: 'A web page link card', kind: 'web' });
add({ type: 'link', x: 880, y: 652, href: 'https://example.com/board', title: 'A whiteboard link card', kind: 'whiteboard' });
add({ type: 'timer', x: 880, y: 740, durationMs: 300000, endsAt: null, remainingMs: 300000 });
add({ type: 'image', x: 1240, y: 572, w: 320, h: 200, src: pngDataUri(160, 100), href: 'https://example.com' });
add({ type: 'image', x: 1600, y: 572, w: 280, h: 200, src: pngDataUri(160, 100), crop: { zoom: 2, x: 0.2, y: 0.3 } });
add({ type: 'text', x: 1240, y: 790, text: 'PNG picture with a link', size: 'small', by: BY });
add({ type: 'text', x: 1600, y: 790, text: 'Same picture, cropped 2×', size: 'small', by: BY });

// ---------- drawings ----------
add({ type: 'container', x: 0, y: 1010, w: 1920, h: 640, color: 'purple', text: 'Drawings in every style' });
const styles = ['watercolor', 'comic', 'draft', 'paper', 'blueprint', 'marker', 'plain'];
styles.forEach((style, i) => {
  const x = 32 + (i % 4) * 470, y = 1042 + Math.floor(i / 4) * 300;
  add({ type: 'image', x, y, w: 300, h: 240, by: BY, style, src: 'data:image/svg+xml,' + mug(style) });
  add({ type: 'text', x: x + 316, y: y + 100, text: style, size: 'large', by: BY });
});

// ---------- write ----------
// sticker sits on the first note
const stickerEntry = els.find(([, d]) => d.type === 'sticker');
const noteEl = els.find(([id]) => id === note)[1];
stickerEntry[1].on = [note, noteEl.x, noteEl.y, stickerEntry[1].x, stickerEntry[1].y];
const docs = { 'board/meta': { v: 1, title: 'Whiteboard element test', order: els.map(([id]) => id) } };
for (const [id, data] of els) docs[`elements/${id}`] = JSON.parse(JSON.stringify(data));

// The files are written directly, not through write-db: some elements here
// (notes, the sticker) are people's, and an agent's write-db refuses them.
const cli = path.join(REPO, 'artifact-types', 'whiteboard', 'scripts', 'cli.mjs');
if (!existsSync(cli)) {
  console.error('No whiteboard CLI yet: run npm run build first.');
  process.exit(1);
}
const root = path.join(HERE, 'elements');
rmSync(path.join(root, 'db'), { recursive: true, force: true });
for (const [doc, data] of Object.entries(docs)) {
  const file = path.join(root, 'db', `${doc}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
}
const check = spawnSync(process.execPath, [cli, 'check', root], { encoding: 'utf8' });
if (check.status) {
  process.stdout.write(check.stdout + check.stderr);
  process.exit(check.status);
}
console.log(`${els.length} elements in ${path.relative(process.cwd(), root) || '.'}; check passed`);

function mug(style) {
  const c = (h) => '%23' + h;
  const flat = style === 'watercolor' || style === 'paper';
  const op = style === 'watercolor' ? " fill-opacity='.6'" : '';
  const root = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 240' stroke='${flat ? 'none' : 'currentColor'}' fill='none' stroke-width='2.5' stroke-linejoin='round' stroke-linecap='round'>`;
  const desc = `<desc>Three-quarter view of a coffee mug on a saucer with steam: saucer, saucer rim, mug body, mug top ellipse, coffee surface, handle, handle hole, highlight, shadow, rim line, steam curls, foam spots, spoon, spoon bowl, base ring, seam, crema ring, saucer shadow, table patch, sugar cube</desc>`;
  let body = '';
  if (style !== 'blueprint') body += `<path d='M30 215 Q150 190 270 215 Q150 236 30 215 Z' fill='${c('c9b79c')}'${op}/>`;
  body += `<ellipse cx='150' cy='200' rx='110' ry='22' fill='${c(style === 'blueprint' ? 'ffffff' : 'e8dccb')}'${op}/>`;
  body += `<ellipse cx='150' cy='196' rx='70' ry='12' fill='${c('d8c8b0')}'${op} stroke-width='1.2'/>`;
  const cut = style === 'blueprint' ? " class='cut'" : '';
  body += `<path${cut} d='M85 80 L95 190 Q150 206 205 190 L215 80 Z' fill='${c(style === 'blueprint' ? 'ffffff' : style === 'comic' ? 'e63946' : 'c0573e')}'${op}/>`;
  body += `<path d='M205 100 Q255 100 252 140 Q248 178 200 172' fill='none' stroke='${flat ? c('8f3b28') : 'currentColor'}' stroke-width='${flat ? 14 : 8}'/>`;
  body += `<ellipse cx='150' cy='80' rx='65' ry='16' fill='${c('f4e9da')}'${op}/>`;
  body += `<ellipse cx='150' cy='82' rx='54' ry='11' fill='${c('5b3a24')}'${op}/>`;
  body += `<path d='M108 95 L114 180' stroke='${c('f6c1b3')}' stroke-width='6'/>`;
  if (style === 'comic') body += `<path d='M40 40 L70 60 M30 80 L62 88 M260 40 L232 62' stroke='currentColor' stroke-width='4'/>`;
  if (style === 'draft') body = `<line x1='0' y1='196' x2='300' y2='196' stroke='${c('bbbbbb')}' stroke-width='1'/>` + body;
  if (style === 'blueprint') body += `<line x1='150' y1='20' x2='150' y2='230' stroke-dasharray='18 4 3 4' stroke-width='1'/><path d='M85 230 L215 230 M85 224 L85 236 M215 224 L215 236' stroke-width='1'/>`;
  body += `<path d='M130 60 Q120 45 132 32 Q144 20 134 6 M160 60 Q150 44 162 30 Q174 18 164 4' fill='none' stroke='${flat ? c('9aa5b1') : 'currentColor'}' stroke-width='3'/>`;
  return root + desc + body + '</svg>';
}

function pngDataUri(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = Math.round(240 * x / w); raw[o + 1] = Math.round(120 + 100 * y / h); raw[o + 2] = 200 - Math.round(150 * x / w);
      if ((x - 80) ** 2 + (y - 50) ** 2 < 600) { raw[o] = 255; raw[o + 1] = 220; raw[o + 2] = 80; }
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}

