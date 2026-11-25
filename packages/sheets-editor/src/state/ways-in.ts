import type { PageState } from './initial-state.ts';
import type { AgentActivityChanged, PageEvent } from './event-reducer.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import { isNothingOpen } from './edit-refusals.ts';
import { isSidePaneShownAsPane } from './queries.ts';
export function waysInAsPageSettles(state: PageState): WaysIn {
  if (state.pageWidth === 0) return 'awaitWidthOfPage';
  if (state.isChatBeside === true) return 'areHeldBackByChat';
  if (state.isChatBeside === null) return 'areToComeAtOnce';
  if (!isPageWideEnoughForWaysIn(state)) return 'awaitWidthOfPage';
  return state.isChatBehindButton ? 'areUp' : 'areToCome';
}
export function pendingWaysIn(state: PageState): WaysIn {
  if (state.pageWidth === 0) return 'awaitWidthOfPage';
  if (state.isChatBeside !== false) return 'areHeldBackByChat';
  return isPageWideEnoughForWaysIn(state) ? 'areToCome' : 'awaitWidthOfPage';
}
export function stepWaysIn(stateBefore: PageState, state: PageState, reads: WorkbookReads, event: PageEvent, isEditingPaused: boolean): PageState {
  let { waysIn } = state;
  let nextWaysIn = ((): WaysIn => {
    if (waysIn === 'areNotToCome' || state.isAgentWorking) return 'areNotToCome';
    let isEscapeWhileNavigating =
      !isEditingPaused && event.kind === 'keyPressed' && event.key === 'Escape' && stateBefore.mode.kind === 'navigating';
    let isSentAway = event.kind === 'waysInSentAway' || isEscapeWhileNavigating;
    if (waysIn === 'areUp' && isSentAway && !state.areWaysInOutOfSight) return 'areNotToCome';
    if (waysIn === 'areUp' && isWaysInCoveredByPane(state)) return pendingWaysIn(state);
    if (waysIn === 'areToCome' && isEscapeWhileNavigating && !isWaysInCoveredByPane(stateBefore)) return 'areNotToCome';
    if (isWorkbookNoLongerBlank(reads)) return 'madeWayForWork';
    let isUndoMade = event.kind === 'undoOrRedoAnswered' && event.direction === 'undo' && event.outcome.kind === 'made';
    if (waysIn === 'madeWayForWork' && !isUndoMade) return waysIn;
    let isAgentWordAtOpening = event.kind === 'agentActivityChanged' && event.isAsSpreadsheetOpens === true;
    if (waysIn === 'awaitWordOfAgent' && !isAgentWordAtOpening) return waysIn;
    let hasShellAnswered = waysIn === 'awaitWordOfAgent' && isAgentWordAtOpening && (event as AgentActivityChanged).hasShellAnswered === true;
    let isLayoutChangeDue = waysIn === 'areToComeAtOnce' && isLayoutChangeForWaysIn(event);
    if ((hasShellAnswered || isLayoutChangeDue) && isPageAtRestForWaysIn(state)) return waysInAsPageSettles(state);
    let pending = pendingWaysIn(state);
    if (pending !== 'areToCome') return pending;
    if (waysIn === 'areUp') return state.mode.kind === 'editing' ? pending : waysIn;
    let isWaitedFor = waysIn === 'areToCome' && event.kind === 'waysInWaitedFor';
    if (waysIn !== 'madeWayForWork' && !isWaitedFor) return pending;
    return isPageAtRestForWaysIn(state) ? 'areUp' : waysIn;
  })();
  return nextWaysIn === waysIn
    ? state
    : {
        ...state,
        waysIn: nextWaysIn,
      };
}
export const WAYS_IN_MIN_PAGE_WIDTH = 904;
export const waysInAtOpening = (reads: Pick<WorkbookReads, 'isEveryCellBlank'>, canImportFiles: boolean): WaysIn =>
  reads.isEveryCellBlank && canImportFiles ? 'awaitWordOfAgent' : 'areNotToCome';
export const isPageWideEnoughForWaysIn = (state: Pick<PageState, 'pageWidth'>): boolean => state.pageWidth >= WAYS_IN_MIN_PAGE_WIDTH;
export const isWorkbookNoLongerBlank = (reads: Pick<WorkbookReads, 'isEveryCellBlank'>): boolean => !reads.isEveryCellBlank;
export const isPageAtRestForWaysIn = (state: PageState): boolean =>
  state.mode.kind === 'navigating' && state.entriesUnanswered.length === 0 && state.dragging === null && state.find === null && isNothingOpen(state);
export const isWaitForWaysInPutOff = (state: PageState): boolean => state.waysIn === 'areToCome' && !isPageAtRestForWaysIn(state);
export const areWaysInToComeSoon = (state: PageState): boolean =>
  state.isChatBeside !== true &&
  (state.pageWidth === 0 || isPageWideEnoughForWaysIn(state)) &&
  !isSidePaneShownAsPane(state) &&
  state.find === null &&
  (state.waysIn === 'awaitWordOfAgent' ||
    state.waysIn === 'areToComeAtOnce' ||
    state.waysIn === 'awaitWidthOfPage' ||
    state.waysIn === 'areToCome' ||
    state.waysIn === 'areHeldBackByChat');
export const isLayoutChangeForWaysIn = ({ kind }: PageEvent): boolean =>
  kind === 'gridResized' || kind === 'waysInOutOfSightChanged';
export const isWaysInCoveredByPane = (state: PageState): boolean => isSidePaneShownAsPane(state) || state.find?.isReplaceShown === true;
export type WaysIn =
  | 'awaitWordOfAgent'
  | 'areNotToCome'
  | 'awaitWidthOfPage'
  | 'areHeldBackByChat'
  | 'areToComeAtOnce'
  | 'areUp'
  | 'areToCome'
  | 'madeWayForWork';
