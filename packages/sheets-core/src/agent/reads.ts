/**
 * The agent's reads: readSheets, readCells, readCellFormats, readConditionalFormats, readCharts and readInteractive,
 * answered from the workbook at a revision, by the same names and keys as the agent's skill describes. showGuide goes
 * through the same command but is no read of the workbook: the host answers it (cell-links.ts checks it).
 */

import { type Block, a1, blockA1, columnLetters, columnsText, overlap, rowsText } from './addresses.ts';
import { type CellReading, encodeCell, shownText, usFormulaText } from './cells.ts';
import { type EngineMessage, isObject } from './engine.ts';
import { AgentError } from './errors.ts';
import { sha256Hex } from './sha256.ts';
import { linkFragmentOf } from './cell-links.ts';
import { checkKeys, expand, pickSheet, type SheetContents, type SheetView, sheetsOf, type WorkbookContents } from './workbook.ts';

/** The most cells one readCells answers. */
export const MAX_READ_CELLS = 10_000;
/** About the most JSON one read answers. */
export const MAX_READ_BYTES = 190_000;

// ---------- reading ----------

/** What reads are answered from: the workbook at a revision, its formulas worked out, and the session that holds it. */
export interface ReadContext {
  workbook: WorkbookContents;
  answer(request: EngineMessage): EngineMessage;
  utility(request: EngineMessage): EngineMessage;
  /** The formulas did not finish in the time a read has. */
  calculationTookTooLong?: boolean;
  timeZone: string | null;
  charts?: (view: SheetView, sheets: SheetView[]) => EngineMessage[];
  /** The interactive panel a tab shows, or null (charts.ts, ChartReader.interactiveOf). */
  interactive?: (view: SheetView, sheets: SheetView[]) => EngineMessage | null;
}

export const READ_KINDS = ['readSheets', 'readCells', 'readCellFormats', 'readConditionalFormats', 'readCharts', 'readInteractive'];
/** What the read command takes besides the reads: a walkthrough the host shows the person. */
export const GUIDE_KIND = 'showGuide';
const KINDS_TEXT = [...READ_KINDS, GUIDE_KIND].join(', ');

export function readWorkbook(payload: unknown, context: ReadContext): EngineMessage {
  if (!isObject(payload) || typeof payload.kind !== 'string') throw new AgentError('unknownReadKind', `A read's payload is {"kind": …}: ${KINDS_TEXT}.`);
  const sheets = sheetsOf(context.workbook);
  const revision = context.workbook.revision;
  const keys = (required: string[]) => {
    try {
      checkKeys(payload, required);
    } catch (error) {
      if (error instanceof AgentError) throw new AgentError('unreadableRead', error.message, error.extra);
      throw error;
    }
  };
  switch (payload.kind) {
    case 'readSheets':
      keys([]);
      return readSheets(context, sheets);
    case 'readCells': {
      keys(['sheet', 'range']);
      const view = pickSheet(sheets, payload.sheet);
      return { revision, sheet: view.name, ...readCells(view, view.range(payload.range), context, sheets) };
    }
    case 'readCellFormats': {
      keys(['sheet', 'range']);
      const view = pickSheet(sheets, payload.sheet);
      return { revision, sheet: view.name, formats: readCellFormats(view, view.range(payload.range)) };
    }
    case 'readConditionalFormats': {
      keys(['sheet']);
      const view = pickSheet(sheets, payload.sheet);
      return { revision, sheet: view.name, ...conditionalFormatsOf(view, context.answer) };
    }
    case 'readCharts': {
      keys(['sheet']);
      const view = pickSheet(sheets, payload.sheet);
      return { revision, sheet: view.name, charts: context.charts?.(view, sheets) ?? [] };
    }
    case 'readInteractive': {
      keys(['sheet']);
      const view = pickSheet(sheets, payload.sheet);
      return { revision, sheet: view.name, interactive: context.interactive?.(view, sheets) ?? null };
    }
    default:
      throw new AgentError('unknownReadKind', `"${payload.kind}" is not a read: ${KINDS_TEXT}.`);
  }
}

function readSheets(context: ReadContext, sheets: SheetView[]): EngineMessage {
  const out = sheets.map((view) => {
    const c = view.contents;
    const filled = view.filledBlock();
    const sheet: EngineMessage = { name: view.name, linkFragment: linkFragmentOf(view.sheetId), rowCount: view.rowIds.length, columnCount: view.columnIds.length };
    if (c.interactive) sheet.interactiveId = c.interactive;
    if (filled) sheet.filledRange = blockA1(filled);
    const frozenRow = c.lastFrozenRow ? view.rowIndex(c.lastFrozenRow) : undefined;
    if (frozenRow !== undefined) sheet.lastFrozenRow = frozenRow + 1;
    const frozenColumn = c.lastFrozenColumn ? view.columnIndex(c.lastFrozenColumn) : undefined;
    if (frozenColumn !== undefined) sheet.lastFrozenColumn = columnLetters(frozenColumn);
    if (c.areGridlinesHidden) sheet.areGridlinesHidden = true;
    const groups = (list: SheetContents['rowGroups'], of: 'rows' | 'columns') =>
      (list ?? []).flatMap((g) => {
        const span = view.lineSpan(g.ends, of);
        return span ? [{ [of]: of === 'rows' ? rowsText(...span) : columnsText(...span), isCollapsed: g.isCollapsed }] : [];
      });
    const rowGroups = groups(c.rowGroups, 'rows');
    if (rowGroups.length) sheet.rowGroups = rowGroups;
    const columnGroups = groups(c.columnGroups, 'columns');
    if (columnGroups.length) sheet.columnGroups = columnGroups;
    const table = cellTableOf(view);
    if (table) sheet.cellTable = table;
    const charts = view.contents.placements?.length ?? 0;
    if (charts) sheet.chartCount = charts;
    return sheet;
  });
  return { revision: context.workbook.revision, sheets: out, locale: context.workbook.locale ?? 'en-US', ...(context.timeZone ? { timeZone: context.timeZone } : {}), you: null };
}

function cellTableOf(view: SheetView): EngineMessage | null {
  const entry = view.contents.cellTables?.[0];
  const t = entry?.liveCellTable ?? entry?.cellTable;
  if (!t) return null;
  const header = view.lineSpan({ first: t.headerRows.firstRow, last: t.headerRows.lastRow }, 'rows');
  const columns = view.lineSpan({ first: t.firstColumn, last: t.lastColumn }, 'columns');
  if (!header || !columns) return null;
  const footer = t.footerRows ? view.lineSpan({ first: t.footerRows.firstRow, last: t.footerRows.lastRow }, 'rows') : null;
  return { columns: columnsText(...columns), headerRows: rowsText(...header), footerRows: footer ? rowsText(...footer) : null };
}

/** A sheet's cell formats as blocks, later entries over earlier ones. */
export function formatBlocks(view: SheetView): { block: Block; format: EngineMessage }[] {
  return (view.contents.cellFormats ?? []).flatMap(({ rows, columns, format }) => view.blocksOf(rows, columns).map((block) => ({ block, format })));
}

/** The format a formula's result brings (=TODAY() a date's), where the cell has none of its own. */
export const broughtPattern = (cell: EngineMessage): string | null => (isObject(cell.numberFormatBrought) && typeof cell.numberFormatBrought.pattern === 'string' ? cell.numberFormatBrought.pattern : null);

/**
 * The kinds of a brought format that a read goes by, as the agent's skill has it: a date or a time as {date} / {time} /
 * {dateTime}, money or a percent as {number, shown}. A plain number format that =SUMIFS(F2:F, …) brings from its cells
 * (0.0) reads as the bare number.
 */
const READ_BY_WHEN_BROUGHT = new Set(['date', 'time', 'dateAndTime', 'currency', 'percent']);

/** The number format pattern of each cell that has one, by "row,column". */
export function patternsOf(view: SheetView): Map<string, string> {
  const out = new Map<string, string>();
  for (const { block, format } of formatBlocks(view)) {
    const pattern = isObject(format.numberFormat) ? format.numberFormat.pattern : undefined;
    if (typeof pattern !== 'string') continue;
    for (let r = block.top; r <= block.bottom; r++) for (let c = block.left; c <= block.right; c++) out.set(`${r},${c}`, pattern);
  }
  return out;
}

function cellReading(view: SheetView, context: { utility(request: EngineMessage): EngineMessage; workbook?: WorkbookContents }, sheets: SheetView[]): CellReading {
  const kinds = new Map<string, string | null>();
  const options = new Map<string, string>();
  for (const dropdown of view.contents.dropdowns ?? []) for (const option of dropdown.options ?? []) options.set(option.optionId, option.label);
  const byId = new Map(sheets.map((s) => [s.sheetId, s]));
  const usLocale = (context.workbook?.locale ?? 'en-US') === 'en-US';
  return {
    kindOf(pattern) {
      if (!kinds.has(pattern)) {
        const answer = context.utility({ kind: 'readKindOfPattern', pattern });
        kinds.set(pattern, typeof answer.numberFormatKind === 'string' ? answer.numberFormatKind : null);
      }
      return kinds.get(pattern)!;
    },
    optionLabel: (id) => options.get(id),
    formulaText(cell) {
      if (usLocale && typeof cell.formulaText === 'string') return cell.formulaText;
      const input = cell.input as EngineMessage;
      return usFormulaText(input.formula, view.sheetId, (id) => byId.get(id));
    },
  };
}

function readCells(view: SheetView, asked: Block, context: ReadContext, sheets: SheetView[]): EngineMessage {
  const inside = view.filled().filter(({ row, column }) => row >= asked.top && row <= asked.bottom && column >= asked.left && column <= asked.right);
  // Blank rows and columns at the end of the range are cut: `range` is what `rows` covers.
  let bottom = -1;
  let right = -1;
  for (const { row, column } of inside) {
    bottom = Math.max(bottom, row);
    right = Math.max(right, column);
  }
  const out: EngineMessage = {};
  const patterns = patternsOf(view);
  if (bottom < 0) {
    out.range = null;
    out.rows = {};
  } else {
    const block = { top: asked.top, left: asked.left, bottom, right };
    const count = (bottom - block.top + 1) * (right - block.left + 1);
    if (count > MAX_READ_CELLS) {
      throw new AgentError('tooManyCellsInARead', `${blockA1(block)} holds ${count} cells; one read answers at most ${MAX_READ_CELLS}: read some hundreds of rows at a time.`, { cellCount: count });
    }
    const reading = cellReading(view, context, sheets);
    const width = right - block.left + 1;
    const rows: Record<string, unknown[]> = {};
    const spills = new Map<string, Block>();
    for (const { row, column, cell } of inside.filter((x) => x.spilled)) {
      const from = isObject(cell.from) ? cell.from : null;
      const [fr, fc] = from ? [view.rowIndex(from.r as string), view.columnIndex(from.c as string)] : [undefined, undefined];
      if (fr === undefined || fc === undefined) continue;
      const key = `${fr},${fc}`;
      const was = spills.get(key) ?? { top: fr, left: fc, bottom: fr, right: fc };
      spills.set(key, { top: was.top, left: was.left, bottom: Math.max(was.bottom, row), right: Math.max(was.right, column) });
    }
    for (const { row, column, cell, spilled } of inside) {
      const line = (rows[String(row + 1)] ??= Array<unknown>(width).fill(null));
      const brought = broughtPattern(cell);
      const pattern = patterns.get(`${row},${column}`) ?? (brought !== null && READ_BY_WHEN_BROUGHT.has(reading.kindOf(brought) ?? '') ? brought : null);
      if (spilled) {
        const from = isObject(cell.from) ? cell.from : {};
        const [fr, fc] = [view.rowIndex(from.r as string), view.columnIndex(from.c as string)];
        const value = encodeCell({ value: cell.value, shown: cell.shown }, pattern, reading);
        line[column - block.left] = fr === undefined || fc === undefined ? value : { spilledFrom: a1(fr, fc), value };
        continue;
      }
      const encoded = encodeCell(cell, pattern, reading);
      const spill = spills.get(`${row},${column}`);
      line[column - block.left] = spill && isObject(encoded) ? { ...encoded, spill: blockA1(spill) } : encoded;
    }
    out.range = blockA1(block);
    out.rows = Object.fromEntries(Object.entries(rows).sort(([x], [y]) => Number(x) - Number(y)));
  }
  // What lies over the cells goes as far as the range that was read, blank cells too (a dropdown's C2:C12 over C1:C2).
  Object.assign(out, overlays(view, asked, patterns, context.utility));
  if (JSON.stringify(out).length > MAX_READ_BYTES) {
    throw new AgentError('answerTooLarge', `What ${out.range ?? blockA1(asked)} holds is over ${Math.round(MAX_READ_BYTES / 1000)} KB: read fewer rows at a time.`);
  }
  if (context.calculationTookTooLong) out.calculationTookTooLong = true;
  return out;
}

/** What lies over a read's cells: merged ranges, dropdowns, checkboxes, columns too narrow for their numbers. */
function overlays(view: SheetView, block: Block, patterns: Map<string, string>, utility: (request: EngineMessage) => EngineMessage): EngineMessage {
  const out: EngineMessage = {};
  const merged = (view.contents.mergedRanges ?? []).flatMap(({ range: m }) => {
    const rows = view.lineSpan({ first: m.topLeft.r, last: m.bottomRight.r }, 'rows');
    const columns = view.lineSpan({ first: m.topLeft.c, last: m.bottomRight.c }, 'columns');
    if (!rows || !columns) return [];
    const b = { top: rows[0], bottom: rows[1], left: columns[0], right: columns[1] };
    return overlap(b, block) ? [blockA1(b)] : [];
  });
  if (merged.length) out.mergedRanges = merged;
  const dropdownRanges = new Map<string, string[]>();
  const checkboxes: string[] = [];
  for (const { block: b, format } of formatBlocks(view)) {
    const control = isObject(format.cellControl) ? format.cellControl : null;
    const o = control ? overlap(b, block) : null;
    if (!o || !control) continue;
    if (control.kind === 'dropdown' && typeof control.dropdownId === 'string') dropdownRanges.set(control.dropdownId, [...(dropdownRanges.get(control.dropdownId) ?? []), blockA1(o)]);
    else if (control.kind === 'checkbox') checkboxes.push(blockA1(o));
  }
  const dropdowns = (view.contents.dropdowns ?? []).filter((d) => dropdownRanges.has(d.dropdownId)).map((d) => ({ dropdownId: d.dropdownId, ranges: dropdownRanges.get(d.dropdownId), options: d.options }));
  if (dropdowns.length) out.dropdowns = dropdowns;
  if (checkboxes.length) out.checkboxes = checkboxes;
  // A number or a date wider than its column, by the engine's own measure of a digit (the page's ### test, roughly).
  const described = utility({ kind: 'describeSharedCode' });
  const measure = isObject(described.widthsOfNumbers) ? described.widthsOfNumbers : {};
  const num = (v: unknown, or: number) => (typeof v === 'number' ? v : or);
  const digit = num(measure.widthOfADigit, 0.64) * num(measure.pixelsInTenPoints, 13);
  const half = typeof measure.halfAsWideAsADigit === 'string' ? measure.halfAsWideAsADigit : '';
  const one = typeof measure.noWiderThanADigit === 'string' ? measure.noWiderThanADigit : '0123456789';
  const widthOf = (text: string) => [...text].reduce((w, ch) => w + digit * (half.includes(ch) ? 0.5 : one.includes(ch) ? 1 : num(measure.widthOfAnyOtherCharacter, 1.75)), num(measure.aroundTheTextInPixels, 8));
  const standard = num(described.defaultColumnWidthInPixels, 104);
  const widths = new Map<number, number>();
  for (const w of view.contents.columnWidths ?? []) for (const id of expand(w.columns)) {
    const i = view.columnIndex(id);
    if (i !== undefined) widths.set(i, w.widthInPixels);
  }
  const narrow = new Set<number>();
  for (const { row, column, cell } of view.filled()) {
    if (row < block.top || row > block.bottom || column < block.left || column > block.right) continue;
    const value = isObject(cell.value) ? cell.value : isObject(cell.input) ? cell.input : null;
    const shown = shownText(cell) ?? null;
    if (value?.kind !== 'number' || !shown || !(patterns.has(`${row},${column}`) || broughtPattern(cell))) continue;
    if (widthOf(shown) > (widths.get(column) ?? standard)) narrow.add(column);
  }
  if (narrow.size) out.columnsTooNarrowForTheirNumbers = [...narrow].sort((x, y) => x - y).map(columnLetters);
  return out;
}

function readCellFormats(view: SheetView, block: Block): EngineMessage[] {
  const entries: { format: EngineMessage; ranges: string[] }[] = [];
  for (const { block: b, format } of formatBlocks(view)) {
    const o = overlap(b, block);
    if (!o) continue;
    const key = JSON.stringify(format);
    const same = entries.find((e) => JSON.stringify(e.format) === key);
    if (same) same.ranges.push(blockA1(o));
    else entries.push({ format, ranges: [blockA1(o)] });
  }
  return entries.map(({ ranges, format }) => ({ ranges, format }));
}

/** A sheet's rules by address, with the fingerprint a replace names, and how many no address can name. */
export function conditionalFormatsOf(view: SheetView, answer: (request: EngineMessage) => EngineMessage): { rules: EngineMessage[]; fingerprint: string; rulesWithoutAnAddress: number } {
  const listed = [...(view.contents.conditionalFormats ?? [])].sort((x, y) => (x.priority ?? 0) - (y.priority ?? 0));
  const fingerprint = sha256Hex(JSON.stringify(listed)).slice(0, 16);
  if (listed.length === 0) return { rules: [], fingerprint, rulesWithoutAnAddress: 0 };
  const read = answer({ kind: 'readConditionalFormatsByAddress', sheetId: view.sheetId, rules: listed.map((r) => ({ ranges: r.ranges, effect: r.effect })) });
  const byAddress = Array.isArray(read.rules) ? (read.rules as unknown[]) : [];
  const rules: EngineMessage[] = [];
  let without = 0;
  listed.forEach((_, i) => {
    const rule = byAddress[i];
    if (isObject(rule) && Array.isArray(rule.cells) && rule.cells.length > 0) rules.push({ cells: rule.cells, effect: rule.effect });
    else without++;
  });
  return { rules, fingerprint, rulesWithoutAnAddress: without };
}
