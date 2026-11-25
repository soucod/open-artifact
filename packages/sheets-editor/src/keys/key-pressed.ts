import { toggleCheckboxesByKey } from '../chips/checkbox-presses.ts';
import { checkboxLinesOfCell, toggleCellCheckboxLine, pressListKeyInEntry } from '../editor/entry-looks.ts';
import {
  doesKeyStepBackIntoCells,
  stepBackIntoCells,
  commentToShutOnEscape,
  hasNoticeToDismiss,
  isSidePaneShuttable,
  hasNoticeOrUndoOffer,
  isTurnUndoOfferFrontmost,
  escapeInCellsDoes,
} from '../state/escape.ts';
import {
  takeOfferLitAlone,
  waitForFormula,
  moveOfferLight,
  chooseOfferRow,
  entryWithOfferRowFormula,
  waveFormulaOfferOff,
  stopAskingForFormula,
  goBackToWords,
} from '../formulas/from-words/actions.ts';
import {
  doesTabAcceptWordsOffered,
  wordsOfferedNow,
  acceptWordsOffered,
  refreshWordsOffered,
  matchingWordsOffered,
} from '../editor/words-offered.ts';
import { withNoEffects, withFormulasLeftToWorkOut, clearPassingNotice, NAVIGATING_MODE, isMenuHoldingField } from '../state/transitions.ts';
import {
  isPeopleCellEditedWithoutList,
  peopleChipsOfListCell,
  refreshPeopleList,
  moveInPeopleList,
  peopleListRows,
  indexOfPeopleListRowGoneTo,
  shouldWaitForPeopleOnEnter,
  stepOffUnderAgent,
  isEnterHeldInPeopleList,
  isAskAgentRowBusy,
  peopleListRowKey,
  takePeopleListRow,
  chipGoneToInPeopleCell,
  removePersonFromCell,
  stepAmongPeopleChips,
  withPeopleChipGoneTo,
  caretInEntryOutsideChips,
  isEntryAmongPeople,
} from '../chips/people-list.ts';
import { withDropWhatIsHeld, ARROW_KEY_MOVES, entryAtCaretOf, caretInEntryOf, LINE_EDITS_OF_COMMAND, keyActOf } from './key-acts.ts';
import { walkWithinSelection, withRangeWalked } from '../selection/walk-range.ts';
import { scrollThroughTallCell, scrollToTallCellStart } from '../grid/tall-cells.ts';
import { nextTabRun, cellBelowTabRunStart } from '../selection/tab-run.ts';
import { withLineAddedAfterEntry } from '../editor/add-line-at-end.ts';
import { cellAfterKeyMove, extendSelectionByKey, selectAllCells, selectWholeLines } from '../selection/keyboard.ts';
import { isCheckboxFormat } from '../chips/checkboxes.ts';
import { activeAnchorCell, moveActiveCellTo, isSameCell, scrollToShowActiveCell, selectedArea, selectionKindOf } from '../selection/model.ts';
import { isColumnPick, moveFunctionListHighlight, pickFunctionListRow, shutFunctionList } from '../formulas/autocomplete.ts';
import { isEntryWorkPending } from '../editor/unanswered-entries.ts';
import { withoutOtherRanges, refuseWhenSeveralRanges, oneRangeActOfCommand } from '../selection/several-ranges.ts';
import { jumpOrExtendSelection } from '../selection/jumps.ts';
import { selectTableOrAll } from '../selection/table-select.ts';
import {
  dropdownAtActiveCell,
  openDropdownList,
  dropdownListRows,
  highlightDropdownRow,
  pickDropdownRow,
  closeDropdownList,
  openCardOfHighlighted,
  closeSidePane,
} from '../chips/dropdowns.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import {
  letArrowsActOnCells,
  startEntryEditing,
  clearSelectedCells,
  doesEntryTakeLineBreaks,
  isSelectionMoreThanActiveCell,
  textToEditAt,
} from '../editor/start-entry.ts';
import { stepListIndex } from '../ui/list-cards.ts';
import { menuItemKey } from '../chips/dropdown-options.ts';
import {
  commitEntryAndMove,
  leaveEntryEditing,
  stopAskingForFix,
  commitProposedFix,
  toggleEntryCheckboxAndSave,
  typedTextNotice,
  commitEntryToSelection,
} from '../editor/commit-entry.ts';
import { moveInListCard, takeListCardRow, shutListCard, goIntoListCard, popupOverEntry } from '../state/list-cards.ts';
import { moveInTimeList } from '../editor/time-list.ts';
import { clearCellsOrDropdown } from '../selection/cells-seen.ts';
import { withCalendarShut, enterTodayInCell, withCalendarOpen } from '../chips/calendar.ts';
import { fillDownOrRight, withoutFillDrag } from '../selection/fill-handle.ts';
import { insertAutoSum } from '../formulas/auto-sum.ts';
import { undoOrRedo } from '../history/steps-together.ts';
import { applyFormatCommand } from '../format/format-commands.ts';
import { isEntryExpanded, expandEntry, collapseEntry } from '../editor/expanded-entry.ts';
import { actOnSheetPointedIn, switchToNextSheetWhileEditing, sheetsToPointInFor } from '../formulas/sheet-pointed-in.ts';
import { movePointedReference, toggleArrowsTarget } from '../formulas/reference-pointing.ts';
import { withEntryText } from '../editor/text-looks.ts';
import { openContextMenu } from '../ui/menu.ts';
import { layoutOfView } from '../grid/layout.ts';
import { deleteSelectedRows, deleteSelectedLines } from '../edits/rows-out-of-view.ts';
import { insertRowsOrColumns } from '../edits/insert-lines.ts';
import { actOnOutlineGroups, outlineAxisForAct } from '../grid/outline-groups.ts';
import { addSheetAfter, showSheetAtOffset } from '../state/sheet-tabs.ts';
import { filterButtonAtActiveCell, reduceOwnFilterList, openOwnFilterList } from '../tables/own-filter-list.ts';
import { ownFilterKeyNotDrawnYet } from '../tables/own-filters.ts';
import { openRowsAsk } from '../tables/rows-asked-for.ts';
import { outlineOfFilterNotDrawnYet } from '../tables/table-outlines.ts';
import { toggleFormulasShown } from '../grid/formulas-shown.ts';
import { conditionalRulesOfPane } from '../state/queries.ts';
import { closeFind } from '../ui/find.ts';
import { letGoOfCopiedCells } from '../state/copied-cells.ts';
import { isAgentOfferPendingOrAsked } from '../format/conditional/pane-state.ts';
import { actInConditionalFormats } from '../format/conditional/pane-reducer.ts';
import { hideExplainedCard } from '../state/explained-under-cell.ts';
import { canEditLinkAtActiveCell } from '../links/link-form.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { KeyPressed, PageContext, WordsOfferedPressed } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CellId } from '../model/workbook.ts';
import type { KeyMove } from '../selection/keyboard.ts';
import type { KeyAct } from './key-acts.ts';
export function pressSpaceInCell(state: PageState, reads: ReadsWithTextMeasurer): PageTransition | null {
  let toggled = toggleCheckboxesByKey(state, 'space', reads);
  if (toggled !== null) return toggled;
  let [firstLine, ...otherLines] = checkboxLinesOfCell(state, reads);
  if (firstLine === undefined) return null;
  return otherLines.length === 0 ? toggleCellCheckboxLine(state, reads, firstLine) : startEntryAtActiveCell(state, reads);
}
export function stepKeyPressed(state: PageState, keyEvent: KeyPressed, context: PageContext, isFromWordsOffer = false): PageTransition {
  let { reads } = context;
  let stateBackInCells = state.isSteppedOutOfCells && doesKeyStepBackIntoCells(keyEvent.key) ? stepBackIntoCells(state) : state;
  let stateInCells = keyEvent.key === 'Enter' && !keyEvent.isAltHeld ? takeOfferLitAlone(stateBackInCells, reads) : stateBackInCells;
  let wordsAccepted: string | null =
    isFromWordsOffer || doesTabAcceptWordsOffered(stateInCells, keyEvent) ? (wordsOfferedNow(stateInCells)?.offered ?? null) : null;
  let stateAfterWords = wordsAccepted === null ? stateInCells : acceptWordsOffered(stateInCells);
  const act = keyActInState(stateAfterWords, keyEvent, context);
  if (act === null) return withNoEffects(stateAfterWords);
  if (keyEvent.hasWaitedForPeople === true && isPeopleCellEditedWithoutList(stateAfterWords, reads)) return withDropWhatIsHeld(stateAfterWords);
  let isRepeatableAct =
    act.kind === 'move' ||
    act.kind === 'extendSelection' ||
    act.kind === 'pointAtCells' ||
    (act.kind === 'jump' && (act.to.kind === 'page' || act.to.kind === 'edgeOfData')) ||
    act.kind === 'moveInDropdownList' ||
    act.kind === 'moveInPeopleList' ||
    act.kind === 'stepInField' ||
    act.kind === 'moveInCard' ||
    act.kind === 'moveInTimeList' ||
    act.kind === 'moveInFunctionList' ||
    (act.kind === 'actOnLists' && act.key === 'backspace');
  if (keyEvent.isRepeat && !isRepeatableAct) return withNoEffects(act.kind === 'waitForFormula' ? waitForFormula(stateAfterWords) : stateAfterWords);
  const isTabOrEnterMove =
    (keyEvent.key === 'Tab' || keyEvent.key === 'Enter') && 'columnDelta' in act && (act.rowDelta !== 0 || act.columnDelta !== 0);
  let walkWithin = isTabOrEnterMove ? walkWithinSelection(stateAfterWords, reads, act) : null;
  let pagedState =
    act.kind === 'jump' && act.to.kind === 'page' && !act.isExtending ? scrollThroughTallCell(stateAfterWords, reads, act.to.by) : null;
  if (pagedState !== null) return withNoEffects(pagedState);
  let dropsRangeWalked =
    act.kind === 'move' || act.kind === 'extendSelection' || act.kind === 'jump' || act.kind === 'selectAll' || act.kind === 'selectWhole';
  let stateForAct =
    dropsRangeWalked && walkWithin === null
      ? {
          ...stateAfterWords,
          rangeWalked: null,
        }
      : stateAfterWords;
  let stepped = stepKeyAct(stateForAct, keyEvent, act, context, walkWithin?.at ?? null, wordsAccepted);
  if (stepped.effects.some(({ kind }) => kind === 'waitForPeople')) return stepped;
  let walkedStep = walkWithin === null ? null : withRangeWalked(walkWithin, stepped);
  if (walkedStep !== null) return walkedStep;
  let moveAct = 'columnDelta' in act ? act : null;
  let isArrowCommit = act.kind === 'commitEdit' && ARROW_KEY_MOVES[keyEvent.key] !== undefined;
  let tabRun = nextTabRun(stateAfterWords, keyEvent.key, moveAct, dropsRangeWalked || isArrowCommit, reads);
  let transition = isTabOrEnterMove && walkWithin === null ? withLineAddedAfterEntry(stepped, stateAfterWords, context, act) : stepped;
  return tabRun === transition.state.tabRun
    ? transition
    : {
        ...transition,
        state: {
          ...transition.state,
          tabRun,
        },
      };
}
export function stepKeyAct(
  state: PageState,
  keyEvent: KeyPressed,
  act: KeyAct,
  context: PageContext,
  walkedTo: CellId | null,
  offeredWords: string | null,
): PageTransition {
  let { reads } = context;
  let targetOfMove = (move: KeyMove): CellId =>
    walkedTo ?? (keyEvent.key === 'Enter' && move.rowDelta === 1 ? cellBelowTabRunStart(state, reads) : null) ?? cellAfterKeyMove(state, reads, move);
  if (
    (act.kind === 'sumUp' ||
      (act.kind === 'enterToday' && isCheckboxFormat(reads.formatOf(activeAnchorCell(state, reads)))) ||
      (act.kind === 'jump' && act.to.kind === 'edgeOfData') ||
      (act.kind === 'pointAtCells' && act.isToEdgeOfData) ||
      (act.kind === 'takeFunctionListRow' && isColumnPick(state, null))) &&
    isEntryWorkPending(state, context)
  )
    return withFormulasLeftToWorkOut(state, keyEvent);
  switch (act.kind) {
    case 'move':
      return withNoEffects(moveActiveCellTo(walkedTo === null ? withoutOtherRanges(state) : state, reads, targetOfMove(act)));
    case 'extendSelection':
      return withNoEffects(extendSelectionByKey(state, reads, act));
    case 'jump': {
      let jumped = jumpOrExtendSelection(act.isExtending ? state : withoutOtherRanges(state), reads, act.to, act.isExtending);
      let atTallCellStart = act.to.kind === 'page' && !act.isExtending ? scrollToTallCellStart(state, reads) : state;
      if (atTallCellStart === state) return withNoEffects(jumped);
      if (isSameCell(jumped.activeCell, state.activeCell))
        return withNoEffects({
          ...jumped,
          scrollTop: state.scrollTop,
        });
      return withNoEffects(jumpOrExtendSelection(withoutOtherRanges(atTallCellStart), reads, act.to, false));
    }
    case 'selectAll':
      return withNoEffects(selectAllCells(withoutOtherRanges(state), reads));
    case 'selectTableOrAll':
      return withNoEffects(selectTableOrAll(state, reads));
    case 'selectWhole':
      return withNoEffects(selectWholeLines(withoutOtherRanges(state), reads, act.what));
    case 'openCell': {
      let checkboxesToggled = toggleCheckboxesByKey(state, 'enter', reads);
      if (checkboxesToggled !== null) return checkboxesToggled;
      if (dropdownAtActiveCell(state, reads) !== null) return withNoEffects(openDropdownList(scrollToShowActiveCell(state, reads), reads));
      return startEntryAtActiveCell(state, reads);
    }
    case 'startEditing': {
      let spacePressed = act.text === ' ' ? pressSpaceInCell(state, reads) : null;
      if (spacePressed !== null) return spacePressed;
      if (act.text === null) return startEntryAtActiveCell(state, reads);
      if (isFormulaText(act.text) && peopleChipsOfListCell(state, reads) !== null) return withNoEffects(state);
      return withNoEffects(
        refreshWordsOffered(refreshPeopleList(letArrowsActOnCells(startEntryEditing(state, reads, act.text, 'cell'), reads), reads), reads, {
          text: act.text,
          isOpenToOffer: true,
        }),
      );
    }
    case 'moveInPeopleList':
      return withNoEffects(
        moveInPeopleList(state, reads, (index: number | null, count: number) => stepListIndex(index, act.by, count), act.by === 1),
      );
    case 'moveInDropdownList': {
      if (state.dropdown === null) return withNoEffects(state);
      let rowKeys = (dropdownListRows(state, reads) ?? []).map(menuItemKey);
      let highlightedIndex = state.dropdown.highlighted === null ? -1 : rowKeys.indexOf(state.dropdown.highlighted);
      let nextIndex = stepListIndex(highlightedIndex === -1 ? null : highlightedIndex, act.by, rowKeys.length);
      return withNoEffects(highlightDropdownRow(state, nextIndex === null ? null : (rowKeys[nextIndex] ?? null)));
    }
    case 'takeDropdownListRow': {
      let highlighted = state.dropdown?.highlighted ?? null;
      let rowTaken = dropdownListRows(state, reads)
        ?.map(menuItemKey)
        .find((option) => option === highlighted);
      let cellToGoTo = targetOfMove(act);
      let isAddOptionSideways = rowTaken === 'addOption' && act.columnDelta !== 0;
      if (rowTaken !== undefined && !isAddOptionSideways) return pickDropdownRow(state, reads, rowTaken, cellToGoTo, 'key');
      let listClosed = closeDropdownList(state);
      if (state.mode.kind === 'editing') return commitEntryAndMove(listClosed, reads, cellToGoTo);
      return withNoEffects(act.columnDelta === 0 ? listClosed : moveActiveCellTo(listClosed, reads, cellToGoTo, 'key'));
    }
    case 'shutList':
      return withNoEffects({
        ...closeDropdownList(state),
        peopleList: null,
      });
    case 'takePeopleListRow': {
      let rows = peopleListRows(state, reads);
      let cellToGoTo = targetOfMove(act);
      if (state.peopleList === null || rows === null) return commitEntryAndMove(state, reads, cellToGoTo);
      let rowGoneTo = rows[indexOfPeopleListRowGoneTo(state.peopleList, rows)];
      let isSideways = act.columnDelta !== 0;
      if (rowGoneTo === undefined && peopleChipsOfListCell(state, reads) !== null) {
        if (state.mode.kind === 'editing' && state.mode.text.trim() !== '' && !isSideways) return withNoEffects(state);
        return withNoEffects(
          moveActiveCellTo(
            leaveEntryEditing({
              ...state,
              peopleList: null,
            }),
            reads,
            cellToGoTo,
            'key',
          ),
        );
      }
      if (rowGoneTo === undefined) return commitEntryAndMove(state, reads, cellToGoTo);
      if (keyEvent.hasWaitedForPeople !== true && shouldWaitForPeopleOnEnter(state, reads)) {
        let { searchedFor } = state.peopleList;
        return {
          state,
          effects: [
            {
              kind: 'waitForPeople',
              searchedFor,
              key: keyEvent,
            },
          ],
        };
      }
      let steppedOff = keyEvent.hasWaitedForPeople === true ? stepOffUnderAgent(state, reads) : null;
      if (steppedOff !== null) return withDropWhatIsHeld(steppedOff);
      if (
        isEnterHeldInPeopleList(state, reads, keyEvent.hasWaitedForPeople === true) ||
        isAskAgentRowBusy(peopleListRowKey(rowGoneTo), state, context)
      )
        return keyEvent.hasWaitedForPeople === true ? withDropWhatIsHeld(state) : withNoEffects(state);
      return takePeopleListRow(state, reads, peopleListRowKey(rowGoneTo), cellToGoTo, 'key', isSideways, keyEvent.hasWaitedForPeople === true);
    }
    case 'removeFromField': {
      if (act.atCaret !== 'everyone' || chipGoneToInPeopleCell(state, reads) !== null) return removePersonFromCell(state, reads, null, 'key');
      return peopleChipsOfListCell(state, reads)?.length === 0 && reads.cellOf(activeAnchorCell(state, reads)) !== null
        ? withNoEffects(state)
        : clearSelectedCells(
            {
              ...state,
              peopleList: null,
            },
            reads,
          );
    }
    case 'stepInField': {
      let stepped = stepAmongPeopleChips(state, reads, act.step);
      if ('chip' in stepped) return withNoEffects(withPeopleChipGoneTo(state, stepped.chip));
      if (keyEvent.isRepeat) return withNoEffects(state);
      let cellToGoTo = targetOfMove({
        rowDelta: 0,
        ...stepped,
      });
      if (isSameCell(cellToGoTo, state.activeCell)) return withNoEffects(state);
      return withNoEffects(
        moveActiveCellTo(
          {
            ...state,
            peopleList: null,
          },
          reads,
          cellToGoTo,
        ),
      );
    }
    case 'stayInField':
      return withNoEffects(state);
    case 'moveInCard':
      return withNoEffects(moveInListCard(state, reads, act.by));
    case 'takeCardRow':
      return takeListCardRow(state, reads, null, targetOfMove(act), act.columnDelta !== 0);
    case 'shutCard':
      return withNoEffects(shutListCard(state));
    case 'goIntoCard':
      return withNoEffects(goIntoListCard(state, reads));
    case 'stayInCard':
      return withNoEffects(state);
    case 'openCardOfOption':
      return withNoEffects(openCardOfHighlighted(state, reads));
    case 'moveInTimeList':
      return withNoEffects(moveInTimeList(state, 'chosen', (index: number | null, count: number) => stepListIndex(index, act.by, count)));
    case 'moveInFunctionList':
      return withNoEffects(moveFunctionListHighlight(state, act.by));
    case 'takeFunctionListRow':
      return withNoEffects(pickFunctionListRow(state, reads, null));
    case 'shutFunctionList':
      return withNoEffects(shutFunctionList(state));
    case 'moveInFormulaOffer':
      return withNoEffects(moveOfferLight(state, reads, act.by));
    case 'takeFormulaOfferRow':
      return chooseOfferRow(state, reads, null);
    case 'enterFormulaRead': {
      let entryWithFormula = entryWithOfferRowFormula(state, reads);
      return entryWithFormula === null ? withNoEffects(state) : commitEntryAndMove(entryWithFormula, reads, targetOfMove(act), 'key');
    }
    case 'waveFormulaOfferOff':
      return withNoEffects(waveFormulaOfferOff(state));
    case 'waitForFormula':
      return withNoEffects(waitForFormula(state));
    case 'stopAskingForFormula':
      return stopAskingForFix(state, reads) ?? stopAskingForFormula(state);
    case 'goBackToWords':
      return commitProposedFix(state, reads) ?? withNoEffects(goBackToWords(state, reads));
    case 'clearCells':
      return clearCellsOrDropdown(withCalendarShut(state), context, 'key');
    case 'fill':
      return refuseWhenSeveralRanges(state, 'fill') ?? fillDownOrRight(withCalendarShut(state), reads, act.toward);
    case 'enterToday':
      return keyEvent.today === undefined
        ? withNoEffects(state)
        : enterTodayInCell(withoutOtherRanges(withCalendarShut(state)), reads, keyEvent.today);
    case 'sumUp':
      return insertAutoSum(state, reads);
    case 'undoOrRedo':
      return undoOrRedo(state, act.direction, context);
    case 'formatCells':
      return applyFormatCommand(state, reads, act.choice, caretInEntryOutsideChips(state, reads, keyEvent.caretInEntry));
    case 'actOnLists':
      return withNoEffects(pressListKeyInEntry(state, reads, act.key, entryAtCaretOf(state.mode, keyEvent)));
    case 'pressBoxOfLine':
      return toggleEntryCheckboxAndSave(state, reads, entryAtCaretOf(state.mode, keyEvent));
    case 'commitEdit': {
      let isArrowKey = ARROW_KEY_MOVES[keyEvent.key] !== undefined;
      let noticeOfTypedText = isArrowKey ? typedTextNotice(state, reads) : null;
      return commitEntryAndMove(
        isArrowKey || isEntryExpanded(state.mode)
          ? {
              ...state,
              lastDone: null,
            }
          : state,
        reads,
        targetOfMove(act),
        'key',
        offeredWords === null
          ? noticeOfTypedText
          : {
              what: 'offeredWordsEntered',
              words: offeredWords,
            },
        act.isKeep === true,
      );
    }
    case 'commitEditToSelection':
      return commitEntryToSelection(state, reads);
    case 'cancelEdit': {
      let navigating = {
        ...clearPassingNotice(state),
        mode: NAVIGATING_MODE,
        dropdown: null,
        peopleList: null,
      };
      let wasFormula = state.mode.kind === 'editing' && isFormulaText(state.mode.text);
      return withNoEffects(wasFormula ? scrollToShowActiveCell(navigating, reads) : navigating);
    }
    case 'pointAtCells':
      return withNoEffects(
        actOnSheetPointedIn(
          state,
          reads,
          (stateToPoint: PageState) => movePointedReference(stateToPoint, reads, caretInEntryOf(state.mode, keyEvent), act),
        ),
      );
    case 'switchArrows':
      return withNoEffects(
        actOnSheetPointedIn(
          state,
          reads,
          (stateToSwitch: PageState) => toggleArrowsTarget(stateToSwitch, reads, caretInEntryOf(state.mode, keyEvent)),
        ),
      );
    case 'writeInEntry': {
      if (state.mode.kind !== 'editing') return withNoEffects(state);
      let { isBegunToListFunctions, ...entryMode } = state.mode;
      return withNoEffects({
        ...state,
        mode: withEntryText(entryMode, act.text, act.caretAt),
      });
    }
    case 'askForMenu':
      return openContextMenu(state, null, reads);
    case 'askForLinkForm':
      return withNoEffects(state);
    case 'expandEntry':
      return withNoEffects(expandEntry(state, reads));
    case 'collapseEntry':
      return withNoEffects(collapseEntry(state, reads));
    case 'insertOrDeleteLines': {
      let area = selectedArea(state, reads);
      let selectionKind = area === null ? 'cells' : selectionKindOf(area, layoutOfView(state, reads));
      if (selectionKind === 'cells') return openContextMenu(state, null, reads);
      let lineEdit = LINE_EDITS_OF_COMMAND[act.what][selectionKind];
      let oneRangeAct = oneRangeActOfCommand(lineEdit);
      let refused = oneRangeAct === null ? null : refuseWhenSeveralRanges(state, oneRangeAct);
      if (refused !== null) return refused;
      let calendarShut = withCalendarShut(state);
      if (lineEdit === 'deleteRows') return deleteSelectedRows(calendarShut, reads);
      return lineEdit === 'deleteColumns'
        ? deleteSelectedLines(calendarShut, reads, lineEdit)
        : insertRowsOrColumns(calendarShut, reads, lineEdit);
    }
    case 'actOnGroups':
      return actOnOutlineGroups(withCalendarShut(state), context, act.act, outlineAxisForAct(state, reads, act.act));
    case 'addSheet':
      return keyEvent.newSheetNameStem === undefined ? withNoEffects(state) : addSheetAfter(withCalendarShut(state), keyEvent.newSheetNameStem);
    case 'showSheetBeside': {
      if (state.mode.kind === 'editing') return withNoEffects(switchToNextSheetWhileEditing(state, reads, act.by, keyEvent.caretInEntry));
      let filterButton = act.by === 1 ? filterButtonAtActiveCell(state, reads, state.activeCell) : null;
      if (filterButton === null && state.peopleList !== null) return withNoEffects(state);
      if (filterButton === null) return withNoEffects(showSheetAtOffset(state, reads, act.by));
      if (filterButton.isOfFoundTable && ownFilterKeyNotDrawnYet(state) !== null) return withNoEffects(state);
      if (filterButton.isOfFoundTable) {
        let openRowsAskFrom = (stateToSort: PageState) =>
          openRowsAsk(
            {
              ...reduceOwnFilterList(stateToSort, reads, {
                kind: 'giveUp',
              }),
              contextBarMenu: 'sort',
            },
            reads,
            filterButton,
          );
        let rowsAskOpened = openRowsAskFrom(state);
        return withNoEffects(
          outlineOfFilterNotDrawnYet(rowsAskOpened, reads) === null ? openRowsAskFrom(scrollToShowActiveCell(state, reads)) : rowsAskOpened,
        );
      }
      return withNoEffects(openOwnFilterList(state, reads, filterButton.tableKey, filterButton.c, keyEvent.today ?? null));
    }
    case 'showOrHideFormulas':
      return withNoEffects(toggleFormulasShown(state));
    case 'letGo': {
      if (state.menu !== null)
        return withNoEffects(
          isMenuHoldingField(state.menu)
            ? state
            : {
                ...state,
                menu: null,
              },
        );
      if (commentToShutOnEscape(state) === 'box')
        return {
          state: {
            ...state,
            lastDone: null,
            copiedCells: null,
          },
          effects: [
            {
              kind: 'shutCommentBox',
            },
          ],
        };
      if (commentToShutOnEscape(state) === 'card')
        return {
          state: {
            ...state,
            comments: (state.comments ?? []).map(
              ({ handle, cells, isResolved }) => ({
                handle,
                cells,
                isResolved,
                isOpen: false,
              }),
            ),
            lastDone: null,
            copiedCells: null,
          },
          effects: [
            {
              kind: 'shutComment',
            },
          ],
        };
      if (state.followed !== null)
        return withNoEffects({
          ...state,
          lastDone: null,
          copiedCells: null,
        });
      if (!hasNoticeToDismiss(state) && state.dragging === null) {
        let withNothingHeld = {
          ...state,
          lastDone: null,
          copiedCells: null,
        };
        let conditionalRules = conditionalRulesOfPane(withNothingHeld);
        let { state: stateAfter, effects } =
          state.find !== null
            ? withNoEffects(closeFind(withNothingHeld))
            : !isSidePaneShuttable(state)
              ? withNoEffects(letGoOfCopiedCells(state, reads, context.refusalOfEveryEdit === null))
              : conditionalRules !== null && isAgentOfferPendingOrAsked(conditionalRules)
                ? actInConditionalFormats(withNothingHeld, reads, {
                    kind: 'stepBack',
                  })
                : withNoEffects(closeSidePane(withNothingHeld));
        return {
          state: hideExplainedCard(stateAfter, reads),
          effects,
        };
      }
      return withNoEffects({
        ...withoutFillDrag(hideExplainedCard(state, reads)),
        notice: null,
        newsOfLoss: hasNoticeOrUndoOffer(state) ? state.newsOfLoss : null,
        undoOffer: null,
        undoOfTurnOffered: isTurnUndoOfferFrontmost(state) ? null : state.undoOfTurnOffered,
        lastDone: null,
        calendar: null,
        copiedCells: null,
      });
    }
    case 'stepOutOfCells':
      return withNoEffects({
        ...hideExplainedCard(state, reads),
        isSteppedOutOfCells: true,
        lastDone: {
          what: 'steppedOutOfCells',
        },
        copiedCells: null,
      });
    case 'goOnOutOfGrid':
      return withNoEffects({
        ...closeDropdownList(state),
        peopleList: null,
      });
    case 'goIntoCalendar':
      return withNoEffects({
        ...(state.calendar === null ? withCalendarOpen(state, reads) : state),
        timesCalendarAsked: state.timesCalendarAsked + 1,
      });
  }
}
export const keyActInState = (
  state: PageState,
  keyEvent: KeyPressed,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): KeyAct | null =>
  keyActOf(state.mode, keyEvent, popupOverEntry(state, reads), escapeInCellsDoes(state), {
    sheetsToPointIn: sheetsToPointInFor(state, reads, refusalOfEveryEdit === null),
    pointedReference: state.pointedReference,
    viewOnlyBecause: refusalOfEveryEdit,
    doesEntryTakeLineBreaks: doesEntryTakeLineBreaks(state, reads),
    hasCellsToFill: isSelectionMoreThanActiveCell(state, reads),
    isSteppedOutOfCells: state.isSteppedOutOfCells,
    doesKeyOpenLinkForm: refusalOfEveryEdit === null && canEditLinkAtActiveCell(state, reads),
  });
export const startEntryAtActiveCell = (state: PageState, reads: ReadsWithTextMeasurer): PageTransition =>
  withNoEffects(
    isEntryAmongPeople(state, reads)
      ? refreshPeopleList(scrollToShowActiveCell(state, reads), reads)
      : startEntryEditing(state, reads, textToEditAt(state, reads, activeAnchorCell(state, reads)), 'cell'),
  );
export const takeWordsOfferedByTab = (state: PageState, offer: WordsOfferedPressed, context: PageContext): PageTransition =>
  matchingWordsOffered(state, offer)?.isShown === true
    ? stepKeyPressed(
        state,
        {
          kind: 'keyPressed',
          key: 'Tab',
          isShiftHeld: false,
          isModifierHeld: false,
          isAltHeld: false,
          isRepeat: false,
        },
        context,
        true,
      )
    : withNoEffects(state);
