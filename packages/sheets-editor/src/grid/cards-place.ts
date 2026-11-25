import type { Person } from '@open-artifact/sheets-core';
import type { ProfileOfPerson } from '../chips/people-list.ts';
import type { CellArea } from '../selection/model.ts';
import type { LineIndex, LineSpan } from '../model/line-ids.ts';
import type { LineSizes } from '../model/line-sizes.ts';
import type { SizeOnPage } from '../view/page-view.ts';
import type { BorderLinesInBox } from './moved-columns.ts';
import type { ShownLines } from './borders.ts';
import type { AreaSpansOnScreen, EdgesOfCells, GridPane, PaneRect } from './geometry.ts';
import type { AxisLinesOnShow, LinesOnShow } from './lines-slide.ts';
import { resetScrollForFreezeDrag, layoutOfView } from './layout.ts';
import { showSheetPointedIn } from '../formulas/sheet-pointed-in.ts';
import { rowPanes, columnPanes } from './geometry.ts';
import { errorsOfferShown } from '../formulas/fix/errors-offer.ts';
import { a1OfFirstAndLast } from '../view/page-view.ts';
import { GRID_PIXEL_SLACK } from './entry-hints.ts';
import { profileOfUser } from '../chips/people-list.ts';
import { CELL_POPUP_SIDE_OFFSETS, POPUP_EDGE_GAP } from '../ui/popup-placement.ts';
import { drawnBoxOfSpans } from './view-boxes.ts';
import { shownLineAtOrBefore, shownLineAtOrAfter } from '../model/line-sizes.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageState } from '../state/initial-state.ts';
/** A person as a chip in a cell shows them: their id, name and picture. */
export interface ChipPerson {
  userId: string;
  name: string;
  avatarUrl: string | null;
}
/** A box of a cell, or of its text, that the offer to fix errors steers clear of or comes after. */
export interface CellBoxForOffer extends PaneRect {
  isInError: boolean;
  isOfOffer: boolean;
  isWholeInView: boolean;
  runsOnFromError?: true;
}
/** How far the errors offered reach: whether more are below the view, the left of the first, and the right of the fixes. */
export interface ErrorsOfferReach {
  areMoreBelow: boolean;
  leftOfFirst: number;
  rightOfFixes: number;
}
/** Where the top left corner of the offer to fix errors goes. */
export interface ErrorsOfferCorner {
  left: number;
  top: number;
}
/** Where the summary of the selection goes: the middle of its width, its top and its height. */
export interface SelectionSummaryPlace {
  center: number;
  top: number;
  height: number;
}
/** The side of a cell its explaining card goes on. */
export type SideOfExplainedCard = 'right' | 'under';
/** A place for the explaining card, beside the cell or under it. */
interface ExplainedCardPlace {
  side: SideOfExplainedCard;
  left: number;
  top: number;
}
export function linesOnShowOf(state: PageState, reads: ReadsWithTextMeasurer): LinesOnShow {
  let view = resetScrollForFreezeDrag(showSheetPointedIn(state, reads));
  let [layout, lines] = [layoutOfView(view, reads), reads.linesOf(view.sheetId)];
  return {
    sheetId: view.sheetId,
    rows: axisLinesOnShow(lines?.rows, layout.rowEdges, layout.rowsOutOfSight, rowPanes(view, layout, view)),
    columns: axisLinesOnShow(lines?.columns, layout.columnEdges, layout.columnsOutOfSight, columnPanes(view, layout, view)),
  };
}
export function sideForExplainedCard(
  cellBox: PaneRect,
  pageSize: SizeOnPage,
  zoom: number,
  boxesInTheWay: readonly PaneRect[],
): SideOfExplainedCard | null {
  let [cardWidth, cardHeight] = [EXPLAINED_CARD_SIZE.width / zoom, EXPLAINED_CARD_SIZE.height / zoom];
  let margins = EXPLAINED_CARD_MARGINS;
  let places: ExplainedCardPlace[] = [
    {
      side: 'right',
      left: cellBox.left + cellBox.width,
      top: cellBox.top,
    },
    {
      side: 'under',
      left: cellBox.left,
      top: cellBox.top + cellBox.height,
    },
  ];
  let isInTheWay = ({ left, top }: ExplainedCardPlace, box: PaneRect) =>
    !isSameBoxCorner(box, cellBox) &&
    left < box.left + box.width &&
    box.left < left + cardWidth &&
    top < box.top + box.height &&
    box.top < top + cardHeight;
  let placesThatFit = places.filter(
    (place) =>
      place.side === 'right'
        ? place.left + cardWidth + margins.right / zoom <= pageSize.width && cellBox.top + EXPLAINED_CARD_MIN_ROOM / zoom <= pageSize.height
        : place.top + cardHeight + margins.under / zoom <= pageSize.height,
  );
  return (
    (placesThatFit.find((place) => !boxesInTheWay.some((box) => isInTheWay(place, box))) ?? placesThatFit[0])
      ?.side ?? null
  );
}
export function errorsOfferedView(state: PageState, reads: ReadsWithTextMeasurer) {
  let errorsArea = errorsOfferShown(state, reads);
  let cells = errorsArea === null ? null : a1OfFirstAndLast(errorsArea, reads);
  return cells === null
    ? null
    : {
        count: state.errorsOffered?.count ?? 0,
        cells,
      };
}
export function errorsOfferCornerPlace(
  selectionRect: EdgesOfCells,
  { areMoreBelow, leftOfFirst, rightOfFixes }: ErrorsOfferReach,
  zoom: number,
  explainedCard: PaneRect | null,
  cellBoxes: readonly CellBoxForOffer[],
  otherBoxes: readonly PaneRect[],
): ErrorsOfferCorner | null {
  let [offerHeight, offerWidth] = [ERRORS_OFFER_HEIGHT / zoom, ERRORS_OFFER_WIDTH / zoom];
  let lowestTop = selectionRect.bottom - offerHeight;
  let rightmostLeft = Math.max(selectionRect.left, selectionRect.right - offerWidth);
  let freePlaceFrom = (
    boxes: readonly PaneRect[],
    offerLeft: number,
    startTop: number,
    direction: 'down' | 'up',
  ): ErrorsOfferCorner | null => {
    let boxesInColumn = boxes.filter(
      (box) => offerLeft + GRID_PIXEL_SLACK < box.left + box.width && box.left < offerLeft + offerWidth,
    );
    let freeTopFrom = (offerTop: number, boxesLeft: readonly PaneRect[]): number => {
      let overlapping = boxesLeft.filter(
        (box) => offerTop + GRID_PIXEL_SLACK < box.top + box.height && box.top + GRID_PIXEL_SLACK < offerTop + offerHeight,
      );
      if (overlapping.length === 0) return offerTop;
      return freeTopFrom(
        direction === 'down'
          ? Math.max(...overlapping.map((box) => box.top + box.height))
          : Math.min(...overlapping.map((box) => box.top)) - offerHeight,
        boxesLeft.filter((box) => !overlapping.includes(box)),
      );
    };
    let top = freeTopFrom(startTop, boxesInColumn);
    return (direction === 'down' || selectionRect.top <= top) && top <= lowestTop
      ? {
          left: offerLeft,
          top,
        }
      : null;
  };
  let cardTopPart = (ERRORS_OFFER_HEIGHT - ERRORS_OFFER_TOP_PART) / zoom;
  let cardBoxes: PaneRect[] =
    explainedCard === null
      ? []
      : [
          {
            ...explainedCard,
            top: explainedCard.top + cardTopPart,
            height: explainedCard.height - cardTopPart,
          },
        ];
  let boxesInTheWay = [...cardBoxes, ...cellBoxes, ...otherBoxes].filter((box) => !('runsOnFromError' in box));
  let boxesInError = [...cardBoxes, ...cellBoxes.filter(({ isInError }) => isInError)];
  let offeredBoxes = cellBoxes.filter((box) => box.isOfOffer && box.isWholeInView);
  let lastOffered = offeredBoxes.reduce<CellBoxForOffer | null>(
    (last, box) =>
      last === null || box.top > last.top + 0.5 || (box.top > last.top - 0.5 && box.left > last.left) ? box : last,
    null,
  );
  if (lastOffered !== null) {
    let [rightOfLast, bottomOfLast] = [lastOffered.left + lastOffered.width, lastOffered.top + lastOffered.height];
    let placeBelow = areMoreBelow
      ? null
      : freePlaceFrom(
          boxesInTheWay,
          lastOffered.left <= rightmostLeft ? lastOffered.left : Math.max(selectionRect.left, rightOfLast - offerWidth),
          bottomOfLast,
          'down',
        );
    if (placeBelow !== null && placeBelow.top - bottomOfLast <= ERRORS_OFFER_MAX_DROP / zoom) return placeBelow;
    let placeBeside = areMoreBelow || rightOfLast > rightmostLeft ? null : freePlaceFrom(boxesInTheWay, rightOfLast, lastOffered.top, 'down');
    if (placeBeside?.top === lastOffered.top) return placeBeside;
    let rightOfOffered = Math.max(...offeredBoxes.map((box) => box.left + box.width));
    let rightOfOfferedAndFixes = Math.max(rightOfOffered, rightOfFixes);
    let leftBeforeOffered = Math.min(...offeredBoxes.map((box) => box.left)) - offerWidth;
    let placeAbove =
      (rightOfOfferedAndFixes <= rightmostLeft ? freePlaceFrom(boxesInError, rightOfOfferedAndFixes, lowestTop, 'up') : null) ??
      (rightOfOffered <= rightmostLeft ? freePlaceFrom(boxesInError, rightOfOffered, lowestTop, 'up') : null) ??
      (selectionRect.left <= leftBeforeOffered ? freePlaceFrom(boxesInError, leftBeforeOffered, lowestTop, 'up') : null);
    if (placeAbove !== null) return placeAbove;
  }
  let left = clampWithinBounds(selectionRect.left, leftOfFirst, rightmostLeft);
  return freePlaceFrom(boxesInError, left, lowestTop, 'up') ?? freePlaceFrom(cardBoxes, left, lowestTop, 'up');
}
export function selectionSummaryPlace(box: PaneRect, pageSize: SizeOnPage): SelectionSummaryPlace {
  let height = SELECTION_SUMMARY_HEIGHT;
  let right = Math.min(box.left + box.width, pageSize.width);
  let topBelow = box.top + box.height + SELECTION_SUMMARY_GAP;
  let topAbove = box.top - SELECTION_SUMMARY_GAP - height;
  let lowestTop = pageSize.height - SELECTION_SUMMARY_GAP - height;
  return {
    center: (Math.max(box.left, 0) + right) / 2,
    top: topBelow <= lowestTop ? topBelow : topAbove >= SELECTION_SUMMARY_GAP && topAbove <= lowestTop ? topAbove : lowestTop,
    height,
  };
}
export function chipPersonOf(profilesById: ReadonlyMap<string, ProfileOfPerson>, person: Person): ChipPerson {
  let { userId, name, avatarUrl } = profileOfUser(profilesById, person);
  return {
    userId,
    name,
    avatarUrl: avatarUrl === '' ? null : avatarUrl,
  };
}
export const SELECTION_SUMMARY_HEIGHT = 20;
export const ERRORS_OFFER_HEIGHT = 84;
export const ERRORS_OFFER_TOP_PART = 44;
export const ERRORS_OFFER_WIDTH = 304;
export const ERRORS_OFFER_MAX_DROP = 120;
export const EXPLAINED_CARD_MIN_ROOM = 52;
export const COMMENT_CARD_ROOM_AT_FOOT = 340;
export const EXPLAINED_CARD_SIZE = {
  width: 320,
  height: 120,
};
export const EXPLAINED_CARD_MARGINS = {
  right: CELL_POPUP_SIDE_OFFSETS.right + POPUP_EDGE_GAP,
  under: CELL_POPUP_SIDE_OFFSETS.under + POPUP_EDGE_GAP,
};
export const isSameBoxCorner = (first: Pick<PaneRect, 'left' | 'top'>, second: Pick<PaneRect, 'left' | 'top'>): boolean =>
  Math.abs(first.left - second.left) < 0.5 && Math.abs(first.top - second.top) < 0.5;
export const isBoxShownOrEmpty = (spans: AreaSpansOnScreen): boolean =>
  drawnBoxOfSpans(spans) !== null || spans.across.end === spans.across.start || spans.down.end === spans.down.start;
export const rectOfSpans = ({ across, down }: AreaSpansOnScreen): PaneRect => ({
  left: across.start,
  top: down.start,
  width: across.end - across.start,
  height: down.end - down.start,
});
export const clampWithinBounds = (low: number, value: number, high: number): number => Math.max(low, Math.min(value, high));
export const FIX_PILL_REACH = 260;
export const FIX_PILL_ROOM_ABOVE = 64;
export const SELECTION_SUMMARY_GAP = 3;
export const doColumnSpansOverlap = (
  first: Pick<CellArea, 'leftColumnIndex' | 'columnCount'>,
  second: Pick<CellArea, 'leftColumnIndex' | 'columnCount'>,
): boolean =>
  first.leftColumnIndex < second.leftColumnIndex + second.columnCount && second.leftColumnIndex < first.leftColumnIndex + first.columnCount;
export const NO_LINES_IN_TEXT_BOX: readonly number[] = [];
export const NO_NUMBERS_OF_LINES: readonly (number | null)[] = [];
export const NO_OTHER_PEOPLE: readonly ChipPerson[] = [];
export const NO_BORDER_LINES: readonly BorderLinesInBox[] = [];
export const linesAroundIndexes = (indexes: readonly number[], edges: LineSizes): ShownLines => ({
  before: shownLineAtOrBefore(edges, (indexes[0] ?? 0) - 1),
  indexes,
  after: shownLineAtOrAfter(edges, (indexes.at(-1) ?? 0) + 1),
});
export const axisLinesOnShow = (
  order: LineIndex | undefined,
  edges: LineSizes,
  outOfSight: readonly LineSpan[],
  panes: readonly GridPane[],
): AxisLinesOnShow => ({
  order: order ?? null,
  outOfSight,
  edges,
  frozenCount: panes.find(({ areFrozen }) => areFrozen)?.count ?? 0,
  scroll: panes.find(({ areFrozen }) => !areFrozen)?.scroll ?? 0,
});
