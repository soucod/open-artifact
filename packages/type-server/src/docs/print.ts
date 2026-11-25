/**
 * A doc as a page made for printing, and that page as a PDF, printed by Chromium: tagged, with an outline. The Chromium
 * is the user's own Chrome (`$OPEN_ARTIFACT_CHROME`, else the usual places, chrome.ts). With none, the page can open its
 * browser's print dialog on this same HTML instead, and the CLI says what to do.
 *
 * The page is built from text and the doc's own pictures, inside it: everything is escaped, nothing loads from anywhere
 * (its own Content-Security-Policy says so too), so a doc can't run or fetch anything while it prints.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type Block,
  columnWidths,
  DEFAULT_HIGHLIGHT,
  type DocFont,
  type DocLanguage,
  escapeAttr,
  escapeXml,
  type ExportNote,
  ExportNotes,
  ExportRefusal,
  type ExportSource,
  headingOf,
  hexColor,
  type Inline,
  linkOf,
  noteEmbed,
  notePending,
  opensWithName,
  type Paper,
  type SegmentImage,
  segmentsOf,
  spanOf,
  TEXT_COLORS,
  textColorOf,
} from '@open-artifact/docs-core';
import { findChrome, launchChrome } from './chrome.ts';

/** Page margins, here and in the print call: the header and footer stand in them. */
const MARGIN_MM = { y: 18, x: 16 };
const PAPER_INCHES: Record<Paper, { width: number; height: number }> = { a4: { width: 210 / 25.4, height: 297 / 25.4 }, letter: { width: 8.5, height: 11 } };
const PAGE_SIZE: Record<Paper, string> = { a4: 'A4', letter: 'letter' };
const LANG: Record<DocLanguage, string> = { en: 'en', zh: 'zh-CN', ja: 'ja', ko: 'ko' };
const RENDER_TIMEOUT_MS = 120_000;

/** System faces, as the page falls back to them, with the Chinese, Japanese and Korean ones each platform has. */
const FACES: Record<DocFont, string> = {
  sans: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", Times, "Songti SC", "Noto Serif CJK SC", SimSun, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Courier New", "PingFang SC", "Microsoft YaHei", monospace',
};

function styleOf(source: ExportSource): string {
  return `
@page { size: ${PAGE_SIZE[source.paper]}; margin: ${MARGIN_MM.y}mm ${MARGIN_MM.x}mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; color: #1f1e1d; font: 12pt/1.5 ${FACES[source.fonts.text]}; overflow-wrap: break-word; }
@media screen { body { max-width: 760px; margin: 40px auto; padding: 0 24px; } }
h1, h2, h3, h4, h5, h6 { font-family: ${FACES[source.fonts.headings]}; font-weight: 400; break-after: avoid; break-inside: avoid; }
h1 { font-size: 26pt; line-height: 1.2; margin: 0 0 10pt; }
h2 { font-size: 17pt; line-height: 1.25; margin: 18pt 0 6pt; }
h3 { font-size: 13.5pt; line-height: 1.3; margin: 14pt 0 5pt; }
h4 { font-size: 12pt; font-weight: 600; margin: 12pt 0 4pt; }
h5 { font-size: 11pt; font-weight: 600; margin: 10pt 0 4pt; }
h6 { font-size: 11pt; color: #6b6a65; margin: 10pt 0 4pt; }
p { margin: 0 0 8pt; }
ul, ol { margin: 0 0 8pt; padding-left: 22pt; }
li { margin: 0 0 2pt; }
li > p { margin: 0 0 2pt; }
li > ul, li > ol { margin: 2pt 0; }
ol ol { list-style-type: lower-alpha; }
ol ol ol { list-style-type: lower-roman; }
ul.check { list-style: none; padding-left: 22pt; }
ul.check > li { position: relative; }
.box { position: absolute; left: -18pt; }
blockquote { margin: 0 0 8pt; padding-left: 12pt; border-left: 2.5pt solid #d9d8d2; color: #4a4945; }
pre { margin: 0 0 10pt; padding: 8pt 10pt; background: #f5f4f0; border-radius: 4pt; font: 9.5pt/1.45 ${FACES.mono}; white-space: pre-wrap; overflow-wrap: anywhere; }
code { font-family: ${FACES.mono}; font-size: .88em; background: #f5f4f0; border-radius: 3pt; padding: .08em .3em; }
pre code { font: inherit; background: none; padding: 0; }
/* A collapsed border stands half outside its table: a full-width table would lose its right edge to the page margin. */
table { width: calc(100% - 1pt); margin: 0 0 10pt .5pt; border-collapse: collapse; font-size: 10.5pt; line-height: 1.45; }
table.sized { table-layout: fixed; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { padding: 5pt 7pt; border: .75pt solid #e3e2dc; vertical-align: top; text-align: left; font-weight: 400; overflow-wrap: anywhere; }
th { background: #f5f4f0; }
th > :last-child, td > :last-child { margin-bottom: 0; }
hr { margin: 12pt 0; border: 0; border-top: .75pt solid #d9d8d2; }
a { color: #1a5fb4; }
mark { color: inherit; }
img { max-width: 100%; height: auto; }
.chip { padding: .1em .45em; background: #f0efea; border-radius: 3pt; font-size: .84em; }
section + section { break-before: page; }
`;
}

/** A picture travels inside the page, as everything does: the page loads nothing. */
function imageHtml(image: SegmentImage): string {
  const size = image.width ? ` style="width:${image.width}px"` : '';
  return `<img src="data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}" alt="${escapeAttr(image.alt)}"${size}>`;
}

function inlineHtml(inline: Inline[], source: ExportSource, notes: ExportNotes): string {
  return segmentsOf(inline, source, notes)
    .map(segment => {
      const marks = segment.marks ?? {};
      let html = segment.image ? imageHtml(segment.image) : escapeXml(segment.text).replaceAll('\n', '<br>');
      if (segment.chip) html = `<span class="chip">${html}</span>`;
      if (marks.code) html = `<code>${html}</code>`;
      if (marks.highlight !== undefined) html = `<mark style="background:#${hexColor(marks.highlight) ?? DEFAULT_HIGHLIGHT}">${html}</mark>`;
      if (marks.underline) html = `<u>${html}</u>`;
      if (marks.strike) html = `<s>${html}</s>`;
      if (marks.italic) html = `<em>${html}</em>`;
      if (marks.bold) html = `<strong>${html}</strong>`;
      const to = linkOf(marks.link, source);
      const href = to ? ('href' in to ? to.href : `#${to.anchor.id}`) : undefined;
      // A link keeps the link's colour, as on the page.
      const color = href ? undefined : TEXT_COLORS[textColorOf(marks.textColor) ?? ''];
      if (color) html = `<span style="color:#${color}">${html}</span>`;
      return href ? `<a href="${escapeAttr(href)}">${html}</a>` : html;
    })
    .join('');
}

/** ` id="…"` on a block a link inside the doc goes to. */
const idOf = (block: Block, source: ExportSource) => {
  const anchor = source.anchors?.blocks.get(block.id);
  return anchor ? ` id="${escapeAttr(anchor.id)}"` : '';
};

function blockHtml(block: Block, source: ExportSource, notes: ExportNotes): string {
  const children = () => blocksHtml(block.children ?? [], source, notes);
  const id = idOf(block, source);
  switch (block.type) {
    case 'paragraph': {
      const html = inlineHtml(block.inline ?? [], source, notes);
      const level = headingOf(block);
      if (!html) return `<p${id}><br></p>`;
      return level ? `<h${level}${id}>${html}</h${level}>` : `<p${id}>${html}</p>`;
    }
    case 'codeBlock': {
      const text = segmentsOf(block.inline ?? [], source, notes).map(segment => segment.text).join('');
      return `<pre${id}><code>${escapeXml(text)}</code></pre>`;
    }
    case 'horizontalRule':
      return `<hr${id}>`;
    case 'pending':
      notePending(notes);
      return '';
    case 'embed':
      noteEmbed(notes);
      return '';
    case 'blockquote':
      return `<blockquote${id}>${children()}</blockquote>`;
    case 'list':
      return listHtml(block, source, notes);
    case 'table':
      return tableHtml(block, source, notes);
    default:
      return id ? `<div${id}>${children()}</div>` : children();
  }
}

const blocksHtml = (blocks: Block[], source: ExportSource, notes: ExportNotes) => blocks.map(block => blockHtml(block, source, notes)).join('');

function listHtml(block: Block, source: ExportSource, notes: ExportNotes): string {
  const kind = block.attrs?.kind;
  const items = (block.children ?? []).map(item => {
    const box = kind === 'check' ? `<span class="box">${item.attrs?.checked === true ? '☑' : '☐'}</span>` : '';
    return `<li${idOf(item, source)}>${box}${blocksHtml(item.children ?? [], source, notes)}</li>`;
  });
  if (kind !== 'ordered') return `<ul${idOf(block, source)}${kind === 'check' ? ' class="check"' : ''}>${items.join('')}</ul>`;
  const start = Number(block.attrs?.start);
  const numbering = block.attrs?.numbering;
  const type = typeof numbering === 'string' && ['a', 'A', 'i', 'I'].includes(numbering) ? numbering : undefined;
  return `<ol${idOf(block, source)}${Number.isInteger(start) && block.attrs?.start !== undefined ? ` start="${start}"` : ''}${type ? ` type="${type}" style="list-style-type:${{ a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' }[type]}"` : ''}>${items.join('')}</ol>`;
}

function tableHtml(block: Block, source: ExportSource, notes: ExportNotes): string {
  const rows = block.children ?? [];
  if (!rows.length) return '';
  // The doc's own column widths, when its first row gives every column one; the browser lays out the rest.
  const widths = (rows[0]!.children ?? []).flatMap(cell => {
    const given = columnWidths(cell.attrs?.colwidth);
    const span = spanOf(cell.attrs?.colspan);
    return given.length === span ? given : given.length === 1 ? Array.from({ length: span }, () => given[0]! / span) : Array.from({ length: span }, () => 0);
  });
  const sized = widths.length > 0 && widths.every(width => width > 0);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const columns = sized ? `<colgroup>${widths.map(width => `<col style="width:${((width / total) * 100).toFixed(2)}%">`).join('')}</colgroup>` : '';
  const isHeader = (row: Block) => (row.children ?? []).length > 0 && (row.children ?? []).every(cell => cell.attrs?.header === true);
  let leading = 0;
  while (leading < rows.length && isHeader(rows[leading]!)) leading++;
  const rowHtml = (row: Block) =>
    `<tr${idOf(row, source)}>${(row.children ?? [])
      .map(cell => {
        const tag = cell.attrs?.header === true ? 'th' : 'td';
        const colspan = spanOf(cell.attrs?.colspan);
        const rowspan = spanOf(cell.attrs?.rowspan);
        const align = cell.attrs?.align === 'center' || cell.attrs?.align === 'right' ? `text-align:${cell.attrs.align};` : '';
        const fill = hexColor(cell.attrs?.background);
        const style = align + (fill ? `background:#${fill};` : '');
        return `<${tag}${idOf(cell, source)}${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}${style ? ` style="${style}"` : ''}>${blocksHtml(cell.children ?? [], source, notes)}</${tag}>`;
      })
      .join('')}</tr>`;
  const head = leading ? `<thead>${rows.slice(0, leading).map(rowHtml).join('')}</thead>` : '';
  return `<table${idOf(block, source)}${sized ? ' class="sized"' : ''}>${columns}${head}<tbody>${rows.slice(leading).map(rowHtml).join('')}</tbody></table>`;
}

/** The page. `notes` gets what stayed out of it. */
export function printHtml(source: ExportSource, notes: ExportNotes): string {
  const several = source.tabs.length > 1;
  const body = source.tabs
    .map((tab, index) => {
      const anchor = source.anchors?.tabs[index];
      return `<section${anchor ? ` id="${escapeAttr(anchor.id)}"` : ''}>${several && !opensWithName(tab) ? `<h1>${escapeXml(tab.name)}</h1>` : ''}${blocksHtml(tab.blocks, source, notes)}</section>`;
    })
    .join('');
  return `<!doctype html>
<html lang="${LANG[source.language]}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${escapeXml(source.title)}</title>
<style>${styleOf(source)}</style>
</head>
<body>${body}</body>
</html>
`;
}

// Chrome is the slow part of an export, and one is enough.
let printing: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  const run = printing.then(job, job);
  printing = run.catch(() => undefined);
  return run;
}

function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took more than ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const headerStyle = `font: 7pt ${FACES.sans.replaceAll('"', "'")}; color: #7a7a75; width: 100%; padding: 0 ${MARGIN_MM.x}mm;`;

/** The PDF of the page: tagged, with an outline from its headings, the title above each page and its number below. */
export async function renderPdf(source: ExportSource): Promise<{ bytes: Buffer; notes: ExportNote[]; pages?: number }> {
  const chrome = findChrome();
  if (!chrome) {
    const given = process.env.OPEN_ARTIFACT_CHROME;
    const fix = given ? `OPEN_ARTIFACT_CHROME is ${given}, which is no file.` : 'Install Google Chrome (or Chromium, Edge, Brave), or set OPEN_ARTIFACT_CHROME to its program.';
    throw new ExportRefusal('no_chrome', `A PDF is printed by Chrome, and there is none here. ${fix} Or export as html and print that from any browser.`, 503);
  }
  const notes = new ExportNotes();
  const html = printHtml(source, notes);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-artifact-docs-print-'));
  const file = path.join(dir, 'doc.html');
  fs.writeFileSync(file, html);
  const paper = PAPER_INCHES[source.paper];
  try {
    const data = await oneAtATime(async () => {
      const browser = await launchChrome(chrome);
      try {
        const printed = (async () => {
          const page = await browser.page();
          await page.navigate(pathToFileURL(file).href);
          await page.evaluate('document.fonts.ready.then(() => true)');
          const result = await page.send('Page.printToPDF', {
            printBackground: true,
            generateTaggedPDF: true,
            generateDocumentOutline: true,
            displayHeaderFooter: true,
            headerTemplate: `<div style="${headerStyle}"><span class="title"></span></div>`,
            footerTemplate: `<div style="${headerStyle} text-align: right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
            paperWidth: paper.width,
            paperHeight: paper.height,
            marginTop: MARGIN_MM.y / 25.4,
            marginBottom: MARGIN_MM.y / 25.4,
            marginLeft: MARGIN_MM.x / 25.4,
            marginRight: MARGIN_MM.x / 25.4,
          });
          return String(result.data);
        })();
        return await within(printed, RENDER_TIMEOUT_MS, 'printing');
      } finally {
        await browser.close();
      }
    });
    const bytes = Buffer.from(data, 'base64');
    const pages = bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length;
    return { bytes, notes: notes.list(), ...(pages ? { pages } : {}) };
  } catch (error) {
    if (error instanceof ExportRefusal) throw error;
    throw new ExportRefusal('renderer_unavailable', `Chrome could not print the doc: ${(error as Error).message}`, 503);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
