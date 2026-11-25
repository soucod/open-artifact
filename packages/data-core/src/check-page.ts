import type { Table } from './types.ts';
import { cellToString } from './tables.ts';
import { DASH_PAGE_TOKENS, dashChartToken, MAX_LOOK_CHARTS } from './look.ts';

/** How a page finding is told: the document it is in, and a line of that document's text when it has one. */
export type PageReport = (doc: string, level: 'error' | 'warning', message: string, line?: number) => void;

/** A dataset as the page check knows it: its rows when the check could read them. */
export interface PageDatasetInfo {
  table: Table | null;
}

/** What the page check learnt of the page's scripts and marks. */
export interface PageCheckOutcome {
  /** Dataset and calc ids some element names in `data-source`. */
  marked: Set<string>;
  /** Dataset ids the scripts read (`dash.data` / `dash.refresh`), with the document that reads each first. */
  reads: Map<string, string>;
  /** Each `dash.calc` id with the input ids it names. */
  calcs: Map<string, string[]>;
}

interface HtmlElement {
  tag: string;
  attrs: Record<string, string>;
  line: number;
  parent: number;
}

interface HtmlBlock {
  el: number;
  text: string;
  line: number;
}

interface HtmlText {
  text: string;
  el: number;
  line: number;
}

interface PageScript {
  doc: string;
  text: string;
  line: number;
}

const VOID_TAGS: ReadonlySet<string> = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const DROPPED_TAGS: ReadonlySet<string> = new Set(['meta', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'portal', 'fencedframe']);
const SCRIPT_TYPES: ReadonlySet<string> = new Set(['', 'text/javascript', 'application/javascript']);
const FIGURE_PATTERN = /(?<![\w.#-])(?:[$€£¥]\s?\d[\d,.]*|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s?%|\d+\.\d+|\d{3,})(?![\w.-])/;
const YEAR_OR_DATE_PATTERN = /^(?:19|20)\d{2}$|\d{4}-\d{2}/;
/** What a drawing may be stored holding (the runtime's empty value): nothing, a dash, or n/a. */
const EMPTY_DRAWING_PATTERN = /^[\s–—−\-·.…]*$|^n\/?a$/i;
const MAX_FIGURE_WARNINGS = 8;
const PAGE_DOC = 'files/index.html';

/** The tokens a page may use (`var(--…)`): the ones `#dash-root` defines, which `dash/look` sets. */
export const DASH_DEFINED_TOKENS: ReadonlySet<string> = new Set([
  ...DASH_PAGE_TOKENS,
  '--dash-font-weight-medium',
  '--dash-shadow-popover',
  '--dash-dur-fast',
  '--dash-dur-slow',
  '--dash-ease-out',
  '--dash-gutter',
  ...['xs', 'sm', 'md', 'lg', 'xl'].flatMap((size) => [`--dash-gap-${size}`, `--dash-pad-${size}`]),
  ...Array.from({ length: MAX_LOOK_CHARTS }, (_, index) => dashChartToken(index + 1)),
]);
const TOKEN_USE_PATTERN = /var\(\s*(--(?:dash|color|font)-[A-Za-z0-9_-]+)/g;
const TOKEN_DEFINITION_PATTERN = /(--[A-Za-z0-9_-]+)\s*:/g;

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match: string, entity: string) => {
    const key = entity.toLowerCase();
    if (key === 'amp') return '&';
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    if (key === 'quot') return '"';
    if (key === 'apos') return "'";
    if (key === 'nbsp') return ' ';
    const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) attrs[(match[1] ?? '').toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
  return attrs;
}

/** A light scan of a page's HTML: elements (tag, attributes, line, parent), inline scripts and styles, text runs. */
function scanHtml(html: string): { elements: HtmlElement[]; scripts: HtmlBlock[]; styles: HtmlBlock[]; texts: HtmlText[] } {
  const elements: HtmlElement[] = [];
  const scripts: HtmlBlock[] = [];
  const styles: HtmlBlock[] = [];
  const texts: HtmlText[] = [];
  const stack: number[] = [];
  const lower = html.toLowerCase();
  const lineAt = (index: number): number => html.slice(0, index).split('\n').length;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    const textEnd = lt === -1 ? html.length : lt;
    if (textEnd > i) {
      const text = html.slice(i, textEnd);
      if (text.trim()) texts.push({ text: decodeHtmlEntities(text), el: stack.at(-1) ?? -1, line: lineAt(i) });
    }
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      const name = html.slice(lt + 2, end === -1 ? html.length : end).trim().toLowerCase();
      for (let k = stack.length - 1; k >= 0; k--) {
        if (elements[stack[k] ?? -1]?.tag === name) {
          stack.length = k;
          break;
        }
      }
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const match = /^<([A-Za-z][A-Za-z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(lt));
    if (!match) {
      i = lt + 1;
      continue;
    }
    const tag = (match[1] ?? '').toLowerCase();
    const rawAttrs = match[2] ?? '';
    const selfClosing = /\/\s*$/.test(rawAttrs);
    const element: HtmlElement = { tag, attrs: parseAttributes(rawAttrs.replace(/\/\s*$/, '')), line: lineAt(lt), parent: stack.at(-1) ?? -1 };
    elements.push(element);
    const index = elements.length - 1;
    i = lt + match[0].length;
    if (tag === 'script' || tag === 'style') {
      const close = lower.indexOf(`</${tag}`, i);
      const body = html.slice(i, close === -1 ? html.length : close);
      (tag === 'script' ? scripts : styles).push({ el: index, text: body, line: element.line });
      const end = close === -1 ? html.length : html.indexOf('>', close);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(index);
  }
  return { elements, scripts, styles, texts };
}

/** The ids every page file names in `dash.loader("<id>", …)`. */
export function getDeclaredLoaders(files: ReadonlyMap<string, string>): Set<string> {
  const loaders = new Set<string>();
  for (const text of files.values()) for (const match of text.matchAll(/dash\.loader\(\s*(['"`])([^'"`]+)\1/g)) loaders.add(match[2] ?? '');
  return loaders;
}

/** Whether a script compiles, or its syntax error. */
function scriptSyntaxError(text: string): string | null {
  try {
    // Compiled only, never run: the check reads the page's scripts as text.
    new Function(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const decodeComponent = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/**
 * Checks the page (`files/index.html` and the scripts and stylesheets it loads) against the datasets: what the page
 * drops, scripts that don't parse, calcs and loaders, drawings, tokens, marks and figures outside marks.
 */
export function checkDashboardPage(
  files: ReadonlyMap<string, string>,
  datasets: ReadonlyMap<string, PageDatasetInfo>,
  report: PageReport,
): PageCheckOutcome {
  const calcs = new Map<string, string[]>();
  const loaders = new Map<string, string>();
  const reads = new Map<string, string>();
  const marked = new Set<string>();
  const index = files.get('index.html');
  if (index === undefined) return { marked, reads, calcs };
  const page = scanHtml(index);
  const js: PageScript[] = [];
  const css: string[] = [];
  const isOneWriterMeta = (element: HtmlElement): boolean => element.tag === 'meta' && element.attrs.name === 'dash-one-writer';
  const oneWriter = page.elements.some(isOneWriterMeta);
  for (const element of page.elements) {
    if (DROPPED_TAGS.has(element.tag) && !isOneWriterMeta(element))
      report(PAGE_DOC, 'warning', `<${element.tag}> is dropped.`, element.line);
    const priority = element.attrs['data-fetchpriority'];
    if (priority !== undefined && !['high', 'low'].includes(priority.trim().toLowerCase()))
      report(PAGE_DOC, 'warning', `data-fetchpriority="${priority}" reads as auto; it is high or low.`, element.line);
    for (const name of Object.keys(element.attrs))
      if (name.startsWith('on') && name.length > 2) report(PAGE_DOC, 'warning', `${name}= doesn’t run; add a listener in a script.`, element.line);
    if (element.tag === 'link' && /(^|\s)stylesheet(\s|$)/i.test(element.attrs.rel ?? '')) {
      const name = (element.attrs.href ?? '').trim().replace(/^\.\//, '');
      const text = files.get(name);
      if (text !== undefined) css.push(text);
      else report(PAGE_DOC, 'warning', `<link href="${element.attrs.href ?? ''}"> names no files/<name>, so it is dropped.`, element.line);
    }
  }
  for (const script of page.scripts) {
    const element = page.elements[script.el];
    if (element === undefined) continue;
    const type = (element.attrs.type ?? '').trim().toLowerCase();
    if (!SCRIPT_TYPES.has(type)) {
      if (type === 'module') report(PAGE_DOC, 'warning', '<script type="module"> doesn’t run here; no modules.', element.line);
      continue;
    }
    if (element.attrs.src !== undefined) {
      const name = element.attrs.src.trim().replace(/^\.\//, '');
      const text = files.get(name);
      if (text !== undefined) js.push({ doc: `files/${name}`, text, line: 1 });
      else report(PAGE_DOC, 'warning', `<script src="${element.attrs.src}"> names no files/<name>, so it is dropped (d3 is already the global d3).`, element.line);
    } else js.push({ doc: PAGE_DOC, text: script.text, line: script.line });
  }
  for (const style of page.styles) css.push(style.text);

  const calcDocs = new Map<string, string>();
  for (const script of js) {
    const syntax = scriptSyntaxError(script.text);
    if (syntax !== null) report(script.doc, 'error', `A script doesn’t parse (from line ${script.line}): ${syntax}`, script.line);
    for (const match of script.text.matchAll(/dash\.calc\(\s*(['"`])([^'"`]+)\1/g)) {
      const after = script.text.slice(match.index, match.index + 600);
      const inputs = /inputs\s*:\s*\[([^\]]*)\]/.exec(after)?.[1];
      const id = match[2] ?? '';
      calcs.set(id, inputs ? [...inputs.matchAll(/(['"`])([^'"`]+)\1/g)].map((input) => input[2] ?? '') : []);
      calcDocs.set(id, script.doc);
    }
    for (const match of script.text.matchAll(/dash\.loader\(\s*(['"`])([^'"`]+)\1/g))
      if (!loaders.has(match[2] ?? '')) loaders.set(match[2] ?? '', script.doc);
    for (const match of script.text.matchAll(/dash\.(?:data|refresh)\(\s*(['"`])([^'"`]+)\1/g)) {
      const id = match[2] ?? '';
      if (!reads.has(id)) reads.set(id, script.doc);
    }
    for (const match of script.text.matchAll(/var\(--(?:dash|color|font)-[A-Za-z0-9_-]*\$\{/g))
      report(script.doc, 'warning', `${match[0]}…: write token names in full; a built name hides a typo.`);
    if (/\.innerHTML\s*=|\.html\(/.test(script.text))
      report(script.doc, 'warning', 'uses innerHTML / .html(): data values are untrusted text; show them with textContent / .text().');
    if (/\b(?:localStorage|sessionStorage|document\.cookie|indexedDB)\b/.test(script.text))
      report(script.doc, 'warning', 'uses storage or cookies, which the dashboard doesn’t have.');
    if (/\bfetch\(|XMLHttpRequest|new WebSocket|import\(/.test(script.text))
      report(script.doc, 'warning', 'reaches the network or imports a module; the page has no network: data comes from dash.data.');
  }
  for (const [id, inputs] of calcs) {
    const doc = calcDocs.get(id) ?? PAGE_DOC;
    if (datasets.has(id)) report(doc, 'error', `dash.calc("${id}") uses a dataset’s id; a calc takes an id no dataset has.`);
    for (const input of inputs)
      if (!datasets.has(input) && !calcs.has(input)) report(doc, 'error', `dash.calc("${id}") reads input "${input}", which is no dataset or calc.`);
  }
  for (const [id, doc] of loaders) if (!datasets.has(id)) report(doc, 'warning', `dash.loader("${id}") names no dataset; a loader runs for the dataset with its id.`);

  checkDrawings(page, js, oneWriter, report);
  checkTokens(page, js, css, report);
  checkMarks(page, datasets, calcs, marked, report);
  return { marked, reads, calcs };
}

function checkDrawings(page: ReturnType<typeof scanHtml>, js: readonly PageScript[], oneWriter: boolean, report: PageReport): void {
  const draws = new Map<string, string>();
  let drawsByName = true;
  for (const script of js) {
    for (const match of script.text.matchAll(/dash\.draw\(\s*(['"`])([^'"`]+)\1/g)) if (!draws.has(match[2] ?? '')) draws.set(match[2] ?? '', script.doc);
    // A name built in code: which drawing it fills can't be told.
    if (/dash\.draw\(\s*[^'"`\s)]/.test(script.text)) drawsByName = false;
  }
  const insideDrawing = (index: number): boolean => {
    for (let k = page.elements[index]?.parent ?? -1; k !== -1; k = page.elements[k]?.parent ?? -1)
      if (page.elements[k]?.attrs['data-draw'] !== undefined) return true;
    return false;
  };
  const drawn = new Set<string>();
  page.elements.forEach((element, index) => {
    const name = element.attrs['data-draw'];
    if (name === undefined) return;
    drawn.add(name);
    const where = `<${element.tag} data-draw="${name}">`;
    if (drawsByName && !draws.has(name)) report(PAGE_DOC, 'warning', `${where}: no dash.draw("${name}", fn) fills it, so it keeps its —.`, element.line);
    if (!oneWriter) return;
    if (insideDrawing(index)) {
      report(PAGE_DOC, 'warning', `${where} sits inside another drawing; the outer one’s function draws all of it.`, element.line);
      return;
    }
    const holds =
      page.elements.some((other) => other.parent === index) ||
      !EMPTY_DRAWING_PATTERN.test(page.texts.filter((text) => text.el === index).map((text) => text.text).join(''));
    if (holds) report(PAGE_DOC, 'warning', `${where} is stored holding more than a —; a drawing’s function writes all of it.`, element.line);
  });
  for (const [name, doc] of draws) if (!drawn.has(name)) report(doc, 'warning', `dash.draw("${name}") has no element marked data-draw="${name}" to draw.`);
}

function checkTokens(page: ReturnType<typeof scanHtml>, js: readonly PageScript[], css: readonly string[], report: PageReport): void {
  const texts = [...css, ...js.map((script) => script.text)];
  const own = new Set<string>();
  for (const text of [...texts, ...page.elements.map((element) => element.attrs.style ?? '')])
    for (const match of text.matchAll(TOKEN_DEFINITION_PATTERN)) own.add(match[1] ?? '');
  const unknown = new Set<string>();
  for (const text of [...texts, ...page.elements.map((element) => element.attrs.style ?? '')])
    for (const match of text.matchAll(TOKEN_USE_PATTERN)) {
      const token = match[1] ?? '';
      if (!DASH_DEFINED_TOKENS.has(token) && !own.has(token)) unknown.add(token);
    }
  for (const token of unknown)
    report(PAGE_DOC, 'error', `var(${token}) is no token of the dashboard (a typo?): use the names in reference/design-defaults.md.`);
}

function checkMarks(
  page: ReturnType<typeof scanHtml>,
  datasets: ReadonlyMap<string, PageDatasetInfo>,
  calcs: ReadonlyMap<string, string[]>,
  marked: Set<string>,
  report: PageReport,
): void {
  const closestTable = (element: HtmlElement): HtmlElement | null => {
    for (let k = element.parent; k !== -1; k = page.elements[k]?.parent ?? -1) {
      const table = page.elements[k];
      if (table?.tag === 'table' && table.attrs['data-source'] !== undefined) return table;
    }
    return null;
  };
  const columnCheck = (where: string, line: number, id: string, field: string): void => {
    const table = datasets.get(id)?.table;
    if (table && !table.columns.includes(field))
      report(PAGE_DOC, 'error', `${where}: data-field="${field}" is no column of ${id} (columns: ${table.columns.join(', ')}).`, line);
  };
  for (const element of page.elements) {
    const where = `<${element.tag}${element.attrs.id ? ` id="${element.attrs.id}"` : ''}>`;
    const line = element.line;
    const source = element.attrs['data-source'];
    if (source === undefined) {
      if (element.tag === 'th' && element.attrs['data-field'] !== undefined) {
        const table = closestTable(element);
        if (!table) report(PAGE_DOC, 'warning', `${where}: a <th data-field> outside a marked <table data-source data-row-key>.`, line);
        else {
          const ids = (table.attrs['data-source'] ?? '').trim().split(/\s+/);
          if (ids.length === 1) columnCheck(where, line, ids[0] ?? '', element.attrs['data-field']);
        }
      } else if (['data-field', 'data-where', 'data-row'].some((name) => element.attrs[name] !== undefined)) {
        report(PAGE_DOC, 'warning', `${where}: data-field/data-where/data-row without data-source on the same element.`, line);
      }
      continue;
    }
    const ids = source.trim().split(/\s+/).filter(Boolean);
    if (ids.length === 0) {
      report(PAGE_DOC, 'error', `${where}: data-source is empty.`, line);
      continue;
    }
    for (const id of ids) {
      marked.add(id);
      if (!datasets.has(id) && !calcs.has(id))
        report(
          PAGE_DOC,
          'error',
          `${where}: data-source="${id}" names no dataset or dash.calc (datasets: ${[...datasets.keys()].join(', ') || 'none'}${calcs.size ? `; calcs: ${[...calcs.keys()].join(', ')}` : ''}).`,
          line,
        );
    }
    if (element.tag === 'svg') report(PAGE_DOC, 'warning', `${where}: mark a chart on its container, not the <svg> itself.`, line);
    const only = ids.length === 1 ? (ids[0] ?? '') : null;
    const table = only === null ? null : (datasets.get(only)?.table ?? null);
    const field = element.attrs['data-field'];
    if (field !== undefined) {
      if (ids.length > 1) report(PAGE_DOC, 'error', `${where}: data-field with several data-source ids; a cell comes from one source.`, line);
      else {
        if (element.tag === 'th' && only !== null && datasets.has(only) && closestTable(element))
          report(PAGE_DOC, 'warning', `${where}: a computed column’s <th> names a calc, not a dataset.`, line);
        if (only !== null) columnCheck(where, line, only, field);
      }
    }
    const whereAttr = element.attrs['data-where'];
    if (whereAttr !== undefined && table && only !== null) {
      const pairs = whereAttr
        .split('&')
        .filter(Boolean)
        .map((part): [string, string] => {
          const eq = part.indexOf('=');
          return eq < 0 ? [decodeComponent(part), ''] : [decodeComponent(part.slice(0, eq)), decodeComponent(part.slice(eq + 1))];
        });
      const missing = pairs.filter(([column]) => !table.columns.includes(column));
      if (missing.length)
        report(PAGE_DOC, 'error', `${where}: data-where names ${missing.map(([column]) => `"${column}"`).join(', ')}, no column of ${only}.`, line);
      else if (!table.rows.some((row) => pairs.every(([column, value]) => cellToString(row[column]) === value)))
        report(PAGE_DOC, 'error', `${where}: data-where="${whereAttr}" matches no row of ${only}.`, line);
    }
    const rowAttr = element.attrs['data-row'];
    if (rowAttr !== undefined && table && only !== null) {
      const n = Number(rowAttr);
      if (!Number.isInteger(n) || n < 0 || n >= table.rows.length)
        report(PAGE_DOC, 'error', `${where}: data-row="${rowAttr}" is outside ${only}’s ${table.rows.length} rows (0-based).`, line);
    }
    const key = element.attrs['data-row-key'];
    if (key !== undefined) {
      if (element.tag !== 'table') report(PAGE_DOC, 'warning', `${where}: data-row-key goes on the <table>.`, line);
      if (ids.length > 1) report(PAGE_DOC, 'error', `${where}: a table is marked with one data-source.`, line);
      else if (table && only !== null) {
        const columns = key.split(',').map((column) => column.trim()).filter(Boolean);
        const missing = columns.filter((column) => !table.columns.includes(column));
        if (missing.length) report(PAGE_DOC, 'error', `${where}: data-row-key names ${missing.join(', ')}, no column of ${only}.`, line);
        else {
          const keys = table.rows.map((row) => columns.map((column) => cellToString(row[column])).join('\u0000'));
          if (new Set(keys).size !== keys.length)
            report(PAGE_DOC, 'error', `${where}: data-row-key="${key}" doesn’t tell ${only}’s rows apart (repeated values); add a column ("a,b").`, line);
        }
      }
    }
  }

  const insideMarkOrScript = (index: number): boolean => {
    for (let k = index; k !== -1; k = page.elements[k]?.parent ?? -1) {
      const element = page.elements[k];
      if (element === undefined) return false;
      if (
        ['script', 'style', 'template'].includes(element.tag) ||
        element.attrs['data-source'] !== undefined ||
        element.attrs['data-literal'] !== undefined ||
        element.attrs['data-draw'] !== undefined
      )
        return true;
    }
    return false;
  };
  let figures = 0;
  for (const text of page.texts) {
    if (insideMarkOrScript(text.el)) continue;
    const match = FIGURE_PATTERN.exec(text.text);
    if (!match || YEAR_OR_DATE_PATTERN.test(match[0].trim())) continue;
    if (++figures <= MAX_FIGURE_WARNINGS)
      report(
        PAGE_DOC,
        'warning',
        `"${text.text.trim().slice(0, 60)}" holds a figure (${match[0].trim()}) outside any mark. Every figure comes from a dataset; a fixed reference the person chose is fine.`,
        text.line,
      );
  }
}
