import type { ErrorExplained, PageState, ReasonsForErrors } from './initial-state.ts';
import type { EditAnswered, PageContext } from './event-reducer.ts';
import type { PageTransition } from './transitions.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import { cellExplained, keepIfSameJson } from './explained-under-cell.ts';
import { explainCellError, cellKeyOf } from '../formulas/error-tells.ts';
import { activeAnchorCell, isSameCell, areaOfPosition } from '../selection/model.ts';
import { fixableErrorAt } from '../formulas/fix/ask.ts';
import { isSelectionOneCell } from '../selection/keyboard.ts';
import { checkAgentForFormulas } from '../formulas/from-words/offer.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { unansweredEntryOf } from '../editor/unanswered-entries.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
export function updateReasonsForErrors(state: PageState, reads: ReadsWithTextMeasurer, doCausesWaitForCalculation: boolean): PageState {
  let reasonsForErrors = state.reasonsForErrors;
  let explained = cellExplained(state, reads);
  let ofEntryCell = keepIfSameJson(explainCellError(reads, activeAnchorCell(state, reads)), reasonsForErrors.ofEntryCell);
  let ofCellExplained = keepIfSameJson(explained === null ? null : explainCellError(reads, explained.cellId), reasonsForErrors.ofCellExplained);
  let fixAtExplained = explained === null ? null : fixableErrorAt(state, reads, explained.cellId);
  let isFixInPlaceYetToBeKnown = fixAtExplained === 'yetToBeKnown';
  let cellToFixInPlace = explained === null || fixAtExplained === null || isFixInPlaceYetToBeKnown ? null : cellKeyOf(explained.cellId);
  let isOneCellSelected = state.otherRanges.length === 0 && isSelectionOneCell(state, reads);
  let anchorCell = activeAnchorCell(state, reads);
  let fixAtEntryCell =
    ofEntryCell === null || !isOneCellSelected
      ? null
      : explained !== null && isSameCell(explained.cellId, anchorCell)
        ? fixAtExplained
        : fixableErrorAt(state, reads, anchorCell);
  let isEntryCellToFixInPlace = state.fixesOnCells.stage === null && fixAtEntryCell !== null && fixAtEntryCell !== 'yetToBeKnown';
  let isFixAtEntryCellYetToBeKnown = state.fixesOnCells.stage === null && fixAtEntryCell === 'yetToBeKnown';
  let nextReasons: ReasonsForErrors = {
    ofEntryCell,
    ofCellExplained,
    cellToFixInPlace,
    isFixInPlaceYetToBeKnown,
    isEntryCellToFixInPlace,
    isFixAtEntryCellYetToBeKnown,
    doCausesWaitForCalculation,
  };
  return ofEntryCell === reasonsForErrors.ofEntryCell &&
    ofCellExplained === reasonsForErrors.ofCellExplained &&
    cellToFixInPlace === reasonsForErrors.cellToFixInPlace &&
    isFixInPlaceYetToBeKnown === reasonsForErrors.isFixInPlaceYetToBeKnown &&
    isEntryCellToFixInPlace === reasonsForErrors.isEntryCellToFixInPlace &&
    isFixAtEntryCellYetToBeKnown === reasonsForErrors.isFixAtEntryCellYetToBeKnown &&
    doCausesWaitForCalculation === reasonsForErrors.doCausesWaitForCalculation
    ? state
    : {
        ...state,
        reasonsForErrors: nextReasons,
      };
}
export function canOfferFixAtEntryCell({
  reasonsForErrors: { isEntryCellToFixInPlace, isFixAtEntryCellYetToBeKnown },
  formulaFromWords: { agent: agentOnWords, hasAgentBeenMissed },
}: Pick<PageState, 'reasonsForErrors' | 'formulaFromWords'>): boolean {
  let isEntryCellFine = (agentOnWords === 'checking' || agentOnWords === 'unchecked') && !hasAgentBeenMissed;
  return isFixAtEntryCellYetToBeKnown ? isEntryCellFine || agentOnWords === 'available' : isEntryCellToFixInPlace && isEntryCellFine;
}
export function checkAgentWhenFixCellGone(state: PageState, transition: PageTransition): PageTransition {
  let wasToBeRead = state.errorsFoundAtOpening === 'toBeRead' && transition.state.errorsFoundAtOpening !== 'toBeRead';
  let isToBeRead = state.errorsReadAsOf === null && transition.state.errorsReadAsOf !== null;
  if (wasToBeRead || isToBeRead) return checkAgentForFormulas(transition);
  let [reasonsAfter, reasonsBefore] = [transition.state.reasonsForErrors, state.reasonsForErrors];
  let isNewCellToFix = reasonsAfter.cellToFixInPlace !== null && reasonsAfter.cellToFixInPlace !== reasonsBefore.cellToFixInPlace;
  let isEntryCellNewlyToFix =
    reasonsAfter.isEntryCellToFixInPlace && (!reasonsBefore.isEntryCellToFixInPlace || !isSameCell(transition.state.activeCell, state.activeCell));
  return isNewCellToFix || isEntryCellNewlyToFix ? checkAgentForFormulas(transition) : transition;
}
export function entryCameToError(
  { sheetId, entriesUnanswered }: Pick<PageState, 'sheetId' | 'entriesUnanswered'>,
  reads: WorkbookReads,
  cellId: CellId,
): EntryCameToError | null {
  let isUnanswered = entriesUnanswered.some((entry) => isSameCell(entry.cellId, cellId));
  let reason = cellId.sheetId === sheetId && !isUnanswered ? explainCellError(reads, cellId) : null;
  let position = reads.positionOfCell(cellId);
  return reason === null || reason.code === '#TIMEOUT!' || position === null
    ? null
    : {
        what: 'entryCameToError',
        cellId,
        cell: areaToA1AsStored(areaOfPosition(position), ownRowOrderOfSheet(reads, cellId.sheetId)),
        reason,
      };
}
export function refreshEntryError(state: PageState, reads: WorkbookReads, lastDone: EntryCameToError): PageState {
  let checked = keepIfSameJson(entryCameToError(state, reads, lastDone.cellId), lastDone);
  return checked === lastDone
    ? state
    : {
        ...state,
        lastDone: checked,
      };
}
export function noteEntryError(
  state: PageState,
  { reads, areFormulasLeft }: Pick<PageContext, 'reads' | 'areFormulasLeft'>,
  { edit, outcome, ifQueued }: Pick<EditAnswered, 'edit' | 'outcome' | 'ifQueued'>,
): PageState {
  let lastDone = state.lastDone?.what === 'entryCameToError' ? state.lastDone : null;
  if (areFormulasLeft)
    return lastDone === null
      ? state
      : {
          ...state,
          lastDone: null,
        };
  let { entryBeforeLine = edit } = ifQueued;
  let errorOfEntry =
    entryBeforeLine.kind === 'enter' &&
    (entryBeforeLine !== edit || outcome.kind === 'editQueued' || outcome.kind === 'nothingToChange') &&
    ifQueued.isSaveOfOpenEntry !== true
      ? entryCameToError(state, reads, unansweredEntryOf(entryBeforeLine).cellId)
      : null;
  if (errorOfEntry !== null)
    return {
      ...state,
      lastDone: errorOfEntry,
    };
  return lastDone === null ? state : refreshEntryError(state, reads, lastDone);
}
export function refreshEntryErrorOnRead(state: PageState, reads: WorkbookReads, cellIdRead: CellId | null): PageState {
  let lastDone = state.lastDone?.what === 'entryCameToError' ? state.lastDone : null;
  if (lastDone === null) return state;
  return (cellIdRead === null ? lastDone.reason.isTellOnItsWay === true : isSameCell(cellIdRead, lastDone.cellId))
    ? refreshEntryError(state, reads, lastDone)
    : state;
}
export const isFixInPlacePending = ({
  reasonsForErrors: { cellToFixInPlace, isFixInPlaceYetToBeKnown },
  formulaFromWords: { agent: agentOnWords },
}: Pick<PageState, 'reasonsForErrors' | 'formulaFromWords'>): boolean => isFixInPlaceYetToBeKnown || (cellToFixInPlace !== null && agentOnWords === 'checking');
/** What was done last when an entry came to an error: the cell, its address as stored, and why it errs. */
export interface EntryCameToError {
  what: 'entryCameToError';
  cellId: CellId;
  cell: string;
  reason: ErrorExplained;
}
