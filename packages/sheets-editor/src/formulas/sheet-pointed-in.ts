import type { SheetId } from '@open-artifact/sheets-core';
import type { CaretInEntryPlaced } from '../editor/entry-boxes.ts';
import type { GridPoint } from '../grid/geometry.ts';
import type { KeyStep } from '../keys/key-acts.ts';
import type { IfQueued, PageContext, PageEvent } from '../state/event-reducer.ts';
import type { SheetShownDone } from '../state/sheet-tabs.ts';
import type { PageMode, PageTransition } from '../state/transitions.ts';
import { clampScrollOfView, findSheetById } from '../grid/layout.ts';
import { activeAnchorCell, areaOfPosition, selectedArea, scrollToShowActiveCell, selectionAtCell } from '../selection/model.ts';
import { areaToA1AsStored } from './from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { isPointingPossible, pointAtCell, dragPointedReference } from './reference-pointing.ts';
import { firstPlaceInSheet, interactiveOfSheet } from '../state/places.ts';
import { isFormulaAskedOrProposed } from './from-words/actions.ts';
import { selectionAtPointer } from '../selection/pointer.ts';
import { withNoEffects } from '../state/transitions.ts';
import { endEntryOnPointerPress, pointerSelectRequest } from '../editor/commit-entry.ts';
import { showSheet } from '../state/sheet-tabs.ts';
import { withIfQueued } from '../model/edit-effects.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { carryFormulaOfAgentDiscarded } from '../agent/discarded-formula-note.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState, SheetShownForDone } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** What a sheet beside the entry's would be to point in: the entry's own, another, or none to point in. */
export type SheetToPointIn = 'entrysOwn' | 'another' | null;
/** The state as it is seen while a formula is entered in one sheet and its references are pointed at in another. */
export function showSheetPointedIn(state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  let place = state.placesLeft.find(({ sheetId: placeSheetId }) => placeSheetId === state.sheetPointedIn);
  if (place === undefined) return state;
  let { sheetId, scrollLeft, scrollTop } = place;
  return clampScrollOfView(
    {
      ...state,
      sheetId,
      scrollLeft,
      scrollTop,
    },
    workbook,
  );
}
/** Back from the sheet pointed in, as `shown`, to the entry's sheet, keeping what changed from `shown` to `next`. */
export function restoreEntrySheet(entryState: PageState, shown: PageState, next: PageState): PageState {
  if (next === shown) return entryState;
  let { sheetId, scrollLeft, scrollTop } = entryState;
  let placesLeft = entryState.placesLeft.map(
    (place) =>
      place.sheetId === next.sheetId
        ? {
            ...place,
            scrollLeft: next.scrollLeft,
            scrollTop: next.scrollTop,
          }
        : place,
  );
  return {
    ...next,
    sheetId,
    scrollLeft,
    scrollTop,
    placesLeft,
  };
}
export function actOnSheetPointedIn(state: PageState, workbook: ReadsWithTextMeasurer, act: (state: PageState) => PageState): PageState {
  if (state.sheetPointedIn === null) return act(state);
  let shown = showSheetPointedIn(state, workbook);
  return restoreEntrySheet(state, shown, act(shown));
}
export function sheetShownLastDone(
  state: PageState,
  workbook: WorkbookReads,
  pointedSheetId: SheetId | null,
): SheetShownDone | SheetShownForDone | null {
  let entrySheetName = findSheetById(workbook, state.sheetId)?.name;
  if (entrySheetName === undefined) return null;
  if (pointedSheetId === null)
    return {
      what: 'sheetShown',
      name: entrySheetName,
    };
  let pointedSheetName = findSheetById(workbook, pointedSheetId)?.name;
  let position = workbook.positionOfCell(activeAnchorCell(state, workbook));
  if (pointedSheetName === undefined || position === null) return null;
  let entryCell = areaToA1AsStored(areaOfPosition(position), ownRowOrderOfSheet(workbook, state.sheetId));
  return {
    what: 'sheetShownForFormula',
    name: pointedSheetName,
    entryCell,
    entrySheet: entrySheetName,
  };
}
export function canSwitchSheetWhileEditing(
  mode: PageMode,
  caret: CaretInEntryPlaced | undefined,
  isBackToEntrySheet: boolean,
  mayPoint: boolean,
): boolean {
  if (mode.kind !== 'editing') return false;
  return isBackToEntrySheet || (mayPoint && isPointingPossible(mode, caret));
}
export function sheetIdAtOffset(sheetId: SheetId, workbook: WorkbookReads, offset: KeyStep): SheetId | undefined {
  let sheets = workbook.listSheets();
  return sheets[sheets.findIndex((sheet) => sheet.sheetId === sheetId) + offset]?.sheetId;
}
export function sheetsToPointInFor(
  state: PageState,
  workbook: WorkbookReads,
  allowsAnother: boolean,
): { before: SheetToPointIn; after: SheetToPointIn } {
  let { sheetId, sheetPointedIn } = state;
  let targetAt = (offset: KeyStep): SheetToPointIn => {
    let targetSheetId = sheetIdAtOffset(sheetPointedIn ?? sheetId, workbook, offset);
    if (targetSheetId === undefined || firstPlaceInSheet(workbook, targetSheetId) === null) return null;
    if (targetSheetId === sheetId) return 'entrysOwn';
    return allowsAnother && !isFormulaAskedOrProposed(state) && interactiveOfSheet(workbook, targetSheetId) === null ? 'another' : null;
  };
  return {
    before: targetAt(-1),
    after: targetAt(1),
  };
}
export function switchSheetWhileEditing(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  sheetId: SheetId,
  caret: CaretInEntryPlaced | undefined,
  allowsAnother: boolean,
): PageState | null {
  let { mode, placesLeft, sheetPointedIn } = state;
  let isBackToEntrySheet = sheetId === state.sheetId && sheetPointedIn !== null;
  let mayPoint = allowsAnother && !isFormulaAskedOrProposed(state) && interactiveOfSheet(workbook, sheetId) === null;
  if (!canSwitchSheetWhileEditing(mode, caret, isBackToEntrySheet, mayPoint)) return null;
  if (sheetId === (sheetPointedIn ?? state.sheetId)) return state;
  if (isBackToEntrySheet) return withSheetPointedIn(state, workbook, null);
  let placeLeft = placesLeft.find((placeKept) => placeKept.sheetId === sheetId);
  let place = placeLeft !== undefined && selectedArea(placeLeft, workbook) !== null ? placeLeft : firstPlaceInSheet(workbook, sheetId);
  if (place === null) return null;
  return {
    ...withSheetPointedIn(scrollToShowActiveCell(state, workbook), workbook, sheetId),
    placesLeft:
      placeLeft === undefined ? [place, ...placesLeft] : placesLeft.map((placeKept) => (placeKept === placeLeft ? place : placeKept)),
  };
}
export function switchToNextSheetWhileEditing(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  offset: KeyStep,
  caret: CaretInEntryPlaced | undefined,
): PageState {
  let sheetId = sheetIdAtOffset(state.sheetPointedIn ?? state.sheetId, workbook, offset);
  return sheetId === undefined ? state : (switchSheetWhileEditing(state, workbook, sheetId, caret, true) ?? state);
}
export function pressCellsInSheetPointedIn(
  state: PageState,
  shown: PageState,
  workbook: ReadsWithTextMeasurer,
  pointer: GridPoint,
): PageTransition {
  let selection = selectionAtPointer(shown, workbook, pointer);
  if (selection === null) return withNoEffects(state);
  let selected = 'activeCell' in selection ? selection : selectionAtCell(selection);
  let ended = endEntryOnPointerPress(state, workbook, null);
  let { lastDone } = ended.state;
  let discardNotice = lastDone?.what === 'formulaOfAgentDiscarded' ? lastDone : null;
  if (ended.state.mode.kind !== 'editing')
    return withNoEffects({
      ...showSheet(ended.state, workbook, shown.sheetId),
      ...selected,
      lastDone: discardNotice,
    });
  let ifQueued: Partial<IfQueued> = {
    ...('activeCell' in selection
      ? pointerSelectRequest(selection)
      : {
          select: selected,
          foundBy: 'pointer',
        }),
    thenSheet: shown.sheetId,
  };
  let effects = ended.effects.map((effect) => withIfQueued(effect, ifQueued));
  return {
    state: ended.state,
    effects,
  };
}
/** The step of an event on the grid while a sheet other than the entry's is pointed in; `null` for an event it leaves alone. */
export function stepInSheetPointedIn(
  state: PageState,
  event: PageEvent,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition | null {
  if (state.sheetPointedIn === null) return null;
  let shown = showSheetPointedIn(state, reads);
  if (event.kind === 'pointerPressed') {
    let pointedOrScrollTop = refusalOfEveryEdit === null && !isFormulaAskedOrProposed(state) ? pointAtCell(shown, event, reads) : null;
    return pointedOrScrollTop === null
      ? pressCellsInSheetPointedIn(state, shown, reads, event)
      : withNoEffects(restoreEntrySheet(state, shown, pointedOrScrollTop));
  }
  if (event.kind === 'pointerDragged') {
    if (state.dragging?.kind !== 'pointing') return withNoEffects(state);
    return withNoEffects(restoreEntrySheet(state, shown, dragPointedReference(shown, event, reads)));
  }
  if (event.kind === 'wheelTurned') {
    let scrollLeft = shown.scrollLeft + event.deltaX;
    let pointedOrScrollTop = shown.scrollTop + event.deltaY;
    let pagesTurnedForReader = shown.pagesTurnedForReader + (event.isPageForReader === true ? 1 : 0);
    let clamped = clampScrollOfView(
      {
        ...shown,
        scrollLeft,
        scrollTop: pointedOrScrollTop,
        pagesTurnedForReader,
      },
      reads,
    );
    let isUnmoved = clamped.scrollLeft === shown.scrollLeft && clamped.scrollTop === shown.scrollTop;
    return withNoEffects(restoreEntrySheet(state, shown, isUnmoved ? shown : clamped));
  }
  if (event.kind === 'menuAsked' && event.at !== null) return pressCellsInSheetPointedIn(state, shown, reads, event.at);
  return event.kind === 'pointerPressedTwice' ? withNoEffects(state) : null;
}
export function dropSheetPointedInWhenDone(state: PageState, workbook: WorkbookReads): PageState {
  let { sheetPointedIn, mode } = state;
  if (sheetPointedIn === null) return state;
  if (sheetPointedIn === state.sheetId)
    return {
      ...state,
      sheetPointedIn: null,
    };
  if (!(mode.kind === 'editing' && isFormulaText(mode.text)) || firstPlaceInSheet(workbook, sheetPointedIn) === null)
    return carryFormulaOfAgentDiscarded(state, withSheetPointedIn(state, workbook, null));
  return state.calendar === null
    ? state
    : {
        ...state,
        calendar: null,
      };
}
export const withSheetPointedIn = (state: PageState, workbook: WorkbookReads, sheetId: SheetId | null): PageState => ({
  ...state,
  sheetPointedIn: sheetId,
  dragging: null,
  lastDone: sheetShownLastDone(state, workbook, sheetId),
});
