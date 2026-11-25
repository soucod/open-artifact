import type { SheetId } from '@open-artifact/sheets-core';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ErrorsOffered, PageState } from './initial-state.ts';
import type { PageContext, PageEvent, RowsAskedForActedOn } from './event-reducer.ts';
import type { DropdownEditorAct } from '../chips/dropdown-editor.ts';
import type { EditOutcome } from '../store/workbook-sync.ts';
import type { PageEffect, PageTransition } from './transitions.ts';
import { readsWithFormatsToCome, withTellOthersWhomViewFollows, stepViewFollowing } from '../presence/follow-person.ts';
import { updateCommentModePicksCells, shutCommentBoxLeftBehind, shutCommentLeftBehind, doesCommentModePick } from '../comments/comment-state.ts';
import { withFormulasLeftToWorkOut, withNoEffects, isMenuHoldingSizeField } from './transitions.ts';
import { checkAgentWhenOfferGone, areFixesWaiting, updateFixesOnCellsAfterEvent } from '../formulas/fix/fixes-on-cells.ts';
import { checkAgentWhenFixCellGone, updateReasonsForErrors, noteEntryError } from './reasons-for-errors.ts';
import { updateFixesToOffer } from '../formulas/fix/cells-to-fix.ts';
import { trackCommentsWithAgent, trackLeftByCaret } from './focus-return.ts';
import { updateEntryEndedUnasked, canEntryBeAnsweredLater } from '../editor/entries-answered-later.ts';
import {
  seeOwnRowOrderChanges,
  ownFilterByKey,
  isOwnFilterUnused,
  isOwnFilterKeyUnused,
  ownFilterKeyNotDrawnYet,
  isOwnFilterDrawn,
  ownSortToUndo,
} from '../tables/own-filters.ts';
import {
  tableKeyOfFilterBarTurnedOn,
  isOwnFilterHeldForTry,
  settlePlaceAfterRowsTry,
  dropUnneededAgentRowsHold,
  shouldEndRowsAsk,
  actOnRowsAsk,
} from '../tables/rows-asked-for.ts';
import { pressMessageWithPoint, startTapping, hasTapLeftCell, pressOfDrag, rememberLastPresses } from '../selection/pointer.ts';
import { isHoldInForce, answerHoldOf, holdOneMoreAct } from '../format/answer-holds.ts';
import {
  handleUnderPress,
  pressToMoveCellsOutOfTable,
  cancelMovingCells,
  holdMoveAtRowNumbers,
  dropMoveWait,
  dragToWaitedRowOnRelease,
  withoutMoveReplacedOffer,
} from '../selection/move-cells.ts';
import { scrollToStuckHeaderOnPress } from '../grid/sticky-headers.ts';
import { markDriftFromTableHandle } from '../tables/table-handle-menu.ts';
import { withReadySetsAsked } from '../chips/dropdowns.ts';
import { updateImportMarks } from '../import/marks-of-import.ts';
import { updateSelectionJustImported } from '../import/bring-in.ts';
import { dropStaleMovedClearOfColumns, revealActiveCellAfterMove } from '../grid/outline-groups.ts';
import { dropStaleRangeWalked } from '../selection/walk-range.ts';
import { dropCaretAtEndOfOtherSheet } from '../grid/lines-at-end.ts';
import { keepTabRun } from '../selection/tab-run.ts';
import { noteRowAddedAfterEntry, givesNewRowsFormulas } from '../edits/insert-lines.ts';
import { noteStepsAndAnswerAwaited, isRedoGivingNewRowsFormulas, cellsOfColumnsWentToAfter } from './notes-of-steps.ts';
import { pivotTypingToEnter, pivotTableOfSidePane, settlePivotTablePane } from '../tables/pivot-tables.ts';
import { takeSavedNamedView } from '../tables/named-view-actions.ts';
import { stepCellsLinkedTo } from '../agent/shown-by-agent.ts';
import { closeFindWithReplaceInPane } from '../ui/find-in-pane.ts';
import { stepWaysIn } from './ways-in.ts';
import { contextBarMenuAfterEvent, isPointerOrMenuEvent, dropDragIfRowsOutOfViewChanged } from './context-bar.ts';
import { stepOffersAtSelection } from './offers-at-selection.ts';
import { stepsToUndoAfter } from '../history/undo-steps.ts';
import { stepsToRedoAfterEvent } from '../history/steps-together.ts';
import { updateExplainedUnderCell } from './explained-under-cell.ts';
import { followContextBarRulesCard, settleConditionalFormatsPane } from '../format/conditional/pane-reducer.ts';
import { isSameSelection, moveActiveCellTo, isSelectionUnchangedAcross } from '../selection/model.ts';
import { closeListCustomFormat, rereadCustomPattern, withStopAskingEffect } from '../format/custom-number-format.ts';
import { refreshShownUnderPattern, withNumberFormatExamples } from '../format/number-format-choices.ts';
import { clearOwnFilters, declareCellTableOfNewFilter, reapplyOwnFiltersAfterAnswer } from '../tables/own-filter-actions.ts';
import { unhideFilteredRowsOfSelection, unhideRowsUnderActiveCell } from '../tables/filtered-rows.ts';
import { withoutOtherRanges, keepOtherRangesFitting } from '../selection/several-ranges.ts';
import { isOwnFilterTrialLeftOpen, closeOwnFilterListOnEvent } from '../tables/own-filter-list.ts';
import {
  endAwaitInsertOfRows,
  awaitInsertOfRows,
  areErrorsAtOpeningDue,
  updateErrorsOffered,
  readErrorsAtOpening,
  resetBaselineOfOffer,
  updateErrorsAtOpening,
} from '../formulas/fix/errors-offer.ts';
import { hasUnsavedDropdownTyping } from '../chips/dropdown-pane-edits.ts';
import { hasLeftDropdownPane, reconcileDropdownState } from '../chips/dropdown-sync.ts';
import { dropdownEditorOfPane, versionHistoryOfPane } from './queries.ts';
import { withIfQueued } from '../model/edit-effects.ts';
import { keepsAgentsFormula } from '../editor/commit-entry.ts';
import { optionIdOfMenuKey } from '../chips/dropdown-options.ts';
import { updateFiguresOfSelection } from './figures-of-selection.ts';
import { withXlsxFileToldWhenFree } from '../export/xlsx-saved-notice.ts';
import { withoutEntryOfPressedCell } from '../chips/list-on-press.ts';
import { reduceSheetsEvent } from './event-reducer.ts';
import { cellWithListOfEntry, unansweredEntryOf } from '../editor/unanswered-entries.ts';
import { triesToEdit, refuseEditsOfTransition, refuseEditsInCommentMode, isEffectAnEdit } from './edit-refusals.ts';
import { endVersionLook, endLookEffects, dropStaleTakingBack } from '../history/version-history.ts';
import { withFormatsOfRowsAbove } from './formats-to-come.ts';
import { guardEditsAgainstRowsOutOfView } from '../edits/rows-out-of-view.ts';
import { addFilterValuesToInserts } from '../tables/insert-filter-values.ts';
import { keepCalendarInStep } from '../chips/calendar.ts';
import { followEntryCellText } from '../editor/start-entry.ts';
import { settleSelectionSeen, noteSelectionLeftByPerson } from './selection-seen.ts';
import { settleActiveCellOnMerges } from '../selection/merged-cells.ts';
import { settleFind } from '../ui/find.ts';
import { dropUndoOfTurnOnEdit, dropDoneCardOnEvent, stopSayingWorkingWhenCursorGone } from '../agent/turn-of-agent.ts';
import { keepWordsOffered } from '../editor/words-offered.ts';
import { syncWorkbookSettingPick } from '../ui/locale-time-zone-pick.ts';
import { dropStalePasteThatWaits } from '../clipboard/paste-that-waits.ts';
import { dropStaleLinkForm } from '../links/link-form.ts';
import { withListNumbersOfEntry } from '../editor/entry-looks.ts';
import { syncReferencesInEntry, dropPointedReference } from '../formulas/reference-pointing.ts';
import { dropSheetPointedInWhenDone } from '../formulas/sheet-pointed-in.ts';
import { withSelectionToldToAgent } from '../agent/view-context.ts';
import { withOwnSelectionTold } from '../presence/selections.ts';
import { peopleListEffects, settlePeopleList } from '../chips/people-list.ts';
import { dropFillDragUnlessNavigating } from '../selection/fill-handle.ts';
import { reconcilePlacementSelection, placementById } from '../charts/placed-views.ts';
import { refreshFormulaHelp } from '../formulas/autocomplete.ts';
import { keepTimeListInStep } from '../editor/time-list.ts';
import { updateCopiedCells } from './copied-cells.ts';
import { stepFormulaFromWords } from '../formulas/from-words/offer.ts';
import { settleAskOwedToAgent } from '../agent/ask-owed-to-agent.ts';
import { settleSortPane } from '../tables/sort-pane.ts';
import { askForCellHistory } from '../history/cell-history.ts';
import { offerUndoIfEditChangedResults } from '../tables/sort-changed-results.ts';
import { noteFormulasLostToLastAct } from '../formulas/lost-formulas.ts';
import { startCalculatingShown, endCalculatingShown } from './calculating-shown.ts';
import { longCalculationOnCalculating, longCalculationOnCalculated } from './long-calculation.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
export function reduceSheetsPage(state: PageState, event: PageEvent, context: PageContext): PageTransition {
  let reads = readsWithFormatsToCome(context.reads, state);
  context = {
    ...context,
    reads,
  };
  let stateIn = updateCommentModePicksCells(state, context);
  let transition = shutCommentBoxLeftBehind(
    stateIn,
    shutCommentLeftBehind(stateIn, reduceEventWithFollowUps(stateIn, event, context), context.reads),
    context.reads,
  );
  if (
    context.areFormulasLeft &&
    transition.effects.some(({ kind }: PageEffect) => kind === 'putOnClipboard' || kind === 'workOutFormulasLeft')
  )
    return withFormulasLeftToWorkOut(stateIn, event);
  let stateAfter = updateCommentModePicksCells(transition.state, context);
  let resultWithComments = checkAgentWhenOfferGone(
    stateIn,
    checkAgentWhenFixCellGone(stateIn, {
      ...transition,
      state: updateFixesToOffer(updateReasonsForErrors(stateAfter, context.reads, context.areFormulasLeft), context.reads),
    }),
  );
  let stateTracked = trackCommentsWithAgent(stateIn, resultWithComments.state, event, context.reads);
  let resultEnded = {
    ...resultWithComments,
    state: updateEntryEndedUnasked(stateIn, stateTracked, event),
  };
  return seeOwnRowOrderChanges(stateIn, resultEnded, event, context.reads);
}
export function reduceEventWithFollowUps(state: PageState, event: PageEvent, context: PageContext): PageTransition {
  let isActOnShutFilterList = event.kind === 'ownFilterListActedIn' && state.ownFilterList === null;
  if (state.rowsAskedFor !== null && OWN_FILTER_EVENT_KINDS.has(event.kind) && !isActOnShutFilterList) {
    let giveUpEvent =
      event.kind === 'ownFilterListAsked' && event.tableKey === tableKeyOfFilterBarTurnedOn(state)
        ? GIVE_UP_ROWS_ASKED_FOR_KEEPING_FILTER
        : GIVE_UP_ROWS_ASKED_FOR;
    let givenUp = reduceEventWithFollowUps(state, giveUpEvent, context);
    if ((event.kind === 'ownFilterLineRemoved' && isOwnFilterHeldForTry(state, event.tableKey)) || givenUp.state.rowsAskedFor !== null) return givenUp;
    let eventResult = reduceEventWithFollowUps(givenUp.state, event, context);
    let filterKeptOnForColumnsCard =
      giveUpEvent === GIVE_UP_ROWS_ASKED_FOR_KEEPING_FILTER && eventResult.state.ownFilterList !== null
        ? tableKeyOfFilterBarTurnedOn(state)
        : eventResult.state.filterKeptOnForColumnsCard;
    let { ownFilterList } = eventResult.state;
    let isFilterNotDrawnYet = filterKeptOnForColumnsCard !== null && state.rowsAskedFor.isFilterNotDrawnYet;
    let { isTableGuessed, tableUnderLetters, table } = state.rowsAskedFor;
    let isListOfGuessedTable = isTableGuessed && ownFilterList?.tableKey === table?.key;
    let sort = isListOfGuessedTable && tableUnderLetters === null ? null : (ownFilterList?.sort ?? null);
    let nextOwnFilterList =
      ownFilterList === null
        ? null
        : {
            ...ownFilterList,
            isFilterNotDrawnYet: isFilterNotDrawnYet || ownFilterList.isFilterNotDrawnYet,
            isTableGuessed: isListOfGuessedTable,
            sort,
          };
    return {
      state: {
        ...eventResult.state,
        filterKeptOnForColumnsCard,
        ownFilterList: nextOwnFilterList,
      },
      effects: [...givenUp.effects, ...eventResult.effects],
    };
  }
  let pressOnMessage = pressMessageWithPoint(event);
  if (pressOnMessage !== null && isHoldInForce(answerHoldOf(state, 'rowsAskedFor'), pressOnMessage))
    return withNoEffects({
      ...holdOneMoreAct(state, 'rowsAskedFor', pressOnMessage),
      dragging: null,
    });
  let tapStarted = startTapping(state, event, context);
  if (tapStarted !== null) return withNoEffects(tapStarted);
  let isPressOnHandle = event.kind === 'pointerPressed' && handleUnderPress(state, event, context) !== undefined;
  let isPressOnColumnGrip = event.kind === 'pointerPressed' && event.onGripOfColumn !== undefined;
  let stateIn = isPressOnHandle || isPressOnColumnGrip ? state : scrollToStuckHeaderOnPress(event, state, context);
  let stateUndragged = {
    ...stateIn,
    dragging: null,
  };
  let isFingerWheel = event.kind === 'wheelTurned' && event.isByFinger === true;
  if (stateIn.dragging?.kind === 'tapping' && isFingerWheel)
    return reduceEventWithFollowUps(
      {
        ...stateUndragged,
        menu: null,
      },
      event,
      context,
    );
  let isPointerLost = event.kind === 'pointerReleased' && event.isPointerLost === true;
  let isEditTextNew = event.kind === 'editTextChanged' && !(stateIn.mode.kind === 'editing' && stateIn.mode.text === event.text);
  let endsTap = isPointerLost || event.kind === 'keyPressed' || isEditTextNew || hasTapLeftCell(stateIn, context.reads);
  let endsFillTap = stateIn.dragging?.kind === 'filling' && stateIn.dragging.tap !== null && isPointerLost;
  if ((stateIn.dragging?.kind === 'tapping' && endsTap) || endsFillTap) return reduceEventWithFollowUps(stateUndragged, event, context);
  let moveOutOfTable = pressToMoveCellsOutOfTable(stateIn, event, context.reads);
  if (moveOutOfTable !== null) {
    let stateBeforeMove =
      stateIn.dragging?.kind === 'movingCells' ? cancelMovingCells(stateIn, stateIn.dragging, context.reads) : stateUndragged;
    let moveResult = reduceEventWithFollowUps(stateBeforeMove, moveOutOfTable, context);
    let eventResult = reduceEventWithFollowUps(moveResult.state, event, context);
    return {
      ...eventResult,
      effects: [...moveResult.effects, ...eventResult.effects],
    };
  }
  let heldAtRowNumbers = holdMoveAtRowNumbers(stateIn, event);
  if (heldAtRowNumbers !== null && event.kind === 'pointerDragged') return withNoEffects(markDriftFromTableHandle(heldAtRowNumbers, event));
  let stateWithoutMoveWait = dropMoveWait(stateIn);
  if (stateWithoutMoveWait !== stateIn && event.kind === 'pointerDragged') return reduceEventWithFollowUps(stateWithoutMoveWait, event, context);
  let dragToWaitedRow = dragToWaitedRowOnRelease(stateIn, event);
  if (dragToWaitedRow !== null) {
    let dragResult = reduceEventWithFollowUps(stateWithoutMoveWait, dragToWaitedRow, context);
    let eventResult = reduceEventWithFollowUps(dragResult.state, event, context);
    return {
      ...eventResult,
      effects: [...dragResult.effects, ...eventResult.effects],
    };
  }
  let latePress = pressOfDrag(stateIn.dragging);
  let isLatePressDue = event.kind === 'pointerReleased' || (event.kind === 'linkCardAsked' && (event.link ?? null) !== null);
  if (latePress !== null && isLatePressDue) {
    let latePressResult = reduceEventWithFollowUps(
      stateUndragged,
      {
        ...latePress,
        isToldOfLate: true,
      },
      context,
    );
    let afterLatePress = reduceEventWithFollowUps(latePressResult.state, event, context);
    return {
      ...afterLatePress,
      effects: [...latePressResult.effects, ...afterLatePress.effects],
    };
  }
  let reduced = withReadySetsAsked(reduceCommittingDropdownEditor(stateIn, event, context));
  let stateAfterFollowUps = updateImportMarks(
    updateSelectionJustImported(
      stateIn,
      dropStaleMovedClearOfColumns(
        dropStaleRangeWalked(dropCaretAtEndOfOtherSheet(stateIn, keepTabRun(stateIn, reduced.state, event)), context.reads),
        context.reads,
      ),
      event,
    ),
    event,
    context.reads,
  );
  let stateAfterPresses = noteRowAddedAfterEntry(
    noteStepsAndAnswerAwaited(rememberLastPresses(stateAfterFollowUps, stateIn, event, context.reads), event, reduced.effects),
    event,
    context.reads,
  );
  let withWaysIn = {
    ...reduced,
    state: closeFindWithReplaceInPane(stepWaysIn(stateIn, stateAfterPresses, context.reads, event, context.refusalOfEveryEdit === 'editingPaused')),
  };
  let contextBarMenu = contextBarMenuAfterEvent(stateIn, withWaysIn.state, event, context.reads);
  let offersAtSelection = stepOffersAtSelection(stateIn, withWaysIn.state, event, context.reads);
  let stepsToUndo = stepsToUndoAfter(stateIn.stepsToUndo, event);
  let stepsToRedo = stepsToRedoAfterEvent(stateIn.stepsToRedo, event);
  let areStepsUnchanged = stepsToUndo === stateIn.stepsToUndo && stepsToRedo === stateIn.stepsToRedo;
  let isSameSheetAsBefore = areStepsUnchanged && withWaysIn.state.sheetId === stateIn.sheetId;
  let formatAsTableChosenLast = isSameSheetAsBefore ? withWaysIn.state.formatAsTableChosenLast : null;
  let ownSortChosenLast = isSameSheetAsBefore ? ownSortToUndo(withWaysIn.state) : null;
  let chartBeingMade =
    (withWaysIn.state.sheetPointedIn ?? withWaysIn.state.sheetId) === (stateIn.sheetPointedIn ?? stateIn.sheetId)
      ? withWaysIn.state.chartBeingMade
      : null;
  let withErrorsRead = withErrorsOfferedRead(
    updateExplainedUnderCell(
      stateIn,
      contextBarMenu === withWaysIn.state.contextBarMenu &&
        chartBeingMade === withWaysIn.state.chartBeingMade &&
        offersAtSelection === withWaysIn.state.offersAtSelection &&
        formatAsTableChosenLast === withWaysIn.state.formatAsTableChosenLast &&
        ownSortChosenLast === withWaysIn.state.ownSortChosenLast &&
        areStepsUnchanged
        ? withWaysIn.state
        : {
            ...withWaysIn.state,
            contextBarMenu,
            offersAtSelection,
            stepsToUndo,
            stepsToRedo,
            formatAsTableChosenLast,
            ownSortChosenLast,
            chartBeingMade,
          },
      context.reads,
      event.kind === 'fixInPlaceAsked' && event.cardOf !== null
        ? 'mouse'
        : event.kind === 'pointerPressed' || (event.kind === 'menuAsked' && event.at !== null && event.inContextBar === undefined)
          ? event.isByMouse === true
            ? 'mouse'
            : 'fingerOrPen'
          : null,
    ),
    context,
  );
  let withErrorsOffered = trackInsertOfRowsForErrorsOffered(withErrorsRead, event, withWaysIn.effects, context.areFormulasLeft);
  let withRulesCard = followContextBarRulesCard(
    stateIn,
    withErrorsOffered === withWaysIn.state
      ? withWaysIn
      : {
          ...withWaysIn,
          state: withErrorsOffered,
        },
    context,
  );
  let { state: stateAfter } = withRulesCard;
  let isDragWithoutDragging = (event.kind === 'pointerDragged' || event.kind === 'pointerReleased') && stateIn.dragging === null;
  let isSelectionMovedByEvent =
    (isPointerOrMenuEvent(event) && !isDragWithoutDragging) ||
    (event.kind === 'keyPressed' && (!isSameSelection(stateIn, stateAfter) || stateIn.mode !== stateAfter.mode));
  let withOwnFilters = closeListCustomFormat(
    stateIn,
    settleOwnFilterOnceDrawn(
      stateIn,
      dropFilterKeptOnForColumnsCard(
        giveUpOwnFilterTryWhenDue(
          giveUpRowsAskedForWhenDue(
            {
              ...withRulesCard,
              state: settlePlaceAfterRowsTry(stateIn, stateAfter, isSelectionMovedByEvent),
            },
            event,
            context,
          ),
          event,
          context,
        ),
        context,
      ),
      context,
    ),
    event,
  );
  let withPatternsShown = {
    ...withOwnFilters,
    state: dropUnneededAgentRowsHold(refreshShownUnderPattern(stateIn, withOwnFilters.state, context.reads)),
  };
  let thenEvent = event.kind === 'editAnswered' ? event.ifQueued.thenEvent : undefined;
  let isThenEventDropped =
    event.kind === 'editAnswered' && event.ifQueued.isThenEventDroppedIfRefused === true && event.outcome.kind === 'refused';
  if (thenEvent === undefined || isThenEventDropped || hasQueueEditEffect(withPatternsShown)) return withPatternsShown;
  let thenResult = reduceEventWithFollowUps(withPatternsShown.state, thenEvent, context);
  let releaseResult =
    thenEvent.kind === 'pointerPressed' && thenEvent.isToldOfLate === true
      ? reduceEventWithFollowUps(
          thenResult.state,
          {
            kind: 'pointerReleased',
          },
          context,
        )
      : withNoEffects(thenResult.state);
  return {
    ...releaseResult,
    effects: [...withPatternsShown.effects, ...thenResult.effects, ...releaseResult.effects],
  };
}
export function withFilterKeptOnForColumnsCard(stateBefore: PageState, state: PageState): PageState {
  let tableKey = state.ownFilterList?.tableKey;
  if (tableKey === undefined) return state;
  let hasFilterOn = ({ ownFilterTried, ...withoutFilterTried }: PageState) => {
    let heldFilter = ownFilterTried?.before.held;
    let ownFilter = heldFilter?.key === tableKey ? heldFilter : ownFilterByKey(withoutFilterTried, tableKey);
    return ownFilter !== null && !isOwnFilterUnused(ownFilter);
  };
  return hasFilterOn(stateBefore) && !hasFilterOn(state)
    ? {
        ...state,
        filterKeptOnForColumnsCard: tableKey,
      }
    : state;
}
export function settleListFilterOnceUsed(state: PageState): PageState {
  let { ownFilterList, ownFilterTried } = state;
  if (ownFilterList === null || !ownFilterList.isFilterNotDrawnYet || ownFilterTried !== null) return state;
  let ownFilter = ownFilterByKey(state, ownFilterList.tableKey);
  return ownFilter === null || isOwnFilterUnused(ownFilter)
    ? state
    : {
        ...state,
        ownFilterList: {
          ...ownFilterList,
          isFilterNotDrawnYet: false,
        },
      };
}
export function dropFilterKeptOnForColumnsCard(transition: PageTransition, { reads }: PageContext): PageTransition {
  let tableKey = transition.state.filterKeptOnForColumnsCard;
  if (tableKey === null || transition.state.ownFilterList !== null) return transition;
  let state = {
    ...transition.state,
    filterKeptOnForColumnsCard: null,
  };
  let isFilterGone = isOwnFilterKeyUnused(state, tableKey);
  return {
    ...transition,
    state: isFilterGone
      ? clearOwnFilters(state, reads, {
          tableKey,
        })
      : state,
  };
}
export function settleOwnFilterOnceDrawn(
  stateBefore: PageState,
  transition: PageTransition,
  { reads, refusalOfEveryEdit }: PageContext,
): PageTransition {
  let { state } = transition;
  let tableKey = ownFilterKeyNotDrawnYet(stateBefore);
  let ownFilter = tableKey === null ? null : ownFilterByKey(state, tableKey);
  if (ownFilter === null || isOwnFilterUnused(ownFilter) || !isOwnFilterDrawn(state, ownFilter)) return transition;
  let declared = declareCellTableOfNewFilter(
    clearOwnFilters(state, reads, {
      tableKey: ownFilter.key,
    }),
    state,
    reads,
    refusalOfEveryEdit === null && !doesCommentModePick(stateBefore),
  );
  return {
    state: declared.state,
    effects: [...transition.effects, ...declared.effects],
  };
}
export function giveUpRowsAskedForWhenDue(transition: PageTransition, event: PageEvent, context: PageContext): PageTransition {
  if (!shouldEndRowsAsk(transition.state)) return transition;
  let { reads, refusalOfEveryEdit } = context;
  if (event.kind === 'rowsAskedForActedOn' && event.act.kind === 'giveUp') {
    let { state, effects } = actOnRowsAsk(transition.state, reads, event.act, refusalOfEveryEdit === null);
    return {
      state,
      effects: [...transition.effects, ...effects],
    };
  }
  let givenUp = reduceEventWithFollowUps(transition.state, GIVE_UP_ROWS_ASKED_FOR, context);
  return {
    ...givenUp,
    effects: [...transition.effects, ...givenUp.effects],
  };
}
export function hideExplanationUnderPointer(state: PageState): PageState {
  let { pointedAt, hiddenUnderPointer } = state.explainedUnderCell;
  return {
    ...state,
    explainedUnderCell: {
      ...state.explainedUnderCell,
      pointedAt: null,
      hiddenUnderPointer: pointedAt?.cellId ?? hiddenUnderPointer,
    },
  };
}
export function selectErrorsAtOpening(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  if (state.errorsAtOpening === null || state.mode.kind === 'editing') return state;
  return unhideFilteredRowsOfSelection(
    {
      ...withoutOtherRanges(moveActiveCellTo(state, reads, state.errorsAtOpening.first, 'pointer')),
      selectionCorner: state.errorsAtOpening.last,
    },
    reads,
  );
}
export function giveUpOwnFilterTryWhenDue(transition: PageTransition, event: PageEvent, context: PageContext): PageTransition {
  if (!isOwnFilterTrialLeftOpen(transition.state)) return transition;
  if (event.kind === 'ownFilterListActedIn' && event.act.kind === 'giveUp')
    return {
      ...transition,
      state: {
        ...transition.state,
        ownFilterTried: null,
      },
    };
  let givenUp = reduceEventWithFollowUps(
    transition.state,
    {
      kind: 'ownFilterListActedIn',
      act: {
        kind: 'giveUp',
      },
    },
    context,
  );
  return {
    ...givenUp,
    effects: [...transition.effects, ...givenUp.effects],
  };
}
export function trackInsertOfRowsForErrorsOffered(state: PageState, event: PageEvent, effects: PageEffect[], areFormulasLeft: boolean): PageState {
  let { errorsOffered } = state;
  if (errorsOffered === null) return state;
  let endsAwaitOfInsert =
    effects.some(({ kind }) => kind === 'queueEdit' || kind === 'undoOrRedo' || kind === 'queueEditsThatTakeBack') ||
    (!areFormulasLeft &&
      ((event.kind === 'editAnswered' && givesNewRowsFormulas(event.edit)) ||
        event.kind === 'undoOrRedoAnswered' ||
        event.kind === 'formulasLeftChanged'));
  let startsAwaitOfInsert =
    !areFormulasLeft &&
    effects.some(
      (effect) =>
        effect.kind === 'queueEdit'
          ? givesNewRowsFormulas(effect.edit)
          : effect.kind === 'undoOrRedo' && effect.direction === 'redo' && isRedoGivingNewRowsFormulas(state),
    );
  if (!endsAwaitOfInsert && !startsAwaitOfInsert) return state;
  let afterEnd = endsAwaitOfInsert ? endAwaitInsertOfRows(errorsOffered) : errorsOffered;
  let nextErrorsOffered = startsAwaitOfInsert ? awaitInsertOfRows(afterEnd) : afterEnd;
  return nextErrorsOffered === errorsOffered
    ? state
    : {
        ...state,
        errorsOffered: nextErrorsOffered,
      };
}
export function withErrorsOfferedRead(
  state: PageState,
  { reads, areFormulasLeft, refusalOfEveryEdit }: PageContext,
): PageState {
  let { errorsOffered, errorsReadAsOf, sheetId, workbookChangeCount } = state;
  let { formulasWorkedOutCount } = state;
  let isReadUpToDate =
    errorsReadAsOf?.sheetId === sheetId &&
    errorsReadAsOf.workbookChangeCount === workbookChangeCount &&
    errorsReadAsOf.formulasWorkedOutCount === formulasWorkedOutCount;
  let areErrorsAtOpeningToBeRead = areErrorsAtOpeningDue(state);
  if ((isReadUpToDate && !areErrorsAtOpeningToBeRead) || refusalOfEveryEdit !== null) return state;
  if ((errorsOffered?.sheetId !== sheetId || areErrorsAtOpeningToBeRead) && (areFormulasLeft || reads.calculationTookTooLong)) return state;
  let hasWorkbookChanged = errorsReadAsOf?.workbookChangeCount !== workbookChangeCount;
  let nextErrorsOffered = updateErrorsOffered(errorsOffered, reads, sheetId, hasWorkbookChanged, areFixesWaiting(state));
  let { offerDueBackOn } = state.fixesOnCells;
  let isOfferDueBack = offerDueBackOn.includes(sheetId);
  return {
    ...readErrorsAtOpening(state, reads),
    errorsReadAsOf: {
      sheetId,
      workbookChangeCount,
      formulasWorkedOutCount,
    },
    errorsOffered: isOfferDueBack ? updateErrorsOffered(resetBaselineOfOffer(nextErrorsOffered), reads, sheetId, false) : nextErrorsOffered,
    ...(isOfferDueBack && {
      fixesOnCells: {
        ...state.fixesOnCells,
        offerDueBackOn: offerDueBackOn.filter((dueSheetId: SheetId) => dueSheetId !== sheetId),
      },
    }),
  };
}
export function reduceCommittingDropdownEditor(state: PageState, event: PageEvent, context: PageContext): PageTransition {
  let transition = reduceEventWithTidying(state, event, context);
  if (
    event.kind === 'dropdownEditorActedIn' ||
    event.kind === 'pivotTablePaneActedIn' ||
    event.kind === 'workbookChanged' ||
    event.kind === 'formulasWorkedOut' ||
    event.kind === 'editAnswered' ||
    event.kind === 'undoOrRedoAnswered' ||
    event.kind === 'editOfChartAsked'
  )
    return transition;
  let pivotTyping = pivotTypingToEnter(state);
  if (pivotTyping !== null) {
    if (!hasQueueEditEffect(transition) && (pivotTableOfSidePane(transition.state)?.typed ?? null) !== null) return transition;
    let entered = reduceEventWithTidying(state, pivotTyping, context);
    let [firstEffect] = entered.effects;
    return firstEffect?.kind === 'queueEdit'
      ? {
          state: entered.state,
          effects: [
            withIfQueued(firstEffect, {
              thenEvent: event,
            }),
          ],
        }
      : transition;
  }
  if (!hasUnsavedDropdownTyping(state)) return transition;
  if (!hasQueueEditEffect(transition) && !hasLeftDropdownPane(state, transition.state)) return transition;
  let actInDropdownEditor = (act: DropdownEditorAct, isBeforeKeep: boolean = false) =>
    reduceEventWithTidying(
      state,
      {
        kind: 'dropdownEditorActedIn',
        act,
        ...(isBeforeKeep && {
          isBeforeKeep,
        }),
      },
      context,
    );
  if (dropdownEditorOfPane(state)?.cellsTyped !== undefined) {
    let enteredCells = actInDropdownEditor({
      kind: 'enterCells',
      isBeforeOtherEvent: true,
    });
    let [firstEffect] = enteredCells.effects;
    if (firstEffect?.kind === 'queueEdit')
      return {
        state: enteredCells.state,
        effects: [
          withIfQueued(firstEffect, {
            thenEvent: event,
          }),
        ],
      };
    let cellsRefused = dropdownEditorOfPane(enteredCells.state)?.cellsRefused;
    let resultAfterCells = reduceEventWithTidying(enteredCells.state, event, context);
    return cellsRefused === undefined || dropdownEditorOfPane(resultAfterCells.state)?.cellsRefused !== undefined
      ? resultAfterCells
      : {
          ...resultAfterCells,
          state: {
            ...resultAfterCells.state,
            notice: {
              kind: 'dropdownCellsRefused',
              refused: cellsRefused,
            },
          },
        };
  }
  let entered = actInDropdownEditor(
    {
      kind: 'enter',
      thenStartsOption: false,
    },
    keepsAgentsFormula(transition),
  );
  if (entered.effects.length === 0) return transition;
  let [firstEffectOfEnter] = entered.effects;
  if (
    ((event.kind === 'cardRowChosen' && optionIdOfMenuKey(state.dropdown?.card?.ofRow ?? null) !== null) ||
      event.kind === 'optionsNamedInList' ||
      event.kind === 'optionMovedInList') &&
    firstEffectOfEnter?.kind === 'queueEdit'
  )
    return {
      state: entered.state,
      effects: [
        withIfQueued(firstEffectOfEnter, {
          thenEvent: event,
          isThenEventDroppedIfRefused: true,
        }),
      ],
    };
  let resultAfterEnter = reduceEventWithTidying(entered.state, event, context);
  return {
    state: resultAfterEnter.state,
    effects: [...entered.effects, ...resultAfterEnter.effects],
  };
}
export function reduceEventWithTidying(state: PageState, event: PageEvent, context: PageContext): PageTransition {
  let transition = reduceEventWithDerivedState(state, event, context);
  let withChanges = withTellOthersWhomViewFollows(state, transition, event);
  let isFiguresDue = event.kind === 'figuresOfSelectionDue';
  return {
    ...withChanges,
    state: updateFiguresOfSelection(state, withXlsxFileToldWhenFree(withChanges.state), context.reads, isFiguresDue),
  };
}
export function answerEntriesEndedAtOnce(transition: PageTransition, context: PageContext): PageTransition {
  return transition.effects.reduce(
    (acc: PageTransition, effect) => {
      let withEffect = (addedEffect: PageEffect): PageTransition => ({
        state: acc.state,
        effects: [...acc.effects, addedEffect],
      });
      if (effect.kind !== 'queueEdit' || effect.ifQueued.endsEntryAtOnce !== true) return withEffect(withoutEntryOfPressedCell(effect));
      let { edit, ifQueued } = effect;
      let { endsEntryAtOnce, ...ifQueuedRest } = ifQueued;
      if (edit.kind !== 'enter' || !canEntryBeAnsweredLater(acc.state, context, effect))
        return withEffect(
          withoutEntryOfPressedCell({
            ...effect,
            ifQueued: ifQueuedRest,
          }),
        );
      let outcome: EditOutcome = {
        kind: 'editQueued',
        placeChanged: null,
      };
      let answered = reduceSheetsEvent(
        acc.state,
        {
          kind: 'editAnswered',
          edit,
          outcome,
          ifQueued: ifQueuedRest,
        },
        context,
      );
      let { formatsToCome } = ifQueuedRest;
      let cellWithList = cellWithListOfEntry(edit, context.reads);
      let entryUnanswered = {
        ...unansweredEntryOf(edit),
        ...(cellWithList !== null && {
          cellWithList,
        }),
        ...(formatsToCome !== undefined && {
          formatsToCome,
        }),
      };
      return {
        state: {
          ...answered.state,
          entriesUnanswered: [...answered.state.entriesUnanswered, entryUnanswered],
        },
        effects: [...acc.effects, effect, ...answered.effects],
      };
    },
    {
      state: transition.state,
      effects: [],
    },
  );
}
export function endVersionLookWhenEditsLost(stateBefore: PageState, transition: PageTransition): PageTransition {
  let isLookNotShownYet = versionHistoryOfPane(stateBefore)?.look?.shown === null;
  let { notice, newsOfLoss } = transition.state;
  let isLossNew =
    (notice !== stateBefore.notice && notice?.kind === 'entriesNotKept') || (newsOfLoss !== stateBefore.newsOfLoss && newsOfLoss !== null);
  return isLookNotShownYet && (isLossNew || triesToEdit(stateBefore, transition))
    ? {
        ...transition,
        state: endVersionLook(transition.state),
      }
    : transition;
}
export function reduceEventWithDerivedState(state: PageState, event: PageEvent, context: PageContext): PageTransition {
  let { reads, refusalOfEveryEdit } = context;
  let reduced = answerEntriesEndedAtOnce(withFormatsOfRowsAbove(reduceSheetsEvent(state, event, context), state, reads), context);
  let withAnswerTracked =
    event.kind === 'editAnswered' && !hasQueuedEntryBeforeLine(reduced)
      ? {
          ...reduced,
          state: noteEntryError(reduced.state, context, event),
        }
      : reduced;
  let withFiltersReapplied = {
    ...withAnswerTracked,
    state: takeSavedNamedView(reapplyOwnFiltersAfterAnswer(withAnswerTracked.state, reads, event, cellsOfColumnsWentToAfter(state, event)), reads, event),
  };
  let guarded =
    refusalOfEveryEdit === null
      ? endVersionLookWhenEditsLost(
          state,
          guardEditsAgainstRowsOutOfView(state, addFilterValuesToInserts(withFiltersReapplied, reads), reads, event.kind === 'editAnswered'),
        )
      : refuseEditsOfTransition(state, withFiltersReapplied, refusalOfEveryEdit);
  let { state: nextState, effects } =
    refusalOfEveryEdit === null && doesCommentModePick(state) ? refuseEditsInCommentMode(state, guarded, event) : guarded;
  let effectsAfterLook = endLookEffects(state, nextState, effects, event);
  let stateWithoutMovedOffer = withoutMoveReplacedOffer(state, nextState, event);
  let countedState = effectsAfterLook.some(isEffectAnEdit)
    ? {
        ...stateWithoutMovedOffer,
        changesAskedFor: stateWithoutMovedOffer.changesAskedFor + 1,
      }
    : stateWithoutMovedOffer;
  let settledState = rereadCustomPattern(
    state,
    reconcileDropdownState(
      state,
      keepCalendarInStep(
        state,
        followEntryCellText(
          state,
          settleSelectionSeen(
            state,
            keepOtherRangesFitting(
              state,
              revealActiveCellAfterMove(
                state,
                unhideRowsUnderActiveCell(
                  state,
                  settleActiveCellOnMerges(
                    settleFind(
                      state,
                      dropStaleTakingBack(
                        dropUndoOfTurnOnEdit(
                          state,
                          dropDoneCardOnEvent(
                            stopSayingWorkingWhenCursorGone(
                              stepCellsLinkedTo(
                                state,
                                {
                                  state: stepViewFollowing(
                                    state,
                                    {
                                      state: countedState,
                                      effects: effectsAfterLook,
                                    },
                                    event,
                                    context,
                                  ),
                                  effects: effectsAfterLook,
                                },
                                event,
                                reads,
                              ),
                              context,
                            ),
                            event,
                          ),
                          event,
                          effectsAfterLook,
                          context,
                        ),
                      ),
                      reads,
                      refusalOfEveryEdit === null,
                    ),
                    reads,
                  ),
                  reads,
                ),
                reads,
              ),
              event,
              reads,
            ),
            reads,
          ),
          reads,
        ),
        reads,
      ),
      reads,
    ),
    reads,
  );
  let stateWithFormats = keepWordsOffered(
    state,
    withNumberFormatExamples(syncWorkbookSettingPick(dropStalePasteThatWaits(state, dropStaleLinkForm(settledState, reads)), reads), reads),
    reads,
    event.kind === 'editTextChanged' && event.typingIn === 'cell',
  );
  let stateWithReferences = withListNumbersOfEntry(
    state,
    syncReferencesInEntry(state, dropSheetPointedInWhenDone(dropPointedReference(stateWithFormats), reads), reads),
    reads,
  );
  let stateWithoutStaleDrag = dropDragIfRowsOutOfViewChanged(state, stateWithReferences, reads);
  let resultWithSelectionTold = settleConditionalFormatsPane(
    state,
    withSelectionToldToAgent(
      state,
      withOwnSelectionTold(
        peopleListEffects(
          state,
          {
            state: trackLeftByCaret(
              state,
              dropFillDragUnlessNavigating(
                state,
                reconcilePlacementSelection(
                  state,
                  refreshFormulaHelp(
                    state,
                    keepTimeListInStep(
                      state,
                      settlePeopleList(state, updateCopiedCells(stateWithoutStaleDrag, effectsAfterLook, event, reads), reads),
                      reads,
                    ),
                    refusalOfEveryEdit !== null,
                    reads,
                  ),
                  event,
                  reads,
                ),
              ),
              event,
            ),
            effects: effectsAfterLook,
          },
          reads,
        ),
        reads,
      ),
      context,
    ),
    context,
  );
  let resultWithAsks = updateFixesOnCellsAfterEvent(
    withStopAskingEffect(
      state,
      stepFormulaFromWords(state, settleAskOwedToAgent(resultWithSelectionTold, context, event), reads, refusalOfEveryEdit !== null),
    ),
    reads,
    refusalOfEveryEdit !== null,
    event,
  );
  let finalState = noteSelectionLeftByPerson(
    state,
    updateErrorsAtOpening(state, settleSelectionSeen(settledState, settlePivotTablePane(settleSortPane(resultWithAsks.state, reads), reads, event, context.areFormulasLeft), reads), event),
    event,
  );
  let finalResult = askForCellHistory(
    {
      ...resultWithAsks,
      state: offerUndoIfEditChangedResults(noteFormulasLostToLastAct(closeOwnFilterListOnEvent(finalState, event), event, reads), event, context),
    },
    reads,
  );
  if (finalState.menu === null || finalState.menu !== state.menu) return finalResult;
  let isMenuStillFitting =
    event.kind !== 'workbookChanged' ||
    isMenuHoldingSizeField(finalState.menu) ||
    (finalState.menu.ofChart !== undefined && placementById(finalState, reads, finalState.menu.ofChart.placementId) !== null) ||
    ((finalState.menu.holds === 'all' || finalState.menu.holds === 'noEdits') &&
      finalState.textToEditOfEntryCell === state.textToEditOfEntryCell &&
      isSelectionUnchangedAcross(state, event.readsBefore, reads));
  return finalState.mode === state.mode && isMenuStillFitting && isSameSelection(state, finalState)
    ? finalResult
    : {
        ...finalResult,
        state: {
          ...finalResult.state,
          menu: null,
        },
      };
}
export function updateCalculatingShown(state: PageState, reads: WorkbookReads): PageState {
  let isCalculatingShown = state.isActShownAsCalculated || state.areFormulasShownAsLeft;
  return {
    ...state,
    ...(isCalculatingShown &&
      !state.isActShownAsCalculated && {
        ownViewShownAsApplied: null,
      }),
    calculatingShown: (isCalculatingShown ? startCalculatingShown : endCalculatingShown)(state.calculatingShown),
    longCalculationTold: isCalculatingShown
      ? longCalculationOnCalculating(state.longCalculationTold)
      : longCalculationOnCalculated(state.longCalculationTold, reads.calculationTookTooLong),
  };
}
export const GIVE_UP_ROWS_ASKED_FOR: RowsAskedForActedOn = {
  kind: 'rowsAskedForActedOn',
  act: {
    kind: 'giveUp',
  },
};
export const GIVE_UP_ROWS_ASKED_FOR_KEEPING_FILTER: RowsAskedForActedOn = {
  kind: 'rowsAskedForActedOn',
  act: {
    kind: 'giveUp',
    leavesFilterOn: true,
  },
};
export const OWN_FILTER_EVENT_KINDS = new Set<PageEvent['kind']>([
  'ownFilterAsked',
  'ownFilterByCellChosen',
  'ownFilterLineRemoved',
  'ownSortRemoved',
  'ownSortMadeForEveryone',
  'namedViewPicked',
  'namedViewsChanged',
  'ownFiltersCleared',
  'ownFiltersRefreshed',
  'ownFilterListAsked',
  'ownFilterListActedIn',
  'ownFilterListSortChosen',
  'ownFiltersBroughtBack',
]);
export const withErrorsOfferedFromStart = (state: PageState, reads: WorkbookReads, errorsOffered: ErrorsOffered): PageState => ({
  ...state,
  errorsOffered: updateErrorsOffered(
    {
      ...errorsOffered,
      baseline: 0,
    },
    reads,
    state.sheetId,
    false,
  ),
});
export const hasQueuedEntryBeforeLine = ({ effects }: PageTransition): boolean =>
  effects.some((effect) => effect.kind === 'queueEdit' && effect.ifQueued.entryBeforeLine !== undefined);
export const hasQueueEditEffect = ({ effects }: PageTransition): boolean =>
  effects.some((effect) => effect.kind === 'queueEdit');
