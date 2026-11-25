import type { CellAt, CellBlock, IdRun, RowId, SheetId } from '@open-artifact/sheets-core';
import type { LineSpan } from './line-ids.ts';
import type { WorkbookReads } from './workbook.ts';
import type { CellSelection } from '../selection/model.ts';
import type { PageState } from '../state/initial-state.ts';
/** Two cells of a sheet, by their places, at the corners of a block of cells. */
export interface CornersOfCells {
  sheetId: SheetId;
  oneCorner: CellAt;
  otherCorner: CellAt;
}
/** The rows a paste or a move may land in when rows filtered out of view are in its way; nothing when none are. */
export interface RowsToLandInPastFilters {
  mayLandIn?: IdRun[];
}
import { clipIndexRuns } from '../grid/line-runs.ts';
import { rowsHiddenByOwnFilters } from '../grid/layout.ts';
import { selectedRangeOf } from './edit-effects.ts';
import { isSelectionOneCell } from '../selection/keyboard.ts';
import { selectedArea } from '../selection/model.ts';
export function rowSpanBetween(reads: WorkbookReads, sheetId: SheetId, oneRowId: RowId, otherRowId: RowId): LineSpan | null {
  let rows = reads.linesOf(sheetId)?.rows;
  let [oneIndex, otherIndex] = [rows?.indexOf(oneRowId) ?? null, rows?.indexOf(otherRowId) ?? null];
  return oneIndex === null || otherIndex === null
    ? null
    : {
        firstIndex: Math.min(oneIndex, otherIndex),
        count: Math.abs(oneIndex - otherIndex) + 1,
      };
}
export function spansLeftByOwnFilters(state: PageState, reads: WorkbookReads, sheetId: SheetId, span: LineSpan): LineSpan[] {
  let filteredRuns = clipIndexRuns(rowsHiddenByOwnFilters(state, reads, sheetId), span);
  if (filteredRuns.length === 0) return [span];
  let pieces: LineSpan[] = [];
  let { firstIndex: nextFirst } = span;
  for (let run of [
    ...filteredRuns,
    {
      firstIndex: span.firstIndex + span.count,
      count: 0,
    },
  ]) {
    if (run.firstIndex > nextFirst)
      pieces.push({
        firstIndex: nextFirst,
        count: run.firstIndex - nextFirst,
      });
    nextFirst = run.firstIndex + run.count;
  }
  return pieces;
}
export function rowRunsOfSpans(reads: WorkbookReads, sheetId: SheetId, spans: readonly LineSpan[]): IdRun[] | null {
  let rows = reads.linesOf(sheetId)?.rows;
  let [firstRun, ...moreRuns] = spans.flatMap((span) => rows?.runsIn(span) ?? []);
  return firstRun === undefined ? null : [firstRun, ...moreRuns];
}
export function cellBlockOfCorners(reads: WorkbookReads, { sheetId, oneCorner, otherCorner }: CornersOfCells): CellBlock | null {
  let span = rowSpanBetween(reads, sheetId, oneCorner.r, otherCorner.r);
  let runs = span === null ? null : rowRunsOfSpans(reads, sheetId, [span]);
  return runs === null
    ? null
    : {
        sheetId,
        rows: runs,
        oneColumn: oneCorner.c,
        otherColumn: otherCorner.c,
      };
}
export function shownRowRunsBetween(state: PageState, reads: WorkbookReads, sheetId: SheetId, oneRowId: RowId, otherRowId: RowId): IdRun[] | null {
  let span = rowSpanBetween(reads, sheetId, oneRowId, otherRowId);
  return span === null ? null : shownRowRunsOfSpan(state, reads, sheetId, span);
}
export function shownCellBlockOfCorners(
  state: PageState,
  reads: WorkbookReads,
  { sheetId, oneCorner, otherCorner }: CornersOfCells,
): CellBlock | null {
  let runs = shownRowRunsBetween(state, reads, sheetId, oneCorner.r, otherCorner.r);
  return runs === null
    ? null
    : {
        sheetId,
        rows: runs,
        oneColumn: oneCorner.c,
        otherColumn: otherCorner.c,
      };
}
export function hasNoFilteredRowsBetween(state: PageState, reads: WorkbookReads, sheetId: SheetId, oneRowId: RowId, otherRowId: RowId): boolean {
  let span = rowSpanBetween(reads, sheetId, oneRowId, otherRowId);
  let filteredRuns = rowsHiddenByOwnFilters(state, reads, sheetId);
  return span !== null && clipIndexRuns(filteredRuns, span).length === 0;
}
export function cellBlockOfSelection(state: PageState, reads: WorkbookReads, selection: CellSelection): CellBlock | null {
  let corners = selectedRangeOf(selection);
  if (!isSelectionOneCell(selection, reads)) return shownCellBlockOfCorners(state, reads, corners);
  let mergedArea = selectedArea(selection, reads);
  let rowSpan =
    mergedArea === null
      ? null
      : {
          firstIndex: mergedArea.topRowIndex,
          count: mergedArea.rowCount,
        };
  return rowSpan !== null && spansLeftByOwnFilters(state, reads, corners.sheetId, rowSpan).length > 0 ? cellBlockOfCorners(reads, corners) : null;
}
export function unbrokenCellBlockOfCorners(state: PageState, reads: WorkbookReads, block: CornersOfCells): CellBlock | null {
  let { sheetId, oneCorner, otherCorner } = block;
  let selection: CellSelection = {
    activeCell: {
      sheetId,
      rowId: oneCorner.r,
      columnId: oneCorner.c,
    },
    selectionCorner: {
      sheetId,
      rowId: otherCorner.r,
      columnId: otherCorner.c,
    },
    rangeWalked: null,
  };
  if (isSelectionOneCell(selection, reads)) return cellBlockOfSelection(state, reads, selection);
  return hasNoFilteredRowsBetween(state, reads, sheetId, oneCorner.r, otherCorner.r) ? cellBlockOfCorners(reads, block) : null;
}
export function landingRowsSkippingFilters(
  state: PageState,
  reads: WorkbookReads,
  sheetId: SheetId,
  rowId: RowId,
  maxCount: number | null,
): RowsToLandInPastFilters | null {
  let rows = reads.linesOf(sheetId)?.rows;
  let rowIndex = rows?.indexOf(rowId) ?? null;
  if (rows === undefined || rowIndex === null) return {};
  if (rowsHiddenByOwnFilters(state, reads, sheetId).length === 0) return {};
  let span = {
    firstIndex: rowIndex,
    count: Math.min(rows.count - rowIndex, maxCount ?? 1 / 0),
  };
  let [firstPiece] = spansLeftByOwnFilters(state, reads, sheetId, span);
  let runs = firstPiece?.firstIndex === rowIndex ? rowRunsOfSpans(reads, sheetId, [firstPiece]) : null;
  return runs === null
    ? null
    : {
        mayLandIn: runs,
      };
}
export const shownRowRunsOfSpan = (state: PageState, reads: WorkbookReads, sheetId: SheetId, span: LineSpan): IdRun[] | null =>
  rowRunsOfSpans(reads, sheetId, spansLeftByOwnFilters(state, reads, sheetId, span));
export const rowCountOfRuns = (runs: readonly IdRun[]): number =>
  runs.reduce((total, { count }) => total + count, 0);
