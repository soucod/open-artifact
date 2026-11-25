import type { Filter, SheetId } from '@open-artifact/sheets-core';
import { ownFilterByKey, restoreHeldOwnFilter, applyOwnFilter, heldOwnFilterSnapshot } from './own-filters.ts';
import { isSameCell } from '../selection/model.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { OwnFilterTried, PageState, SelectionPlace } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { OwnFilter } from './own-filters.ts';
/** The page with a filter tried on it, and the try to undo it by; `tried` is `null` when nothing is tried. */
export interface OwnFilterTry {
  state: PageState;
  tried: OwnFilterTried | null;
}
/** The filters of each sheet as they stood before a try, for the filters they were worked out from. */
interface OwnFiltersBeforeTryCached {
  of: Map<SheetId, OwnFilter[]>;
  kept: Map<SheetId, OwnFilter[]>;
}
export function withPlaceBeforeTry(
  state: PageState,
  reads: WorkbookReads,
  { placeBefore, placeAfterTry }: Pick<OwnFilterTried, 'placeBefore' | 'placeAfterTry'>,
  undone: PageState,
): PageState {
  const canPlaceBefore = reads.positionOfCell(placeBefore.activeCell) !== null && reads.positionOfCell(placeBefore.selectionCorner) !== null;
  if (placeAfterTry === null) return undone;
  if (!canPlaceBefore || !isSameSelectionPlace(selectionPlaceOf(state), placeAfterTry)) return undone;
  const scrollTop = state.scrollTop === placeAfterTry.scrollTop ? placeBefore.scrollTop : undone.scrollTop;
  return {
    ...undone,
    ...placeBefore,
    scrollTop,
  };
}
export function undoOwnFilterTry(state: PageState, reads: ReadsWithTextMeasurer, tried: OwnFilterTried): PageState {
  const heldNow = ownFilterByKey(state, tried.before.held.key);
  if (heldNow === null || heldNow.filter === tried.before.held.filter) return state;
  return withPlaceBeforeTry(state, reads, tried, restoreHeldOwnFilter(state, reads, tried.before));
}
export function tryOwnFilter(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  held: OwnFilter,
  tried: OwnFilterTried | null,
  filter: Filter | null,
): OwnFilterTry {
  if (held.filter === filter)
    return {
      state,
      tried,
    };
  const stateBeforeTry = tried === null ? state : undoOwnFilterTry(state, reads, tried);
  const heldBefore = ownFilterByKey(stateBeforeTry, held.key) ?? held;
  const triedState = applyOwnFilter(stateBeforeTry, reads, heldBefore, filter);
  const heldAfter = ownFilterByKey(triedState, held.key);
  if (heldAfter === null || heldAfter.filter === heldBefore.filter)
    return {
      state: applyOwnFilter(state, reads, held, filter),
      tried,
    };
  return {
    state: triedState,
    tried: {
      before: tried === null ? heldOwnFilterSnapshot(state, held) : tried.before,
      placeBefore: tried === null ? selectionPlaceOf(state) : tried.placeBefore,
      placeAfterTry: selectionPlaceOf(triedState),
    },
  };
}
export function ownFiltersBeforeTry(ownFilters: Map<SheetId, OwnFilter[]>, tried: OwnFilterTried | null): Map<SheetId, OwnFilter[]> {
  if (tried === null) return ownFilters;
  const cached = ownFiltersBeforeTryCache.get(tried);
  if (cached?.of === ownFilters) return cached.kept;
  const filtersBefore = new Map(
    Array.from(
      ownFilters,
      ([sheetId, filters]): [SheetId, OwnFilter[]] => [
        sheetId,
        filters.map((filter) => (filter.key === tried.before.held.key ? tried.before.held : filter)),
      ],
    ),
  );
  ownFiltersBeforeTryCache.set(tried, {
    of: ownFilters,
    kept: filtersBefore,
  });
  return filtersBefore;
}
export const selectionPlaceOf = ({
  sheetId,
  activeCell,
  selectionCorner,
  otherRanges,
  rangeWalked,
  scrollTop,
}: SelectionPlace): SelectionPlace => ({
  sheetId,
  activeCell,
  selectionCorner,
  otherRanges,
  rangeWalked,
  scrollTop,
});
export const isSameSelectionPlace = (place: SelectionPlace, other: SelectionPlace): boolean =>
  place.sheetId === other.sheetId &&
  isSameCell(place.activeCell, other.activeCell) &&
  isSameCell(place.selectionCorner, other.selectionCorner) &&
  place.otherRanges === other.otherRanges;
export const wasOwnFilterTryUndone = (before: PageState, after: PageState): boolean =>
  before.ownFilterTried !== null && after.ownFilterTried === null && isSameSelectionPlace(selectionPlaceOf(after), before.ownFilterTried.placeBefore);
export const ownFiltersBeforeTryCache = new WeakMap<OwnFilterTried, OwnFiltersBeforeTryCached>();
