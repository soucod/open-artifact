import {
  withNoEffects,
  sortColumnOfMenu,
  isMenuHoldingField,
  withFormulasLeftToWorkOut,
  clearPassingNotice,
  NAVIGATING_MODE,
  cellsToSortOfMenu,
} from './transitions.ts';
import { openMenuWith, openContextBarMenu, openContextMenu, menuPlaceNear, withSetMeetsInMenu } from '../ui/menu.ts';
import { mergeOrUnmergeSelection } from '../format/merge-cells.ts';
import { convertTextsToNumbers, textsConvertedOfferAfterEdit } from '../format/texts-to-numbers.ts';
import { moveLinesByKey, endLinesDrag, finishMovingLines } from '../selection/move-lines.ts';
import { deleteSelectedRows, deleteSelectedLines } from '../edits/rows-out-of-view.ts';
import { sortTableFromMenu, withTableToSortInMenu } from '../tables/table-to-sort.ts';
import { sortSheetByColumn, rangeSortWideningChoice, sortRange } from '../tables/sort.ts';
import type { CellsToSortAsked } from '../tables/sort.ts';
import {
  runOutlineCommand,
  setOutlineGroupsCollapsed,
  showOutlineGroupsToLevel,
  NO_NEWLY_COLLAPSED_GROUPS,
  newlyCollapsedGroupIds,
  ownCollapsingAfterReadsChange,
  moveSelectionsOutOfNewlyCollapsed,
} from '../grid/outline-groups.ts';
import { insertRowsOrColumns } from '../edits/insert-lines.ts';
import {
  hasOtherRanges,
  actOnEveryRange,
  rangesForLineAxis,
  oneRangeActOfCommand,
  refuseWhenSeveralRanges,
  withoutOtherRanges,
  refreshLastDoneCounts,
} from '../selection/several-ranges.ts';
import { clearCellsOrDropdown } from '../selection/cells-seen.ts';
import {
  finishDuplicateSheet,
  leaveRenamingOrEntry,
  showSheet,
  addSheetAfter,
  duplicateSheet,
  deleteSheet,
  startRenamingSheet,
  finishRenamingSheet,
  markUndoOfferSaved,
  markLastDoneSaved,
} from './sheet-tabs.ts';
import { finishPasteOfChart, copyOrCutSelection, pasteIntoSelection, pasteChart, areaOfPastedTexts } from './copy-paste.ts';
import {
  doesCommentModePick,
  canCommentModePickNow,
  openCommentAtSelection,
  shutCommentsOnPress,
  commentAtSelectionCorner,
  goToCommentKeepingScroll,
  openCommentByKeyboard,
  withCommentsTold,
  goToComment,
} from '../comments/comment-state.ts';
import { stepInSheetPointedIn, switchSheetWhileEditing } from '../formulas/sheet-pointed-in.ts';
import { eventEffectOnDrag } from './drag-events.ts';
import { stopMovingColumnsOfTable, dropMovedColumnsOfTable } from '../selection/move-table-columns.ts';
import { cancelMovingCells, noteTableLeftItsPlace, dropMovedCells } from '../selection/move-cells.ts';
import { endDragKeepingScroll, finishResizeDrag, resetRowHeightOnDoublePress, chooseColumnWidth, chooseRowHeight } from '../grid/resize-lines.ts';
import { doesEventCloseTableHandleMenu, markDriftFromTableHandle, tableHandleClicked, openTableHandleMenu } from '../tables/table-handle-menu.ts';
import {
  moveMarkedLink,
  withoutMarkedLink,
  withoutLinkPointedAt,
  cellKeyText,
  explainCellUnderPointer,
  leaveLinkCard,
  askLinkCard,
  cellExplained,
  putAwayErrorCard,
} from './explained-under-cell.ts';
import {
  fixKeyAction,
  actOnFixKey,
  fixAtCell,
  askAgentForFixes,
  fixesInSelectionStage,
  receiveFixAnswer,
  keepFixes,
  endFixes,
  discardFixes,
  fixPillShown,
  keepFix,
  discardFix,
  takeBackKeptFix,
  pointAtFix,
  dropFixesTakenBack,
} from '../formulas/fix/fixes-on-cells.ts';
import { stepKeyPressed, pressSpaceInCell, takeWordsOfferedByTab } from '../keys/key-pressed.ts';
import {
  dropPressedCheckbox,
  notePressedCheckbox,
  dropCheckboxIfPointerLeft,
  toggleCheckboxOnRelease,
  toggleableCheckboxValue,
  setCheckboxesOfSelection,
} from '../chips/checkbox-presses.ts';
import { withCalendarShut, openCalendarOnLateTap, pickDayInCalendar, pickTimeInCalendar, withCalendarOpen } from '../chips/calendar.ts';
import { pressOnGrid, pointerPressedOnGrid, pointerDraggedOnGrid, cellOfDoublePress } from '../selection/pointer.ts';
import { startFillDragByFinger, endFillDrag, isPointOnFillHandle, fillDownToTableEnd } from '../selection/fill-handle.ts';
import {
  openListOnPress,
  openEntryOnPress,
  doesCellOpenItsOwnOnPress,
  openListOfPressedActiveCell,
  openEntryOfPressedActiveCell,
} from '../chips/list-on-press.ts';
import {
  closePeopleListOnCellClick,
  isPeopleCell,
  refreshPeopleList,
  peopleChipsOfListCell,
  notePeopleListScroll,
  caretInEntryOutsideChips,
  isAskAgentRowBusy,
  takePeopleListRow,
  openPeopleListToAskPerson,
  removePersonFromCell,
  withProfilesLearned,
  withPeopleFound,
  pasteIntoPeopleCell,
  keepPeopleListOpen,
} from '../chips/people-list.ts';
import { toggleDropdownListOnClick, refreshDropdownEditor } from '../chips/dropdown-sync.ts';
import { finishFreezeDrag, startFreezeDrag, applyFreezeChoice } from '../grid/freeze.ts';
import { dropPlacedView, reducePlacedViewAct, isPointOnSelectedPlacement, scrollBackIfNewChartGone } from '../charts/placed-views.ts';
import { reduceEditOfChartAsked } from '../charts/chart-edits.ts';
import { chartBeingMadeTold } from '../charts/chart-being-made-state.ts';
import { isSumWithFormulaCell, figuresOfSelection, insertFigureFormula } from '../selection/figures.ts';
import {
  pickDropdownRow,
  closeDropdownList,
  closeSidePane,
  toggleDropdownPane,
  toggleOptionColorCard,
  nameDropdownOptions,
  moveDropdownOption,
  withReadySets,
  openDropdownListOrEditor,
  editDropdownOfEntryCell,
} from '../chips/dropdowns.ts';
import { reduceDropdownEditor } from '../chips/dropdown-editor.ts';
import {
  commitEntryKeepingAgentsFormula,
  commitEntryInPlaceIfEditing,
  withTextOfOthersFlag,
  leaveEntryEditing,
  saveEntryLeavingItOpen,
  commitEntryAndMove,
  toggleEntryCheckboxAndSave,
  commitProposedFix,
  stopAskingForFix,
  endEntryOnPointerPress,
} from '../editor/commit-entry.ts';
import { versionHistoryOfPane, isSidePaneShownAsPane, noticeGivesWay, canOfferAgentForRules } from './queries.ts';
import {
  toggleVersionHistory,
  versionHistoryActed,
  refreshVersionHistory,
  carrySessionIntoState,
  versionLookAnswered,
  versionsAnswered,
  editsThatTakeBackRead,
  takeBackAnswered,
  versionAuthorsArrived,
} from '../history/version-history.ts';
import { openConditionalFormatsAs, openConditionalFormatsPane, clearChosenTestBeingAdded } from '../format/conditional/pane-state.ts';
import { askRulesFromMenuWords, showRulesInMenu, closeRulesMenu, takeAgentAnswerAboutRules } from '../format/conditional/agent-rules.ts';
import { actInConditionalFormats } from '../format/conditional/pane-reducer.ts';
import { openSortPane, actInSortPane, sortChosenCells, sortOfSidePane, withSortPaneSortsFor } from '../tables/sort-pane.ts';
import type { SortPaneActSent } from '../tables/sort-pane.ts';
import { toggleFormulasShown } from '../grid/formulas-shown.ts';
import {
  keepActiveCellInViewOnResize,
  giveBackScrollForMoreRoom,
  keepActiveCellAboveCardAtFoot,
  revealActiveCellBelow,
  noteScrollForLessRoom,
  keepActiveCellClearOfStuckHeaders,
  keepKeyedCellClearOfStuckHeaders,
  keepKeyedSelectionShown,
} from '../selection/keep-in-view.ts';
import { viewWithDensity, layoutOfView, clampScrollOfView, findSheetById, keepResizedLineInSight } from '../grid/layout.ts';
import { openFind, changeFindText, stepFindHit, refreshFindHits, closeFind, isModalOpen, showFindReplace, changeFindOptions } from '../ui/find.ts';
import { replaceFound, dropReplacementsNotShown, countLeftAfterReplaceAll } from '../ui/find-replace.ts';
import { fitColumnToTextOnDoublePress, fitSelectedColumnsToText } from '../grid/fit-to-text.ts';
import {
  anchorCellOf,
  moveActiveCellTo,
  isSameCell,
  scrollToShowActiveCell,
  withRoomUnderNoticesAtFoot,
  activeAnchorCell,
  selectionAtCell,
  scrollToShowSelection,
} from '../selection/model.ts';
import { textToEditAt, startEntryEditing, letArrowsActOnCells, stopArrowsActingOnCells, doesEntryTakeLineBreaks } from '../editor/start-entry.ts';
import { clampScrollWithFloats, NO_BOXES_AT_FOOT } from '../grid/geometry.ts';
import { followCaretAtEnd, keepCaretAtEndInView, addLinesAtEnd } from '../grid/lines-at-end.ts';
import { isEditingSameText } from '../formulas/reference-pointing.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { closeImportOfAFile, confirmImport, discardImport, escapeImport, keepImport, narrowImportedArea } from '../import/bring-in.ts';
import { withXlsxFileToldLater, withXlsxFileSaved } from '../export/xlsx-saved-notice.ts';
import {
  readListSignsTyped,
  marksToTypeAfterSigns,
  canSetMarkOnEntrySelection,
  selectInEntry,
  setEntryLooks,
  toggleCellCheckboxLine,
} from '../editor/entry-looks.ts';
import { refreshWordsOffered, showWordsOffered, hideWordsOffered, withoutWordsOffered } from '../editor/words-offered.ts';
import { restoreWhatCaretLeft, restoreEntryOfPageBefore, keepEntryLeftByCaret, leaveSheetNameEntry } from './focus-return.ts';
import { isFormulaUnfinishedInEntry } from '../editor/formula-closing.ts';
import {
  isFormulaAskedOrProposed,
  chooseOfferRow,
  waveFormulaOfferOff,
  goBackToWords,
  setOfferDrawn,
  endProposalArrival,
  waitForFormula,
  pickProposedFix,
  stopAskingForFormula,
  takeAgentAvailability,
} from '../formulas/from-words/actions.ts';
import { dropFormulaOfAgentDiscarded, carryFormulaOfAgentDiscarded } from '../agent/discarded-formula-note.ts';
import { isEntryExpanded, collapseEntry, expandEntry } from '../editor/expanded-entry.ts';
import { putAwayErrorsOffer, isErrorsOfferBlocked, errorsOfferShown } from '../formulas/fix/errors-offer.ts';
import {
  selectErrorsAtOpening,
  hideExplanationUnderPointer,
  withErrorsOfferedFromStart,
  settleListFilterOnceUsed,
  withFilterKeptOnForColumnsCard,
  updateCalculatingShown,
} from './page-reducer.ts';
import { fixesToOfferInSelection } from '../formulas/fix/cells-to-fix.ts';
import { undoOrRedoIfFree } from '../history/steps-together.ts';
import { undoTurnOfAgent, setAgentWorking, changesByAgentArrived, dropUndoOfTurnWaitedOut } from '../agent/turn-of-agent.ts';
import { pickColumnToSortBy } from '../ui/sort-menu.ts';
import {
  setRowsHiddenByOwnFilters,
  keepSelectionOnShownRows,
  rowsHiddenByOwnFiltersAfterChange,
  unhideFilteredRowsOfSelection,
} from '../tables/filtered-rows.ts';
import {
  declareCellTableOfNewFilter,
  toggleOwnFilterOnSelection,
  filterByCellValue,
  dropUnusedOwnFilter,
  removeOwnFilterLine,
  clearOwnFilters,
  bringBackOwnFilters,
  ownFiltersOfExistingSheets,
} from '../tables/own-filter-actions.ts';
import { clearOwnSortByKey, refreshStaleOwnFilters, lookAgainAtOwnFilters, ownRowOrdersNotGivenUp, ownFilterByKey } from '../tables/own-filters.ts';
import { makeOwnSortForEveryone, openOwnFilterList, reduceOwnFilterList, sortFromOwnFilterList } from '../tables/own-filter-list.ts';
import {
  selectAfterEdit,
  reconcileWithWorkbook,
  noticeOfRefusedEdit,
  restoreViewOfRefusedEdit,
  discardEffectsOfRefusal,
  noticeOfStepNotTaken,
  showChangedPlace,
  showUndoneOrRedone,
} from './edit-answers.ts';
import { IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { doesRowsActionSort, actOnRowsAsk, takeAgentRowsAnswer, openRowsAsk, scrollToFilterButtonsRow } from '../tables/rows-asked-for.ts';
import { applyFormatCommand } from '../format/format-commands.ts';
import { drawBordersOnSelection } from '../format/borders.ts';
import { toggleGridlines } from '../grid/gridlines.ts';
import {
  typeCustomPattern,
  typeCustomPatternInList,
  formatOfCustomPattern,
  withRefusalTold,
  leaveCustomFormat,
  canAskAgentForFormat,
  askAgentForNumberFormat,
  takeNumberFormatAnswer,
  afterFormatApplied,
} from '../format/custom-number-format.ts';
import { isHoldReleased, answerHoldOf, holdOneMoreAct, markHoldSeen } from '../format/answer-holds.ts';
import { openWorkbookSettingPick, pickWorkbookSetting, commitWorkbookSettingPick } from '../ui/locale-time-zone-pick.ts';
import type { WorkbookSettingAsked } from '../ui/locale-time-zone-pick.ts';
import { openListOfKeys } from '../keys/shortcut-list.ts';
import {
  openCellHistory,
  setCellHistoryScope,
  askCellHistoryAgain,
  refreshCellHistory,
  cellHistoryAnswered,
  cellHistoryAuthorsArrived,
} from '../history/cell-history.ts';
import { receiveImportAnswer } from '../import/import-flow.ts';
import {
  receivePartialImportAnswer,
  answerImportQuestion,
  chooseImportDestination,
  changeImportByHand,
  loadImportColumnKinds,
  sendImportWish,
  askImportPlanAgain,
  stopAwaitingImportPlan,
  refreshImportOnWorkbookChange,
} from '../import/import-review.ts';
import { awaitFileToImport, carryFileAwaited } from '../import/file-awaited.ts';
import { openListCardAtRow, takeListCardRow, shutListCard } from './list-cards.ts';
import { moveInTimeList } from '../editor/time-list.ts';
import { setFormulaHelpCaret, isColumnPick, pickFunctionListRow, shutFunctionList, listAllFunctions } from '../formulas/autocomplete.ts';
import {
  withAddressPastedOverWords,
  editLinkOfUrlInEntry,
  openEntryLinkForm,
  submitLinkFormInEntry,
  removeLinkOfUrlFromCell,
} from '../links/links-in-entry.ts';
import type { LinkOverWords } from '../links/links-in-entry.ts';
import { isEntryWorkPending } from '../editor/unanswered-entries.ts';
import { takeWorkedOutFormula } from '../formulas/from-words/offer.ts';
import { takeAgentsFormulaAnswer } from '../formulas/from-words/ask-agent.ts';
import { setFormatAsTable } from '../tables/format-as-table.ts';
import { withSelectionsOfOthers } from '../presence/selections.ts';
import { goToCells } from '../selection/go-to-cells.ts';
import { importReadFile } from '../import/text-file.ts';
import { moveSheetToPlace, lastDoneOfSheetMove } from './sheet-move.ts';
import { copyLinkToSheet, noticeLinkNotCopied } from '../links/sheet-links.ts';
import { settlePasteThatWaits, holdPasteThatWaits } from '../clipboard/paste-that-waits.ts';
import { ownCellLostNotice, ownSortOfSortStep, whomSortOfStepIsFor } from './own-cell-lost.ts';
import { askForPivotTable, actInPivotTablePane, settlePivotTablePane } from '../tables/pivot-tables.ts';
import type { PivotTablePaneActedIn } from '../tables/pivot-tables.ts';
import { updatePivotTable } from './pivot-tables-out-of-date.ts';
import { pickNamedView, changeNamedView } from '../tables/named-view-actions.ts';
import type { NamedViewChange } from '../tables/named-view-actions.ts';
import type { NamedViewInHand } from '../tables/named-view-model.ts';
import { writeFromInteractive, editInteractiveOfSheet } from './places.ts';
import type { CellWrittenFromAnInteractive } from '@open-artifact/sheets-core';
import type { OwnViewShownAsApplied } from '../tables/filter-messages.ts';
import type { PlaceOfLink } from '../shell/sheet-links.ts';
import type { ColumnWentTo } from '../selection/move-table-columns.ts';
import { NO_NOTES_OF_STEPS, selectionOfStepReversed } from './notes-of-steps.ts';
import { nextSavingProgress, savingProgressAfterWait } from './saving-progress.ts';
import { refreshEntryErrorOnRead } from './reasons-for-errors.ts';
import { wholeSheetsAsChanges, nextIsFirstBuild } from '../agent/follow-agent.ts';
import { calculatingShownAfterWait } from './calculating-shown.ts';
import { longCalculationAfterWait } from './long-calculation.ts';
import { nextContextBarMenu } from './context-bar.ts';
import { isNoticeOfOtherEditRefused } from './edit-refusals.ts';
import { openLinkFormFromCellCard, openLinkFormAtActiveCell, shutLinkForm, submitLinkForm, removeLinkFromCellCard } from '../links/link-form.ts';
import { askAgentToFixFormula, cellOfFixNotice, withFixNoticeDown } from '../formulas/fix/ask.ts';
import { stepBackIntoCells } from './escape.ts';
import { answerFirstEntry } from '../editor/entries-answered-later.ts';
import { hasPastedLinks } from '../clipboard/other-programs.ts';
import type { CellsOfAnotherProgram } from '../clipboard/other-programs.ts';
import { refusalMessageKey, editRefusalReason } from '../model/refusals.ts';
import { editAnsweredFor } from '../engine/cause-of-error-cache.ts';
import { lineEditAfterEntry } from '../editor/add-line-at-end.ts';
import { openEditorOfTopRule } from '../format/conditional/suggestions.ts';
import type {
  CellAt,
  PastedTextIs,
  ValuesOfACopy,
} from '@open-artifact/sheets-core';
import type {
  ColumnId,
  ColumnOfATable,
  ColumnReading,
  Edit,
  EngineCellTable,
  EngineRecordedEdit,
  Filter,
  NothingToChangeAnswer,
  OtherAnswerToAnEdit,
  Refused,
  RowId,
  SheetId,
  SortDirection,
  StepGivenUpAnswer,
  WentAlong,
} from '@open-artifact/sheets-core';
import type { StockKind } from '@open-artifact/sheets-core/stock-charts';
import type { CellId, PlacementOnGrid, WorkbookReads } from '../model/workbook.ts';
import type { CellArea, CellPosition, CellSelection, SelectionPositions, SelectionToRead } from '../selection/model.ts';
import type { CellFoundBy, GridPoint, GridScroll, LinesAxisName } from '../grid/geometry.ts';
import type { FormatToCome } from './formats-to-come.ts';
import type { ColumnsOfTableMoving } from '../selection/move-table-columns.ts';
import type { PagePoint } from '../comments/page-comments.ts';
import type { CellDensity } from '../grid/cell-metrics-values.ts';
import type { Wait } from './calculating-shown.ts';
import type { ChartNodeCopies, ChartOnClipboard } from './copy-paste.ts';
import type { whatPointerWasOver } from '../selection/pointer.ts';
import type {
  BordersDrawnDone,
  CellsSortedDone,
  CalendarOpen,
  CaretAtEnd,
  CellHistoryScope,
  CellsChangedInSheet,
  HistoryWhy,
  RulesDrawnAs,
  CutJustMoved,
  DoneToCells,
  EntryLooks,
  FormattedDone,
  LastDone,
  LinesDone,
  NewsOfLoss,
  Notice,
  OwnFilterConditionHeld,
  PageState,
  SavingState,
  TableNotFormatted,
  TimeOfDay,
  VersionHistoryInPane,
  VersionOfWorkbook,
  VersionRestoredOffer,
  XlsxFileSaved as SavedXlsxFile,
  ImportReadingWords,
} from './initial-state.ts';
import type { EditAuthor } from '../history/requests.ts';
import type { MergeAct } from '../format/merge-cells.ts';
import type { SelectionHandle } from '../kit/selection-frame.tsx';
import type { CellsHeldForChart } from './controller.ts';
import type { RulesPaneAction } from '../format/conditional/pane-state.ts';
import type { LabelEnds } from '../model/a1-references.ts';
import type { AtMenuOffer } from '../i18n/menu-labels.ts';
import type { AnswerSeen } from '../format/answer-holds.ts';
import type { OptionMovedInDropdown, OptionsNamedInDropdown } from '../chips/dropdowns.ts';
import type { TimeChosenInCalendar } from '../chips/calendar.ts';
import type { DropdownEditorAct } from '../chips/dropdown-editor.ts';
import type { ProfileOfPerson } from '../chips/people-list.ts';
import type { HeardSelection } from '../presence/room.ts';
import type { CopyLinkOutcome } from '../shell/sheet-links.ts';
import type { WhyRefused } from '../store/requests.ts';
import type { NumberFormatReply } from '../format/custom-number-format.ts';
import type { AgentReplyAboutRules } from '../format/conditional/agent-rules.ts';
import type { FormatCommand } from '../format/format-commands.ts';
import type { BorderChoice, BorderLine } from '../format/borders.ts';
import type { FORMULA_OFFER_ROW_IDS } from '../formulas/from-words/offer-list.tsx';
import type { StepInLooksHistory } from '../editor/text-looks.ts';
import type { PageEffect, PageTransition, QueueEditEffect, StaysAt, UndoOrRedoEffect } from './transitions.ts';
import type { ClearHow } from '../selection/cells-seen.ts';
import type { StepShown } from './edit-answers.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
import type { TablesRead as TablesReadOfSheets } from '../engine/worker-workbook.ts';
import type { FilterTableInIds } from '../tables/own-filters.ts';
import type { ImportDelimiter } from '../import/csv-file.tsx';
import type { ChosenRowHeight } from '../grid/row-height-dialog.tsx';
import type { FunctionListPick } from '../formulas/autocomplete.ts';
import type { RevisionRun } from '../agent/turn-changes.ts';
import type {
  EditOutcome,
  EditQueuedOutcome,
  RefusalOfEveryEdit as RefusalOfSyncing,
  TakeBackOutcome,
  UndoOrRedoOutcome,
} from '../store/workbook-sync.ts';
/** The text box of an entry as it stood when the event was told: its caret, text, and whether a composition is open. */
export interface CaretInEntry {
  start: number;
  end: number;
  text: string;
  isComposing: boolean;
}
/** A key pressed, read the same on every platform. */
export interface KeyPress {
  key: string;
  isShiftHeld: boolean;
  isModifierHeld: boolean;
  isAltHeld: boolean;
  isRepeat: boolean;
}
/** Where a menu, a change of the sheet or a format was chosen. */
export type ChosenIn = 'menu' | 'toolbar';
/** The answers of the agent that the page holds acts on until they are seen. */
export type HoldOfAgentsAnswer = 'fixes' | 'numberFormat' | 'rowsAskedFor';
/** A change of the sheet chosen in a menu, by a key or in the toolbar. */
export type SheetChange =
  | 'resizeColumns'
  | 'resizeRows'
  | 'mergeCells'
  | 'unmergeCells'
  | 'convertTexts'
  | 'moveRowsUp'
  | 'moveRowsDown'
  | 'moveColumnsLeft'
  | 'moveColumnsRight'
  | 'deleteRows'
  | 'deleteColumns'
  | 'sortAscending'
  | 'sortDescending'
  | 'sortRangeAscending'
  | 'sortRangeDescending'
  | 'groupRows'
  | 'groupColumns'
  | 'ungroupRows'
  | 'ungroupColumns'
  | 'collapseRows'
  | 'collapseColumns'
  | 'expandRows'
  | 'expandColumns'
  | 'insertRowAbove'
  | 'insertRowBelow'
  | 'insertColumnLeft'
  | 'insertColumnRight'
  | 'clearCells';
/** What chart nodes are copied for: a sheet duplicated, or a chart pasted. */
export type ChartNodesCopiedFor =
  | { kind: 'duplicateOfSheet'; sheetId: SheetId; name: string }
  | { kind: 'pasteOfChart'; chart: { sheetId: SheetId; placementId: string }; toSheetId: SheetId; topLeft: CellAt; offsetFromAnchorCell: { xInPixels: number; yInPixels: number } };
/** What the page does once an edit is queued, and once it is answered. */
/** What an act says it did by its name alone; the cells it was done to make the rest of the line. */
export type DoneToArea = DoneToCells['what'] | StepShown;
/** The last-done lines among `Done` whose name is one of `What`, each narrowed to those names. */
type DoneNamed<Done, What extends string> = Done extends { what: infer Name }
  ? Extract<Name, What> extends never
    ? never
    : Omit<Done, 'what'> & { what: Extract<Name, What> }
  : never;
/** The names of the last-done lines an act gives whole, with nothing to fill in from its cells. */
export type DoneGivenWhole =
  | 'rowsFrozen'
  | 'columnsFrozen'
  | 'gridlinesHidden'
  | 'gridlinesShown'
  | 'interactiveReset'
  | 'interactiveDefaultsSaved'
  | 'pivotTableAdded'
  | 'pivotTableUpdated'
  | 'formattedAsTable'
  | 'notFormattedAsTable'
  | 'placedViewMoved'
  | 'placedViewSized'
  | 'grouped'
  | 'ungrouped'
  | 'collapsed'
  | 'expanded'
  | 'groupsCollapsed'
  | 'groupsExpanded'
  | 'shownToLevel'
  | 'dropdownCellsSet'
  | 'dropdownOptionsSet'
  | 'dropdownOptionMoved'
  | 'dropdownOptionRemoved'
  | 'dropdownOptionsAdded'
  | 'dropdownStartedFrom'
  | 'headerRowSet'
  | 'offeredWordsEntered'
  | 'typedTextEntered'
  | 'entryEmptiedCell'
  | 'formulaOfAgentEntered'
  | 'fixKept'
  | 'fixesKept'
  | 'columnsOfTableMoved'
  | 'personAdded'
  | 'personRemoved'
  | 'peopleReplaced'
  | 'contentsReplaced'
  | 'rowsSorted'
  | 'checked'
  | 'unchecked'
  | 'movedOverCells'
  | 'boxOfLineSet'
  | 'undoOfferMade'
  | 'timeZoneSet'
  | 'localeSet'
  | 'rulesAdded'
  | 'ruleChanged'
  | 'movedToNumbers'
  | 'scaleColorsNothing'
  | 'ruleRemoved'
  | 'ruleMoved'
  | 'offerDiscarded'
  | 'agentStopped'
  | 'namedViewPicked'
  | 'namedViewSaved'
  | 'namedViewUpdated'
  | 'namedViewRenamed';
/**
 * What an act says it did, when it says more than its name: a whole last-done line, or one still missing what the
 * cells it was done to tell (the labels of lines, the cells formatted or sorted, and the heading rows to leave out).
 */
export type DoneWithDetail =
  | DoneNamed<LastDone, DoneGivenWhole>
  | Omit<LinesDone, keyof LabelEnds>
  | Omit<FormattedDone, 'cells'>
  | Omit<BordersDrawnDone, 'cells'>
  | (Omit<CellsSortedDone, 'cells'> & { cells?: string; headingRowCount: number })
  | { what: 'checkboxesMade'; headingRowCount: number };
/** What to select once an edit is queued: the place it changed, a selection, positions to find again, an area, or nothing. */
export type SelectAfterEdit = 'placeChanged' | SelectionToRead | SelectionPositions | CellArea | null;
/** A line to add once the entry is answered, with what to tell and select then. */
export interface LineAfterEntry extends Pick<IfQueued, 'onlyCellOfPlaceChanged' | 'carriesTabRunOn' | 'undoSelects'> {
  edit: Edit;
  done: DoneWithDetail;
}
/** Columns of a table moved by an edit: how many, the workbook read before the move, and the selection kept if it is not made. */
export interface ColumnsOfTableMoved extends Omit<ColumnsOfTableMoving, 'landsAt' | 'count' | 'isToMove'> {
  count: number;
  before: WorkbookReads | null;
  selectedIfNotMade: CellSelection;
  /** A cell of the table whose columns moved, and where each column went. */
  ofTableAt: CellId;
  wentTo: ColumnWentTo[];
}
/** The end of the rows or columns just added, to bring into view. */
export interface EndToBringIntoView {
  what: 'rows' | 'columns';
  count: number;
}
export interface IfQueued {
  select: SelectAfterEdit;
  done: DoneToArea | DoneWithDetail | null;
  foundBy?: CellFoundBy | 'fillHandle';
  undoOffer?: PageState['undoOffer'];
  pasteOfTextInstead?: PasteChosen | null;
  pasteChosen?: PasteChosen;
  entryBeforeLine?: Edit;
  thenLine?: LineAfterEntry;
  thenEntryOfPressedCell?: 'opens';
  formatsToCome?: FormatToCome[];
  askOfChart?: number;
  thenEvent?: PageEvent;
  leavesEntryOpen?: boolean;
  endsEntryAtOnce?: boolean;
  isViewLeftAsItIs?: boolean;
  reachesRowsOutOfView?: boolean;
  movesCut?: CutJustMoved;
  movesColumnsOfTable?: ColumnsOfTableMoved;
  isSaveOfOpenEntry?: boolean;
  isKeepOfAgentsFormula?: boolean;
  isKeepOfAgentsFix?: boolean;
  leavesLineRoundCopy?: boolean;
  isThenEventDroppedIfRefused?: boolean;
  isPlaceOnlyShown?: boolean;
  carriesTabRunOn?: boolean;
  isMadeAroundRowsOutOfView?: true;
  dropsWhatIsHeld?: 'always' | 'ifRefused';
  thenPeopleList?: 'staysOpen';
  thenInDropdownEditor?: 'opens' | 'goesOn' | 'entered' | 'startsOption';
  thenGoesOnTo?: CellId;
  thenCalendar?: 'opens';
  thenDropdownList?: 'opens';
  thenListOfPressedCell?: 'opens';
  thenEditorOfTopRule?: { cellsPickedByPage: 'movedToNumbers' | null };
  isSelectedAlone?: boolean;
  endBroughtIntoView?: EndToBringIntoView;
  thenSheet?: SheetId;
  keepsWordsOnEntryBefore?: boolean;
  onlyCellOfPlaceChanged?: { inRowOf: CellId } | { inColumnOf: CellId };
  scrollIfRefused?: GridScroll;
  selectionIfRefused?: Pick<PageState, 'activeCell' | 'selectionCorner' | 'rangeWalked' | 'otherRanges' | 'movedClearOfColumnsTo'>;
  isSelectionGivenUp?: true;
  undoSelects?: CellSelection;
}
/** Fields an event carries when the act began before the agent's answer it acts on was seen. */
interface BegunBeforeAnswerSeen {
  hasBegunBeforeAnswerWasSeen?: true;
}
/** The point a pointer event happened at, and what lay under it then. */
interface PointerAt extends PagePoint {
  madeOver?: ReturnType<typeof whatPointerWasOver>;
}

export interface KeyPressed extends KeyPress, BegunBeforeAnswerSeen {
  kind: 'keyPressed';
  today?: string;
  newSheetNameStem?: string;
  /** The key of the cell whose fix pill was seen long enough before the key was pressed. */
  pillOfFixSeen?: string | null;
  isReadLate?: true;
  caretInEntry?: CaretInEntry;
  hasWaitedForPeople?: boolean;
}
export interface PointerPressed extends PointerAt, BegunBeforeAnswerSeen {
  kind: 'pointerPressed';
  isShiftHeld: boolean;
  isModifierHeld: boolean;
  isByFinger: boolean;
  isToldOfLate?: boolean;
  isByMouse?: true;
  isOnBoxOfEntry?: boolean;
  onHandleOfTable?: string;
  onGripOfColumn?: CellId;
  caretInEntry?: CaretInEntry;
}
export interface PointerPressedTwice extends PointerAt, BegunBeforeAnswerSeen {
  kind: 'pointerPressedTwice';
  isByFinger: boolean;
  isUnhurried?: boolean;
  isToldOfLate?: boolean;
}
export interface PointerDragged extends PagePoint {
  kind: 'pointerDragged';
  isHeldStill?: true;
}
export interface PointerReleased {
  kind: 'pointerReleased';
  isPointerLost?: true;
}
export interface WheelTurned {
  kind: 'wheelTurned';
  deltaX: number;
  deltaY: number;
  isByFinger?: true;
  isPageForReader?: true;
}
export interface PointerRested {
  kind: 'pointerRested';
  at: PagePoint | null;
  link?: LinkCardAsked['link'];
}
export interface GridResized {
  kind: 'gridResized';
  width: number;
  height: number;
  pageWidth: number;
  heightUnderWhatFloats: number;
  heightUnderCardAtFoot: number;
  noticesAtFoot?: { left: number; heightUnderTheRest: number };
  boxesAtFootByTouch?: { left: number; right: number; heightUnder: number }[];
  isComposerOpen: boolean;
  zoom: number;
  isZoomAboutPointer: boolean;
  isOnPhone: boolean;
  isNarrowByTouch: boolean;
  isCoveredMoreByComposer: boolean;
  isCoveredMoreByKeyboard: boolean;
  isCoveredLessByKeyboard: boolean;
}
/** What is done to a chart or other view placed over the cells. */
export type PlacedViewAct =
  | { kind: 'select'; isByKey: boolean; isForAskBox?: boolean; hasJustArrived?: true }
  | { kind: 'leave'; isForCells: boolean }
  | { kind: 'takeHold'; at: GridPoint; sides: SelectionHandle | null; isByFinger: boolean }
  | { kind: 'moveByStep' | 'sizeByStep'; toward: 'up' | 'down' | 'left' | 'right' }
  | { kind: 'askForMenu'; at: GridPoint | null; canAgentChangeIt: boolean; isForNobody?: true }
  | { kind: 'delete'; isByKey: boolean };
/** An edit of the charts asked for: a chart of cells added, or a chart pointed at another node. */
export type ChartEditAsked =
  | { kind: 'add'; nodeId: string; name: string; cells: CellsHeldForChart }
  | { kind: 'pointAtOtherNode'; viewId: string; from: string; to: string; renaming: { from: string; to: string } | null };
export interface PlacedViewActedOn {
  kind: 'placedViewActedOn';
  placementId: string;
  act: PlacedViewAct;
}
export interface EditOfChartAsked {
  kind: 'editOfChartAsked';
  asked: ChartEditAsked;
  askId: number;
}
export interface ChartBeingMadeTold {
  kind: 'chartBeingMadeTold';
  nth: number;
  /** Where the chart is being placed (`topLeft` is an A1 address), or the id of its node once sent or added. */
  chart: { sheetId: SheetId; topLeft: string; kind: StockKind | 'any' } | { nodeSent: string } | { nodeAdded: string } | null;
}
export interface MenuAsked extends BegunBeforeAnswerSeen {
  kind: 'menuAsked';
  at: PagePoint | null;
  inContextBar?: { height: number; isByKey: boolean };
  isToSearch?: true;
  isForNobody?: boolean;
  isOnBoxOfEntry?: boolean;
  isByMouse?: boolean;
  madeOver?: PointerAt['madeOver'];
}
export interface FiguresAsked {
  kind: 'figuresAsked';
  at: PagePoint;
  height: number;
}
export interface MenuClosed {
  kind: 'menuClosed';
  onlyIfAskedAt?: PagePoint | null;
}
export interface CalendarClosed {
  kind: 'calendarClosed';
  ifStill?: CalendarOpen;
}
export interface DayChosen {
  kind: 'dayChosen';
  day: string;
  time?: TimeOfDay;
}
export interface TimeChosen extends TimeChosenInCalendar {
  kind: 'timeChosen';
}
export interface DropdownListRowChosen {
  kind: 'dropdownListRowChosen';
  key: string;
}
export interface DropdownEditorActedIn {
  kind: 'dropdownEditorActedIn';
  act: DropdownEditorAct;
  isBeforeKeep?: boolean;
}
export interface SidePaneShut {
  kind: 'sidePaneShut';
  isGivenUp?: true;
}
export interface WaysInOutOfSightChanged {
  kind: 'waysInOutOfSightChanged';
  are: boolean;
}
export interface WindowCaretChanged {
  kind: 'windowCaretChanged';
  hasCaret: boolean;
}
export interface ConditionalFormatsAsked {
  kind: 'conditionalFormatsAsked';
  by: string;
}
export interface RuleAskedInMenu {
  kind: 'ruleAskedInMenu';
  words: string;
  menuAt: PagePoint | null;
}
export interface RulesSuggestedInMenu {
  kind: 'rulesSuggestedInMenu';
  menuAt: PagePoint | null;
}
export interface ConditionalFormatsActedIn {
  kind: 'conditionalFormatsActedIn';
  act: RulesPaneAction;
}
export interface SortPaneAsked {
  kind: 'sortPaneAsked';
  of: 'sheet' | 'range';
  chosenIn?: ChosenIn;
}
export interface SortPaneActedIn {
  kind: 'sortPaneActedIn';
  act: SortPaneActSent;
}
export interface PivotTableAsked {
  kind: 'pivotTableAsked';
  nameOfNewSheet: string;
  chosenIn?: ChosenIn;
}
export interface PivotTableUpdateAsked {
  kind: 'pivotTableUpdateAsked';
  of: CellId;
}
export interface PickOfNamedView {
  kind: 'namedViewPicked';
  tableKey: string;
  namedViewId: string;
}
export interface NamedViewsChanged {
  kind: 'namedViewsChanged';
  tableKey: string;
  change: NamedViewChange;
}
export interface InteractiveWrote {
  kind: 'interactiveWrote';
  viewId: string;
  cells: CellWrittenFromAnInteractive[];
}
export interface CellsLinkedToAsked {
  kind: 'cellsLinkedTo';
  place: PlaceOfLink;
}
export interface CalculationBegan {
  kind: 'calculationBegan';
  /** The page's own view of a table being applied, when that is what is worked out. */
  ofOwnView?: OwnViewShownAsApplied;
}
/** An answer of the agent, or of the store, to the ask the page made under `askId`. */
interface AnswerToAsk {
  askId: number;
}
export interface AgentRepliedAboutConditionalFormats extends AnswerToAsk {
  kind: 'agentRepliedAboutConditionalFormats';
  reply: AgentReplyAboutRules;
}
export interface AgentForConditionalFormatsChecked {
  kind: 'agentForConditionalFormatsChecked';
  isAvailable: boolean;
}
/** What the person does in the version history pane or on the bar of a version looked at. */
export type VersionHistoryAct =
  | { kind: 'look'; revision: number }
  | { kind: 'endLook'; isFromBar?: true; isByPointer?: true }
  | { kind: 'restore'; revision: number; isFromBar?: true; isByPointer?: true }
  | { kind: 'showOlder' }
  | { kind: 'tryAgain' };
/** Why a version could not be shown; `'calledOff'` when the look was given up before it came. */
export type WhyVersionNotShown = 'calledOff' | 'editsNotSaved' | 'notOffered' | 'unknownRevision' | HistoryWhy;
/** The versions read from the store, or why they were not. */
export type VersionsReadOutcome =
  | { kind: 'read'; versions: VersionOfWorkbook[]; hasOlder: boolean }
  | { kind: 'notRead'; why: HistoryWhy };
/** The edits that take back what was done, read from the store, or why they were not. */
export type EditsThatTakeBackOutcome =
  | { kind: 'read'; builtOnRevision: number; edits: EngineRecordedEdit[] }
  | { kind: 'notRead'; why: 'unknownRevision' | 'changedSince' | 'tooMuch' | 'notAccepted' | HistoryWhy };
/** What a cell held at a version. */
export type HeldContent = { kind: 'nothing' } | { kind: 'written'; text: string } | { kind: 'number'; value: number };
/** One change in the history of a cell or row. */
export interface CellHistoryChange {
  revision: number;
  atMs: number;
  author: EditAuthor | null;
  cells: { columnId: ColumnId; held: HeldContent }[];
}
/** The history of a cell or row read from the store, or why it was not. */
export type CellHistoryOutcome =
  | { kind: 'read'; changes: CellHistoryChange[]; areEarlierLeftOut: boolean }
  | { kind: 'notRead'; why: 'cellIsGone' | 'answerIsTooLarge' | HistoryWhy };
/** What the agent changed in its turn: the cells of each sheet, and the runs of edits it made. */
export interface ChangedInTurnOfAgent {
  cellsBySheet: Map<SheetId, CellId[]> | null;
  edits: RevisionRun[] | null;
}
/** What the agent asks the viewer to be shown: cells by address, in a sheet by name. */
export interface ShownByAgentAsk {
  at: string[];
  inSheet: string | null;
}
export interface VersionHistoryActedIn {
  kind: 'versionHistoryActedIn';
  act: VersionHistoryAct;
}
export interface VersionHistoryCarriedOn {
  kind: 'versionHistoryCarriedOn';
  pane: VersionHistoryInPane | null;
  kept: Pick<PageState, 'notesOfSteps' | 'rowsAddedAfterEntries' | 'stepsToUndo' | 'stepsToRedo' | 'profilesById' | 'newsOfLoss'>;
}
export interface VersionLookedAt extends AnswerToAsk {
  kind: 'versionLookedAt';
  whyNot: WhyVersionNotShown | null;
}
export interface VersionsRead extends AnswerToAsk {
  kind: 'versionsRead';
  read: VersionsReadOutcome;
}
export interface EditsThatTakeBackRead extends AnswerToAsk {
  kind: 'editsThatTakeBackRead';
  read: EditsThatTakeBackOutcome;
}
/** A place an edit changed, as rows and columns of its sheet; `area` is `null` when its cells are no longer there. */
export interface PlaceAreaChanged {
  sheetId: SheetId;
  placementId?: string;
  area: CellArea | null;
}
export interface TakeBackAnswered {
  kind: 'takeBackAnswered';
  askId: number;
  outcome: TakeBackOutcome;
  offerIfMade: VersionRestoredOffer | null;
}
export interface DensityChosen {
  kind: 'densityChosen';
  density: CellDensity;
}
export interface FindTextChanged {
  kind: 'findTextChanged';
  text: string;
  goesToCellFound: boolean;
}
export interface FindStepped {
  kind: 'findStepped';
  by: number;
}
export interface ReplaceShownChanged {
  kind: 'replaceShownChanged';
  isShown: boolean;
}
export interface FindOptionsChanged {
  kind: 'findOptionsChanged';
  within?: 'sheet' | 'allSheets' | 'selectedCells';
  matchesCase?: boolean;
  isWholeCell?: boolean;
  isInFormulas?: boolean;
}
export interface ReplaceChosen {
  kind: 'replaceChosen';
  text: string;
  where: 'cellFound' | 'everyCell';
}
export interface EditTextChanged {
  kind: 'editTextChanged';
  text: string;
  typingIn: 'cell' | 'formulaBar';
  looks?: EntryLooks;
  stepInHistory?: StepInLooksHistory;
  caretAt?: number;
  caretAfterSignsRead?: number;
  isNotTyped?: boolean;
  isOfHistory?: boolean;
  areSignsPutBack?: boolean;
  isInBoxOfOneLine?: boolean;
}
export interface CellEntryTyped {
  kind: 'cellEntryTyped';
  text: string;
  isOpenToOffer: boolean;
}
/** Words offered to finish what is typed in a cell. */
interface WordsOffered {
  cellId: CellId;
  typed: string;
  offered: string;
}
export interface WordsOfferedShown extends WordsOffered {
  kind: 'wordsOfferedShown';
  isWithNoKey?: true;
}
export interface WordsOfferedPressed extends WordsOffered {
  kind: 'wordsOfferedPressed';
}
export interface WordsOfferedWithdrawn {
  kind: 'wordsOfferedWithdrawn';
  isOutOfView?: true;
}
export interface FocusCameBack {
  kind: 'focusCameBack';
  asItLeft: boolean;
}
export interface EntryOfPageBeforeFound {
  kind: 'entryOfPageBeforeFound';
  entry: Parameters<typeof restoreEntryOfPageBefore>[1];
}
export interface FocusLost {
  kind: 'focusLost';
  mayComeBack: boolean;
  isOfWindow?: boolean;
}
export interface EntryLeft {
  kind: 'entryLeft';
  isForToolAboutWholeCells?: true;
  caretInEntry?: CaretInEntry;
}
export interface NoticeDismissed {
  kind: 'noticeDismissed';
  notice: Notice | NewsOfLoss;
}
export interface ErrorsAtOpeningPutAway {
  kind: 'errorsAtOpeningPutAway';
  sheetId: SheetId;
}
export interface UndoOfStepAsked {
  kind: 'undoOfStepAsked';
  step: string;
}
export interface UndoOrRedoChosen {
  kind: 'undoOrRedoChosen';
  direction: 'undo' | 'redo';
}
export interface ColumnWidthChosen {
  kind: 'columnWidthChosen';
  widthInPixels: number | 'fitToText' | null;
}
export interface RowHeightChosen {
  kind: 'rowHeightChosen';
  chosen: ChosenRowHeight | null;
}
export interface CellsToSortChosen {
  kind: 'cellsToSortChosen';
  chosen: 'selection' | 'table' | null;
  isWithNoKeyboard?: true;
}
export interface SheetChangeChosen {
  kind: 'sheetChangeChosen';
  change: SheetChange;
  chosenIn?: 'toolbar';
  isWithNoKeyboard?: true;
}
export interface FreezeChosen {
  kind: 'freezeChosen';
  what: LinesAxisName;
  count: number;
}
export interface FigureChosen {
  kind: 'figureChosen';
  figure: string;
  chosenIn?: 'toolbar';
}
export interface ColumnToSortByChosen {
  kind: 'columnToSortByChosen';
  columnId: ColumnId;
  isWithNoKeyboard?: true;
}
export interface GroupMarkPressed {
  kind: 'groupMarkPressed';
  of: LinesAxisName;
  groupIds: readonly string[];
  isToCollapse: boolean;
}
export interface GroupLevelChosen {
  kind: 'groupLevelChosen';
  of: LinesAxisName;
  level: number;
  chosenIn?: ChosenIn;
}
export interface RowsPutOutOfViewByOwnFilters {
  kind: 'rowsPutOutOfViewByOwnFilters';
  sheetId: SheetId;
  rowIds: Set<RowId>;
}
export interface OwnFilterAsked {
  kind: 'ownFilterAsked';
  chosenIn: 'menu';
}
export interface OwnFilterByCellChosen {
  kind: 'ownFilterByCellChosen';
  keeps: 'only' | 'allBut';
  chosenIn: 'menu';
}
export interface OwnFilterLineRemoved {
  kind: 'ownFilterLineRemoved';
  tableKey: string;
  lineIndex: number;
}
export interface OwnSortRemoved {
  kind: 'ownSortRemoved';
  tableKey: string;
}
export interface OwnSortMadeForEveryone {
  kind: 'ownSortMadeForEveryone';
  tableKey: string;
  isWithNoKeyboard?: true;
}
export interface OwnRowOrderSeen {
  kind: 'ownRowOrderSeen';
  sheetId: SheetId;
  staysAt: StaysAt;
}
export interface OwnFiltersCleared {
  kind: 'ownFiltersCleared';
  of: { tableKey: string } | { sheetId: SheetId };
  chosenIn?: ChosenIn;
}
export interface OwnFiltersRefreshed {
  kind: 'ownFiltersRefreshed';
  sheetId: SheetId;
}
export interface OwnFiltersLookedAtAgain {
  kind: 'ownFiltersLookedAtAgain';
  sheetId: SheetId;
}
export interface OwnFilterListAsked {
  kind: 'ownFilterListAsked';
  tableKey: string;
  c: ColumnId;
  today: string;
}
/** What the person does in the list of a column's own filter. */
export type OwnFilterListAct =
  | { kind: 'giveUp' }
  | { kind: 'tick'; index: number }
  | { kind: 'tickAll' }
  | { kind: 'tickNone' }
  | { kind: 'type'; words: string; blank: string }
  | { kind: 'pointAt'; row: string | null }
  | { kind: 'take'; row: string }
  | { kind: 'addCondition'; key: number }
  | { kind: 'changeCondition'; key: number; held: OwnFilterConditionHeld }
  | { kind: 'removeCondition'; key: number }
  | { kind: 'joinConditions'; by: 'and' | 'or' }
  | { kind: 'removeLine'; lineIndex: number };
/** The rows asked for in words, as the agent's answer was read: a filter, and the columns to sort by. */
export interface RowsAsked {
  filter: Filter | null;
  sortBy: SortKeyOfColumn[];
}
/** What the person does on the card that asks for rows in words. */
export type RowsAskedForAct =
  | { kind: 'giveUp'; leavesFilterOn?: true }
  | { kind: 'customSort'; of: 'sheet' | 'range' }
  | { kind: 'type'; words: string; today: string }
  /** `isColumnFound` is left out when the card rests on its own, after an answer of the agent came in. */
  | { kind: 'rest'; isRowPointedAt: boolean; isColumnFound?: boolean }
  | { kind: 'pointAt'; asked: RowsAsked | null }
  | { kind: 'take'; asked: RowsAsked; isWithNoKeyboard?: true }
  | { kind: 'takeNamedView'; namedViewId: string }
  | { kind: 'takeAnswer'; askOnShow: number | null; isWithNoKeyboard?: true };
export interface OwnFilterListActedIn {
  kind: 'ownFilterListActedIn';
  act: OwnFilterListAct;
}
export interface OwnFilterListSortChosen {
  kind: 'ownFilterListSortChosen';
  direction: SortDirection;
  isWithNoKeyboard?: true;
}
export interface RowsAskedForActedOn {
  kind: 'rowsAskedForActedOn';
  act: RowsAskedForAct;
}
export interface AgentRepliedWhichRowsAreAskedFor extends AnswerToAsk {
  kind: 'agentRepliedWhichRowsAreAskedFor';
  reply: NumberFormatReply | { kind: 'isYetToBeAllowed' };
}
export interface ViewerFound {
  kind: 'viewerFound';
  userId: string;
}
/** A sort key as kept with the own filters and asked of the agent: a column and its direction. */
export interface SortKeyOfColumn {
  c: ColumnId;
  direction: SortDirection;
}
/** Own filters kept in the browser for a table, read back when the workbook opens again. */
export interface KeptOwnFilter {
  cellTableId: string | null;
  cellTable: EngineCellTable;
  liveCellTable: EngineCellTable;
  table: FilterTableInIds;
  columns: ColumnOfATable[];
  filter: Filter | null;
  sortBy: SortKeyOfColumn[] | null;
  /** The saved view the filter was taken from, while it is still as the view has it. */
  namedViewInHand?: NamedViewInHand | null;
}
export interface OwnFiltersBroughtBack {
  kind: 'ownFiltersBroughtBack';
  kept: KeptOwnFilter[];
}
export interface MergeChangeChosenInToolbar {
  kind: 'mergeChangeChosenInToolbar';
  change: MergeAct;
}
export interface CheckboxesSetInToolbar {
  kind: 'checkboxesSetInToolbar';
  isChecking: boolean;
}
export interface CellFormatChosen {
  kind: 'cellFormatChosen';
  chosenIn: ChosenIn;
  choice: FormatCommand;
  caretInEntry?: CaretInEntry;
}
export interface BordersChosen {
  kind: 'bordersChosen';
  choice: BorderChoice;
  pen?: Partial<BorderLine>;
}
export interface BorderPenChanged {
  kind: 'borderPenChanged';
  change: Partial<PageState['borderPen']>;
}
export interface CustomNumberFormatTyped {
  kind: 'customNumberFormatTyped';
  pattern: string;
  isOfUndoOrRedo?: boolean;
}
export interface TypedInListOfNumberFormats {
  kind: 'typedInListOfNumberFormats';
  text: string;
}
export interface CustomNumberFormatEntered extends BegunBeforeAnswerSeen {
  kind: 'customNumberFormatEntered';
}
export interface AgentAskedForNumberFormat extends BegunBeforeAnswerSeen {
  kind: 'agentAskedForNumberFormat';
}
export interface AgentsAnswerSeen extends AnswerSeen {
  kind: 'agentsAnswerSeen';
  at: HoldOfAgentsAnswer;
}
export interface ActHeldAtAgentsAnswer extends BegunBeforeAnswerSeen {
  kind: 'actHeldAtAgentsAnswer';
  at: HoldOfAgentsAnswer;
}
export interface AgentRepliedWithANumberFormat extends AnswerToAsk {
  kind: 'agentRepliedWithANumberFormat';
  reply: NumberFormatReply;
}
/** A pick of the workbook's locale or time zone asked for; the time zone's comes with the browser's own. */
export type PickForWorkbookAsked = { kind: 'pickForWorkbookAsked' } & WorkbookSettingAsked;
export interface PickedForWorkbook {
  kind: 'pickedForWorkbook';
  of: 'locale' | 'timeZone';
  value: string;
}
export interface CellHistoryAsked {
  kind: 'cellHistoryAsked';
  chosenIn: 'menu';
}
export interface CellHistoryScopeChosen {
  kind: 'cellHistoryScopeChosen';
  scope: CellHistoryScope;
}
export interface CellHistoryRead extends AnswerToAsk {
  kind: 'cellHistoryRead';
  read: CellHistoryOutcome;
}
export interface AgentRepliedAboutImport extends AnswerToAsk {
  kind: 'agentRepliedAboutImport';
  reply: NumberFormatReply;
}
export interface AgentWroteOnAboutImport extends AnswerToAsk {
  kind: 'agentWroteOnAboutImport';
  written: unknown;
}
export interface ImportQuestionAnswered {
  kind: 'importQuestionAnswered';
  questionId: string;
  optionIndex: number;
}
/** Where a file is to be imported: a new sheet, or a sheet there is and how the rows go into it. */
export type ImportDestinationPick =
  | { kind: 'newSheet' }
  | { kind: 'sheet'; sheetId: SheetId; how: { kind: 'addRows' | 'replaceRows' } | { kind: 'mergeByKey'; keyColumnIndex: number } };
/** How a column of an import is read; import adds reading true and false to the engine's readings. */
export type ImportReading = ColumnReading | { kind: 'trueOrFalse' };
/** A change the person makes by hand to how a file is imported. */
export type ImportChangeByHand =
  | { kind: 'sheetName'; name: string }
  | { kind: 'headings'; line: number | null }
  | { kind: 'line'; line: number; isLeftOut: boolean }
  | { kind: 'column'; columnIndex: number; name?: string; reading?: ImportReading; isLeftOut?: boolean };
export interface ImportDestinationChosen {
  kind: 'importDestinationChosen';
  picked: ImportDestinationPick;
}
export interface ImportChangedByHand {
  kind: 'importChangedByHand';
  change: ImportChangeByHand;
}
export interface ImportKindsAskedFor {
  kind: 'importKindsAskedFor';
  columnIndex: number;
}
export interface ImportWishSent {
  kind: 'importWishSent';
  wish: string;
}
export interface ImportAskedByHost {
  kind: 'importAskedByHost';
  isByKey: boolean;
}
export interface ImportConfirmed {
  kind: 'importConfirmed';
  plansHeardCount: number;
}
export interface ImportEscaped {
  kind: 'importEscaped';
  isWishTyped?: boolean;
}
export interface PeopleListRowChosen {
  kind: 'peopleListRowChosen';
  row: string;
}
export interface PersonRemovedFromField {
  kind: 'personRemovedFromField';
  userId: string;
}
export interface CardAskedByRestingPointer {
  kind: 'cardAskedByRestingPointer';
  ofRow: string;
}
export interface CardOfOptionAsked {
  kind: 'cardOfOptionAsked';
  optionId: string;
}
export interface CardRowChosen {
  kind: 'cardRowChosen';
  row: string | null;
}
export interface OptionsNamedInList extends OptionsNamedInDropdown {
  kind: 'optionsNamedInList';
}
export interface OptionMovedInList extends OptionMovedInDropdown {
  kind: 'optionMovedInList';
}
export interface TimeListRowChosen {
  kind: 'timeListRowChosen';
  row: number;
}
export interface TimeListRowPointedAt {
  kind: 'timeListRowPointedAt';
  row: number;
}
export interface EntryCaretMoved {
  kind: 'entryCaretMoved';
  text: string;
  start: number;
  end: number;
}
export interface EntryLooksChanged {
  kind: 'entryLooksChanged';
  looks: EntryLooks;
}
/** An address pasted over words of the entry, to link the words to it. */
export interface AddressPastedOverWords extends LinkOverWords {
  kind: 'addressPastedOverWords';
  text: string;
  caretAt: number;
}
export interface BoxOfLinePressedInEntry {
  kind: 'boxOfLinePressedInEntry';
  line: number | undefined;
}
export interface BoxOfLinePressedInCell {
  kind: 'boxOfLinePressedInCell';
  paragraph: number;
}
/** A row chosen in the function list: a function by its name, or a column by its id. */
export type FunctionListRowChosen = { kind: 'functionListRowChosen' } & FunctionListPick;
export interface FormulaOfferRowChosen {
  kind: 'formulaOfferRowChosen';
  row: keyof typeof FORMULA_OFFER_ROW_IDS;
}
export interface FormulaReadToBeWorkedOut {
  kind: 'formulaReadToBeWorkedOut';
  formula: string;
}
export interface FormulaOfferDrawn {
  kind: 'formulaOfferDrawn';
  isDrawn: boolean;
  hasRested?: true;
}
export interface FormulaOfAgentKept {
  kind: 'formulaOfAgentKept';
  /** The formula of the fix kept, when one of several was kept. */
  fix?: string;
}
export interface AgentForFormulasChecked {
  kind: 'agentForFormulasChecked';
  isAvailable: boolean;
}
export interface AgentRepliedWithAFormula extends AnswerToAsk {
  kind: 'agentRepliedWithAFormula';
  reply: NumberFormatReply;
}
export interface AgentRepliedWithAFix extends AnswerToAsk {
  kind: 'agentRepliedWithAFix';
  reply: NumberFormatReply;
}
export interface PeopleFound {
  kind: 'peopleFound';
  searchedFor: string;
  people: ProfileOfPerson[];
}
export interface OffersUnderAtRead {
  kind: 'offersUnderAtRead';
  offers: AtMenuOffer[];
}
export interface PeopleLookedUp {
  kind: 'peopleLookedUp';
  askedAbout: string[];
  profiles: ProfileOfPerson[];
}
export interface TablesRead {
  kind: 'tablesRead';
  tablesRead?: TablesReadOfSheets;
}
export interface FormatAsTableChosen {
  kind: 'formatAsTableChosen';
  chosenIn: 'menu';
  isOn: boolean;
  kept: TableNotFormatted[] | null;
}
export interface SelectionsOfOthersChanged {
  kind: 'selectionsOfOthersChanged';
  selections: HeardSelection[];
  atMs: number;
}
export interface SheetChosen {
  kind: 'sheetChosen';
  sheetId: SheetId;
  canPoint?: boolean;
  isPickedInList?: true;
  caretInEntry?: CaretInEntry;
}
export interface CellsGoneTo {
  kind: 'cellsGoneTo';
  area: CellArea;
}
export interface SheetAddChosen {
  kind: 'sheetAddChosen';
  nameStem: string;
}
export interface FileToImportRead {
  kind: 'fileToImportRead';
  filename: string;
  delimiter: ImportDelimiter;
  rows: string[][];
  words: ImportReadingWords;
}
export interface FileToImportNotRead {
  kind: 'fileToImportNotRead';
  why: 'tooLarge' | 'notText' | 'notRead' | 'excelFileDropped' | 'folder';
}
export interface SheetDuplicateChosen {
  kind: 'sheetDuplicateChosen';
  sheetId: SheetId;
  wordsAroundName: { beforeName: string; afterName: string };
}
export interface ChartNodesCopied {
  kind: 'chartNodesCopied';
  copiedFor: ChartNodesCopiedFor;
  copies: ChartNodeCopies;
}
export interface ChartNodesLongInBeingCopied {
  kind: 'chartNodesLongInBeingCopied';
  copiedFor: ChartNodesCopiedFor['kind'];
}
export interface XlsxFileSaved extends SavedXlsxFile {
  kind: 'xlsxFileSaved';
}
/** An event about one sheet, chosen on its tab or in a menu. */
interface OfSheet {
  sheetId: SheetId;
}
export interface SheetDeleteChosen extends OfSheet {
  kind: 'sheetDeleteChosen';
}
export interface SheetRenameChosen extends OfSheet {
  kind: 'sheetRenameChosen';
}
export interface SheetMoveChosen extends OfSheet {
  kind: 'sheetMoveChosen';
  toIndex: number;
}
export interface SheetLinkCopyChosen {
  kind: 'sheetLinkCopyChosen';
  sheetId: SheetId | null;
}
export interface SheetLinkCopyAnswered {
  kind: 'sheetLinkCopyAnswered';
  whyNot: CopyLinkOutcome;
}
export interface SheetNameTyped {
  kind: 'sheetNameTyped';
  text: string;
}
export interface SheetNameLeft {
  kind: 'sheetNameLeft';
  mayComeBack?: boolean;
}
export interface CopyChosen {
  kind: 'copyChosen';
  token?: string;
}
export interface CutChosen {
  kind: 'cutChosen';
  token: string;
}
export interface CopyRefused {
  kind: 'copyRefused';
  asked: string;
  keyInstead: 'sameInAMoment' | 'command' | 'control' | null;
}
export interface PasteChosen {
  kind: 'pasteChosen';
  cutToken: string | null;
  copiedCellsAsText: string | null;
  /** Set when the cells copied had formulas that the copy carries only as their results. */
  areFormulasLeftOut?: true;
  ofAnotherProgram: CellsOfAnotherProgram | null;
  valuesOfCopiedCells: { copiedCellsAsAnswered: string | null; values: ValuesOfACopy } | null;
  localeOfTexts: string | null;
  text: string;
  pastedTextIs: PastedTextIs;
  markdownIs?: 'wordsAlone' | 'read';
  isPlainText: boolean;
  landsOnce?: boolean;
}
export interface ChartPasteChosen {
  kind: 'chartPasteChosen';
  chart: ChartOnClipboard;
}
export interface PasteThatWaitsAnswered {
  kind: 'pasteThatWaitsAnswered';
  nth: number;
  isToBePasted: boolean;
}
export interface WorkbookChanged {
  kind: 'workbookChanged';
  readsBefore: ReadsWithTextMeasurer;
  isUnasked: boolean;
  tablesRead?: TablesReadOfSheets;
}
export interface FormulasWorkedOut {
  kind: 'formulasWorkedOut';
  readsBefore: ReadsWithTextMeasurer;
  tablesRead?: TablesReadOfSheets;
}
export interface TextMeasuredAnew {
  kind: 'textMeasuredAnew';
  readsBefore: ReadsWithTextMeasurer;
}
export interface EditsDropped {
  kind: 'editsDropped';
  isPartKept?: boolean;
  why?: NonNullable<WhyRefused>;
}
export interface AskOwedToAgentGivenUp {
  kind: 'askOwedToAgentGivenUp';
  by: 'person' | 'time';
}
export interface SavingChanged {
  kind: 'savingChanged';
  saving: SavingState;
  hasUnsavedEdits: boolean;
  unsavedEditCount: number;
}
export interface FixesKept extends BegunBeforeAnswerSeen {
  kind: 'fixesKept';
}
export interface FixesEnded extends BegunBeforeAnswerSeen {
  kind: 'fixesEnded';
}
export interface FixActedOn extends BegunBeforeAnswerSeen {
  kind: 'fixActedOn';
  /** The key of the cell whose fix pill was acted on. */
  pillOf: string;
  act: 'kept' | 'discarded';
}
export interface FixKeptAnswered {
  kind: 'fixKeptAnswered';
  cellId: CellId;
}
export interface FixPointedAt {
  kind: 'fixPointedAt';
  at: GridPoint | null;
}
export interface FormulasLeftChanged {
  kind: 'formulasLeftChanged';
  areLeft: boolean;
}
export interface CauseOfErrorRead {
  kind: 'causeOfErrorRead';
  of: CellId | null;
}
export interface AgentActivityChanged extends PersonAtWork {
  kind: 'agentActivityChanged';
  isWorking: boolean;
  changedInTurn?: ChangedInTurnOfAgent;
  isSheetJustMade?: true;
  isAsSpreadsheetOpens?: true;
  hasShellAnswered?: true;
}
/** Fields told when the person is at work in the page as the agent's work comes in. */
interface PersonAtWork {
  isPersonAtWorkInPage?: true;
}
/** A change the agent made, as it arrives to be marked on the cells. */
export interface ChangeArrivedFromAgent extends CellsChangedInSheet {
  revision: number;
  fadeBeginsAtMs: number | null;
  isOfViewer?: true;
  isOfLayoutAlone?: true;
  /** The same change in other sheets. */
  inOtherSheets?: CellsChangedInSheet[];
  /** The chart the edit placed, if it placed one. */
  chart?: PlacementOnGrid;
  /** The first revision of the run of changes this one belongs to. */
  inRunSince?: number;
}
export interface ChangesByAgentChanged extends PersonAtWork {
  kind: 'changesByAgentChanged';
  changes: ChangeArrivedFromAgent[];
}
export interface FollowAsked {
  kind: 'followAsked';
  tabKey: string | null;
  userId: string | null;
}
export interface ViewShownByAgentChanged extends PersonAtWork {
  kind: 'viewShownByAgentChanged';
  shown: ShownByAgentAsk | null;
}
export interface WorkShownLongEnough {
  kind: 'workShownLongEnough';
  wait: Wait;
}
export interface ContextBarMenuChanged {
  kind: 'contextBarMenuChanged';
  menu: string;
  isOpen: boolean;
  /** The table key the filter bar is for, `''` to guess the table, or the cell it was opened at. */
  ofFilterBarFor?: string | CellAt;
}
export interface LinkCardLeftByPointer {
  kind: 'linkCardLeftByPointer';
  cardOf: string | null;
  isDoneWith?: true;
}
export interface OtherThanCellsCopied {
  kind: 'otherThanCellsCopied';
  ofChart?: 'notCut' | 'copied';
}
export interface LinkCardAsked {
  kind: 'linkCardAsked';
  at: PagePoint | null;
  link?: {
    address: string;
    inCell: CellPosition;
    box: { width: number; height: number; x: number; y: number };
    scroll: { scrollLeft: number; scrollTop: number };
  };
}
export interface LinkEditChosen {
  kind: 'linkEditChosen';
  address: string;
}
export interface LinkFormAsked {
  kind: 'linkFormAsked';
  caretInEntry?: CaretInEntry;
}
export interface LinkGiven {
  kind: 'linkGiven';
  text: string;
  address: string;
}
export interface LinkRemoveChosen {
  kind: 'linkRemoveChosen';
  cardOf: string;
  address?: string;
}
/** An event about the card of a cell's error. */
interface OfErrorCard {
  cardOf: string;
}
export interface FixOfErrorAsked extends OfErrorCard {
  kind: 'fixOfErrorAsked';
}
export interface FixInPlaceAsked {
  kind: 'fixInPlaceAsked';
  /** The error card the fix is asked from, or none when it is asked for the cell being entered. */
  cardOf: string | null;
}
export interface ErrorCardPutAway extends OfErrorCard {
  kind: 'errorCardPutAway';
}
export interface CommentModeChanged {
  kind: 'commentModeChanged';
  isOn: boolean;
  /** `false` when the comment mode is the host's, not the page's own tool for picking cells. */
  isToolForEditors?: boolean;
}
export interface CommentModeLeftByPress {
  kind: 'commentModeLeftByPress';
  isReleased: boolean;
}
export interface CommentsPointedAt {
  kind: 'commentsPointedAt';
  handles: string[];
}
/** A comment as the shell lists it to the page. */
export interface CommentListed {
  handle: string;
  anchor: string;
  isResolved: boolean;
  isOpen: boolean;
}
export interface CommentsTold {
  kind: 'commentsTold';
  listed: CommentListed[];
  /** The anchor of the open comment box, if one is open. */
  boxAnchor: string | null;
  sentToAgent?: string;
  repliedTo?: string[];
}
export interface CommentChosen {
  kind: 'commentChosen';
  isForAgent?: true;
  chosenIn?: 'menu';
}
export interface CommentMarkPressed {
  kind: 'commentMarkPressed';
  handle: string;
}
export interface CommentPicked {
  kind: 'commentPicked';
  handle: string;
  isByPreview?: true;
}
export interface CaretAtEndChanged {
  kind: 'caretAtEndChanged';
  at: CaretAtEnd | null;
}
export interface LinesAtEndAsked {
  kind: 'linesAtEndAsked';
  what: 'rows' | 'columns';
  count: number;
  countSeen: number;
}
/** An edit that may leave formulas without the cells they read. */
export type ActThatMayLoseFormulas =
  | { kind: 'cellsKeepWhatTheyHold'; sheetId: SheetId }
  | { kind: 'sorted'; sheetId: SheetId; area: CellArea; keyColumnIndexes: number[] };
/** Told with the answer to an edit that may lose formulas: the act, the word for it, and the workbook before it. */
export interface LossOfFormulasToTell {
  act: ActThatMayLoseFormulas;
  word: 'delete' | 'move' | 'sort';
  reads: WorkbookReads;
}
export interface EditAnswered extends Omit<QueueEditEffect, 'kind' | 'ifQueued'> {
  kind: 'editAnswered';
  outcome: EditOutcome;
  before?: LossOfFormulasToTell;
  ifQueued: IfQueued;
}
export interface UndoOrRedoAnswered extends Omit<UndoOrRedoEffect, 'kind'> {
  kind: 'undoOrRedoAnswered';
  outcome: UndoOrRedoOutcome;
}

/** Every event the page's reducers hear, told by the page, the controller or the workbook. */
export type PageEvent =
  | KeyPressed
  | PointerPressed
  | PointerPressedTwice
  | PointerDragged
  | PointerReleased
  | { kind: 'pointerCanceled' }
  | WheelTurned
  | PointerRested
  | GridResized
  | PlacedViewActedOn
  | EditOfChartAsked
  | ChartBeingMadeTold
  | MenuAsked
  | FiguresAsked
  | { kind: 'figuresOfSelectionDue' }
  | { kind: 'costsInMenuAsked' }
  | { kind: 'tableToSortAsked' }
  | MenuClosed
  | CalendarClosed
  | DayChosen
  | TimeChosen
  | DropdownListRowChosen
  | DropdownEditorActedIn
  | { kind: 'dropdownShut' }
  | SidePaneShut
  | { kind: 'waysInWaitedFor' }
  | { kind: 'waysInSentAway' }
  | WaysInOutOfSightChanged
  | WindowCaretChanged
  | { kind: 'sidePaneToggled' }
  | ConditionalFormatsAsked
  | RuleAskedInMenu
  | RulesSuggestedInMenu
  | { kind: 'ruleInMenuLetGo' }
  | ConditionalFormatsActedIn
  | SortPaneAsked
  | { kind: 'whomSortsAreForAsked' }
  | SortPaneActedIn
  | PivotTableAsked
  | PivotTableUpdateAsked
  | PivotTablePaneActedIn
  | AgentRepliedAboutConditionalFormats
  | AgentForConditionalFormatsChecked
  | { kind: 'versionHistoryAsked' }
  | VersionHistoryActedIn
  | { kind: 'versionsLookedAtAgain' }
  | VersionHistoryCarriedOn
  | VersionLookedAt
  | VersionsRead
  | EditsThatTakeBackRead
  | TakeBackAnswered
  | { kind: 'formulasShownToggled' }
  | DensityChosen
  | { kind: 'findOpened' }
  | FindTextChanged
  | FindStepped
  | { kind: 'findLookedAgain' }
  | { kind: 'findClosed' }
  | ReplaceShownChanged
  | FindOptionsChanged
  | ReplaceChosen
  | EditTextChanged
  | CellEntryTyped
  | WordsOfferedShown
  | WordsOfferedWithdrawn
  | WordsOfferedPressed
  | FocusCameBack
  | EntryOfPageBeforeFound
  | { kind: 'pageMayBeEnded' }
  | FocusLost
  | EntryLeft
  | { kind: 'sheetListOpened' }
  | { kind: 'caretPlacedInEntry' }
  | { kind: 'entryExpandedOrCollapsed' }
  | { kind: 'expandedEntryFinished' }
  | { kind: 'entryGivenBoxOfItsOwn' }
  | NoticeDismissed
  | ErrorsAtOpeningPutAway
  | { kind: 'fixOfErrorsAtOpeningAsked' }
  | { kind: 'fixesOfErrorsAtOpeningAsked' }
  | { kind: 'fixesOfSelectedCellsAsked' }
  | { kind: 'undoOfferTaken' }
  | UndoOfStepAsked
  | UndoOrRedoChosen
  | { kind: 'undoOfferDismissed' }
  | { kind: 'undoOfTurnTaken' }
  | { kind: 'undoOfTurnDismissed' }
  | ColumnWidthChosen
  | RowHeightChosen
  | CellsToSortChosen
  | SheetChangeChosen
  | FreezeChosen
  | FigureChosen
  | ColumnToSortByChosen
  | GroupMarkPressed
  | GroupLevelChosen
  | RowsPutOutOfViewByOwnFilters
  | OwnFilterAsked
  | OwnFilterByCellChosen
  | OwnFilterLineRemoved
  | OwnSortRemoved
  | OwnSortMadeForEveryone
  | PickOfNamedView
  | NamedViewsChanged
  | OwnRowOrderSeen
  | OwnFiltersCleared
  | OwnFiltersRefreshed
  | OwnFiltersLookedAtAgain
  | OwnFilterListAsked
  | { kind: 'ownFilterListShut' }
  | OwnFilterListActedIn
  | OwnFilterListSortChosen
  | RowsAskedForActedOn
  | AgentRepliedWhichRowsAreAskedFor
  | ViewerFound
  | OwnFiltersBroughtBack
  | MergeChangeChosenInToolbar
  | CheckboxesSetInToolbar
  | CellFormatChosen
  | BordersChosen
  | BorderPenChanged
  | { kind: 'gridlinesToggled' }
  | InteractiveWrote
  | { kind: 'interactiveResetChosen' }
  | { kind: 'interactiveSaveAsDefaultChosen' }
  | CustomNumberFormatTyped
  | TypedInListOfNumberFormats
  | CustomNumberFormatEntered
  | { kind: 'customNumberFormatDropped' }
  | { kind: 'customNumberFormatEscaped' }
  | AgentAskedForNumberFormat
  | AgentsAnswerSeen
  | ActHeldAtAgentsAnswer
  | AgentRepliedWithANumberFormat
  | PickForWorkbookAsked
  | PickedForWorkbook
  | { kind: 'pickForWorkbookEntered' }
  | { kind: 'pickForWorkbookDropped' }
  | { kind: 'listOfKeysAsked' }
  | { kind: 'listOfKeysShut' }
  | CellHistoryAsked
  | CellHistoryScopeChosen
  | { kind: 'cellHistoryAskedAgain' }
  | { kind: 'cellHistoryLookedAtAgain' }
  | { kind: 'cellHistoryShut' }
  | CellHistoryRead
  | AgentRepliedAboutImport
  | AgentWroteOnAboutImport
  | ImportQuestionAnswered
  | ImportDestinationChosen
  | ImportChangedByHand
  | ImportKindsAskedFor
  | ImportWishSent
  | { kind: 'importPlanAskedAgain' }
  | { kind: 'importPlanAwaitedNoLonger' }
  | ImportAskedByHost
  | ImportConfirmed
  | { kind: 'importDropped' }
  | ImportEscaped
  | { kind: 'importKept' }
  | { kind: 'marksOfImportOver' }
  | PeopleListRowChosen
  | { kind: 'personAsked' }
  | PersonRemovedFromField
  | { kind: 'peopleListShut' }
  | CardAskedByRestingPointer
  | CardOfOptionAsked
  | CardRowChosen
  | OptionsNamedInList
  | { kind: 'newOptionNoLongerNamed' }
  | OptionMovedInList
  | { kind: 'cardShut' }
  | TimeListRowChosen
  | { kind: 'timeListShut' }
  | TimeListRowPointedAt
  | EntryCaretMoved
  | EntryLooksChanged
  | AddressPastedOverWords
  | BoxOfLinePressedInEntry
  | BoxOfLinePressedInCell
  | FunctionListRowChosen
  | { kind: 'functionListShut' }
  | FormulaOfferRowChosen
  | FormulaReadToBeWorkedOut
  | { kind: 'formulaOfferShut' }
  | { kind: 'wordsOfFormulaAskedBack' }
  | FormulaOfferDrawn
  | { kind: 'formulaOfAgentArrived' }
  | FormulaOfAgentKept
  | { kind: 'pressInListOfFormulaHeld' }
  | { kind: 'formulaAskStopped' }
  | AgentForFormulasChecked
  | AgentRepliedWithAFormula
  | AgentRepliedWithAFix
  | { kind: 'allFunctionsAskedFor' }
  | PeopleFound
  | OffersUnderAtRead
  | PeopleLookedUp
  | TablesRead
  | FormatAsTableChosen
  | SelectionsOfOthersChanged
  | SheetChosen
  | CellsGoneTo
  | CellsLinkedToAsked
  | SheetAddChosen
  | FileToImportRead
  | FileToImportNotRead
  | SheetDuplicateChosen
  | ChartNodesCopied
  | ChartNodesLongInBeingCopied
  | XlsxFileSaved
  | { kind: 'xlsxFileDialogShut' }
  | SheetDeleteChosen
  | SheetRenameChosen
  | SheetMoveChosen
  | SheetLinkCopyChosen
  | SheetLinkCopyAnswered
  | SheetNameTyped
  | { kind: 'sheetNameEntered' }
  | SheetNameLeft
  | { kind: 'sheetListShut' }
  | { kind: 'sheetRenameDropped' }
  | CopyChosen
  | CutChosen
  | CopyRefused
  | PasteChosen
  | ChartPasteChosen
  | PasteThatWaitsAnswered
  | WorkbookChanged
  | FormulasWorkedOut
  | TextMeasuredAnew
  | EditsDropped
  | AskOwedToAgentGivenUp
  | SavingChanged
  | { kind: 'fixOfErrorsAsked' }
  | { kind: 'errorsOfferPutAway' }
  | { kind: 'fixesInPlaceAsked' }
  | FixesKept
  | { kind: 'fixesKeptAnswered' }
  | FixesEnded
  | FixActedOn
  | FixKeptAnswered
  | FixPointedAt
  | CalculationBegan
  | { kind: 'calculationEnded' }
  | FormulasLeftChanged
  | CauseOfErrorRead
  | AgentActivityChanged
  | ChangesByAgentChanged
  | { kind: 'viewTakenBack' }
  | FollowAsked
  | ViewShownByAgentChanged
  | WorkShownLongEnough
  | { kind: 'contextBarLeftByKey' }
  | ContextBarMenuChanged
  | LinkCardLeftByPointer
  | { kind: 'linkAddressCopied' }
  | OtherThanCellsCopied
  | LinkCardAsked
  | LinkEditChosen
  | LinkFormAsked
  | { kind: 'linkFormShut' }
  | LinkGiven
  | LinkRemoveChosen
  | FixOfErrorAsked
  | FixInPlaceAsked
  | { kind: 'chatAskedAfterNoFix' }
  | { kind: 'noticeOfNoFixPutAway' }
  | ErrorCardPutAway
  | { kind: 'fillKeyPressedOutsideCells' }
  | { kind: 'steppedBackIntoCells' }
  | { kind: 'tabGoesOnFromCells' }
  | { kind: 'linkHeldByCommentMode' }
  | CommentModeChanged
  | CommentModeLeftByPress
  | CommentsPointedAt
  | CommentsTold
  | CommentChosen
  | CommentMarkPressed
  | CommentPicked
  | CaretAtEndChanged
  | { kind: 'endOfSheetLeftByKey' }
  | LinesAtEndAsked
  | EditAnswered
  | UndoOrRedoAnswered;
/** Why every edit is refused for now, when it is: the workbook's syncing, or an earlier version shown in its place. */
export type RefusalOfEveryEdit = RefusalOfSyncing | 'earlierVersionShown' | null;
/** What the reducers know of the workbook and its syncing as they hear an event. */
export interface PageContext {
  reads: ReadsWithTextMeasurer;
  revisionHeld: number | null;
  refusalOfEveryEdit: RefusalOfEveryEdit;
  areFormulasLeft: boolean;
  areReadsTheLatest: boolean;
  areEditsAnsweredLater: boolean;
  wasEventHeld: boolean;
}
/** What a menu holds open in place of its items. */
interface MenuHolding {
  holds: 'columnWidthField' | 'rowHeightField' | 'cellsToSort';
  cellsToSort?: CellsToSortAsked;
}
export function reduceSheetChangeChosen(
  state: PageState,
  menu: PageState['menu'],
  context: PageContext,
  change: SheetChange,
  isWithNoKeyboard: boolean,
): PageTransition {
  let { reads } = context;
  let openMenuHolding = (holds: MenuHolding) => withNoEffects(openMenuWith(state, reads, menu, holds));
  switch (change) {
    case 'resizeColumns':
      return openMenuHolding({
        holds: 'columnWidthField',
      });
    case 'resizeRows':
      return openMenuHolding({
        holds: 'rowHeightField',
      });
    case 'mergeCells':
    case 'unmergeCells':
      return mergeOrUnmergeSelection(state, reads, change);
    case 'convertTexts':
      return convertTextsToNumbers(state, reads);
    case 'moveRowsUp':
    case 'moveRowsDown':
    case 'moveColumnsLeft':
    case 'moveColumnsRight':
      return moveLinesByKey(state, reads, change);
    case 'deleteRows':
      return deleteSelectedRows(state, reads);
    case 'deleteColumns':
      return deleteSelectedLines(state, reads, change);
    case 'sortAscending':
    case 'sortDescending':
      return state.selectionSeen.shape === 'cell'
        ? sortTableFromMenu(state, reads, menu, change, isWithNoKeyboard)
        : sortSheetByColumn(state, reads, change, sortColumnOfMenu(menu, 'sheet'), isWithNoKeyboard);
    case 'sortRangeAscending':
    case 'sortRangeDescending': {
      let wideningChoice = rangeSortWideningChoice(state, reads);
      return wideningChoice === null
        ? sortRange(state, reads, change, 'selection', sortColumnOfMenu(menu, 'range'), isWithNoKeyboard)
        : openMenuHolding({
            holds: 'cellsToSort',
            cellsToSort: {
              change,
              ...wideningChoice,
            },
          });
    }
    case 'groupRows':
    case 'groupColumns':
    case 'ungroupRows':
    case 'ungroupColumns':
    case 'collapseRows':
    case 'collapseColumns':
    case 'expandRows':
    case 'expandColumns':
      return runOutlineCommand(state, context, change);
    case 'insertRowAbove':
    case 'insertRowBelow':
    case 'insertColumnLeft':
    case 'insertColumnRight':
      return insertRowsOrColumns(state, reads, change);
    case 'clearCells': {
      let clearHow: ClearHow = isWithNoKeyboard && !hasOtherRanges(state) ? 'menuWithNoKeyboard' : 'menu';
      return clearCellsOrDropdown(state, context, clearHow);
    }
  }
}
export function rebaseOpenListsOnScroll(stateBefore: PageState, state: PageState): PageState {
  let { scrollLeft, scrollTop, dropdown, peopleList } = state;
  if (scrollLeft === stateBefore.scrollLeft && scrollTop === stateBefore.scrollTop) return state;
  let scrollAsItOpened = {
    scrollLeft,
    scrollTop,
  };
  return {
    ...state,
    dropdown:
      dropdown === null
        ? null
        : {
            ...dropdown,
            scrollAsItOpened,
          },
    peopleList:
      peopleList === null
        ? null
        : {
            ...peopleList,
            scrollAsItOpened,
          },
  };
}
export function reduceChartNodesCopied(state: PageState, reads: WorkbookReads, { copiedFor, copies }: ChartNodesCopied): PageTransition {
  switch (copiedFor.kind) {
    case 'duplicateOfSheet':
      return finishDuplicateSheet(state, reads, copiedFor, copies);
    case 'pasteOfChart':
      return finishPasteOfChart(state, copiedFor, copies);
  }
}
export function reduceSheetsEvent(state: PageState, event: PageEvent, context: PageContext): PageTransition {
  let { reads, refusalOfEveryEdit } = context;
  let canChangeCells = refusalOfEveryEdit === null && !doesCommentModePick(state);
  let withSortForWhomAsked = (result: PageTransition, from: 'ofPane' | 'ofMenu'): PageTransition => {
    let sortPane = from === 'ofPane' ? sortOfSidePane(state) : null;
    let sortsWhat: 'sheet' | 'range' = event.kind === 'sheetChangeChosen' && !event.change.startsWith('sortRange') ? 'sheet' : 'range';
    let sortsFor = sortPane === null ? state.menu?.sortsFor?.[sortsWhat] : sortPane.sortsFor;
    let isForEveryone = sortPane?.isAskedForEveryone === true || sortsFor === 'everyone';
    let ownSort = isForEveryone ? null : ownSortOfSortStep(result, reads);
    if (!isForEveryone && sortsFor === 'oneself' && ownSort === null) {
      let whomFor = whomSortOfStepIsFor(result, reads);
      let paneOf = state.selectionSeen.shape === 'cell' ? 'range' : sortsWhat;
      if (whomFor !== null || result.state.menu?.holds === 'cellsToSort')
        return withNoEffects(
          sortPane === null
            ? openSortPane(state, reads, paneOf)
            : withSortPaneSortsFor(
                {
                  ...state,
                  menu: null,
                },
                whomFor,
              ),
        );
    }
    return ownSort === null
      ? result
      : declareCellTableOfNewFilter(result.state, keepActiveCellClearOfStuckHeaders(result.state, ownSort, reads), reads, canChangeCells);
  };
  let pointingResult = stepInSheetPointedIn(state, event, context);
  if (pointingResult !== null) return pointingResult;
  let draggingKind = state.dragging?.kind ?? 'selecting';
  let dragAnswer =
    draggingKind !== 'selecting' && draggingKind !== 'filling' && draggingKind !== 'pointing' && draggingKind !== 'tapping'
      ? eventEffectOnDrag(event)
      : 'partOfIt';
  if (dragAnswer === 'notHeard') return withNoEffects(state);
  let stopsMoveOfColumns = event.kind === 'keyPressed' || event.kind === 'pasteChosen' || event.kind === 'cutChosen';
  if (draggingKind === 'movingColumnsOfTable' && stopsMoveOfColumns) return withNoEffects(stopMovingColumnsOfTable(state));
  let current =
    dragAnswer !== 'letsGo'
      ? state
      : state.dragging?.kind === 'movingLines'
        ? endLinesDrag(state)
        : state.dragging?.kind === 'movingColumnsOfTable'
          ? stopMovingColumnsOfTable(state)
          : state.dragging?.kind === 'movingCells'
            ? cancelMovingCells(state, state.dragging, reads)
            : endDragKeepingScroll(state, reads);
  if ('chosenIn' in event && event.chosenIn === 'menu' && (current.menu === null || isMenuHoldingField(current.menu))) return withNoEffects(current);
  if (doesEventCloseTableHandleMenu(current, event))
    return withNoEffects({
      ...current,
      menu: null,
    });
  switch (event.kind) {
    case 'keyPressed':
      if (dragAnswer === 'letsGo' && event.key === 'Escape') return withNoEffects(current);
      {
        let isAnyModifierHeld = event.isShiftHeld || event.isModifierHeld || event.isAltHeld;
        let linkMoved = moveMarkedLink(current, reads, event.key, isAnyModifierHeld);
        if (linkMoved !== null) return withNoEffects(linkMoved);
        let fixKey =
          (!isAnyModifierHeld || (event.key === 'F2' && !event.isModifierHeld)) && !event.isRepeat ? fixKeyAction(current, reads, event) : null;
        if (fixKey !== null) {
          let fixKeyActed = actOnFixKey(current, reads, fixKey);
          if (fixKey.does !== 'keeps') return fixKeyActed;
          let keyStepped = stepKeyPressed(
            fixKeyActed.state,
            {
              ...event,
              key: 'ArrowDown',
            },
            context,
          );
          return {
            state: keyStepped.state,
            effects: [...fixKeyActed.effects, ...keyStepped.effects],
          };
        }
        if (event.key === 'Enter' && !isAnyModifierHeld && !event.isRepeat && canCommentModePickNow(current))
          return openCommentAtSelection(current, reads, false);
      }
      return stepKeyPressed(dropPressedCheckbox(withoutMarkedLink(current)), event, context);
    case 'pointerPressed': {
      if (canCommentModePickNow(current)) {
        let pressToComment = {
          ...withCalendarShut(current),
          pressesOnFillHandle: 0,
          isPressToComment: true,
        };
        let pressedOnGrid = pressOnGrid(
          pressToComment,
          {
            ...event,
            isModifierHeld: false,
          },
          reads,
        );
        return shutCommentsOnPress(pressToComment, event, pressedOnGrid, reads);
      }
      let fillDragByFinger = startFillDragByFinger(current, event, context);
      if (fillDragByFinger !== null) return withNoEffects(fillDragByFinger);
      let commentAtCorner = event.isByFinger && event.isToldOfLate === true ? commentAtSelectionCorner(current, event, context) : null;
      if (commentAtCorner !== null)
        return {
          state: goToCommentKeepingScroll(
            {
              ...current,
              calendar: null,
              dropdown: null,
              peopleList: null,
            },
            reads,
            commentAtCorner.handle,
          ),
          effects: [
            {
              kind: 'openComment',
              handle: commentAtCorner.handle,
            },
          ],
        };
      let isSelectionExtended = event.isShiftHeld || event.isModifierHeld === true;
      let listOpenedOnPress = openListOnPress(
        current,
        openCalendarOnLateTap(
          current,
          closePeopleListOnCellClick(
            current,
            toggleDropdownListOnClick(current, pointerPressedOnGrid(withCalendarShut(current), event, context), isSelectionExtended, reads),
            isSelectionExtended,
            reads,
          ),
          {
            ...event,
            isShiftHeld: isSelectionExtended,
          },
          {
            reads,
            canEdit: context.refusalOfEveryEdit === null,
          },
        ),
        {
          ...event,
          isShiftHeld: isSelectionExtended,
        },
        context,
      );
      let withEntryOpened = openEntryOnPress(
        current,
        listOpenedOnPress,
        {
          ...event,
          isShiftHeld: isSelectionExtended,
        },
        context,
      );
      let pressesOnFillHandle = withEntryOpened.state.dragging?.kind === 'filling' ? current.pressesOnFillHandle + 1 : 0;
      let withPressesCounted = {
        ...withEntryOpened,
        state: {
          ...withEntryOpened.state,
          pressesOnFillHandle,
        },
      };
      return shutCommentsOnPress(
        current,
        event,
        notePressedCheckbox(
          current,
          withPressesCounted,
          {
            ...event,
            isShiftHeld: isSelectionExtended,
          },
          context,
        ),
        reads,
      );
    }
    case 'pointerDragged':
      return withNoEffects(
        noteTableLeftItsPlace(markDriftFromTableHandle(pointerDraggedOnGrid(dropCheckboxIfPointerLeft(current, reads, event), event, reads), event)),
      );
    case 'pointerReleased': {
      let released = {
        ...current,
        dragging: null,
        isPressToComment: false,
      };
      if (current.isPressToComment && canCommentModePickNow(released) && current.dragging?.kind === 'selecting' && event.isPointerLost !== true)
        return openCommentAtSelection(released, reads, false);
      let checkboxToggled = toggleCheckboxOnRelease(current, released, context);
      if (checkboxToggled !== null) return checkboxToggled;
      if (current.dragging?.kind === 'resizing') {
        let { sizeInPixels, sizeAtPress } = current.dragging;
        return finishResizeDrag(
          {
            ...current,
            hasLastHeldEdgeMoved: sizeInPixels !== sizeAtPress,
          },
          current.dragging,
          context,
        );
      }
      if (current.dragging?.kind === 'movingLines') return finishMovingLines(current, current.dragging, context);
      if (current.dragging?.kind === 'movingColumnsOfTable')
        return event.isPointerLost === true
          ? withNoEffects(stopMovingColumnsOfTable(current))
          : dropMovedColumnsOfTable(current, current.dragging, context);
      if (current.dragging?.kind === 'movingCells') {
        if (event.isPointerLost === true) return withNoEffects(cancelMovingCells(current, current.dragging, reads));
        let cellsDropped = dropMovedCells(current, current.dragging, context);
        let tableHandleClick = tableHandleClicked(current.dragging);
        return tableHandleClick === null
          ? cellsDropped
          : {
              ...cellsDropped,
              state: openTableHandleMenu(cellsDropped.state, tableHandleClick, context),
            };
      }
      if (current.dragging?.kind === 'filling') return endFillDrag(current, context);
      if (current.dragging?.kind === 'freezing') return finishFreezeDrag(current, current.dragging, context);
      if (current.dragging?.kind === 'movingPlacedView' || current.dragging?.kind === 'sizingPlacedView')
        return dropPlacedView(current, current.dragging, context);
      return withNoEffects(
        current.dragging === null
          ? current
          : {
              ...current,
              dragging: null,
            },
      );
    }
    case 'pointerCanceled':
      return withNoEffects(
        current.dragging === null
          ? current
          : {
              ...current,
              dragging: null,
            },
      );
    case 'placedViewActedOn':
      return reducePlacedViewAct(current, event, context);
    case 'editOfChartAsked':
      return reduceEditOfChartAsked(current, context, event);
    case 'chartBeingMadeTold':
      return withNoEffects({
        ...current,
        chartBeingMade: chartBeingMadeTold(current, context.reads, event),
      });
    case 'menuAsked': {
      let menuOpened =
        event.at !== null && event.inContextBar !== undefined
          ? withNoEffects(openContextBarMenu(current, reads, event.at, event.inContextBar))
          : openContextMenu(current, event.at, reads, event.isToSearch);
      if (event.isForNobody === true)
        return menuOpened.state.menu !== current.menu
          ? {
              ...menuOpened,
              state: {
                ...menuOpened.state,
                menu: null,
              },
            }
          : menuOpened;
      return event.at !== null && event.inContextBar === undefined && current.dragging?.kind !== 'tapping'
        ? shutCommentsOnPress(current, event.at, menuOpened, reads)
        : menuOpened;
    }
    case 'figuresAsked': {
      if (current.mode.kind === 'editing' || !isSumWithFormulaCell(figuresOfSelection(current, reads))) return withNoEffects(current);
      let menuPlace = menuPlaceNear(current, event.at, event.height);
      return withNoEffects({
        ...current,
        menu: {
          ...menuPlace,
          isAskedByKey: false,
          holds: 'figures',
        },
      });
    }
    case 'figuresOfSelectionDue':
      return withNoEffects(current);
    case 'costsInMenuAsked':
      return withNoEffects(withSetMeetsInMenu(current, reads));
    case 'tableToSortAsked':
      return withNoEffects(withTableToSortInMenu(current, reads));
    case 'menuClosed':
      return withNoEffects(
        current.menu === null || isMenuHoldingField(current.menu) || (event.onlyIfAskedAt !== undefined && event.onlyIfAskedAt !== current.menu.at)
          ? current
          : {
              ...current,
              menu: null,
            },
      );
    case 'calendarClosed':
      return withNoEffects(event.ifStill === undefined || event.ifStill === current.calendar ? withCalendarShut(current) : current);
    case 'dayChosen':
      return pickDayInCalendar(current, reads, event.day, event.time ?? null);
    case 'timeChosen':
      return pickTimeInCalendar(current, reads, event);
    case 'dropdownListRowChosen':
      return current.dropdown !== null ? pickDropdownRow(current, reads, event.key, current.activeCell, 'pointer') : withNoEffects(current);
    case 'dropdownEditorActedIn': {
      let dropdownEditorActed = reduceDropdownEditor(current, reads, event.act);
      let commitEntry = event.isBeforeKeep === true ? commitEntryKeepingAgentsFormula : commitEntryInPlaceIfEditing;
      let entryCommitted = dropdownEditorActed.effects.length === 0 ? null : commitEntry(current, reads);
      if (entryCommitted === null) return dropdownEditorActed;
      let { state: editorState, effects: editorEffects } = reduceDropdownEditor(entryCommitted.state, reads, event.act);
      return {
        state: editorState,
        effects: [...entryCommitted.effects, ...editorEffects],
      };
    }
    case 'dropdownShut':
      return withNoEffects(closeDropdownList(current));
    case 'sidePaneShut':
      if ((versionHistoryOfPane(current)?.look ?? null) !== null)
        return event.isGivenUp === true ? withNoEffects(current) : toggleVersionHistory(current);
      return withNoEffects(isSidePaneShownAsPane(current) ? closeSidePane(current) : current);
    case 'waysInWaitedFor':
    case 'waysInSentAway':
      return withNoEffects(current);
    case 'waysInOutOfSightChanged':
      return withNoEffects(
        current.areWaysInOutOfSight === event.are
          ? current
          : {
              ...current,
              areWaysInOutOfSight: event.are,
            },
      );
    case 'windowCaretChanged':
      return withNoEffects(
        current.isWindowLeft === event.hasCaret
          ? {
              ...current,
              isWindowLeft: !event.hasCaret,
            }
          : current,
      );
    case 'sidePaneToggled':
      return withNoEffects(toggleDropdownPane(current, reads));
    case 'conditionalFormatsAsked':
      return withNoEffects(event.by === 'button' ? openConditionalFormatsAs(current, 'pane') : openConditionalFormatsPane(current));
    case 'ruleAskedInMenu':
      return askRulesFromMenuWords(current, reads, event.words, event.menuAt);
    case 'rulesSuggestedInMenu':
      return withNoEffects(showRulesInMenu(current, event.menuAt));
    case 'ruleInMenuLetGo':
      return withNoEffects(closeRulesMenu(current));
    case 'conditionalFormatsActedIn':
      return actInConditionalFormats(current, reads, event.act);
    case 'sortPaneAsked':
      return leaveRenamingOrEntry(current, reads) ?? withNoEffects(openSortPane(current, reads, event.of));
    case 'whomSortsAreForAsked': {
      let { menu } = current;
      let whomForChange = (change: SheetChange) =>
        whomSortOfStepIsFor(
          reduceSheetChangeChosen(
            {
              ...current,
              menu: null,
            },
            menu,
            context,
            change,
            false,
          ),
          reads,
        );
      return withNoEffects(
        menu?.holds === 'all'
          ? {
              ...current,
              menu: {
                ...menu,
                sortsFor: {
                  sheet: whomForChange('sortAscending'),
                  range: whomForChange('sortRangeAscending'),
                },
              },
            }
          : withSortPaneSortsFor(
              current,
              whomSortOfStepIsFor(
                actInSortPane(current, reads, {
                  kind: 'sort',
                }),
                reads,
              ),
            ),
      );
    }
    case 'sortPaneActedIn':
      if (event.act.kind !== 'sort') return actInSortPane(current, reads, event.act);
      return (
        commitEntryInPlaceIfEditing(current, reads) ??
        (context.areFormulasLeft ? withFormulasLeftToWorkOut(current, event) : withSortForWhomAsked(actInSortPane(current, reads, event.act), 'ofPane'))
      );
    case 'pivotTableAsked':
      return (
        leaveRenamingOrEntry(current, reads) ??
        (context.areFormulasLeft ? withFormulasLeftToWorkOut(current, event) : askForPivotTable(current, reads, event.nameOfNewSheet))
      );
    case 'pivotTableUpdateAsked':
      return (
        commitEntryInPlaceIfEditing(current, reads) ??
        (context.areFormulasLeft ? withFormulasLeftToWorkOut(current, event) : updatePivotTable(current, reads, event.of))
      );
    case 'pivotTablePaneActedIn':
      if (event.act.kind === 'type' || event.act.kind === 'dropTyped') return actInPivotTablePane(current, reads, event.act, event.of);
      return (
        commitEntryInPlaceIfEditing(current, reads) ??
        (context.areFormulasLeft
          ? withFormulasLeftToWorkOut(current, event)
          : actInPivotTablePane(settlePivotTablePane(current, reads, event, false), reads, event.act, event.of))
      );
    case 'agentRepliedAboutConditionalFormats':
      return takeAgentAnswerAboutRules(current, reads, event.askId, event.reply);
    case 'agentForConditionalFormatsChecked':
      return withNoEffects(
        current.hasViewNoAgentForRules === !event.isAvailable
          ? current
          : {
              ...current,
              hasViewNoAgentForRules: !event.isAvailable,
            },
      );
    case 'versionHistoryAsked':
      return leaveRenamingOrEntry(current, reads) ?? toggleVersionHistory(current);
    case 'versionHistoryActedIn':
      return versionHistoryActed(current, reads, event.act);
    case 'versionsLookedAtAgain':
      return refreshVersionHistory(current);
    case 'versionHistoryCarriedOn':
      return withNoEffects(carrySessionIntoState(current, event.pane, event.kept));
    case 'versionLookedAt':
      return versionLookAnswered(current, event.askId, event.whyNot);
    case 'versionsRead':
      return versionsAnswered(current, event.askId, event.read);
    case 'editsThatTakeBackRead':
      return editsThatTakeBackRead(current, reads, event.askId, event.read);
    case 'takeBackAnswered':
      return takeBackAnswered(current, reads, event);
    case 'formulasShownToggled':
      return withNoEffects(toggleFormulasShown(current));
    case 'densityChosen':
      return withNoEffects(
        event.density === current.density ? current : keepActiveCellInViewOnResize(current, viewWithDensity(current, reads, event.density), reads),
      );
    case 'findOpened':
      return withNoEffects(openFind(current, reads));
    case 'findTextChanged':
      return withNoEffects(changeFindText(current, event, reads));
    case 'findStepped':
      return withNoEffects(stepFindHit(current, event.by, reads));
    case 'findLookedAgain':
      return withNoEffects(refreshFindHits(current, reads));
    case 'findClosed':
      return withNoEffects(closeFind(current));
    case 'replaceShownChanged': {
      if (event.isShown && isModalOpen(current)) return withNoEffects(current);
      let isReplaceShown = event.isShown && refusalOfEveryEdit === null;
      let withoutSidePane = isReplaceShown && current.find !== null && isSidePaneShownAsPane(current) ? closeSidePane(current) : current;
      return withNoEffects(showFindReplace(withoutSidePane, isReplaceShown, reads));
    }
    case 'findOptionsChanged': {
      let { kind: _kind, ...findOptions } = event;
      return withNoEffects(changeFindOptions(current, findOptions, reads));
    }
    case 'replaceChosen':
      return replaceFound(current, context, event);
    case 'pointerPressedTwice': {
      if (canCommentModePickNow(current)) return withNoEffects(current);
      if (isPointOnSelectedPlacement(current, reads, event)) return withNoEffects(current);
      if (startFreezeDrag(current, event, context) !== null) return withNoEffects(current);
      let lineSizeReset = current.hasLastHeldEdgeMoved
        ? null
        : (resetRowHeightOnDoublePress(current, event, context) ?? fitColumnToTextOnDoublePress(current, event, context));
      if (lineSizeReset !== null) return lineSizeReset;
      let { state: pressedTwice, cellId: cellPressedTwice } = cellOfDoublePress(current, reads, event);
      if (current.mode.kind !== 'navigating') return withNoEffects(current);
      if (event.isByFinger && commentAtSelectionCorner(current, event, context) !== null) return withNoEffects(current);
      if (isPointOnFillHandle(current, event, context)) {
        if (event.isByFinger || current.pressesOnFillHandle < 2) return withNoEffects(current);
        return context.areFormulasLeft
          ? withFormulasLeftToWorkOut(current, event)
          : fillDownToTableEnd(
              {
                ...current,
                pressesOnFillHandle: 0,
              },
              context,
            );
      }
      let isCheckboxToggled =
        cellPressedTwice !== null && context.refusalOfEveryEdit === null && toggleableCheckboxValue(reads, anchorCellOf(reads, cellPressedTwice)) !== null;
      if (cellPressedTwice === null || isCheckboxToggled) return withNoEffects(current);
      let isEntryNotOpenedByPress =
        context.refusalOfEveryEdit !== null || doesCommentModePick(current) || doesCellOpenItsOwnOnPress(current, reads, cellPressedTwice);
      if (event.isUnhurried === true && isEntryNotOpenedByPress) return withNoEffects(current);
      if (fixAtCell(current, anchorCellOf(reads, cellPressedTwice)) !== null) return withNoEffects(current);
      let movedToCell = moveActiveCellTo(pressedTwice, reads, cellPressedTwice, 'pointer');
      let textToEdit = textToEditAt(movedToCell, reads, movedToCell.activeCell);
      if (!isPeopleCell(reads, movedToCell.activeCell)) return withNoEffects(startEntryEditing(movedToCell, reads, textToEdit, 'cell', 'pointer'));
      let withPeopleList = refreshPeopleList(movedToCell, reads);
      return withNoEffects(event.isByFinger ? startEntryEditing(withPeopleList, reads, '', 'cell', 'pointer') : withPeopleList);
    }
    case 'wheelTurned': {
      let { scrollLeft, scrollTop } = clampScrollWithFloats(
        {
          scrollLeft: current.scrollLeft + event.deltaX,
          scrollTop: current.scrollTop + event.deltaY,
        },
        layoutOfView(current, reads),
        current,
      );
      let isScrollUnchanged = scrollLeft === current.scrollLeft && scrollTop === current.scrollTop;
      let checkboxDropped = isScrollUnchanged && event.isByFinger !== true ? current : dropPressedCheckbox(current);
      if (isScrollUnchanged) return withNoEffects(checkboxDropped);
      let pagesTurnedForReader = current.pagesTurnedForReader + (event.isPageForReader === true ? 1 : 0);
      return withNoEffects({
        ...checkboxDropped,
        scrollLeft,
        scrollTop,
        pagesTurnedForReader,
        calendar: null,
      });
    }
    case 'gridResized': {
      let resized = {
        ...current,
        gridWidth: event.width,
        gridHeight: event.height,
        pageWidth: event.pageWidth ?? event.width,
        heightUnderWhatFloats: event.heightUnderWhatFloats,
        heightUnderCardAtFoot: event.heightUnderCardAtFoot ?? 0,
        noticesAtFoot: event.noticesAtFoot ?? null,
        isComposerOpen: event.isComposerOpen ?? false,
        zoom: event.zoom ?? 1,
        isOnPhone: event.isOnPhone ?? false,
        isNarrowByTouch: event.isNarrowByTouch ?? false,
        boxesAtFootByTouch: event.boxesAtFootByTouch ?? NO_BOXES_AT_FOOT,
      };
      let roomGivenBack = event.isZoomAboutPointer === true ? resized : giveBackScrollForMoreRoom(current, resized, reads);
      let caretFollowed = followCaretAtEnd(current, clampScrollOfView(roomGivenBack, reads), reads);
      if (current.mode.kind !== 'editing') {
        let isComposerOverNotices =
          event.isCoveredMoreByComposer === true &&
          current.noticesAtFoot !== null &&
          (roomGivenBack.noticesAtFoot?.heightUnderTheRest ?? roomGivenBack.heightUnderWhatFloats) > current.noticesAtFoot.heightUnderTheRest
            ? {
                ...current,
                heightUnderWhatFloats: current.noticesAtFoot.heightUnderTheRest,
                noticesAtFoot: null,
              }
            : current;
        let activeCellKeptAbove =
          event.isCoveredMoreByComposer === true ||
          (current.newsOfLoss !== null && roomGivenBack.zoom === current.zoom && event.heightUnderWhatFloats > current.heightUnderWhatFloats)
            ? keepActiveCellAboveCardAtFoot(isComposerOverNotices, caretFollowed, reads)
            : caretFollowed;
        let activeCellRevealed =
          event.isZoomAboutPointer === true
            ? activeCellKeptAbove
            : current.gridHeight === 0
              ? revealActiveCellBelow(activeCellKeptAbove, reads)
              : keepActiveCellInViewOnResize(current, activeCellKeptAbove, reads);
        let scrollNoted = noteScrollForLessRoom(current, activeCellKeptAbove, activeCellRevealed);
        let isMovedByItself =
          current.gridWidth > 0 &&
          current.gridHeight > 0 &&
          event.isZoomAboutPointer !== true &&
          (scrollNoted.scrollLeft !== current.scrollLeft || scrollNoted.scrollTop !== current.scrollTop);
        let movesOfViewByItself = scrollNoted.movesOfViewByItself + (isMovedByItself ? 1 : 0);
        return withNoEffects(
          rebaseOpenListsOnScroll(current, {
            ...scrollNoted,
            movesOfViewByItself,
          }),
        );
      }
      if (event.isZoomAboutPointer === true) return withNoEffects(rebaseOpenListsOnScroll(current, caretFollowed));
      let isGridResized = roomGivenBack.gridWidth !== current.gridWidth || roomGivenBack.gridHeight !== current.gridHeight;
      let { scrolledForEntry } = current;
      let scrollForEntry =
        scrolledForEntry !== null &&
        isSameCell(scrolledForEntry.cell, current.activeCell) &&
        scrolledForEntry.to.scrollLeft === current.scrollLeft &&
        scrolledForEntry.to.scrollTop === current.scrollTop
          ? scrolledForEntry.from
          : null;
      let isActiveCellToShow = isGridResized || event.isCoveredMoreByKeyboard === true || (scrollForEntry !== null && event.isCoveredLessByKeyboard === true);
      let { scrollLeft: scrollLeftToShow, scrollTop: scrollTopToShow } = scrollToShowActiveCell(current, reads, 'cellAlone');
      let isRoomOnlyGrown =
        withRoomUnderNoticesAtFoot(caretFollowed, reads).heightUnderWhatFloats > withRoomUnderNoticesAtFoot(current, reads).heightUnderWhatFloats &&
        scrollLeftToShow === current.scrollLeft &&
        scrollTopToShow === current.scrollTop;
      if (!isActiveCellToShow && !isRoomOnlyGrown) return withNoEffects(rebaseOpenListsOnScroll(current, caretFollowed));
      if (!isActiveCellToShow) return withNoEffects(rebaseOpenListsOnScroll(current, scrollToShowActiveCell(caretFollowed, reads)));
      let activeCellShown = scrollToShowActiveCell(
        scrollForEntry === null
          ? caretFollowed
          : clampScrollOfView(
              {
                ...caretFollowed,
                ...scrollForEntry,
              },
              reads,
            ),
        reads,
      );
      let scrolledForEntryNow = {
        cell: current.activeCell,
        from: scrollForEntry ?? {
          scrollLeft: current.scrollLeft,
          scrollTop: current.scrollTop,
        },
        to: {
          scrollLeft: activeCellShown.scrollLeft,
          scrollTop: activeCellShown.scrollTop,
        },
      };
      return withNoEffects(
        rebaseOpenListsOnScroll(current, {
          ...activeCellShown,
          scrolledForEntry: scrolledForEntryNow,
        }),
      );
    }
    case 'editTextChanged': {
      if (isEditingSameText(current, event)) return withNoEffects(current);
      let isSameTextInFormulaBar = current.mode.kind !== 'editing' && event.typingIn === 'formulaBar' && event.text === current.textToEditOfEntryCell;
      let isSameTextInEntry = current.mode.kind === 'editing' && current.mode.text === event.text;
      if (isModalOpen(current) && (isSameTextInFormulaBar || isSameTextInEntry)) return withNoEffects(current);
      if (event.typingIn === 'cell' && isFormulaText(event.text) && peopleChipsOfListCell(current, reads) !== null) return withNoEffects(current);
      let isSpaceInListCell =
        current.mode.kind !== 'editing' &&
        event.typingIn === 'cell' &&
        (event.text === ' ' || event.text === '　') &&
        peopleChipsOfListCell(current, reads) === null
          ? pressSpaceInCell(dropPressedCheckbox(current), reads)
          : null;
      if (isSpaceInListCell !== null) return isSpaceInListCell;
      let importClosed = closeImportOfAFile({
        ...withXlsxFileToldLater(current),
        customNumberFormat: null,
        pasteThatWaits: null,
        pickForWorkbook: null,
        isListOfKeysOpen: false,
        cellHistory: null,
      });
      let withTextOfOthers = withTextOfOthersFlag(
        current,
        readListSignsTyped(current.mode, startEntryEditing(importClosed.state, reads, event.text, event.typingIn, 'key', event), reads, event),
        event,
      );
      let marksTyped =
        event.caretAfterSignsRead === void 0
          ? withTextOfOthers
          : marksToTypeAfterSigns(current, withTextOfOthers, reads, event.caretAfterSignsRead, event.stepInHistory === 'redo');
      let signsLeft: PageState =
        event.areSignsPutBack === true && marksTyped.mode.kind === 'editing'
          ? {
              ...marksTyped,
              mode: {
                ...marksTyped.mode,
                areSignsLeftAsTyped: true,
              },
            }
          : marksTyped;
      let withBoxOfOneLine: PageState =
        event.isInBoxOfOneLine === true && signsLeft.mode.kind === 'editing'
          ? {
              ...signsLeft,
              mode: {
                ...signsLeft.mode,
                isInBoxOfOneLine: true,
              },
            }
          : signsLeft;
      let withArrowsOnCells = current.mode.kind !== 'editing' && event.typingIn === 'cell' ? letArrowsActOnCells(withBoxOfOneLine, reads) : withBoxOfOneLine;
      if (
        (peopleChipsOfListCell(current, reads) === null
          ? event.text === '' && isPeopleCell(reads, activeAnchorCell(current, reads))
          : event.text.trim() === '') &&
        event.typingIn === 'cell'
      )
        return {
          ...importClosed,
          state: refreshPeopleList(leaveEntryEditing(importClosed.state), reads),
        };
      if (isSameTextInFormulaBar)
        return {
          ...importClosed,
          state: {
            ...withArrowsOnCells,
            peopleList: null,
          },
        };
      return {
        ...importClosed,
        state: isSameTextInEntry ? notePeopleListScroll(withArrowsOnCells, reads) : refreshPeopleList(withArrowsOnCells, reads),
      };
    }
    case 'cellEntryTyped':
      return withNoEffects(refreshWordsOffered(current, reads, event));
    case 'wordsOfferedShown':
      return withNoEffects(showWordsOffered(current, event));
    case 'wordsOfferedWithdrawn':
      return withNoEffects(event.isOutOfView === true ? hideWordsOffered(current) : withoutWordsOffered(current));
    case 'wordsOfferedPressed':
      return takeWordsOfferedByTab(current, event, context);
    case 'focusCameBack':
      return withNoEffects(restoreWhatCaretLeft(current, event.asItLeft, context));
    case 'entryOfPageBeforeFound':
      return withNoEffects(restoreEntryOfPageBefore(current, event.entry, context));
    case 'pageMayBeEnded':
      return refusalOfEveryEdit !== null ? withNoEffects(current) : saveEntryLeavingItOpen(current, reads);
    case 'focusLost':
    case 'entryLeft':
    case 'sheetListOpened': {
      if (event.kind === 'sheetListOpened' && isFormulaUnfinishedInEntry(current)) return withNoEffects(current);
      if (event.kind === 'entryLeft' && event.isForToolAboutWholeCells === true) {
        let caretOutsideChips = caretInEntryOutsideChips(current, reads, event.caretInEntry);
        if (!canSetMarkOnEntrySelection(current, caretOutsideChips)) return withNoEffects(current);
      }
      if (event.kind === 'focusLost' && (event.mayComeBack === true || event.isOfWindow === true) && isFormulaAskedOrProposed(current))
        return withNoEffects(current);
      let dropdownListClosed = closeDropdownList(current);
      let withoutDiscardedFormula = event.kind === 'focusLost' ? dropdownListClosed : dropFormulaOfAgentDiscarded(dropdownListClosed);
      let entryCommitted = commitEntryInPlaceIfEditing(withoutDiscardedFormula, reads);
      let listCommitted =
        entryCommitted === null
          ? withNoEffects(withPeopleListShut(withoutDiscardedFormula))
          : {
              ...entryCommitted,
              state: withPeopleListShut(entryCommitted.state),
            };
      return event.kind === 'focusLost' && event.mayComeBack === true ? keepEntryLeftByCaret(current, listCommitted) : listCommitted;
    }
    case 'caretPlacedInEntry':
      return withNoEffects(stopArrowsActingOnCells(current));
    case 'entryExpandedOrCollapsed':
      return withNoEffects(isEntryExpanded(current.mode) ? collapseEntry(current, reads) : expandEntry(current, reads));
    case 'expandedEntryFinished':
      return isEntryExpanded(current.mode)
        ? commitEntryAndMove(
            {
              ...current,
              lastDone: null,
            },
            reads,
            activeAnchorCell(current, reads),
            'key',
          )
        : withNoEffects(current);
    case 'entryGivenBoxOfItsOwn': {
      if (current.mode.kind !== 'editing') return withNoEffects(current);
      let { isInBoxOfOneLine: _isInBoxOfOneLine, ...modeOutOfBox } = current.mode;
      let inBoxOfItsOwn = {
        ...current,
        mode: modeOutOfBox,
      };
      return withNoEffects(doesEntryTakeLineBreaks(inBoxOfItsOwn, reads) ? inBoxOfItsOwn : current);
    }
    case 'noticeDismissed':
      if (current.newsOfLoss === event.notice)
        return withNoEffects({
          ...current,
          newsOfLoss: null,
        });
      return withNoEffects(
        current.notice === event.notice
          ? {
              ...current,
              notice: null,
            }
          : current,
      );
    case 'errorsAtOpeningPutAway':
      if (current.errorsAtOpening?.first.sheetId !== event.sheetId) return withNoEffects(current);
      return withNoEffects({
        ...current,
        errorsAtOpening: null,
        errorsOffered: current.errorsOffered === null ? null : putAwayErrorsOffer(current.errorsOffered),
      });
    case 'fixOfErrorsAtOpeningAsked':
      return withNoEffects(selectErrorsAtOpening(current, reads));
    case 'fixesOfErrorsAtOpeningAsked': {
      let { toOffer: fixesOnCells } = current.fixesOnCells;
      let errorsSelected = selectErrorsAtOpening(current, reads);
      let { errorsOffered } = errorsSelected;
      if (fixesOnCells === null || fixesOnCells === 'yetToBeKnown' || isErrorsOfferBlocked(current) || errorsSelected === current || errorsOffered === null)
        return withNoEffects(current);
      let errorsShown = {
        ...hideExplanationUnderPointer(errorsSelected),
        errorsAtOpening: null,
      };
      let withErrorsOffered = withErrorsOfferedFromStart(errorsShown, reads, errorsOffered);
      if (fixesOnCells.length === 1 && fixesOnCells[0]?.copies.length === 0) {
        let isOneError = current.errorsAtOpening?.count === 1;
        let fixesAsked = askAgentForFixes(isOneError ? errorsShown : withErrorsOffered, reads);
        let { errorsAtOpening } = current;
        return fixesAsked.state.mode.kind === 'editing'
          ? fixesAsked
          : {
              ...fixesAsked,
              state: {
                ...fixesAsked.state,
                errorsAtOpening,
                errorsOffered,
              },
            };
      }
      return errorsOfferShown(withErrorsOffered, reads) === null ? withNoEffects(current) : askAgentForFixes(withErrorsOffered, reads);
    }
    case 'fixesOfSelectedCellsAsked': {
      let fixesToOffer = fixesToOfferInSelection(current, reads);
      let fixesInSelection = {
        ...current.fixesOnCells,
        toOfferInSelection: fixesToOffer,
        isEndToldDuringAct: false,
      };
      let explanationHidden = hideExplanationUnderPointer(
        clearPassingNotice({
          ...current,
          fixesOnCells: fixesInSelection,
        }),
      );
      let { errorsOffered } = current;
      if (errorsOffered === null || fixesToOffer === null || fixesToOffer === 'yetToBeKnown') return withNoEffects(current);
      if (fixesInSelectionStage(explanationHidden) !== 'offered') return withNoEffects(current);
      let withFixesOffered =
        fixesToOffer.length === 1 && fixesToOffer[0]?.copies.length === 0
          ? explanationHidden
          : withErrorsOfferedFromStart(
              {
                ...explanationHidden,
                errorsAtOpening: null,
              },
              reads,
              errorsOffered,
            );
      if (withFixesOffered !== explanationHidden && errorsOfferShown(withFixesOffered, reads) === null) return withNoEffects(current);
      let fixesAsked = askAgentForFixes(withFixesOffered, reads, 'toOfferInSelection');
      return fixesAsked.state === withFixesOffered ? withNoEffects(current) : fixesAsked;
    }
    case 'undoOfferTaken':
      return (
        commitEntryInPlaceIfEditing(current, reads) ??
        (current.undoOffer === null
          ? withNoEffects(current)
          : {
              state: current,
              effects: [
                {
                  kind: 'undoOrRedo',
                  direction: 'undo',
                },
              ],
            })
      );
    case 'undoOfStepAsked':
      return (
        commitEntryInPlaceIfEditing(current, reads) ??
        (current.notesOfSteps.latest === event.step
          ? {
              state: current,
              effects: [
                {
                  kind: 'undoOrRedo',
                  direction: 'undo',
                },
              ],
            }
          : withNoEffects(current))
      );
    case 'undoOrRedoChosen':
      return undoOrRedoIfFree(current, event.direction, context);
    case 'undoOfferDismissed':
      return withNoEffects({
        ...current,
        undoOffer: null,
      });
    case 'undoOfTurnTaken':
      return undoTurnOfAgent(current, reads);
    case 'undoOfTurnDismissed':
      return withNoEffects({
        ...current,
        undoOfTurnOffered: null,
      });
    case 'columnWidthChosen':
    case 'rowHeightChosen':
    case 'cellsToSortChosen':
    case 'sheetChangeChosen':
    case 'freezeChosen':
    case 'figureChosen': {
      let isChosenInToolbar = (event.kind === 'sheetChangeChosen' || event.kind === 'figureChosen') && event.chosenIn === 'toolbar';
      if (current.menu === null && !isChosenInToolbar) return withNoEffects(current);
      let entryCommitted = isChosenInToolbar ? commitEntryInPlaceIfEditing(current, reads) : null;
      if (entryCommitted !== null) return entryCommitted;
      let menuShut = {
        ...(isChosenInToolbar ? withCalendarShut(current) : current),
        menu: null,
        lastDone: null,
        notice: null,
        mode: NAVIGATING_MODE,
      };
      let unlessNothingChosen = (transition: PageTransition) =>
        isChosenInToolbar && transition.state === menuShut && transition.effects.length === 0 ? withNoEffects(current) : transition;
      let menuShutWithNotice = {
        ...menuShut,
        notice: current.notice,
      };
      if (event.kind === 'columnWidthChosen') {
        let { widthInPixels } = event;
        if (widthInPixels === null) return withNoEffects(menuShutWithNotice);
        if (widthInPixels === 'fitToText' && context.areFormulasLeft) return withFormulasLeftToWorkOut(menuShut, event);
        return actOnEveryRange(
          menuShut,
          (ofRange: PageState) =>
            widthInPixels === 'fitToText' ? fitSelectedColumnsToText(ofRange, reads) : chooseColumnWidth(ofRange, reads, widthInPixels),
          rangesForLineAxis(menuShut, reads, 'columns').slice(0, -1),
        );
      }
      if (event.kind === 'rowHeightChosen') {
        let { chosen } = event;
        return chosen === null
          ? withNoEffects(menuShutWithNotice)
          : actOnEveryRange(
              menuShut,
              (ofRange: PageState) => chooseRowHeight(ofRange, reads, chosen.heightInPixels),
              rangesForLineAxis(menuShut, reads, 'rows').slice(0, -1),
            );
      }
      if (event.kind === 'cellsToSortChosen') {
        let cellsToSort = cellsToSortOfMenu(current.menu);
        if (cellsToSort === null) return withNoEffects(current);
        if (event.chosen === null) return withNoEffects(menuShutWithNotice);
        if (cellsToSort.change === 'sortByKeysOfPane')
          return withSortForWhomAsked(sortChosenCells(menuShut, reads, event.chosen, event.isWithNoKeyboard === true), 'ofPane');
        return withSortForWhomAsked(
          sortRange(menuShut, reads, cellsToSort.change, event.chosen, sortColumnOfMenu(current.menu, 'range'), event.isWithNoKeyboard === true),
          'ofMenu',
        );
      }
      if (event.kind === 'figureChosen')
        return context.areFormulasLeft ? withFormulasLeftToWorkOut(menuShut, event) : unlessNothingChosen(insertFigureFormula(menuShut, reads, event.figure));
      if (event.kind === 'freezeChosen') return applyFreezeChoice(menuShut, reads, event);
      if (
        (event.change === 'sortAscending' ||
          event.change === 'sortDescending' ||
          event.change === 'sortRangeAscending' ||
          event.change === 'sortRangeDescending') &&
        context.areFormulasLeft
      )
        return withFormulasLeftToWorkOut(menuShut, event);
      let oneRangeAct = oneRangeActOfCommand(event.change);
      return (
        (oneRangeAct === null ? null : refuseWhenSeveralRanges(menuShut, oneRangeAct)) ??
        unlessNothingChosen(
          withSortForWhomAsked(
            reduceSheetChangeChosen(menuShut, isChosenInToolbar ? null : current.menu, context, event.change, event.isWithNoKeyboard === true),
            'ofMenu',
          ),
        )
      );
    }
    case 'columnToSortByChosen': {
      let columnPicked = pickColumnToSortBy(current, reads, event.columnId);
      return columnPicked === current
        ? withNoEffects(current)
        : reduceSheetsEvent(
            columnPicked,
            {
              kind: 'sheetChangeChosen',
              change: 'sortAscending',
              ...(event.isWithNoKeyboard === true && {
                isWithNoKeyboard: true,
              }),
            },
            context,
          );
    }
    case 'groupMarkPressed':
      return commitEntryInPlaceIfEditing(current, reads) ?? setOutlineGroupsCollapsed(current, context, event.of, event.groupIds, event.isToCollapse);
    case 'groupLevelChosen':
      return (
        commitEntryInPlaceIfEditing(current, reads) ??
        showOutlineGroupsToLevel(
          {
            ...current,
            menu: null,
          },
          context,
          event.of,
          event.level,
        )
      );
    case 'rowsPutOutOfViewByOwnFilters':
      return withNoEffects(setRowsHiddenByOwnFilters(current, reads, event.sheetId, event.rowIds));
    case 'ownFilterAsked':
      return (
        commitEntryInPlaceIfEditing(current, reads) ??
        declareCellTableOfNewFilter(
          current,
          keepActiveCellClearOfStuckHeaders(
            current,
            toggleOwnFilterOnSelection(
              {
                ...current,
                menu: null,
              },
              reads,
            ),
            reads,
          ),
          reads,
          canChangeCells,
        )
      );
    case 'ownFilterByCellChosen':
      return (
        commitEntryInPlaceIfEditing(current, reads) ??
        declareCellTableOfNewFilter(
          current,
          keepActiveCellClearOfStuckHeaders(
            current,
            filterByCellValue(
              {
                ...current,
                menu: null,
              },
              reads,
              event.keeps,
            ),
            reads,
          ),
          reads,
          canChangeCells,
        )
      );
    case 'ownFilterLineRemoved':
      return withNoEffects(
        dropUnusedOwnFilter(removeOwnFilterLine(clearPassingNotice(current), reads, event.tableKey, event.lineIndex), reads, event.tableKey),
      );
    case 'ownSortRemoved':
      return withNoEffects(dropUnusedOwnFilter(clearOwnSortByKey(clearPassingNotice(current), reads, event.tableKey), reads, event.tableKey));
    case 'ownSortMadeForEveryone':
      return (
        commitEntryInPlaceIfEditing(current, reads) ??
        (context.areFormulasLeft
          ? withFormulasLeftToWorkOut(current, event)
          : makeOwnSortForEveryone(current, reads, event.tableKey, event.isWithNoKeyboard === true))
      );
    case 'namedViewPicked': {
      let entryCommitted = commitEntryInPlaceIfEditing(current, reads);
      if (entryCommitted !== null) return entryCommitted;
      if (context.areFormulasLeft) return withFormulasLeftToWorkOut(current, event);
      let told = pickNamedView(current, reads, event.tableKey, event.namedViewId).told;
      let ownFilter = ownFilterByKey(told, event.tableKey);
      return withNoEffects(ownFilter === null ? told : scrollToFilterButtonsRow(told, reads, ownFilter));
    }
    case 'namedViewsChanged':
      return changeNamedView(current, reads, event.tableKey, event.change);
    case 'ownRowOrderSeen': {
      let { sheetId, staysAt } = event;
      let isElsewhere = staysAt === null || sheetId !== current.sheetId;
      let notAwaited = {
        ...current,
        isOwnRowOrderAwaited: false,
      };
      let selectionStaying = !isElsewhere && 'corner' in staysAt! && current.mode.kind === 'navigating' ? staysAt : null;
      let selectionAfterOrder = isElsewhere
        ? notAwaited
        : selectionStaying !== null
          ? {
              ...selectAfterEdit(
                withoutOtherRanges(notAwaited),
                reads,
                {
                  ...IF_QUEUED_DEFAULTS,
                  select: selectionStaying,
                  done: null,
                },
                null,
              ),
              lastDone: current.lastDone,
            }
          : clampScrollOfView(
              {
                ...withoutOtherRanges(notAwaited),
                ...selectionAtCell(current.activeCell),
                scrollTop: staysAt!.scrollTop,
              },
              reads,
            );
      let selectionOnShownRows = keepSelectionOnShownRows(refreshStaleOwnFilters(selectionAfterOrder, reads, sheetId), reads);
      return selectionStaying === null
        ? withNoEffects(selectionOnShownRows)
        : {
            state: selectionOnShownRows,
            effects: [
              {
                kind: 'dropWhatIsHeld',
              },
            ],
          };
    }
    case 'ownFiltersCleared':
      return withNoEffects(
        clearOwnFilters(
          {
            ...clearPassingNotice(current),
            menu: null,
          },
          reads,
          event.of,
        ),
      );
    case 'ownFiltersRefreshed':
      return withNoEffects(lookAgainAtOwnFilters(clearPassingNotice(current), reads, 'apply', event.sheetId));
    case 'ownFiltersLookedAtAgain':
      return withNoEffects(lookAgainAtOwnFilters(current, reads, 'look', event.sheetId));
    case 'ownFilterListAsked':
      return (
        commitEntryInPlaceIfEditing(current, reads) ?? withNoEffects(openOwnFilterList(current, reads, event.tableKey, event.c, event.today ?? null))
      );
    case 'ownFilterListShut':
      return withNoEffects({
        ...current,
        ownFilterList: null,
      });
    case 'ownFilterListActedIn':
      return withNoEffects(settleListFilterOnceUsed(withFilterKeptOnForColumnsCard(current, reduceOwnFilterList(current, reads, event.act))));
    case 'ownFilterListSortChosen':
      return context.areFormulasLeft
        ? withFormulasLeftToWorkOut(current, event)
        : sortFromOwnFilterList(current, reads, event.direction, event.isWithNoKeyboard === true);
    case 'rowsAskedForActedOn':
      return context.areFormulasLeft && doesRowsActionSort(current, event.act, refusalOfEveryEdit === null)
        ? withFormulasLeftToWorkOut(current, event)
        : actOnRowsAsk(current, reads, event.act, refusalOfEveryEdit === null);
    case 'agentRepliedWhichRowsAreAskedFor':
      return withNoEffects(takeAgentRowsAnswer(current, reads, event.askId, event.reply));
    case 'viewerFound':
      return withNoEffects({
        ...current,
        viewerId: event.userId,
      });
    case 'ownFiltersBroughtBack':
      return withNoEffects(bringBackOwnFilters(current, reads, event.kept));
    case 'mergeChangeChosenInToolbar':
      return (
        commitEntryInPlaceIfEditing(current, reads) ??
        refuseWhenSeveralRanges(current, event.change) ??
        mergeOrUnmergeSelection(
          {
            ...current,
            lastDone: null,
            notice: null,
          },
          reads,
          event.change,
        )
      );
    case 'checkboxesSetInToolbar':
      return commitEntryInPlaceIfEditing(current, reads) ?? setCheckboxesOfSelection(current, reads, event.isChecking);
    case 'cellFormatChosen':
      if (event.chosenIn === 'toolbar')
        return applyFormatCommand(current, reads, event.choice, caretInEntryOutsideChips(current, reads, event.caretInEntry));
      return applyFormatCommand(
        {
          ...current,
          menu: null,
          lastDone: null,
          notice: null,
        },
        reads,
        event.choice,
        caretInEntryOutsideChips(current, reads, event.caretInEntry),
      );
    case 'bordersChosen':
      return actOnEveryRange(current, (ofRange: PageState) => drawBordersOnSelection(ofRange, reads, event.choice, event.pen));
    case 'borderPenChanged':
      return withNoEffects({
        ...current,
        borderPen: {
          ...current.borderPen,
          ...event.change,
        },
      });
    case 'gridlinesToggled':
      return toggleGridlines(current, reads);
    case 'interactiveWrote':
      return writeFromInteractive(current, reads, event.viewId, event.cells);
    case 'interactiveResetChosen':
      return editInteractiveOfSheet(current, reads, 'resetInteractive');
    case 'interactiveSaveAsDefaultChosen':
      return editInteractiveOfSheet(current, reads, 'saveDefaultsOfInteractive');
    case 'customNumberFormatTyped':
      return current.customNumberFormat?.typedIn === 'list'
        ? withNoEffects(current)
        : typeCustomPattern(current, reads, event.pattern, event.isOfUndoOrRedo === true);
    case 'typedInListOfNumberFormats':
      return typeCustomPatternInList(current, reads, event.text);
    case 'customNumberFormatEntered': {
      let customNumberFormat = current.customNumberFormat;
      if (customNumberFormat === null) return withNoEffects(current);
      if (!isHoldReleased(answerHoldOf(current, 'numberFormat'), event)) return withNoEffects(holdOneMoreAct(current, 'numberFormat', event));
      let customFormat = formatOfCustomPattern(customNumberFormat, reads);
      return customFormat === null
        ? withNoEffects({
            ...current,
            customNumberFormat: withRefusalTold(customNumberFormat),
          })
        : applyFormatCommand(current, reads, customFormat);
    }
    case 'customNumberFormatDropped':
      return withNoEffects({
        ...current,
        customNumberFormat: null,
      });
    case 'customNumberFormatEscaped':
      return withNoEffects(leaveCustomFormat(current, reads));
    case 'agentAskedForNumberFormat':
      if (!canAskAgentForFormat(current)) return withNoEffects(current);
      return isHoldReleased(answerHoldOf(current, 'numberFormat'), event)
        ? askAgentForNumberFormat(current, reads)
        : withNoEffects(holdOneMoreAct(current, 'numberFormat', event));
    case 'agentsAnswerSeen':
      return withNoEffects(markHoldSeen(current, event.at, event));
    case 'actHeldAtAgentsAnswer':
      return withNoEffects(holdOneMoreAct(current, event.at, event));
    case 'agentRepliedWithANumberFormat':
      return withNoEffects(takeNumberFormatAnswer(current, reads, event.askId, event.reply));
    case 'pickForWorkbookAsked':
      return commitEntryInPlaceIfEditing(current, reads) ?? openWorkbookSettingPick(current, reads, event);
    case 'pickedForWorkbook':
      return pickWorkbookSetting(current, event.of, event.value);
    case 'pickForWorkbookEntered':
      return commitWorkbookSettingPick(current);
    case 'pickForWorkbookDropped':
      return withNoEffects({
        ...current,
        pickForWorkbook: null,
      });
    case 'listOfKeysAsked':
      return withNoEffects(openListOfKeys(current));
    case 'listOfKeysShut':
      return withNoEffects({
        ...current,
        isListOfKeysOpen: false,
      });
    case 'cellHistoryAsked':
      return withNoEffects(openCellHistory(current, reads));
    case 'cellHistoryScopeChosen':
      return withNoEffects(setCellHistoryScope(current, reads, event.scope));
    case 'cellHistoryAskedAgain':
      return withNoEffects(askCellHistoryAgain(current));
    case 'cellHistoryLookedAtAgain':
      return withNoEffects(refreshCellHistory(current));
    case 'cellHistoryShut':
      return withNoEffects({
        ...current,
        cellHistory: null,
      });
    case 'cellHistoryRead':
      return cellHistoryAnswered(current, reads, event.askId, event.read);
    case 'agentRepliedAboutImport':
      return receiveImportAnswer(current, reads, event.askId, event.reply);
    case 'agentWroteOnAboutImport':
      return receivePartialImportAnswer(current, reads, event.askId, event.written);
    case 'importQuestionAnswered':
      return answerImportQuestion(current, reads, event.questionId, event.optionIndex);
    case 'importDestinationChosen':
      return chooseImportDestination(current, reads, event.picked);
    case 'importChangedByHand':
      return changeImportByHand(current, reads, event.change);
    case 'importKindsAskedFor':
      return loadImportColumnKinds(current, reads, event.columnIndex);
    case 'importWishSent':
      return sendImportWish(current, event.wish);
    case 'importPlanAskedAgain':
      return askImportPlanAgain(current);
    case 'importPlanAwaitedNoLonger':
      return stopAwaitingImportPlan(current);
    case 'importAskedByHost':
      return leaveRenamingOrEntry(current, reads) ?? withNoEffects(awaitFileToImport(current, event.isByKey));
    case 'importConfirmed':
      return confirmImport(current, reads, event.plansHeardCount);
    case 'importDropped':
      return discardImport(current);
    case 'importEscaped':
      return escapeImport(current, event.isWishTyped === true);
    case 'importKept':
      return keepImport(current);
    case 'marksOfImportOver':
      return withNoEffects(current);
    case 'peopleListRowChosen':
      return isAskAgentRowBusy(event.row, current, context)
        ? withNoEffects(current)
        : takePeopleListRow(current, reads, event.row, current.activeCell, 'pointer', false);
    case 'personAsked':
      return withNoEffects(openPeopleListToAskPerson(current, reads));
    case 'personRemovedFromField':
      return removePersonFromCell(current, reads, event.userId, 'pointer');
    case 'peopleListShut':
      if (current.peopleList === null) return withNoEffects(current);
      return withNoEffects(
        peopleChipsOfListCell(current, reads) !== null && current.mode.kind === 'editing'
          ? leaveEntryEditing({
              ...current,
              peopleList: null,
            })
          : {
              ...current,
              peopleList: null,
            },
      );
    case 'cardAskedByRestingPointer':
      return withNoEffects(openListCardAtRow(current, reads, event.ofRow, 'restingPointer'));
    case 'cardOfOptionAsked':
      return withNoEffects(toggleOptionColorCard(current, reads, event.optionId));
    case 'cardRowChosen':
      return takeListCardRow(current, reads, event.row, current.activeCell, false);
    case 'optionsNamedInList':
      return nameDropdownOptions(current, reads, event);
    case 'newOptionNoLongerNamed':
      return withNoEffects(
        current.dropdown === null
          ? current
          : {
              ...current,
              dropdown: {
                ...current.dropdown,
                isNewOptionBeingNamed: false,
              },
            },
      );
    case 'optionMovedInList':
      return moveDropdownOption(current, reads, event);
    case 'cardShut':
      return withNoEffects(shutListCard(current));
    case 'timeListRowChosen':
      if (current.timeList === null) return withNoEffects(current);
      return commitEntryAndMove(
        moveInTimeList(current, 'chosen', () => event.row),
        reads,
        current.activeCell,
        'pointer',
      );
    case 'timeListShut':
      return withNoEffects(
        current.timeList === null
          ? current
          : {
              ...current,
              timeList: null,
            },
      );
    case 'timeListRowPointedAt':
      return withNoEffects(moveInTimeList(current, 'pointedAt', () => event.row));
    case 'entryCaretMoved':
      return withNoEffects(setFormulaHelpCaret(selectInEntry(current, event), event));
    case 'entryLooksChanged':
      return withNoEffects(setEntryLooks(current, event.looks));
    case 'addressPastedOverWords':
      return withNoEffects(withAddressPastedOverWords(current, reads, event));
    case 'boxOfLinePressedInEntry':
      return toggleEntryCheckboxAndSave(current, reads, void 0, event.line);
    case 'boxOfLinePressedInCell':
      return toggleCellCheckboxLine(current, reads, event.paragraph);
    case 'functionListRowChosen':
      return isColumnPick(current, event) && isEntryWorkPending(current, context)
        ? withFormulasLeftToWorkOut(current, event)
        : withNoEffects(pickFunctionListRow(current, reads, event));
    case 'functionListShut':
      return withNoEffects(shutFunctionList(current));
    case 'formulaOfferRowChosen':
      return chooseOfferRow(current, reads, event.row);
    case 'formulaReadToBeWorkedOut':
      return withNoEffects(takeWorkedOutFormula(current, reads, event.formula));
    case 'formulaOfferShut':
      return withNoEffects(waveFormulaOfferOff(current));
    case 'wordsOfFormulaAskedBack':
      return commitProposedFix(current, reads) ?? withNoEffects(goBackToWords(current, reads));
    case 'formulaOfferDrawn':
      return withNoEffects(setOfferDrawn(current, event.isDrawn, event.hasRested));
    case 'formulaOfAgentArrived':
      return withNoEffects(endProposalArrival(current));
    case 'formulaOfAgentKept': {
      let { stage: formulaFromWords } = current.formulaFromWords;
      if (formulaFromWords?.kind !== 'proposed' || formulaFromWords.isArriving) return withNoEffects(waitForFormula(current));
      let withFixPicked = event.fix === void 0 ? current : pickProposedFix(current, reads, event.fix);
      if (withFixPicked === null) return withNoEffects(waitForFormula(current));
      return commitEntryKeepingAgentsFormula(withFixPicked, reads) ?? withNoEffects(withFixPicked);
    }
    case 'pressInListOfFormulaHeld':
      return withNoEffects(waitForFormula(current));
    case 'formulaAskStopped':
      return stopAskingForFix(current, reads) ?? stopAskingForFormula(current);
    case 'agentForFormulasChecked':
      return withNoEffects(takeAgentAvailability(current, event.isAvailable));
    case 'agentRepliedWithAFormula':
      return takeAgentsFormulaAnswer(current, reads, event.askId, event.reply);
    case 'agentRepliedWithAFix':
      return receiveFixAnswer(current, reads, event.askId, event.reply);
    case 'allFunctionsAskedFor':
      return withNoEffects(listAllFunctions(current, reads));
    case 'peopleFound': {
      let withProfiles = withProfilesLearned(current, event.people);
      let { searchedFor, people } = event;
      let { peopleList } = withProfiles;
      if (peopleList?.searchedFor !== searchedFor) return withNoEffects(withProfiles);
      return withNoEffects(
        withPeopleFound(withProfiles, reads, {
          searchedFor,
          people,
        }),
      );
    }
    case 'offersUnderAtRead': {
      let withSetsReady = withReadySets(current, event.offers);
      return withNoEffects(
        withSetsReady.peopleList === null
          ? withSetsReady
          : {
              ...withSetsReady,
              peopleList: {
                ...withSetsReady.peopleList,
                offers: event.offers,
              },
            },
      );
    }
    case 'peopleLookedUp':
      return withNoEffects(
        cellHistoryAuthorsArrived(versionAuthorsArrived(withProfilesLearned(current, event.profiles), event.askedAbout), event.askedAbout),
      );
    case 'tablesRead':
      return withNoEffects(
        keepKeyedCellClearOfStuckHeaders(
          current.tablesRead,
          {
            ...current,
            tablesRead: event.tablesRead ?? current.tablesRead,
          },
          reads,
        ),
      );
    case 'formatAsTableChosen':
      return setFormatAsTable(current, reads, refusalOfEveryEdit === null, event);
    case 'selectionsOfOthersChanged':
      return withSelectionsOfOthers(current, event.selections, event.atMs);
    case 'sheetChosen': {
      let canPoint = event.canPoint !== false && refusalOfEveryEdit === null;
      let sheetSwitched = switchSheetWhileEditing(current, reads, event.sheetId, event.caretInEntry, canPoint);
      if (sheetSwitched !== null) return withNoEffects(sheetSwitched);
      return (
        leaveRenamingOrEntry(current, reads) ??
        withNoEffects(
          carryFormulaOfAgentDiscarded(
            event.isPickedInList === true ? dropFormulaOfAgentDiscarded(current) : current,
            showSheet(current, reads, event.sheetId),
          ),
        )
      );
    }
    case 'cellsGoneTo':
      return withNoEffects(goToCells(current, reads, event.area));
    case 'cellsLinkedTo':
      return withNoEffects({
        ...current,
        cellsLinkedTo: {
          kind: 'asked',
          place: event.place,
        },
      });
    case 'sheetAddChosen':
      return leaveRenamingOrEntry(current, reads) ?? addSheetAfter(current, event.nameStem);
    case 'fileToImportRead':
      return leaveRenamingOrEntry(current, reads) ?? carryFileAwaited(current, importReadFile(current, reads, event));
    case 'fileToImportNotRead':
      return carryFileAwaited(
        current,
        withNoEffects({
          ...current,
          notice: {
            kind: 'fileNotImported',
            why: event.why,
          },
        }),
      );
    case 'sheetDuplicateChosen':
      return leaveRenamingOrEntry(current, reads) ?? duplicateSheet(current, reads, event.sheetId, event.wordsAroundName);
    case 'chartNodesCopied':
      return reduceChartNodesCopied(current, reads, event);
    case 'chartNodesLongInBeingCopied':
      return withNoEffects(
        current.notice === null || noticeGivesWay(current.notice)
          ? {
              ...current,
              notice: {
                kind: 'chartsBeingCopied',
                copiedFor: event.copiedFor,
              },
            }
          : current,
      );
    case 'xlsxFileSaved': {
      let { went, filename, url, notCarriedOver } = event;
      return withNoEffects(
        withXlsxFileSaved(current, {
          went,
          filename,
          url,
          notCarriedOver,
        }),
      );
    }
    case 'xlsxFileDialogShut':
      return withNoEffects({
        ...current,
        xlsxFileReady: null,
      });
    case 'sheetDeleteChosen':
      return leaveRenamingOrEntry(current, reads) ?? deleteSheet(current, reads, event.sheetId);
    case 'sheetRenameChosen':
      return leaveRenamingOrEntry(current, reads) ?? withNoEffects(startRenamingSheet(current, reads, event.sheetId));
    case 'sheetMoveChosen':
      return leaveRenamingOrEntry(current, reads) ?? moveSheetToPlace(current, reads, event.sheetId, event.toIndex);
    case 'sheetLinkCopyChosen':
      return copyLinkToSheet(current, event.sheetId);
    case 'sheetLinkCopyAnswered':
      return withNoEffects(noticeLinkNotCopied(current, event.whyNot));
    case 'sheetNameTyped': {
      let { sheetBeingRenamed: renaming } = current;
      if (renaming === null) return withNoEffects(current);
      let typedName = {
        ...renaming,
        typed: event.text,
        refused: null,
      };
      return withNoEffects({
        ...current,
        sheetBeingRenamed: typedName,
      });
    }
    case 'sheetNameEntered':
      return finishRenamingSheet(current, reads, false);
    case 'sheetNameLeft':
      return leaveSheetNameEntry(current, reads, event.mayComeBack === true);
    case 'sheetListShut':
      return finishRenamingSheet(current, reads, true);
    case 'sheetRenameDropped':
      return withNoEffects({
        ...current,
        sheetBeingRenamed: null,
      });
    case 'copyChosen':
    case 'cutChosen':
      if (current.mode.kind === 'editing') return withNoEffects(current);
      return copyOrCutSelection(
        {
          ...withCalendarShut(closeDropdownList(current)),
          peopleList: null,
        },
        reads,
        event.kind === 'cutChosen' ? event.token : null,
      );
    case 'copyRefused':
      return withNoEffects({
        ...current,
        lastDone: null,
        notice: {
          ...event,
          kind: 'cellsNotCopied',
        },
        ...(event.keyInstead === 'sameInAMoment' && {
          copiedCells: null,
          cutJustMoved: null,
        }),
      });
    case 'pasteChosen': {
      let pastedInPeopleCell = pasteIntoPeopleCell(current, reads, event);
      return pastedInPeopleCell === null ? pasteIntoSelection(current, reads, event) : withNoEffects(pastedInPeopleCell);
    }
    case 'chartPasteChosen':
      return pasteChart(current, reads, event.chart);
    case 'pasteThatWaitsAnswered':
      return settlePasteThatWaits(current, reads, event);
    case 'workbookChanged': {
      let sheetBeingRenamed = current.sheetBeingRenamed;
      let isSheetStillRenamed = sheetBeingRenamed !== null && findSheetById(reads, sheetBeingRenamed.sheetId) !== undefined;
      let newlyCollapsed = event.isUnasked ? NO_NEWLY_COLLAPSED_GROUPS : newlyCollapsedGroupIds(event.readsBefore, reads);
      let keptForOwnRowOrder = <Noted extends { atChangeCount: number }>(noted: Noted | null): Noted | null =>
        current.isOwnRowOrderAwaited && !event.isUnasked && noted?.atChangeCount === current.workbookChangeCount
          ? ({
              ...noted,
              atChangeCount: noted!.atChangeCount + 1,
            } as Noted)
          : noted;
      let reconciled = reconcileWithWorkbook(
        {
          ...current,
          sortToLookBackOn: keptForOwnRowOrder(current.sortToLookBackOn),
          formulasLostToLastAct: keptForOwnRowOrder(current.formulasLostToLastAct),
          sheetBeingRenamed: isSheetStillRenamed ? sheetBeingRenamed : null,
          ownFilters: ownFiltersOfExistingSheets(current, reads),
          ownRowOrders: ownRowOrdersNotGivenUp(current, reads),
          workbookChangeCount: current.workbookChangeCount + 1,
          tablesRead: event.tablesRead ?? current.tablesRead,
        },
        event.readsBefore,
        reads,
        {
          ownCollapsing: ownCollapsingAfterReadsChange(current, event.readsBefore, reads, newlyCollapsed),
          rowsOutOfViewByOwnFilters: rowsHiddenByOwnFiltersAfterChange(current, event.readsBefore, reads),
        },
      );
      let selectionKept = keepSelectionOnShownRows(moveSelectionsOutOfNewlyCollapsed(reconciled, reads, newlyCollapsed), reads);
      let ownCellLost = event.isUnasked ? ownCellLostNotice(current, event.readsBefore, selectionKept, reads) : null;
      let withOwnCellLost =
        ownCellLost === null
          ? selectionKept
          : {
              ...selectionKept,
              lastDone: ownCellLost,
            };
      let caretFollowed = followCaretAtEnd(current, clampScrollOfView(withOwnCellLost, reads), reads, event.readsBefore);
      return refreshImportOnWorkbookChange(
        rebaseOpenListsOnScroll(
          caretFollowed,
          keepKeyedCellClearOfStuckHeaders(current.tablesRead, keepActiveCellInViewOnResize(current, caretFollowed, reads, event.readsBefore), reads),
        ),
        reads,
      );
    }
    case 'formulasWorkedOut': {
      let workedOut = {
        ...current,
        formulasWorkedOutCount: current.formulasWorkedOutCount + 1,
        tablesRead: event.tablesRead ?? current.tablesRead,
      };
      let reconciled = reconcileWithWorkbook(workedOut, event.readsBefore, reads);
      let caretFollowed = followCaretAtEnd(current, clampScrollOfView(reconciled, reads), reads, event.readsBefore);
      return refreshImportOnWorkbookChange(
        rebaseOpenListsOnScroll(
          caretFollowed,
          keepKeyedCellClearOfStuckHeaders(current.tablesRead, keepActiveCellInViewOnResize(current, caretFollowed, reads, event.readsBefore), reads),
        ),
        reads,
      );
    }
    case 'textMeasuredAnew': {
      let reconciled = reconcileWithWorkbook(
        {
          ...withoutLinkPointedAt(current),
        },
        event.readsBefore,
        reads,
      );
      let caretFollowed = followCaretAtEnd(current, clampScrollOfView(reconciled, reads), reads, event.readsBefore);
      return withNoEffects(rebaseOpenListsOnScroll(caretFollowed, keepActiveCellInViewOnResize(current, caretFollowed, reads, event.readsBefore)));
    }
    case 'editsDropped':
      return withNoEffects({
        ...current,
        lastDone: null,
        newsOfLoss: event,
        undoOffer: null,
        notesOfSteps: NO_NOTES_OF_STEPS,
      });
    case 'askOwedToAgentGivenUp':
      return withNoEffects(current);
    case 'savingChanged': {
      let { saving, hasUnsavedEdits } = event;
      let savingProgress = nextSavingProgress(current.savingProgress, event.unsavedEditCount);
      let undoOfferMade = current.lastDone?.what === 'undoOfferMade' && current.lastDone.headerRow === undefined ? current.lastDone : null;
      let undoOfferSaved = undoOfferMade === null ? null : markUndoOfferSaved(undoOfferMade.offer, saving);
      let lastDoneSaved = current.entriesUnanswered.length > 0 ? current.lastDone : markLastDoneSaved(current.lastDone, saving);
      const lastDoneMarked: PageState['lastDone'] =
        undoOfferSaved === null || undoOfferSaved === undoOfferMade?.offer
          ? lastDoneSaved
          : {
              what: 'undoOfferMade',
              offer: undoOfferSaved,
            };
      let undoOfferMarked = markUndoOfferSaved(current.undoOffer, saving);
      let isUnchanged =
        saving === current.saving &&
        hasUnsavedEdits === current.hasUnsavedEdits &&
        savingProgress === current.savingProgress &&
        lastDoneMarked === current.lastDone &&
        undoOfferMarked === current.undoOffer;
      return withNoEffects(
        isUnchanged
          ? current
          : {
              ...current,
              saving,
              hasUnsavedEdits,
              isLargeEditUnsaved: current.isLargeEditUnsaved && saving !== 'allSaved',
              savingProgress,
              lastDone: lastDoneMarked,
              undoOffer: undoOfferMarked,
            },
      );
    }
    case 'fixOfErrorsAsked': {
      let offerOfErrors = current.errorsOffered?.offer ?? null;
      return withNoEffects(
        offerOfErrors === null
          ? current
          : unhideFilteredRowsOfSelection(
              {
                ...withoutOtherRanges(moveActiveCellTo(current, reads, offerOfErrors.first, 'pointer')),
                selectionCorner: offerOfErrors.last,
              },
              reads,
            ),
      );
    }
    case 'errorsOfferPutAway':
      return withNoEffects(
        current.errorsOffered === null || current.errorsOffered.offer === null
          ? current
          : {
              ...current,
              errorsOffered: putAwayErrorsOffer(current.errorsOffered),
            },
      );
    case 'fixesInPlaceAsked': {
      let fixesWithEndUntold = {
        ...current.fixesOnCells,
        isEndToldDuringAct: false,
      };
      return askAgentForFixes(
        clearPassingNotice({
          ...current,
          fixesOnCells: fixesWithEndUntold,
        }),
        reads,
      );
    }
    case 'fixesKept':
      return current.mode.kind === 'editing' ? withNoEffects(current) : keepFixes(current, reads, event);
    case 'fixesKeptAnswered':
      return current.fixesOnCells.stage?.isKept === true ? endFixes(current) : withNoEffects(current);
    case 'fixesEnded':
      return discardFixes(current, event);
    case 'fixActedOn': {
      let fixPill = fixPillShown(current, reads);
      if (fixPill === null || cellKeyText(fixPill.cellId) !== event.pillOf) return withNoEffects(current);
      if (!isHoldReleased(answerHoldOf(current, 'fixes'), event)) return withNoEffects(holdOneMoreAct(current, 'fixes', event));
      return event.act === 'kept' ? keepFix(current, reads, fixPill.cellId) : discardFix(current, fixPill.cellId);
    }
    case 'fixKeptAnswered':
      return takeBackKeptFix(current, event.cellId);
    case 'fixPointedAt':
      return withNoEffects(pointAtFix(current, reads, event.at));
    case 'calculationBegan':
      return withNoEffects(
        updateCalculatingShown(
          {
            ...current,
            isActShownAsCalculated: true,
            ownViewShownAsApplied: event.ofOwnView ?? null,
          },
          reads,
        ),
      );
    case 'calculationEnded':
      return withNoEffects(
        updateCalculatingShown(
          {
            ...current,
            isActShownAsCalculated: false,
          },
          reads,
        ),
      );
    case 'formulasLeftChanged':
      return withNoEffects(
        refreshEntryErrorOnRead(
          updateCalculatingShown(
            {
              ...current,
              areFormulasShownAsLeft: event.areLeft,
            },
            reads,
          ),
          reads,
          null,
        ),
      );
    case 'causeOfErrorRead':
      return withNoEffects(refreshEntryErrorOnRead(current, reads, event.of));
    case 'agentActivityChanged': {
      let agentWorking = setAgentWorking(
        current,
        event.isWorking,
        event.changedInTurn ?? null,
        event.isSheetJustMade === true ? wholeSheetsAsChanges(context.reads) : [],
        context,
      );
      let isFirstBuild = nextIsFirstBuild(current, event, context.reads);
      return withNoEffects(
        isFirstBuild === agentWorking.isFirstBuild
          ? agentWorking
          : {
              ...agentWorking,
              isFirstBuild,
            },
      );
    }
    case 'changesByAgentChanged':
      return withNoEffects(changesByAgentArrived(current, event.changes, context));
    case 'viewTakenBack':
    case 'followAsked':
    case 'viewShownByAgentChanged':
      return withNoEffects(current);
    case 'workShownLongEnough': {
      let calculatingShown = calculatingShownAfterWait(current.calculatingShown, event.wait);
      let doneByAgent = current.doneByAgent?.wait === event.wait ? null : current.doneByAgent;
      let savingProgress = savingProgressAfterWait(current.savingProgress, event.wait);
      let longCalculationTold = longCalculationAfterWait(current.longCalculationTold, event.wait);
      if (current.undoOfTurnOffered?.wait === event.wait) return withNoEffects(dropUndoOfTurnWaitedOut(current, event.wait));
      if (current.waitForNextEditOfAgent === event.wait)
        return withNoEffects({
          ...current,
          writtenInTurnOfAgent: [],
          waitForNextEditOfAgent: null,
        });
      let isUnchanged =
        calculatingShown === current.calculatingShown &&
        doneByAgent === current.doneByAgent &&
        savingProgress === current.savingProgress &&
        longCalculationTold === current.longCalculationTold;
      return withNoEffects(
        isUnchanged
          ? current
          : {
              ...current,
              calculatingShown,
              doneByAgent,
              savingProgress,
              longCalculationTold,
            },
      );
    }
    case 'contextBarLeftByKey':
      return withNoEffects(scrollToShowSelection(current, reads));
    case 'contextBarMenuChanged': {
      let contextBarMenu = nextContextBarMenu(current.contextBarMenu, event.menu, event.isOpen);
      if (contextBarMenu === current.contextBarMenu) return withNoEffects(current);
      if (contextBarMenu === 'sort') {
        let ownFilterList = reduceOwnFilterList(current, reads, {
          kind: 'giveUp',
        });
        let rowsAsk = openRowsAsk(
          {
            ...ownFilterList,
            contextBarMenu,
          },
          reads,
          event.ofFilterBarFor,
        );
        let isFilterNotDrawnYet = rowsAsk.rowsAskedFor?.isFilterNotDrawnYet === true;
        return declareCellTableOfNewFilter(current, rowsAsk, reads, canChangeCells && !isFilterNotDrawnYet);
      }
      if (contextBarMenu !== 'conditionalFormatting')
        return withNoEffects({
          ...current,
          contextBarMenu,
        });
      let rulesShownAs: RulesDrawnAs = canOfferAgentForRules(current) ? 'card' : 'pane';
      return withNoEffects({
        ...openConditionalFormatsAs(current, rulesShownAs),
        contextBarMenu,
      });
    }
    case 'pointerRested':
      return withNoEffects(explainCellUnderPointer(current, reads, event.at, event.link ?? null));
    case 'linkCardLeftByPointer':
      return withNoEffects(leaveLinkCard(current, reads, event.cardOf, event.isDoneWith === true));
    case 'linkAddressCopied':
      return withNoEffects({
        ...current,
        lastDone: {
          what: 'linkCopied',
        },
      });
    case 'otherThanCellsCopied':
      if (event.ofChart === 'copied')
        return withNoEffects({
          ...clearPassingNotice(current),
          lastDone: {
            what: 'chartCopied',
          },
        });
      return event.ofChart === undefined || current.notice?.kind === 'chartNotCut' || isNoticeOfOtherEditRefused(current.notice)
        ? withNoEffects(current)
        : withNoEffects({
            ...current,
            lastDone: null,
            notice: {
              kind: 'chartNotCut',
            },
          });
    case 'linkCardAsked':
      return withNoEffects(askLinkCard(current, reads, event.at, event.link ?? null));
    case 'linkEditChosen': {
      let linkForm = openLinkFormFromCellCard(current, reads);
      if (linkForm !== null) return withNoEffects(linkForm);
      let explained = cellExplained(current, reads);
      if (explained === null) return withNoEffects(current);
      let movedToCell = moveActiveCellTo(current, reads, explained.cellId, 'pointer');
      let textToEdit = textToEditAt(movedToCell, reads, movedToCell.activeCell);
      let editing = startEntryEditing(movedToCell, reads, textToEdit, 'cell', 'pointer');
      let address = event.address ?? explained.link?.address;
      let linkInEntry = address === void 0 ? null : editLinkOfUrlInEntry(editing, reads, address);
      return withNoEffects(linkInEntry ?? editing);
    }
    case 'linkFormAsked': {
      let caretInEntry = caretInEntryOutsideChips(current, reads, event.caretInEntry);
      let formInEntry = openEntryLinkForm(current, reads, caretInEntry);
      if (formInEntry !== null || current.mode.kind === 'editing') return withNoEffects(formInEntry ?? current);
      return withNoEffects(openLinkFormAtActiveCell(current, reads) ?? current);
    }
    case 'linkFormShut':
      return withNoEffects(shutLinkForm(current, reads));
    case 'linkGiven':
      return current.linkForm?.inEntry === void 0
        ? submitLinkForm(current, reads, event.text, event.address)
        : submitLinkFormInEntry(current, reads, event.text, event.address);
    case 'linkRemoveChosen':
      return event.address === void 0
        ? removeLinkFromCellCard(current, reads, event.cardOf)
        : removeLinkOfUrlFromCell(current, reads, event.cardOf, event.address);
    case 'fixOfErrorAsked': {
      let explained = cellExplained(current, reads);
      return withNoEffects(
        explained === null || cellKeyText(explained.cellId) !== event.cardOf
          ? current
          : withoutOtherRanges(moveActiveCellTo(current, reads, explained.cellId, 'pointer')),
      );
    }
    case 'fixInPlaceAsked': {
      if (event.cardOf === null)
        return current.reasonsForErrors.isEntryCellToFixInPlace && current.formulaFromWords.agent === 'available'
          ? askAgentToFixFormula(
              {
                ...current,
                menu: null,
              },
              reads,
              activeAnchorCell(current, reads),
            )
          : withNoEffects(current);
      let explained = cellExplained(current, reads);
      return explained === null || cellKeyText(explained.cellId) !== event.cardOf
        ? withNoEffects(current)
        : askAgentToFixFormula(current, reads, explained.cellId);
    }
    case 'chatAskedAfterNoFix': {
      let cellOfNotice = cellOfFixNotice(current);
      return withNoEffects(
        cellOfNotice === null || current.mode.kind === 'editing' ? current : withoutOtherRanges(moveActiveCellTo(current, reads, cellOfNotice, 'pointer')),
      );
    }
    case 'noticeOfNoFixPutAway':
      return withNoEffects(withFixNoticeDown(current));
    case 'errorCardPutAway':
      return withNoEffects(putAwayErrorCard(current, reads, event.cardOf));
    case 'fillKeyPressedOutsideCells':
      return withNoEffects({
        ...current,
        lastDone: {
          what: 'nothingToFill',
        },
      });
    case 'steppedBackIntoCells':
      return withNoEffects(current.isSteppedOutOfCells ? stepBackIntoCells(current) : current);
    case 'tabGoesOnFromCells':
      return withNoEffects(
        current.mode.kind === 'navigating'
          ? {
              ...current,
              isSteppedOutOfCells: true,
            }
          : current,
      );
    case 'linkHeldByCommentMode':
      return withNoEffects({
        ...current,
        lastDone: null,
        notice: {
          kind: 'linkHeldByCommentMode',
        },
      });
    case 'commentModeChanged': {
      if (event.isOn === current.isCommentModeOn)
        return withNoEffects(
          current.isCommentModeLeftByPress
            ? {
                ...current,
                isCommentModeLeftByPress: false,
              }
            : current,
        );
      let isRefusedForCommentMode = current.notice?.kind === 'editRefused' && current.notice.why === 'commentModeIsOn';
      return withNoEffects({
        ...current,
        isCommentModeOn: event.isOn,
        isCommentModeForACard:
          event.isOn && (event.isToolForEditors === false || (current.comments?.some(({ isOpen }: { isOpen: boolean }) => isOpen) ?? null)),
        isCommentModeLeftByPress: false,
        hasCommentModeRefused: false,
        notice: isRefusedForCommentMode ? null : current.notice,
      });
    }
    case 'commentModeLeftByPress': {
      if (event.isReleased)
        return {
          state: current,
          effects: [
            {
              kind: 'endCommentMode',
              isAskNext: false,
            },
          ],
        };
      if (!current.doesCommentModePickCells) return withNoEffects(current);
      let isRefusedForCommentMode = current.notice?.kind === 'editRefused' && current.notice.why === 'commentModeIsOn';
      return withNoEffects({
        ...current,
        isCommentModeLeftByPress: true,
        notice: isRefusedForCommentMode ? null : current.notice,
      });
    }
    case 'commentsPointedAt':
      return withNoEffects({
        ...current,
        commentsPointedAt: event.handles,
      });
    case 'commentsTold': {
      let isCommentModeForACard =
        current.isCommentModeForACard ?? (event.listed.length === 0 ? null : event.listed.some(({ isOpen }) => isOpen));
      return openCommentByKeyboard(
        withCommentsTold(
          {
            ...current,
            isCommentModeForACard,
          },
          event,
        ),
        reads,
        event.sentToAgent,
      );
    }
    case 'commentChosen':
      return openCommentAtSelection(current, reads, event.isForAgent === true);
    case 'commentMarkPressed':
      return current.mode.kind === 'navigating'
        ? {
            state: {
              ...goToCommentKeepingScroll(current, reads, event.handle),
              pressesOnFillHandle: 0,
            },
            effects: [
              {
                kind: 'openComment',
                handle: event.handle,
              },
            ],
          }
        : withNoEffects(current);
    case 'commentPicked':
      return withNoEffects((event.isByPreview === true ? goToCommentKeepingScroll : goToComment)(current, reads, event.handle));
    case 'caretAtEndChanged':
      return withNoEffects(
        keepCaretAtEndInView(
          event.at === current.caretAtEnd
            ? current
            : {
                ...current,
                caretAtEnd: event.at,
              },
          reads,
        ),
      );
    case 'endOfSheetLeftByKey':
      return withNoEffects(scrollToShowActiveCell(current, reads));
    case 'linesAtEndAsked':
      return current.mode.kind === 'editing' ? endEntryOnPointerPress(current, reads, null) : addLinesAtEnd(current, reads, event);
    case 'editAnswered': {
      const { edit, outcome, ifQueued } = event;
      let holdsBoxAlone = current.dragging?.kind === 'selecting' && current.dragging.holdsBoxAlone;
      if (outcome.kind === 'refused' && edit.kind === 'enter' && holdsBoxAlone === true)
        return reduceSheetsEvent(dropPressedCheckbox(current), event, context);
      if (outcome.kind === 'editQueued' && outcome.isSentAsSeveralEdits === true && !current.isLargeEditUnsaved)
        return reduceSheetsEvent(
          {
            ...current,
            isLargeEditUnsaved: true,
          },
          event,
          context,
        );
      if (current.heldUntilAnswered?.edit === edit) {
        let heldEventReduced = reduceSheetsEvent(
          {
            ...current,
            heldUntilAnswered: null,
          },
          event,
          context,
        );
        if (outcome.kind !== 'editQueued') return heldEventReduced;
        let held = current.heldUntilAnswered.held;
        return {
          ...heldEventReduced,
          state: keepResizedLineInSight(heldEventReduced.state, held, reads),
        };
      }
      if (ifQueued.askOfChart !== void 0)
        return withNoEffects(
          outcome.kind === 'editQueued'
            ? {
                ...current,
                undoOffer: null,
              }
            : current,
        );
      if (ifQueued.endsEntryAtOnce === true) {
        let firstEntryAnswered = answerFirstEntry(current, reads, event);
        return withNoEffects(
          ifQueued.formatsToCome !== void 0 && ifQueued.foundBy === 'key'
            ? rebaseOpenListsOnScroll(current, keepKeyedSelectionShown(firstEntryAnswered, reads))
            : firstEntryAnswered,
        );
      }
      let { pasteOfTextInstead } = ifQueued;
      if (
        pasteOfTextInstead !== null &&
        (edit.kind === 'pasteCellsOfAnotherProgram'
          ? outcome.kind === 'refused' &&
            (outcome.refusal !== 'tooMuchThatNoCellShows' || hasPastedLinks(edit.rows)) &&
            outcome.refusal !== 'repeatedPasteTooLarge' &&
            outcome.refusal !== 'rowNotNamedInTheWay' &&
            outcome.refusal !== 'formulaReadsAnotherRow' &&
            outcome.refusal !== 'cellOfDropdownHoldsNoOption' &&
            refusalMessageKey(outcome.refusal) !== 'noRoomInWorkbook'
          : edit.kind === 'pasteValuesOfCopiedCells'
            ? outcome.kind === 'refused' &&
              outcome.refusal !== 'repeatedPasteTooLarge' &&
              outcome.refusal !== 'rowNotNamedInTheWay' &&
              outcome.refusal !== 'cellOfDropdownHoldsNoOption' &&
              refusalMessageKey(outcome.refusal) !== 'noRoomInWorkbook'
            : (outcome.kind === 'nothingToChange' && ifQueued.isMadeAroundRowsOutOfView !== true) ||
              (outcome.kind === 'refused' && outcome.refusal === 'unreadableCopiedCells'))
      )
        return pasteIntoSelection(current, reads, pasteOfTextInstead);
      if (outcome.kind === 'toBeShownFirst') {
        let { pasteChosen } = ifQueued;
        let { textThatNoCellShows } = outcome;
        let replacementsDropped = pasteChosen === undefined ? dropReplacementsNotShown(current, edit, textThatNoCellShows, ifQueued) : null;
        if (replacementsDropped !== null) return replacementsDropped;
        if (ifQueued.thenEvent?.kind === 'fixesKeptAnswered') return dropFixesTakenBack(current, reads, textThatNoCellShows);
        if (ifQueued.thenEvent?.kind === 'fixKeptAnswered') return takeBackKeptFix(current, ifQueued.thenEvent.cellId);
        return withNoEffects(
          pasteChosen === undefined
            ? noticeOfRefusedEdit(current, reads, edit, 'unreadableRequest', ifQueued)
            : holdPasteThatWaits(current, {
                chosen: pasteChosen,
                sheetId: 'selected' in edit ? edit.selected.sheetId : current.sheetId,
                toBeShown: textThatNoCellShows,
              }),
        );
      }
      if (outcome.kind === 'refused' && ifQueued.isSaveOfOpenEntry === true) return withNoEffects(current);
      if (outcome.kind === 'refused') {
        let replacementsDropped = outcome.refusal === 'tooMuchThatNoCellShows' ? dropReplacementsNotShown(current, edit, 'tooMany', ifQueued) : null;
        if (replacementsDropped !== null) return replacementsDropped;
        return {
          state: noticeOfRefusedEdit(
            restoreViewOfRefusedEdit(
              stopArrowsActingOnCells(
                edit.kind === 'changeConditionalFormat'
                  ? clearChosenTestBeingAdded(current)
                  : ifQueued.entryBeforeLine !== void 0
                    ? {
                        ...clearPassingNotice(current),
                        mode: NAVIGATING_MODE,
                        dropdown: null,
                        peopleList: null,
                      }
                    : current,
              ),
              ifQueued,
              reads,
            ),
            reads,
            editAnsweredFor(event, outcome),
            outcome.refusal,
            ifQueued,
          ),
          effects: [
            ...(ifQueued.dropsWhatIsHeld === undefined
              ? []
              : [
                  {
                    kind: 'dropWhatIsHeld',
                  } satisfies PageEffect,
                ]),
            ...discardEffectsOfRefusal(edit, outcome.refusal),
          ],
        };
      }
      let isQueued = outcome.kind === 'editQueued';
      let undoOffer = isQueued
        ? textsConvertedOfferAfterEdit(countLeftAfterReplaceAll(ifQueued, current, context), edit, reads)
        : current.undoOffer;
      let lineEdit = lineEditAfterEntry(current, event, context);
      if (lineEdit !== null)
        return {
          state: {
            ...current,
            undoOffer,
          },
          effects: [lineEdit],
        };
      const isSortEdit = edit.kind === 'sortRows' || edit.kind === 'sortCells';
      let { leavesEntryOpen: keepsEntryOpen } = ifQueued;
      let nextMode = keepsEntryOpen ? current.mode : NAVIGATING_MODE;
      let nextDropdown = keepsEntryOpen ? current.dropdown : null;
      let nextPeopleList = keepsEntryOpen || ifQueued.thenPeopleList === 'staysOpen' ? current.peopleList : null;
      let selectionAfterEdit = edit.kind === 'fillCells' ? null : (areaOfPastedTexts(reads, edit) ?? ifQueued.select);
      let isSortThatChangedNothing = isSortEdit && !isQueued;
      let keepsDoneAndSelect =
        isQueued || edit.kind === 'setBorders' || edit.kind === 'setRowHeights' || edit.kind === 'setColumnWidths' || edit.kind === 'fitColumns';
      let answeredState = selectAfterEdit(
        {
          ...clearPassingNotice(current),
          undoOffer,
          mode: nextMode,
          dropdown: nextDropdown,
          peopleList: nextPeopleList,
          customNumberFormat: afterFormatApplied(current.customNumberFormat, edit, null),
        },
        reads,
        keepsDoneAndSelect
          ? ifQueued
          : {
              ...ifQueued,
              done: null,
              select: selectionAfterEdit,
            },
        isQueued ? narrowImportedArea(edit, (outcome as EditQueuedOutcome).placeChanged, reads) : null,
      );
      let stateWithLastDone = refreshLastDoneCounts(answeredState, reads, edit);
      let { done } = ifQueued;
      let sortDone = typeof done === 'object' && (done?.what === 'rowsSorted' || done?.what === 'cellsSorted') ? done : null;
      let stateWithNotice: PageState =
        edit.kind === 'renameSheet'
          ? {
              ...stateWithLastDone,
              sheetBeingRenamed: null,
              lastDone: isQueued
                ? {
                    what: 'sheetRenamed',
                    name: edit.name,
                  }
                : null,
            }
          : edit.kind === 'moveSheet' && isQueued
            ? {
                ...stateWithLastDone,
                lastDone: lastDoneOfSheetMove(reads, edit.sheetId),
              }
            : edit.kind === 'fillCells' && !isQueued && ifQueued.foundBy !== 'fillHandle'
              ? {
                  ...stateWithLastDone,
                  lastDone: {
                    what: 'nothingToFill',
                  },
                }
              : edit.kind === 'duplicateSheet' &&
                  edit.placedViews?.kind === 'leftBehind' &&
                  isQueued &&
                  (stateWithLastDone.notice === null || noticeGivesWay(stateWithLastDone.notice))
                ? {
                    ...stateWithLastDone,
                    notice: {
                      kind: 'chartsLeftBehindByDuplicate',
                    },
                  }
                : isSortThatChangedNothing && sortDone !== null && (stateWithLastDone.notice === null || noticeGivesWay(stateWithLastDone.notice))
                  ? {
                      ...stateWithLastDone,
                      notice: {
                        kind: 'alreadySorted',
                        column: sortDone.column,
                      },
                    }
                  : stateWithLastDone;
      if (edit.kind === 'pasteTexts' && ifQueued.undoOffer?.kind === 'textsConverted' && undoOffer === null) {
        let noticeAfterUndo: PageState['notice'] =
          stateWithNotice.notice === null || noticeGivesWay(stateWithNotice.notice)
            ? {
                kind: 'textsNotConverted',
                count: edit.cells.length,
              }
            : stateWithNotice.notice;
        return isQueued
          ? {
              state: {
                ...stateWithNotice,
                notice: current.notice,
              },
              effects: [
                {
                  kind: 'undoOrRedo',
                  direction: 'undo',
                  takesBackFor: noticeAfterUndo,
                },
              ],
            }
          : withNoEffects({
              ...stateWithNotice,
              notice: noticeAfterUndo,
            });
      }
      if (ifQueued.dropsWhatIsHeld === 'always')
        return {
          state: stateWithNotice,
          effects: [
            {
              kind: 'dropWhatIsHeld',
            },
          ],
        };
      let { thenInDropdownEditor } = ifQueued;
      if (ifQueued.thenGoesOnTo !== undefined) return withNoEffects(moveActiveCellTo(stateWithNotice, reads, ifQueued.thenGoesOnTo));
      if (ifQueued.thenCalendar === 'opens') return withNoEffects(withCalendarOpen(stateWithNotice, reads));
      if (ifQueued.thenPeopleList === 'staysOpen') return withNoEffects(keepPeopleListOpen(stateWithNotice, reads));
      if (ifQueued.thenDropdownList === 'opens') return withNoEffects(openDropdownListOrEditor(stateWithNotice, reads));
      if (ifQueued.thenListOfPressedCell === 'opens') {
        let listOpened = openListOfPressedActiveCell(stateWithNotice, reads, ifQueued.select);
        return withNoEffects(ifQueued.thenEntryOfPressedCell === 'opens' ? openEntryOfPressedActiveCell(listOpened, reads, ifQueued.select) : listOpened);
      }
      if (ifQueued.thenEditorOfTopRule !== undefined && isQueued)
        return withNoEffects(openEditorOfTopRule(stateWithNotice, reads, ifQueued.thenEditorOfTopRule));
      if (thenInDropdownEditor === undefined) return withNoEffects(stateWithNotice);
      if (thenInDropdownEditor === 'opens') return withNoEffects(editDropdownOfEntryCell(stateWithNotice, reads));
      return withNoEffects(refreshDropdownEditor(stateWithNotice, reads, thenInDropdownEditor));
    }
    case 'undoOrRedoAnswered': {
      let { direction, outcome, takesBackFor } = event;
      let isSentAsSeveralEdits = outcome.kind === 'made' && outcome.isSentAsSeveralEdits === true;
      let isLargeEditUnsaved = current.isLargeEditUnsaved || isSentAsSeveralEdits;
      let withoutUndoOffer = {
        ...current,
        undoOffer: null,
        isLargeEditUnsaved,
      };
      if (takesBackFor !== void 0)
        return withNoEffects({
          ...withoutUndoOffer,
          lastDone: null,
          notice: takesBackFor,
        });
      let isUndo = direction === 'undo';
      let afterStep = ((): PageState => {
        switch (outcome.kind) {
          case 'nothingLeft': {
            if (isUndo && current.areStepsToUndoLost) {
              let noticeOfLostSteps: Notice = {
                kind: 'undoStepsLeftInEarlierPage',
              };
              return {
                ...{
                  ...clearPassingNotice(current),
                  lastDone: null,
                  notice: noticeOfLostSteps,
                },
                areStepsToUndoLost: false,
              };
            }
            const stepNotTaken = isUndo ? 'nothingToUndo' : 'nothingToRedo';
            let stepsLeftNotice = isUndo && current.notice?.kind === 'undoStepsLeftInEarlierPage' ? current.notice : null;
            return {
              ...current,
              notice: stepsLeftNotice,
              lastDone: {
                what: stepNotTaken,
              },
            };
          }
          case 'refused': {
            let refusalReason = editRefusalReason(outcome.refusal);
            return {
              ...current,
              notice: {
                kind: 'editRefused',
                why: refusalReason,
                asked: 'otherEdit',
              },
            };
          }
          case 'stepGivenUp':
            return {
              ...withoutUndoOffer,
              notice: noticeOfStepNotTaken(outcome, direction),
            };
          case 'made': {
            let stepShown: StepShown = isUndo ? 'undone' : 'redone';
            let { changed, changedBefore = [] } = outcome;
            let changes = [...changedBefore, ...(changed === null ? [] : [changed])];
            let reversedSelection = selectionOfStepReversed(current, direction, outcome);
            return changedBefore.length === 0
              ? showChangedPlace(clearPassingNotice(withoutUndoOffer), reads, stepShown, changed, reversedSelection)
              : showUndoneOrRedone(clearPassingNotice(withoutUndoOffer), reads, stepShown, changes);
          }
        }
      })();
      let caretFollowed = followCaretAtEnd(current, afterStep, reads);
      return withNoEffects(scrollBackIfNewChartGone(caretFollowed, reads));
    }
  }
}
export const withPeopleListShut = (state: PageState): PageState =>
  state.peopleList === null
    ? state
    : {
        ...state,
        peopleList: null,
      };
