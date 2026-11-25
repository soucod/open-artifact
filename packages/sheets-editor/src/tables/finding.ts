import type { ColumnId, IdRun, RowId, SheetId, TableInIds, TableOfASheet, WhyNotRecognized } from '@open-artifact/sheets-core';
import { spanCutsOwnRowOrder, coveringRowSpanIn, ownRowOrderOfSheet } from '../model/line-ids.ts';
import { layoutOfView } from '../grid/layout.ts';
import { isInSpan, isRangeInSight } from '../grid/geometry.ts';
import type { SheetRead, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CellArea } from '../selection/model.ts';
import type { PartsOfPlacedTable, TableIndexRun } from '../selection/table-select.ts';
import type { LineIndex, OwnRowOrder } from '../model/line-ids.ts';
import type { PlacedTableOnSheet } from '../grid/sticky-headers.ts';
import type { TableToFilter } from './own-filters.ts';
/** The header rows of a table by index, and whether the engine is sure they are its header. */
export interface HeaderIndexRun extends TableIndexRun {
  isSure: boolean;
}
/** Where a table read in ids lies in the sheet: its header rows (if any), its body rows and its columns. */
export interface TableBounds {
  header: HeaderIndexRun | null;
  body: TableIndexRun;
  columns: TableIndexRun;
}
/** The area a filtered table takes, and the row its filter buttons are on. */
export interface FilteredTableArea extends CellArea {
  rowIndexOfButtons: number;
}
/** A table found on a sheet, placed in its rows and columns. */
export interface PlacedTable extends PlacedTableOnSheet, PartsOfPlacedTable {}
/** The tables found on a sheet that could be placed, those of them the engine is certain of, and those it could not place. */
export interface PlacedTables {
  all: PlacedTable[];
  certain: PlacedTable[];
  lost: TableOfASheet[];
}
/** Whether the tables of a sheet were never read, are read as they are now, or were read before the latest change. */
export type TablesReadState = 'neverRead' | 'asTheyAre' | 'behind';
interface BodyRuns {
  count: number;
  runs: IdRun[];
}
interface PlacedTablesCached {
  rows: LineIndex;
  columns: LineIndex;
  placed: PlacedTables;
}
interface TablesInSightCached {
  reads: ReadsWithTextMeasurer;
  tables: PlacedTable[];
}
export function tableBoundsOf(table: TableInIds, book: WorkbookReads): TableBounds | null {
  let positionAt = (rowId: RowId, columnId: ColumnId) =>
    book.positionOfCell({
      sheetId: table.sheetId,
      rowId,
      columnId,
    });
  let bodyStart = positionAt(table.firstRowOfBody, table.firstColumn);
  let bodyEnd = positionAt(table.lastRowOfBody, table.lastColumn);
  if (bodyStart === null || bodyEnd === null) return null;
  let body = {
    first: bodyStart.rowIndex,
    last: bodyEnd.rowIndex,
  };
  let columns = {
    first: bodyStart.columnIndex,
    last: bodyEnd.columnIndex,
  };
  if (body.first > body.last || columns.first > columns.last) return null;
  if (table.header === null)
    return {
      header: null,
      body,
      columns,
    };
  let headerStart = positionAt(table.header.firstRow, table.firstColumn);
  let headerEnd = positionAt(table.header.lastRow, table.firstColumn);
  if (headerStart === null || headerEnd === null) return null;
  return {
    header:
      headerStart.rowIndex <= headerEnd.rowIndex && headerEnd.rowIndex < body.first
        ? {
            first: headerStart.rowIndex,
            last: headerEnd.rowIndex,
            isSure: table.header.isSure,
          }
        : null,
    body,
    columns,
  };
}
export function areaOfFilteredTable(book: WorkbookReads, { table, columns }: TableToFilter): FilteredTableArea | null {
  let { sheetId, header } = table;
  let rowIndexOf = (rowId: RowId | null) => (rowId === null ? null : book.rowIndexOf(sheetId, rowId));
  let columnIndexes = [table.firstColumn, ...columns.map(({ c }) => c), table.lastColumn].flatMap(
    (columnId) => book.columnIndexOf(sheetId, columnId) ?? [],
  );
  let bodyRowIndexes = [table.firstRowOfBody, table.lastRowOfBody].flatMap((rowId) => rowIndexOf(rowId) ?? []);
  let headerFirstRow = rowIndexOf(header.firstRow);
  let headerLastRow = rowIndexOf(header.lastRow) ?? headerFirstRow;
  if (columnIndexes.length === 0 || headerLastRow === null) return null;
  let firstBodyRow = headerLastRow + 1;
  let underBodyRow = rowIndexOf(table.rowUnderTheBody);
  let lastRow = Math.max(firstBodyRow, underBodyRow === null ? Math.max(...bodyRowIndexes) : underBodyRow - 1);
  let topRow = headerFirstRow ?? headerLastRow;
  let leftColumn = Math.min(...columnIndexes);
  return {
    topRowIndex: topRow,
    leftColumnIndex: leftColumn,
    rowCount: lastRow - topRow + 1,
    columnCount: Math.max(...columnIndexes) - leftColumn + 1,
    rowIndexOfButtons: headerLastRow,
  };
}
export function hasCellsOnShowIn(sheetId: SheetId, rows: TableIndexRun, columns: TableIndexRun, book: WorkbookReads): boolean {
  for (let rowIndex = rows.first; rowIndex <= rows.last; rowIndex += 1)
    if (
      book
        .columnIndexesOnShowIn(sheetId, rowIndex)
        .some((columnIndex) => columnIndex >= columns.first && columnIndex <= columns.last)
    )
      return true;
  return false;
}
export function lastRowIndexOfTableRead(table: TableOfASheet, header: TableIndexRun, rows: LineIndex): number | null {
  let [firstPart, lastPart] = [table.body.at(0), table.body.at(-1)];
  if (firstPart === undefined || lastPart === undefined) return header.last;
  let firstBodyIndex = header.last + 1;
  let cached = bodyRunsCache.get(table);
  let stretches = cached?.runs.flatMap((run) => rows.stretchesOf(run)) ?? [];
  if (
    cached !== undefined &&
    stretches.reduce((sum, { count }) => sum + count, 0) === cached.count &&
    stretches.every(
      (stretch) => stretch.firstIndex >= firstBodyIndex && stretch.firstIndex + stretch.count <= firstBodyIndex + cached.count,
    )
  )
    return header.last + cached.count;
  let [firstIndex, lastIndex] = [rows.indexOf(firstPart.firstRow), rows.indexOf(lastPart.lastRow)];
  if (firstIndex === null || lastIndex === null || firstIndex < firstBodyIndex || lastIndex < firstIndex) return null;
  let count = lastIndex - header.last;
  bodyRunsCache.set(table, {
    count,
    runs: rows.runsIn({
      firstIndex: firstBodyIndex,
      count,
    }),
  });
  return lastIndex;
}
export function placeTableRead(
  sheetId: SheetId,
  table: TableOfASheet,
  { rows, columns: columnLines }: { rows: LineIndex; columns: LineIndex },
): PlacedTable | null {
  let rowSpanOf = ({ firstRow, lastRow }: { firstRow: RowId; lastRow: RowId }) => {
    let [first, last] = [rows.indexOf(firstRow), rows.indexOf(lastRow)];
    return first === null || last === null || first > last
      ? null
      : {
          first,
          last,
        };
  };
  let { headerRows, footerRows, firstColumn, lastColumn } = table;
  let header = rowSpanOf(headerRows);
  let columnIndexes = [...table.columns.map(({ c }) => c), lastColumn].flatMap(
    (columnId) => columnLines.indexOf(columnId) ?? [],
  );
  if (header === null || columnIndexes.length === 0) return null;
  let columns = {
    first: Math.min(...columnIndexes),
    last: Math.max(...columnIndexes),
  };
  let footer = footerRows === null ? null : rowSpanOf(footerRows);
  let lastRowIndex = footerRows === null ? lastRowIndexOfTableRead(table, header, rows) : (footer?.last ?? null);
  if (lastRowIndex === null || (footer !== null && footer.first <= header.last)) return null;
  let lastPart = table.body.at(-1);
  let lastBodyIndex = ((lastPart?.role === 'blank' ? rows.indexOf(lastPart.firstRow) : null) ?? footer?.first ?? lastRowIndex + 1) - 1;
  return {
    key: tableKeyOf(headerRows.firstRow, firstColumn),
    sheetId,
    table,
    header,
    body:
      lastBodyIndex > header.last
        ? {
            first: header.last + 1,
            last: lastBodyIndex,
          }
        : null,
    columns,
    area: areaOfRowsAndColumns(
      {
        first: header.first,
        last: lastRowIndex,
      },
      columns,
    ),
  };
}
export function placedTableAsSeen(ownOrder: OwnRowOrder, placed: PlacedTable): PlacedTable | null {
  let { header, body, columns, area, table } = placed;
  let firstBodyIndex = header.last + 1;
  let bodySpan = {
    firstIndex: firstBodyIndex,
    count: area.topRowIndex + area.rowCount - firstBodyIndex,
  };
  if (
    spanCutsOwnRowOrder(ownOrder, {
      firstIndex: header.first,
      count: firstBodyIndex - header.first,
    })
  )
    return null;
  if (!spanCutsOwnRowOrder(ownOrder, bodySpan)) return placed;
  if (table.footerRows !== null) return null;
  let seenBody = coveringRowSpanIn('seen', ownOrder, bodySpan);
  let lastSeenIndex = seenBody.firstIndex + seenBody.count - 1;
  return {
    ...placed,
    body:
      body === null
        ? null
        : {
            first: body.first,
            last: lastSeenIndex,
          },
    area: areaOfRowsAndColumns(
      {
        first: header.first,
        last: lastSeenIndex,
      },
      columns,
    ),
  };
}
export function placedTablesOfSheet({ tablesRead }: Pick<PageState, 'tablesRead'>, reads: WorkbookReads, sheetId: SheetId): PlacedTables {
  let [tables, lines]: [TableOfASheet[] | undefined, SheetRead | null] = [tablesRead.get(sheetId)?.tables, reads.linesOf(sheetId)];
  if (tables === undefined || lines === null) return NO_TABLES_PLACED;
  let cached = placedTablesCache.get(tables);
  if (cached?.rows === lines.rows && cached.columns === lines.columns) return cached.placed;
  let ownOrder = ownRowOrderOfSheet(reads, sheetId);
  let placedOrNot = tables.map((table) => {
    if (ownOrder === null) return placeTableRead(sheetId, table, lines);
    let placed = placeTableRead(sheetId, table, {
      ...lines,
      rows: ownOrder.stored,
    });
    return placed === null ? null : placedTableAsSeen(ownOrder, placed);
  });
  let all = placedOrNot.filter((placed) => placed !== null);
  let placedTables = {
    all,
    certain: all.filter(({ table }) => isTableCertain(table)),
    lost: tables.filter((table, at) => placedOrNot[at] === null),
  };
  placedTablesCache.set(tables, {
    rows: lines.rows,
    columns: lines.columns,
    placed: placedTables,
  });
  return placedTables;
}
export function tablesInSightOf(view: PageState, reads: ReadsWithTextMeasurer): PlacedTable[] {
  let cached = tablesInSightCache.get(view);
  if (cached?.reads === reads) return cached.tables;
  let [layout, activeCell] = [layoutOfView(view, reads), reads.positionOfCell(view.activeCell)];
  let holdsActiveCell = (area: CellArea) =>
    activeCell !== null &&
    isInSpan(activeCell.rowIndex, area.topRowIndex, area.rowCount) &&
    isInSpan(activeCell.columnIndex, area.leftColumnIndex, area.columnCount);
  let tables = placedTablesOfSheet(view, reads, view.sheetId).all.filter(
    ({ area }) => holdsActiveCell(area) || isRangeInSight(area, view, layout, view),
  );
  tablesInSightCache.set(view, {
    reads,
    tables,
  });
  return tables;
}
export function tablesReadState({ tablesRead }: Pick<PageState, 'tablesRead'>, sheetId: SheetId): TablesReadState {
  let read = tablesRead.get(sheetId);
  if (read === undefined) return 'neverRead';
  return read.isLatest ? 'asTheyAre' : 'behind';
}
export const rowRangeOfTable = ({ header, body }: Pick<TableBounds, 'header' | 'body'>): TableIndexRun => ({
  first: (header ?? body).first,
  last: body.last,
});
export const indexRangesOverlap = (range: TableIndexRun, otherRange: TableIndexRun): boolean =>
  range.first <= otherRange.last && otherRange.first <= range.last;
export const NO_TABLES_PLACED: PlacedTables = {
  all: [],
  certain: [],
  lost: [],
};
export const isTableCertain = ({ basis }: Pick<TableOfASheet, 'basis'>): boolean => basis.kind !== 'assumed';
export const hasTableHeadings = ({ basis }: Pick<TableOfASheet, 'basis'>): boolean =>
  basis.kind !== 'assumed' || basis.whyNotRecognized !== 'noHeadings';
export const PLAIN_LIST_REASONS = new Set<WhyNotRecognized>([
  'oneColumn',
  'fewerThanTwoRecords',
  'labelsPastABlankColumn',
  'mayBeLabelsAndValues',
  'nothingProvesTheHeader',
]);
export const isPlainListTable = ({ basis }: Pick<TableOfASheet, 'basis'>): boolean =>
  basis.kind !== 'assumed' || PLAIN_LIST_REASONS.has(basis.whyNotRecognized);
export const tableEdgesOf = ({
  headerRows,
  firstColumn,
  lastColumn,
  footerRows,
}: TableOfASheet): Pick<TableOfASheet, 'headerRows' | 'firstColumn' | 'lastColumn' | 'footerRows'> => ({
  headerRows,
  firstColumn,
  lastColumn,
  footerRows,
});
export const tableKeyOf = (firstRow: RowId, firstColumn: ColumnId): string => `${firstRow} ${firstColumn}`;
export const areaOfRowsAndColumns = (rows: TableIndexRun, columns: TableIndexRun): CellArea => ({
  topRowIndex: rows.first,
  rowCount: rows.last - rows.first + 1,
  leftColumnIndex: columns.first,
  columnCount: columns.last - columns.first + 1,
});
export const bodyRunsCache = new WeakMap<TableOfASheet, BodyRuns>();
export const placedTablesCache = new WeakMap<TableOfASheet[], PlacedTablesCached>();
export const tablesInSightCache = new WeakMap<PageState, TablesInSightCached>();
