import type { Edit } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { FilledByFingerOffer, PageState } from '../state/initial-state.ts';
import type { PageContext, PointerPressed } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { AutoscrollDirection, GridPoint, LinesAxisName, LinesUnderFrozen, PaneRect, SpanOnScreen } from '../grid/geometry.ts';
import type { CellArea, CellPosition } from './model.ts';
import { isIdleOrTapping, withNoEffects } from '../state/transitions.ts';
import {
  isPeopleListOnActiveCell,
  selectedArea,
  scrollToShowPosition,
  isSameCell,
  selectionOfArea,
  isSameArea,
  selectionKindOf,
  isSameSelection,
} from './model.ts';
import {
  rangeSpansOnScreen,
  isSpanEndInSight,
  paneRect,
  scrollPositionInLines,
  cellUnderPointer,
  clampPointToCells,
  layoutForNarrowTouch,
  cellInSight,
  DRAG_START_DISTANCE,
  autoscrollPointPastEdge,
  frozenRowsHeight,
  frozenColumnsWidth,
} from '../grid/geometry.ts';
import { layoutOfView } from '../grid/layout.ts';
import { ROW_HEADER_WIDTH } from '../grid/cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT } from '../grid/cell-metrics.ts';
import { isPointerOverFrozenRows, dragPositionClearOfStuckHeaders, pointedPositionClearOfStuckHeaders } from '../grid/sticky-headers.ts';
import { shownLineAtOrBefore } from '../model/line-sizes.ts';
import { shownCellBlockOfCorners, shownRowRunsOfSpan } from '../model/cell-blocks.ts';
import { selectedRangeOf, queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { trimAreaToShownRows, lastShownRowIndex } from '../tables/filtered-rows.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { lastRowOfDataBelow } from './jumps.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** The fill handle's box on the grid, and the pane it shows in. */
export interface FillHandleBox extends PaneRect {
  showsIn: PaneRect;
}
/** The fill handle dragged: where it was pressed, the cell pointed at, which way the pointer is further out, and the finger's tap and grip. */
export interface FillingDrag {
  kind: 'filling';
  pressedAt: GridPoint;
  pointedAt: CellId | null;
  isMoreAcross: boolean;
  tap: PointerPressed | null;
  grip: GridPoint | null;
}
/** The edit that fills cells from a source. */
export type FillCellsEdit = Extract<Edit, { kind: 'fillCells' }>;
/** What the edit and the rules a fill goes by need of the page. */
export type FillContext = Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>;
/** The frozen lines of each axis, and how many scrolled lines are under them. */
export type FrozenOfAxes = Record<LinesAxisName, LinesUnderFrozen>;
export function fillHandleBox(state: PageState, reads: ReadsWithTextMeasurer, isReadOnly: boolean, size: number = FILL_HANDLE_SIZE): FillHandleBox | null {
  let isOneArea = isIdleOrTapping(state) || state.dragging?.kind === 'filling';
  if (isReadOnly || !isOneArea || state.mode.kind !== 'navigating' || state.menu !== null) return null;
  if (isPeopleListOnActiveCell(state, reads)) return null;
  if (state.otherRanges.length > 0) return null;
  let area = selectedArea(state, reads);
  if (area === null) return null;
  let { across, down } = rangeSpansOnScreen(area, state, layoutOfView(state, reads), state);
  if (!isSpanEndInSight(across) || !isSpanEndInSight(down)) return null;
  let [right, bottom] = [across.end, down.end];
  return {
    left: right - 1 - size / 2,
    top: bottom - 1 - size / 2,
    width: size,
    height: size,
    showsIn: paneRect(across, down),
  };
}
export function isPointOnFillHandle(
  state: PageState,
  point: GridPoint,
  { reads, refusalOfEveryEdit }: FillContext,
  isByFinger: boolean = false,
): boolean {
  let handle = fillHandleBox(state, reads, refusalOfEveryEdit !== null, isByFinger ? FILL_HANDLE_TOUCH_SIZE : FILL_HANDLE_SIZE);
  let x = point.x - ROW_HEADER_WIDTH;
  let y = point.y - COLUMN_HEADER_HEIGHT;
  return (
    handle !== null &&
    x >= Math.max(handle.showsIn.left, handle.left) &&
    x < handle.left + handle.width &&
    y >= Math.max(handle.showsIn.top, handle.top) &&
    y < handle.top + handle.height
  );
}
export function startFillDragByFinger(state: PageState, tap: PointerPressed, workbook: FillContext) {
  let handle = fillHandleBox(state, workbook.reads, workbook.refusalOfEveryEdit !== null);
  let isFingerTap = tap.isByFinger && tap.isToldOfLate !== true;
  if (handle === null || !isFingerTap || !isPointOnFillHandle(state, tap, workbook, true)) return null;
  let grip = {
    x: tap.x - (ROW_HEADER_WIDTH + handle.left + handle.width / 2),
    y: tap.y - (COLUMN_HEADER_HEIGHT + handle.top + handle.height / 2),
  };
  let pressedAt = {
    x: tap.x,
    y: tap.y,
  };
  return {
    ...state,
    dragging: {
      kind: 'filling',
      pressedAt,
      pointedAt: null,
      isMoreAcross: false,
      tap,
      grip,
    } satisfies FillingDrag,
  };
}
export function linesPastFrozen(offset: number, edgeIndex: number, { frozenCount, under }: LinesUnderFrozen): number {
  if (offset === 0) return 0;
  let [first, last] = offset > 0 ? [edgeIndex + 1, edgeIndex + offset] : [edgeIndex + offset, edgeIndex - 1];
  let frozenOverlap = Math.min(last, frozenCount + under - 1) - Math.max(first, frozenCount) + 1;
  return Math.max(1, Math.abs(offset) - Math.max(0, frozenOverlap));
}
export function grownFillArea(
  area: CellArea,
  { rowIndex, columnIndex }: CellPosition,
  isMoreAcross: boolean,
  frozen: FrozenOfAxes,
): CellArea | null {
  let rowOffset = offsetOutsideSpan(rowIndex, area.topRowIndex, area.rowCount);
  let columnOffset = offsetOutsideSpan(columnIndex, area.leftColumnIndex, area.columnCount);
  if (rowOffset === 0 && columnOffset === 0) return null;
  let rowLines = linesPastFrozen(rowOffset, area.topRowIndex + (rowOffset > 0 ? area.rowCount - 1 : 0), frozen.rows);
  let columnLines = linesPastFrozen(columnOffset, area.leftColumnIndex + (columnOffset > 0 ? area.columnCount - 1 : 0), frozen.columns);
  return (rowLines === columnLines ? !isMoreAcross : rowLines > columnLines)
    ? {
        ...area,
        topRowIndex: area.topRowIndex + Math.min(0, rowOffset),
        rowCount: area.rowCount + Math.abs(rowOffset),
      }
    : {
        ...area,
        leftColumnIndex: area.leftColumnIndex + Math.min(0, columnOffset),
        columnCount: area.columnCount + Math.abs(columnOffset),
      };
}
export function fillAreaOfDrag(state: PageState, reads: ReadsWithTextMeasurer): CellArea | null {
  if (state.dragging?.kind !== 'filling' || state.dragging.pointedAt === null) return null;
  let pointed = reads.positionOfCell(state.dragging.pointedAt);
  let area: CellArea | null = pointed === null ? null : selectedArea(state, reads);
  return pointed === null || area === null
    ? null
    : grownFillArea(area, pointed, state.dragging.isMoreAcross, scrollPositionInLines(state, layoutOfView(state, reads)));
}
export function fillTargetCellForGrip(
  gripCell: CellPosition,
  pointed: CellPosition,
  area: CellArea,
  isMoreAcross: boolean,
  frozen: FrozenOfAxes,
): CellPosition {
  let grown = grownFillArea(area, pointed, isMoreAcross, frozen);
  if (grown === null) return pointed;
  let { topRowIndex: topRow, leftColumnIndex: leftColumn } = area;
  let direction = fillDirection(area, grown);
  if (direction === 'up')
    return {
      rowIndex: Math.min(topRow, gripCell.rowIndex),
      columnIndex: leftColumn,
    };
  if (direction === 'left')
    return {
      rowIndex: topRow,
      columnIndex: Math.min(leftColumn, gripCell.columnIndex),
    };
  return direction === 'down'
    ? {
        rowIndex: Math.max(topRow + area.rowCount - 1, gripCell.rowIndex),
        columnIndex: leftColumn,
      }
    : {
        rowIndex: topRow,
        columnIndex: Math.max(leftColumn + area.columnCount - 1, gripCell.columnIndex),
      };
}
export function moveFillDrag(state: PageState, point: GridPoint, reads: ReadsWithTextMeasurer): PageState {
  let frame = layoutOfView(state, reads);
  let area: CellArea | null = selectedArea(state, reads);
  if (state.dragging?.kind !== 'filling' || area === null) return state;
  let { across, down } = rangeSpansOnScreen(area, state, frame, state);
  let isMoreAcross =
    distanceOutsideSpan(point.x - ROW_HEADER_WIDTH, visibleSpanStart(across), across.end) >
    distanceOutsideSpan(point.y - COLUMN_HEADER_HEIGHT, visibleSpanStart(down), down.end);
  let grownSoFar = fillAreaOfDrag(state, reads) ?? area;
  let pointedCell = cellUnderPointer(point, state, frame, state, grownSoFar);
  let frozen = scrollPositionInLines(state, frame);
  let grown = grownFillArea(area, pointedCell, isMoreAcross, frozen);
  let { topRowIndex: topRow, leftColumnIndex: leftColumn } = area;
  let isGrowingUp = grown !== null && fillDirection(area, grown) === 'up';
  let fromRow = isPointerOverFrozenRows(point, frame) ? shownLineAtOrBefore(frame.rowEdges, topRow - 1) : topRow;
  let rowsAbove = {
    of: () => area,
    fromRow,
    grownSoFar,
  };
  let target: CellPosition = isGrowingUp
    ? {
        ...dragPositionClearOfStuckHeaders(point, state, reads, frame, rowsAbove),
        columnIndex: leftColumn,
      }
    : pointedCell;
  let gripCell = (): CellPosition => {
    let gripPoint = clampPointToCells(point, layoutForNarrowTouch(state));
    let pointed = cellUnderPointer(gripPoint, state, frame, state, grownSoFar);
    let cell = cellInSight(pointed, state, frame);
    let rowsAboveTop = {
      ...rowsAbove,
      fromRow: topRow,
    };
    return isGrowingUp ? pointedPositionClearOfStuckHeaders(cell, rowsAboveTop, state, reads, frame) : cell;
  };
  let fillTarget: CellPosition = state.dragging.grip === null ? target : fillTargetCellForGrip(gripCell(), pointedCell, area, isMoreAcross, frozen);
  let pointedAt = reads.cellIdAt(state.sheetId, fillTarget.rowIndex, fillTarget.columnIndex);
  let next = {
    ...state,
    dragging: {
      ...state.dragging,
      pointedAt,
      isMoreAcross,
    },
  };
  let fillArea = fillAreaOfDrag(next, reads);
  let isRowCountChanged = fillArea?.rowCount !== area.rowCount;
  let scrolled =
    fillArea === null || state.dragging.grip !== null
      ? next
      : scrollToShowPosition(
          next,
          reads,
          fillTarget,
          {
            rows: isRowCountChanged,
            columns: !isRowCountChanged,
          },
          'pointer',
        );
  let pointedAtBefore = state.dragging.pointedAt;
  return pointedAtBefore !== null &&
    pointedAt !== null &&
    isSameCell(pointedAtBefore, pointedAt) &&
    isMoreAcross === state.dragging.isMoreAcross &&
    scrolled.scrollLeft === state.scrollLeft &&
    scrolled.scrollTop === state.scrollTop
    ? state
    : scrolled;
}
export function dragFillHandle(state: PageState, point: GridPoint, reads: ReadsWithTextMeasurer): PageState {
  if (state.dragging?.kind !== 'filling') return state;
  let { tap, grip } = state.dragging;
  let distance = tap === null ? 0 : Math.hypot(point.x - tap.x, point.y - tap.y);
  if (tap !== null && distance < DRAG_START_DISTANCE / state.zoom) return state;
  let started = tap === null ? state : startFillDrag(state, tap, grip);
  return moveFillDrag(started, pointLessGrip(point, grip), reads);
}
export function fillDirection(area: CellArea, grown: CellArea): AutoscrollDirection {
  if (grown.rowCount !== area.rowCount) return grown.topRowIndex < area.topRowIndex ? 'up' : 'down';
  return grown.leftColumnIndex < area.leftColumnIndex ? 'left' : 'right';
}
export function autoScrollFillDrag(state: PageState, point: GridPoint, reads: ReadsWithTextMeasurer): PageState {
  let [area, fillArea]: [CellArea | null, CellArea | null] = [selectedArea(state, reads), fillAreaOfDrag(state, reads)];
  if (state.dragging?.kind !== 'filling' || area === null) return state;
  if (fillArea === null) return dragFillHandle(state, point, reads);
  if (state.dragging.grip !== null) return state;
  let direction = fillDirection(area, fillArea);
  let scrollPoint = autoscrollPointPastEdge(point, state, direction);
  if (scrollPoint !== null) return moveFillDrag(state, scrollPoint, reads);
  let frame = layoutOfView(state, reads);
  return (
    direction === 'up' || direction === 'down'
      ? point.y - COLUMN_HEADER_HEIGHT < frozenRowsHeight(frame)
      : point.x - ROW_HEADER_WIDTH < frozenColumnsWidth(frame)
  )
    ? moveFillDrag(state, point, reads)
    : state;
}
export function fillCellsEdit(
  state: PageState,
  reads: WorkbookReads,
  source: CellArea,
  filled: CellArea,
  filledCells: FillCellsEdit['filledCells'],
): FillCellsEdit | null {
  let sourceArea = selectionOfArea(state, reads, source);
  let isBackwards = filled.topRowIndex < source.topRowIndex || filled.leftColumnIndex < source.leftColumnIndex;
  let farCell = reads.cellIdAt(
    state.sheetId,
    isBackwards ? filled.topRowIndex : filled.topRowIndex + filled.rowCount - 1,
    isBackwards ? filled.leftColumnIndex : filled.leftColumnIndex + filled.columnCount - 1,
  );
  let sourceRange = sourceArea === null ? null : shownCellBlockOfCorners(state, reads, selectedRangeOf(sourceArea));
  if (sourceRange === null || farCell === null) return null;
  if (filled.topRowIndex === source.topRowIndex) {
    let linesToFill: FillCellsEdit['linesToFill'] = {
      kind: 'columnsAsFarAs',
      column: farCell.columnId,
    };
    return {
      kind: 'fillCells',
      source: sourceRange,
      linesToFill,
      filledCells,
    };
  }
  let rows = shownRowRunsOfSpan(state, reads, state.sheetId, {
    firstIndex: filled.topRowIndex,
    count: filled.rowCount,
  });
  return rows === null
    ? null
    : {
        kind: 'fillCells',
        source: sourceRange,
        linesToFill: {
          kind: 'rows',
          rows,
        },
        filledCells,
      };
}
export function areaAddedByFill(area: CellArea, grown: CellArea): CellArea {
  let addedRows = grown.rowCount - area.rowCount;
  let addedColumns = grown.columnCount - area.columnCount;
  if (addedRows > 0) {
    let top = grown.topRowIndex < area.topRowIndex ? grown.topRowIndex : area.topRowIndex + area.rowCount;
    return {
      ...grown,
      topRowIndex: top,
      rowCount: addedRows,
    };
  }
  let left = grown.leftColumnIndex < area.leftColumnIndex ? grown.leftColumnIndex : area.leftColumnIndex + area.columnCount;
  return {
    ...grown,
    leftColumnIndex: left,
    columnCount: addedColumns,
  };
}
export function finishFill(
  state: PageState,
  { reads, refusalOfEveryEdit }: FillContext,
  grown: CellArea | null,
): PageTransition {
  let stopped = withoutFillDrag(state);
  let area: CellArea | null = selectedArea(state, reads);
  if (area === null || grown === null) return withNoEffects(stopped);
  let filled: CellArea = trimAreaToShownRows(state, reads, grown, state.sheetId);
  if (isSameArea(filled, area)) return withNoEffects(stopped);
  let edit = fillCellsEdit(state, reads, area, areaAddedByFill(area, filled), 'continuePatterns');
  if (edit === null) return withNoEffects(stopped);
  if (refusalOfEveryEdit !== null)
    return withNoEffects({
      ...stopped,
      notice: {
        kind: 'editRefused',
        why: refusalOfEveryEdit,
        asked: 'fill',
      },
    });
  let undoOffer: FilledByFingerOffer | null =
    state.dragging?.kind === 'filling' && state.dragging.grip !== null
      ? {
          kind: 'filledByFinger',
          cells: areaToA1AsStored(filled, ownRowOrderOfSheet(reads, state.sheetId)),
        }
      : null;
  return queueEdit(stopped, edit, {
    ...IF_QUEUED_DEFAULTS,
    select: filled,
    foundBy: 'fillHandle',
    done: 'filled',
    undoOffer,
  });
}
export function fillDownToTableEnd(state: PageState, workbook: FillContext): PageTransition {
  let area: CellArea | null = selectedArea(state, workbook.reads);
  if (area === null) return withNoEffects(state);
  let rowsToTableEnd = lastRowOfDataBelow(state, workbook.reads, area) - area.topRowIndex + 1;
  let grown: CellArea | null =
    rowsToTableEnd > area.rowCount
      ? {
          ...area,
          rowCount: rowsToTableEnd,
        }
      : null;
  return finishFill(state, workbook, grown);
}
export function fillSourceBeside(state: PageState, reads: WorkbookReads, area: CellArea, isDown: boolean): CellArea | null {
  let { topRowIndex: topRow, leftColumnIndex: leftColumn } = area;
  let rowAbove: number | null = lastShownRowIndex(state, reads, topRow);
  if (isDown ? rowAbove === null : leftColumn === 0) return null;
  let source =
    isDown && rowAbove !== null
      ? {
          ...area,
          topRowIndex: rowAbove,
        }
      : {
          ...area,
          leftColumnIndex: leftColumn - 1,
        };
  let [merged] = reads.mergedAreasIn(state.sheetId, source);
  if (merged === undefined) return source;
  if (area.rowCount > 1 || area.columnCount > 1) return null;
  if (isDown)
    return merged.leftColumnIndex === leftColumn
      ? {
          ...merged,
          columnCount: 1,
        }
      : null;
  return merged.topRowIndex === topRow
    ? {
        ...merged,
        rowCount: 1,
      }
    : null;
}
export function fillDownOrRight(state: PageState, reads: ReadsWithTextMeasurer, direction: 'down' | 'right'): PageTransition {
  let area: CellArea | null = selectedArea(state, reads);
  if (area === null) return withNoEffects(state);
  let merged = reads.mergedAreaAt(state.sheetId, {
    rowIndex: area.topRowIndex,
    columnIndex: area.leftColumnIndex,
  });
  let selected =
    merged !== null && isSameArea(merged, area)
      ? {
          ...area,
          rowCount: 1,
          columnCount: 1,
        }
      : area;
  let isDown = direction === 'down';
  let nothingToFill = withNoEffects({
    ...state,
    lastDone: {
      what: 'nothingToFill',
    },
  });
  let isOneLine = (isDown ? selected.rowCount : selected.columnCount) === 1;
  if (isOneLine && selectionKindOf(selected, layoutOfView(state, reads)) !== 'cells') return nothingToFill;
  let firstLine = isDown
    ? {
        ...selected,
        rowCount: 1,
      }
    : {
        ...selected,
        columnCount: 1,
      };
  let source = isOneLine ? fillSourceBeside(state, reads, selected, isDown) : firstLine;
  if (source === null) return nothingToFill;
  let target = isOneLine ? selected : areaAddedByFill(source, selected);
  let edit = fillCellsEdit(state, reads, source, target, 'repeatSource');
  if (edit === null) return nothingToFill;
  return queueEdit(state, edit, {
    ...IF_QUEUED_DEFAULTS,
    select: state,
    done: 'filled',
  });
}
export const FILL_HANDLE_SIZE = 14;
export const FILL_HANDLE_TOUCH_SIZE = 24;
export const startFillDrag = (state: PageState, point: GridPoint, grip: GridPoint | null = null) => ({
  ...state,
  calendar: null,
  dropdown: null,
  peopleList: null,
  dragging: {
    kind: 'filling',
    pressedAt: {
      x: point.x,
      y: point.y,
    },
    pointedAt: null,
    isMoreAcross: false,
    tap: null,
    grip,
  } satisfies FillingDrag,
});
export const offsetOutsideSpan = (index: number, start: number, count: number): number =>
  index < start ? index - start : Math.max(0, index - (start + count - 1));
export const distanceOutsideSpan = (position: number, start: number, end: number): number =>
  Math.max(start - position, position - end, 0);
export const visibleSpanStart = ({ start, showFrom }: Pick<SpanOnScreen, 'start' | 'showFrom'>): number =>
  showFrom === 0 ? start : Math.max(start, showFrom);
export const pointLessGrip = (point: GridPoint, grip: GridPoint | null): GridPoint => ({
  x: point.x - (grip?.x ?? 0),
  y: point.y - (grip?.y ?? 0),
});
export const endFillDrag = (state: PageState, workbook: FillContext): PageTransition =>
  finishFill(state, workbook, fillAreaOfDrag(state, workbook.reads));
export const withoutFillDrag = (state: PageState): PageState =>
  state.dragging?.kind === 'filling'
    ? {
        ...state,
        dragging: null,
      }
    : state;
export const dropFillDragUnlessNavigating = (before: PageState, after: PageState): PageState =>
  after.mode.kind === 'navigating' && isSameSelection(before, after) ? after : withoutFillDrag(after);
