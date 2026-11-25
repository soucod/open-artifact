import type { CellArea } from '../selection/model.ts';
import type { LineSpan, OwnRowOrder } from './line-ids.ts';
import { wholeRowSpanIn, rowIndexIn, rowStretchesIn, coveringRowSpanIn, rowSpansIn } from './line-ids.ts';
/** How many rows and columns a sheet has. */
export interface SheetSize {
  rowCount: number;
  columnCount: number;
}
/** A sheet's size and its own order of rows, which the references typed in it are read against. */
export interface SheetSizeAndOrder extends SheetSize {
  ownRowOrder: OwnRowOrder | null;
}
/** The first and last labels of a run of rows or columns. */
export interface LabelEnds {
  first: string;
  last: string;
}
export function columnLetters(columnIndex: number): string {
  let letters = '';
  for (let remaining = columnIndex + 1; remaining > 0; remaining = Math.floor((remaining - 1) / LETTERS_IN_ALPHABET))
    letters = String.fromCharCode(CHAR_CODE_OF_A + ((remaining - 1) % LETTERS_IN_ALPHABET)) + letters;
  return letters;
}
export function rowLabelEnds(area: CellArea, ownRowOrder: OwnRowOrder | null): LabelEnds {
  let span = wholeRowSpanIn('stored', ownRowOrder, rowSpanOfArea(area));
  return span === null
    ? {
        first: `${rowNumberAsStored(area.topRowIndex, ownRowOrder)}`,
        last: `${rowNumberAsStored(area.topRowIndex + area.rowCount - 1, ownRowOrder)}`,
      }
    : {
        first: `${span.firstIndex + 1}`,
        last: `${span.firstIndex + span.count}`,
      };
}
export function areaToA1(area: CellArea): string {
  let [rowEnds, columnEnds] = [rowLabelEnds(area, null), columnLabelEnds(area)];
  let start = `${columnEnds.first}${rowEnds.first}`;
  let end = `${columnEnds.last}${rowEnds.last}`;
  return start === end ? start : `${start}:${end}`;
}
export function wholeAreaToA1AsStored(area: CellArea, ownRowOrder: OwnRowOrder | null): string | null {
  let span = wholeRowSpanIn('stored', ownRowOrder, rowSpanOfArea(area));
  return span === null ? null : areaToA1(areaWithRowSpan(area, span));
}
export function parseA1Area(reference: string, sheetSize: SheetSize): CellArea | null {
  let match = /^\$?([a-z]{1,3})\$?(\d*)(?::\$?([a-z]{1,3})\$?(\d*))?$/i.exec(reference.trim());
  if (match === null) return null;
  let [, firstColumn = '', firstRow = '', lastColumn = firstColumn, lastRow = firstRow] = match;
  if ((firstRow === '') !== (lastRow === '') || (firstRow === '' && match[3] === undefined)) return null;
  let columnIndexes = [columnIndexFromLetters(firstColumn), columnIndexFromLetters(lastColumn)];
  let rowIndexes = firstRow === '' ? [0, sheetSize.rowCount - 1] : [Number(firstRow) - 1, Number(lastRow) - 1];
  let [leftColumn, rightColumn] = [Math.min(...columnIndexes), Math.max(...columnIndexes)];
  let [topRow, bottomRow] = [Math.min(...rowIndexes), Math.max(...rowIndexes)];
  if (topRow < 0 || bottomRow >= sheetSize.rowCount || rightColumn >= sheetSize.columnCount) return null;
  return {
    topRowIndex: topRow,
    leftColumnIndex: leftColumn,
    rowCount: bottomRow - topRow + 1,
    columnCount: rightColumn - leftColumn + 1,
  };
}
export function parseA1AreaAsSeen(reference: string, sheetLayout: SheetSizeAndOrder): CellArea | null {
  let [area = null, ...rest] = parseA1AreasAsSeen(reference, sheetLayout) ?? [];
  return rest.length > 0 ? null : area;
}
export function parseA1AreasAsSeen(reference: string, sheetLayout: SheetSizeAndOrder): CellArea[] | null {
  let area = parseA1Area(reference, sheetLayout);
  return area === null ? null : areasAsSeen(area, sheetLayout.ownRowOrder);
}
export function isA1CellInSheet(reference: string, { rowCount, columnCount }: SheetSize): boolean {
  let [, letters = '', digits = ''] = A1_CELL_PATTERN.exec(reference) ?? [];
  let [columnIndex, rowNumber] = [columnIndexFromLetters(letters), Number(digits)];
  return columnIndex >= 0 && columnIndex < columnCount && rowNumber >= 1 && rowNumber <= rowCount;
}
export function spanOfIndexes(indexes: Iterable<number>): LineSpan {
  let [lowest, highest]: [number, number] = [1 / 0, -1 / 0];
  for (let index of indexes) {
    if (index < lowest) lowest = index;
    if (index > highest) highest = index;
  }
  return {
    firstIndex: lowest,
    count: highest - lowest + 1,
  };
}
export const CHAR_CODE_OF_A = 65;
export const LETTERS_IN_ALPHABET = 26;
export const rowNumberAsStored = (index: number, ownRowOrder: OwnRowOrder | null): number => rowIndexIn('stored', ownRowOrder, index) + 1;
export const rowSpanOfArea = ({ topRowIndex, rowCount }: Pick<CellArea, 'topRowIndex' | 'rowCount'>): LineSpan => ({
  firstIndex: topRowIndex,
  count: rowCount,
});
export const areaWithRowSpan = <A extends CellArea>(area: A, { firstIndex, count }: LineSpan): A => ({
  ...area,
  topRowIndex: firstIndex,
  rowCount: count,
});
export const isAreaSplitWhenStored = (area: CellArea, ownRowOrder: OwnRowOrder | null): boolean =>
  ownRowOrder !== null && rowStretchesIn('stored', ownRowOrder, rowSpanOfArea(area)).length > 1;
export const columnLabelEnds = ({ leftColumnIndex, columnCount }: Pick<CellArea, 'leftColumnIndex' | 'columnCount'>): LabelEnds => ({
  first: columnLetters(leftColumnIndex),
  last: columnLetters(leftColumnIndex + columnCount - 1),
});
export const areaAsSeen = (area: CellArea, ownRowOrder: OwnRowOrder | null): CellArea =>
  areaWithRowSpan(area, coveringRowSpanIn('seen', ownRowOrder, rowSpanOfArea(area)));
export const areasAsSeen = (area: CellArea, ownRowOrder: OwnRowOrder | null): CellArea[] =>
  rowSpansIn('seen', ownRowOrder, rowSpanOfArea(area)).map((span) => areaWithRowSpan(area, span));
export const columnIndexFromLetters = (letters: string): number =>
  Array.from<string>(letters.toUpperCase()).reduce((index: number, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
export const A1_CELL_PATTERN = /^\$?([A-Za-z]{1,3})\$?(0|[1-9]\d*)$/;
export const normalizeA1Reference = (reference: string): string => reference.replaceAll('$', '').toUpperCase();
