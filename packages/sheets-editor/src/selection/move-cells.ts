import type { SheetId } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { LineSpan } from '../model/line-ids.ts';
import type { OwnFilter, PageState } from '../state/initial-state.ts';
import type { PageContext, PageEvent, PointerDragged, PointerPressed } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { GridLayout } from '../grid/layout.ts';
import type { GridPoint, GridScroll, PaneRect, ShownStretch, SpanOnScreen, StartAndEnd } from '../grid/geometry.ts';
import type { CellArea, CellPosition, CellSelection } from './model.ts';
import {
  selectionKindOf,
  isPeopleListOnActiveCell,
  selectedArea,
  areaGrownOverMerges,
  selectionOfArea,
  areaOfPosition,
  isSameCell,
  scrollToShowPosition,
  BOTH_AXES,
  isSameArea,
  scrollToShowActiveCell,
  moveActiveCellTo,
} from './model.ts';
import {
  rangeSpansOnScreen,
  isSpanInSight,
  frozenRowsHeight,
  frozenColumnsWidth,
  cellUnderPointer,
  autoscrollPointPastEdge,
  isInSpan,
  pointPastColumnEnd,
  rowRunSpanOnScreen,
  columnRunSpanOnScreen,
  cellsAreaHeight,
  isRangeInSight,
  isSpanEndInSight,
  cellsAreaWidth,
} from '../grid/geometry.ts';
import { isIdleOrTapping, withNoEffects } from '../state/transitions.ts';
import { layoutOfView, clampScrollOfView } from '../grid/layout.ts';
import { tablesReadState, areaOfFilteredTable } from '../tables/finding.ts';
import { tablesToOutline } from '../tables/tables-in-view.ts';
import { filteredRowRunsIn } from '../tables/filtered-rows.ts';
import { ownFiltersOfSheet } from '../tables/own-filters.ts';
import { stuckHeadersOfView, dragPositionClearOfStuckHeaders, bottomOfStuckHeadersInSheet } from '../grid/sticky-headers.ts';
import { ROW_HEADER_WIDTH } from '../grid/cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT } from '../grid/cell-metrics.ts';
import { isAreaWithin, splitAreaAround } from './several-ranges.ts';
import { selectAreaFromSeenCorner } from './table-select.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { unbrokenCellBlockOfCorners, landingRowsSkippingFilters, rowCountOfRuns } from '../model/cell-blocks.ts';
import { areaRefBetween, cellRefOf } from '../model/workbook.ts';
import { noticeRowsOutOfViewInTheWay } from '../edits/rows-out-of-view.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** Which edge of an area a strip to grab it by runs along. */
export type EdgeSide = 'top' | 'left' | 'bottom' | 'right';
/** A stretch of the screen along one axis, clipped to what is in sight. */
export interface StretchInSight {
  from: number;
  to: number;
}
/** A table whose outline can be grabbed to move it: its key and area. */
export interface TableOfStrip {
  key: string;
  area: CellArea;
}
/** A table outlined on the grid, as moving cells goes by it: its key, its area, and when its outline is held back for the agent's changes. */
export interface TableToOutline extends TableOfStrip {
  comesLater: { revisionOfMark: number; afterMs: number } | null;
}
/** A strip along an edge of the selection or of a table, to grab it by and move its cells. */
export interface MoveGrabStrip extends PaneRect {
  side: EdgeSide;
  table: TableOfStrip | null;
}
/** The box of a table's handle, and whether it sits over the row numbers with a row number left showing under it. */
export interface TableHandleBox extends PaneRect {
  isAtRowNumbers: boolean;
  rowNumberUnder: number | null;
}
/** A table's handle as drawn: its box, the box near the table that takes the pointer, and the way between them. */
export interface TableHandle extends PaneRect {
  table: TableOfStrip;
  near: PaneRect;
  wayThere: PaneRect;
  isOverRowNumbers: boolean;
  rowNumberUnder: number | null;
  isBesideHeaderKept: boolean;
}
/** What of the drawn grid finding a table handle under the pointer goes by. */
export interface GridOfTableHandles {
  body: Pick<PaneRect, 'left' | 'top'>;
  handlesOfTables: TableHandle[];
  areCellsHeld: boolean;
}
/** What the cells being moved are held by: a table's handle, an edge of the selection, or a table's outline. */
export type HoldOfMovingCells = 'handle' | 'edge' | 'outline';
/** Which cell of the area moved the pointer holds, from its top left. */
export interface CellHeldInArea {
  rowsDown: number;
  columnsAcross: number;
}
/** Cells dragged to move them. */
export interface MovingCellsDrag {
  kind: 'movingCells';
  press: PointerPressed;
  heldBy: HoldOfMovingCells;
  first: CellId;
  last: CellId;
  scrollAtPress: GridScroll;
  grip: GridPoint;
  heldAt: CellHeldInArea;
  landing: CellId | null;
  hasDriftedFromHandle?: true;
  restedOn: CellId | null;
  heldStillAt: GridPoint | null;
  isOffCells: boolean;
  hasTableLeftItsPlace?: true;
  hasTableLeftItsColumns?: true;
  waitsAt?: GridPoint;
}
/** Where moved cells are along one axis: their own first line, where they land so far, where the pointer would take them, and the line held. */
export interface MoveAlongAxis {
  own: number;
  soFar: number;
  next: number;
  held: number;
}
/** How far a table's handle must be pulled before its cells leave their place. */
export interface PullOfHandle {
  least: number;
}
/** The cells a move lands over and replaces, and how many of them have something in them. */
export interface CellsReplaced {
  cells: string;
  count: number;
}
/** Where on screen an area's columns and rows are. */
export type SpansOfArea = ReturnType<typeof rangeSpansOnScreen>;
export let TABLE_HANDLE_WIDTH: number;
export let TABLE_HANDLE_HEIGHT: number;
export let TABLE_HANDLE_GAP: number;
export let TABLE_HANDLE_NARROW_WIDTH: number;
export let TABLE_HANDLE_NARROW_GAP: number;
export let ROW_NUMBER_DIGITS_UNDER_HANDLE: number;
export function edgeStripsOfArea(area: CellArea, table: TableOfStrip | null, state: PageState, layout: GridLayout): MoveGrabStrip[] {
  if (selectionKindOf(area, layout) !== 'cells') return [];
  if (area.rowCount === layout.rowCount && area.columnCount === layout.columnCount) return [];
  let { across, down } = rangeSpansOnScreen(area, state, layout, state);
  if (!isSpanInSight(across) || !isSpanInSight(down)) return [];
  let outset = table === null ? null : 1 / Math.min(state.zoom, 1);
  let [wholeAcross, wholeDown] = [wholeEdgeStrip(across, outset), wholeEdgeStrip(down, outset)];
  return (
    [
    ['top', wholeAcross, startEdgeStrip(down, outset)],
    ['left', startEdgeStrip(across, outset), wholeDown],
    ['bottom', wholeAcross, endEdgeStrip(down, outset, frozenRowsHeight(layout))],
    ['right', endEdgeStrip(across, outset, frozenColumnsWidth(layout)), wholeDown],
  ] satisfies [EdgeSide, StretchInSight | null, StretchInSight | null][]
  ).flatMap(
    ([side, acrossStrip, downStrip]): MoveGrabStrip[] =>
      acrossStrip === null || downStrip === null || acrossStrip.to <= acrossStrip.from || downStrip.to <= downStrip.from
        ? []
        : [
            {
              side,
              table,
              left: acrossStrip.from,
              top: downStrip.from,
              width: acrossStrip.to - acrossStrip.from,
              height: downStrip.to - downStrip.from,
            },
          ],
  );
}
export function moveGrabStrips(state: PageState, reads: ReadsWithTextMeasurer, isEditRefused: boolean, tables?: readonly TableToOutline[]): MoveGrabStrip[] {
  let isIdle = isIdleOrTapping(state) || state.dragging?.kind === 'movingCells';
  if (isEditRefused || !isIdle || state.mode.kind !== 'navigating') return [];
  if (isPeopleListOnActiveCell(state, reads)) return [];
  if (state.menu !== null && state.menu.ofHandleOfTable === undefined) return [];
  let layout = layoutOfView(state, reads);
  let selectionArea: CellArea | null = state.otherRanges.length > 0 ? null : selectedArea(state, reads);
  return [
    ...(tablesReadState(state, state.sheetId) === 'asTheyAre' && state.entriesUnanswered.length === 0
      ? (tables ?? tablesToOutline(state, reads))
      : []
    ).flatMap(
      ({ key, area, comesLater }: TableToOutline) =>
        comesLater !== null ||
        areaGrownOverMerges(reads, state.sheetId, area) !== area ||
        cutsTableHeaderOrFooter(area, state.sheetId, reads) ||
        filteredRowRunsIn(state, reads, area).length > 0
          ? []
          : edgeStripsOfArea(
              area,
              {
                key,
                area,
              },
              state,
              layout,
            ),
    ),
    ...(selectionArea === null ? [] : edgeStripsOfArea(selectionArea, null, state, layout)),
  ];
}
export function tableHandleBox(
  { across, down }: SpansOfArea,
  firstRowHeight: number,
  { topRowIndex, leftColumnIndex }: Pick<CellArea, 'topRowIndex' | 'leftColumnIndex'>,
): TableHandleBox {
  let centredInset = Math.ceil((firstRowHeight - 1 - TABLE_HANDLE_HEIGHT) / 2);
  let isAtRowNumbers = leftColumnIndex === 0 && across.start === 0;
  let width = isAtRowNumbers ? TABLE_HANDLE_NARROW_WIDTH : TABLE_HANDLE_WIDTH;
  return {
    left: across.start - 1 - (isAtRowNumbers ? TABLE_HANDLE_NARROW_GAP : TABLE_HANDLE_GAP) - width,
    top: Math.max(down.showFrom, Math.max(down.start, down.showFrom) + Math.min(centredInset, TABLE_HANDLE_TOP_INSET)),
    width,
    height: TABLE_HANDLE_HEIGHT,
    isAtRowNumbers,
    rowNumberUnder: isAtRowNumbers && String(topRowIndex + 1).length > ROW_NUMBER_DIGITS_UNDER_HANDLE ? topRowIndex + 1 : null,
  };
}
export function tableHandles(tables: readonly TableToOutline[], state: PageState, reads: ReadsWithTextMeasurer, isEditRefused: boolean): TableHandle[] {
  let unscrolledState = {
    ...state,
    scrollLeft: 0,
    scrollTop: 0,
    gridWidth: 1e9,
    gridHeight: 1e9,
  };
  let stripTables = new Map(
    moveGrabStrips(unscrolledState, reads, isEditRefused, tables).flatMap(
      ({ table }): [string, TableOfStrip][] => (table === null ? [] : [[table.key, table]]),
    ),
  );
  if (stripTables.size === 0) return [];
  let layout = layoutOfView(state, reads);
  let spansOf = (area: CellArea): SpansOfArea => rangeSpansOnScreen(area, state, layout, state);
  let nearBoxOf = (area: CellArea): PaneRect => boxOfSpans(spansOf(area), 1 + TABLE_HANDLE_GAP, TABLE_HANDLE_GAP);
  let ownFilterAreas: CellArea[] = ownFiltersOfSheet(state, state.sheetId).flatMap(
    (ownFilter: OwnFilter) => areaOfFilteredTable(reads, ownFilter) ?? [],
  );
  let boxesToAvoid = [
    ...tables.map(
      ({ key, area }) => ({
        key,
        box: nearBoxOf(area),
      }),
    ),
    ...ownFilterAreas.map(
      (filterArea) => ({
        key: null,
        box: nearBoxOf(filterArea),
      }),
    ),
  ];
  let stuckHeaders = stuckHeadersOfView(state, reads, layout);
  let selectionBoxes = [state, ...state.otherRanges].flatMap((range): PaneRect[] => {
    let area: CellArea | null = selectedArea(range, reads);
    return area === null ? [] : [boxOfSpans(spansOf(area))];
  });
  return [...stripTables.values()].flatMap((table): TableHandle[] => {
    let { across, down } = spansOf(table.area);
    let firstRowDown = spansOf({
      ...table.area,
      rowCount: 1,
    }).down;
    let headerKept = (down.start < down.showFrom ? stuckHeaders.find(({ key }) => key === table.key) : null) ?? null;
    let {
      isAtRowNumbers: isOverRowNumbers,
      rowNumberUnder,
      ...box
    } = tableHandleBox(
      {
        across,
        down,
      },
      firstRowDown.end - firstRowDown.start,
      table.area,
    );
    let { left, top } = box;
    if ((headerKept !== null && headerKept.top < headerKept.showFrom) || top + TABLE_HANDLE_HEIGHT > down.showTo) return [];
    if (headerKept === null && firstRowDown.end <= down.showFrom) return [];
    if (isOverRowNumbers && headerKept?.areRowNumbersItsOwn === false) return [];
    if (!isOverRowNumbers && left < across.showFrom) return [];
    if (
      boxesToAvoid.some((toAvoid) => toAvoid.key !== table.key && doBoxesIntersect(box, toAvoid.box)) ||
      selectionBoxes.some((selectionBox) => doBoxesIntersect(box, selectionBox))
    )
      return [];
    let near = nearBoxOf(table.area);
    let wayThere = {
      ...near,
      left,
      width: near.left - left,
    };
    return [
      {
        table,
        ...box,
        near,
        wayThere,
        isOverRowNumbers,
        rowNumberUnder,
        isBesideHeaderKept: headerKept !== null,
      },
    ];
  });
}
export function tableHandleUnderPointer(pointer: GridPoint, grid: GridOfTableHandles, heldKey: string | null): string | null {
  let [x, y] = [pointer.x - grid.body.left, pointer.y - grid.body.top];
  let held = grid.handlesOfTables.find(({ table }) => table.key === heldKey);
  if (held !== undefined && isPointInBox(x, y, held)) return heldKey;
  if (grid.areCellsHeld) return null;
  if (held !== undefined && isPointInBox(x, y, held.wayThere)) return heldKey;
  return grid.handlesOfTables.find(({ near }) => isPointInBox(x, y, near))?.table.key ?? null;
}
export function gripOffsetInSpan({ start, end, showFrom, showTo }: StartAndEnd & ShownStretch, position: number): number {
  let [from, to] = [Math.max(start, showFrom), Math.min(end, showTo)];
  let snap = Math.min(MOVE_CELLS_SNAP, (to - from) / 2);
  return clampNumber(position, from + snap, to - snap);
}
export function handleUnderPress(
  state: PageState,
  press: PointerPressed,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): TableHandle | undefined {
  if (press.onHandleOfTable === undefined || press.isByFinger || press.isToldOfLate === true) return;
  if ((press.isShiftHeld || press.isModifierHeld === true) && press.x < ROW_HEADER_WIDTH) return;
  let [x, y] = [press.x - ROW_HEADER_WIDTH, press.y - COLUMN_HEADER_HEIGHT];
  return tableHandles(tablesToOutline(state, reads), state, reads, refusalOfEveryEdit !== null).find(
    (handle) => handle.table.key === press.onHandleOfTable && isPointInBox(x, y, handle),
  );
}
export function startMovingCells(
  state: PageState,
  press: PointerPressed,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
) {
  let isModified = press.isShiftHeld || press.isModifierHeld === true;
  let isOnHandleOverCells = press.onHandleOfTable !== undefined && press.x >= ROW_HEADER_WIDTH;
  if (press.isByFinger || (isModified && !isOnHandleOverCells)) return null;
  if (press.isToldOfLate === true) return null;
  let [x, y] = [press.x - ROW_HEADER_WIDTH, press.y - COLUMN_HEADER_HEIGHT];
  let isHeaderKept = press.madeOver?.headerKept !== undefined;
  let stripsUnderPress = moveGrabStrips(state, reads, refusalOfEveryEdit !== null).filter(
    ({ table, left, top, width, height }) =>
      !(isHeaderKept && table !== null) && x >= left && x < left + width && y >= top && y < top + height,
  );
  let selectionArea: CellArea | null = selectedArea(state, reads);
  let strip =
    stripsUnderPress.find(
      ({ table }) => table !== null && !(selectionArea !== null && isAreaWithin(table.area, selectionArea)),
    ) ?? stripsUnderPress.at(-1);
  let handle = handleUnderPress(state, press, {
    reads,
    refusalOfEveryEdit,
  });
  let held = handle ?? (isModified ? undefined : strip);
  if (held === undefined) return null;
  let tableSelection = held.table === null ? null : selectAreaFromSeenCorner(state, reads, held.table.area);
  if (held.table !== null && tableSelection === null) return null;
  let view: PageState =
    tableSelection === null
      ? state
      : {
          ...state,
          ...tableSelection,
          leftByKeyAt: null,
        };
  let area: CellArea | null = selectedArea(view, reads);
  let selection: CellSelection | null = area === null ? null : selectionOfArea(view, reads, area);
  if (area === null || selection === null) return null;
  let layout = layoutOfView(view, reads);
  let { across, down } = rangeSpansOnScreen(area, view, layout, view);
  let cellPressed = cellUnderPointer(
    {
      x: ROW_HEADER_WIDTH + clampNumber(x, across.start + (handle === undefined ? 0 : 1), across.end - 1),
      y: COLUMN_HEADER_HEIGHT + clampNumber(y, down.start, down.end - 1),
    },
    view,
    layout,
    view,
  );
  let cellSpans = rangeSpansOnScreen(areaOfPosition(cellPressed), view, layout, view);
  return {
    ...view,
    dragging: {
      kind: 'movingCells',
      press,
      heldBy: handle !== undefined ? 'handle' : held.table === null ? 'edge' : 'outline',
      first: selection.activeCell,
      last: selection.selectionCorner,
      scrollAtPress: {
        scrollLeft: view.scrollLeft,
        scrollTop: view.scrollTop,
      },
      grip:
        handle === undefined
          ? {
              x: x - gripOffsetInSpan(cellSpans.across, x),
              y: y - gripOffsetInSpan(cellSpans.down, y),
            }
          : {
              x: 0,
              y: y - clampNumber(y, cellSpans.down.start, cellSpans.down.end - 1),
            },
      heldAt: {
        rowsDown: cellPressed.rowIndex - area.topRowIndex,
        columnsAcross: cellPressed.columnIndex - area.leftColumnIndex,
      },
      landing: null,
      restedOn: null,
      heldStillAt: null,
      isOffCells: false,
    } satisfies MovingCellsDrag,
  };
}
export function autoscrollMovingCells<P extends GridPoint>(state: PageState, pointer: P, heldArea: CellArea, landingArea: CellArea | null): P {
  let isMovingDown = landingArea !== null && landingArea.topRowIndex > heldArea.topRowIndex;
  let isMovingRight = landingArea !== null && landingArea.leftColumnIndex > heldArea.leftColumnIndex;
  let pointerAlongRows = autoscrollPointPastEdge(pointer, state, isMovingDown ? 'down' : 'up') ?? pointer;
  return autoscrollPointPastEdge(pointerAlongRows, state, isMovingRight ? 'right' : 'left') ?? pointerAlongRows;
}
export function isHeldBackFromNext(
  { own, soFar, next, held }: MoveAlongAxis,
  pointerMoved: number,
  spanOfRun: (run: LineSpan) => SpanOnScreen,
  zoom: number,
  pull: PullOfHandle | null = null,
): boolean {
  let [firstIndex, endIndex] = next > own ? [own + held + 1, next + held + 1] : [next + held, own + held];
  let shownSizeOf = (run: LineSpan): number => {
    let { start, end, showFrom, showTo } = spanOfRun(run);
    return next > own ? Math.min(end, showTo) - Math.max(start, showFrom) : Math.min(end - start, Math.max(end, showFrom));
  };
  let shownSize = Math.max(
    shownSizeOf({
      firstIndex,
      count: endIndex - firstIndex,
    }),
    pull === null
      ? 0
      : shownSizeOf({
          firstIndex: own + held,
          count: 1,
        }),
  );
  let isWithinSnap = Math.abs(pointerMoved) < Math.max(MOVE_CELLS_SNAP / zoom, shownSize / 2, pull?.least ?? 0);
  return soFar === own && next !== own && isWithinSnap;
}
export function dragMovingCells(state: PageState, drag: MovingCellsDrag, pointer: Pick<PointerDragged, 'x' | 'y' | 'isHeldStill'>, reads: ReadsWithTextMeasurer) {
  let { heldAt } = drag;
  let heldArea = areaStillHeld(state, reads, drag);
  if (heldArea === null) return cancelMovingCells(state, drag, reads);
  let landingArea = landingAreaOfMove(state, reads, drag);
  let pointerScrolled = pointer.isHeldStill === true ? autoscrollMovingCells(state, pointer, heldArea, landingArea) : pointer;
  let { topRowIndex, leftColumnIndex } = landingArea ?? heldArea;
  let grownSoFar = areaOfPosition({
    rowIndex: topRowIndex + heldAt.rowsDown,
    columnIndex: leftColumnIndex + heldAt.columnsAcross,
  });
  let layout = layoutOfView(state, reads);
  let clampColumn = (columnIndex: number): number =>
    clampNumber(columnIndex - heldAt.columnsAcross, 0, layout.columnCount - heldArea.columnCount);
  let clampRow = (rowIndex: number): number => clampNumber(rowIndex - heldAt.rowsDown, 0, layout.rowCount - heldArea.rowCount);
  let cellsLeft = ROW_HEADER_WIDTH + rangeSpansOnScreen(heldArea, state, layout, state).across.start;
  let pointerHeld = (rawPointer: GridPoint): GridPoint => {
    let held = pointerForMovingCells(rawPointer, drag, layout, state);
    if (drag.heldBy !== 'handle') return held;
    return isInSpan(held.x, cellsLeft - TABLE_HANDLE_REACH, TABLE_HANDLE_REACH)
      ? {
          ...held,
          x: cellsLeft + 1,
        }
      : pointPastColumnEnd(held, state, layout, state);
  };
  let positionOfPointer = (rawPointer: GridPoint): CellPosition =>
    dragPositionClearOfStuckHeaders(pointerHeld(rawPointer), state, reads, layout, {
      of: (columnIndex: number) => ({
        leftColumnIndex: clampColumn(columnIndex),
        columnCount: heldArea.columnCount,
      }),
      fromRow: bottomOfStuckHeadersInSheet(state, reads, heldArea, layout) === null ? -1 : heldArea.topRowIndex + heldAt.rowsDown,
      grownSoFar,
    });
  let pointerAtPress = {
    x: drag.press.x - (state.scrollLeft - drag.scrollAtPress.scrollLeft),
    y: drag.press.y - (state.scrollTop - drag.scrollAtPress.scrollTop),
  };
  let position = positionOfPointer(pointerScrolled);
  let isRowHeldBack = isHeldBackFromNext(
    {
      own: heldArea.topRowIndex,
      soFar: topRowIndex,
      next: clampRow(position.rowIndex),
      held: heldAt.rowsDown,
    },
    pointerScrolled.y - pointerAtPress.y,
    (run) => rowRunSpanOnScreen(run, state, layout, state),
    state.zoom,
    drag.heldBy === 'handle'
      ? {
          least: 0,
        }
      : null,
  );
  let isColumnHeldBack = isHeldBackFromNext(
    {
      own: heldArea.leftColumnIndex,
      soFar: leftColumnIndex,
      next: clampColumn(position.columnIndex),
      held: heldAt.columnsAcross,
    },
    pointerScrolled.x - pointerAtPress.x,
    (run) => columnRunSpanOnScreen(run, state, layout, state),
    state.zoom,
    drag.heldBy === 'handle'
      ? {
          least: leastPullAcrossForHandle(drag),
        }
      : null,
  );
  let heldBackX = drag.heldBy === 'handle' ? cellsLeft - 1 : pointerAtPress.x;
  let landingPosition =
    isRowHeldBack || isColumnHeldBack
      ? positionOfPointer({
          x: isColumnHeldBack ? heldBackX : pointerScrolled.x,
          y: isRowHeldBack ? pointerAtPress.y : pointerScrolled.y,
        })
      : position;
  let isOffCells = !(
    isInSpan(pointer.x, ...columnZoneOfDrag(drag, state)) && isInSpan(pointer.y, COLUMN_HEADER_HEIGHT, cellsAreaHeight(state))
  );
  let landing = reads.cellIdAt(state.sheetId, clampRow(landingPosition.rowIndex), clampColumn(landingPosition.columnIndex));
  let isAtLanding = (cellId: CellId): boolean => landing !== null && isSameCell(landing, cellId);
  let isHeldBack = isRowHeldBack || isColumnHeldBack;
  let isStillAtFirst = drag.landing === null || isSameCell(drag.landing, drag.first);
  let scrolled: PageState =
    isAtLanding(drag.first) && (isHeldBack || (!isOffCells && isStillAtFirst))
      ? state
      : scrollToShowPosition(state, reads, landingPosition, BOTH_AXES, 'pointer');
  let mayStayPut = !isHeldBack || drag.heldBy === 'handle';
  if (drag.landing === null && !isOffCells && mayStayPut && isAtLanding(drag.first)) return state;
  let isUnchanged =
    drag.landing !== null &&
    isAtLanding(drag.landing) &&
    isOffCells === drag.isOffCells &&
    scrolled.scrollTop === state.scrollTop &&
    scrolled.scrollLeft === state.scrollLeft;
  let isOnRestedCell = drag.restedOn !== null && isAtLanding(drag.restedOn);
  if (isUnchanged && (isOffCells || isOnRestedCell)) return state;
  let { heldStillAt } = drag;
  let isNearHeldStill = heldStillAt !== null && Math.hypot(pointer.x - heldStillAt.x, pointer.y - heldStillAt.y) < HOLD_STILL_DISTANCE;
  if (isUnchanged && pointer.isHeldStill !== true && (heldStillAt === null || isNearHeldStill)) return state;
  let isHeldStillHere = isUnchanged && pointer.isHeldStill === true;
  let hasRested = isHeldStillHere && isNearHeldStill;
  let nextDrag: MovingCellsDrag = {
    ...drag,
    landing,
    isOffCells,
    heldStillAt:
      isHeldStillHere && !hasRested
        ? {
            x: pointer.x,
            y: pointer.y,
          }
        : null,
    restedOn: hasRested ? landing : drag.restedOn,
  };
  return {
    ...scrolled,
    dropdown: null,
    peopleList: null,
    dragging: nextDrag,
  };
}
export function areaStillHeld(state: PageState, reads: WorkbookReads, { first, last }: Pick<MovingCellsDrag, 'first' | 'last'>): CellArea | null {
  let area: CellArea | null = selectedArea(state, reads);
  let selection: CellSelection | null = area === null ? null : selectionOfArea(state, reads, area);
  return selection !== null && isSameCell(selection.activeCell, first) && isSameCell(selection.selectionCorner, last) ? area : null;
}
export function landingAreaOfMove(state: PageState, reads: WorkbookReads, drag: Pick<MovingCellsDrag, 'landing' | 'first' | 'last'>): CellArea | null {
  let landingPosition = drag.landing === null ? null : reads.positionOfCell(drag.landing);
  let heldArea = areaStillHeld(state, reads, drag);
  if (landingPosition === null || heldArea === null) return null;
  let landingArea = {
    ...heldArea,
    topRowIndex: landingPosition.rowIndex,
    leftColumnIndex: landingPosition.columnIndex,
  };
  return isSameArea(landingArea, heldArea) ? null : landingArea;
}
export function noteTableLeftItsPlace(state: PageState): PageState {
  let { dragging } = state;
  if (dragging?.kind !== 'movingCells' || !isHeldByHandleAtRowNumbers(dragging)) return state;
  let {
    landing,
    first,
    hasTableLeftItsPlace,
    hasTableLeftItsColumns,
  } = dragging;
  let hasLeftPlace = hasTableLeftItsPlace !== true && isMoveLandingElsewhere(dragging);
  let hasLeftColumns = hasTableLeftItsColumns !== true && landing !== null && landing.columnId !== first.columnId;
  if (!hasLeftPlace && !hasLeftColumns) return state;
  return {
    ...state,
    dragging: {
      ...dragging,
      hasTableLeftItsPlace: true,
      ...(hasLeftColumns && {
        hasTableLeftItsColumns: true,
      }),
    },
  };
}
export function cancelMovingCells(state: PageState, { scrollAtPress }: Pick<MovingCellsDrag, 'scrollAtPress'>, reads: ReadsWithTextMeasurer): PageState {
  let view = clampScrollOfView(
    {
      ...state,
      ...scrollAtPress,
      dragging: null,
    },
    reads,
  );
  let area: CellArea | null = selectedArea(view, reads);
  return area === null || isRangeInSight(area, view, layoutOfView(view, reads), view) ? view : scrollToShowActiveCell(view, reads);
}
export function cellsReplacedByMove(state: PageState, reads: WorkbookReads): CellsReplaced | null {
  let [heldArea, landingArea]: [CellArea | null, CellArea | null] = [selectedArea(state, reads), landingAreaOfMovingCells(state, reads)];
  if (heldArea === null || landingArea === null) return null;
  let count = splitAreaAround(landingArea, heldArea, 'rows').flatMap(
    (area) => reads.filledCellsIn(state.sheetId, area),
  ).length;
  return count === 0
    ? null
    : {
        cells: areaToA1AsStored(landingArea, ownRowOrderOfSheet(reads, state.sheetId)),
        count,
      };
}
export function dropMovedCells(
  state: PageState,
  drag: MovingCellsDrag,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition {
  let view = cancelMovingCells(state, drag, reads);
  if (drag.landing === null || landingAreaOfMovingCells(state, reads) === null) {
    let cellPressed =
      drag.heldBy === 'outline' && !drag.isOffCells && drag.landing !== null && isSameCell(drag.landing, drag.first)
        ? cellUnderPress(drag.press, view, reads)
        : null;
    return withNoEffects(cellPressed === null ? view : moveActiveCellTo(view, reads, cellPressed, 'pointer'));
  }
  if (refusalOfEveryEdit !== null)
    return withNoEffects({
      ...view,
      notice: {
        kind: 'editRefused',
        why: refusalOfEveryEdit,
        asked: 'otherEdit',
      },
    });
  let cells = unbrokenCellBlockOfCorners(state, reads, areaRefBetween(drag.first, drag.last));
  let landingRows =
    cells === null ? null : landingRowsSkippingFilters(state, reads, state.sheetId, drag.landing.rowId, rowCountOfRuns(cells.rows));
  if (cells === null || landingRows === null) return noticeRowsOutOfViewInTheWay(view, 'moveCells');
  let replaced = cellsReplacedByMove(state, reads);
  return queueEdit(
    {
      ...state,
      dragging: null,
    },
    {
      kind: 'moveCells',
      cells,
      toSheetId: state.sheetId,
      toTopLeft: cellRefOf(drag.landing),
      ...landingRows,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: 'placeChanged',
      foundBy: 'fillHandle',
      done:
        replaced === null
          ? 'moved'
          : {
              what: 'movedOverCells',
              ...replaced,
            },
      undoOffer:
        replaced === null
          ? null
          : {
              kind: 'moveReplacedCells',
              ...replaced,
            },
      scrollIfRefused: drag.scrollAtPress,
    },
  );
}
export function holdMoveAtRowNumbers(state: PageState, event: PageEvent) {
  let { dragging } = state;
  return event.kind === 'pointerDragged' &&
    dragging?.kind === 'movingCells' &&
    isHeldByHandleAtRowNumbers(dragging) &&
    dragging.hasTableLeftItsPlace !== true &&
    isInSpan(event.x, ROW_HEADER_WIDTH, ROW_NUMBERS_HANDLE_SLACK)
    ? {
        ...state,
        dragging: {
          ...dragging,
          waitsAt: {
            x: event.x,
            y: event.y,
          },
        },
      }
    : null;
}
export function dropMoveWait(state: PageState) {
  if (state.dragging?.kind !== 'movingCells' || state.dragging.waitsAt === undefined) return state;
  let { waitsAt: _waitsAt, ...dragging } = state.dragging;
  return {
    ...state,
    dragging,
  };
}
export function dragToWaitedRowOnRelease({ dragging }: Pick<PageState, 'dragging'>, event: PageEvent): PointerDragged | null {
  let waitsAt =
    event.kind === 'pointerReleased' && event.isPointerLost !== true && dragging?.kind === 'movingCells' && dragging.hasTableLeftItsPlace !== true
      ? dragging.waitsAt
      : undefined;
  return waitsAt === undefined
    ? null
    : {
        kind: 'pointerDragged',
        x: ROW_HEADER_WIDTH - 1,
        y: waitsAt.y,
      };
}
export function pressToMoveCellsOutOfTable(state: PageState, event: PageEvent, reads: ReadsWithTextMeasurer) {
  let dragging = state.dragging;
  if (event.kind !== 'pointerDragged' || dragging?.kind !== 'movingCells') return null;
  if (!(isHeldByHandleAtRowNumbers(dragging) && dragging.hasTableLeftItsColumns !== true && event.x < ROW_HEADER_WIDTH)) return null;
  let moved = dragMovingCells(state, dragging, event, reads).dragging;
  if (moved?.kind !== 'movingCells' || !isMoveLandingElsewhere(moved)) return null;
  let { onHandleOfTable: _onHandleOfTable, ...press } = dragging.press;
  return press;
}
export const EDGE_GRAB_WIDTH = 3;
export const EDGE_GRAB_SCALE = 1;
export const clipSpanToSight = (from: number, to: number, { showFrom, showTo }: ShownStretch): StretchInSight => ({
  from: Math.max(from, showFrom),
  to: Math.min(to, showTo),
});
export const edgeGrabInset = ({ start, end }: StartAndEnd, outset: number | null): number =>
  outset === null ? Math.min(EDGE_GRAB_WIDTH, (end - start) / 4) : EDGE_GRAB_SCALE * outset;
export const edgeGrabOutset = (outset: number | null): number => outset ?? 1 + EDGE_GRAB_WIDTH;
export const startEdgeStrip = (span: SpanOnScreen, outset: number | null): StretchInSight | null =>
  (outset === null ? span.start >= span.showFrom : span.start > span.showFrom) && span.start < span.showTo
    ? clipSpanToSight(span.start - edgeGrabOutset(outset), span.start + edgeGrabInset(span, outset), span)
    : null;
export const endEdgeStrip = (span: SpanOnScreen, outset: number | null, frozenSize: number): StretchInSight | null =>
  isSpanEndInSight(span)
    ? clipSpanToSight(
        Math.max(span.end - (outset ?? 1) - edgeGrabInset(span, outset), span.end > frozenSize ? frozenSize : 0),
        span.end + (outset === null ? EDGE_GRAB_WIDTH : 0),
        span,
      )
    : null;
export const wholeEdgeStrip = (span: SpanOnScreen, outset: number | null): StretchInSight =>
  clipSpanToSight(span.start - edgeGrabOutset(outset), span.end + (outset === null ? EDGE_GRAB_WIDTH : 0), span);
export const cutsTableHeaderOrFooter = (
  { topRowIndex, rowCount, leftColumnIndex, columnCount }: CellArea,
  sheetId: SheetId,
  reads: WorkbookReads,
): boolean =>
  reads.cellTablesDeclaredIn(sheetId).some(({ liveCellTable }) => {
    let firstColumnIndex = reads.columnIndexOf(sheetId, liveCellTable.firstColumn);
    let lastColumnIndex = reads.columnIndexOf(sheetId, liveCellTable.lastColumn);
    if (firstColumnIndex === null || lastColumnIndex === null) return true;
    if (leftColumnIndex > lastColumnIndex || leftColumnIndex + columnCount <= firstColumnIndex) return false;
    let coversAllColumns = leftColumnIndex <= firstColumnIndex && leftColumnIndex + columnCount > lastColumnIndex;
    let headerAndFooterRows = [liveCellTable.headerRows, liveCellTable.footerRows].flatMap(
      (rows) =>
        rows === null
          ? []
          : [
              {
                first: reads.rowIndexOf(sheetId, rows.firstRow),
                last: reads.rowIndexOf(sheetId, rows.lastRow),
              },
            ],
    );
    let touchesHeaderOrFooter = headerAndFooterRows.some(
      ({ first, last }) => first === null || last === null || (topRowIndex <= last && topRowIndex + rowCount > first),
    );
    let coversHeaderAndFooter = headerAndFooterRows.every(
      ({ first, last }) => first !== null && last !== null && topRowIndex <= first && topRowIndex + rowCount > last,
    );
    return touchesHeaderOrFooter && !(coversAllColumns && coversHeaderAndFooter);
  });
[TABLE_HANDLE_WIDTH, TABLE_HANDLE_HEIGHT, TABLE_HANDLE_GAP] = [18, 22, 3];
export const TABLE_HANDLE_TOP_INSET = 3;
export const TABLE_HANDLE_REACH = 1 + TABLE_HANDLE_GAP + TABLE_HANDLE_WIDTH;
[TABLE_HANDLE_NARROW_WIDTH, TABLE_HANDLE_NARROW_GAP, ROW_NUMBER_DIGITS_UNDER_HANDLE] = [13, 1, 2];
export const boxOfSpans = ({ across, down }: SpansOfArea, growStart: number = 0, growEnd: number = 0): PaneRect => {
  let [acrossClip, downClip] = [
    clipSpanToSight(across.start - growStart, across.end + growEnd, across),
    clipSpanToSight(down.start - growStart, down.end + growEnd, down),
  ];
  return {
    left: acrossClip.from,
    top: downClip.from,
    width: acrossClip.to - acrossClip.from,
    height: downClip.to - downClip.from,
  };
};
export const doBoxesIntersect = (box: PaneRect, otherBox: PaneRect): boolean =>
  box.left < otherBox.left + otherBox.width &&
  otherBox.left < box.left + box.width &&
  box.top < otherBox.top + otherBox.height &&
  otherBox.top < box.top + box.height;
export const isPointInBox = (x: number, y: number, { left, top, width, height }: PaneRect): boolean =>
  x >= left && x < left + width && y >= top && y < top + height;
export const clampNumber = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));
export const clampGripAcrossZones = (zoneEdges: readonly number[], pressAt: number, grip: number, pointerAt: number): number =>
  zoneEdges.reduce((position, edge) => {
    let isPressPastEdge = pressAt >= edge;
    if (pressAt - grip >= edge !== isPressPastEdge || pointerAt >= edge !== isPressPastEdge) return position;
    return isPressPastEdge ? Math.max(position, edge) : Math.min(position, edge - 1);
  }, pointerAt - grip);
export const pointerForMovingCells = (
  { x, y }: GridPoint,
  { press, grip }: Pick<MovingCellsDrag, 'press' | 'grip'>,
  layout: GridLayout,
  { gridWidth, gridHeight }: Pick<PageState, 'gridWidth' | 'gridHeight'>,
): GridPoint => ({
  x: clampGripAcrossZones([ROW_HEADER_WIDTH, ROW_HEADER_WIDTH + frozenColumnsWidth(layout), gridWidth], press.x, grip.x, x),
  y: clampGripAcrossZones([COLUMN_HEADER_HEIGHT, COLUMN_HEADER_HEIGHT + frozenRowsHeight(layout), gridHeight], press.y, grip.y, y),
});
export const MOVE_CELLS_SNAP = 8;
export const HOLD_STILL_DISTANCE = 3;
export const columnZoneOfDrag = ({ heldBy }: Pick<MovingCellsDrag, 'heldBy'>, view: Pick<PageState, 'gridWidth'>): [number, number] =>
  heldBy === 'handle' ? [0, ROW_HEADER_WIDTH + cellsAreaWidth(view)] : [ROW_HEADER_WIDTH, cellsAreaWidth(view)];
export const landingAreaOfMovingCells = ({ dragging, ...rest }: PageState, reads: WorkbookReads): CellArea | null =>
  dragging?.kind !== 'movingCells' || dragging.isOffCells
    ? null
    : landingAreaOfMove(
        {
          ...rest,
          dragging,
        },
        reads,
        dragging,
      );
export const isHeldByHandleAtRowNumbers = ({ press }: Pick<MovingCellsDrag, 'press'>): boolean =>
  press.onHandleOfTable !== undefined && press.x < ROW_HEADER_WIDTH;
export const leastPullAcrossForHandle = (drag: Pick<MovingCellsDrag, 'press'>): number =>
  isHeldByHandleAtRowNumbers(drag) ? ROW_HEADER_WIDTH - drag.press.x + 2 * ROW_NUMBERS_HANDLE_SLACK : 0;
export const isMoveLandingElsewhere = ({ landing, first }: Pick<MovingCellsDrag, 'landing' | 'first'>): boolean =>
  landing !== null && !isSameCell(landing, first);
export const ROW_NUMBERS_HANDLE_SLACK = 16;
export const cellUnderPress = (point: GridPoint, view: PageState, reads: ReadsWithTextMeasurer): CellId | null => {
  let { rowIndex, columnIndex } = cellUnderPointer(point, view, layoutOfView(view, reads), view);
  return reads.cellIdAt(view.sheetId, rowIndex, columnIndex);
};
export const withoutMoveReplacedOffer = (before: PageState, state: PageState, event: PageEvent): PageState =>
  state.undoOffer?.kind === 'moveReplacedCells' &&
  (event.kind === 'pointerPressed' ||
    state.sheetId !== before.sheetId ||
    (state.undoOfTurnOffered !== null && state.undoOfTurnOffered !== before.undoOfTurnOffered) ||
    (state.mode.kind === 'editing' && before.mode.kind !== 'editing'))
    ? {
        ...state,
        undoOffer: null,
      }
    : state;
