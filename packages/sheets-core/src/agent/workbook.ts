/**
 * The workbook as the engine's `readWorkbook` gives it, and one sheet of it as the agent's calls see it: rows and
 * columns by id and by place, the cells that hold something, and the sheet a call names.
 */

import { type Block, columnLetters, parseColumns, parseRange, parseRows } from './addresses.ts';
import type { Lines } from './cells.ts';
import { type EngineMessage, isObject } from './engine.ts';
import { AgentError } from './errors.ts';


/** Ids of rows or columns: `${base}.${first}` … `${base}.${first + count - 1}`, in the sheet's order. */
export interface Run {
  base: string;
  first: number;
  count: number;
}

export type Runs = Run | Run[];

export interface SheetContents {
  sheetId: string;
  name: string;
  rows: Run[];
  columns: Run[];
  cells?: EngineMessage[];
  spilledCells?: EngineMessage[];
  cellFormats?: { rows: Runs; columns: Runs; format: EngineMessage }[];
  columnWidths?: { columns: Runs; widthInPixels: number }[];
  rowHeights?: { rows: Runs; heightInPixels: number }[];
  mergedRanges?: { range: { topLeft: { r: string; c: string }; bottomRight: { r: string; c: string } } }[];
  dropdowns?: { dropdownId: string; options: { optionId: string; label: string; color: unknown }[] }[];
  lastFrozenRow?: string | null;
  lastFrozenColumn?: string | null;
  areGridlinesHidden?: boolean;
  rowGroups?: { groupId: string; ends: { first: string; last: string }; isCollapsed: boolean }[];
  columnGroups?: { groupId: string; ends: { first: string; last: string }; isCollapsed: boolean }[];
  cellTables?: { cellTableId: string; cellTable: CellTable; liveCellTable?: CellTable | null }[];
  conditionalFormats?: { conditionalFormatId: string; ranges: unknown[]; liveRanges?: unknown[]; priority?: number; effect: unknown }[];
  /** The charts that lie over the sheet (charts.ts): where each lies, and the view (the chart) it shows. */
  placements?: { placementId: string; placement: Placement; liveTopLeft?: CellIds | null }[];
  /** The view this sheet shows as an interactive panel (charts.ts), when the whole tab is one. */
  interactive?: string | null;
}

export interface CellIds {
  r: string;
  c: string;
}

export interface Placement {
  shows: { kind: string; viewId: string };
  topLeft: CellIds;
  offsetFromAnchorCell?: { xInPixels: number; yInPixels: number };
  widthInPixels: number;
  heightInPixels: number;
}

/** A cell an interactive panel may write, with the value it held when the panel was made (null: blank). */
export interface WritableCell {
  r: string;
  c: string;
  value: { kind: string; value: unknown } | null;
}

/**
 * A view (a chart, or an interactive panel): its name and its one element, the widget it draws and the cells each
 * input stands for. A panel's element (kind "interactive") also lists the inputs its controls may write, each with the
 * values its cells go back to on a reset.
 */
export interface ChartView {
  name: string;
  elements: {
    kind: string;
    elementId: string;
    embed: { ref: string; caption: string };
    inputs: { name: string; range: { sheetId: string; topLeft: CellIds; bottomRight: CellIds } }[];
    writes?: { input: string; saved: WritableCell[] }[];
  }[];
}

export interface CellTable {
  headerRows: { firstRow: string; lastRow: string };
  firstColumn: string;
  lastColumn: string;
  footerRows: { firstRow: string; lastRow: string } | null;
}

/** The engine's `readWorkbook` answer. */
export interface WorkbookContents {
  revision: number;
  locale?: string;
  timeZone?: string | null;
  sheets: SheetContents[];
  views?: { viewId: string; view: ChartView }[];
}


// ---------- a sheet's lines ----------

export const runList = (runs: Runs | undefined): Run[] => (runs === undefined ? [] : Array.isArray(runs) ? runs : [runs]);
export const expand = (runs: Runs | undefined): string[] => runList(runs).flatMap((r) => Array.from({ length: r.count }, (_, i) => `${r.base}.${r.first + i}`));

/** The runs that cover the ids from index `from` to `to` of a sheet's rows. */
export function runsBetween(runs: Run[], from: number, to: number): Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const run of runs) {
    const start = Math.max(from, at);
    const end = Math.min(to, at + run.count - 1);
    if (start <= end) out.push({ base: run.base, first: run.first + (start - at), count: end - start + 1 });
    at += run.count;
    if (at > to) break;
  }
  return out;
}

/** One sheet as the calls see it: its row and column ids, where each id is. */
export class SheetView implements Lines {
  readonly contents: SheetContents;
  readonly rowIds: string[];
  readonly columnIds: string[];
  private rowAt?: Map<string, number>;
  private columnAt?: Map<string, number>;

  constructor(contents: SheetContents) {
    this.contents = contents;
    this.rowIds = expand(contents.rows);
    this.columnIds = expand(contents.columns);
  }

  get name() {
    return this.contents.name;
  }

  get sheetId() {
    return this.contents.sheetId;
  }

  rowIndex(id: string): number | undefined {
    this.rowAt ??= new Map(this.rowIds.map((r, i) => [r, i]));
    return this.rowAt.get(id);
  }

  columnIndex(id: string): number | undefined {
    this.columnAt ??= new Map(this.columnIds.map((c, i) => [c, i]));
    return this.columnAt.get(id);
  }

  /** A range of this sheet; outside it is refused (outsideTheSheet). */
  range(text: unknown, key = 'range'): Block {
    const b = parseRange(text, key);
    this.within(b, String(text));
    return b;
  }

  within(b: Block, text: string): void {
    if (b.bottom >= this.rowIds.length || b.right >= this.columnIds.length) {
      throw new AgentError('outsideTheSheet', `${text} lies outside sheet "${this.name}", which has ${this.rowIds.length} rows (1–${this.rowIds.length}) and ${this.columnIds.length} columns (A–${columnLetters(this.columnIds.length - 1)}).`, { rowCount: this.rowIds.length, columnCount: this.columnIds.length });
    }
  }

  rows(text: unknown, key = 'rows'): [number, number] {
    const [a, b] = parseRows(text, key);
    this.within({ top: a, bottom: b, left: 0, right: 0 }, String(text));
    return [a, b];
  }

  columns(text: unknown, key = 'columns'): [number, number] {
    const [a, b] = parseColumns(text, key);
    this.within({ top: 0, bottom: 0, left: a, right: b }, String(text));
    return [a, b];
  }

  /** The engine's cell block: the rows as runs, the two edge columns. */
  engineBlock(b: Block): EngineMessage {
    return { sheetId: this.sheetId, rows: runsBetween(this.contents.rows, b.top, b.bottom), oneColumn: this.columnIds[b.left], otherColumn: this.columnIds[b.right] };
  }

  /** The engine's area: two corner cells. */
  engineCorners(b: Block): EngineMessage {
    return { sheetId: this.sheetId, oneCorner: { r: this.rowIds[b.top], c: this.columnIds[b.left] }, otherCorner: { r: this.rowIds[b.bottom], c: this.columnIds[b.right] } };
  }

  /** The cells that hold something (spilled ones too), with where they are. */
  filled(): { row: number; column: number; cell: EngineMessage; spilled: boolean }[] {
    const out: { row: number; column: number; cell: EngineMessage; spilled: boolean }[] = [];
    for (const [list, spilled] of [
      [this.contents.cells ?? [], false],
      [this.contents.spilledCells ?? [], true],
    ] as const) {
      for (const cell of list) {
        const row = this.rowIndex(cell.r as string);
        const column = this.columnIndex(cell.c as string);
        if (row !== undefined && column !== undefined && (spilled || isObject(cell.input))) out.push({ row, column, cell, spilled });
      }
    }
    return out;
  }

  filledBlock(): Block | null {
    let b: Block | null = null;
    for (const { row, column } of this.filled()) {
      b = b ? { top: Math.min(b.top, row), left: Math.min(b.left, column), bottom: Math.max(b.bottom, row), right: Math.max(b.right, column) } : { top: row, left: column, bottom: row, right: column };
    }
    return b;
  }

  /** The blocks a set of row runs × column runs covers. */
  blocksOf(rows: Runs | undefined, columns: Runs | undefined): Block[] {
    const spans = (ids: string[], at: (id: string) => number | undefined): [number, number][] => {
      const indexes = ids.map(at).filter((i): i is number => i !== undefined).sort((x, y) => x - y);
      const out: [number, number][] = [];
      for (const i of indexes) {
        const last = out.at(-1);
        if (last && i === last[1] + 1) last[1] = i;
        else if (!last || i > last[1]) out.push([i, i]);
      }
      return out;
    };
    const rowSpans = spans(expand(rows), (id) => this.rowIndex(id));
    const columnSpans = spans(expand(columns), (id) => this.columnIndex(id));
    return rowSpans.flatMap(([top, bottom]) => columnSpans.map(([left, right]) => ({ top, bottom, left, right })));
  }

  /** A group's or a merged range's ends, as places. */
  lineSpan(ends: { first: string; last: string }, of: 'rows' | 'columns'): [number, number] | null {
    const at = (id: string) => (of === 'rows' ? this.rowIndex(id) : this.columnIndex(id));
    const [a, b] = [at(ends.first), at(ends.last)];
    return a === undefined || b === undefined ? null : [Math.min(a, b), Math.max(a, b)];
  }
}

export function sheetsOf(workbook: WorkbookContents): SheetView[] {
  return workbook.sheets.map((s) => new SheetView(s));
}

/** The sheet a call names, by its name, capitals aside. */
export function pickSheet(sheets: SheetView[], name: unknown, key = 'sheet'): SheetView {
  if (typeof name !== 'string' || name === '') throw new AgentError('unknownSheetName', `${key} is a sheet's name, as readSheets gives it.`);
  const found = sheets.find((s) => s.name === name) ?? sheets.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!found) {
    const names = sheets.map((s) => `"${s.name}"`).join(', ');
    throw new AgentError('unknownSheetName', sheets.length ? `No sheet is named "${name}". The sheets: ${names}.` : 'This Sheet has no sheets yet: add one first ({"kind": "addSheet", "name": "Sheet1"}).', { sheetName: name });
  }
  return found;
}

/** Refuses keys an edit or a read does not take, and keys it needs that are missing. */
export function checkKeys(given: EngineMessage, required: string[], optional: string[] = []): void {
  for (const key of required) if (!(key in given)) throw new AgentError('unreadableEdit', `${String(given.kind)} takes ${key}.`, { key });
  for (const key of Object.keys(given)) {
    if (key !== 'kind' && !required.includes(key) && !optional.includes(key)) {
      const takes = [...required, ...optional.map((k) => `${k}?`)].join(', ');
      throw new AgentError('unreadableEdit', `${String(given.kind)} takes no "${key}": its keys are ${takes || 'none'}.`, { key });
    }
  }
}
