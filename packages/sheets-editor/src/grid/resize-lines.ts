import type { ColumnId, Edit, RowId, SheetId } from '@open-artifact/sheets-core';
import { shownRowRunsBetween } from '../model/cell-blocks.ts';
import { selectedArea, selectionOfArea, selectionAreaAndKind } from '../selection/model.ts';
import { withNoEffects } from '../state/transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS, holdUntilAnswered } from '../model/edit-effects.ts';
import { layoutOfView, lineBeingResized, clampScrollOfView } from './layout.ts';
import { rangeSpansOnScreen, isSpanEndInSight, rowResizeLineAt, columnResizeLineAt, clampColumnWidth, clampRowHeight } from './geometry.ts';
import { ROW_HEADER_WIDTH } from './cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT } from './cell-metrics.ts';
import { isRowUnderStuckHeader } from './sticky-headers.ts';
import type { PageState } from '../state/initial-state.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellSelection } from '../selection/model.ts';
import type { LineToResize, ResizingDrag } from '../selection/pointer.ts';
import type { PagePoint } from '../comments/page-comments.ts';
import type { DoneWithDetail, PageContext, PointerPressed } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
export type SetRowHeightsEdit = Extract<Edit, { kind: 'setRowHeights' }>;
export type SetColumnWidthsEdit = Extract<Edit, { kind: 'setColumnWidths' }>;
/** An edit that sizes rows or columns, or fits columns to their text. */
export type LineSizeEdit = Extract<Edit, { kind: 'setRowHeights' | 'setColumnWidths' | 'fitColumns' }>;
export type RowToResize = Extract<LineToResize, { isA: 'row' }>;
export type ColumnToResize = Extract<LineToResize, { isA: 'column' }>;
/** A pointer over the grid, and whether it is a finger and was told of late. */
export type PointerOverLines = PagePoint & Pick<PointerPressed, 'isByFinger' | 'isToldOfLate'>;
/** The last shown column of a selection of columns, and where its right edge is on screen. */
export interface ColumnEdgeInSight {
  columnIndex: number;
  edge: number;
  showFrom: number;
}
/** The row or column edge under the pointer, and its size now. */
export interface LineUnderPointer {
  line: LineToResize;
  sizeInPixels: number;
}
export function setRowHeightsEdit(
  view: PageState,
  reads: WorkbookReads,
  oneRowId: RowId,
  otherRowId: RowId,
  heightInPixels: number | null,
): SetRowHeightsEdit | null {
  let { sheetId } = view;
  let rows = shownRowRunsBetween(view, reads, sheetId, oneRowId, otherRowId);
  return rows === null
    ? null
    : {
        kind: 'setRowHeights',
        sheetId,
        rows,
        heightInPixels,
      };
}
export function resizeSelectedLines(
  state: PageState,
  reads: WorkbookReads,
  editForSelection: (selection: CellSelection) => SetRowHeightsEdit | SetColumnWidthsEdit | null,
): PageTransition {
  let area = selectedArea(state, reads);
  let selection = area === null ? null : selectionOfArea(state, reads, area);
  let edit = selection === null ? null : editForSelection(selection);
  if (edit === null) return withNoEffects(state);
  let done: DoneWithDetail =
    edit.kind === 'setRowHeights'
      ? {
          what: 'rowsSized',
          heightInPixels: edit.heightInPixels,
        }
      : {
          what: 'columnsSized',
          widthInPixels: edit.widthInPixels,
        };
  return queueEdit(state, edit, {
    ...IF_QUEUED_DEFAULTS,
    select: state,
    done,
  });
}
export function lastShownColumnEdge(state: PageState, reads: ReadsWithTextMeasurer, isSuppressed: boolean): ColumnEdgeInSight | null {
  if (isSuppressed || state.mode.kind === 'editing') return null;
  let selectionArea = selectionAreaAndKind(state, reads);
  if (selectionArea?.kind !== 'columns') return null;
  let layout = layoutOfView(state, reads);
  let { across } = rangeSpansOnScreen(selectionArea.area, state, layout, state);
  if (!isSpanEndInSight(across)) return null;
  let columnIndex = selectionArea.area.leftColumnIndex + selectionArea.area.columnCount - 1;
  while (columnIndex >= selectionArea.area.leftColumnIndex && layout.columnEdges.sizeOf(columnIndex) === 0) columnIndex -= 1;
  if (columnIndex < selectionArea.area.leftColumnIndex) return null;
  return {
    columnIndex,
    edge: across.end,
    showFrom: across.showFrom,
  };
}
export function columnResizeUnderFinger(state: PageState, pointer: PagePoint, reads: ReadsWithTextMeasurer): number | null {
  let columnEdge = lastShownColumnEdge(state, reads, false);
  if (columnEdge === null) return null;
  let grab = FINGER_RESIZE_GRAB / state.zoom;
  let { columnEdges, columnCount } = layoutOfView(state, reads);
  let nextColumnIndex = columnEdge.columnIndex + 1;
  while (nextColumnIndex < columnCount && columnEdges.sizeOf(nextColumnIndex) === 0) nextColumnIndex += 1;
  let grabBefore = Math.min(grab, columnEdges.sizeOf(columnEdge.columnIndex) / 3);
  let grabAfter = nextColumnIndex < columnCount ? Math.min(grab, columnEdges.sizeOf(nextColumnIndex) / 3) : 0;
  let x = pointer.x - ROW_HEADER_WIDTH;
  return x >= Math.max(columnEdge.showFrom, columnEdge.edge - grabBefore) &&
    x <= columnEdge.edge + grabAfter &&
    pointer.y < Math.max(COLUMN_HEADER_HEIGHT, 2 * grab)
    ? columnEdge.columnIndex
    : null;
}
export function resizeLineUnderPointer(
  state: PageState,
  pointer: PointerOverLines,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): LineUnderPointer | null {
  if (refusalOfEveryEdit !== null || state.mode.kind === 'editing') return null;
  if (pointer.isByFinger && pointer.isToldOfLate === true) return null;
  let layout = layoutOfView(state, reads);
  let rowLineIndex = pointer.isByFinger ? null : rowResizeLineAt(pointer, state, layout);
  let rowIndex = rowLineIndex !== null && isRowUnderStuckHeader(rowLineIndex, state, reads, layout) ? null : rowLineIndex;
  let columnIndex = pointer.isByFinger ? columnResizeUnderFinger(state, pointer, reads) : columnResizeLineAt(pointer, state, layout);
  let cellId = reads.cellIdAt(state.sheetId, rowIndex ?? 0, columnIndex ?? 0);
  if (cellId === null) return null;
  if (rowIndex !== null)
    return {
      line: {
        isA: 'row',
        rowId: cellId.rowId,
      },
      sizeInPixels: layout.rowEdges.sizeOf(rowIndex),
    };
  if (columnIndex === null) return null;
  return {
    line: {
      isA: 'column',
      columnId: cellId.columnId,
    },
    sizeInPixels: layout.columnEdges.sizeOf(columnIndex),
  };
}
export function selectionCoveringLine(state: PageState, reads: ReadsWithTextMeasurer, line: LineToResize): CellSelection | null {
  let selectionArea = selectionAreaAndKind(state, reads);
  if (selectionArea === null) return null;
  let { area, kind } = selectionArea;
  let layout = layoutOfView(state, reads);
  if (!(area.rowCount === layout.rowCount && area.columnCount === layout.columnCount) && kind !== (line.isA === 'row' ? 'rows' : 'columns'))
    return null;
  let [lineIndex, firstIndex, count] =
    line.isA === 'row'
      ? [reads.rowIndexOf(state.sheetId, line.rowId), area.topRowIndex, area.rowCount]
      : [reads.columnIndexOf(state.sheetId, line.columnId), area.leftColumnIndex, area.columnCount];
  return lineIndex !== null && lineIndex >= firstIndex && lineIndex < firstIndex + count ? selectionOfArea(state, reads, area) : null;
}
export function rowHeightsEditForLine(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  line: RowToResize,
  heightInPixels: number | null,
): SetRowHeightsEdit | null {
  let selection = selectionCoveringLine(state, reads, line);
  return selection === null
    ? setRowHeightsEdit(state, reads, line.rowId, line.rowId, heightInPixels)
    : setRowHeightsEdit(state, reads, selection.activeCell.rowId, selection.selectionCorner.rowId, heightInPixels);
}
export function columnsToResizeForLine(state: PageState, reads: ReadsWithTextMeasurer, line: ColumnToResize): [ColumnId, ColumnId] {
  let selection = selectionCoveringLine(state, reads, line);
  return selection === null ? [line.columnId, line.columnId] : [selection.activeCell.columnId, selection.selectionCorner.columnId];
}
export function finishResizeDrag(
  state: PageState,
  drag: ResizingDrag,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition {
  let { line, sizeAtPress } = drag;
  let view = endDragKeepingScroll(state, reads);
  let sizeInPixels = lineBeingResized(state, reads)?.sizeInPixels;
  let isUnchanged = sizeInPixels === sizeAtPress || drag.sizeInPixels === sizeAtPress;
  if (sizeInPixels === undefined || isUnchanged) return withNoEffects(view);
  if (refusalOfEveryEdit !== null)
    return withNoEffects({
      ...view,
      notice: {
        kind: 'editRefused',
        why: refusalOfEveryEdit,
        asked: 'otherEdit',
      },
    });
  let edit =
    line.isA === 'row'
      ? rowHeightsEditForLine(state, reads, line, sizeInPixels)
      : setColumnWidthsEdit(state.sheetId, ...columnsToResizeForLine(state, reads, line), sizeInPixels);
  return edit === null ? withNoEffects(view) : holdUntilAnswered(queueResizeEdit(view, edit), drag);
}
export function resetRowHeightOnDoublePress(
  state: PageState,
  pointer: PointerOverLines,
  context: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition | null {
  let line = resizeLineUnderPointer(state, pointer, context)?.line;
  if (line?.isA !== 'row') return null;
  let edit = rowHeightsEditForLine(state, context.reads, line, null);
  return edit === null ? withNoEffects(state) : queueResizeEdit(state, edit);
}
export const setColumnWidthsEdit = (sheetId: SheetId, oneColumn: ColumnId, otherColumn: ColumnId, widthInPixels: number): SetColumnWidthsEdit => ({
  kind: 'setColumnWidths',
  sheetId,
  oneColumn,
  otherColumn,
  widthInPixels,
});
export const chooseColumnWidth = (state: PageState, reads: WorkbookReads, widthInPixels: number): PageTransition =>
  resizeSelectedLines(
    state,
    reads,
    ({ activeCell, selectionCorner }) =>
      setColumnWidthsEdit(state.sheetId, activeCell.columnId, selectionCorner.columnId, clampColumnWidth(widthInPixels)),
  );
export const chooseRowHeight = (state: PageState, reads: WorkbookReads, heightInPixels: number | null): PageTransition =>
  resizeSelectedLines(
    state,
    reads,
    ({ activeCell, selectionCorner }) =>
      setRowHeightsEdit(state, reads, activeCell.rowId, selectionCorner.rowId, heightInPixels === null ? null : clampRowHeight(heightInPixels)),
  );
export const FINGER_RESIZE_GRAB = 20;
export const queueResizeEdit = (state: PageState, edit: LineSizeEdit): PageTransition =>
  queueEdit(
    {
      ...state,
      lastDone: null,
    },
    edit,
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: null,
    },
  );
export const endDragKeepingScroll = (state: PageState, reads: ReadsWithTextMeasurer): PageState =>
  clampScrollOfView(
    {
      ...state,
      dragging: null,
    },
    reads,
  );
