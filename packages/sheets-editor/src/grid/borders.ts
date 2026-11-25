import type { Border, BorderStyle, SheetId } from '@open-artifact/sheets-core';
import type { BorderSide, WholeCellFormat } from '../model/cell-format.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { PaintPair } from './cell-drawing.tsx';
import type { GridLayout } from './layout.ts';
import { shownLineAtOrBefore, shownLineAtOrAfter } from '../model/line-sizes.ts';
import { colorKey, NO_COLOR } from '../model/colors.ts';
import { textColorsOnFill } from '../format/cell-colors.ts';
import { isInSpan } from './geometry.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
/** A border that is drawn. */
export type BorderLine = Extract<Border, { kind: 'line' }>;
/** How a border style is drawn: how wide it shows, the width and offsets of its strokes, and its dash pattern. */
export interface BorderLook {
  width: number;
  strokeWidth: number;
  strokes: number[];
  dashes: string | null;
}
/** Some lines of one axis, with the shown line just before them and the one just after. */
export interface ShownLines {
  before: number;
  indexes: readonly number[];
  after: number;
}
/** A border drawn unbroken along cells: the line, the index before its first cell, its first and the one after its last. */
export interface BorderRun {
  line: BorderLine;
  beforeFirst: number;
  first: number;
  afterLast: number;
}
/** The borders of the cell at a place, or null where no cell's format is read. */
export type BordersAtPlace = (cell: CellPosition) => Pick<WholeCellFormat, 'border'> | null;
/** The borders of the cell at a row and column. */
export type BordersAtCell = (rowIndex: number, columnIndex: number) => WholeCellFormat['border'];
/** The lines of the grid to draw borders on, and where they are on screen. */
export interface GridOfBorders {
  rows: ShownLines;
  columns: ShownLines;
  formatAt: BordersAtPlace;
  mergedAreas: readonly CellArea[];
  leftOfColumn: (columnIndex: number) => number;
  topOfRow: (rowIndex: number) => number;
}
/** The borders of one style and color, as a single path. */
export interface BorderPath {
  key: string;
  path: string;
  strokeWidth: number;
  dashes: string | null;
  paint: PaintPair | null;
}
/** A side of an area, or the lines inside it across and down. */
export type AreaBorderSide = BorderSide | 'horizontal' | 'vertical';
/** Whether the cells along a side have borders: all, part, none, or no such line to have one. */
export type AreaBorderState = 'all' | 'part' | 'none' | null;
export type AreaBorderLines = Record<AreaBorderSide, AreaBorderState>;
/** The borders of an area, and whether they were read from a sample of its cells. */
export interface AreaBorders {
  lines: AreaBorderLines;
  isFromSample: boolean;
}
/** An area to read the borders of, with the reads it needs. */
export interface AreaToReadBordersOf {
  area: CellArea;
  formatAt: BordersAtPlace;
  mergedAreas: readonly CellArea[];
  bordersMayChangeBefore: { rows: number[]; columns: number[] };
}
/** The stroke paths of one border style and color, as they are gathered. */
interface StrokesOfLine {
  line: BorderLine;
  strokes: string[];
}
export function strongerBorder(first: Border, second: Border): BorderLine | null {
  if (first.kind === 'none') return second.kind === 'none' ? null : second;
  if (second.kind === 'none') return first;
  return borderStyleRank(second.style) > borderStyleRank(first.style) ? second : first;
}
export function borderOverhangBelow(
  { topRowIndex, rowCount, leftColumnIndex }: Pick<CellArea, 'topRowIndex' | 'rowCount' | 'leftColumnIndex'>,
  layout: Pick<GridLayout, 'rowEdges' | 'rowCount'>,
  bordersAt: BordersAtCell,
): number {
  let endRow = topRowIndex + rowCount;
  let lastRow = Math.max(topRowIndex, shownLineAtOrBefore(layout.rowEdges, endRow - 1));
  let nextRow = shownLineAtOrAfter(layout.rowEdges, endRow);
  let border = strongerBorder(
    bordersAt(lastRow, leftColumnIndex).bottom,
    nextRow < layout.rowCount
      ? bordersAt(nextRow, leftColumnIndex).top
      : {
          kind: 'none',
        },
  );
  return border === null ? 0 : BORDER_LOOKS[border.style].width - 1;
}
export function borderLineKey(line: BorderLine): string {
  let cached = BORDER_LINE_KEY_CACHE.get(line);
  if (cached !== undefined) return cached;
  let key = `${line.style} ${colorKey(line.color)}`;
  BORDER_LINE_KEY_CACHE.set(line, key);
  return key;
}
export function borderPaint({ color }: BorderLine): PaintPair | null {
  let cached = BORDER_PAINT_CACHE.get(colorKey(color));
  if (cached !== undefined) return cached;
  let paint = textColorsOnFill(color, NO_COLOR);
  BORDER_PAINT_CACHE.set(colorKey(color), paint);
  return paint;
}
export function borderRunsAlongLine({ before, indexes, after }: ShownLines, lineAt: (index: number) => BorderLine | null): BorderRun[] {
  let runs: BorderRun[] = [];
  indexes.forEach((index, position) => {
    let line = lineAt(index);
    if (line === null) return;
    let next = indexes[position + 1] ?? after;
    let lastRun = runs.at(-1);
    if (lastRun?.afterLast === index && borderLineKey(lastRun.line) === borderLineKey(line) && BORDER_LOOKS[line.style].dashes === null)
      lastRun.afterLast = next;
    else
      runs.push({
        line,
        beforeFirst: indexes[position - 1] ?? before,
        first: index,
        afterLast: next,
      });
  });
  return runs;
}
export function buildBorderPaths(grid: GridOfBorders): BorderPath[] {
  let { rows, columns, formatAt, mergedAreas, leftOfColumn, topOfRow } = grid;
  let lineBetween = (first: CellPosition, second: CellPosition, firstSide: BorderSide, secondSide: BorderSide) => {
    let line = strongerBorder(
      formatAt(first)?.border[firstSide] ?? {
        kind: 'none',
      },
      formatAt(second)?.border[secondSide] ?? {
        kind: 'none',
      },
    );
    return line === null || isInsideOneMergedArea(mergedAreas, first, second) ? null : line;
  };
  let lineBetweenRows = (upperRow: number, lowerRow: number, columnIndex: number) =>
    lineBetween(
      {
        rowIndex: upperRow,
        columnIndex,
      },
      {
        rowIndex: lowerRow,
        columnIndex,
      },
      'bottom',
      'top',
    );
  let lineBetweenColumns = (leftColumn: number, rightColumn: number, rowIndex: number) =>
    lineBetween(
      {
        rowIndex,
        columnIndex: leftColumn,
      },
      {
        rowIndex,
        columnIndex: rightColumn,
      },
      'right',
      'left',
    );
  let pathsByKey = new Map<string, StrokesOfLine>();
  let addRun = (
    { line, first, afterLast }: BorderRun,
    isHorizontal: boolean,
    crossIndex: number,
    crossingLines: (BorderLine | null)[],
  ) => {
    let { width, strokes } = BORDER_LOOKS[line.style];
    let [alongEdge, crossEdge] = isHorizontal ? [leftOfColumn, topOfRow] : [topOfRow, leftOfColumn];
    let crossingWidths = crossingLines.map((crossingLine) => (crossingLine === null ? 0 : BORDER_LOOKS[crossingLine.style].width));
    let start = Math.max(alongEdge(first) - Math.max(...crossingWidths, 1), alongEdge(0));
    let end = alongEdge(afterLast);
    let middle = clampLineOffset(crossEdge(crossIndex), crossEdge(0), width) - width / 2;
    let entry: StrokesOfLine = pathsByKey.get(borderLineKey(line)) ?? {
      line,
      strokes: [],
    };
    pathsByKey.set(borderLineKey(line), entry);
    for (let stroke of strokes) {
      let offset = middle + stroke;
      entry.strokes.push(isHorizontal ? `M${start} ${offset}H${end}` : `M${offset} ${start}V${end}`);
    }
  };
  for (let [previousIndex, lineIndex] of neighbourIndexPairs(rows)) {
    let runs = borderRunsAlongLine(columns, (columnIndex) => lineBetweenRows(previousIndex, lineIndex, columnIndex));
    for (let run of runs)
      addRun(
        run,
        true,
        lineIndex,
        [previousIndex, lineIndex].map((rowIndex) => lineBetweenColumns(run.beforeFirst, run.first, rowIndex)),
      );
  }
  for (let [previousIndex, lineIndex] of neighbourIndexPairs(columns)) {
    let runs = borderRunsAlongLine(rows, (rowIndex) => lineBetweenColumns(previousIndex, lineIndex, rowIndex));
    for (let run of runs)
      addRun(
        run,
        false,
        lineIndex,
        [previousIndex, lineIndex].map((columnIndex) => lineBetweenRows(run.beforeFirst, run.first, columnIndex)),
      );
  }
  let paths = [...pathsByKey];
  paths.sort(([, firstStrokes], [, secondStrokes]) => borderStyleRank(firstStrokes.line.style) - borderStyleRank(secondStrokes.line.style));
  return paths.map(
    ([key, { line, strokes }]) => ({
      key,
      path: strokes.join(''),
      strokeWidth: BORDER_LOOKS[line.style].strokeWidth,
      dashes: BORDER_LOOKS[line.style].dashes,
      paint: borderPaint(line),
    }),
  );
}
export function summarizeAreaBorders(lines: AreaBorderLines, isFromSample: boolean) {
  if (isFromSample)
    return [...OUTER_BORDER_SIDES, ...INNER_BORDER_SIDES].some((side) => lines[side] === 'all' || lines[side] === 'part')
      ? 'some'
      : 'unsure';
  let allAre = (sides: readonly AreaBorderSide[], state: AreaBorderState) =>
    sides.every((side) => lines[side] === null || lines[side] === state);
  if (allAre(OUTER_BORDER_SIDES, 'none') && allAre(INNER_BORDER_SIDES, 'none')) return 'none';
  if (allAre(OUTER_BORDER_SIDES, 'all') && allAre(INNER_BORDER_SIDES, 'all')) return 'all';
  if (allAre(OUTER_BORDER_SIDES, 'all') && allAre(INNER_BORDER_SIDES, 'none')) return 'outer';
  if (allAre(OUTER_BORDER_SIDES, 'none') && allAre(INNER_BORDER_SIDES, 'all')) return 'inner';
  let [onlySide, ...otherSides] = [...OUTER_BORDER_SIDES, ...INNER_BORDER_SIDES].filter(
    (side) => lines[side] !== 'none' && lines[side] !== null,
  );
  return onlySide !== undefined && otherSides.length === 0 && lines[onlySide] === 'all' ? onlySide : 'some';
}
export function sampleEvenly<Item>(items: readonly Item[], count: number): readonly Item[] {
  if (items.length <= count) return items;
  let sample: Item[] = [];
  for (let index = 0; index < count; index += 1) {
    let item = items[Math.round((index * (items.length - 1)) / (count - 1))];
    if (item === undefined) throw Error('a list cannot be spread over fewer than two');
    sample.push(item);
  }
  return sample;
}
export function borderLineCandidates(start: number, count: number, bases: readonly number[], offsets: readonly number[]): number[] {
  let indexes = [
    ...new Set(
      [start, ...bases.flatMap((base) => offsets.map((offset) => base + offset))].filter(
        (index) => isInSpan(index, start, count),
      ),
    ),
  ];
  indexes.sort((first, second) => first - second);
  return indexes;
}
export function readAreaBorders({
  area,
  formatAt,
  mergedAreas,
  bordersMayChangeBefore,
}: AreaToReadBordersOf): AreaBorders {
  let { topRowIndex, leftColumnIndex, rowCount, columnCount } = area;
  let isFromSample = false;
  let rowBreaks = [
    ...bordersMayChangeBefore.rows,
    ...mergedAreas.flatMap((merged) => [merged.topRowIndex, merged.topRowIndex + merged.rowCount]),
  ];
  let columnBreaks = [
    ...bordersMayChangeBefore.columns,
    ...mergedAreas.flatMap((merged) => [merged.leftColumnIndex, merged.leftColumnIndex + merged.columnCount]),
  ];
  let rowLines = borderLineCandidates(topRowIndex, rowCount, rowBreaks, [0]);
  let columnLines = borderLineCandidates(leftColumnIndex, columnCount, columnBreaks, [0]);
  let readLines = (isHorizontal: boolean, lineIndexes: number[]): AreaBorderState => {
    let [beforeSide, afterSide]: [BorderSide, BorderSide] = isHorizontal ? ['bottom', 'top'] : ['right', 'left'];
    let crossIndexes = isHorizontal ? columnLines : rowLines;
    let sampledLines = sampleEvenly(
      lineIndexes,
      Math.max(Math.floor(MAX_BORDER_SAMPLES / crossIndexes.length), MIN_BORDER_SAMPLES_PER_LINE),
    );
    let sampledCross = sampleEvenly(crossIndexes, Math.floor(MAX_BORDER_SAMPLES / Math.max(sampledLines.length, 1)));
    let hasLine = false;
    let hasGap = false;
    for (let lineIndex of sampledLines)
      for (let crossIndex of sampledCross) {
        let cellAt = (index: number): CellPosition =>
          isHorizontal
            ? {
                rowIndex: index,
                columnIndex: crossIndex,
              }
            : {
                rowIndex: crossIndex,
                columnIndex: index,
              };
        if (isInsideOneMergedArea(mergedAreas, cellAt(lineIndex - 1), cellAt(lineIndex))) continue;
        if (
          strongerBorder(
            formatAt(cellAt(lineIndex - 1))?.border[beforeSide] ?? {
              kind: 'none',
            },
            formatAt(cellAt(lineIndex))?.border[afterSide] ?? {
              kind: 'none',
            },
          ) === null
        )
          hasGap = true;
        else hasLine = true;
        if (hasLine && hasGap) return 'part';
      }
    if (sampledLines.length < lineIndexes.length || sampledCross.length < crossIndexes.length) isFromSample = true;
    if (hasLine) return 'all';
    return hasGap ? 'none' : null;
  };
  let innerOffsets = [0, 1];
  return {
    lines: {
      top: readLines(true, [topRowIndex]),
      bottom: readLines(true, [topRowIndex + rowCount]),
      left: readLines(false, [leftColumnIndex]),
      right: readLines(false, [leftColumnIndex + columnCount]),
      horizontal: readLines(true, borderLineCandidates(topRowIndex + 1, rowCount - 1, rowBreaks, innerOffsets)),
      vertical: readLines(false, borderLineCandidates(leftColumnIndex + 1, columnCount - 1, columnBreaks, innerOffsets)),
    },
    isFromSample,
  };
}
export const BORDER_STYLE_ORDER: readonly BorderStyle[] = ['dotted', 'dashed', 'thin', 'medium', 'double', 'thick'];
export const borderStyleRank = (style: BorderStyle): number => BORDER_STYLE_ORDER.indexOf(style);
export const solidBorderLook = (width: number): BorderLook => ({
  width,
  strokeWidth: width,
  strokes: [0],
  dashes: null,
});
export const BORDER_LOOKS: Record<BorderStyle, BorderLook> = {
  thin: solidBorderLook(1),
  medium: solidBorderLook(2),
  thick: solidBorderLook(3),
  dashed: {
    ...solidBorderLook(1),
    dashes: '4 3',
  },
  dotted: {
    ...solidBorderLook(1),
    dashes: '1 2',
  },
  double: {
    width: 3,
    strokeWidth: 1,
    strokes: [-1, 1],
    dashes: null,
  },
};
export const borderStyleWidth = (style: BorderStyle): number => BORDER_LOOKS[style].width;
export const MAX_BORDER_WIDTH = Math.max(...Object.values(BORDER_LOOKS).map(({ width }) => width));
export const bordersAtCellOf =
  (sheet: WorkbookReads, sheetId: SheetId): BordersAtCell =>
  (rowIndex, columnIndex) => {
    let cellId = sheet.cellIdAt(sheetId, rowIndex, columnIndex);
    return (cellId === null ? DEFAULT_CELL_FORMAT : sheet.formatOf(cellId)).border;
  };
export const isInsideOneMergedArea = (mergedAreas: readonly CellArea[], first: CellPosition, second: CellPosition): boolean =>
  mergedAreas.some(
    (area) =>
      [first, second].every(
        ({ rowIndex, columnIndex }) =>
          isInSpan(rowIndex, area.topRowIndex, area.rowCount) && isInSpan(columnIndex, area.leftColumnIndex, area.columnCount),
      ),
  );
export const BORDER_LINE_KEY_CACHE = new WeakMap<BorderLine, string>();
export const BORDER_PAINT_CACHE = new Map<string, PaintPair | null>();
export const neighbourIndexPairs = ({ before, indexes, after }: ShownLines): [number, number][] =>
  indexes.length === 0 ? [] : [...indexes, after].map((index, position) => [indexes[position - 1] ?? before, index]);
export const clampLineOffset = (offset: number, start: number, width: number): number => Math.max(offset, start + width);
export const NO_AREA_BORDERS: AreaBorderLines = {
  top: 'none',
  bottom: 'none',
  left: 'none',
  right: 'none',
  horizontal: null,
  vertical: null,
};
export const OUTER_BORDER_SIDES: readonly BorderSide[] = ['top', 'bottom', 'left', 'right'];
export const INNER_BORDER_SIDES: readonly ('horizontal' | 'vertical')[] = ['horizontal', 'vertical'];
export const MAX_BORDER_SAMPLES = 500;
export const MIN_BORDER_SAMPLES_PER_LINE = Math.floor(Math.sqrt(MAX_BORDER_SAMPLES));
