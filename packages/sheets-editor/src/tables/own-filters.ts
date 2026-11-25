import type {
  CellTableRead,
  ColumnId,
  ColumnOfATable,
  EngineCellTable,
  Filter,
  FilteredRowsAnswer,
  IdRun,
  RowId,
  SheetId,
  SortDirection,
  TableInIds,
  ValueAskedFor,
  CellCondition,
} from '@open-artifact/sheets-core';
import { areaOfFilteredTable, indexRangesOverlap } from './finding.ts';
import type { FilteredTableArea } from './finding.ts';
import { mergedAreaOrCellOf, selectionPositionsOf } from '../selection/model.ts';
import type { CellArea } from '../selection/model.ts';
import type { TableIndexRun } from '../selection/table-select.ts';
import { areasOverlap } from '../model/workbook.ts';
import { isInSpan } from '../grid/geometry.ts';
import { booleanText } from '../model/cell-text.ts';
import { showNumberInColumnFormat, describeColumnCondition } from '../format/conditional/descriptions.ts';
import type { RulePlace } from '../format/conditional/descriptions.ts';
import { isWholeDayRange } from './own-filter-conditions.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { ownFilterRecordsArea, dropUnusedOwnFilter } from './own-filter-actions.ts';
import { namedViewAskedKey } from './named-view-model.ts';
import type { NamedViewInHand } from './named-view-model.ts';
import { findSheetById } from '../grid/layout.ts';
import { sortHoldsOfColumn } from './sort.ts';
import { rowIdsOutOfView, keepFilterClausesWhereColumns, mapFilterColumns } from './filter-model.ts';
import type { FilterTerm } from './filter-model.ts';
import { withoutFrozenRowKeys, keepSelectionOnShownRows, setRowsHiddenByOwnFilters } from './filtered-rows.ts';
import { columnLetters } from '../model/a1-references.ts';
import { columnLabelOf } from '../format/conditional/editor-view.ts';
import { spanCutsOwnRowOrder } from '../model/line-ids.ts';
import type { LineIndex, LineSpan } from '../model/line-ids.ts';
import type { CellId, CellTablesRead, GroupOnGrid, WorkbookReads } from '../model/workbook.ts';
import type { Notice, PageState, SortHoldsOfColumn } from '../state/initial-state.ts';
import type { PageEffect, PageTransition } from '../state/transitions.ts';
import type { PageEvent, SortKeyOfColumn } from '../state/event-reducer.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { RuleColumn, RuleOperand, RuleTest } from '../messages/conditional-format.ts';
/** A table as a filter reads it: its header is always there. */
export interface FilterTableInIds extends TableInIds {
  header: NonNullable<TableInIds['header']>;
}
/** A table to filter, with the cell table it was read from: as declared, and where it is now. */
export interface FilterTable {
  cellTableId: string | null;
  cellTable: EngineCellTable;
  liveCellTable: EngineCellTable | null;
  table: FilterTableInIds;
  columns: ColumnOfATable[];
}
/** All a filter needs of a table to place it: the table and its columns. */
export type TableToFilter = Pick<FilterTable, 'table' | 'columns'>;
/** A column a sort goes by, as the page tells it. */
export interface SaidOfSortColumn {
  column: RuleColumn;
  direction: SortDirection;
  holds: SortHoldsOfColumn | null;
}
/** The page's own sort of a table: the columns it goes by and the rows in their sorted order. */
export interface OwnFilterSort {
  by: SortKeyOfColumn[];
  said: SaidOfSortColumn[];
  /** `null` until the rows in sorted order are read. */
  rows: IdRun[] | null;
  isRefused: boolean;
}
/** Why the rows a filter lets through could not be had now. */
export type WhyRowsNotNow = 'tookTooLong' | 'dayIsNotKnown' | 'fault';
/** A filter whose rows could not be had yet, why, and how often they were asked for. */
export interface OwnFilterUnanswered {
  why: WhyRowsNotNow;
  tries: number;
}
/** A test of a filter line, as the page tells it. */
export type SaidOfFilterItem =
  | { kind: 'test'; test: RuleTest }
  | { kind: 'isOneOf' | 'isNoneOf'; column: RuleColumn; values: (string | null)[] };
/** A filter of the page's own, on a table: what it asks, the rows it lets through, and the sort of the table. */
export interface OwnFilter extends FilterTable {
  key: string;
  filter: Filter | null;
  /** `null` while no filter is asked, or its rows are not had yet. */
  rows: FilteredRowsAnswer | null;
  sort: OwnFilterSort | null;
  namedViewInHand: NamedViewInHand | null;
  unanswered: OwnFilterUnanswered | null;
  /** The lines of the filter, as the page tells them. */
  lines: SaidOfFilterItem[][];
  /** The look stamp of the workbook the filter was last looked at with. */
  lookedAtAsOf: number;
}
/** An own filter as it stood before a try, with the other filters of its sheet and the rows they hid. */
export interface HeldOwnFilterSnapshot {
  held: OwnFilter;
  others: OwnFilter[];
  rowsOutOfView: Set<RowId>;
}
/** How many records a filter lets through, of all the table holds. */
export interface RecordCountsOfFilter {
  inView: number;
  all: number;
}
/** What came of asking the engine for the rows a filter lets through. */
export type FilteredRowsAsked =
  | { kind: 'rows'; filter: Filter; rows: FilteredRowsAnswer }
  | { kind: 'tableIsGone' }
  | { kind: 'notNow'; why: WhyRowsNotNow }
  | { kind: 'nothingLeftToAsk' };
/** A filter looked at again: its table as found now, what it asks, and the rows it lets through. */
export interface OwnFilterAnswered {
  kind: 'answered';
  found: FilterTable;
  filter: Filter | null;
  rows: FilteredRowsAnswer | null;
}
/** What came of looking at a filter again. */
export type OwnFilterLook =
  | OwnFilterAnswered
  | { kind: 'tableIsGone' }
  | { kind: 'notNow'; readonly why: WhyRowsNotNow | 'hasNoRecord' | null };
/** The page's own sort last chosen for a table, and the sort it had before, to undo it. */
export interface OwnSortChoice {
  tableKey: string;
  by: SortKeyOfColumn[];
  before: SortKeyOfColumn[] | null;
}
/** Columns of a table moved inside it: a cell of the table, and each column that went to another. */
export interface ColumnsWentTo {
  ofTableAt: CellId;
  wentTo: [ColumnId, ColumnId][];
}
/** How filters are looked at again: put in force, only looked at, or put in force when a row of an area is missed. */
export type OwnFiltersLookAgain = 'apply' | 'look' | { applyIfARowIsMissedAmong: CellArea };
type StateOfOwnFilters = Pick<PageState, 'ownFilters'>;
type StateOfFiltersDrawn = Pick<PageState, 'ownFilters' | 'ownFilterList' | 'rowsAskedFor'>;
type LookStampOfState = Pick<PageState, 'workbookChangeCount' | 'formulasWorkedOutCount'>;
export function filterTableOfCellTable(found: CellTableRead | 'tookTooLong' | 'nowhere' | null): FilterTable | null {
  if (found === null || typeof found === 'string' || found.table === null) return null;
  const {
    cellTableId,
    cellTable,
    liveCellTable,
    table: { table, columns },
  } = found;
  const { header } = table;
  if (header === null) throw Error('sheets-core read a cell table with no header');
  return {
    cellTableId,
    cellTable,
    liveCellTable,
    table: {
      ...table,
      header,
    },
    columns,
  };
}
export function isOwnFilterKeyUnused(state: StateOfOwnFilters, key: string): boolean {
  const ownFilter = ownFilterByKey(state, key);
  return ownFilter !== null && isOwnFilterUnused(ownFilter);
}
export function ownFilterNotDrawnYet(state: PageState): OwnFilter | null {
  const key = ownFilterKeyNotDrawnYet(state);
  return ownFiltersOfSheet(state, state.sheetId).find(({ key: filterKey }) => filterKey === key) ?? null;
}
export function drawnOwnFiltersOfSheet(state: StateOfFiltersDrawn, sheetId: SheetId): OwnFilter[] {
  const ownFilters = ownFiltersOfSheet(state, sheetId);
  const keyNotDrawn = ownFilterKeyNotDrawnYet(state);
  if (keyNotDrawn === null || ownFilters.every(({ key }) => key !== keyNotDrawn)) return ownFilters;
  const cached = drawnOwnFiltersCache.get(ownFilters);
  if (cached?.butFor === keyNotDrawn) return cached.drawn;
  const drawn = ownFilters.filter(({ key }) => key !== keyNotDrawn);
  drawnOwnFiltersCache.set(ownFilters, {
    butFor: keyNotDrawn,
    drawn,
  });
  return drawn;
}
export function ownFiltersWithoutKey(
  ownFilters: Map<SheetId, OwnFilter[]>,
  key: string | null,
  evenIfItAsks: boolean,
): Map<SheetId, OwnFilter[]> {
  if (key === null) return ownFilters;
  const cached = ownFiltersWithoutKeyCache.get(ownFilters);
  if (cached?.key === key && cached.evenIfItAsks === evenIfItAsks) return cached.kept;
  const kept = new Map(
    Array.from(
      ownFilters,
      ([sheetId, filters]): [SheetId, OwnFilter[]] => [
        sheetId,
        filters.filter((ownFilter) => ownFilter.key !== key || (!evenIfItAsks && !isOwnFilterUnused(ownFilter))),
      ],
    ),
  );
  ownFiltersWithoutKeyCache.set(ownFilters, {
    key,
    evenIfItAsks,
    kept,
  });
  return kept;
}
export function ownFilterTableArea(reads: WorkbookReads, ownFilter: FilterTable): FilteredTableArea | null {
  const area = areaOfFilteredTable(reads, ownFilter);
  const { footerRows } = ownFilter.liveCellTable;
  if (area === null || footerRows === null) return area;
  const lastFooterRowIndex = reads.rowIndexOf(ownFilter.table.sheetId, footerRows.lastRow);
  return lastFooterRowIndex === null
    ? area
    : {
        ...area,
        rowCount: Math.max(area.rowCount, lastFooterRowIndex - area.topRowIndex + 1),
      };
}
export function ownFilterAtCell(state: StateOfOwnFilters, reads: WorkbookReads, cell: CellId): OwnFilter | null {
  const cellArea = mergedAreaOrCellOf(reads, cell);
  if (cellArea === null) return null;
  return (
    ownFiltersOfSheet(state, cell.sheetId).find((ownFilter) => {
      const area = ownFilterTableArea(reads, ownFilter);
      return area !== null && areasOverlap(area, cellArea);
    }) ?? null
  );
}
export function rowBelowOwnFilterButtonsAt(state: StateOfOwnFilters, reads: WorkbookReads, cell: CellId): number {
  const position = reads.positionOfCell(cell);
  if (position === null) return 0;
  const rowsBelowButtons = ownFiltersOfSheet(state, cell.sheetId).flatMap((ownFilter) => {
    const area = areaOfFilteredTable(reads, ownFilter);
    return area !== null && position.rowIndex >= area.topRowIndex && isInSpan(position.columnIndex, area.leftColumnIndex, area.columnCount)
      ? area.rowIndexOfButtons + 1
      : [];
  });
  return Math.max(0, ...rowsBelowButtons);
}
export function filterValueText(place: RulePlace, column: ColumnId, value: ValueAskedFor): string {
  switch (value.kind) {
    case 'text':
    case 'error':
      return value.value;
    case 'boolean':
      return booleanText(value.value);
    case 'number':
      return showNumberInColumnFormat(place, value.value, column);
  }
}
export function asDayEqualityTest(test: RuleTest, condition: CellCondition): RuleTest {
  const { condition: testCondition } = test;
  if (testCondition.kind !== 'numberIsBetween' && testCondition.kind !== 'numberIsNotBetween') return test;
  if (!test.isOfDates || !isWholeDayRange(condition)) return test;
  const comparison = testCondition.kind === 'numberIsBetween' ? 'equalTo' : 'notEqualTo';
  return {
    ...test,
    condition: {
      kind: 'numberIs',
      comparison,
      operand: testCondition.oneEnd,
    },
  };
}
export function startAtFirstNumberRow(place: RulePlace, column: ColumnId): RulePlace {
  const { reads, sheetId, topRowIndex } = place;
  const columnIndex = reads.columnIndexOf(sheetId, column);
  if (topRowIndex === null || columnIndex === null) return place;
  for (let offset = 0; offset < NUMBER_ROW_SEARCH_LIMIT; offset += 1) {
    const cellId = reads.cellIdAt(sheetId, topRowIndex + offset, columnIndex);
    if (cellId === null) return place;
    if (cellValueOf(reads.cellOnShowIn(cellId))?.kind === 'number')
      return {
        ...place,
        topRowIndex: topRowIndex + offset,
      };
  }
  return place;
}
export function describeFilterItem(place: RulePlace, ownFilter: TableToFilter, { c: column, asked }: FilterTerm): SaidOfFilterItem {
  const columnLabel = columnLabelOfFilterTable(place.reads, ownFilter, column);
  if (asked.kind === 'meets') {
    const test = describeColumnCondition(startAtFirstNumberRow(place, column), column, columnLabel, asked.condition);
    const { condition } = asked;
    if (condition.kind === 'numberIs' && condition.operand.kind === 'sameRowInColumn' && test.condition.kind === 'numberIs') {
      const operand: RuleOperand = {
        kind: 'column',
        column: columnLabelOfFilterTable(place.reads, ownFilter, condition.operand.c),
      };
      return {
        kind: 'test',
        test: {
          ...test,
          condition: {
            ...test.condition,
            operand,
          },
        },
      };
    }
    return {
      kind: 'test',
      test: asDayEqualityTest(test, condition),
    };
  }
  const isOneOf = asked.kind === 'isOneOf';
  const [firstValue, ...otherValues] = asked.values;
  if (otherValues.length > 0)
    return {
      kind: asked.kind,
      column: columnLabel,
      values: asked.values.map((value) => (value === null ? null : filterValueText(place, column, value))),
    };
  const valueText = firstValue === null ? null : filterValueText(place, column, firstValue);
  return {
    kind: 'test',
    test: {
      column: columnLabel,
      isOfDates: false,
      condition:
        valueText === null
          ? {
              kind: isOneOf ? 'isBlank' : 'isNotBlank',
            }
          : {
              kind: isOneOf ? 'textIs' : 'textIsNot',
              text: valueText,
            },
    },
  };
}
export function describeFilterLines(reads: WorkbookReads, ownFilter: TableToFilter, filter: Filter): SaidOfFilterItem[][] {
  const { sheetId, firstRowOfBody } = ownFilter.table;
  const place = {
    reads,
    sheetId,
    topRowIndex: reads.rowIndexOf(sheetId, firstRowOfBody),
  };
  return filter.allOf.map(
    ({ anyOf: [firstItem, ...otherItems] }) => [
      describeFilterItem(place, ownFilter, firstItem),
      ...otherItems.map((item) => describeFilterItem(place, ownFilter, item)),
    ],
  );
}
export function canSortOwnFilterTable(reads: WorkbookReads, ownFilter: TableToFilter): boolean {
  const { sheetId } = ownFilter.table;
  const [recordsArea, sheet] = [ownFilterRecordsArea(reads, ownFilter), findSheetById(reads, sheetId)];
  if (recordsArea === null || sheet === undefined) return false;
  const rows = {
    firstIndex: recordsArea.topRowIndex,
    count: recordsArea.rowCount,
  };
  const rowsAcross = {
    ...recordsArea,
    leftColumnIndex: 0,
    columnCount: sheet.columnCount,
  };
  const isTallAndInRows = (area: CellArea | undefined) => area !== undefined && area.rowCount > 1 && areasOverlap(area, rowsAcross);
  return (
    rows.count > 1 &&
    !isInSpan(sheet.frozenRowCount - 1, rows.firstIndex, rows.count) &&
    !cutsRowGroup(rows, sheet.rowGroups) &&
    !reads.mergedAreasIn(sheetId, rowsAcross).some(isTallAndInRows) &&
    !reads.cellsWithSpillIn(sheetId).some(
      ({ r: rowId, c: columnId }) =>
        isTallAndInRows(
          reads.spillOver({
            sheetId,
            rowId,
            columnId,
          })?.area,
        ),
    )
  );
}
export function saidOfSortColumn(reads: WorkbookReads, ownFilter: TableToFilter, { c: columnId, direction }: SortKeyOfColumn): SaidOfSortColumn {
  const recordsArea = ownFilterRecordsArea(reads, ownFilter);
  const column = {
    sheetId: ownFilter.table.sheetId,
    columnId,
  };
  return {
    column: columnLabelOfFilterTable(reads, ownFilter, columnId),
    direction,
    holds: recordsArea === null ? null : sortHoldsOfColumn(reads, column, recordsArea),
  };
}
export function rowIdsOutOfViewOf(ownFilters: readonly Pick<OwnFilter, 'rows'>[]): Set<RowId> {
  const rowIds = new Set<RowId>();
  for (const { rows } of ownFilters) for (const rowId of rowIdsOutOfView(rows?.rowsOutOfView ?? [])) rowIds.add(rowId);
  return rowIds;
}
export function setOwnFiltersOfSheet(state: PageState, sheetId: SheetId, ownFilters: OwnFilter[]): PageState {
  const bySheet = new Map(state.ownFilters);
  if (ownFilters.length === 0) bySheet.delete(sheetId);
  else bySheet.set(sheetId, ownFilters);
  const next = {
    ...state,
    ownFilters: bySheet,
  };
  return ownFilters.some(({ sort }) => sort !== null) ? next : setOwnRowOrderOfSheet(next, sheetId, null);
}
export function setOwnRowOrderOfSheet(state: PageState, sheetId: SheetId, rows: IdRun[] | null): PageState {
  if ((state.ownRowOrders.get(sheetId) ?? null) === rows) return state;
  const bySheet = new Map(state.ownRowOrders);
  if (rows === null) bySheet.delete(sheetId);
  else bySheet.set(sheetId, rows);
  return {
    ...state,
    ownRowOrders: bySheet,
  };
}
export function takeOwnRowOrderFromSorts(state: PageState, sheetId: SheetId): PageState {
  const rows = sortedRowsOfOwnFilters(ownFiltersOfSheet(state, sheetId));
  return rows === null ? state : setOwnRowOrderOfSheet(state, sheetId, rows);
}
export function areSortedRowsInOrder(
  { ownRowOrders }: Pick<PageState, 'ownRowOrders'>,
  reads: WorkbookReads,
  sheetId: SheetId,
  ownFilters: readonly Pick<OwnFilter, 'sort'>[],
): boolean {
  const [sortedRows, lineRows] = [sortedRowsOfOwnFilters(ownFilters), reads.linesOf(sheetId)?.rows];
  if (sortedRows === null || lineRows === undefined || ownRowOrders.get(sheetId) === sortedRows) return true;
  const stretches = sortedRows.flatMap((run) => lineRows.stretchesOf(run));
  return stretches.every((stretch, index) => {
    const previous: LineSpan | undefined = stretches[index - 1];
    return previous === undefined || previous.firstIndex + previous.count === stretch.firstIndex;
  });
}
export function areOwnFiltersInForce(
  state: Pick<PageState, 'rowsOutOfViewByOwnFilters'>,
  reads: WorkbookReads,
  sheetId: SheetId,
  ownFilters: OwnFilter[],
): boolean {
  const rowOrder = reads.linesOf(sheetId)?.rows;
  const frozenRowCount = findSheetById(reads, sheetId)?.frozenRowCount;
  const outOfView = rowsOutOfViewByOwnFiltersOn(state, sheetId);
  const cached = ownFiltersInForceCache.get(ownFilters);
  if (cached !== undefined && cached.order === rowOrder && cached.frozenRowCount === frozenRowCount && cached.outOfView === outOfView)
    return cached.areSo;
  const areSo = isSameIdSet(withoutFrozenRowKeys(reads, sheetId, rowIdsOutOfViewOf(ownFilters)), outOfView);
  ownFiltersInForceCache.set(ownFilters, {
    order: rowOrder,
    frozenRowCount,
    outOfView,
    areSo,
  });
  return areSo;
}
export function recordCountsOfOwnFilter(
  state: Pick<PageState, 'ownFilters' | 'rowsOutOfViewByOwnFilters'>,
  reads: WorkbookReads,
  { rows, table: { sheetId } }: Pick<OwnFilter, 'rows' | 'table'>,
): RecordCountsOfFilter | null {
  if (rows === null || !areOwnFiltersInForce(state, reads, sheetId, ownFiltersOfSheet(state, sheetId))) return null;
  return {
    inView: rows.recordsInView,
    all: rows.records,
  };
}
export function recordCountsOfPendingOwnFilter(state: PageState, reads: WorkbookReads): RecordCountsOfFilter | null {
  const ownFilter = ownFilterNotDrawnYet(state);
  return ownFilter === null ? null : recordCountsOfOwnFilter(state, reads, ownFilter);
}
export function putOwnFiltersInForce(state: PageState, reads: ReadsWithTextMeasurer, sheetId: SheetId, ownFilters: OwnFilter[]): PageState {
  const withFilters = setOwnFiltersOfSheet(state, sheetId, ownFilters);
  return areOwnFiltersInForce(state, reads, sheetId, ownFilters)
    ? keepSelectionOnShownRows(withFilters, reads)
    : setRowsHiddenByOwnFilters(withFilters, reads, sheetId, rowIdsOutOfViewOf(ownFilters));
}
export function keepOwnFiltersWhileUnanswered(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  sheetId: SheetId,
  ownFilters: OwnFilter[],
  keptWhileUnanswered: OwnFilter[],
): PageState {
  const withFilters = setOwnFiltersOfSheet(state, sheetId, ownFilters);
  if (keptWhileUnanswered.length === 0) return withFilters;
  if (ownFilters.every(({ filter }) => filter === null))
    return setRowsHiddenByOwnFilters(withFilters, reads, sheetId, NO_ROWS_OUT_OF_VIEW);
  const keptKeys = new Set(keptWhileUnanswered.map(({ key }) => key));
  const [othersOutOfView, keptOutOfView] = [
    rowIdsOutOfViewOf(ownFiltersOfSheet(state, sheetId).filter(({ key }) => !keptKeys.has(key))),
    rowIdsOutOfViewOf(keptWhileUnanswered),
  ];
  const rowIdsStillOut = [...rowsOutOfViewByOwnFiltersOn(state, sheetId)].filter(
    (rowId) => othersOutOfView.has(rowId) || !keptOutOfView.has(rowId),
  );
  return setRowsHiddenByOwnFilters(withFilters, reads, sheetId, new Set(rowIdsStillOut));
}
export function askFilteredRows(reads: WorkbookReads, table: TableInIds, filter: Filter, isRetry: boolean = false): FilteredRowsAsked | null {
  const answer = reads.filteredRows(table, filter);
  if (answer === null) return null;
  if (answer.kind === 'filteredRows')
    return {
      kind: 'rows',
      filter,
      rows: answer,
    };
  const { refusal } = answer;
  if (refusal === 'filteredTableIsGone' || refusal === 'headerOfFilteredTableIsGone')
    return {
      kind: 'tableIsGone',
    };
  if (refusal === 'dayIsNotKnownToTheFilter')
    return {
      kind: 'notNow',
      why: 'dayIsNotKnown',
    };
  if (refusal !== 'columnIsNotOfTheFilteredTable')
    return {
      kind: 'notNow',
      why: refusal === 'readTookTooLong' ? 'tookTooLong' : 'fault',
    };
  const knownFilter = filterOnKnownColumns(reads, table.sheetId, filter);
  return isRetry || knownFilter === null || knownFilter.allOf.length === filter.allOf.length
    ? {
        kind: 'nothingLeftToAsk',
      }
    : askFilteredRows(reads, table, knownFilter, true);
}
export function refreshFilterTable(
  reads: WorkbookReads,
  ownFilter: FilterTable,
  cellTables: CellTablesRead,
): FilterTable | 'tookTooLong' | 'nowhere' | 'hasNoRecord' | null {
  if (cellTables === null || cellTables === 'tookTooLong') return cellTables;
  const sameCellTable =
    cellTables.find(({ cellTableId }) => cellTableId === ownFilter.cellTableId) ??
    cellTables.find(({ cellTable: otherCellTable }) => isSameByJson(otherCellTable, ownFilter.cellTable));
  const cellTable = sameCellTable ?? reads.cellTableDeclaredAs(ownFilter.table.sheetId, ownFilter.cellTable);
  if (cellTable === null || typeof cellTable === 'string') return cellTable;
  const filterTable = filterTableOfCellTable(cellTable);
  if (filterTable === null) return 'hasNoRecord';
  const { isSure } = sameCellTable === undefined ? ownFilter.table.header : filterTable.table.header;
  const table = {
    ...filterTable.table,
    header: {
      ...filterTable.table.header,
      isSure,
    },
  };
  const { liveCellTable } = filterTable;
  return {
    ...filterTable,
    cellTable: isSameByJson(filterTable.cellTable, ownFilter.cellTable) ? ownFilter.cellTable : filterTable.cellTable,
    liveCellTable: isSameByJson(liveCellTable, ownFilter.liveCellTable) ? ownFilter.liveCellTable : liveCellTable,
    table: isSameByJson(table, ownFilter.table) ? ownFilter.table : table,
    columns: isSameByJson(filterTable.columns, ownFilter.columns) ? ownFilter.columns : filterTable.columns,
  };
}
export function lookAtOwnSort(
  reads: WorkbookReads,
  ownFilter: TableToFilter,
  sort: Pick<OwnFilterSort, 'by' | 'rows'>,
  rowsIfUnanswered: IdRun[] | null,
): OwnFilterSort | null {
  const [firstBy, ...thenBy] = sort.by.filter(
    ({ c: columnId }) => ownFilter.columns.some((column) => column.c === columnId),
  );
  if (firstBy === undefined || !canSortOwnFilterTable(reads, ownFilter)) return null;
  const by = thenBy.length + 1 === sort.by.length ? sort.by : [firstBy, ...thenBy];
  const { sheetId, firstRowOfBody, lastRowOfBody } = ownFilter.table;
  const answer = reads.rowsInSortedOrder({
    sheetId,
    oneRow: firstRowOfBody,
    otherRow: lastRowOfBody,
    byColumn: firstBy.c,
    direction: firstBy.direction,
    thenBy: thenBy.map(
      ({ c: columnId, direction }) => ({
        byColumn: columnId,
        direction,
      }),
    ),
  });
  const rows = answer?.kind !== 'rowsInSortedOrder' ? rowsIfUnanswered : isSameByJson(answer.rows, sort.rows) ? sort.rows : answer.rows;
  return {
    by,
    said: saidOfSortBy(reads, ownFilter, by),
    rows,
    isRefused: answer?.kind === 'refused',
  };
}
export function lookAtOwnFilter(
  reads: WorkbookReads,
  ownFilter: FilterTable,
  filter: Filter | null,
  cellTables: CellTablesRead | 'asHeld' = reads.cellTables(ownFilter.table.sheetId),
): OwnFilterLook {
  const found = cellTables === 'asHeld' ? ownFilter : refreshFilterTable(reads, ownFilter, cellTables);
  const hasNoRecordYet = found === 'hasNoRecord' && areaOfFilteredTable(reads, ownFilter) !== null;
  if (found === null)
    return {
      kind: 'notNow',
      why: null,
    };
  if (found === 'tookTooLong' || hasNoRecordYet)
    return {
      kind: 'notNow',
      why: found,
    };
  if (found === 'nowhere' || found === 'hasNoRecord')
    return {
      kind: 'tableIsGone',
    };
  if (filter === null || haveFilterColumnsChanged(found, ownFilter))
    return {
      kind: 'answered',
      found,
      filter: null,
      rows: null,
    };
  const asked = askFilteredRows(reads, found.table, filter);
  if (asked === null)
    return {
      kind: 'notNow',
      why: null,
    };
  if (asked.kind === 'nothingLeftToAsk')
    return {
      kind: 'answered',
      found,
      filter: null,
      rows: null,
    };
  return asked.kind === 'rows'
    ? {
        ...asked,
        kind: 'answered',
        found,
      }
    : asked;
}
export function applyOwnFilter(state: PageState, reads: ReadsWithTextMeasurer, ownFilter: OwnFilter, filter: Filter | null): PageState {
  const { sheetId } = ownFilter.table;
  const isAsHeld = ownFilter.lookedAtAsOf === lookStampOfWorkbook(state) && ownFilter.unanswered === null;
  const looked = isAsHeld ? lookAtOwnFilter(reads, ownFilter, filter, 'asHeld') : lookAtOwnFilter(reads, ownFilter, filter);
  switch (looked.kind) {
    case 'answered': {
      const sort =
        isAsHeld || ownFilter.sort === null ? ownFilter.sort : lookAtOwnSort(reads, looked.found, ownFilter.sort, ownFilter.sort.rows);
      return putOwnFiltersInForce(
        state,
        reads,
        sheetId,
        replaceOwnFilter(state, ownFilter, ownFilterFromAnswer(state, reads, ownFilter.key, looked, sort)),
      );
    }
    case 'tableIsGone':
      return withOwnFilterNotice(putOwnFiltersInForce(state, reads, sheetId, replaceOwnFilter(state, ownFilter, null)), {
        kind: 'filteredTableIsGone',
      });
    case 'notNow':
      if (filter !== null) return looked.why === null ? state : noticeFilterNotWorkedOut(state, looked.why);
      return putOwnFiltersInForce(
        state,
        reads,
        sheetId,
        replaceOwnFilter(state, ownFilter, {
          ...ownFilter,
          filter,
          rows: null,
          unanswered: null,
          lines: [],
        }),
      );
  }
}
export function ownSortChoiceAfter(
  state: Pick<PageState, 'ownSortChosenLast'>,
  { key: tableKey, sort }: Pick<OwnFilter, 'key' | 'sort'>,
  by: SortKeyOfColumn[],
): OwnSortChoice | null {
  let before = sort?.by ?? null;
  return isSameByJson(before, by)
    ? state.ownSortChosenLast
    : {
        tableKey,
        by,
        before,
      };
}
export function withNamedViewInHand(state: PageState, tableKey: string, namedViewInHand: NamedViewInHand | null): PageState {
  let ownFilter = ownFilterByKey(state, tableKey);
  return ownFilter === null || isSameByJson(ownFilter.namedViewInHand, namedViewInHand)
    ? state
    : setOwnFiltersOfSheet(
        state,
        ownFilter.table.sheetId,
        replaceOwnFilter(state, ownFilter, {
          ...ownFilter,
          namedViewInHand,
        }),
      );
}
export function sortOwnFilter(state: PageState, reads: WorkbookReads, ownFilter: OwnFilter, by: SortKeyOfColumn[] | null): PageState {
  let { sheetId } = ownFilter.table,
    sort =
      by === null
        ? null
        : lookAtOwnSort(
            reads,
            ownFilter,
            {
              by,
              rows: null,
            },
            null,
          ),
    ownFilters = ownFiltersOfSheet(state, sheetId).flatMap((other) =>
      other.key === ownFilter.key
        ? [withOwnSort(other, sort)]
        : other.sort !== null && other.filter === null
          ? []
          : [withOwnSort(other, null)],
    ),
    listTableKey = state.ownFilterList?.tableKey,
    withList =
      listTableKey !== undefined && !ownFilters.some(({ key }) => key === listTableKey)
        ? {
            ...state,
            ownFilterList: null,
          }
        : state,
    { namedViewInHand } = ownFilter,
    next: PageState = {
      ...withNamedViewInHand(
        takeOwnRowOrderFromSorts(setOwnFiltersOfSheet(withList, sheetId, ownFilters), sheetId),
        ownFilter.key,
        namedViewInHand === null
          ? null
          : {
              ...namedViewInHand,
              isSortLeftOut: false,
            },
      ),
      ownSortChosenLast: sort === null ? null : ownSortChoiceAfter(state, ownFilter, sort.by),
    },
    columnIndex = sort === null ? null : reads.columnIndexOf(sheetId, sort.by[0].c);
  if (sort === null || columnIndex === null) return next;
  const column = columnLetters(columnIndex);
  return {
    ...next,
    lastDone: {
      what: 'rowsSorted',
      column,
      direction: sort.by[0].direction,
    },
  };
}
export function clearOwnSortByKey(state: PageState, reads: WorkbookReads, key: string): PageState {
  const ownFilter = ownFilterByKey(state, key);
  return ownFilter === null ? state : sortOwnFilter(state, reads, ownFilter, null);
}
export function ownSortToUndo(state: Pick<PageState, 'ownSortChosenLast' | 'ownFilters'>): OwnSortChoice | null {
  let chosen = state.ownSortChosenLast,
    ownFilter = chosen === null ? null : ownFilterByKey(state, chosen.tableKey);
  return isSameByJson(ownFilter?.sort?.by, chosen?.by) ? chosen : null;
}
export function undoOwnSortChoice(state: PageState, reads: ReadsWithTextMeasurer): PageState | null {
  if (state.ownSortChosenLast === null) return null;
  let { tableKey, before } = state.ownSortChosenLast,
    refreshed = refreshStaleOwnFilters(state, reads, state.sheetId),
    ownFilter = ownFilterByKey(refreshed, tableKey),
    restored = ownFilter === null ? refreshed : sortOwnFilter(refreshed, reads, ownFilter, before);
  return {
    ...dropUnusedOwnFilter(restored, reads, tableKey),
    ownSortChosenLast: null,
    lastDone: {
      what: 'undone',
      cells: null,
    },
  };
}
export function ownRowOrdersNotGivenUp({ ownRowOrders }: Pick<PageState, 'ownRowOrders'>, book: WorkbookReads): Map<SheetId, IdRun[]> {
  const kept = [...ownRowOrders].filter(([sheetId]) => findSheetById(book, sheetId)?.isOwnRowOrderGivenUp === false);
  return kept.length === ownRowOrders.size ? ownRowOrders : new Map(kept);
}
export function seeOwnRowOrderChanges(
  before: PageState,
  { state, effects }: PageTransition,
  event: PageEvent,
  book: WorkbookReads,
): PageTransition {
  if (state.ownRowOrders === before.ownRowOrders)
    return {
      state,
      effects,
    };
  const keepsSelection =
    state.rowsAskedFor === null &&
    event.kind !== 'workbookChanged' &&
    event.kind !== 'ownFiltersLookedAtAgain' &&
    event.kind !== 'ownFiltersBroughtBack';
  const seeEffects = [...new Set([...before.ownRowOrders.keys(), ...state.ownRowOrders.keys()])].flatMap(
    (sheetId): PageEffect[] => {
      const rows = state.ownRowOrders.get(sheetId) ?? null;
      if (rows === (before.ownRowOrders.get(sheetId) ?? null)) return [];
      const positions = keepsSelection ? selectionPositionsOf(state, book) : null;
      const staysAt =
        sheetId !== state.sheetId
          ? null
          : (positions ?? {
              scrollTop: state.scrollTop,
            });
      return [
        {
          kind: 'seeRowsInOwnOrder',
          sheetId,
          rows,
          staysAt,
        },
      ];
    },
  );
  const isOwnRowOrderAwaited = state.isOwnRowOrderAwaited || seeEffects.length > 0;
  return {
    state: {
      ...state,
      isOwnRowOrderAwaited,
    },
    effects: [...effects, ...seeEffects],
  };
}
export function restoreHeldOwnFilter(state: PageState, reads: ReadsWithTextMeasurer, snapshot: HeldOwnFilterSnapshot): PageState {
  const current = ownFilterByKey(state, snapshot.held.key);
  if (current === null) return state;
  const { sheetId } = snapshot.held.table;
  const heldWithSort = {
    ...snapshot.held,
    sort: current.sort,
  };
  const replaced = replaceOwnFilter(state, current, heldWithSort);
  return replaced.length === snapshot.others.length + 1 &&
    replaced.every(
      (ownFilter) =>
        ownFilter === heldWithSort || snapshot.others.some((other) => isSameOwnFilterLook(ownFilter, other)),
    )
    ? setRowsHiddenByOwnFilters(setOwnFiltersOfSheet(state, sheetId, replaced), reads, sheetId, snapshot.rowsOutOfView)
    : putOwnFiltersInForce(state, reads, sheetId, replaced);
}
export function namedViewInHandAfterMove(
  reads: WorkbookReads,
  {
    namedViewInHand,
    table: { sheetId },
  }: Pick<OwnFilter, 'namedViewInHand' | 'table'>,
  wentTo: ColumnsWentTo['wentTo'],
): NamedViewInHand | null {
  let namedView = reads
    .namedViewsIn(sheetId)
    .find(({ namedViewId }) => namedViewId === namedViewInHand?.namedViewId)?.namedView;
  if (namedViewInHand === null || namedView === undefined) return namedViewInHand;
  let columns = new Map(wentTo.map(([before, after]) => [before, after])),
    columnAfter = (columnId: ColumnId): ColumnId => columns.get(columnId) ?? columnId,
    moved = {
      ...namedView,
      filter: namedView.filter === null ? null : mapFilterColumns(namedView.filter, columnAfter),
      sortBy: namedView.sortBy.map((sortKey) => ({
        ...sortKey,
        c: columnAfter(sortKey.c),
      })),
    };
  return namedViewAskedKey(namedView) === namedViewInHand.asked
    ? {
        ...namedViewInHand,
        asked: namedViewAskedKey(moved),
      }
    : namedViewInHand;
}
export function ownFilterAfterColumnsMoved(reads: WorkbookReads, ownFilter: OwnFilter, { ofTableAt, wentTo }: ColumnsWentTo): OwnFilter {
  let [area, position] = [areaOfFilteredTable(reads, ownFilter), reads.positionOfCell(ofTableAt)];
  if (
    !(
      area !== null &&
      position !== null &&
      isInSpan(position.rowIndex, area.topRowIndex, area.rowCount) &&
      isInSpan(position.columnIndex, area.leftColumnIndex, area.columnCount)
    )
  )
    return ownFilter;
  let columns = new Map(wentTo),
    columnAfter = (columnId: ColumnId): ColumnId => columns.get(columnId) ?? columnId,
    sortKeyAfter = (sortKey: SortKeyOfColumn): SortKeyOfColumn => ({
      ...sortKey,
      c: columnAfter(sortKey.c),
    }),
    [firstKey, ...otherKeys] = ownFilter.sort?.by ?? [];
  return {
    ...ownFilter,
    namedViewInHand: namedViewInHandAfterMove(reads, ownFilter, wentTo),
    filter: ownFilter.filter === null ? null : mapFilterColumns(ownFilter.filter, columnAfter),
    sort:
      ownFilter.sort === null || firstKey === undefined
        ? ownFilter.sort
        : {
            ...ownFilter.sort,
            by: [sortKeyAfter(firstKey), ...otherKeys.map(sortKeyAfter)],
          },
  };
}
export function lookAgainAtOwnFilters(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  how: OwnFiltersLookAgain,
  sheetId: SheetId,
  columnsMoved?: ColumnsWentTo,
): PageState {
  const heldFilters = ownFiltersOfSheet(state, sheetId);
  if (heldFilters.length === 0) return state;
  const cellTables = reads.cellTables(sheetId);
  const looked = heldFilters.map((ownFilter) => {
    let moved = columnsMoved === undefined ? ownFilter : ownFilterAfterColumnsMoved(reads, ownFilter, columnsMoved);
    return {
      held: moved,
      asked: lookAtOwnFilter(reads, moved, moved.filter, cellTables),
    };
  });
  const refreshed = looked.flatMap(({ held, asked }): OwnFilter[] => {
    if (asked.kind === 'tableIsGone') return [];
    if (asked.kind === 'answered') {
      const sortKept = haveFilterColumnsChanged(asked.found, held) ? null : held.sort;
      const sort = sortKept === null ? null : lookAtOwnSort(reads, asked.found, sortKept, how === 'apply' ? null : sortKept.rows);
      return [
        {
          ...ownFilterFromAnswer(state, reads, held.key, asked, sort),
          namedViewInHand: held.namedViewInHand,
        },
      ];
    }
    if (held.unanswered === null || asked.why === null || asked.why === 'hasNoRecord') return [held];
    return [
      {
        ...held,
        unanswered: {
          why: asked.why,
          tries: held.unanswered.tries + 1,
        },
      },
    ];
  });
  const isNewlyAnswered = refreshed.some(
    ({ key, rows }) =>
      rows !== null && heldFilters.some((held) => held.key === key && held.unanswered !== null),
  );
  const missesRow =
    typeof how === 'object' && missesRowOutOfViewInArea(state, reads, sheetId, rowIdsOutOfViewOf(refreshed), how.applyIfARowIsMissedAmong);
  const next =
    how === 'apply' || missesRow || isNewlyAnswered
      ? putOwnFiltersInForce(state, reads, sheetId, refreshed)
      : keepOwnFiltersWhileUnanswered(
          state,
          reads,
          sheetId,
          refreshed,
          heldFilters.filter(
            ({ key, filter }) =>
              filter !== null && !refreshed.some((refreshedFilter) => refreshedFilter.key === key && refreshedFilter.filter !== null),
          ),
        );
  const hasSortUnanswered = heldFilters.some(({ sort }) => sort?.rows === null);
  const withRowOrder = how === 'apply' || hasSortUnanswered ? takeOwnRowOrderFromSorts(next, sheetId) : next;
  const sorted = heldFilters.find(({ sort }) => sort !== null);
  const gone = heldFilters.find(({ key }) => !refreshed.some((refreshedFilter) => refreshedFilter.key === key));
  if (gone !== undefined)
    return withOwnFilterNotice(
      withRowOrder,
      gone === sorted && gone.filter === null
        ? {
            kind: 'ownSortIsOver',
            why: 'tableIsGone',
          }
        : {
            kind: 'filteredTableIsGone',
          },
    );
  const sortDropped = refreshed.find(({ key, sort }) => key === sorted?.key && sort === null);
  if (sortDropped !== undefined) {
    const hasSortColumn = sorted?.sort?.by.some(
      ({ c: columnId }) => sortDropped.columns.some((column) => column.c === columnId),
    );
    return withOwnFilterNotice(withRowOrder, {
      kind: 'ownSortIsOver',
      why: hasSortColumn === true ? 'tableChanged' : 'columnIsGone',
    });
  }
  const whyNotWorkedOut = looked.flatMap(
    ({ asked }) => (asked.kind === 'notNow' && asked.why !== null ? [asked.why] : []),
  )[0];
  return how !== 'apply' || whyNotWorkedOut === undefined ? withRowOrder : noticeFilterNotWorkedOut(withRowOrder, whyNotWorkedOut);
}
export function recordAndTableRows(reads: WorkbookReads, ownFilter: FilterTable): { records: TableIndexRun; all: TableIndexRun } | null {
  const [recordsArea, tableArea] = [ownFilterRecordsArea(reads, ownFilter), ownFilterTableArea(reads, ownFilter)];
  return recordsArea === null || tableArea === null
    ? null
    : {
        records: indexRangeOfArea(recordsArea),
        all: indexRangeOfArea(tableArea),
      };
}
export function addOwnFilter(state: PageState, reads: ReadsWithTextMeasurer, ownFilter: OwnFilter): PageState {
  const rows = recordAndTableRows(reads, ownFilter);
  const kept = ownFiltersOfSheet(state, ownFilter.table.sheetId).filter((other) => {
    const otherRows = recordAndTableRows(reads, other);
    if (rows === null || otherRows === null) return true;
    return !indexRangesOverlap(rows.records, otherRows.all) && !indexRangesOverlap(otherRows.records, rows.all);
  });
  return putOwnFiltersInForce(state, reads, ownFilter.table.sheetId, [...kept, ownFilter]);
}
export const filterTableAtCell = (reads: WorkbookReads, cellId: CellId): FilterTable | null => filterTableOfCellTable(reads.cellTableAt(cellId));
export const NO_OWN_ROW_ORDERS = new Map<SheetId, IdRun[]>();
export const isOwnFilterUnused = ({ filter, sort }: Pick<OwnFilter, 'filter' | 'sort'>): boolean => filter === null && sort === null;
export const NO_OWN_FILTERS = new Map<SheetId, OwnFilter[]>();
export const ownFiltersOfSheet = ({ ownFilters }: StateOfOwnFilters, sheetId: SheetId): OwnFilter[] => ownFilters.get(sheetId) ?? [];
export const isOwnFilterDrawn = (state: StateOfFiltersDrawn, { key }: Pick<OwnFilter, 'key'>): boolean => key !== ownFilterKeyNotDrawnYet(state);
export const ownFilterKeyNotDrawnYet = ({ ownFilterList, rowsAskedFor }: Pick<PageState, 'ownFilterList' | 'rowsAskedFor'>): string | null =>
  ownFilterList?.isFilterNotDrawnYet === true
    ? ownFilterList.tableKey
    : rowsAskedFor?.isFilterNotDrawnYet === true
      ? (rowsAskedFor.table?.key ?? null)
      : null;
export const drawnOwnFiltersCache = new WeakMap<OwnFilter[], { butFor: string; drawn: OwnFilter[] }>();
export const ownFiltersWithoutKeyCache = new WeakMap<
  Map<SheetId, OwnFilter[]>,
  { key: string; evenIfItAsks: boolean; kept: Map<SheetId, OwnFilter[]> }
>();
export const allOwnFilters = ({ ownFilters }: StateOfOwnFilters): OwnFilter[] => [...ownFilters.values()].flat();
export const ownFilterByKey = (state: StateOfOwnFilters, key: string): OwnFilter | null =>
  allOwnFilters(state).find((ownFilter) => ownFilter.key === key) ?? null;
export const nextOwnFilterKey = (state: StateOfOwnFilters): string =>
  String(1 + Math.max(0, ...allOwnFilters(state).map(({ key }) => Number(key))));
export const lookStampOfWorkbook = ({
  workbookChangeCount,
  formulasWorkedOutCount,
}: LookStampOfState): number => workbookChangeCount + formulasWorkedOutCount;
export const columnLabelOfFilterTable = (reads: WorkbookReads, { table: { sheetId }, columns }: TableToFilter, c: ColumnId): RuleColumn =>
  columnLabelOf(
    reads,
    sheetId,
    columns.find((column) => column.c === c) ?? {
      c,
      name: null,
    },
  );
export const NUMBER_ROW_SEARCH_LIMIT = 50;
export const isFilterTableEmpty = ({ table }: Pick<FilterTable, 'table'>): boolean => table.runs.length === 0;
export const cutsRowGroup = (rows: LineSpan, rowGroups: GroupOnGrid[]): boolean =>
  rowGroups.some((rowGroup) => rowGroup.count > 1 && spanCutsOwnRowOrder(rows, rowGroup));
export const isOwnFilterSortable = (reads: WorkbookReads, ownFilter: TableToFilter): boolean =>
  isFilterTableEmpty(ownFilter) && canSortOwnFilterTable(reads, ownFilter);
export const saidOfSortBy = (reads: WorkbookReads, ownFilter: TableToFilter, [firstBy, ...thenBy]: SortKeyOfColumn[]): SaidOfSortColumn[] => [
  saidOfSortColumn(reads, ownFilter, firstBy),
  ...thenBy.map((by) => saidOfSortColumn(reads, ownFilter, by)),
];
export const NO_ROWS_OUT_OF_VIEW = new Set<RowId>();
export const rowsOutOfViewByOwnFiltersOn = (
  { rowsOutOfViewByOwnFilters }: Pick<PageState, 'rowsOutOfViewByOwnFilters'>,
  sheetId: SheetId,
): Set<RowId> => rowsOutOfViewByOwnFilters.get(sheetId) ?? NO_ROWS_OUT_OF_VIEW;
export const sortedRowsOfOwnFilters = (ownFilters: readonly Pick<OwnFilter, 'sort'>[]): IdRun[] | null =>
  ownFilters.find(({ sort }) => sort !== null)?.sort?.rows ?? null;
export const isSameIdSet = (ids: ReadonlySet<string>, otherIds: ReadonlySet<string>): boolean =>
  ids.size === otherIds.size && [...ids].every((id) => otherIds.has(id));
export const ownFiltersInForceCache = new WeakMap<
  OwnFilter[],
  { order: LineIndex | undefined; frozenRowCount: number | undefined; outOfView: Set<RowId>; areSo: boolean }
>();
export const filterOnKnownColumns = (reads: WorkbookReads, sheetId: SheetId, filter: Filter): Filter | null =>
  keepFilterClausesWhereColumns(filter, (columnId) => reads.columnIndexOf(sheetId, columnId) !== null);
/** Whether two values read the same once written as JSON. */
export const isSameByJson = <Compared>(value: Compared, otherValue: Compared): boolean => JSON.stringify(value) === JSON.stringify(otherValue);
export const haveFilterColumnsChanged = (found: Pick<FilterTable, 'cellTable'>, ownFilter: Pick<FilterTable, 'cellTable' | 'columns'>): boolean =>
  found.cellTable.firstColumn !== ownFilter.cellTable.firstColumn &&
  found.cellTable.lastColumn !== ownFilter.cellTable.lastColumn &&
  ![found.cellTable.firstColumn, found.cellTable.lastColumn].every(
    (columnId) => ownFilter.columns.some(({ c }) => c === columnId),
  );
export const ownFilterFromAnswer = (
  state: LookStampOfState & StateOfOwnFilters,
  reads: WorkbookReads,
  key: string,
  { found, filter, rows }: OwnFilterAnswered,
  sort: OwnFilterSort | null,
): OwnFilter => ({
  ...found,
  key,
  filter,
  rows,
  sort,
  namedViewInHand: ownFilterByKey(state, key)?.namedViewInHand ?? null,
  unanswered: null,
  lines: filter === null ? [] : describeFilterLines(reads, found, filter),
  lookedAtAsOf: lookStampOfWorkbook(state),
});
export const NEVER_LOOKED_AT = -1;
export const withOwnFilterNotice = (state: PageState, notice: Notice): PageState => ({
  ...state,
  notice,
});
export const noticeFilterNotWorkedOut = (state: PageState, why: WhyRowsNotNow | 'hasNoRecord'): PageState =>
  withOwnFilterNotice(
    state,
    why === 'hasNoRecord'
      ? {
          kind: 'noTableToFilter',
        }
      : {
          kind: 'ownFilterNotWorkedOut',
          why,
        },
  );
export const replaceOwnFilter = (state: StateOfOwnFilters, { key, table }: Pick<OwnFilter, 'key' | 'table'>, replacement: OwnFilter | null): OwnFilter[] =>
  ownFiltersOfSheet(state, table.sheetId).flatMap((ownFilter) => (ownFilter.key === key ? (replacement ?? []) : ownFilter));
export const withOwnSort = (ownFilter: OwnFilter, sort: OwnFilterSort | null): OwnFilter =>
  ownFilter.sort === sort
    ? ownFilter
    : {
        ...ownFilter,
        sort,
      };
export const heldOwnFilterSnapshot = (
  state: Pick<PageState, 'ownFilters' | 'rowsOutOfViewByOwnFilters'>,
  held: OwnFilter,
): HeldOwnFilterSnapshot => ({
  held,
  others: ownFiltersOfSheet(state, held.table.sheetId).filter((ownFilter) => ownFilter !== held),
  rowsOutOfView: rowsOutOfViewByOwnFiltersOn(state, held.table.sheetId),
});
export const isSameOwnFilterLook = (ownFilter: OwnFilter, other: OwnFilter): boolean =>
  ownFilter.key === other.key &&
  ownFilter.filter === other.filter &&
  JSON.stringify(ownFilter.rows?.rowsOutOfView) === JSON.stringify(other.rows?.rowsOutOfView);
export const missesRowOutOfViewInArea = (
  state: Pick<PageState, 'rowsOutOfViewByOwnFilters'>,
  reads: WorkbookReads,
  sheetId: SheetId,
  rowIdsStillOut: ReadonlySet<RowId>,
  { topRowIndex, rowCount }: Pick<CellArea, 'topRowIndex' | 'rowCount'>,
): boolean =>
  [...rowsOutOfViewByOwnFiltersOn(state, sheetId)].some((rowId) => {
    const rowIndex = rowIdsStillOut.has(rowId) ? null : reads.rowIndexOf(sheetId, rowId);
    return rowIndex !== null && rowIndex >= topRowIndex && rowIndex < topRowIndex + rowCount;
  });
export const refreshStaleOwnFilters = (state: PageState, reads: ReadsWithTextMeasurer, sheetId: SheetId): PageState =>
  ownFiltersOfSheet(state, sheetId).some(({ lookedAtAsOf }) => lookedAtAsOf !== lookStampOfWorkbook(state))
    ? lookAgainAtOwnFilters(state, reads, 'look', sheetId)
    : state;
export const indexRangeOfArea = ({ topRowIndex, rowCount }: Pick<CellArea, 'topRowIndex' | 'rowCount'>): TableIndexRun => ({
  first: topRowIndex,
  last: topRowIndex + rowCount - 1,
});
export const addOwnFilterForTable = (state: PageState, reads: ReadsWithTextMeasurer, filterTable: FilterTable): PageState =>
  addOwnFilter(
    state,
    reads,
    ownFilterFromAnswer(
      state,
      reads,
      nextOwnFilterKey(state),
      {
        kind: 'answered',
        found: filterTable,
        filter: null,
        rows: null,
      },
      null,
    ),
  );
