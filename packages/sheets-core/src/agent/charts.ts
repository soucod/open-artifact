/**
 * Charts, as the agent's addChart, setChart, deleteChart and readCharts know them, made of what the engine keeps:
 *
 *   a view       {viewId: "viw_<code>.0", view: {name, elements: [{kind: "widget", elementId: "vel_<code>.0",
 *                 embed: {ref: "node/<widget>", caption}, inputs: [{name, range: {sheetId, topLeft, bottomRight}}]}]}}
 *                the chart itself: the widget it draws with, the cells each input stands for (corner ids)
 *   a placement  {placementId: "plc_<code>.0", placement: {shows: {kind: "view", viewId}, topLeft: {r, c},
 *                 offsetFromAnchorCell?, widthInPixels, heightInPixels}}, in one sheet's `placements`
 *                where the chart lies; the page moves, resizes, copies and deletes it with edits of its own
 *
 * A chart's id is its view's. The page makes its own charts with an edit of the engine (addPlacedView, e.g. Insert
 * chart); the agent's addChart and setChart write the operations themselves (setViews, setPlacements; null for one
 * deletes it), and the engine's load checks them. They are logged in the format version the engine records them in
 * itself: 30, or 33 when a placement has an offset (what the page's own moves record).
 *
 * An interactive panel is a view too, with one element of kind "interactive" and no placement: it fills a tab of its
 * own, which names it in its settings (`interactive`). Its element lists the inputs the panel's controls may write
 * (`writes`), each with the values its cells held when the panel was made, which a reset brings back. addInteractive
 * writes it (setViews, then setSheetSettings), logged in format version 47; the agent's chart edits leave it alone.
 *
 * An input keeps the ids of the corners it was given. A read gives where it lies now: as it lies between its corners,
 * or, when a corner's row or column was deleted, between where the corners were, worked out in a session that applied
 * every edit (a load leaves deleted cells out) and then brought those rows and columns back.
 */

import { a1 } from './addresses.ts';
import { type EngineMessage, isObject } from './engine.ts';
import { AgentError } from './errors.ts';
import type { ChartEdits, EditContext } from './edits.ts';
import { checkKeys, type ChartView, type WritableCell, pickSheet, type Placement, type Run, type SheetContents, SheetView, type WorkbookContents } from './workbook.ts';

/** The widgets a chart may name: a widget by its id, or null when the Sheet has none by that id. */
export interface WidgetLookup {
  get(id: string): { id: string } | null;
}

/** The format version the engine records views and placements in; with an offset, the newer one. */
export const CHART_FORMAT_VERSION = 30;
export const OFFSET_FORMAT_VERSION = 33;
/** The format version the engine records an interactive panel's view and its tab's setting in. */
export const INTERACTIVE_FORMAT_VERSION = 47;
/** The most views a workbook holds: charts and interactive panels together. */
export const MAX_CHARTS = 200;
/** The most cells one interactive panel may write, over all its writable inputs. */
export const MAX_WRITABLE_CELLS = 1000;
/** The data source the page fills for a panel's controls: no input may take its name. */
export const INTERACTIVE_SOURCE = 'interactive';
const INTERACTIVE_KEYS = ['sheet', 'name', 'caption', 'widget', 'inputs', 'writable'];
/** What a writable cell may hold besides nothing: a value typed in, not a formula, a date or a person. */
const WRITABLE_KINDS = new Set(['number', 'text', 'boolean']);
const MAX_INPUTS = 32;
/** The engine's limits (describeSharedCode): a placement's sides and its offset from its cell. */
const MIN_SIDE = 40;
const MAX_SIDE = 4000;
const MAX_OFFSET = 2000;
/** A chart's name and caption: the engine gives no limit for their length (nameOfViewTooLong, captionInViewTooLong), so these are the store's. */
const MAX_NAME = 200;
const MAX_CAPTION = 1000;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const CHART_KEYS = ['name', 'caption', 'widget', 'inputs', 'sheet', 'topLeft', 'widthInPixels', 'heightInPixels'];

type ViewEntry = { viewId: string; view: ChartView };
type PlacementEntry = NonNullable<SheetContents['placements']>[number];
type ViewElement = ChartView['elements'][number];
type ViewInput = ViewElement['inputs'][number];

/** The workbook with some deleted rows and columns brought back (null when that can't be done): see the header. */
export type Undeleted = (ops: EngineMessage[]) => WorkbookContents | null;

// ---------- reading ----------

const widgetOf = (ref: string) => (ref.startsWith('node/') ? ref.slice(5) : ref);

/** `<base>.<n>` → the run of that one id. */
function runOf(id: string): Run | null {
  const dot = id.lastIndexOf('.');
  const first = Number(id.slice(dot + 1));
  return dot > 0 && Number.isInteger(first) ? { base: id.slice(0, dot), first, count: 1 } : null;
}

/** Reads charts: each view's live ranges, worked out once per read. */
export class ChartReader {
  private readonly workbook: WorkbookContents;
  private readonly sheets: SheetView[];
  private readonly undeleted: Undeleted;
  private readonly brought = new Map<string, SheetView | null>();

  constructor(workbook: WorkbookContents, sheets: SheetView[], undeleted: Undeleted) {
    this.workbook = workbook;
    this.sheets = sheets;
    this.undeleted = undeleted;
  }

  views(): ViewEntry[] {
    return this.workbook.views ?? [];
  }

  /** The interactive panel a tab shows, as readInteractive gives it, or null when the tab is not one. */
  interactiveOf(sheet: SheetView): EngineMessage | null {
    const viewId = sheet.contents.interactive;
    const entry = viewId ? this.views().find((v) => v.viewId === viewId) : undefined;
    const element = entry?.view.elements.find((e) => e.kind === 'interactive');
    if (!entry || !element) return null;
    return {
      interactiveId: entry.viewId,
      name: entry.view.name,
      caption: element.embed.caption,
      widget: widgetOf(element.embed.ref),
      inputs: element.inputs.map((input) => ({ name: input.name, cells: this.cellsOf(input.range) })),
      writable: (element.writes ?? []).map((w) => w.input),
    };
  }

  /** Each chart that lies over a sheet, in the order of its placements: {chartId, chart}. */
  chartsOf(view: SheetView): EngineMessage[] {
    const views = new Map(this.views().map((v) => [v.viewId, v.view]));
    return (view.contents.placements ?? []).flatMap((entry) => {
      const shown = views.get(entry.placement.shows.viewId);
      return shown ? [{ chartId: entry.placement.shows.viewId, chart: this.chart(shown, view, entry) }] : [];
    });
  }

  /** Where the view with this id lies: its placement and sheet, or null. */
  placementOf(viewId: string): { sheet: SheetView; entry: PlacementEntry } | null {
    for (const sheet of this.sheets) {
      const entry = (sheet.contents.placements ?? []).find((p) => p.placement.shows.viewId === viewId);
      if (entry) return { sheet, entry };
    }
    return null;
  }

  chart(shown: ChartView, sheet: SheetView, entry: PlacementEntry): EngineMessage {
    const element = shown.elements[0];
    const p = entry.placement;
    const corner = entry.liveTopLeft ?? p.topLeft;
    const row = sheet.rowIndex(corner.r) ?? 0;
    const column = sheet.columnIndex(corner.c) ?? 0;
    const offset = p.offsetFromAnchorCell;
    return {
      name: shown.name,
      caption: element?.embed.caption ?? '',
      widget: element ? widgetOf(element.embed.ref) : null,
      inputs: (element?.inputs ?? []).map((input) => ({ name: input.name, cells: this.cellsOf(input.range) })),
      sheet: sheet.name,
      topLeft: a1(row, column),
      ...(offset && (offset.xInPixels || offset.yInPixels) ? { offsetFromAnchorCell: { xInPixels: offset.xInPixels, yInPixels: offset.yInPixels } } : {}),
      widthInPixels: p.widthInPixels,
      heightInPixels: p.heightInPixels,
    };
  }

  /** Where an input lies now, as {sheet, range}; null when all its cells are deleted. */
  cellsOf(range: ViewInput['range']): { sheet: string; range: string } | null {
    const sheet = this.sheets.find((s) => s.sheetId === range.sheetId);
    if (!sheet) return null;
    const rows = this.span(sheet, 'rows', range.topLeft.r, range.bottomRight.r);
    const columns = rows && this.span(sheet, 'columns', range.topLeft.c, range.bottomRight.c);
    if (!rows || !columns) return null;
    const [top, bottom] = rows;
    const [left, right] = columns;
    return { sheet: sheet.name, range: top === bottom && left === right ? a1(top, left) : `${a1(top, left)}:${a1(bottom, right)}` };
  }

  /** The live lines (from, to) an input's two corner ids stand between. */
  private span(sheet: SheetView, of: 'rows' | 'columns', one: string, other: string): [number, number] | null {
    const at = (id: string) => (of === 'rows' ? sheet.rowIndex(id) : sheet.columnIndex(id));
    const [a, b] = [at(one), at(other)];
    if (a !== undefined && b !== undefined) return [Math.min(a, b), Math.max(a, b)];
    const missing = [one, other].filter((id) => at(id) === undefined).map(runOf);
    if (missing.some((r) => r === null)) return null;
    const back = this.bringBack(sheet.sheetId, of, missing as Run[]);
    if (!back) return null;
    const all = of === 'rows' ? back.rowIds : back.columnIds;
    const [x, y] = [all.indexOf(one), all.indexOf(other)];
    if (x < 0 || y < 0) return null;
    const live = all.slice(Math.min(x, y), Math.max(x, y) + 1).map(at).filter((i): i is number => i !== undefined);
    return live.length ? [Math.min(...live), Math.max(...live)] : null;
  }

  private bringBack(sheetId: string, of: 'rows' | 'columns', runs: Run[]): SheetView | null {
    const op = of === 'rows' ? { kind: 'undeleteRows', sheetId, rows: runs } : { kind: 'undeleteColumns', sheetId, columns: runs };
    const key = JSON.stringify(op);
    if (!this.brought.has(key)) {
      const workbook = this.undeleted([op]);
      const contents = workbook?.sheets.find((s) => s.sheetId === sheetId);
      this.brought.set(key, contents ? new SheetView(contents) : null);
    }
    return this.brought.get(key) ?? null;
  }
}

// ---------- editing ----------

/** What the chart edits are made with: the edit context, the widgets, and a workbook with deleted lines brought back. */
export interface ChartHost {
  context: Pick<EditContext, 'read'>;
  /** Applies view and placement operations, logged in `version`. */
  apply(ops: EngineMessage[], version: number): void;
  widgets: WidgetLookup;
  undeleted: Undeleted;
  newIdCode(): string;
}

interface Made {
  view: ChartView;
  sheet: SheetView;
  placement: Placement;
}

/** addChart, setChart, deleteChart and addInteractive (applyEdits calls them for its chart edits). */
export function chartEdits(host: ChartHost): ChartEdits {
  const reader = (sheets: SheetView[]) => new ChartReader(host.context.read(), sheets, host.undeleted);
  const versionOf = (placement: Placement | null) => (placement?.offsetFromAnchorCell ? OFFSET_FORMAT_VERSION : CHART_FORMAT_VERSION);

  /**
   * What a chart and an interactive panel both give: the name and caption, the widget and the inputs, checked, in the
   * engine's terms. `now` is the view they replace (setChart); its inputs given as the read gave them keep their corners.
   */
  function parts(chart: EngineMessage, sheets: SheetView[], now: { viewId: string; view: ChartView; read: EngineMessage } | null): { name: string; caption: string; widget: string; inputs: ViewInput[] } {
    const { name, caption } = chart;
    if (typeof name !== 'string' || name.trim() === '') throw new AgentError('viewHasNoName', 'name is what a screen reader calls the chart: some words, not "".');
    if (typeof caption !== 'string') throw new AgentError('unreadableEdit', 'caption is a string, "" for none.');
    if (name.length > MAX_NAME) throw new AgentError('nameOfViewTooLong', `name is at most ${MAX_NAME} characters: a short title, with the rest in caption.`);
    if (caption.length > MAX_CAPTION) throw new AgentError('captionInViewTooLong', `caption is at most ${MAX_CAPTION} characters.`);
    if (CONTROL.test(name) || CONTROL.test(caption)) throw new AgentError('textOfViewHoldsControlCharacter', 'name and caption are one line of text: no line breaks, tabs or other control characters.');
    const widget = typeof chart.widget === 'string' ? widgetOf(chart.widget) : '';
    if (!host.widgets.get(widget)) throw new AgentError('unknownWidget', `This Sheet has no widget ${JSON.stringify(chart.widget)}: widget is the id that creating the widget gave.`);
    const views = reader(sheets).views();
    const other = views.find((v) => v.viewId !== now?.viewId && v.view.elements.some((e) => widgetOf(e.embed.ref) === widget));
    if (other) throw new AgentError('widgetOfAnotherChart', `Widget ${widget} is chart ${other.viewId}'s: a second chart drawn alike takes a widget of its own with the same code.`, { chartId: other.viewId });

    if (!Array.isArray(chart.inputs)) throw new AgentError('unreadableEdit', 'inputs is a list: [{"name": "rows", "cells": {"sheet": "Sheet1", "range": "A1:C30"}}].');
    if (chart.inputs.length > MAX_INPUTS) throw new AgentError('tooManyInputsOfElement', `A chart has up to ${MAX_INPUTS} inputs.`);
    const stored = new Map((now?.view.elements[0]?.inputs ?? []).map((input) => [input.name, input]));
    const readInputs = new Map(((now?.read.inputs as EngineMessage[] | undefined) ?? []).map((input) => [input.name as string, JSON.stringify(input.cells)]));
    const names = new Set<string>();
    const inputs = chart.inputs.map((input: unknown, i: number) => {
      if (!isObject(input)) throw new AgentError('unreadableEdit', `inputs[${i}] is {"name", "cells": {"sheet", "range"}}.`);
      checkKeys({ ...input, kind: `inputs[${i}]` }, ['name', 'cells']);
      const inputName = input.name;
      if (typeof inputName !== 'string' || !INPUT_NAME.test(inputName)) throw new AgentError('inputNameNotAllowed', `inputs[${i}].name is the name the code cites as input/<name>: letters, digits and _, not starting with a digit.`);
      if (names.has(inputName)) throw new AgentError('inputNamedTwice', `Two inputs are named "${inputName}".`);
      names.add(inputName);
      // An input given as the read gave it keeps the corners it has (a deleted one, `cells: null`, can only be kept).
      const kept = stored.get(inputName);
      if (kept && readInputs.get(inputName) === JSON.stringify(input.cells)) return { name: inputName, range: kept.range };
      if (input.cells === null) throw new AgentError('inputHasNoCells', `inputs[${i}] ("${inputName}") has no cells: give it {"sheet", "range"}.`);
      if (!isObject(input.cells)) throw new AgentError('unreadableEdit', `inputs[${i}].cells is {"sheet", "range"}.`);
      checkKeys({ ...input.cells, kind: `inputs[${i}].cells` }, ['sheet', 'range']);
      const of = pickSheet(sheets, input.cells.sheet, `inputs[${i}].cells.sheet`);
      const b = of.range(input.cells.range, `inputs[${i}].cells.range`);
      return { name: inputName, range: { sheetId: of.sheetId, topLeft: { r: of.rowIds[b.top]!, c: of.columnIds[b.left]! }, bottomRight: { r: of.rowIds[b.bottom]!, c: of.columnIds[b.right]! } } };
    });
    return { name, caption, widget, inputs };
  }

  /** The chart as it is given, checked, in the engine's terms; `now` is the chart it replaces (setChart). */
  function made(chart: unknown, sheets: SheetView[], now: { viewId: string; view: ChartView; sheet: SheetView; entry: PlacementEntry; read: EngineMessage; reader: ChartReader } | null): Made {
    if (!isObject(chart)) throw new AgentError('unreadableEdit', `chart is {${CHART_KEYS.join(', ')}, offsetFromAnchorCell?}.`);
    checkKeys({ ...chart, kind: 'chart' }, CHART_KEYS, ['offsetFromAnchorCell']);
    const { name, caption, widget, inputs } = parts(chart, sheets, now);

    const sheet = pickSheet(sheets, chart.sheet);
    const corner = sheet.range(chart.topLeft, 'topLeft');
    if (corner.top !== corner.bottom || corner.left !== corner.right) throw new AgentError('unreadableEdit', 'topLeft is one cell, such as "E1".');
    const side = (key: 'widthInPixels' | 'heightInPixels') => {
      const n = chart[key];
      if (!Number.isInteger(n) || (n as number) < MIN_SIDE || (n as number) > MAX_SIDE) throw new AgentError('sizeOfPlacementNotAllowed', `${key} is a whole number of pixels from ${MIN_SIDE} to ${MAX_SIDE}.`);
      return n as number;
    };
    const widthInPixels = side('widthInPixels');
    const heightInPixels = side('heightInPixels');
    // The chart stays at its cell: the corner it has (it may lie on a cell id the read gives by its place now).
    const stays = now !== null && now.sheet.sheetId === sheet.sheetId && now.read.topLeft === chart.topLeft;
    const topLeft = stays ? now.entry.placement.topLeft : { r: sheet.rowIds[corner.top]!, c: sheet.columnIds[corner.left]! };
    let offset: { xInPixels: number; yInPixels: number } | undefined;
    if (chart.offsetFromAnchorCell === undefined) offset = stays ? now.entry.placement.offsetFromAnchorCell : undefined;
    else {
      const given = chart.offsetFromAnchorCell;
      if (!isObject(given)) throw new AgentError('offsetOfPlacementNotAllowed', 'offsetFromAnchorCell is {"xInPixels", "yInPixels"}: whole numbers of pixels right of and below the cell\'s corner.');
      checkKeys({ ...given, kind: 'offsetFromAnchorCell' }, ['xInPixels', 'yInPixels']);
      const { xInPixels, yInPixels } = given;
      const fits = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_OFFSET;
      if (!fits(xInPixels) || !fits(yInPixels)) {
        throw new AgentError('offsetOfPlacementNotAllowed', `offsetFromAnchorCell is whole numbers of pixels from 0 to ${MAX_OFFSET}: how far right of the cell's corner and below it the chart's corner lies. Keep it within the cell.`);
      }
      offset = xInPixels || yInPixels ? { xInPixels: xInPixels as number, yInPixels: yInPixels as number } : undefined;
    }
    const elementId = now?.view.elements[0]?.elementId ?? `vel_${host.newIdCode()}.0`;
    return {
      view: { name, elements: [{ kind: 'widget', elementId, embed: { ref: `node/${widget}`, caption }, inputs }] },
      sheet,
      placement: { shows: { kind: 'view', viewId: now?.viewId ?? '' }, topLeft, ...(offset ? { offsetFromAnchorCell: offset } : {}), widthInPixels, heightInPixels },
    };
  }

  /** The chart a setChart or deleteChart names, with where it lies and what a read gives for it. */
  function find(chartId: unknown, sheets: SheetView[]) {
    const read = reader(sheets);
    const view = typeof chartId === 'string' ? read.views().find((v) => v.viewId === chartId) : undefined;
    if (!view) throw new AgentError('unknownChart', `No chart has the id ${JSON.stringify(chartId)}: readCharts gives each chart's chartId.`);
    const at = read.placementOf(view.viewId);
    return { ...view, at, reader: read };
  }

  /**
   * The cells a panel may write, input by input, each with what it holds now (the values a reset brings back). Only a
   * blank cell or a plain number, text or boolean typed in is writable.
   */
  function writesOf(writable: unknown, inputs: ViewInput[], sheets: SheetView[]): NonNullable<ViewElement['writes']> {
    if (!Array.isArray(writable) || new Set(writable).size !== writable.length) {
      throw new AgentError('unreadableEdit', 'writable is a list of input names, each named once: [] when the controls only read.');
    }
    const byName = new Map(inputs.map((input) => [input.name, input]));
    const filledOf = new Map<string, Map<string, ReturnType<SheetView['filled']>[number]>>();
    let total = 0;
    return writable.map((given: unknown) => {
      const input = typeof given === 'string' ? byName.get(given) : undefined;
      if (!input) throw new AgentError('unknownInput', `writable names ${JSON.stringify(given)}, which is none of this panel's inputs.`);
      const { sheetId, topLeft, bottomRight } = input.range;
      const source = sheets.find((s) => s.sheetId === sheetId)!;
      const [top, bottom] = [source.rowIndex(topLeft.r)!, source.rowIndex(bottomRight.r)!];
      const [left, right] = [source.columnIndex(topLeft.c)!, source.columnIndex(bottomRight.c)!];
      total += (bottom - top + 1) * (right - left + 1);
      if (total > MAX_WRITABLE_CELLS) throw new AgentError('tooManyCells', `The writable inputs of one panel cover at most ${MAX_WRITABLE_CELLS.toLocaleString('en-US')} cells together.`);
      let filled = filledOf.get(sheetId);
      if (!filled) {
        filled = new Map(source.filled().map((f) => [`${f.row},${f.column}`, f]));
        filledOf.set(sheetId, filled);
      }
      const saved: WritableCell[] = [];
      for (let row = top; row <= bottom; row++) {
        for (let column = left; column <= right; column++) {
          const f = filled.get(`${row},${column}`);
          const held = f?.cell.input;
          if (f && (f.spilled || !isObject(held) || !WRITABLE_KINDS.has(String(held.kind)))) {
            throw new AgentError('cannotWriteInteractiveCell', `${source.name}!${a1(row, column)} holds a formula, a spilled value or a value of another kind: a writable cell is blank or holds a plain number, text or boolean.`, { cell: `${source.name}!${a1(row, column)}` });
          }
          const value = f && isObject(held) ? { kind: String(held.kind), value: held.value } : null;
          saved.push({ r: source.rowIds[row]!, c: source.columnIds[column]!, value });
        }
      }
      return { input: input.name, saved };
    });
  }

  return {
    addInteractive(panel: unknown, sheets: SheetView[]): void {
      if (!isObject(panel)) throw new AgentError('unreadableEdit', `interactive is {${INTERACTIVE_KEYS.join(', ')}}.`);
      checkKeys({ ...panel, kind: 'interactive' }, INTERACTIVE_KEYS);
      const tab = pickSheet(sheets, panel.sheet);
      if (tab.contents.interactive || tab.filledBlock() || tab.contents.placements?.length) {
        throw new AgentError('sheetNotBlank', `Sheet "${tab.name}" already holds cells, charts or a panel: an interactive panel takes a blank tab of its own (addSheet one first).`);
      }
      if (reader(sheets).views().length >= MAX_CHARTS) throw new AgentError('tooManyViews', `A workbook holds ${MAX_CHARTS} views, charts and interactive panels together.`);
      const { name, caption, widget, inputs } = parts(panel, sheets, null);
      if (inputs.some((input) => input.name === INTERACTIVE_SOURCE)) {
        throw new AgentError('inputNameNotAllowed', `"${INTERACTIVE_SOURCE}" is the name of the source the page gives the panel's controls: name the input otherwise.`);
      }
      for (const input of inputs) {
        const source = sheets.find((s) => s.sheetId === input.range.sheetId);
        if (input.range.sheetId === tab.sheetId || source?.contents.interactive) {
          throw new AgentError('sheetIsAnInteractive', `Input "${input.name}" lies on an interactive panel's tab: a panel's inputs are cells of the tabs that hold the data.`);
        }
      }
      const writes = writesOf(panel.writable, inputs, sheets);
      const viewId = `viw_${host.newIdCode()}.0`;
      const elementId = `vel_${host.newIdCode()}.0`;
      host.apply(
        [
          { kind: 'setViews', views: [{ viewId, view: { name, elements: [{ kind: 'interactive', elementId, embed: { ref: `node/${widget}`, caption }, inputs, writes }] } }] },
          { kind: 'setSheetSettings', sheets: [{ sheetId: tab.sheetId, settings: { interactive: viewId } }] },
        ],
        INTERACTIVE_FORMAT_VERSION,
      );
    },

    add(chart: unknown, sheets: SheetView[]): void {
      const charts = reader(sheets).views().length;
      if (charts >= MAX_CHARTS) throw new AgentError('tooManyViews', `A workbook holds ${MAX_CHARTS} charts.`);
      const m = made(chart, sheets, null);
      const code = host.newIdCode();
      const viewId = `viw_${code}.0`;
      const placement = { ...m.placement, shows: { kind: 'view', viewId } };
      host.apply(
        [
          { kind: 'setViews', views: [{ viewId, view: m.view }] },
          { kind: 'setPlacements', sheetId: m.sheet.sheetId, placements: [{ placementId: `plc_${code}.0`, placement }] },
        ],
        versionOf(placement),
      );
    },

    set(chartId: unknown, chart: unknown, sheets: SheetView[]): boolean {
      const found = find(chartId, sheets);
      if (found.view.elements.some((e) => e.kind === 'interactive')) {
        throw new AgentError('unknownChart', `${found.viewId} is an interactive panel, not a chart: setChart leaves it alone.`);
      }
      if (!found.at) throw new AgentError('unknownChart', `Chart ${String(chartId)} lies over no sheet.`);
      const { sheet, entry } = found.at;
      const read = found.reader.chart(found.view, sheet, entry);
      const m = made(chart, sheets, { viewId: found.viewId, view: found.view, sheet, entry, read, reader: found.reader });
      const placement = { ...m.placement, shows: { kind: 'view', viewId: found.viewId } };
      const ops: EngineMessage[] = [];
      if (JSON.stringify(m.view) !== JSON.stringify(found.view)) ops.push({ kind: 'setViews', views: [{ viewId: found.viewId, view: m.view }] });
      if (m.sheet.sheetId !== sheet.sheetId) {
        ops.push({ kind: 'setPlacements', sheetId: sheet.sheetId, placements: [{ placementId: entry.placementId, placement: null }] });
        ops.push({ kind: 'setPlacements', sheetId: m.sheet.sheetId, placements: [{ placementId: `plc_${host.newIdCode()}.0`, placement }] });
      } else if (JSON.stringify(placement) !== JSON.stringify(entry.placement)) {
        ops.push({ kind: 'setPlacements', sheetId: sheet.sheetId, placements: [{ placementId: entry.placementId, placement }] });
      }
      if (ops.length === 0) return false;
      host.apply(ops, versionOf(placement));
      return true;
    },

    remove(chartId: unknown, sheets: SheetView[]): void {
      const found = find(chartId, sheets);
      if (found.view.elements.some((e) => e.kind === 'interactive')) {
        throw new AgentError('unknownChart', `${found.viewId} is an interactive panel, not a chart: deleteChart leaves it, and the person removes it in the page.`);
      }
      const ops: EngineMessage[] = [];
      if (found.at) ops.push({ kind: 'setPlacements', sheetId: found.at.sheet.sheetId, placements: [{ placementId: found.at.entry.placementId, placement: null }] });
      ops.push({ kind: 'setViews', views: [{ viewId: found.viewId, view: null }] });
      host.apply(ops, CHART_FORMAT_VERSION);
    },
  };
}
