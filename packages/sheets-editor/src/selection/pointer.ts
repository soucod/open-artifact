import type { ColumnId, RowId, SheetId } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { DraggingKind, PageState, Press } from '../state/initial-state.ts';
import type { PageContext, PageEvent, PointerDragged, PointerPressed } from '../state/event-reducer.ts';
import type { QueuedEvent } from '../state/controller.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { PagePoint } from '../comments/page-comments.ts';
import type { GridHit, GridPoint, GridScroll } from '../grid/geometry.ts';
import type { AxesToShow, CellArea, CellPosition, CellSelection, PositionToShow, SelectionKind } from './model.ts';
import {
  isAnchorOfActiveCell,
  isSameCell,
  scrollToShowPosition,
  selectedArea,
  BOTH_AXES,
  shownPositionInMerge,
  selectionBetweenPositions,
  mergedAreaOrCellOf,
  moveActiveCellTo,
  areaGrownOverMerges,
  selectionAreaAndKind,
} from './model.ts';
import {
  takeAreaOutOfSelection,
  isPointerTargetSelected,
  withCurrentRangeAmongOthers,
  someAreaHasCell,
  areasOfAllRanges,
  allRangesOf,
  withoutOtherRanges,
} from './several-ranges.ts';
import {
  hitTestGrid,
  rangeSpansOnScreen,
  isSpanFullyInSight,
  RIGHT_EDGE_SLOP,
  autoscrollPointPastEdge,
  scrollPositionInLines,
  frozenRowsHeight,
  frozenColumnsWidth,
  layoutForNarrowTouch,
  clampScrollKeepingReach,
  cellUnderPointer,
  clampPointToCells,
  cellInSight,
  DRAG_START_DISTANCE,
  clampRowHeight,
  clampColumnWidth,
} from '../grid/geometry.ts';
import { layoutOfView } from '../grid/layout.ts';
import { stuckHeaderAtPoint, pointedPositionClearOfStuckHeaders, columnSpanAt, dragPositionClearOfStuckHeaders } from '../grid/sticky-headers.ts';
import { selectAllCells } from './keyboard.ts';
import { withNoEffects, isIdleOrTapping } from '../state/transitions.ts';
import { endEntryOnPointerPress } from '../editor/commit-entry.ts';
import { columnMoveOfPress, startMovingColumnsOfTable, dragMovingColumnsOfTable } from './move-table-columns.ts';
import { isPointOnFillHandle, startFillDrag, autoScrollFillDrag, dragFillHandle } from './fill-handle.ts';
import { startFreezeDrag, dragFreezeTo } from '../grid/freeze.ts';
import { resizeLineUnderPointer } from '../grid/resize-lines.ts';
import { startMovingCells, dragMovingCells } from './move-cells.ts';
import { startMovingLines, dragMovingLines } from './move-lines.ts';
import { isFormulaAskedOrProposed } from '../formulas/from-words/actions.ts';
import { pointAtCell, dragPointedReference } from '../formulas/reference-pointing.ts';
import { ROW_HEADER_WIDTH, DEFAULT_ROW_HEIGHT } from '../grid/cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT } from '../grid/cell-metrics.ts';
import { dragPlacedView, sizePlacedView } from '../charts/placed-views.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { checkboxUnderPointer } from '../chips/checkbox-presses.ts';
/** The ranges a drag with the modifier held takes out of the selection, and the cell it started from. */
export interface TakeOutOfDrag {
  from: CellId;
  ranges: CellSelection[];
}
/** A drag that selects cells, rows or columns. */
export interface SelectingDrag {
  kind: 'selecting';
  what: SelectionKind;
  takesOut?: TakeOutOfDrag;
  isByFinger?: true;
  timesAtEdge?: number;
  holdsBoxAlone?: true;
  pressedCheckbox?: NonNullable<ReturnType<typeof checkboxUnderPointer>>;
}
/** A finger resting on the grid before it is known to tap or drag. */
export interface TappingDrag {
  kind: 'tapping';
  tap: PointerPressed;
  over: CellId | null;
  isOnActiveCell: boolean;
}
/** The row or column whose size a drag changes. Made by grid/resize-lines.ts. */
export type LineToResize = { isA: 'row'; rowId: RowId } | { isA: 'column'; columnId: ColumnId };
/** A drag that changes the size of a row or column. */
export interface ResizingDrag {
  kind: 'resizing';
  line: LineToResize;
  sizeInPixels: number;
  sizeAtPress: number;
  pointerAtPress: number;
  isByFinger?: true;
}
/** A row or column header the pointer hit. */
export type HeaderHit = Extract<GridHit, { kind: 'rowHeader' | 'columnHeader' }>;
/** What a pointer pressed: where it was, the scroll then, and the cells under it and in the open entry. */
export interface PointerWasOver {
  headerKept?: string;
  scrollLeft: number;
  scrollTop: number;
  sheetId: SheetId;
  place: GridHit['kind'] | null;
  cell: CellId | null;
  entryCell: CellId | null;
}
/** A press on the grid: where, and which keys were held. */
export interface PressOnGrid extends GridPoint {
  isShiftHeld: boolean;
  isModifierHeld?: boolean;
}
/** A cell under a press that may be the second of a double press, and the view to read it in. */
export interface CellOfDoublePress {
  state: PageState;
  cellId: CellId | null;
}
/** Which way a finger held at an edge scrolls: -1, 0 or 1 along each axis. */
export interface FingerAutoscroll {
  across: number;
  down: number;
}
export function extendSelectionToPosition(state: PageState, reads: ReadsWithTextMeasurer, position: PositionToShow, axes: AxesToShow): PageState {
  let cellId = reads.cellIdAt(state.sheetId, position.rowIndex, position.columnIndex);
  if (cellId === null) return state;
  let isAnchor = isAnchorOfActiveCell(state, reads, cellId);
  let corner = isAnchor ? state.activeCell : cellId;
  if (!isSameCell(corner, state.selectionCorner))
    return scrollToShowPosition(
      {
        ...state,
        selectionCorner: corner,
      },
      reads,
      position,
      axes,
      'pointer',
    );
  let unwalked =
    state.rangeWalked === null
      ? state
      : {
          ...state,
          rangeWalked: null,
        };
  if (!isAnchor && position.isToComeClearOf === undefined) return unwalked;
  let scrolled = scrollToShowPosition(unwalked, reads, position, axes, 'pointer');
  return scrolled.scrollLeft !== unwalked.scrollLeft || scrolled.scrollTop !== unwalked.scrollTop ? scrolled : unwalked;
}
export function takeOutWhileDragging(state: PageState, reads: ReadsWithTextMeasurer, { from, ranges }: TakeOutOfDrag, position: CellPosition): PageState {
  let cellId = reads.cellIdAt(state.sheetId, position.rowIndex, position.columnIndex);
  let lastRange = ranges.at(-1);
  let area =
    cellId === null
      ? null
      : selectedArea(
          {
            activeCell: from,
            selectionCorner: cellId,
          },
          reads,
        );
  if (lastRange === undefined || area === null) return state;
  let withRanges = {
    ...state,
    ...lastRange,
    otherRanges: ranges.slice(0, -1),
  };
  let takenOut = takeAreaOutOfSelection(withRanges, reads, area);
  if (takenOut === null) return state;
  let next =
    JSON.stringify(takenOut.lastDone) === JSON.stringify(state.lastDone)
      ? {
          ...takenOut,
          lastDone: state.lastDone,
        }
      : takenOut;
  return scrollToShowPosition(next, reads, position, BOTH_AXES, 'pointer');
}
export function cellIdUnderPointer(state: PageState, reads: ReadsWithTextMeasurer, pointer: GridPoint): CellId | null {
  let hit = hitTestGrid(pointer, state, layoutOfView(state, reads));
  return hit?.kind === 'cell' ? reads.cellIdAt(state.sheetId, hit.rowIndex, hit.columnIndex) : null;
}
export function rememberLastPresses(state: PageState, before: PageState, message: PageEvent, reads: ReadsWithTextMeasurer): PageState {
  let [earlierPress, lastPress] = state.lastPresses;
  let { scrollLeft, scrollTop } = state;
  if (message.kind === 'pointerPressed') {
    let cellId = cellIdUnderPointer(before, reads, message);
    let { x, y } = message;
    let viewThen: GridScroll = {
      scrollLeft: before.scrollLeft,
      scrollTop: before.scrollTop,
    };
    let press: Press | null =
      cellId === null
        ? null
        : {
            cellId,
            x,
            y,
            viewThen,
            viewAfter: {
              scrollLeft,
              scrollTop,
            },
          };
    let isLateMouse = message.isToldOfLate === true && !message.isByFinger;
    return {
      ...state,
      lastPresses: [isLateMouse ? earlierPress : lastPress, press],
    };
  }
  let isDrag = message.kind === 'pointerDragged';
  return (message.kind === 'pointerPressedTwice' || (!isDrag && !isSameScroll(state, before))) && (earlierPress !== null || lastPress !== null)
    ? {
        ...state,
        lastPresses: [null, null],
      }
    : state;
}
export function cellOfDoublePress(state: PageState, reads: ReadsWithTextMeasurer, pointer: GridPoint): CellOfDoublePress {
  let cellId = cellIdUnderPointer(state, reads, pointer);
  let [earlierPress, lastPress] = state.lastPresses;
  return !(
    earlierPress !== null &&
    lastPress !== null &&
    isNearPress(earlierPress, pointer) &&
    isNearPress(lastPress, pointer) &&
    earlierPress.cellId.sheetId === state.sheetId &&
    !isSameScroll(earlierPress.viewThen, state)
  ) || reads.positionOfCell(earlierPress.cellId) === null
    ? {
        state,
        cellId,
      }
    : {
        state: {
          ...state,
          ...earlierPress.viewAfter,
        },
        cellId: earlierPress.cellId,
      };
}
export function whatPointerWasOver(point: PagePoint | null, state: PageState, reads: ReadsWithTextMeasurer): PointerWasOver {
  let hit = point === null ? null : hitTestGrid(point, state, layoutOfView(state, reads));
  let position = {
    rowIndex: 0,
    columnIndex: 0,
    ...hit,
  };
  let stuckHeader = point === null ? undefined : stuckHeaderAtPoint(point, state, reads);
  return {
    ...(stuckHeader !== undefined && {
      headerKept: stuckHeader.key,
    }),
    scrollLeft: state.scrollLeft,
    scrollTop: state.scrollTop,
    sheetId: state.sheetId,
    place: hit?.kind ?? null,
    cell: hit === null ? null : reads.cellIdAt(state.sheetId, position.rowIndex, position.columnIndex),
    entryCell: state.mode.kind === 'editing' ? state.activeCell : null,
  };
}
/** The event, carrying what lay under the pointer when it happened (only press events read it back). */
export function stampWhatPointerWasOver(
  message: PageEvent,
  state: PageState,
  reads: ReadsWithTextMeasurer,
): PageEvent | (PageEvent & { madeOver: PointerWasOver }) {
  let point = pointOfPressMessage(message);
  return (point === null && !('isOnBoxOfEntry' in message)) || 'madeOver' in message
    ? message
    : {
        ...message,
        madeOver: whatPointerWasOver(point, state, reads),
      };
}
export function viewForLateMessage(message: QueuedEvent, state: PageState, reads: ReadsWithTextMeasurer): PageState | 'ofOpenEntry' {
  if (!('madeOver' in message)) return state;
  let [point, madeOver] = [pointOfPressMessage(message), message.madeOver!];
  let overNow = whatPointerWasOver(point, state, reads);
  if ('isOnBoxOfEntry' in message && overNow.entryCell !== null && isSameCellOrNone(madeOver.entryCell, overNow.entryCell)) return 'ofOpenEntry';
  if (isSamePointerTarget(madeOver, overNow)) return state;
  let viewThen = {
    ...state,
    scrollLeft: madeOver.scrollLeft,
    scrollTop: madeOver.scrollTop,
  };
  return isSamePointerTarget(madeOver, whatPointerWasOver(point, viewThen, reads)) ? viewThen : state;
}
export function selectLinesFromHeader(state: PageState, reads: ReadsWithTextMeasurer, header: HeaderHit, isFromActiveCell: boolean) {
  let { rowCount, columnCount } = layoutOfView(state, reads);
  let activePosition = reads.positionOfCell(state.activeCell);
  let from: CellPosition =
    isFromActiveCell && activePosition !== null
      ? shownPositionInMerge(state, reads, activePosition)
      : {
          rowIndex: 0,
          columnIndex: 0,
          ...header,
        };
  let selection =
    header.kind === 'rowHeader'
      ? selectionBetweenPositions(
          state,
          reads,
          {
            rowIndex: from.rowIndex,
            columnIndex: 0,
          },
          {
            rowIndex: header.rowIndex,
            columnIndex: columnCount - 1,
          },
        )
      : selectionBetweenPositions(
          state,
          reads,
          {
            rowIndex: 0,
            columnIndex: from.columnIndex,
          },
          {
            rowIndex: rowCount - 1,
            columnIndex: header.columnIndex,
          },
        );
  let what: Exclude<SelectionKind, 'cells'> = header.kind === 'rowHeader' ? 'rows' : 'columns';
  return {
    ...state,
    ...selection,
    dragging: {
      kind: 'selecting',
      what,
    } satisfies SelectingDrag,
  };
}
export function pressWithModifier(state: PageState, target: GridHit, reads: ReadsWithTextMeasurer) {
  if (target.kind === 'corner') return null;
  if (target.kind !== 'cell') {
    let { rowCount, columnCount } = layoutOfView(state, reads);
    let lineArea: CellArea =
      target.kind === 'rowHeader'
        ? {
            topRowIndex: target.rowIndex,
            leftColumnIndex: 0,
            rowCount: 1,
            columnCount,
          }
        : {
            topRowIndex: 0,
            leftColumnIndex: target.columnIndex,
            rowCount,
            columnCount: 1,
          };
    let isWholeLine = (area: CellArea) => (target.kind === 'rowHeader' ? area.columnCount === columnCount : area.rowCount === rowCount);
    return isPointerTargetSelected(state, target, reads)
      ? (takeAreaOutOfSelection(state, reads, lineArea, isWholeLine) ?? state)
      : selectLinesFromHeader(withCurrentRangeAmongOthers(state), reads, target, false);
  }
  let cellId = reads.cellIdAt(state.sheetId, target.rowIndex, target.columnIndex);
  if (cellId === null) return state;
  let cellArea = mergedAreaOrCellOf(reads, cellId);
  if (cellArea !== null && someAreaHasCell(areasOfAllRanges(state, reads), target.rowIndex, target.columnIndex)) {
    let takesOut: TakeOutOfDrag = {
      from: cellId,
      ranges: allRangesOf(state),
    };
    let takenOut = takeAreaOutOfSelection(state, reads, cellArea);
    if (takenOut === null)
      return {
        ...state,
        dragging: {
          kind: 'selecting',
          what: 'cells',
        } satisfies SelectingDrag,
      };
    return {
      ...takenOut,
      contextBarMenu: null,
      menu: null,
      dragging: {
        kind: 'selecting',
        what: 'cells',
        takesOut,
      } satisfies SelectingDrag,
    };
  }
  return {
    ...moveActiveCellTo(withCurrentRangeAmongOthers(state), reads, cellId, 'pointer'),
    dragging: {
      kind: 'selecting',
      what: 'cells',
    } satisfies SelectingDrag,
  };
}
export function selectionAtPointer(state: PageState, reads: ReadsWithTextMeasurer, pointer: GridPoint): CellId | CellSelection | null {
  let hit = hitTestGrid(pointer, state, layoutOfView(state, reads));
  if (hit === null) return null;
  if (hit.kind === 'cell') return reads.cellIdAt(state.sheetId, hit.rowIndex, hit.columnIndex);
  let { activeCell, selectionCorner } =
    hit.kind === 'corner' ? selectAllCells(state, reads) : selectLinesFromHeader(state, reads, hit, false);
  return {
    activeCell,
    selectionCorner,
    rangeWalked: null,
  };
}
export function pressOnGrid(state: PageState, pointer: PressOnGrid, reads: ReadsWithTextMeasurer): PageTransition {
  let hit = hitTestGrid(pointer, state, layoutOfView(state, reads));
  if (hit === null) return withNoEffects(state);
  let cellId = hit.kind === 'cell' ? reads.cellIdAt(state.sheetId, hit.rowIndex, hit.columnIndex) : null;
  if (state.mode.kind === 'editing') {
    if (cellId !== null && isAnchorOfActiveCell(state, reads, cellId)) return withNoEffects(state);
    return endEntryOnPointerPress(state, reads, selectionAtPointer(state, reads, pointer));
  }
  let pressedState = {
    ...state,
    cameToMergedCellsAt: null,
  };
  let modifiedPress = pointer.isModifierHeld === true && !pointer.isShiftHeld ? pressWithModifier(pressedState, hit, reads) : null;
  if (modifiedPress !== null) return withNoEffects(modifiedPress);
  if (hit.kind !== 'cell')
    return withNoEffects(
      hit.kind === 'corner'
        ? selectAllCells(withoutOtherRanges(pressedState), reads)
        : selectLinesFromHeader(pressedState, reads, hit, pointer.isShiftHeld),
    );
  if (cellId === null) return withNoEffects(pressedState);
  let moved = pointer.isShiftHeld
    ? extendSelectionToPosition(pressedState, reads, hit, BOTH_AXES)
    : moveActiveCellTo(pressedState, reads, cellId, 'pointer');
  return withNoEffects({
    ...moved,
    dragging: {
      kind: 'selecting',
      what: 'cells',
    } satisfies SelectingDrag,
  });
}
export function pointerPressedOnGrid(state: PageState, pointer: PointerPressed, context: PageContext): PageTransition {
  if (pointer.onGripOfColumn !== undefined) {
    let columnMove = columnMoveOfPress(state, pointer, context);
    let moving = columnMove === null ? null : startMovingColumnsOfTable(state, columnMove, context.reads);
    if (moving !== null) return withNoEffects(moving);
  }
  if (!(pointer.isToldOfLate === true && !pointer.isByFinger) && isPointOnFillHandle(state, pointer, context))
    return withNoEffects(startFillDrag(state, pointer));
  let freezeDrag = startFreezeDrag(state, pointer, context);
  if (freezeDrag !== null) return withNoEffects(freezeDrag);
  let resizeLine = resizeLineUnderPointer(state, pointer, context);
  if (resizeLine === null) {
    let { reads, refusalOfEveryEdit } = context;
    let hit = hitTestGrid(pointer, state, layoutOfView(state, reads));
    let isOnHeader = hit?.kind === 'rowHeader' || hit?.kind === 'columnHeader';
    let moveDrag =
      (pointer.onHandleOfTable === undefined ? null : startMovingCells(state, pointer, context)) ??
      (refusalOfEveryEdit === null &&
      state.mode.kind !== 'editing' &&
      isOnHeader &&
      !pointer.isShiftHeld &&
      pointer.isModifierHeld !== true &&
      !pointer.isByFinger
        ? startMovingLines(state, reads, hit as HeaderHit, pointer)
        : startMovingCells(state, pointer, context));
    let pointing =
      refusalOfEveryEdit === null &&
      !isFormulaAskedOrProposed(state) &&
      !(state.mode.kind === 'editing' && state.mode.isBegunToListFunctions === true)
        ? pointAtCell(state, pointer, reads)
        : null;
    let next = moveDrag ?? pointing;
    return next === null ? pressOnGrid(state, pointer, reads) : withNoEffects(next);
  }
  return withNoEffects({
    ...state,
    menu: null,
    dragging: {
      kind: 'resizing',
      line: resizeLine.line,
      sizeInPixels: resizeLine.sizeInPixels,
      sizeAtPress: resizeLine.sizeInPixels,
      pointerAtPress: resizeLine.line.isA === 'row' ? pointer.y : pointer.x,
      ...(pointer.isByFinger && {
        isByFinger: true,
      }),
    } satisfies ResizingDrag,
  });
}
export function isActiveCellFullyInSight(state: PageState, reads: ReadsWithTextMeasurer): boolean {
  let area = mergedAreaOrCellOf(reads, state.activeCell);
  if (area === null) return false;
  let { across, down } = rangeSpansOnScreen(area, state, layoutOfView(state, reads), state);
  return isSpanFullyInSight(across) && isSpanFullyInSight(down);
}
export function startTapping(state: PageState, message: PageEvent, context: PageContext) {
  if (message.kind !== 'pointerPressed' || !message.isByFinger || message.isToldOfLate === true) return null;
  if (!isIdleOrTapping(state) && state.dragging?.kind !== 'selecting') return null;
  let isOnStuckHeader = stuckHeaderAtPoint(message, state, context.reads) !== undefined;
  if (!isOnStuckHeader && isPointOnFillHandle(state, message, context, true)) return null;
  if (!isOnStuckHeader && resizeLineUnderPointer(state, message, context) !== null) return null;
  let cellId = cellIdUnderPointer(state, context.reads, message);
  let isOnActiveCell =
    !isOnStuckHeader &&
    cellId !== null &&
    isAnchorOfActiveCell(state, context.reads, cellId) &&
    isActiveCellFullyInSight(state, context.reads) &&
    state.mode.kind === 'navigating' &&
    state.menu === null;
  return {
    ...state,
    dragging: {
      kind: 'tapping',
      tap: message,
      over: cellId,
      isOnActiveCell,
    } satisfies TappingDrag,
  };
}
export function pressOfDrag(drag: PageState['dragging']): PointerPressed | null {
  if (drag?.kind === 'filling' || drag?.kind === 'tapping') return drag.tap;
  if (drag?.kind !== 'movingCells' || drag.heldBy === 'handle') return null;
  return drag.landing === null ? drag.press : null;
}
export function pushPointerPastRightEdge<P extends GridPoint>(state: PageState, what: SelectionKind, pointer: P, reads: WorkbookReads): P {
  let activePosition = reads.positionOfCell(state.activeCell);
  let cornerPosition = reads.positionOfCell(state.selectionCorner);
  if (activePosition === null || cornerPosition === null || pointer.x < state.gridWidth - RIGHT_EDGE_SLOP) return pointer;
  let activeCellArea: CellArea = {
    topRowIndex: activePosition.rowIndex,
    leftColumnIndex: activePosition.columnIndex,
    rowCount: 1,
    columnCount: 1,
  };
  let activeArea = what === 'cells' ? areaGrownOverMerges(reads, state.sheetId, activeCellArea) : activeCellArea;
  return cornerPosition.columnIndex >= activeArea.leftColumnIndex + activeArea.columnCount
    ? {
        ...pointer,
        x: Math.max(pointer.x, state.gridWidth + 1),
      }
    : pointer;
}
export function fingerAutoscrollDirection(state: PageState, pointer: GridPoint, reads: ReadsWithTextMeasurer): FingerAutoscroll {
  let area = mergedAreaOrCellOf(reads, state.activeCell);
  if (area === null)
    return {
      across: 0,
      down: 0,
    };
  let layout = layoutOfView(state, reads);
  let spans = rangeSpansOnScreen(area, state, layout, state);
  let [x, y] = [pointer.x - ROW_HEADER_WIDTH, pointer.y - COLUMN_HEADER_HEIGHT];
  let pastVertical = autoscrollPointPastEdge(pointer, state, y >= spans.down.end ? 'down' : 'up', true);
  let pastHorizontal = autoscrollPointPastEdge(pointer, state, x >= spans.across.end ? 'right' : 'left', true);
  let visibleHeight = state.gridHeight - (state.isNarrowByTouch ? state.heightUnderCardAtFoot : 0);
  let down =
    visibleHeight === state.gridHeight
      ? Math.sign((pastVertical?.y ?? pointer.y) - pointer.y)
      : pointer.y >= visibleHeight
        ? 1
        : Math.min(0, Math.sign((pastVertical?.y ?? pointer.y) - pointer.y));
  let across = Math.sign((pastHorizontal?.x ?? pointer.x) - pointer.x);
  let { rows, columns } = scrollPositionInLines(state, layout);
  let isOverFrozenRows = rows.under > 0 && y < frozenRowsHeight(layout);
  let isOverFrozenColumns = columns.under > 0 && x < frozenColumnsWidth(layout);
  let isBelowFrozenRows = area.topRowIndex >= layout.frozenRowCount;
  let isRightOfFrozenColumns = area.leftColumnIndex >= layout.frozenColumnCount;
  return {
    across: Math.max(isRightOfFrozenColumns ? -1 : 0, isOverFrozenColumns ? -1 : across),
    down: Math.max(isBelowFrozenRows ? -1 : 0, isOverFrozenRows ? -1 : down),
  };
}
export function dragSelectingByFinger(state: PageState, pointer: PointerDragged, reads: ReadsWithTextMeasurer): PageState {
  let layout = layoutOfView(state, reads);
  let narrowLayout = layoutForNarrowTouch(state);
  let direction: FingerAutoscroll =
    pointer.isHeldStill === true
      ? fingerAutoscrollDirection(state, pointer, reads)
      : {
          across: 0,
          down: 0,
        };
  let timesAtEdge = state.dragging?.kind === 'selecting' ? (state.dragging.timesAtEdge ?? 0) : 0;
  let isAtEdge = direction.across !== 0 || direction.down !== 0;
  let nextTimes = Math.min(timesAtEdge + 1, FINGER_AUTOSCROLL_DELAY_TICKS + 1);
  let timesNow = pointer.isHeldStill !== true ? timesAtEdge : isAtEdge ? nextTimes : 0;
  let step = timesNow > FINGER_AUTOSCROLL_DELAY_TICKS ? FINGER_AUTOSCROLL_STEP : 0;
  let { scrollLeft, scrollTop } = state;
  let wantedScroll: GridScroll = {
    scrollLeft: scrollLeft + direction.across * step,
    scrollTop: scrollTop + direction.down * step,
  };
  let scroll: GridScroll =
    step === 0
      ? {
          scrollLeft,
          scrollTop,
        }
      : clampScrollKeepingReach(state, wantedScroll, layout, state);
  let selecting = {
    ...state,
    ...scroll,
    dragging: {
      kind: 'selecting',
      what: 'cells',
      isByFinger: true,
      timesAtEdge: timesNow,
    } satisfies SelectingDrag,
  };
  let { rows, columns } = scrollPositionInLines(selecting, layout);
  let selectionArea = rows.under + columns.under > 0 ? (selectionAreaAndKind(selecting, reads)?.area ?? null) : null;
  let cell = cellUnderPointer(clampPointToCells(pointer, narrowLayout), selecting, layout, narrowLayout, selectionArea);
  let position = pointedPositionClearOfStuckHeaders(
    cellInSight(cell, selecting, layout),
    {
      of: columnSpanAt,
      fromRow: rowIndexOfActiveCell(selecting, reads),
    },
    selecting,
    reads,
    layout,
  );
  let extended = extendSelectionToPosition(selecting, reads, position, {
    rows: false,
    columns: false,
  });
  return extended === selecting && timesNow === timesAtEdge && scroll.scrollLeft === scrollLeft && scroll.scrollTop === scrollTop ? state : extended;
}
export function pointerDraggedOnGrid(state: PageState, pointer: PointerDragged, reads: ReadsWithTextMeasurer): PageState {
  if (state.dragging?.kind === 'pointing') return dragPointedReference(state, pointer, reads);
  if (state.dragging === null || state.mode.kind === 'editing') return state;
  if (state.dragging.kind === 'tapping') {
    let { tap, isOnActiveCell } = state.dragging;
    let distance = Math.hypot(pointer.x - tap.x, pointer.y - tap.y);
    if (!isOnActiveCell || distance < DRAG_START_DISTANCE / state.zoom) return state;
    let pressAtTap: PressOnGrid = {
      x: tap.x,
      y: tap.y,
      isShiftHeld: false,
    };
    let pressed = pressOnGrid(
      withoutOtherRanges({
        ...state,
        dragging: null,
      }),
      pressAtTap,
      reads,
    ).state;
    return pointerDraggedOnGrid(
      {
        ...pressed,
        ...{
          calendar: null,
          dropdown: null,
          peopleList: null,
        },
        dragging: {
          kind: 'selecting',
          what: 'cells',
          isByFinger: true,
        } satisfies SelectingDrag,
      },
      pointer,
      reads,
    );
  }
  if (state.dragging.kind === 'resizing') {
    let { line, sizeAtPress, pointerAtPress } = state.dragging;
    let moved = (line.isA === 'row' ? pointer.y : pointer.x) - pointerAtPress;
    let isSizeUnchanged = state.dragging.sizeInPixels === sizeAtPress;
    let slop = state.dragging.isByFinger === true ? DRAG_START_DISTANCE / state.zoom : DRAG_SLOP;
    if (isSizeUnchanged && Math.abs(moved) < slop) return state;
    let wantedSize = sizeAtPress + moved;
    let clampedSize = line.isA === 'row' ? clampRowHeight(wantedSize) : clampColumnWidth(wantedSize);
    if (clampedSize === state.dragging.sizeInPixels) return state;
    return {
      ...state,
      dragging: {
        ...state.dragging,
        sizeInPixels: clampedSize,
      },
    };
  }
  if (state.dragging.kind === 'movingLines') return dragMovingLines(state, state.dragging, pointer, reads);
  if (state.dragging.kind === 'movingColumnsOfTable') return dragMovingColumnsOfTable(state, state.dragging, pointer, reads);
  if (state.dragging.kind === 'movingCells') {
    let { press, landing } = state.dragging;
    let distance = Math.hypot(pointer.x - press.x, pointer.y - press.y);
    if (landing === null && distance < DRAG_SLOP) return state;
    return dragMovingCells(state, state.dragging, pointer, reads);
  }
  if (state.dragging.kind === 'movingPlacedView') return dragPlacedView(state, state.dragging, pointer, reads);
  if (state.dragging.kind === 'sizingPlacedView') return sizePlacedView(state, state.dragging, pointer, reads);
  if (state.dragging.kind === 'freezing') {
    let { what, pressedAt, count } = state.dragging;
    let moved = what === 'rows' ? pointer.y - pressedAt.y : pointer.x - pressedAt.x;
    if (count === null && Math.abs(moved) < DRAG_SLOP) return state;
    return dragFreezeTo(state, state.dragging, pointer, reads);
  }
  if (state.dragging.kind === 'filling') {
    let { pressedAt, pointedAt } = state.dragging;
    let distance = Math.hypot(pointer.x - pressedAt.x, pointer.y - pressedAt.y);
    if (pointedAt === null && distance < DRAG_SLOP) return state;
    return pointer.isHeldStill === true ? autoScrollFillDrag(state, pointer, reads) : dragFillHandle(state, pointer, reads);
  }
  if (state.dragging.isByFinger === true) return dragSelectingByFinger(state, pointer, reads);
  let layout = layoutOfView(state, reads);
  let { what, takesOut } = state.dragging;
  let pointerPushed = pointer.isHeldStill === true ? pushPointerPastRightEdge(state, what, pointer, reads) : pointer;
  let axes: AxesToShow = {
    rows: what !== 'columns',
    columns: what !== 'rows',
  };
  let { rows, columns } = scrollPositionInLines(state, layout);
  let grownArea = takesOut === undefined ? selectionAreaAndKind(state, reads)?.area : mergedAreaOrCellOf(reads, takesOut.from);
  let grownSoFar = rows.under + columns.under > 0 ? (grownArea ?? null) : null;
  let position = dragPositionClearOfStuckHeaders(pointerPushed, state, reads, layout, {
    of: what === 'cells' ? columnSpanAt : what,
    fromRow: rowIndexOfActiveCell(state, reads, takesOut?.from),
    grownSoFar,
  });
  if (takesOut !== undefined) return takeOutWhileDragging(state, reads, takesOut, position);
  let positionToShow: PositionToShow = {
    ...position,
    rowIndex: axes.rows ? position.rowIndex : layout.rowCount - 1,
    columnIndex: axes.columns ? position.columnIndex : layout.columnCount - 1,
  };
  return extendSelectionToPosition(state, reads, positionToShow, axes);
}
export const isSameScroll = (scroll: GridScroll, otherScroll: GridScroll): boolean =>
  scroll.scrollLeft === otherScroll.scrollLeft && scroll.scrollTop === otherScroll.scrollTop;
export const DOUBLE_PRESS_SLOP = 4;
export const isNearPress = (point: GridPoint, otherPoint: GridPoint): boolean =>
  Math.max(Math.abs(point.x - otherPoint.x), Math.abs(point.y - otherPoint.y)) <= DOUBLE_PRESS_SLOP;
export const pointOfPressMessage = (message: PageEvent): PagePoint | null => {
  if (message.kind === 'pointerPressed' || message.kind === 'pointerPressedTwice') return message;
  return message.kind === 'menuAsked' && message.inContextBar === undefined ? message.at : null;
};
export const pressMessageWithPoint = (message: PageEvent) =>
  (message.kind === 'pointerPressed' || message.kind === 'pointerPressedTwice' || message.kind === 'menuAsked') &&
  pointOfPressMessage(message) !== null
    ? message
    : null;
export const isSameCellOrNone = (cell: CellId | null, otherCell: CellId | null): boolean =>
  cell === null || otherCell === null ? cell === otherCell : isSameCell(cell, otherCell);
export const isSamePointerTarget = (target: PointerWasOver, otherTarget: PointerWasOver): boolean =>
  target.sheetId === otherTarget.sheetId && target.place === otherTarget.place && isSameCellOrNone(target.cell, otherTarget.cell);
export const hasTapLeftCell = (state: PageState, reads: ReadsWithTextMeasurer): boolean =>
  state.dragging?.kind === 'tapping' && !isSameCellOrNone(state.dragging.over, cellIdUnderPointer(state, reads, state.dragging.tap));
export const DRAG_SLOP = 3;
export const POINTER_DRAG_KINDS = new Set<DraggingKind>([
  'selecting',
  'filling',
  'pointing',
  'movingLines',
  'movingColumnsOfTable',
  'movingCells',
  'movingPlacedView',
]);
export const FINGER_AUTOSCROLL_STEP = DEFAULT_ROW_HEIGHT;
export const FINGER_AUTOSCROLL_DELAY_TICKS = 4;
export const rowIndexOfActiveCell = (state: Pick<PageState, 'activeCell'>, reads: WorkbookReads, cellId: CellId = state.activeCell): number =>
  reads.positionOfCell(cellId)?.rowIndex ?? 0;
