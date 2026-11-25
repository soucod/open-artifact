import { hasOtherRanges } from '../selection/several-ranges.ts';
import { selectedArea, activeAnchorCell, areaOfPosition, isSameCell } from '../selection/model.ts';
import { hasFilteredRowsIn } from '../tables/filtered-rows.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { wholeAreaToA1AsStored, columnLetters } from '../model/a1-references.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { selectedPlacedViewId } from '../charts/placed-views.ts';
import { ownFiltersOfSheet } from '../tables/own-filters.ts';
import type { OwnSortToldToAgent, PageState, SelectedToldToAgent, SelectionForAgent } from '../state/initial-state.ts';
import type { PageContext } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
/** What telling the agent the selection reads: the workbook, and the revision held. */
export type SelectionContext = Pick<PageContext, 'reads' | 'revisionHeld'>;
export function selectionForAgent(state: PageState, context: SelectionContext): SelectionForAgent | null {
  const { reads, revisionHeld } = context;
  if (revisionHeld === null || !canTellAgentSelection(state, context) || hasOtherRanges(state)) return null;
  let { sheetId } = state.activeCell;
  let sheetIndex = reads.listSheets().findIndex((sheet) => sheet.sheetId === sheetId);
  let selected = selectedArea(state, reads);
  let entryPosition = reads.positionOfCell(activeAnchorCell(state, reads));
  if (sheetIndex < 0 || selected === null || entryPosition === null) return null;
  if (hasFilteredRowsIn(state, reads, selected)) return null;
  let ownRowOrder = ownRowOrderOfSheet(reads, sheetId);
  let range = wholeAreaToA1AsStored(selected, ownRowOrder);
  if (range === null) return null;
  return {
    sheetNumber: sheetIndex + 1,
    range,
    activeCell: areaToA1AsStored(areaOfPosition(entryPosition), ownRowOrder),
    revision: revisionHeld,
  };
}
export function ownSortOfViewForAgent(
  state: PageState,
  { reads }: Pick<SelectionContext, 'reads'> = {} as Pick<SelectionContext, 'reads'>,
): OwnSortToldToAgent | null {
  let { sheetId } = state;
  if (!state.ownRowOrders.has(sheetId)) return null;
  let by = (ownFiltersOfSheet(state, sheetId).find((filter) => filter.sort !== null)?.sort?.by ?? []).flatMap(({ c: columnId, direction }) => {
    let index = reads.columnIndexOf(sheetId, columnId);
    return index === null ? [] : [`${columnLetters(index)} ${direction}`];
  });
  return {
    sheetNumber: reads.listSheets().findIndex((sheet) => sheet.sheetId === sheetId) + 1,
    by: by.slice(0, MAX_SORT_KEYS_TOLD_TO_AGENT).join(', '),
  };
}
export function withSelectionToldToAgent(
  previousState: PageState,
  { state, effects }: PageTransition,
  context: SelectionContext,
): PageTransition {
  let { selectedToldToAgent: told } = state;
  if (
    told !== null &&
    isSameCell(state.activeCell, previousState.activeCell) &&
    isSameCell(state.selectionCorner, previousState.selectionCorner) &&
    state.rangeWalked === previousState.rangeWalked &&
    state.otherRanges === previousState.otherRanges &&
    state.placementSelected === previousState.placementSelected &&
    state.rowsOutOfViewByOwnFilters === previousState.rowsOutOfViewByOwnFilters &&
    state.ownFilters === previousState.ownFilters &&
    state.ownRowOrders === previousState.ownRowOrders &&
    state.entriesUnanswered === previousState.entriesUnanswered &&
    state.workbookChangeCount === previousState.workbookChangeCount &&
    (told.byAddress?.revision ?? null) === context.revisionHeld
  )
    return {
      state,
      effects,
    };
  let byAddress = selectionForAgent(state, context);
  let chartId = context.revisionHeld === null ? null : selectedPlacedViewId(state, context.reads);
  let ownSort = ownSortOfViewForAgent(state, context);
  if (
    told !== null &&
    told.chartId === chartId &&
    told.ownSort?.sheetNumber === ownSort?.sheetNumber &&
    told.ownSort?.by === ownSort?.by &&
    told.byAddress?.sheetNumber === byAddress?.sheetNumber &&
    told.byAddress?.range === byAddress?.range &&
    told.byAddress?.activeCell === byAddress?.activeCell &&
    told.byAddress?.revision === byAddress?.revision
  )
    return {
      state,
      effects,
    };
  let selected: SelectedToldToAgent = {
    byAddress,
    chartId,
    ownSort,
  };
  return {
    state: {
      ...state,
      selectedToldToAgent: selected,
    },
    effects: [
      ...effects,
      {
        kind: 'tellAgentWhatIsSelected',
        selected,
      },
    ],
  };
}
export const VIEW_ID_PATTERN = /^viw_[a-z0-9]{8,16}\.\d{1,10}$/;
export const isViewId = (viewId: string): boolean => VIEW_ID_PATTERN.test(viewId);
export const canTellAgentSelection = (
  { entriesUnanswered }: Pick<PageState, 'entriesUnanswered'>,
  { revisionHeld }: Pick<PageContext, 'revisionHeld'>,
): boolean =>
  revisionHeld !== null && entriesUnanswered.length === 0;
export const MAX_SORT_KEYS_TOLD_TO_AGENT = 20;
