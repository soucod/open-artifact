import type { ColumnOfATable, RowId, SheetId, TableWithColumns } from '@open-artifact/sheets-core';
import type { ColumnHolds, TableHolds } from '../state/initial-state.ts';
import type { CellArea } from '../selection/model.ts';
import type { RuleWordsNotRead } from './rule-formats.ts';
import { areaOfReference } from '../model/reference-areas.ts';
import { cellValueOf } from '../model/cell-values.ts';
import type { CellId, CellOnShow, SheetRead, WorkbookReads } from '../model/workbook.ts';
/** Rows of a table that are not records (totals and the like), and what was seen while looking. */
export interface RowsNotRecords {
  rows: number[];
  isOneEmpty: boolean;
  /** The table is long, and its rows away from both ends were not looked at. */
  isMiddleUnread: boolean;
}
/** A cell on show in a row, at its column. */
interface CellShownInRow {
  columnIndex: number;
  shown: CellOnShow;
}
/** A number shown in a row, at its column. */
interface NumberInRow {
  columnIndex: number;
  number: number;
}
export function columnHoldsOf(reads: WorkbookReads, { table }: Pick<TableWithColumns, 'table'>, { c, name, kind }: ColumnOfATable): ColumnHolds {
  let found = reads.valuesOfFilteredColumn(table, null, c);
  let valuesOfColumn = found?.kind === 'valuesOfFilteredColumn' ? found : null;
  let cellAt = (rowId: RowId): CellId => ({
    sheetId: table.sheetId,
    rowId,
    columnId: c,
  });
  let [firstValue] = valuesOfColumn?.values.filter(({ value }) => value !== null) ?? [];
  let dropdown = firstValue === undefined ? null : reads.dropdownOf(cellAt(firstValue.firstInRow));
  return {
    c,
    name,
    kind,
    values: (valuesOfColumn?.values ?? []).map(({ value, firstInRow, records }) => {
      let cellInput = reads.cellOf(cellAt(firstInRow))?.input;
      let users = cellInput?.kind === 'users' ? cellInput.users : cellInput?.kind === 'user' ? [cellInput] : [];
      return {
        value,
        records,
        userIds: users.map(({ userId }) => userId),
      };
    }),
    areMoreValuesLeftOut: valuesOfColumn?.areMoreLeftOut ?? true,
    optionsOfDropdown: dropdown?.options.map(({ label }) => label) ?? null,
  };
}
export function isTooMuchToRead(holds: TableHolds): boolean {
  let cached = tooMuchToReadCache.get(holds);
  if (cached !== undefined) return cached;
  let [optionCount, characterCount] = [0, 0];
  for (let { name, values, optionsOfDropdown } of holds.columns) {
    optionCount += optionsOfDropdown?.length ?? 0;
    characterCount += name?.length ?? 0;
    for (let option of optionsOfDropdown ?? []) characterCount += option.length;
    for (let { value } of values) characterCount += value?.kind === 'text' ? value.value.length : 0;
  }
  let isTooMuch = optionCount > MOST_DROPDOWN_OPTIONS_HELD || characterCount > MOST_TEXT_CHARACTERS_HELD;
  tooMuchToReadCache.set(holds, isTooMuch);
  return isTooMuch;
}
export function tableHoldsOf(reads: WorkbookReads, table: TableWithColumns): TableHolds {
  let sheet = reads.sheetAsItStands(table.table.sheetId);
  let key = JSON.stringify(table.table);
  let cached = sheet === null ? undefined : tableHoldsCache.get(sheet)?.get(key);
  if (cached !== undefined) return cached;
  let holds: TableHolds = {
    records: 0,
    columns: table.columns.map((column) => columnHoldsOf(reads, table, column)),
  };
  let isComplete = holds.columns.every(
    ({ values, areMoreValuesLeftOut }) => values.length > 0 || !areMoreValuesLeftOut,
  );
  if (sheet !== null && isComplete) tableHoldsCache.set(sheet, (tableHoldsCache.get(sheet) ?? new Map<string, TableHolds>()).set(key, holds));
  return holds;
}
export function tableAtCellCached(reads: WorkbookReads, cell: CellId): TableWithColumns | null {
  let sheet = reads.sheetAsItStands(cell.sheetId);
  let key = cell.rowId + ' ' + cell.columnId;
  let table = (sheet === null ? undefined : tableAtCellCache.get(sheet)?.get(key)) ?? reads.tableAtCell(cell);
  if (sheet !== null && table !== null) tableAtCellCache.set(sheet, (tableAtCellCache.get(sheet) ?? new Map<string, TableWithColumns | 'nowhere'>()).set(key, table));
  return table === 'nowhere' ? null : table;
}
export function rowsThatAreNotRecords(
  reads: WorkbookReads,
  sheetId: SheetId,
  { topRowIndex, rowCount, leftColumnIndex, columnCount }: CellArea,
): RowsNotRecords {
  let rows: number[] = [];
  let isOneEmpty = false;
  let sumsByColumn = new Map<number, { sum: number; count: number }>();
  let rowsAtEachEnd = Math.max(Math.floor(MOST_CELLS_SCANNED_FOR_TOTALS / 2 / columnCount), 1);
  for (let index = 0; index < rowCount; index += 1) {
    if (index === rowsAtEachEnd && rowCount > 2 * rowsAtEachEnd) {
      index = rowCount - rowsAtEachEnd;
      sumsByColumn.clear();
    }
    let rowIndex = topRowIndex + index;
    let cells = reads
      .columnIndexesOnShowIn(sheetId, rowIndex)
      .filter((columnIndex) => columnIndex >= leftColumnIndex && columnIndex < leftColumnIndex + columnCount)
      .flatMap((columnIndex): CellShownInRow[] => {
        let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
        let shown = cellId === null ? null : reads.cellOnShowIn(cellId);
        return shown === null
          ? []
          : [
              {
                columnIndex,
                shown,
              },
            ];
      });
    isOneEmpty ||= cells.length === 0;
    let sumsReferencedRows = ({ columnIndex, shown }: CellShownInRow): boolean => {
      if (!('input' in shown) || shown.input.kind !== 'formula') return false;
      let spans = shown.input.formula.references.slice(0, MOST_REFERENCES_READ).flatMap((reference) => {
        let area = reference.sheetId === sheetId ? areaOfReference(reads, reference) : null;
        let coversColumn = area !== null && area.leftColumnIndex <= columnIndex && columnIndex < area.leftColumnIndex + area.columnCount;
        let from = Math.max(area?.topRowIndex ?? 0, topRowIndex);
        let to = Math.min((area?.topRowIndex ?? 0) + (area?.rowCount ?? 0), topRowIndex + rowCount);
        return coversColumn && from < to
          ? [
              {
                from,
                to,
              },
            ]
          : [];
      });
      spans.sort((span, other) => span.from - other.from);
      let [rowsCovered, coveredTo] = [0, topRowIndex];
      for (let { from, to } of spans) {
        rowsCovered += Math.max(to - Math.max(from, coveredTo), 0);
        coveredTo = Math.max(coveredTo, to);
      }
      return rowsCovered >= 2;
    };
    let saysTotal = cells.slice(0, 2).some(({ shown }) => {
      let value = cellValueOf(shown);
      return value?.kind === 'text' && value.value.length <= MOST_NAME_CHARACTERS && totalRowLabelPattern.test(value.value);
    });
    let numbers = cells.flatMap(({ columnIndex, shown }): NumberInRow[] => {
      let value = cellValueOf(shown);
      return value?.kind === 'number' && value.value !== 0
        ? [
            {
              columnIndex,
              number: value.value,
            },
          ]
        : [];
    });
    let isSumOfRowsAbove = ({ columnIndex, number }: NumberInRow): boolean => {
      let { sum, count } = sumsByColumn.get(columnIndex) ?? {
        sum: 0,
        count: 0,
      };
      return count >= LEAST_ROWS_FOR_TOTAL && Math.abs(number - sum) <= 0.000000001 * Math.abs(sum);
    };
    let sumCount = numbers.filter(isSumOfRowsAbove).length;
    let isTotalRow = sumCount > 1 && sumCount * 2 > numbers.length;
    if (cells.length <= 1 || saysTotal || isTotalRow || cells.some(sumsReferencedRows)) {
      rows.push(rowIndex);
      continue;
    }
    for (let { columnIndex, number } of numbers) {
      let { sum, count } = sumsByColumn.get(columnIndex) ?? {
        sum: 0,
        count: 0,
      };
      sumsByColumn.set(columnIndex, {
        sum: sum + number,
        count: count + 1,
      });
    }
  }
  return {
    rows,
    isOneEmpty,
    isMiddleUnread: rowCount > 2 * rowsAtEachEnd,
  };
}
export const RULE_WORDS_NOT_READ: RuleWordsNotRead = {
  kind: 'notRead',
  isOnItsWay: false,
};
export const tableHoldsCache = new WeakMap<SheetRead, Map<string, TableHolds>>();
export const MOST_DROPDOWN_OPTIONS_HELD = 500;
export const MOST_TEXT_CHARACTERS_HELD = 500000;
export const tooMuchToReadCache = new WeakMap<TableHolds, boolean>();
export const tableAtCellCache = new WeakMap<SheetRead, Map<string, TableWithColumns | 'nowhere'>>();
export const MOST_CELLS_SCANNED_FOR_TOTALS = 1e5;
export const MOST_REFERENCES_READ = 100;
export const MOST_NAME_CHARACTERS = 100;
export const LEAST_ROWS_FOR_TOTAL = 3;
export const MOST_RULE_RANGES = 40;
export const totalRowLabelPattern =
  /^\s*(?:(?:grand\s+|sub-?\s*)?totals?|average|avg)\b|\b(?:(?:sub-?\s*)?totals?|average|avg|mean|roll-?\s?up)\s*[.:]?\s*$|^\s*(?:sum|mean|median|max|min|maximum|minimum|overall|grand|count|all|net|ytd|tot|Σ)\s*[.:]?\s*$/i;
