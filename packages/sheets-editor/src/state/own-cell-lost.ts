import type { PageState } from './initial-state.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import { findSheetById } from '../grid/layout.ts';
import { mergedAreaOrCellOf, selectedArea, isSameArea } from '../selection/model.ts';
import { hasOtherRanges } from '../selection/several-ranges.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
import type { PageTransition } from './transitions.ts';
import type { SortEdit } from '../tables/sort.ts';
import { sheetOfViewOrEmpty } from '../grid/layout.ts';
import {
  refreshStaleOwnFilters,
  ownFilterAtCell,
  filterTableAtCell,
  ownFilterTableArea,
  isOwnFilterSortable,
  addOwnFilterForTable,
  sortOwnFilter,
} from '../tables/own-filters.ts';
import type { SortKeyOfColumn } from './event-reducer.ts';
import { ownFilterRecordsArea } from '../tables/own-filter-actions.ts';
import { sortMovesWholeRows, type SortsFor } from '../tables/sort-pane.ts';
import { areaOfFilteredTable } from '../tables/finding.ts';
import { recordsSortableAsCells } from '../tables/table-to-sort.ts';
import { readsAsStored } from '../model/workbook.ts';
export function ownCellLostNotice(stateBefore: PageState, readsBefore: WorkbookReads, state: PageState, reads: WorkbookReads): OwnCellLost | null {
  if (stateBefore.mode.kind !== 'navigating') return null;
  if (findSheetById(reads, stateBefore.sheetId) === undefined) {
    let sheetName = findSheetById(reads, state.sheetId)?.name;
    return sheetName === undefined
      ? null
      : {
          what: 'ownSheetRemoved',
          name: sheetName,
        };
  }
  let areaBefore = mergedAreaOrCellOf(readsBefore, stateBefore.activeCell);
  let area = mergedAreaOrCellOf(reads, state.activeCell);
  let areaSelected = selectedArea(state, reads);
  if (state.sheetId !== stateBefore.sheetId || areaBefore === null || area === null || areaSelected === null) return null;
  if (hasOtherRanges(state) || !isSameArea(area, areaSelected)) return null;
  let cellAddress = areaToA1AsStored(
    {
      ...area,
      rowCount: 1,
      columnCount: 1,
    },
    ownRowOrderOfSheet(reads, state.sheetId),
  );
  if (reads.positionOfCell(stateBefore.activeCell) === null)
    return {
      what: 'ownCellRemoved',
      cell: cellAddress,
    };
  return areaBefore.topRowIndex === area.topRowIndex && areaBefore.leftColumnIndex === area.leftColumnIndex
    ? null
    : {
        what: 'ownCellMoved',
        cell: cellAddress,
      };
}
/**
 * The own sort of a table the page's user may take in place of a sort of rows
 * or cells for everyone: the state with that table's own filter sorted the
 * same way, or `null` where the sort is not of one whole table.
 */
export function ownSortInsteadOfSort(state: PageState, reads: ReadsWithTextMeasurer, edit: SortEdit): PageState | null {
  let { sheetId } = state;
  let [oneRow, otherRow] = edit.kind === 'sortRows' ? [edit.oneRow, edit.otherRow] : [edit.cells.oneCorner.r, edit.cells.otherCorner.r];
  let [oneRowIndex, otherRowIndex] = [reads.rowIndexOf(sheetId, oneRow), reads.rowIndexOf(sheetId, otherRow)];
  let byColumnIndex = reads.columnIndexOf(sheetId, edit.byColumn);
  if (oneRowIndex === null || otherRowIndex === null || byColumnIndex === null) return null;
  let firstRowIndex = Math.max(oneRowIndex, sheetOfViewOrEmpty(state, reads).frozenRowCount);
  let cell = reads.cellIdAt(sheetId, firstRowIndex, byColumnIndex);
  if (cell === null) return null;
  let refreshed = refreshStaleOwnFilters(state, reads, sheetId);
  let ownFilter = ownFilterAtCell(refreshed, reads, cell);
  let filter = ownFilter ?? filterTableAtCell(reads, cell);
  if (filter === null || (ownFilter === null && !filter.table.header.isSure)) return null;
  let [recordsArea, tableArea] = [ownFilterRecordsArea(reads, filter), ownFilterTableArea(reads, filter)];
  if (recordsArea === null || tableArea === null || !isOwnFilterSortable(reads, filter)) return null;
  let sortKeys: SortKeyOfColumn[] = [
    {
      c: edit.byColumn,
      direction: edit.direction,
    },
    ...(edit.thenBy ?? []).map(({ byColumn, direction }) => ({
      c: byColumn,
      direction,
    })),
  ];
  let sortedArea = edit.kind === 'sortRows' ? tableArea : recordsArea;
  let rowAfterTable = sortedArea.topRowIndex + sortedArea.rowCount;
  let rowsPastTable = {
    topRowIndex: rowAfterTable,
    rowCount: otherRowIndex + 1 - rowAfterTable,
    leftColumnIndex: 0,
    columnCount: 1 / 0,
  };
  let columnIndexOfCorner = (corner: 'oneCorner' | 'otherCorner'): number | null =>
    edit.kind === 'sortCells' ? reads.columnIndexOf(sheetId, edit.cells[corner].c) : null;
  let movesWholeRows = sortMovesWholeRows(reads, sheetId, recordsArea);
  let filteredTable = areaOfFilteredTable(reads, filter);
  let isSortOfWholeRecords = (): boolean =>
    edit.kind === 'sortRows'
      ? movesWholeRows ||
        (filteredTable !== null &&
          recordsSortableAsCells(refreshed, readsAsStored(reads), {
            table: filteredTable,
            records: recordsArea,
          }) !== null)
      : movesWholeRows &&
        (columnIndexOfCorner('oneCorner') ?? 1 / 0) <= recordsArea.leftColumnIndex &&
        (columnIndexOfCorner('otherCorner') ?? -1) >= recordsArea.leftColumnIndex + recordsArea.columnCount - 1;
  if (
    firstRowIndex !== recordsArea.topRowIndex ||
    otherRowIndex < recordsArea.topRowIndex + recordsArea.rowCount - 1 ||
    !sortKeys.every(({ c: columnId }) => filter.columns.some((column) => column.c === columnId)) ||
    (rowsPastTable.rowCount > 0 && reads.areaOnShowIn(sheetId, rowsPastTable) !== null) ||
    !isSortOfWholeRecords()
  )
    return null;
  let withFilter = ownFilter === null ? addOwnFilterForTable(refreshed, reads, filter) : refreshed;
  let filterToSort = ownFilter ?? ownFilterAtCell(withFilter, reads, cell);
  return filterToSort === null ? null : sortOwnFilter(withFilter, reads, filterToSort, sortKeys);
}
/** The own sort a step that sorts for everyone could be taken as instead, or `null`. */
export function ownSortOfSortStep(step: PageTransition, reads: ReadsWithTextMeasurer): PageState | null {
  let edit = sortEditOfStep(step);
  return edit === null ? null : ownSortInsteadOfSort(step.state, reads, edit);
}
/** The sort a step queues as its one effect, or `null` where it queues none. */
export const sortEditOfStep = ({ effects: [effect] }: PageTransition): SortEdit | null =>
  effect?.kind === 'queueEdit' && (effect.edit.kind === 'sortRows' || effect.edit.kind === 'sortCells') ? effect.edit : null;
/** Whom a step's sort could be for: `null` where it sorts nothing. */
export const whomSortOfStepIsFor = (step: PageTransition, reads: ReadsWithTextMeasurer): SortsFor | null =>
  sortEditOfStep(step) === null ? null : ownSortOfSortStep(step, reads) === null ? 'everyone' : 'oneself';
/** Whom a sort is for: the sheet as everyone sees it, or only the page's own view of a table. */
/** What was done last when the page's own cell went away under an edit not asked for here: told to screen readers. */
export type OwnCellLost =
  | { what: 'ownSheetRemoved'; name: string }
  | { what: 'ownCellRemoved' | 'ownCellMoved'; cell: string };
