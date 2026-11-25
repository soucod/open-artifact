import type { GridScroll, ShownStretch, StartAndEnd } from '../grid/geometry.ts';
import type { GridLayout } from '../grid/layout.ts';
import type { Dragging, PageState, ScrollForLessRoom, ScrollsForLessRoom } from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CellArea } from './model.ts';
import {
  withRoomBesideFootNotices,
  cellsHeightAboveFloats,
  rangeSpansOnScreen,
  frozenRowsHeight,
  boxOfCellRange,
  isRangeInSight,
  frozenColumnsWidth,
  cellsAreaWidth,
  cellsAreaHeight,
  clampBetween,
  isSpanInSight,
} from '../grid/geometry.ts';
import { COLUMN_HEADER_HEIGHT } from '../grid/cell-metrics.ts';
import {
  mergedAreaOrCellOf,
  scrollToShowPosition,
  scrollToShowEnlargedEditor,
  scrollToShowSelection,
  areaOfPosition,
  scrollToShowActiveCell,
  withRoomUnderNoticesAtFoot,
} from './model.ts';
import { layoutOfView, clampScrollOfView } from '../grid/layout.ts';
import { stuckHeadersBottom, stuckHeadersOfView, heightCoveredByStickyHeaders } from '../grid/sticky-headers.ts';
import { holdUntilAnswered } from '../model/edit-effects.ts';
import { DEFAULT_ROW_HEIGHT } from '../grid/cell-metrics-values.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** How much of an area shows on screen, across and down, and down clear of what floats at the foot. */
export interface ShownExtent {
  across: number;
  down: number;
  downClear: number;
}
/** The scrolls made for less room that still hold, across and down. */
export type ScrollsForLessRoomStill = Pick<ScrollsForLessRoom, 'across' | 'down'>;
export function shownExtentOfArea(area: CellArea, view: PageState, layout: GridLayout): ShownExtent {
  let withRoom = withRoomBesideFootNotices(view, area.leftColumnIndex, view.scrollLeft, layout);
  let clearView = {
    ...view,
    gridHeight: COLUMN_HEADER_HEIGHT + cellsHeightAboveFloats(withRoom),
  };
  let { across, down } = rangeSpansOnScreen(area, view, layout, view);
  return {
    across: shownLengthOf(across),
    down: shownLengthOf(down),
    downClear: shownLengthOf(rangeSpansOnScreen(area, view, layout, clearView).down),
  };
}
export function keepKeyedCellClearOfStuckHeaders(tablesBefore: PageState['tablesRead'], after: PageState, book: ReadsWithTextMeasurer): PageState {
  if (tablesBefore === after.tablesRead) return after;
  let before = {
    ...after,
    tablesRead: tablesBefore,
  };
  let active = book.positionOfCell(after.activeCell);
  let merged = mergedAreaOrCellOf(book, after.activeCell);
  let { leftByKeyAt } = after;
  let isUnscrolledSinceKey = leftByKeyAt?.scrollTop === after.scrollTop && leftByKeyAt.scrollLeft === after.scrollLeft;
  if (active === null || merged === null || !isUnscrolledSinceKey || isAutoScrollHeld(after)) return after;
  let layout = layoutOfView(after, book);
  if (merged.topRowIndex < layout.frozenRowCount) return after;
  let cellTop = layout.rowEdges.startOf(merged.topRowIndex) - after.scrollTop;
  let isCovered = (view: PageState) =>
    cellTop < frozenRowsHeight(layout) + stuckHeadersBottom(merged, stuckHeadersOfView(view, book, layout));
  return !isCovered(before) && isCovered(after)
    ? scrollToShowPosition(
        after,
        book,
        active,
        {
          rows: true,
          columns: false,
        },
        'key',
      )
    : after;
}
export function keepKeyedSelectionShown(view: PageState, book: ReadsWithTextMeasurer): PageState {
  let { leftByKeyAt, dragging } = view;
  if (!(leftByKeyAt?.scrollTop === view.scrollTop && leftByKeyAt.scrollLeft === view.scrollLeft) || dragging !== null) return view;
  let shown = scrollToShowEnlargedEditor(scrollToShowSelection(view, book), book, 'key');
  let { scrollLeft, scrollTop } = shown;
  return {
    ...view,
    scrollLeft,
    scrollTop,
    leftByKeyAt: {
      scrollLeft,
      scrollTop,
    },
  };
}
export function keepActiveCellClearOfStuckHeaders(before: PageState, after: PageState, book: ReadsWithTextMeasurer): PageState {
  let active = book.positionOfCell(after.activeCell);
  let merged = mergedAreaOrCellOf(book, after.activeCell);
  if (active === null || merged === null || isAutoScrollHeld(after)) return after;
  let spanBelowHeaders = (view: PageState, layout: GridLayout) => {
    let headersBottom = stuckHeadersBottom(merged, stuckHeadersOfView(view, book, layout));
    let { top: cellTop, bottom: cellBottom } = boxOfCellRange(merged, layout);
    let clearTop = view.scrollTop + frozenRowsHeight(layout) + headersBottom;
    return {
      from: cellTop - clearTop,
      to: cellBottom - clearTop,
    };
  };
  let [layoutBefore, layoutAfter] = [layoutOfView(before, book), layoutOfView(after, book)];
  if (merged.topRowIndex < layoutAfter.frozenRowCount || !isRangeInSight(merged, before, layoutBefore, before)) return after;
  let [spanBefore, spanAfter] = [spanBelowHeaders(before, layoutBefore), spanBelowHeaders(after, layoutAfter)];
  if (spanAfter.from >= 0) return after;
  if (spanBefore.from > -1)
    return scrollToShowPosition(
      after,
      book,
      active,
      {
        rows: true,
        columns: false,
      },
      'key',
    );
  if (spanBefore.to <= 0 || spanAfter.to > 0) return after;
  let heightCovered = heightCoveredByStickyHeaders(after, book, active, layoutAfter);
  let scrollTop = boxOfCellRange(merged, layoutAfter).bottom - frozenRowsHeight(layoutAfter) - heightCovered - spanBefore.to;
  return {
    ...after,
    scrollTop: Math.max(0, Math.min(after.scrollTop, scrollTop)),
  };
}
export function keepActiveCellInViewOnResize(before: PageState, after: PageState, book: ReadsWithTextMeasurer, bookBefore: ReadsWithTextMeasurer = book): PageState {
  let [layoutBefore, layoutAfter] = [layoutOfView(before, bookBefore), layoutOfView(after, book)];
  let isSameBook = bookBefore === book;
  let isNarrower =
    after.gridWidth < before.gridWidth ||
    frozenColumnsWidth(layoutAfter) > frozenColumnsWidth(layoutBefore) ||
    (isSameBook && layoutAfter.frozenColumnCount < layoutBefore.frozenColumnCount);
  let isShorter =
    after.gridHeight < before.gridHeight ||
    after.density !== before.density ||
    frozenRowsHeight(layoutAfter) > frozenRowsHeight(layoutBefore) ||
    (isSameBook && layoutAfter.frozenRowCount < layoutBefore.frozenRowCount);
  let isSameSheet = after.sheetId === before.sheetId;
  if ((!isNarrower && !isShorter) || !isSameSheet || isAutoScrollHeld(after)) return after;
  let active = book.positionOfCell(after.activeCell);
  let mergedAfter = mergedAreaOrCellOf(book, after.activeCell);
  let mergedBefore = mergedAreaOrCellOf(bookBefore, before.activeCell);
  if (active === null || mergedAfter === null || mergedBefore === null) return after;
  let shrunkLayout: GridLayout = {
    ...layoutBefore,
    frozenRowCount: Math.min(layoutBefore.frozenRowCount, layoutAfter.frozenRowCount),
    frozenColumnCount: Math.min(layoutBefore.frozenColumnCount, layoutAfter.frozenColumnCount),
  };
  if (![layoutBefore, shrunkLayout].every((layout: GridLayout) => isRangeInSight(mergedBefore, before, layout, before))) return after;
  let [shownBefore, shownAfter] = [
    shownExtentOfArea(mergedBefore, before, shrunkLayout),
    shownExtentOfArea(mergedAfter, after, layoutAfter),
  ];
  let { left: leftEdge, top: topEdge, right: rightEdge, bottom: bottomEdge } = boxOfCellRange(mergedAfter, layoutAfter);
  let { across, down } = rangeSpansOnScreen(mergedAfter, after, layoutAfter, after);
  let axes = {
    columns:
      isNarrower &&
      shownAfter.across < shownBefore.across &&
      canBeBroughtIntoView(rightEdge - leftEdge, cellsAreaWidth(after) - frozenColumnsWidth(layoutAfter), across),
    rows:
      isShorter &&
      (shownAfter.down < shownBefore.down || shownAfter.downClear < shownBefore.downClear) &&
      canBeBroughtIntoView(bottomEdge - topEdge, cellsAreaHeight(after) - frozenRowsHeight(layoutAfter), down),
  };
  return scrollToShowPosition(after, book, active, axes, 'key');
}
export function scrollsForLessRoomStill(view: Pick<PageState, 'scrolledForLessRoom' | 'sheetId' | 'scrollLeft' | 'scrollTop' | 'gridWidth' | 'gridHeight'>): ScrollsForLessRoomStill {
  let { across = null, down = null, sheetId }: Partial<ScrollsForLessRoom> = view.scrolledForLessRoom ?? {};
  let stillHolds = (scrolled: ScrollForLessRoom | null, scroll: number, room: number): ScrollForLessRoom | null =>
    scrolled !== null && sheetId === view.sheetId && scrolled.at === scroll && scroll <= scrollKeepingEndShown(scrolled, room) ? scrolled : null;
  return {
    across: stillHolds(across, view.scrollLeft, view.gridWidth),
    down: stillHolds(down, view.scrollTop, view.gridHeight),
  };
}
export function scrolledForLessRoomToKeep(
  view: Pick<PageState, 'scrolledForLessRoom' | 'sheetId' | 'scrollLeft' | 'scrollTop' | 'gridWidth' | 'gridHeight'>,
): ScrollsForLessRoom | null {
  let { across, down } = scrollsForLessRoomStill(view);
  return across === null && down === null
    ? null
    : {
        sheetId: view.sheetId,
        across,
        down,
      };
}
export function giveBackScrollForMoreRoom(before: PageState, after: PageState, book: ReadsWithTextMeasurer): PageState {
  let { across, down } = scrollsForLessRoomStill(before);
  if (isAutoScrollHeld(after) || (across === null && down === null)) return after;
  let givenBack = {
    ...after,
    scrollLeft: across === null ? after.scrollLeft : Math.min(across.at, scrollKeepingEndShown(across, after.gridWidth)),
    scrollTop: down === null ? after.scrollTop : Math.min(down.at, scrollKeepingEndShown(down, after.gridHeight)),
  };
  let active = book.positionOfCell(after.activeCell);
  if (active === null) return givenBack;
  let extentIn = (view: PageState) => shownExtentOfArea(areaOfPosition(active), view, layoutOfView(view, book));
  let extentAfter = extentIn(after);
  let showsLess = (view: PageState) => {
    let extent = extentIn(view);
    return extent.across < extentAfter.across || extent.down < extentAfter.down || extent.downClear < extentAfter.downClear;
  };
  if (!showsLess(givenBack)) return givenBack;
  let showingCell = scrollToShowActiveCell(givenBack, book, 'cellAlone');
  let partlyGivenBack = {
    ...after,
    scrollLeft: clampBetween(showingCell.scrollLeft, givenBack.scrollLeft, after.scrollLeft),
    scrollTop: clampBetween(showingCell.scrollTop, givenBack.scrollTop, after.scrollTop),
  };
  return showsLess(partlyGivenBack) ? after : partlyGivenBack;
}
export function scrollForLessRoomOnAxis(scrolled: ScrollForLessRoom | null, scrollBefore: number, scrollAfter: number, room: number): ScrollForLessRoom | null {
  let from = scrolled?.from ?? scrollBefore;
  if (scrollAfter <= from) return null;
  return {
    from,
    end: Math.max(scrolled?.end ?? 0, scrollAfter + room),
    at: scrollAfter,
  };
}
export function noteScrollForLessRoom(before: PageState, unscrolled: GridScroll, after: PageState): PageState {
  let still = scrollsForLessRoomStill(before);
  let across = scrollForLessRoomOnAxis(still.across, unscrolled.scrollLeft, after.scrollLeft, after.gridWidth);
  let down = scrollForLessRoomOnAxis(still.down, unscrolled.scrollTop, after.scrollTop, after.gridHeight);
  if (across !== null || down !== null)
    return {
      ...after,
      scrolledForLessRoom: {
        sheetId: after.sheetId,
        across,
        down,
      },
    };
  return before.scrolledForLessRoom?.sheetId === after.sheetId
    ? {
        ...after,
        scrolledForLessRoom: null,
      }
    : after;
}
export function holdFreezingAndKeepActiveCellInView(before: PageState, transition: PageTransition, held: Dragging, book: ReadsWithTextMeasurer): PageTransition {
  let withHeld = holdUntilAnswered(transition, held);
  let view = keepActiveCellInViewOnResize(before, clampScrollOfView(withHeld.state, book), book);
  return {
    ...withHeld,
    state: view,
  };
}
export function revealActiveCellBelow(view: PageState, book: ReadsWithTextMeasurer): PageState {
  let merged = mergedAreaOrCellOf(book, view.activeCell);
  if (!(merged !== null && isRangeInSight(merged, view, layoutOfView(view, book), view)) || isAutoScrollHeld(view)) return view;
  return {
    ...view,
    scrollTop: Math.max(view.scrollTop, scrollToShowActiveCell(view, book).scrollTop),
  };
}
export function keepActiveCellAboveCardAtFoot(before: PageState, after: PageState, book: ReadsWithTextMeasurer): PageState {
  let withRoom =
    before.gridHeight === 0
      ? {
          ...after,
          heightUnderWhatFloats: after.heightUnderCardAtFoot,
        }
      : withRoomUnderNoticesAtFoot(before, book);
  let merged = mergedAreaOrCellOf(book, after.activeCell);
  let clearView = {
    ...withRoom,
    gridHeight: COLUMN_HEADER_HEIGHT + cellsHeightAboveFloats(withRoom),
  };
  if (
    merged === null ||
    after.dragging !== null ||
    cellsHeightAboveFloats(after) >= cellsHeightAboveFloats(withRoom) ||
    !isRangeInSight(merged, withRoom, layoutOfView(withRoom, book), clearView)
  )
    return after;
  let revealed = {
    ...after,
    scrollTop: Math.max(after.scrollTop, scrollToShowActiveCell(after, book).scrollTop),
  };
  let roomAbove = {
    ...after,
    gridHeight: after.gridHeight - withRoomUnderNoticesAtFoot(after, book).heightUnderWhatFloats,
  };
  let { down } = rangeSpansOnScreen(merged, revealed, layoutOfView(after, book), roomAbove);
  return Math.min(down.end, down.showTo) - Math.max(down.start, down.showFrom) >= Math.min(DEFAULT_ROW_HEIGHT, down.end - down.start) / 2
    ? revealed
    : after;
}
export const canBeBroughtIntoView = (size: number, room: number, run: StartAndEnd & ShownStretch): boolean =>
  size <= room || (room > 0 && !isSpanInSight(run));
export const shownLengthOf = ({ start, end, showFrom, showTo }: StartAndEnd & ShownStretch): number =>
  Math.max(0, Math.min(end, showTo) - Math.max(start, showFrom));
export const isAutoScrollHeld = (view: PageState): boolean =>
  view.mode.kind === 'editing' ||
  view.dragging !== null ||
  view.followed !== null ||
  (view.isFollowingAgent && view.followsOnOneSheet !== 'yetToMove') ||
  (view.shownByAgent?.place ?? null) !== null ||
  view.placementSelected !== null ||
  view.caretAtEnd !== null;
export const scrollKeepingEndShown = ({ from, end }: Pick<ScrollForLessRoom, 'from' | 'end'>, room: number): number => Math.max(from, end - room);
