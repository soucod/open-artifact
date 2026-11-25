import type { LineSpan } from '../model/line-ids.ts';
import type { LineSizes } from '../model/line-sizes.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { BoxAtFoot, PageState } from '../state/initial-state.ts';
import type { GridLayout, LineResize, ReachOfWhatFloats } from './layout.ts';
import {
  isLineShown,
  shownLineAtOrAfter,
  shownLineAtOrBefore,
  nearestShownLine,
  scrollPositionAtPixel,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_ROW_HEIGHT,
  MAX_ROW_HEIGHT,
} from '../model/line-sizes.ts';
import type { ScrollPosition } from '../model/line-sizes.ts';
import { ROW_HEADER_WIDTH, DEFAULT_ROW_HEIGHT } from './cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT } from './cell-metrics.ts';
/** How far the cells are scrolled, in pixels. */
export interface GridScroll {
  scrollLeft: number;
  scrollTop: number;
}
/** How a cell to show was come to: by a key, or by the pointer. */
export type CellFoundBy = 'key' | 'pointer';
/** The rows or the columns of the grid, as one axis: their edges, how many there are, and how many are frozen. */
export interface GridAxis {
  edges: LineSizes;
  count: number;
  frozenCount: number;
}
/** The rows of a layout, enough to make an axis of them. */
export type RowLines = Pick<GridLayout, 'rowEdges' | 'rowCount' | 'frozenRowCount'>;
/** The columns of a layout, enough to make an axis of them. */
export type ColumnLines = Pick<GridLayout, 'columnEdges' | 'columnCount' | 'frozenColumnCount'>;
/** The room the grid has on the page, and how much of it floats over the cells at the foot. */
export type GridRoom = Pick<PageState, 'gridWidth' | 'gridHeight' | 'heightUnderWhatFloats'>;
/** Which lines a pointer started among, when some are frozen. */
export type FrozenPart = 'someFrozenLine' | 'onlyLinesThatScroll';
/** Which lines are being dragged or dropped among. */
export type LinesAxisName = 'rows' | 'columns';
/** The way the pointer is past an edge of the grid. */
export type AutoscrollDirection = 'up' | 'down' | 'left' | 'right';
/** A point on the grid, in pixels from its top left corner. */
export interface GridPoint {
  x: number;
  y: number;
}
export interface StartAndEnd {
  start: number;
  end: number;
}
/** Where a line's resize grip is on screen: its edge and the stretch a pointer takes it in. */
export interface ResizeGrip extends StartAndEnd {
  edge: number;
}
/** How many lines are frozen, and how many lines that scroll are under them. */
export interface LinesUnderFrozen {
  frozenCount: number;
  under: number;
}
/** A box in a line, to scroll into sight: how far past the line's start it is, how long, and the room around it. */
export interface BoxAlongLine {
  pastStart?: number;
  length: number;
  around: number;
}
/** A box in a cell, to scroll into sight with what is shown under it. */
export interface BoxInCell {
  left: number;
  top: number;
  width: number;
  height: number;
  around: number;
  heightShownUnder: number;
}
/** A cell to scroll into sight, and how high the headers that stick over it are. */
export interface CellToShow extends CellPosition {
  heightCovered?: number;
}
/** What part of the grid a point is on. */
export type GridHit =
  | { kind: 'corner' }
  | { kind: 'rowHeader'; rowIndex: number }
  | { kind: 'columnHeader'; columnIndex: number }
  | ({ kind: 'cell' } & CellPosition);
/** How much further than the room to lay lines out, before and after. */
export interface ExtraReach {
  before: number;
  after: number;
}
/** Where on screen lines are shown, between two offsets. */
export interface ShownStretch {
  showFrom: number;
  showTo: number;
}
/** The lines of one axis drawn together: the frozen ones, or those that scroll. */
export interface GridPane extends ShownStretch {
  first: number;
  count: number;
  areFrozen: boolean;
  scroll: number;
}
/** Where a run of lines is on screen, and the stretch of the screen they are shown in. */
export interface SpanOnScreen extends StartAndEnd, ShownStretch {
  isEndUnderFrozenLines: boolean;
}
/** Where an area of cells is on screen, across and down. */
export interface AreaSpansOnScreen {
  across: SpanOnScreen;
  down: SpanOnScreen;
}
/** The edges of cells in the sheet, in pixels. */
export interface EdgesOfCells {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface PaneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function contentOffsetAt(offset: number, scroll: number, axis: GridAxis, frozenPart: FrozenPart | null = null): number {
  let frozenSize = frozenSizeOf(axis);
  if (offset >= frozenSize) return offset + scroll;
  if (scroll === 0 || frozenPart === 'someFrozenLine') return offset;
  let scrolledOffset = frozenSize + Math.max(0, offset + scroll);
  if (frozenPart === null) return offset >= 0 ? offset : scrolledOffset;
  let firstUnfrozenStart = axis.edges.startOf(axis.edges.indexAt(frozenSize + scroll));
  if (firstUnfrozenStart <= frozenSize) return offset;
  return offset >= 0 ? firstUnfrozenStart - 1 : Math.min(firstUnfrozenStart - 1, scrolledOffset);
}
export function lastShownLineWhere(indices: readonly number[], edges: LineSizes, isWanted: (index: number) => boolean): number | null {
  for (let at = indices.length - 1; at >= 0; at -= 1) {
    let index = indices[at];
    if (index !== undefined && isLineShown(edges, index) && isWanted(index)) return index;
  }
  return null;
}
export function pointPastColumnEnd<P extends GridPoint>(
  point: P,
  { scrollLeft }: Pick<GridScroll, 'scrollLeft'> = {} as Pick<GridScroll, 'scrollLeft'>,
  layout: ColumnLines,
  view: Pick<PageState, 'gridWidth'>,
): P {
  if (point.x < 0) return point;
  let [offset, axis] = [point.x - ROW_HEADER_WIDTH, columnAxisOf(layout)];
  let index = axis.edges.indexAt(contentOffsetAt(offset, scrollLeft, axis));
  let pastEnd = (offset < 0 ? 0 : lineEndOnScreen(index, scrollLeft, axis)) + 1;
  return pastEnd < cellsAreaWidth(view)
    ? {
        ...point,
        x: ROW_HEADER_WIDTH + pastEnd,
      }
    : point;
}
export function frozenPartOf(index: number, { frozenCount }: Pick<GridAxis, 'frozenCount'>): FrozenPart | null {
  if (frozenCount === 0) return null;
  return index < frozenCount ? 'someFrozenLine' : 'onlyLinesThatScroll';
}
export function scrolledLinesUnderFrozen(scroll: number, axis: GridAxis): LinesUnderFrozen {
  let { edges, frozenCount } = axis;
  if (frozenCount === 0 || scroll === 0)
    return {
      frozenCount,
      under: 0,
    };
  let position = frozenSizeOf(axis) + scroll;
  let index = edges.indexAt(position);
  let isPartlyScrolled = edges.startOf(index) < position;
  return {
    frozenCount,
    under: index - frozenCount + (isPartlyScrolled ? 1 : 0),
  };
}
export function clampScroll(scroll: GridScroll, layout: GridLayout, view: GridRoom): GridScroll {
  return {
    scrollLeft: clampBetween(scroll.scrollLeft, 0, maxScrollLeft(layout, view)),
    scrollTop: clampBetween(scroll.scrollTop, 0, maxScrollTop(layout, view)),
  };
}
export function clampScrollWithFloats(scroll: GridScroll, layout: GridLayout, view: GridRoom): GridScroll {
  let max = maxScrollWithFloats(layout, view);
  return {
    scrollLeft: clampBetween(scroll.scrollLeft, 0, max.scrollLeft),
    scrollTop: clampBetween(scroll.scrollTop, 0, max.scrollTop),
  };
}
export function clampScrollKeepingReach(reach: GridScroll, scroll: GridScroll, layout: GridLayout, view: GridRoom): GridScroll {
  let reachMax = clampScrollWithFloats(reach, layout, view);
  return {
    scrollLeft: clampBetween(scroll.scrollLeft, 0, Math.max(maxScrollLeft(layout, view), reachMax.scrollLeft)),
    scrollTop: clampBetween(scroll.scrollTop, 0, Math.max(maxScrollTop(layout, view), reachMax.scrollTop)),
  };
}
export function scrollToShowSpan(scroll: number, start: number, length: number, room: number, isLast: boolean): number {
  if (length > room) return scroll > start && scroll <= start + length - (isLast ? 1 : room) ? scroll : start;
  if (start < scroll) return start;
  return start + length > scroll + room ? start + length - room : scroll;
}
export function scrollToShowLine(
  scroll: number,
  index: number,
  room: number,
  axis: GridAxis,
  box: BoxAlongLine | undefined,
  extraAtEnd: number = 0,
  covered: number = 0,
): number {
  if (index < axis.frozenCount) return scroll;
  let frozenSize = frozenSizeOf(axis) + covered;
  let scrollingRoom = Math.max(room - frozenSize, DEFAULT_ROW_HEIGHT);
  let start = axis.edges.startOf(index) + (box?.pastStart ?? 0) - (box?.around ?? 0);
  let isLast = axis.edges.startOf(index + 1) === axis.edges.totalSize;
  let size = axis.edges.sizeOf(index);
  let length =
    box === undefined ? size + (isLast && size + extraAtEnd <= scrollingRoom ? extraAtEnd : 0) : Math.min(box.length + 2 * box.around, scrollingRoom);
  return scrollToShowSpan(scroll + frozenSize, start, length, scrollingRoom, isLast) - frozenSize;
}
export function withRoomBesideFootNotices<V extends Pick<PageState, 'noticesAtFoot' | 'heightUnderWhatFloats'>>(
  view: V,
  columnIndex: number,
  scrollLeft: number,
  layout: ColumnLines,
): V {
  let { noticesAtFoot } = view;
  return noticesAtFoot !== null && ROW_HEADER_WIDTH + lineEndOnScreen(columnIndex, scrollLeft, columnAxisOf(layout)) <= noticesAtFoot.left
    ? {
        ...view,
        heightUnderWhatFloats: noticesAtFoot.heightUnderTheRest,
      }
    : view;
}
export function scrollToShowCell(
  scroll: GridScroll,
  cell: CellToShow,
  layout: GridLayout,
  view: GridRoom & Pick<PageState, 'noticesAtFoot'>,
  foundBy: CellFoundBy | undefined,
  withRoomPastEnd: boolean = false,
  box?: BoxAlongLine,
): GridScroll {
  let scrollLeft = scrollToShowLine(
    scroll.scrollLeft,
    cell.columnIndex,
    cellsAreaWidth(view),
    columnAxisOf(layout),
    undefined,
    withRoomPastEnd ? ROOM_RIGHT_OF_LAST_COLUMN : 0,
  );
  return {
    scrollLeft,
    scrollTop: scrollToShowLine(
      scroll.scrollTop,
      cell.rowIndex,
      foundBy === 'key' ? cellsHeightAboveFloats(withRoomBesideFootNotices(view, cell.columnIndex, scrollLeft, layout)) : cellsAreaHeight(view),
      rowAxisOf(layout),
      box,
      withRoomPastEnd ? ROOM_BELOW_LAST_ROW : 0,
      cell.heightCovered,
    ),
  };
}
export function scrollToShowBoxInCell(
  { scrollLeft, scrollTop }: GridScroll,
  { rowIndex, columnIndex, heightCovered }: CellToShow,
  { left, top, width, height, around, heightShownUnder }: BoxInCell,
  layout: GridLayout,
  view: GridRoom,
): GridScroll {
  let [across, down] = [
    {
      pastStart: left,
      length: width,
      around,
    },
    {
      pastStart: top,
      length: height + heightShownUnder,
      around,
    },
  ];
  let scroll = {
    scrollLeft: scrollToShowLine(scrollLeft, columnIndex, cellsAreaWidth(view), columnAxisOf(layout), across),
    scrollTop: scrollToShowLine(scrollTop, rowIndex, cellsHeightAboveFloats(view), rowAxisOf(layout), down, 0, heightCovered),
  };
  let reach = {
    across: Math.max(layout.reachOfWhatFloats?.across ?? 0, layout.columnEdges.startOf(columnIndex) + left + width),
    down: Math.max(layout.reachOfWhatFloats?.down ?? 0, layout.rowEdges.startOf(rowIndex) + top + height),
  };
  return clampScrollWithFloats(
    scroll,
    {
      ...layout,
      reachOfWhatFloats: reach,
    },
    view,
  );
}
export function cellEndCornerOnScreen(cell: CellPosition, scroll: GridScroll, layout: GridLayout, view: Pick<PageState, 'gridWidth' | 'gridHeight'>): GridPoint {
  let x = lineStartOnScreen(cell.columnIndex, scroll.scrollLeft, columnAxisOf(layout));
  let y = lineEndOnScreen(cell.rowIndex, scroll.scrollTop, rowAxisOf(layout));
  return {
    x: ROW_HEADER_WIDTH + clampBetween(x, 0, cellsAreaWidth(view)),
    y: COLUMN_HEADER_HEIGHT + clampBetween(y, 0, cellsAreaHeight(view)),
  };
}
export function hitTestGrid(point: GridPoint, scroll: GridScroll, layout: GridLayout): GridHit | null {
  let inRowHeader = point.x < ROW_HEADER_WIDTH;
  let inColumnHeader = point.y < COLUMN_HEADER_HEIGHT;
  if (inRowHeader && inColumnHeader)
    return {
      kind: 'corner',
    };
  let contentPoint = contentPointAt(point, scroll, layout);
  let columnIndex = layout.columnEdges.indexAt(contentPoint.x);
  let rowIndex = layout.rowEdges.indexAt(contentPoint.y);
  if (!inColumnHeader && rowIndex >= layout.rowCount) return null;
  if (!inRowHeader && columnIndex >= layout.columnCount) return null;
  if (inRowHeader)
    return {
      kind: 'rowHeader',
      rowIndex,
    };
  return inColumnHeader
    ? {
        kind: 'columnHeader',
        columnIndex,
      }
    : {
        kind: 'cell',
        rowIndex,
        columnIndex,
      };
}
export function resizeGripOfLine(index: number, scroll: number, axis: GridAxis): ResizeGrip | null {
  if (!isLineShown(axis.edges, index)) return null;
  let edge = lineEndOnScreen(index, scroll, axis);
  let frozenSize = index < axis.frozenCount ? 0 : frozenSizeOf(axis);
  if (edge <= frozenSize) return null;
  let isLastFrozen = index === lastFrozenLineIndex(axis);
  return {
    edge,
    start: isLastFrozen ? edge : Math.max(frozenSize, edge - resizeGripReach(index, axis)),
    end: edge + resizeGripReach(shownLineAtOrAfter(axis.edges, index + 1), axis),
  };
}
export function resizeLineAt(offset: number, scroll: number, axis: GridAxis): number | null {
  let { edges, count } = axis;
  let index = edges.indexAt(contentOffsetAt(offset, scroll, axis));
  let hasGripHere = (lineIndex: number) => {
    let grip = isInSpan(lineIndex, 0, count) ? resizeGripOfLine(lineIndex, scroll, axis) : null;
    return grip !== null && isInStartEnd(offset, grip);
  };
  let previousIndex = shownLineAtOrBefore(edges, index - 1);
  return [lastFrozenLineIndex(axis), index, previousIndex].find(hasGripHere) ?? null;
}
export function columnResizeLineAt(point: GridPoint, { scrollLeft }: Pick<GridScroll, 'scrollLeft'>, layout: ColumnLines): number | null {
  if (point.y >= COLUMN_HEADER_HEIGHT || point.x < ROW_HEADER_WIDTH) return null;
  return resizeLineAt(point.x - ROW_HEADER_WIDTH, scrollLeft, columnAxisOf(layout));
}
export function rowResizeLineAt(point: GridPoint, { scrollTop }: Pick<GridScroll, 'scrollTop'>, layout: RowLines): number | null {
  if (point.x >= ROW_HEADER_WIDTH || point.y < COLUMN_HEADER_HEIGHT) return null;
  return resizeLineAt(point.y - COLUMN_HEADER_HEIGHT, scrollTop, rowAxisOf(layout));
}
export function freezeGripSpan(axis: GridAxis): StartAndEnd {
  let lastFrozen = lastFrozenLineIndex(axis);
  if (lastFrozen < 0)
    return {
      start: -FREEZE_GRIP_HALF_REACH,
      end: FREEZE_GRIP_HALF_REACH,
    };
  let frozenSize = frozenSizeOf(axis);
  return {
    start: frozenSize - resizeGripReach(lastFrozen, axis),
    end: frozenSize,
  };
}
export function freezeGripAt(point: GridPoint, layout: GridLayout): LinesAxisName | null {
  if (point.x < ROW_HEADER_WIDTH && isInStartEnd(point.y - COLUMN_HEADER_HEIGHT, rowFreezeGripSpan(layout))) return 'rows';
  return point.y < COLUMN_HEADER_HEIGHT && isInStartEnd(point.x - ROW_HEADER_WIDTH, columnFreezeGripSpan(layout)) ? 'columns' : null;
}
export function lineIndexUnderPointer(offset: number, scroll: number, room: number, axis: GridAxis, frozenPart: FrozenPart | null): number {
  let { edges } = axis;
  let index = edges.indexAt(contentOffsetAt(offset, scroll, axis, frozenPart));
  let frozenSize = frozenSizeOf(axis);
  let step = !(
    index >= axis.frozenCount &&
    edges.sizeOf(index) > room - frozenSize &&
    edges.startOf(index) < scroll + room &&
    edges.startOf(index + 1) > scroll + frozenSize
  )
    ? 0
    : offset < 0
      ? -1
      : offset >= room
        ? 1
        : 0;
  let clamped = clampBetween(index + step, 0, axis.count - 1);
  return nearestShownLine(edges, axis.count, clamped, step);
}
export function scrollingPaneOf(scroll: number, room: number, axis: GridAxis, reach: ExtraReach): GridPane {
  let { edges, count } = axis;
  let frozenSize = frozenSizeOf(axis);
  let first = Math.max(axis.frozenCount, edges.indexAt(Math.max(0, scroll + frozenSize - reach.before)));
  let end = scroll + room + reach.after;
  let endIndex = edges.indexAt(end);
  let last = endIndex < count && edges.startOf(endIndex) < end ? endIndex + 1 : endIndex;
  return {
    first,
    count: Math.max(0, last - first),
    areFrozen: false,
    scroll,
    showFrom: frozenSize,
    showTo: room,
  };
}
export function panesOfAxis(scroll: number, room: number, axis: GridAxis, reach: ExtraReach): GridPane[] {
  let paneAxis = unfreezeWhenUnscrolled(axis, scroll);
  let scrollingPane = scrollingPaneOf(scroll, room, paneAxis, reach);
  if (paneAxis.frozenCount === 0) return [scrollingPane];
  let { frozenCount } = paneAxis;
  return [
    {
      first: 0,
      count: frozenCount,
      areFrozen: true,
      scroll: 0,
      showFrom: 0,
      showTo: scrollingPane.showFrom,
    },
    scrollingPane,
  ];
}
export function shownIndicesInPane({ first, count }: Pick<GridPane, 'first' | 'count'>, edges: LineSizes): number[] {
  let indices: number[] = [];
  for (let index = shownLineAtOrAfter(edges, first); index < first + count; index = shownLineAtOrAfter(edges, index + 1))
    indices.push(index);
  return indices;
}
export function dropIndexAtPointer(point: GridPoint, scroll: GridScroll, layout: GridLayout, view: Pick<PageState, 'gridWidth' | 'gridHeight'>, axisName: LinesAxisName): number {
  let [offset, scrollPosition, room, axis]: [number, number, number, GridAxis] =
    axisName === 'rows'
      ? [point.y - COLUMN_HEADER_HEIGHT, scroll.scrollTop, cellsAreaHeight(view), rowAxisOf(layout)]
      : [point.x - ROW_HEADER_WIDTH, scroll.scrollLeft, cellsAreaWidth(view), columnAxisOf(layout)];
  let { edges, count, frozenCount } = axis;
  let contentOffset = contentOffsetAt(offset, scrollPosition, axis);
  let index = clampBetween(edges.indexAt(contentOffset), 0, count - 1);
  let dropIndex = contentOffset < edges.startOf(index) + edges.sizeOf(index) / 2 ? index : index + 1;
  if (index < frozenCount) return dropIndex;
  let pane = scrollingPaneOf(scrollPosition, room, axis, NO_EXTRA_REACH);
  let firstDrop = edges.startOf(pane.first) < scrollPosition + pane.showFrom ? pane.first + 1 : pane.first;
  let paneEnd = pane.first + pane.count;
  let lastDrop = edges.startOf(paneEnd) > scrollPosition + room ? paneEnd - 1 : paneEnd;
  return clampBetween(dropIndex, firstDrop, Math.max(firstDrop, lastDrop));
}
export function freezeCountAtPointer(
  point: GridPoint,
  scroll: GridScroll,
  layout: GridLayout,
  axisName: LinesAxisName,
  isCornerUnderFrozenLines: boolean,
): ScrollPosition {
  let [offset, scrollPosition, axis]: [number, number, GridAxis] =
    axisName === 'rows'
      ? [point.y - COLUMN_HEADER_HEIGHT, scroll.scrollTop, rowAxisOf(layout)]
      : [point.x - ROW_HEADER_WIDTH, scroll.scrollLeft, columnAxisOf(layout)];
  let frozenSize = frozenSizeOf(axis);
  let staysFrozen = frozenSize > 0 && offset < frozenSize - FREEZE_DRAG_SLACK && !isCornerUnderFrozenLines;
  return scrollPositionAtPixel(axis.edges, staysFrozen ? offset : Math.max(offset + scrollPosition, frozenSize));
}
export function edgeBeforeLineOnScreen(index: number, scroll: number, room: number, axis: GridAxis): number | null {
  let edge = index === 0 ? lineStartOnScreen(0, scroll, axis) : lineEndOnScreen(index - 1, scroll, axis);
  let frozenSize = index <= axis.frozenCount ? 0 : frozenSizeOf(axis);
  return edge >= frozenSize && edge <= room ? edge : null;
}
export function resizedLineEndOnScreen(
  { index, sizeInPixels }: Pick<LineResize, 'index' | 'sizeInPixels'>,
  scroll: number,
  room: number,
  axis: GridAxis,
): number | null {
  let start = lineStartOnScreen(index, scroll, axis);
  let frozenSize = index < axis.frozenCount ? 0 : frozenSizeOf(axis);
  if (lineEndOnScreen(index, scroll, axis) <= frozenSize || start >= room) return null;
  return clampBetween(start + sizeInPixels, frozenSize, room - 1);
}
export function autoscrollPointPastEdge<P extends GridPoint>(
  point: P,
  view: Pick<PageState, 'gridWidth' | 'gridHeight' | 'heightUnderCardAtFoot'>,
  direction: AutoscrollDirection,
  hasEdgeZones: boolean = false,
): P | null {
  if (direction === 'up' || direction === 'down') {
    if (point.y < COLUMN_HEADER_HEIGHT)
      return {
        ...point,
        y: point.y - DEFAULT_ROW_HEIGHT,
      };
    let footMargin = view.heightUnderCardAtFoot + AUTOSCROLL_FOOT_MARGIN;
    let edgeZoneBelow = direction === 'down' && hasEdgeZones ? Math.max(AUTOSCROLL_EDGE_ZONE, footMargin) : 0;
    return point.y >= view.gridHeight - edgeZoneBelow
      ? {
          ...point,
          y: Math.max(point.y, view.gridHeight) + DEFAULT_ROW_HEIGHT,
        }
      : null;
  }
  if (point.x < ROW_HEADER_WIDTH)
    return {
      ...point,
      x: point.x - AUTOSCROLL_HORIZONTAL_OVERSHOOT,
    };
  let edgeZone = direction === 'right' ? (hasEdgeZones ? AUTOSCROLL_EDGE_ZONE : RIGHT_EDGE_SLOP) : 0;
  return point.x >= view.gridWidth - edgeZone
    ? {
        ...point,
        x: Math.max(point.x, view.gridWidth) + AUTOSCROLL_HORIZONTAL_OVERSHOOT,
      }
    : null;
}
export function boxOfCellRange(range: CellArea, { rowEdges, columnEdges }: Pick<GridLayout, 'rowEdges' | 'columnEdges'>): EdgesOfCells {
  return {
    left: columnEdges.startOf(range.leftColumnIndex),
    top: rowEdges.startOf(range.topRowIndex),
    right: columnEdges.startOf(range.leftColumnIndex + range.columnCount),
    bottom: rowEdges.startOf(range.topRowIndex + range.rowCount),
  };
}
export function lineSpanOnScreen(first: number, count: number, scroll: number, room: number, axis: GridAxis): SpanOnScreen {
  let paneAxis = unfreezeWhenUnscrolled(axis, scroll);
  let frozenSize = frozenSizeOf(paneAxis);
  let start = lineStartOnScreen(first, scroll, paneAxis);
  let end = count === 0 ? start : lineEndOnScreen(first + count - 1, scroll, paneAxis);
  let span = {
    start,
    end,
    isEndUnderFrozenLines: false,
  };
  if (first >= paneAxis.frozenCount)
    return {
      ...span,
      showFrom: frozenSize,
      showTo: room,
    };
  if (first + count <= paneAxis.frozenCount)
    return {
      ...span,
      showFrom: 0,
      showTo: frozenSize,
    };
  return end > frozenSize
    ? {
        ...span,
        showFrom: 0,
        showTo: room,
      }
    : {
        start,
        end: frozenSize,
        isEndUnderFrozenLines: true,
        showFrom: 0,
        showTo: frozenSize,
      };
}
export function isRangeInSight(range: CellArea, scroll: GridScroll, layout: GridLayout, view: Pick<PageState, 'gridWidth' | 'gridHeight'>): boolean {
  let { across, down } = rangeSpansOnScreen(range, scroll, layout, view);
  return isSpanInSight(across) && isSpanInSight(down);
}
export const NO_BOXES_AT_FOOT: BoxAtFoot[] = [];
export const cellsAreaWidth = ({ gridWidth }: Pick<PageState, 'gridWidth'>): number => Math.max(0, gridWidth - ROW_HEADER_WIDTH);
export const cellsAreaHeight = ({ gridHeight }: Pick<PageState, 'gridHeight'>): number => Math.max(0, gridHeight - COLUMN_HEADER_HEIGHT);
export const cellsHeightAboveFloats = (view: Pick<PageState, 'gridHeight' | 'heightUnderWhatFloats'>): number =>
  Math.max(cellsAreaHeight(view) - view.heightUnderWhatFloats, Math.min(cellsAreaHeight(view), DEFAULT_ROW_HEIGHT));
export const layoutForNarrowTouch = <V extends Pick<PageState, 'isNarrowByTouch' | 'gridHeight' | 'heightUnderWhatFloats'>>(view: V): V =>
  view.isNarrowByTouch
    ? {
        ...view,
        gridHeight: COLUMN_HEADER_HEIGHT + cellsHeightAboveFloats(view),
        heightUnderWhatFloats: 0,
      }
    : view;
export const clampBetween = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));
export const rowAxisOf = ({ rowEdges, rowCount, frozenRowCount }: RowLines): GridAxis => ({
  edges: rowEdges,
  count: rowCount,
  frozenCount: frozenRowCount,
});
export const columnAxisOf = ({
  columnEdges,
  columnCount,
  frozenColumnCount,
}: ColumnLines): GridAxis => ({
  edges: columnEdges,
  count: columnCount,
  frozenCount: frozenColumnCount,
});
export const frozenSizeOf = ({ edges, frozenCount }: Pick<GridAxis, 'edges' | 'frozenCount'>): number => edges.startOf(frozenCount);
export const frozenRowsHeight = (layout: RowLines): number => frozenSizeOf(rowAxisOf(layout));
export const frozenColumnsWidth = (layout: ColumnLines): number => frozenSizeOf(columnAxisOf(layout));
export const MIN_SCROLLING_ROWS_HEIGHT = 3 * DEFAULT_ROW_HEIGHT;
export const MIN_SCROLLING_COLUMNS_WIDTH = 104;
export const frozenCountThatFits = (edges: LineSizes, frozenCount: number, room: number): number =>
  clampBetween(edges.indexAt(room), 0, frozenCount);
export const frozenCountsThatFit = (
  frozen: Pick<GridLayout, 'frozenRowCount' | 'frozenColumnCount'>,
  { rowEdges, columnEdges }: Pick<GridLayout, 'rowEdges' | 'columnEdges'>,
  view: Pick<PageState, 'gridWidth' | 'gridHeight' | 'find' | 'heightUnderCardAtFoot'>,
): Pick<GridLayout, 'frozenRowCount' | 'frozenColumnCount'> => ({
  frozenRowCount: frozenCountThatFits(
    rowEdges,
    frozen.frozenRowCount,
    cellsAreaHeight(view) + (view.find?.roomAboveGrid ?? 0) - view.heightUnderCardAtFoot - MIN_SCROLLING_ROWS_HEIGHT,
  ),
  frozenColumnCount: frozenCountThatFits(columnEdges, frozen.frozenColumnCount, cellsAreaWidth(view) - MIN_SCROLLING_COLUMNS_WIDTH),
});
export const lineStartOnScreen = (index: number, scroll: number, { edges, frozenCount }: Pick<GridAxis, 'edges' | 'frozenCount'>): number =>
  edges.startOf(index) - (index < frozenCount ? 0 : scroll);
export const lineEndOnScreen = (index: number, scroll: number, axis: Pick<GridAxis, 'edges' | 'frozenCount'>): number =>
  lineStartOnScreen(index, scroll, axis) + axis.edges.sizeOf(index);
export const scrollPositionInLines = (scroll: GridScroll, layout: GridLayout): { rows: LinesUnderFrozen; columns: LinesUnderFrozen } => ({
  rows: scrolledLinesUnderFrozen(scroll.scrollTop, rowAxisOf(layout)),
  columns: scrolledLinesUnderFrozen(scroll.scrollLeft, columnAxisOf(layout)),
});
export const ROOM_BELOW_LAST_ROW = 44;
export const maxScrollTop = (layout: RowLines, view: Pick<PageState, 'gridHeight' | 'heightUnderWhatFloats'>): number => {
  let cellsHeight = cellsHeightAboveFloats(view);
  let scrollingHeight = cellsHeight - frozenRowsHeight(layout);
  let roomBelow = clampBetween(scrollingHeight - DEFAULT_ROW_HEIGHT, 0, ROOM_BELOW_LAST_ROW);
  return layout.rowEdges.totalSize + roomBelow - cellsHeight;
};
export const ROOM_RIGHT_OF_LAST_COLUMN_BASE = ROW_HEADER_WIDTH;
export const ROOM_RIGHT_OF_LAST_COLUMN = ROOM_RIGHT_OF_LAST_COLUMN_BASE + 10;
export const maxScrollLeft = (layout: ColumnLines, view: Pick<PageState, 'gridWidth'>): number => {
  let scrollingWidth = cellsAreaWidth(view) - frozenColumnsWidth(layout);
  let roomRight = clampBetween(scrollingWidth - ROOM_RIGHT_OF_LAST_COLUMN, 0, ROOM_RIGHT_OF_LAST_COLUMN);
  return layout.columnEdges.totalSize + roomRight - cellsAreaWidth(view);
};
export const rowsEndOnScreen = ({ scrollTop }: Pick<GridScroll, 'scrollTop'>, layout: RowLines): number =>
  lineStartOnScreen(layout.rowCount, scrollTop, rowAxisOf(layout));
export const columnsEndOnScreen = ({ scrollLeft }: Pick<GridScroll, 'scrollLeft'>, layout: ColumnLines): number =>
  lineStartOnScreen(layout.columnCount, scrollLeft, columnAxisOf(layout));
export const columnEndOnScreen = (index: number, { scrollLeft }: Pick<GridScroll, 'scrollLeft'>, layout: ColumnLines): number =>
  lineEndOnScreen(index, scrollLeft, columnAxisOf(layout));
export const maxScrollWithFloats = (layout: GridLayout, view: GridRoom): GridScroll => {
  let { across = 0, down = 0 }: Partial<ReachOfWhatFloats> = layout.reachOfWhatFloats ?? {};
  return {
    scrollLeft: maxScrollLeft(layout, view) + Math.max(0, across - layout.columnEdges.totalSize),
    scrollTop: maxScrollTop(layout, view) + Math.max(0, down - layout.rowEdges.totalSize),
  };
};
export const contentPointAt = (point: GridPoint, scroll: GridScroll, layout: GridLayout): GridPoint => ({
  x: contentOffsetAt(point.x - ROW_HEADER_WIDTH, scroll.scrollLeft, columnAxisOf(layout)),
  y: contentOffsetAt(point.y - COLUMN_HEADER_HEIGHT, scroll.scrollTop, rowAxisOf(layout)),
});
export const isInSpan = (value: number, start: number, length: number): boolean => value >= start && value < start + length;
export const RESIZE_GRIP_REACH = 4;
export const resizeGripReach = (index: number, { edges, count }: Pick<GridAxis, 'edges' | 'count'>): number =>
  index < count ? Math.min(RESIZE_GRIP_REACH, edges.sizeOf(index) / 4) : RESIZE_GRIP_REACH;
export const isInStartEnd = (value: number, { start, end }: StartAndEnd): boolean => value >= start && value < end;
export const lastFrozenLineIndex = ({ edges, frozenCount }: Pick<GridAxis, 'edges' | 'frozenCount'>): number =>
  shownLineAtOrBefore(edges, frozenCount - 1);
export const columnResizeGrip = (index: number, { scrollLeft }: Pick<GridScroll, 'scrollLeft'>, layout: ColumnLines): ResizeGrip | null =>
  resizeGripOfLine(index, scrollLeft, columnAxisOf(layout));
export const rowResizeGrip = (index: number, { scrollTop }: Pick<GridScroll, 'scrollTop'>, layout: RowLines): ResizeGrip | null =>
  resizeGripOfLine(index, scrollTop, rowAxisOf(layout));
export const FREEZE_GRIP_HALF_REACH = 4;
export const rowFreezeGripSpan = (layout: RowLines): StartAndEnd => freezeGripSpan(rowAxisOf(layout));
export const columnFreezeGripSpan = (layout: ColumnLines): StartAndEnd => freezeGripSpan(columnAxisOf(layout));
export const clampColumnWidth = (width: number): number => clampBetween(Math.round(width), MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
export const clampRowHeight = (height: number): number => clampBetween(Math.round(height), MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
export const clampPointToCells = ({ x, y }: GridPoint, view: Pick<PageState, 'gridWidth' | 'gridHeight'>): GridPoint => ({
  x: clampBetween(x, ROW_HEADER_WIDTH, ROW_HEADER_WIDTH + cellsAreaWidth(view) - 1),
  y: clampBetween(y, COLUMN_HEADER_HEIGHT, COLUMN_HEADER_HEIGHT + cellsAreaHeight(view) - 1),
});
export const lineIndexInSight = (index: number, scroll: number, axis: GridAxis): number =>
  index < axis.frozenCount
    ? index
    : Math.max(index, Math.min(axis.edges.indexAt(frozenSizeOf(axis) + scroll), shownLineAtOrBefore(axis.edges, axis.count - 1)));
export const cellInSight = (
  { rowIndex, columnIndex }: CellPosition,
  { scrollLeft, scrollTop }: GridScroll,
  layout: GridLayout,
): CellPosition => ({
  rowIndex: lineIndexInSight(rowIndex, scrollTop, rowAxisOf(layout)),
  columnIndex: lineIndexInSight(columnIndex, scrollLeft, columnAxisOf(layout)),
});
export const cellUnderPointer = (
  point: GridPoint,
  scroll: GridScroll,
  layout: GridLayout,
  view: Pick<PageState, 'gridWidth' | 'gridHeight'>,
  anchor: Pick<CellArea, 'topRowIndex' | 'leftColumnIndex'> | null = null,
): CellPosition => ({
  rowIndex: lineIndexUnderPointer(
    point.y - COLUMN_HEADER_HEIGHT,
    scroll.scrollTop,
    cellsAreaHeight(view),
    rowAxisOf(layout),
    anchor === null ? null : frozenPartOf(anchor.topRowIndex, rowAxisOf(layout)),
  ),
  columnIndex: lineIndexUnderPointer(
    point.x - ROW_HEADER_WIDTH,
    scroll.scrollLeft,
    cellsAreaWidth(view),
    columnAxisOf(layout),
    anchor === null ? null : frozenPartOf(anchor.leftColumnIndex, columnAxisOf(layout)),
  ),
});
export const unfreezeWhenUnscrolled = (axis: GridAxis, scroll: number): GridAxis =>
  scroll === 0
    ? {
        ...axis,
        frozenCount: 0,
      }
    : axis;
export const NO_EXTRA_REACH: ExtraReach = {
  before: 0,
  after: 0,
};
export const extraReachOfShift = (shift: number): ExtraReach => ({
  before: Math.max(0, -shift),
  after: Math.max(0, shift),
});
export const shownRowIndicesInPane = (pane: Pick<GridPane, 'first' | 'count'>, { rowEdges }: Pick<GridLayout, 'rowEdges'>): number[] => shownIndicesInPane(pane, rowEdges);
export const shownColumnIndicesInPane = (pane: Pick<GridPane, 'first' | 'count'>, { columnEdges }: Pick<GridLayout, 'columnEdges'>): number[] =>
  shownIndicesInPane(pane, columnEdges);
export const rowPanes = (
  { scrollTop }: Pick<GridScroll, 'scrollTop'>,
  layout: RowLines,
  view: Pick<PageState, 'gridHeight'>,
  reach: ExtraReach = NO_EXTRA_REACH,
): GridPane[] =>
  panesOfAxis(scrollTop, cellsAreaHeight(view), rowAxisOf(layout), reach);
export const columnPanes = (
  { scrollLeft }: Pick<GridScroll, 'scrollLeft'>,
  layout: ColumnLines,
  view: Pick<PageState, 'gridWidth'>,
  reach: ExtraReach = NO_EXTRA_REACH,
): GridPane[] => panesOfAxis(scrollLeft, cellsAreaWidth(view), columnAxisOf(layout), reach);
export const FREEZE_DRAG_SLACK = 8;
export const rowEdgeOnScreen = (index: number, { scrollTop }: Pick<GridScroll, 'scrollTop'>, layout: RowLines, view: Pick<PageState, 'gridHeight'>): number | null =>
  edgeBeforeLineOnScreen(index, scrollTop, cellsAreaHeight(view), rowAxisOf(layout));
export const columnEdgeOnScreen = (
  index: number,
  { scrollLeft }: Pick<GridScroll, 'scrollLeft'>,
  layout: ColumnLines,
  view: Pick<PageState, 'gridWidth'>,
): number | null =>
  edgeBeforeLineOnScreen(index, scrollLeft, cellsAreaWidth(view), columnAxisOf(layout));
export const resizedRowEndOnScreen = (
  resize: Pick<LineResize, 'index' | 'sizeInPixels'>,
  { scrollTop }: Pick<GridScroll, 'scrollTop'>,
  layout: RowLines,
  view: Pick<PageState, 'gridHeight'>,
): number | null =>
  resizedLineEndOnScreen(resize, scrollTop, cellsAreaHeight(view), rowAxisOf(layout));
export const resizedColumnEndOnScreen = (
  resize: Pick<LineResize, 'index' | 'sizeInPixels'>,
  { scrollLeft }: Pick<GridScroll, 'scrollLeft'>,
  layout: ColumnLines,
  view: Pick<PageState, 'gridWidth'>,
): number | null =>
  resizedLineEndOnScreen(resize, scrollLeft, cellsAreaWidth(view), columnAxisOf(layout));
export const DRAG_START_DISTANCE = 8;
export const RIGHT_EDGE_SLOP = 4;
export const AUTOSCROLL_EDGE_ZONE = 24;
export const AUTOSCROLL_FOOT_MARGIN = 8;
export const AUTOSCROLL_HORIZONTAL_OVERSHOOT = 104;
export const paneRect = (across: ShownStretch, down: ShownStretch): PaneRect => ({
  left: across.showFrom,
  top: down.showFrom,
  width: across.showTo - across.showFrom,
  height: down.showTo - down.showFrom,
});
export const rowRunSpanOnScreen = (
  { firstIndex, count }: LineSpan,
  { scrollTop }: Pick<GridScroll, 'scrollTop'>,
  layout: RowLines,
  view: Pick<PageState, 'gridHeight'>,
): SpanOnScreen => lineSpanOnScreen(firstIndex, count, scrollTop, cellsAreaHeight(view), rowAxisOf(layout));
export const columnRunSpanOnScreen = (
  { firstIndex, count }: LineSpan,
  { scrollLeft }: Pick<GridScroll, 'scrollLeft'>,
  layout: ColumnLines,
  view: Pick<PageState, 'gridWidth'>,
): SpanOnScreen => lineSpanOnScreen(firstIndex, count, scrollLeft, cellsAreaWidth(view), columnAxisOf(layout));
export const rangeSpansOnScreen = (
  range: CellArea,
  scroll: GridScroll,
  layout: GridLayout,
  view: Pick<PageState, 'gridWidth' | 'gridHeight'>,
): AreaSpansOnScreen => ({
  across: lineSpanOnScreen(range.leftColumnIndex, range.columnCount, scroll.scrollLeft, cellsAreaWidth(view), columnAxisOf(layout)),
  down: lineSpanOnScreen(range.topRowIndex, range.rowCount, scroll.scrollTop, cellsAreaHeight(view), rowAxisOf(layout)),
});
export const isSpanInSight = ({ start, end, showFrom, showTo }: StartAndEnd & ShownStretch): boolean =>
  end > start && end > showFrom && start < showTo;
export const isSpanFullyInSight = ({
  start,
  end,
  showFrom,
  showTo,
  isEndUnderFrozenLines,
}: SpanOnScreen): boolean => !isEndUnderFrozenLines && start >= showFrom && end <= showTo;
export const isSpanEndInSight = ({
  end,
  showFrom,
  showTo,
  isEndUnderFrozenLines,
}: Omit<SpanOnScreen, 'start'>): boolean => !isEndUnderFrozenLines && end > showFrom && end <= showTo;
