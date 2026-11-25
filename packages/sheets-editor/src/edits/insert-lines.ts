import type { Edit, SheetId } from '@open-artifact/sheets-core';
import { toggleableCheckboxValue } from '../chips/checkbox-presses.ts';
import { isLineShown } from '../model/line-sizes.ts';
import { selectedArea } from '../selection/model.ts';
import { withNoEffects } from '../state/transitions.ts';
import { shownRowCountIn } from '../tables/filtered-rows.ts';
import { IF_QUEUED_DEFAULTS, queueEdit } from '../model/edit-effects.ts';
import { layoutOfView } from '../grid/layout.ts';
import { isRowHeaderOfTables } from '../tables/tables-in-view.ts';
import type { PageState, RowAddedAfterEntries } from '../state/initial-state.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { IfQueued, PageEvent } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { GridLayout } from '../grid/layout.ts';
import type { CellArea } from '../selection/model.ts';
import type { CellId } from '../model/workbook.ts';
/** A command that inserts rows or columns beside the selection. */
export type InsertLinesCommand = 'insertRowAbove' | 'insertRowBelow' | 'insertColumnLeft' | 'insertColumnRight';
export function mostRowsToInsert(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): number {
  let checkboxCount = workbook
    .filledCellsIn(sheetId, area)
    .filter((cellId) => toggleableCheckboxValue(workbook, cellId) !== null).length;
  return Math.floor(workbook.mostCheckboxesOfOneInsert() / checkboxCount);
}
export function noteRowAddedAfterEntry(state: PageState, event: PageEvent, workbook: WorkbookReads): PageState {
  if (event.kind !== 'editAnswered' || event.ifQueued.entryBeforeLine === undefined) return state;
  if (event.edit.kind !== 'insertRows' || event.outcome.kind !== 'editQueued') return state;
  let { sheetId } = event.edit;
  let area = event.outcome.placeChanged?.area ?? null;
  let rowId = area === null ? undefined : workbook.cellIdAt(sheetId, area.topRowIndex, 0)?.rowId;
  if (rowId === undefined) return state;
  let isOnSheet = (rowAdded: RowAddedAfterEntries) => rowAdded.sheetId === sheetId;
  let otherSheets = state.rowsAddedAfterEntries.filter((rowAdded) => !isOnSheet(rowAdded));
  let onSheet = [
    ...state.rowsAddedAfterEntries.filter(isOnSheet),
    {
      sheetId,
      rowId,
    },
  ];
  return {
    ...state,
    rowsAddedAfterEntries: [...otherSheets, ...onSheet.slice(-MAX_ROWS_ADDED_AFTER_ENTRIES)],
  };
}
export function isRowAddedAfterEntry(
  { sheetId, rowsAddedAfterEntries }: Pick<PageState, 'sheetId' | 'rowsAddedAfterEntries'>,
  workbook: WorkbookReads,
  { columnCount, rowEdges }: Pick<GridLayout, 'columnCount' | 'rowEdges'>,
  rowIndex: number,
): boolean {
  if (rowsAddedAfterEntries.length === 0 || rowIndex < 1) return false;
  let rowId = workbook.cellIdAt(sheetId, rowIndex, 0)?.rowId;
  let rowArea = {
    topRowIndex: rowIndex,
    leftColumnIndex: 0,
    rowCount: 1,
    columnCount,
  };
  let isBlankUnderFilledCell = (cellId: CellId) => {
    let columnIndex = workbook.positionOfCell(cellId)?.columnIndex;
    let cellAbove = columnIndex === undefined ? null : workbook.cellIdAt(sheetId, rowIndex - 1, columnIndex);
    return toggleableCheckboxValue(workbook, cellId) === false && cellAbove !== null && toggleableCheckboxValue(workbook, cellAbove) !== null;
  };
  return (
    rowsAddedAfterEntries.some((rowAdded) => rowAdded.sheetId === sheetId && rowAdded.rowId === rowId) &&
    isLineShown(rowEdges, rowIndex) &&
    workbook.cellsOnShowIn(sheetId, rowArea).every(isBlankUnderFilledCell) &&
    workbook.mergedAreasIn(sheetId, rowArea).length === 0
  );
}
export function skipRowsAddedAfterEntries(
  state: Pick<PageState, 'sheetId' | 'rowsAddedAfterEntries'>,
  workbook: WorkbookReads,
  layout: Pick<GridLayout, 'columnCount' | 'rowEdges'>,
  rowIndex: number,
): number {
  let index = rowIndex;
  while (isRowAddedAfterEntry(state, workbook, layout, index)) index -= 1;
  return index;
}
export function continuesRowBands(workbook: WorkbookReads, sheetId: SheetId, rowIndex: number, step: number): boolean {
  let isRowFilled = (index: number) => workbook.columnIndexesOnShowIn(sheetId, index).length > 0;
  if (!isRowFilled(rowIndex) || isRowFilled(rowIndex - step)) return false;
  let neighborRowIndex = rowIndex + step;
  let farRowIndex = neighborRowIndex;
  while (!isRowFilled(farRowIndex) && workbook.cellIdAt(sheetId, farRowIndex, 0) !== null) farRowIndex += step;
  let matchesNeighborLook = (index: number) =>
    isRowFilled(index) && workbook.lookOfRow(sheetId, index) === workbook.lookOfRow(sheetId, neighborRowIndex);
  return (
    matchesNeighborLook(farRowIndex) &&
    (matchesNeighborLook(farRowIndex + step) || (isRowFilled(farRowIndex + step) && matchesNeighborLook(farRowIndex + 2 * step)))
  );
}
export function insertRowsOrColumns(state: PageState, workbook: ReadsWithTextMeasurer, command: InsertLinesCommand): PageTransition {
  let area = selectedArea(state, workbook);
  if (area === null) return withNoEffects(state);
  let { sheetId, activeCell, selectionCorner, rangeWalked } = state;
  let isRows = command === 'insertRowAbove' || command === 'insertRowBelow';
  let isBefore = command === 'insertRowAbove' || command === 'insertColumnLeft';
  let startIndex = isRows ? area.topRowIndex : area.leftColumnIndex;
  let lineCount = isRows ? area.rowCount : area.columnCount;
  let count = isRows ? shownRowCountIn(state, workbook, area) : lineCount;
  let insertIndex = isBefore ? startIndex : startIndex + lineCount;
  let cellBefore = isRows ? workbook.cellIdAt(sheetId, insertIndex - 1, 0) : workbook.cellIdAt(sheetId, 0, insertIndex - 1);
  let neighborIndex = isBefore ? insertIndex : insertIndex - 1;
  let neighborCell = isRows ? workbook.cellIdAt(sheetId, neighborIndex, 0) : workbook.cellIdAt(sheetId, 0, neighborIndex);
  let step = isBefore ? -1 : 1;
  let select = isRows
    ? {
        ...area,
        topRowIndex: insertIndex,
        rowCount: count,
      }
    : {
        ...area,
        leftColumnIndex: insertIndex,
      };
  let ifQueued: IfQueued = {
    ...IF_QUEUED_DEFAULTS,
    undoSelects: {
      activeCell,
      selectionCorner,
      rangeWalked,
    },
    select,
    done: {
      what: isRows ? 'rowsInserted' : 'columnsInserted',
    },
  };
  if (!isRows)
    return queueEdit(
      state,
      {
        kind: 'insertColumns',
        sheetId,
        afterColumn: cellBefore?.columnId ?? null,
        count,
        formatsFromColumn: neighborCell?.columnId ?? null,
        groupsFromColumn: neighborCell?.columnId ?? null,
      },
      ifQueued,
    );
  let layout = layoutOfView(state, workbook);
  let isAfterAddedRow = isBefore && isRowAddedAfterEntry(state, workbook, layout, neighborIndex);
  let formulasRowIndex = continuesRowBands(workbook, sheetId, neighborIndex, step) || isAfterAddedRow ? neighborIndex + step : neighborIndex;
  let formulasCell =
    isBefore && isRowHeaderOfTables(neighborIndex, state, workbook) ? null : workbook.cellIdAt(sheetId, formulasRowIndex, 0);
  return queueEdit(
    state,
    {
      kind: 'insertRows',
      sheetId,
      afterRow: cellBefore?.rowId ?? null,
      count,
      formatsFromRow: formulasCell?.rowId ?? null,
      groupsFromRow: neighborCell?.rowId ?? null,
      formulasFromRow: formulasCell?.rowId ?? null,
    },
    ifQueued,
  );
}
export const givesNewRowsFormulas = (edit: Edit): boolean =>
 edit.kind === 'insertRows' && (edit.formulasFromRow ?? null) !== null;
export const MAX_ROWS_ADDED_AFTER_ENTRIES = 3;
