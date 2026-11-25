import type { SheetId } from '@open-artifact/sheets-core';
import { selectedAreaAsSeen, selectionInRowOrder } from '../presence/selections.ts';
import { rangeSpansOnScreen, isSpanEndInSight, hitTestGrid } from '../grid/geometry.ts';
import { isPointOnFillHandle } from '../selection/fill-handle.ts';
import { selectedArea, mergedAreaOrCellOf, moveActiveCellTo, isSameCell } from '../selection/model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { withoutOtherRanges } from '../selection/several-ranges.ts';
import { commentAnchorOfCells, cellsOfCommentAnchor } from './anchors.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet, wholeRowSpanIn } from '../model/line-ids.ts';
import { withNoEffects, type PageEffect, type PageTransition } from '../state/transitions.ts';
import { isModalOpen } from '../ui/find.ts';
import { showSheet } from '../state/sheet-tabs.ts';
import { isNothingOpenButPane } from '../state/edit-refusals.ts';
import { hasFilteredRowsIn } from '../tables/filtered-rows.ts';
import type { CellsOfComment, CommentOnPage, PageState } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import type { GridPoint } from '../grid/geometry.ts';
import type { GridLayout } from '../grid/layout.ts';
import type { FillContext } from '../selection/fill-handle.ts';
import type { PageContext, CommentsTold } from '../state/event-reducer.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';

/** Where a new comment goes: its anchor, its cells as an address, and the number of its sheet. */
export interface NewCommentPlace {
  anchor: string;
  cells: string;
  sheetNumber: number;
}

export function isActiveCellInComment(
  { cells }: Pick<CommentOnPage, 'cells'>,
  { activeCell }: Pick<PageState, 'activeCell'>,
  reads: WorkbookReads,
): boolean {
  let activeCellPosition = reads.positionOfCell(activeCell);
  let commentArea = cells.activeCell.sheetId === activeCell.sheetId ? selectedAreaAsSeen(cells, reads) : null;
  return (
    activeCellPosition !== null &&
    commentArea !== null &&
    activeCellPosition.rowIndex >= commentArea.topRowIndex &&
    activeCellPosition.rowIndex < commentArea.topRowIndex + commentArea.rowCount &&
    activeCellPosition.columnIndex >= commentArea.leftColumnIndex &&
    activeCellPosition.columnIndex < commentArea.leftColumnIndex + commentArea.columnCount
  );
}
export function openCommentCountBySheet({ comments }: Pick<PageState, 'comments'>, reads: WorkbookReads): Map<SheetId, number> {
  let countBySheet = new Map<SheetId, number>();
  for (let { cells, isResolved } of comments ?? []) {
    let { sheetId } = cells.activeCell;
    if (!isResolved && selectedAreaAsSeen(cells, reads) !== null) countBySheet.set(sheetId, (countBySheet.get(sheetId) ?? 0) + 1);
  }
  return countBySheet;
}
/** Whether the comment's cells end on screen where the area ends, at its bottom-right corner. */
export function doesCommentEndAtSelectionCorner(
  cells: CellsOfComment,
  area: CellArea | null,
  state: PageState,
  reads: WorkbookReads,
  layout: GridLayout,
): boolean {
  let commentArea = cells.activeCell.sheetId === state.sheetId ? selectedAreaAsSeen(cells, reads) : null;
  if (commentArea === null || area === null) return false;
  let [commentSpans, areaSpans] = [rangeSpansOnScreen(commentArea, state, layout, state), rangeSpansOnScreen(area, state, layout, state)];
  return (
    [commentSpans.across, commentSpans.down, areaSpans.across, areaSpans.down].every(isSpanEndInSight) &&
    [commentSpans.across, commentSpans.down].every(({ start, end }) => start < end) &&
    commentSpans.across.end === areaSpans.across.end &&
    commentSpans.down.end === areaSpans.down.end
  );
}
/** The comment marked at the corner of the selection when the finger is on the fill handle there. */
export function commentAtSelectionCorner(state: PageState, point: GridPoint, context: FillContext): CommentOnPage | null {
  if (!isPointOnFillHandle(state, point, context, true)) return null;
  let { reads } = context;
  let [selection, layout] = [selectedArea(state, reads), layoutOfView(state, reads)];
  return (
    state.comments?.findLast(
      ({ cells, isResolved, isOpen }) =>
        (isOpen || !isResolved) && doesCommentEndAtSelectionCorner(cells, selection, state, reads, layout),
    ) ?? null
  );
}
export function newCommentPlace(state: PageState, reads: WorkbookReads): NewCommentPlace | null {
  let filteredArea = isFilteredSelectionForComment(state, reads)
    ? mergedAreaOrCellOf(reads, state.activeCell)
    : selectedArea(withoutOtherRanges(state), reads);
  if (filteredArea === null) return null;
  let { sheetId } = state.activeCell;
  let startCellId = reads.cellIdAt(sheetId, filteredArea.topRowIndex, filteredArea.leftColumnIndex);
  let endCellId = reads.cellIdAt(
    sheetId,
    filteredArea.topRowIndex + filteredArea.rowCount - 1,
    filteredArea.leftColumnIndex + filteredArea.columnCount - 1,
  );
  if (startCellId === null || endCellId === null) return null;
  let stored = selectionInRowOrder(
    'stored',
    {
      activeCell: startCellId,
      selectionCorner: endCellId,
    },
    reads,
  );
  let anchor = commentAnchorOfCells(stored.activeCell, stored.selectionCorner);
  let sheetIndex = reads.listSheets().findIndex((sheet) => sheet.sheetId === sheetId);
  if (anchor === null || sheetIndex < 0) return null;
  return {
    anchor,
    cells: areaToA1AsStored(filteredArea, ownRowOrderOfSheet(reads, sheetId)),
    sheetNumber: sheetIndex + 1,
  };
}
export function openCommentAtSelection(state: PageState, reads: ReadsWithTextMeasurer, isForAgent: boolean): PageTransition {
  let navigated = withoutOtherRanges(
    state.menu === null
      ? state
      : {
          ...state,
          menu: null,
        },
  );
  let area = isFilteredSelectionForComment(navigated, reads) ? moveActiveCellTo(navigated, reads, navigated.activeCell) : navigated;
  if (area.comments === null || area.mode.kind !== 'navigating') return withNoEffects(area);
  let comment = commentAtActiveCell(area, reads);
  if (comment !== null)
    return {
      state: area,
      effects: [
        {
          kind: 'openComment',
          handle: comment.handle,
        },
      ],
    };
  let place = newCommentPlace(area, reads);
  return place === null
    ? withNoEffects(area)
    : {
        state: area,
        effects: [
          {
            kind: 'openCommentBox',
            ...place,
            isForAgent,
          },
        ],
      };
}
export function openCommentByKeyboard(state: PageState, reads: WorkbookReads, handle: string | undefined): PageTransition {
  let comment = state.comments?.find((listed) => listed.handle === handle);
  return comment === undefined ||
    state.mode.kind !== 'navigating' ||
    state.newCommentOn !== null ||
    state.comments?.some(({ isOpen }) => isOpen) === true ||
    state.contextBarMenu !== null ||
    isCommentBlocked(state) ||
    !isActiveCellInComment(comment, state, reads)
    ? withNoEffects(state)
    : {
        state,
        effects: [
          {
            kind: 'openComment',
            handle: comment.handle,
            isKeyboardLeft: true,
          },
        ],
      };
}
export function shutCommentLeftBehind(state: PageState, transition: PageTransition, reads: WorkbookReads): PageTransition {
  let comment = transition.state.comments?.find(({ isOpen }) => isOpen);
  return comment !== undefined &&
    !isSameCell(state.activeCell, transition.state.activeCell) &&
    !isActiveCellInComment(comment, transition.state, reads) &&
    !transition.effects.some(({ kind }) => kind === 'openComment')
    ? {
        ...transition,
        effects: [
          ...transition.effects,
          {
            kind: 'shutComment',
          },
        ],
      }
    : transition;
}
export function goToComment(state: PageState, reads: ReadsWithTextMeasurer, handle: string): PageState {
  let isBlocked = state.mode.kind !== 'navigating' || isModalOpen(state) || state.dragging !== null;
  let commentCells = state.comments?.find((listed) => listed.handle === handle)?.cells;
  let comment = commentCells === undefined ? undefined : selectionInRowOrder('seen', commentCells, reads);
  if (isBlocked || comment === undefined || selectedArea(comment, reads) === null) return state;
  let navigated = withoutOtherRanges(showSheet(state, reads, comment.activeCell.sheetId));
  if (navigated.sheetId !== comment.activeCell.sheetId) return state;
  return {
    ...moveActiveCellTo(navigated, reads, comment.activeCell),
    selectionCorner: comment.selectionCorner,
  };
}
export function shutCommentBoxLeftBehind(state: PageState, transition: PageTransition, reads: WorkbookReads): PageTransition {
  let newCommentOn = transition.state.newCommentOn;
  return newCommentOn !== null &&
    !isSameCell(state.activeCell, transition.state.activeCell) &&
    !canCommentModePickNow(state) &&
    !isActiveCellInComment(
      {
        cells: newCommentOn,
      },
      transition.state,
      reads,
    )
    ? {
        ...transition,
        effects: [
          {
            kind: 'shutCommentBox',
          },
          ...transition.effects,
        ],
      }
    : transition;
}
/** Shuts the comment box and open comment when the press lands off the cells. */
export function shutCommentsOnPress(
  state: PageState,
  point: GridPoint,
  transition: PageTransition,
  reads: ReadsWithTextMeasurer,
): PageTransition {
  let hasNewComment = state.newCommentOn !== null && !canCommentModePickNow(state);
  let hasOpenComment = state.comments?.some(({ isOpen }) => isOpen) === true;
  let isDraggingChanged = transition.state.dragging !== state.dragging;
  if ((!hasNewComment && !hasOpenComment) || isDraggingChanged) return transition;
  if (hitTestGrid(point, state, layoutOfView(state, reads)) !== null) return transition;
  return {
    ...transition,
    effects: [
      ...(hasNewComment
        ? [
            {
              kind: 'shutCommentBox',
            } satisfies PageEffect,
          ]
        : []),
      ...transition.effects,
      ...(hasOpenComment
        ? [
            {
              kind: 'shutComment',
            } satisfies PageEffect,
          ]
        : []),
    ],
  };
}
export const withCommentsTold = (state: PageState, { listed, boxAnchor }: Pick<CommentsTold, 'listed' | 'boxAnchor'>): PageState => ({
  ...state,
  comments: listed.flatMap(({ anchor, ...comment }) => {
    let cells = cellsOfCommentAnchor(anchor);
    return cells === null
      ? []
      : [
          {
            ...comment,
            cells,
          },
        ];
  }),
  newCommentOn: boxAnchor === null ? null : cellsOfCommentAnchor(boxAnchor),
});
export const isActiveCellInOpenComment = (
  { comments, newCommentOn }: Pick<PageState, 'comments' | 'newCommentOn'>,
  reads: WorkbookReads,
  activeCell: CellId,
): boolean =>
  [
    ...(newCommentOn === null ? [] : [newCommentOn]),
    ...(comments ?? []).flatMap(({ cells, isOpen }) => (isOpen ? [cells] : [])),
  ].some(
    (cells) =>
      isActiveCellInComment(
        {
          cells,
        },
        {
          activeCell,
        },
        reads,
      ),
  );
export const isCommentWithAgent = ({ commentsWithAgent }: Pick<PageState, 'commentsWithAgent'>, handle: string): boolean =>
  commentsWithAgent?.handles.includes(handle) === true;
export const isCommentMarkedOnGrid = (state: PageState, { handle, isOpen, isResolved }: CommentOnPage): boolean =>
  isOpen || (!isResolved && (state.commentsPointedAt.includes(handle) || isCommentWithAgent(state, handle)));
export const commentAtActiveCell = (state: PageState, reads: WorkbookReads): CommentOnPage | null =>
  state.comments?.find((comment) => !comment.isResolved && isActiveCellInComment(comment, state, reads)) ?? null;
export const updateCommentModePicksCells = (state: PageState, { refusalOfEveryEdit }: Pick<PageContext, 'refusalOfEveryEdit'>): PageState => {
  let picksCells =
    state.isCommentModeOn && !state.isCommentModeLeftByPress && (refusalOfEveryEdit === 'readOnly' || state.isCommentModeForACard !== true);
  return picksCells === state.doesCommentModePickCells
    ? state
    : {
        ...state,
        doesCommentModePickCells: picksCells,
      };
};
export const doesCommentModePick = (state: PageState): boolean =>
  state.doesCommentModePickCells && state.comments !== null && state.mode.kind !== 'editing';
export const canCommentModePickNow = (state: PageState): boolean =>
  state.doesCommentModePickCells && state.comments !== null && state.mode.kind === 'navigating' && state.find === null && isNothingOpenButPane(state);
/** Whether the selection cannot take a comment as it is: rows in it are filtered out or stand apart in the order seen. */
export const isFilteredSelectionForComment = (state: PageState, reads: WorkbookReads): boolean => {
  let area = selectedArea(withoutOtherRanges(state), reads);
  if (area === null) return false;
  let rowSpan = {
    firstIndex: area.topRowIndex,
    count: area.rowCount,
  };
  return (
    hasFilteredRowsIn(state, reads, area) || wholeRowSpanIn('stored', ownRowOrderOfSheet(reads, state.activeCell.sheetId), rowSpan) === null
  );
};
export const hasCommentToOpenAtSelection = (state: PageState, reads: WorkbookReads): boolean =>
  state.comments !== null &&
  state.mode.kind === 'navigating' &&
  (commentAtActiveCell(state, reads) !== null || newCommentPlace(state, reads) !== null);
export const isCommentBlocked = (state: PageState): boolean =>
  state.find !== null || state.dragging !== null || isModalOpen(state) || !isNothingOpenButPane(state);
export const goToCommentKeepingScroll = (state: PageState, reads: ReadsWithTextMeasurer, handle: string): PageState => {
  let { scrollLeft, scrollTop } = state;
  let navigated = goToComment(state, reads, handle);
  return navigated === state
    ? state
    : {
        ...navigated,
        scrollLeft,
        scrollTop,
      };
};
