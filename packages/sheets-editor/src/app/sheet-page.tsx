import { DEFAULT_TOAST_TIMEOUT_MS, useToasts } from '../kit/toast.tsx';
import { Surface } from '../kit/surface.tsx';
import { UiRoot } from '../kit/theme.tsx';
import { useStore } from 'zustand';
import { useConnectionProblem } from '../shell/connection-news.ts';
import { rotatedResizeCursor } from '../kit/selection-frame.tsx';
import { likelyHasKeyboard, subscribeSheetMedia } from '../kit/platform.ts';
import { Button } from '../kit/button.tsx';
import { Icon, type IconName } from '../kit/icon.tsx';
import { TooltipGroup } from '../kit/tooltip.tsx';
import type { SheetController } from '../state/controller.ts';
import type { SheetClipboard } from '../clipboard/page-clipboard.ts';
import type { FrameChrome } from '../shell/frame-chrome.ts';
import type { ConnectionNews } from '../shell/connection-news.ts';
import type { WordsOfLoad } from '../shell/load-announcer.ts';
import type { ChatWithAgent } from '../agent/chat-with-agent.ts';
import type { StockChartMaker, ChartWriterByAgent } from '../charts/new-charts.ts';
import type { ChartEditsByAgent } from '../charts/agent-edits.ts';
import type { ChartCardCount } from '../agent/changes-by-agent.ts';
import type { HostComments } from '../comments/agent-ai-comments.ts';
import type { MouseAroundComments } from '../comments/mouse-around.ts';
import type { ChartsRunOn, CardUnderChart } from '../charts/placed-views-layer.tsx';
import type { LinkPlace } from '../links/cell-links-view.tsx';
import type { PasteKeyTracker } from '../clipboard/paste-keys.ts';
import type { FindTextGiven } from '../ui/find-bar.tsx';
import type { PagePoint } from '../comments/page-comments.ts';
import type { FilesForAgent } from '../agent/files-for-agent.ts';
import type { ZoomStore } from '../grid/zoom.ts';
import type { PersonInputWatch } from './input-watch.ts';
import type { GridPoint, PaneRect } from '../grid/geometry.ts';
import type { PointBox } from '../grid/zoom.ts';
import type { AnchorOnPage } from '../chips/people-list-view.tsx';
import type { GridDrawingProps } from '../grid/grid-drawing.tsx';
import type { GridOfPage, PageView } from '../view/page-view.ts';
import type { PageMode } from '../state/transitions.ts';
import type { KeyPress, LinkCardAsked, ChosenIn, PageEvent } from '../state/event-reducer.ts';
import type { KeyEventFields, KeyWithModifiers } from '../keys/key-press.ts';
import type { Wait } from '../state/calculating-shown.ts';
import type { AllSavedSay, LongCalculationSay } from '../ui/save-status.tsx';
import type { EntryBox } from '../editor/entry-boxes.ts';
import type { EntryEditorElement } from '../dom/entry-editor.ts';
import type { DrawnBox } from '../grid/view-boxes.ts';
import type { EditingMode } from '../state/transitions.ts';
import type { EditTextChanged } from '../state/event-reducer.ts';
import type { PlaceOfKeyboard } from '../agent/added-to-message-notices.tsx';
import type { PressTracker } from './press-tracker.ts';
import type { WindowFocusWatch } from './focus-guards.ts';
import type { PopupOverEntry } from '../state/list-cards.ts';
import type { SelectionHandle } from '../kit/selection-frame.tsx';
import type { KeyAct } from '../keys/key-acts.ts';
import type { CaretGoneTo, CaretOtherEnd } from '../charts/placed-views-layer.tsx';
import type { PlacedViewAct } from '../state/event-reducer.ts';
import type { LinkCardAskedAtPointer } from '../links/cell-links-view.tsx';
import type { ZoomFit } from '../grid/zoom.ts';
import type { TapOnPlacedView } from '../charts/placed-views-layer.tsx';
import type { Taps } from '../selection/finger-taps.ts';
import type { Finger } from '../grid/pinch-zoom.ts';
import type { CaretAtEnd } from '../state/initial-state.ts';
import type { EntryEditorChange } from '../editor/entry-field.tsx';
import type { PickerAskedInCellsMenuBy } from '../ui/format-toolbar.tsx';
import type { MenuOpenChange } from '../ui/sheet-tabs/add-sheet.tsx';
import type { CellAt } from '@open-artifact/sheets-core';
import type { ActInDropdownPane } from '../chips/dropdown-pane.tsx';
import type { ActInRulesPane } from '../format/conditional/pane-state.ts';
import type { ActInSortPane } from '../tables/sort-pane-view.tsx';
import type { SortPaneAsked, VersionHistoryAct } from '../state/event-reducer.ts';
import type { ItemLitInMenu } from '../tables/table-handle-menu.ts';
import type { FieldOfChipsBox } from '../chips/field-of-chips.tsx';
import type { FixPillAct } from '../formulas/fix/fix-pill.tsx';
import type { HowActBegan } from '../format/answer-holds.ts';
import type { CellsToSortChosen } from '../state/event-reducer.ts';
import type { GroupLevelChosen, OwnFiltersCleared } from '../state/event-reducer.ts';
import type { CellHistoryScope } from '../state/initial-state.ts';
import type { ColumnId, SheetId, SortDirection } from '@open-artifact/sheets-core';
import type { OwnFilterListActs } from '../tables/own-filter-list-view.tsx';
import type { FilterButtonPressed } from '../tables/filter-buttons-layer.tsx';
import type { BorderChoice, BorderLine } from '../format/borders.ts';
import type { FormatCommand } from '../format/format-commands.ts';
import type { FileOrWhyNotRead } from '../import/csv-file.tsx';
import type { RulesPaneAction } from '../format/conditional/pane-state.ts';
import type { RuleNumber } from '../format/conditional/ask-agent-about-rule.tsx';
import type { FixesAct } from '../formulas/fix/errors-notice.tsx';
import type { ChartKindOrAny, WhyNoChart } from '../charts/chart-words.ts';
import type { ChartEndWord, ChartLane } from '../agent/changes-by-agent.ts';
import type { ChartMaking } from '../charts/chart-making.ts';
import type { AskSentToChat, ChartChangeOutcome } from '../messages/charts.ts';
import type { ChartNodeSwap } from '../charts/widget-nodes.ts';
import type { SendToAgentAboutView } from '../charts/placed-views-layer.tsx';
import type { OpenerOwed } from '../tables/own-filter-bar-view.tsx';
import type { OfferAtSelection } from '../ui/offers-at-selection.tsx';
import type { PressToSwallow } from '../ui/press-swallow.ts';
import type { ContextToolsState } from '../ui/toolbar/context-tools.ts';
import type { ConnectionBackSay } from '../ui/save-status.tsx';
import type { FontMark } from '../state/initial-state.ts';
import type { SelectionForAgent } from '../state/initial-state.ts';
import type { BarPicker } from '../ui/search-menu/bar-commands.tsx';
import type { ThemeMode } from '../kit/theme.tsx';
import type { SheetSearchEvent } from '../ui/search-menu/sheet-commands.ts';
import type { MenuCommand } from '../ui/search-menu/matching.ts';
import type { CommandsUnderHeading } from '../ui/search-menu/command-groups.ts';
import type { CommandsOfTypedWords } from '../ui/cell-menu/cell-menu.tsx';
import type { LinkExplainedView } from '../view/page-view.ts';
import type { StyleWithVariables } from '../grid/cell-drawing.tsx';
import type { CalendarUnderCellProps } from '../chips/calendar-under-cell.tsx';
import type { DropdownListUnderCellProps } from '../chips/dropdown-list.tsx';
import type { PeopleListProps } from '../chips/people-list-view.tsx';
import type { TimeListPopupProps } from '../editor/time-list-popup.tsx';
import type { WordsOfferedButtonProps } from '../editor/words-offered-view.tsx';
import type { ConditionalFormattingPaneProps } from '../format/conditional/pane.tsx';
import type { CustomNumberFormatDialogProps } from '../format/custom-number-format-dialog.tsx';
import type { ColumnWidthDialogProps } from '../grid/column-width-dialog.tsx';
import type { GroupMarginProps } from '../grid/group-margin.tsx';
import type { RowHeightDialogProps } from '../grid/row-height-dialog.tsx';
import type { ImportDialogProps } from '../import/import-dialog.tsx';
import type { OwnFilterBarViewProps } from '../tables/own-filter-bar-view.tsx';
import type { SortFilterCardListProps } from '../tables/sort-filter-card.tsx';
import type { CellContextMenuProps } from '../ui/cell-menu/cell-menu.tsx';
import type { FormattingToolbarProps } from '../ui/format-toolbar.tsx';
import type { LocaleTimeZoneDialogProps } from '../ui/locale-time-zone-dialog.tsx';
import type { SheetPickerProps } from '../ui/sheet-tabs/sheet-picker.tsx';
import type { ViewMenuProps } from '../ui/view-menu.tsx';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { TOOLBAR_TAB_STOP_SELECTOR, toolbarTabStopOf } from '../ui/toolbar/keys-hint.tsx';
import {
  LINK_AMONG_TEXT_ATTR,
  LINK_IN_WORDS_ATTR,
  openLinkIfShown,
  openLinkUnlessCommentMode,
  linkPlaceOfUrl,
  openLinkFromKey,
  useLinkPressHandler,
  useLinkPressCursor,
  LINK_ADDRESS_ID,
} from '../links/cell-links-view.tsx';
import {
  cellPositionOfElement,
  GridDrawing,
  ARE_ROWS_NAMED_HERE,
  boxInBody,
  zoomedEntryBox,
  cellEntryBoxStyle,
  entryGridlineOverlap,
  gridlinesDataAttribute,
  outlineBoxInBody,
} from '../grid/grid-drawing.tsx';
import { pointInZoomedElement, unzoomLength, boxOnScreen, clampZoom, zoomToFit, zoomForFitting, withFitZoom, zoomedStyle, useZoom } from '../grid/zoom.ts';
import { Fragment } from 'react/jsx-runtime';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import {
  BlankCellWordsContext,
  BLANK_CELL_WORDS_BY_PLATFORM,
  textClearanceStyle,
  fillPaintStyle,
  textPaintStyle,
  paintDataAttributes,
  TextWidthProvider,
  SELECTION_SUMMARY_ID,
  peopleListKeepsToColumn,
  personChipLinesOfCell,
} from '../grid/cell-drawing.tsx';
import { useCellsAsBefore, useChangesComingIn } from '../agent/changes-coming-in.ts';
import { useLingeringRows } from '../ui/lingering-rows.ts';
import { IS_IOS_BROWSER } from '../grid/cell-drawing-values.ts';
import { useLineKeys } from '../grid/line-keys.ts';
import { NO_WORDS_OF_LOAD } from '../shell/load-announcer.ts';
import { NO_CHAT_WITH_AGENT, MAX_ASK_WORDS_LENGTH, cleanAskWords } from '../agent/chat-with-agent.ts';
import { NO_CHART_MAKER, insertChartWrittenByAgent } from '../charts/new-charts.ts';
import { NO_AGENT_AI_COMMENTS } from '../comments/agent-ai-comments.ts';
import { noMouseAroundComments } from '../comments/mouse-around.ts';
import {
  CHARTS_RUN_ON_NOTHING,
  findPlacedViewCaret,
  PLACED_VIEW_CARET_SELECTOR,
  isPlacedViewAskInput,
  placementIdOfElement,
  findPlacedViewAskInput,
  doesCaretStayWithPlacement,
  isInPlacedViewAskBox,
  isInPlacedViewControls,
  getPlacedViewRect,
  isInPlacedViewCardOrTools,
  placementIdAttributes,
  askWordsOfKind,
  howCaretComesToPlacedView,
  PlacedViewsLayer,
} from '../charts/placed-views-layer.tsx';
import { DRAG_START_DISTANCE } from '../grid/geometry.ts';
import {
  useIsTrueForVisibleMs,
  LONG_RETRY_WARNING_MS,
  saveStatusCard,
  LONG_SAVE_NOTICE_DELAY_MS,
  nextIsLongSaveTold,
  lossNewsAtAllSaved,
  nextAllSavedSay,
  areEditsNewlyDropped,
  SAID_NOTICE_SHOWN_MS,
  nextLongCalculationSay,
  doesStepOutLeaveNotice,
  nextConnectionBackSay as nextConnectionBackSayImported,
  isNoticeApartFromSaveCard,
  SaveStatusToast,
  isSavingStoppedRefusal,
  calculatingWords,
} from '../ui/save-status.tsx';
import { useKeysOffCells, getKeysOffCellsState } from './keys-off-cells.ts';
import { preventMouseDownDefault, IS_APPLE_PLATFORM, isContextMenuClick, isTouchOrPenPointer, opensMenuAtPointer } from '../ui/dom-events.ts';
import { preventPageScrollOverField } from '../shell/touch-scroll-under-keyboard.ts';
import { isEntryEditor, entryEditorOf, isTextInputOrEntryEditor } from '../dom/entry-editor.ts';
import {
  useCellEntryFieldEvents,
  isWordsOfferedKeyDrawn,
  isOnWordsOfferedButton,
  WordsOfferedAnnouncer,
  WordsOffered,
  WordsOfferedButton,
} from '../editor/words-offered-view.tsx';
import {
  useEntryBoxes,
  giveEntryBoxOfItsOwn,
  caretInEntryPatch,
  typingBoxOf,
  giveEntryBoxToFormat,
  forgetCaretPlacement,
  isPastingIntoEntryNow,
} from '../editor/entry-boxes.ts';
import { useTypingHoldForPanes } from '../ui/typing-hold.ts';
import {
  initialSidePaneWidth,
  focusPaneStart,
  focusSidePaneOrTitle,
  sheetBesideSidePaneProps,
  SHEET_BEHIND_SIDE_PANE_CLASS,
  SidePaneShutContext,
} from '../ui/side-pane/side-pane.tsx';
import {
  useWaysInWaitedFor,
  useAnnouncementsUnderWay,
  useAgentAskedFromWaysIn,
  useWaysInShown,
  useWaysInOutOfSightReport,
  useEscapeSendsWaysInAway,
  useWaysInFocusKeeping,
} from '../ui/ways-in/ways-in-state.ts';
import { setWaysInShown } from '../ui/toolbar/ways-in-shown.ts';
import { useRoomKeptForGonePane } from '../ui/gone-pane-room.ts';
import {
  TOAST_SELECTOR,
  OPEN_DIALOG_SELECTOR,
  AT_FOOT_ATTRIBUTE,
  DIALOG_ROLE_SELECTOR,
  MOVED_WHILE_FADING_ATTRIBUTE,
  STATUS_ROLE_SELECTOR,
  isInsideUnpinnedToast,
  isInsideToast,
  hasInteractiveToast,
} from '../shell/ui-root.tsx';
import { COLUMN_HEADER_HEIGHT, cellPaddingBesideBox } from '../grid/cell-metrics.ts';
import { clipBoxToShown, commentMarksAtPoint } from '../grid/view-boxes.ts';
import {
  boxesNoticesMustNotCover,
  shouldNoticesSitAtFoot,
  noticeSpotAtFoot,
  noticeLiftToClearCells,
  NOTICE_STACK_STEP_PX,
} from '../shell/notice-placement.ts';
import {
  takePressesAfterDelay,
  useColumnGripCalled,
  cellOfGripPressed,
  ColumnGrips,
  ColumnsRiding,
  UndoAgentTurnCard,
  DoneByAgentCard,
} from '../agent/done-by-agent.tsx';
import { useCommentMode } from '../comments/comment-mode.ts';
import { commentCornerKeyOf, commentCardPlaces, markCommentLayersUnderMouse, didMouseLeaveIntoOverlay } from '../comments/card-places.ts';
import {
  OFFERS_AT_SELECTION_BUTTONS_SELECTOR,
  isInOffersAtSelection,
  focusNeighbourOffer,
  isInExpandedEntry,
  OffersAtSelection,
  ExpandedEntryFinishButton,
  ExpandButtonAtSelection,
} from '../ui/offers-at-selection.tsx';
import {
  AT_END_OF_SHEET_FIELDS,
  isInAtEndOfSheet,
  isAtEndOfSheetInput,
  focusAtEndOfSheetField,
  ADD_MORE_COLUMNS_BUTTON_ID,
  AddAtEndOfSheet,
} from '../grid/add-at-end.tsx';
import {
  ERRORS_OFFERED_ATTRIBUTE,
  isPlainTabWhileNavigating,
  didFocusLeaveByTab,
  partStepOfTabInEntry,
  hasShortcutModifier,
  askAgentToFixOfferedErrors,
  areMoreErrorsThanKnown,
  noteErrorsKnownOf,
  doesKeyStepBackIntoCellsButF6,
  isTrustedPlainTab,
  ErrorsOfferNotice,
} from '../formulas/fix/errors-notice.tsx';
import {
  useIsComposing,
  withoutOfferWhenComposing,
  formulaOfferActiveDescendant,
  WaitForFormula,
  FormulaArriving,
  FormulaFromWordsHelp,
} from '../formulas/from-words/offer-list.tsx';
import { watchWindowFocusLeft, createScrollGestureTimer, holdProgrammaticFocus, isTrustedPointerDownEvent } from './focus-guards.ts';
import { areFocusLeftChecksHeld, whenWindowBlurred, isFocusWithinSameMenu, whenBlurredToNothing } from '../grid/focus-left.ts';
import { hasElementAwaitingKeyboard, offerKeyboardWhenReady } from '../ui/keyboard-handoff.ts';
import { focusMoveOfKey, isActLeftToCtrlAlt, keyActOf, doesPopupLetLineBreak, listKindOfShortcut, movesCaretInEntry } from '../keys/key-acts.ts';
import { slideOffsetNow, useTabsAway, watchKeyboardSlides } from '../shell/tabs-away.ts';
import {
  getBottomSafeAreaInset,
  getKeyboardInset,
  setBarsInsetAtFoot,
  subscribeBottomInsets,
  useCoveredUnderCellsProperty,
  useFootInsetOf,
} from '../shell/bottom-insets.ts';
import {
  isOnPhone,
  isNarrowByTouch,
  isCoarsePointerNow,
  useNarrowPhone,
  useOnPhone,
  isTouchBelowSm,
  useCoarsePointer,
  useNarrowByTouch,
} from './media-queries.ts';
import { defaultRowHeightAtDensity } from '../grid/cell-metrics-values.ts';
import { useFormulaBarRemountKey } from '../editor/formula-bar-remount.ts';
import { isModalOpen } from '../ui/find.ts';
import { groupLevelCount, gridHeaderRoomStyle, groupMarginRoomStyle, GroupMargin } from '../grid/group-margin.tsx';
import { useFormulaBarLines, firstLineWidthStyle } from '../editor/formula-bar-folding.ts';
import { isFormulaText, DROPDOWN_SCROLL_SLOP } from '../chips/dropdown-pane-edits.ts';
import { watchAnotherRangeKey } from '../selection/another-range-key.ts';
import { useAnnouncedLastDone, announcementOfLastDone } from '../ui/last-done-announcer.ts';
import { afterNextFrameOrTimeout } from '../utils/next-frame.ts';
import { useNameFlagsAtPointer } from '../presence/flags-at-pointer-hook.ts';
import { useFilterButtonPointedAt, FilterTableOutlines, FilterButtonsLayer } from '../tables/filter-buttons-layer.tsx';
import {
  useTableHandleCall,
  tableKeyOfHandleAt,
  isAtTableHandleOverRowNumber,
  rowNumberUnderTableHandle,
  TableHandle,
} from '../tables/table-handle.tsx';
import { useGridZoomGestures } from '../grid/zoom-gestures.ts';
import { useStepBackIntoCells, ReaderPageAnnouncer, ReadersScroller } from '../state/step-back-into-cells.tsx';
import { useMarksOfImportExpiry } from '../import/marks-of-import-expiry.ts';
import { useErrorCardHover, errorCellUnderMouse, askFixOfErrorCard, ErrorCard } from '../formulas/error-card.tsx';
import {
  useLinkCardHover,
  useLinkCardSeen,
  copyTextWithExecCommand,
  linkUnderMouse,
  linkAtPointerPoint,
  LinkCard,
} from '../links/link-hover-card.tsx';
import { findStepShortcut, isFindShortcut, isReplaceShortcut, FindBarUnlessGivenUp } from '../ui/find-bar.tsx';
import { isKeyboardShortcutsKey, isElementLiveAndNotInert, KeyboardShortcutsDialog } from '../ui/keyboard-shortcuts-dialog.tsx';
import { isAllCommandsMenuKey, allCommandsMenuKeyAction, HideKeyboardButton } from '../keys/all-commands-menu-key.tsx';
import { usePressGuardAfterViewMove } from '../ui/press-guard-after-view-move.ts';
import { CELL_HISTORY_CARD_ATTRIBUTE, CellHistoryPopover } from '../history/cell-history-popover.tsx';
import { INITIAL_FOCUS_IS_SAFE_ATTRIBUTE } from '../import/discard-import-dialog.tsx';
import {
  refocusInContextBar,
  useCaretAfterComment,
  createWindowFocusCheck,
  createFingerPressTracker,
  createFingerTapCaret,
  pickFocusTarget,
  isFocusOutsideSearchOrErrors,
} from '../grid/focus-keeping.ts';
import {
  shownSheetIdOf,
  dropAddedChartMaking,
  chartMakingForView,
  placedViewOfAddedChart,
  addedChartForCard,
  dropChartMakingOfNth,
  awaitedChartMaking,
  settleChartMaking,
  chartMakingOutcome,
  isAddedChartStillAtPress,
} from '../charts/chart-making.ts';
import { EMPTY_CLIPBOARD_CONTENT } from '../clipboard/formats.ts';
import { pasteChosenFrom, wasExecCommandHandled, pasteOfLastPutHere } from '../clipboard/page-clipboard.ts';
import { normalizeLineBreaks, flattenEnteredText, trimTrailingNewlines } from '../format/shown-text.ts';
import { isOneLineEditor, NAVIGATING_MODE, isMenuHoldingField } from '../state/transitions.ts';
import { MODIFIER_KEYS } from '../state/escape.ts';
import { isAltCommandPress, isFillDownOrRightKey, isCommandHeld, isTypingKey, latinKeyOf, readKeyPress } from '../keys/key-press.ts';
import { createPressTracker } from './press-tracker.ts';
import { giveUpPopupAround, CanTakeFocusContext } from '../ui/popup-given-up-on-blur.ts';
import { createPasteKeyTracker } from '../clipboard/paste-keys.ts';
import { TABLE_CARD_WIDTH, useHungTableCardPlace } from '../tables/hung-card-place.ts';
import { BLANK_AND_FORMULA_ENTRY_MODES, entryTextAfterKey } from '../editor/typed-keys.ts';
import { isOpenLinkShortcut } from '../links/url-display.ts';
import { swallowRepeatedDeleteKeys, swallowRestOfPress } from '../ui/press-swallow.ts';
import { CONTEXT_BAR_PART_ATTRIBUTE, isInClosingContextBar } from '../ui/toolbar-tooltip.tsx';
import { isRepeatedEnterOrSpace } from '../ui/repeated-key-guards.ts';
import { placedViewKeyAct, isUndoOrFormulasToggle } from '../charts/placed-views.ts';
import { fontMarkOfShortcut } from '../editor/text-looks.ts';
import { defaultSheetName } from '../i18n/sheet-names.ts';
import {
  fixFieldsOfKeyPress,
  fixWaitingUnderPointer,
  pointClampedToRight,
  useFixPointer,
  useWhenKeyCame,
  FixPill,
} from '../formulas/fix/fix-pill.tsx';
import { eventTimeMs, isBeforeAnswerSeen, AgentsAnswerHolds } from '../agent/answer-holds.tsx';
import { useOverscrollBounce, overscrollOf } from '../ui/overscroll-bounce.ts';
import { useFingerFling } from '../grid/finger-fling.ts';
import { usePinchZoom } from '../grid/pinch-zoom.ts';
import { createChartTapTracker } from '../charts/chart-taps.ts';
import { createLineBoxPresses, undoOfferToShow, LingeringEntryInput, CalculatingSpinner } from '../editor/entry-field.tsx';
import {
  NO_TAPS,
  isTapOnGrid,
  TAP_HOLD_LIMIT_MS,
  isSoonAfterCellTap,
  tapsAfterPress,
  tapsPressedOnLastTap,
  tapOnGrid,
  gridSpotAt,
  settleTaps,
  DOUBLE_TAP_GAP_MS,
  TAP_SLOP_PX,
  mayTapBeTold,
  tapsAfterLift,
} from '../selection/finger-taps.ts';
import { armCellMenuTouchGuard, MENU_ON_CELLS_ATTRIBUTE, CellContextMenu } from '../ui/cell-menu/cell-menu.tsx';
import { isSumWithFormulaCell } from '../selection/figures.ts';
import { historyStepOfInputType, isHistoryOrDropInputType, isTypingInputType } from '../editor/commit-entry.ts';
import { isFilterBarAskOpen, whatHasCaretAfterOwnFilterCard, SortFilterCardPopover, OwnFilterBarView } from '../tables/own-filter-bar-view.tsx';
import { isPaneMenuOfContextBar } from '../state/context-bar.ts';
import { SORT_BUTTON_ATTRIBUTE, CustomSortPane } from '../tables/sort-pane-view.tsx';
import { contextBarMenuHandlers } from '../ui/context-bar-menus.ts';
import { isFormatMenuKeepingEntrySelection, isFormatChoiceKeepingEntrySelection } from '../ui/toolbar-entry-selection.ts';
import { sheetPrefixForFormula } from '../formulas/references.ts';
import { GUESS_TABLE_FOR_ROWS_ASK } from '../tables/rows-asked-for.ts';
import { keyTargetAtTableMenu } from '../tables/table-handle-menu.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { POPUP_EDGE_GAP } from '../ui/popup-placement.ts';
import { exampleOfChoice } from '../format/number-format-choices.ts';
import { browserTimeZone } from './browser-locale.ts';
import {
  doesSelectionShowError,
  fixOfferInMenu,
  askAgentAboutSelection,
  askFixFromMenu,
  askFixesOfSelectedCellsFromMenu,
} from '../agent/ask-agent-menu.tsx';
import { shouldEnterCommentForAgent, watchAgentAskedUnderAt } from '../agent/chat-or-comment.ts';
import { storeDensity } from './density-preference.ts';
import { readTablesNotFormatted, writeTablesNotFormatted } from '../tables/tables-not-formatted.ts';
import { whatHasCaretAfterFilterList, OwnFilterList } from '../tables/own-filter-list-view.tsx';
import { askPersonActions } from '../chips/people-list.ts';
import { insertCellControl, cellControlInsertChoices } from '../ui/toolbar/number-format-menu.tsx';
import { ConditionalAskCard } from '../format/conditional/ask-list.tsx';
import { closeOpenMenusAndPopovers } from './page-guards.ts';
import { canSwitchSheetWhileEditing } from '../formulas/sheet-pointed-in.ts';
import { isFormulaAskedOrProposed } from '../formulas/from-words/actions.ts';
import { EVENTS_BEFORE_FILE_IMPORT } from '../import/text-file.ts';
import { useImportFilePicker, importFileChoices } from '../import/csv-file.tsx';
import { PageFileDrop, canTakeDroppedFile, isExcelFileName } from '../import/page-file-drop.tsx';
import { NO_FILES_FOR_AGENT, type AgentFileSource } from '../agent/files-for-agent.ts';
import { trackCellsAddedToChat, CellsAddedAnnouncer, AddedToMessageToast } from '../agent/added-to-message-notices.tsx';
import { askAgentForRulesInChat, askAgentAboutRule } from '../format/conditional/ask-agent-about-rule.tsx';
import { createPressForFixesTracker } from '../formulas/fix/press-for-fixes.ts';
import { chartMessages, chartChangeOutcomeWords } from '../messages/charts.ts';
import { tabStopBefore } from '../ui/last-tab-stop-focus.ts';
import { GUIDE_CARD_ATTRIBUTE, GUIDE_STEP_ON_ATTRIBUTE, WalkthroughCard } from '../links/walkthrough-card.tsx';
import { pageInputHoldBack } from '../debug/input-hold-back.ts';
import { pivotTableMessages, PivotTableOutOfDateBar } from '../tables/pivot-table-messages.tsx';
import { PivotTablePane } from '../tables/pivot-table-pane.tsx';
import type { PivotTablePaneProps } from '../tables/pivot-table-pane.tsx';
import { personChipLinesInRowHeight } from '../grid/chip-metrics.ts';
import type { GuideFromStream } from '../shell/sheet-links.ts';
import { InteractiveSheetBar, InteractiveSheetSection } from '../charts/interactive-sheet-view.tsx';
import type { InteractivesRunOn } from '../charts/interactive-sheet-view.tsx';
import { interactiveSheetMessages } from '../messages/import.ts';
import type { NamedViewsMenuProps } from '../tables/named-views-menu.tsx';
import type { PlacedViewFix } from '../charts/fix-of-placed-view.tsx';
import { SettledWordsAnnouncer, OpenedWordsAnnouncer, UndoOfferAnnouncer } from '../ui/settled-announcers.tsx';
import { areFixesOnOffer, ErrorsAtOpeningAnnouncer, ErrorsAtOpeningToast } from '../formulas/fix/errors-at-opening.tsx';
import { askChatAfterNoFix, NoFixAnnouncer, NoFixToast } from '../formulas/fix/no-fix-notice.tsx';
import { undoOfferOfChartAdded, ChartNotAddedToast, chartAddedAnnouncement } from '../charts/chart-added-toast.tsx';
import {
  chartKindName,
  chartCaptionOrName,
  chartKindNameOrAny,
  newChartTitle,
  CHART_MESSAGES,
  chartRefusalText,
  insertChartKindLabel,
} from '../charts/chart-words.ts';
import { CHART_END_WORDS, chartEndWordOfAgent, countChartAsk, chartAskKindWord } from '../agent/changes-by-agent.ts';
import { isSingleCellSample } from '../charts/cells-held.ts';
import { STOCK_CHART_PROGRAMS } from '../charts/stock-programs.ts';
import { isChartMadeByPage, INSERT_CHART_LABEL, chartAskPayload, chartOffersForPage, chartOfferAtSelection } from '../charts/chart-offers.ts';
import { shouldAskInChatInstead, chartAskFaultShown } from '../charts/ask-to-change-chart.ts';
import { ChartAskMenu } from '../charts/chart-ask-menu.tsx';
import { SortFilterCardList } from '../tables/sort-filter-card.tsx';
import { tableCardPlacement, hungCardUnderFilterButton } from '../tables/table-outlines.ts';
import { wrapTextTool } from '../ui/toolbar/wrap-text-tool.tsx';
import { chartThumbnailIcon } from '../charts/chart-thumbnail.tsx';
import { focusControlInWrapper, disabledByViewOnly, isWrapperOfDisabledControl } from '../ui/why-not.tsx';
import { useImportOnGrid } from '../import/import-on-grid.tsx';
import {
  saveStatusText,
  savingChangesText,
  allChangesSavedText,
  editingBackOnText,
  reconnectedText,
  formulasCalculatedText,
  noticeText,
  agentMissedMessageText,
} from '../i18n/notice-labels.ts';
import { noticeGivesWay } from '../state/queries.ts';
import {
  listAnnouncement,
  withHighlightedRowIdOr,
  comboboxAriaProps,
  listenForListUnderCellEvents,
  isListUnderCellRow,
  isRowFocusOnIos,
  isInListUnderCell,
} from '../ui/list-under-cell.tsx';
import { dropdownListIds, firstDropdownListRowId, dropdownListSpokenWords, DropdownListUnderCell } from '../chips/dropdown-list.tsx';
import { peopleListCardIds, peopleListLabel, peopleListRowWords, PeopleList } from '../chips/people-list-view.tsx';
import { timeListActiveDescendant, TimeListPopup } from '../editor/time-list-popup.tsx';
import { functionListActiveDescendant, OPENS_FUNCTION_LIST_ATTRIBUTE, FunctionHelp } from '../formulas/function-list.tsx';
import { editingCellLabel, editingCellOnSheetLabel } from '../i18n/grid-action-labels.ts';
import { calendarCellComboboxProps, CalendarUnderCell } from '../chips/calendar-under-cell.tsx';
import { entryEditorLineStyle, entryEditorStyle } from '../editor/ios-grown-editor.ts';
import { CHIP_FIELD_LINE_HEIGHT } from '../chips/field-of-chips.tsx';
import { NO_REFERENCES, isEntryUntouched } from '../formulas/reference-pointing.ts';
import { addPeopleHint, PeopleField } from '../chips/people-field.tsx';
import { contextToolsShapeOf, nextContextToolsState } from '../ui/toolbar/context-tools.ts';
import { FormattingToolbar } from '../ui/format-toolbar.tsx';
import { searchMenuBarCommands, functionCommandsForFormula, functionCommandsForPrefix } from '../ui/search-menu/bar-commands.tsx';
import { ViewMenu, viewCommands } from '../ui/view-menu.tsx';
import { asThemeMode, THEME_CHOSEN_ATTRIBUTE, chooseSheetsTheme } from '../shell/root-theme.ts';
import { sheetSearchCommands } from '../ui/search-menu/sheet-commands.ts';
import { blankSheetChooser, dispatchFromSheetList, SheetPicker } from '../ui/sheet-tabs/sheet-picker.tsx';
import { insertTools } from '../tools/insert-tools.ts';
import { atMenuOffers, personChipRemoveHint } from '../i18n/menu-labels.ts';
import { pickFunctionWhenSettled } from '../formulas/function-picked.ts';
import { goToSheetAndColumnCommands, goToCellsCommands, goToLabel } from '../ui/go-to-commands.ts';
import { hexColorCommands, borderCommandsFromWords, typedFontSizeCommands } from '../ui/search-menu/typed-format-commands.ts';
import { commandsUnderHeading } from '../ui/search-menu/command-groups.ts';
import { autocompleteFunctionsHeading, functionListLabel } from '../messages/formula-autocomplete.ts';
import { filterBarToAnnounce, FilterBarAnnouncer } from '../tables/filter-bar-announcer.tsx';
import { isFieldInList } from '../ui/field-in-list.tsx';
import { LINK_FORM_ATTR, LinkEditPopup } from '../links/link-edit-popup.tsx';
import { formulaBarPlaceholder, CellEntryHint } from '../editor/entry-hint.tsx';
import { FormulaBarReferenceHues } from '../editor/formula-bar-hues.tsx';
import { versionHistoryMessages } from '../history/version-text.ts';
import { ThemeChangeNotice } from '../ui/theme-change-notice.tsx';
import { SelectedRangeAnnouncer, PointedCellsAnnouncer } from '../ui/selection-announcers.tsx';
import { AgentSaidAnnouncer } from '../agent/agent-said-announcer.tsx';
import { EarlierVersionAnnouncer, EarlierVersionBar } from '../history/earlier-version-bar.tsx';
import { WaysInHintAnnouncer, WaysInToolbar } from '../ui/ways-in/ways-in-toolbar.tsx';
import { describeLastDone } from '../i18n/last-done-labels.ts';
import { shortcutListMessages } from '../messages/shortcut-labels.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { formulasTookTooLongWords, ERROR_DESCRIPTION_ID, errorExplanationWords } from '../messages/formula-errors.ts';
import { PeopleListAnnouncer } from '../chips/people-list-announcer.tsx';
import { linkPositionText, commentModeHint, builtLinkAddressLabel } from '../i18n/status-labels.ts';
import { UndoOfferToast } from '../ui/undo-offer-toast.tsx';
import { MountedToast } from '../ui/mounted-toast.tsx';
import { AgentUnavailableToast } from '../agent/agent-unavailable-toast.tsx';
import { LeaveCellsHint } from '../ui/leave-cells-hint.tsx';
import { CellsHeld } from '../tables/cells-held-copy.tsx';
import { GridScrollbars } from '../grid/scrollbars.tsx';
import { AddColumnsPopover } from '../ui/add-columns-popover.tsx';
import { ContentsBox } from '../ui/contents-box.tsx';
import { SelectionFigures } from '../ui/selection-figures.tsx';
import { ConditionalFormattingPane } from '../format/conditional/pane.tsx';
import { DropdownPane } from '../chips/dropdown-pane.tsx';
import { VersionHistoryPane } from '../history/version-history-pane.tsx';
import { ColumnWidthDialog } from '../grid/column-width-dialog.tsx';
import { RowHeightDialog } from '../grid/row-height-dialog.tsx';
import { SortScopeDialog } from '../tables/sort-scope-dialog.tsx';
import { CustomNumberFormatDialog } from '../format/custom-number-format-dialog.tsx';
import { HiddenTextPasteDialog } from '../clipboard/hidden-text-paste-dialog.tsx';
import { LocaleTimeZoneDialog } from '../ui/locale-time-zone-dialog.tsx';
import { ImportDialog } from '../import/import-dialog.tsx';
import { ExportReadyDialog } from '../export/export-ready-dialog.tsx';
import { DateInputLocaleContext } from '../chips/date-input.tsx';
import { DRAG_SLOP } from '../selection/pointer.ts';
import { DangerWarningIcon } from '../ui/warning-icon.tsx';
import { isoDayOfDate } from '../chips/calendar.ts';
/** A pointer held down on the grid while it drags: where it is, and which way the cells last scrolled under it. */
interface DragHold {
  at: GridPoint;
  atLastTime: GridPoint | null;
  times: number;
  way: GridPoint;
  isByFinger: boolean;
}
/** How the pointer moved while it is held down. */
interface DragMove {
  pressedAt: GridPoint;
  isButtonDown: boolean;
  isByFinger: boolean;
}
/** The finger pressed on a placed view, kept until it lifts. */
interface PlacedViewPointer {
  pointerId: number;
  placementId: string;
}
/** Where and when a finger last lifted from a quick tap on a placed view, to tell a double tap. */
interface PlacedViewLift {
  placementId: string;
  at: GridPoint;
  liftedAtMs: number;
}
/** A change in a field an entry is typed in: the cell's input, the formula bar, or the rich entry editor. */
interface FieldInput {
  target: HTMLInputElement | HTMLTextAreaElement | EntryEditorElement;
  nativeEvent: Event;
}
/** The filter button or chip a column's own filter list was opened from, and where the list hangs. */
interface FilterListOpener {
  opener: HTMLElement | null;
  isChip: boolean;
  anchor: Pick<Element, 'getBoundingClientRect'>;
  tableKey: string;
  c: ColumnId;
}
/** A toast that offers to undo a change kept on a chart: what came of keeping it, and the nodes swapped. */
interface ChartChangeUndoNotice {
  says: ChartChangeOutcome;
  nodes: ChartNodeSwap;
}
/** Why the last ask for a chart came to nothing, to tell in the chart menu. */
interface ChartAskFault {
  why: WhyNoChart;
  wasByRow: boolean;
  /** The start of the area to chart when the ask was made, so that the fault is no longer told once it moves. */
  tableAtPress?: string | null;
}
/** A chart the agent is writing: what was asked, and the sheet it was asked on. */
interface ChartBeingWritten {
  asked: string;
  sheetId: SheetId | null;
}
/** An ask for a chart the page takes up after the agent did not, or after a while: the cells it was for, and whether the page may take the caret from the bar. */
interface LateChartAsk {
  cells: PageView['selectionByAddress'];
  mayTakeCaretFromBar: boolean;
}
/** Attributes spread on the fields text is typed in, `data-*` ones included. */
type FieldAttributes = React.InputHTMLAttributes<HTMLElement> & { [dataAttribute: `data-${string}`]: string | boolean };
/** The table a sort and filter card is for, and whether it hangs beside the table. */
interface TableCardHang {
  tableKey: string;
  hangBeside: boolean;
}
export let lastObjectKey: number;
export function createDragHoldTracker(store: SheetController) {
  let held: DragHold | null = null;
  let scrollNow = () => {
    let { rows, columns } = store.getView().grid.scroll;
    return {
      x: columns.by,
      y: rows.by,
    };
  };
  return {
    lastAt: () => held?.at ?? null,
    forget: () => void (held = null),
    movedTo(at: GridPoint, { pressedAt, isButtonDown, isByFinger }: DragMove) {
      held =
        (held !== null || !isWithinTapSlop(at, pressedAt)) && isButtonDown
          ? {
              atLastTime: null,
              times: 0,
              way: NO_DRAG_WAY,
              ...held,
              at,
              isByFinger,
            }
          : null;
      store.dispatch({
        kind: 'pointerDragged',
        ...at,
      });
    },
    timeCame(isPointerCaptured: boolean) {
      let hold = held;
      if (hold === null) return;
      let isStill = hold.atLastTime !== null && isWithinTapSlop(hold.at, hold.atLastTime);
      hold.atLastTime = hold.at;
      if (!(store.getView().grid.isFingerSelecting ? isPointerCaptured : isStill) || store.isEventUnfinished()) return;
      hold.times += 1;
      if ((hold.way.x !== 0 || hold.way.y !== 0) && !hold.isByFinger && !isHeldStillTickToScroll(hold.times)) return;
      let scrollBefore = scrollNow();
      store.dispatch({
        kind: 'pointerDragged',
        ...hold.at,
        isHeldStill: true,
      });
      let scrollAfter = scrollNow();
      let way = {
        x: Math.sign(scrollAfter.x - scrollBefore.x),
        y: Math.sign(scrollAfter.y - scrollBefore.y),
      };
      if ((way.x !== 0 && way.x !== hold.way.x) || (way.y !== 0 && way.y !== hold.way.y)) hold.times = 0;
      hold.way = way;
    },
  };
}
/** The tool parts that may hold a menu, and the bar a reader sees in place of the format tools. */
export interface ToolPartsOfPage extends Record<ToolPartWithMenu['part'], HTMLElement | null> {
  barOfReader: HTMLElement | null;
}
export function toolPartWithMenuHolding(target: Node, { barOfReader, ...parts }: ToolPartsOfPage) {
  return TOOL_PARTS_WITH_MENUS.find(
    ({ part }) => (part === 'formatTools' ? (parts.formatTools ?? barOfReader) : parts[part])?.contains(target) === true,
  );
}
export function focusFirstMatching(holder: HTMLElement | null, selector: string) {
  let candidates: Iterable<HTMLElement | null> = selector === ':scope' ? [holder] : (holder?.querySelectorAll<HTMLElement>(selector) ?? []);
  for (let candidate of candidates)
    if (
      (candidate?.focus({
        preventScroll: true,
      }),
      candidate !== null && candidate === candidate.ownerDocument.activeElement)
    )
      return true;
  return false;
}
export function scrollIntoSheetScroller(element: Element) {
  let scroller = element.closest('.sheet-scroller');
  if (scroller === null) return;
  let [{ left: elementLeft, right: elementRight }, scrollerBox] = [element.getBoundingClientRect(), scroller.getBoundingClientRect()];
  scroller.scrollLeft +=
    Math.min(0, elementLeft - SHEET_SCROLLER_MARGIN - scrollerBox.left) + Math.max(0, elementRight + SHEET_SCROLLER_MARGIN - scrollerBox.right);
}
export function focusFirstControl(holder: HTMLElement | null) {
  let isFocused = focusFirstMatching(holder, TOOLBAR_TAB_STOP_SELECTOR) || focusFirstMatching(holder, 'button:not(:disabled)');
  let activeElement = holder?.ownerDocument.activeElement ?? null;
  if (isFocused && activeElement !== null) scrollIntoSheetScroller(activeElement);
  return isFocused;
}
export function moveCaretToEndOfField(field: HTMLInputElement | HTMLTextAreaElement) {
  let text = field.value;
  field.value = '';
  field.value = text;
}
export function objectKey(object: object) {
  let knownKey = objectKeys.get(object);
  if (knownKey !== undefined) return knownKey;
  lastObjectKey += 1;
  objectKeys.set(object, lastObjectKey);
  return lastObjectKey;
}
export function keepCaretAtEndOnTyping({
  currentTarget,
  key,
  ctrlKey,
  metaKey,
  keyCode,
  nativeEvent,
}: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
  let isComposing = nativeEvent.isComposing || keyCode === 229;
  if ((key.length === 1 || key === 'Dead') && !ctrlKey && !metaKey && !isComposing)
    currentTarget.setSelectionRange(currentTarget.value.length, currentTarget.value.length);
}
export function guardFieldHistoryUndo(field: HTMLElement & Pick<HTMLInputElement, 'value'>) {
  let undoneToEmpty = false;
  let onBeforeInput = (event: InputEvent) => {
    if (!event.inputType.startsWith('history')) return void (undoneToEmpty = false);
    let isUndo = event.inputType === 'historyUndo';
    let isBlocked = isUndo ? field.value === '' : undoneToEmpty;
    if (!field.hasAttribute('data-is-waiting') && !isBlocked) return;
    undoneToEmpty ||= isUndo;
    event.preventDefault();
  };
  field.addEventListener('beforeinput', onBeforeInput);
  return () => field.removeEventListener('beforeinput', onBeforeInput);
}
export function redispatchKeyToFocused(event: KeyboardEvent) {
  let isComposing = event.isComposing || event.keyCode === 229 || event.key === 'Dead';
  if (event.key === 'Tab' || isComposing) return;
  ReactDOM.flushSync(() => {
    return;
  });
  if ((event.view?.document.activeElement ?? null)?.dispatchEvent(redispatchedKeydown(event)) === false) event.preventDefault();
}
export function cellTextUnderPointer(
  textElement: Element,
  grid: Element,
  zoom: number,
  { rows, columns }: GridOfPage['scroll'],
  { clientX, clientY }: Pick<MouseEvent, 'clientX' | 'clientY'>,
): NonNullable<LinkCardAsked['link']> | null {
  let address = textElement.hasAttribute(LINK_AMONG_TEXT_ATTR) ? textElement.getAttribute(LINK_IN_WORDS_ATTR) : null;
  let inCell = cellPositionOfElement(textElement);
  if (address === null || inCell === null) return null;
  let lineRect =
    [...textElement.getClientRects()].find(({ top: lineTop, bottom: lineBottom }) => clientY >= lineTop && clientY <= lineBottom) ??
    textElement.getBoundingClientRect();
  let gridBox = grid.getBoundingClientRect();
  let left = Math.max(lineRect.left, gridBox.left, clientX - POINTER_TEXT_REACH_PX);
  let right = Math.min(lineRect.right, gridBox.right);
  return {
    address,
    inCell,
    box: {
      ...pointInZoomedElement(grid, zoom, {
        clientX: left,
        clientY: lineRect.top,
      }),
      width: unzoomLength(Math.max(0, right - left), zoom),
      height: unzoomLength(lineRect.height, zoom),
    },
    scroll: {
      scrollLeft: columns.by,
      scrollTop: rows.by,
    },
  };
}
export function scheduleWorkShownLongEnough(wait: Wait | null, store: SheetController) {
  if (wait === null) return;
  let timer = setTimeout(
    () =>
      store.dispatch({
        kind: 'workShownLongEnough',
        wait,
      }),
    wait.ms,
  );
  return () => clearTimeout(timer);
}
export function useZoomedVirtualAnchor(anchorRef: React.RefObject<Element | null>, zoom: number, fallbackRect: PointBox | null): AnchorOnPage {
  let lastRectRef = React.useRef<PointBox | null>(fallbackRect);
  React.useLayoutEffect(() => {
    if (fallbackRect !== null) lastRectRef.current = fallbackRect;
  }, [fallbackRect]);
  return React.useMemo(
    () => ({
      getBoundingClientRect() {
        let element = anchorRef.current;
        if (element === null) return new DOMRect();
        let box = boxOnScreen(element, zoom, fallbackRect ?? lastRectRef.current ?? new DOMRect());
        return new DOMRect(box.x, box.y, box.width, box.height);
      },
    }),
    [anchorRef, zoom, fallbackRect],
  );
}
export interface ReloadPageButtonProps {
  reload: () => void;
}
export function ReloadPageButton({ reload }: ReloadPageButtonProps) {
  let [isReloading, setIsReloading] = React.useState(false);
  React.useEffect(() => {
    if (!isReloading) return;
    let timer = setTimeout(() => setIsReloading(false), RELOAD_BUTTON_BUSY_MS);
    return () => clearTimeout(timer);
  }, [isReloading]);
  return <Button variant="secondary" size="sm" busy={isReloading} onClick={() => {
      setIsReloading(true);
      reload();
    }}>{sheetMessages.reload()}</Button>;
}
export interface SheetGridDrawingProps extends Omit<GridDrawingProps, 'cellsAsBefore' | 'rows' | 'keysOfColumns' | 'areRowsNamed'> {}
export function SheetGridDrawing(props: SheetGridDrawingProps) {
  let { rowsDrawn, columnHeaders, pagesTurnedForReader } = props.grid;
  return <BlankCellWordsContext value={BLANK_CELL_WORDS_BY_PLATFORM}><GridDrawing {...props} cellsAsBefore={useCellsAsBefore(props.grid)} rows={useLingeringRows(rowsDrawn, pagesTurnedForReader, IS_IOS_BROWSER)} keysOfColumns={useLineKeys(keysOfLines(columnHeaders), pagesTurnedForReader, IS_IOS_BROWSER)} areRowsNamed={ARE_ROWS_NAMED_HERE} /></BlankCellWordsContext>;
}
/** Where typing goes: into an entry box, or onto the grid. */
export type TypingTarget = EditingMode['typingIn'] | 'grid';
/** The caret of an entry box, kept while the caret is with the cells before the entry ends. */
interface CaretKept {
  box: EntryBox;
  text: string;
  selected: [number, number, 'forward' | 'backward' | 'none'];
}
/** Text typed into the waiting box ahead of the cell it goes onto. */
interface TypingHeldAhead {
  text: string;
  typeOntoCell: () => void;
}
/** Which field of the page an entry box is. */
type PlaceOfField = 'chart' | 'cell' | 'formulaBar' | 'sheetName' | 'sidePane';
/** A text field the caret left for a menu or another window, to come back to as it was. */
interface FieldLeft {
  place: PlaceOfField | 'grid' | null;
  text: string;
  indexInPane: number;
  picked: [number | null, number | null, ('forward' | 'backward' | 'none')?];
  pressesBefore: number;
}
/** Whether the person was on the page when something was asked, to tell later whether they have left since. */
interface FocusPresence {
  wasHere: boolean;
  timesFocusHadLeft: number;
}
/** What the page asks of the frame around it. */
export interface SheetsPageShell extends Pick<FrameChrome, 'drawsHistory' | 'offerFind' | 'offerImport' | 'offerHistory'> {
  /** The cells have been measured, so they can be shown. */
  cellsAreMeasured(): void;
}
/** Where the caret goes as the page opens, from what was kept of the last visit. */
export interface CaretAtFirst {
  mayCellsTake(): boolean;
  mustCellsWait(): boolean;
  /** Whether the keyboard came over from the page before, with nothing pressed since the page started. */
  isKeyboardHandedOver(pressesHeard: PressesHeardAtStart): boolean;
  doCellsTakeOncePainted(): boolean;
  wasPointerPressedLast: boolean;
  mayKeyEndWait(key: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): boolean;
  actsHeard: PersonInputWatch;
}
/** What the page has heard of the person since it started, as the keyboard comes to it. */
export interface PressesHeardAtStart {
  pressesBegun: number;
  timesFocusLeft: number;
}
/** The walkthrough the agent hands this page, and whether the person is at work in it. */
export interface GuideOfPage {
  from: GuideFromStream;
  isPersonAtWorkInPage: () => boolean;
}
export interface SheetsPageProps {
  store: SheetController;
  clipboard: SheetClipboard;
  reloadPage: (() => void) | null;
  shell: SheetsPageShell;
  atEndOfSheetBar?: React.ReactNode;
  isInStaffTrials?: () => boolean;
  isAgentForToolsExpected?: boolean;
  connectionNews: ConnectionNews;
  wordsOfLoad?: Pick<WordsOfLoad, 'areWordsToCome' | 'onChanged'>;
  caretAtFirst?: CaretAtFirst;
  isEarlierVersionLeft?: boolean;
  oncePlaceholderIsOff?: (run: () => void) => () => void;
  chatWithAgent?: ChatWithAgent;
  guide?: GuideOfPage;
  chartsMadeByPage?: StockChartMaker;
  chartCardCounted?: (card: ChartCardCount) => void;
  ownToolOfFormatCounted?: (format: 'currency' | 'percent') => void;
  commentsOfHost?: HostComments;
  commentsLayer?: React.ReactNode;
  mouseAroundComments?: MouseAroundComments;
  chartsRunOn?: ChartsRunOn;
  interactivesRunOn?: InteractivesRunOn | null;
  changesOfCharts?: ChartEditsByAgent | null;
  chartsWrittenByAgent?: ChartWriterByAgent | null;
  filesForAgent?: FilesForAgent;
  gridZoom: ZoomStore;
  isAgentWorkingNow?: () => boolean;
}
export function SheetsPage({
  store,
  clipboard,
  reloadPage,
  shell,
  atEndOfSheetBar,
  isInStaffTrials = isNeverInStaffTrials,
  isAgentForToolsExpected = false,
  connectionNews,
  wordsOfLoad = NO_WORDS_OF_LOAD,
  caretAtFirst,
  isEarlierVersionLeft = false,
  oncePlaceholderIsOff = runAtOnce,
  chatWithAgent = NO_CHAT_WITH_AGENT,
  guide,
  chartsMadeByPage = NO_CHART_MAKER,
  chartCardCounted = countsNothing,
  ownToolOfFormatCounted = countsNothing,
  commentsOfHost = NO_AGENT_AI_COMMENTS,
  commentsLayer = null,
  mouseAroundComments = noMouseAroundComments,
  chartsRunOn = CHARTS_RUN_ON_NOTHING,
  interactivesRunOn = null,
  changesOfCharts = null,
  chartsWrittenByAgent = null,
  filesForAgent = NO_FILES_FOR_AGENT,
  gridZoom,
  isAgentWorkingNow = isAgentNeverWorking,
}: SheetsPageProps) {
  const view = useStore(store.viewStore, store.getView);
  let zoom = useZoom(gridZoom);
  let [isColumnCountCardOpen, setIsColumnCountCardOpen] = React.useState(false);
  let wasColumnCountCardOpenRef = React.useRef(false);
  if (isColumnCountCardOpen && view.grid.headerThatAddsColumns === null) setIsColumnCountCardOpen(false);
  let pointInGrid = (event: React.MouseEvent<Element>) => pointInZoomedElement(event.currentTarget, zoom, event);
  let cellPointOf = (cell: Element, event: React.MouseEvent<Element>) => {
    let at = pointInGrid(event);
    let link = cellTextUnderPointer(cell, event.currentTarget, zoom, view.grid.scroll, event);
    return link === null
      ? {
          cell,
          at,
        }
      : {
          cell,
          at,
          link,
        };
  };
  let dragStartDistance = unzoomLength(DRAG_START_DISTANCE, zoom);
  let connection = useConnectionProblem(connectionNews);
  let isRetryingLong = useIsTrueForVisibleMs(view.saving === 'retrying', LONG_RETRY_WARNING_MS);
  let isEditingPaused = view.viewOnlyBecause === 'editingPaused';
  let saveCard = saveStatusCard(view.saving, view.hasUnsavedEdits, connection, isRetryingLong, isEditingPaused);
  let [wasEditingPaused, setWasEditingPaused] = React.useState(isEditingPaused);
  let [isEditingBackNoticeShown, setIsEditingBackNoticeShown] = React.useState(false);
  if (isEditingPaused !== wasEditingPaused) {
    setWasEditingPaused(isEditingPaused);
    setIsEditingBackNoticeShown(!isEditingPaused && view.viewOnlyBecause === null);
  }
  let [announcedConnectionWords, setAnnouncedConnectionWords] = React.useState<string | null>(null);
  let connectionWords = saveCard?.isAboutConnection === true && connection?.mayPass === true ? saveCard.words : null;
  if (announcedConnectionWords !== null && announcedConnectionWords !== connectionWords) setAnnouncedConnectionWords(null);
  let isSavingLong = useIsTrueForVisibleMs(view.saving === 'saving' && view.calculating !== 'underWay', LONG_SAVE_NOTICE_DELAY_MS);
  let [isLongSaveTold, setIsLongSaveTold] = React.useState(false);
  let isLongSaveToldNow = nextIsLongSaveTold(isLongSaveTold, isSavingLong, view.saving);
  if (isLongSaveToldNow !== isLongSaveTold) setIsLongSaveTold(isLongSaveToldNow);
  let [allSavedSay, setAllSavedSay] = React.useState<AllSavedSay>('none');
  let [lossNews, setLossNews] = React.useState<PageView['newsOfLoss']>(null);
  let nextLossNews = lossNewsAtAllSaved(lossNews, allSavedSay, view);
  if (nextLossNews !== lossNews) setLossNews(nextLossNews);
  let allSavedSayNext = nextAllSavedSay(allSavedSay, {
    saving: view.saving,
    isCardDue: saveCard !== null,
    wereEditsDropped: areEditsNewlyDropped(view, nextLossNews),
  });
  if (allSavedSayNext !== allSavedSay) setAllSavedSay(allSavedSayNext);
  let isAllSavedSaid = allSavedSay === 'said' || allSavedSay === 'saidInLine';
  if (useIsTrueForVisibleMs(isAllSavedSaid, SAID_NOTICE_SHOWN_MS) && isAllSavedSaid) setAllSavedSay('none');
  let [longCalculationSay, setLongCalculationSay] = React.useState<LongCalculationSay>('none');
  let isWorkPending = () => store.isWorkYetToReachWorkbook() || store.areFormulasLeft();
  let longCalculationSayNext = nextLongCalculationSay(
    longCalculationSay,
    view,
    useStore(store.viewStore, isWorkPending),
  );
  if (longCalculationSayNext !== longCalculationSay) setLongCalculationSay(longCalculationSayNext);
  if (useIsTrueForVisibleMs(longCalculationSay === 'endSaid', SAID_NOTICE_SHOWN_MS) && longCalculationSay === 'endSaid')
    setLongCalculationSay('none');
  let isViewOnly = view.viewOnlyBecause !== null;
  let versionLook = view.versionHistory?.look ?? null;
  let [isRestoreInBar, setIsRestoreInBar] = React.useState(false);
  let { doCellsTakeNoText: doCellsTakeNoText, wasSomethingKeptOff } = useKeysOffCells();
  let canPersonEdit = view.viewOnlyBecause !== 'readOnly';
  let cellsRef = React.useRef<HTMLDivElement | null>(null);
  let filesOfferedToAgent = React.useSyncExternalStore<readonly AgentFileSource[]>(filesForAgent.onChanged, filesForAgent.offered, filesForAgent.offered);
  let toastsOfPage = useToasts();
  React.useEffect(
    () =>
      filesForAgent.onTold?.((words: string, isProblem: boolean) =>
        toastsOfPage.add({ title: words, variant: isProblem ? 'warning' : 'neutral' }),
      ),
    [filesForAgent, toastsOfPage],
  );
  let zoomedGridRef = React.useRef<HTMLDivElement | null>(null);
  let cellEditorRef = React.useRef<HTMLInputElement | null>(null);
  let pendingTypingRef = React.useRef<TypingHeldAhead | null>(null);
  let typingFieldRef = React.useRef<HTMLTextAreaElement | EntryEditorElement | null>(null);
  let activeEditorRef = React.useRef<EntryBox | null>(null);
  let cellEditorCleanupRef = React.useRef<(() => void) | null>(null);
  let setCellEditorElement = React.useCallback((element: HTMLInputElement | null) => {
    cellEditorCleanupRef.current?.();
    cellEditorCleanupRef.current = element === null ? null : guardFieldHistoryUndo(element);
    cellEditorRef.current = element;
    activeEditorRef.current = typingFieldRef.current ?? element;
  }, []);
  let typingFieldCleanupRef = React.useRef<(() => void) | null>(null);
  let setTypingFieldElement = React.useCallback((element: HTMLTextAreaElement | EntryEditorElement | null) => {
    typingFieldCleanupRef.current?.();
    typingFieldCleanupRef.current = element === null ? null : preventPageScrollOverField(element);
    typingFieldRef.current = element;
    activeEditorRef.current = element ?? cellEditorRef.current;
    if (element !== null && !isEntryEditor(element)) moveCaretToEndOfField(element);
  }, []);
  let gridFocusRef = React.useRef<HTMLDivElement | null>(null);
  let interactiveSectionRef = React.useRef<HTMLDivElement | null>(null);
  let getGridOrEditorElement = React.useCallback(() => {
    let currentView = store.getView();
    if (currentView.interactive !== null) return interactiveSectionRef.current;
    return (areCellsOffLimits(currentView) ? gridFocusRef : cellEditorRef).current;
  }, [store]);
  let getSelectedPlacementId = React.useCallback(
    () => store.getView().grid.placedViews.find(({ isSelected }) => isSelected)?.placementId ?? null,
    [store],
  );
  let getCaretElement = React.useCallback(
    (placementId: string | null = getSelectedPlacementId()) => {
      if (whereTypingGoes(store.getView()) !== 'grid') return activeEditorRef.current;
      let ownerDocument = cellsRef.current?.ownerDocument;
      return (
        (placementId === null || ownerDocument === undefined ? null : findPlacedViewCaret(ownerDocument, placementId)) ?? getGridOrEditorElement()
      );
    },
    [store, getSelectedPlacementId, getGridOrEditorElement],
  );
  let focusCaret = React.useCallback(
    () =>
      getCaretElement()?.focus({
        preventScroll: true,
      }),
    [getCaretElement],
  );
  let cellFieldKeyProps = useCellEntryFieldEvents(store);
  let functionsButtonRef = React.useRef<HTMLSpanElement | null>(null);
  let formulaBarRef = React.useRef<HTMLTextAreaElement | null>(null);
  let formulaBarCleanupRef = React.useRef<(() => void) | null>(null);
  let setFormulaBarElement = React.useCallback((element: HTMLTextAreaElement | null) => {
    formulaBarCleanupRef.current?.();
    formulaBarCleanupRef.current = element === null ? null : preventPageScrollOverField(element);
    formulaBarRef.current = element;
    if (element !== null) moveCaretToEndOfField(element);
  }, []);
  let entryFieldRefs = React.useMemo(
    () => ({
      cell: activeEditorRef,
      formulaBar: formulaBarRef,
    }),
    [],
  );
  let entryBoxes = useEntryBoxes(store, entryFieldRefs);
  let shownViewToolsRef = React.useRef<HTMLDivElement | null>(null);
  let viewToolsRef = React.useRef<HTMLDivElement | null>(null);
  let setViewToolsInRowElement = React.useCallback((element: HTMLDivElement | null) => {
    viewToolsRef.current = element;
    shownViewToolsRef.current = element;
  }, []);
  let getViewToolsButton = React.useCallback(() => shownViewToolsRef.current?.querySelector('button') ?? null, []);
  let formulaRowRef = React.useRef<HTMLDivElement | null>(null);
  let formatToolsRef = React.useRef<HTMLDivElement | null>(null);
  let readerBarRef = React.useRef<HTMLDivElement | null>(null);
  let versionBarRef = React.useRef<HTMLDivElement | null>(null);
  let sidePaneRef = React.useRef<HTMLElement | null>(null);
  let isFindFieldToCome = React.useCallback(() => store.getView().find?.isReplaceShown !== true, [store]);
  let sidePaneTakesNoTyping = useTypingHoldForPanes({
    store,
    paneRef: sidePaneRef,
    always: cellsRef,
    isFieldToCome: isFindFieldToCome,
  });
  let [sidePaneWidth, setSidePaneWidth] = React.useState(initialSidePaneWidth);
  let sheetTabsRef = React.useRef<HTMLDivElement | null>(null);
  let addSheetButtonRef = React.useRef<HTMLElement | null>(null);
  let calendarPopupRef = React.useRef<HTMLDivElement | null>(null);
  let [footBar, setFootBar] = React.useState<HTMLDivElement | null>(null);
  let overGridRef = React.useRef<HTMLDivElement | null>(null);
  let [footNotice, setFootNotice] = React.useState<HTMLDivElement | null>(null);
  let [undoOfTurnCard, setUndoOfTurnCard] = React.useState<HTMLDivElement | null>(null);
  let footNoticeRef = React.useRef<HTMLDivElement | null>(null);
  let setFootNoticeElement = React.useCallback((element: HTMLDivElement | null) => {
    footNoticeRef.current = element;
    setFootNotice(element);
  }, []);
  useWaysInWaitedFor(store, view.waysIn, view.isWaitForWaysInPutOff);
  let areWaysInUp = view.waysIn === 'areUp';
  React.useEffect(() => (setWaysInShown(areWaysInUp), () => setWaysInShown(false)), [areWaysInUp]);
  let isWaysInMenuOpen = useAnnouncementsUnderWay();
  let { isAgentAsked, noteAgentAsked } = useAgentAskedFromWaysIn({
    areWaysInDue: areWaysInUp,
    isDraftWaiting: false,
    doCellsTakeNoText: doCellsTakeNoText,
  });
  let isSidePaneDrawn = view.isSidePaneOpen || view.find?.isReplaceShown === true;
  let heldBackLayersRef = React.useRef(new Set<HeldBackLayer>());
  let [isAnyLayerHeldBack, setIsAnyLayerHeldBack] = React.useState(false);
  let [isNonWaysInLayerHeldBack, setIsNonWaysInLayerHeldBack] = React.useState(false);
  let isRoomKeptForGonePane = useRoomKeptForGonePane({
    isPaneDrawn: isSidePaneDrawn,
    isChatOverBar: false,
    isMenuOpen: isAnyLayerHeldBack || view.menu?.isOfContextBar === true,
    bar: footBar,
  });
  let [headerExtra, setHeaderExtra] = React.useState<HTMLFieldSetElement | null>(null);
  let [footerExtra, setFooterExtra] = React.useState<HTMLFieldSetElement | null>(null);
  let toastResizeObserverRef = React.useRef<ResizeObserver | null>(null);
  let toastMutationObserverRef = React.useRef<MutationObserver | null>(null);
  let toastRoomRef = React.useRef({
    top: 0,
    right: 0,
  });
  let isFindBarShown = view.find !== null && !view.find.isReplaceShown;
  let placeToastRoom = React.useEffectEvent((isFindShown: boolean = isFindBarShown) => {
    let cells = cellsRef.current;
    let root = cells?.ownerDocument.documentElement;
    let toasts = root?.querySelector<HTMLElement>(TOAST_SELECTOR) ?? null;
    if (cells === null || root === undefined || toasts === null) return;
    let cellsBox = cells.getBoundingClientRect();
    let topBelowHeaders = cellsBox.top + cells.clientTop + COLUMN_HEADER_HEIGHT * gridZoom.now();
    let findBox = isFindShown ? root.querySelector('.sheet-find-parts')?.getBoundingClientRect() : undefined;
    let roomOverToasts = Math.max(topBelowHeaders, findBox?.bottom ?? 0);
    let rem = Number.parseFloat(getComputedStyle(root).fontSize);
    let rightOfToasts = findBox === undefined ? cellsBox.right : findBox.right + rem;
    toasts.style.setProperty('--sheet-room-over-toasts', `${roomOverToasts}px`);
    toasts.style.setProperty('--sheet-room-right-of-toasts', `${root.clientWidth - rightOfToasts}px`);
    toasts.style.setProperty('--sheet-room-kept-at-right', `${root.clientWidth - cellsBox.right}px`);
    toastRoomRef.current = {
      top: roomOverToasts + rem,
      right: rightOfToasts - rem,
    };
  });
  React.useLayoutEffect(() => placeToastRoom(isFindBarShown), [isFindBarShown]);
  let [seenDialogs] = React.useState(() => new WeakSet<Element>());
  let placeNotices = React.useEffectEvent((gridPlaced: GridOfPage, placedZoom: number, reason?: 'measure' | 'toasts') => {
    let cells = cellsRef.current;
    let toasts = cells?.ownerDocument.querySelector<HTMLElement>(TOAST_SELECTOR) ?? null;
    if (cells === null || toasts === null) return;
    if (placedZoom !== zoom) return;
    if (gridPlaced.yetToGlide !== null) return reason === 'toasts' ? placeToastRoom() : undefined;
    let [frontDialog, ...otherDialogs] = toasts.querySelectorAll<HTMLElement>(OPEN_DIALOG_SELECTOR);
    let isAtFoot = toasts.hasAttribute(AT_FOOT_ATTRIBUTE);
    let isToastsInUse = toasts.matches(':hover') || toasts.contains(cells.ownerDocument.activeElement);
    let isFrontNew = frontDialog !== undefined && !seenDialogs.has(frontDialog) && !isToastsInUse;
    for (let dialog of toasts.querySelectorAll(DIALOG_ROLE_SELECTOR)) seenDialogs.add(dialog);
    if (frontDialog === undefined && !isAtFoot) return;
    if (reason === 'toasts') placeToastRoom();
    let boxesOnScreen = (cellRanges: readonly DrawnBox[]) =>
      cellRanges.flatMap((range) => {
        let { left, top, width, height } = boxInBody(clipBoxToShown(range), gridPlaced.body);
        if (width <= 0 || height <= 0) return [];
        let {
          x,
          y,
          ...size
        } = boxOnScreen(cells, placedZoom, {
          x: left,
          y: top,
          width,
          height,
        });
        return [
          {
            left: x,
            top: y,
            right: x + size.width,
            bottom: y + size.height,
          },
        ];
      });
    let boxesNotToCover = boxesOnScreen(boxesNoticesMustNotCover(gridPlaced));
    let openEntry = cells.querySelector(OPEN_ENTRY_SELECTOR);
    let { top: roomTop, right: roomRight } = toastRoomRef.current;
    let [toastsWidth, frontDialogHeight] = [toasts.offsetWidth, frontDialog?.offsetHeight ?? 0];
    let root = cells.ownerDocument.documentElement;
    let pinnedCard = toasts.querySelector('[data-pinned]')?.parentElement ?? null;
    let shouldSitAtFoot = shouldNoticesSitAtFoot({
      isAtFoot,
      howManyUp: frontDialog === undefined ? 0 : 1 + otherDialogs.length,
      isAnyLeft: toasts.querySelector(DIALOG_ROLE_SELECTOR) !== null,
      isFrontNew,
      spot: {
        left: roomRight - toastsWidth,
        top: roomTop,
        right: roomRight,
        bottom: roomTop + frontDialogHeight,
      },
      spotAtFoot: noticeSpotAtFoot({
        heightOfWindow: root.clientHeight,
        roomUnder: Number.parseFloat(toasts.style.getPropertyValue('--sheet-room-under-notices')),
        rem: Number.parseFloat(getComputedStyle(root).fontSize),
        topOfPinnedCard: pinnedCard?.getBoundingClientRect().top ?? null,
        rightOfCells: cells.getBoundingClientRect().right,
        width: toastsWidth,
        height: frontDialogHeight,
      }),
      notToCover: openEntry === null ? boxesNotToCover : [...boxesNotToCover, openEntry.getBoundingClientRect()],
      betterNotCovered: isToastsInUse ? [] : boxesOnScreen(gridPlaced.changedInTurnOffered),
    });
    if (shouldSitAtFoot === isAtFoot) return;
    for (let dialog of toasts.querySelectorAll(DIALOG_ROLE_SELECTOR))
      dialog.toggleAttribute(MOVED_WHILE_FADING_ATTRIBUTE, dialog.hasAttribute('data-ending-style'));
    toasts.toggleAttribute(AT_FOOT_ATTRIBUTE, shouldSitAtFoot);
    if (reason === 'measure') return;
    toastResizeObserverRef.current?.unobserve(toasts);
    toastResizeObserverRef.current?.observe(toasts);
  });
  let grid = view.grid;
  React.useLayoutEffect(() => placeNotices(grid, zoom), [grid, zoom]);
  let barTopRef = React.useRef(0);
  let stopUndoCardJumpRef = React.useRef(() => {});
  let liftUndoCard = React.useEffectEvent((card: HTMLDivElement | null, { activeCellElementId }: Pick<GridOfPage, 'activeCellElementId'>) => {
    let cells = cellsRef.current;
    if (cells === null || card === null || !card.isConnected) return;
    let currentLift = Number.parseFloat(card.style.getPropertyValue(UNDO_OF_TURN_LIFT_PROPERTY));
    let lift = Number.isNaN(currentLift) ? 0 : currentLift;
    let { left, top, right, bottom } = card.getBoundingClientRect();
    let ownerDocument = cells.ownerDocument;
    let [, translateY = '0'] = (ownerDocument.defaultView?.getComputedStyle(card).translate ?? '').split(' ');
    let translatedLift = -Number.parseFloat(translateY);
    let shownLift = Number.isNaN(translatedLift) ? lift : translatedLift;
    let activeCellElement = activeCellElementId === null ? null : ownerDocument.getElementById(activeCellElementId);
    let openEntry = cells.querySelector(OPEN_ENTRY_SELECTOR);
    let isInUse = card.querySelector('button:hover') !== null || (ownerDocument.hasFocus() && card.contains(ownerDocument.activeElement));
    let nextLift = noticeLiftToClearCells({
      spot: {
        left,
        right,
        top: top + shownLift,
        bottom: bottom + shownLift,
      },
      aboveBar: barTopRef.current,
      keptClear: [activeCellElement, openEntry].flatMap((element) => element?.getBoundingClientRect() ?? []),
      topOfCells: toastRoomRef.current.top,
      gap: SHEET_FOOT_GAP,
      liftInUse: isInUse && !Number.isNaN(currentLift) ? lift : null,
    });
    if (nextLift === currentLift) return;
    let isRising = nextLift > barTopRef.current && nextLift > lift;
    let jumps = Number.isNaN(currentLift) || isRising;
    card.toggleAttribute('data-jumps', jumps);
    card.style.setProperty(UNDO_OF_TURN_LIFT_PROPERTY, `${nextLift}px`);
    if (!jumps || ownerDocument.defaultView === null) return;
    stopUndoCardJumpRef.current();
    stopUndoCardJumpRef.current = takePressesAfterDelay(card, ownerDocument.defaultView);
  });
  React.useLayoutEffect(() => liftUndoCard(undoOfTurnCard, grid), [undoOfTurnCard, grid]);
  let liftUndoCardNextFrame = () =>
    void cellsRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => liftUndoCard(undoOfTurnCard, store.getView().grid));
  let observeToasts = React.useEffectEvent(() => {
    let toasts = cellsRef.current?.ownerDocument.querySelector(TOAST_SELECTOR) ?? null;
    let observed = toasts === null ? [] : [toasts, toasts.querySelector(STATUS_ROLE_SELECTOR)];
    for (let element of observed) if (element !== null) toastResizeObserverRef.current?.observe(element);
    if (toasts !== null)
      toastMutationObserverRef.current?.observe(toasts, {
        childList: true,
        subtree: true,
      });
  });
  let canEndCommentMode = React.useCallback(() => commentsOfHost.canEndMode(), [commentsOfHost]);
  useCommentMode(store, cellsRef, canEndCommentMode);
  let commentCornerKeyAtTarget = ({ target }: Pick<Event, 'target'>) =>
    store.getView().mode.kind === 'navigating' ? commentCornerKeyOf(target) : null;
  let mousePointOverCellsRef = React.useRef<Pick<MouseEvent, 'clientX' | 'clientY'> | null>(null);
  let putAwayCommentsRef = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    let cells = cellsRef.current;
    if (cells === null) return;
    if (!view.grid.mayCommentBePreviewed || isAnyLayerHeldBack)
      mouseAroundComments.putAwayAtDraw(!view.grid.wouldCommentBeInTheWay && !isAnyLayerHeldBack);
    let placement = {
      grid: view.grid,
      gridElement: cells,
      zoom,
    };
    commentsOfHost.tellPlaces(
      commentCardPlaces(placement, {
        asked: commentsOfHost.cardAskedFor(),
        onItsPoint: commentsOfHost.cardOnItsPoint()?.handle ?? null,
        heightOfCard: (handle: string) => commentsOfHost.heightOfCard(handle),
        heightOfPreview: (handle: string) => commentsOfHost.heightOfPreview(handle),
      }),
    );
    markCommentLayersUnderMouse(placement, mousePointOverCellsRef.current);
  });
  let isKeyboardLikely = React.useSyncExternalStore(subscribeSheetMedia, likelyHasKeyboard, () => false);
  let isOfferKeyDrawn = isWordsOfferedKeyDrawn(view.wordsOffered, isKeyboardLikely);
  let lastPutHereHolds = React.useSyncExternalStore(clipboard.onLastPutHereChange, clipboard.whatLastPutHereHolds, () => null);
  let valuesOfLastPutHere = React.useSyncExternalStore(clipboard.onLastPutHereChange, clipboard.valuesOfLastPutHere, () => null);
  let doesCommentModePickCells = view.doesCommentModePickCells;
  let isAnyNoticeUp =
    view.notice !== null ||
    view.newsOfLoss !== null ||
    view.undoOffer !== null ||
    saveCard !== null ||
    view.fractionSavedToShow !== null ||
    isLongSaveToldNow ||
    view.isLongCalculationTold ||
    doesCommentModePickCells ||
    allSavedSay === 'said' ||
    isEditingBackNoticeShown;
  React.useEffect(() => {
    if (isAnyNoticeUp) observeToasts();
  }, [isAnyNoticeUp]);
  let findBarRef = React.useRef<HTMLInputElement | null>(null);
  let replaceFieldRef = React.useRef<HTMLInputElement | null>(null);
  let chooseFileButtonRef = React.useRef<HTMLElement | null>(null);
  let ownFilterBarRef = React.useRef<HTMLFieldSetElement | null>(null);
  let pivotTableBarRef = React.useRef<HTMLFieldSetElement | null>(null);
  let isNotComeToByTabRef = React.useRef(true);
  let [isComeToByTab, setIsComeToByTab] = React.useState(false);
  let forgetComeToByTab = () => {
    isNotComeToByTabRef.current = true;
    setIsComeToByTab(false);
  };
  let markComeToByTab = React.useCallback(() => {
    isNotComeToByTabRef.current = false;
    setIsComeToByTab(true);
  }, []);
  let wasTabKeyDownRef = React.useRef(false);
  let wasFormulaBarFocusedRef = React.useRef(false);
  let isFocusMoveExpectedRef = React.useRef(false);
  let isFocusMovingByCodeRef = React.useRef(false);
  let moveCaretTo = React.useCallback(
    (fromPart: PagePart, step: number, skipOffersAtSelection: boolean = false) => {
      ReactDOM.flushSync(() => {
        return;
      });
      let focusPart: Record<PagePart, () => boolean> = {
        functionsButton: () => focusFirstMatching(functionsButtonRef.current, 'button'),
        formulaBar: () => {
          let isFocused = focusFirstMatching(formulaBarRef.current, ':scope');
          if (isFocused) wasFormulaBarFocusedRef.current = true;
          return isFocused;
        },
        viewTools: () => focusFirstMatching(viewToolsRef.current, 'button'),
        findBar: () => store.getView().find?.isReplaceShown !== true && focusFirstMatching(findBarRef.current, ':scope'),
        cells: () => focusFirstMatching(getCaretElement(), ':scope'),
        guide: () =>
          focusFirstMatching(
            cellsRef.current?.ownerDocument.querySelector(`[${GUIDE_CARD_ATTRIBUTE}]:not([data-ending-style])`) ?? null,
            `[${GUIDE_STEP_ON_ATTRIBUTE}]`,
          ),
        offersAtSelection: () => focusFirstMatching(cellsRef.current, OFFERS_AT_SELECTION_BUTTONS_SELECTOR),
        charts: () => focusFirstMatching(cellsRef.current, PLACED_VIEW_CARET_SELECTOR),
        endOfSheet: () => focusFirstMatching(cellsRef.current, AT_END_OF_SHEET_FIELDS),
        errorsNotice: () =>
          focusFirstMatching(
            cellsRef.current?.ownerDocument.querySelector(`[${ERRORS_OFFERED_ATTRIBUTE}]:not([data-ending-style])`) ?? null,
            'button:not([role=option][aria-disabled])',
          ),
        undoOfTurn: () => focusFirstMatching(undoOfTurnCard, 'button'),
        waysIn: () => focusFirstControl(footNoticeRef.current),
        formatTools: () => focusFirstControl(formatToolsRef.current ?? readerBarRef.current ?? versionBarRef.current),
        toasts: () =>
          focusFirstMatching(
            cellsRef.current?.ownerDocument.querySelector(TOAST_SELECTOR) ?? null,
            ':is(a[href], button):not([data-ending-style] *)',
          ),
        ownFilterBar: () => focusFirstMatching(ownFilterBarRef.current, 'button'),
        pivotTableBar: () => focusFirstMatching(pivotTableBarRef.current, 'button'),
        sheets: () => focusFirstMatching(sheetTabsRef.current, '[role="tab"][aria-selected="true"]'),
        sidePane: () => focusPaneStart(sidePaneRef.current, 'lastUsed'),
      };
      let index = PAGE_PARTS_IN_F6_ORDER.indexOf(fromPart) + step;
      for (let part = PAGE_PARTS_IN_F6_ORDER[index]; part !== undefined; part = PAGE_PARTS_IN_F6_ORDER[index]) {
        if (!(skipOffersAtSelection && (part === 'offersAtSelection' || part === 'guide')) && focusPart[part]()) return true;
        index += step;
      }
      return false;
    },
    [store, getCaretElement, undoOfTurnCard],
  );
  let moveCaretFromCells = React.useCallback(
    (fromPart: PagePart, step: number) => {
      let hasMoved = moveCaretTo(fromPart, step, true);
      let cellsElement = getGridOrEditorElement();
      if (hasMoved && cellsElement !== null && cellsElement === cellsElement.ownerDocument.activeElement) markComeToByTab();
      return hasMoved;
    },
    [moveCaretTo, getGridOrEditorElement, markComeToByTab],
  );
  let tabIntoFormulaBar = React.useCallback((event: React.KeyboardEvent<Element>, part: 'functionsButton' | 'viewTools' | 'cells') => {
    let isTowardFormulaBar = event.shiftKey === (part !== 'functionsButton');
    if (event.defaultPrevented || event.key !== 'Tab' || !isTowardFormulaBar) return false;
    if (hasShortcutModifier(event)) return false;
    if (part === 'viewTools' && event.target !== viewToolsRef.current?.querySelector('button')) return false;
    let formulaBar = formulaBarRef.current;
    if (formulaBar === null) return false;
    if (part === 'cells' && tabStopBefore(formulaBar.ownerDocument.body, gridFocusRef.current) !== formulaBar) return false;
    isFocusMovingByCodeRef.current = true;
    formulaBar.setSelectionRange(0, formulaBar.value.length);
    formulaBar.focus({
      preventScroll: true,
    });
    isFocusMovingByCodeRef.current = false;
    if (formulaBar !== formulaBar.ownerDocument.activeElement) return false;
    event.preventDefault();
    formulaRowRef.current?.querySelector('.sheet-formula-sign')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
    return true;
  }, []);
  let typingTarget = whereTypingGoes(view);
  let isComposing = useIsComposing(entryFieldRefs);
  let formulaFromWords = React.useMemo(
    () => withoutOfferWhenComposing(view.formulaFromWords, isComposing),
    [view.formulaFromWords, isComposing],
  );
  let isFormulaOfferDrawn = view.formulaFromWords.stage?.kind === 'offered' && view.formulaFromWords.stage.isDrawn;
  React.useEffect(() => {
    if (isComposing && isFormulaOfferDrawn)
      store.dispatch({
        kind: 'formulaOfferDrawn',
        isDrawn: false,
      });
  }, [isComposing, isFormulaOfferDrawn, store]);
  let noteInputMethodIfKeyboard = React.useCallback(() => {
    if (likelyHasKeyboard()) store.noteInputMethodInUse();
  }, [store]);
  React.useEffect(() => {
    if (isComposing) noteInputMethodIfKeyboard();
  }, [isComposing, noteInputMethodIfKeyboard]);
  let lastTypingTargetRef = React.useRef(typingTarget);
  let isFocusingFieldRef = React.useRef(false);
  let focusTypingTarget = (target: TypingTarget, caretKept: CaretKept | null = null) => {
    if (target === 'grid') return focusCaret();
    let field = (target === 'cell' ? activeEditorRef : formulaBarRef).current;
    if (field === null || field === field.ownerDocument.activeElement) return;
    isFocusingFieldRef.current = true;
    try {
      field.focus({
        preventScroll: true,
      });
    } finally {
      isFocusingFieldRef.current = false;
    }
    if (field !== field.ownerDocument.activeElement) return;
    if (field === caretKept?.box && field.value === caretKept.text && caretKept.selected[0] !== field.value.length)
      return field.setSelectionRange(...caretKept.selected);
    field.setSelectionRange(field.value.length, field.value.length);
    field.scrollTo({
      top: field.scrollHeight,
      ...(field.value.includes(`
`)
        ? {}
        : {
            left: field.scrollWidth,
          }),
    });
    if (isEntryEditor(field)) field.bringCaretIntoSight();
    return;
  };
  let dispatchEditText = (typingIn: EditingMode['typingIn'], text: string, more: Omit<EditTextChanged, 'kind' | 'text' | 'typingIn'> = {}) =>
    store.dispatch({
      kind: 'editTextChanged',
      text,
      typingIn,
      ...more,
    });
  let completeEditText = (
    { text, typingIn }: Pick<EditingMode, 'text' | 'typingIn'>,
    complete: (text: string) => string | null,
    isNotTyped: boolean = false,
  ) => {
    let field = (typingIn === 'cell' ? activeEditorRef : formulaBarRef).current;
    let completed =
      field?.value === text && field.selectionStart === text.length && field.selectionEnd === text.length ? complete(text) : null;
    if (completed === null) store.dropWhatIsHeld();
    else if (completed !== text)
      dispatchEditText(typingIn, completed, {
        caretAt: completed.length,
        ...(isNotTyped && {
          isNotTyped: true,
        }),
      });
  };
  let getActiveElement = () => cellsRef.current?.ownerDocument.activeElement ?? null;
  let isFocusInCells = () =>
    (cellsRef.current?.contains(getActiveElement()) === true &&
      !isInAtEndOfSheet(getActiveElement()) &&
      !isPlacedViewAskInput(getActiveElement()) &&
      !isInOffersAtSelection(getActiveElement())) ||
    getActiveElement() === formulaBarRef.current;
  let whereIsFocus = (): PlaceOfKeyboard => {
    if (getKeysOffCellsState().isNoticeOwed) return 'beforeNotice';
    if (cellsRef.current?.ownerDocument.hasFocus() !== true) return 'elsewhere';
    if (isFocusInCells()) return doCellsTakeNoText && !wasSomethingKeptOff ? 'pausedAtCells' : 'inCells';
    return (getActiveElement()?.closest('[role="menu"]') ?? null) === null ? 'elsewhere' : 'inMenu';
  };
  let hasPageFocus = React.useCallback(() => cellsRef.current?.ownerDocument.hasFocus() === true, []);
  let isFocusNowhere = () => {
    let active = getActiveElement();
    let isInCalendarPopup = store.getView().calendar === null && calendarPopupRef.current?.contains(active) === true;
    return active === active?.ownerDocument.body || active?.matches(':disabled') === true || isInCalendarPopup;
  };
  let focusTrackerRef = React.useRef<PressTracker | null>(null);
  let timesFocusBegun = React.useCallback(() => focusTrackerRef.current?.timesBegun() ?? 0, []);
  let isPageLeftUntouched = React.useCallback(
    () => cellsRef.current?.ownerDocument.hasFocus() !== true && focusTrackerRef.current?.hasPersonActedSinceFocusLeft() !== true,
    [],
  );
  let isPageLeftUnpressed = React.useCallback(
    () =>
      cellsRef.current?.ownerDocument.hasFocus() !== true && focusTrackerRef.current?.hasPersonActedSinceFocusLeft('pressesOnly') !== true,
    [],
  );
  let windowFocusWatchRef = React.useRef<WindowFocusWatch | null>(null);
  React.useEffect(() => {
    let win = cellsRef.current?.ownerDocument.defaultView ?? null;
    if (win === null) return;
    let watch = watchWindowFocusLeft(win);
    windowFocusWatchRef.current = watch;
    return () => watch.stop();
  }, []);
  let isPageReallyLeft = React.useCallback(
    () =>
      isPageLeftUnpressed() &&
      (cellsRef.current?.ownerDocument.visibilityState !== 'hidden' || windowFocusWatchRef.current?.hadFocusLeftBefore() === true),
    [isPageLeftUnpressed],
  );
  let isBlurringByCodeRef = React.useRef(false);
  let blurQuietly = React.useCallback((element: Element | null) => {
    isBlurringByCodeRef.current = true;
    try {
      if (element instanceof HTMLElement) element.blur();
    } finally {
      isBlurringByCodeRef.current = false;
    }
  }, []);
  let isEditKeptOnBlurRef = React.useRef(false);
  let isPointerHeldOutsideRef = React.useRef(false);
  let isPageLeftWithoutPointer = React.useCallback(
    () => isPageLeftUnpressed() && !isPointerHeldOutsideRef.current,
    [isPageLeftUnpressed],
  );
  let [scrollGesture] = React.useState(createScrollGestureTimer);
  let mayFocusReturnToCells = () =>
    isPageReallyLeft() &&
    focusTrackerRef.current?.hasPressJustEnded() !== true &&
    !isPointerHeldOutsideRef.current &&
    !scrollGesture.isUnderWay() &&
    !areFocusLeftChecksHeld();
  let mayFocusReturnToCellsEvent = React.useEffectEvent(mayFocusReturnToCells);
  let whenFocusStays = (action: () => void, dispatchMode: 'mayDispatch' | 'dispatchesNothing' = 'mayDispatch') => {
    let active = getActiveElement();
    let timesLeft = focusTrackerRef.current?.timesFocusLeft();
    let check = () => {
      if (focusTrackerRef.current?.timesFocusLeft() !== timesLeft && cellsRef.current?.ownerDocument.hasFocus() !== true) return;
      if (getActiveElement() === active || isFocusNowhere() || isFocusInCells()) action();
    };
    if (dispatchMode === 'mayDispatch') store.onceEventsAreFinished(check);
    else store.lookOnceEventsAreFinished(check);
  };
  let focusChangesRef = React.useRef(0);
  let pointerPressesRef = React.useRef(0);
  let pendingBlurRef = React.useRef<ReturnType<SheetController['askForCommands']> | null>(null);
  let isBlurPending = React.useCallback(() => pendingBlurRef.current !== null, []);
  let afterFocusLeaves = (
    keepCells: () => void,
    leave: () => void = () => {},
    shouldKeepEdit: (mode: EditingMode) => boolean = () => false,
    keepInCalendar?: () => void,
  ) => {
    let focusChangesBefore = focusChangesRef.current;
    let pointerPressesBefore = pointerPressesRef.current;
    return () => {
      let isMenuToClose = store.getView().menu !== null && isPageLeftUnpressed() && pendingBlurRef.current === null;
      if (!isMenuToClose)
        ReactDOM.flushSync(() => {
          return;
        });
      let { mode: latestMode, menu: latestMenu, calendar } = store.getView();
      let keepsEdit = isEditKeptOnBlurRef.current && latestMode.kind === 'editing' && shouldKeepEdit(latestMode);
      let isSameFocus = focusChangesRef.current === focusChangesBefore;
      let wasPressed = pointerPressesRef.current !== pointerPressesBefore;
      let isFocusStill = isSameFocus && !wasPressed;
      let ownerDocument = cellsRef.current?.ownerDocument;
      let isInCells = isFocusInCells() && ownerDocument !== undefined && !hasElementAwaitingKeyboard(ownerDocument);
      if (isFocusStill && (isInCells || keepsEdit) && latestMenu === null) return keepCells();
      const calendarPopup = calendar !== null && latestMenu === null && latestMode.kind !== 'editing' ? calendarPopupRef.current : null;
      const isInCalendar = calendarPopup !== null && (calendarPopup.contains(getActiveElement()) || hasElementAwaitingKeyboard(calendarPopup));
      if (isFocusStill && isInCalendar && keepInCalendar !== undefined) {
        keepInCalendar();
        let { mode: modeAfter, calendar: calendarAfter } = store.getView();
        let isCalendarLeft = calendarAfter !== null && !calendarPopup.contains(getActiveElement());
        if (modeAfter.kind === 'editing' || !isCalendarLeft) return;
      }
      leave();
      store.dropWhatIsHeld();
      if (isMenuToClose)
        store.dispatch({
          kind: 'menuClosed',
        });
    };
  };
  let afterFocusLeavesTypedAhead = (
    keepCells: () => void,
    shouldKeepEdit: (mode: EditingMode) => boolean = () => false,
    keepInCalendar?: () => void,
  ) => {
    let timesLeft = focusTrackerRef.current?.timesFocusLeft();
    let hasFocusLeftSince = (mode: EditingMode) => focusTrackerRef.current?.timesFocusLeft() !== timesLeft && shouldKeepEdit(mode);
    store.onceEventsAreFinished(afterFocusLeaves(keepCells, undefined, hasFocusLeftSince, keepInCalendar), undefined, 'asTypedAhead');
  };
  let refocusTypingTarget = () => {
    let target = whereTypingGoes(store.getView());
    focusTypingTarget(target);
    if (target === 'grid') lastTypingTargetRef.current = target;
  };
  let refocusTypingTargetEvent = React.useEffectEvent(refocusTypingTarget);
  let refocusFromBehindToast = React.useEffectEvent(() => {
    let ownerDocument = cellsRef.current?.ownerDocument;
    let active = ownerDocument?.activeElement;
    let isBehind =
      ((isInsideUnpinnedToast(active) ? active?.closest(DIALOG_ROLE_SELECTOR) : null)?.querySelector('[data-behind]') ?? null) !== null;
    if (ownerDocument?.hasFocus() === true && isBehind && !hasElementAwaitingKeyboard(ownerDocument)) refocusTypingTarget();
  });
  let hasFormulaOfFix = view.formulaOfFixOnEntryCell !== null;
  React.useEffect(() => {
    if (!hasFormulaOfFix) return;
    return () => {
      let formulaBar = formulaBarRef.current;
      if (formulaBar !== null && formulaBar === formulaBar.ownerDocument.activeElement) refocusTypingTargetEvent();
    };
  }, [hasFormulaOfFix]);
  React.useEffect(() => {
    let ownerDocument = cellsRef.current?.ownerDocument;
    if (ownerDocument === undefined) return;
    let onKeyDown = (event: KeyboardEvent) => {
      let isInToast = event.target instanceof Element && isInsideToast(event.target);
      let keyEvent = normalizedKeyEvent(event);
      let focusMove = isInToast ? focusMoveOfKey(keyEvent) : null;
      if (focusMove === 'cells') {
        if (isInsideToast(ownerDocument.activeElement)) refocusTypingTargetEvent();
        if (!store.getView().isCommentModeOn) event.preventDefault();
        return;
      }
      if (event.key !== 'F6' || !isInToast || !hasInteractiveToast(ownerDocument)) return;
      if ((keyEvent.isRepeat && !keyEvent.isAltHeld) || (focusMove !== null && moveCaretTo('toasts', focusMove === 'nextPart' ? 1 : -1)))
        event.preventDefault();
    };
    ownerDocument.addEventListener('keydown', onKeyDown);
    return () => ownerDocument.removeEventListener('keydown', onKeyDown);
  }, [store, moveCaretTo]);
  let bottomInsetRef = React.useRef(0);
  let keyboardInsetRef = React.useRef(0);
  let wasPaneFullWidthRef = React.useRef(false);
  let measureGridRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    let [cells, zoomedGrid] = [cellsRef.current, zoomedGridRef.current];
    if (cells === null || zoomedGrid === null) return;
    let root = cells.ownerDocument.documentElement;
    let observedDialogs = new WeakSet<Element>();
    let measure = (entries: readonly ResizeObserverEntry[], isZoomAboutPointer: boolean = false) => {
      if (!cells.isConnected) return;
      let zoomNow = gridZoom.now();
      for (let { target } of entries) if (!target.isConnected) resizeObserver.unobserve(target);
      let slideOffset = footBar === null ? 0 : slideOffsetNow(footBar);
      let { top: cellsTop } = cells.getBoundingClientRect();
      let cellsBottom = cellsTop + cells.clientTop + cells.clientHeight;
      let footBox = footBar?.getClientRects()[0] ?? null;
      let footTop = footBox === null ? cellsBottom : footBox.top - slideOffset;
      let heightUnderFoot = root.clientHeight - footTop;
      let bottomInset = getBottomSafeAreaInset();
      let isCoveredMoreByComposer = bottomInset > bottomInsetRef.current;
      if (cells.clientHeight > 0) bottomInsetRef.current = bottomInset;
      let isCoveredMoreByKeyboard = getKeyboardInset() > keyboardInsetRef.current;
      let isCoveredLessByKeyboard = getKeyboardInset() < keyboardInsetRef.current;
      keyboardInsetRef.current = getKeyboardInset();
      let composerOverlap = Math.max(0, bottomInset - heightUnderFoot);
      barTopRef.current = composerOverlap;
      liftUndoCard(undoOfTurnCard, store.getView().grid);
      footBar?.style.setProperty('--sheet-width-of-grid', `${cells.clientWidth}px`);
      placeToastRoom();
      let footNoticeHeight = footNotice === null ? 0 : footNotice.offsetHeight + SHEET_FOOT_GAP;
      let roomUnderCards = Math.max(composerOverlap, footNoticeHeight);
      let undoCardHeight = undoOfTurnCard === null ? 0 : composerOverlap + undoOfTurnCard.offsetHeight + SHEET_FOOT_GAP;
      const toasts = root.querySelector<HTMLElement>(TOAST_SELECTOR);
      toasts?.style.setProperty('--sheet-room-under-notices', `${heightUnderFoot + Math.max(roomUnderCards, undoCardHeight)}px`);
      placeNotices(store.getView().grid, gridZoom.now(), 'measure');
      const isAtFoot = toasts?.hasAttribute(AT_FOOT_ATTRIBUTE) === true;
      let noticesBox = (isAtFoot ? toasts : toasts?.querySelector('[data-pinned]')?.parentElement)?.getBoundingClientRect();
      let openDialogs: ArrayLike<HTMLElement> & Iterable<HTMLElement> = isAtFoot ? toasts.querySelectorAll<HTMLElement>(OPEN_DIALOG_SELECTOR) : [];
      for (let target of openDialogs) {
        if (observedDialogs.has(target)) continue;
        observedDialogs.add(target);
        resizeObserver.observe(target);
      }
      let dialogTops = Array.from<HTMLElement, number>(
        openDialogs,
        (dialog) => (dialog.offsetParent?.getBoundingClientRect().bottom ?? cellsBottom) - dialog.offsetHeight,
      );
      let topOfNotices =
        noticesBox === undefined || noticesBox.height === 0
          ? cellsBottom
          : Math.min(noticesBox.top, ...dialogTops) - NOTICE_STACK_STEP_PX * Math.max(0, openDialogs.length - 1);
      let topOfCards = footTop - roomUnderCards;
      let boxAtFootInCells = ({ left, right }: Pick<DOMRect, 'left' | 'right'>, top: number) => ({
        left: Math.floor(
          pointInZoomedElement(cells, zoomNow, {
            clientX: left,
            clientY: top,
          }).x,
        ),
        right: Math.ceil(
          pointInZoomedElement(cells, zoomNow, {
            clientX: right,
            clientY: top,
          }).x,
        ),
        heightUnder: Math.ceil(unzoomLength(cellsBottom - top, zoomNow)),
      });
      let topOfFloating = Math.min(topOfCards, topOfNotices);
      let isPaneFullWidth = (sidePaneRef.current?.offsetWidth ?? 0) >= Math.max(1, root.clientWidth - 1);
      setBarsInsetAtFoot(isPaneFullWidth ? 0 : heightUnderFoot);
      store.dispatch({
        kind: 'gridResized',
        width: Math.floor(unzoomLength(cells.clientWidth, zoomNow)),
        height: Math.floor(unzoomLength(cells.clientHeight, zoomNow)),
        pageWidth: root.clientWidth,
        heightUnderWhatFloats: Math.ceil(unzoomLength(cellsBottom - topOfFloating, zoomNow)),
        ...(noticesBox !== undefined &&
          topOfNotices < topOfCards && {
            noticesAtFoot: {
              left: Math.floor(
                pointInZoomedElement(cells, zoomNow, {
                  clientX: noticesBox.left,
                  clientY: noticesBox.top,
                }).x,
              ),
              heightUnderTheRest: Math.ceil(unzoomLength(cellsBottom - topOfCards, zoomNow)),
            },
          }),
        heightUnderCardAtFoot: Math.ceil(unzoomLength(cellsBottom - footTop, zoomNow)),
        isCoveredMoreByComposer,
        isComposerOpen: bottomInset > 0,
        isCoveredMoreByKeyboard,
        isCoveredLessByKeyboard,
        zoom: zoomNow,
        isZoomAboutPointer,
        isOnPhone: isOnPhone(),
        isNarrowByTouch: isNarrowByTouch(),
        ...(footBox !== null &&
          isCoarsePointerNow() &&
          !isNarrowByTouch() && {
            boxesAtFootByTouch: [
              boxAtFootInCells(footBox, footTop - composerOverlap),
              ...(footNotice === null ? [] : [boxAtFootInCells(footNotice.getBoundingClientRect(), footTop - footNoticeHeight)]),
            ],
          }),
      });
      let ownerDocument = cells.ownerDocument;
      let isFocusOnBody = ownerDocument.activeElement === ownerDocument.body;
      let hasPaneJustFilled = isPaneFullWidth && !wasPaneFullWidthRef.current;
      if (root.clientWidth > 0) wasPaneFullWidthRef.current = isPaneFullWidth;
      let isFocusLost = ownerDocument.activeElement?.getClientRects().length === 0 || (hasPaneJustFilled && isFocusOnBody);
      let isSelectionCollapsed = ownerDocument.hasFocus() && ownerDocument.getSelection()?.isCollapsed !== false;
      if (isFocusLost && isSelectionCollapsed && !hasElementAwaitingKeyboard(ownerDocument)) focusPaneStart(sidePaneRef.current, 'start');
      shell.cellsAreMeasured();
    };
    let resizeObserver = new ResizeObserver((entries) => measure(entries));
    let footObserver = new MutationObserver(() => measure([]));
    if (footBar !== null)
      footObserver.observe(footBar, {
        attributes: true,
        attributeFilter: ['data-keeps-room-of-pane'],
      });
    let remeasure = () => measure([]);
    let modeObserver = new MutationObserver(remeasure);
    modeObserver.observe(cells.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode'],
    });
    let win = cells.ownerDocument.defaultView;
    let frameId = 0;
    let remeasureNextFrame = () => {
      remeasure();
      win?.cancelAnimationFrame(frameId);
      frameId = win?.requestAnimationFrame(remeasure) ?? 0;
    };
    let mediaQueries = ['(prefers-color-scheme:dark)', '(forced-colors:active)'].map((query) => win?.matchMedia(query));
    for (let mediaQuery of mediaQueries) mediaQuery?.addEventListener('change', remeasureNextFrame);
    let stopZoomWatch = gridZoom.subscribe((isAboutPointer) => measure([], isAboutPointer));
    measureGridRef.current = remeasure;
    let lastBottomInset = getBottomSafeAreaInset();
    let stopInsetWatch = subscribeBottomInsets(() => {
      if (getBottomSafeAreaInset() === lastBottomInset) return;
      lastBottomInset = getBottomSafeAreaInset();
      measure([]);
    });
    resizeObserver.observe(root);
    toastResizeObserverRef.current = resizeObserver;
    let toastObserver =
      win === null
        ? null
        : new win.MutationObserver(() => {
            refocusFromBehindToast();
            placeNotices(store.getView().grid, gridZoom.now(), 'toasts');
          });
    toastMutationObserverRef.current = toastObserver;
    observeToasts();
    let observedElements = footBar === null ? [cells] : [cells, footBar];
    for (let element of observedElements) resizeObserver.observe(element);
    resizeObserver.observe(cells.ownerDocument.body);
    if (overGridRef.current !== null) resizeObserver.observe(overGridRef.current);
    let wheelTargets: HTMLElement[] = [...observedElements, headerExtra, footerExtra].filter((element) => element !== null);
    let onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      mouseAroundComments.putAway();
      let scroller = event.target instanceof Element ? event.target.closest('.sheet-scroller') : null;
      if (scroller !== null && scroller.scrollWidth > scroller.clientWidth && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      let entryEditor = entryEditorOf(event.target);
      if (
        (entryEditor instanceof HTMLTextAreaElement || isEntryEditor(entryEditor)) &&
        entryEditor.scrollHeight > entryEditor.clientHeight &&
        Math.abs(event.deltaY) >= Math.abs(event.deltaX) &&
        !(event.altKey || event.shiftKey || event.metaKey)
      )
        return;
      event.preventDefault();
      let deltaScale =
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? unzoomLength(1, gridZoom.now()) : defaultRowHeightAtDensity(store.getView().density);
      store.dispatch({
        kind: 'wheelTurned',
        deltaX: event.deltaX * deltaScale,
        deltaY: event.deltaY * deltaScale,
      });
    };
    for (let element of wheelTargets)
      element.addEventListener('wheel', onWheel, {
        passive: false,
      });
    return () => {
      resizeObserver.disconnect();
      footObserver.disconnect();
      modeObserver.disconnect();
      for (let mediaQuery of mediaQueries) mediaQuery?.removeEventListener('change', remeasureNextFrame);
      win?.cancelAnimationFrame(frameId);
      stopZoomWatch();
      stopInsetWatch();
      measureGridRef.current = null;
      toastResizeObserverRef.current = null;
      toastObserver?.disconnect();
      toastMutationObserverRef.current = null;
      let toastsLayer = root.querySelector<HTMLElement>(TOAST_SELECTOR);
      for (let room of ['over-toasts', 'right-of-toasts', 'kept-at-right', 'under-notices'])
        toastsLayer?.style.removeProperty(`--sheet-room-${room}`);
      for (let element of wheelTargets) element.removeEventListener('wheel', onWheel);
    };
  }, [
    store,
    gridZoom,
    footBar,
    footNotice,
    undoOfTurnCard,
    headerExtra,
    footerExtra,
    shell,
    mouseAroundComments,
  ]);
  let caretKeptBeforeEntryEndsRef = React.useRef<CaretKept | null>(null);
  React.useLayoutEffect(() => {
    let isCaretWithCellsBeforeEntryEnds = view.isCaretWithCellsBeforeEntryEnds;
    let keptCaret = caretKeptBeforeEntryEndsRef.current;
    if (!isCaretWithCellsBeforeEntryEnds) caretKeptBeforeEntryEndsRef.current = null;
    if (lastTypingTargetRef.current === typingTarget) return;
    let active = getActiveElement();
    let hasPageFocusNow = active?.ownerDocument.hasFocus() === true;
    let activeField =
      [activeEditorRef.current, formulaBarRef.current, cellEditorRef.current].find((field) => field === active) ?? null;
    if (isCaretWithCellsBeforeEntryEnds && (!hasPageFocusNow || activeField === null)) return;
    lastTypingTargetRef.current = typingTarget;
    if (typingTarget === 'grid') isEditKeptOnBlurRef.current = false;
    if (isCaretWithCellsBeforeEntryEnds && activeField !== null)
      caretKeptBeforeEntryEndsRef.current = {
        box: activeField,
        text: activeField.value,
        selected: [
          activeField.selectionStart ?? activeField.value.length,
          activeField.selectionEnd ?? activeField.value.length,
          activeField.selectionDirection ?? 'none',
        ],
      };
    if (keptCaret !== null && typingTarget !== 'grid' && active !== cellEditorRef.current) return;
    let sidePane = sidePaneRef.current;
    let isFocusOutsideCells =
      sidePane?.contains(sidePane.ownerDocument.activeElement) === true || isInAtEndOfSheet(active) || isPlacedViewAskInput(active);
    if (typingTarget === 'grid' && isFocusOutsideCells) return;
    let isPageLeft = isPageLeftUntouched() || (view.isEntryEndedUnasked && cellsRef.current?.ownerDocument.hasFocus() !== true);
    if (typingTarget === 'grid' && isPageLeft) {
      formulaBarRef.current?.blur();
      if (active instanceof HTMLElement && active.hasAttribute('data-is-going')) active.blur();
      return;
    }
    let field = (typingTarget === 'cell' ? activeEditorRef : formulaBarRef).current;
    let isLeftOutside = keptCaret === null ? isPageLeftWithoutPointer() : !hasPageFocusNow;
    if (typingTarget !== 'grid' && active !== field && isLeftOutside) {
      isEditKeptOnBlurRef.current = true;
      if (isFocusInCells() || !isTextInputOrEntryEditor(active)) blurQuietly(active);
      return;
    }
    focusTypingTarget(typingTarget, keptCaret);
  });
  let isGridFocusHeld = areCellsOffLimits(view);
  React.useLayoutEffect(() => {
    let [cellEditorElement, gridFocus] = [cellEditorRef.current, gridFocusRef.current];
    let [from, to] = isGridFocusHeld ? [cellEditorElement, gridFocus] : [gridFocus, cellEditorElement];
    let isFocusOnFrom = () => from !== null && from.ownerDocument.hasFocus() && from === from.ownerDocument.activeElement;
    let moveFocus = () => {
      if (isFocusOnFrom() && store.getView().mode.kind !== 'editing')
        to?.focus({
          preventScroll: true,
        });
    };
    if (isGridFocusHeld) return moveFocus();
    let timer = setTimeout(moveFocus);
    return () => clearTimeout(timer);
  }, [store, isGridFocusHeld]);
  let formulaBarKey = useFormulaBarRemountKey(
    view.mode.kind === 'editing' && view.mode.typingIn === 'formulaBar',
    isModalOpen(view) || view.menu !== null,
  );
  let isNarrowPhone = useNarrowPhone();
  let isOnPhoneHere = useOnPhone();
  let isHistoryControlInHeader: boolean = shell.drawsHistory() && view.viewOnlyBecause !== 'readOnly';
  let areViewToolsAtFoot: boolean = isHistoryControlInHeader && !isOnPhoneHere;
  let groupLevels = groupLevelCount(view.groupMargins.rows);
  let headerRoomStyle = React.useMemo(
    (): StyleWithVariables => gridHeaderRoomStyle(groupLevels, zoom, view.density),
    [groupLevels, zoom, view.density],
  );
  let formulaBarLines = useFormulaBarLines({
    field: formulaBarRef,
    text: view.formulaOfFixOnEntryCell === null ? view.formulaBarText : '',
    toolsAtEnd: viewToolsRef,
    areToolsAtEnd: !areViewToolsAtFoot,
    isCardAsWideAsStrip: isNarrowPhone,
    isOnlyRead: isNarrowPhone && view.isFormulaBarReadOnly,
  });
  let formulaFirstLineStyle = React.useMemo(
    (): StyleWithVariables | undefined => firstLineWidthStyle(formulaBarLines.widthOfFirstLineOfSeveral),
    [formulaBarLines.widthOfFirstLineOfSeveral],
  );
  React.useLayoutEffect(() => {
    let { mode: latestMode } = store.getView();
    let isEditingText = latestMode.kind === 'editing' && !isFormulaText(latestMode.text);
    if (typingTarget === 'formulaBar' && isEditingText && isNarrowPhone) activeEditorRef.current?.scrollTo(0, 0);
  }, [store, typingTarget, isNarrowPhone]);
  useCoveredUnderCellsProperty(formulaRowRef);
  React.useLayoutEffect(() => {
    let ownerDocument = cellsRef.current?.ownerDocument;
    if (!isViewOnly || ownerDocument === undefined) return;
    if (
      (ownerDocument.activeElement?.matches(':disabled') === true || ownerDocument.activeElement === ownerDocument.body) &&
      ownerDocument.hasFocus()
    )
      focusCaret();
  }, [isViewOnly, focusCaret]);
  let { calculatingShownWait: calculatingShownWait, savingBarWait, longCalculationWait: longCalculationWait } = view;
  let { waitForNextEditOfAgent, waitForAgentOnComments } = view;
  let doneByAgentWait = view.doneByAgent?.wait ?? null;
  React.useEffect(() => watchAnotherRangeKey(window), []);
  React.useEffect(() => scheduleWorkShownLongEnough(calculatingShownWait, store), [store, calculatingShownWait]);
  React.useEffect(() => scheduleWorkShownLongEnough(savingBarWait, store), [store, savingBarWait]);
  React.useEffect(() => scheduleWorkShownLongEnough(longCalculationWait, store), [store, longCalculationWait]);
  React.useEffect(() => scheduleWorkShownLongEnough(waitForNextEditOfAgent, store), [store, waitForNextEditOfAgent]);
  React.useEffect(() => scheduleWorkShownLongEnough(waitForAgentOnComments, store), [store, waitForAgentOnComments]);
  let lastDoneAnnouncement = useAnnouncedLastDone(
    store,
    () => cellsRef.current?.ownerDocument.hasFocus() === true && isFocusInCells(),
  );
  let lastDoneWords = view.lastDone === null ? null : announcementOfLastDone(view.lastDone, lastDoneAnnouncement);
  let [isZoomSettling, setIsZoomSettling] = React.useState(false);
  let zoomSettleCountRef = React.useRef(0);
  let markZoomSettling = React.useCallback(() => {
    let win = cellsRef.current?.ownerDocument.defaultView ?? null;
    if (win === null) return;
    zoomSettleCountRef.current += 1;
    let count = zoomSettleCountRef.current;
    setIsZoomSettling(true);
    afterNextFrameOrTimeout(
      win,
      () =>
        afterNextFrameOrTimeout(win, () => {
          if (count === zoomSettleCountRef.current) setIsZoomSettling(false);
        }),
      ACTIVE_DESCENDANT_PAUSE_MS,
    );
  }, []);
  let isDoneByAgentShownLongEnough = useIsTrueForVisibleMs(doneByAgentWait !== null, doneByAgentWait?.ms ?? 0);
  React.useEffect(() => {
    if (isDoneByAgentShownLongEnough && doneByAgentWait !== null)
      store.dispatch({
        kind: 'workShownLongEnough',
        wait: doneByAgentWait,
      });
  }, [store, doneByAgentWait, isDoneByAgentShownLongEnough]);
  let columnHeadingsCall = useColumnGripCalled({
    drawn: view.grid,
    gridRef: cellsRef,
    zoom,
  });
  let nameFlagsAtPointer = useNameFlagsAtPointer({
    store,
    drawn: view.grid,
    gridRef: cellsRef,
    zoom,
  });
  let filterButtonPointedAt = useFilterButtonPointedAt({
    drawn: view.grid,
    gridRef: cellsRef,
    zoom,
  });
  let tableHandleCall = useTableHandleCall({
    drawn: view.grid,
    gridRef: cellsRef,
    zoom,
  });
  let { menuOfHandleShut } = tableHandleCall;
  let tableHandleCalledFor = view.grid.cellsHeld === null ? (view.menu?.ofHandleOfTable ?? tableHandleCall.calledFor) : null;
  useGridZoomGestures({
    gridRef: cellsRef,
    overGridRef,
    gridZoom,
    zoomTo: (nextZoom, pointer) => {
      let [cells, zoomBefore, zoomAfter] = [cellsRef.current, gridZoom.now(), clampZoom(nextZoom)];
      if (cells === null || zoomAfter === zoomBefore) return;
      mouseAroundComments.putAway();
      let point = pointInZoomedElement(cells, zoomBefore, pointer);
      gridZoom.set(zoomAfter, true);
      store.dispatch({
        kind: 'wheelTurned',
        deltaX: point.x * (1 - zoomBefore / zoomAfter),
        deltaY: point.y * (1 - zoomBefore / zoomAfter),
      });
    },
  });
  useStepBackIntoCells({
    store,
    gridRef: gridFocusRef,
    isSteppedOut: view.isSteppedOutOfCells,
  });
  useChangesComingIn(cellsRef, view.grid);
  useMarksOfImportExpiry(store, view.marksOfImport);
  let errorCardHover = useErrorCardHover(store, view.linkExplained !== null);
  let pointerDispatch = React.useMemo(
    () => ({
      dispatch(event: PageEvent) {
        if (event.kind === 'pointerRested' && event.at !== null) errorCardHover.cardIsPutAway();
        store.dispatch(event);
      },
    }),
    [store, errorCardHover],
  );
  let linkCardHover = useLinkCardHover(pointerDispatch, view.linkExplained?.cellKey ?? null);
  let [isLinkCardPressedAway, setIsLinkCardPressedAway] = React.useState(true);
  let linkCardSeen = useLinkCardSeen(cellsRef);
  let openLink = React.useMemo(() => openLinkIfShown(linkCardSeen, openLinkUnlessCommentMode(store)), [linkCardSeen, store]);
  let leaveLinkCard = React.useCallback(
    () =>
      store.dispatch({
        kind: 'linkCardLeftByPointer',
        cardOf: store.getView().linkExplained?.cellKey ?? null,
        isDoneWith: true,
      }),
    [store],
  );
  let openLinkFromCard = React.useCallback(
    (url: string, place?: LinkPlace) => {
      let linkPlace = place ?? linkPlaceOfUrl(store.getView().linkExplained, url);
      let isOpened = linkPlace !== null && openLink(url, linkPlace);
      if (isOpened) leaveLinkCard();
      return isOpened;
    },
    [store, openLink, leaveLinkCard],
  );
  let copyLinkAddress = React.useCallback(
    (url: string) => {
      let ownerDocument = cellsRef.current?.ownerDocument;
      if (!(ownerDocument !== undefined && copyTextWithExecCommand(ownerDocument, url)))
        return store.dispatch({
          kind: 'sheetLinkCopyAnswered',
          whyNot: 'refused',
        });
      clipboard.somethingElseCopiedHere();
      store.dispatch({
        kind: 'linkAddressCopied',
      });
      return leaveLinkCard();
    },
    [store, clipboard, leaveLinkCard],
  );
  let copyLinkIfSeen = React.useCallback(
    (url: string) => {
      let linkPlace = linkPlaceOfUrl(store.getView().linkExplained, url);
      if (
        linkPlace === 'typed' ||
        (linkPlace !== null &&
          linkCardSeen.hasShown({
            ...linkPlace,
            url,
          }))
      )
        copyLinkAddress(url);
    },
    [store, linkCardSeen, copyLinkAddress],
  );
  let chooseLinkEdit = React.useCallback(
    (address: string) =>
      store.onceEventsAreFinished(() => {
        if (!isPageReallyLeft())
          store.dispatch({
            kind: 'linkEditChosen',
            address,
          });
      }),
    [store, isPageReallyLeft],
  );
  let chooseLinkRemove = React.useCallback(
    (address: string) => {
      let { cellKey, urlsOnWords } = store.getView().linkExplained ?? {};
      if (cellKey === undefined) return;
      let ofAddress =
        urlsOnWords?.includes(address) === true
          ? {
              address,
            }
          : {};
      store.dispatch({
        kind: 'linkRemoveChosen',
        cardOf: cellKey,
        ...ofAddress,
      });
      leaveLinkCard();
    },
    [store, leaveLinkCard],
  );
  let askLinkForm = React.useCallback(() => {
    giveEntryBoxOfItsOwn(store, entryFieldRefs);
    store.dispatch({
      kind: 'linkFormAsked',
      ...caretInEntryPatch(store.getView().mode, entryFieldRefs),
    });
  }, [store, entryFieldRefs]);
  let giveLink = React.useCallback(
    (text: string, address: string) => {
      let isFormInEntry = store.getView().linkForm?.inEntry !== undefined;
      ReactDOM.flushSync(
        () =>
          store.dispatch({
            kind: 'linkGiven',
            text,
            address,
          }),
      );
      if (!isFormInEntry) return;
      store.lookOnceEventsAreFinished(() => {
        let { mode: latestMode, linkForm } = store.getView();
        let { end } = (latestMode.kind === 'editing' ? latestMode.selectedInEntry : undefined) ?? {};
        if (linkForm === null && end !== undefined) typingBoxOf(latestMode, entryFieldRefs)?.setSelectionRange(end, end);
      });
    },
    [store, entryFieldRefs],
  );
  let shutLinkForm = React.useCallback(
    () =>
      store.dispatch({
        kind: 'linkFormShut',
      }),
    [store],
  );
  let forwardWheelToCells = React.useCallback(
    (event: WheelEvent) => cellsRef.current?.dispatchEvent(new WheelEvent(event.type, event)) === false,
    [],
  );
  let refocusFromUnpinnedToast = React.useEffectEvent(() => {
    if (isInsideUnpinnedToast(cellsRef.current?.ownerDocument.activeElement)) focusTypingTarget(typingTarget);
  });
  let hasUndoOffer = view.undoOffer !== null;
  React.useLayoutEffect(() => {
    if (!hasUndoOffer) refocusFromUnpinnedToast();
  }, [hasUndoOffer]);
  let placeOfField = (field: Element): PlaceOfField | null => {
    if (isPlacedViewAskInput(field)) return 'chart';
    if (field === activeEditorRef.current) return 'cell';
    if (field === formulaBarRef.current) return 'formulaBar';
    if (field.classList.contains('sheet-name-field')) return 'sheetName';
    return sidePaneRef.current?.contains(field) === true ? 'sidePane' : null;
  };
  let sidePaneInputs = () => [...(sidePaneRef.current?.querySelectorAll('input') ?? [])];
  let fieldLeftForMenuRef = React.useRef<FieldLeft | null>(null);
  let focusBeforeMenuRef = React.useRef<EventTarget | null>(null);
  let closeMenuAndRefocus = React.useCallback(() => {
    let focusBefore = focusBeforeMenuRef.current;
    fieldLeftForMenuRef.current = null;
    store.dispatch({
      kind: 'menuClosed',
    });
    if (!(focusBefore instanceof HTMLElement && (focusBefore.closest('[role="menu"]') === null || isTextInputOrEntryEditor(focusBefore))))
      return focusCaret();
    let textField = isTextInputOrEntryEditor(focusBefore) && focusBefore.selectionStart !== null ? focusBefore : null;
    let picked: FieldLeft['picked'] = [textField?.selectionStart ?? null, textField?.selectionEnd ?? null, textField?.selectionDirection ?? undefined];
    let [scrollLeft, scrollTop] = [focusBefore.scrollLeft, focusBefore.scrollTop];
    focusBefore.focus({
      preventScroll: true,
    });
    textField?.setSelectionRange(...picked);
    focusBefore.scrollTo(scrollLeft, scrollTop);
    return focusBefore.ownerDocument.activeElement === focusBefore ? undefined : focusCaret();
  }, [focusCaret, store]);
  let pasteKeyRef = React.useRef<PasteKeyTracker | null>(null);
  let pasteEventRef = React.useRef<ClipboardEvent | null>(null);
  let notePasteEvent = React.useCallback((event: ClipboardEvent) => {
    pasteEventRef.current = event;
  }, []);
  let focusLeftRef = React.useRef<{ left: FieldLeft; timer: ReturnType<typeof setTimeout> } | null>(null);
  let isBlurDuringEventRef = React.useRef(false);
  let noteFieldLeft = (field: Element | null) => {
    if (focusTrackerRef.current?.isUnderWay() === true) return false;
    let { mode: latestMode, peopleList: latestPeopleList } = store.getView();
    let isPeopleListInField = latestMode.kind !== 'editing' && (latestPeopleList?.inField ?? null) !== null;
    if (field === getGridOrEditorElement() && isPeopleListInField) {
      fieldLeftForMenuRef.current = {
        place: 'grid',
        text: '',
        indexInPane: -1,
        picked: [0, 0],
        pressesBefore: focusTrackerRef.current?.timesBegun() ?? 0,
      };
      return true;
    }
    if (!isTextInputOrEntryEditor(field)) return false;
    if (field.hasAttribute('data-is-going')) return false;
    if (field === cellEditorRef.current && whereTypingGoes(store.getView()) === 'grid') return false;
    let { selectionStart, selectionEnd, selectionDirection } = field;
    if (selectionStart === null) return false;
    fieldLeftForMenuRef.current = {
      place: placeOfField(field),
      text: field.value,
      indexInPane: sidePaneInputs().findIndex((paneInput) => paneInput === field),
      picked: [selectionStart, selectionEnd, selectionDirection ?? undefined],
      pressesBefore: focusTrackerRef.current?.timesBegun() ?? 0,
    };
    return true;
  };
  let loseFocus = (mayComeBack: boolean, isOfWindow: boolean = false) => {
    let { mode: latestMode, openUnderCell, isListOfKeysOpen, linkForm } = store.getView();
    if (latestMode.kind !== 'editing' && openUnderCell === null) return;
    if (isListOfKeysOpen) return;
    if (isOfWindow && linkForm?.inEntry !== undefined)
      return store.dispatch({
        kind: 'pageMayBeEnded',
      });
    let typingField = typingFieldRef.current;
    store.dispatch({
      kind: 'focusLost',
      mayComeBack,
      ...(isOfWindow && {
        isOfWindow,
      }),
    });
    let blurFields = () => {
      let target = whereTypingGoes(store.getView());
      lastTypingTargetRef.current = target;
      if (target === 'grid') formulaBarRef.current?.blur();
      if (target === 'grid') typingField?.blur();
      if (target === 'grid' && latestMode.kind === 'editing') cellEditorRef.current?.blur();
    };
    if (!store.isEventUnfinished()) return blurFields();
    return store.lookOnceEventsAreFinished(() => {
      if (cellsRef.current?.ownerDocument.hasFocus() === true && isFocusInCells() && focusLeftRef.current === null) return;
      blurFields();
    });
  };
  let [findTextGiven, setFindTextGiven] = React.useState<FindTextGiven | null>(null);
  let [timesRenameBegunElsewhere, setTimesRenameBegunElsewhere] = React.useState(0);
  let focusPresence = (isByPress: boolean = false): FocusPresence => {
    let isUntouched = !isByPress && focusTrackerRef.current?.hasPersonActedSinceFocusLeft('keysToo') === false;
    return {
      wasHere: !isPageReallyLeft() || isUntouched,
      timesFocusHadLeft: focusTrackerRef.current?.timesFocusLeft() ?? 0,
    };
  };
  let isStillPresent = (presence: FocusPresence | null) =>
    presence !== null && isPageReallyLeft() && (presence.wasHere || (focusTrackerRef.current?.timesFocusLeft() ?? 0) !== presence.timesFocusHadLeft);
  let findPresenceRef = React.useRef<FocusPresence | null>(null);
  let [findBarKey, setFindBarKey] = React.useState(0);
  let openFind = (text: string | null, isByScroll: boolean = false) => {
    if (isModalOpen(store.getView())) return;
    if (isByScroll) scrollGesture.begin();
    findPresenceRef.current = focusPresence(isByScroll);
    if (store.getView().find !== null && findBarRef.current === null) setFindBarKey((key) => key + 1);
    store.dispatch({
      kind: 'findOpened',
    });
    setFindTextGiven(
      text === null
        ? null
        : {
            text,
          },
    );
    if (text !== null)
      store.dispatch({
        kind: 'findTextChanged',
        text,
        goesToCellFound: true,
      });
    loseFocus(false);
    findBarRef.current?.focus({
      preventScroll: true,
    });
    findBarRef.current?.select();
  };
  let openFindEmpty = () => openFind(null);
  let openFindEvent = React.useEffectEvent(openFindEmpty);
  let openFindByScrollEvent = React.useEffectEvent(() => openFind(null, true));
  let showReplace = () => {
    let presence = focusPresence();
    findPresenceRef.current = presence;
    store.onceWhatIsShownOfSelectionIsKnown(() => {
      if (!isStillPresent(presence))
        store.dispatch({
          kind: 'replaceShownChanged',
          isShown: true,
        });
    });
  };
  let showReplaceEvent = React.useEffectEvent(showReplace);
  let openReplace = () => {
    openFindEmpty();
    showReplace();
  };
  let closeFind = () => {
    let target = whereTypingGoes(store.getView());
    store.dispatch({
      kind: 'findClosed',
    });
    focusTypingTarget(target);
  };
  let stepFind = (by: number) => {
    store.dispatch({
      kind: 'entryLeft',
    });
    store.dispatch({
      kind: 'findStepped',
      by,
    });
  };
  let stepFindEvent = React.useEffectEvent(stepFind);
  React.useEffect(() => {
    let ownerDocument = cellsRef.current?.ownerDocument;
    if (ownerDocument === undefined) return;
    let onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      let findStep = findStepShortcut(event);
      let isFromCells = [gridFocusRef, cellEditorRef, activeEditorRef, formulaBarRef].some(
        (ref) => ref.current === event.target,
      );
      if (isFindShortcut(event) || (findStep !== null && store.getView().find === null)) openFindEvent();
      else if (isReplaceShortcut(event)) {
        openFindEvent();
        showReplaceEvent();
      } else if (findStep === null) return;
      else if (event.target instanceof Node && findBarRef.current?.closest('search')?.contains(event.target) === true) return;
      else if (isFromCells) stepFindEvent(findStep);
      event.preventDefault();
      event.stopPropagation();
    };
    ownerDocument.addEventListener('keydown', onKeyDown, true);
    return () => ownerDocument.removeEventListener('keydown', onKeyDown, true);
  }, [store]);
  let focusBeforeKeysListRef = React.useRef<Element | null>(null);
  let placementBeforeKeysListRef = React.useRef<string | null>(null);
  let cardUnderChartRef = React.useRef<CardUnderChart | null>(null);
  React.useEffect(() => {
    let ownerDocument = cellsRef.current?.ownerDocument;
    if (ownerDocument === undefined) return;
    let onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !isKeyboardShortcutsKey(event, IS_APPLE_PLATFORM)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (store.getView().isListOfKeysOpen)
        return store.dispatch({
          kind: 'listOfKeysShut',
        });
      let active = ownerDocument.activeElement;
      let placementId = placementIdOfElement(active);
      let returnTo = isPlacedViewAskInput(active) && placementId !== null ? findPlacedViewCaret(ownerDocument, placementId) : active;
      focusBeforeKeysListRef.current = active === ownerDocument.body ? null : returnTo;
      placementBeforeKeysListRef.current = isPlacedViewAskInput(active) ? placementId : null;
      return store.dispatch({
        kind: 'listOfKeysAsked',
      });
    };
    ownerDocument.addEventListener('keydown', onKeyDown, true);
    return () => ownerDocument.removeEventListener('keydown', onKeyDown, true);
  }, [store]);
  React.useEffect(() => {
    let ownerDocument = cellsRef.current?.ownerDocument;
    if (ownerDocument === undefined) return;
    let onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !isAllCommandsMenuKey(event, IS_APPLE_PLATFORM)) return;
      let { menu: latestMenu, viewOnlyBecause } = store.getView();
      let action = allCommandsMenuKeyAction({
        isPointerCoarse: isCoarsePointerNow(),
        canPersonEdit: viewOnlyBecause === null,
        isFromCells: false,
        menu: latestMenu,
        isRepeat: event.repeat,
      });
      if (action === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === 'shuts')
        store.dispatch({
          kind: 'menuClosed',
        });
    };
    ownerDocument.addEventListener('keydown', onKeyDown, true);
    return () => ownerDocument.removeEventListener('keydown', onKeyDown, true);
  }, [store]);
  React.useEffect(() => (shell.offerFind(openFindByScrollEvent), () => shell.offerFind(null)), [shell]);
  let isInteractiveWritable = view.interactive?.doesWrite === true && view.viewOnlyBecause === null;
  let isPointerPressedLastRef = React.useRef(caretAtFirst?.wasPointerPressedLast === true);
  React.useLayoutEffect(
    () => () => caretAtFirst?.actsHeard.notePointerPressedLast(isPointerPressedLastRef.current),
    [caretAtFirst],
  );
  let isEscapeHeldInEditRef = React.useRef(false);
  let pressGuard = usePressGuardAfterViewMove(store, view.movesOfViewByItself, cellsRef);
  let wasPointerPressedLast = React.useCallback(() => isPointerPressedLastRef.current, []);
  let isBeforeAnyInputRef = React.useRef(true);
  let wasKeyPressedLast = React.useCallback(() => !isBeforeAnyInputRef.current && !isPointerPressedLastRef.current, []);
  let lastFocusedByKeyRef = React.useRef<HTMLElement | null>(null);
  let getLastFocusedByKey = React.useCallback(() => {
    let element = lastFocusedByKeyRef.current;
    if (element === null || !isElementLiveAndNotInert(element) || element.matches(':disabled')) return null;
    return element.getClientRects().length > 0 ? element : null;
  }, []);
  let lastReplaced = view.lastDone?.what === 'replaced' ? view.lastDone : null;
  let replaced = view.undoOffer?.kind === 'replacedInCells' ? view.undoOffer : lastReplaced;
  let findBar =
    view.find === null
      ? null
      : <FindBarUnlessGivenUp key={findBarKey} find={view.find} fieldRef={findBarRef} replaceFieldRef={replaceFieldRef} canReplace={view.viewOnlyBecause === null} areFormulasShown={view.areFormulasShown} replaced={replaced} textGiven={findTextGiven} onText={(text) =>
              store.dispatch({
                kind: 'findTextChanged',
                text,
                goesToCellFound: [findBarRef, replaceFieldRef].some(
                  ({ current }) => current !== null && current === current.ownerDocument.activeElement,
                ),
              })} onStep={stepFind} onReplaceAsked={showReplace} onOptions={(options) =>
              store.dispatch({
                kind: 'findOptionsChanged',
                ...options,
              })} pane={{
              ref: sidePaneRef,
              takesNoTyping: sidePaneTakesNoTyping,
              width: sidePaneWidth,
              onWidthChange: setSidePaneWidth,
              wasPointerPressedLast,
            }} onReplace={(text, where) => {
              store.dispatch({
                kind: 'entryLeft',
              });
              store.dispatch({
                kind: 'replaceChosen',
                text,
                where,
              });
            }} onUndoOrRedo={(event) =>
              store.dispatch({
                kind: 'keyPressed',
                ...normalizedKeyEvent(event),
              })} onLookAgain={() =>
              store.dispatch({
                kind: 'findLookedAgain',
              })} onGoOn={(step) => moveCaretTo(view.find?.isReplaceShown === true ? 'sidePane' : 'findBar', step)} onClose={closeFind} hasLeftSinceAsked={() => isStillPresent(findPresenceRef.current)} onGivenUp={() => {
              focusChangesRef.current += 1;
              store.dispatch({
                kind: 'findClosed',
              });
            }} />;
  let isFirstKeyAwaitedRef = React.useRef<false | 'atFirst' | 'underTypist'>(false);
  let cancelKeyboardOfferRef = React.useRef<(() => void) | null>(null);
  let isKeyboardOfferedRef = React.useRef(false);
  let wasPressInAskBoxRef = React.useRef(false);
  let isFocusLostUntouchedRef = React.useRef(false);
  let pressesAtWindowBlurRef = React.useRef(-1);
  let focusLostToNothingRef = React.useRef<EventTarget | null>(null);
  let isDialogOwedCaretRef = React.useRef(false);
  let focusOpenModal = () => {
    if (!isModalOpen(store.getView())) return false;
    let ownerDocument = cellsRef.current?.ownerDocument;
    let dialog = [
      ...(ownerDocument?.querySelectorAll(`:is([data-ui=Dialog], [${CELL_HISTORY_CARD_ATTRIBUTE}]):not([data-ending-style])`) ?? []),
    ].at(-1);
    let initialFocus = dialog?.hasAttribute(INITIAL_FOCUS_IS_SAFE_ATTRIBUTE) === true ? dialog.querySelector('[data-initial-focus]') : null;
    let fallbackFocus = dialog?.querySelector(INITIAL_FOCUS_SELECTOR);
    for (let candidate of [focusLostToNothingRef.current, chooseFileButtonRef.current, initialFocus, fallbackFocus, dialog]) {
      if (!(candidate instanceof HTMLElement) || dialog?.contains(candidate) !== true) continue;
      candidate.focus({
        preventScroll: true,
      });
      if (ownerDocument?.activeElement === candidate) break;
    }
    return true;
  };
  let restoreFocus = (retry?: () => void, beforeRestore?: () => void) => {
    let ownerDocument = cellsRef.current?.ownerDocument;
    if (ownerDocument === undefined) return;
    isFocusLostUntouchedRef.current = false;
    isFirstKeyAwaitedRef.current = false;
    if (ownerDocument.activeElement !== ownerDocument.body && ownerDocument.activeElement?.matches(':disabled') !== true) return;
    let noteFocusLost = () => {
      isFocusLostUntouchedRef.current =
        !mayFocusReturnToCells() &&
        ownerDocument.activeElement === ownerDocument.body &&
        ownerDocument.defaultView?.navigator.userActivation?.hasBeenActive !== true;
    };
    if (hasElementAwaitingKeyboard(ownerDocument)) return noteFocusLost();
    if (ownerDocument.getSelection()?.isCollapsed === false) return;
    if (focusLeftRef.current !== null) return;
    beforeRestore?.();
    if (beforeRestore !== undefined && ownerDocument.activeElement !== ownerDocument.body) return;
    let focusAfterModal = focusLostToNothingRef.current instanceof HTMLElement ? focusLostToNothingRef.current : null;
    let contextBarField = () =>
      ownerDocument.querySelector<HTMLElement>('[data-part-of-context-bar] :is([role="combobox"], [role="listbox"][tabindex="0"])');
    let isUntouchedSinceModal =
      focusTrackerRef.current?.timesBegun() === pressesAtWindowBlurRef.current &&
      !focusTrackerRef.current.hasPersonActedSinceFocusLeft('pressesOnly') &&
      store.getView().mode.kind === 'navigating';
    if (
      !focusOpenModal() &&
      !refocusInContextBar(focusAfterModal, () => ownerDocument.activeElement, contextBarField) &&
      !(isUntouchedSinceModal && focusSidePaneOrTitle(sidePaneRef.current, focusAfterModal))
    )
      refocusTypingTarget();
    noteFocusLost();
  };
  let isCellsCopyTarget = () => {
    let active = getActiveElement();
    if (active === null) return false;
    if (active === cellEditorRef.current) return whereTypingGoes(store.getView()) === 'grid';
    if (active === activeEditorRef.current) return store.getView().mode.kind !== 'editing';
    if (active instanceof HTMLInputElement) return false;
    return active === gridFocusRef.current || calendarPopupRef.current?.contains(active) === true;
  };
  let isFocusInEntryField = () => {
    let active = getActiveElement();
    return active !== null && (active === activeEditorRef.current || active === formulaBarRef.current);
  };
  let mayEntryTakeClipboard = () => isFocusInEntryField() && store.mayAnEntryOpenOrEnd();
  let isPlacedViewFocused = () => placementIdOfElement(getActiveElement()) !== null && !isPlacedViewAskInput(getActiveElement());
  let isPlacedViewFocusedWithoutText = () =>
    isPlacedViewFocused() && (cellsRef.current?.ownerDocument.getSelection()?.toString() ?? '') === '';
  let onCopyOrCut = React.useEffectEvent((event: ClipboardEvent) => {
    let { clipboardData } = event;
    let isEntryCopy = event.type === 'copy' && isFocusInEntryField() && store.mayWhatACopyHoldsChange();
    let isEntryCut = event.type === 'cut' && store.getView().mode.kind === 'editing';
    let isCellsTarget = isCellsCopyTarget() && !isEntryCut;
    if (!(clipboard.isBrowserAskedForCells() || isCellsTarget || isEntryCopy) || clipboardData === null) {
      clipboard.somethingElseCopiedHere();
      if (!isPlacedViewFocusedWithoutText() || clipboardData === null)
        return store.dispatch({
          kind: 'otherThanCellsCopied',
        });
      event.preventDefault();
      let latestView = store.getView();
      let sheetId = shownSheetIdOf(latestView);
      let placementId = placementIdOfElement(getActiveElement());
      let placedView = latestView.grid.placedViews.find((placed) => placed.placementId === placementId);
      if (event.type === 'cut' || sheetId === null || placedView === undefined) {
        clipboard.duringCopy(clipboardData, () => clipboard.putOnClipboard(EMPTY_CLIPBOARD_CONTENT));
        return store.dispatch({
          kind: 'otherThanCellsCopied',
          ...(event.type === 'cut' && {
            ofChart: 'notCut',
          }),
        });
      }
      clipboard.duringCopy(
        clipboardData,
        () =>
          clipboard.putChartOnClipboard(
            {
              sheetId,
              placementId: placedView.placementId,
            },
            placedView.name,
          ),
      );
      return store.dispatch({
        kind: 'otherThanCellsCopied',
        ofChart: 'copied',
      });
    }
    event.preventDefault();
    clipboard.duringCopy(
      clipboardData,
      () =>
        store.dispatch(
          event.type === 'cut'
            ? {
                kind: 'cutChosen',
                token: crypto.randomUUID(),
              }
            : {
                kind: 'copyChosen',
              },
        ),
    );
    if (likelyHasKeyboard() && cellsRef.current?.ownerDocument.hasFocus() === false) clipboard.forgetLastPutHere();
  });
  let onBeforeClipboard = React.useEffectEvent((event: Event) => {
    let isEntryTarget = event.type !== 'beforecut' && mayEntryTakeClipboard();
    let isEntryCut = event.type === 'beforecut' && store.getView().mode.kind === 'editing';
    if (
      clipboard.isBrowserAskedForCells() ||
      (isCellsCopyTarget() && !isEntryCut) ||
      isEntryTarget ||
      (event.type === 'beforepaste' ? isPlacedViewFocused() : isPlacedViewFocusedWithoutText())
    )
      event.preventDefault();
  });
  let onPaste = React.useEffectEvent((event: ClipboardEvent) => {
    let isPasteAfterBlur = isBlurDuringEventRef.current && isFocusNowhere();
    let isPasteFromMenu = pasteEventRef.current === event && pasteKeyRef.current?.isByKey() === true;
    pasteEventRef.current = null;
    let isCellsPaste = isCellsCopyTarget() || mayEntryTakeClipboard() || isPasteAfterBlur || isPasteFromMenu;
    let { clipboardData } = event;
    let isWithoutFormatting = pasteKeyRef.current?.isWithoutFormatting() === true;
    let chart = isWithoutFormatting ? null : clipboard.chartAtPasteOf(clipboardData);
    if (!isCellsPaste && (chart === null || !isPlacedViewFocused())) return;
    event.preventDefault();
    if (pasteKeyRef.current?.isHeldDown() === true) return;
    let pasteEvent: PageEvent =
      chart === null
        ? pasteChosenFrom(clipboard, clipboardData, isWithoutFormatting)
        : {
            kind: 'chartPasteChosen',
            chart,
          };
    if (isPasteFromMenu) {
      store.dispatch({
        kind: 'menuClosed',
      });
      return store.dispatch(pasteEvent);
    }
    if (!isCellsPaste || !store.isEventUnfinished()) return store.dispatch(pasteEvent);
    let text = normalizeLineBreaks(clipboardData?.getData('text/plain') ?? '');
    let isCopyPending = store.isCopyOrCutYetToBeMade();
    return afterFocusLeavesTypedAhead(
      () => {
        let { mode: latestMode } = store.getView();
        let lastPutHere = isCopyPending ? clipboard.lastPutHere() : null;
        if (latestMode.kind !== 'editing')
          return store.dispatch(lastPutHere === null ? pasteEvent : pasteChosenFrom(clipboard, lastPutHere, isWithoutFormatting));
        let pastedText = lastPutHere === null ? text : normalizeLineBreaks(lastPutHere.getData('text/plain'));
        let enteredText = isOneLineEditor(latestMode) ? flattenEnteredText(pastedText) : trimTrailingNewlines(pastedText);
        return completeEditText(latestMode, (textBefore) => textBefore + enteredText, true);
      },
      () => true,
    );
  });
  let restoreFieldLeft = (left: FieldLeft) => {
    let ownerDocument = cellsRef.current?.ownerDocument;
    let active = ownerDocument?.activeElement ?? null;
    if (active === null) return;
    let field: Element = active;
    if (left.place === 'sidePane' && active === ownerDocument?.body) {
      let paneInput = sidePaneInputs()[left.indexInPane];
      if (paneInput?.value !== left.text.trim() || paneInput.selectionStart === null) {
        focusPaneStart(sidePaneRef.current, 'lastUsed');
        return;
      }
      field = paneInput;
    }
    let placementId = getSelectedPlacementId();
    if (left.place === 'chart' && active === ownerDocument?.body && placementId !== null)
      field = findPlacedViewAskInput(ownerDocument, placementId) ?? active;
    if (left.place === null || placeOfField(field) !== left.place) return;
    if (!isTextInputOrEntryEditor(field)) return;
    field.focus({
      preventScroll: true,
    });
    if (field.value.trim() === left.text.trim()) field.setSelectionRange(...left.picked);
  };
  let settleFocusLeft = (how: 'windowLeft' | 'timeOrKey' | 'pressOrFocus') => {
    let focusLeft = focusLeftRef.current;
    if (focusLeft === null) return;
    clearTimeout(focusLeft.timer);
    focusLeftRef.current = null;
    if (how === 'windowLeft') return void (fieldLeftForMenuRef.current = focusLeft.left);
    let asItLeft = how === 'timeOrKey' && focusLeft.left.place !== 'sidePane';
    store.dispatch({
      kind: 'focusCameBack',
      asItLeft,
    });
    if (how === 'pressOrFocus') return;
    let wasInEntry = focusLeft.left.place === 'cell' || focusLeft.left.place === 'formulaBar';
    isBlurDuringEventRef.current = wasInEntry && store.isEventUnfinished();
    store.lookOnceEventsAreFinished(() => {
      isBlurDuringEventRef.current = false;
      ReactDOM.flushSync(() => {
        return;
      });
      restoreFieldLeft(focusLeft.left);
      restoreFocus();
    });
  };
  let [dragHoldTracker] = React.useState(() => createDragHoldTracker(store));
  let menuAtBeforeCloseRef = React.useRef<PagePoint | null>(null);
  let onWindowLeft = React.useEffectEvent(() => {
    settleFocusLeft('windowLeft');
    lastFocusedByKeyRef.current = null;
    store.dispatch({
      kind: 'windowCaretChanged',
      hasCaret: false,
    });
    loseFocus(noteFieldLeft(cellsRef.current?.ownerDocument.activeElement ?? null), true);
    store.dispatch({
      kind: 'dropdownEditorActedIn',
      act: {
        kind: 'enter',
        thenStartsOption: false,
      },
    });
    if (!isBlurPending())
      store.dispatch({
        kind: 'menuClosed',
      });
    store.dispatch({
      kind: 'calendarClosed',
    });
    let { isFillHandleHeld, areCellsHeld, placedViewHeldBy } = store.getView().grid;
    if (isFillHandleHeld || areCellsHeld || placedViewHeldBy !== null)
      store.dispatch({
        kind: 'pointerCanceled',
      });
    dragHoldTracker.forget();
  });
  let onWindowBlur = React.useEffectEvent(() => {
    pressesAtWindowBlurRef.current = focusTrackerRef.current?.timesBegun() ?? -1;
    wasTabKeyDownRef.current = false;
    isPointerHeldOutsideRef.current = false;
    scrollGesture.end();
    isEscapeHeldInEditRef.current = false;
    if (likelyHasKeyboard()) clipboard.forgetLastPutHere();
    let ownerDocument = cellsRef.current?.ownerDocument;
    if (ownerDocument !== undefined) whenWindowBlurred(ownerDocument, () => onWindowLeft());
  });
  let restoreFocusOnClick = React.useEffectEvent(() => restoreFocus());
  let { noteCommentChosen, isCaretLeft: isCaretLeftForComment } = useCaretAfterComment(restoreFocus);
  let isModalOpenNow = React.useEffectEvent(() => isModalOpen(store.getView()));
  let onWindowFocus = React.useEffectEvent(() => {
    let ownerDocument = cellsRef.current?.ownerDocument;
    if (ownerDocument !== undefined && ownerDocument.activeElement === ownerDocument.body) wasTabKeyDownRef.current = true;
    store.dispatch({
      kind: 'windowCaretChanged',
      hasCaret: true,
    });
    if (focusLeftRef.current !== null) return;
    let fieldLeft = fieldLeftForMenuRef.current;
    fieldLeftForMenuRef.current = null;
    if (fieldLeft === null || fieldLeft.pressesBefore !== focusTrackerRef.current?.timesBegun())
      return store.dispatch({
        kind: 'focusCameBack',
        asItLeft: false,
      });
    let timer = setTimeout(() => settleFocusLeft('timeOrKey'), FOCUS_COMING_BACK_WAIT_MS);
    focusLeftRef.current = {
      left: fieldLeft,
      timer,
    };
  });
  let isPressOnActiveCellAfterLeave = ({ target, clientX, clientY }: Pick<MouseEvent, 'target' | 'clientX' | 'clientY'>) => {
    let placeLeft = focusLeftRef.current?.left.place;
    let activeCellElementId = store.getView().grid.activeCellElementId;
    if ((placeLeft !== 'cell' && placeLeft !== 'formulaBar') || activeCellElementId === null) return false;
    if (!(target instanceof Node) || cellsRef.current?.contains(target) !== true) return false;
    let activeCellBox = cellsRef.current.ownerDocument.getElementById(activeCellElementId)?.getBoundingClientRect();
    if (activeCellBox === undefined) return false;
    return activeCellBox.left <= clientX && clientX <= activeCellBox.right && activeCellBox.top <= clientY && clientY <= activeCellBox.bottom;
  };
  let awaitFirstKey = (how: 'atFirst' | 'underTypist') => {
    isFirstKeyAwaitedRef.current = how;
    caretAtFirst?.actsHeard.restBeginsNow();
  };
  let awaitKeyUnderTypist = React.useEffectEvent(() => {
    if (!wasPressInAskBoxRef.current || caretAtFirst === undefined) return false;
    awaitFirstKey('underTypist');
    return true;
  });
  let takeCaretAtFirst = () => restoreFocus(offerCaretAtFirst);
  let takeCaretWhenFocused = () => {
    if (cellsRef.current?.ownerDocument.hasFocus() === true) takeCaretAtFirst();
  };
  let offerCaretAtFirst = () => {
    if (cellsRef.current?.ownerDocument.hasFocus() !== true) return;
    if (caretAtFirst === undefined || !caretAtFirst.mayCellsTake()) return;
    if (caretAtFirst.mustCellsWait()) return awaitFirstKey('atFirst');
    let caret = cancelKeyboardOfferRef.current === null && caretAtFirst.doCellsTakeOncePainted() ? getCaretElement() : null;
    if (caret === null) return takeCaretAtFirst();
    isKeyboardOfferedRef.current = true;
    cancelKeyboardOfferRef.current = offerKeyboardWhenReady(caret, takeCaretWhenFocused, {
      onGivenUp: () => {
        isKeyboardOfferedRef.current = false;
      },
    });
  };
  let offerCaretAtFirstEvent = React.useEffectEvent(offerCaretAtFirst);
  let checkWindowFocus = React.useEffectEvent(() => {
    if (
      caretAtFirst?.isKeyboardHandedOver({
        pressesBegun: focusTrackerRef.current?.timesBegun() ?? 0,
        timesFocusLeft: focusTrackerRef.current?.timesFocusLeft() ?? 0,
      }) === true
    )
      offerCaretAtFirst();
    else restoreFocus();
  });
  let forwardKeyToCaret = (event: KeyboardEvent) => {
    if (!isBlurDuringEventRef.current) return false;
    let caret = getCaretElement();
    if (caret === null || event.target !== caret.ownerDocument.body) return false;
    let isComposingKey = event.isComposing || event.keyCode === 229 || event.key === 'Dead';
    if (!event.isTrusted || event.defaultPrevented || isComposingKey || MODIFIER_KEYS.has(event.key)) return false;
    if (!caret.dispatchEvent(redispatchedKeydown(event))) event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  };
  let onWindowKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    if (focusLeftRef.current !== null && event.key === 'Tab') event.preventDefault();
    settleFocusLeft('timeOrKey');
    if (forwardKeyToCaret(event)) return;
    if (isAltCommandPress(normalizedKeyEvent(event), IS_APPLE_PLATFORM)) event.preventDefault();
    let { viewOnlyBecause, mode: latestMode } = store.getView();
    if (viewOnlyBecause !== null || !isFillDownOrRightKey(event, IS_APPLE_PLATFORM)) return;
    event.preventDefault();
    let isSyntheticOnCaret = !event.isTrusted && event.target === getCaretElement();
    if (!event.repeat && (latestMode.kind === 'editing' || !(isCellsCopyTarget() || isSyntheticOnCaret)))
      store.dispatch({
        kind: 'fillKeyPressedOutsideCells',
      });
  });
  let onWindowKeyDownFirst = React.useEffectEvent((event: KeyboardEvent) => {
    if (!event.isTrusted || MODIFIER_KEYS.has(event.key)) return;
    if (event.target !== cellsRef.current?.ownerDocument.body) isFirstKeyAwaitedRef.current = false;
    let isFirstKeyForCells =
      caretAtFirst !== undefined &&
      isFirstKeyAwaitedRef.current !== false &&
      event.key !== 'Escape' &&
      caretAtFirst.actsHeard.hadRestedBeforeLast() &&
      (isFirstKeyAwaitedRef.current === 'underTypist' || caretAtFirst.mayKeyEndWait(event));
    if (isFirstKeyAwaitedRef.current === 'underTypist' && !isFirstKeyForCells && event.key === 'Tab') event.preventDefault();
    let isEscapeWhileEditing = isFirstKeyAwaitedRef.current !== false && event.key === 'Escape' && store.getView().mode.kind === 'editing';
    let isForOpenModal = event.target === cellsRef.current?.ownerDocument.body && isModalOpen(store.getView());
    let isKeyboardOffered = isKeyboardOfferedRef.current && event.target === cellsRef.current?.ownerDocument.body;
    if (isKeyboardOffered && event.repeat) {
      event.preventDefault();
      return event.stopImmediatePropagation();
    }
    if (!isFocusLostUntouchedRef.current && !isFirstKeyForCells && !isForOpenModal && !isEscapeWhileEditing && !isKeyboardOffered) return;
    if (isKeyboardOffered) {
      cancelKeyboardOfferRef.current?.();
      measureGridRef.current?.();
    }
    isFocusLostUntouchedRef.current = false;
    isFirstKeyAwaitedRef.current = false;
    let ownerDocument = cellsRef.current?.ownerDocument;
    if (event.target !== ownerDocument?.body) return;
    let isComposingKey = event.isComposing || event.keyCode === 229 || event.key === 'Dead';
    let mayForward = !event.defaultPrevented && !isComposingKey;
    if (isEscapeWhileEditing) event.preventDefault();
    let forwardTo = (target: Element | null) => {
      if (target === null || target === ownerDocument!.body || !mayForward) return;
      if (!target.dispatchEvent(redispatchedKeydown(event))) event.preventDefault();
      event.stopImmediatePropagation();
    };
    if (isForOpenModal) {
      if (isDialogOwedCaretRef.current) focusLostToNothingRef.current = null;
      isDialogOwedCaretRef.current = false;
      focusOpenModal();
      let isSafeFocus =
        ownerDocument!.activeElement === chooseFileButtonRef.current ||
        ownerDocument!.activeElement?.matches(`[${INITIAL_FOCUS_IS_SAFE_ATTRIBUTE}] [data-initial-focus],${INITIAL_FOCUS_SELECTOR}`) === true;
      if (event.key === 'Tab' && isSafeFocus) return event.preventDefault();
      return forwardTo(ownerDocument!.activeElement);
    }
    if (store.getView().find !== null) {
      findBarRef.current?.focus({
        preventScroll: true,
      });
      return forwardTo(ownerDocument!.activeElement);
    }
    if (isEscapeWhileEditing) {
      forwardTo(getCaretElement());
      ReactDOM.flushSync(() => {
        return;
      });
      return restoreFocus();
    }
    return restoreFocus(undefined, () => {
      forwardTo(getCaretElement());
      ReactDOM.flushSync(() => {
        return;
      });
    });
  });
  React.useEffect(() => {
    let win = cellsRef.current?.ownerDocument.defaultView ?? null;
    if (win === null) return;
    let onBlur = () => onWindowBlur();
    let onFocusMove = ({ type, target, relatedTarget }: FocusEvent) => {
      isDialogOwedCaretRef.current = false;
      if (type === 'focusin') isKeyboardOfferedRef.current = false;
      focusLostToNothingRef.current = type === 'focusout' && relatedTarget === null ? target : null;
      if (focusLostToNothingRef.current !== null) isPointerHeldOutsideRef.current = false;
    };
    let check = () => checkWindowFocus();
    let onClick = () => restoreFocusOnClick();
    let pressTracker = createPressTracker(win);
    focusTrackerRef.current = pressTracker;
    let stopHoldingFocus = holdProgrammaticFocus(
      win,
      () => pageInputHoldBack.isHeldBack() || (!isTrustedPointerDownEvent(win) && mayFocusReturnToCellsEvent()),
      giveUpPopupAround,
    );
    let pasteKeys = createPasteKeyTracker(win);
    pasteKeyRef.current = pasteKeys;
    let focusCheck = createWindowFocusCheck({
      check,
      isDialogOpen: () => isModalOpenNow(),
      isDialogOwedCaret: () => isDialogOwedCaretRef.current,
      timesFocusLeft: pressTracker.timesFocusLeft,
    });
    let onFocus = () => {
      try {
        onWindowFocus();
      } finally {
        pressTracker.afterPress(focusCheck.windowGotFocus);
      }
    };
    let onCopy = (event: ClipboardEvent) => onCopyOrCut(event);
    let onPasteEvent = (event: ClipboardEvent) => onPaste(event);
    let onBeforeClipboardEvent = (event: Event) => onBeforeClipboard(event);
    let onKeyDownEvent = (event: KeyboardEvent) => onWindowKeyDown(event);
    let onKeyDownFirstEvent = (event: KeyboardEvent) => onWindowKeyDownFirst(event);
    let beforeEvents = ['beforecopy', 'beforecut', 'beforepaste'];
    win.addEventListener('blur', onBlur);
    win.addEventListener('focusout', onFocusMove);
    win.addEventListener('focusin', onFocusMove);
    win.addEventListener('focus', onFocus);
    win.addEventListener('click', onClick);
    win.addEventListener('copy', onCopy);
    win.addEventListener('cut', onCopy);
    win.addEventListener('paste', onPasteEvent);
    win.addEventListener('keydown', onKeyDownFirstEvent, true);
    win.addEventListener('keydown', onKeyDownEvent, true);
    for (let type of beforeEvents) win.addEventListener(type, onBeforeClipboardEvent);
    offerCaretAtFirstEvent();
    return () => {
      clearTimeout(focusLeftRef.current?.timer);
      cancelKeyboardOfferRef.current?.();
      cancelKeyboardOfferRef.current = null;
      focusCheck.stop();
      win.removeEventListener('blur', onBlur);
      win.removeEventListener('focusout', onFocusMove);
      win.removeEventListener('focusin', onFocusMove);
      pressTracker.stop();
      stopHoldingFocus();
      pasteKeys.stop();
      win.removeEventListener('focus', onFocus);
      win.removeEventListener('click', onClick);
      win.removeEventListener('copy', onCopy);
      win.removeEventListener('cut', onCopy);
      win.removeEventListener('paste', onPasteEvent);
      win.removeEventListener('keydown', onKeyDownFirstEvent, true);
      win.removeEventListener('keydown', onKeyDownEvent, true);
      for (let type of beforeEvents) win.removeEventListener(type, onBeforeClipboardEvent);
    };
  }, []);
  let askLinkCard = React.useCallback(
    () =>
      store.dispatch({
        kind: 'linkCardAsked',
        at: null,
      }),
    [store],
  );
  let linkOpener = React.useMemo(
    () => ({
      open: (url: string, place: LinkPlace) =>
        place !== 'typed' && store.getView().linksAmongTextOfActiveCell?.urls.includes(url) === true
          ? openLinkFromCard(url, place)
          : openLink(url, place),
      askForCard: askLinkCard,
      isCardHeldBack: isAnyLayerHeldBack,
    }),
    [store, openLink, openLinkFromCard, askLinkCard, isAnyLayerHeldBack],
  );
  let menuKeyEventRef = React.useRef<Event | null>(null);
  let isKeyForLayer = React.useCallback(
    (event: React.KeyboardEvent<Element>, layer: HeldBackLayer | null) =>
      (layer !== null && heldBackLayersRef.current.has(layer)) ||
      (event.key === 'Escape' && heldBackLayersRef.current.size > 0) ||
      event.nativeEvent === menuKeyEventRef.current,
    [],
  );
  let isKeyOfMenu = React.useCallback(
    (event: React.KeyboardEvent<Element>) => isKeyForLayer(event, null) || (event.key === 'Enter' && heldBackLayersRef.current.size > 0),
    [isKeyForLayer],
  );
  let mayKeyActHere = (event: KeyEventFields, act: KeyAct, latestMode: PageMode) => {
    let { formatOfSelection: latestFormatOfSelection, viewOnlyBecause } = store.getView();
    let isActOfModifiedKey =
      act.kind === 'showSheetBeside' ||
      act.kind === 'actOnGroups' ||
      act.kind === 'writeInEntry' ||
      (act.kind === 'actOnLists' && act.key === 'lineBreak');
    if (isAltShortcutKey(event) && !isActOfModifiedKey) return false;
    if (event.ctrlKey && event.altKey && isActLeftToCtrlAlt(normalizedKeyEvent(event).key, act)) return false;
    if (act.kind === 'formatCells' && latestFormatOfSelection === null) return false;
    if (act.kind === 'fill' && viewOnlyBecause !== null) return false;
    if (act.kind === 'askForLinkForm') return !isMacCtrlLetterWhileEditing(event, latestMode) && store.isNextEventHandledAtOnce();
    return !(act.kind === 'formatCells' && isMacCtrlLetterWhileEditing(event, latestMode));
  };
  let typeAheadIntoEntry = (
    event: React.KeyboardEvent<HTMLElement>,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>, isReplayed: boolean) => void,
  ) => {
    if (!store.mayAnEntryOpenOrEnd()) return false;
    let keyEvent = normalizedKeyEvent(event);
    let {
      mode: latestMode,
      openUnderCell,
      escapeInCells,
      isSteppedOutOfCells,
    } = store.getView();
    if (keyEvent.key === 'Tab' && isSteppedOutOfCells) return false;
    if (
      !(
        [[NAVIGATING_MODE, null], ...BLANK_AND_FORMULA_ENTRY_MODES.map((entryMode): [PageMode, null] => [entryMode, null]), [latestMode, openUnderCell]] satisfies [
          PageMode,
          PopupOverEntry | null,
        ][]
      ).some(
        ([modeTried, popupTried]) => {
          let act = keyActOf(modeTried, keyEvent, popupTried, escapeInCells);
          return act !== null && mayKeyActHere(event, act, modeTried);
        },
      ) &&
      !isOpenLinkShortcut(NAVIGATING_MODE, keyEvent)
    )
      return false;
    event.preventDefault();
    let actWhileNavigating = keyActOf(NAVIGATING_MODE, keyEvent, null, 'leaves');
    let shouldReplay =
      (actWhileNavigating?.kind === 'startEditing' && actWhileNavigating.text !== null && actWhileNavigating.text !== ' ') ||
      /^(Arrow(Up|Down|Left|Right)|Escape)$/.test(keyEvent.key);
    afterFocusLeavesTypedAhead(
      () => onKeyDown(event, true),
      (modeNow) => {
        let latestView = store.getView();
        return (
          keyActOf(modeNow, keyEvent, latestView.openUnderCell, latestView.escapeInCells, latestView) === null && entryTextAfterKey(modeNow.text, keyEvent) !== null
        );
      },
      shouldReplay ? () => void getActiveElement()?.dispatchEvent(redispatchedKeydown(event.nativeEvent)) : undefined,
    );
    return true;
  };
  let endWaitForPeopleOnKey = (event: React.KeyboardEvent<Element>, isComposingKey: boolean) => {
    if (isComposingKey) noteInputMethodIfKeyboard();
    if (isComposingKey) store.endWaitForPeople('goOn');
    else if (event.key === 'Escape' && !isKeyForLayer(event, null)) store.endWaitForPeople('callOff');
  };
  let isComposingRef = React.useRef(false);
  let isSpaceHeldRef = React.useRef(false);
  let isShiftHeldRef = React.useRef(false);
  let noteModifierKeys = ({ type, key, code, keyCode, shiftKey }: React.KeyboardEvent<Element>) => {
    if (type === 'keyup' || code !== 'Space') isSpaceHeldRef.current = false;
    if (type === 'keyup' && keyCode === 229) return;
    isShiftHeldRef.current = type === 'keydown' ? shiftKey || key === 'Shift' : shiftKey && key !== 'Shift';
  };
  let placedViewPressRef = React.useRef<SelectionHandle | null>(null);
  let notePlacedViewPress = React.useCallback((sides: SelectionHandle) => {
    placedViewPressRef.current = sides;
  }, []);
  let placementLeftRef = React.useRef<string | null>(null);
  let onPlacedViewCaret = (placementId: string, how: 'come' | 'left', target: CaretOtherEnd) => {
    let caretTarget: CaretGoneTo =
      typeof target === 'string'
        ? target
        : {
            partOf: placementIdOfElement(target),
          };
    if (how === 'left' && doesCaretStayWithPlacement(placementId, caretTarget)) return;
    let isLeftForNothing = target === 'onNothing' && placementIdOfElement(getActiveElement()) !== null;
    if (how === 'left' && !isLeftForNothing) placementLeftRef.current = placementId;
    let isByKey = typeof target !== 'string' && !isPointerPressedLastRef.current;
    let isFromCells = target === cellEditorRef.current || target === gridFocusRef.current;
    let act: PlacedViewAct =
      how === 'come'
        ? {
            kind: 'select',
            isByKey,
            isForAskBox: isPlacedViewAskInput(getActiveElement()),
          }
        : {
            kind: 'leave',
            isForCells: isByKey && isFromCells,
          };
    store.dispatch({
      kind: 'placedViewActedOn',
      placementId,
      act,
    });
  };
  let actOnPlacedView = (placementId: string, act: PlacedViewAct) => {
    store.dispatch({
      kind: 'placedViewActedOn',
      placementId,
      act,
    });
    if (act.kind === 'delete')
      swallowRepeatedDeleteKeys(cellsRef.current?.ownerDocument.defaultView, (then) => store.lookOnceEventsAreFinished(then));
    whenFocusStays(refocusTypingTarget, 'dispatchesNothing');
  };
  let askForPlacedViewMenu = (placementId: string, at: GridPoint | null) => {
    let { placedViews } = store.getView().grid;
    if (placedViews.find((placed) => placed.placementId === placementId)?.canBeChanged !== true) return;
    if (cardUnderChartRef.current?.isChangeUnderWay(placementId) === true) return;
    actOnPlacedView(placementId, {
      kind: 'askForMenu',
      at,
      canAgentChangeIt: cardUnderChartRef.current?.canAgentChange(placementId) === true,
    });
  };
  let leavePlacedViewOnPress = (event: React.MouseEvent<Element>) => {
    let { target, button } = event;
    let placementId = getSelectedPlacementId();
    let isOnBarButton = button === 0 && target instanceof Element && target.closest(`button, [${CONTEXT_BAR_PART_ATTRIBUTE}]`) !== null;
    if (placementId !== null && isOnBarButton)
      actOnPlacedView(placementId, {
        kind: 'leave',
        isForCells: false,
      });
  };
  let placedViewPressedRef = React.useRef<string | null>(null);
  let placedViewPointerRef = React.useRef<PlacedViewPointer | null>(null);
  let tapHoldEndRef = React.useRef<(() => void) | null>(null);
  let placedViewLiftRef = React.useRef<PlacedViewLift | null>(null);
  let fitZoomRef = React.useRef<ZoomFit | null>(null);
  React.useEffect(() => gridZoom.subscribe(() => void (fitZoomRef.current = null)), [gridZoom]);
  let [placedViewTap, setPlacedViewTap] = React.useState<TapOnPlacedView | null>(null);
  let noteCaretAtEnd = () =>
    store.dispatch({
      kind: 'caretAtEndChanged',
      at: caretAtEndRef.current,
    });
  let noteCaretAtEndOnKey = (key: string) => {
    if (!MODIFIER_KEYS.has(key) && !/^(?:F\d+|Page(?:Up|Down)|ContextMenu|Tab)$/.test(key)) noteCaretAtEnd();
  };
  let onAtEndOfSheetKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!isAtEndOfSheetInput(event.target) && isRepeatedEnterOrSpace(event)) return event.preventDefault();
    if (event.key !== 'Escape') noteCaretAtEndOnKey(event.key);
    if (event.key === 'ArrowDown' && event.target === getAddColumnsButton()) {
      event.preventDefault();
      return askColumnCountCard(true);
    }
    let focusMove = focusMoveOfKey(normalizedKeyEvent(event));
    let isArrowKey = !isAtEndOfSheetInput(event.target) && event.key in ARROW_KEY_STEPS;
    if (event.key === 'F6' || isArrowKey || focusMove !== null) event.preventDefault();
    if (focusMove === 'cells') return focusTypingTarget('grid');
    if (focusMove !== null) return void moveCaretTo('endOfSheet', focusMove === 'nextPart' ? 1 : -1);
    if (isArrowKey) return void focusAtEndOfSheetField(event.target, ARROW_KEY_STEPS[event.key] ?? 1);
    if (event.key !== 'Tab') return;
    let step = event.shiftKey ? -1 : 1;
    let hasMoved = focusAtEndOfSheetField(event.target, step);
    if (hasMoved) noteCaretAtEnd();
    let isTypingElsewhere = whereTypingGoes(store.getView()) !== 'grid';
    if (hasMoved || (isTypingElsewhere && moveCaretFromCells(step === -1 ? 'charts' : 'endOfSheet', step))) event.preventDefault();
    return;
  };
  let startsEditing = (event: KeyEventFields) => {
    let latestView = store.getView();
    let { mode: latestMode, openUnderCell, escapeInCells } = latestView;
    let act = keyActOf(latestMode, normalizedKeyEvent(event), openUnderCell, escapeInCells, latestView);
    return act?.kind === 'startEditing' && act.text !== null && act.text !== ' ' && mayKeyActHere(event, act, latestMode);
  };
  let onOffersAtSelectionKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (isRepeatedEnterOrSpace(event)) return event.preventDefault();
    let focusMove = focusMoveOfKey(normalizedKeyEvent(event));
    let step = ARROW_KEY_STEPS[event.key];
    if (event.key === 'F6' || event.key === 'Tab' || step !== undefined || focusMove !== null) event.preventDefault();
    if (focusMove === 'cells' || event.key === 'Tab') return focusTypingTarget('grid');
    if (focusMove !== null) return void moveCaretTo('offersAtSelection', focusMove === 'nextPart' ? 1 : -1);
    if (step !== undefined) focusNeighbourOffer(event.target, step);
    return;
  };
  let onCellsKeyDown = (event: React.KeyboardEvent<HTMLElement>, isReplayed = false) => {
    isComposingRef.current = event.nativeEvent.isComposing || event.keyCode === 229;
    if (!isReplayed) noteModifierKeys(event);
    if (!isReplayed) endWaitForPeopleOnKey(event, isComposingRef.current);
    if (isComposingRef.current && isInAtEndOfSheet(event.target)) noteCaretAtEnd();
    if (isComposingRef.current) return;
    let wereCommentsUp = mouseAroundComments.isUp();
    if (!MODIFIER_KEYS.has(event.key)) mouseAroundComments.putAway();
    if (wereCommentsUp && event.key === 'Escape' && store.getView().escapeInCells !== 'leaves') {
      event.preventDefault();
      return;
    }
    let isInEndOfSheetArea = isInAtEndOfSheet(event.target) && !isAtEndOfSheetInput(event.target);
    let isCommandInAtEnd = isInEndOfSheetArea && isCommandHeld(event);
    let startsEditingFromEnd = isInEndOfSheetArea && !isCommandInAtEnd && (isReplayed || startsEditing(event));
    if (isInAtEndOfSheet(event.target) && !isCommandInAtEnd && !startsEditingFromEnd) return onAtEndOfSheetKeyDown(event);
    if (startsEditingFromEnd && !isReplayed) {
      forgetComeToByTab();
      focusTypingTarget('grid');
    }
    if (isInOffersAtSelection(event.target) && !isCommandHeld(event)) return onOffersAtSelectionKeyDown(event);
    let placementId = placementIdOfElement(event.target);
    if (placementId !== null) {
      let ownerDocument = cellsRef.current?.ownerDocument;
      if (
        ownerDocument !== undefined &&
        !isPlacedViewAskInput(event.target) &&
        cardUnderChartRef.current?.takeKey(placementId, {
          key: event.key,
          isCharacter: isTypingKey(event, IS_APPLE_PLATFORM),
          isOnChartItself: event.target === findPlacedViewCaret(ownerDocument, placementId),
          madeAtMs: event.nativeEvent.timeStamp,
        }) === true
      ) {
        event.preventDefault();
        return;
      }
      let focusMove = focusMoveOfKey(normalizedKeyEvent(event));
      if (event.key === 'F6' && !event.altKey) event.preventDefault();
      if (focusMove === 'nextPart' || focusMove === 'partBefore') {
        store.dispatch({
          kind: 'placedViewActedOn',
          placementId,
          act: {
            kind: 'leave',
            isForCells: focusMove === 'partBefore',
          },
        });
        return whenFocusStays(() => void moveCaretTo('charts', focusMove === 'nextPart' ? 1 : -1));
      }
      if (isPlacedViewAskInput(event.target)) return;
      if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && !isInPlacedViewAskBox(event.target)) {
        event.preventDefault();
        return askForPlacedViewMenu(placementId, null);
      }
      let keyAct = placedViewKeyAct(normalizedKeyEvent(event));
      let actHere = isInPlacedViewControls(event.target) && keyAct?.kind !== 'leave' ? null : keyAct;
      if (actHere === null && !isCommandHeld(event)) return;
      if (actHere !== null) {
        event.preventDefault();
        return actOnPlacedView(placementId, actHere);
      }
    }
    if (!isReplayed && typeAheadIntoEntry(event, onCellsKeyDown)) return;
    if (isKeyForLayer(event, null)) return;
    let isAltEnter = event.key === 'Enter' && event.altKey && !event.metaKey && (IS_APPLE_PLATFORM || !event.ctrlKey);
    let isCommandEnter = event.key === 'Enter' && isCommandHeld(event) && !event.altKey && !event.shiftKey;
    let { openUnderCell, viewOnlyBecause, hasCellsToFill } = store.getView();
    if ((isAltEnter || (isCommandEnter && !hasCellsToFill)) && doesPopupLetLineBreak(openUnderCell, isAltEnter) && viewOnlyBecause === null)
      giveEntryBoxOfItsOwn(store, entryFieldRefs);
    if (event.key === 'Enter' && isCommandHeld(event) && event.shiftKey && !event.altKey && openUnderCell === null && viewOnlyBecause === null)
      giveEntryBoxOfItsOwn(store, entryFieldRefs);
    if (fontMarkOfShortcut(normalizedKeyEvent(event)) !== undefined && viewOnlyBecause === null) giveEntryBoxToFormat(store, entryFieldRefs);
    if (listKindOfShortcut(normalizedKeyEvent(event)) !== undefined && viewOnlyBecause === null) giveEntryBoxOfItsOwn(store, entryFieldRefs);
    let latestView = store.getView();
    let isPlainTabFromCells =
      !isReplayed && placementId === null && isPlainTabWhileNavigating(event, latestView.mode, isNotComeToByTabRef.current);
    if (isPlainTabFromCells && REDISPATCHED_KEYDOWNS.has(event.nativeEvent)) {
      event.preventDefault();
      return markComeToByTab();
    }
    if ((isPlainTabFromCells || (!isReplayed && latestView.isSteppedOutOfCells)) && tabIntoFormulaBar(event, 'cells')) return;
    if (isPlainTabFromCells) {
      ReactDOM.flushSync(
        () =>
          store.dispatch({
            kind: 'tabGoesOnFromCells',
          }),
      );
      return gridFocusRef.current?.focus({
        preventScroll: true,
      });
    }
    let isCtrlAltEnter =
      IS_APPLE_PLATFORM && event.ctrlKey && event.altKey && !event.metaKey && event.key === 'Enter' && latestView.mode.kind === 'editing';
    let keyEvent = {
      ...normalizedKeyEvent(event),
      ...(isCtrlAltEnter && {
        isAltHeld: true,
      }),
      ...caretInEntryPatch(latestView.mode, entryFieldRefs),
    };
    if (placementId === null && openLinkFromKey(event, keyEvent, latestView, linkOpener)) return;
    let { mode: latestMode, openUnderCell: latestOpenUnderCell, escapeInCells, notice: latestNotice } = latestView;
    let allCommandsAction = !isAllCommandsMenuKey(event, IS_APPLE_PLATFORM)
      ? null
      : allCommandsMenuKeyAction({
          isPointerCoarse: isCoarsePointerNow(),
          canPersonEdit: latestView.viewOnlyBecause === null,
          isFromCells: placementId === null && latestMode.kind === 'navigating' && latestOpenUnderCell === null,
          menu: latestView.menu,
          isRepeat: event.repeat,
        });
    if (allCommandsAction !== null) {
      event.preventDefault();
      return allCommandsAction === 'opens'
        ? store.dispatch({
            kind: 'menuAsked',
            at: null,
            isToSearch: true,
          })
        : undefined;
    }
    let act = keyActOf(latestMode, keyEvent, latestOpenUnderCell, escapeInCells, latestView);
    if ((placementId !== null || isCommandInAtEnd || isInOffersAtSelection(event.target)) && act !== null && !isUndoOrFormulasToggle(act)) return;
    let isAltEnterInEntry = latestMode.kind === 'editing' && keyEvent.key === 'Enter' && keyEvent.isAltHeld;
    if (act === null && isAltEnterInEntry) return event.preventDefault();
    if (act === null || !mayKeyActHere(event, act, latestMode)) {
      if (isReplayed && latestMode.kind === 'editing') completeEditText(latestMode, (text) => entryTextAfterKey(text, keyEvent));
      let isModifierHeld = isCommandHeld(event) || (IS_APPLE_PLATFORM && event.ctrlKey);
      let isUnhandled =
        act === null || ((act.kind === 'formatCells' || act.kind === 'askForLinkForm') && isMacCtrlLetterWhileEditing(event, latestMode));
      if (
        isUnhandled &&
        latestMode.kind === 'editing' &&
        movesCaretInEntry({
          ...keyEvent,
          isModifierHeld,
        })
      )
        store.dispatch({
          kind: 'caretPlacedInEntry',
        });
      let isPageKey = /^Page(?:Up|Down)$/.test(keyEvent.key) && !isCommandHeld(event) && !event.altKey;
      let isOneLineEntry =
        latestMode.kind === 'editing' &&
        (latestMode.typingIn === 'formulaBar'
          ? formulaBarLines.lineCountWithCaret === 1
          : !latestMode.text.includes(`
`) && latestView.grid.editorLineCount === 1);
      let { caretInEntry } = keyEvent;
      let isCaretAtEnd = caretInEntry !== undefined && caretInEntry.start === caretInEntry.text.length;
      let isShiftPageDownAtEnd = keyEvent.key === 'PageDown' && keyEvent.isShiftHeld && isCaretAtEnd;
      if (isUnhandled && isPageKey && (isOneLineEntry || isShiftPageDownAtEnd)) event.preventDefault();
      return;
    }
    if (
      act.kind === 'startEditing' &&
      act.text !== null &&
      act.text !== ' ' &&
      !event.repeat &&
      event.target === activeEditorRef.current &&
      event.nativeEvent.isTrusted &&
      !isReplayed
    )
      return;
    event.preventDefault();
    if (latestNotice !== null && doesStepOutLeaveNotice(act, latestNotice, saveCard))
      return event.repeat
        ? undefined
        : store.dispatch({
            kind: 'noticeDismissed',
            notice: latestNotice,
          });
    let opensCell = act.kind === 'openCell' || (act.kind === 'startEditing' && act.text === null);
    let { isFormulaBarReadOnly, isPressOrEnterAComment } = store.getView();
    if (opensCell && isFormulaBarReadOnly && !isPressOrEnterAComment) return event.repeat ? undefined : focusTypingTarget('formulaBar');
    let todayPatch =
      act.kind === 'enterToday' || act.kind === 'showSheetBeside'
        ? {
            today: todayDate(),
          }
        : null;
    let newSheetPatch =
      act.kind === 'addSheet'
        ? {
            newSheetNameStem: defaultSheetName(),
          }
        : null;
    let fixFields = fixFieldsOfKeyPress(
      keyEvent.key,
      {
        cameForKeys: fixKeysCameAt.current,
        hold: latestView.holdsOnAgentsAnswers.fixes,
      },
      eventTimeMs(event),
      isReplayed,
    );
    store.dispatch({
      kind: 'keyPressed',
      ...keyEvent,
      ...todayPatch,
      ...newSheetPatch,
      ...fixFields,
    });
    if (act.kind === 'goOnOutOfGrid' && !event.repeat) whenFocusStays(() => void moveCaretTo('cells', act.by));
    if (act.kind === 'writeInEntry' && !event.repeat) entryBoxes(act);
    if (act.kind === 'askForLinkForm' && !event.repeat) askLinkForm();
    return;
  };
  let clicksSinceCaretMovedRef = React.useRef(2);
  let lastProgrammaticActMsRef = React.useRef(Number.NEGATIVE_INFINITY);
  let isContextBarMenuByKeyRef = React.useRef(false);
  let isChartMenuRef = React.useRef(false);
  let lastKeyDownRef = React.useRef<KeyboardEvent | null>(null);
  let didFocusLeaveByTabNow = (relatedTarget: EventTarget | null) =>
    didFocusLeaveByTab(relatedTarget, lastKeyDownRef.current, isPointerPressedLastRef.current);
  let wasFocusLostToNothingRef = React.useRef(false);
  let pressPointRef = React.useRef<GridPoint | null>(null);
  let edgeStretch = useOverscrollBounce(zoomedGridRef, gridZoom.now, IS_APPLE_PLATFORM);
  let speedAtLetGoRef = React.useRef({
    x: 0,
    y: 0,
  });
  let edgeStretchPressProps = {
    onPointerDownCapture: () => void edgeStretch.letGo(),
    onPointerUpCapture: ({ pointerType }: React.PointerEvent<Element>) => {
      if (pointerType === 'touch') speedAtLetGoRef.current = edgeStretch.letGo();
    },
    onPointerCancelCapture: () => void edgeStretch.letGo(),
    onLostPointerCaptureCapture: () => void edgeStretch.letGo(),
  };
  let scrollPastEdges = React.useCallback((delta: GridPoint) => overscrollOf(store.getView().grid.scroll, delta), [store]);
  let bumpAtStandstill = React.useCallback(
    (speed: GridPoint) => {
      let pastEdges = scrollPastEdges(speed);
      edgeStretch.bumpedAt({
        x: pastEdges.x === 0 ? 0 : speed.x,
        y: pastEdges.y === 0 ? 0 : speed.y,
      });
    },
    [edgeStretch, scrollPastEdges],
  );
  let fingerFling = useFingerFling({
    store,
    grid: cellsRef,
    gridZoom,
    isOnApple: IS_APPLE_PLATFORM,
    atStandstill: bumpAtStandstill,
  });
  let stopOnFingerDown = React.useCallback(() => fingerFling.stop() || edgeStretch.isOnWayBack(), [fingerFling, edgeStretch]);
  let captureSwipe = React.useCallback((pointerId: number) => {
    try {
      cellsRef.current?.setPointerCapture(pointerId);
    } catch {}
  }, []);
  let pullByFinger = (delta: GridPoint) => {
    let zoomNow = gridZoom.now();
    let eased = edgeStretch.easedBy({
      x: delta.x * zoomNow,
      y: delta.y * zoomNow,
    });
    let wheelDelta = {
      x: eased.x / zoomNow,
      y: eased.y / zoomNow,
    };
    let pastEdges = scrollPastEdges(wheelDelta);
    edgeStretch.pulledBy(
      {
        x: pastEdges.x * zoomNow,
        y: pastEdges.y * zoomNow,
      },
      delta,
    );
    store.dispatch({
      kind: 'wheelTurned',
      deltaX: wheelDelta.x,
      deltaY: wheelDelta.y,
      isByFinger: true,
    });
  };
  let pinchZoom = usePinchZoom({
    store,
    grid: cellsRef,
    gridZoom,
  });
  let isClickToSwallowRef = React.useRef(false);
  let lastPointerRef = React.useRef({
    at: {
      x: 0,
      y: 0,
    },
    atMs: 0,
  });
  let pressPointerIdRef = React.useRef<number | null>(null);
  let [fingerPresses] = React.useState(createFingerPressTracker);
  let [chartTaps] = React.useState(createChartTapTracker);
  let [fingerTapCaret] = React.useState(createFingerTapCaret);
  let dragStartMsRef = React.useRef<number | null>(null);
  let hasPointerMovedRef = React.useRef(false);
  let askLinkCardAtPointer = React.useCallback<LinkCardAskedAtPointer>(
    (cell, event) => {
      let cells = cellsRef.current;
      if (cells === null) return;
      let zoomNow = gridZoom.now();
      let link = cellTextUnderPointer(cell, cells, zoomNow, store.getView().grid.scroll, event);
      if (link !== null)
        store.dispatch({
          kind: 'linkCardAsked',
          at: pointInZoomedElement(cells, zoomNow, event),
          link,
        });
    },
    [store, gridZoom],
  );
  let linkPress = useLinkPressHandler(openLink, linkCardSeen, askLinkCardAtPointer);
  let lineBoxPresses = React.useMemo(
    () =>
      createLineBoxPresses(
        (paragraph) =>
          store.dispatch({
            kind: 'boxOfLinePressedInCell',
            paragraph,
          }),
      ),
    [store],
  );
  let opensNoLink = React.useCallback(() => {
    let { mode: latestMode, isCommentModeOn } = store.getView();
    return latestMode.kind === 'editing' || isCommentModeOn;
  }, [store]);
  useLinkPressCursor({
    gridRef: cellsRef,
    card: linkCardSeen,
    opensNone: opensNoLink,
  });
  let [isPointerHeldInCells, setIsPointerHeldInCells] = React.useState(false);
  let heldPointerIdRef = React.useRef<number | null>(null);
  let isPointerKeptRef = React.useRef(true);
  let isPressForMenuRef = React.useRef(false);
  let wasLastPressByMouseRef = React.useRef(false);
  let wasPressOnOfferRef = React.useRef(false);
  let isMouseDownHandledRef = React.useRef(false);
  let isRestOfPressSwallowedRef = React.useRef(false);
  let tapsRef = React.useRef(NO_TAPS);
  let actsCountRef = React.useRef(0);
  let actsAtLastPressRef = React.useRef({
    act: 0,
    timesFocusLeft: 0,
  });
  let updateTaps = (update: (taps: Taps) => Taps) => {
    let apply = () => {
      tapsRef.current = update(tapsRef.current);
    };
    if (store.mayAnEntryOpenOrEnd()) store.onceEventsAreFinished(apply);
    else apply();
  };
  let isGridHeld = () => {
    let {
      edgeHeldOf,
      isFillHandleHeld,
      isFingerSelecting,
      areCellsHeld,
      freezeBarHeld,
      placedViewHeldBy,
    } = store.getView().grid;
    return edgeHeldOf !== null || isFillHandleHeld || isFingerSelecting || areCellsHeld || freezeBarHeld !== null || placedViewHeldBy !== null;
  };
  let isOtherPointerWhileHeld = ({ pointerId }: Pick<PointerEvent, 'pointerId'>) => isGridHeld() && pointerId !== heldPointerIdRef.current;
  let firstFingerIdRef = React.useRef<number | null>(null);
  let secondFingerIdRef = React.useRef<number | null>(null);
  let isSecondFinger = ({ pointerType, pointerId }: Pick<PointerEvent, 'pointerType' | 'pointerId'>) =>
    pointerType === 'touch' && firstFingerIdRef.current !== null && pointerId !== firstFingerIdRef.current;
  let beginPinch = (element: Element, finger: Finger, atMs: number) => {
    if (finger.pointerId === secondFingerIdRef.current) secondFingerIdRef.current = null;
    try {
      element.setPointerCapture(finger.pointerId);
    } catch {
      return pinchZoom.forget();
    }
    firstFingerIdRef.current = finger.pointerId;
    pinchZoom.firstCameDown(finger);
    pressPointRef.current = pointInZoomedElement(element, gridZoom.now(), finger);
    hasPointerMovedRef.current = true;
    fingerFling.stop();
    fingerFling.fingerMovedTo(finger, atMs);
  };
  let tapHoldTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  let pressTargetRef = React.useRef<Element | null>(null);
  let returnFocusAfterPressMenu = () =>
    store.onceEventsAreFinished(() => {
      if (store.getView().menu === null) return;
      tapsRef.current = NO_TAPS;
      if (pressTargetRef.current !== null) armCellMenuTouchGuard(pressTargetRef.current);
      pressPointRef.current = null;
    });
  let [isFilterCleared, setIsFilterCleared] = React.useState(false);
  let dispatchToOwnFilterList = React.useCallback(
    (event: PageEvent) => {
      let hadOwnFilterBar = store.getView().ownFilterBar !== null;
      store.dispatch(event);
      store.lookOnceEventsAreFinished(() => setIsFilterCleared(hadOwnFilterBar && store.getView().ownFilterBar === null));
    },
    [store],
  );
  let lastPressMsRef = React.useRef(0);
  let beforeAnswerSeenPatch = (): { hasBegunBeforeAnswerWasSeen?: true } => {
    let pressMs = eventTimeMs({
      timeStamp: lastPressMsRef.current,
    });
    return isBeforeAnswerSeen(store.getView().holdsOnAgentsAnswers.rowsAskedFor, pressMs)
      ? {
          hasBegunBeforeAnswerWasSeen: true,
        }
      : {};
  };
  let dispatchPointerEvent = (event: PageEvent) =>
    store.getView().ownFilterList === null ? store.dispatch(event) : dispatchToOwnFilterList(event);
  let startTapHoldMenu = (at: GridPoint, isOnBoxOfEntry: boolean, win: Document['defaultView']) => {
    if (win?.CSS.supports('-webkit-touch-callout', 'none') !== true) return;
    tapHoldTimerRef.current = setTimeout(() => {
      if (!isTapOnGrid(at, store.getView().grid)) return;
      dispatchPointerEvent({
        kind: 'menuAsked',
        at,
        ...(isOnBoxOfEntry && {
          isOnBoxOfEntry,
        }),
        ...beforeAnswerSeenPatch(),
      });
      whenFocusStays(refocusTypingTarget, 'dispatchesNothing');
      returnFocusAfterPressMenu();
    }, TAP_HOLD_LIMIT_MS);
  };
  React.useEffect(() => () => clearTimeout(tapHoldTimerRef.current), [tapHoldTimerRef]);
  let isFillHandleJustTouched = () => {
    let dragStartMs = dragStartMsRef.current;
    return (
      store.getView().grid.isFillHandleOnlyTouched && dragStartMs !== null && dragStartMs - lastPointerRef.current.atMs < FILL_HANDLE_TOUCH_WINDOW_MS
    );
  };
  let isCellEditorTarget = (target: EventTarget | null) => entryEditorOf(target) === activeEditorRef.current;
  let isPressInEntryBox = ({ target }: Pick<Event, 'target'>) =>
    isCellEditorTarget(target) && store.getView().mode.kind === 'editing' && store.mayAnEntryOpenOrEnd();
  let isRefocusingAfterPressRef = React.useRef(false);
  let refocusAfterPress = (when: 'atPress' | 'atLift', placementId: string | null) => {
    if (store.isEventUnfinished() && !isFocusInCells()) {
      if (when === 'atLift')
        ReactDOM.flushSync(() => {
          return;
        });
      getCaretElement(placementId)?.focus({
        preventScroll: true,
      });
    }
    whenFocusStays(() => {
      isRefocusingAfterPressRef.current = true;
      try {
        if (when === 'atLift' || cellsRef.current?.contains(getActiveElement()) !== true)
          ReactDOM.flushSync(() => {
            return;
          });
        refocusTypingTarget();
      } finally {
        isRefocusingAfterPressRef.current = false;
      }
    }, 'dispatchesNothing');
  };
  let pointInPlacedView = (
    { currentTarget, clientX, clientY }: Pick<React.MouseEvent<Element>, 'currentTarget' | 'clientX' | 'clientY'>,
    placementId: string,
  ) => {
    let placedRect = getPlacedViewRect(currentTarget.ownerDocument, placementId);
    return placedRect === null
      ? null
      : {
          x: (clientX - placedRect.left) / zoom,
          y: (clientY - placedRect.top) / zoom,
        };
  };
  let onGridPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    lastPressMsRef.current = event.timeStamp;
    if (event.pointerType === 'touch' && event.isPrimary) {
      firstFingerIdRef.current = null;
      secondFingerIdRef.current = null;
      pinchZoom.forget();
      if (isPressForMenuRef.current && isGridHeld())
        store.dispatch({
          kind: 'pointerCanceled',
        });
    }
    let onlyFinger = firstFingerIdRef.current === null ? pinchZoom.onlyFingerDown() : null;
    if (event.pointerType === 'touch' && onlyFinger !== null) beginPinch(event.currentTarget, onlyFinger, event.timeStamp);
    clearTimeout(tapHoldTimerRef.current);
    tapHoldEndRef.current = null;
    let hasFlingStopped = !isSecondFinger(event) && fingerFling.stop();
    let isStretchOnWayBack = edgeStretch.isOnWayBack();
    let isFlingStopped = (hasFlingStopped || isStretchOnWayBack) && event.pointerType === 'touch';
    isClickToSwallowRef.current = isFlingStopped || isStretchOnWayBack;
    if (isStretchOnWayBack && !isFlingStopped) return;
    wasColumnCountCardOpenRef.current = isColumnCountCardOpen;
    isShiftHeldRef.current = event.shiftKey;
    isSpaceHeldRef.current = false;
    if (event.pointerType === 'mouse') linkCardHover.isPressed();
    let isOnCommentCorner = commentCornerKeyAtTarget(event) !== null;
    let isPlainMousePress =
      event.pointerType === 'mouse' && event.button === 0 && !(event.ctrlKey || event.shiftKey || event.metaKey || event.altKey);
    let isOnControl =
      tableKeyOfHandleAt(event.target) !== undefined ||
      isInPlacedViewControls(event.target) ||
      isAtEndOfSheetInput(event.target) ||
      isOnWordsOfferedButton(event.target) ||
      isInExpandedEntry(event.target) ||
      isInAtEndOfSheet(event.target) ||
      isInOffersAtSelection(event.target) ||
      isOnSkipTarget(event);
    putAwayCommentsRef.current = null;
    if (isPlainMousePress && !isOnCommentCorner && !isOnControl)
      mouseAroundComments.isPressedOnCells({
        x: event.clientX,
        y: event.clientY,
      });
    else if (event.button !== 0 || event.ctrlKey || !isOnCommentCorner) putAwayCommentsRef.current = mouseAroundComments.putAway();
    setIsLinkCardPressedAway(event.pointerType === 'mouse');
    pressPointerIdRef.current = null;
    chartTaps.forget();
    fingerTapCaret.forget();
    setPlacedViewTap(null);
    let actsNow = {
      act: actsCountRef.current,
      timesFocusLeft: focusTrackerRef.current?.timesFocusLeft() ?? 0,
    };
    let { act: actBefore, timesFocusLeft: timesFocusLeftBefore } = actsAtLastPressRef.current;
    let hasPersonActedSinceLast = actsNow.act !== actBefore + 1 || actsNow.timesFocusLeft !== timesFocusLeftBefore;
    actsAtLastPressRef.current = actsNow;
    let tapsAtPress = tapsRef.current;
    let isSoonAfterTap = event.pointerType === 'touch' && isSoonAfterCellTap(tapsAtPress, event.timeStamp);
    let tapsBefore = NO_TAPS;
    updateTaps((taps) => ((tapsBefore = taps), tapsAfterPress(taps, null)));
    let placedViewPress = placedViewPressRef.current;
    placedViewPressRef.current = null;
    let placementOfCardOrTools = isInPlacedViewCardOrTools(event.target) ? placementIdOfElement(event.target) : null;
    if (event.button === 0 && placementOfCardOrTools !== null && placementOfCardOrTools !== getSelectedPlacementId()) {
      let select: PlacedViewAct = {
        kind: 'select',
        isByKey: false,
      };
      store.dispatch({
        kind: 'placedViewActedOn',
        placementId: placementOfCardOrTools,
        act: select,
      });
      refocusAfterPress('atPress', placementOfCardOrTools);
    }
    if (isInPlacedViewControls(event.target) || isAtEndOfSheetInput(event.target)) return;
    if (isOnWordsOfferedButton(event.target) || isInExpandedEntry(event.target)) return;
    let placementId = placementIdOfElement(event.target);
    let selectedPlacementIdNow = getSelectedPlacementId();
    let isOnSelectedPlacement = placementId !== null && placementId === selectedPlacementIdNow;
    let isPlacementCaretElsewhere =
      !event.currentTarget.ownerDocument.hasFocus() || placementIdOfElement(getActiveElement()) !== selectedPlacementIdNow;
    if (selectedPlacementIdNow !== null && !isOnSelectedPlacement && isPlacementCaretElsewhere)
      store.dispatch({
        kind: 'placedViewActedOn',
        placementId: selectedPlacementIdNow,
        act: {
          kind: 'leave',
          isForCells: false,
        },
      });
    let isInEntryBox = isPressInEntryBox(event);
    let isInCellEditor = isCellEditorTarget(event.target) && store.getView().mode.kind === 'editing' && !isInEntryBox;
    let isMiddleButton = event.button === 1;
    let isPrimaryButton = event.button === 0 && !isContextMenuClick(event);
    isMouseDownHandledRef.current = false;
    isRestOfPressSwallowedRef.current = isInCellEditor && isSoonAfterTap;
    if (isRestOfPressSwallowedRef.current) {
      let { pointerId, timeStamp } = event;
      let taps = tapsPressedOnLastTap(tapsAtPress, {
        pointerId,
        atMs: timeStamp,
        at: pointInGrid(event),
      });
      return updateTaps(() => taps);
    }
    if (isInCellEditor)
      store.dispatch({
        kind: 'caretPlacedInEntry',
      });
    let isPrimaryFinger = event.pointerType === 'touch' && event.isPrimary && !isFlingStopped;
    if (isInCellEditor && isPrimaryFinger && activeEditorRef.current !== null)
      fingerTapCaret.fingerCameDownIn(activeEditorRef.current, event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    if (isInCellEditor && isPrimaryButton && event.pointerType !== 'touch' && activeEditorRef.current !== null)
      forgetCaretPlacement(activeEditorRef.current, store.getView().mode);
    if (!(isMiddleButton || isPrimaryButton) || isInCellEditor) return;
    if (!isInEntryBox && event.pointerType === 'touch') isMouseDownHandledRef.current = true;
    else if (!isInEntryBox) event.preventDefault();
    if (Math.abs(event.timeStamp - lastProgrammaticActMsRef.current) <= POINTER_DOWN_REPEAT_MS) return;
    let { isTapYetToBeTold, isFingerSelecting } = store.getView().grid;
    if (isSecondFinger(event) && (!isGridHeld() || isTapYetToBeTold)) {
      store.dispatch({
        kind: 'pointerCanceled',
      });
      if (isFingerSelecting) pressPointRef.current = dragHoldTracker.lastAt() ?? lastPointerRef.current.at;
    }
    if (isSecondFinger(event)) {
      secondFingerIdRef.current = event.pointerId;
      let canPinch = pressPointRef.current !== null && !isGridHeld();
      if (pinchZoom.secondCameDown(event, canPinch)) {
        event.currentTarget.setPointerCapture(event.pointerId);
        hasPointerMovedRef.current = true;
        fingerFling.stop();
      }
    }
    if (isOtherPointerWhileHeld(event) || isSecondFinger(event)) return;
    if (isGridHeld())
      store.dispatch({
        kind: 'pointerCanceled',
      });
    let isEditing = store.getView().mode.kind === 'editing';
    let linkPressResult = isFlingStopped ? 'isForCells' : linkPress.pressed(event, isEditing);
    let { doesCommentModePickCells, viewOnlyBecause } = store.getView();
    let isLineBoxPress = lineBoxPresses.pressed(event, isEditing || isFlingStopped || doesCommentModePickCells || viewOnlyBecause !== null);
    let showsLinkCard = linkPressResult === 'showsCardFirst' && store.getView().canLinkCardCome && !isAnyLayerHeldBack;
    let linkAmongText = event.target instanceof Element ? event.target.closest(`[${LINK_AMONG_TEXT_ATTR}]`) : null;
    if (showsLinkCard && linkAmongText !== null) askLinkCardAtPointer(linkAmongText, event);
    else if (showsLinkCard)
      store.dispatch({
        kind: 'linkCardAsked',
        at: pointInGrid(event),
      });
    let isLinkPress = linkPressResult === 'opensLink' || showsLinkCard;
    let isOnSheetEndOrOffers = isInAtEndOfSheet(event.target) || isInOffersAtSelection(event.target);
    if (isLinkPress || isOnSkipTarget(event) || isOnSheetEndOrOffers) clicksSinceCaretMovedRef.current = 0;
    if (isLinkPress) hasPointerMovedRef.current = false;
    if (
      (isOnSkipTarget(event) || isOnSheetEndOrOffers || isLinkPress || commentCornerKeyAtTarget(event) !== null) &&
      !isMiddleButton &&
      !isFlingStopped
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') {
      firstFingerIdRef.current = event.pointerId;
      pinchZoom.firstCameDown(event);
      fingerFling.fingerMovedTo(event, event.timeStamp);
    }
    if (isMiddleButton || isFlingStopped) {
      pressPointRef.current = pointInGrid(event);
      hasPointerMovedRef.current = isFlingStopped;
      if (isStretchOnWayBack && isFlingStopped) edgeStretch.heldAgain();
      return setIsPointerHeldInCells(isMiddleButton);
    }
    clicksSinceCaretMovedRef.current = isLineBoxPress ? 0 : clicksSinceCaretMovedRef.current + 1;
    let isByFinger = event.pointerType === 'touch';
    isPressForMenuRef.current = isByFinger;
    wasLastPressByMouseRef.current = event.pointerType === 'mouse';
    let at = pointInGrid(event);
    let { pointerId, timeStamp } = event;
    pressPointRef.current = isByFinger ? at : null;
    dragHoldTracker.forget();
    lastPointerRef.current = {
      at,
      atMs: timeStamp,
    };
    isPointerKeptRef.current = false;
    dragStartMsRef.current = null;
    hasPointerMovedRef.current = false;
    pressPointerIdRef.current = pointerId;
    pressTargetRef.current = isByFinger && event.target instanceof Element ? event.target : null;
    if (isByFinger && placementId === null) startTapHoldMenu(at, isInEntryBox, event.currentTarget.ownerDocument.defaultView);
    let isPhoneFingerOnPlacement = isByFinger && placedViewPress === null && isOnPhone();
    placedViewPressedRef.current = isByFinger && (!isOnSelectedPlacement || isPhoneFingerOnPlacement) ? placementId : null;
    placedViewPointerRef.current =
      isByFinger && placementId !== null
        ? {
            pointerId,
            placementId,
          }
        : null;
    let pointInPlacement = placementId === null ? null : pointInPlacedView(event, placementId);
    chartTaps.cameDown(
      event,
      placementId !== null && pointInPlacement !== null && placedViewPress === null && !isEditing
        ? {
            placementId,
            at: pointInPlacement,
          }
        : null,
      store.getView().grid.placedViews,
    );
    let gripOfColumn = cellOfGripPressed(event.target, store.getView().grid);
    if (event.pointerType === 'mouse') errorCardHover.mouseIsPressed();
    let tableHandleKey = tableKeyOfHandleAt(event.target);
    wasPressOnOfferRef.current = tableHandleKey !== undefined;
    if (event.pointerType === 'mouse') tableHandleCall.pointerMovedTo(event);
    if (placementId === null)
      dispatchPointerEvent({
        kind: 'pointerPressed',
        ...at,
        isShiftHeld: event.shiftKey,
        isModifierHeld: event.metaKey || event.ctrlKey,
        isByFinger,
        ...(event.pointerType === 'mouse' && {
          isByMouse: true,
        }),
        ...(isInEntryBox && {
          isOnBoxOfEntry: isInEntryBox,
        }),
        ...(tableHandleKey !== undefined && {
          onHandleOfTable: tableHandleKey,
        }),
        ...(gripOfColumn !== undefined && {
          onGripOfColumn: gripOfColumn,
        }),
        ...beforeAnswerSeenPatch(),
        ...caretInEntryPatch(store.getView().mode, entryFieldRefs),
      });
    let takeHoldOfPlacement = (heldPlacementId: string) => {
      loseFocus(false);
      store.dispatch({
        kind: 'placedViewActedOn',
        placementId: heldPlacementId,
        act: {
          kind: 'takeHold',
          at,
          sides: placedViewPress,
          isByFinger,
        },
      });
    };
    if (placementId !== null && placedViewPressedRef.current === null) takeHoldOfPlacement(placementId);
    if (!isByFinger || placementId === null) placedViewLiftRef.current = null;
    if (placementId !== null && isPhoneFingerOnPlacement && !isViewOnly) {
      let ownerDocument = event.currentTarget.ownerDocument;
      let { clientX, clientY } = event;
      let holdPlacement = () => {
        tapHoldEndRef.current = null;
        if (
          !(
            placedViewPressedRef.current === placementId &&
            dragStartMsRef.current === null &&
            pinchZoom.onlyFingerDown()?.pointerId === pointerId &&
            placementIdOfElement(ownerDocument.elementFromPoint(clientX, clientY)) === placementId
          )
        )
          return;
        chartTaps.forget();
        takeHoldOfPlacement(placementId);
        store.onceEventsAreFinished(() => {
          let isSamePress = lastPointerRef.current.atMs === timeStamp && placedViewPointerRef.current?.pointerId === pointerId;
          let isHeld = store
            .getView()
            .grid.placedViews.some((placed) => placed.placementId === placementId && placed.isHeld);
          if (!isSamePress && isHeld)
            store.dispatch({
              kind: 'pointerCanceled',
            });
          if (!isSamePress || !isHeld) return;
          placedViewPressedRef.current = null;
          pressPointRef.current = null;
          heldPointerIdRef.current = pointerId;
          findPlacedViewCaret(ownerDocument, placementId)?.focus({
            preventScroll: true,
          });
        });
      };
      tapHoldEndRef.current = holdPlacement;
      if (ownerDocument.defaultView?.CSS.supports('-webkit-touch-callout', 'none') === true)
        tapHoldTimerRef.current = setTimeout(() => {
          if (tapHoldEndRef.current === holdPlacement) holdPlacement();
        }, TAP_HOLD_LIMIT_MS);
    }
    if (isInEntryBox)
      store.onceEventsAreFinished(() => {
        if (store.getView().mode.kind === 'editing') moveEntryToUnlessThere('cell');
      });
    store.onceEventsAreFinished(() => {
      let isFingerDragSelecting =
        lastPointerRef.current.atMs === timeStamp && hasPointerMovedRef.current && store.getView().grid.isFingerSelecting;
      if (isFillHandleJustTouched() || isFingerDragSelecting)
        store.dispatch({
          kind: 'pointerCanceled',
        });
      let isHeld = isGridHeld();
      if (isHeld) heldPointerIdRef.current = pointerId;
      if (isHeld) pressPointRef.current = null;
      let tap = tapOnGrid(at, store.getView().grid);
      if (isByFinger && tap !== null && placementId === null)
        tapsRef.current = tapsAfterPress(tapsBefore, {
          pointerId,
          atMs: timeStamp,
          at,
          on: tap.on,
          hasPersonActedSinceLast,
        });
    });
    let isOnChart = placementId !== null;
    if (
      !fingerPresses.notePress({
        pointerId,
        isByFinger,
        isOnChart,
        hadCaret: getActiveElement(),
      })
    )
      return;
    refocusAfterPress('atPress', placedViewPressedRef.current === null ? placementId : null);
  };
  let onGridMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    let isHandled = isMouseDownHandledRef.current;
    isMouseDownHandledRef.current = false;
    if (isPickerField(event.target)) return;
    let isEditing = store.getView().mode.kind === 'editing';
    let gridOrEditor = getGridOrEditorElement();
    let keepsFocus = isEditing
      ? !isCellEditorTarget(event.target)
      : gridOrEditor !== null && gridOrEditor === gridOrEditor.ownerDocument.activeElement;
    let isOnPlacement = placementIdOfElement(event.target) !== null;
    let isOnSheetEndOrOffers = isInAtEndOfSheet(event.target) || isInOffersAtSelection(event.target) || isInExpandedEntry(event.target);
    if (isHandled || keepsFocus || isOnPlacement || isOnSheetEndOrOffers) event.preventDefault();
  };
  let askLinesAtEnd = (what: 'rows' | 'columns', count: number) => {
    let { rowCount, columnCount } = store.getView().grid;
    let countSeen = what === 'rows' ? rowCount : columnCount;
    if (isAtEndOfSheetInput(getActiveElement())) {
      if (what === 'rows') noteCaretAtEnd();
      setCaretAtEnd(null);
      focusTypingTarget('grid');
      forgetComeToByTab();
    }
    store.dispatch({
      kind: 'linesAtEndAsked',
      what,
      count,
      countSeen,
    });
  };
  let caretAtEndRef = React.useRef<CaretAtEnd | null>(null);
  let setCaretAtEnd = (at: CaretAtEnd | null, nextFocus: Element | null = null) => {
    if (at === caretAtEndRef.current || (at === null && isColumnCountCardOpen)) return;
    let isLeaving = at === null && caretAtEndRef.current !== null;
    caretAtEndRef.current = at;
    store.dispatch({
      kind: 'caretAtEndChanged',
      at,
    });
    if (
      isLeaving &&
      nextFocus !== null &&
      !isPointerPressedLastRef.current &&
      (nextFocus === cellEditorRef.current || nextFocus === gridFocusRef.current)
    )
      store.dispatch({
        kind: 'endOfSheetLeftByKey',
      });
    if (at !== null) loseFocus(false);
  };
  let syncCaretAtEndWithCard = React.useEffectEvent((isCardOpen: boolean) => {
    if (isCardOpen) setCaretAtEnd('columns');
    else if (!isInAtEndOfSheet(getActiveElement())) setCaretAtEnd(null);
  });
  React.useEffect(() => syncCaretAtEndWithCard(isColumnCountCardOpen), [isColumnCountCardOpen]);
  let askColumnCountCard = (isByKey: boolean) => setIsColumnCountCardOpen(isByKey || !wasColumnCountCardOpenRef.current);
  let getAddColumnsButton = () => cellsRef.current?.querySelector<HTMLElement>(`#${ADD_MORE_COLUMNS_BUTTON_ID}`) ?? null;
  let askFigures = () => {
    let { body, selectionSummary } = store.getView().grid;
    if (selectionSummary === null) return;
    let { center, top, height } = selectionSummary;
    store.dispatch({
      kind: 'figuresAsked',
      at: {
        x: body.left + center,
        y: body.top + top,
      },
      height,
    });
  };
  let onGridContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    let isOnBoxOfEntry = isPressInEntryBox(event);
    let isEditing = store.getView().mode.kind === 'editing';
    if (isCellEditorTarget(event.target) && isEditing && !isOnBoxOfEntry) return;
    if (isPickerField(event.target)) return;
    event.preventDefault();
    clearTimeout(tapHoldTimerRef.current);
    let placementId = placementIdOfElement(event.target);
    if (placementId !== null && isTouchOrPenPointer(event)) return tapHoldEndRef.current?.();
    if (placementId !== null && isInPlacedViewAskBox(event.target)) return;
    if (placementId !== null) return askForPlacedViewMenu(placementId, opensMenuAtPointer(event) ? pointInGrid(event) : null);
    let summary = store.getView().grid.selectionSummary?.summary ?? null;
    if (isOnSkipTarget(event) && isSumWithFormulaCell(summary)) return askFigures();
    if (isInAtEndOfSheet(event.target) || isInOffersAtSelection(event.target)) return;
    if (isOnWordsOfferedButton(event.target) || isInExpandedEntry(event.target)) return;
    if (tableKeyOfHandleAt(event.target) !== undefined && !isAtTableHandleOverRowNumber(event.target)) return;
    let { grid: latestGrid } = store.getView();
    let isFillHandleTap = latestGrid.isFillHandleOnlyTouched && tapOnGrid(lastPointerRef.current.at, latestGrid) !== null;
    if (isGridHeld() && !isFillHandleTap && !latestGrid.isTapYetToBeTold && !isContextMenuClick(event)) return;
    let isByMouse = isContextMenuClick(event) && !isTouchOrPenPointer(event);
    if (isByMouse) errorCardHover.mouseIsPressed();
    dispatchPointerEvent({
      kind: 'menuAsked',
      at: opensMenuAtPointer(event) ? pointInGrid(event) : null,
      ...(isByMouse && {
        isByMouse,
      }),
      ...(isOnBoxOfEntry && {
        isOnBoxOfEntry,
      }),
      ...beforeAnswerSeenPatch(),
    });
    whenFocusStays(refocusTypingTarget, 'dispatchesNothing');
    if (isPressForMenuRef.current && pressPointerIdRef.current !== null) returnFocusAfterPressMenu();
  };
  let onGridPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    nameFlagsAtPointer.pointerMovedTo(event.pointerType === 'touch' ? null : event);
    filterButtonPointedAt.pointerMovedTo(event.pointerType === 'touch' ? null : event);
    tableHandleCall.pointerMovedTo(event.pointerType === 'touch' ? null : event);
    columnHeadingsCall.pointerMovedTo(event.pointerType === 'touch' ? null : event);
    let pinch = event.pointerType === 'touch' ? pinchZoom.fingerMovedTo(event, event.timeStamp) : 'isOfNoPinch';
    if (pinch === 'isOfPinch') return;
    if (
      (event.pointerType === 'touch' &&
        firstFingerIdRef.current === null &&
        (event.pointerId === secondFingerIdRef.current ||
          event.pointerId === pinchZoom.onlyFingerDown()?.pointerId ||
          event.currentTarget.hasPointerCapture(event.pointerId))) ||
      pinch === 'isFirstAfterPinch'
    )
      return beginPinch(event.currentTarget, event, event.timeStamp);
    if (isSecondFinger(event)) return;
    let commentLayer: string | null = null;
    if (event.pointerType === 'mouse') {
      mousePointOverCellsRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
      };
      commentLayer = markCommentLayersUnderMouse(
        {
          grid: view.grid,
          gridElement: event.currentTarget,
          zoom,
        },
        mousePointOverCellsRef.current,
      );
    }
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      if (event.pointerType !== 'mouse') return;
      if (view.fixesOnCells?.stage === 'waiting') {
        let fixCell = fixWaitingUnderPointer(event);
        let fixAt = fixCell === null ? null : pointInZoomedElement(event.currentTarget, zoom, pointClampedToRight(fixCell, event));
        fixPointer.isOver(fixCell, fixAt);
      }
      let errorCell = errorCellUnderMouse(event);
      let isErrorCardTold = errorCardHover.tell(
        errorCell === null
          ? null
          : {
              cell: errorCell,
              at: pointInGrid(event),
            },
        {
          x: event.clientX,
          y: event.clientY,
        },
      );
      let linkElement = isErrorCardTold ? null : linkUnderMouse(event);
      linkCardHover.isOver(linkElement === null ? null : cellPointOf(linkElement, event));
      let isOverCardTarget = errorCell !== null || isErrorCardTold || linkElement !== null;
      let isOverPlacedView = event.target instanceof Element && event.target.closest('.sheet-placed-view') !== null;
      mouseAroundComments.isOver(isOverCardTarget || isOverPlacedView || isAnyLayerHeldBack ? null : commentLayer, {
        x: event.clientX,
        y: event.clientY,
      });
      return;
    }
    if (event.pointerType === 'mouse')
      mouseAroundComments.isDraggedTo({
        x: event.clientX,
        y: event.clientY,
      });
    if (isOtherPointerWhileHeld(event)) return;
    if ((event.buttons & -2) !== 0) chartTaps.forget();
    let at = pointInGrid(event);
    let lastPointer = lastPointerRef.current;
    if (dragStartMsRef.current === null) {
      let nativeEvent = event.nativeEvent;
      let match = ('getCoalescedEvents' in nativeEvent ? [...nativeEvent.getCoalescedEvents(), nativeEvent] : [nativeEvent]).find(
        ({ clientX, clientY }) =>
          Math.hypot(
            at.x + unzoomLength(clientX - event.clientX, zoom) - lastPointer.at.x,
            at.y + unzoomLength(clientY - event.clientY, zoom) - lastPointer.at.y,
          ) >= dragStartDistance,
      );
      dragStartMsRef.current = match?.timeStamp ?? null;
    }
    if (isFillHandleJustTouched()) {
      store.dispatch({
        kind: 'pointerCanceled',
      });
      pressPointRef.current = lastPointer.at;
    }
    let pressPoint = pressPointRef.current;
    let buttonsNeeded = pressPoint === null ? 1 : 4;
    let isWrongButton = event.buttons !== 0 && (event.buttons & buttonsNeeded) === 0;
    let isLostRelease = event.buttons === 0 && isGridHeld();
    let isByFingerOrPen = event.pointerType === 'touch' || event.pointerType === 'pen';
    if ((isWrongButton || isLostRelease) && !isByFingerOrPen) return event.currentTarget.releasePointerCapture(event.pointerId);
    if (pressPoint === null)
      return dragHoldTracker.movedTo(at, {
        pressedAt: lastPointer.at,
        isButtonDown: event.buttons !== 0,
        isByFinger: event.pointerType === 'touch',
      });
    if (event.pointerType === 'touch') fingerFling.fingerMovedTo(event, event.timeStamp);
    if (event.pointerType === 'touch' && !hasPointerMovedRef.current && Math.hypot(pressPoint.x - at.x, pressPoint.y - at.y) < dragStartDistance)
      return;
    hasPointerMovedRef.current = true;
    pressPointRef.current = at;
    if (event.pointerType === 'touch')
      return pullByFinger({
        x: pressPoint.x - at.x,
        y: pressPoint.y - at.y,
      });
    return store.dispatch({
      kind: 'wheelTurned',
      deltaX: pressPoint.x - at.x,
      deltaY: pressPoint.y - at.y,
      ...(isByFingerOrPen
        ? {
            isByFinger: true,
          }
        : {}),
    });
  };
  let onGridPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') mouseAroundComments.isPressLost();
    pinchZoom.fingerLifted(event.pointerId, event.timeStamp);
    if (event.pointerId === secondFingerIdRef.current) secondFingerIdRef.current = null;
    if (isSecondFinger(event)) return;
    clearTimeout(tapHoldTimerRef.current);
    tapHoldEndRef.current = null;
    fingerFling.stop();
    updateTaps(() => NO_TAPS);
    placedViewPressedRef.current = null;
    placedViewPointerRef.current = null;
    chartTaps.forget();
    if (!isOtherPointerWhileHeld(event))
      store.dispatch({
        kind: 'pointerCanceled',
      });
  };
  let fitPlacedViewInSight = (placementId: string, isForced: boolean) => {
    let {
      placedViews,
      clearBodyHeight: heightOfClearBody,
      endOfFrozenRows,
      endOfFrozenColumns,
    } = store.getView().grid;
    let placed = placedViews.find((view) => view.placementId === placementId);
    if (placed === undefined || cellsRef.current === null) return;
    let zoomNow = gridZoom.now();
    let fitZoom = zoomToFit(
      {
        width: (endOfFrozenColumns?.at ?? 0) + placed.box.width,
        height: (endOfFrozenRows?.at ?? 0) + placed.box.height,
      },
      {
        width: cellsRef.current.clientWidth,
        height: (COLUMN_HEADER_HEIGHT + heightOfClearBody) * zoomNow,
      },
    );
    let fitting = zoomForFitting(placementId, fitZoom, zoomNow, fitZoomRef.current);
    if (isForced || fitting.fit !== null) {
      gridZoom.set(fitting.zoom);
      fitZoomRef.current = fitting.fit === null ? null : withFitZoom(fitting.fit, gridZoom.now());
    }
    store.dispatch({
      kind: 'placedViewActedOn',
      placementId,
      act: {
        kind: 'select',
        isByKey: true,
      },
    });
  };
  let onPressedTwice = (at: GridPoint, isByFinger: boolean, isUnhurried = false) => {
    if (clicksSinceCaretMovedRef.current < 2) return;
    let noticeBefore = store.getView().notice;
    store.dispatch({
      kind: 'pointerPressedTwice',
      ...(isUnhurried && {
        isUnhurried,
      }),
      ...at,
      isByFinger,
      ...beforeAnswerSeenPatch(),
    });
    if (!isByFinger || !isNarrowPhone) return;
    store.onceEventsAreFinished(() => {
      let { notice: latestNotice, linkExplained, grid: latestGrid } = store.getView();
      let isEditRefused = latestNotice !== noticeBefore && latestNotice?.kind === 'editRefused';
      let isOnActiveCell = gridSpotAt(at, latestGrid) === latestGrid.activeCellElementId;
      if (isEditRefused && isOnActiveCell && linkExplained === null && formulaBarLines.opensAsCard)
        setTimeout(
          () =>
            formulaBarRef.current?.focus({
              preventScroll: true,
            }),
        );
    });
  };
  let onGridPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId) || isSecondFinger(event)) return;
    if (event.pointerType === 'mouse') mouseAroundComments.isPressLost();
    if (event.pointerId === firstFingerIdRef.current) firstFingerIdRef.current = null;
    clearTimeout(tapHoldTimerRef.current);
    tapHoldEndRef.current = null;
    pressPointerIdRef.current = null;
    chartTaps.forget();
    setIsPointerHeldInCells(false);
    if (!isOtherPointerWhileHeld(event)) {
      dragHoldTracker.forget();
      dispatchPointerEvent({
        kind: 'pointerReleased',
        ...(!isPointerKeptRef.current && {
          isPointerLost: true,
        }),
      });
    }
    let { pointerId } = event;
    if (fingerPresses.noteLift(pointerId, isFocusNowhere() ? null : getActiveElement())) refocusAfterPress('atLift', null);
    let point = {
      x: event.clientX,
      y: event.clientY,
    };
    let [pressAtMs, putAwayComment] = [lastPointerRef.current.atMs, putAwayCommentsRef.current];
    store.onceEventsAreFinished(() => {
      let down = tapsRef.current.down;
      let { taps, pressedTwiceAt } = settleTaps(
        tapsRef.current,
        pointerId,
        (point) => gridSpotAt(point, store.getView().grid),
      );
      tapsRef.current = taps;
      if (pressedTwiceAt !== null) onPressedTwice(pressedTwiceAt, true, down?.isUnhurried);
      let latestGrid = store.getView().grid;
      if (!(down?.pointerId === pointerId && taps.last?.on === latestGrid.activeCellElementId) || lastPointerRef.current.atMs !== pressAtMs) return;
      let commentMark = commentMarksAtPoint(latestGrid, down.at).at(-1);
      if (commentMark === undefined || latestGrid.explainedCellBox !== null) return;
      if (commentMark === putAwayComment) mouseAroundComments.putAway();
      else mouseAroundComments.isTappedByFinger(commentMark, point);
    });
  };
  let { isDragToldOfWhileStill } = view.grid;
  React.useEffect(() => {
    if (!isDragToldOfWhileStill) return;
    let interval = setInterval(() => {
      let heldPointerId = heldPointerIdRef.current;
      dragHoldTracker.timeCame(heldPointerId !== null && cellsRef.current?.hasPointerCapture(heldPointerId) === true);
    }, DRAG_HELD_STILL_TICK_MS);
    return () => clearInterval(interval);
  }, [isDragToldOfWhileStill, dragHoldTracker, heldPointerIdRef]);
  let moveEntryTo = (target: EditingMode['typingIn']) => {
    let isEditing = store.getView().mode.kind === 'editing';
    let move = () => {
      let latestView = store.getView();
      let { formulaBarText, mode: latestMode } = latestView;
      let isReadOnly = latestView.isFormulaBarReadOnly || latestView.formulaOfFixOnEntryCell !== null;
      let mayMove = target === 'formulaBar' || latestMode.kind === 'editing';
      if (isReadOnly || !mayMove || whereTypingGoes(latestView) === target) return;
      if (target === 'formulaBar' && latestMode.kind !== 'editing') ReactDOM.flushSync(() => dispatchEditText(target, formulaBarText));
      else dispatchEditText(target, formulaBarText);
    };
    if (isEditing) store.onceEventsAreFinished(move);
    else store.onceWhatIsShownOfSelectionIsKnown(move);
  };
  let moveEntryToUnlessThere = (target: EditingMode['typingIn']) => {
    if (typingTarget === target || whereTypingGoes(store.getView()) === target) return;
    moveEntryTo(target);
  };
  let moveEntryToFormulaBar = () => {
    if (store.mayAnEntryOpenOrEnd()) moveEntryTo('formulaBar');
  };
  let isInBoxOfOneLine = view.mode.kind === 'editing' && view.mode.isInBoxOfOneLine === true && !view.isCaretWithCellsBeforeEntryEnds;
  React.useLayoutEffect(() => {
    let cellEditorElement = cellEditorRef.current;
    if (isInBoxOfOneLine || cellEditorElement === null || store.getView().mode.kind !== 'editing') return;
    if (cellEditorElement === cellEditorElement.ownerDocument.activeElement && cellEditorElement.ownerDocument.hasFocus()) refocusTypingTargetEvent();
  }, [store, isInBoxOfOneLine]);
  let { isEntryAmongPeople: isEntryAmongPeople } = view.grid;
  let entryCellOnPhone = isOnPhoneHere ? view.entryCellKey : null;
  let entryPlaceKey = `${isEntryAmongPeople} ${entryCellOnPhone}`;
  let entryPlaceKeyRef = React.useRef(entryPlaceKey);
  React.useLayoutEffect(() => {
    let ownerDocument = cellsRef.current?.ownerDocument;
    let isSame = entryPlaceKeyRef.current === entryPlaceKey;
    entryPlaceKeyRef.current = entryPlaceKey;
    if (isSame || ownerDocument === undefined || whereTypingGoes(store.getView()) !== 'cell') return;
    if (ownerDocument.activeElement === ownerDocument.body && ownerDocument.hasFocus()) refocusTypingTargetEvent();
  }, [store, entryPlaceKey]);
  let [waitingBoxText, setWaitingBoxText] = React.useState('');
  let typeIntoWaitingBox = (text: string) => {
    let pending = pendingTypingRef.current;
    if (pending !== null && store.isMoreHeldBehind(pending.typeOntoCell)) return;
    setWaitingBoxText(text);
    if (pending !== null)
      return void (pendingTypingRef.current = {
        ...pending,
        text,
      });
    let clear = () => {
      pendingTypingRef.current = null;
      setWaitingBoxText('');
    };
    let typeOntoCell = afterFocusLeaves(
      () => {
        if (pendingTypingRef.current === null) throw Error('the text kept in the waiting box was gone before its turn to be typed');
        let { text: textHeld } = pendingTypingRef.current;
        clear();
        let { mode: latestMode } = store.getView();
        if (textHeld === '') return;
        if (latestMode.kind === 'navigating')
          dispatchEditText('cell', textHeld, {
            isInBoxOfOneLine: true,
          });
        if (latestMode.kind === 'editing') completeEditText(latestMode, (textBefore) => textBefore + textHeld);
      },
      clear,
      () => true,
    );
    pendingTypingRef.current = {
      text,
      typeOntoCell,
    };
    store.onceEventsAreFinished(typeOntoCell, clear, 'asTypedAhead');
  };
  let onFieldInput = (typingIn: EditingMode['typingIn'], { target, nativeEvent }: FieldInput) => {
    forgetComeToByTab();
    wasFormulaBarFocusedRef.current = false;
    let isTypedBeforeEntryEnds = target === cellEditorRef.current && store.getView().isCaretWithCellsBeforeEntryEnds;
    if (isTypedBeforeEntryEnds) store.endWaitForPeople('goOn');
    if (store.mayAnEntryOpenOrEnd()) return isTypedBeforeEntryEnds ? typeIntoWaitingBox(target.value) : undefined;
    let isComposingText = isComposingRef.current || ('isComposing' in nativeEvent && nativeEvent.isComposing === true);
    const { mode: latestMode } = store.getView();
    const isEditing = latestMode.kind === 'editing';
    let isInGridFocus = target === cellEditorRef.current && !isEditing;
    if (target === cellEditorRef.current && isEditing && latestMode.isInBoxOfOneLine !== true) return;
    if (typingIn === 'cell' && target !== cellEditorRef.current && !isEditing) return;
    if (isInGridFocus && (target.value === ' ' || target.value === '　')) {
      if (isSpaceHeldRef.current) return;
      isSpaceHeldRef.current = true;
      if (isShiftHeldRef.current) {
        store.dispatch({
          kind: 'keyPressed',
          ...SHIFT_SPACE_KEY,
        });
        return;
      }
    }
    if (isEditing && isEntryEditor(target) && target.value === latestMode.text)
      return store.dispatch({
        kind: 'entryLooksChanged',
        looks: target.looks,
      });
    let inputType = 'inputType' in nativeEvent && typeof nativeEvent.inputType === 'string' ? nativeEvent.inputType : undefined;
    let signsInLastInput = isEntryEditor(target) ? target.signsInLastInput : null;
    let areSignsRead = signsInLastInput === 'read';
    let stepInHistory = historyStepOfInputType(inputType);
    dispatchEditText(typingIn, target.value, {
      ...(target.selectionEnd !== null && {
        caretAt: target.selectionEnd,
      }),
      ...(isInGridFocus &&
        isComposingText && {
          isInBoxOfOneLine: true,
        }),
      ...(isHistoryOrDropInputType(inputType) && {
        isOfHistory: true,
      }),
      ...((!isTypingInputType(inputType) || isPastingIntoEntryNow()) && {
        isNotTyped: true,
      }),
      ...(isEntryEditor(target) &&
        (isHistoryOrDropInputType(inputType) || areSignsRead) && {
          looks: target.looks,
        }),
      ...(stepInHistory !== undefined && {
        stepInHistory,
      }),
      ...(areSignsRead &&
        target.selectionStart !== null && {
          caretAfterSignsRead: target.selectionStart,
        }),
      ...(signsInLastInput === 'putBack' && {
        areSignsPutBack: true,
      }),
    });
  };
  let onFieldKeyDown = (event: React.KeyboardEvent<HTMLElement>, isReplayed = false) => {
    let isComposingKey = event.nativeEvent.isComposing || event.keyCode === 229;
    if (event.key === 'F6' && event.repeat && !event.altKey && !isComposingKey) return event.preventDefault();
    if (!isReplayed) endWaitForPeopleOnKey(event, isComposingKey);
    if (!isComposingKey && !isReplayed && typeAheadIntoEntry(event, onFieldKeyDown)) return;
    let isReplayedOutsideEdit = isReplayed && store.getView().mode.kind !== 'editing';
    let { mode: latestMode, openUnderCell } = store.getView();
    let tabStep = openUnderCell === null ? partStepOfTabInEntry(event, latestMode, wasFormulaBarFocusedRef.current) : null;
    let focusMove = isComposingKey || isReplayedOutsideEdit ? null : (tabStep ?? focusMoveOfKey(normalizedKeyEvent(event)));
    let moveCaretOn = tabStep === null ? moveCaretTo : moveCaretFromCells;
    if ((focusMove === 'nextPart' || (focusMove === 'partBefore' && !isViewOnly)) && !isKeyForLayer(event, null)) {
      event.preventDefault();
      lastTypingTargetRef.current = 'grid';
      store.dispatch({
        kind: 'entryLeft',
      });
      return whenFocusStays(() => {
        let latestView = store.getView();
        if (latestView.mode.kind === 'editing') focusTypingTarget(whereTypingGoes(latestView));
        else if (!moveCaretOn('formulaBar', focusMove === 'nextPart' ? 1 : -1)) focusTypingTarget('grid');
      });
    }
    if (isReplayedOutsideEdit || store.getView().mode.kind === 'editing') return onCellsKeyDown(event, isReplayed);
    if (event.key === 'Escape' && !isKeyForLayer(event, null)) focusTypingTarget('grid');
    return;
  };
  let chartOfMenu = view.menu?.ofChart ?? null;
  let chartMenuOf = React.useMemo(
    () =>
      chartOfMenu === null
        ? null
        : {
            ...chartOfMenu,
            mark: placementIdAttributes(chartOfMenu.placementId),
          },
    [chartOfMenu],
  );
  let chooseChartDelete = React.useCallback(
    (isByKey: boolean) => {
      let placementId = store.getView().menu?.ofChart?.placementId;
      if (placementId === undefined) return;
      store.dispatch({
        kind: 'placedViewActedOn',
        placementId,
        act: {
          kind: 'delete',
          isByKey,
        },
      });
      swallowRepeatedDeleteKeys(cellsRef.current?.ownerDocument.defaultView, (then) => store.lookOnceEventsAreFinished(then));
    },
    [store],
  );
  let menuAt = view.menu?.at ?? null;
  let menuAnchor = useZoomedVirtualAnchor(
    cellsRef,
    zoom,
    React.useMemo(() => (menuAt === null ? null : new DOMRect(menuAt.x, menuAt.y)), [menuAt]),
  );
  let menuOpenedByRef = React.useRef<PickerAskedInCellsMenuBy>(null);
  let withMenuOpenedBy = React.useCallback((isByKey: boolean, action: () => void) => {
    menuOpenedByRef.current = isByKey ? 'key' : 'pointer';
    try {
      action();
    } finally {
      menuOpenedByRef.current = null;
    }
  }, []);
  let contextBarMenuOpenedByRef = React.useRef<PickerAskedInCellsMenuBy>(null);
  let getContextBarMenuOpenedBy = React.useCallback(() => contextBarMenuOpenedByRef.current, []);
  let getTypingTargetElement = React.useCallback(() => {
    switch (whereTypingGoes(store.getView())) {
      case 'grid':
        return getGridOrEditorElement();
      case 'cell':
        return activeEditorRef.current;
      case 'formulaBar':
        return formulaBarRef.current;
    }
  }, [store, getGridOrEditorElement]);
  let dispatchThenFocusTyping = React.useCallback(
    (kind: 'entryExpandedOrCollapsed' | 'expandedEntryFinished') =>
      store.onceEventsAreFinished(() => {
        if (isPageReallyLeft()) return;
        ReactDOM.flushSync(
          () =>
            store.dispatch({
              kind,
            }),
        );
        getTypingTargetElement()?.focus({
          preventScroll: true,
        });
      }),
    [store, isPageReallyLeft, getTypingTargetElement],
  );
  let whatHasCaretAfter = React.useCallback(() => {
    if (cellsRef.current?.ownerDocument.hasFocus() !== true) return false;
    let latestView = store.getView();
    let isCalendarOpen = latestView.calendar !== null && latestView.mode.kind === 'navigating';
    let sidePane = sidePaneRef.current;
    let isInSidePane = sidePane?.contains(sidePane.ownerDocument.activeElement) === true;
    let isInFindFields = [findBarRef, replaceFieldRef].some(
      ({ current }) => current !== null && current === current.ownerDocument.activeElement,
    );
    let isAtEndOfSheet = isAtEndOfSheetInput(cellsRef.current.ownerDocument.activeElement);
    let active = cellsRef.current.ownerDocument.activeElement;
    let isOnPlacement = placementIdOfElement(active) !== null && (active?.closest('[role="menu"]') ?? null) === null;
    let isRenamingSheet = latestView.listedSheets.some(({ renaming }) => renaming !== null);
    let isFocusTaken =
      hasElementAwaitingKeyboard(cellsRef.current.ownerDocument) ||
      isFilterBarAskOpen(latestView) ||
      isInSidePane ||
      isInFindFields ||
      isRenamingSheet ||
      isCalendarOpen ||
      latestView.linkForm !== null ||
      isAtEndOfSheet ||
      isOnPlacement;
    if (latestView.menu !== null || isFocusTaken || isModalOpen(latestView)) return false;
    let { contextBarMenu: latestContextBarMenu } = latestView;
    if (
      (latestContextBarMenu !== null && isPaneMenuOfContextBar(latestContextBarMenu) && isTouchBelowSm()) ||
      (latestContextBarMenu !== null && contextBarMenuOpenedByRef.current === 'key')
    )
      return false;
    return getTypingTargetElement() ?? false;
  }, [store, getTypingTargetElement]);
  let whatHasCaretAfterMenu = React.useCallback(() => {
    let target = whatHasCaretAfter();
    if (target !== false && target === cellEditorRef.current) markZoomSettling();
    return target;
  }, [whatHasCaretAfter, markZoomSettling]);
  let whatHasCaretAfterLayer = React.useCallback(() => {
    let lastFocused = lastKeyDownRef.current?.key === 'Escape' ? getLastFocusedByKey() : null;
    return lastFocused !== null && whatHasCaretAfter() !== false ? lastFocused : whatHasCaretAfterMenu();
  }, [getLastFocusedByKey, whatHasCaretAfter, whatHasCaretAfterMenu]);
  let whatHasCaretAfterPaneLayer = React.useCallback(
    (isInPane: boolean) => (isInPane ? sidePaneRef.current?.querySelector<HTMLElement>(`[${SORT_BUTTON_ATTRIBUTE}]`) : null) ?? whatHasCaretAfterLayer(),
    [whatHasCaretAfterLayer],
  );
  let whatHasCaretAfterKeysList = React.useCallback(() => {
    let focusBefore = focusBeforeKeysListRef.current;
    let caretAfter = whatHasCaretAfter();
    let isTypingTarget =
      focusBefore === gridFocusRef.current ||
      focusBefore === cellEditorRef.current ||
      focusBefore === activeEditorRef.current ||
      (focusBefore === formulaBarRef.current && !store.getView().isFormulaBarReadOnly);
    let returnTo = focusBefore instanceof HTMLElement && isElementLiveAndNotInert(focusBefore) && !isTypingTarget ? focusBefore : null;
    let target = pickFocusTarget(returnTo, caretAfter, whatHasCaretAfterLayer);
    if (target === false || placementIdOfElement(target) !== placementBeforeKeysListRef.current) placementBeforeKeysListRef.current = null;
    return target;
  }, [store, whatHasCaretAfter, whatHasCaretAfterLayer]);
  let menu = view.menu;
  React.useEffect(() => {
    if (menu === null || isMenuHoldingField(menu)) return;
    isContextBarMenuByKeyRef.current = menu.isOfContextBar === true && menu.isAskedByKey;
    isChartMenuRef.current = menu.ofChart !== undefined;
  }, [menu]);
  let isOneCellSelected = view.selectedCellCount === 1;
  React.useEffect(() => {
    if (menu?.holds === 'all' && isOneCellSelected && menu.tableToSort === undefined)
      store.dispatch({
        kind: 'tableToSortAsked',
      });
    else if (menu?.holds === 'all' && menu.sortsFor === undefined)
      store.dispatch({
        kind: 'whomSortsAreForAsked',
      });
  }, [store, menu, isOneCellSelected]);
  let { sortPane } = view;
  let sortPaneStepKey = sortPane === null ? null : JSON.stringify([sortPane, view.latestStep]);
  React.useEffect(() => {
    if (sortPaneStepKey !== null)
      store.dispatch({
        kind: 'whomSortsAreForAsked',
      });
  }, [store, sortPaneStepKey]);
  let whatHasCaretAfterContextBarMenu = React.useCallback(() => {
    if (isCaretLeftForComment()) return false;
    let active = cellsRef.current?.ownerDocument.activeElement ?? null;
    if (active !== null && active.closest(`[${ERRORS_OFFERED_ATTRIBUTE}]`) !== null) return false;
    let caretAfter = whatHasCaretAfter();
    let chartPlacementId = caretAfter !== false && isChartMenuRef.current ? getSelectedPlacementId() : null;
    if (chartPlacementId !== null && active !== null) return findPlacedViewCaret(active.ownerDocument, chartPlacementId) ?? caretAfter;
    let isEditing = store.getView().mode.kind === 'editing';
    if (!isContextBarMenuByKeyRef.current || caretAfter === false || isEditing) return caretAfter;
    return toolbarTabStopOf(formatToolsRef.current) ?? caretAfter;
  }, [store, whatHasCaretAfter, isCaretLeftForComment, getSelectedPlacementId]);
  let askContextBarMenu = React.useCallback(
    (button: Element, isByKey: boolean) => {
      let cells = cellsRef.current;
      if (cells === null) return;
      let { left, top, height } = button.getBoundingClientRect();
      let zoomNow = gridZoom.now();
      store.dispatch({
        kind: 'menuAsked',
        at: pointInZoomedElement(cells, zoomNow, {
          clientX: left,
          clientY: top,
        }),
        inContextBar: {
          height: unzoomLength(height, zoomNow),
          isByKey,
        },
      });
    },
    [store, gridZoom],
  );
  let closeMenu = React.useCallback(() => {
    clicksSinceCaretMovedRef.current = 0;
    if (store.getView().menu?.ofHandleOfTable !== undefined) menuOfHandleShut();
    store.dispatch({
      kind: 'menuClosed',
    });
  }, [store, menuOfHandleShut]);
  let closeMenuIfAskedAt = React.useCallback(
    (at: PagePoint | null) =>
      store.dispatch({
        kind: 'menuClosed',
        onlyIfAskedAt: at,
      }),
    [store],
  );
  let onLayerOpenChange = React.useCallback(
    (layer: HeldBackLayer, isOpen: boolean, event: Event | null) => {
      let win = cellsRef.current?.ownerDocument.defaultView;
      let isNewlyOpen = isOpen && !heldBackLayersRef.current.has(layer);
      let isUserActive = win?.navigator.userActivation?.isActive !== false;
      if (isNewlyOpen && isUserActive && win?.document.hasFocus() === false) {
        win.focus();
        if (!win.document.hasFocus())
          getTypingTargetElement()?.focus({
            preventScroll: true,
          });
      }
      if (isOpen) heldBackLayersRef.current.add(layer);
      else heldBackLayersRef.current.delete(layer);
      setIsAnyLayerHeldBack(heldBackLayersRef.current.size > 0);
      setIsNonWaysInLayerHeldBack([...heldBackLayersRef.current].some((heldLayer) => heldLayer !== 'ofWaysIn'));
      menuKeyEventRef.current = event;
      let isPressInCells = event?.type === 'mousedown' && event.target instanceof Node && cellsRef.current?.contains(event.target) === true;
      let isBarOfPhone = (cellsRef.current?.closest('[data-is-bar-of-phone]') ?? null) !== null;
      if (!isOpen && !(event === null && isBarOfPhone)) clicksSinceCaretMovedRef.current = isPressInCells ? 1 : 0;
    },
    [getTypingTargetElement],
  );
  let notedContextBarMenuRef = React.useRef<string | null>(null);
  let isPickerAskedByKeyRef = React.useRef(false);
  let makeContextBarMenuHandlers = React.useCallback(
    () =>
      contextBarMenuHandlers({
        store,
        noted: notedContextBarMenuRef,
        note: (isMenuNoted, closedBy) => onLayerOpenChange('ofToolbar', isMenuNoted, closedBy),
        onCardAsked: () =>
          store.lookOnceEventsAreFinished(() => {
            if (!((formatToolsRef.current?.getClientRects().length ?? 0) > 0) || store.getView().isAgentWorking) return;
            let { isOfFilterBar = false, isFilterNotDrawnYet = false } = store.getView().rowsAskedFor ?? {};
            if (isOfFilterBar && !isFilterNotDrawnYet && !isTouchBelowSm()) return;
          }),
      }),
    [store, shell, onLayerOpenChange],
  );
  let chartMenuOpenCountRef = React.useRef(0);
  let leaveEntryKeepingSelection = React.useCallback(() => {
    let selectedCaretInEntry = () => {
      let { caretInEntry: caretRange } = caretInEntryPatch(store.getView().mode, entryFieldRefs);
      return caretRange !== undefined && caretRange.start < caretRange.end ? caretRange : undefined;
    };
    if (selectedCaretInEntry() === undefined) return;
    giveEntryBoxToFormat(store, entryFieldRefs);
    let caretInEntry = selectedCaretInEntry();
    if (caretInEntry !== undefined)
      store.dispatch({
        kind: 'entryLeft',
        isForToolAboutWholeCells: true,
        caretInEntry,
      });
  }, [store, entryFieldRefs]);
  let onMenuOpenChange = React.useCallback(
    (menuKind: string, isOpen: boolean, event: Event | null, at?: string | CellAt) => {
      contextBarMenuOpenedByRef.current = null;
      if (menuKind === 'chart' && isOpen) chartMenuOpenCountRef.current += 1;
      if (menuKind === 'chart' && isOpen && store.getView().mode.kind === 'editing')
        store.dispatch({
          kind: 'entryLeft',
        });
      if (menuKind === 'sort' && isOpen && store.getView().mode.kind === 'editing')
        store.dispatch({
          kind: 'entryLeft',
        });
      if (isOpen && isFormatMenuKeepingEntrySelection(menuKind)) leaveEntryKeepingSelection();
      makeContextBarMenuHandlers().onOpenChange(menuKind, isOpen, event, at);
    },
    [store, makeContextBarMenuHandlers, leaveEntryKeepingSelection],
  );
  let { contextBarMenu } = view;
  React.useEffect(() => {
    if (contextBarMenu === null) makeContextBarMenuHandlers().onNoMenuInState();
  });
  let onWaysInLayerOpenChange = React.useCallback<MenuOpenChange>(
    (isOpen, event) => onLayerOpenChange('ofWaysIn', isOpen, isOpen ? null : event),
    [onLayerOpenChange],
  );
  let onZoomLayerOpenChange = React.useCallback<MenuOpenChange>(
    (isOpen, event) => onLayerOpenChange('ofZoom', isOpen, isOpen ? null : event),
    [onLayerOpenChange],
  );
  let onNamedViewsLayerOpenChange = React.useCallback<MenuOpenChange>(
    (isOpen, event) => onLayerOpenChange('ofNamedViews', isOpen, isOpen ? null : event),
    [onLayerOpenChange],
  );
  let onFiguresLayerOpenChange = React.useCallback<MenuOpenChange>(
    (isOpen, event) => onLayerOpenChange('ofFigures', isOpen, isOpen ? null : event),
    [onLayerOpenChange],
  );
  let onSheetsLayerOpenChange = React.useCallback<MenuOpenChange>(
    (isOpen, event) => onLayerOpenChange('ofSheets', isOpen, isOpen ? null : event),
    [onLayerOpenChange],
  );
  let entryCellLabel =
    view.entrySheetName === null
      ? null
      : {
          sheet: sheetPrefixForFormula(view.entrySheetName).slice(0, -1),
          cell: `!${view.entryCellText}`,
        };
  let { body: gridBody } = view.grid;
  let entryBox = view.grid.editorBox ?? view.grid.activeCellBox;
  let isCalendarShown = view.calendar !== null && entryBox !== null;
  let {
    left: entryBoxLeft,
    top: entryBoxTop,
    width: entryBoxWidth,
    height: entryBoxHeight,
  } = entryBox === null
    ? {
        ...gridBody,
        width: 0,
        height: 0,
      }
    : zoomedEntryBox(entryBox, gridBody, view.grid.editorScale);
  let calendarAnchor = useZoomedVirtualAnchor(
    cellsRef,
    zoom,
    React.useMemo(
      () => (isCalendarShown ? new DOMRect(entryBoxLeft, entryBoxTop, entryBoxWidth, entryBoxHeight) : null),
      [isCalendarShown, entryBoxLeft, entryBoxTop, entryBoxWidth, entryBoxHeight],
    ),
  );
  let boxesLitByLink = view.grid.boxesLitByLink.map(({ box }) => clipBoxToShown(box));
  let litTop = Math.min(...boxesLitByLink.map(({ top }) => top));
  let litBottom = Math.max(...boxesLitByLink.map(({ top, height }) => top + height));
  let [guideLeft, guideTop, guideRight, guideBottom] =
    boxesLitByLink.length === 0 || Math.max(litTop, gridBody.height - litBottom) < GUIDE_ROOM_ABOVE_OR_BELOW
      ? [0, 0, gridBody.width - GUIDE_EDGE_GAP, 0]
      : [
          Math.min(...boxesLitByLink.map(({ left }) => left)),
          litTop,
          Math.max(...boxesLitByLink.map(({ left, width }) => left + width)),
          litBottom,
        ];
  let isGuideAtEnd =
    guideBottom === 0 &&
    (boxesLitByLink.length > 0 || entryBoxTop - gridBody.top > GUIDE_CARD_HEIGHT / zoom || entryBoxLeft - gridBody.left < gridBody.width / 2);
  let guideAnchor = useZoomedVirtualAnchor(
    cellsRef,
    zoom,
    React.useMemo(
      () => ({
        x: gridBody.left + guideLeft,
        y: gridBody.top + guideTop,
        width: guideRight - guideLeft,
        height: guideBottom - guideTop,
      }),
      [gridBody.left, gridBody.top, guideLeft, guideTop, guideRight, guideBottom],
    ),
  );
  let isLinkFormShown = view.linkForm !== null && entryBox !== null;
  let linkFormAnchor = useZoomedVirtualAnchor(
    cellsRef,
    zoom,
    React.useMemo(
      () => (isLinkFormShown ? new DOMRect(entryBoxLeft, entryBoxTop, entryBoxWidth, entryBoxHeight) : null),
      [isLinkFormShown, entryBoxLeft, entryBoxTop, entryBoxWidth, entryBoxHeight],
    ),
  );
  let isCellHistoryShown = view.cellHistory !== null && entryBox !== null;
  let cellHistoryAnchor = useZoomedVirtualAnchor(
    cellsRef,
    zoom,
    React.useMemo(
      () => (isCellHistoryShown ? new DOMRect(entryBoxLeft, entryBoxTop, entryBoxWidth, entryBoxHeight) : null),
      [isCellHistoryShown, entryBoxLeft, entryBoxTop, entryBoxWidth, entryBoxHeight],
    ),
  );
  let { dropdownAnchorBox, editorScale } = view.grid;
  let dropdownAnchor = useZoomedVirtualAnchor(
    cellsRef,
    zoom,
    React.useMemo(
      () => (dropdownAnchorBox === null ? null : toDomRect(zoomedEntryBox(dropdownAnchorBox, gridBody, editorScale))),
      [dropdownAnchorBox, gridBody, editorScale],
    ),
  );
  let onDropdownRowChosen = React.useCallback(
    (rowKey: string) => {
      clicksSinceCaretMovedRef.current = 0;
      lastProgrammaticActMsRef.current = performance.now();
      store.dispatch({
        kind: 'dropdownListRowChosen',
        key: rowKey,
      });
    },
    [store],
  );
  let onDropdownBlur = React.useCallback(
    (event: Event) => {
      let goingTo = 'relatedTarget' in event && event.relatedTarget !== null ? event.relatedTarget : event.target;
      if (goingTo instanceof Node && cellsRef.current?.contains(goingTo) === true) return;
      clicksSinceCaretMovedRef.current = 0;
      store.dispatch({
        kind: 'dropdownShut',
      });
    },
    [store],
  );
  let giveUpSidePane = React.useCallback(() => {
    pointerPressesRef.current += 1;
    store.dispatch({
      kind: 'sidePaneShut',
      isGivenUp: true,
    });
  }, [store]);
  let shutSidePane = React.useCallback(() => {
    clicksSinceCaretMovedRef.current = 0;
    getLastFocusedByKey()?.focus({
      preventScroll: true,
    });
    store.dispatch({
      kind: 'sidePaneShut',
    });
  }, [store, getLastFocusedByKey]);
  let dispatchThenNoteChange = React.useCallback(
    (event: PageEvent, onDone?: (isDone: boolean) => void) => {
      if (onDone === undefined) return store.dispatch(event);
      let onNotDone = () => onDone(false);
      return store.onceEventsAreFinished(() => {
        let viewBefore = store.getView();
        try {
          store.dispatch(event);
        } finally {
          store.onceEventsAreFinished(() => onDone(store.getView() !== viewBefore), onNotDone);
        }
      }, onNotDone);
    },
    [store],
  );
  let onDropdownEditorAct = React.useCallback<ActInDropdownPane>(
    (act, onDone) =>
      dispatchThenNoteChange(
        {
          kind: 'dropdownEditorActedIn',
          act,
        },
        onDone,
      ),
    [dispatchThenNoteChange],
  );
  let onConditionalFormatsAct = React.useCallback<ActInRulesPane>(
    (act, onDone) =>
      dispatchThenNoteChange(
        {
          kind: 'conditionalFormatsActedIn',
          act,
        },
        onDone,
      ),
    [dispatchThenNoteChange],
  );
  let onSortPaneAct = React.useCallback<ActInSortPane>(
    (act, onDone) => {
      if (act.kind === 'sort' && store.getView().mode.kind === 'editing')
        store.dispatch({
          kind: 'entryLeft',
        });
      let isWithNoKeyboard = act.kind === 'sort' && !likelyHasKeyboard();
      dispatchThenNoteChange(
        {
          kind: 'sortPaneActedIn',
          act: isWithNoKeyboard
            ? {
                ...act,
                isWithNoKeyboard,
              }
            : act,
        },
        onDone,
      );
    },
    [store, dispatchThenNoteChange],
  );
  let askSortPane = React.useCallback(
    (of: SortPaneAsked['of'], choice: ChoiceMadeIn = NO_CHOSEN_IN) => {
      if (store.getView().mode.kind === 'editing')
        store.dispatch({
          kind: 'entryLeft',
        });
      store.dispatch({
        kind: 'sortPaneAsked',
        of,
        ...choice,
      });
    },
    [store],
  );
  let askSortPaneFromMenu = React.useCallback((of: SortPaneAsked['of']) => askSortPane(of, CHOSEN_IN_MENU), [askSortPane]);
  let onPivotTablePaneAct = React.useCallback<PivotTablePaneProps['onAct']>(
    (act, onDone) => {
      let of = store.getView().pivotTablePane?.cellId;
      if (of === undefined) return;
      if (act.kind !== 'type' && store.getView().mode.kind === 'editing')
        store.dispatch({
          kind: 'entryLeft',
        });
      dispatchThenNoteChange(
        {
          kind: 'pivotTablePaneActedIn',
          act,
          of,
        },
        onDone,
      );
    },
    [store, dispatchThenNoteChange],
  );
  let askPivotTable = React.useCallback(() => {
    if (store.getView().mode.kind === 'editing')
      store.dispatch({
        kind: 'entryLeft',
      });
    let nameOfNewSheet = pivotTableMessages.nameOfNewSheet();
    store.dispatch({
      kind: 'pivotTableAsked',
      nameOfNewSheet,
      ...CHOSEN_IN_MENU,
    });
  }, [store]);
  let onVersionHistoryAct = React.useCallback(
    (act: VersionHistoryAct) =>
      store.dispatch({
        kind: 'versionHistoryActedIn',
        act,
      }),
    [store],
  );
  let lookAtVersionsAgain = React.useCallback(
    () =>
      store.dispatch({
        kind: 'versionsLookedAtAgain',
      }),
    [store],
  );
  let returnFocusFromSidePaneWhen = React.useCallback(
    (isStillOpen: (view: PageView) => boolean) => {
      if (!isPointerPressedLastRef.current || !likelyHasKeyboard()) return;
      store.lookOnceEventsAreFinished(() => {
        if (isStillOpen(store.getView())) return;
        let sidePane = sidePaneRef.current;
        let active = sidePane?.ownerDocument.activeElement ?? null;
        if (sidePane?.contains(active) === true && !isTextInputOrEntryEditor(active) && sidePane.ownerDocument.hasFocus())
          getTypingTargetElement()?.focus({
            preventScroll: true,
          });
      });
    },
    [store, getTypingTargetElement],
  );
  let returnFocusFromConditionalFormats = React.useCallback(
    () =>
      returnFocusFromSidePaneWhen(({ conditionalFormats: latestConditionalFormats }) => latestConditionalFormats?.keepsKeys !== false),
    [returnFocusFromSidePaneWhen],
  );
  let returnFocusFromVersionHistory = React.useCallback(
    () => returnFocusFromSidePaneWhen(({ versionHistory }) => versionHistory === null),
    [returnFocusFromSidePaneWhen],
  );
  let askRulesFromCells = React.useCallback(() => {
    isPickerAskedByKeyRef.current = false;
    contextBarMenuOpenedByRef.current = null;
    let isContextBarShown = (formatToolsRef.current?.getClientRects().length ?? 0) > 0;
    makeContextBarMenuHandlers().onRulesAskedByRow('cells', !isContextBarShown);
  }, [makeContextBarMenuHandlers]);
  let askSortFromMenu = React.useCallback(() => {
    isPickerAskedByKeyRef.current = false;
    let { menu: latestMenu, grid: latestGrid } = store.getView();
    let filterButton = latestGrid.filterButtons.find(
      ({ isOfFoundTable, tableKey }) => isOfFoundTable && tableKey === latestMenu?.ofHandleOfTable,
    );
    if (filterButton !== undefined) {
      store.dispatch({
        kind: 'menuClosed',
      });
      return onMenuOpenChange('sort', true, null, {
        r: filterButton.r,
        c: filterButton.c,
      });
    }
    let isContextBarShown = (formatToolsRef.current?.getClientRects().length ?? 0) > 0;
    if (!isContextBarShown && store.getView().ownFilterOffers?.filter.kind !== 'turnOn') return;
    if (!isContextBarShown)
      return store.dispatch({
        kind: 'ownFilterAsked',
        chosenIn: 'menu',
      });
    onMenuOpenChange('sort', true, null, GUESS_TABLE_FOR_ROWS_ASK);
    contextBarMenuOpenedByRef.current = menuOpenedByRef.current;
    return;
  }, [store, onMenuOpenChange]);
  let askChartFromMenu = React.useCallback(
    (isByKey: boolean) => {
      isPickerAskedByKeyRef.current = false;
      store.dispatch({
        kind: 'menuClosed',
      });
      onMenuOpenChange('chart', true, null);
      contextBarMenuOpenedByRef.current = isByKey ? 'key' : 'pointer';
    },
    [store, onMenuOpenChange],
  );
  let onTableMenuKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, lit: ItemLitInMenu) => {
      if (event.nativeEvent.isComposing || isAltShortcutKey(event)) return;
      let key = normalizedKeyEvent(event);
      let keyTarget = keyTargetAtTableMenu(key, lit);
      if (keyTarget === 'menu') return;
      event.preventDefault();
      event.stopPropagation();
      if (keyTarget === 'cells')
        store.dispatch({
          kind: 'keyPressed',
          ...key,
        });
    },
    [store],
  );
  let { dropdownList } = view;
  let highlightedDropdownRow = dropdownList?.rows[dropdownList.highlightedRow ?? -1];
  let isEntryHelperShown =
    view.peopleList !== null ||
    view.timeList !== null ||
    view.functionList !== null ||
    view.functionGuide !== null ||
    formulaFromWords.stage !== null;
  let peopleListField = view.peopleList?.inField ?? null;
  let peopleListCellBox = peopleListField === null ? null : view.grid.activeCellBox;
  let editorVerticalAlign = view.grid.editorFormat.alignment.vertical;
  let { clearBodyHeight } = view.grid;
  let { over: editorClearOver, under: editorClearUnder, right: editorClearRight } = view.grid.editorKeepsClear;
  let activeCellDrawn =
    peopleListField === null ? undefined : view.grid.rowsDrawn.flatMap(({ cells }) => cells).find(({ isActive }) => isActive);
  let doesPeopleListKeepToColumn =
    peopleListField !== null &&
    peopleListCellBox !== null &&
    activeCellDrawn !== undefined &&
    peopleListKeepsToColumn(
      personChipLinesOfCell(activeCellDrawn, {
        over: editorClearOver,
        under: editorClearUnder,
      }),
      peopleListField.length,
      personChipLinesInRowHeight(clearBodyHeight - peopleListCellBox.top, DEFAULT_CELL_FORMAT.font.size, {
        over: editorClearOver,
        under: editorClearUnder,
      }),
    );
  let { density } = view;
  let cellPaddingBeside = cellPaddingBesideBox(density);
  let peopleListPlacement = React.useMemo(() => {
    if (peopleListCellBox === null) return null;
    let keepsClear = {
      over: editorClearOver,
      under: editorClearUnder,
      left: cellPaddingBeside,
      right: editorClearRight,
    };
    let {
      left,
      top,
      height,
      minWidth,
      clipPath,
    } = cellEntryBoxStyle(peopleListCellBox, gridBody, DEFAULT_CELL_FORMAT, keepsClear);
    let scrollSlop = DROPDOWN_SCROLL_SLOP;
    let { showsIn } = peopleListCellBox;
    let showsInBottom = Math.min(showsIn.top + showsIn.height, clearBodyHeight);
    let isChipsAlignedFits = (
      {
        top: peopleListCellBox.top >= showsIn.top - scrollSlop,
        center: true,
        bottom: peopleListCellBox.top + peopleListCellBox.height <= showsInBottom + scrollSlop,
      }
    )[editorVerticalAlign];
    return {
      left,
      top,
      width: minWidth,
      height,
      linesBefore: entryGridlineOverlap(peopleListCellBox, 1),
      chipsAt: isChipsAlignedFits ? editorVerticalAlign : 'center',
      clearOfText: textClearanceStyle(keepsClear, density),
      ...(clipPath !== undefined && {
        clipPath,
      }),
    };
  }, [
    peopleListCellBox,
    gridBody,
    editorClearOver,
    editorClearUnder,
    density,
    cellPaddingBeside,
    editorClearRight,
    editorVerticalAlign,
    clearBodyHeight,
  ]);
  let popupBounds = React.useMemo(
    () => ({
      left: gridBody.left,
      right: gridBody.left + gridBody.width - POPUP_EDGE_GAP,
    }),
    [gridBody.left, gridBody.width],
  );
  let [entryHelperRect, setEntryHelperRect] = React.useState<DOMRect | null>(null);
  let noteEntryHelperRect = React.useCallback(
    (box: FieldOfChipsBox | null) =>
      setEntryHelperRect((rectBefore) => {
        if (box === null) return null;
        let { left, top, width, height } = box;
        return rectBefore?.x === left && rectBefore.y === top && rectBefore.width === width && rectBefore.height === height
          ? rectBefore
          : new DOMRect(left, top, width, height);
      }),
    [],
  );
  let entryHelperAnchor = useZoomedVirtualAnchor(
    cellsRef,
    zoom,
    React.useMemo(() => {
      if (!isEntryHelperShown) return null;
      if (peopleListPlacement !== null && entryHelperRect !== null) return entryHelperRect;
      return new DOMRect(entryBoxLeft, entryBoxTop, entryBoxWidth, entryBoxHeight);
    }, [isEntryHelperShown, peopleListPlacement, entryHelperRect, entryBoxLeft, entryBoxTop, entryBoxWidth, entryBoxHeight]),
  );
  let removePersonFromField = React.useCallback(
    (userId: string) => {
      clicksSinceCaretMovedRef.current = 0;
      getTypingTargetElement()?.focus({
        preventScroll: true,
      });
      store.dispatch({
        kind: 'personRemovedFromField',
        userId,
      });
    },
    [store, getTypingTargetElement],
  );
  let {
    left: explainedCellLeft = null,
    top: explainedCellTop = 0,
    width: explainedCellWidth = 0,
    height: explainedCellHeight = 0,
  } = view.grid.explainedCellBox ?? {};
  let explainedCellRect = React.useMemo(
    () =>
      explainedCellLeft === null
        ? null
        : {
            x: gridBody.left + explainedCellLeft,
            y: gridBody.top + explainedCellTop,
            width: explainedCellWidth,
            height: explainedCellHeight,
          },
    [explainedCellLeft, explainedCellTop, explainedCellWidth, explainedCellHeight, gridBody.left, gridBody.top],
  );
  let errorExplainedAnchor = useZoomedVirtualAnchor(cellsRef, zoom, view.errorExplained === null ? null : explainedCellRect);
  let { cornerOfErrorsOffered } = view.grid;
  let [errorCornerLeft, errorCornerTop] = [cornerOfErrorsOffered?.left, cornerOfErrorsOffered?.top];
  let errorCornerRect = React.useMemo(
    () =>
      errorCornerLeft === undefined || errorCornerTop === undefined
        ? null
        : {
            x: gridBody.left + errorCornerLeft,
            y: gridBody.top + errorCornerTop,
            width: 0,
            height: 0,
          },
    [errorCornerLeft, errorCornerTop, gridBody.left, gridBody.top],
  );
  let errorCornerAnchor = useZoomedVirtualAnchor(cellsRef, zoom, errorCornerRect);
  let { pillOfFix } = view.grid;
  let { left: fixPillLeft, top: fixPillTop, width: fixPillWidth, height: fixPillHeight } = pillOfFix?.box ?? {};
  let fixPillRect = React.useMemo(
    () =>
      fixPillLeft === undefined || fixPillTop === undefined
        ? null
        : {
            x: gridBody.left + fixPillLeft,
            y: gridBody.top + fixPillTop,
            width: fixPillWidth ?? 0,
            height: fixPillHeight ?? 0,
          },
    [fixPillLeft, fixPillTop, fixPillWidth, fixPillHeight, gridBody.left, gridBody.top],
  );
  let fixPillAnchor = useZoomedVirtualAnchor(cellsRef, zoom, fixPillRect);
  let fixPillKey = pillOfFix?.key ?? null;
  let actableFixPillKey = isAnyLayerHeldBack ? null : fixPillKey;
  let onFixActedOn = React.useCallback(
    (act: FixPillAct, howActBegan: HowActBegan) => {
      if (actableFixPillKey !== null)
        store.dispatch({
          kind: 'fixActedOn',
          act,
          pillOf: actableFixPillKey,
          ...howActBegan,
        });
    },
    [store, actableFixPillKey],
  );
  let holdActAtFixes = React.useCallback(
    () =>
      store.dispatch({
        kind: 'actHeldAtAgentsAnswer',
        at: 'fixes',
      }),
    [store],
  );
  let fixPointer = useFixPointer(store, fixPillKey);
  let fixKeyCameAt = useWhenKeyCame(actableFixPillKey);
  let fixPillKeyForKeys = pillOfFix?.areKeysForIt === true ? actableFixPillKey : null;
  let fixKeysCameAt = useWhenKeyCame(fixPillKeyForKeys);
  let linkExplainedRect = view.linkExplained?.wordsBox ?? explainedCellRect;
  let linkExplainedAnchor = useZoomedVirtualAnchor(cellsRef, zoom, view.linkExplained === null ? null : linkExplainedRect);
  let formulaBarTextStartAnchor = React.useMemo(
    () => ({
      getBoundingClientRect() {
        let formulaBar = formulaBarRef.current;
        let style = formulaBar?.ownerDocument.defaultView?.getComputedStyle(formulaBar);
        if (formulaBar === null || style === undefined) return new DOMRect();
        let { left: barLeft, top: barTop, height: barHeight } = formulaBar.getBoundingClientRect();
        let insetLeft = Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft);
        return new DOMRect(barLeft + insetLeft, barTop, 0, barHeight);
      },
    }),
    [],
  );
  let closeCalendar = React.useCallback(() => {
    clicksSinceCaretMovedRef.current = 0;
    store.dispatch({
      kind: 'calendarClosed',
    });
  }, [store]);
  let closeCalendarIfStill = React.useCallback<CalendarUnderCellProps['onGivenUp']>(
    (ifStill) =>
      store.dispatch({
        kind: 'calendarClosed',
        ifStill,
      }),
    [store],
  );
  let chooseDay = React.useCallback<CalendarUnderCellProps['onDayChosen']>(
    (day, time) => {
      clicksSinceCaretMovedRef.current = 0;
      lastProgrammaticActMsRef.current = performance.now();
      store.dispatch({
        kind: 'dayChosen',
        day,
        ...(time !== null && {
          time,
        }),
      });
    },
    [store],
  );
  let chooseTime = React.useCallback<CalendarUnderCellProps['onTimeChosen']>(
    (time, today, thenCalendar) => {
      clicksSinceCaretMovedRef.current = 0;
      store.dispatch({
        kind: 'timeChosen',
        time,
        today: today,
        thenCalendar,
      });
    },
    [store],
  );
  let onCalendarKeyDown = React.useCallback<CalendarUnderCellProps['onKeyDown']>(
    (event) => {
      if (event.nativeEvent.isComposing || isAltShortcutKey(event)) return;
      let key = normalizedKeyEvent(event);
      let { mode: latestMode, viewOnlyBecause } = store.getView();
      let actWhileNavigating = keyActOf(NAVIGATING_MODE, key, null, 'leaves');
      let isTypingStart = actWhileNavigating?.kind === 'startEditing' && actWhileNavigating.text !== null && actWhileNavigating.text !== ' ';
      if (latestMode.kind === 'editing' && (isTypingStart || actWhileNavigating?.kind === 'clearCells'))
        return activeEditorRef.current?.focus({
          preventScroll: true,
        });
      let act = keyActOf(latestMode, key, null, 'leaves');
      if (
        !(
          (act?.kind === 'startEditing' && act.text !== ' ') ||
          act?.kind === 'clearCells' ||
          (act?.kind === 'fill' && viewOnlyBecause === null) ||
          act?.kind === 'undoOrRedo' ||
          act?.kind === 'formatCells' ||
          act?.kind === 'askForMenu'
        )
      )
        return;
      event.preventDefault();
      store.dispatch({
        kind: 'keyPressed',
        ...key,
      });
    },
    [store],
  );
  let isColumnWidthFieldOpen = view.menu?.holds === 'columnWidthField';
  let chooseColumnWidth = React.useCallback<ColumnWidthDialogProps['onWidthChosen']>(
    (widthInPixels) => {
      clicksSinceCaretMovedRef.current = 0;
      store.dispatch({
        kind: 'columnWidthChosen',
        widthInPixels,
      });
    },
    [store],
  );
  let chooseCellsToSort = React.useCallback(
    (chosen: CellsToSortChosen['chosen']) => {
      clicksSinceCaretMovedRef.current = 0;
      store.dispatch({
        kind: 'cellsToSortChosen',
        chosen,
        ...(likelyHasKeyboard()
          ? {}
          : {
              isWithNoKeyboard: true,
            }),
      });
    },
    [store],
  );
  let isRowHeightFieldOpen = view.menu?.holds === 'rowHeightField';
  let chooseRowHeight = React.useCallback<RowHeightDialogProps['onHeightChosen']>(
    (chosen) => {
      clicksSinceCaretMovedRef.current = 0;
      store.dispatch({
        kind: 'rowHeightChosen',
        chosen,
      });
    },
    [store],
  );
  let typeCustomNumberFormat = React.useCallback<CustomNumberFormatDialogProps['onTyped']>(
    (pattern, isOfUndoOrRedo) =>
      store.dispatch({
        kind: 'customNumberFormatTyped',
        pattern,
        ...(isOfUndoOrRedo && {
          isOfUndoOrRedo,
        }),
      }),
    [store],
  );
  let enterCustomNumberFormat = React.useCallback<CustomNumberFormatDialogProps['onEntered']>(
    (howActBegan) =>
      store.dispatch({
        kind: 'customNumberFormatEntered',
        ...howActBegan,
      }),
    [store],
  );
  let dropCustomNumberFormat = React.useCallback(
    () =>
      store.dispatch({
        kind: 'customNumberFormatDropped',
      }),
    [store],
  );
  let escapeCustomNumberFormat = React.useCallback(
    () =>
      store.dispatch({
        kind: 'customNumberFormatEscaped',
      }),
    [store],
  );
  let askAgentForNumberFormat = React.useCallback<CustomNumberFormatDialogProps['onAgentAsked']>(
    (howActBegan) =>
      store.dispatch({
        kind: 'agentAskedForNumberFormat',
        ...howActBegan,
      }),
    [store],
  );
  let holdActAtNumberFormat = React.useCallback(
    (howActBegan: HowActBegan = {}) =>
      store.dispatch({
        kind: 'actHeldAtAgentsAnswer',
        at: 'numberFormat',
        ...howActBegan,
      }),
    [store],
  );
  let answerPasteThatWaits = React.useCallback(
    (nth: number, isToBePasted: boolean) =>
      store.dispatch({
        kind: 'pasteThatWaitsAnswered',
        nth,
        isToBePasted,
      }),
    [store],
  );
  let { timeZone, locale, examplesOfNumberFormats } = view;
  let dateExample = React.useMemo(
    () => ({
      locale,
      march15: exampleOfChoice(examplesOfNumberFormats, 'date'),
    }),
    [locale, examplesOfNumberFormats],
  );
  let leaveEntryIfEditing = React.useCallback(() => {
    if (store.getView().mode.kind === 'editing')
      store.dispatch({
        kind: 'entryLeft',
      });
  }, [store]);
  let workbookSettings = React.useMemo(
    () => ({
      locale,
      examples: examplesOfNumberFormats,
      onLocaleAsked: () => {
        leaveEntryIfEditing();
        store.dispatch({
          kind: 'pickForWorkbookAsked',
          of: 'locale',
        });
      },
      timeZone,
      onTimeZoneAsked: () => {
        leaveEntryIfEditing();
        store.dispatch({
          kind: 'pickForWorkbookAsked',
          of: 'timeZone',
          nameInBrowser: browserTimeZone(),
        });
      },
    }),
    [store, locale, examplesOfNumberFormats, timeZone, leaveEntryIfEditing],
  );
  let pickForWorkbook = React.useCallback<LocaleTimeZoneDialogProps['onPicked']>(
    (of, value) =>
      store.dispatch({
        kind: 'pickedForWorkbook',
        of,
        value,
      }),
    [store],
  );
  let enterPickForWorkbook = React.useCallback(
    () =>
      store.dispatch({
        kind: 'pickForWorkbookEntered',
      }),
    [store],
  );
  let dropPickForWorkbook = React.useCallback(
    () =>
      store.dispatch({
        kind: 'pickForWorkbookDropped',
      }),
    [store],
  );
  let answerImportQuestion = React.useCallback<ImportDialogProps['onAnswered']>(
    (questionId, optionIndex) =>
      store.dispatch({
        kind: 'importQuestionAnswered',
        questionId,
        optionIndex,
      }),
    [store],
  );
  let chooseImportDestination = React.useCallback<ImportDialogProps['onDestinationPicked']>(
    (destination) =>
      store.dispatch({
        kind: 'importDestinationChosen',
        picked: destination,
      }),
    [store],
  );
  let changeImportByHand = React.useCallback<ImportDialogProps['onChangedByHand']>(
    (change) =>
      store.dispatch({
        kind: 'importChangedByHand',
        change: change,
      }),
    [store],
  );
  let askImportKinds = React.useCallback<ImportDialogProps['onKindsWanted']>(
    (columnIndex) =>
      store.dispatch({
        kind: 'importKindsAskedFor',
        columnIndex: columnIndex,
      }),
    [store],
  );
  let sendImportWish = React.useCallback<ImportDialogProps['onWished']>(
    (wish) =>
      store.dispatch({
        kind: 'importWishSent',
        wish: wish,
      }),
    [store],
  );
  let askImportPlanAgain = React.useCallback(
    () =>
      store.dispatch({
        kind: 'importPlanAskedAgain',
      }),
    [store],
  );
  let stopAwaitingImportPlan = React.useCallback(
    () =>
      store.dispatch({
        kind: 'importPlanAwaitedNoLonger',
      }),
    [store],
  );
  let confirmImport = React.useCallback(
    (plansHeardCount: number) =>
      store.dispatch({
        kind: 'importConfirmed',
        plansHeardCount,
      }),
    [store],
  );
  let latestAfterDialogRef = React.useRef(isPageLeftUnpressed);
  React.useInsertionEffect(() => {
    latestAfterDialogRef.current = isPageLeftUnpressed;
  });
  let callLatestAfterDialog = React.useCallback(() => latestAfterDialogRef.current(), []);
  let noteDialogReturn = React.useCallback<ImportDialogProps['onCaretOwed']>((returnTo) => {
    focusLostToNothingRef.current = returnTo;
    isDialogOwedCaretRef.current = true;
    fieldLeftForMenuRef.current = null;
  }, []);
  let shutXlsxFileDialog = React.useCallback(() => {
    store.dispatch({
      kind: 'xlsxFileDialogShut',
    });
  }, [store]);
  let chooseSheetChange = React.useCallback<CellContextMenuProps['onChangeChosen']>(
    (change) =>
      store.dispatch({
        kind: 'sheetChangeChosen',
        change: change,
        ...(likelyHasKeyboard()
          ? {}
          : {
              isWithNoKeyboard: true,
            }),
      }),
    [store],
  );
  let chooseColumnToSortBy = React.useCallback<CellContextMenuProps['onColumnToSortByChosen']>(
    (columnId) =>
      store.dispatch({
        kind: 'columnToSortByChosen',
        columnId,
        ...(likelyHasKeyboard()
          ? {}
          : {
              isWithNoKeyboard: true,
            }),
      }),
    [store],
  );
  let chooseFreeze = React.useCallback<CellContextMenuProps['onFreezeChosen']>(
    (what, count) =>
      store.dispatch({
        kind: 'freezeChosen',
        what,
        count,
      }),
    [store],
  );
  let leaveGroupMargin = React.useCallback(() => {
    if (((cellsRef.current?.ownerDocument.activeElement ?? null)?.closest('.sheet-group-margin') ?? null) !== null) focusCaret();
  }, [focusCaret]);
  let onGroupMarkPressed = React.useCallback<GroupMarginProps['onMarkPressed']>(
    (of, { groupIds, isCollapsed }) => {
      store.dispatch({
        kind: 'groupMarkPressed',
        of,
        groupIds,
        isToCollapse: !isCollapsed,
      });
      leaveGroupMargin();
    },
    [store, leaveGroupMargin],
  );
  let chooseGroupLevel = React.useCallback(
    (of: GroupLevelChosen['of'], level: number, choice: ChoiceMadeIn = NO_CHOSEN_IN) => {
      store.dispatch({
        kind: 'groupLevelChosen',
        of,
        level,
        ...choice,
      });
      leaveGroupMargin();
    },
    [store, leaveGroupMargin],
  );
  let chooseGroupLevelFromMenu = React.useCallback<CellContextMenuProps['onGroupLevelChosen']>(
    (lines, level) => chooseGroupLevel(lines, level, CHOSEN_IN_MENU),
    [chooseGroupLevel],
  );
  let openLinkFromMenu = React.useCallback<CellContextMenuProps['onLinkOpened']>(
    (linkUrl) => {
      openLink(linkUrl, 'typed');
      focusCaret();
    },
    [openLink, focusCaret],
  );
  let chooseComment = React.useCallback(() => {
    store.dispatch({
      kind: 'commentChosen',
      chosenIn: 'menu',
    });
    noteCommentChosen();
  }, [store, noteCommentChosen]);
  let askWhetherAgentCanBeSent = React.useCallback(() => commentsOfHost.askWhetherAgentCanBeSent(), [commentsOfHost]);
  React.useEffect(() => commentsOfHost.askWhetherAgentCanBeSent(), [commentsOfHost]);
  let couldSendToAgent = React.useCallback(() => commentsOfHost.couldSendToAgentWhenLastAnswered(), [commentsOfHost]);
  let isChatOfferedInMenu = React.useCallback(
    () => chatWithAgent.isToBeHad() === true && !chatWithAgent.isBesidePage(),
    [chatWithAgent],
  );
  let chooseCommentForAgent = React.useCallback(() => {
    store.dispatch({
      kind: 'commentChosen',
      isForAgent: true,
      chosenIn: 'menu',
    });
    noteCommentChosen();
  }, [store, noteCommentChosen]);
  let commentInsteadOfChat = (cells: Pick<SelectionForAgent, 'sheetNumber' | 'range'>, wereKeysKeptOff: boolean) => {
    let latestView = store.getView();
    let offers = {
      isFieldOnTop: !isCoarsePointerNow() && latestView.viewOnlyBecause === null,
      isChatToBeHad: chatWithAgent.isToBeHad(),
      isCommentOffered: latestView.isCommentOffered,
      doCellsShowError: doesSelectionShowError(latestView),
      couldCommentGoToAgent: couldSendToAgent(),
    };
    let where = {
      selected: latestView.selectionByAddress,
      place: whereIsFocus(),
      isInMenuThatPressShut: latestView.menu === null && (getActiveElement()?.closest(`[${MENU_ON_CELLS_ATTRIBUTE}]`) ?? null) !== null,
      hasPauseHeld: wereKeysKeptOff,
      isEventUnfinished: !store.isNextEventHandledAtOnce(),
      areCellsInView: (latestView.grid.selectionBox ?? latestView.grid.activeCellBox) !== null,
    };
    if (!shouldEnterCommentForAgent(offers, cells, where)) return false;
    store.dispatch({
      kind: 'commentChosen',
      isForAgent: true,
    });
    noteCommentChosen();
    return true;
  };
  let askCopyOrCutFromMenu = React.useCallback<CellContextMenuProps['onCopyOrCutChosen']>(
    (asked) => {
      store.dispatch({
        kind: 'menuClosed',
      });
      if (clipboard.askBrowserToCopyOrCutCells(asked)) return;
      isContextBarMenuByKeyRef.current = false;
      store.dispatch({
        kind: 'copyRefused',
        asked,
        keyInstead: likelyHasKeyboard() ? PRIMARY_MODIFIER_NAME : null,
      });
    },
    [store, clipboard],
  );
  let chooseChartCopy = React.useCallback(() => {
    store.dispatch({
      kind: 'menuClosed',
    });
    let doc = cellsRef.current?.ownerDocument;
    if (doc === undefined || !wasExecCommandHandled(doc, 'copy'))
      store.dispatch({
        kind: 'copyRefused',
        asked: 'copy',
        keyInstead: likelyHasKeyboard() ? PRIMARY_MODIFIER_NAME : null,
      });
  }, [store]);
  let pasteFromMenu = React.useCallback<CellContextMenuProps['onPasteChosen']>(
    (asked) => {
      let pasteEvent = pasteOfLastPutHere(clipboard, asked);
      let { menu: latestMenu } = store.getView();
      if (pasteEvent === null || latestMenu === null || isMenuHoldingField(latestMenu)) return;
      store.dispatch({
        kind: 'menuClosed',
      });
      store.dispatch(pasteEvent);
    },
    [store, clipboard],
  );
  let clearCellsFromMenu = React.useCallback(
    () =>
      store.dispatch({
        kind: 'sheetChangeChosen',
        change: 'clearCells',
        ...(likelyHasKeyboard()
          ? {}
          : {
              isWithNoKeyboard: true,
            }),
      }),
    [store],
  );
  let toggleFormulasShown = React.useCallback(
    () =>
      store.dispatch({
        kind: 'formulasShownToggled',
      }),
    [store],
  );
  let chooseDensity = React.useCallback<RowHeightDialogProps['onDensityChosen']>(
    (chosenDensity) => {
      store.dispatch({
        kind: 'densityChosen',
        density: chosenDensity,
      });
      store.onceEventsAreFinished(() => {
        if (store.getView().density === chosenDensity) storeDensity(chosenDensity);
      });
    },
    [store],
  );
  let chooseUndoOrRedo = React.useCallback<ViewMenuProps['onUndoOrRedoChosen']>(
    (direction) =>
      store.dispatch({
        kind: 'undoOrRedoChosen',
        direction,
      }),
    [store],
  );
  let askListOfKeys = React.useCallback(() => {
    focusBeforeKeysListRef.current = null;
    placementBeforeKeysListRef.current = null;
    store.dispatch({
      kind: 'listOfKeysAsked',
    });
  }, [store]);
  let shutListOfKeys = React.useCallback(
    () =>
      store.dispatch({
        kind: 'listOfKeysShut',
      }),
    [store],
  );
  let askCellHistory = React.useCallback(
    () =>
      store.dispatch({
        kind: 'cellHistoryAsked',
        chosenIn: 'menu',
      }),
    [store],
  );
  let chooseCellHistoryScope = React.useCallback(
    (scope: CellHistoryScope) =>
      store.dispatch({
        kind: 'cellHistoryScopeChosen',
        scope,
      }),
    [store],
  );
  let askCellHistoryAgain = React.useCallback(
    () =>
      store.dispatch({
        kind: 'cellHistoryAskedAgain',
      }),
    [store],
  );
  let lookAtCellHistoryAgain = React.useCallback(
    () =>
      store.dispatch({
        kind: 'cellHistoryLookedAtAgain',
      }),
    [store],
  );
  let shutCellHistory = React.useCallback(
    () =>
      store.dispatch({
        kind: 'cellHistoryShut',
      }),
    [store],
  );
  let askOwnFilter = React.useCallback(
    () =>
      store.dispatch({
        kind: 'ownFilterAsked',
        chosenIn: 'menu',
      }),
    [store],
  );
  let chooseOwnFilterByCell = React.useCallback<CellContextMenuProps['onOwnFilterByCellChosen']>(
    (keeps) =>
      store.dispatch({
        kind: 'ownFilterByCellChosen',
        keeps,
        chosenIn: 'menu',
      }),
    [store],
  );
  let shutOwnFilterList = React.useCallback(
    () =>
      dispatchToOwnFilterList({
        kind: 'ownFilterListShut',
      }),
    [dispatchToOwnFilterList],
  );
  let removeOwnFilterLine = React.useCallback<OwnFilterBarViewProps['onLineRemoved']>(
    (tableKey, lineIndex) => {
      let { ownFilterList } = store.getView();
      if (ownFilterList !== null) shutOwnFilterList();
      if (ownFilterList?.isOnTrial !== true || ownFilterList.tableKey !== tableKey)
        dispatchToOwnFilterList({
          kind: 'ownFilterLineRemoved',
          tableKey,
          lineIndex,
        });
    },
    [store, shutOwnFilterList, dispatchToOwnFilterList],
  );
  let removeOwnSort = React.useCallback<OwnFilterBarViewProps['onSortRemoved']>(
    (tableKey) =>
      dispatchToOwnFilterList({
        kind: 'ownSortRemoved',
        tableKey,
      }),
    [dispatchToOwnFilterList],
  );
  let makeOwnSortForEveryone = React.useCallback(
    (tableKey: string) => {
      store.dispatch({
        kind: 'ownSortMadeForEveryone',
        tableKey,
        ...(likelyHasKeyboard()
          ? {}
          : {
              isWithNoKeyboard: true,
            }),
      });
      focusCaret();
    },
    [store, focusCaret],
  );
  let mayNamedViewsChange = view.viewOnlyBecause === null;
  let actsOnNamedViews = React.useMemo<Omit<NamedViewsMenuProps, 'views'>>(
    () => ({
      onPicked: (tableKey, namedViewId) => {
        if (store.getView().mode.kind === 'editing')
          store.dispatch({
            kind: 'entryLeft',
          });
        store.dispatch({
          kind: 'namedViewPicked',
          tableKey,
          namedViewId,
        });
      },
      onChanged: mayNamedViewsChange
        ? (tableKey, change) =>
            store.dispatch({
              kind: 'namedViewsChanged',
              tableKey,
              change,
            })
        : null,
      onOpenChange: onNamedViewsLayerOpenChange,
      whatHasCaretAfter,
    }),
    [store, mayNamedViewsChange, onNamedViewsLayerOpenChange, whatHasCaretAfter],
  );
  let clearOwnFilters = React.useCallback(
    (of: OwnFiltersCleared['of'], choice: ChoiceMadeIn = NO_CHOSEN_IN) =>
      dispatchToOwnFilterList({
        kind: 'ownFiltersCleared',
        of,
        ...choice,
      }),
    [dispatchToOwnFilterList],
  );
  let clearOwnFiltersOfTable = React.useCallback<CellContextMenuProps['onOwnFilterRemoved']>(
    (tableKey) =>
      clearOwnFilters(
        {
          tableKey,
        },
        CHOSEN_IN_MENU,
      ),
    [clearOwnFilters],
  );
  let clearOwnFiltersOfSheet = React.useCallback<OwnFilterBarViewProps['onCleared']>(
    (sheetId) =>
      clearOwnFilters({
        sheetId,
      }),
    [clearOwnFilters],
  );
  let isTableFormatKeptOffRef = React.useRef(false);
  let chooseFormatAsTable = React.useCallback<CellContextMenuProps['onFormatAsTableChosen']>(
    (isOn) => {
      let kept = isTableFormatKeptOffRef.current ? null : readTablesNotFormatted();
      store.dispatch({
        kind: 'formatAsTableChosen',
        chosenIn: 'menu',
        isOn,
        kept,
      });
    },
    [store],
  );
  let tablesNotFormattedSeenRef = React.useRef(view.tablesNotFormatted);
  React.useEffect(() => {
    if (view.tablesNotFormatted === tablesNotFormattedSeenRef.current) return;
    tablesNotFormattedSeenRef.current = view.tablesNotFormatted;
    isTableFormatKeptOffRef.current = !writeTablesNotFormatted(view.tablesNotFormatted);
  }, [view.tablesNotFormatted]);
  let refreshOwnFilters = React.useCallback<OwnFilterBarViewProps['onRefreshed']>(
    (sheetId) =>
      store.dispatch({
        kind: 'ownFiltersRefreshed',
        sheetId,
      }),
    [store],
  );
  let lookAtOwnFiltersAgain = React.useCallback<OwnFilterBarViewProps['onLookAgain']>(
    (sheetId) =>
      store.dispatch({
        kind: 'ownFiltersLookedAtAgain',
        sheetId,
      }),
    [store],
  );
  let askOwnFilterList = React.useCallback(
    (tableKey: string, c: ColumnId) =>
      store.dispatch({
        kind: 'ownFilterListAsked',
        tableKey,
        c,
        today: todayDate(),
      }),
    [store],
  );
  let isFilterListLeftByPressRef = React.useRef(false);
  let clearFilterListLeftByPress = React.useCallback(() => {
    isFilterListLeftByPressRef.current = false;
  }, []);
  const [filterListOpener, setFilterListOpener] = React.useState<FilterListOpener | null>(null);
  let filterListOpenerElement = filterListOpener?.opener ?? null;
  let onFilterButtonPressed = React.useCallback(
    ({ tableKey, r, c, isOfFoundTable, isListOpen }: FilterButtonPressed) => {
      if (isListOpen && store.getView().ownFilterList !== null) return shutOwnFilterList();
      setFilterListOpener(null);
      if (!isOfFoundTable) return askOwnFilterList(tableKey, c);
      if (store.getView().rowsAskedFor !== null) onMenuOpenChange('sort', false, null);
      return isListOpen
        ? undefined
        : onMenuOpenChange('sort', true, null, {
            r,
            c,
          });
    },
    [store, askOwnFilterList, shutOwnFilterList, onMenuOpenChange],
  );
  let openFilterListAt = React.useCallback<OwnFilterBarViewProps['onColumnAsked']>(
    (tableKey, c, opener) => {
      let chip = opener?.closest('li') ?? null;
      let { ownFilterList } = store.getView();
      if (chip !== null && ownFilterList?.tableKey === tableKey && ownFilterList.c === c) return shutOwnFilterList();
      isFilterListLeftByPressRef.current = false;
      let rect = (chip ?? opener ?? cellsRef.current)?.getBoundingClientRect() ?? new DOMRect();
      setFilterListOpener({
        opener,
        isChip: chip !== null,
        anchor: {
          getBoundingClientRect: () => rect,
        },
        tableKey,
        c,
      });
      if (store.getView().mode.kind === 'editing')
        store.dispatch({
          kind: 'entryLeft',
        });
      askOwnFilterList(tableKey, c);
      store.lookOnceEventsAreFinished(() => {
        if (store.getView().ownFilterList === null) setFilterListOpener(null);
      });
    },
    [store, askOwnFilterList, shutOwnFilterList],
  );
  let onFilterListAct = React.useCallback<OwnFilterListActs>(
    (act) => {
      if (act.kind === 'take') {
        lastProgrammaticActMsRef.current = performance.now();
        clicksSinceCaretMovedRef.current = 0;
      }
      store.dispatch({
        kind: 'ownFilterListActedIn',
        act,
      });
    },
    [store],
  );
  let chooseFilterListSort = React.useCallback(
    (direction: SortDirection) => {
      lastProgrammaticActMsRef.current = performance.now();
      clicksSinceCaretMovedRef.current = 0;
      store.dispatch({
        kind: 'ownFilterListSortChosen',
        direction,
        ...(likelyHasKeyboard()
          ? {}
          : {
              isWithNoKeyboard: true,
            }),
      });
    },
    [store],
  );
  let forgetClosedFilterListOpener = React.useCallback(() => {
    if (store.getView().ownFilterList === null) setFilterListOpener(null);
  }, [store]);
  let whatHasCaretAfterOwnFilterList = React.useCallback(() => {
    let { rowsAskedFor: latestRowsAskedFor, ownFilterList } = store.getView();
    return whatHasCaretAfterFilterList({
      opener: filterListOpenerElement?.isConnected === true ? filterListOpenerElement : null,
      isOtherCardOpen: latestRowsAskedFor !== null || ownFilterList !== null,
      isLeftByPress: isFilterListLeftByPressRef.current,
      otherwise: whatHasCaretAfterLayer,
    });
  }, [store, filterListOpenerElement, whatHasCaretAfterLayer]);
  let chooseFigure = React.useCallback<CellContextMenuProps['onFigureChosen']>(
    (figure) =>
      store.dispatch({
        kind: 'figureChosen',
        figure,
      }),
    [store],
  );
  let onPartKeyDown = React.useCallback(
    (event: React.KeyboardEvent<Element>, part: PagePart, layer: HeldBackLayer | null, cellsTarget: HTMLElement | null = null) => {
      let key = normalizedKeyEvent(event);
      let isInLayer = isKeyForLayer(event, layer);
      if (key.key === 'F6' && !key.isAltHeld && (key.isRepeat || isInLayer)) event.preventDefault();
      let focusMove = isInLayer ? null : focusMoveOfKey(key);
      if (focusMove === null) return;
      if (focusMove === 'cells')
        (cellsTarget ?? getTypingTargetElement())?.focus({
          preventScroll: true,
        });
      else if (!moveCaretTo(part, focusMove === 'nextPart' ? 1 : -1)) return;
      if (focusMove !== 'cells' || !store.getView().isCommentModeOn) event.preventDefault();
      if (part === 'formatTools' && focusMove === 'cells')
        store.dispatch({
          kind: 'contextBarLeftByKey',
        });
    },
    [store, moveCaretTo, isKeyForLayer, getTypingTargetElement],
  );
  let onToolsKeyDownForCells = React.useCallback(
    (event: React.KeyboardEvent<Element>, layer: HeldBackLayer | null, actKind: KeyAct['kind'] | null, isFromInputAllowed = false) => {
      let isInInput = event.target instanceof HTMLInputElement && !isFromInputAllowed;
      if (event.defaultPrevented || isInInput || isKeyForLayer(event, layer)) return;
      let key = normalizedKeyEvent(event);
      let keyActKind = keyActOf(store.getView().mode, key, null, 'leaves')?.kind;
      if (keyActKind === undefined || (keyActKind !== 'undoOrRedo' && keyActKind !== actKind)) return;
      event.preventDefault();
      store.dispatch({
        kind: 'keyPressed',
        ...key,
      });
    },
    [store, isKeyForLayer],
  );
  let returnFocusIfOnBody = React.useCallback(() => {
    let active = cellsRef.current?.ownerDocument.activeElement ?? null;
    if (active === active?.ownerDocument.body) focusCaret();
  }, [focusCaret]);
  let watchCaretLeaving = React.useCallback(() => {
    let timesBefore = focusTrackerRef.current?.timesCaretLeft();
    return () => focusTrackerRef.current?.timesCaretLeft() !== timesBefore;
  }, []);
  let openPersonActions = React.useCallback(() => {
    let hasCaretLeft = watchCaretLeaving();
    store.onceEventsAreFinished(() => {
      if (hasCaretLeft()) return;
      askPersonActions(store.getView().mode).forEach((event) => store.dispatch(event));
    });
  }, [store, watchCaretLeaving]);
  let returnFocusToEntry = React.useCallback(() => {
    let { mode: latestMode } = store.getView();
    if (latestMode.kind !== 'editing') return;
    let entryElement = (latestMode.typingIn === 'cell' ? activeEditorRef : formulaBarRef).current;
    let active = entryElement?.ownerDocument.activeElement ?? null;
    if (active === entryElement) return;
    if (isPageLeftWithoutPointer()) {
      isEditKeptOnBlurRef.current = true;
      if (functionsButtonRef.current?.contains(active) === true) blurQuietly(active);
      return;
    }
    isFocusingFieldRef.current = true;
    try {
      entryElement?.focus({
        preventScroll: true,
      });
    } finally {
      isFocusingFieldRef.current = false;
    }
  }, [store, isPageLeftWithoutPointer, blurQuietly]);
  let askAllFunctions = React.useCallback(
    (
      { detail }: Pick<React.MouseEvent, 'detail'> = {
        detail: 0,
      },
    ) => {
      if (detail > 1) return;
      let hasCaretLeft = watchCaretLeaving();
      store.onceEventsAreFinished(() => {
        if (hasCaretLeft()) return;
        let { mode: latestMode } = store.getView();
        if (latestMode.kind === 'editing' && !isFormulaText(latestMode.text))
          store.dispatch({
            kind: 'entryLeft',
          });
        store.dispatch({
          kind: 'allFunctionsAskedFor',
        });
        store.lookOnceEventsAreFinished(() => {
          if (hasCaretLeft()) return;
          ReactDOM.flushSync(() => {
            return;
          });
          returnFocusToEntry();
        });
      });
    },
    [store, returnFocusToEntry, watchCaretLeaving],
  );
  let onFunctionsButtonKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLSpanElement>) => {
      tabIntoFormulaBar(event, 'functionsButton');
      onPartKeyDown(event, 'functionsButton', null);
    },
    [onPartKeyDown, tabIntoFormulaBar],
  );
  let onFunctionListKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLSpanElement>) => {
      if (event.key !== 'Escape' || store.getView().functionList === null) return;
      event.preventDefault();
      event.stopPropagation();
      store.dispatch({
        kind: 'functionListShut',
      });
      returnFocusToEntry();
    },
    [store, returnFocusToEntry],
  );
  let onFormatToolsKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => onPartKeyDown(event, 'formatTools', null), [onPartKeyDown]);
  let onUndoOfTurnKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => onPartKeyDown(event, 'undoOfTurn', null), [onPartKeyDown]);
  let onToolbarKeyDown = React.useCallback<FormattingToolbarProps['onKeyDown']>(
    (event) => {
      onPartKeyDown(event, 'formatTools', 'ofToolbar');
      let isFormatOfSelectionShown = store.getView().formatOfSelection !== null;
      onToolsKeyDownForCells(event, 'ofToolbar', isFormatOfSelectionShown ? 'formatCells' : null);
      if (!event.defaultPrevented && !isKeyForLayer(event, 'ofToolbar'))
        openLinkFromKey(event, normalizedKeyEvent(event), store.getView(), linkOpener, false);
    },
    [onPartKeyDown, onToolsKeyDownForCells, isKeyForLayer, store, linkOpener],
  );
  let onSheetsTabsKeyDown = React.useCallback<SheetPickerProps['onKeyDown']>(
    (event) => {
      onPartKeyDown(event, 'sheets', 'ofSheets');
      onToolsKeyDownForCells(event, 'ofSheets', null);
    },
    [onPartKeyDown, onToolsKeyDownForCells],
  );
  let onSheetsBarKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      onPartKeyDown(event, 'sheets', null);
      onToolsKeyDownForCells(event, null, null);
    },
    [onPartKeyDown, onToolsKeyDownForCells],
  );
  let onOwnFilterBarKeyDown = React.useCallback<OwnFilterBarViewProps['onKeyDown']>(
    (event) => {
      onPartKeyDown(event, 'ownFilterBar', 'ofNamedViews');
      onToolsKeyDownForCells(event, 'ofNamedViews', null);
    },
    [onPartKeyDown, onToolsKeyDownForCells],
  );
  let onPivotTableBarKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      onPartKeyDown(event, 'pivotTableBar', null);
      onToolsKeyDownForCells(event, null, null);
    },
    [onPartKeyDown, onToolsKeyDownForCells],
  );
  let updatePivotTableOutOfDate = React.useCallback(() => {
    let { pivotTableOutOfDateAt: of, mode: latestMode } = store.getView();
    if (of === null) return;
    if (latestMode.kind === 'editing')
      store.dispatch({
        kind: 'entryLeft',
      });
    store.dispatch({
      kind: 'pivotTableUpdateAsked',
      of,
    });
    focusCaret();
  }, [store, focusCaret]);
  let onFiguresKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      onPartKeyDown(event, 'sheets', 'ofFigures');
      onToolsKeyDownForCells(event, 'ofFigures', null);
    },
    [onPartKeyDown, onToolsKeyDownForCells],
  );
  let onSidePaneKeyDown = React.useCallback<ConditionalFormattingPaneProps['onKeyDownInPane']>(
    (event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      let isToCells = focusMoveOfKey(normalizedKeyEvent(event)) === 'cells' && !isKeyForLayer(event, null);
      let { conditionalFormats: latestConditionalFormats, isCommentModeOn } = store.getView();
      if (isToCells && latestConditionalFormats?.doesEscapeStepBack === true) {
        if (!isCommentModeOn) event.preventDefault();
        return store.dispatch({
          kind: 'conditionalFormatsActedIn',
          act: {
            kind: 'stepBack',
          },
        });
      }
      onPartKeyDown(event, 'sidePane', null, getLastFocusedByKey());
      let isNothingTyped = !store.getView().isSomethingTypedInSidePane;
      if (isToCells && isNothingTyped) return shutSidePane();
      if (isToCells)
        getTypingTargetElement()?.focus({
          preventScroll: true,
        });
      if (isNothingTyped) onToolsKeyDownForCells(event, null, null, true);
      return;
    },
    [store, onPartKeyDown, onToolsKeyDownForCells, isKeyForLayer, shutSidePane, getLastFocusedByKey, getTypingTargetElement],
  );
  let onViewToolsKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      tabIntoFormulaBar(event, 'viewTools');
      onPartKeyDown(event, viewToolsRef.current === null ? 'sheets' : 'viewTools', 'ofZoom');
      if (!isAltShortcutKey(event)) onToolsKeyDownForCells(event, 'ofZoom', 'showOrHideFormulas');
    },
    [onPartKeyDown, onToolsKeyDownForCells, tabIntoFormulaBar],
  );
  let chooseCellFormat = React.useCallback(
    (choice: FormatCommand) => {
      if ('patternToType' in choice) leaveEntryIfEditing();
      else if (isFormatChoiceKeepingEntrySelection(choice)) leaveEntryKeepingSelection();
      if ('toggle' in choice) giveEntryBoxToFormat(store, entryFieldRefs);
      if ('list' in choice) giveEntryBoxOfItsOwn(store, entryFieldRefs);
      store.dispatch({
        kind: 'cellFormatChosen',
        choice,
        chosenIn: 'toolbar',
        ...caretInEntryPatch(store.getView().mode, entryFieldRefs),
      });
      returnFocusIfOnBody();
    },
    [store, entryFieldRefs, leaveEntryIfEditing, leaveEntryKeepingSelection, returnFocusIfOnBody],
  );
  let chooseCellFormatAtFoot = React.useCallback<FormattingToolbarProps['onFormatChosen']>(
    (choice) => {
      chooseCellFormat(choice);
    },
    [chooseCellFormat],
  );
  let askSheetMenu = React.useCallback<FormattingToolbarProps['onSheetMenuAsked']>(
    (button, isByKey) => {
      leaveEntryIfEditing();
      askContextBarMenu(button, isByKey);
    },
    [leaveEntryIfEditing, askContextBarMenu],
  );
  let insertCellControlFromToolbar = React.useCallback<FormattingToolbarProps['onInsertChosen']>(
    (control) =>
      insertCellControl(control, {
        onFormatChosen: chooseCellFormat,
        onPersonChosen: openPersonActions,
      }),
    [chooseCellFormat, openPersonActions],
  );
  let askConditionalFormats = React.useCallback<FormattingToolbarProps['onConditionalFormatsAsked']>(
    (by) => {
      if (by === 'menu') {
        contextBarMenuOpenedByRef.current = null;
        return makeContextBarMenuHandlers().onRulesAskedByRow('toolbar', false);
      }
      store.dispatch({
        kind: 'conditionalFormatsAsked',
        by,
      });
    },
    [store, makeContextBarMenuHandlers],
  );
  let askSortPaneFromToolbar = React.useCallback(
    (of: SortPaneAsked['of']) => {
      askSortPane(of);
    },
    [askSortPane],
  );
  let { conditionalFormats } = view;
  let conditionalFormatsInMenu = conditionalFormats?.drawnAs === 'menu' ? conditionalFormats : null;
  let suggestRulesInMenu = React.useCallback(() => {
    if (menuAt !== null)
      store.dispatch({
        kind: 'rulesSuggestedInMenu',
        menuAt,
      });
  }, [store, menuAt]);
  let onConditionalFormatsActFromCard = React.useCallback(
    (act: RulesPaneAction) => {
      onConditionalFormatsAct(act);
    },
    [onConditionalFormatsAct],
  );
  let askForCommands = React.useCallback<CellContextMenuProps['askForCommands']>(
    (words, options, signal) => {
      menuAtBeforeCloseRef.current = store.getView().menu?.at ?? null;
      let answer = store.askForCommands(words, options, signal);
      pendingBlurRef.current = answer;
      let forgetAnswer = () => {
        if (pendingBlurRef.current === answer) pendingBlurRef.current = null;
      };
      answer.then(forgetAnswer, forgetAnswer);
      signal.addEventListener('abort', forgetAnswer, {
        once: true,
      });
      if (signal.aborted) forgetAnswer();
      return answer;
    },
    [store],
  );
  let askRuleInMenu = React.useCallback<CellContextMenuProps['onRuleAskedInWords']>(
    (words) => {
      let menuAtBeforeClose = menuAtBeforeCloseRef.current;
      if (menuAtBeforeClose !== null)
        store.dispatch({
          kind: 'ruleAskedInMenu',
          words,
          menuAt: menuAtBeforeClose,
        });
    },
    [store],
  );
  let letGoOfRuleInMenu = React.useCallback(() => {
    store.dispatch({
      kind: 'ruleInMenuLetGo',
    });
    suggestRulesInMenu();
  }, [store, suggestRulesInMenu]);
  let pointAtRuleSuggestion = React.useCallback<CellContextMenuProps['onSuggestedRulePointedAt']>(
    (rules) =>
      onConditionalFormatsAct({
        kind: 'pointAtSuggestion',
        rules,
      }),
    [onConditionalFormatsAct],
  );
  let takeRuleSuggestion = React.useCallback<CellContextMenuProps['onSuggestedRuleTaken']>(
    (rules) =>
      onConditionalFormatsAct({
        kind: 'takeSuggestion',
        rules,
      }),
    [onConditionalFormatsAct],
  );
  let startOrShowRules = React.useCallback<CellContextMenuProps['onRulesAsked']>(
    (choice) =>
      onConditionalFormatsAct({
        kind: choice === 'newRule' ? 'startRule' : 'showInPane',
      }),
    [onConditionalFormatsAct],
  );
  let keepRulesOffer = React.useCallback(
    () =>
      onConditionalFormatsAct({
        kind: 'keepOffer',
      }),
    [onConditionalFormatsAct],
  );
  let stepBackInRules = React.useCallback(
    () =>
      onConditionalFormatsAct({
        kind: 'stepBack',
      }),
    [onConditionalFormatsAct],
  );
  let chooseBorders = React.useCallback(
    (choice: BorderChoice, pen?: Partial<BorderLine>) =>
      store.dispatch({
        kind: 'bordersChosen',
        choice,
        ...(pen !== undefined && {
          pen,
        }),
      }),
    [store],
  );
  let chooseMergeChange = React.useCallback<FormattingToolbarProps['onMergeChangeChosen']>(
    (change) => {
      leaveEntryIfEditing();
      store.dispatch({
        kind: 'mergeChangeChosenInToolbar',
        change,
      });
      returnFocusIfOnBody();
    },
    [store, leaveEntryIfEditing, returnFocusIfOnBody],
  );
  let setCheckboxesInToolbar = React.useCallback<FormattingToolbarProps['onCheckboxesSet']>(
    (isChecking) => {
      leaveEntryIfEditing();
      store.dispatch({
        kind: 'checkboxesSetInToolbar',
        isChecking,
      });
      returnFocusIfOnBody();
    },
    [store, leaveEntryIfEditing, returnFocusIfOnBody],
  );
  let setCheckboxesOfCellTypes = React.useCallback(
    (isChecking: boolean) => {
      store.dispatch({
        kind: 'checkboxesSetInToolbar',
        isChecking,
      });
      returnFocusIfOnBody();
    },
    [store, returnFocusIfOnBody],
  );
  let chooseSheetChangeInToolbar = React.useCallback<FormattingToolbarProps['onSheetChangeChosen']>(
    (change) => {
      leaveEntryIfEditing();
      store.dispatch({
        kind: 'sheetChangeChosen',
        change,
        chosenIn: 'toolbar',
        ...(likelyHasKeyboard()
          ? {}
          : {
              isWithNoKeyboard: true,
            }),
      });
      returnFocusIfOnBody();
    },
    [store, leaveEntryIfEditing, returnFocusIfOnBody],
  );
  let actOnRowsAskedFor = React.useCallback<SortFilterCardListProps['onAct']>(
    (act) => {
      if (act.kind !== 'take' && act.kind !== 'takeAnswer' && act.kind !== 'takeNamedView')
        return store.dispatch({
          kind: 'rowsAskedForActedOn',
          act,
        });
      store.dispatch({
        kind: 'rowsAskedForActedOn',
        act:
          likelyHasKeyboard() || act.kind === 'takeNamedView'
          ? act
          : {
              ...act,
              isWithNoKeyboard: true,
            },
      });
      return returnFocusIfOnBody();
    },
    [store, returnFocusIfOnBody],
  );
  let askCustomSort = React.useCallback(() => {
    const of = store.getView().areWholeColumnsSelected ? 'sheet' : 'range';
    store.dispatch({
      kind: 'rowsAskedForActedOn',
      act: {
        kind: 'customSort',
        of,
      },
    });
  }, [store]);
  let chooseFigureInToolbar = React.useCallback<FormattingToolbarProps['onFigureChosen']>(
    (figure) => {
      leaveEntryIfEditing();
      store.dispatch({
        kind: 'figureChosen',
        figure,
        chosenIn: 'toolbar',
      });
      returnFocusIfOnBody();
    },
    [store, leaveEntryIfEditing, returnFocusIfOnBody],
  );
  let toggleSidePane = React.useCallback(() => {
    store.dispatch({
      kind: 'sidePaneToggled',
    });
  }, [store]);
  let toggleSidePaneOfCellTypes = React.useCallback(
    () =>
      store.dispatch({
        kind: 'sidePaneToggled',
      }),
    [store],
  );
  let changeBorderPen = React.useCallback<FormattingToolbarProps['onBorderPenChanged']>(
    (change) =>
      store.dispatch({
        kind: 'borderPenChanged',
        change,
      }),
    [store],
  );
  let toggleGridlines = React.useCallback(
    () =>
      store.dispatch({
        kind: 'gridlinesToggled',
      }),
    [store],
  );
  let chooseCellFormatInMenu = React.useCallback<CellContextMenuProps['onFormatChosen']>(
    (choice) =>
      store.dispatch({
        kind: 'cellFormatChosen',
        choice,
        chosenIn: 'menu',
      }),
    [store],
  );
  let insertCellControlFromMenu = React.useCallback<CellContextMenuProps['onInsertChosen']>(
    (control) =>
      insertCellControl(control, {
        onToolUsed: () => {},
        onFormatChosen: chooseCellFormatInMenu,
        onPersonChosen: openPersonActions,
      }),
    [chooseCellFormatInMenu, openPersonActions],
  );
  let choosePeopleListRow = React.useCallback<PeopleListProps['onRowChosen']>(
    (row) => {
      clicksSinceCaretMovedRef.current = 0;
      lastProgrammaticActMsRef.current = performance.now();
      store.dispatch({
        kind: 'peopleListRowChosen',
        row,
      });
    },
    [store],
  );
  let pressWordsOffered = React.useCallback<WordsOfferedButtonProps['onPressed']>(
    ({ cellId, typed, offered }, pressedAt) => {
      clicksSinceCaretMovedRef.current = 0;
      lastProgrammaticActMsRef.current = pressedAt;
      store.dispatch({
        kind: 'wordsOfferedPressed',
        cellId,
        typed,
        offered,
      });
    },
    [store],
  );
  let askCardByRestingPointer = React.useCallback<DropdownListUnderCellProps['onCardAsked']>(
    (ofRow) =>
      store.dispatch({
        kind: 'cardAskedByRestingPointer',
        ofRow,
      }),
    [store],
  );
  let askCardOfOption = React.useCallback<DropdownListUnderCellProps['onCardOfOptionAsked']>(
    (optionId) => {
      clicksSinceCaretMovedRef.current = 0;
      store.dispatch({
        kind: 'cardOfOptionAsked',
        optionId,
      });
    },
    [store],
  );
  let nameOptionsInList = React.useCallback<DropdownListUnderCellProps['onOptionsNamed']>(
    (naming, onDone) =>
      dispatchThenNoteChange(
        {
          kind: 'optionsNamedInList',
          ...naming,
        },
        () => onDone(store.getView().dropdownList),
      ),
    [dispatchThenNoteChange, store],
  );
  let stopNamingNewOption = React.useCallback(
    () =>
      store.dispatch({
        kind: 'newOptionNoLongerNamed',
      }),
    [store],
  );
  let moveOptionInList = React.useCallback<DropdownListUnderCellProps['onOptionMoved']>(
    (move, onDone) =>
      dispatchThenNoteChange(
        {
          kind: 'optionMovedInList',
          ...move,
        },
        onDone,
      ),
    [dispatchThenNoteChange],
  );
  let focusKeptOnListRowRef = React.useRef<Element | null>(null);
  let giveCaretBackToCells = React.useCallback(
    () =>
      getTypingTargetElement()?.focus({
        preventScroll: true,
      }),
    [getTypingTargetElement],
  );
  let isAnythingOpenUnderCell = view.openUnderCell !== null;
  React.useLayoutEffect(() => {
    let row = focusKeptOnListRowRef.current;
    if (row === null || (row.isConnected && isAnythingOpenUnderCell)) return;
    focusKeptOnListRowRef.current = null;
    let { activeElement, body } = row.ownerDocument;
    let caretTarget = activeElement === row || activeElement === body ? whatHasCaretAfter() : false;
    if (caretTarget !== false)
      caretTarget.focus({
        preventScroll: true,
      });
  });
  let chooseCardRow = React.useCallback<DropdownListUnderCellProps['onCardRowChosen']>(
    (row) => {
      clicksSinceCaretMovedRef.current = 0;
      lastProgrammaticActMsRef.current = performance.now();
      store.dispatch({
        kind: 'cardRowChosen',
        row,
      });
    },
    [store],
  );
  let shutCard = React.useCallback(
    () =>
      store.dispatch({
        kind: 'cardShut',
      }),
    [store],
  );
  let onPeopleListBlur = React.useCallback<PeopleListProps['onShut']>(
    (event) => {
      if (event.target instanceof Node && cellsRef.current?.contains(event.target) === true) return;
      if (event.target === formulaBarRef.current) return;
      clicksSinceCaretMovedRef.current = 0;
      store.dispatch({
        kind: 'peopleListShut',
      });
    },
    [store],
  );
  let chooseTimeListRow = React.useCallback<TimeListPopupProps['onRowChosen']>(
    (row) => {
      clicksSinceCaretMovedRef.current = 0;
      lastProgrammaticActMsRef.current = performance.now();
      store.dispatch({
        kind: 'timeListRowChosen',
        row,
      });
    },
    [store],
  );
  let pointAtTimeListRow = React.useCallback<TimeListPopupProps['onRowPointedAt']>(
    (row) =>
      store.dispatch({
        kind: 'timeListRowPointedAt',
        row,
      }),
    [store],
  );
  let onTimeListBlur = React.useCallback<TimeListPopupProps['onShut']>(
    (event) => {
      clicksSinceCaretMovedRef.current = 0;
      if (!(event.target instanceof Node && cellsRef.current?.contains(event.target) === true))
        store.dispatch({
          kind: 'timeListShut',
        });
    },
    [store],
  );
  let dispatchFromEntryHelper = React.useCallback(
    (event: PageEvent) => {
      if (
        event.kind === 'functionListRowChosen' ||
        event.kind === 'formulaOfferRowChosen' ||
        event.kind === 'wordsOfFormulaAskedBack' ||
        event.kind === 'formulaOfAgentKept' ||
        event.kind === 'formulaAskStopped'
      ) {
        clicksSinceCaretMovedRef.current = 0;
        lastProgrammaticActMsRef.current = performance.now();
      }
      if (!(event.kind === 'entryCaretMoved' && !isFormulaText(event.text) && store.getView().grid.editorLooks === undefined)) store.dispatch(event);
    },
    [store],
  );
  let caretInEntryNow = React.useCallback(() => caretInEntryPatch(store.getView().mode, entryFieldRefs), [store, entryFieldRefs]);
  let isSheetPointingBlockedRef = React.useRef(false);
  let canSwitchSheet = React.useCallback<SheetPickerProps['isChosenForFormula']>(
    (sheetId) => {
      let latestView = store.getView();
      let { mode: latestMode, listedSheets, sheetPointedIn, viewOnlyBecause } = latestView;
      let sheet = listedSheets.find((listed) => listed.sheetId === sheetId);
      if (sheetPointedIn === null && sheet?.isShown === true) return false;
      return canSwitchSheetWhileEditing(
        latestMode,
        caretInEntryNow().caretInEntry,
        sheet?.holdsOpenEntry === true,
        viewOnlyBecause === null && sheet?.isInteractive !== true && !isSheetPointingBlockedRef.current && !isFormulaAskedOrProposed(latestView),
      );
    },
    [store, caretInEntryNow],
  );
  let lookOnceEventsAreFinished = React.useCallback<ConditionalFormattingPaneProps['lookOnceEventsAreFinished']>((look) => store.lookOnceEventsAreFinished(look), [store]);
  let dispatchFromSheetTabs = React.useCallback<SheetPickerProps['dispatch']>(
    (event) => {
      let isNameLeftWhileUnderWay = event.kind === 'sheetNameLeft' && focusTrackerRef.current?.isUnderWay() === true;
      let pointingPatch = isSheetPointingBlockedRef.current
        ? {
            canPoint: false,
          }
        : {};
      let eventToSend =
        event.kind === 'sheetChosen'
          ? {
              ...event,
              ...caretInEntryNow(),
              ...pointingPatch,
            }
          : event;
      store.dispatch(
        isNameLeftWhileUnderWay
          ? {
              kind: 'sheetNameLeft',
            }
          : eventToSend,
      );
      if (event.kind === 'sheetListShut' || event.kind === 'sheetListOpened') return;
      store.onceEventsAreFinished(() => {
        let formulaBar = formulaBarRef.current;
        if (formulaBar !== null && formulaBar === formulaBar.ownerDocument.activeElement && store.getView().mode.kind === 'navigating') focusCaret();
      });
      if ((event.kind === 'sheetChosen' || event.kind === 'sheetAddChosen') && cellsRef.current?.ownerDocument.hasFocus() === false) {
        cellsRef.current.ownerDocument.defaultView?.focus();
        getTypingTargetElement()?.focus({
          preventScroll: true,
        });
      }
    },
    [store, getTypingTargetElement, caretInEntryNow, focusCaret],
  );
  let closeToastIfFocusLeft = () => {
    let active = cellsRef.current?.ownerDocument.activeElement;
    if (isFocusOutsideSearchOrErrors(active)) refocusTypingTarget();
  };
  let closeToastIfInsideUnpinned = () => {
    let doc = cellsRef.current?.ownerDocument;
    if (doc?.hasFocus() === true && isInsideUnpinnedToast(doc.activeElement)) refocusTypingTarget();
  };
  let dispatchFileImport = React.useCallback(
    (event: PageEvent) => {
      for (let eventBefore of EVENTS_BEFORE_FILE_IMPORT) store.dispatch(eventBefore);
      store.dispatch(event);
    },
    [store],
  );
  let importFilePicker = useImportFilePicker({
    mostBytes: view.mostBytesOfAFileToImport,
    dispatch: dispatchFileImport,
  });
  let { choose: chooseFileToImport, takeDropped: takeDroppedFile, forget: forgetFileToImport } = importFilePicker;
  let dropImport = React.useCallback(() => {
    forgetFileToImport();
    store.dispatch({
      kind: 'importDropped',
    });
  }, [store, forgetFileToImport]);
  let escapeImport = React.useCallback(
    (isWishTyped: boolean) => {
      let isNoImport = store.getView().importOfAFile === null;
      store.dispatch({
        kind: 'importEscaped',
        ...(isWishTyped && {
          isWishTyped,
        }),
      });
      if (isNoImport) return forgetFileToImport();
      store.onceEventsAreFinished(() => {
        if (store.getView().importOfAFile === null) forgetFileToImport();
      });
    },
    [store, forgetFileToImport],
  );
  let keepImport = React.useCallback(
    () =>
      store.dispatch({
        kind: 'importKept',
      }),
    [store],
  );
  let canImportFile = view.viewOnlyBecause === null && importFileChoices.length > 0;
  React.useEffect(() => {
    if (!canImportFile) return;
    shell.offerImport((isByKey) => {
      if (isModalOpen(store.getView())) return;
      scrollGesture.begin();
      dispatchFileImport({
        kind: 'importAskedByHost',
        isByKey,
      });
    });
    return () => shell.offerImport(null);
  }, [shell, store, dispatchFileImport, canImportFile, scrollGesture]);
  let askFilesForAgent = React.useCallback<SheetPickerProps['onFileForAgentChosen']>(
    (source) => {
      const doc = cellsRef.current?.ownerDocument;
      if (doc?.hasFocus() === false) doc.defaultView?.focus();
      filesForAgent.ask(source);
      clicksSinceCaretMovedRef.current = 0;
    },
    [filesForAgent],
  );
  let takeDroppedImport = React.useCallback(
    (file: FileOrWhyNotRead) => {
      if (!(file instanceof File && isExcelFileName(file) && filesForAgent.offered().includes('computer'))) return takeDroppedFile(file);
      forgetFileToImport();
      dispatchFileImport({
        kind: 'fileToImportNotRead',
        why: 'excelFileDropped',
      });
    },
    [filesForAgent, dispatchFileImport, takeDroppedFile, forgetFileToImport],
  );
  let chooseImportFile = React.useCallback<SheetPickerProps['onImportChosen']>(
    (choices) => {
      if (store.getView().mode.kind !== 'editing') chooseFileToImport(choices);
    },
    [store, chooseFileToImport],
  );
  let chooseImportFileOfAnyKind = React.useCallback(() => chooseImportFile(importFileChoices), [chooseImportFile]);
  let isChatToBeHad = React.useSyncExternalStore(chatWithAgent.subscribe, chatWithAgent.isToBeHad, chatWithAgent.isToBeHad);
  let doesChatTakeWordsAtOnce = React.useSyncExternalStore(
    chatWithAgent.subscribe,
    chatWithAgent.takesWordsAtOnce,
    chatWithAgent.takesWordsAtOnce,
  );
  let cellsAddedToChat = React.useMemo(() => trackCellsAddedToChat(chatWithAgent), [chatWithAgent]);
  let askForRulesInChat = React.useCallback(
    (words: string) => (
      (lastProgrammaticActMsRef.current = performance.now()),
      askAgentForRulesInChat(store, cellsAddedToChat, words).then((isAsked) => {
        let conditionalFormats = store.getView().conditionalFormats;
        if (isAsked && conditionalFormats?.drawnAs === 'card' && conditionalFormats.isAskBeyondRules)
          store.dispatch({
            kind: 'contextBarMenuChanged',
            menu: 'conditionalFormatting',
            isOpen: false,
          });
        return isAsked;
      })
    ),
    [store, cellsAddedToChat],
  );
  let newestChatPressCount = React.useSyncExternalStore(
    cellsAddedToChat.subscribe,
    cellsAddedToChat.newestThatTellsPress,
    cellsAddedToChat.newestThatTellsPress,
  );
  React.useEffect(() => {
    if (newestChatPressCount > 0) observeToasts();
  }, [newestChatPressCount]);
  let selectedPlacementId = view.grid.placedViews.find(({ isSelected }) => isSelected)?.placementId;
  let selectedPlacementIdOnPhone = isOnPhoneHere ? selectedPlacementId : undefined;
  let { areWaysInToComeSoon: areWaysInToComeSoon } = view;
  React.useEffect(() => {
    let win = cellsRef.current?.ownerDocument.defaultView ?? null;
    if (win === null || areWaysInToComeSoon) return;
    let lookAtChat = () => void chatWithAgent.look();
    lookAtChat();
    win.addEventListener('focus', lookAtChat);
    return () => win.removeEventListener('focus', lookAtChat);
  }, [chatWithAgent, areWaysInToComeSoon]);
  let { isAgentOfferedAmongWaysIn } = view;
  let isMenuOpen = view.menu !== null;
  let isRuleEditorOpen = view.conditionalFormats !== null && view.conditionalFormats.editor !== null;
  let isChartMenuOpen = view.contextBarMenu === 'chart';
  let isPeopleListOpen = view.peopleList !== null;
  React.useEffect(() => {
    if (
      (isAgentOfferedAmongWaysIn ||
        selectedPlacementId !== undefined ||
        isMenuOpen ||
        isChartMenuOpen ||
        isRuleEditorOpen ||
        (isPeopleListOpen && !chatWithAgent.isKeptFromLeaving())) &&
      !areWaysInToComeSoon
    )
      chatWithAgent.look();
  }, [
    chatWithAgent,
    isAgentOfferedAmongWaysIn,
    selectedPlacementId,
    isMenuOpen,
    isChartMenuOpen,
    isRuleEditorOpen,
    isPeopleListOpen,
    areWaysInToComeSoon,
  ]);
  let askAgentToFixAfterEdit = React.useCallback(
    () => askAgentToFixOfferedErrors(store, cellsAddedToChat, 'afterEdit'),
    [store, cellsAddedToChat],
  );
  let areErrorsOffered = view.errorsOffered !== null || view.errorsAtOpening !== null;
  React.useEffect(() => {
    if (areErrorsOffered && !areWaysInToComeSoon) chatWithAgent.look();
  }, [chatWithAgent, areErrorsOffered, areWaysInToComeSoon]);
  let putAwayErrorsOffer = React.useCallback(
    () =>
      store.dispatch({
        kind: 'errorsOfferPutAway',
      }),
    [store],
  );
  let [pressForFixesTracker] = React.useState(createPressForFixesTracker);
  React.useEffect(() => pressForFixesTracker.forget, [pressForFixesTracker]);
  let onFixesAct = React.useCallback(
    (act: FixesAct, howActBegan?: HowActBegan) => {
      if (act !== 'asked')
        return store.dispatch({
          kind: act === 'kept' ? 'fixesKept' : 'fixesEnded',
          ...howActBegan,
        });
      if (store.isEventUnfinished()) return;
      pressForFixesTracker.note(cellsRef.current?.ownerDocument.defaultView ?? null);
      return store.dispatch({
        kind: 'fixesInPlaceAsked',
      });
    },
    [store, pressForFixesTracker],
  );
  let returnFocusAfterErrorsNotice = React.useCallback(() => {
    if (cellsRef.current?.ownerDocument.hasFocus() !== true) return;
    let caretAfter = whatHasCaretAfterMenu();
    (caretAfter === false ? getTypingTargetElement() : caretAfter)?.focus({
      preventScroll: true,
    });
  }, [whatHasCaretAfterMenu, getTypingTargetElement]);
  let onErrorsNoticeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<Element>) => {
      if ((event.ctrlKey || event.metaKey || event.altKey) && event.key === 'Escape') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        returnFocusAfterErrorsNotice();
        return putAwayErrorsOffer();
      }
      onPartKeyDown(event, 'errorsNotice', null);
      return onToolsKeyDownForCells(event, null, null);
    },
    [onPartKeyDown, onToolsKeyDownForCells, putAwayErrorsOffer, returnFocusAfterErrorsNotice],
  );
  let onGuideKeyDown = React.useCallback(
    (event: React.KeyboardEvent<Element>) => onPartKeyDown(event, 'guide', null),
    [onPartKeyDown],
  );
  let shownSheetNumber = React.useCallback(
    () => store.getView().listedSheets.findIndex(({ isShown }) => isShown) + 1,
    [store],
  );
  let openChatAboutBlankSheet = React.useCallback(
    () => void chatWithAgent.openAboutBlankSheet(sheetMessages.blankSheet(), shownSheetNumber()),
    [chatWithAgent, shownSheetNumber],
  );
  let [chartMaking, setChartMaking] = React.useState<ChartMaking | null>(null);
  let openChatAboutChart = React.useCallback(
    (chart: string) => {
      setChartMaking(dropAddedChartMaking);
      chatWithAgent.openAboutChart(chartMessages.chart(), chart, shownSheetNumber());
    },
    [chatWithAgent, shownSheetNumber],
  );
  let onChartMadeLastOvertaken = React.useCallback(() => {
    setChartMaking(dropAddedChartMaking);
    if (isTouchBelowSm() || store.getView().isAgentWorking) return;
  }, [store, shell]);
  let [chartChangeUndoNotice, setChartChangeUndoNotice] = React.useState<ChartChangeUndoNotice | null>(null);
  let stepOfChartChange = typeof chartChangeUndoNotice?.says === 'object' ? chartChangeUndoNotice.says.step : null;
  if (stepOfChartChange !== null && (stepOfChartChange !== view.latestStep || view.entryCellKey !== null)) setChartChangeUndoNotice(null);
  let undoChartChange = () => {
    if (stepOfChartChange !== null)
      store.dispatch({
        kind: 'undoOfStepAsked',
        step: stepOfChartChange,
      });
  };
  let renderSettledWordsAnnouncer = React.useCallback(
    (words: string | null, about: string) =>
      <SettledWordsAnnouncer words={words} about={about} store={store} inPageOf={cellsRef} />,
    [store],
  );
  let sendToChatAboutChart = React.useCallback(
    (
      method: 'sendAboutChart' | 'sendPressAboutChart',
      chart: string,
      askWords: string,
      what: string = chartMessages.chart(),
    ): Promise<AskSentToChat> =>
      store.isEventUnfinished() || store.getView().hasUnsavedEdits
        ? Promise.resolve('failed')
        : chatWithAgent[method](what, chart, shownSheetNumber(), askWords),
    [chatWithAgent, shownSheetNumber, store],
  );
  let sendAboutChart = React.useCallback<SendToAgentAboutView>(
    (viewId, words) => sendToChatAboutChart('sendAboutChart', viewId, words),
    [sendToChatAboutChart],
  );
  let sendPressAboutChart = React.useCallback<SendToAgentAboutView>(
    (viewId, words) => sendToChatAboutChart('sendPressAboutChart', viewId, words),
    [sendToChatAboutChart],
  );
  let lookAtChatUnlessComingSoon = React.useCallback(() => {
    if (!areWaysInToComeSoon && chatWithAgent.isToBeHad() !== true) chatWithAgent.look();
    return !areWaysInToComeSoon;
  }, [chatWithAgent, areWaysInToComeSoon]);
  let [wasChatToBeHad, setWasChatToBeHad] = React.useState(false);
  if (isChatToBeHad !== null && isChatToBeHad !== wasChatToBeHad) setWasChatToBeHad(isChatToBeHad);
  let askAgentAboutPaneRule = React.useCallback(
    (rule: RuleNumber) => askAgentAboutRule(store, chatWithAgent, rule),
    [chatWithAgent, store],
  );
  let isChatToBeHadOrWas = isChatToBeHad ?? wasChatToBeHad;
  let canAskInChatAboutRules = isChatToBeHadOrWas && view.selectionByAddress !== null;
  let conditionalFormatsCard = React.useMemo(
    () =>
      conditionalFormats?.drawnAs === 'card'
        ? <ConditionalAskCard pane={conditionalFormats} onAct={onConditionalFormatsActFromCard} onAskedInChat={canAskInChatAboutRules ? askForRulesInChat : null} />
        : null,
    [conditionalFormats, onConditionalFormatsActFromCard, canAskInChatAboutRules, askForRulesInChat],
  );
  let { errorsFoundAtOpening } = view;
  let hasMoreErrorsThanKnown = React.useMemo(
    () =>
      errorsFoundAtOpening !== null &&
      errorsFoundAtOpening !== 'toBeRead' &&
      areMoreErrorsThanKnown(errorsFoundAtOpening.sheetId, errorsFoundAtOpening.count),
    [errorsFoundAtOpening],
  );
  let fixesStage = view.fixesOnCells?.stage ?? null;
  let fixOfferOfMenu = fixOfferInMenu(view, {
    canPersonEdit,
    isChatToBeHad: isChatToBeHad ?? wasChatToBeHad,
  });
  let areFixesOffered = areFixesOnOffer(view.fixesOnCells);
  const isErrorsAtOpeningOffered =
    view.errorsAtOpening !== null && hasMoreErrorsThanKnown && canPersonEdit && (isChatToBeHad === true || areFixesOffered);
  let isAskingFixesAtOpeningRef = React.useRef(false);
  let askFixesOfErrorsAtOpening = async (isInPlace: boolean): Promise<void> => {
    let errorsAtOpening = store.getView().errorsAtOpening;
    if (errorsAtOpening === null || isAskingFixesAtOpeningRef.current) return;
    if (isInPlace) {
      if (store.isEventUnfinished()) return;
      pressForFixesTracker.note(cellsRef.current?.ownerDocument.defaultView ?? null);
      store.dispatch({
        kind: 'fixesOfErrorsAtOpeningAsked',
      });
      store.lookOnceEventsAreFinished(() => {
        if (store.getView().errorsAtOpening?.sheetId === errorsAtOpening.sheetId) return;
        noteErrorsKnownOf(errorsAtOpening.sheetId, errorsAtOpening.count);
        whenFocusStays(closeToastIfFocusLeft, 'dispatchesNothing');
      });
      return;
    }
    isAskingFixesAtOpeningRef.current = true;
    try {
      if (!(await askAgentToFixOfferedErrors(store, cellsAddedToChat, 'atOpening'))) return;
      noteErrorsKnownOf(errorsAtOpening.sheetId, errorsAtOpening.count);
      whenFocusStays(closeToastIfFocusLeft, 'dispatchesNothing');
    } finally {
      isAskingFixesAtOpeningRef.current = false;
    }
  };
  let isAskingChatAfterNoFixRef = React.useRef(false);
  let openChatAfterNoFix = async (): Promise<void> => {
    if (isAskingChatAfterNoFixRef.current) return;
    isAskingChatAfterNoFixRef.current = true;
    try {
      if (await askChatAfterNoFix(store, cellsAddedToChat)) whenFocusStays(closeToastIfFocusLeft, 'dispatchesNothing');
    } finally {
      isAskingChatAfterNoFixRef.current = false;
    }
  };
  let askAgentAboutSelectionFromMenu = React.useCallback<CellContextMenuProps['onAgentAsked']>(
    (mayAskToFix) => void askAgentAboutSelection(cellsAddedToChat, store, mayAskToFix),
    [cellsAddedToChat, store],
  );
  let askFixFromCellMenu = React.useCallback(() => askFixFromMenu(store, closeMenu), [store, closeMenu]);
  let askFixesOfSelectedCells = React.useCallback(() => {
    let errorsAtOpening = store.getView().errorsAtOpening;
    pressForFixesTracker.note(cellsRef.current?.ownerDocument.defaultView ?? null);
    if (!askFixesOfSelectedCellsFromMenu(store, closeMenu)) return pressForFixesTracker.forget();
    store.lookOnceEventsAreFinished(() => {
      if (errorsAtOpening !== null && store.getView().errorsAtOpening?.sheetId !== errorsAtOpening.sheetId)
        noteErrorsKnownOf(errorsAtOpening.sheetId, errorsAtOpening.count);
    });
  }, [store, closeMenu, pressForFixesTracker]);
  React.useEffect(
    () =>
      watchAgentAskedUnderAt(
        store,
        {
          isInStaffTrials,
          chatWithAgent,
          comments: commentsOfHost,
        },
        () => askAgentAboutSelectionFromMenu(false),
      ),
    [store, isInStaffTrials, chatWithAgent, commentsOfHost, askAgentAboutSelectionFromMenu],
  );
  let chartMakingNow = chartMakingForView(chartMaking, view);
  if (chartMakingNow !== chartMaking) setChartMaking(chartMakingNow);
  let addedChartView = placedViewOfAddedChart(chartMaking, view);
  React.useEffect(() => {
    if (chartMaking !== null) observeToasts();
  }, [chartMaking]);
  let addedChartOnCard = addedChartForCard(chartMaking, addedChartView !== undefined, view);
  let { undoOffer, undoOfTurnOffered } = view;
  let undoOfferShown = React.useMemo(
    () =>
      undoOfferToShow({
        undoOffer,
        undoOfTurnOffered,
      }),
    [undoOffer, undoOfTurnOffered],
  );
  let undoOfferOnCard = React.useMemo(
    () => (addedChartOnCard === null ? undoOfferShown : undoOfferOfChartAdded(addedChartOnCard)),
    [addedChartOnCard, undoOfferShown],
  );
  let isPlainUndoOfferShown = addedChartOnCard === null && undoOfferShown?.taken === 'undoOfferTaken';
  let takeUndoOfferShown = () => {
    if (undoOfferShown !== null)
      store.dispatch({
        kind: undoOfferShown.taken,
      });
  };
  let undoAddedChart = () => {
    if (addedChartOnCard === null || addedChartOnCard.step === null) return;
    store.dispatch({
      kind: 'undoOfStepAsked',
      step: addedChartOnCard.step,
    });
    setChartMaking((making) => dropChartMakingOfNth(making, addedChartOnCard.nth));
  };
  let dropChartMaking = (nth: number, isToCloseToast: boolean) => {
    setChartMaking((making) => dropChartMakingOfNth(making, nth));
    if (isToCloseToast) whenFocusStays(closeToastIfFocusLeft, 'dispatchesNothing');
  };
  let isMakingChartRef = React.useRef(false);
  let mayTakeCaretFromBarRef = React.useRef(true);
  let chartMakingNthRef = React.useRef(0);
  let whyChartNotMadeByPageRef = React.useRef<ChartEndWord>('busy');
  let makeChartByPage = React.useMemo(
    () =>
      async (chartKind: ChartKindOrAny, words: string, lateAsk?: LateChartAsk): Promise<boolean | null> => {
        let latestView = store.getView();
        if (!chartsMadeByPage.isToBeHad || latestView.viewOnlyBecause !== null) return null;
        if (latestView.doesCommentModePickCells) return null;
        if (chartKind === 'any' || words !== '') return null;
        if (lateAsk !== undefined && !latestView.chartsOnOffer.some((offer) => offer.kind === chartKind)) return null;
        let cells =
          lateAsk !== undefined &&
          (latestView.selectionByAddress?.sheetNumber !== lateAsk.cells?.sheetNumber || latestView.selectionByAddress?.range !== lateAsk.cells?.range)
            ? null
            : store.cellsForChartByPage();
        if (cells === null) return null;
        whyChartNotMadeByPageRef.current = 'busy';
        if (isMakingChartRef.current) return false;
        isMakingChartRef.current = true;
        mayTakeCaretFromBarRef.current = lateAsk?.mayTakeCaretFromBar ?? true;
        chartMakingNthRef.current += 1;
        let awaited = awaitedChartMaking(chartMakingNthRef.current, chartKind, latestView);
        setChartMaking(awaited);
        let chartName = chartKindName(chartKind);
        let outcome = await chartsMadeByPage
          .make(
            chartKind,
            (nodeId) =>
              store.askForEditOfChart({
                kind: 'add',
                nodeId,
                name: chartName,
                cells,
              }),
          )
          .finally(() => {
            isMakingChartRef.current = false;
          });
        setChartMaking((making) => settleChartMaking(making, awaited, outcome));
        if (typeof outcome === 'string') whyChartNotMadeByPageRef.current = CHART_END_WORDS[outcome];
        return typeof outcome !== 'string';
      },
    [chartsMadeByPage, store],
  );
  let noteChartNotForPage = React.useCallback(() => {
    chartMakingNthRef.current += 1;
    setChartMaking({
      nth: chartMakingNthRef.current,
      is: 'notAdded',
      why: 'notForPage',
    });
  }, []);
  let [chartsOfferedFor, setChartsOfferedFor] = React.useState<boolean | null>(null);
  let isChartsOfferAskedRef = React.useRef(false);
  let [hasEverSelected, setHasEverSelected] = React.useState(false);
  if (!hasEverSelected && view.selectionByAddress !== null) setHasEverSelected(true);
  React.useEffect(() => {
    if (!(hasEverSelected || isChartMenuOpen) || chartsWrittenByAgent === null) return;
    let isStillMounted = true;
    chartsWrittenByAgent
      .isToBeHad()
      .catch(() => false)
      .then((isToBeHad) => (isStillMounted ? setChartsOfferedFor(isToBeHad && !isChartsOfferAskedRef.current) : undefined));
    return () => {
      isStillMounted = false;
    };
  }, [hasEverSelected, isChartMenuOpen, chartsWrittenByAgent]);
  const canAgentWriteCharts =
    chartsWrittenByAgent !== null && chartsMadeByPage.isToBeHad && view.viewOnlyBecause === null && !view.doesCommentModePickCells;
  let isChartWritingOffered = canAgentWriteCharts ? chartsOfferedFor : false;
  let isChartWritingOn = isChartWritingOffered === true;
  let [chartBeingWritten, setChartBeingWritten] = React.useState<ChartBeingWritten | null>(null);
  let chartWritingGivenUpNthRef = React.useRef(0);
  let isChartWritingLeftSheetRef = React.useRef(false);
  let isChartBeingPlacedRef = React.useRef(false);
  let [chartAskFault, setChartAskFault] = React.useState<ChartAskFault | null>(null);
  let [isLastAskNotToBeRepeated, setIsLastAskNotToBeRepeated] = React.useState(false);
  let [chartAskTyped, setChartAskTyped] = React.useState('');
  let [isChartKindAsked, setIsChartKindAsked] = React.useState(false);
  let [wasChartMenuOpen, setWasChartMenuOpen] = React.useState(isChartMenuOpen);
  if (wasChartMenuOpen !== isChartMenuOpen) {
    setWasChartMenuOpen(isChartMenuOpen);
    setChartAskTyped('');
    setChartAskFault(null);
  }
  let writeChartByAgent = React.useCallback(
    async (chartKind: ChartKindOrAny, words: string): Promise<[ChartEndWord, ChartLane]> => {
      if (chartsWrittenByAgent === null || isMakingChartRef.current) return ['busy', 'agent'];
      let latestView = store.getView();
      let chartMenuOpensBefore = chartMenuOpenCountRef.current;
      let cellsForChart = store.cellsForChartByAgent();
      let isByRow = words === '';
      let isSingleCell = cellsForChart !== null && isSingleCellSample(cellsForChart) && latestView.selectionSeen.cellsAre !== 'number';
      if (cellsForChart === null || (isSingleCell && isByRow))
        return (
          setChartAskFault({
            why: 'forChat',
            wasByRow: isByRow,
          }),
          ['for_chat', 'agent']
        );
      isMakingChartRef.current = true;
      chartMakingNthRef.current += 1;
      let nth = chartMakingNthRef.current;
      let awaited = awaitedChartMaking(nth, 'byAgent', latestView);
      isChartWritingLeftSheetRef.current = false;
      setIsChartKindAsked(chartKind !== 'any');
      setChartMaking(awaited);
      setChartAskFault(null);
      setIsLastAskNotToBeRepeated(false);
      setChartBeingWritten({
        asked: chartCaptionOrName(chartKind, words),
        sheetId: shownSheetIdOf(latestView),
      });
      let { held, ...chartCells } = cellsForChart;
      let [topLeft, sheetId] = [store.newChartOfCellsHeld(held)?.topLeft, shownSheetIdOf(latestView)];
      if (topLeft !== undefined && sheetId !== null)
        store.dispatch({
          kind: 'chartBeingMadeTold',
          nth,
          chart: {
            sheetId,
            topLeft,
            kind: isByRow ? chartKind : 'any',
          },
        });
      let outcome = await insertChartWrittenByAgent(
        {
          agent: chartsWrittenByAgent,
          add(nodeId: string) {
            store.dispatch({
              kind: 'chartBeingMadeTold',
              nth,
              chart: {
                nodeSent: nodeId,
              },
            });
            isChartBeingPlacedRef.current = true;
            let chartName = chartKindNameOrAny(chartKind);
            return store
              .askForEditOfChart({
                kind: 'add',
                nodeId,
                name: chartName,
                cells: held,
              })
              .finally(() => {
                isChartBeingPlacedRef.current = false;
              });
          },
        },
        {
          program: STOCK_CHART_PROGRAMS[chartKind === 'any' ? 'bar' : chartKind],
          ...chartCells,
        },
        {
          asked: chartKind === 'any' && words === '' ? null : askWordsOfKind(chartKind, words),
          mostUnitsOfAsked: MAX_ASK_WORDS_LENGTH,
        },
      ).catch(() => (chartWritingGivenUpNthRef.current >= nth ? 'stopped' : 'notChanged'));
      if (chartMakingNthRef.current !== nth) return ['stopped', 'agent'];
      let isChartMenuOpenNow = store.getView().contextBarMenu === 'chart';
      isMakingChartRef.current = false;
      setChartBeingWritten(null);
      store.dispatch({
        kind: 'chartBeingMadeTold',
        nth,
        chart:
          typeof outcome === 'object'
            ? {
                nodeAdded: outcome.nodeId,
              }
            : null,
      });
      setIsLastAskNotToBeRepeated(outcome === 'full');
      mayTakeCaretFromBarRef.current = isChartMenuOpenNow;
      let settled = chartMakingOutcome(outcome, isChartMenuOpenNow, isChartWritingLeftSheetRef.current);
      if (outcome === 'noAgent') {
        isChartsOfferAskedRef.current = true;
        setChartsOfferedFor(false);
      }
      let isToTryPage = outcome === 'noAgent' || outcome === 'tooLarge' || outcome === 'forChat' || outcome === 'notChanged';
      let lateAsk = {
        cells: latestView.selectionByAddress,
        mayTakeCaretFromBar: isChartMenuOpenNow,
      };
      let pageOutcome = isToTryPage ? await makeChartByPage(chartKind, words, lateAsk) : null;
      if (pageOutcome === true && isChartMenuOpenNow && chartMenuOpensBefore === chartMenuOpenCountRef.current)
        store.dispatch({
          kind: 'contextBarMenuChanged',
          menu: 'chart',
          isOpen: false,
        });
      if (pageOutcome !== null) return [pageOutcome ? 'by_page_late' : whyChartNotMadeByPageRef.current, 'page'];
      setChartMaking(
        (making) => ('made' in settled ? settleChartMaking(making, awaited, settled.made) : making?.nth === nth ? null : making),
      );
      if ('inCard' in settled && settled.inCard !== null) {
        setChartAskFault({
          why: settled.inCard,
          wasByRow: isByRow,
        });
        setChartAskTyped((typed) => (typed === '' ? words : typed));
      }
      if (typeof outcome === 'object' && isChartMenuOpenNow)
        store.dispatch({
          kind: 'contextBarMenuChanged',
          menu: 'chart',
          isOpen: false,
        });
      return [chartEndWordOfAgent(outcome), 'agent'];
    },
    [chartsWrittenByAgent, store, makeChartByPage],
  );
  let forgetChartBeingMade = React.useCallback(
    (nth: number) =>
      store.dispatch({
        kind: 'chartBeingMadeTold',
        nth,
        chart: null,
      }),
    [store],
  );
  let giveUpChartWriting = React.useCallback(() => {
    chartWritingGivenUpNthRef.current = chartMakingNthRef.current;
    chartsWrittenByAgent?.giveUp();
  }, [chartsWrittenByAgent]);
  let stepBackFromChartWriting = React.useCallback(() => {
    giveUpChartWriting();
    if (isChartBeingPlacedRef.current) return;
    if (isMakingChartRef.current)
      store.dispatch({
        kind: 'chartBeingMadeTold',
        nth: chartMakingNthRef.current,
        chart: null,
      });
    isMakingChartRef.current = false;
    setChartBeingWritten(null);
  }, [giveUpChartWriting, store]);
  React.useEffect(() => giveUpChartWriting, [giveUpChartWriting]);
  let hasChartWritingLeftSheet = chartBeingWritten !== null && chartBeingWritten.sheetId !== shownSheetIdOf(view);
  React.useEffect(() => {
    if (!hasChartWritingLeftSheet) return;
    isChartWritingLeftSheetRef.current = true;
    giveUpChartWriting();
  }, [hasChartWritingLeftSheet, giveUpChartWriting]);
  let askChart = React.useCallback(
    async (chartKind: ChartKindOrAny, words: string): Promise<[ChartEndWord, ChartLane]> => {
      let selection = store.getView().selectionByAddress;
      if (selection === null) return ['waiting', 'page'];
      let chartMenuOpensBefore = chartMenuOpenCountRef.current;
      let isChartMenuOpenNow = store.getView().contextBarMenu === 'chart';
      lastProgrammaticActMsRef.current = performance.now();
      let askWords = cleanAskWords(words);
      let isByPageFirst = isChartMadeByPage(store.getView().chartsOnOffer[0], isChartWritingOn);
      let pageOutcome = isByPageFirst ? await makeChartByPage(chartKind, askWords) : null;
      if (pageOutcome === null && !isChartMenuOpenNow) {
        if (!isMakingChartRef.current) noteChartNotForPage();
        return ['refused', 'page'];
      }
      let whyNothing = pageOutcome === null ? store.whyNothingToChart() : null;
      let cellsForChart = pageOutcome === null && whyNothing === null ? store.cellsForChartByAgent() : null;
      let isSingleCell = cellsForChart !== null && isSingleCellSample(cellsForChart) && store.getView().selectionSeen.cellsAre !== 'number';
      if (whyNothing === 'tablesNotFoundYet') return ['waiting', 'page'];
      if (whyNothing !== null || (isSingleCell && askWords === ''))
        return (
          setChartAskFault({
            why: whyNothing ?? 'noCells',
            wasByRow: askWords === '',
            tableAtPress: store.getView().selectionSeen.shape === 'cell' ? store.startOfAreaToChart() : null,
          }),
          [whyNothing === 'filterCutsTable' ? 'filter' : 'no_cells', 'page']
        );
      let isToAskInChat = shouldAskInChatInstead(chartAskFault?.why ?? null, chatWithAgent.isToBeHad() === true);
      let isToWriteByAgent =
        pageOutcome === null &&
        !isToAskInChat &&
        canAgentWriteCharts &&
        !isChartsOfferAskedRef.current &&
        (await chartsWrittenByAgent.isToBeHad().catch(() => false));
      if (store.isStopped()) return pageOutcome === null ? ['left', 'agent'] : [pageOutcome ? 'by_page' : whyChartNotMadeByPageRef.current, 'page'];
      if (isToWriteByAgent) return writeChartByAgent(chartKind, askWords);
      let outcome = isByPageFirst
        ? pageOutcome
        : await makeChartByPage(chartKind, askWords, {
            cells: selection,
            mayTakeCaretFromBar: true,
          });
      let isOpenedInChat =
        outcome ??
        (await cellsAddedToChat.openWithWhatWasPressed(
          newChartTitle(chartKind, askWords),
          selection,
          INSERT_CHART_LABEL,
          chartAskPayload(chartKind, askWords),
        ));
      if (outcome === null && !isOpenedInChat && chatWithAgent.isToBeHad() !== true) {
        if (isMakingChartRef.current) return ['busy', 'agent'];
        return (noteChartNotForPage(), ['no_agent', 'agent']);
      }
      if (isOpenedInChat && isChartMenuOpenNow && chartMenuOpensBefore === chartMenuOpenCountRef.current)
        store.dispatch({
          kind: 'contextBarMenuChanged',
          menu: 'chart',
          isOpen: false,
        });
      if (outcome !== null) return [outcome ? 'by_page' : whyChartNotMadeByPageRef.current, 'page'];
      if (!isOpenedInChat) return ['not_to_chat', 'agent'];
      return [isToAskInChat ? 'to_chat' : 'chat_no_agent', 'agent'];
    },
    [
      cellsAddedToChat,
      chatWithAgent,
      makeChartByPage,
      isChartWritingOn,
      noteChartNotForPage,
      store,
      chartAskFault,
      canAgentWriteCharts,
      chartsWrittenByAgent,
      writeChartByAgent,
    ],
  );
  let chartNotice = view.isOneRangeNeeded
    ? CHART_MESSAGES.oneRangeNeeded()
    : view.isSelectionCutByOwnFilters && (isChatToBeHad !== false || chartsMadeByPage.isToBeHad)
      ? CHART_MESSAGES.filterCutsCells()
      : null;
  let [areFormatToolsInView, setAreFormatToolsInView] = React.useState(true);
  React.useLayoutEffect(() => {
    if (!isMenuOpen) return;
    setAreFormatToolsInView(isTouchBelowSm() || (formatToolsRef.current?.getClientRects().length ?? 0) > 0);
  }, [isMenuOpen]);
  let canChartBeAsked =
    isChartWritingOffered === true || isChatToBeHad === true ? true : isChartWritingOffered === false && isChatToBeHad === false ? false : null;
  let areTablesAwaitedForChart = isChartMenuOpen && store.areTablesAwaitedForChart();
  const chartWhyNot =
    canChartBeAsked === false
      ? 'noChat'
      : canChartBeAsked === null || view.selectionByAddress === null || areTablesAwaitedForChart
        ? 'waiting'
        : null;
  let areaToChartStart = isChartMenuOpen && view.selectionSeen.shape === 'cell' ? store.startOfAreaToChart() : null;
  let hasTableMovedSinceFault = chartAskFault?.tableAtPress !== undefined && chartAskFault.tableAtPress !== areaToChartStart;
  let chartFaultShown =
    chartAskFault === null || hasTableMovedSinceFault
      ? null
      : chartAskFaultShown(chartAskFault.why, {
          ...chartAskFault,
          isChatToBeHad: isChatToBeHad === true,
        });
  let areChartKindsForPage =
    chartsMadeByPage.isToBeHad &&
    view.viewOnlyBecause === null &&
    !view.doesCommentModePickCells &&
    isChartMadeByPage(view.chartsOnOffer[0], isChartWritingOn);
  let canPageMakeChart = areChartKindsForPage && view.selectionByAddress !== null;
  let chartOffersNow = chartOffersForPage(view.chartsOnOffer, isChartWritingOn);
  let [chartOffers, setChartOffers] = React.useState(chartOffersNow);
  let [areChartOffersHeld, setAreChartOffersHeld] = React.useState(false);
  if (!areChartOffersHeld && chartOffers !== chartOffersNow) setChartOffers(chartOffersNow);
  let [areaToChartBefore, setAreaToChartBefore] = React.useState(areaToChartStart);
  if (areaToChartBefore !== areaToChartStart) {
    setAreaToChartBefore(areaToChartStart);
    setChartOffers(chartOffersNow);
  }
  let canChartNow = chartWhyNot === null || canPageMakeChart;
  if (areChartOffersHeld !== (isChartMenuOpen && chartOffers.length > 0 && canChartNow)) setAreChartOffersHeld(!areChartOffersHeld);
  let askChartCounted = React.useCallback(
    async (chartKind: ChartKindOrAny, words: string): Promise<void> => {
      if (store.getView().contextBarMenu !== 'chart') return void (await askChart(chartKind, words));
      let countAsk = countChartAsk(chartCardCounted, chartAskKindWord(chartKind, cleanAskWords(words) !== '', chartOffers.length > 0));
      try {
        countAsk(...(await askChart(chartKind, words)));
      } catch (error) {
        throw (countAsk('failed', 'page'), error);
      }
    },
    [askChart, chartCardCounted, chartOffers, store],
  );
  React.useEffect(() => {
    if (isChartMenuOpen)
      chartCardCounted({
        step: 'open',
        what: store.whatChartCardOpensOn(),
      });
  }, [isChartMenuOpen, chartCardCounted, store]);
  let chartAskMenu = React.useMemo(
    () =>
      isChartMenuOpen
        ? <ChartAskMenu onOffer={chartOffers} whyNot={chartWhyNot} canPageMakeChart={canPageMakeChart} areKindsForPage={areChartKindsForPage} onAsked={askChartCounted} change={chartBeingWritten === null ? null : 'agentWrites'} askedOfAgent={chartBeingWritten?.asked ?? ''} isKindAsked={isChartKindAsked} onSteppedBackFromChange={stepBackFromChartWriting} noteOnLastAsk={chartFaultShown === null ? null : chartRefusalText(chartFaultShown)} isNoteOfFault={chartFaultShown !== 'forChat' &&
              chartFaultShown !== 'notHere' &&
              chartFaultShown !== 'noCells' &&
              chartFaultShown !== 'filterCutsTable'} isLastAskNotToBeRepeated={isLastAskNotToBeRepeated} typed={chartAskTyped} onTyped={(typed) => {
              setChartAskTyped(typed);
              setChartAskFault(null);
            }} />
        : null,
    [
      isChartMenuOpen,
      chartOffers,
      chartWhyNot,
      canPageMakeChart,
      areChartKindsForPage,
      askChartCounted,
      chartBeingWritten,
      isChartKindAsked,
      stepBackFromChartWriting,
      chartFaultShown,
      isLastAskNotToBeRepeated,
      chartAskTyped,
    ],
  );
  const { rowsAskedFor } = view;
  let sortFilterCards = React.useMemo(
    () =>
      rowsAskedFor === null
        ? null
        : <SortFilterCardList card={rowsAskedFor} onAct={actOnRowsAskedFor} onCustomSortAsked={askCustomSort} />,
    [rowsAskedFor, actOnRowsAskedFor, askCustomSort],
  );
  let { tableThatFilterBarAddsTo } = view;
  const isFilterNotDrawnYet = rowsAskedFor?.isFilterNotDrawnYet === true;
  let isFilterBarAskShown = isFilterBarAskOpen(view);
  let [filterListTableKey, filterListColumn] = [view.ownFilterList?.tableKey ?? null, view.ownFilterList?.c ?? null];
  const isFilterListOpenerShown =
    filterListOpener !== null &&
    (filterListTableKey === null || (filterListTableKey === filterListOpener.tableKey && filterListColumn === filterListOpener.c));
  let tableCardKey = isFilterNotDrawnYet
    ? rowsAskedFor.tableKey
    : isFilterBarAskShown
      ? tableThatFilterBarAddsTo
      : isFilterListOpenerShown
        ? filterListOpener.tableKey
        : null;
  let tableCardSpot = tableCardPlacement(view.grid, tableCardKey, zoom, TABLE_CARD_WIDTH);
  let [tableCardHang, setTableCardHang] = React.useState<TableCardHang | null>(null);
  if ((tableCardHang?.tableKey ?? null) !== tableCardKey)
    setTableCardHang(
      tableCardKey === null
        ? null
        : {
            tableKey: tableCardKey,
            hangBeside: tableCardSpot !== null,
          },
    );
  let hangsBesideTable = tableCardHang?.hangBeside ?? tableCardSpot !== null;
  let [tableCardX, tableCardY] = tableCardSpot === null ? [null, 0] : [tableCardSpot.x, tableCardSpot.y];
  let tableCardAnchor = useZoomedVirtualAnchor(
    cellsRef,
    zoom,
    React.useMemo(() => (tableCardX === null ? null : new DOMRect(tableCardX, tableCardY, 0, 0)), [tableCardX, tableCardY]),
  );
  let {
    anchor: besideTableAnchor,
    clearAtFoot,
    noteFirstCardDrawn,
    noteColumnsCardDrawn,
  } = useHungTableCardPlace({
    placeOnScreen: tableCardAnchor,
    tableKey: tableCardKey,
    byButton: tableCardSpot?.byButton ?? null,
    zoom,
    grid: cellsRef,
  });
  let { ownFilterList } = view;
  let filterListHung =
    ownFilterList === null || ownFilterList.hangsFrom === null || isFilterListOpenerShown
      ? null
      : hungCardUnderFilterButton({
          ...ownFilterList,
          hangsFrom: ownFilterList.hangsFrom,
        });
  let [filterListHungX, filterListHungY] = filterListHung === null ? [null, 0] : [filterListHung.x, filterListHung.y];
  let {
    anchor: filterListAnchor,
    clearAtFoot: filterListClearAtFoot,
    noteFirstCardDrawn: noteFilterListDrawn,
  } = useHungTableCardPlace({
    placeOnScreen: useZoomedVirtualAnchor(
      cellsRef,
      zoom,
      React.useMemo(
        () => (filterListHungX === null ? null : new DOMRect(filterListHungX, filterListHungY, 0, 0)),
        [filterListHungX, filterListHungY],
      ),
    ),
    tableKey: filterListHung?.whose ?? null,
    byButton: filterListHung?.byButton ?? null,
    goesWithRow: true,
    zoom,
    grid: cellsRef,
  });
  let filterBarCard = React.useMemo(
    () =>
      tableThatFilterBarAddsTo === null
        ? null
        : {
            card: isFilterBarAskShown && !isFilterNotDrawnYet ? rowsAskedFor : null,
            besideTable: besideTableAnchor,
            hangsBesideTable,
            clearAtFoot,
            onDrawn: noteFirstCardDrawn,
            onOpenChange: (isOpen: boolean, event: Event | null) => onMenuOpenChange('sort', isOpen, event, tableThatFilterBarAddsTo),
            onAct: actOnRowsAskedFor,
            onCustomSortAsked: askCustomSort,
          },
    [
      tableThatFilterBarAddsTo,
      isFilterBarAskShown,
      isFilterNotDrawnYet,
      rowsAskedFor,
      besideTableAnchor,
      hangsBesideTable,
      clearAtFoot,
      noteFirstCardDrawn,
      onMenuOpenChange,
      actOnRowsAskedFor,
      askCustomSort,
    ],
  );
  let filterNotDrawnCard = React.useMemo(
    () => ({
      card: isFilterNotDrawnYet ? rowsAskedFor : null,
      besideTable: besideTableAnchor,
      hangsBesideTable: true,
      clearAtFoot,
      onDrawn: noteFirstCardDrawn,
      onOpenChange: (isOpen: boolean, event: Event | null) => onMenuOpenChange('sort', isOpen, event),
      onAct: actOnRowsAskedFor,
      onCustomSortAsked: askCustomSort,
    }),
    [isFilterNotDrawnYet, rowsAskedFor, besideTableAnchor, clearAtFoot, noteFirstCardDrawn, onMenuOpenChange, actOnRowsAskedFor, askCustomSort],
  );
  let isFilterListFromButton = filterListOpener?.isChip === false;
  let owedAfterSortCardRef = React.useRef<OpenerOwed | null>(null);
  let askSortCardFromFilterList = React.useCallback(
    (isByKey: boolean) => {
      let tableKey = filterListOpener?.tableKey ?? null;
      if (tableKey === null) return;
      owedAfterSortCardRef.current =
        isByKey && filterListOpenerElement !== null
          ? {
              opener: filterListOpenerElement,
              presses: focusTrackerRef.current?.timesBegun() ?? 0,
            }
          : null;
      onMenuOpenChange('sort', true, null, tableKey);
      store.lookOnceEventsAreFinished(() => {
        if (store.getView().rowsAskedFor === null) owedAfterSortCardRef.current = null;
      });
    },
    [store, filterListOpener, filterListOpenerElement, onMenuOpenChange],
  );
  let whatHasCaretAfterFilterBarCard = React.useCallback(() => {
    let owedAfterBack = owedAfterSortCardRef.current;
    owedAfterSortCardRef.current = null;
    return whatHasCaretAfterOwnFilterCard(store.getView(), {
      owedAfterBack,
      pressesNow: timesFocusBegun(),
      afterMenu: whatHasCaretAfter,
    });
  }, [store, whatHasCaretAfter, timesFocusBegun]);
  let filterListChip = React.useMemo(
    () =>
      filterListTableKey === null || filterListColumn === null || filterListOpener?.isChip !== true
        ? null
        : {
            tableKey: filterListTableKey,
            c: filterListColumn,
          },
    [filterListTableKey, filterListColumn, filterListOpener],
  );
  let isCoarsePointer = useCoarsePointer();
  let isWrapOffered =
    view.grid.offersAtSelection?.isTextCutOff === true && view.grid.offersAtSelection.besideIfShort !== null && !isCoarsePointer;
  let chartOnOffer = chartOfferAtSelection(view.chartsOnOffer);
  let chartOfferedAtSelection =
    view.grid.offersAtSelection?.isOneCell === false &&
    view.viewOnlyBecause === null &&
    !view.isSelectionCutByOwnFilters &&
    isChartMadeByPage(chartOnOffer, isChartWritingOn) &&
    chartsMadeByPage.isToBeHad
      ? chartOnOffer
      : undefined;
  let offersAtSelection = React.useMemo(
    (): OfferAtSelection[] => [
      ...(isWrapOffered
        ? [
            {
              ...wrapTextTool(),
              onPress(event: React.MouseEvent<HTMLButtonElement>) {
                swallowRestOfPress(event);
                chooseCellFormat({
                  wrapText: true,
                });
              },
            },
          ]
        : []),
      ...(chartOfferedAtSelection === undefined
        ? []
        : [
            {
              id: 'chart',
              icon: chartThumbnailIcon(chartOfferedAtSelection, !canPageMakeChart),
              label: insertChartKindLabel(chartOfferedAtSelection.kind),
              canAct: canPageMakeChart,
              whyNot: null,
              onPress() {
                askChart(chartOfferedAtSelection.kind, '');
                if (cellsRef.current?.ownerDocument.hasFocus() === true) focusCaret();
              },
            },
          ]),
    ],
    [isWrapOffered, chooseCellFormat, chartOfferedAtSelection, canPageMakeChart, askChart, focusCaret],
  );
  let putAwayErrorCard = React.useCallback(
    (cardOf: string) =>
      store.dispatch({
        kind: 'errorCardPutAway',
        cardOf,
      }),
    [store],
  );
  let askFixFromErrorCard = React.useCallback(
    (cardOf: string, isFixedHere: boolean) => askFixOfErrorCard(store, cellsAddedToChat, cardOf, isFixedHere),
    [store, cellsAddedToChat],
  );
  let isErrorExplained = view.errorExplained !== null;
  React.useEffect(() => {
    if (isErrorExplained && !areWaysInToComeSoon) chatWithAgent.look();
  }, [chatWithAgent, isErrorExplained, areWaysInToComeSoon]);
  const { grid: gridNow, mode, notice, newsOfLoss } = view;
  let selectedPlacementBeforeRef = React.useRef(selectedPlacementId);
  let isPlacementStillThere = React.useEffectEvent(
    (placementId: string) => gridNow.placedViews.some((placed) => placed.placementId === placementId),
  );
  let isCaretFreeToGo = React.useEffectEvent(() => {
    let active = getActiveElement();
    let isInClosingPart = isInsideUnpinnedToast(active) || isInClosingContextBar(active);
    return active === active?.ownerDocument.body || isFocusInCells() || isInClosingPart;
  });
  let placementSelectedByPageRef = React.useRef<string | null>(null);
  let openPlacedViewMenuIfOwed = React.useEffectEvent((placementId: string) => {
    let isOwed = placementBeforeKeysListRef.current === placementId;
    placementBeforeKeysListRef.current = null;
    let doc = cellsRef.current?.ownerDocument;
    if (isOwed && doc?.hasFocus() === true) cardUnderChartRef.current?.open(placementId);
  });
  React.useLayoutEffect(() => {
    let placementBefore = selectedPlacementBeforeRef.current;
    selectedPlacementBeforeRef.current = selectedPlacementId;
    let wasMenuOwed = placementLeftRef.current === placementBefore;
    placementLeftRef.current = null;
    let wasSelectedByPage = placementSelectedByPageRef.current === selectedPlacementId;
    placementSelectedByPageRef.current = null;
    let doc = cellsRef.current?.ownerDocument;
    if (doc === undefined) return;
    if (selectedPlacementId !== undefined) {
      openPlacedViewMenuIfOwed(selectedPlacementId);
      if (placementIdOfElement(doc.activeElement) === selectedPlacementId) return;
      let caretComes = howCaretComesToPlacedView({
        isCaretOfPressOnItsWay: isRefocusingAfterPressRef.current,
        hasPageCaret: doc.hasFocus(),
        isCaretFreeToGo: isCaretFreeToGo() || wasSelectedByPage,
      });
      if (caretComes === 'comesByItself') return;
      if (caretComes === 'isBrought') return focusCaret();
      let act: PlacedViewAct = {
        kind: 'leave',
        isForCells: false,
      };
      return store.dispatch({
        kind: 'placedViewActedOn',
        placementId: selectedPlacementId,
        act,
      });
    }
    if (placementBefore === undefined) return;
    if (wasMenuOwed && isPlacementStillThere(placementBefore)) return;
    let isCaretNowhere = doc.activeElement === doc.body || placementIdOfElement(doc.activeElement) !== null;
    if (isCaretNowhere && doc.hasFocus() && awaitKeyUnderTypist()) return;
    if (isCaretNowhere && doc.hasFocus()) return focusCaret();
    if (isCaretNowhere && doc.activeElement instanceof HTMLElement) doc.activeElement.blur();
    return;
  }, [selectedPlacementId, focusCaret, store]);
  let selectAddedChart = React.useEffectEvent((placementId: string) => {
    if (addedChartView?.placementId !== placementId) return;
    let isCaretInContextBar = mayTakeCaretFromBarRef.current && formatToolsRef.current?.contains(getActiveElement()) === true;
    if (isPageLeftUntouched() || !(isCaretFreeToGo() || isCaretInContextBar)) return;
    if (!isAddedChartStillAtPress(chartMaking, store.getView())) return;
    placementSelectedByPageRef.current = isCaretInContextBar ? placementId : null;
    store.dispatch({
      kind: 'placedViewActedOn',
      placementId,
      act: {
        kind: 'select',
        isByKey: true,
        hasJustArrived: true,
      },
    });
  });
  let addedChartPlacement = addedChartView?.placementId;
  let selectedAddedChartRef = React.useRef<string | null>(null);
  let isCaretStillSettling = React.useEffectEvent(() => {
    let active = getActiveElement();
    return active === active?.ownerDocument.body || (active?.closest(`[${CONTEXT_BAR_PART_ATTRIBUTE}]`) ?? null) !== null;
  });
  React.useEffect(() => {
    let doc = cellsRef.current?.ownerDocument;
    let win = doc?.defaultView ?? null;
    if (addedChartPlacement === undefined || isChartMenuOpen) return;
    if (doc === undefined || win === null) return;
    if (selectedAddedChartRef.current === addedChartPlacement) return;
    selectedAddedChartRef.current = addedChartPlacement;
    let tryAfterFrame = (triesLeft: number): void =>
      afterNextFrameOrTimeout(
        win,
        () => (triesLeft > 0 && isCaretStillSettling() ? tryAfterFrame(triesLeft - 1) : selectAddedChart(addedChartPlacement)),
      );
    return tryAfterFrame(ADDED_CHART_SELECT_TRIES);
  }, [addedChartPlacement, isChartMenuOpen]);
  let focusWrapperRef = React.useRef<Element | null>(null);
  React.useLayoutEffect(() => {
    let doc = cellsRef.current?.ownerDocument;
    if (doc?.hasFocus() === true && doc.activeElement === focusWrapperRef.current) focusControlInWrapper(doc.activeElement);
  });
  let [gridRight, gridBottom] = [gridNow.body.left + gridNow.body.width, gridNow.body.top + gridNow.body.height];
  let sizeOfGrid = React.useMemo(
    () => ({
      gridWidth: gridRight,
      gridHeight: gridBottom,
      density: gridNow.density,
    }),
    [gridRight, gridBottom, gridNow.density],
  );
  let importOnGrid = useImportOnGrid({
    open: view.importOfAFile,
    listedSheets: view.listedSheets,
    locale: view.locale,
    sizeOfGrid,
    isImportAsNewSheetUnanswered: view.isImportAsNewSheetUnanswered,
    zoom,
    onConfirmed: confirmImport,
    onDropped: dropImport,
    onEscaped: escapeImport,
  });
  let saveStatus =
    saveCard?.isAboutConnection === true ? null : saveStatusText(view.saving, view.hasUnsavedEdits, isRetryingLong, isEditingPaused);
  let saveLineWords =
    (isRetryingLong ? null : saveStatus) ??
    announcedConnectionWords ??
    (saveStatus === null && (view.fractionSavedToShow !== null || isLongSaveToldNow) ? savingChangesText() : null) ??
    (isAllSavedSaid ? allChangesSavedText() : null) ??
    (isEditingBackNoticeShown ? editingBackOnText() : null);
  let [connectionBackSay, setConnectionBackSay] = React.useState<ConnectionBackSay>('none');
  let nextConnectionBackSay = nextConnectionBackSayImported(connectionBackSay, {
    isReconnectingSaid: announcedConnectionWords !== null,
    isOpen: connection === null,
    isLineTaken: saveLineWords !== null,
  });
  if (nextConnectionBackSay !== connectionBackSay) setConnectionBackSay(nextConnectionBackSay);
  if (useIsTrueForVisibleMs(connectionBackSay === 'backSaid', SAID_NOTICE_SHOWN_MS) && connectionBackSay === 'backSaid') setConnectionBackSay('none');
  const isNoticeShown = notice !== null && !isNoticeApartFromSaveCard(notice, saveCard);
  const doesNoticeGiveWay = isNoticeShown && noticeGivesWay(notice) && mode.kind !== 'editing';
  React.useEffect(() => {
    if (!doesNoticeGiveWay) return;
    let timer = setTimeout(
      () =>
        store.dispatch({
          kind: 'noticeDismissed',
          notice,
        }),
      DEFAULT_TOAST_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [store, notice, doesNoticeGiveWay]);
  const isExcelDropNoticeUseless =
    notice?.kind === 'fileNotImported' && notice.why === 'excelFileDropped' && !filesOfferedToAgent.includes('computer');
  React.useEffect(() => {
    if (isExcelDropNoticeUseless)
      store.dispatch({
        kind: 'noticeDismissed',
        notice,
      });
  }, [store, notice, isExcelDropNoticeUseless]);
  let { peopleList } = view;
  let highlightedPerson = peopleList?.rows[peopleList.highlightedRow];
  let personChipGoneTo = peopleList?.inField?.find(({ userId }) => userId === peopleList.chipGoneTo);
  let peopleListAnnouncement = listAnnouncement(peopleList?.card ?? null);
  let [isEntryLiveRegionOn, setIsEntryLiveRegionOn] = React.useState(true);
  let [isListLiveRegionOn, setIsListLiveRegionOn] = React.useState(true);
  let isEditorACombobox = gridNow.isEditorAComboBox || gridNow.isEditorOverCalendar || isInBoxOfOneLine;
  let isComboboxInCell = isEditorACombobox && peopleList?.under !== 'formulaBar';
  let activeDescendantId =
    dropdownList !== null
      ? dropdownListIds(dropdownList)
      : peopleList?.under === 'cell'
        ? peopleListCardIds(peopleList)
        : view.timeList !== null
          ? timeListActiveDescendant(view.timeList)
          : view.functionList !== null && typingTarget === 'cell'
            ? functionListActiveDescendant(view.functionList)
            : typingTarget === 'cell'
              ? formulaOfferActiveDescendant(formulaFromWords)
              : null;
  let dropdownAriaOnIos =
    mode.kind === 'navigating' && IS_IOS_BROWSER && dropdownList !== null
      ? withHighlightedRowIdOr(dropdownListIds(dropdownList), firstDropdownListRowId(dropdownList))
      : null;
  let entryOverlapOfGridlines = gridNow.editorBox === null ? NO_OFFSET : entryGridlineOverlap(gridNow.editorBox, gridNow.editorScale);
  let sheetBesidePaneProps = sheetBesideSidePaneProps(sidePaneWidth, isSidePaneDrawn);
  let sheetBehindSidePaneClass = isSidePaneDrawn ? SHEET_BEHIND_SIDE_PANE_CLASS : '';
  let tabsAway = useTabsAway(mode.kind === 'editing');
  let areTabsAway = tabsAway.areTabsAway && !isSidePaneDrawn;
  let isFrameShortened = tabsAway.isFrameShortened && !isSidePaneDrawn;
  let isNarrowWithFormatBar = useNarrowByTouch() && view.formatOfSelection !== null;
  let isFootCovered = areTabsAway || (mode.kind === 'editing' && !isSidePaneDrawn);
  useFootInsetOf(isNarrowWithFormatBar && isFootCovered ? footBar : null);
  let leaveMenuAndEntryOnPress = (event: React.MouseEvent<HTMLButtonElement>) => {
    swallowRestOfPress(event);
    let { contextBarMenu, mode: latestMode } = store.getView();
    if (contextBarMenu !== null) onMenuOpenChange(contextBarMenu, false, null);
    if (latestMode.kind === 'editing')
      store.dispatch({
        kind: 'entryLeft',
      });
  };
  let takeViewBack = () => {
    let { isFollowingAgent, isFollowingPerson, grid: latestGrid } = store.getView();
    if (isFollowingAgent || isFollowingPerson || latestGrid.yetToGlide !== null)
      store.dispatch({
        kind: 'viewTakenBack',
      });
  };
  let shownSheet = view.listedSheets.find(({ isShown }) => isShown);
  let swallowRestOfGuardedPress = (event: React.SyntheticEvent<Element>) => {
    if (pressGuard.isRestOfPressSwallowed()) event.stopPropagation();
  };
  let shownSheetName = shownSheet?.name ?? sheetMessages.sheet();
  let cellEditorDescribedBy = view.areFormulasShown ? `${KEY_TO_LIST_OF_KEYS_ID} ${FORMULAS_SHOWN_ID}` : KEY_TO_LIST_OF_KEYS_ID;
  let activeCellElementId =
    view.isSteppedOutOfCells || view.isCaretWithCellsBeforeEntryEnds || isZoomSettling ? null : gridNow.activeCellElementId;
  let entryBoxStyle =
    gridNow.editorBox === null
      ? null
      : cellEntryBoxStyle(gridNow.editorBox, gridNow.body, gridNow.editorFormat, gridNow.editorKeepsClear, {
          lineCount: gridNow.editorLineCount,
          foldsAt: gridNow.editorFoldsAt,
          scale: gridNow.editorScale,
        });
  let areReferencesWritten =
    view.referencesInEntry.some(({ writtenAt }) => writtenAt !== undefined) &&
    formulaFromWords.stage?.kind !== 'asked' &&
    !(formulaFromWords.stage?.kind === 'proposed' && formulaFromWords.stage.isArriving);
  let areReferencesHued =
    areReferencesWritten &&
    !isInBoxOfOneLine &&
    !gridNow.isEntryAmongPeople &&
    gridNow.editorPaints.fill === null &&
    gridNow.editorPaints.text === null;
  let isEditingFormula = mode.kind === 'editing' && !isInBoxOfOneLine && isFormulaText(mode.text);
  let renderCellEditor = (isWaitingBox: boolean) => {
    if (mode.kind !== 'editing' || view.entryCellText === null) return null;
    let editorProps = {
      className: 'sheet-cell-editor',
      'aria-label':
        view.entrySheetName === null ? editingCellLabel(view.entryCellText) : editingCellOnSheetLabel(view.entryCellText, view.entrySheetName),
      'aria-busy': formulaFromWords.stage?.kind === 'asked' || undefined,
      ...(gridNow.isEditorOverCalendar
        ? calendarCellComboboxProps(view.calendar !== null, activeDescendantId)
        : comboboxAriaProps(gridNow.isEditorAComboBox || isWaitingBox, activeDescendantId)),
      ...PLAIN_TEXT_FIELD_PROPS,
      ...cellFieldKeyProps,
      'data-starts-on-line-at-left': entryOverlapOfGridlines.x > 0 || undefined,
      'data-holds-one-line': isWaitingBox || mode.holdsOneLine || mode.isInBoxOfOneLine,
      'data-is-as-wide-as-may-be': (entryBoxStyle !== null && entryBoxStyle.minWidth === entryBoxStyle.maxWidth) || undefined,
      'data-floats-over-other-sheet': view.sheetPointedIn !== null || undefined,
      'data-is-expanded': gridNow.expandedEntryCard !== null || undefined,
      'data-flag-stands': gridNow.editorFlagStands ?? undefined,
      'data-is-under-hues': areReferencesHued || undefined,
      style:
        peopleListPlacement !== null
          ? entryEditorLineStyle(CHIP_FIELD_LINE_HEIGHT, DEFAULT_CELL_FORMAT.font)
          : {
              ...entryEditorStyle(entryBoxStyle ?? OFFSCREEN_SPOT, gridNow.editorFormat.font, isEditingFormula),
              ...fillPaintStyle(gridNow.editorPaints.fill),
              ...textPaintStyle(gridNow.editorPaints.text),
            },
      ...(peopleListPlacement === null && paintDataAttributes(gridNow.editorPaints)),
      value: mode.text,
      // The rich editor's div has been made an EntryEditorElement, so its target carries `value`.
      onChange: (event: React.ChangeEvent<HTMLInputElement> | EntryEditorChange) => onFieldInput('cell', event as FieldInput),
      onFocus: () => {
        if (!store.mayAnEntryOpenOrEnd()) moveEntryToUnlessThere('cell');
      },
    };
    let { autoComplete, ...editorPropsWithoutAutoComplete } = editorProps;
    return isWaitingBox
      ? <input ref={setCellEditorElement} {...GRID_KEY_FIELD_PROPS} {...editorProps} aria-describedby={cellEditorDescribedBy} />
      : <LingeringEntryInput ofCell={entryCellOnPhone} drawn={!gridNow.isEntryAmongPeople
            ? {
                as: 'editor',
                ref: setTypingFieldElement,
                ...editorPropsWithoutAutoComplete,
                references: areReferencesHued ? view.referencesInEntry : NO_REFERENCES,
                brackets: view.matchingBrackets,
                looks: gridNow.editorLooks,
                areLooksSeen: gridNow.areEditorLooksSeen,
                marksOfCell: gridNow.marksOfEntryCell,
                areSignsRead: gridNow.doesEntryReadSigns,
                textHeldAsEntryOpened: gridNow.textHeldAsEntryOpened,
                areSignsLeftAsTyped: gridNow.areSignsLeftAsTyped,
                numbersOfLines: gridNow.editorNumbersOfLines,
                caretToPut: gridNow.editorCaretToPut,
                onMarkAsked: (toggle: FontMark) =>
                  chooseCellFormat({
                    toggle,
                  }),
                selectionHeld: view.linkForm?.inEntry,
                onBoxPressed: (line: number) =>
                  store.dispatch({
                    kind: 'boxOfLinePressedInEntry',
                    line,
                  }),
              }
            : {
                as: 'textArea',
                ref: setTypingFieldElement,
                rows: 1,
                ...editorProps,
                placeholder: peopleListField === null ? undefined : addPeopleHint(peopleListField),
              }} />;
  };
  let cellEditor = <>{(isInBoxOfOneLine ? null : renderCellEditor(false)) ??
        <LingeringEntryInput drawn={null} />}{(isInBoxOfOneLine ? renderCellEditor(true) : null) ??
        (<input ref={setCellEditorElement} {...GRID_KEY_FIELD_PROPS} className="sheet-cell-editor" data-is-waiting data-frame-waiting-field onBlur={({ relatedTarget, currentTarget: { ownerDocument: doc } }) => {
            isShiftHeldRef.current = false;
            if (relatedTarget !== null || focusTrackerRef.current?.isUnderWay() === true) return;
            if (isModalOpen(store.getView())) return;
            setTimeout(() => {
              if (doc.hasFocus()) restoreFocus();
            });
          }} onFocus={() => {
            let latestView = store.getView();
            if (areCellsOffLimits(latestView) && latestView.mode.kind !== 'editing')
              gridFocusRef.current?.focus({
                preventScroll: true,
              });
          }} hidden={isViewOnly} readOnly={isViewOnly || doCellsTakeNoText} aria-hidden={typingTarget !== 'grid' || undefined} tabIndex={-1} aria-label={shownSheetName} aria-describedby={cellEditorDescribedBy} {...(dropdownAriaOnIos === null ? cellEntryComboboxProps(activeCellElementId) : comboboxAriaProps(true, dropdownAriaOnIos))} {...PLAIN_TEXT_FIELD_PROPS} {...cellFieldKeyProps} style={peopleListPlacement !== null
              ? entryEditorLineStyle(CHIP_FIELD_LINE_HEIGHT, DEFAULT_CELL_FORMAT.font)
              : entryEditorStyle(
                  gridNow.activeCellBox === null
                    ? {
                        left: gridNow.body.left,
                        top: gridNow.body.top,
                      }
                    : cellEntryBoxStyle(gridNow.activeCellBox, gridNow.body, gridNow.editorFormat, gridNow.editorKeepsClear),
                  gridNow.editorFormat.font,
                  false,
                )} value={waitingBoxText} onChange={(event) => onFieldInput('cell', event)} onKeyDown={(event) => {
            cellFieldKeyProps.onKeyDown(event);
            keepCaretAtEndOnTyping(event);
          }} />)}</>;
  let entryTextLooks =
    mode.kind !== 'editing' || view.entryCellText === null
      ? null
      : {
          text: mode.text,
          font: DEFAULT_CELL_FORMAT.font,
        };
  let { formatsThatFit, takesDropdownFromInsert } = view.formatOfSelection ?? {};
  let isSelectionOfDropdown = view.formatOfSelection?.numberFormat.choice === 'dropdown';
  let insertChoicesOfCellControls = React.useMemo(
    () =>
      formatsThatFit === undefined || takesDropdownFromInsert === undefined
        ? []
        : cellControlInsertChoices({
            formatsThatFit,
            takesDropdown: takesDropdownFromInsert,
            isOneRangeNeeded: view.isOneRangeNeeded,
            isDropdown: isSelectionOfDropdown,
          }),
    [formatsThatFit, takesDropdownFromInsert, view.isOneRangeNeeded, isSelectionOfDropdown],
  );
  let areContextToolsHeld = mode.kind === 'editing' || view.contextBarMenu !== null;
  let [areContextToolsRestedOn, setAreContextToolsRestedOn] = React.useState(false);
  let [contextTools, setContextTools] = React.useState<ContextToolsState>({
    shown: contextToolsShapeOf(view.selectionSeen),
    hasSortAndFilter: view.isSortAndFilterOnBar,
    actSeen: null,
  });
  let contextToolsNext = nextContextToolsState(contextTools, view, {
    isHeld: areContextToolsHeld,
    isRestedOn: areContextToolsRestedOn,
  });
  if (contextToolsNext !== contextTools) setContextTools(contextToolsNext);
  let numberFormatListTold = React.useMemo(
    () => ({
      onTyped: (text: string) =>
        store.dispatch({
          kind: 'typedInListOfNumberFormats',
          text,
        }),
      onAgentAsked: askAgentForNumberFormat,
      onEscaped: escapeCustomNumberFormat,
      onEntered: enterCustomNumberFormat,
      onActHeld: holdActAtNumberFormat,
    }),
    [store, askAgentForNumberFormat, escapeCustomNumberFormat, enterCustomNumberFormat, holdActAtNumberFormat],
  );
  let customNumberFormatInList = view.customNumberFormat?.typedIn === 'list' ? view.customNumberFormat : null;
  let isAgentOfferedForPattern = view.isAgentOfferedForPattern && !isComposing;
  let numberFormatList = React.useMemo(
    () => ({
      entry: customNumberFormatInList,
      isAgentOffered: isAgentOfferedForPattern,
      told: numberFormatListTold,
    }),
    [customNumberFormatInList, isAgentOfferedForPattern, numberFormatListTold],
  );
  let contextBar =
    view.formatOfSelection !== null &&
    (<div className="sheet-context-bar" data-is-shown="true" data-stands="footBar"><FormattingToolbar ref={formatToolsRef} isSwipedRow={isNarrowWithFormatBar} isEntryOpen={mode.kind === 'editing'} whyNoToolForCells={selectedPlacementId === undefined ? null : chartMessages.toolIsNotForCharts()} formatOfSelection={view.formatOfSelection} sectionShows={contextToolsNext.shown} onSectionRestedOn={setAreContextToolsRestedOn} arePeopleSelected={view.selectionSeen.cellsAre === 'person'} selectedRowCount={view.selectedRowCount} selectedColumnCount={view.selectedColumnCount} canMergeSelection={view.canMergeSelection && !view.isOneRangeNeeded} canUnmergeSelection={view.canUnmergeSelection && !view.isOneRangeNeeded} isOneRangeNeeded={view.isOneRangeNeeded} onMergeChangeChosen={chooseMergeChange} onCheckboxesSet={setCheckboxesInToolbar} onSheetChangeChosen={chooseSheetChangeInToolbar} canWriteFigures={view.hasFiguresToWrite} onFigureChosen={chooseFigureInToolbar} isPaneOfDropdownOpen={view.isSidePaneAboutDropdown} canDropdownBeRemoved={view.canDropdownBeRemoved} onPaneOfDropdownAsked={toggleSidePane} openMenu={isFilterBarAskShown ? null : view.contextBarMenu} isSheetMenuOpen={view.menu?.isOfContextBar === true && !isMenuHoldingField(view.menu)} onFormatChosen={chooseCellFormatAtFoot} onChosenByOwnTool={ownToolOfFormatCounted} workbookInFormatMenu={workbookSettings} formatInList={numberFormatList} borderPen={view.borderPen} onBordersChosen={chooseBorders} onBorderPenChanged={changeBorderPen} areGridlinesHidden={view.grid.areGridlinesHidden} onGridlinesToggled={toggleGridlines} whatColorPickerShows={store.whatColorPickerShows} onMenuOpenChange={onMenuOpenChange} howPickerWasAskedInCellsMenu={getContextBarMenuOpenedBy} onSheetMenuAsked={askSheetMenu} areConditionalFormatsOpen={conditionalFormats?.drawnAs === 'pane'} onConditionalFormatsAsked={askConditionalFormats} isPickerAskedByKeyRef={isPickerAskedByKeyRef} cardOfConditionalFormats={conditionalFormatsCard} cardOfChart={chartAskMenu} cardOfSortAndFilter={isFilterBarAskShown ? null : sortFilterCards} isSortAndFilterOnBar={contextToolsNext.hasSortAndFilter} whyNoChart={chartNotice} whatHasCaretAfterMenu={whatHasCaretAfter} onKeyDown={onToolbarKeyDown} inserts={insertChoicesOfCellControls} onInsertChosen={insertCellControlFromToolbar} /></div>);
  let readerBar = isInteractiveWritable && view.interactive !== null && (
    <InteractiveSheetBar
      ref={readerBarRef}
      canBeReset={view.interactive.canBeReset}
      hasDefaultsToSave={view.interactive.hasDefaultsToSave}
      comment={null}
      onChosen={(kind) => {
        store.dispatch({ kind });
        focusCaret();
      }}
      onKeyDown={onToolbarKeyDown}
    />
  );
  let interactiveViewId = view.interactive?.viewId ?? null;
  let onInteractiveChanged = React.useEffectEvent(() => {
    if (((interactiveViewId !== null && isFocusInCells()) || isFocusNowhere()) && document.hasFocus()) focusCaret();
  });
  let isInteractiveAskOffered = !isViewOnly && isChatToBeHadOrWas;
  let interactiveChartAsk = React.useMemo<PlacedViewFix>(
    () => ({
      noticeCame: (isQuiet) => void (isQuiet || isViewOnly || lookAtChatUnlessComingSoon()),
      ask:
        isInteractiveAskOffered && interactiveViewId !== null
          ? (press) =>
              sendToChatAboutChart('sendPressAboutChart', interactiveViewId, press, interactiveSheetMessages.interactive())
          : null,
      giveChartCaret: focusCaret,
    }),
    [isInteractiveAskOffered, interactiveViewId, isViewOnly, lookAtChatUnlessComingSoon, sendToChatAboutChart, focusCaret],
  );
  let interactiveViewIdBeforeRef = React.useRef(interactiveViewId);
  React.useLayoutEffect(() => {
    if (interactiveViewIdBeforeRef.current !== interactiveViewId) onInteractiveChanged();
    interactiveViewIdBeforeRef.current = interactiveViewId;
  }, [interactiveViewId]);
  let onInteractiveKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'F6') {
      if (moveCaretTo('cells', event.shiftKey ? -1 : 1)) event.preventDefault();
      return;
    }
    onToolsKeyDownForCells(event, null, 'showSheetBeside');
  };
  let {
    formatOfSelection,
    selectedRowCount,
    selectedColumnCount,
    canMergeSelection,
  } = view;
  let {
    isOneRangeNeeded,
    isSidePaneAboutDropdown,
    canUnmergeSelection,
  } = view;
  let { areGridlinesHidden } = view.grid;
  let { borderPen } = view;
  let hasFiguresToWrite = view.hasFiguresToWrite;
  let [isChartSelected, sectionShows] = [selectedPlacementId !== undefined, contextToolsNext.shown];
  let hasBarSortAndFilter = contextToolsNext.hasSortAndFilter;
  let arePeopleSelected = view.selectionSeen.cellsAre === 'person';
  let areCellsBlank = view.selectionSeen.cellsAre === 'empty';
  let cellTypes = React.useMemo<CellContextMenuProps['cellTypes']>(
    () => ({
      arePeopleSelected,
      areCellsBlank,
      examples: workbookSettings.examples,
      areSeveralCheckboxes: sectionShows === 'checkboxes',
      isPaneOfDropdownOpen: view.isSidePaneAboutDropdown,
      canDropdownBeRemoved: view.canDropdownBeRemoved,
      onStepChosen: (step) =>
        chooseCellFormat({
          stepOfDecimalPlaces: step,
        }),
      onCheckboxesSet: setCheckboxesOfCellTypes,
      onPaneOfDropdownAsked: toggleSidePaneOfCellTypes,
    }),
    [
      arePeopleSelected,
      areCellsBlank,
      workbookSettings.examples,
      sectionShows,
      view.isSidePaneAboutDropdown,
      view.canDropdownBeRemoved,
      chooseCellFormat,
      setCheckboxesOfCellTypes,
      toggleSidePaneOfCellTypes,
    ],
  );
  let menuBarCommands = React.useCallback(
    () =>
      formatOfSelection === null
        ? []
        : searchMenuBarCommands(
            {
              whyNoToolForCells: isChartSelected ? chartMessages.toolIsNotForCharts() : null,
              formatOfSelection,
              sectionShows,
              isSortAndFilterOnBar: hasBarSortAndFilter,
              arePeopleSelected,
              selectedRowCount,
              selectedColumnCount,
              canMergeSelection: canMergeSelection && !isOneRangeNeeded,
              canUnmergeSelection: canUnmergeSelection && !isOneRangeNeeded,
              areGridlinesHidden,
              borderPen,
              isOneRangeNeeded,
              whyNoChart: chartNotice,
              canWriteFigures: hasFiguresToWrite,
              isPaneOfDropdownOpen: isSidePaneAboutDropdown,
              inserts: insertChoicesOfCellControls,
            },
            {
              onFormatChosen: chooseCellFormatAtFoot,
              onBordersChosen: chooseBorders,
              onMergeChangeChosen: chooseMergeChange,
              onCheckboxesSet: setCheckboxesInToolbar,
              onSheetChangeChosen: chooseSheetChangeInToolbar,
              onFigureChosen: chooseFigureInToolbar,
              onSortPaneAsked: askSortPaneFromToolbar,
              onPaneOfDropdownAsked: toggleSidePane,
              onInsertChosen: insertCellControlFromToolbar,
              onBorderPenChanged: changeBorderPen,
              onGridlinesToggled: toggleGridlines,
              onLocaleAsked: workbookSettings.onLocaleAsked,
              onTimeZoneAsked: workbookSettings.onTimeZoneAsked,
              onPickerAsked(picker: BarPicker) {
                if (picker === 'conditionalFormatting') return askRulesFromCells();
                onMenuOpenChange(picker, true, null);
                contextBarMenuOpenedByRef.current = menuOpenedByRef.current;
              },
            },
          ),
    [
      formatOfSelection,
      isChartSelected,
      sectionShows,
      hasBarSortAndFilter,
      arePeopleSelected,
      selectedRowCount,
      selectedColumnCount,
      canMergeSelection,
      canUnmergeSelection,
      areGridlinesHidden,
      borderPen,
      changeBorderPen,
      toggleGridlines,
      isOneRangeNeeded,
      chartNotice,
      hasFiguresToWrite,
      isSidePaneAboutDropdown,
      insertChoicesOfCellControls,
      chooseCellFormatAtFoot,
      chooseBorders,
      chooseMergeChange,
      setCheckboxesInToolbar,
      chooseSheetChangeInToolbar,
      chooseFigureInToolbar,
      askSortPaneFromToolbar,
      toggleSidePane,
      insertCellControlFromToolbar,
      askRulesFromCells,
      onMenuOpenChange,
      workbookSettings,
    ],
  );
  let askVersionHistory = () => {
    leaveEntryIfEditing();
    store.dispatch({
      kind: 'versionHistoryAsked',
    });
  };
  let historyButtonDisabled = disabledByViewOnly(versionLook === null ? view.viewOnlyBecause : null);
  let pressHistoryInHeader = React.useEffectEvent((): void => {
    if (historyButtonDisabled.disabled || isModalOpen(view)) return;
    if (cellsRef.current !== null) closeOpenMenusAndPopovers(cellsRef.current.ownerDocument);
    isPointerPressedLastRef.current = true;
    isBeforeAnyInputRef.current = false;
    focusTrackerRef.current?.noteActInShell();
    askVersionHistory();
  });
  React.useEffect((): (() => void) | undefined => {
    if (!isHistoryControlInHeader) return;
    shell.offerHistory((): void => pressHistoryInHeader());
    return (): void => shell.offerHistory(null);
  }, [shell, isHistoryControlInHeader]);
  let viewMenu = <ViewMenu gridZoom={gridZoom} side={areViewToolsAtFoot ? 'top' : 'bottom'} onOpenChange={onZoomLayerOpenChange} whatHasCaretAfter={whatHasCaretAfter} wasPointerPressedLast={wasPointerPressedLast} onFitChartAsked={selectedPlacementIdOnPhone === undefined ? null : () => fitPlacedViewInSight(selectedPlacementIdOnPhone, false)} areFormulasShown={view.areFormulasShown} isEntryOpen={view.mode.kind !== 'navigating'} onFormulasShownToggled={toggleFormulasShown} density={view.density} onDensityChosen={chooseDensity} undoAndRedo={view.undoAndRedo} onUndoOrRedoChosen={chooseUndoOrRedo} onFindAsked={openFindEmpty} onFindAndReplaceAsked={view.viewOnlyBecause === null ? openReplace : null} onListOfKeysAsked={askListOfKeys} />;
  let commandsOfBar = (): MenuCommand[] => {
    let root = cellsRef.current?.ownerDocument.documentElement;
    let shownIndex = view.listedSheets.findIndex(({ isShown }) => isShown);
    let shownListedSheet = view.listedSheets[shownIndex];
    return [
      ...menuBarCommands(),
      ...viewCommands(
        {
          areFormulasShown: view.areFormulasShown,
          isEntryOpen: view.mode.kind !== 'navigating',
          density: view.density,
          undoAndRedo:
            view.undoAndRedo === null || view.mode.kind !== 'navigating'
              ? view.undoAndRedo
              : {
                  undo: view.undoAndRedo.undo === 'nothingLeft' ? 'nothingLeft' : null,
                  redo: view.undoAndRedo.redo === 'nothingLeft' ? 'nothingLeft' : null,
                },
          theme: asThemeMode(root?.getAttribute(THEME_CHOSEN_ATTRIBUTE) ?? null),
        },
        {
          gridZoom,
          onFitChartAsked: selectedPlacementIdOnPhone === undefined ? null : () => fitPlacedViewInSight(selectedPlacementIdOnPhone, false),
          onFormulasShownToggled: toggleFormulasShown,
          onDensityChosen: chooseDensity,
          onUndoOrRedoChosen: chooseUndoOrRedo,
          onFindAsked: openFindEmpty,
          onFindAndReplaceAsked: view.viewOnlyBecause === null ? openReplace : null,
          onListOfKeysAsked: askListOfKeys,
          onThemeChosen(theme: ThemeMode | null) {
            if (root !== undefined) chooseSheetsTheme(root, theme);
          },
        },
      ),
      ...(shownListedSheet === undefined
        ? []
        : sheetSearchCommands(
            {
              sheet: shownListedSheet,
              isOnlySheet: view.listedSheets.length === 1,
              placeAmongTabs: {
                index: shownIndex,
                count: view.listedSheets.length,
              },
              viewOnlyBecause: view.viewOnlyBecause,
              isVersionHistoryOpen: view.versionHistory !== null,
              filesForAgent: filesOfferedToAgent,
              whyNoToolForCells: isChartSelected ? chartMessages.toolIsNotForCharts() : null,
            },
            {
              dispatch(event: SheetSearchEvent) {
                if (event.kind === 'sheetRenameChosen') setTimesRenameBegunElsewhere((count) => count + 1);
                dispatchFromSheetTabs(event);
              },
              onBlankChosen: blankSheetChooser(dispatchFromSheetList(view.listedSheets, dispatchFromSheetTabs)),
              onImportChosen: chooseImportFile,
              onFileForAgentChosen: askFilesForAgent,
              onVersionHistoryAsked: askVersionHistory,
              onAllFunctionsAsked: askAllFunctions,
              onAllSheetsAsked: null,
            },
          )),
      ...insertTools(
        {
          offers: atMenuOffers(new Date()),
          viewOnlyBecause: view.viewOnlyBecause,
          whyNoToolForCells: isChartSelected ? chartMessages.toolIsNotForCharts() : null,
          inserts: insertChoicesOfCellControls,
          setMeets: view.menu?.setMeets ?? null,
        },
        {
          onFormatChosen: chooseCellFormatAtFoot,
          dispatch: (event: PageEvent) => store.dispatch(event),
          onDayChosen: null,
        },
      ),
    ];
  };
  let askCostsInMenu = React.useCallback(
    () =>
      store.dispatch({
        kind: 'costsInMenuAsked',
      }),
    [store],
  );
  let functionCommandsState = {
    canEdit: view.viewOnlyBecause === null,
    isEntryOpen: view.mode.kind !== 'navigating',
  };
  let functionCommandsTold = {
    onFunctionChosen: (name: string) => pickFunctionWhenSettled(name, store, returnFocusToEntry, watchCaretLeaving()),
  };
  let goToCommandsFor = (words: string) =>
    goToSheetAndColumnCommands(
      words,
      MOST_TYPED_COMMANDS,
      {
        sheet: view.grid,
        listedSheets: view.listedSheets,
        columnsToGoTo: view.columnsToGoTo ?? [],
      },
      store,
    );
  let commandsOfTyped = (words: string): CommandsOfTypedWords | null => {
    let colorCommands =
      formatOfSelection === null
        ? []
        : hexColorCommands(
            words,
            {
              whyNoToolForCells: isChartSelected ? chartMessages.toolIsNotForCharts() : null,
              formatOfSelection,
            },
            {
              onFormatChosen: chooseCellFormatAtFoot,
            },
          );
    if (colorCommands.length > 0)
      return {
        commands: colorCommands,
        isFirstMeant: false,
      };
    if (words.trimStart().startsWith('='))
      return {
        commands: functionCommandsForFormula(words, MOST_TYPED_COMMANDS, functionCommandsState, functionCommandsTold),
        isFirstMeant: true,
      };
    let borderCommands = borderCommandsFromWords(
      words,
      {
        whyNoToolForCells: isChartSelected ? chartMessages.toolIsNotForCharts() : null,
      },
      {
        onBordersChosen: chooseBorders,
      },
    );
    if (formatOfSelection !== null && borderCommands.length > 0)
      return {
        commands: borderCommands,
        isFirstMeant: true,
      };
    let formatCommands =
      formatOfSelection === null
        ? []
        : typedFontSizeCommands(
            words,
            {
              whyNoToolForCells: isChartSelected ? chartMessages.toolIsNotForCharts() : null,
              formatOfSelection,
            },
            {
              onFormatChosen: chooseCellFormatAtFoot,
            },
          );
    if (formatCommands.length > 0)
      return {
        commands: [...formatCommands, ...goToCommandsFor(words)],
        isFirstMeant: true,
      };
    let goToCommands = goToCellsCommands(
      words,
      {
        sheet: view.grid,
      },
      store,
    );
    return goToCommands.length === 0
      ? null
      : {
          commands: [...goToCommands, ...goToCommandsFor(words)],
          isFirstMeant: true,
        };
  };
  let commandsByName = (words: string): CommandsUnderHeading<MenuCommand>[] => [
    ...commandsUnderHeading(goToLabel(), goToCommandsFor(words)),
    ...commandsUnderHeading(
      autocompleteFunctionsHeading(),
      functionCommandsForPrefix(words, MOST_TYPED_COMMANDS, functionCommandsState, functionCommandsTold),
    ),
  ];
  let {
    ownFilterBar,
    hasFilterNotDrawnYet,
    recordsUnderFilterNotDrawnYet,
  } = view;
  let shownSheetId = shownSheetIdOf(view);
  let filterBarAnnounced = React.useMemo(
    () =>
      filterBarToAnnounce(
        {
          ownFilterBar,
          hasFilterNotDrawnYet,
          recordsUnderFilterNotDrawnYet,
        },
        shownSheetId,
      ),
    [ownFilterBar, hasFilterNotDrawnYet, recordsUnderFilterNotDrawnYet, shownSheetId],
  );
  if ((view.ownFilterBar !== null || isFilterNotDrawnYet) && isFilterCleared) setIsFilterCleared(false);
  let askAgentFromWaysIn = () => {
    let wasInWaysIn = footNoticeRef.current?.contains(document.activeElement) === true;
    openChatAboutBlankSheet();
    noteAgentAsked();
    lastProgrammaticActMsRef.current = performance.now();
    if (wasInWaysIn)
      getTypingTargetElement()?.focus({
        preventScroll: true,
      });
  };
  let isWaysInCovered = isAgentAsked || isWaysInMenuOpen || isNonWaysInLayerHeldBack || view.contextBarMenu !== null || view.menu !== null;
  let { areSeen: areWaysInSeen, askAgent: askAgentFromWaysInOffer } = useWaysInShown({
    areDue: areWaysInUp,
    mayBeSeen: !isWaysInCovered,
    offered: !view.isAgentOfferedAmongWaysIn || isChatToBeHad === false ? null : isChatToBeHad === null ? 'awaited' : askAgentFromWaysIn,
  });
  useWaysInOutOfSightReport(store, areWaysInUp && isWaysInCovered);
  useEscapeSendsWaysInAway(store, areWaysInUp && !isWaysInCovered);
  let waysInFocus = useWaysInFocusKeeping({
    findWaysIn: () => footNoticeRef.current,
    areWaysInDue: () => store.getView().waysIn === 'areUp',
    giveToCells: () =>
      getTypingTargetElement()?.focus({
        preventScroll: true,
      }),
  });
  let onWaysInKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onPartKeyDown(event, 'waysIn', 'ofWaysIn');
    let wasPrevented = event.defaultPrevented;
    onToolsKeyDownForCells(event, 'ofWaysIn', null);
    if (!wasPrevented && event.defaultPrevented)
      getTypingTargetElement()?.focus({
        preventScroll: true,
      });
  };
  let sheetsPage = <div ref={listenForListUnderCellEvents} className={`relative flex h-full flex-col ${sheetBesidePaneProps.className}`} style={sheetBesidePaneProps.style} data-draws-entry-larger={gridNow.editorScale > 1 || undefined} onPointerDownCapture={(event) => {
      takeViewBack();
      let isInCells = event.target instanceof Node && cellsRef.current?.contains(event.target) === true;
      actsCountRef.current += 1;
      let isTouch = event.pointerType === 'touch';
      if (pressGuard.isPressSwallowed(isInCells && event.buttons !== 0, isTouch)) {
        event.stopPropagation();
        if (!isTouch) event.preventDefault();
      }
      isEscapeHeldInEditRef.current = false;
      isPointerPressedLastRef.current = event.buttons !== 0;
      isBeforeAnyInputRef.current = false;
      if (isPointerPressedLastRef.current) lastFocusedByKeyRef.current = null;
      wasFocusLostToNothingRef.current = false;
      let { target } = event;
      wasPressInAskBoxRef.current = isInPlacedViewAskBox(target);
      isFilterListLeftByPressRef.current = true;
      if (!(target instanceof Node)) return;
      if ([cellsRef, formulaBarRef].some(({ current }) => current?.contains(target) === true)) forgetComeToByTab();
      let isPressAfterTimeOrKey = isPressOnActiveCellAfterLeave(event);
      settleFocusLeft(isPressAfterTimeOrKey ? 'timeOrKey' : 'pressOrFocus');
      if (!isPressAfterTimeOrKey || store.getView().mode.kind !== 'editing') return;
      event.stopPropagation();
      event.preventDefault();
    }} onKeyDownCapture={(event) => {
      let { key, nativeEvent, target } = event;
      lastKeyDownRef.current = nativeEvent;
      if (!nativeEvent.repeat) wasTabKeyDownRef.current = false;
      wasPressInAskBoxRef.current = isInPlacedViewAskBox(target);
      if (nativeEvent.getModifierState(key)) return;
      actsCountRef.current += 1;
      if (nativeEvent.isTrusted && !nativeEvent.repeat) isPointerHeldOutsideRef.current = true;
      isPointerPressedLastRef.current = false;
      isBeforeAnyInputRef.current = false;
      let isEscapeHeld =
        isEscapeHeldInEditRef.current && key === 'Escape' && store.getView().mode.kind === 'editing' && !isFieldInList(target);
      if (!isEscapeHeld || !nativeEvent.repeat) isEscapeHeldInEditRef.current = false;
      if (isEscapeHeld) {
        event.preventDefault();
        return event.stopPropagation();
      }
      if (
        [cellEditorRef, gridFocusRef, activeEditorRef, formulaBarRef].some(({ current }) => current === target) &&
        doesKeyStepBackIntoCellsButF6(key)
      )
        forgetComeToByTab();
      let isEscapeInTypingTarget =
        key === 'Escape' && target === getGridOrEditorElement() && !isAltShortcutKey(event) && !isCommandHeld(event);
      let { isFollowingPerson, escapeInCells } = store.getView();
      if (!isEscapeInTypingTarget || !isFollowingPerson || escapeInCells !== 'letsGo') takeViewBack();
      if (isListUnderCellRow(target) && key !== 'Enter' && key !== ' ') {
        if (doesKeyStepBackIntoCellsButF6(key)) forgetComeToByTab();
        return (
          getTypingTargetElement()?.focus({
            preventScroll: true,
          }),
          event.stopPropagation(),
          onCellsKeyDown(event)
        );
      }
      let { mode: latestMode, functionList, isCommentModeOn } = store.getView();
      if (key !== 'Escape' || latestMode.kind !== 'editing' || functionList !== null || isCommentModeOn) return;
      let toolbarPart =
        target instanceof Node
          ? toolPartWithMenuHolding(target, {
              functionsButton: functionsButtonRef.current,
              viewTools: shownViewToolsRef.current,
              formatTools: formatToolsRef.current,
              barOfReader: readerBarRef.current,
            })
          : undefined;
      if (toolbarPart === undefined || event.isDefaultPrevented()) return;
      onPartKeyDown(event, toolbarPart.part, toolbarPart.ownMenu);
      if (!event.isDefaultPrevented()) return;
      event.stopPropagation();
      isEscapeHeldInEditRef.current = true;
    }} onKeyUpCapture={({ target, nativeEvent }) => {
      if (!isTrustedPlainTab(nativeEvent, wasTabKeyDownRef.current)) return;
      wasTabKeyDownRef.current = false;
      if (target === getGridOrEditorElement() && store.getView().mode.kind === 'navigating') markComeToByTab();
    }} onPointerUpCapture={swallowRestOfGuardedPress} onPointerCancelCapture={swallowRestOfGuardedPress} onMouseUpCapture={swallowRestOfGuardedPress} onMouseDownCapture={(event) => {
      if (pressGuard.isRestOfPressSwallowed()) event.preventDefault();
      swallowRestOfGuardedPress(event);
    }} onDoubleClickCapture={(event) => {
      if (pressGuard.isDoubleClickSwallowed()) event.stopPropagation();
    }} onContextMenuCapture={(event) => {
      if (!pressGuard.isMenuSwallowed()) return;
      event.stopPropagation();
      event.preventDefault();
    }} onClickCapture={(event) => {
      let { detail, target } = event;
      takeViewBack();
      if (pressGuard.isClickSwallowed(detail > 0)) event.stopPropagation();
      let isFileInput = target instanceof HTMLInputElement && target.type === 'file';
      if (detail === 0 && !isFileInput) {
        isPointerPressedLastRef.current = false;
        isBeforeAnyInputRef.current = false;
      }
      if (target instanceof Node && cellsRef.current?.contains(target) === true) forgetComeToByTab();
    }} onFocus={({ target, relatedTarget, currentTarget }: React.FocusEvent<Element>) => {
      let lastKey = lastKeyDownRef.current?.key;
      lastKeyDownRef.current = null;
      isEscapeHeldInEditRef.current = false;
      if (target !== cellEditorRef.current && target !== gridFocusRef.current) forgetComeToByTab();
      wasFocusLostToNothingRef.current = relatedTarget === null;
      focusBeforeMenuRef.current = null;
      let isInside = (ref: React.RefObject<Element | null>) => ref.current?.contains(target) === true;
      let isInTools = isInside(shownViewToolsRef) || isInside(formatToolsRef) || isInside(readerBarRef);
      let isInPaneOrPlacement =
        isInside(sidePaneRef) || isInside(findBarRef) || isInside(replaceFieldRef) || placementIdOfElement(target) !== null;
      if (isEditKeptOnBlurRef.current && isInPaneOrPlacement) loseFocus(false);
      isEditKeptOnBlurRef.current = false;
      let isTabbedIn =
        (lastKey === 'Tab' || lastKey === 'F6') && currentTarget.contains(relatedTarget) && sidePaneRef.current?.contains(relatedTarget) !== true;
      if (isInTools && target instanceof HTMLElement && !isPointerPressedLastRef.current) lastFocusedByKeyRef.current = target;
      else if (currentTarget.contains(target) && (!isInside(sidePaneRef) || isTabbedIn)) lastFocusedByKeyRef.current = null;
      let blurredPart = getSelectedPlacementId();
      if (blurredPart !== null) onPlacedViewCaret(blurredPart, 'left', target);
      focusWrapperRef.current = isWrapperOfDisabledControl(target) ? target : null;
      if ((relatedTarget === null || placementIdOfElement(relatedTarget) !== null) && focusControlInWrapper(target) !== null) return;
      if (target === getGridOrEditorElement() && focusLeftRef.current?.left.place === 'grid') return;
      fieldLeftForMenuRef.current = null;
      let placeLeft = focusLeftRef.current?.left.place;
      if (!(store.isEventUnfinished() && (placeLeft === 'cell' || placeLeft === 'formulaBar') && placeOfField(target) === placeLeft))
        settleFocusLeft('pressOrFocus');
      let isFocusKeptOnRow = isRowFocusOnIos({
        isWebKitOfIos: IS_IOS_BROWSER,
        isRow: isListUnderCellRow(target),
        isPressUnderWay: focusTrackerRef.current?.isUnderWay() === true,
        isEntryOpen: store.getView().mode.kind !== 'navigating',
      });
      focusKeptOnListRowRef.current = isFocusKeptOnRow ? target : null;
      if (isInListUnderCell(target) && !isFieldInList(target) && !isFocusKeptOnRow)
        getTypingTargetElement()?.focus({
          preventScroll: true,
        });
    }} onBlur={(event: React.FocusEvent<Element>) => {
      if (isBlurringByCodeRef.current) return;
      let isFromFormulaBar = event.target === formulaBarRef.current;
      if (event.relatedTarget === null) focusBeforeMenuRef.current = event.target;
      if (isInListUnderCell(event.relatedTarget)) return;
      if ((event.relatedTarget ?? event.target).closest(`[${LINK_FORM_ATTR}]`) !== null && store.getView().mode.kind === 'editing') return;
      let isToFunctionsButton = calendarPopupRef.current?.contains(event.relatedTarget) === true;
      let isInContextBarPart = (event.relatedTarget ?? event.target).closest(`[${CONTEXT_BAR_PART_ATTRIBUTE}]`) !== null;
      let isToSidePane = sidePaneRef.current?.contains(event.relatedTarget) === true;
      let isToFindFields =
        event.relatedTarget !== null && [findBarRef, replaceFieldRef].some((fieldRef) => fieldRef.current === event.relatedTarget);
      let isToPlacement = placementIdOfElement(event.relatedTarget) !== null;
      let isOutOfPage = !event.currentTarget.contains(event.relatedTarget);
      let isFieldInListLeft = isFieldInList(event.target) && !isToSidePane && !isToFindFields && !isToPlacement;
      if (isInContextBarPart || isFieldInListLeft) return;
      if (isFocusWithinSameMenu(event.target, event.relatedTarget)) return;
      let isFromEntry = [activeEditorRef, formulaBarRef, cellEditorRef].some((fieldRef) => fieldRef.current === event.target);
      let isToOwnPart = isToSidePane || isToFindFields || isToPlacement;
      let isToFocusGuard = event.relatedTarget?.hasAttribute('data-base-ui-focus-guard') === true;
      if (isFormulaAskedOrProposed(store.getView()) && (!isFromEntry || isToFocusGuard) && !isToOwnPart) return;
      let isLeftByPress = event.relatedTarget === null && noteFieldLeft(event.target);
      let wasPressedInFormulaBar = isFocusMoveExpectedRef.current;
      if (isFromFormulaBar && event.relatedTarget !== null) isFocusMoveExpectedRef.current = false;
      if (
        isFromFormulaBar &&
        !wasPressedInFormulaBar &&
        !isToFunctionsButton &&
        !isToOwnPart &&
        !isOutOfPage &&
        !isFormulaAskedOrProposed(store.getView()) &&
        ![activeEditorRef, cellEditorRef, gridFocusRef].some((fieldRef) => fieldRef.current === event.relatedTarget) &&
        functionsButtonRef.current?.contains(event.relatedTarget) !== true &&
        isEntryUntouched(store.getView().mode) &&
        !store.isWorkYetToReachWorkbook()
      ) {
        store.dispatch({
          kind: 'entryLeft',
        });
        return store.lookOnceEventsAreFinished(() => {
          if (whereTypingGoes(store.getView()) === 'grid') lastTypingTargetRef.current = 'grid';
        });
      }
      if (isToFunctionsButton || !(isToSidePane || isToFindFields || isToPlacement || isOutOfPage)) return;
      if (event.relatedTarget !== null) return loseFocus(isLeftByPress);
      let { target } = event;
      return whenBlurredToNothing(target, (isToNothing) => {
        let wasStillFocused = isToNothing && target.ownerDocument.activeElement === target;
        loseFocus(isLeftByPress);
        if (wasStillFocused) restoreFocus();
      });
    }}><div ref={formulaRowRef} className="sheet-formula-row" style={headerRoomStyle} hidden={interactiveViewId !== null && areViewToolsAtFoot} data-is-over-interactive={interactiveViewId !== null || undefined}><span id={CELL_ADDRESS_ID} hidden>{view.allSelectedText}</span>{isViewOnly
            ? <span aria-hidden className="sheet-formula-sign"><Icon name={FUNCTION_ICON_PROPS.icon} size="auto" /></span>
            : (<span ref={functionsButtonRef} role="presentation" className="sheet-formula-sign" onMouseDown={preventMouseDownDefault} onKeyDown={onFunctionsButtonKeyDown} onKeyDownCapture={onFunctionListKeyDown}><Button variant="ghost" iconOnly icon={FUNCTION_ICON_PROPS.icon} className="text-muted" aria-label={functionListLabel()} aria-haspopup="listbox" aria-expanded={view.functionList !== null} tooltipSide="bottom" {...{
                    [OPENS_FUNCTION_LIST_ATTRIBUTE]: true,
                  }} onClick={askAllFunctions} /></span>)}<WaitForFormula stage={formulaFromWords.stage} /><textarea key={formulaBarKey} ref={setFormulaBarElement} rows={Math.min(formulaBarLines.lineCountWithCaret, isNarrowPhone ? FORMULA_FIELD_MAX_ROWS_OPENED : FORMULA_FIELD_MAX_ROWS)} data-has-lines={formulaBarLines.opensAsCard || undefined} data-folds-lines={formulaBarLines.areLinesFolded || undefined} data-is-first-line-cut={formulaBarLines.isFirstLineCut || undefined} data-is-first-line-of-several={formulaBarLines.widthOfFirstLineOfSeveral !== null || undefined} style={formulaFirstLineStyle} id={FORMULA_FIELD_ID} data-comment-target="" className="sheet-formula-field" data-is-under-hues={areReferencesWritten || undefined} aria-label={sheetMessages.formulaBar()} aria-describedby={CELL_ADDRESS_ID} aria-busy={formulaFromWords.stage?.kind === 'asked' || undefined} {...comboboxAriaProps(
                false,
                peopleList?.under === 'formulaBar'
                  ? peopleListCardIds(peopleList)
                  : view.functionList !== null && typingTarget === 'formulaBar'
                    ? functionListActiveDescendant(view.functionList)
                    : typingTarget === 'formulaBar'
                      ? formulaOfferActiveDescendant(formulaFromWords)
                      : null,
              )} {...PLAIN_TEXT_FIELD_PROPS} readOnly={view.isFormulaBarReadOnly || view.formulaOfFixOnEntryCell !== null} value={view.formulaOfFixOnEntryCell === null ? view.formulaBarText : ''} placeholder={view.formulaOfFixOnEntryCell ?? view.formulaSpilledOverEntryCell ?? formulaBarPlaceholder(view)} data-shows-formula={isFormulaText(
                  view.formulaOfFixOnEntryCell ?? (view.formulaBarText === '' ? (view.formulaSpilledOverEntryCell ?? '') : view.formulaBarText),
                ) || undefined} onChange={(event) => onFieldInput('formulaBar', event)} onFocus={({ relatedTarget, currentTarget: formulaBar }) => {
                let lastKeyEvent = lastKeyDownRef.current;
                let isToSelectAll = isFocusMovingByCodeRef.current || didFocusLeaveByTabNow(relatedTarget);
                let isTabbedIn =
                  (focusLeftRef.current !== null && relatedTarget === null) ||
                  (wasFocusLostToNothingRef.current && relatedTarget !== null && lastKeyEvent === null);
                if (isToSelectAll && !isFocusMovingByCodeRef.current) formulaBar.select();
                let isCaretToEnd =
                  isEditKeptOnBlurRef.current &&
                  relatedTarget === null &&
                  focusTrackerRef.current?.isUnderWay() !== true &&
                  !isFocusingFieldRef.current;
                let putCaretAtEnd = () => formulaBar.setSelectionRange(formulaBar.value.length, formulaBar.value.length);
                if (isCaretToEnd) putCaretAtEnd();
                if (isTabbedIn || isCaretToEnd) isPointerPressedLastRef.current = false;
                if (isTabbedIn) isBeforeAnyInputRef.current = false;
                if (isToSelectAll || isTabbedIn) wasFormulaBarFocusedRef.current = true;
                formulaBar.toggleAttribute(HAS_FOCUS_BY_KEY_ATTRIBUTE, !isPointerPressedLastRef.current);
                if (isToSelectAll || isTabbedIn || isCaretToEnd)
                  setTimeout(() => {
                    let lastKeyDown = lastKeyDownRef.current;
                    let isHeld =
                      (lastKeyDown !== null && !lastKeyDown.getModifierState(lastKeyDown.key)) || isPointerPressedLastRef.current;
                    let isCaretAtStart = formulaBar === formulaBar.ownerDocument.activeElement && formulaBar.selectionEnd === 0;
                    if (isCaretAtStart && !isHeld && isCaretToEnd) putCaretAtEnd();
                    else if (isCaretAtStart && !isHeld) formulaBar.select();
                  });
                let scrollToCaretAtEnd = () => {
                  if (formulaBar === formulaBar.ownerDocument.activeElement && formulaBar.selectionStart === formulaBar.value.length)
                    formulaBar.scrollTop = formulaBar.scrollHeight;
                };
                if (!isPointerPressedLastRef.current) scrollToCaretAtEnd();
                if (!isPointerPressedLastRef.current) setTimeout(scrollToCaretAtEnd);
                moveEntryToUnlessThere('formulaBar');
              }} onBlur={({ currentTarget: formulaBar, relatedTarget }) => {
                formulaBar.scrollTo(0, 0);
                formulaBar.removeAttribute(HAS_FOCUS_BY_KEY_ATTRIBUTE);
                if (relatedTarget !== null) wasFormulaBarFocusedRef.current = false;
              }} onPointerDown={({ button, buttons, pointerType, currentTarget: formulaBar }) => {
                wasFormulaBarFocusedRef.current = false;
                if (buttons !== 0) {
                  formulaBar.removeAttribute(HAS_FOCUS_BY_KEY_ATTRIBUTE);
                  isFocusMoveExpectedRef.current = true;
                }
                if (button === 0 && pointerType !== 'touch') forgetCaretPlacement(formulaBar, store.getView().mode);
              }} onClick={moveEntryToFormulaBar} onKeyDown={onFieldKeyDown} />{(areReferencesWritten || view.matchingBrackets !== null) &&
            !isComposing &&
            mode.kind === 'editing' &&
            mode.text === view.formulaBarText &&
            <FormulaBarReferenceHues key={`${formulaBarKey} ${typingTarget} ${JSON.stringify(formulaBarLines)} ${isNarrowPhone}`} text={view.formulaBarText} references={view.referencesInEntry} brackets={view.matchingBrackets} box={formulaBarRef} />}{!areViewToolsAtFoot &&
            (<div ref={setViewToolsInRowElement} role="presentation" className="sheet-view-tools" onMouseDown={preventMouseDownDefault} onKeyDown={onViewToolsKeyDown}><TooltipGroup>{viewMenu}{view.viewOnlyBecause !== 'readOnly' &&
                    !isHistoryControlInHeader &&
                    <Button variant="ghost" iconOnly icon="History" aria-label={versionHistoryMessages.title()} pressed={view.versionHistory !== null} {...historyButtonDisabled} onClick={askVersionHistory} />}</TooltipGroup></div>)}</div><ThemeChangeNotice zoomButton={getViewToolsButton} side={areViewToolsAtFoot ? 'top' : 'bottom'} isEntryOpen={view.mode.kind !== 'navigating'} whatHasCaretAfter={whatHasCaretAfter} /><SelectedRangeAnnouncer selectedRange={view.selectedRange} /><PointedCellsAnnouncer pointedCells={view.pointedCells} isEntryOpen={mode.kind === 'editing'} /><AgentSaidAnnouncer said={view.saidOfAgent} doneByAgent={view.doneByAgent} /><EarlierVersionAnnouncer look={versionLook} isEarlierVersionLeft={isEarlierVersionLeft} /><CellsAddedAnnouncer store={store} chat={cellsAddedToChat} placeOfKeyboard={whereIsFocus} /><WaysInHintAnnouncer areUp={areWaysInSeen} canAskAgent={typeof askAgentFromWaysInOffer === 'function'} wordsOfLoad={wordsOfLoad} /><span id={FORMULAS_SHOWN_ID} hidden>{describeLastDone({
          what: 'formulasShown',
        })}</span><span id={KEY_TO_LIST_OF_KEYS_ID} hidden>{shortcutListMessages.keyThatOpensIt(IS_APPLE_PLATFORM)}</span>{IS_IOS_BROWSER &&
        <ReaderPageAnnouncer grid={gridNow} />}<LiveAnnouncer words={lastDoneWords !== null && lastDoneWords.what !== 'replaced' && describeLastDone(lastDoneWords)} timesSaid={view.lastDone === null ? 0 : objectKey(view.lastDone)} /><LiveAnnouncer words={saveLineWords ?? (connectionBackSay === 'backSaid' ? reconnectedText() : null)} />{isRetryingLong &&
        <div role="alert" className="sr-only">{saveStatus}</div>}<LiveAnnouncer words={view.calculating === 'wrong'
            ? formulasTookTooLongWords()
            : view.isLongCalculationTold
              ? calculatingWords(view.ownViewShownAsApplied)
              : longCalculationSay === 'endSaid' && view.ownViewShownAsApplied === null && formulasCalculatedText()} /><OpenedWordsAnnouncer words={dropdownList !== null &&
          ((mode.kind === 'navigating' && (dropdownAriaOnIos?.highlightedRowId ?? null) === null) || highlightedDropdownRow?.kind === 'add') &&
          (listAnnouncement(dropdownList.card) ?? dropdownListSpokenWords(dropdownList))} isEntryOpen={mode.kind !== 'navigating'} store={store} inPageOf={cellsRef} /><FilterBarAnnouncer bar={filterBarAnnounced} isCleared={isFilterCleared} /><WordsOfferedAnnouncer words={view.wordsOfferedSaid} hasGone={view.isOfferGoneToBeSaid} isKeyDrawn={isOfferKeyDrawn} /><PeopleListAnnouncer list={peopleList} /><LiveAnnouncer words={peopleList !== null && peopleList.inField !== null && peopleListLabel(peopleList)} /><LiveAnnouncer words={view.linkExplained !== null &&
          view.linkExplained.marked !== null &&
          linkPositionText(
            view.linkExplained.marked + 1,
            view.linkExplained.urls.length,
            view.linkExplained.urls[view.linkExplained.marked] ?? '',
            view.linkExplained.areKeysNewOnCard,
          )} /><LiveAnnouncer words={personChipGoneTo !== undefined && personChipRemoveHint(personChipGoneTo.name)} /><LiveAnnouncer words={peopleListAnnouncement !== null
            ? !isComboboxInCell && peopleListAnnouncement
            : highlightedPerson !== undefined &&
              (mode.kind === 'navigating' || !isComboboxInCell || highlightedPerson.kind === 'keepAsText') &&
              peopleListRowWords(highlightedPerson)} />{(saveCard !== null ||
        view.fractionSavedToShow !== null ||
        isLongSaveToldNow ||
        view.isLongCalculationTold ||
        allSavedSay === 'said') &&
        (<SaveStatusToast card={saveCard} fractionSaved={view.fractionSavedToShow} isLongSaveTold={isLongSaveToldNow} isLongCalculationTold={view.isLongCalculationTold} ownViewShownAsApplied={view.ownViewShownAsApplied} isAllSavedSaid={allSavedSay === 'said'} action={saveCard?.offersReload === true && reloadPage !== null
              ? <ReloadPageButton reload={reloadPage} />
              : undefined} onUp={() => {
            setAnnouncedConnectionWords(connectionWords);
            if (view.saving === 'retrying' && saveCard?.isAboutConnection === false) setAllSavedSay('owed');
          }} onBarUp={() => setAllSavedSay('owed')} />)}<ErrorsAtOpeningAnnouncer store={store} wordsOfLoad={wordsOfLoad} inPageOf={cellsRef} isToastUp={isErrorsAtOpeningOffered} />{isErrorsAtOpeningOffered &&
        (<ErrorsAtOpeningToast key={view.errorsAtOpening!.sheetId} count={view.errorsAtOpening!.count} onAgentAsked={(isInPlace) => void askFixesOfErrorsAtOpening(isInPlace)} onTakenDown={closeToastIfInsideUnpinned} cells={view.errorsAtOpening!.cells} canAttach={mode.kind !== 'editing' && (view.selectionByAddress !== null || view.isOneRangeNeeded)} fixedHere={!areFixesOffered ? 'no' : view.errorsAtOpening!.areFixesHeldBack || fixesStage === 'undecided' ? 'notNow' : 'now'} onDismissed={() => {
              let errorsAtOpening = store.getView().errorsAtOpening;
              if (errorsAtOpening === null) return;
              noteErrorsKnownOf(errorsAtOpening.sheetId, errorsAtOpening.count);
              store.dispatch({
                kind: 'errorsAtOpeningPutAway',
                sheetId: errorsAtOpening.sheetId,
              });
              whenFocusStays(closeToastIfFocusLeft, 'dispatchesNothing');
            }} />)}{view.undoOffer !== null &&
        view.undoOffer.kind !== 'moveReplacedCells' &&
        (<UndoOfferToast offer={view.undoOffer} onTaken={() =>
            store.dispatch({
              kind: 'undoOfferTaken',
            })} onDismissed={() => {
            store.dispatch({
              kind: 'undoOfferDismissed',
            });
            whenFocusStays(closeToastIfFocusLeft, 'dispatchesNothing');
          }} />)}<NoFixAnnouncer why={view.noticeOfNoFix?.why ?? null} isChatOffered={canPersonEdit && isChatToBeHad === true} />{view.noticeOfNoFix !== null &&
        (<NoFixToast key={`${view.noticeOfNoFix.cells} ${view.noticeOfNoFix.why}`} why={view.noticeOfNoFix.why} isChatOffered={canPersonEdit && isChatToBeHad === true} canAttach={mode.kind !== 'editing' && (view.selectionByAddress !== null || view.isOneRangeNeeded)} onAgentAsked={() => void openChatAfterNoFix()} onOver={({ byUser }) => {
              store.dispatch({
                kind: 'noticeOfNoFixPutAway',
              });
              if (byUser) whenFocusStays(closeToastIfFocusLeft, 'dispatchesNothing');
            }} onTakenDown={closeToastIfInsideUnpinned} />)}{chartMaking?.is === 'notAdded' &&
        <ChartNotAddedToast key={chartMaking.nth} why={chartMaking.why} onGone={(isToCloseToast) => dropChartMaking(chartMaking.nth, isToCloseToast)} />}{chartChangeUndoNotice !== null &&
        (<MountedToast key={chartChangeUndoNotice.nodes.to} words={chartChangeOutcomeWords(chartChangeUndoNotice.says)} {...(stepOfChartChange !== null && {
              action: <Button variant="secondary" size="sm" aria-label={chartMessages.undoChangeOfChart()} onClick={undoChartChange}>{sheetMessages.undo()}</Button>,
            })} staysUntilClosed={false} onOver={({ byUser }) => {
              setChartChangeUndoNotice(null);
              if (byUser) whenFocusStays(closeToastIfFocusLeft, 'dispatchesNothing');
            }} onTakenDown={closeToastIfInsideUnpinned} />)}<UndoOfferAnnouncer store={store} inPageOf={cellsRef} /><SettledWordsAnnouncer words={chartAddedAnnouncement(chartMaking?.is === 'notAdded' ? chartMaking : addedChartOnCard, true)} about={chartMaking === null ? null : String(chartMaking.nth)} store={store} inPageOf={cellsRef} /><SettledWordsAnnouncer words={chartChangeUndoNotice === null ? null : chartChangeOutcomeWords(chartChangeUndoNotice.says)} about={chartChangeUndoNotice?.nodes.to ?? null} store={store} inPageOf={cellsRef} />{notice !== null &&
        <div key={`said ${objectKey(notice)}`} role="alert" className="sr-only">{(isSavingStoppedRefusal(notice) ? saveStatus : null) ?? noticeText(notice)}</div>}{notice !== null &&
        !isNoticeShown &&
        (<MountedToast key={`toast ${objectKey(notice)}`} words={noticeText(notice)} {...(notice.kind === 'callsForFixesFailed' && WARNING_TOAST_ICON_PROPS)} action={notice.kind === 'fileNotImported' && notice.why === 'excelFileDropped'
                ? (<Button variant="secondary" size="sm" onClick={() => {
                      askFilesForAgent('computer');
                      store.dispatch({
                        kind: 'noticeDismissed',
                        notice,
                      });
                    }}>{sheetMessages.importFromExcel()}</Button>)
                : undefined} staysUntilClosed={!noticeGivesWay(notice) || mode.kind === 'editing'} onOver={({ byUser }) => {
              store.dispatch({
                kind: 'noticeDismissed',
                notice,
              });
              if (byUser) whenFocusStays(closeToastIfFocusLeft, 'dispatchesNothing');
            }} onTakenDown={closeToastIfInsideUnpinned} />)}{wasSomethingKeptOff &&
        <div role="alert" className="sr-only">{agentMissedMessageText()}</div>}{wasSomethingKeptOff &&
        <MountedToast words={agentMissedMessageText()} staysUntilClosed onOver={() => {}} onTakenDown={closeToastIfInsideUnpinned} />}{isEditingBackNoticeShown &&
        (<MountedToast words={editingBackOnText()} staysUntilClosed={false} onOver={() => {
            setIsEditingBackNoticeShown(false);
            closeToastIfInsideUnpinned();
          }} onTakenDown={closeToastIfInsideUnpinned} />)}<AgentUnavailableToast store={store} chat={chatWithAgent} placeOfKeyboard={whereIsFocus} hasWindowFocus={hasPageFocus} isSaidElsewhere={({ pressed, chartId, request }) =>
          pressed === INSERT_CHART_LABEL
            ? chatWithAgent.isToBeHad() !== true
            : chartId !== undefined && request !== undefined && chatWithAgent.isToBeHad() !== false} standInFor={commentInsteadOfChat} onToastUp={() => observeToasts()} onGone={closeToastIfInsideUnpinned} /><AddedToMessageToast store={store} chat={cellsAddedToChat} placeOfKeyboard={whereIsFocus} hasWindowFocus={hasPageFocus} isAgentWorking={view.isAgentWorking} onGone={closeToastIfInsideUnpinned} />{commentsLayer}<LiveAnnouncer words={doesCommentModePickCells && commentModeHint(isKeyboardLikely)} />{doesCommentModePickCells &&
        !view.hasCommentModeRefused &&
        <MountedToast words={commentModeHint(isKeyboardLikely)} staysUntilClosed={false} onOver={closeToastIfInsideUnpinned} onTakenDown={closeToastIfInsideUnpinned} />}{newsOfLoss !== null &&
        <div key={`said ${objectKey(newsOfLoss)}`} role="alert" className="sr-only">{noticeText(newsOfLoss)}</div>}{newsOfLoss !== null &&
        (<MountedToast key={`toast ${objectKey(newsOfLoss)}`} words={noticeText(newsOfLoss)} staysUntilClosed onOver={() => {
              store.dispatch({
                kind: 'noticeDismissed',
                notice: newsOfLoss,
              });
              closeToastIfInsideUnpinned();
            }} onTakenDown={closeToastIfInsideUnpinned} />)}<SortFilterCardPopover cardToAdd={filterNotDrawnCard} whatHasCaretAfterCard={whatHasCaretAfterFilterBarCard} onColumnAsked={openFilterListAt} timesPressed={timesFocusBegun} crossPressed={null} />{view.ownFilterBar !== null &&
        <OwnFilterBarView bar={view.ownFilterBar} cardToAdd={filterBarCard} whatHasCaretAfterCard={whatHasCaretAfterFilterBarCard} onColumnAsked={openFilterListAt} columnOpen={filterListChip} timesPressed={timesFocusBegun} onLineRemoved={removeOwnFilterLine} onSortRemoved={removeOwnSort} onSortMadeForEveryone={view.viewOnlyBecause === null ? makeOwnSortForEveryone : null} actsOnNamedViews={actsOnNamedViews} onRefreshed={refreshOwnFilters} onCleared={clearOwnFiltersOfSheet} onLookAgain={lookAtOwnFiltersAgain} onGoingWithCaret={focusCaret} onKeyDown={onOwnFilterBarKeyDown} className={sheetBehindSidePaneClass} style={headerRoomStyle} ref={ownFilterBarRef} />}{view.pivotTableOutOfDateAt !== null &&
        <PivotTableOutOfDateBar onUpdate={view.viewOnlyBecause === null ? updatePivotTableOutOfDate : null} onKeyDown={onPivotTableBarKeyDown} className={sheetBehindSidePaneClass} style={headerRoomStyle} ref={pivotTableBarRef} />}<LiveAnnouncer words={view.pivotTableOutOfDateAt !== null && pivotTableMessages.outOfDate()} />{findBar}<div ref={watchKeyboardSlides} {...edgeStretchPressProps} className="sheet-with-group-margins" data-are-tabs-away={areTabsAway || undefined} data-is-frame-shortened={isFrameShortened || undefined} data-is-bar-of-phone={isNarrowWithFormatBar || undefined} style={{
          marginBlockStart: (view.find?.roomAboveGrid ?? 0) * zoom,
          ...groupMarginRoomStyle(view.groupMargins, zoom),
        }}>{view.groupMargins.columns !== null &&
            <GroupMargin ref={setFooterExtra} margin={view.groupMargins.columns} zoom={zoom} onMarkPressed={onGroupMarkPressed} onLevelChosen={chooseGroupLevel} />}{view.groupMargins.rows !== null &&
            <GroupMargin ref={setHeaderExtra} margin={view.groupMargins.rows} zoom={zoom} onMarkPressed={onGroupMarkPressed} onLevelChosen={chooseGroupLevel} />}<div className="sheet-under-find-bar relative flex min-h-0 flex-col overflow-clip"><LeaveCellsHint cells={cellsRef} doesEscapeStepOut={view.escapeInCells === 'stepsOut' && view.openUnderCell === null && !view.isEscapeForFix} isCardUnderCell={view.errorExplained !== null || view.linkExplained !== null} hasEscapeSteppedOut={view.lastDone?.what === 'steppedOutOfCells'} /><div ref={cellsRef} className="sheet-grid min-h-0 flex-1" inert={interactiveViewId !== null} role="presentation" {...gridlinesDataAttribute(gridNow)} data-is-stepped-out-of={view.isSteppedOutOfCells} data-is-come-to-by-tab={isComeToByTab || undefined} data-holds-edge-of={gridNow.edgeHeldOf ?? undefined} data-holds-fill-handle={gridNow.isFillHandleHeld} data-is-grabbed={isPointerHeldInCells ||
                  gridNow.areLinesDragged ||
                  gridNow.columnsRiding !== null ||
                  gridNow.areCellsHeld ||
                  gridNow.freezeBarHeld !== null ||
                  gridNow.placedViewHeldBy === 'all'} data-holds-side-of-chart={(gridNow.placedViewHeldBy !== null && gridNow.placedViewHeldBy !== 'all') || undefined} style={gridNow.placedViewHeldBy === null || gridNow.placedViewHeldBy === 'all'
                    ? undefined
                    : {
                        cursor: rotatedResizeCursor(gridNow.placedViewHeldBy, 0),
                      }} data-lines-to-take-hold-of={gridNow.linesToTakeHoldOf ?? undefined} data-are-columns-riding={gridNow.areColumnsDrawnAsLanded || undefined} onKeyDown={onCellsKeyDown} onKeyUp={noteModifierKeys} onPointerDown={onGridPointerDown} onMouseDown={onGridMouseDown} onMouseDownCapture={(event) => {
                  if (!isRestOfPressSwallowedRef.current) return;
                  isRestOfPressSwallowedRef.current = false;
                  event.preventDefault();
                  event.stopPropagation();
                }} onPointerUpCapture={(event) => {
                  linkPress.letGo(event, hasPointerMovedRef.current);
                  lineBoxPresses.letGo(event, hasPointerMovedRef.current);
                }} onPointerMove={onGridPointerMove} onPointerEnter={(event) => {
                  let isCaptured = event.currentTarget.hasPointerCapture(event.pointerId);
                  if (event.pointerType === 'mouse' && !isCaptured) onGridPointerMove(event);
                }} onPointerLeave={(event) => {
                  let { pointerType, currentTarget: gridElement } = event;
                  if (pointerType === 'mouse') {
                    errorCardHover.tell(null);
                    linkCardHover.isOver(null);
                    fixPointer.isOver(null, null);
                  }
                  mousePointOverCellsRef.current = null;
                  markCommentLayersUnderMouse(
                    {
                      grid: view.grid,
                      gridElement,
                      zoom,
                    },
                    null,
                  );
                  if (pointerType === 'mouse') mouseAroundComments.hasLeftGrid(didMouseLeaveIntoOverlay(event, gridElement.getBoundingClientRect()));
                  nameFlagsAtPointer.pointerMovedTo(null);
                  filterButtonPointedAt.pointerMovedTo(null);
                  tableHandleCall.pointerMovedTo(null);
                  columnHeadingsCall.pointerMovedTo(null);
                }} onPointerUp={(event) => {
                  if (event.pointerType === 'mouse')
                    mouseAroundComments.isLetGo(
                      markCommentLayersUnderMouse(
                        {
                          grid: view.grid,
                          gridElement: event.currentTarget,
                          zoom,
                        },
                        event,
                      ),
                    );
                  if (
                    fingerTapCaret.fingerLifted(event.pointerId, {
                      x: event.clientX,
                      y: event.clientY,
                    })
                  )
                    isMouseDownHandledRef.current = true;
                  pinchZoom.fingerLifted(event.pointerId, event.timeStamp);
                  if (event.pointerId === secondFingerIdRef.current) secondFingerIdRef.current = null;
                  if (isSecondFinger(event)) return;
                  if (event.pointerId === firstFingerIdRef.current && secondFingerIdRef.current === null)
                    if (hasPointerMovedRef.current) fingerFling.fingerLifted(event.timeStamp, speedAtLetGoRef.current);
                    else fingerFling.stop();
                  if (!isOtherPointerWhileHeld(event)) isPointerKeptRef.current = true;
                  let { pointerId, timeStamp } = event;
                  let wasDragged = hasPointerMovedRef.current;
                  let placementToFocus = wasDragged ? null : placedViewPressedRef.current;
                  placedViewPressedRef.current = null;
                  let pressOnPlacement = placedViewPointerRef.current;
                  let isStill = !wasDragged && dragStartMsRef.current === null;
                  let isTap = isStill;
                  if (pressOnPlacement?.pointerId === pointerId) {
                    placedViewPointerRef.current = null;
                    let pressAt = pointInPlacedView(event, pressOnPlacement.placementId);
                    let { atMs: pressedAtMs } = lastPointerRef.current;
                    let isQuickTap = isStill && timeStamp - pressedAtMs <= TAP_HOLD_LIMIT_MS;
                    let lastTap = placedViewLiftRef.current;
                    let liftedAt = {
                      x: event.clientX,
                      y: event.clientY,
                    };
                    let isDoubleTap =
                      isQuickTap &&
                      lastTap?.placementId === pressOnPlacement.placementId &&
                      pressedAtMs - lastTap.liftedAtMs <= DOUBLE_TAP_GAP_MS &&
                      Math.hypot(liftedAt.x - lastTap.at.x, liftedAt.y - lastTap.at.y) <= TAP_SLOP_PX;
                    placedViewLiftRef.current =
                      isQuickTap && !isDoubleTap
                        ? {
                            placementId: pressOnPlacement.placementId,
                            at: liftedAt,
                            liftedAtMs: timeStamp,
                          }
                        : null;
                    let isFitOnPhone = isDoubleTap && isOnPhone();
                    if (isFitOnPhone) fitPlacedViewInSight(pressOnPlacement.placementId, true);
                    if (isStill && pressAt !== null)
                      setPlacedViewTap({
                        placementId: pressOnPlacement.placementId,
                        ...pressAt,
                      });
                    isTap = isQuickTap && !isFitOnPhone;
                  }
                  if (placementToFocus !== null)
                    findPlacedViewCaret(event.currentTarget.ownerDocument, placementToFocus)?.focus({
                      preventScroll: true,
                    });
                  let chartLetGo = chartTaps.letGo(event, {
                    isTap,
                    areEventsFinished: !store.isEventUnfinished(),
                    charts: store.getView().grid.placedViews,
                  });
                  if (chartLetGo !== null) chartTaps.tell(chartLetGo.placementId, chartLetGo.at);
                  updateTaps((taps) => {
                    let isTapToBeTold = !wasDragged && mayTapBeTold(store.getView().grid);
                    return tapsAfterLift(taps, pointerId, isTapToBeTold ? timeStamp : null);
                  });
                  if (pressPointerIdRef.current === pointerId && !event.currentTarget.hasPointerCapture(pointerId)) onGridPointerUp(event);
                  let link = linkAtPointerPoint(event);
                  if (event.pointerType === 'mouse') linkCardHover.isOver(link === null ? null : cellPointOf(link, event));
                }} onPointerDownCapture={() => {
                  isClickToSwallowRef.current = false;
                  isMouseDownHandledRef.current = false;
                  isRestOfPressSwallowedRef.current = false;
                }} onClickCapture={(event) => {
                  if (isClickToSwallowRef.current && event.detail > 0) event.stopPropagation();
                  isClickToSwallowRef.current = false;
                }} onClick={(event) => {
                  if (isOnSkipTarget(event) && gridNow.selectionSummary?.opensMenu === true) askFigures();
                  let commentHandle = commentCornerKeyAtTarget(event);
                  if (commentHandle !== null)
                    store.dispatch({
                      kind: 'commentMarkPressed',
                      handle: commentHandle,
                    });
                }} onContextMenu={onGridContextMenu} onPointerCancel={onGridPointerCancel} onLostPointerCapture={onGridPointerUp} onDoubleClick={(event) => {
                  if (
                    isInAtEndOfSheet(event.target) ||
                    isInPlacedViewControls(event.target) ||
                    isInOffersAtSelection(event.target) ||
                    isInExpandedEntry(event.target) ||
                    wasPressOnOfferRef.current ||
                    commentCornerKeyAtTarget(event) !== null
                  )
                    return;
                  if (!isPressForMenuRef.current && !event.metaKey && !event.ctrlKey) onPressedTwice(pointInGrid(event), false);
                }}><span id={ERROR_DESCRIPTION_ID} hidden>{view.errorOfActiveCell !== null && errorExplanationWords(view.errorOfActiveCell, canPersonEdit)}</span><span id={LINK_ADDRESS_ID} hidden>{view.whereWordsOfActiveCellLink !== null && view.isAddressOfActiveCellBuilt
                        ? builtLinkAddressLabel(view.whereWordsOfActiveCellLink)
                        : view.whereWordsOfActiveCellLink}</span><div ref={zoomedGridRef} role="presentation" className="sheet-grid-zoomed" style={zoomedStyle(zoom)}><TextWidthProvider within={cellsRef}><ReadersScroller store={store} grid={gridNow} isOn={IS_IOS_BROWSER}><div ref={gridFocusRef} id={SHEET_ROWS_ID} className="sheet-rows" role="grid" tabIndex={typingTarget === 'grid' ? 0 : -1} onFocus={({ target, currentTarget, relatedTarget }) => {
                                if (target !== currentTarget) return;
                                if (didFocusLeaveByTabNow(relatedTarget) && !store.getView().isSteppedOutOfCells) markComeToByTab();
                                if (whereTypingGoes(store.getView()) !== 'formulaBar') {
                                  getTypingTargetElement()?.focus({
                                    preventScroll: true,
                                  });
                                  return;
                                }
                                store.dispatch({
                                  kind: 'entryLeft',
                                });
                                whenFocusStays(refocusTypingTarget);
                              }} aria-label={shownSheetName} aria-describedby={cellEditorDescribedBy} aria-readonly={isViewOnly} aria-multiselectable aria-rowcount={gridNow.rowCount + 1} aria-colcount={gridNow.columnCount + 1} aria-activedescendant={activeCellElementId ?? undefined}><SheetGridDrawing grid={gridNow} linesOnShow={store.linesOnShow()} cornerOnTop={nameFlagsAtPointer.cornerOnTop} cornersCalledUp={nameFlagsAtPointer.cornersCalledUp} flagsHidden={nameFlagsAtPointer.flagsHidden} rowNumberUnderHandle={rowNumberUnderTableHandle(gridNow, tableHandleCalledFor)} /></div></ReadersScroller><AddAtEndOfSheet key={shownSheet?.sheetId} grid={gridNow} isColumnCountCardOpen={isColumnCountCardOpen} onAdd={askLinesAtEnd} onColumnCountAsked={askColumnCountCard} onCaretAtEnd={setCaretAtEnd} onCaretLost={() => {
                                setCaretAtEnd(null);
                                if (cellsRef.current?.ownerDocument.hasFocus() === true) focusCaret();
                              }} /><FilterTableOutlines outlines={gridNow.foundTableOutlines} body={gridNow.body} areOfFoundTables latestRevisionByAgent={gridNow.latestRevisionByAgent} /><React.Fragment key={`filters-${shownSheet?.sheetId}`}><FilterTableOutlines outlines={gridNow.filteredTableOutlines} body={gridNow.body} filteredTablesDrawn={gridNow.filteredTablesDrawn} /><FilterButtonsLayer buttons={gridNow.filterButtons} filteredTablesDrawn={gridNow.filteredTablesDrawn} pointedAt={filterButtonPointedAt.pointedAt} body={gridNow.body} onListAsked={onFilterButtonPressed} onGoingWithCaret={focusCaret} /></React.Fragment><TableHandle grid={gridNow} calledFor={tableHandleCalledFor} isMenuOpen={view.menu?.ofHandleOfTable !== undefined} /><ColumnGrips grid={gridNow} calledFor={columnHeadingsCall.calledFor} /><ColumnsRiding grid={gridNow} gridRef={cellsRef} zoom={zoom} /><CellsHeld held={gridNow.cellsHeld} body={gridNow.body} density={gridNow.density} /><OffersAtSelection grid={gridNow} zoom={zoom} offers={offersAtSelection} isHeldBack={isAnyLayerHeldBack} wasLastPressByMouse={() => wasLastPressByMouseRef.current} onCaretLost={focusCaret} /><PlacedViewsLayer placedViews={gridNow.placedViews} chartBeingMade={gridNow.chartBeingMade} sheetOnShow={shownSheetIdOf(view)} onChartBeingMadeGone={forgetChartBeingMade} body={gridNow.body} zoom={zoom} runsOn={chartsRunOn} tap={placedViewTap} hearPresses={chartTaps.hear} onAct={actOnPlacedView} onAskAgent={isChatToBeHad === true ? openChatAboutChart : null} doesChatTakeWords={doesChatTakeWordsAtOnce} onSendToAgent={sendAboutChart} onFixAsked={(isChatToBeHad ?? wasChatToBeHad) ? sendPressAboutChart : null} onNoticeWithFixCame={lookAtChatUnlessComingSoon} changes={changesOfCharts} pointChart={store.askForEditOfChart} onKeepAnswered={(nodes, says) =>
                              setChartChangeUndoNotice({
                                says,
                                nodes,
                              })} isKeyOfMenu={isKeyOfMenu} onCardOpened={onChartMadeLastOvertaken} cardUnderChart={cardUnderChartRef} onCaret={onPlacedViewCaret} onSidesPressed={notePlacedViewPress} onCaretTaken={closeMenuAndRefocus} saidAtRest={renderSettledWordsAnnouncer} /><GridScrollbars grid={gridNow} store={store} zoom={zoom} /><ExpandedEntryFinishButton grid={gridNow} onFinished={() => dispatchThenFocusTyping('expandedEntryFinished')} /><PeopleField people={peopleListField} chipGoneTo={view.peopleList?.chipGoneTo ?? null} place={peopleListPlacement} keepsToColumn={doesPeopleListKeepToColumn} within={popupBounds} onPersonRemoved={removePersonFromField} onSized={noteEntryHelperRect} typed={entryTextLooks}><CellEntryHint grid={gridNow} /><WordsOffered grid={gridNow} offered={view.wordsOffered} isKeyDrawn={isOfferKeyDrawn} store={store} /><FormulaArriving grid={gridNow} stage={formulaFromWords.stage} actsHeld={formulaFromWords.actsHeld} text={mode.kind === 'editing' ? mode.text : ''} isInFontOfFormulas={isEditingFormula} dispatch={dispatchFromEntryHelper} />{cellEditor}</PeopleField><WordsOfferedButton grid={gridNow} offered={view.wordsOffered} isKeyDrawn={isOfferKeyDrawn} onPressed={pressWordsOffered} /><ExpandButtonAtSelection grid={gridNow} entryBoxRef={typingFieldRef} zoom={zoom} isHeldBack={isAnyLayerHeldBack || isWrapOffered} wasLastPressByMouse={() => wasLastPressByMouseRef.current} onPressed={() => dispatchThenFocusTyping('entryExpandedOrCollapsed')} /></TextWidthProvider>{gridNow.editorBox !== null &&
                        gridNow.editorFlagStands !== null &&
                        entryCellLabel !== null &&
                        (<div aria-hidden className="sheet-name-flags-of-others sheet-flag-on-editor" data-stands={gridNow.editorFlagStands} style={outlineBoxInBody(gridNow.editorBox, gridNow.body)}><div><span style={{
                                maxWidth: `min(240px, ${gridNow.body.width - gridNow.editorBox.left}px)`,
                              }}><bdi>{entryCellLabel.sheet}</bdi>{entryCellLabel.cell}</span></div></div>)}</div></div>{importOnGrid.pictureOverGrid}<AddColumnsPopover isOpen={isColumnCountCardOpen} columnCount={gridNow.columnCount} opener={getAddColumnsButton} onShut={() => setIsColumnCountCardOpen(false)} onKeyPressed={noteCaretAtEndOnKey} onCountChosen={(count) => {
                  askLinesAtEnd('columns', count);
                  forgetComeToByTab();
                }} whatHasCaretAfter={whatHasCaretAfter} /><CalendarUnderCell popupRef={calendarPopupRef} calendar={view.calendar} anchor={calendarAnchor} isEntryOpen={mode.kind === 'editing'} timesAsked={view.timesCalendarAsked} whatHasCaretAfter={whatHasCaretAfter} isKeyboardLeftOutside={isPageLeftWithoutPointer} onGivenUp={closeCalendarIfStill} onShut={closeCalendar} onDayChosen={chooseDay} onTimeChosen={chooseTime} onKeyDown={onCalendarKeyDown} onKeyBroughtCaret={redispatchKeyToFocused} />{view.interactive !== null &&
                <InteractiveSheetSection key={interactiveViewId} sectionRef={interactiveSectionRef} wasKeyPressedLast={wasKeyPressedLast} runsOn={interactivesRunOn} interactive={view.interactive} zoom={zoom} isViewOnly={isViewOnly} onWrite={(cells, whenWritten) => {
                    if (interactiveViewId !== null)
                      store.dispatch({
                        kind: 'interactiveWrote',
                        viewId: interactiveViewId,
                        cells,
                      });
                    store.lookOnceEventsAreFinished(() => {
                      ReactDOM.flushSync(() => {
                        return;
                      });
                      whenWritten();
                    });
                  }} onKeyForPage={(focusMove) => void moveCaretTo('cells', focusMove === 'nextPart' ? 1 : -1)} onKeyDown={onInteractiveKeyDown} onGoneWithKeyboard={focusCaret} fix={interactiveChartAsk} />}</div><ErrorsOfferNotice count={canPersonEdit && !isErrorsAtOpeningOffered && ((isChatToBeHad ?? wasChatToBeHad) || view.fixesOnCells !== null)
                ? (view.errorsOffered?.count ?? null)
                : null} countOffered={view.countOfErrorsOffered} isHeldBack={isAnyLayerHeldBack || isErrorsAtOpeningOffered || cornerOfErrorsOffered === null} areItsCellsInView={view.grid.areCellsOfErrorsOfferInView} canAttach={view.selectionByAddress !== null || view.isOneRangeNeeded} isChatToBeHad={isChatToBeHad ?? wasChatToBeHad} anchor={errorCornerAnchor} place={`${errorCornerLeft} ${errorCornerTop}`} stageOfFixes={view.fixesOnCells?.stage ?? null} countOfFixes={view.fixesOnCells?.count ?? 0} pressForFixes={pressForFixesTracker} holdOnFixes={view.holdsOnAgentsAnswers.fixes} onActHeldAtFixes={holdActAtFixes} onFixesActedOn={onFixesAct} onFixAsked={askAgentToFixAfterEdit} onPutAway={putAwayErrorsOffer} onWheelTurned={forwardWheelToCells} onKeyPressed={onErrorsNoticeKeyDown} onGoneWithFocus={returnFocusAfterErrorsNotice} /><FixPill cellKey={actableFixPillKey} shown={pillOfFix?.shown ?? null} formulaIfCut={pillOfFix?.formulaIfCut ?? null} cellHeight={(fixPillHeight ?? 0) * zoom} came={fixKeyCameAt} anchor={fixPillAnchor} side={pillOfFix?.side ?? null} hold={view.holdsOnAgentsAnswers.fixes} onActHeld={holdActAtFixes} onActedOn={onFixActedOn} onPointed={fixPointer.isOnPill} /><div className={`sheet-bar ${sheetBehindSidePaneClass}`} style={headerRoomStyle} onPointerDownCapture={({ pointerType }) => {
              isSheetPointingBlockedRef.current = pointerType === 'touch';
            }} onKeyDownCapture={() => {
              isSheetPointingBlockedRef.current = false;
            }}><SheetPicker ref={sheetTabsRef} addSheetButton={addSheetButtonRef} listedSheets={importOnGrid.listedSheets} viewOnlyBecause={view.viewOnlyBecause} isUnfinishedFormulaOpen={view.isUnfinishedFormulaOpen} onListOpenChange={onSheetsLayerOpenChange} whatHasCaretAfterList={whatHasCaretAfter} timesRenameBegunElsewhere={timesRenameBegunElsewhere} onKeyDown={onSheetsTabsKeyDown} isChosenForFormula={canSwitchSheet} onImportChosen={chooseImportFile} filesForAgent={filesOfferedToAgent} onFileForAgentChosen={askFilesForAgent} lookOnceEventsAreFinished={lookOnceEventsAreFinished} dispatch={dispatchFromSheetTabs} />{view.viewOnlyBecause === null && importFilePicker.input}{view.calculating !== null &&
                <CalculatingSpinner isTurning={view.calculating === 'underWay'} />}<ContentsBox onMouseDown={preventMouseDownDefault} onKeyDown={onFiguresKeyDown}><SelectionFigures kept={view.figuresOfSelection} signsOfNumbers={view.signsOfNumbers} store={store} inPage={cellsRef} onMenuOpenChange={onFiguresLayerOpenChange} whatHasCaretAfter={whatHasCaretAfter} /></ContentsBox><ContentsBox onMouseDown={preventMouseDownDefault} onKeyDown={onSheetsBarKeyDown}>{atEndOfSheetBar}</ContentsBox>{areViewToolsAtFoot &&
                <div ref={shownViewToolsRef} role="presentation" className="sheet-view-tools" onMouseDown={preventMouseDownDefault} onKeyDown={onViewToolsKeyDown}><TooltipGroup>{viewMenu}</TooltipGroup></div>}</div><div ref={overGridRef} className="sheet-over-grid">{(view.formatOfSelection !== null || isInteractiveWritable || versionLook !== null) &&
              (<div ref={setFootBar} className={`sheet-foot ${sheetBehindSidePaneClass}`} data-has-format-tools={contextBar !== false || undefined} data-is-entry-open={mode.kind === 'editing' || undefined} data-keeps-room-of-pane={isRoomKeptForGonePane ? 'of-gone-pane' : undefined} role="presentation">{areWaysInSeen &&
                    versionLook === null &&
                    <ContentsBox {...waysInFocus}><WaysInToolbar ref={setFootNoticeElement} onAskAgent={askAgentFromWaysInOffer} onImportChosen={chooseImportFile} filesForAgent={filesOfferedToAgent} onFileForAgentChosen={askFilesForAgent} whatHasCaretAfter={whatHasCaretAfter} onMenuOpenChange={onWaysInLayerOpenChange} onKeyDown={onWaysInKeyDown} /></ContentsBox>}<UndoAgentTurnCard offer={undoOfferOnCard} isBeingTaken={addedChartOnCard === null && !isPlainUndoOfferShown && view.isUndoOfTurnAwaited} onTaken={addedChartOnCard === null ? takeUndoOfferShown : undoAddedChart} ref={setUndoOfTurnCard} onKeyDown={onUndoOfTurnKeyDown} onGoneWithKeyboard={focusCaret} onLeftAlone={liftUndoCardNextFrame} wait={addedChartOnCard === null ? (undoOfferShown?.wait ?? null) : null} onSeenLongEnough={(wait) =>
                      store.dispatch(
                        isPlainUndoOfferShown
                          ? {
                              kind: 'undoOfferDismissed',
                            }
                          : {
                              kind: 'workShownLongEnough',
                              wait,
                            },
                      )} /><UiRoot render={<Surface elevation="panel" className="sheet-card-of-tools flex max-w-full items-center gap-1 p-1" onMouseDownCapture={leavePlacedViewOnPress} onClickCapture={leavePlacedViewOnPress} />}>{versionLook !== null &&
                        view.versionHistory !== null &&
                        <EarlierVersionBar history={view.versionHistory} look={versionLook} onAct={onVersionHistoryAct} barRef={versionBarRef} onRoomForRestore={setIsRestoreInBar} onKeyDown={onFormatToolsKeyDown} onGoneWithKeyboard={focusCaret} />}{versionLook === null && contextBar}{versionLook === null &&
                        isNarrowWithFormatBar &&
                        areTabsAway &&
                        !isFormulaAskedOrProposed(view) &&
                        <HideKeyboardButton onPressed={leaveMenuAndEntryOnPress} />}{versionLook === null && readerBar}</UiRoot><DoneByAgentCard done={addedChartOnCard === null && view.doneByAgent?.isCardUp === true ? view.doneByAgent : null} /></div>)}</div></div><CellContextMenu isOpen={view.menu !== null && !isMenuHoldingField(view.menu)} isAskedByKey={view.menu?.isAskedByKey === true} placeAsked={menuAt} onWindowLeftWithMenuAskedAt={closeMenuIfAskedAt} staysOpenAsWindowIsLeft={isBlurPending} isAskedToSearch={view.menu?.isToSearch === true} isOfContextBar={view.menu?.isOfContextBar === true} isOfHandleOfTable={view.menu?.ofHandleOfTable !== undefined} ofChart={chartMenuOf} cardUnderChart={cardUnderChartRef} onChartCopyChosen={chooseChartCopy} onChartDeleteChosen={chooseChartDelete} canInsertChart={chartNotice === null && areFormatToolsInView} canCellsMakeChart={view.chartsOnOffer.length > 0 && (canChartBeAsked !== false || areChartKindsForPage)} onChartCardAsked={askChartFromMenu} onKeyDownInMenuOfHandle={onTableMenuKeyDown} anchor={menuAnchor} side={view.menu?.side ?? null} whatHasCaretAfter={whatHasCaretAfterContextBarMenu} linkUrl={view.linkOfActiveCell} linkInWordsUrl={view.linkInWordsOfActiveCell?.url ?? null} isLinkInWordsBuilt={view.isAddressOfActiveCellBuilt} selectionIsOf={view.selectionIsOf} selectedRowCount={view.selectedRowCount} selectedColumnCount={view.selectedColumnCount} selectedCellCount={view.selectedCellCount} rowCountToSize={view.rowCountToSize} columnCountToSize={view.columnCountToSize} isOneRangeNeeded={view.isOneRangeNeeded} isSelectionCutByOwnFilters={view.isSelectionCutByOwnFilters} isSelectionCutByOwnSort={view.isSelectionCutByOwnSort} heldToPaste={lastPutHereHolds} canPasteValuesOnly={valuesOfLastPutHere !== null} canMergeSelection={view.canMergeSelection} canUnmergeSelection={view.canUnmergeSelection} canMoveSelectionBack={view.canMoveSelectionBack} canMoveSelectionOn={view.canMoveSelectionOn} freezeChoices={view.freezeChoices} groupChoices={view.groupChoices} canDeleteSelectedRows={view.canDeleteSelectedRows} canDeleteSelectedColumns={view.canDeleteSelectedColumns} areWholeRowsSelected={view.areWholeRowsSelected} areWholeColumnsSelected={view.areWholeColumnsSelected} columnToSortBy={view.columnToSortBy} canSortSelectedRange={view.canSortSelectedRange} columnToSortSelectedRangeBy={view.columnToSortSelectedRangeBy} columnsOfferedToSortBy={view.columnsOfferedToSortBy} headingToSortBy={view.headingToSortBy} headingToSortSelectedRangeBy={view.headingToSortSelectedRangeBy} keysToSortBy={view.keysToSortBy} canSortTableAtCell={view.canSortTableAtCell} menuSortsFor={view.menuSortsFor} keysToSortSelectedRangeBy={view.keysToSortSelectedRangeBy} formatOfSelection={view.menu === null ? null : view.formatOfSelection} holdsOnlyFigures={view.menu?.holds === 'figures'} holdsNoEdits={view.menu?.holds === 'noEdits'} ownFilterOffers={view.ownFilterOffers} formatAsTableOffer={view.formatAsTableOffer} figures={view.figures} isChatToBeHad={isChatToBeHad} wasChatToBeHad={wasChatToBeHad} hasAddressForAgent={view.selectionByAddress !== null} doCellsShowError={canPersonEdit && doesSelectionShowError(view)} canActiveCellBeFixedHere={fixOfferOfMenu === 'ofActiveCell' || fixOfferOfMenu === 'ofSelectedCells'} isFixOfActiveCellYetToBeKnown={fixOfferOfMenu === 'yetToBeKnown'} onFixAsked={fixOfferOfMenu === 'ofSelectedCells' ? askFixesOfSelectedCells : askFixFromCellMenu} onClosed={closeMenu} onLinkOpened={openLinkFromMenu} onLinkCopied={copyLinkAddress} linkByHandOffered={view.linkByHandOffered} doesKeyOpenLinkForm={view.doesKeyOpenLinkForm} onLinkFormAsked={askLinkForm} onLinkCardAsked={askLinkCard} isCommentOffered={view.isCommentOffered && versionLook === null} onCopyOrCutChosen={askCopyOrCutFromMenu} keyThatPastes={isKeyboardLikely ? PRIMARY_MODIFIER_NAME : null} onPasteChosen={pasteFromMenu} onPasteMeantForCells={notePasteEvent} onCommentChosen={chooseComment} onClearChosen={clearCellsFromMenu} onChangeChosen={chooseSheetChange} onOwnFilterAsked={askOwnFilter} onSortAndFilterAsked={askSortFromMenu} onOwnFilterByCellChosen={chooseOwnFilterByCell} onOwnFilterRemoved={clearOwnFiltersOfTable} onFormatAsTableChosen={chooseFormatAsTable} onColumnToSortByChosen={chooseColumnToSortBy} onFreezeChosen={chooseFreeze} onGroupLevelChosen={chooseGroupLevelFromMenu} onFormatChosen={chooseCellFormatInMenu} cellTypes={cellTypes} onConditionalFormatsAsked={askRulesFromCells} onSortPaneAsked={askSortPaneFromMenu} onFigureChosen={chooseFigure} areDropdownsSelected={view.canDropdownBeRemoved} onInsertChosen={insertCellControlFromMenu} isCellHistoryOffered={view.canCellHistoryBeAsked} onCellHistoryAsked={askCellHistory} isActiveCellOfPivotTable={view.isActiveCellOfPivotTable} onPivotTableAsked={askPivotTable} onAgentAsked={askAgentAboutSelectionFromMenu} onAgentAskedInComment={chooseCommentForAgent} onFindAskedFor={view.menu === null ? ignoreFindAsked : openFind} addressOfActiveCell={view.menu === null ? null : (view.selectionByAddress?.activeCell ?? null)} commandsOfBar={view.menu === null ? noCommandsOfBar : commandsOfBar} commandsOfTyped={view.menu === null ? noCommandsOfTyped : commandsOfTyped} commandsByName={view.menu === null ? noCommandsByName : commandsByName} onSearchBegun={askCostsInMenu} askForCommands={askForCommands} canAskForCommands={store.canAskForCommands} isAgentForToolsExpected={isAgentForToolsExpected} onOpened={askWhetherAgentCanBeSent} couldCommentGoToAgent={couldSendToAgent} mightChatLeaveSheet={isChatOfferedInMenu} canRuleBeAskedInWords={view.doRulesOpenInCard && view.formatOfSelection !== null} rulesInMenu={conditionalFormatsInMenu?.isAboutWords === true ? conditionalFormatsInMenu : null} rulesSuggested={conditionalFormatsInMenu?.suggestions ?? null} onSuggestedRulesWanted={suggestRulesInMenu} onSuggestedRulePointedAt={pointAtRuleSuggestion} onSuggestedRuleTaken={takeRuleSuggestion} onRulesAsked={startOrShowRules} onRuleAskedInWords={askRuleInMenu} onRuleLetGo={letGoOfRuleInMenu} onRuleKept={keepRulesOffer} onRuleStopped={stepBackInRules} onCommandTaken={withMenuOpenedBy} /><DropdownListUnderCell list={dropdownList} anchor={dropdownAnchor} cellElementId={dropdownList === null ? null : gridNow.activeCellElementId} isCardBeside={isListLiveRegionOn} onRoomBesideMeasured={setIsListLiveRegionOn} onRowChosen={onDropdownRowChosen} onCardAsked={askCardByRestingPointer} onCardOfOptionAsked={askCardOfOption} onOptionsNamed={nameOptionsInList} onNewOptionNoLongerNamed={stopNamingNewOption} onOptionMoved={moveOptionInList} onCaretGivenBack={giveCaretBackToCells} onCardRowChosen={chooseCardRow} onCardShut={shutCard} onShut={onDropdownBlur} /><ConditionalFormattingPane pane={view.conditionalFormats} timesAsked={view.timesSidePaneAsked} changesAskedFor={view.grid.changesAskedFor} paneRef={sidePaneRef} takesNoTyping={sidePaneTakesNoTyping} paneWidth={sidePaneWidth} onPaneWidthChange={setSidePaneWidth} onKeyDownInPane={onSidePaneKeyDown} whatHasCaretAfter={whatHasCaretAfter} wasPointerPressedLast={wasPointerPressedLast} whatColorPickerShows={store.whatColorPickerShows} onAct={onConditionalFormatsAct} lookOnceEventsAreFinished={lookOnceEventsAreFinished} onPressed={returnFocusFromConditionalFormats} onShut={shutSidePane} onAskAgent={isChatToBeHadOrWas ? askAgentAboutPaneRule : null} onAskedInChat={canAskInChatAboutRules ? askForRulesInChat : null} /><DropdownPane isOpen={view.isSidePaneAboutDropdown} editor={view.dropdownEditor} timesAsked={view.timesSidePaneAsked} paneRef={sidePaneRef} takesNoTyping={sidePaneTakesNoTyping} paneWidth={sidePaneWidth} onPaneWidthChange={setSidePaneWidth} onKeyDownInPane={onSidePaneKeyDown} whatHasCaretAfter={whatHasCaretAfter} wasPointerPressedLast={wasPointerPressedLast} whatColorPickerShows={store.whatColorPickerShows} onAct={onDropdownEditorAct} onShut={shutSidePane} /><CustomSortPane pane={view.sortPane} timesAsked={view.timesSidePaneAsked} paneRef={sidePaneRef} takesNoTyping={sidePaneTakesNoTyping} paneWidth={sidePaneWidth} onPaneWidthChange={setSidePaneWidth} onKeyDownInPane={onSidePaneKeyDown} whatHasCaretAfter={whatHasCaretAfter} wasPointerPressedLast={wasPointerPressedLast} onAct={onSortPaneAct} onShut={shutSidePane} /><PivotTablePane pane={view.pivotTablePane} timesAsked={view.timesSidePaneAsked} paneRef={sidePaneRef} takesNoTyping={sidePaneTakesNoTyping} paneWidth={sidePaneWidth} onPaneWidthChange={setSidePaneWidth} onKeyDownInPane={onSidePaneKeyDown} whatHasCaretAfter={whatHasCaretAfter} wasPointerPressedLast={wasPointerPressedLast} onAct={onPivotTablePaneAct} onShut={shutSidePane} /><VersionHistoryPane history={view.versionHistory} timesAsked={view.timesSidePaneAsked} paneRef={sidePaneRef} takesNoTyping={sidePaneTakesNoTyping} paneWidth={sidePaneWidth} onPaneWidthChange={setSidePaneWidth} onKeyDownInPane={onSidePaneKeyDown} whatHasCaretAfter={whatHasCaretAfter} wasPointerPressedLast={wasPointerPressedLast} onAct={onVersionHistoryAct} isRestoreInBar={isRestoreInBar} onPressed={returnFocusFromVersionHistory} onLookAgain={lookAtVersionsAgain} onShut={shutSidePane} /><ErrorCard error={gridNow.explainedCellBox === null ? null : (view.errorExplained?.error ?? null)} by={view.errorExplained?.by ?? null} cellKey={view.errorExplained?.cellKey ?? null} canPersonEdit={canPersonEdit} isHeldBack={isAnyLayerHeldBack} anchor={errorExplainedAnchor} side={view.errorExplained === null || gridNow.explainedCellBox === null ? null : gridNow.sideOfExplainedCell} placeOfCell={`${explainedCellLeft} ${explainedCellTop} ${gridBody.width} ${gridNow.clearBodyHeight}`} isFixOffered={canPersonEdit && isChatToBeHad === true} isFixedHere={canPersonEdit && view.errorExplained?.canBeFixedHere === true} canAttach={view.selectionByAddress !== null || view.isOneRangeNeeded} mouse={errorCardHover} onFixAsked={askFixFromErrorCard} onPutAway={putAwayErrorCard} onWheelTurned={forwardWheelToCells} /><LinkCard urls={linkExplainedRect === null ? null : (view.linkExplained?.urls ?? null)} urlsOnWords={view.linkExplained?.urlsOnWords ?? NO_URLS_ON_WORDS} isInWords={view.linkExplained?.isInWords ?? null} isBuilt={view.linkExplained?.isBuilt ?? null} by={view.linkExplained?.by ?? null} cellKey={view.linkExplained?.cellKey ?? null} marked={view.linkExplained?.marked ?? null} isHeldBack={isAnyLayerHeldBack} isBroughtByFingerOrPen={(view.linkExplained?.by !== 'pointer' || view.linkExplained.isByPress) && !isLinkCardPressedAway} anchor={linkExplainedAnchor} roomAbove={gridNow.roomAboveExplainedCell} seen={linkCardSeen} mouse={linkCardHover} onLinkOpened={openLinkFromCard} onLinkCopied={copyLinkIfSeen} onEditChosen={view.viewOnlyBecause === null ? chooseLinkEdit : null} onRemoveChosen={view.viewOnlyBecause === null && (view.linkExplained?.canBeTakenOff === true || (view.linkExplained?.urlsOnWords.length ?? 0) > 0)
            ? chooseLinkRemove
            : null} onPressedTooSoon={leaveLinkCard} onWheelTurned={forwardWheelToCells} onFingerCameDown={stopOnFingerDown} onSwipedByFinger={captureSwipe} /><LinkEditPopup form={isLinkFormShown ? view.linkForm : null} anchor={linkFormAnchor} whatHasCaretAfter={whatHasCaretAfter} onSaved={giveLink} onShut={shutLinkForm} /><PeopleList list={peopleList} cellAnchor={entryHelperAnchor} formulaBarAnchor={formulaBarTextStartAnchor} cellElementId={peopleList === null ? null : gridNow.activeCellElementId} isCardBeside={isEntryLiveRegionOn} onRoomBesideMeasured={setIsEntryLiveRegionOn} onRowChosen={choosePeopleListRow} onCardAsked={askCardByRestingPointer} onCardRowChosen={chooseCardRow} onCardShut={shutCard} onShut={onPeopleListBlur} /><TimeListPopup list={view.timeList} anchor={entryHelperAnchor} cellElementId={view.timeList === null ? null : gridNow.activeCellElementId} onRowChosen={chooseTimeListRow} onRowPointedAt={pointAtTimeListRow} onShut={onTimeListBlur} /><FunctionHelp list={view.functionList} guide={view.functionGuide} caretAfterPick={view.caretAfterPick} writtenWhole={view.functionWrittenWhole} typingIn={mode.kind === 'editing' ? mode.typingIn : null} isBoxInSight={typingTarget === 'formulaBar' || gridNow.editorBox !== null} isCellBoxAComboBox={isEditorACombobox} isReferencePointedAt={view.pointedCells !== null} cellAnchor={entryHelperAnchor} cellElementId={view.functionList === null ? null : gridNow.activeCellElementId} decimalSign={view.decimalSign} boxes={entryFieldRefs} dispatch={dispatchFromEntryHelper} /><FormulaFromWordsHelp formulaFromWords={formulaFromWords} typingIn={mode.kind === 'editing' ? mode.typingIn : null} cellAnchor={entryHelperAnchor} cellElementId={formulaFromWords.stage === null ? null : gridNow.activeCellElementId} boxes={entryFieldRefs} dispatch={dispatchFromEntryHelper} isFormulaTyped={mode.kind === 'editing' && mode.text.startsWith('=')} /><KeyboardShortcutsDialog isOpen={view.isListOfKeysOpen} isViewOnly={isViewOnly} hasComments={view.hasCommentsOnCells} whatHasCaretAfter={whatHasCaretAfterKeysList} onShut={shutListOfKeys} />{guide !== undefined &&
        <WalkthroughCard guide={guide.from} store={store} anchor={guideAnchor} areCellsLit={boxesLitByLink.length > 0} isAtEnd={isGuideAtEnd} isPersonAtWorkInPage={guide.isPersonAtWorkInPage} onKeyDown={onGuideKeyDown} giveCaretBack={returnFocusAfterErrorsNotice} />}<CellHistoryPopover history={view.cellHistory} anchor={cellHistoryAnchor} decimalSign={view.decimalSign} whatHasCaretAfter={whatHasCaretAfterLayer} onScopeChosen={chooseCellHistoryScope} onTryAgain={askCellHistoryAgain} onLookAgain={lookAtCellHistoryAgain} onShut={shutCellHistory} /><OwnFilterList list={view.ownFilterList} clearAtFoot={!isFilterListOpenerShown ? filterListClearAtFoot : hangsBesideTable ? clearAtFoot : 0} onDrawn={!isFilterListOpenerShown ? noteFilterListDrawn : hangsBesideTable ? noteColumnsCardDrawn : null} anchor={!isFilterListOpenerShown ? filterListAnchor : hangsBesideTable ? besideTableAnchor : filterListOpener.anchor} whatHasCaretAfter={whatHasCaretAfterOwnFilterList} onGone={forgetClosedFilterListOpener} onBack={isFilterListFromButton ? askSortCardFromFilterList : null} onAct={onFilterListAct} onSort={view.viewOnlyBecause === null || view.ownFilterList?.sort?.isForOneself === true ? chooseFilterListSort : null} onShut={shutOwnFilterList} onActedWithin={clearFilterListLeftByPress} /><ColumnWidthDialog isOpen={isColumnWidthFieldOpen} columnCount={view.columnCountToSize} widthInPixels={view.selectedColumnWidth} whatHasCaretAfter={whatHasCaretAfterLayer} onWidthChosen={chooseColumnWidth} /><RowHeightDialog isOpen={isRowHeightFieldOpen} rowCount={view.rowCountToSize} heightInPixels={view.selectedRowHeight} isHeightGiven={view.isSelectedRowHeightGiven} density={view.density} onDensityChosen={chooseDensity} whatHasCaretAfter={whatHasCaretAfterLayer} onHeightChosen={chooseRowHeight} /><SortScopeDialog asked={view.cellsToSortAsked} whatHasCaretAfter={whatHasCaretAfterPaneLayer} onChosen={chooseCellsToSort} /><CustomNumberFormatDialog entry={view.customNumberFormat?.typedIn === 'dialog' ? view.customNumberFormat : null} isAgentOffered={view.isAgentOfferedForPattern && !isComposing} whatHasCaretAfter={whatHasCaretAfterLayer} onTyped={typeCustomNumberFormat} onEntered={enterCustomNumberFormat} onDropped={dropCustomNumberFormat} onEscaped={escapeCustomNumberFormat} onAgentAsked={askAgentForNumberFormat} onActHeld={holdActAtNumberFormat} /><AgentsAnswerHolds holds={view.holdsOnAgentsAnswers} store={store} /><HiddenTextPasteDialog shown={view.pasteThatWaits} whatHasCaretAfter={whatHasCaretAfterLayer} onAnswered={answerPasteThatWaits} /><LocaleTimeZoneDialog pick={view.pickForWorkbook} whatHasCaretAfter={whatHasCaretAfterLayer} onPicked={pickForWorkbook} onEntered={enterPickForWorkbook} onDropped={dropPickForWorkbook} /><ImportDialog importOfAFile={view.importOfAFile} fileAwaited={view.fileAwaited} whatHasCaretAfter={whatHasCaretAfterLayer} onAnswered={answerImportQuestion} onDestinationPicked={chooseImportDestination} onChangedByHand={changeImportByHand} onKindsWanted={askImportKinds} onWished={sendImportWish} onAskedAgain={askImportPlanAgain} onAwaitedNoLonger={stopAwaitingImportPlan} {...importOnGrid.dialog} onKept={keepImport} onFileAsked={chooseImportFileOfAnyKind} onFileDropped={takeDroppedFile} chooseButtonRef={chooseFileButtonRef} isKeyboardLeftOutside={callLatestAfterDialog} wasKeyPressedLast={wasKeyPressedLast} onCaretOwed={noteDialogReturn} /><ExportReadyDialog file={view.xlsxFileReady} whatHasCaretAfter={whatHasCaretAfterLayer} onShut={shutXlsxFileDialog} /><PageFileDrop isTaken={canTakeDroppedFile(view) && !isAnyLayerHeldBack} wayInByKeyboard={addSheetButtonRef} onDropped={takeDroppedImport} /></div>;
  return <CanTakeFocusContext value={isPageReallyLeft}><SidePaneShutContext value={giveUpSidePane}><DateInputLocaleContext value={dateExample}>{sheetsPage}</DateInputLocaleContext></SidePaneShutContext></CanTakeFocusContext>;
}
export const DRAG_HELD_STILL_TICK_MS = 60;
export const HELD_STILL_SLOW_TICKS = 16;
export const isHeldStillTickToScroll = (times: number) =>
  times % (times <= HELD_STILL_SLOW_TICKS ? 4 : times <= 2 * HELD_STILL_SLOW_TICKS ? 2 : 1) === 0;
export const isWithinTapSlop = (point: GridPoint, startPoint: GridPoint) =>
  Math.hypot(point.x - startPoint.x, point.y - startPoint.y) < DRAG_SLOP;
export const NO_DRAG_WAY: GridPoint = {
  x: 0,
  y: 0,
};
export const toDomRect = ({ left, top: rectTop, width, height }: PaneRect) =>
  new DOMRect(left, rectTop, width, height);
export const POINTER_DOWN_REPEAT_MS = 300;
export const FILL_HANDLE_TOUCH_WINDOW_MS = 150;
export const FOCUS_COMING_BACK_WAIT_MS = 200;
export const INITIAL_FOCUS_SELECTOR = 'input[data-initial-focus],textarea[data-initial-focus],[data-initial-focus] [role=combobox]';
export const SHEET_FOOT_GAP = 8;
export const UNDO_OF_TURN_LIFT_PROPERTY = '--sheet-lift-of-undo-of-turn';
export const CELL_SCROLL_FOOT_ROOM = 88;
export const isPickerField = (target: EventTarget | null) => isAtEndOfSheetInput(target) || isPlacedViewAskInput(target);
export const CELL_ADDRESS_ID = 'cell-address';
export const FORMULA_FIELD_ID = 'formula-field';
export const FORMULAS_SHOWN_ID = 'formulas-shown';
export const KEY_TO_LIST_OF_KEYS_ID = 'key-to-list-of-keys';
export const HAS_FOCUS_BY_KEY_ATTRIBUTE = 'data-has-focus-by-key';
export const countsNothing = () => {};
export const runAtOnce = (run: () => void) => (run(), () => {});
/** A part of the page that F6 and Shift+F6 step through. */
export type PagePart =
  | 'functionsButton'
  | 'formulaBar'
  | 'viewTools'
  | 'ownFilterBar'
  | 'pivotTableBar'
  | 'findBar'
  | 'cells'
  | 'guide'
  | 'offersAtSelection'
  | 'charts'
  | 'endOfSheet'
  | 'errorsNotice'
  | 'toasts'
  | 'undoOfTurn'
  | 'waysIn'
  | 'formatTools'
  | 'sheets'
  | 'sidePane';
export const PAGE_PARTS_IN_F6_ORDER: readonly PagePart[] = [
  'functionsButton',
  'formulaBar',
  'viewTools',
  'ownFilterBar',
  'pivotTableBar',
  'findBar',
  'cells',
  'guide',
  'offersAtSelection',
  'charts',
  'endOfSheet',
  'errorsNotice',
  'toasts',
  'undoOfTurn',
  'waysIn',
  'formatTools',
  'sheets',
  'sidePane',
];
export const ARROW_KEY_STEPS: Readonly<Partial<Record<string, number>>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};
export const SHEET_SCROLLER_MARGIN = 28;
export const whereTypingGoes = ({ mode, isCaretWithCellsBeforeEntryEnds }: Pick<PageView, 'mode' | 'isCaretWithCellsBeforeEntryEnds'>): TypingTarget =>
  mode.kind === 'editing' && !isCaretWithCellsBeforeEntryEnds ? mode.typingIn : 'grid';
export const areCellsOffLimits = ({
  viewOnlyBecause,
  isSteppedOutOfCells,
  doesCommentModePickCells,
}: Pick<PageView, 'viewOnlyBecause' | 'isSteppedOutOfCells' | 'doesCommentModePickCells'>) =>
  viewOnlyBecause !== null || isSteppedOutOfCells || doesCommentModePickCells;
/** A layer of the page that holds keys back from the cells while it is open. */
export type HeldBackLayer = 'ofToolbar' | 'ofWaysIn' | 'ofZoom' | 'ofNamedViews' | 'ofFigures' | 'ofSheets';
/** A part of the tools that may open a menu of its own, and the layer that menu is. */
export interface ToolPartWithMenu {
  part: 'functionsButton' | 'viewTools' | 'formatTools';
  ownMenu: HeldBackLayer | null;
}
export const TOOL_PARTS_WITH_MENUS: readonly ToolPartWithMenu[] = [
  {
    part: 'functionsButton',
    ownMenu: null,
  },
  {
    part: 'viewTools',
    ownMenu: 'ofZoom',
  },
  {
    part: 'formatTools',
    ownMenu: 'ofToolbar',
  },
];
export const objectKeys = new WeakMap<object, number>();
lastObjectKey = 0;
export const FUNCTION_ICON_PROPS: { icon: IconName } = {
  icon: 'Function',
};
export const WARNING_TOAST_ICON_PROPS = {
  icon: <DangerWarningIcon size="md" />,
};
export const OFFSCREEN_SPOT = {
  left: -1e4,
  top: 0,
};
export const PLAIN_TEXT_FIELD_PROPS = {
  spellCheck: false,
  autoComplete: 'off',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  enterKeyHint: 'done',
  'data-gramm': 'false',
  'data-gramm_editor': 'false',
  'data-enable-grammarly': 'false',
} satisfies FieldAttributes;
export const NO_OFFSET: GridPoint = {
  x: 0,
  y: 0,
};
export const NO_URLS_ON_WORDS: LinkExplainedView['urlsOnWords'] = [];
export const FORMULA_FIELD_MAX_ROWS = 6;
export const FORMULA_FIELD_MAX_ROWS_OPENED = 14;
export const OPEN_ENTRY_SELECTOR = '.sheet-expanded-entry, .sheet-cell-editor:not([data-is-waiting])';
export const PRIMARY_MODIFIER_NAME = IS_APPLE_PLATFORM ? 'command' : 'control';
export const SHEET_ROWS_ID = 'sheet-rows';
export const ACTIVE_DESCENDANT_PAUSE_MS = 1000;
export const cellEntryComboboxProps = (
  activeDescendantId: string | null,
): Pick<React.HTMLAttributes<HTMLElement>, 'role' | 'aria-expanded' | 'aria-haspopup' | 'aria-controls' | 'aria-activedescendant'> => ({
  role: 'combobox',
  'aria-expanded': true,
  'aria-haspopup': 'grid',
  'aria-controls': SHEET_ROWS_ID,
  'aria-activedescendant': activeDescendantId ?? undefined,
});
export const GRID_KEY_FIELD_PROPS = {
  inputMode: 'none',
  'data-holds-one-line': true,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} satisfies FieldAttributes;
export const isAltShortcutKey = (keyEvent: KeyWithModifiers) =>
  (keyEvent.altKey && !keyEvent.ctrlKey && !IS_APPLE_PLATFORM && keyEvent.key !== '=') ||
  (keyEvent.metaKey && ['`', '~'].includes(latinKeyOf(keyEvent, true)));
export const normalizedKeyEvent = (keyEvent: KeyEventFields): KeyPress => readKeyPress(keyEvent, IS_APPLE_PLATFORM);
export const REDISPATCHED_KEYDOWNS = new WeakSet<KeyboardEvent>();
export const redispatchedKeydown = (sourceEvent: KeyboardEvent) => {
  let redispatched = new globalThis.KeyboardEvent(
    'keydown',
    Object.assign(sourceEvent, {
      modifierAltGraph: sourceEvent.getModifierState('AltGraph'),
    }),
  );
  REDISPATCHED_KEYDOWNS.add(redispatched);
  return redispatched;
};
export const POINTER_TEXT_REACH_PX = 200;
export const keysOfLines = <Key,>(lines: readonly { key: Key }[]) => lines.map(({ key }) => key);
export const SHIFT_SPACE_KEY: KeyPress = {
  key: ' ',
  isShiftHeld: true,
  isModifierHeld: false,
  isAltHeld: false,
  isRepeat: false,
};
export const isMacCtrlLetterWhileEditing = (keyEvent: KeyEventFields, mode: PageMode) =>
  IS_APPLE_PLATFORM && keyEvent.ctrlKey && !keyEvent.metaKey && mode.kind === 'editing' && /^[a-z]$/i.test(normalizedKeyEvent(keyEvent).key);
export const todayDate = () => isoDayOfDate(new Date());
export const isOnSkipTarget = ({ target }: Pick<Event, 'target'>) => target instanceof Element && target.id === SELECTION_SUMMARY_ID;
export const RELOAD_BUTTON_BUSY_MS = 60000;
export const isNeverInStaffTrials = () => false;
export const ignoreFindAsked = () => {
  return;
};
export const noCommandsOfBar = (): MenuCommand[] => [];
export const noCommandsOfTyped = () => null;
export const noCommandsByName = (): CommandsUnderHeading<MenuCommand>[] => [];
export const MOST_TYPED_COMMANDS = 8;
/** Where a choice was made, when it was not made on the cells. */
export interface ChoiceMadeIn {
  chosenIn?: ChosenIn;
}
export const CHOSEN_IN_MENU: ChoiceMadeIn = {
  chosenIn: 'menu',
};
export const NO_CHOSEN_IN: ChoiceMadeIn = {};
export const ADDED_CHART_SELECT_TRIES = 3;
export const isAgentNeverWorking = () => false;
export const GUIDE_EDGE_GAP = 20;
export const GUIDE_ROOM_ABOVE_OR_BELOW = 240;
export const GUIDE_CARD_HEIGHT = 286;
