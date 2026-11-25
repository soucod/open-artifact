import type { ColumnId, RowId, SheetId } from '@open-artifact/sheets-core';
import { cellTextForCsv, fullDateBehindMonthDayTime, escapeFirstCsvCellText } from '../clipboard/text-escaping.ts';
import { numberFormatOfCell, fullShownTextOfCell } from '../model/workbook.ts';
import { csvFileName } from './file-names.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import type { CsvFile } from './file-export.ts';
/** The shown texts of a sheet's cells, by row index and then by column index. */
export type CsvTextsByRow = Map<number, Map<number, string>>;
export function csvLineOf(fields: readonly string[]): string {
  let startsWithSign = CSV_LEADING_SIGN_PATTERN.test(fields[0] ?? '');
  let line = fields
    .map((field, index) => (startsWithSign && index > 0 && field !== '' ? quoteCsvField(field) : csvField(field)))
    .join(',');
  return line === '' ? '""' : line;
}
export function shownTextsForCsv(reads: WorkbookReads, sheetId: SheetId, area: CellArea): CsvTextsByRow {
  let textsByRow: CsvTextsByRow = new Map();
  let rowIndexById = new Map<RowId, number>();
  let columnIndexById = new Map<ColumnId, number>();
  for (let cell of reads.cellsOnShowIn(sheetId, area)) {
    let rowIndex = rowIndexById.get(cell.rowId);
    let columnIndex = columnIndexById.get(cell.columnId);
    if (rowIndex === undefined || columnIndex === undefined) {
      let position = reads.positionOfCell(cell);
      if (position === null) continue;
      ({ rowIndex, columnIndex } = position);
      rowIndexById.set(cell.rowId, rowIndex);
      columnIndexById.set(cell.columnId, columnIndex);
    }
    let cellOnShow = reads.cellOnShowIn(cell);
    let shownText: string = cellTextForCsv(
      cellOnShow,
      fullDateBehindMonthDayTime(cellOnShow, () => numberFormatOfCell(reads, cell).pattern) ?? fullShownTextOfCell(reads, cell),
      reads.decimalSign,
    );
    if (shownText === '') continue;
    let rowTexts = textsByRow.get(rowIndex) ?? new Map<number, string>();
    let isFirstCell = rowIndex === 0 && columnIndex === 0;
    textsByRow.set(rowIndex, rowTexts.set(columnIndex, isFirstCell ? escapeFirstCsvCellText(shownText) : shownText));
  }
  return textsByRow;
}
export function blankMergedCellsForCsv(textsByRow: CsvTextsByRow, mergedArea: CellArea): void {
  let { topRowIndex, leftColumnIndex, rowCount, columnCount } = mergedArea;
  let rowIndexes =
    rowCount < textsByRow.size
      ? Array.from(
          {
            length: rowCount,
          },
          (_, offset) => topRowIndex + offset,
        )
      : [...textsByRow.keys()].filter((rowIndex) => rowIndex >= topRowIndex && rowIndex < topRowIndex + rowCount);
  for (let rowIndex of rowIndexes) {
    let rowTexts = textsByRow.get(rowIndex);
    for (let columnIndex of rowTexts?.keys() ?? [])
      if (
        columnIndex >= leftColumnIndex &&
        columnIndex < leftColumnIndex + columnCount &&
        (rowIndex !== topRowIndex || columnIndex !== leftColumnIndex)
      )
        rowTexts?.delete(columnIndex);
  }
}
export function csvFileOfSheet(reads: WorkbookReads, sheetId: SheetId, workbookTitle: string | null): CsvFile | null {
  let sheet = reads.listSheets().find((summary) => summary.sheetId === sheetId);
  if (sheet === undefined) throw Error('the workbook has no such sheet');
  let { name, rowCount, columnCount } = sheet;
  let wholeSheet = {
    topRowIndex: 0,
    leftColumnIndex: 0,
    rowCount,
    columnCount,
  };
  let textsByRow = shownTextsForCsv(reads, sheetId, wholeSheet);
  for (let mergedArea of reads.mergedAreasIn(sheetId, wholeSheet)) blankMergedCellsForCsv(textsByRow, mergedArea);
  let lineCount = 1;
  let fieldCount = 1;
  for (let [rowIndex, rowTexts] of textsByRow) {
    if (rowTexts.size > 0) lineCount = Math.max(lineCount, rowIndex + 1);
    for (let columnIndex of rowTexts.keys()) fieldCount = Math.max(fieldCount, columnIndex + 1);
  }
  if (lineCount * fieldCount > MAX_CSV_CELLS) return null;
  let blankLine = csvLineOf(
    Array.from(
      {
        length: fieldCount,
      },
      () => '',
    ),
  );
  let lines = Array.from(
    {
      length: lineCount,
    },
    (_line, rowIndex) => {
      let rowTexts = textsByRow.get(rowIndex);
      if (rowTexts === undefined || rowTexts.size === 0) return blankLine;
      return csvLineOf(
        Array.from(
          {
            length: fieldCount,
          },
          (_field, columnIndex) => rowTexts.get(columnIndex) ?? '',
        ),

      );
    },
  );
  return {
    filename: csvFileName(workbookTitle, name),
    csv: `${lines.join(`\r
`)}\r
`,
  };
}
export const quoteCsvField = (field: string): string => `"${field.replaceAll('"', '""')}"`;
export const CSV_NEEDS_QUOTES_PATTERN = /[",;\t\r\n]/;
export const csvField = (field: string): string =>
 (CSV_NEEDS_QUOTES_PATTERN.test(field) ? quoteCsvField(field) : field);
export const CSV_LEADING_SIGN_PATTERN = /^ *[+-]/;
export const MAX_CSV_CELLS = 5000000;
