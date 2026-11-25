import type { HorizontalAlignment, ListLine, VerticalAlignment } from '@open-artifact/sheets-core';
import type { RowSizing } from '../model/workbook.ts';
import type { SizedRun } from '../model/line-sizes.ts';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CellDensity } from './cell-metrics-values.ts';
import type { GridLayout } from './layout.ts';
import {
  CELL_PADDING_BY_DENSITY,
  firstLineHeight,
  GRIDLINE_THICKNESS,
  defaultRowHeightAtDensity,
  oneLineRowHeight,
  fontPointsToPixels,
  nextLineHeight,
} from './cell-metrics-values.ts';
import { clampBetween } from './geometry.ts';
import { createLineSizes } from '../model/line-sizes.ts';
/** The side a cell's text is set against. */
export type TextAlignment = Exclude<HorizontalAlignment, 'general'>;
/** The room left clear around a cell's text, in pixels. */
export interface TextInsets {
  over: number;
  under: number;
  left: number;
  right: number;
}
/** How far a text runs past the sides of its cell, in pixels. */
export interface TextOverflow {
  atLeft: number;
  atRight: number;
}
/** A row taller than its run says, for the text it wraps. */
export interface TallRow {
  rowIndex: number;
  heightInPixels: number;
}
/** Which way a zoomed editor is laid out: along its lines, or down them. */
export type EditorAxis = 'along' | 'down';
/** Where a zoomed editor is put along one axis: where its cell starts, how long it is, and how far it is zoomed. */
export interface ZoomedEditorSpan {
  ofCell: number;
  size: number;
  scale: number;
}
export function cellTextInsets(
  rowHeight: number,
  fontSize: number,
  density: CellDensity,
  align: TextAlignment,
  extraUnder: number = 0,
  besideBox: boolean = false,
): TextInsets {
  let [compact, padding] = [CELL_PADDING_BY_DENSITY.compact, CELL_PADDING_BY_DENSITY[density]];
  let room = rowHeight - compactOneLineRowHeight(fontSize);
  let under = clampBetween(extraUnder, 0, room);
  let spare = clampBetween(room - under, 0, padding.over - compact.over + padding.under - compact.under);
  let boxBeside = align === 'right' ? padding.besideBoxAtRight : padding.besideBox;
  let beside = besideBox ? boxBeside : padding.beside;
  let shift =
    (
      {
        left: 1,
        center: 0,
        right: -1,
      } as Record<TextAlignment, number>
    )[align] *
    (beside - compact.beside);
  return {
    over: compact.over + Math.ceil(spare / 2),
    under: compact.under + Math.floor(spare / 2) + under,
    left: CELL_TEXT_PADDING_X / 2 + shift,
    right: CELL_TEXT_PADDING_X / 2 - shift,
  };
}
export function textLineMiddleY(rowHeight: number, fontSize: number, verticalAlign: VerticalAlignment, density: CellDensity, extraUnder: number): number {
  let { over, under } = cellTextInsets(rowHeight, fontSize, density, 'left', extraUnder);
  let halfLine = firstLineHeight(fontSize) / 2;
  let top = over + halfLine;
  let bottom = rowHeight - GRIDLINE_THICKNESS - under - halfLine;
  if (verticalAlign === 'center') return (top + bottom) / 2;
  return verticalAlign === 'top' ? top : bottom;
}
export function textOverflowAtSides({ left, right }: Pick<TextInsets, 'left' | 'right'>, align: TextAlignment): TextOverflow {
  let overflow = left - (right - TEXT_OVERFLOW_GRIDLINE);
  return align === 'right'
    ? {
        atLeft: Math.max(0, -overflow),
        atRight: 0,
      }
    : {
        atLeft: 0,
        atRight: Math.max(0, overflow),
      };
}
export function rowHeightRuns(rowCount: number, runs: readonly RowSizing[], density: CellDensity, tallRows: readonly TallRow[] = []): SizedRun[] {
  let defaultHeight = defaultRowHeightAtDensity(density);
  let sizeRuns: SizedRun[] = [];
  let pushRun = (from: number, to: number, sizeInPixels: number) => {
    if (to > from && sizeInPixels !== defaultHeight)
      sizeRuns.push({
        firstIndex: from,
        count: to - from,
        sizeInPixels,
      });
  };
  let tallIndex = 0;
  let addRuns = (from: number, to: number, sizeInPixels: number) => {
    let start = from;
    for (; tallIndex < tallRows.length; tallIndex += 1) {
      let tallRow = tallRows[tallIndex];
      if (tallRow === undefined || tallRow.rowIndex >= to) break;
      if (tallRow.heightInPixels <= sizeInPixels) continue;
      pushRun(start, tallRow.rowIndex, sizeInPixels);
      pushRun(tallRow.rowIndex, tallRow.rowIndex + 1, tallRow.heightInPixels);
      start = tallRow.rowIndex + 1;
    }
    pushRun(start, to, sizeInPixels);
  };
  let nextIndex = 0;
  for (let {
    firstIndex,
    count,
    heightInPixels,
    largestFontSizeInPoints,
  } of runs) {
    addRuns(nextIndex, firstIndex, defaultHeight);
    addRuns(firstIndex, firstIndex + count, heightInPixels ?? oneLineRowHeight(largestFontSizeInPoints, density));
    nextIndex = firstIndex + count;
  }
  addRuns(nextIndex, rowCount, defaultHeight);
  return sizeRuns;
}
export const COLUMN_HEADER_HEIGHT = 28;
export const LIST_INDENT_PER_LEVEL = 1.8461538461538463;
export const listIndentOfLevel = (level: number | null, fontSize: number): number =>
  level === null ? 0 : (level + 1) * LIST_INDENT_PER_LEVEL * fontPointsToPixels(fontSize);
export const LIST_LINE_GAP = 3;
export const listLineGaps = (count: number): number => (count - 1) * LIST_LINE_GAP;
export const listIndentOfLines = (lines: readonly { list: ListLine }[], fontSize: number): number =>
  lines.filter(({ list }) => list.kind !== 'none').length * LIST_INDENT_PER_LEVEL * fontPointsToPixels(fontSize);
export const lineCountWithListGaps = (lineCount: number, listLineCount: number, fontSize: number): number =>
  lineCount + listLineGaps(listLineCount) / nextLineHeight(fontSize);
export const cellPaddingBeside = (density: CellDensity): number => CELL_PADDING_BY_DENSITY[density].beside;
export const cellPaddingBesideBox = (density: CellDensity): number => CELL_PADDING_BY_DENSITY[density].besideBox;
export const cellMarkSpacing = (density: CellDensity): { after: number; intoWords: number } => ({
  after: CELL_PADDING_BY_DENSITY[density].afterMark,
  intoWords: CELL_PADDING_BY_DENSITY[density].markIntoWords,
});
export const compactOneLineRowHeight = (fontSize: number): number => oneLineRowHeight(fontSize, 'compact');
export const MAX_CHIP_BEYOND_LINE = 4;
export const chipBeyondLine = ({ over }: Pick<TextInsets, 'over'>): number => clampBetween(2 * (over - 3), 0, MAX_CHIP_BEYOND_LINE);
export const editorTextInsets = (rowHeight: number, fontSize: number, density: CellDensity, extraUnder: number = 0): TextInsets => ({
  ...cellTextInsets(rowHeight, fontSize, density, 'left', extraUnder),
  right: CELL_PADDING_BY_DENSITY.compact.beside,
});
export const ZOOMED_EDITOR_MARGIN = 6;
export const ZOOMED_EDITOR_MARGIN_ACROSS = 4;
export const ZOOMED_EDITOR_EXTRA = 6;
export const MIN_PHONE_EDITOR_FONT_PX = 17;
export const phoneEditorScale = ({ isOnPhone, zoom }: Pick<PageState, 'isOnPhone' | 'zoom'>, fontSize: number): number =>
  isOnPhone ? Math.max(1, MIN_PHONE_EDITOR_FONT_PX / (fontPointsToPixels(fontSize) * zoom)) : 1;
export const zoomedEditorMargin = (scale: number, axis: EditorAxis): number =>
  scale === 1 ? 0 : axis === 'along' ? ZOOMED_EDITOR_MARGIN : ZOOMED_EDITOR_MARGIN_ACROSS / scale;
export const zoomedEditorOffset = (scale: number, axis: EditorAxis): number =>
  scale === 1 ? 0 : axis === 'along' ? ZOOMED_EDITOR_MARGIN : ZOOMED_EDITOR_MARGIN_ACROSS;
export const unzoomedEditorWidth = (width: number, scale: number, axis: EditorAxis): number =>
  scale === 1 ? width : (width - ZOOMED_EDITOR_EXTRA) / scale - 2 * zoomedEditorMargin(scale, axis);
export const zoomedEditorExtent = (length: number, below: number): { length: number; around: number } => ({
  length: length + below + ZOOMED_EDITOR_EXTRA,
  around: ZOOMED_EDITOR_MARGIN_ACROSS,
});
export const placeZoomedEditor = ({ ofCell, size, scale }: ZoomedEditorSpan, [min, max]: readonly [number, number], axis: EditorAxis): number => {
  let length = (size + 2 * zoomedEditorMargin(scale, axis)) * scale + ZOOMED_EDITOR_EXTRA;
  let offset = zoomedEditorOffset(scale, axis);
  return Math.max(min, Math.min(ofCell - offset, max - length)) + offset;
};
export const TEXT_OVERFLOW_GRIDLINE = 1;
export const CELL_TEXT_PADDING_X = 8;
export const TEXT_PADDING_BESIDE_TOTAL = 2 * CELL_PADDING_BY_DENSITY.comfortable.beside;
export const textRoomInWidth = (width: number): number => Math.max(0, width - CELL_TEXT_PADDING_X);
export const TEXT_ROOM_EXTRA = CELL_TEXT_PADDING_X - CELL_PADDING_BY_DENSITY.comfortable.beside - TEXT_OVERFLOW_GRIDLINE;
export const textRoomPastPadding = (width: number): number => textRoomInWidth(width) + TEXT_ROOM_EXTRA;
export const hasRoomForText = (width: number, fontSize: number): boolean => textRoomInWidth(width) >= fontPointsToPixels(fontSize);
export const AVERAGE_CHAR_WIDTH_EM = {
  plain: 0.64,
  bold: 0.67,
};
export const charsThatFitWidth = (width: number, font: Pick<WholeCellFormat['font'], 'bold' | 'size'>): number =>
  Math.max(0, (width - CELL_TEXT_PADDING_X) / (AVERAGE_CHAR_WIDTH_EM[font.bold ? 'bold' : 'plain'] * fontPointsToPixels(font.size)));
export const LIST_LINE_HEIGHT_RATIO = 1.4;
export const listHeightForLines = (text: string, fontSize: number): number =>
  CELL_TEXT_PADDING_X + text.length * LIST_LINE_HEIGHT_RATIO * fontPointsToPixels(fontSize);
export const EMPTY_GRID_LAYOUT: GridLayout = {
  rowCount: 0,
  columnCount: 0,
  rowEdges: createLineSizes(0, [], 0),
  columnEdges: createLineSizes(0, [], 0),
  frozenRowCount: 0,
  frozenColumnCount: 0,
  rowsOutOfSight: [],
  columnsOutOfSight: [],
};
export {
  DEFAULT_ROW_HEIGHT,
  defaultRowHeightAtDensity,
  oneLineRowHeight,
  rowHeightForLinesAtDensity,
  rowHeightForLines,
  firstLineHeight,
  MIN_FIRST_LINE_HEIGHT,
  FIRST_LINE_HEIGHT_RATIO,
  fontPointsToPixels,
  nextLineHeight,
  firstLineLeading,
  TEXT_LINE_HEIGHT_RATIO,
  GRIDLINE_THICKNESS,
  CELL_PADDING_BY_DENSITY,
  DEFAULT_CELL_DENSITY,
  ROW_HEADER_WIDTH,
} from './cell-metrics-values.ts';
