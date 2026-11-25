import { cellShownText } from '../clipboard/text-escaping.ts';
import { truncateToCleanText, NEW_SHEET_DESTINATION } from './import-basics.ts';
import { readingFittingTexts, dataLineNumbers, importColumnTexts, importTextAt } from './column-readings.ts';
import { scrambledIndex, SHARED_ROWS_KEPT, SHARED_ROWS_COMPARED, readingAsSheetHolds } from './plan-without-agent.ts';
import { cellValueOf } from '../model/cell-values.ts';
import type { SheetRead, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { ColumnId, RowId, SheetId, TableIntoSheet, TextsAre, WhatATableChangesAnswer, WhatBecomesOfARow } from '@open-artifact/sheets-core';
import type { ImportDestination, ImportFile, ImportHow, ImportPlace, ImportPlan } from '../state/initial-state.ts';
import type { ImportReading } from '../state/event-reducer.ts';
import type { ImportTablePlan } from './preview.ts';
import type { RowHeldInSheet } from './plan-without-agent.ts';
/** An import into a table of a sheet. */
export type SheetDestination = Extract<ImportDestination, { kind: 'sheet' }>;
/** The best table of a sheet for a file, before its key columns are tried. */
export type ImportPlaceFound = Pick<ImportPlace, 'table' | 'intoColumns' | 'matchedCount'>;
interface ImportRowsCached {
  /** The line numbers the rows were taken from, joined. */
  lines: string;
  rows: string[][];
}
interface SharedRowsCached {
  sheet: SheetRead | null;
  /** What the rows were matched with, as JSON. */
  from: string;
  rowsShared: { rowId: RowId; at: number }[];
  /** Readings as the sheet holds, by JSON of the column and its reading. */
  readings: Map<string, ImportReading | null>;
}
export function lastRowIndexInUse(reads: WorkbookReads, sheetId: SheetId) {
  let lastRowIndex = -1;
  for (let rowId of reads.rowsAsTheyStand(sheetId).keys()) lastRowIndex = Math.max(lastRowIndex, reads.rowIndexOf(sheetId, rowId) ?? -1);
  return lastRowIndex;
}
export function tableUnderHeaderRow(
  reads: WorkbookReads,
  { sheetId, name: sheetName }: Pick<SheetSummary, 'sheetId' | 'name'>,
  headerRowIndex: number,
  lastRowIndex: number,
): ImportPlace['table'] | null {
  let shownTextAt = (rowIndex: number, columnIndex: number) => {
    let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
    return cellId === null ? '' : cellShownText(reads.cellOnShowIn(cellId), reads.decimalSign);
  };
  let headings = reads.columnIndexesOnShowIn(sheetId, headerRowIndex).flatMap((columnIndex) => {
    let cellId = reads.cellIdAt(sheetId, headerRowIndex, columnIndex);
    let heading = truncateToCleanText(shownTextAt(headerRowIndex, columnIndex), MAX_PLACE_HEADING_LENGTH);
    return cellId === null || heading === ''
      ? []
      : [
          {
            columnIndex,
            rowId: cellId.rowId,
            columnId: cellId.columnId,
            name: heading,
          },
        ];
  });
  let [firstHeading] = headings;
  if (firstHeading === undefined || headings.length > MAX_PLACE_COLUMNS) return null;
  let recordCount = lastRowIndex - headerRowIndex;
  return {
    sheetId,
    name: sheetName,
    headerRowId: firstHeading.rowId,
    columns: headings.map(
      ({ columnId, name }) => ({
        columnId,
        name,
      }),
    ),
    recordCount,
    firstRecords: Array.from(
      {
        length: Math.min(recordCount, PLACE_FIRST_RECORDS),
      },
      (_, recordIndex) =>
        headings.map(
          ({ columnIndex }) =>
            truncateToCleanText(shownTextAt(headerRowIndex + 1 + recordIndex, columnIndex), PLACE_RECORD_CELL_LENGTH),
        ),
    ),
  };
}
export function matchHeadingsToColumns(headings: string[], columns: ImportPlace['table']['columns']) {
  let usedColumnIds = new Set<ColumnId>();
  return headings.map((heading): ColumnId | null => {
    let normalized = normalizeHeading(heading);
    let match =
      normalized === ''
        ? undefined
        : columns.find(
            ({ columnId, name }) => !usedColumnIds.has(columnId) && normalizeHeading(name) === normalized,
          );
    if (match === undefined) return null;
    usedColumnIds.add(match.columnId);
    return match.columnId;
  });
}
export function textsAreForReading(reading: ImportReading, texts: string[]): TextsAre {
  let fittingReading = readingFittingTexts(reading, texts);
  if (fittingReading.kind === 'trueOrFalse')
    return {
      kind: 'trueOrFalse',
    };
  if (fittingReading.kind === 'dropdown')
    return {
      kind: 'read',
      reading: {
        kind: 'text',
      },
    };
  return {
    kind: 'read',
    reading: fittingReading,
  };
}
export function importRowsOf(file: Pick<ImportFile, 'lines'>, lineNumbers: number[]) {
  let key = lineNumbers.join();
  let cached = importRowsCache.get(file.lines);
  if (cached?.lines === key) return cached.rows;
  let rows = lineNumbers.map((line) => [...(file.lines[line - 1] ?? [])]);
  importRowsCache.set(file.lines, {
    lines: key,
    rows,
  });
  return rows;
}
export function tableImportRequest(
  { sheetId, headerRowId, intoColumns, how }: SheetDestination,
  file: Pick<ImportFile, 'lines'>,
  plan: ImportTablePlan,
): TableIntoSheet {
  let records = dataLineNumbers(file, plan);
  return {
    sheetId,
    headerRow: headerRowId,
    rows: importRowsOf(file, records),
    columns: plan.columns.map(({ reading }, columnIndex) => {
      let column = intoColumns[columnIndex] ?? null;
      return column === null
        ? null
        : {
            column,
            textsAre: textsAreForReading(reading, importColumnTexts(file, records, columnIndex)),
          };
    }),
    how:
      how.kind === 'mergeByKey'
        ? {
            kind: 'mergeByKey',
            keyColumn: how.keyColumnIndex,
          }
        : how,
  };
}
export function countTableChangeRows(read: Pick<WhatATableChangesAnswer, 'rows'>) {
  let counts: Record<WhatBecomesOfARow['kind'], number> = {
    added: 0,
    changes: 0,
    same: 0,
    leftOut: 0,
  };
  for (let { kind } of read.rows) counts[kind] += 1;
  let { added, changes, same, leftOut } = counts;
  return {
    added,
    changing: changes,
    same,
    leftOut,
  };
}
export function areAllDistinctTexts(texts: string[]) {
  let distinct = new Set(texts.map((text) => text.trim().toLowerCase()));
  return texts.length > 0 && distinct.size === texts.length && !distinct.has('');
}
/** The columns of the file that could be the key to merge by: read as text or whole numbers, going into the sheet, all different. */
export function keyColumnCandidates(intoColumns: (ColumnId | null)[], file: Pick<ImportFile, 'lines'>, plan: ImportTablePlan) {
  let records = dataLineNumbers(file, plan);
  return plan.columns.flatMap(
    ({ reading }, columnIndex) =>
      (intoColumns[columnIndex] ?? null) !== null && canReadingBeKey(reading) && areAllDistinctTexts(importColumnTexts(file, records, columnIndex))
        ? [columnIndex]
        : [],
  );
}
export function keyMatchesOfPlace(
  place: Pick<ImportPlace, 'table' | 'intoColumns'>,
  keyColumnIndexes: number[],
  file: Pick<ImportFile, 'lines'>,
  plan: ImportTablePlan,
  reads: Pick<WorkbookReads, 'whatATableChanges'>,
): ImportPlace['keys'] | null {
  let { sheetId, headerRowId } = place.table;
  let changesByKey = keyColumnIndexes.map(
    (keyColumnIndex) => ({
      keyColumnIndex,
      read: reads.whatATableChanges(
        tableImportRequest(
          {
            kind: 'sheet',
            sheetId,
            headerRowId,
            intoColumns: place.intoColumns,
            how: {
              kind: 'mergeByKey',
              keyColumnIndex,
            },
          },
          file,
          plan,
        ),
      ),
    }),
  );
  if (changesByKey.some(({ read }) => read === null)) return null;
  return changesByKey.flatMap(({ keyColumnIndex, read }) => {
    if (read?.kind !== 'whatATableChanges') return [];
    let { added, changing, same } = countTableChangeRows(read);
    return [
      {
        keyColumnIndex,
        changing,
        same,
        added,
        notInTheFile: read.rowsNotInTheTable.length,
      },
    ];
  });
}
export function bestPlaceInSheet(reads: WorkbookReads, sheet: Pick<SheetSummary, 'sheetId' | 'name' | 'frozenRowCount'>, headings: string[]) {
  let lastRowIndex = lastRowIndexInUse(reads, sheet.sheetId);
  let headerRowIndexes =
    sheet.frozenRowCount > 0
      ? [sheet.frozenRowCount - 1]
      : Array.from(
          {
            length: HEADER_ROWS_TRIED,
          },
          (_, index) => index,
        );
  let best: ImportPlaceFound | null = null;
  for (let headerRowIndex of headerRowIndexes) {
    let table = headerRowIndex > lastRowIndex ? null : tableUnderHeaderRow(reads, sheet, headerRowIndex, lastRowIndex);
    if (table === null) continue;
    let intoColumns = matchHeadingsToColumns(headings, table.columns);
    let matchedCount = intoColumns.filter((columnId) => columnId !== null).length;
    if (
      best === null
        ? matchedCount > 0
        : matchedCount > best.matchedCount || (matchedCount === best.matchedCount && table.columns.length > best.table.columns.length)
    )
      best = {
        table,
        intoColumns,
        matchedCount,
      };
  }
  return best;
}
/** The tables of the workbook's sheets the file could go into, likeliest first; null when the workbook cannot tell yet. */
export function findImportPlaces(file: ImportFile, plan: ImportTablePlan, reads: WorkbookReads): ImportPlace[] | null {
  let headings = fileHeadingsOf(file, plan);
  let bestPlaces = reads
    .listSheets()
    .slice(0, MAX_SHEETS_FOR_PLACES)
    .flatMap((sheet) => bestPlaceInSheet(reads, sheet, headings) ?? []);
  bestPlaces.sort((a, b) => b.matchedCount - a.matchedCount);
  let topPlaces = bestPlaces.slice(0, MAX_PLACES).map((place, rank) => {
    let keyColumns = keyColumnCandidates(place.intoColumns, file, plan);
    let keyColumnsTried = !isLargeImportFile(file) ? MAX_KEY_COLUMNS_TRIED : rank === 0 ? 1 : 0;
    return {
      place,
      likeliestKeyColumnIndex: keyColumns[0] ?? null,
      keys: keyMatchesOfPlace(place, keyColumns.slice(0, keyColumnsTried), file, plan, reads),
    };
  });
  let placesWithKeys = topPlaces.flatMap(
    ({ place, likeliestKeyColumnIndex, keys }) =>
      keys === null
        ? []
        : [
            {
              ...place,
              likeliestKeyColumnIndex,
              keys,
            },
          ],
  );
  return placesWithKeys.length < topPlaces.length ? null : placesWithKeys;
}
export function likeliestImportDestination(places: ImportPlace[], fileColumnCount: number): ImportDestination {
  const [best, runnerUp] = places;
  if (best === undefined || best.matchedCount < fileColumnCount) return NEW_SHEET_DESTINATION;
  if (runnerUp !== undefined && runnerUp.matchedCount === best.matchedCount) return NEW_SHEET_DESTINATION;
  if (best.matchedCount * 2 < best.table.columns.length) return NEW_SHEET_DESTINATION;
  let likeliestKey = best.keys.find(
    ({ keyColumnIndex }) => keyColumnIndex === best.likeliestKeyColumnIndex,
  );
  if (best.likeliestKeyColumnIndex !== null && likeliestKey === undefined) return NEW_SHEET_DESTINATION;
  let { sheetId, headerRowId } = best.table;
  return {
    kind: 'sheet',
    sheetId,
    headerRowId,
    intoColumns: best.intoColumns,
    how:
      likeliestKey !== undefined && likeliestKey.changing + likeliestKey.same > 0
        ? {
            kind: 'mergeByKey',
            keyColumnIndex: likeliestKey.keyColumnIndex,
          }
        : {
            kind: 'addRows',
          },
  };
}
/** Readings of the file's columns, by column index, that read it as the sheet already holds the rows they share by the key column. */
export function readingsAsTheSheetHolds(
  file: Pick<ImportFile, 'lines'>,
  plan: ImportTablePlan,
  place: SheetDestination,
  keyColumnIndex: number,
  columnsLeftOut: Set<number>,
  reads: WorkbookReads,
): Record<number, ImportReading> | null {
  let { sheetId, headerRowId, intoColumns } = place;
  let sheet = reads.sheetAsItStands(sheetId);
  let from = JSON.stringify([
    [plan.headerLine, plan.linesLeftOut, headerRowId],
    [keyColumnIndex, intoColumns[keyColumnIndex], plan.columns[keyColumnIndex]?.reading],
    reads.locale,
  ]);
  let cached = sharedRowsCache.get(file.lines);
  if (cached?.sheet !== sheet || cached.from !== from) {
    let how: ImportHow = {
      kind: 'mergeByKey',
      keyColumnIndex,
    };
    let changes = reads.whatATableChanges(
      tableImportRequest(
        {
          ...place,
          how,
        },
        file,
        plan,
      ),
    );
    if (changes === null) return null;
    if (changes.kind === 'refused') return {};
    let rowsShared = changes.rows
      .flatMap(
        (row, at) =>
          row.kind === 'changes' || row.kind === 'same'
            ? [
                {
                  rowId: row.row,
                  at,
                },
              ]
            : [],
      )
      .toSorted((first, second) => scrambledIndex(first.at) - scrambledIndex(second.at))
      .slice(0, SHARED_ROWS_KEPT);
    cached = {
      sheet,
      from,
      rowsShared,
      readings: new Map(),
    };
    sharedRowsCache.set(file.lines, cached);
  }
  let { rowsShared, readings } = cached;
  let records = dataLineNumbers(file, plan);
  let readingOfColumn = (columnIndex: number, reading: ImportReading) => {
    let columnId = intoColumns[columnIndex] ?? null;
    if (columnId === null) return null;
    let shared: RowHeldInSheet[] = [];
    for (let { rowId, at } of rowsShared) {
      if (shared.length === SHARED_ROWS_COMPARED) break;
      let line = records[at];
      if (line === undefined) continue;
      let text = importTextAt(file, line, columnIndex);
      let cell = {
        sheetId,
        rowId,
        columnId,
      };
      const held = cellValueOf(reads.cellOnShowIn(cell));
      const isHeld = held?.kind === 'number' || (held?.kind === 'text' && held.value.trim() !== '');
      if (text.trim() !== '' && isHeld && reads.dropdownOf(cell) === null)
        shared.push({
          text,
          held: held.value,
          line,
        });
    }
    return readingAsSheetHolds(file, records, columnIndex, reading, shared, reads);
  };
  return Object.fromEntries(
    plan.columns.flatMap(({ reading }, columnIndex): [number, ImportReading][] => {
      if (columnsLeftOut.has(columnIndex) || columnIndex === keyColumnIndex) return [];
      let key = JSON.stringify([columnIndex, intoColumns[columnIndex], reading]);
      let held = readings.has(key) ? (readings.get(key) ?? null) : readingOfColumn(columnIndex, reading);
      readings.set(key, held);
      return held === null ? [] : [[columnIndex, held]];
    }),
  );
}
export const MAX_SHEETS_FOR_PLACES = 30;
export const HEADER_ROWS_TRIED = 5;
export const MAX_PLACE_COLUMNS = 60;
export const PLACE_FIRST_RECORDS = 3;
export const MAX_PLACE_HEADING_LENGTH = 1000;
export const PLACE_RECORD_CELL_LENGTH = 40;
export const MAX_PLACES = 3;
export const MAX_KEY_COLUMNS_TRIED = 2;
export const normalizeHeading = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export const fileHeadingsOf = (file: Pick<ImportFile, 'lines'>, { headerLine, columns }: Pick<ImportPlan, 'headerLine' | 'columns'>) =>
  columns.map((_, columnIndex) => (headerLine === null ? '' : importTextAt(file, headerLine, columnIndex)));
export const importRowsCache = new WeakMap<string[][], ImportRowsCached>();
export const isLargeImportFile = ({ lines, columnCount }: Pick<ImportFile, 'lines' | 'columnCount'>) => lines.length * columnCount > 1e5;
export const canReadingBeKey = (reading: ImportReading) =>
  reading.kind === 'text' || (reading.kind === 'number' && reading.decimalPlaces === 0);
export const sharedRowsCache = new WeakMap<string[][], SharedRowsCached>();
