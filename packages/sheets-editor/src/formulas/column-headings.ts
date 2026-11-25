import type { SheetId, ColumnId } from '@open-artifact/sheets-core';
import type { CellArea } from '../selection/model.ts';
import type { CellId, SheetRead } from '../model/workbook.ts';
import type { HeadedColumn } from './from-words/plain-table.ts';
import { areaOfReference } from '../model/reference-areas.ts';
import { cellValueOf, cellPlainText } from '../model/cell-values.ts';
import { headingsInFirstRow } from '../chips/dropdown-editor.ts';
import { readsAsStored } from '../model/workbook.ts';
import { findFormulaReferences } from './references.ts';
import { areaToA1AsStored } from './from-words/where.ts';
import type { WorkbookReads } from '../model/workbook.ts';
/** A column with a heading in row 1, and where it is. */
export interface ColumnWithHeading {
  columnId: ColumnId;
  heading: string;
  columnIndex: number;
}
/**
 * The columns of a sheet headed in its first rows: the columns filled in row 1, those of them with a heading,
 * the index of the first row under the headings, and the index of the row after the last one formulas of the
 * heading rows read.
 */
export interface HeadedColumnsOfSheet {
  inRow1: number[];
  headed: ColumnWithHeading[];
  top: number;
  end: number;
}
/**
 * The last row of its own column a cell's formula reads, `null` where it reads no other rows there (or
 * reads only its own), and `Infinity` where that cannot be told.
 */
export function lastRowReadInOwnColumn(reads: WorkbookReads, cellId: CellId): number | null {
  let { sheetId, columnId } = cellId;
  let input = reads.cellOf(cellId)?.input;
  let position = reads.positionOfCell(cellId);
  if (input?.kind !== 'formula' || position === null) return null;
  let sameSheetReferences = input.formula.references.filter((reference) => reference.sheetId === sheetId);
  let rowsInOwnColumn = sameSheetReferences.flatMap(
    (reference) => (reference.kind === 'cell' && reference.cell.c === columnId ? [reference.cell.r] : []),
  );
  if (new Set(rowsInOwnColumn).size > 1) return Number.POSITIVE_INFINITY;
  let rangeAreas = sameSheetReferences.flatMap(
    (reference) => (reference.kind === 'cell' ? [] : [areaOfReference(reads, reference)]),
  );
  let areas = rangeAreas.flatMap((area) => area ?? []);
  if (areas.length < rangeAreas.length) return Number.POSITIVE_INFINITY;
  let areasOverColumn = areas.filter(
    ({ leftColumnIndex, columnCount }) =>
      leftColumnIndex <= position.columnIndex && position.columnIndex < leftColumnIndex + columnCount,
  );
  if (areasOverColumn.length > 0) return Math.max(...areasOverColumn.map(lastRowIndexOfArea));
  return areas.every((area) => area.topRowIndex <= position.rowIndex && position.rowIndex <= lastRowIndexOfArea(area))
    ? null
    : Number.POSITIVE_INFINITY;
}
export function findHeadedColumns(reads: WorkbookReads, sheetId: SheetId): HeadedColumnsOfSheet {
  let columnsInRow1 = reads.columnIndexesOnShowIn(sheetId, 0);
  let filledCellsInRow = (rowIndex: number) =>
    columnsInRow1
      .flatMap((columnIndex) => reads.cellIdAt(sheetId, rowIndex, columnIndex) ?? [])
      .filter((cellId) => reads.cellOnShowIn(cellId) !== null);
  let rowsReadByFormulas = (rowIndex: number) => {
    let cellIds = filledCellsInRow(rowIndex);
    if (cellIds.length === 0) return null;
    return cellIds.flatMap((cellId) => lastRowReadInOwnColumn(reads, cellId) ?? []);
  };
  let holdsNonText = (rowIndex: number) =>
    filledCellsInRow(rowIndex).some((cellId) => {
      let kind = reads.cellOf(cellId)?.input.kind;
      return kind !== 'text' && kind !== 'richText' && kind !== 'formula';
    });
  let mergedRowCounts = columnsInRow1.map(
    (columnIndex) =>
      reads.mergedAreaAt(sheetId, {
        rowIndex: 0,
        columnIndex,
      })?.rowCount ?? 1,
  );
  let headingRowCount = Math.max(1, ...mergedRowCounts);
  let [firstColumn = 0, lastColumn = firstColumn] = [columnsInRow1[0], columnsInRow1.at(-1)];
  let isBesideRow1 = (columnIndex: number) =>
    columnIndex >= firstColumn - 1 && columnIndex <= lastColumn + 1 && !columnsInRow1.includes(columnIndex);
  let holdsNumberFormula = (columnIndex: number) => {
    let cellId = reads.cellIdAt(sheetId, headingRowCount, columnIndex);
    return cellId !== null && reads.cellOf(cellId)?.input.kind === 'formula' && cellValueOf(reads.cellOnShowIn(cellId))?.kind !== 'text';
  };
  if (
    reads
      .columnIndexesOnShowIn(sheetId, headingRowCount)
      .some((columnIndex) => isBesideRow1(columnIndex) && !holdsNumberFormula(columnIndex))
  )
    return NO_HEADED_COLUMNS;
  let end = headingRowCount;
  while (rowsReadByFormulas(end)?.length === 0) end += 1;
  for (let row = end, rowsRead = rowsReadByFormulas(end); rowsRead !== null; rowsRead = rowsReadByFormulas(++row))
    if (rowsRead.length === 0 || rowsRead.some((lastRowRead) => lastRowRead >= end) || holdsNonText(row)) return NO_HEADED_COLUMNS;
  let { rowCount = 0, columnCount = 0 } = reads.listSheets().find((sheet) => sheet.sheetId === sheetId) ?? {};
  let headed = Array.from(
    headingsInFirstRow(reads, sheetId, {
      topRowIndex: 0,
      leftColumnIndex: 0,
      rowCount,
      columnCount,
    }),
    ([columnIndex, { text }]): ColumnWithHeading[] => {
      let columnId = reads.cellIdAt(sheetId, 0, columnIndex)?.columnId;
      let mergedColumns =
        reads.mergedAreaAt(sheetId, {
          rowIndex: 0,
          columnIndex,
        })?.columnCount ?? 1;
      if (columnId === undefined || mergedColumns > 1) return [];
      return [
        {
          columnId,
          heading: text.trim(),
          columnIndex,
        },
      ];
    },
  ).flat();
  return {
    inRow1: columnsInRow1,
    headed,
    top: headingRowCount,
    end,
  };
}
export function headedColumnsOfSheet(reads: WorkbookReads, sheetId: SheetId): HeadedColumnsOfSheet {
  let sheet = reads.sheetAsItStands(sheetId);
  let cached = sheet === null ? undefined : headedColumnsCache.get(sheet);
  if (sheet === null || cached !== undefined) return cached ?? NO_HEADED_COLUMNS;
  let headed = findHeadedColumns(reads, sheetId);
  headedColumnsCache.set(sheet, headed);
  return headed;
}
/** Whether the word reads as a cell's address (`b2`) and is written in a text of the sheet's first cells. */
export function isAddressWordInSheet(word: string, sheetId: SheetId, reads: WorkbookReads): boolean {
  let sheet = reads.sheetAsItStands(sheetId);
  if (sheet === null) return false;
  let addressWords = addressWordsCache.get(sheet);
  if (addressWords === undefined) {
    let { rowCount = 0, columnCount = 0 } = reads.listSheets().find((summary) => summary.sheetId === sheetId) ?? {};
    let scanned = {
      topRowIndex: 0,
      leftColumnIndex: 0,
      rowCount: Math.min(rowCount, Math.ceil(MAX_CELLS_SCANNED_FOR_ADDRESS_WORDS / Math.max(columnCount, 1))),
      columnCount,
    };
    addressWords = new Set(
      reads.cellsOnShowIn(sheetId, scanned).flatMap((cellId) => {
        let value = cellValueOf(reads.cellOnShowIn(cellId));
        if (value?.kind !== 'text') return [];
        return value.value
          .toLowerCase()
          .split(NON_WORD_CHARACTERS_PATTERN)
          .filter((textWord) => ADDRESS_WORD_PATTERN.test(textWord));
      }),
    );
    addressWordsCache.set(sheet, addressWords);
  }
  return addressWords.has(word.replaceAll('$', '').toLowerCase());
}
/** The headed columns above the cell whose heading has a word starting with what is typed, and their cells under the heading. */
export function headedColumnsMatchingWord(typed: string, cellId: CellId, readsSeen: WorkbookReads): HeadedColumn[] {
  let reads = readsAsStored(readsSeen);
  let position = reads.positionOfCell(cellId);
  if (position === null || TRUE_OR_FALSE_PATTERN.test(typed) || findFormulaReferences(typed, reads.decimalSign).references.length > 0) return [];
  let { inRow1, headed, top: headingTop, end } = headedColumnsOfSheet(reads, cellId.sheetId);
  let ownArea: CellArea = reads.spillOver(cellId)?.area ??
    reads.mergedAreaAt(cellId.sheetId, position) ?? {
      topRowIndex: position.rowIndex,
      leftColumnIndex: position.columnIndex,
      rowCount: 1,
      columnCount: 1,
    };
  let isOwnColumn = (columnIndex: number) =>
    columnIndex >= ownArea.leftColumnIndex && columnIndex < ownArea.leftColumnIndex + ownArea.columnCount;
  let isRowFreeBeside = inRow1.every((columnIndex) => {
    let rowCellId = reads.cellIdAt(cellId.sheetId, ownArea.topRowIndex, columnIndex);
    let rowCell = rowCellId === null || isOwnColumn(columnIndex) ? null : reads.cellOnShowIn(rowCellId);
    return rowCell === null || ('input' in rowCell && cellPlainText(rowCell) !== null);
  });
  let isOwnRowEnd = inRow1.some(isOwnColumn) && ownArea.topRowIndex + ownArea.rowCount === end && isRowFreeBeside;
  let bottom = isOwnRowEnd ? ownArea.topRowIndex : end;
  let isInsideColumn = ownArea.topRowIndex < bottom && ownArea.topRowIndex + ownArea.rowCount > headingTop;
  let typedLower = typed.toLowerCase();
  return headed
    .filter(
      ({ heading, columnIndex }) =>
        headingTop < bottom &&
        (isOwnColumn(columnIndex) ? !isInsideColumn : !isOwnRowEnd) &&
        heading
          .toLowerCase()
          .split(NON_WORD_CHARACTERS_PATTERN)
          .some((word) => word.startsWith(typedLower)),
    )
    .map(({ columnId, heading, columnIndex }) => {
      let area = {
        topRowIndex: headingTop,
        leftColumnIndex: columnIndex,
        rowCount: bottom - headingTop,
        columnCount: 1,
      };
      return {
        columnId,
        heading,
        cells: areaToA1AsStored(area, null),
      };
    });
}
export const NO_HEADED_COLUMNS: HeadedColumnsOfSheet = {
  inRow1: [],
  headed: [],
  top: 0,
  end: 0,
};
export const lastRowIndexOfArea = ({ topRowIndex, rowCount }: CellArea): number => topRowIndex + rowCount - 1;
export const headedColumnsCache = new WeakMap<SheetRead, HeadedColumnsOfSheet>();
export const NON_WORD_CHARACTERS_PATTERN = /[^\p{L}\p{N}]+/u;
export const ADDRESS_WORD_PATTERN = /^[a-z]{1,3}[1-9]\d*$/;
export const MAX_CELLS_SCANNED_FOR_ADDRESS_WORDS = 5000;
export const addressWordsCache = new WeakMap<SheetRead, Set<string>>();
export const TRUE_OR_FALSE_PATTERN = /^(?:true|false)$/i;
