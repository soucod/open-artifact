import type { EngineCellTable, SheetId, ValueContents } from '@open-artifact/sheets-core';
import {
  isSameByJson,
  allOwnFilters,
  lookStampOfWorkbook,
  ownFilterTableArea,
  filterTableOfCellTable,
  filterTableAtCell,
  withOwnFilterNotice,
  refreshStaleOwnFilters,
  addOwnFilterForTable,
  ownFilterAtCell,
  ownFiltersOfSheet,
  applyOwnFilter,
  ownFilterByKey,
  putOwnFiltersInForce,
  lookAgainAtOwnFilters,
  indexRangeOfArea,
  clearOwnSortByKey,
  lookAtOwnFilter,
  haveFilterColumnsChanged,
  lookAtOwnSort,
  addOwnFilter,
  ownFilterFromAnswer,
  nextOwnFilterKey,
  takeOwnRowOrderFromSorts,
  saidOfSortBy,
  NEVER_LOOKED_AT,
  isOwnFilterKeyUnused,
} from './own-filters.ts';
import { placedTablesOfSheet, tableKeyOf, areaOfFilteredTable, indexRangesOverlap } from './finding.ts';
import { hasNoUnformattedMark } from '../grid/sticky-headers.ts';
import { selectedArea, mergedAreaOrCellOf, isSameArea, activeAnchorCell } from '../selection/model.ts';
import { isAreaWithin } from '../selection/several-ranges.ts';
import { clearPassingNotice } from '../state/transitions.ts';
import { withValueFilter, withValueExcluded, filterWithoutEntry } from './filter-model.ts';
import { areasOverlap } from '../model/workbook.ts';
import { keepSelectionOnShownRows } from './filtered-rows.ts';
import { findSheetById, clampScrollOfView } from '../grid/layout.ts';
import { isCellShownBlank } from '../format/shown-text.ts';
import { cellValueOf } from '../model/cell-values.ts';
import type { FilteredTableArea } from './finding.ts';
import type { ColumnsWentTo, FilterTable, OwnFilter, TableToFilter } from './own-filters.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { EditQueuedOutcome } from '../store/workbook-sync.ts';
import type { KeptOwnFilter, OwnFilterByCellChosen, OwnFiltersCleared, PageEvent, SortKeyOfColumn } from '../state/event-reducer.ts';
/** An own filter as it is written down to be brought back after a reload. */
export interface OwnFilterToKeep extends Pick<OwnFilter, 'cellTableId' | 'cellTable' | 'liveCellTable' | 'table' | 'columns' | 'filter' | 'namedViewInHand'> {
  sortBy: SortKeyOfColumn[] | null;
}
export function isCellTableUndeclaredButSure(reads: WorkbookReads, { cellTable, table }: Pick<FilterTable, 'cellTable' | 'table'>): boolean {
  const found = reads.cellTableAt({
    sheetId: table.sheetId,
    rowId: cellTable.headerRows.firstRow,
    columnId: cellTable.firstColumn,
  });
  return found !== null && found.cellTableId === null && found.table?.table.header?.isSure === true && isSameByJson(found.cellTable, cellTable);
}
export function declareCellTableOfNewFilter(before: PageState, state: PageState, reads: WorkbookReads, isAllowed: boolean): PageTransition {
  const ownFiltersBefore = allOwnFilters(before);
  const newFilter = allOwnFilters(state).find(
    ({ cellTableId, cellTable }) =>
      cellTableId === null && !ownFiltersBefore.some((filterBefore) => isSameByJson(filterBefore.cellTable, cellTable)),
  );
  if (newFilter === undefined || !isAllowed || !isCellTableUndeclaredButSure(reads, newFilter))
    return {
      state,
      effects: [],
    };
  const { firstColumn, headerRows } = newFilter.cellTable;
  const placed = placedTablesOfSheet(state, reads, newFilter.table.sheetId).all.find(
    ({ key }) => key === tableKeyOf(headerRows.firstRow, firstColumn),
  );
  if (placed !== undefined && !hasNoUnformattedMark(state, placed, reads))
    return {
      state,
      effects: [],
    };
  const rowsAskedFor = state.rowsAskedFor;
  const nextRowsAskedFor =
    rowsAskedFor !== null && rowsAskedFor.placeBeforeAsOf === lookStampOfWorkbook(state)
      ? {
          ...rowsAskedFor,
          placeBeforeAsOf: rowsAskedFor.placeBeforeAsOf + 1,
        }
      : rowsAskedFor;
  return {
    state: {
      ...state,
      rowsAskedFor: nextRowsAskedFor,
    },
    effects: [
      {
        kind: 'declareCellTable',
        sheetId: newFilter.table.sheetId,
        cellTable: newFilter.cellTable,
      },
    ],
  };
}
export function isOneCellSelected(state: PageState, reads: WorkbookReads): boolean {
  const [area, cellArea] = [selectedArea(state, reads), mergedAreaOrCellOf(reads, state.activeCell)];
  return area !== null && cellArea !== null && isSameArea(area, cellArea);
}
export function cellTableFromSelection(state: PageState, reads: WorkbookReads): EngineCellTable | null {
  const area = selectedArea(state, reads);
  if (area === null || area.rowCount < 2) return null;
  const { topRowIndex, leftColumnIndex, columnCount } = area;
  const firstCellId = reads.cellIdAt(state.sheetId, topRowIndex, leftColumnIndex);
  const lastCellId = reads.cellIdAt(state.sheetId, topRowIndex, leftColumnIndex + columnCount - 1);
  if (firstCellId === null || lastCellId === null) return null;
  return {
    headerRows: {
      firstRow: firstCellId.rowId,
      lastRow: firstCellId.rowId,
    },
    firstColumn: firstCellId.columnId,
    lastColumn: lastCellId.columnId,
    footerRows: null,
  };
}
export function selectionMatchesFilterTable(state: PageState, reads: WorkbookReads, filterTable: FilterTable | null): boolean {
  const area = selectedArea(state, reads);
  const recordsArea = filterTable === null ? null : ownFilterRecordsArea(reads, filterTable);
  const tableArea = filterTable === null ? null : ownFilterTableArea(reads, filterTable);
  if (area === null || recordsArea === null || tableArea === null) return false;
  const recordsToEnd = {
    ...recordsArea,
    rowCount: tableArea.topRowIndex + tableArea.rowCount - recordsArea.topRowIndex,
  };
  if (isSameArea(area, recordsArea) || isSameArea(area, recordsToEnd)) return true;
  return area.columnCount < recordsArea.columnCount && isAreaWithin(area, recordsToEnd);
}
export function cellTableWithFooterFromSelection(
  state: PageState,
  reads: WorkbookReads,
  filterTable: FilterTable | null,
): EngineCellTable | null {
  const area = selectedArea(state, reads);
  const recordsArea = filterTable === null ? null : ownFilterRecordsArea(reads, filterTable);
  if (filterTable === null || area === null || recordsArea === null) return null;
  if (
    !(
      area.topRowIndex === recordsArea.topRowIndex &&
      area.rowCount >= 2 &&
      area.rowCount < recordsArea.rowCount &&
      area.leftColumnIndex === recordsArea.leftColumnIndex &&
      area.columnCount === recordsArea.columnCount
    )
  )
    return null;
  const rowIdAt = (rowIndex: number) => reads.cellIdAt(state.sheetId, rowIndex, recordsArea.leftColumnIndex)?.rowId ?? null;
  const firstFooterRow = rowIdAt(area.topRowIndex + area.rowCount);
  const lastFooterRow = filterTable.liveCellTable.footerRows?.lastRow ?? rowIdAt(recordsArea.topRowIndex + recordsArea.rowCount - 1);
  if (firstFooterRow === null || lastFooterRow === null) return null;
  return {
    ...filterTable.cellTable,
    footerRows: {
      firstRow: firstFooterRow,
      lastRow: lastFooterRow,
    },
  };
}
export function filterTableForSelection(state: PageState, reads: WorkbookReads): FilterTable | null {
  const cellTableEntry = reads.cellTableAt(activeAnchorCell(state, reads));
  const filterTable = filterTableOfCellTable(cellTableEntry);
  if (isOneCellSelected(state, reads)) return filterTable;
  const area = filterTable === null ? selectedArea(state, reads) : null;
  const topLeftCellId = area === null ? null : reads.cellIdAt(state.sheetId, area.topRowIndex, area.leftColumnIndex);
  const filterTableAtTopLeft = topLeftCellId === null ? null : filterTableAtCell(reads, topLeftCellId);
  if (selectionMatchesFilterTable(state, reads, filterTableAtTopLeft)) return filterTableAtTopLeft;
  const isTableSettled =
    (cellTableEntry !== null && cellTableEntry.cellTableId !== null) || selectionMatchesFilterTable(state, reads, filterTable);
  const cellTable =
    cellTableWithFooterFromSelection(state, reads, filterTable) ?? (isTableSettled ? null : cellTableFromSelection(state, reads));
  return cellTable === null ? filterTable : filterTableOfCellTable(reads.cellTableDeclaredAs(state.sheetId, cellTable));
}
export function toggleOwnFilterOnSelection(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  const filterTable = filterTableForSelection(state, reads);
  if (filterTable === null)
    return withOwnFilterNotice(state, {
      kind: 'noTableToFilter',
    });
  const refreshed = refreshStaleOwnFilters(clearPassingNotice(state), reads, filterTable.table.sheetId);
  return ownFilterOfTable(refreshed, filterTable) === null ? addOwnFilterForTable(refreshed, reads, filterTable) : refreshed;
}
export function ownFilterRecordsArea(reads: WorkbookReads, ownFilter: TableToFilter): FilteredTableArea | null {
  const area = areaOfFilteredTable(reads, ownFilter);
  if (area === null) return null;
  const firstRecordIndex = area.rowIndexOfButtons + 1;
  return {
    ...area,
    topRowIndex: firstRecordIndex,
    rowCount: area.topRowIndex + area.rowCount - firstRecordIndex,
  };
}
export function filterByCellValue(state: PageState, reads: ReadsWithTextMeasurer, keeps: OwnFilterByCellChosen['keeps']): PageState {
  const cell = activeAnchorCell(state, reads);
  const refreshed = refreshStaleOwnFilters(state, reads, cell.sheetId);
  const filterAtCell = ownFilterAtCell(refreshed, reads, cell);
  const filterTable = filterAtCell ?? filterTableAtCell(reads, cell);
  if (filterTable === null)
    return withOwnFilterNotice(refreshed, {
      kind: 'noTableToFilter',
    });
  const ownFilter = filterAtCell ?? ownFilterOfTable(refreshed, filterTable);
  const withFilter = ownFilter === null ? addOwnFilterForTable(clearPassingNotice(refreshed), reads, filterTable) : refreshed;
  const target = ownFilter ?? ownFiltersOfSheet(withFilter, cell.sheetId).at(-1);
  const isFilterColumn = filterTable.columns.some(({ c }) => c === cell.columnId);
  if (target === undefined || !isFilterColumn || !isCellInFilterRecords(reads, target, cell)) return withFilter;
  const [columnId, value] = [cell.columnId, filterValueOfCell(reads, cell)];
  return applyOwnFilter(
    clearPassingNotice(withFilter),
    reads,
    target,
    keeps === 'only'
      ? withValueFilter(target.filter, columnId, {
          kind: 'isOneOf',
          values: [value],
        })
      : withValueExcluded(target.filter, columnId, value),
  );
}
export function removeOwnFilterLine(state: PageState, reads: ReadsWithTextMeasurer, tableKey: string, lineIndex: number): PageState {
  const ownFilter = ownFilterByKey(state, tableKey);
  if (ownFilter === null || ownFilter.filter === null) return state;
  return applyOwnFilter(state, reads, ownFilter, filterWithoutEntry(ownFilter.filter, lineIndex));
}
export function clearOwnFilters(state: PageState, reads: ReadsWithTextMeasurer, which: OwnFiltersCleared['of']): PageState {
  const sheetId = 'sheetId' in which ? which.sheetId : ownFilterByKey(state, which.tableKey)?.table.sheetId;
  if (sheetId === undefined) return state;
  return putOwnFiltersInForce(
    {
      ...state,
      ownFilterList: null,
    },
    reads,
    sheetId,
    ownFiltersOfSheet(state, sheetId).filter(({ key }) => 'tableKey' in which && key !== which.tableKey),
  );
}
export function reapplyOwnFiltersAfterEdit(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  message: PageEvent,
  columnsMoved: ColumnsWentTo | null,
): PageState {
  const isEditQueued = message.kind === 'editAnswered' && message.outcome.kind === 'editQueued';
  const isSort = isEditQueued && (message.edit.kind === 'sortRows' || message.edit.kind === 'sortCells');
  if (columnsMoved !== null) return lookAgainAtOwnFilters(state, reads, 'look', columnsMoved.ofTableAt.sheetId, columnsMoved);
  return (
    isSort || (isEditQueued && message.ifQueued.reachesRowsOutOfView === true)
      ? // Both conditions mean the edit was queued; a condition held in a constant does not narrow `outcome`.
        [(message.outcome as EditQueuedOutcome).placeChanged]
      : message.kind === 'undoOrRedoAnswered' && message.outcome.kind === 'made'
        ? [...(message.outcome.changedBefore ?? []), message.outcome.changed]
        : []
  ).reduce((next, changed) => {
    if (changed === null || changed.area === null) return next;
    const { sheetId, area } = changed;
    return ownFiltersOfSheet(next, sheetId).some((ownFilter) => {
      const recordsArea = ownFilterRecordsArea(reads, ownFilter);
      return recordsArea !== null && areasOverlap(recordsArea, area);
    })
      ? lookAgainAtOwnFilters(
          next,
          reads,
          isSort
            ? 'apply'
            : {
                applyIfARowIsMissedAmong: area,
              },
          sheetId,
        )
      : next;
  }, state);
}
export function dropOwnSortAfterSortEdit(state: PageState, reads: ReadsWithTextMeasurer, message: PageEvent): PageState {
  if (message.kind !== 'editAnswered' || message.outcome.kind === 'refused') return state;
  const { edit } = message;
  const [sheetId, ...rowIds] =
    edit.kind === 'sortRows'
      ? [edit.sheetId, edit.oneRow, edit.otherRow]
      : edit.kind === 'sortCells'
        ? [edit.cells.sheetId, edit.cells.oneCorner.r, edit.cells.otherCorner.r]
        : [];
  if (sheetId === undefined) return state;
  const sorted = ownFiltersOfSheet(state, sheetId).find(({ sort }) => sort !== null);
  const recordsArea = sorted === undefined ? null : ownFilterRecordsArea(reads, sorted);
  const rowIndexes = rowIds.flatMap((rowId) => reads.rowIndexOf(sheetId, rowId) ?? []);
  if (sorted === undefined || recordsArea === null) return state;
  return indexRangesOverlap(indexRangeOfArea(recordsArea), {
    first: Math.min(...rowIndexes),
    last: Math.max(...rowIndexes),
  })
    ? dropUnusedOwnFilter(clearOwnSortByKey(state, reads, sorted.key), reads, sorted.key)
    : state;
}
export function reapplyOwnFiltersAfterAnswer(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  message: PageEvent,
  columnsMoved: ColumnsWentTo | null,
): PageState {
  const next = reapplyOwnFiltersAfterEdit(dropOwnSortAfterSortEdit(state, reads, message), reads, message, columnsMoved);
  return message.kind === 'editAnswered' && (message.edit.kind === 'sortRows' || message.edit.kind === 'sortCells')
    ? keepSelectionOnShownRows(next, reads)
    : next;
}
export function ownFiltersOfExistingSheets({ ownFilters }: Pick<PageState, 'ownFilters'>, reads: WorkbookReads): Map<SheetId, OwnFilter[]> {
  const kept = [...ownFilters].filter(([sheetId]) => findSheetById(reads, sheetId) !== undefined);
  return kept.length === ownFilters.size ? ownFilters : new Map(kept);
}
export function bringBackOwnFilter(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  { filter, sortBy, namedViewInHand = null, ...held }: KeptOwnFilter,
): PageState {
  const looked = lookAtOwnFilter(reads, held, filter);
  if (looked.kind === 'tableIsGone') return state;
  if (looked.kind === 'answered' && (filter ?? sortBy) !== null && haveFilterColumnsChanged(looked.found, held)) return state;
  if (looked.kind === 'answered') {
    let { columns } = looked.found,
      isColumnFound = ({ c: columnId }: SortKeyOfColumn): boolean => columns.some((column) => column.c === columnId);
    if (sortBy !== null && !sortBy.some(isColumnFound)) {
      let withNotice = withOwnFilterNotice(state, {
          kind: 'ownSortIsOver',
          why: 'columnIsGone',
        }),
        inHandWithoutSort =
          namedViewInHand === null
            ? null
            : {
                ...namedViewInHand,
                isSortLeftOut: true,
              };
      return filter === null
        ? withNotice
        : bringBackOwnFilter(withNotice, reads, {
            ...held,
            filter,
            sortBy: null,
            namedViewInHand: inHandWithoutSort,
          });
    }
    const sort =
      sortBy === null
        ? null
        : lookAtOwnSort(
            reads,
            looked.found,
            {
              by: sortBy,
              rows: null,
            },
            null,
          );
    let ownFilter: OwnFilter = {
        ...ownFilterFromAnswer(state, reads, nextOwnFilterKey(state), looked, sort),
        namedViewInHand,
      },
      next = addOwnFilter(state, reads, ownFilter);
    return takeOwnRowOrderFromSorts(next, held.table.sheetId);
  }
  const isWorthKeeping = looked.why === 'dayIsNotKnown' || looked.why === 'tookTooLong';
  const ownFilter: OwnFilter = {
    ...ownFilterFromAnswer(
      state,
      reads,
      nextOwnFilterKey(state),
      {
        kind: 'answered',
        found: held,
        filter: isWorthKeeping ? filter : null,
        rows: null,
      },
      sortBy === null
        ? null
        : {
            by: sortBy,
            said: saidOfSortBy(reads, held, sortBy),
            rows: null,
            isRefused: false,
          },
    ),
    namedViewInHand,
    lookedAtAsOf: NEVER_LOOKED_AT,
  };
  return addOwnFilter(
    state,
    reads,
    isWorthKeeping && filter !== null
      ? {
          ...ownFilter,
          unanswered: {
            why: looked.why,
            tries: 1,
          },
        }
      : ownFilter,
  );
}
export function bringBackOwnFilters(state: PageState, reads: ReadsWithTextMeasurer, heldFilters: KeptOwnFilter[]): PageState {
  const { scrollLeft, scrollTop, notice } = state;
  const stateWithFilters = heldFilters.reduce((stateSoFar, held) => bringBackOwnFilter(stateSoFar, reads, held), state);
  let noticeAfter = stateWithFilters.notice?.kind === 'ownSortIsOver' ? stateWithFilters.notice : notice;
  return clampScrollOfView(
    {
      ...stateWithFilters,
      scrollLeft,
      scrollTop,
      notice: noticeAfter,
    },
    reads,
  );
}
export const ownFilterOfTable = (state: Pick<PageState, 'ownFilters'>, filterTable: FilterTable): OwnFilter | null =>
  ownFiltersOfSheet(state, filterTable.table.sheetId).find(
    (ownFilter) =>
      filterTable.cellTableId === null ? isSameByJson(ownFilter.cellTable, filterTable.cellTable) : ownFilter.cellTableId === filterTable.cellTableId,
  ) ?? null;
export const isCellInFilterRecords = (reads: WorkbookReads, ownFilter: TableToFilter, cellId: CellId): boolean => {
  const [recordsArea, cellArea] = [ownFilterRecordsArea(reads, ownFilter), mergedAreaOrCellOf(reads, cellId)];
  return recordsArea !== null && cellArea !== null && areasOverlap(recordsArea, cellArea);
};
export const filterValueOfCell = (reads: WorkbookReads, cellId: CellId): ValueContents | null => {
  const cell = reads.cellOnShowIn(cellId);
  return isCellShownBlank(cell) ? null : cellValueOf(cell);
};
export const dropUnusedOwnFilter = (state: PageState, reads: ReadsWithTextMeasurer, key: string): PageState =>
  isOwnFilterKeyUnused(state, key)
    ? clearOwnFilters(state, reads, {
        tableKey: key,
      })
    : state;
export const ownFiltersToKeep = (state: Pick<PageState, 'ownFilters'>): OwnFilterToKeep[] =>
  allOwnFilters(state).map(
    ({
      cellTableId,
      cellTable,
      liveCellTable,
      table,
      columns,
      filter,
      sort,
      namedViewInHand,
    }) => ({
      cellTableId,
      cellTable,
      liveCellTable,
      table,
      columns,
      filter,
      sortBy: sort?.by ?? null,
      namedViewInHand,
    }),
  );
