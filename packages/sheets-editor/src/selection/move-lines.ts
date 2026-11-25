import type { Edit } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { IfQueued, PageContext, SheetChange } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { GridLayout } from '../grid/layout.ts';
import type { GridHit, GridPoint, LinesAxisName } from '../grid/geometry.ts';
import type { CellArea } from './model.ts';
import { selectedArea, selectionKindOf, scrollToShowPosition, isSameCell, selectionBetweenPositions, selectionAreaAndKind } from './model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { cellsHeightAboveFloats, frozenRowsHeight, cellsAreaWidth, frozenColumnsWidth, isInSpan, dropIndexAtPointer } from '../grid/geometry.ts';
import { heightCoveredByStuckHeaders, bottomOfStuckHeadersInSheet, dragPositionClearOfStuckHeaders } from '../grid/sticky-headers.ts';
import { withNoEffects } from '../state/transitions.ts';
import { isLineShown, shownLineAtOrBefore, shownLineAtOrAfter } from '../model/line-sizes.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** The whole rows or columns selected: which, the first of them, how many, and how many the sheet has. */
export interface SelectedLines {
  what: LinesAxisName;
  first: number;
  count: number;
  lineCount: number;
}
/** An edit that moves whole rows or columns. */
export type MoveLinesEdit = Extract<Edit, { kind: 'moveRows' | 'moveColumns' }>;
/** A command that moves the selected lines one along. */
export type MoveLinesCommand = Extract<SheetChange, 'moveRowsUp' | 'moveRowsDown' | 'moveColumnsLeft' | 'moveColumnsRight'>;
/** The edit that moves whole rows. */
type MoveRowsEdit = Extract<Edit, { kind: 'moveRows' }>;
/** The edit that moves whole columns. */
type MoveColumnsEdit = Extract<Edit, { kind: 'moveColumns' }>;
/** Where lines being dragged would land: after a cell's line, or first. */
export interface LinesLanding {
  after: CellId | null;
}
/** Selected lines dragged by their header to move them. */
export interface MovingLinesDrag {
  kind: 'movingLines';
  what: LinesAxisName;
  pressed: CellId;
  pressedAt: GridPoint;
  landing: LinesLanding | null;
}
export function selectedLines(state: PageState, reads: ReadsWithTextMeasurer): SelectedLines | null {
  let area = selectedArea(state, reads);
  if (area === null) return null;
  let layout = layoutOfView(state, reads);
  let kind = selectionKindOf(area, layout);
  if (kind === 'cells') return null;
  return kind === 'rows'
    ? {
        what: kind,
        first: area.topRowIndex,
        count: area.rowCount,
        lineCount: layout.rowCount,
      }
    : {
        what: kind,
        first: area.leftColumnIndex,
        count: area.columnCount,
        lineCount: layout.columnCount,
      };
}
export function lineIndexOfCell(reads: WorkbookReads, what: LinesAxisName, cellId: CellId): number | null {
  let position = reads.positionOfCell(cellId);
  if (position === null) return null;
  return what === 'rows' ? position.rowIndex : position.columnIndex;
}
export function moveLinesEdit(
  state: PageState,
  reads: WorkbookReads,
  { what, first, count }: Pick<SelectedLines, 'what' | 'first' | 'count'>,
  afterCell: CellId | null,
): MoveLinesEdit | null {
  let firstCell = cellOfLine(state, reads, what, first);
  let lastCell = cellOfLine(state, reads, what, first + count - 1);
  if (firstCell === null || lastCell === null) return null;
  let { sheetId } = state;
  return what === 'rows'
    ? {
        kind: 'moveRows',
        sheetId,
        oneRow: firstCell.rowId,
        otherRow: lastCell.rowId,
        afterRow: afterCell?.rowId ?? null,
      }
    : {
        kind: 'moveColumns',
        sheetId,
        oneColumn: firstCell.columnId,
        otherColumn: lastCell.columnId,
        afterColumn: afterCell?.columnId ?? null,
      };
}
export function mergeBrokenByMove(reads: WorkbookReads, edit: MoveLinesEdit): CellArea | null {
  let { sheetId } = edit;
  let isRows = edit.kind === 'moveRows';
  let sheet = reads.listSheets().find((sheetSummary) => sheetSummary.sheetId === sheetId);
  let [oneIndex, otherIndex, afterIndex] = isRows
    ? [
        reads.rowIndexOf(sheetId, (edit as MoveRowsEdit).oneRow),
        reads.rowIndexOf(sheetId, (edit as MoveRowsEdit).otherRow),
        (edit as MoveRowsEdit).afterRow === null ? -1 : reads.rowIndexOf(sheetId, (edit as MoveRowsEdit).afterRow!),
      ]
    : [
        reads.columnIndexOf(sheetId, (edit as MoveColumnsEdit).oneColumn),
        reads.columnIndexOf(sheetId, (edit as MoveColumnsEdit).otherColumn),
        (edit as MoveColumnsEdit).afterColumn === null ? -1 : reads.columnIndexOf(sheetId, (edit as MoveColumnsEdit).afterColumn!),
      ];
  if (sheet === undefined || oneIndex === null || otherIndex === null || afterIndex === null) return null;
  let [lowIndex, highIndex] = [Math.min(oneIndex, otherIndex), Math.max(oneIndex, otherIndex)];
  let { rowCount, columnCount } = sheet;
  let wholeSheet = {
    topRowIndex: 0,
    leftColumnIndex: 0,
    rowCount,
    columnCount,
  };
  return (
    reads.mergedAreasIn(sheetId, wholeSheet).find((mergedArea) => {
      let start = isRows ? mergedArea.topRowIndex : mergedArea.leftColumnIndex;
      let end = start + (isRows ? mergedArea.rowCount : mergedArea.columnCount) - 1;
      let isOutsideMoved = end < lowIndex || highIndex < start;
      let isSplitByDrop = start <= afterIndex && afterIndex < end;
      let isSplitByMove = start < lowIndex || highIndex < end;
      return isOutsideMoved ? isSplitByDrop : isSplitByMove;
    }) ?? null
  );
}
export function scrollToShowSelectedLines(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  let lines = selectedLines(state, reads);
  if (lines === null) return state;
  let isRows = lines.what === 'rows';
  let layout = layoutOfView(state, reads);
  let [edges, roomInSight] = isRows
    ? [layout.rowEdges, cellsHeightAboveFloats(state) - frozenRowsHeight(layout)]
    : [layout.columnEdges, cellsAreaWidth(state) - frozenColumnsWidth(layout)];
  let linesSize = edges.startOf(lines.first + lines.count) - edges.startOf(lines.first);
  if (linesSize > roomInSight) return state;
  let scrollToLine = (view: PageState, lineIndex: number): PageState =>
    scrollToShowPosition(
      view,
      reads,
      isRows
        ? {
            rowIndex: lineIndex,
            columnIndex: 0,
            isToComeClearOf: 'rowNumbers',
          }
        : {
            rowIndex: 0,
            columnIndex: lineIndex,
          },
      {
        rows: isRows,
        columns: !isRows,
      },
      'key',
    );
  let scrolled = scrollToLine(state, lines.first + lines.count - 1);
  let stuckHeadersHeight = isRows ? heightCoveredByStuckHeaders(scrolled, reads, lines.first, 'rowNumbers', layout) : 0;
  return linesSize > roomInSight - stuckHeadersHeight ? scrolled : scrollToLine(scrolled, lines.first);
}
export function moveLinesByKey(state: PageState, reads: ReadsWithTextMeasurer, command: MoveLinesCommand): PageTransition {
  let lines = selectedLines(state, reads);
  let isRows = command === 'moveRowsUp' || command === 'moveRowsDown';
  if (lines === null || (lines.what === 'rows') !== isRows) return withNoEffects(state);
  let isBackward = command === 'moveRowsUp' || command === 'moveColumnsLeft';
  let neighbourIndex = isBackward ? lines.first - 1 : lines.first + lines.count;
  if (!isInSpan(neighbourIndex, 0, lines.lineCount)) return withNoEffects(state);
  let layout = layoutOfView(state, reads);
  let edges = isRows ? layout.rowEdges : layout.columnEdges;
  let afterIndex = isLineShown(edges, neighbourIndex)
    ? neighbourIndex - (isBackward ? 1 : 0)
    : isBackward
      ? shownLineAtOrBefore(edges, neighbourIndex)
      : shownLineAtOrAfter(edges, neighbourIndex) - 1;
  let edit = moveLinesEdit(state, reads, lines, cellOfLine(state, reads, lines.what, afterIndex));
  return edit === null ? withNoEffects(state) : queueEdit(state, edit, MOVED_IF_QUEUED);
}
export function startMovingLines(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  header: Extract<GridHit, { kind: 'rowHeader' | 'columnHeader' }>,
  pressedAt: GridPoint,
) {
  let lines = selectedWholeLines(state, reads);
  let what: LinesAxisName = header.kind === 'rowHeader' ? 'rows' : 'columns';
  let lineIndex = header.kind === 'rowHeader' ? header.rowIndex : header.columnIndex;
  if (lines?.what !== what || !isInSpan(lineIndex, lines.first, lines.count)) return null;
  let pressedCell = cellOfLine(state, reads, what, lineIndex);
  if (pressedCell === null) return null;
  return {
    ...state,
    menu: null,
    dragging: {
      kind: 'movingLines',
      what,
      pressed: pressedCell,
      pressedAt,
      landing: null,
    } satisfies MovingLinesDrag,
  };
}
export function dropRowClearOfStuckHeaders(
  dropIndex: number,
  { first, count }: Pick<SelectedLines, 'first' | 'count'>,
  view: PageState,
  reads: ReadsWithTextMeasurer,
  layout: GridLayout,
): number {
  if (dropIndex <= layout.frozenRowCount || (dropIndex >= first && dropIndex <= first + count)) return dropIndex;
  let headersBottom = bottomOfStuckHeadersInSheet(view, reads, 'rowNumbers', layout);
  if (headersBottom === null) return dropIndex;
  let rowIndexAtBottom = layout.rowEdges.indexAt(headersBottom);
  let firstRowClear = layout.rowEdges.startOf(rowIndexAtBottom) < headersBottom ? rowIndexAtBottom + 1 : rowIndexAtBottom;
  return Math.max(dropIndex, dropIndex < first ? Math.min(firstRowClear, first) : firstRowClear);
}
export function dragMovingLines(state: PageState, drag: MovingLinesDrag, pointer: GridPoint, reads: ReadsWithTextMeasurer) {
  let { what, pressedAt } = drag;
  if (drag.landing === null && Math.hypot(pointer.x - pressedAt.x, pointer.y - pressedAt.y) < MOVE_LINES_DRAG_THRESHOLD) return state;
  let isRows = what === 'rows';
  let layout = layoutOfView(state, reads);
  let lines: Pick<SelectedLines, 'first' | 'count'> = selectedLines(state, reads) ?? {
    first: 0,
    count: 0,
  };
  let position = dragPositionClearOfStuckHeaders(pointer, state, reads, layout, {
    of: what,
    fromRow: lines.first,
  });
  let scrolled = scrollToShowPosition(
    state,
    reads,
    position,
    {
      rows: isRows,
      columns: !isRows,
    },
    'pointer',
  );
  let dropAtPointer = dropIndexAtPointer(pointer, scrolled, layout, scrolled, what);
  let dropIndex = isRows ? dropRowClearOfStuckHeaders(dropAtPointer, lines, scrolled, reads, layout) : dropAtPointer;
  let afterCell = dropIndex === 0 ? null : cellOfLine(scrolled, reads, what, dropIndex - 1);
  let landing = drag.landing;
  if (
    landing !== null &&
    (afterCell === null || landing.after === null ? afterCell === landing.after : isSameCell(afterCell, landing.after)) &&
    scrolled.scrollTop === state.scrollTop &&
    scrolled.scrollLeft === state.scrollLeft
  )
    return state;
  return {
    ...scrolled,
    dragging: {
      ...drag,
      landing: {
        after: afterCell,
      },
    } satisfies MovingLinesDrag,
  };
}
export function movingLinesDropIndex(state: PageState, reads: ReadsWithTextMeasurer): number | null {
  let { dragging: drag } = state;
  if (drag?.kind !== 'movingLines' || drag.landing === null) return null;
  let lines = selectedLines(state, reads);
  let { after: afterCell } = drag.landing;
  let afterIndex = afterCell === null ? -1 : lineIndexOfCell(reads, drag.what, afterCell);
  if (afterIndex === null || lines?.what !== drag.what) return null;
  let dropIndex = afterIndex + 1;
  return isInSpan(dropIndex, lines.first, lines.count + 1) ? null : dropIndex;
}
export function selectPressedLine(state: PageState, reads: ReadsWithTextMeasurer, { what, pressed }: Pick<MovingLinesDrag, 'what' | 'pressed'>): PageState {
  let lineIndex = lineIndexOfCell(reads, what, pressed);
  if (lineIndex === null) return state;
  let { rowCount, columnCount } = layoutOfView(state, reads);
  let selection =
    what === 'rows'
      ? selectionBetweenPositions(
          state,
          reads,
          {
            rowIndex: lineIndex,
            columnIndex: 0,
          },
          {
            rowIndex: lineIndex,
            columnIndex: columnCount - 1,
          },
        )
      : selectionBetweenPositions(
          state,
          reads,
          {
            rowIndex: 0,
            columnIndex: lineIndex,
          },
          {
            rowIndex: rowCount - 1,
            columnIndex: lineIndex,
          },
        );
  return {
    ...state,
    ...selection,
  };
}
export function finishMovingLines(
  state: PageState,
  drag: MovingLinesDrag,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition {
  let view = endLinesDrag(state);
  if (drag.landing === null) return withNoEffects(selectPressedLine(view, reads, drag));
  let lines = selectedLines(state, reads);
  if (lines === null || movingLinesDropIndex(state, reads) === null) return withNoEffects(view);
  if (refusalOfEveryEdit !== null)
    return withNoEffects({
      ...view,
      notice: {
        kind: 'editRefused',
        why: refusalOfEveryEdit,
        asked: 'otherEdit',
      },
    });
  let edit = moveLinesEdit(view, reads, lines, drag.landing.after);
  return edit === null ? withNoEffects(view) : queueEdit(view, edit, MOVED_IF_QUEUED);
}
export const selectedWholeLines = (state: PageState, reads: ReadsWithTextMeasurer): SelectedLines | null =>
  selectionAreaAndKind(state, reads)?.kind === 'cells' ? null : selectedLines(state, reads);
export const cellOfLine = ({ sheetId }: Pick<PageState, 'sheetId'>, reads: WorkbookReads, what: LinesAxisName, lineIndex: number): CellId | null =>
  what === 'rows' ? reads.cellIdAt(sheetId, lineIndex, 0) : reads.cellIdAt(sheetId, 0, lineIndex);
export const MOVED_IF_QUEUED = {
  ...IF_QUEUED_DEFAULTS,
  select: null,
  done: 'moved',
} satisfies IfQueued;
export const MOVE_LINES_DRAG_THRESHOLD = 4;
export const endLinesDrag = (state: PageState): PageState => ({
  ...state,
  dragging: null,
});
