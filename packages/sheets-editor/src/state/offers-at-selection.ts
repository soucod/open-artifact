import type { WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import type { PaneRect, rangeSpansOnScreen } from '../grid/geometry.ts';
import type { PageState } from './initial-state.ts';
import type { PageEvent } from './event-reducer.ts';
import type { CellExplained } from './explained-under-cell.ts';
import { selectedArea, isSameArea, mergedAreaOrCellOf } from '../selection/model.ts';
import { isPointerOrMenuEvent } from './context-bar.ts';
import { pressedCheckbox } from '../chips/checkbox-presses.ts';
import { isExplainingBlocked, linkAddressesAt } from './explained-under-cell.ts';
import { escapeInCellsDoes } from './escape.ts';
import { isIdleOrTapping } from './transitions.ts';
import { isActiveCellInOpenComment } from '../comments/comment-state.ts';
import { isSpanInSight } from '../grid/geometry.ts';
export function isSameSelectionForOffers(before: PageState, state: PageState, reads: WorkbookReads): boolean {
  if (before.sheetId !== state.sheetId) return false;
  if ((before.otherRanges.length > 0 || state.otherRanges.length > 0) && before.otherRanges !== state.otherRanges) return false;
  if (before.activeCell.sheetId !== state.activeCell.sheetId) return false;
  if (
    before.activeCell === state.activeCell &&
    before.selectionCorner === state.selectionCorner &&
    before.rangeWalked === state.rangeWalked &&
    before.workbookChangeCount === state.workbookChangeCount
  )
    return true;
  let [areaBefore, area] = [selectedArea(before, reads), selectedArea(state, reads)];
  return areaBefore === null || area === null ? areaBefore === area : isSameArea(areaBefore, area);
}
export function stepOffersAtSelection(before: PageState, state: PageState, event: PageEvent, reads: WorkbookReads): OffersAtSelection {
  let offers = state.offersAtSelection;
  let arePutAwayIn = (stateToCheck: PageState) =>
    isPointerOrMenuEvent(event) &&
    (pressedCheckbox(stateToCheck) !== null ||
      state.dropdown !== null ||
      state.peopleList !== null ||
      state.calendar !== null ||
      state.timeList !== null);
  if (!isSameSelectionForOffers(before, state, reads))
    return {
      nthSelection: offers.nthSelection + 1,
      areCellsSelectedByPointer: isPointerOrMenuEvent(event),
      arePutAway: arePutAwayIn(state),
      hasPersonChosenCells: before.sheetId === state.sheetId,
    };
  let dragging = before.dragging;
  let isChosenByPointer =
    event.kind === 'pointerReleased' &&
    ((dragging?.kind === 'selecting' && dragging.what === 'cells') || (dragging?.kind === 'tapping' && dragging.isOnActiveCell));
  if (!offers.hasPersonChosenCells && isChosenByPointer)
    return {
      ...offers,
      areCellsSelectedByPointer: true,
      arePutAway: arePutAwayIn(before),
      hasPersonChosenCells: true,
    };
  let isEscapeStepOut =
    event.kind === 'keyPressed' && event.key === 'Escape' && !isExplainingBlocked(before) && escapeInCellsDoes(before) === 'stepsOut';
  let arePutAway = offers.arePutAway || isEscapeStepOut || arePutAwayIn(before);
  let isBusy =
    isIdleOrTapping(state) && (isExplainingBlocked(state) || state.isAgentWorking || isActiveCellInOpenComment(state, reads, state.activeCell));
  let areCellsSelectedByPointer = offers.areCellsSelectedByPointer && !isBusy;
  return arePutAway === offers.arePutAway && areCellsSelectedByPointer === offers.areCellsSelectedByPointer
    ? offers
    : {
        ...offers,
        areCellsSelectedByPointer,
        arePutAway,
      };
}
export function mayOfferAtSelection(state: PageState, reads: WorkbookReads, explained: CellExplained | null): boolean {
  return (
    state.offersAtSelection.hasPersonChosenCells &&
    !state.offersAtSelection.arePutAway &&
    !isExplainingBlocked(state) &&
    state.otherRanges.length === 0 &&
    state.placementSelected === null &&
    !state.isAgentWorking &&
    !isActiveCellInOpenComment(state, reads, state.activeCell) &&
    (explained === null || isExplainedBySelectionWithoutLinks(explained, state, reads))
  );
}
export function isAreaJustActiveCell(state: PageState, reads: WorkbookReads, area: CellArea): boolean {
  let activeArea = mergedAreaOrCellOf(reads, state.activeCell);
  return activeArea !== null && isSameArea(area, activeArea);
}
export function placeOfSelectionOffer(
  { across, down }: ReturnType<typeof rangeSpansOnScreen>,
  view: { width: number; height: number },
  zoom: number,
  { side = 'full', endOfCutText = null }: { side?: SelectionOfferSide; endOfCutText?: number | null } = {},
): SelectionOfferPlace | null {
  if (!isSpanInSight(across) || !isSpanInSight(down)) return null;
  let [margin, size] = [SELECTION_OFFER_MARGIN / zoom, SELECTION_OFFER_SIZE[side] / zoom];
  let [top, bottomShown] = [Math.max(down.start, down.showFrom), Math.min(down.end, down.showTo, view.height)];
  if (bottomShown <= top) return null;
  let [left, maxLeft] = [Math.max(across.end, endOfCutText ?? 0) + Math.max(margin, SELECTION_OFFER_MIN_GAP), view.width - size - margin];
  if (endOfCutText !== null && left > maxLeft) return null;
  let isTucked = left > maxLeft && across.end <= view.width;
  let bottom = isTucked
    ? Math.min(view.height - margin, down.end - SELECTION_OFFER_LIFT / zoom)
    : Math.max(view.height - margin, side === 'short' ? bottomShown : 0);
  if (bottom - top < size) return null;
  return {
    left: Math.min(left, maxLeft),
    middle: (top + (isTucked ? Math.min(bottomShown, bottom) : bottomShown)) / 2,
    top,
    bottom,
  };
}
export function isSelectionOfferCovered(
  { left, middle, top, bottom }: SelectionOfferPlace,
  rects: readonly PaneRect[],
  zoom: number,
  side: SelectionOfferSide = 'full',
): boolean {
  let size = SELECTION_OFFER_SIZE[side] / zoom;
  let buttonTop = Math.max(top, Math.min(middle - size / 2, bottom - size));
  return rects.some(
    (rect: PaneRect) =>
      rect.left < left + size && left < rect.left + rect.width && rect.top < buttonTop + size && buttonTop < rect.top + rect.height,
  );
}
export const NO_OFFERS_AT_SELECTION: OffersAtSelection = {
  nthSelection: 0,
  areCellsSelectedByPointer: false,
  arePutAway: false,
  hasPersonChosenCells: false,
};
export const isExplainedBySelectionWithoutLinks = ({ by, cellId }: CellExplained, state: PageState, reads: WorkbookReads): boolean =>
  by === 'selection' && linkAddressesAt(state, reads, cellId).length === 0;
export const isChosenCellAlone = (state: PageState, reads: WorkbookReads, area: CellArea): boolean =>
  state.offersAtSelection.hasPersonChosenCells &&
  !isExplainingBlocked(state) &&
  state.otherRanges.length === 0 &&
  state.placementSelected === null &&
  isAreaJustActiveCell(state, reads, area);
export const SELECTION_OFFER_SIZE = {
  full: 36,
  short: 24,
};
export const SELECTION_OFFER_MARGIN = 6;
export const SELECTION_OFFER_MIN_GAP = 8;
export const SELECTION_OFFER_LIFT = 18;
/** How big the button offered beside the selection is drawn. */
export type SelectionOfferSide = keyof typeof SELECTION_OFFER_SIZE;
/** Where the button offered beside the selection goes, in pixels of the page. */
export interface SelectionOfferPlace {
  left: number;
  middle: number;
  top: number;
  bottom: number;
}
export interface OffersAtSelection {
  nthSelection: number;
  areCellsSelectedByPointer: boolean;
  arePutAway: boolean;
  hasPersonChosenCells: boolean;
}
