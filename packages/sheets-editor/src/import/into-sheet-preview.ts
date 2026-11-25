import { cellShownText } from '../clipboard/text-escaping.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { previewCellsUnderReading, shortenImportLabel, PREVIEW_ROW_COUNT } from './preview.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { columnLetters, spanOfIndexes } from '../model/a1-references.ts';
import { isFormulaCell } from '../model/workbook.ts';
import { tableImportRequest, countTableChangeRows } from './places.ts';
import { tableWriteHasRoom } from '../model/workbook-room.ts';
import { dataLineNumbers, readingFittingTexts, importColumnTexts } from './column-readings.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { Color, ColumnId, ReadInput, RowId, WhatATableChangesAnswer, WhatBecomesOfARow } from '@open-artifact/sheets-core';
import type {
  ImportFile,
  ImportIntoSheet,
  ImportIntoSheetChanges,
  ImportIntoSheetRow,
  ImportPreviewCell,
  ImportSheetColumnLabel,
} from '../state/initial-state.ts';
import type { ImportReading } from '../state/event-reducer.ts';
import type { ImportPreviewCellRead, ImportTablePlan } from './preview.ts';
import type { SheetDestination } from './places.ts';
/** A column of a sheet with its letters and the name in its header cell. */
export interface SheetColumnNamed extends ImportSheetColumnLabel {
  columnId: ColumnId;
}
export function previewCellOfSheetCell(reads: WorkbookReads, cellId: CellId): ImportPreviewCell {
  let cell = reads.cellOnShowIn(cellId);
  let shown = cellShownText(cell, reads.decimalSign);
  if (cell === null || shown === '')
    return {
      kind: 'blank',
    };
  // The engine writes the key only for a cell that holds an option.
  if ('dropdownOption' in cell)
    return {
      kind: 'option',
      shown: cell.dropdownOption!.label,
      color: cell.dropdownOption!.color,
    };
  let kind = cellValueOf(cell)?.kind;
  if (kind === 'number')
    return {
      kind,
      shown,
    };
  return {
    kind: kind === 'boolean' ? 'trueOrFalse' : 'text',
    shown,
  };
}
/** How the texts of a file's column would show in the sheet's cells they go into, by the cells' dropdowns and number formats. */
export function previewCellsIntoSheet(
  reading: ImportReading,
  texts: string[],
  cellIds: (CellId | null)[],
  optionsAdded: Map<string, string[]>,
  reads: WorkbookReads,
): ImportPreviewCell[] {
  let previewCells = previewCellsUnderReading(
    reading.kind === 'dropdown'
      ? {
          kind: 'text',
        }
      : reading,
    texts,
    reads,
  );
  return texts.map((text, index): ImportPreviewCell => {
    let cellId = cellIds[index] ?? null;
    let lowered = text.trim().toLowerCase();
    let dropdown = cellId === null || lowered === '' ? null : reads.dropdownOf(cellId);
    let labelsAdded = dropdown === null ? [] : (optionsAdded.get(dropdown.dropdownId) ?? []);
    let option = [
      ...(dropdown?.options ?? []),
      ...labelsAdded.map(
        (label): { label: string; color: Color } => ({
          label,
          color: {
            kind: 'none',
          },
        }),
      ),
    ].find(({ label }) => label.trim().toLowerCase() === lowered);
    if (option !== undefined)
      return {
        kind: 'option',
        shown: option.label,
        color: option.color,
      };
    let previewCell = previewCells[index];
    if (previewCell === undefined)
      return {
        kind: 'blank',
      };
    let { cell, held, hasAFormatOfItsOwn } = previewCell;
    let numberFormat = cellId === null ? DEFAULT_CELL_FORMAT.numberFormat : reads.formatOf(cellId).numberFormat;
    if (cell.kind !== 'number' || numberFormat.pattern === DEFAULT_CELL_FORMAT.numberFormat.pattern) return cell;
    if (!isNumberInput(held)) return cell;
    if (hasAFormatOfItsOwn && numberFormat.kind === 'percent') return cell;
    return {
      kind: 'number',
      shown: reads.shownWithRoomForAll(held, numberFormat.pattern) ?? cell.shown,
    };
  });
}
export function sheetColumnsOf(
  columnIds: Set<ColumnId>,
  { sheetId, headerRowId }: Pick<SheetDestination, 'sheetId' | 'headerRowId'>,
  reads: WorkbookReads,
): SheetColumnNamed[] {
  let columns = [...columnIds].flatMap((columnId) => {
    let columnIndex = reads.columnIndexOf(sheetId, columnId);
    let name = shortenImportLabel(
      cellShownText(
        reads.cellOnShowIn({
          sheetId,
          rowId: headerRowId,
          columnId,
        }),
        reads.decimalSign,
      ),
    );
    return columnIndex === null
      ? []
      : [
          {
            at: columnIndex,
            columnId,
            letters: columnLetters(columnIndex),
            name: name === '' ? null : name,
          },
        ];
  });
  columns.sort((a, b) => a.at - b.at);
  return columns.map(
    ({ columnId, letters, name }) => ({
      columnId,
      letters,
      name,
    }),
  );
}
export function dropdownOptionsAdded(
  { optionsAdded }: Pick<WhatATableChangesAnswer, 'optionsAdded'>,
  destination: SheetDestination,
  reads: WorkbookReads,
): ImportIntoSheetChanges['optionsAdded'] {
  let labelsByColumn = new Map<ColumnId, string[]>();
  for (let { column, labels } of optionsAdded) {
    let columnId = destination.intoColumns[column] ?? null;
    if (columnId !== null) labelsByColumn.set(columnId, [...(labelsByColumn.get(columnId) ?? []), ...labels]);
  }
  return sheetColumnsOf(new Set(labelsByColumn.keys()), destination, reads).flatMap(
    ({ columnId, letters, name }) => {
      let shortLabels = [...new Set(labelsByColumn.get(columnId))]
        .map(shortenImportLabel)
        .filter((label) => label !== '');
      return shortLabels.length === 0
        ? []
        : [
            {
              column: {
                letters,
                name,
              },
              labels: shortLabels,
            },
          ];
    },
  );
}
export function formulasWrittenOver(
  changedRows: Extract<WhatBecomesOfARow, { kind: 'changes' }>[],
  destination: SheetDestination,
  reads: WorkbookReads,
): ImportIntoSheetChanges['formulasWrittenOver'] {
  let { sheetId, intoColumns } = destination;
  let count = 0;
  let columnIds = new Set<ColumnId>();
  for (let { row: rowId, columns } of changedRows)
    for (let columnIndex of columns) {
      let columnId = intoColumns[columnIndex] ?? null;
      if (columnId === null) continue;
      if (
        !isFormulaCell(reads, {
          sheetId,
          rowId,
          columnId,
        })
      )
        continue;
      count += 1;
      columnIds.add(columnId);
    }
  return {
    count,
    columns: sheetColumnLabels(columnIds, destination, reads),
  };
}
/** The sheet's columns that replacing the rows would clear: filled in those rows, but not imported into. */
export function columnsClearedByReplace(rowIds: RowId[], destination: SheetDestination, reads: WorkbookReads): ImportSheetColumnLabel[] {
  let { sheetId, intoColumns } = destination;
  let rowIndexes = rowIds.flatMap((rowId) => reads.rowIndexOf(sheetId, rowId) ?? []);
  let sheetColumnCount = reads.listSheets().find((sheet) => sheet.sheetId === sheetId)?.columnCount;
  if (rowIndexes.length === 0 || sheetColumnCount === undefined) return [];
  let rowIdSet = new Set(rowIds);
  let { firstIndex, count } = spanOfIndexes(rowIndexes);
  let filledCells = reads.filledCellsIn(sheetId, {
    topRowIndex: firstIndex,
    rowCount: count,
    leftColumnIndex: 0,
    columnCount: sheetColumnCount,
  });
  let clearedColumnIds = new Set(
    filledCells.flatMap(
      ({ rowId, columnId }) => (rowIdSet.has(rowId) && !intoColumns.includes(columnId) ? [columnId] : []),
    ),
  );
  return sheetColumnLabels(clearedColumnIds, destination, reads);
}
export function previewIntoSheet(
  file: Pick<ImportFile, 'lines'>,
  plan: ImportTablePlan,
  destination: SheetDestination,
  reads: WorkbookReads,
): ImportIntoSheet | null {
  let request = tableImportRequest(destination, file, plan);
  let read = reads.whatATableChanges(request);
  if (read === null || read.kind === 'refused') return read;
  if (!tableWriteHasRoom(request, read, reads))
    return {
      kind: 'refused',
      refusal: 'tooManyCells',
    };
  let { sheetId, headerRowId, intoColumns } = destination;
  let columnsInto = intoColumns.flatMap((columnId, columnIndexInTheFile) => {
    let at = columnId === null ? null : reads.columnIndexOf(sheetId, columnId);
    return columnId === null || at === null
      ? []
      : [
          {
            columnId,
            columnIndexInTheFile,
            at,
          },
        ];
  });
  columnsInto.sort((a, b) => a.at - b.at);
  let columns = columnsInto;
  let cellIdAt = (rowId: RowId, { columnId }: { columnId: ColumnId }): CellId => ({
    sheetId,
    rowId,
    columnId,
  });
  let lastRow: { rowId: RowId; at: number } | null = null;
  let headerRowIndex = reads.rowIndexOf(sheetId, headerRowId) ?? 0;
  for (let rowId of reads.rowsAsTheyStand(sheetId).keys()) {
    let rowIndex = reads.rowIndexOf(sheetId, rowId);
    if (rowIndex !== null && rowIndex > headerRowIndex && rowIndex > (lastRow?.at ?? -1))
      lastRow = {
        rowId,
        at: rowIndex,
      };
  }
  let lastRowId = lastRow?.rowId ?? null;
  let isReplace = destination.how.kind === 'replaceRows';
  let indexedRows = read.rows.map(
    (row, index) => ({
      row,
      index,
    }),
  );
  let changedRows = isReplace
    ? []
    : indexedRows
        .flatMap(
          ({ row, index }) =>
            row.kind === 'changes'
              ? [
                  {
                    row,
                    index,
                  },
                ]
              : [],
        )
        .slice(0, MAX_CHANGED_ROWS_SHOWN);
  let addedRows = indexedRows
    .filter(({ row }) => (isReplace ? row.kind !== 'leftOut' : row.kind === 'added'))
    .slice(0, PREVIEW_ROW_COUNT - changedRows.length);
  let shownRows = [
    ...changedRows.map(
      ({ row, index }) => ({
        index,
        rowId: row.row,
        looksAs: row.row,
        changes: new Set(row.columns),
      }),
    ),
    ...addedRows.map(
      ({ row, index }) => ({
        index,
        rowId: null,
        looksAs: row.kind === 'changes' || row.kind === 'same' ? row.row : lastRowId,
        changes: null,
      }),
    ),
  ];
  let records = dataLineNumbers(file, plan);
  let labelsByDropdown = new Map(
    read.optionsAdded.map(({ dropdownId, labels }) => [dropdownId, labels]),
  );
  let previewColumns = columns.map((column) => {
    let reading: ImportReading = plan.columns[column.columnIndexInTheFile]?.reading ?? {
      kind: 'text',
    };
    let fittingReading = readingFittingTexts(reading, importColumnTexts(file, records, column.columnIndexInTheFile));
    return previewCellsIntoSheet(
      fittingReading,
      shownRows.map(({ index }) => request.rows[index]?.[column.columnIndexInTheFile] ?? ''),
      shownRows.map(({ looksAs }) => (looksAs === null ? null : cellIdAt(looksAs, column))),
      labelsByDropdown,
      reads,
    );
  });
  let rows = shownRows.map(
    ({ index, rowId, changes }, rowIndex): ImportIntoSheetRow => ({
      id: rowId ?? `row ${index} of the file`,
      kind: rowId === null ? 'added' : 'changed',
      cells: columns.map((column, columnIndex) => {
        let cell: ImportPreviewCell = previewColumns[columnIndex]?.[rowIndex] ?? {
          kind: 'blank',
        };
        if (rowId === null)
          return {
            cell,
            before: null,
          };
        let before = previewCellOfSheetCell(reads, cellIdAt(rowId, column));
        return changes.has(column.columnIndexInTheFile)
          ? {
              cell,
              before: before.kind === 'blank' ? '' : before.shown,
            }
          : {
              cell: before,
              before: null,
            };
      }),
    }),
  );
  let goneRows = read.rowsThatGo.slice(0, isReplace ? 0 : MAX_GONE_ROWS_SHOWN).map(
    (rowId): ImportIntoSheetRow => ({
      id: rowId,
      kind: 'gone',
      cells: columns.map(
        (column) => ({
          cell: previewCellOfSheetCell(reads, cellIdAt(rowId, column)),
          before: null,
        }),
      ),
    }),
  );
  let { added: addedCount, changing: changedCount, same: sameCount } = countTableChangeRows(read);
  return {
    kind: 'changes',
    columns: columns.map(
      (column) => ({
        columnIndexInTheFile: column.columnIndexInTheFile,
        name: cellShownText(reads.cellOnShowIn(cellIdAt(headerRowId, column)), reads.decimalSign),
        reading: plan.columns[column.columnIndexInTheFile]?.reading ?? {
          kind: 'text',
        },
      }),
    ),
    isReplaced: isReplace,
    columnsLeftOut: plan.columns.flatMap(
      ({ name }, columnIndex) =>
        (intoColumns[columnIndex] ?? null) === null
          ? [
              {
                columnIndexInTheFile: columnIndex,
                name,
              },
            ]
          : [],
    ),
    optionsAdded: dropdownOptionsAdded(read, destination, reads),
    columnsCleared: isReplace
      ? columnsClearedByReplace(
          read.rows.flatMap((row) => (row.kind === 'changes' ? [row.row] : [])),
          destination,
          reads,
        )
      : [],
    formulasWrittenOver: formulasWrittenOver(
      read.rows.flatMap((row) => (row.kind === 'changes' ? [row] : [])),
      destination,
      reads,
    ),
    rows: [...rows, ...goneRows],
    addedCount,
    changedCount,
    sameCount,
    goneCount: read.rowsThatGo.length,
    untouchedCount: destination.how.kind === 'addRows' ? (lastRow?.at ?? headerRowIndex) - headerRowIndex : read.rowsNotInTheTable.length,
  };
}
export const MAX_CHANGED_ROWS_SHOWN = 50;
export const MAX_GONE_ROWS_SHOWN = 10;
/** A number read from the file; a preview cell is held only under a true-or-false reading, so it is never a number. */
export const isNumberInput = (value: ImportPreviewCellRead['held']): value is Extract<ReadInput, { kind: 'number' }> =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'number';
export const sheetColumnLabels = (
  columnIds: Set<ColumnId>,
  place: Pick<SheetDestination, 'sheetId' | 'headerRowId'>,
  reads: WorkbookReads,
): ImportSheetColumnLabel[] =>
  sheetColumnsOf(columnIds, place, reads).map(
    ({ letters, name }) => ({
      letters,
      name,
    }),
  );
