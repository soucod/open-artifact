import type {
  Border,
  CellControl,
  CellFormat,
  CellFormatContents,
  Color,
  DropdownContents,
  FormatOfACondition,
  HorizontalAlignment,
  IdRun,
  NumberFormatKind,
  SharedCellFormat,
  Underline,
  VerticalAlignment,
  Wrap,
  WrapWritten,
} from '@open-artifact/sheets-core';
import type { CellArea } from '../selection/model.ts';
import { parseLineId, lastAtOrBefore, type LineIndex, type LineSpan } from './line-ids.ts';

/** A number format, with the kind of number its pattern shows. */
export interface KindedNumberFormat {
  kind: NumberFormatKind;
  pattern: string;
}

/** A cell's format with every default filled in. */
export interface WholeCellFormat {
  font: { bold: boolean; italic: boolean; underline: Underline; strikethrough: boolean; color: Color; size: number };
  numberFormat: KindedNumberFormat;
  alignment: { horizontal: HorizontalAlignment; vertical: VerticalAlignment; wrap: Wrap };
  fillColor: Color;
  cellControl: CellControl;
  border: { top: Border; bottom: Border; left: Border; right: Border };
}

/** The parts of a format some cells are given, the number format with its kind. */
export interface KindedCellFormat extends Omit<CellFormat, 'numberFormat'> {
  numberFormat?: KindedNumberFormat;
}

/** Reads the kind of number a number format's pattern shows. */
export type KindOfPattern = (pattern: string) => NumberFormatKind;

export type BorderSide = 'top' | 'bottom' | 'left' | 'right';

/** Rows by columns, as runs of line ids. */
export interface LineRunsOfEntry {
  rows: IdRun[];
  columns: IdRun[];
}

/** Rows by columns, as spans of their positions. */
export interface IndexRunsOfEntry {
  rows: LineSpan[];
  columns: LineSpan[];
}

/** Cells given one format, by their positions. */
export interface FormatAtIndexes extends IndexRunsOfEntry {
  format: KindedCellFormat;
}

/** Cells given one number format pattern, by their positions. */
export interface NumberFormatAtIndexes extends IndexRunsOfEntry {
  pattern: string;
}

/** The whole format of a cell, by its row and column. */
export interface CellFormatLookup {
  formatOf(rowId: string, columnId: string): WholeCellFormat;
}

/** The look conditional formats give a cell. */
export interface GivenLook {
  fillColor?: Color;
  font: NonNullable<FormatOfACondition['font']>;
}

/** The looks conditional formats give cells, and a cell's format as they draw it. */
export interface GivenFormatsLookup {
  lookGivenTo(rowId: string, columnId: string): GivenLook | null;
  formatDrawnOf(format: WholeCellFormat, rowId: string, columnId: string): WholeCellFormat;
}

interface EdgeOfRun {
  at: number;
  list: number;
  isStart: boolean;
}

/** From where along a base of line ids the lists that hold its lines are these. */
interface HeldStretch {
  first: number;
  heldBy: number[];
}
export function normalizedWrap(wrap: WrapWritten): Wrap {
  if (wrap === 'overflow') return false;
  return wrap === 'wrap' ? true : wrap;
}
export function indexRunsOfLineRuns(lineRuns: readonly IdRun[], lineIndex: LineIndex): LineSpan[] {
  let stretches = lineRuns.flatMap((run: IdRun) => lineIndex.stretchesOf(run));
  stretches.sort((oneStretch: LineSpan, otherStretch: LineSpan) => oneStretch.firstIndex - otherStretch.firstIndex);
  let merged: LineSpan[] = [];
  for (let stretch of stretches) {
    let last = merged.at(-1);
    if (last === undefined || stretch.firstIndex > last.firstIndex + last.count) merged.push(stretch);
    else
      merged[merged.length - 1] = {
        firstIndex: last.firstIndex,
        count: Math.max(last.count, stretch.firstIndex + stretch.count - last.firstIndex),
      };
  }
  return merged;
}
export function numberFormatEntryRuns(entries: readonly CellFormatContents[], rows: LineIndex, columns: LineIndex): NumberFormatAtIndexes[] {
  return entries.flatMap(
    (entry: CellFormatContents) =>
      entry.format.numberFormat === undefined || isGeneralPattern(entry.format.numberFormat.pattern)
        ? []
        : {
            pattern: entry.format.numberFormat.pattern,
            rows: indexRunsOfLineRuns(entry.rows, rows),
            columns: indexRunsOfLineRuns(entry.columns, columns),
          },
  );
}
export function runEdgesWithin(runs: readonly LineSpan[], first: number, count: number): number[] {
  let [low, high] = [0, runs.length];
  while (low < high) {
    let middle = Math.floor((low + high) / 2);
    let run = runs[middle];
    if (run !== undefined && run.firstIndex + run.count <= first) low = middle + 1;
    else high = middle;
  }
  let edges: number[] = [];
  for (let runIndex = low; runIndex < runs.length; runIndex += 1) {
    let run = runs[runIndex];
    if (run === undefined || run.firstIndex >= first + count) break;
    edges.push(run.firstIndex, run.firstIndex + run.count);
  }
  return edges;
}
export function borderEdgesNear(entries: readonly IndexRunsOfEntry[], area: CellArea): { rows: number[]; columns: number[] } {
  let rowEdges = new Set<number>();
  let columnEdges = new Set<number>();
  for (let entry of entries) {
    let rowEdgesOfEntry = runEdgesWithin(entry.rows, area.topRowIndex - 1, area.rowCount + 2);
    let columnEdgesOfEntry = runEdgesWithin(entry.columns, area.leftColumnIndex - 1, area.columnCount + 2);
    if (rowEdgesOfEntry.length === 0 || columnEdgesOfEntry.length === 0) continue;
    for (let edge of rowEdgesOfEntry) rowEdges.add(edge);
    for (let edge of columnEdgesOfEntry) columnEdges.add(edge);
  }
  return {
    rows: [...rowEdges],
    columns: [...columnEdges],
  };
}
export function numberFormatPatternsWithin(entries: readonly NumberFormatAtIndexes[], area: CellArea): string[] {
  let matches = entries.filter(
    ({ rows, columns }: NumberFormatAtIndexes) =>
      runEdgesWithin(rows, area.topRowIndex, area.rowCount).length > 0 && runEdgesWithin(columns, area.leftColumnIndex, area.columnCount).length > 0,
  );
  return [...new Set(matches.map(({ pattern }: NumberFormatAtIndexes) => pattern))];
}
export function coveredCountWithin(runs: readonly LineSpan[], first: number, count: number): number {
  let edges = runEdgesWithin(runs, first, count);
  let covered = 0;
  for (let index = 0; index + 1 < edges.length; index += 2)
    covered += Math.min(edges[index + 1] ?? 0, first + count) - Math.max(edges[index] ?? 0, first);
  return covered;
}
export function sharedFormatOfArea(entries: readonly FormatAtIndexes[], area: CellArea): SharedCellFormat {
  let coverage = entries.flatMap(({ rows, columns, format }: FormatAtIndexes) => {
    let columnsCovered = coveredCountWithin(columns, area.leftColumnIndex, area.columnCount);
    let cellsCovered = columnsCovered === 0 ? 0 : columnsCovered * coveredCountWithin(rows, area.topRowIndex, area.rowCount);
    return cellsCovered === 0
      ? []
      : {
          format,
          cellCount: cellsCovered,
        };
  });
  let sharedValue = <T,>(valueOf: (format: KindedCellFormat) => T | undefined, valueByDefault: T): T | null => {
    let shared: { value: T; written: string } | null = null;
    let cellCount = 0;
    for (let covered of coverage) {
      let value = valueOf(covered.format);
      if (value === undefined) continue;
      let written = JSON.stringify(value);
      shared ??= {
        value,
        written,
      };
      if (shared.written !== written) return null;
      cellCount += covered.cellCount;
    }
    if (shared === null) return valueByDefault;
    return cellCount === area.rowCount * area.columnCount ? shared.value : null;
  };
  let { alignment: defaultAlignment, border: defaultBorder, font: defaultFont } = DEFAULT_CELL_FORMAT;
  return {
    numberFormat: sharedValue((format) => format.numberFormat, DEFAULT_CELL_FORMAT.numberFormat),
    alignment: {
      horizontal: sharedValue((format) => format.alignment?.horizontal, defaultAlignment.horizontal),
      vertical: sharedValue((format) => format.alignment?.vertical, defaultAlignment.vertical),
      wrap: sharedValue(wrapOfFormat, defaultAlignment.wrap),
    },
    fillColor: sharedValue((format) => format.fillColor, DEFAULT_CELL_FORMAT.fillColor),
    cellControl: sharedValue((format) => format.cellControl, DEFAULT_CELL_FORMAT.cellControl),
    border: {
      top: sharedValue((format) => format.border?.top, defaultBorder.top),
      right: sharedValue((format) => format.border?.right, defaultBorder.right),
      bottom: sharedValue((format) => format.border?.bottom, defaultBorder.bottom),
      left: sharedValue((format) => format.border?.left, defaultBorder.left),
    },
    font: {
      bold: sharedValue((format) => format.font?.bold, defaultFont.bold),
      italic: sharedValue((format) => format.font?.italic, defaultFont.italic),
      underline: sharedValue((format) => format.font?.underline, defaultFont.underline),
      strikethrough: sharedValue((format) => format.font?.strikethrough, defaultFont.strikethrough),
      color: sharedValue((format) => format.font?.color, defaultFont.color),
      size: sharedValue((format) => format.font?.size, defaultFont.size),
    },
  };
}
export function customHexColors(colors: Iterable<Color | undefined>): string[] {
  let hexes = new Set<string>();
  for (let color of colors) {
    if (color?.kind !== 'rgb' || BUILT_IN_HEX_COLORS.has(color.hex)) continue;
    hexes.add(color.hex);
    if (hexes.size === MAX_CUSTOM_HEX_COLORS) break;
  }
  return [...hexes];
}
export function* colorsUsedInFormats(
  entries: readonly CellFormatContents[],
  dropdowns: readonly DropdownContents[],
): Generator<Color | undefined, void, undefined> {
  for (let { format } of entries) {
    yield* [format.fillColor, format.font?.color];
    for (let side of BORDER_SIDES) {
      let border = format.border?.[side];
      if (border?.kind === 'line') yield border.color;
    }
  }
  for (let { options } of dropdowns) for (let { color } of options) yield color;
}
export function heldByStretches(runLists: readonly (readonly IdRun[])[]): Map<string, HeldStretch[]> {
  let edgesByBase = new Map<string, EdgeOfRun[]>();
  runLists.forEach((runs: readonly IdRun[], listIndex: number) => {
    for (let { base, first, count } of runs) {
      let edges = edgesByBase.get(base) ?? [];
      edges.push(
        {
          at: first,
          list: listIndex,
          isStart: true,
        },
        {
          at: first + count,
          list: listIndex,
          isStart: false,
        },
      );
      edgesByBase.set(base, edges);
    }
  });
  let heldByBase = new Map<string, HeldStretch[]>();
  for (let [base, edges] of edgesByBase) {
    edges.sort(
      (oneEdge: EdgeOfRun, otherEdge: EdgeOfRun) =>
        oneEdge.at === otherEdge.at ? Number(oneEdge.isStart) - Number(otherEdge.isStart) : oneEdge.at - otherEdge.at,
    );
    let lists = new Set<number>();
    let stretches: HeldStretch[] = [];
    edges.forEach(({ at, list, isStart }: EdgeOfRun, edgeIndex: number) => {
      if (isStart) lists.add(list);
      else lists.delete(list);
      if (edges[edgeIndex + 1]?.at !== at)
        stretches.push({
          first: at,
          heldBy: [...lists],
        });
    });
    heldByBase.set(base, stretches);
  }
  return heldByBase;
}
export function createRunMembership(runLists: readonly (readonly IdRun[])[]): (lineId: string) => number[] {
  let heldByBase = heldByStretches(runLists);
  return (lineId: string) => {
    let line = parseLineId(lineId);
    let stretches = line === null ? undefined : heldByBase.get(line.base);
    if (line === null || stretches === undefined) return NO_FORMAT_ENTRY_INDEXES;
    let stretch = lastAtOrBefore(stretches, ({ first }: HeldStretch) => first, line.first);
    return stretch === undefined || stretch.first > line.first ? NO_FORMAT_ENTRY_INDEXES : stretch.heldBy;
  };
}
export function createFormatEntryLookup(entries: readonly LineRunsOfEntry[]): (rowId: string, columnId: string) => number[] {
  let columnMembership = createRunMembership(entries.map(({ columns }: LineRunsOfEntry) => columns));
  let rowTesters = new Map<number, (rowId: string) => boolean>();
  let coversRow = (entryIndex: number, rowId: string) => {
    let tester = rowTesters.get(entryIndex);
    if (tester === undefined) {
      let rowMembership = createRunMembership([entries[entryIndex]?.rows ?? []]);
      tester = (rowIdTested: string) => rowMembership(rowIdTested).length > 0;
      rowTesters.set(entryIndex, tester);
    }
    return tester(rowId);
  };
  return (rowId: string, columnId: string) => columnMembership(columnId).filter((entryIndex: number) => coversRow(entryIndex, rowId));
}
export function internCellFormat(format: WholeCellFormat): WholeCellFormat {
  let key = JSON.stringify(format);
  let interned = internedCellFormats.get(key) ?? format;
  internedCellFormats.set(key, interned);
  return interned;
}
export function createCellFormatLookup(entries: readonly CellFormatContents[], kindOfPattern: KindOfPattern): CellFormatLookup {
  let formats = entries.map(({ format }: CellFormatContents) => withNumberFormatKind(format, kindOfPattern));
  let entriesAt = createFormatEntryLookup(entries);
  let cache = new Map<string, WholeCellFormat>();
  return {
    formatOf(rowId: string, columnId: string) {
      let entryIndexes = entriesAt(rowId, columnId);
      if (entryIndexes.length === 0) return DEFAULT_CELL_FORMAT;
      let key = entryIndexes.join();
      let cached = cache.get(key);
      if (cached !== undefined) return cached;
      let format = internCellFormat(
        entryIndexes.reduce((merged: WholeCellFormat, entryIndex: number) => mergeCellFormat(merged, formats[entryIndex] ?? {}), DEFAULT_CELL_FORMAT),
      );
      cache.set(key, format);
      return format;
    },
  };
}
export function createGivenFormatsLookup(entries: readonly CellFormatContents[]): GivenFormatsLookup {
  if (entries.length === 0) return NO_GIVEN_FORMATS_LOOKUP;
  let entriesAt = createFormatEntryLookup(entries);
  let looks = new Map<string, GivenLook>();
  let drawnCache = new WeakMap<WholeCellFormat, Map<GivenLook, WholeCellFormat>>();
  let lookGivenTo = (rowId: string, columnId: string) => {
    let entryIndexes = entriesAt(rowId, columnId);
    if (entryIndexes.length === 0) return null;
    let key = entryIndexes.join();
    let cached = looks.get(key);
    if (cached !== undefined) return cached;
    let formats = entryIndexes.map((entryIndex: number): CellFormat => entries[entryIndex]?.format ?? {});
    let fillColor = formats.find((format: CellFormat) => format.fillColor !== undefined)?.fillColor;
    let font: GivenLook['font'] = {};
    for (let format of formats) Object.assign(font, format.font);
    let look = {
      ...(fillColor !== undefined && {
        fillColor,
      }),
      font,
    };
    looks.set(key, look);
    return look;
  };
  return {
    lookGivenTo,
    formatDrawnOf(format: WholeCellFormat, rowId: string, columnId: string) {
      let look = lookGivenTo(rowId, columnId);
      if (look === null) return format;
      let drawnByLook = drawnCache.get(format) ?? new Map<GivenLook, WholeCellFormat>();
      drawnCache.set(format, drawnByLook);
      let cached = drawnByLook.get(look);
      if (cached !== undefined) return cached;
      let drawn = internCellFormat(mergeCellFormat(format, look));
      drawnByLook.set(look, drawn);
      return drawn;
    },
  };
}
export const BORDER_SIDES: BorderSide[] = ['top', 'bottom', 'left', 'right'];
export const DEFAULT_CELL_FORMAT: WholeCellFormat = {
  font: {
    bold: false,
    italic: false,
    underline: 'none',
    strikethrough: false,
    color: {
      kind: 'none',
    },
    size: 10,
  },
  numberFormat: {
    kind: 'general',
    pattern: 'General',
  },
  alignment: {
    horizontal: 'general',
    vertical: 'top',
    wrap: false,
  },
  fillColor: {
    kind: 'none',
  },
  cellControl: {
    kind: 'none',
  },
  border: {
    top: {
      kind: 'none',
    },
    bottom: {
      kind: 'none',
    },
    left: {
      kind: 'none',
    },
    right: {
      kind: 'none',
    },
  },
};
export const wrapOfFormat = ({ alignment }: Pick<KindedCellFormat, 'alignment'>): Wrap | undefined =>
  alignment?.wrap === undefined ? undefined : normalizedWrap(alignment.wrap);
export const hasFontFormatting = ({ font }: Pick<WholeCellFormat, 'font'>): boolean =>
  font.bold ||
  font.italic ||
  font.strikethrough ||
  font.underline !== DEFAULT_CELL_FORMAT.font.underline ||
  font.color.kind !== 'none' ||
  font.size !== DEFAULT_CELL_FORMAT.font.size;
export const hasFontOrBorderFormatting = (format: Pick<WholeCellFormat, 'font' | 'border'>): boolean =>
  hasFontFormatting(format) || BORDER_SIDES.some((side: BorderSide) => format.border[side].kind === 'line');
export const LIGHT_GRAY_HEX = '#f3f3f3';
export const withNumberFormatKind = ({ numberFormat, ...format }: CellFormat, kindOfPattern: KindOfPattern): KindedCellFormat =>
  numberFormat === undefined
    ? format
    : {
        ...format,
        numberFormat: {
          kind: kindOfPattern(numberFormat.pattern),
          pattern: numberFormat.pattern,
        },
      };
export const mergeCellFormat = (
  format: WholeCellFormat,
  { alignment, border, font, ...rest }: KindedCellFormat,
): WholeCellFormat => ({
  ...format,
  ...rest,
  alignment: {
    ...format.alignment,
    ...alignment,
    wrap: normalizedWrap(alignment?.wrap ?? format.alignment.wrap),
  },
  border: {
    ...format.border,
    ...border,
  },
  font: {
    ...format.font,
    ...font,
  },
});
export const anyEntryHasBorderLine = (entries: readonly CellFormatContents[]): boolean =>
  entries.some(({ format }: CellFormatContents) => BORDER_SIDES.some((side: BorderSide) => format.border?.[side]?.kind === 'line'));
export const entriesToIndexRuns = (entries: readonly LineRunsOfEntry[], rows: LineIndex, columns: LineIndex): IndexRunsOfEntry[] =>
  entries.map(
    (entry: LineRunsOfEntry) => ({
      rows: indexRunsOfLineRuns(entry.rows, rows),
      columns: indexRunsOfLineRuns(entry.columns, columns),
    }),
  );
export const borderEntryRuns = (entries: readonly CellFormatContents[], rows: LineIndex, columns: LineIndex): IndexRunsOfEntry[] =>
  entriesToIndexRuns(
    entries.filter(({ format }: CellFormatContents) => format.border !== undefined),
    rows,
    columns,
  );
export const wrapEntryRuns = (entries: readonly CellFormatContents[], rows: LineIndex, columns: LineIndex): IndexRunsOfEntry[] =>
  entriesToIndexRuns(
    entries.filter(({ format }: CellFormatContents) => wrapOfFormat(format) === true),
    rows,
    columns,
  );
export const isGeneralPattern = (pattern: string): boolean => /^general$/i.test(pattern);
export const formatEntryRuns = (
  entries: readonly CellFormatContents[],
  rows: LineIndex,
  columns: LineIndex,
  kindOfPattern: KindOfPattern,
): FormatAtIndexes[] =>
  entries.map(
    (entry: CellFormatContents) => ({
      rows: indexRunsOfLineRuns(entry.rows, rows),
      columns: indexRunsOfLineRuns(entry.columns, columns),
      format: withNumberFormatKind(entry.format, kindOfPattern),
    }),
  );
export const rowLookKey = (entries: readonly FormatAtIndexes[], rowIndex: number): string =>
  entries
    .flatMap(
      ({ rows, format }: FormatAtIndexes, entryIndex: number) =>
        Object.keys(format).some((key: string) => key !== 'border') && runEdgesWithin(rows, rowIndex, 1).length > 0 ? [entryIndex] : [],
    )
    .join();
export const clipsWithin = (entries: readonly FormatAtIndexes[], area: CellArea): boolean =>
  entries.some(
    ({ rows, columns, format }: FormatAtIndexes) =>
      wrapOfFormat(format) === 'clip' &&
      coveredCountWithin(columns, area.leftColumnIndex, area.columnCount) > 0 &&
      coveredCountWithin(rows, area.topRowIndex, area.rowCount) > 0,
  );
export const MAX_CUSTOM_HEX_COLORS = 8;
export const BUILT_IN_HEX_COLORS = new Set(['#ffffff', '#f3f3f3', '#000000']);
export const customHexColorsOfSheet = (entries: readonly CellFormatContents[], dropdowns: readonly DropdownContents[]): string[] =>
  customHexColors(colorsUsedInFormats(entries, dropdowns));
export const internedCellFormats = new Map<string, WholeCellFormat>();
export const NO_FORMAT_ENTRY_INDEXES: number[] = [];
export const withFontMarks = (format: WholeCellFormat, marks: readonly string[]): WholeCellFormat =>
  internCellFormat(
    mergeCellFormat(format, {
      font: {
        bold: marks.includes('bold'),
        italic: marks.includes('italic'),
        underline: marks.includes('underline') ? 'single' : 'none',
        strikethrough: marks.includes('strikethrough'),
      },
    }),
  );
export const NO_GIVEN_FORMATS_LOOKUP: GivenFormatsLookup = {
  lookGivenTo: () => null,
  formatDrawnOf: (format: WholeCellFormat) => format,
};
