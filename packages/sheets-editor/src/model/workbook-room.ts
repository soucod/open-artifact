import type { RowId, TableIntoSheet, WhatATableChangesAnswer } from '@open-artifact/sheets-core';
import type { WorkbookReads } from './workbook.ts';
import { dataLineNumbers, importTextAt } from '../import/column-readings.ts';
import { spanOfIndexes } from './a1-references.ts';
/** The lines of a file to import, each its texts by column. */
interface LinesToImport {
  lines: string[][];
}
/** How a file's lines are imported: its columns, the line of their names, and the lines left out. */
interface PlanOfLinesToImport {
  columns: { name?: string }[];
  headerLine: number | null;
  linesLeftOut: number[];
}
export function countFilledCellsToImport(table: LinesToImport, plan: PlanOfLinesToImport, leftOutColumns: readonly number[]): number {
  let keptColumns = plan.columns.flatMap(
    (columnPlan, index) => (leftOutColumns.includes(index) ? [] : [index]),
  );
  let filledCount = keptColumns.filter((keptIndex) => isFilledCellText(plan.columns[keptIndex]?.name)).length;
  for (let row of dataLineNumbers(table, plan))
    for (let columnIndex of keptColumns) if (isFilledCellText(importTextAt(table, row, columnIndex))) filledCount += 1;
  return filledCount;
}
export function tableWriteHasRoom(write: TableIntoSheet, change: WhatATableChangesAnswer, workbook: WorkbookReads): boolean {
  let { sheetId, rows, columns } = write;
  if (hasRoomForFilledCells(rows.length * columns.length, workbook)) return true;
  let replacesRows = write.how.kind === 'replaceRows';
  let replacedRowIds = new Set<RowId>();
  let addedFilledCount = 0;
  change.rows.forEach((rowChange, rowIndex) => {
    if (rowChange.kind === 'leftOut' || (rowChange.kind !== 'added' && !replacesRows)) return;
    if (rowChange.kind !== 'added') replacedRowIds.add(rowChange.row);
    columns.forEach((columnInto, columnIndex) => {
      if (columnInto !== null && isFilledCellText(rows[rowIndex]?.[columnIndex])) addedFilledCount += 1;
    });
  });
  let replacedRowIndexes = [...replacedRowIds].flatMap((rowId) => workbook.rowIndexOf(sheetId, rowId) ?? []);
  let columnCount = workbook.listSheets().find((sheet) => sheet.sheetId === sheetId)?.columnCount;
  if (replacedRowIndexes.length === 0 || columnCount === undefined) return hasRoomForFilledCells(addedFilledCount, workbook);
  let { firstIndex, count: rowCount } = spanOfIndexes(replacedRowIndexes);
  let replacedFilledCells = workbook
    .filledCellsIn(sheetId, {
      topRowIndex: firstIndex,
      rowCount,
      leftColumnIndex: 0,
      columnCount,
    })
    .filter(({ rowId }) => replacedRowIds.has(rowId));
  return hasRoomForFilledCells(addedFilledCount - replacedFilledCells.length, workbook);
}
export function makeUniqueSheetName(requestedName: string, workbook: WorkbookReads): string {
  let characters = Array.from<string>(requestedName.replaceAll(/\p{Cc}/gu, '').replaceAll(/^\p{White_Space}+|\p{White_Space}+$/gu, ''));
  let takenNames = new Set(workbook.listSheets().map(({ name }) => foldSheetNameCase(name)));
  let maxLength = workbook.longestSheetNameInCharacters();
  for (let attempt = 1; ; attempt++) {
    let suffix = attempt === 1 ? '' : ` ${attempt}`;
    let candidate = `${characters
      .slice(0, maxLength - suffix.length)
      .join('')
      .replace(/\p{White_Space}+$/u, '')}${suffix}`;
    if (!takenNames.has(foldSheetNameCase(candidate))) return candidate;
  }
}
export const isFilledCellText = (text: string | undefined): boolean => text !== undefined && text.trim() !== '';
export const hasRoomForFilledCells = (cellCount: number, workbook: WorkbookReads): boolean =>
  cellCount <= 0 || workbook.filledCellCount() + cellCount <= workbook.mostFilledCells();
export const foldSheetNameCase = (name: string): string =>
  Array.from<string, string>(name, (character) => character.toLowerCase()).join('');
