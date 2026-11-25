import type { Color, SheetId } from '@open-artifact/sheets-core';
import type { CellId } from '../model/workbook.ts';
import type { LineSizes } from '../model/line-sizes.ts';
import type { CellArea, SelectionKind } from '../selection/model.ts';
import type { DropdownCellsRefused, DropdownEditorInPane, PageState, RulesInPane, WordsOffered } from '../state/initial-state.ts';
import type { FigureOfCells, SumFigure } from '../selection/figures.ts';
import type { SelectedLines } from '../selection/move-lines.ts';
import type { CellExplained } from '../state/explained-under-cell.ts';
import type { PopupOverEntry } from '../state/list-cards.ts';
import type { EscapeInCells } from '../state/escape.ts';
import type { CalculatingToShow, Wait } from '../state/calculating-shown.ts';
import type { refreshConditionalFormatsPane } from '../format/conditional/pane-reducer.ts';
import type { ReadsWithTextMeasurer, ShiftOfView } from '../state/controller.ts';
import type { OpenedWorkbook } from '../engine/worker-workbook.ts';
import { mergedAreaOrCellOf, activeAnchorCell, selectedArea, isSameArea, selectionKindOf, isSameCell } from '../selection/model.ts';
import { boxOfCellRange, rangeSpansOnScreen, cellsHeightAboveFloats, isInSpan } from '../grid/geometry.ts';
import { layoutOfView, hiddenByBorderAtFoot, resetScrollForFreezeDrag, sheetOfView } from '../grid/layout.ts';
import { ROW_HEADER_WIDTH, rowHeightForLines } from '../grid/cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT, editorTextInsets } from '../grid/cell-metrics.ts';
import { gridViewOf, keptHeaderViewsOf, isKeptHeaderUnderEditor, movedCellsView } from '../grid/grid-view.ts';
import { drawnBoxOfSpans, BIG_BOX_MARGIN_PAST_SIGHT, NO_EDITOR_LAYOUT } from '../grid/view-boxes.ts';
import { editorLayoutOf } from '../editor/editor-box.ts';
import { flagStandOutside } from '../presence/flags.ts';
import { agentSuggestionsStatus } from '../format/conditional/ask-agent.ts';
import { isPreviewBehind } from '../format/conditional/pane-reducer.ts';
import { isAgentOfferPendingOrAsked } from '../format/conditional/pane-state.ts';
import { dropdownEditorOfPane, isSidePaneShownAsPane, canOfferAgentForRules, conditionalRulesOfPane } from '../state/queries.ts';
import {
  optionWithTypedLabel,
  optionsWithTyped,
  isTypedOptionLabelUnsaved,
  everyOptionColorOffer,
  chosenOptionSetKey,
  hasUnsavedSidePaneTyping,
} from '../chips/dropdown-pane-edits.ts';
import { MAX_DROPDOWN_OPTIONS, menuItemKey } from '../chips/dropdown-options.ts';
import { areaToA1AsStored, areasToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet, wholeRowSpanIn } from '../model/line-ids.ts';
import { interactiveSheetOf, interactiveOfSheet, type InteractiveSheet } from '../state/places.ts';
import { drawnPivotTablePane, pivotTableCellAt, type DrawnPivotTablePane } from '../tables/pivot-tables.ts';
import { pivotTableOutOfDateShown } from '../state/pivot-tables-out-of-date.ts';
import { dropdownHeaderRowState } from '../chips/dropdown-editor.ts';
import {
  rangesOtherThanIndex,
  dropdownListRows,
  drawDropdownCard,
  entryCellHasDropdown,
  dropdownAtActiveCell,
  isCellTextUntouched,
} from '../chips/dropdowns.ts';
import { nearestShownLine } from '../model/line-sizes.ts';
import { readsWithFormatsToCome } from '../presence/follow-person.ts';
import { areasOfAllRanges, coveredCellCount, hasOtherRanges, selectedLineCountOnAxis } from '../selection/several-ranges.ts';
import { cellExplained, cellLinkShown, linkAddressesAt, cellKeyText, canExplainUnderCell } from '../state/explained-under-cell.ts';
import { singleAddressList } from '../links/text-links.ts';
import { cellOfFixNotice } from '../formulas/fix/ask.ts';
import { selectedLines } from '../selection/move-lines.ts';
import { isIdleOrTapping, sortColumnOfMenu, cellsToSortOfMenu } from '../state/transitions.ts';
import { figuresOfSelection, isSumWithFormulaCell } from '../selection/figures.ts';
import {
  peopleListRows,
  isEntryInChipCell,
  indexOfPeopleListRowGoneTo,
  drawnPeopleListCard,
  peopleListCard,
  isNoOneFound,
  peopleSearchStage,
  peopleChipsOfListCell,
  chipGoneToInPeopleCell,
  personInCellMatchingSearch,
  isEnterHeldInPeopleList,
} from '../chips/people-list.ts';
import { timeListFocusOf } from '../editor/time-list.ts';
import { secondsOfTime } from '../chips/time-of-day.ts';
import { wordsOfferedNow } from '../editor/words-offered.ts';
import { ownFilterListView, ownFilterListAnchor } from '../tables/own-filter-list.ts';
import { showSheetPointedIn, sheetsToPointInFor } from '../formulas/sheet-pointed-in.ts';
import { outlineGutters, ungroupableGroupsAtSelection, collapsibleGroupsAtSelection, expandableGroupsAtSelection } from '../grid/outline-groups.ts';
import { rowsWithCellsBehindBars, edgesOfBarsAtFoot } from '../grid/cells-behind-bars.ts';
import { withKeptHeadersRiding } from '../grid/moved-columns.ts';
import type { DrawnCell, DrawnRow } from '../grid/grid-drawing.tsx';
import { openCommentCountBySheet, canCommentModePickNow, hasCommentToOpenAtSelection, isActiveCellInOpenComment } from '../comments/comment-state.ts';
import { hasOtherSheetWithCells } from '../state/sheet-tabs.ts';
import { NO_PEER_FLAGS, peerFlagsOnSheet } from '../presence/selections.ts';
import { cellKeyOf } from '../formulas/error-tells.ts';
import { countInIndexRun } from '../grid/line-runs.ts';
import { canAskAgentForFormat } from '../format/custom-number-format.ts';
import { holdsOnAgentsAnswers } from '../format/answer-holds.ts';
import { shownPasteThatWaits } from '../clipboard/paste-that-waits.ts';
import { shownCellHistory, canOpenCellHistory } from '../history/cell-history.ts';
import { filterButtonOffer } from '../tables/filter-button.ts';
import { formatAsTableState } from '../tables/format-as-table.ts';
import { tableColumnOffers } from '../formulas/column-offers.ts';
import { ownFilterBar } from '../tables/own-filter-bar.ts';
import { onlyOwnFilterKeyOfSheet, drawnRowsAsk, isSortAndFilterOnBar } from '../tables/rows-asked-for.ts';
import { ownFilterNotDrawnYet, recordCountsOfPendingOwnFilter } from '../tables/own-filters.ts';
import { shownVersionHistory } from '../history/version-history.ts';
import { isWaitForWaysInPutOff, areWaysInToComeSoon } from '../state/ways-in.ts';
import { drawnSortPane } from '../tables/sort-pane.ts';
import { shownRowCountIn, hasFilteredRowsIn } from '../tables/filtered-rows.ts';
import { canRemoveDropdown } from '../selection/cells-seen.ts';
import { freezeChoicesOf } from '../grid/freeze.ts';
import { sheetSortColumnLetters, sortHoldsForMenu, canSortRange, rangeSortColumnLetters } from '../tables/sort.ts';
import { headingToSortBy, columnsOfferedToSortBy } from '../ui/sort-menu.ts';
import { holdsOfTableSortColumn } from '../tables/table-to-sort.ts';
import { formatOfSelectionWithEntry } from '../editor/entry-looks.ts';
import { NO_FIGURES_OF_SELECTION } from '../state/figures-of-selection.ts';
import { popupOverEntry } from '../state/list-cards.ts';
import { escapeInCellsDoes } from '../state/escape.ts';
import { fixPillOfActiveCell, fixesBarStage, fixesInSelectionStage, cellsOfFixes } from '../formulas/fix/fixes-on-cells.ts';
import { linkActionAtActiveCell, canEditLinkAtActiveCell, richTextLinkAddresses, canRemoveLinkFromCellCard } from '../links/link-form.ts';
import { isLinkBuilt } from '../links/cell-links.ts';
import { isFixInPlacePending, canOfferFixAtEntryCell } from '../state/reasons-for-errors.ts';
import { errorsOfferedView } from '../grid/cards-place.ts';
import { formulaSpilledOverCell } from '../grid/entry-hints.ts';
import { doesEntryTakeLineBreaks, isSelectionMoreThanActiveCell } from '../editor/start-entry.ts';
import { pointedCellsTip } from '../formulas/reference-pointing.ts';
import { isErrorsOfferBlocked } from '../formulas/fix/errors-offer.ts';
import { isFormulaUnfinishedInEntry } from '../editor/formula-closing.ts';
import { whyUndoRedoUnavailable } from '../history/steps-together.ts';
import { fractionSavedToShow } from '../state/saving-progress.ts';
import { isLongCalculationTold, longCalculationWait } from '../state/long-calculation.ts';
import { calculatingToShow, calculatingShownWait } from '../state/calculating-shown.ts';
import { findWithinOf, areaFindLooksIn, indexOfActiveFindHit, shortenFoundText, peopleNamesOfCell } from '../ui/find.ts';
import { cellShownText } from '../clipboard/text-escaping.ts';
import { shownCellOf } from '../grid/formulas-shown.ts';
import { customHexColors } from '../model/cell-format.ts';
export function insertSortedBy<Item>(items: readonly Item[], item: Item, orderOf: (item: Item) => number): Item[] {
  let countBefore = items.filter((other) => orderOf(other) < orderOf(item)).length;
  return [...items.slice(0, countBefore), item, ...items.slice(countBefore)];
}
export function withActiveCellElement(rowsDrawn: DrawnRowOfGrid[], state: PageState, reads: ReadsWithTextMeasurer, isReadOnly: boolean) {
  let activeDrawnCell = rowsDrawn.find(({ cells }) => cells.some(isActiveDrawnCell))?.cells.find(isActiveDrawnCell);
  if (activeDrawnCell !== undefined)
    return {
      rowsDrawn,
      activeCellElementId: activeDrawnCell.elementId,
    };
  let withoutElement = {
    rowsDrawn,
    activeCellElementId: null,
  };
  let activeArea = mergedAreaOrCellOf(reads, state.activeCell);
  if (activeArea === null || state.activeCell.sheetId !== state.sheetId) return withoutElement;
  let { left, top } = boxOfCellRange(activeArea, layoutOfView(state, reads));
  let tinyGrid = {
    gridWidth: ROW_HEADER_WIDTH + 1,
    gridHeight: COLUMN_HEADER_HEIGHT + 1,
  };
  let stateAtActiveCell = {
    ...state,
    ...tinyGrid,
    scrollLeft: left,
    scrollTop: top,
  };
  let [activeRow] = gridViewOf(stateAtActiveCell, reads, null, isReadOnly).rows;
  let activeCell = activeRow?.cells.find(isActiveDrawnCell);
  if (activeRow === undefined || activeCell === undefined) return withoutElement;
  let cellsWithActiveCell = ({ top: rowTop, cells }: DrawnRowOfGrid) =>
    insertSortedBy(
      cells,
      {
        ...activeCell,
        top: OFF_SCREEN_TOP - rowTop,
      },
      (cell) => cell.columnNumber,
    );
  return {
    rowsDrawn: rowsDrawn.some(({ key }) => key === activeRow.key)
      ? rowsDrawn.map(
          (row) =>
            row.key === activeRow.key
              ? {
                  ...row,
                  cells: cellsWithActiveCell(row),
                }
              : row,
        )
      : insertSortedBy(
          rowsDrawn,
          {
            ...activeRow,
            top: OFF_SCREEN_TOP,
            cells: [activeCell],
          },
          (row) => row.rowNumber,
        ),
    activeCellElementId: activeCell.elementId,
  };
}
export function editorOverOtherSheet(state: PageState, reads: ReadsWithTextMeasurer, pageSize: SizeOnPage) {
  let activeArea = mergedAreaOrCellOf(reads, state.activeCell);
  let layout = layoutOfView(state, reads);
  let activeCellBox =
    activeArea === null ? null : drawnBoxOfSpans(rangeSpansOnScreen(activeArea, state, layout, state), BIG_BOX_MARGIN_PAST_SIGHT);
  let entryFormat = reads.formatOf(activeAnchorCell(state, reads));
  let stateInEntrySheet = {
    ...state,
    sheetId: state.activeCell.sheetId,
  };
  let editorKeepsClear = editorTextInsets(
    activeCellBox?.height ?? 0,
    entryFormat.font.size,
    state.density,
    activeArea === null ? 0 : hiddenByBorderAtFoot(stateInEntrySheet, reads, layoutOfView(stateInEntrySheet, reads), activeArea),
  );
  if (activeArea === null || activeCellBox === null || state.mode.kind !== 'editing')
    return {
      ...NO_EDITOR_LAYOUT,
      editorKeepsClear,
      editorScale: 1,
      editorFlagStands: null,
    };
  let clearPageSize = {
    width: pageSize.width,
    height: cellsHeightAboveFloats(state),
  };
  let { editorBox, ...editorLayout } = editorLayoutOf(
    state.mode,
    activeCellBox,
    clearPageSize,
    entryFormat,
    editorKeepsClear,
    reads,
  );
  let lowestLinesHeight = Math.min(
    editorBox.height,
    rowHeightForLines(editorLayout.editorLineCount, entryFormat.font.size, editorKeepsClear),
  );
  let editorBoxAtFoot = {
    left: editorBox.left,
    top: editorBox.top + editorBox.height - lowestLinesHeight,
    width: Math.min(editorBox.width, layout.columnEdges.sizeOf(activeArea.leftColumnIndex)),
    height: lowestLinesHeight,
    showsIn: {
      left: 0,
      top: 0,
      width: pageSize.width,
      height: pageSize.height,
    },
  };
  let flagStands = flagStandOutside(editorBoxAtFoot, clearPageSize.height, 0);
  let { list: formulaHelpList, guide: formulaHelpGuide } = state.formulaHelp;
  let isHelpShown =
    state.mode.typingIn === 'cell' && ((formulaHelpList ?? formulaHelpGuide) !== null || state.formulaFromWords.stage !== null);
  return {
    editorBox: editorBoxAtFoot,
    ...editorLayout,
    editorKeepsClear,
    editorScale: 1,
    editorFlagStands: flagStands === 'below' && isHelpShown ? null : flagStands,
  };
}
export function agentStatusOfConditionalFormats({ agent }: RulesInPane): AgentStatusOfRules | null | undefined {
  if ('about' in agent && agent.about === 'moreSuggestions') return 'isIdle';
  switch (agent.kind) {
    case 'isIdle':
      return 'isIdle';
    case 'isAsked':
      return 'writes';
    case 'hasFailed':
      return 'hasFailed';
    case 'isNotToBeHad':
      return null;
  }
}
export function conditionalFormatsViewOf(pane: RulesInPane | null): ConditionalFormatsView | null {
  if (pane === null) return null;
  let cached = conditionalFormatsViewCache.get(pane);
  if (cached !== undefined) return cached;
  let view: ConditionalFormatsView = {
    ...pane.shown,
    drawnAs: pane.drawnAs,
    isAboutWords: pane.wordsOfMenu !== null,
    isAskedForRules: pane.isAskedForRules,
    agent: agentStatusOfConditionalFormats(pane),
    isAskBeyondRules: pane.agent.kind === 'hasFailed' && pane.agent.isBeyondRules,
    moreFromAgent: agentSuggestionsStatus(pane),
    previewAwaited: isPreviewBehind(pane) ? pane.tried : null,
    doesEscapeStepBack: isAgentOfferPendingOrAsked(pane),
    keepsKeys: pane.editor !== null || isAgentOfferPendingOrAsked(pane),
  };
  conditionalFormatsViewCache.set(pane, view);
  return view;
}
export function dropdownEditorViewOf(state: PageState, areaOfSelection: CellArea | null, reads: ReadsWithTextMeasurer): DropdownEditorView | null {
  let dropdownEditor = dropdownEditorOfPane(state);
  if (dropdownEditor === null) return null;
  let { options, typed, stretches, indexOfOwnStretch } = dropdownEditor;
  let typedLabelOption = optionWithTypedLabel(dropdownEditor);
  return {
    options: optionsWithTyped(dropdownEditor),
    nameTypedFor: isTypedOptionLabelUnsaved(state) && typed !== null ? typed : null,
    nameTaken:
      typed === null || typedLabelOption === null
        ? null
        : {
            ofOptionId: typed.optionId,
            label: typedLabelOption.label,
          },
    canAddOption: options.length < MAX_DROPDOWN_OPTIONS,
    colorOfferedForEveryOption: everyOptionColorOffer(dropdownEditor),
    ownRange:
      stretches[indexOfOwnStretch]?.range ??
      (areaOfSelection === null ? '' : areaToA1AsStored(areaOfSelection, ownRowOrderOfSheet(reads, state.sheetId))),
    cellsRefused: dropdownEditor.cellsRefused ?? null,
    cellsTyped: dropdownEditor.cellsTyped ?? null,
    isMade: dropdownEditor.dropdownId !== null,
    headerRow: dropdownHeaderRowState(state, reads, dropdownEditor),
    otherRanges: rangesOtherThanIndex(stretches, indexOfOwnStretch),
    reach: dropdownEditor.reach,
    startedFrom: chosenOptionSetKey(state, dropdownEditor),
    refused: isDropdownEditRefused(state) ? state.notice : null,
  };
}
export function selectedRowHeightOf(state: PageState, reads: ReadsWithTextMeasurer, sheetRowCount: number, topRowIndex: number): SelectedRowHeight {
  let { rowEdges } = layoutOfView(state, reads);
  let rowIndex = nearestShownLine(rowEdges, sheetRowCount, topRowIndex, 1);
  let givenHeight =
    (state.menu?.holds === 'rowHeightField'
      ? reads.rowSizingOf(state.sheetId).find((sizing) => isInSpan(rowIndex, sizing.firstIndex, sizing.count))
      : undefined
    )?.heightInPixels ?? null;
  return {
    selectedRowHeight: givenHeight ?? rowEdges.sizeOf(rowIndex),
    isSelectedRowHeightGiven: givenHeight !== null,
  };
}
export function a1OfFirstAndLast({ first, last }: FirstAndLastCells, reads: ReadsWithTextMeasurer): string | null {
  let area = selectedArea(
    {
      activeCell: first,
      selectionCorner: last,
      rangeWalked: null,
    },
    reads,
  );
  return area === null ? null : areaToA1AsStored(area, ownRowOrderOfSheet(reads, first.sheetId));
}
export function pageViewOf(
  state: PageState,
  readsAsStored: ReadsWithTextMeasurer,
  viewOnlyBecause: ViewOnlyBecause | null,
  hasKeyInHandWaitedForPeople: boolean = false,
  shiftYetToGlide: ShiftOfView | null = null,
  doesKeyAwaitEndOfEntry: boolean = false,
): PageView {
  let reads: ReadsWithTextMeasurer = readsWithFormatsToCome(readsAsStored, state);
  let areaOfSelection = selectedArea(state, reads);
  let activeArea = mergedAreaOrCellOf(reads, state.activeCell);
  let isSingleCellSelected = areaOfSelection !== null && activeArea !== null && isSameArea(areaOfSelection, activeArea);
  let nameBoxText =
    areaOfSelection === null
      ? ''
      : areaToA1AsStored(
          isSingleCellSelected
            ? {
                ...areaOfSelection,
                rowCount: 1,
                columnCount: 1,
              }
            : areaOfSelection,
          ownRowOrderOfSheet(reads, state.sheetId),
        );
  let allRangeAreas = areasOfAllRanges(state, reads);
  let selectedCellCount = coveredCellCount(allRangeAreas);
  let selectionIsOf: SelectionKind = areaOfSelection === null ? 'cells' : selectionKindOf(areaOfSelection, layoutOfView(state, reads));
  let entryCellId = activeAnchorCell(state, reads);
  let explainedCell = cellExplained(state, reads);
  let ofCellExplained = state.reasonsForErrors.ofCellExplained;
  let linkOfExplainedCell = explainedCell === null ? null : cellLinkShown(state, reads, explainedCell.cellId);
  let explainedLinkAddresses = explainedCell === null ? [] : linkAddressesAt(state, reads, explainedCell.cellId);
  let explainedUrls =
    explainedCell === null || explainedCell.link === null
      ? explainedLinkAddresses
      : singleAddressList(explainedLinkAddresses, explainedCell.link.address);
  let activeCellLink = cellLinkShown(state, reads, entryCellId);
  let activeCellUrls = linkAddressesAt(state, reads, entryCellId);
  let isNavigatingOneCell = isSingleCellSelected && state.mode.kind === 'navigating';
  let linkUnderActiveCell = isNavigatingOneCell ? activeCellLink : null;
  let explainedCellKey = explainedCell === null ? '' : cellKeyText(explainedCell.cellId);
  let explainedArea = explainedCell === null ? null : mergedAreaOrCellOf(reads, explainedCell.cellId);
  let explainedCells =
    explainedArea === null ? '' : areaToA1AsStored(explainedArea, ownRowOrderOfSheet(reads, explainedCell?.cellId.sheetId ?? state.sheetId));
  let fixNoticeCell = cellOfFixNotice(state);
  let fixNoticeArea = fixNoticeCell === null ? null : mergedAreaOrCellOf(reads, fixNoticeCell);
  let linesSelected = selectedLines(state, reads);
  let isEditingOrBusy = state.mode.kind === 'editing' || !isIdleOrTapping(state);
  let isListOpen = state.dropdown !== null || state.peopleList !== null;
  let figures = isEditingOrBusy || isListOpen ? null : figuresOfSelection(state, reads);
  let dropdownRows = dropdownListRows(state, reads);
  let dropdownCardView = dropdownRows === null ? null : drawDropdownCard(state, reads, dropdownRows);
  let highlightedOption = state.dropdown?.highlighted ?? null;
  let highlightedRow = (dropdownRows ?? []).findIndex((row: NonNullable<ReturnType<typeof dropdownListRows>>[number]) => menuItemKey(row) === highlightedOption);
  let peopleRows = peopleListRows(state, reads);
  let timeRows = state.timeList?.rows ?? null;
  let timeInFocus = state.timeList === null ? null : timeListFocusOf(state.timeList);
  let highlightedTimeRow = (timeRows ?? []).findIndex(({ time }) => secondsOfTime(time) === timeInFocus);
  let wordsOffered = viewOnlyBecause === null ? wordsOfferedNow(state) : null;
  let ownFilterList = ownFilterListView(state, reads);
  let stateShown = showSheetPointedIn(state, reads);
  let stateForGrid = resetScrollForFreezeDrag(stateShown);
  let groupMargins = outlineGutters(stateForGrid, reads);
  let isReadOnly = viewOnlyBecause !== null;
  let interactive = interactiveSheetOf(reads, state.sheetId);
  let isPausedNoticeHidden =
    state.notice?.kind === 'editRefused' && state.notice.why === 'editingPaused' && viewOnlyBecause !== 'editingPaused';
  let gridView = gridViewOf(stateForGrid, reads, null, isReadOnly, shiftYetToGlide);
  let isEntryInOtherSheet = stateShown.sheetId !== state.sheetId;
  let headersKept = keptHeaderViewsOf(stateForGrid, reads, isReadOnly, gridView.filterButtons, shiftYetToGlide).filter(
    (headerView: KeptHeaderView) => !isKeptHeaderUnderEditor(headerView, gridView.expandedEntryCard ?? gridView.editorBox, gridView.editorFoldsAt),
  );
  let activeCellElement = withActiveCellElement(gridView.rows, stateForGrid, reads, isReadOnly);
  let grid: GridOfPage = {
    ...gridView,
    ...activeCellElement,
    rowsDrawn: rowsWithCellsBehindBars(
      activeCellElement.rowsDrawn,
      isReadOnly ? [] : edgesOfBarsAtFoot(stateForGrid, gridView.body.left),
      {
        density: gridView.density,
        leftOfBody: gridView.body.left,
      },
      reads,
    ),
    headersKept,
    columnsRiding: gridView.columnsRiding === null ? null : withKeptHeadersRiding(gridView.columnsRiding, headersKept),
    cellsHeld: movedCellsView(stateForGrid, reads, isReadOnly),
    filterButtons: gridView.filterButtons.filter(
      ({ headerKept }: FilterButtonOfGrid) =>
        headerKept === null || headersKept.some(({ key }: KeptHeaderView) => key === headerKept),
    ),
    seams: {
      ...gridView.seams,
      rows: gridView.seams.rows.filter(
        (seamAt: SeamOfGridRows) =>
          !headersKept.some(
            ({ areRowNumbersItsOwn, top, height }: KeptHeaderView) =>
              areRowNumbersItsOwn && seamAt >= top && seamAt < top + height,
          ),
      ),
    },
    ...(isEntryInOtherSheet ? editorOverOtherSheet(state, reads, gridView.body) : {}),
  };
  let openCommentCounts = openCommentCountBySheet(state, reads);
  return {
    grid,
    listedSheets: reads.listSheets().map(
      ({ sheetId, name }): ListedSheet => ({
        sheetId,
        name,
        isShown: sheetId === stateShown.sheetId,
        isInteractive: interactiveOfSheet(reads, sheetId) !== null,
        holdsOpenEntry: sheetId === state.sheetId && isEntryInOtherSheet,
        canBeDeleted: hasOtherSheetWithCells(reads, sheetId),
        renaming:
          sheetId === state.sheetBeingRenamed?.sheetId
            ? {
                typed: state.sheetBeingRenamed.typed,
                refused: state.sheetBeingRenamed.refused,
              }
            : null,
        facesOfOthers: sheetId === stateShown.sheetId ? NO_PEER_FLAGS : peerFlagsOnSheet(sheetId, state),
        isWhereAgentWorks: state.changesByAgent.some(
          ({ fadeBeginsAtMs, cells }) => fadeBeginsAtMs === null && cells.activeCell.sheetId === sheetId,
        ),
        openCommentCount: openCommentCounts.get(sheetId) ?? 0,
      }),
    ),
    interactive,
    nameBoxText,
    entryCellText:
      state.mode.kind === 'editing' && activeArea !== null
        ? areaToA1AsStored(
            {
              ...activeArea,
              rowCount: 1,
              columnCount: 1,
            },
            ownRowOrderOfSheet(reads, state.sheetId),
          )
        : null,
    entryCellKey: state.mode.kind === 'editing' ? cellKeyOf(state.activeCell) : null,
    activeCellKey: cellKeyOf(state.activeCell),
    entrySheetName: isEntryInOtherSheet ? (sheetOfView(state, reads)?.name ?? null) : null,
    selectedRange:
      areaOfSelection === null ||
      (isSingleCellSelected && !hasOtherRanges(state)) ||
      state.dragging?.kind === 'selecting' ||
      state.areFormulasShownAsLeft
        ? null
        : {
            cells: areasToA1AsStored(allRangeAreas, ownRowOrderOfSheet(reads, state.sheetId)),
            summary: figures,
            outOfSight: {
              rowCount: countInIndexRun(layoutOfView(state, reads).rowsOutOfSight, {
                firstIndex: areaOfSelection.topRowIndex,
                count: areaOfSelection.rowCount,
              }),
              columnCount: countInIndexRun(layoutOfView(state, reads).columnsOutOfSight, {
                firstIndex: areaOfSelection.leftColumnIndex,
                count: areaOfSelection.columnCount,
              }),
            },
            ...(hasOtherRanges(state)
              ? {
                  ofSeveral: {
                    rangeCount: allRangeAreas.length,
                    cellCount: coveredCellCount(allRangeAreas),
                    lastRange: nameBoxText,
                  },
                }
              : {}),
          },
    allSelectedText: hasOtherRanges(state) ? areasToA1AsStored(allRangeAreas, ownRowOrderOfSheet(reads, state.sheetId)) : nameBoxText,
    menu: state.menu,
    customNumberFormat: state.customNumberFormat,
    isAgentOfferedForPattern: canAskAgentForFormat(state),
    holdsOnAgentsAnswers: holdsOnAgentsAnswers(state),
    pasteThatWaits: shownPasteThatWaits(state, reads),
    timeZone: reads.timeZone,
    locale: reads.locale,
    decimalSign: reads.decimalSign,
    signsOfNumbers: reads.signsOfNumbers,
    pickForWorkbook: state.pickForWorkbook,
    examplesOfNumberFormats: state.examplesOfNumberFormats,
    isListOfKeysOpen: state.isListOfKeysOpen,
    cellHistory: shownCellHistory(state, reads),
    canCellHistoryBeAsked: canOpenCellHistory(state, reads),
    ownFilterOffers: state.menu === null ? null : filterButtonOffer(state, reads),
    formatAsTableOffer: state.menu === null ? null : formatAsTableState(state, reads, viewOnlyBecause === null),
    tablesNotFormatted: state.tablesNotFormatted,
    columnsToGoTo: state.menu === null ? null : tableColumnOffers(state, reads),
    ownFilterBar: ownFilterBar(stateShown, reads),
    tableThatFilterBarAddsTo: onlyOwnFilterKeyOfSheet(stateShown),
    hasFilterNotDrawnYet: ownFilterNotDrawnYet(stateShown) !== null,
    recordsUnderFilterNotDrawnYet: recordCountsOfPendingOwnFilter(stateShown, reads),
    rowsAskedFor: drawnRowsAsk(state, reads, viewOnlyBecause === null),
    isSortAndFilterOnBar: isSortAndFilterOnBar(state, reads),
    ownFilterList:
      ownFilterList === null
        ? null
        : {
            ...ownFilterList,
            hangsFrom: ownFilterListAnchor(state, reads),
          },
    wordsOffered:
      wordsOffered === null
        ? null
        : {
            ...wordsOffered,
            rest: wordsOffered.offered.slice(wordsOffered.typed.length),
          },
    wordsOfferedSaid:
      viewOnlyBecause === null && state.wordsOffered?.isShown === true && !state.wordsOffered.isGone ? state.wordsOffered.offered : null,
    isOfferGoneToBeSaid: viewOnlyBecause === null && state.wordsOffered?.isGone === true && !state.isActShownAsCalculated,
    importOfAFile: state.importOfAFile,
    marksOfImport: state.marksOfImport,
    fileAwaited: state.fileAwaited,
    xlsxFileReady: state.xlsxFileReady,
    calendar: state.calendar,
    canToggleSidePane: state.sidePane?.kind === 'dropdown' || entryCellHasDropdown(state, reads),
    isSidePaneAboutDropdown: state.sidePane?.kind === 'dropdown',
    versionHistory: shownVersionHistory(state),
    dropdownList:
      dropdownRows === null || activeArea === null
        ? null
        : {
            ofCell: activeAnchorCell(state, reads),
            dropdownId: dropdownAtActiveCell(state, reads)?.dropdownId ?? null,
            cell: areaToA1AsStored(
              {
                ...activeArea,
                rowCount: 1,
                columnCount: 1,
              },
              ownRowOrderOfSheet(reads, state.sheetId),
            ),
            rows: dropdownRows,
            highlightedRow: highlightedRow === -1 ? null : highlightedRow,
            card: dropdownCardView,
            haveOptionsCards: isCellTextUntouched(state),
            isCueForCardsDue: state.dropdown?.cueForCards === 'now',
            isCardOfPointerAlone: state.dropdown?.isCardOfPointerAlone ?? false,
            isNewOptionBeingNamed: state.dropdown?.isNewOptionBeingNamed ?? false,
            timesNewOptionAsked: state.dropdown?.timesNewOptionAsked ?? 0,
          },
    isSidePaneOpen: isSidePaneShownAsPane(state),
    doRulesOpenInCard: canOfferAgentForRules(state),
    isSomethingTypedInSidePane: hasUnsavedSidePaneTyping(state),
    waysIn: viewOnlyBecause === null ? state.waysIn : 'areNotToCome',
    isWaitForWaysInPutOff: isWaitForWaysInPutOff(state),
    areWaysInToComeSoon: viewOnlyBecause === null && areWaysInToComeSoon(state),
    isAgentOfferedAmongWaysIn: viewOnlyBecause === null && state.waysIn === 'areUp' && reads.isSheetAsNew(state.sheetId),
    timesSidePaneAsked: state.timesSidePaneAsked,
    timesCalendarAsked: state.timesCalendarAsked,
    dropdownEditor: dropdownEditorViewOf(state, areaOfSelection, reads),
    conditionalFormats: conditionalFormatsViewOf(conditionalRulesOfPane(state)),
    sortPane: drawnSortPane(state, reads),
    pivotTablePane: drawnPivotTablePane(state, reads),
    pivotTableOutOfDateAt: pivotTableOutOfDateShown(state),
    isActiveCellOfPivotTable: state.menu !== null && pivotTableCellAt(reads, state.activeCell) !== null,
    figures: state.menu !== null && isSumWithFormulaCell(figures) ? figures : null,
    hasFiguresToWrite: viewOnlyBecause === null && isSumWithFormulaCell(figures),
    selectionIsOf,
    selectedRowCount: areaOfSelection === null ? 1 : shownRowCountIn(state, reads, areaOfSelection),
    selectedColumnCount: areaOfSelection?.columnCount ?? 1,
    selectedCellCount,
    canDropdownBeRemoved: viewOnlyBecause === null && canRemoveDropdown(state, reads),
    rowCountToSize: Math.max(
      1,
      areaOfSelection === null || hasOtherRanges(state)
        ? selectedLineCountOnAxis(state, reads, 'rows')
        : shownRowCountIn(state, reads, areaOfSelection),
    ),
    columnCountToSize: Math.max(1, selectedLineCountOnAxis(state, reads, 'columns')),
    ...selectedRowHeightOf(state, reads, grid.rowCount, areaOfSelection?.topRowIndex ?? 0),
    selectedColumnWidth: selectedColumnWidthOf(layoutOfView(state, reads).columnEdges, grid.columnCount, areaOfSelection?.leftColumnIndex ?? 0),
    isOneRangeNeeded: hasOtherRanges(state),
    selectionByAddress: interactive === null ? (state.selectedToldToAgent?.byAddress ?? null) : null,
    isSelectionCutByOwnFilters:
      areaOfSelection !== null && state.rowsOutOfViewByOwnFilters.size > 0 && hasFilteredRowsIn(state, reads, areaOfSelection),
    isSelectionCutByOwnSort:
      areaOfSelection !== null &&
      wholeRowSpanIn('stored', ownRowOrderOfSheet(reads, state.sheetId), {
        firstIndex: areaOfSelection.topRowIndex,
        count: areaOfSelection.rowCount,
      }) === null,
    chartsOnOffer: state.chartsOnOffer,
    canMergeSelection: areaOfSelection !== null && !isSingleCellSelected,
    canUnmergeSelection: areaOfSelection !== null && reads.mergedAreasIn(state.sheetId, areaOfSelection).length > 0,
    canMoveSelectionBack: linesSelected !== null && linesSelected.first > 0,
    canMoveSelectionOn: linesSelected !== null && linesSelected.first + linesSelected.count < linesSelected.lineCount,
    freezeChoices: state.menu === null ? null : freezeChoicesOf(state, reads),
    groupChoices:
      state.menu === null || linesSelected === null
        ? null
        : {
            of: linesSelected.what,
            canUngroup: ungroupableGroupsAtSelection(state, reads, linesSelected.what).length > 0,
            collapseCount: collapsibleGroupsAtSelection(state, reads, linesSelected.what).length,
            expandCount: expandableGroupsAtSelection(state, reads, linesSelected.what).length,
            levelCount: groupMargins[linesSelected.what as keyof typeof groupMargins]?.levelCount ?? 0,
          },
    groupMargins,
    canDeleteSelectedRows: areaOfSelection !== null && areaOfSelection.rowCount < grid.rowCount,
    canDeleteSelectedColumns: areaOfSelection !== null && areaOfSelection.columnCount < grid.columnCount,
    areWholeRowsSelected: areaOfSelection !== null && areaOfSelection.columnCount === grid.columnCount,
    areWholeColumnsSelected: areaOfSelection !== null && areaOfSelection.rowCount === grid.rowCount,
    columnToSortBy: sheetSortColumnLetters(state, reads, sortColumnOfMenu(state.menu, 'sheet')),
    headingToSortBy: state.menu?.holds === 'all' ? headingToSortBy(state, reads, 'sheet', sortColumnOfMenu(state.menu, 'sheet')) : '',
    keysToSortBy:
      state.menu?.holds !== 'all'
        ? null
        : selectedCellCount === 1
          ? holdsOfTableSortColumn(state, reads)
          : sortHoldsForMenu(state, reads, 'sheet', sortColumnOfMenu(state.menu, 'sheet')),
    canSortTableAtCell:
      state.menu?.holds === 'all' &&
      selectedCellCount === 1 &&
      state.menu.tableToSort !== null &&
      pivotTableCellAt(reads, state.activeCell) === null,
    menuSortsFor: state.menu?.sortsFor,
    columnsOfferedToSortBy: state.menu?.holds === 'all' && selectedCellCount > 1 ? columnsOfferedToSortBy(state, reads) : null,
    canSortSelectedRange: hasOtherRanges(state) || canSortRange(state, reads),
    columnToSortSelectedRangeBy: hasOtherRanges(state) ? null : rangeSortColumnLetters(state, reads, sortColumnOfMenu(state.menu, 'range')),
    headingToSortSelectedRangeBy: state.menu?.holds === 'all' ? headingToSortBy(state, reads, 'range', sortColumnOfMenu(state.menu, 'range')) : '',
    keysToSortSelectedRangeBy:
      state.menu?.holds === 'all' && !hasOtherRanges(state) ? sortHoldsForMenu(state, reads, 'range', sortColumnOfMenu(state.menu, 'range')) : null,
    cellsToSortAsked: cellsToSortOfMenu(state.menu),
    formatOfSelection: viewOnlyBecause === null && interactive === null ? formatOfSelectionWithEntry(state, isEntryInChipCell(state, reads)) : null,
    selectionSeen: state.selectionSeen,
    selectionLeftByPerson: state.selectionLeftByPerson,
    figuresOfSelection: state.mode.kind === 'editing' ? NO_FIGURES_OF_SELECTION : state.figuresOfSelection,
    borderPen: state.borderPen,
    peopleList:
      peopleRows === null || state.peopleList === null || activeArea === null
        ? null
        : {
            cell: areaToA1AsStored(
              {
                ...activeArea,
                rowCount: 1,
                columnCount: 1,
              },
              ownRowOrderOfSheet(reads, state.sheetId),
            ),
            under: state.mode.kind === 'editing' ? state.mode.typingIn : 'cell',
            rows: peopleRows,
            highlightedRow: indexOfPeopleListRowGoneTo(state.peopleList, peopleRows),
            card: drawnPeopleListCard(state.peopleList, peopleRows),
            isCardOfPointerAlone: peopleListCard.isCardOfPointerAlone(state),
            isNothingFound: isNoOneFound(state.peopleList, peopleRows) && peopleRows.length <= 1,
            search: peopleSearchStage(state.peopleList),
            searchedFor: state.peopleList.searchedFor,
            isOfPeopleAlone: state.peopleList.isOfPeopleAlone,
            inField: peopleChipsOfListCell(state, reads),
            chipGoneTo: chipGoneToInPeopleCell(state, reads),
            foundInField: personInCellMatchingSearch(state, reads),
          },
    timeList:
      timeRows === null || activeArea === null
        ? null
        : {
            cell: areaToA1AsStored(
              {
                ...activeArea,
                rowCount: 1,
                columnCount: 1,
              },
              ownRowOrderOfSheet(reads, state.sheetId),
            ),
            rows: timeRows.map(
              ({ time, shown }) => ({
                secondOfDay: secondsOfTime(time),
                shown,
              }),
            ),
            highlightedRow: highlightedTimeRow === -1 ? null : highlightedTimeRow,
          },
    functionList: state.formulaHelp.list,
    functionGuide: state.formulaFromWords.stage === null ? state.formulaHelp.guide : null,
    matchingBrackets: state.formulaFromWords.stage === null ? state.formulaHelp.brackets : null,
    caretAfterPick: state.formulaHelp.caretAfterPick,
    functionWrittenWhole: state.formulaHelp.writtenWhole,
    openUnderCell: popupOverEntry(state, reads),
    escapeInCells: escapeInCellsDoes(state),
    isEscapeForFix: escapeInCellsDoes(state) === 'stepsOut' && fixPillOfActiveCell(state, reads) !== null,
    isSteppedOutOfCells: state.isSteppedOutOfCells,
    isCommentModeOn: state.isCommentModeOn,
    doesCommentModePickCells: state.doesCommentModePickCells,
    hasCommentModeRefused: state.hasCommentModeRefused,
    isAgentWorking: state.isAgentWorking,
    isPressOrEnterAComment: canCommentModePickNow(state),
    isCommentOffered: hasCommentToOpenAtSelection(state, reads),
    hasCommentsOnCells: state.comments !== null,
    hasStepsToUndoForNextPageToKnowOf: state.areStepsToUndoLost || state.stepsToUndo > 0,
    isFollowingAgent: state.isFollowingAgent || state.shownByAgent !== null,
    isFollowingPerson: state.followed !== null,
    movesOfViewByItself: state.movesOfViewByItself,
    linkOfActiveCell: linkUnderActiveCell?.drawnAs === 'words' ? null : (linkUnderActiveCell?.url ?? null),
    linkForm: state.linkForm,
    linkByHandOffered: viewOnlyBecause === null ? linkActionAtActiveCell(state, reads) : null,
    doesKeyOpenLinkForm: viewOnlyBecause === null && canEditLinkAtActiveCell(state, reads),
    linkInWordsOfActiveCell:
      linkUnderActiveCell?.drawnAs === 'words' && canExplainUnderCell(state)
        ? {
            url: linkUnderActiveCell.url,
            cellKey: cellKeyText(entryCellId),
          }
        : null,
    linksAmongTextOfActiveCell:
      isNavigatingOneCell && activeCellLink === null && activeCellUrls.length > 0 && canExplainUnderCell(state)
        ? {
            urls: activeCellUrls,
            cellKey: cellKeyText(entryCellId),
          }
        : null,
    canLinkCardCome: canExplainUnderCell(state),
    whereWordsOfActiveCellLink: activeCellLink?.drawnAs === 'words' ? activeCellLink.url : null,
    isAddressOfActiveCellBuilt: activeCellLink?.drawnAs === 'words' && isLinkBuilt(reads.cellOf(entryCellId)),
    errorExplained:
      explainedCell === null ||
      ofCellExplained === null ||
      ofCellExplained.isTellOnItsWay === true ||
      (explainedCell.by === 'pointer' && viewOnlyBecause === null && isFixInPlacePending(state)) ||
      isActiveCellInOpenComment(state, reads, explainedCell.cellId)
        ? null
        : {
            error: ofCellExplained,
            by: explainedCell.by,
            cellKey: explainedCellKey,
            cells: explainedCells,
            canBeFixedHere:
              viewOnlyBecause === null && state.formulaFromWords.agent === 'available' && state.reasonsForErrors.cellToFixInPlace !== null,
          },
    linkExplained:
      explainedCell === null || explainedUrls.length === 0
        ? null
        : {
            urls: explainedUrls,
            urlsOnWords: richTextLinkAddresses(reads, explainedCell.cellId, explainedUrls),
            isWholeCell: linkOfExplainedCell !== null,
            isInWords: linkOfExplainedCell === null || linkOfExplainedCell.drawnAs === 'words',
            isBuilt: isLinkBuilt(reads.cellOf(explainedCell.cellId)),
            canBeTakenOff: canRemoveLinkFromCellCard(state, reads),
            marked: explainedCell.link === null && isSameCell(explainedCell.cellId, entryCellId) ? state.explainedUnderCell.markedLink : null,
            areKeysNewOnCard: state.explainedUnderCell.areKeysNewOnCard,
            wordsBox: explainedCell.link?.box ?? null,
            isByPress: explainedCell.isByPress,
            by: explainedCell.by,
            cellKey: explainedCellKey,
          },
    errorsOffered: isReadOnly ? null : errorsOfferedView(state, reads),
    fixesOnCells: isReadOnly ? null : fixesBarStage(state),
    fixesOfSelectedCells: isReadOnly ? null : fixesInSelectionStage(state),
    doesFixWaitForCalculation:
      state.reasonsForErrors.doCausesWaitForCalculation &&
      (state.reasonsForErrors.isFixAtEntryCellYetToBeKnown || state.fixesOnCells.toOfferInSelection === 'yetToBeKnown'),
    countOfErrorsOffered: isReadOnly || state.errorsOffered === null || state.errorsOffered.offer === null ? null : state.errorsOffered.count,
    errorOfActiveCell: state.reasonsForErrors.ofEntryCell,
    canActiveCellBeFixedHere:
      viewOnlyBecause === null && state.formulaFromWords.agent === 'available' && state.reasonsForErrors.isEntryCellToFixInPlace,
    isFixOfActiveCellYetToBeKnown: viewOnlyBecause === null && canOfferFixAtEntryCell(state),
    formulaBarText: state.mode.kind === 'editing' && peopleChipsOfListCell(state, reads) === null ? state.mode.text : state.textToEditOfEntryCell,
    formulaSpilledOverEntryCell: formulaSpilledOverCell(reads, entryCellId),
    formulaOfFixOnEntryCell:
      isReadOnly || state.mode.kind === 'editing'
        ? null
        : (cellsOfFixes(state).find(({ cellId }: ReturnType<typeof cellsOfFixes>[number]) => isSameCell(cellId, entryCellId))?.formula ?? null),
    pointedReference: state.pointedReference,
    referencesInEntry: state.referencesInEntry,
    sheetPointedIn: state.sheetPointedIn,
    sheetsToPointIn: sheetsToPointInFor(state, reads, !isReadOnly),
    doesEntryTakeLineBreaks: doesEntryTakeLineBreaks(state, reads),
    hasCellsToFill: isSelectionMoreThanActiveCell(state, reads),
    formulaFromWords: state.formulaFromWords,
    pointedCells: pointedCellsTip(state, reads),
    isFormulaBarReadOnly: viewOnlyBecause !== null && state.mode.kind !== 'editing',
    errorsAtOpening:
      state.errorsAtOpening === null
        ? null
        : {
            sheetId: state.errorsAtOpening.first.sheetId,
            count: state.errorsAtOpening.count,
            cells: a1OfFirstAndLast(state.errorsAtOpening, reads),
            areFixesHeldBack: isErrorsOfferBlocked(state),
          },
    errorsFoundAtOpening: state.errorsFoundAtOpening,
    noticeOfNoFix:
      fixNoticeArea === null
        ? null
        : {
            cells: areaToA1AsStored(fixNoticeArea, ownRowOrderOfSheet(reads, state.sheetId)),
            why: state.formulaFromWords.fixThatCameToNothing?.why ?? 'other',
          },
    mode: state.mode,
    isUnfinishedFormulaOpen: isFormulaUnfinishedInEntry(state),
    notice: isDropdownEditRefused(state) || isPausedNoticeHidden ? null : state.notice,
    newsOfLoss: state.newsOfLoss,
    isEntryEndedUnasked: state.isEntryEndedUnasked,
    undoOffer:
      state.mode.kind === 'editing' &&
      (state.undoOffer?.kind === 'filledByFinger' ||
        state.undoOffer?.kind === 'clearedWithNoKeyboard' ||
        state.undoOffer?.kind === 'sortedWithNoKeyboard' ||
        state.undoOffer?.kind === 'sortChangedResults' ||
        state.undoOffer?.kind === 'moveOfColumnsChangedResults' ||
        state.undoOffer?.kind === 'dropdownClearedCells' ||
        state.undoOffer?.kind === 'optionsGoneClearedCells' ||
        state.undoOffer?.kind === 'dropdownOptionDeleted')
        ? null
        : state.undoOffer,
    undoOfTurnOffered: state.undoOfTurnOffered,
    latestStep: state.notesOfSteps.latest,
    isUndoOfTurnAwaited: state.takingBack?.what.kind === 'turnOfAgent',
    undoAndRedo: whyUndoRedoUnavailable(state, viewOnlyBecause),
    isImportAsNewSheetUnanswered: state.answerAwaited === 'toImportAsNewSheet',
    saving: state.saving,
    hasUnsavedEdits: state.hasUnsavedEdits,
    fractionSavedToShow: fractionSavedToShow(state.savingProgress, state.saving),
    isLongCalculationTold: isLongCalculationTold(state.longCalculationTold),
    ownViewShownAsApplied: state.ownViewShownAsApplied,
    calculating: viewOnlyBecause === 'readOnly' ? null : calculatingToShow(state.calculatingShown, reads.calculationTookTooLong),
    calculatingShownWait: calculatingShownWait(state.calculatingShown),
    savingBarWait: state.savingProgress?.wait ?? null,
    longCalculationWait: longCalculationWait(state.longCalculationTold),
    waitForNextEditOfAgent: state.waitForNextEditOfAgent,
    waitForAgentOnComments: state.commentsWithAgent?.wait ?? null,
    contextBarMenu: state.contextBarMenu,
    viewOnlyBecause,
    isCaretWithCellsBeforeEntryEnds: doesKeyAwaitEndOfEntry || (hasKeyInHandWaitedForPeople && !isEnterHeldInPeopleList(state, reads, true)),
    mostBytesOfAFileToImport: reads.mostBytesOfATableToImport(),
    areFormulasShown: state.areFormulasShown,
    density: state.density,
    lastDone: state.lastDone?.what === 'entryCameToError' && state.lastDone.reason.isTellOnItsWay === true ? null : state.lastDone,
    saidOfAgent: state.saidOfAgent,
    doneByAgent: state.doneByAgent,
    find:
      state.find === null
        ? null
        : {
            text: state.find.text,
            count: state.find.hits.length,
            isCapped: state.find.isCapped,
            editsSinceLooked: state.find.editsSinceLooked,
            roomAboveGrid: state.find.roomAboveGrid,
            isReplaceShown: state.find.isReplaceShown && viewOnlyBecause === null,
            options: state.find.options,
            within: ((within: { at: CellArea } | null) => (within === null ? null : areaToA1AsStored(within.at, ownRowOrderOfSheet(reads, state.sheetId))))(
              findWithinOf(state.find.options),
            ),
            isInAllSheets: state.find.options.within === 'allSheets',
            selectedCells: ((area: CellArea | null) => (area === null ? null : areaToA1AsStored(area, ownRowOrderOfSheet(reads, state.sheetId))))(
              areaFindLooksIn(state, reads),
            ),
            at: ((index: number | null) => (index === null ? null : index + 1))(indexOfActiveFindHit(state)),
            shown: ((cellShown: ReturnType<typeof shownCellOf>) =>
              shortenFoundText(peopleNamesOfCell(cellShown, state.profilesById) ?? cellShownText(cellShown, reads.decimalSign)))(
              shownCellOf(state, reads, state.activeCell),
            ),
            cell:
              activeArea === null
                ? ''
                : areaToA1AsStored(
                    {
                      ...activeArea,
                      rowCount: 1,
                      columnCount: 1,
                    },
                    ownRowOrderOfSheet(reads, state.sheetId),
                  ),
          },
  };
}
export const OFF_SCREEN_TOP = -1e4;
export const isActiveDrawnCell = ({ isActive }: DrawnCellOfRow): boolean => isActive;
export const conditionalFormatsViewCache: WeakMap<WeakKey, ConditionalFormatsView> = new WeakMap();
export const isDropdownEditRefused = (state: PageState): boolean =>
  dropdownEditorOfPane(state) !== null && state.notice?.kind === 'editRefused';
export const selectedColumnWidthOf = (columnEdges: LineSizes, sheetColumnCount: number, leftColumnIndex: number): number =>
  columnEdges.sizeOf(nearestShownLine(columnEdges, sheetColumnCount, leftColumnIndex, 1));
export const colorPickerChoicesOf = (state: PageState, reads: ReadsWithTextMeasurer): ColorPickerChoices => ({
  hexColorsInSheet: customHexColors([
    ...(dropdownEditorOfPane(state)?.options ?? []).map(({ color }) => color),
    ...reads.hexColorsOf(state.sheetId).map(
      (hex): Color => ({
        kind: 'rgb',
        hex,
      }),
    ),
  ]),
  textOfActiveCell: cellShownText(reads.cellOnShowIn(activeAnchorCell(state, reads)), reads.decimalSign),
});
/** Why the page only shows the workbook and takes no edits, as the opened workbook tells it. */
export type ViewOnlyBecause = NonNullable<ReturnType<OpenedWorkbook['refusalOfEveryEdit']>>;
type StateOf<Key extends keyof PageState> = PageState[Key];
type EditingMode = Extract<PageState['mode'], { kind: 'editing' }>;
/** A width and a height in pixels of the page. */
export interface SizeOnPage {
  width: number;
  height: number;
}
/** A drawn cell, read here to find the active cell's element. */
export type DrawnCellOfRow = DrawnCell;
/** A drawn row of the grid, read here to place the active cell among the rows. */
export type DrawnRowOfGrid = DrawnRow;
/** How the agent that suggests rules of conditional formats is doing, as the pane shows it. */
export type AgentStatusOfRules = 'isIdle' | 'writes' | 'hasFailed';
export interface FirstAndLastCells {
  first: CellId;
  last: CellId;
}
export interface SelectedRowHeight {
  selectedRowHeight: number;
  isSelectedRowHeightGiven: boolean;
}
/** What the rules pane shows, as worked out when the pane is refreshed. */
export type ShownInRulesPane = ReturnType<typeof refreshConditionalFormatsPane>['shown'];
/** Of the conditional formats, what is drawn besides what the rules pane shows. */
export interface ConditionalFormatsOfPane {
  drawnAs: RulesInPane['drawnAs'];
  isAboutWords: boolean;
  isAskedForRules: RulesInPane['isAskedForRules'];
  agent: AgentStatusOfRules | null | undefined;
  isAskBeyondRules: boolean;
  moreFromAgent: ReturnType<typeof agentSuggestionsStatus>;
  previewAwaited: ReturnType<typeof refreshConditionalFormatsPane>['tried'] | null;
  doesEscapeStepBack: ReturnType<typeof isAgentOfferPendingOrAsked>;
  keepsKeys: boolean;
}
/** The conditional formats open in the side pane or on a card, as drawn. */
export type ConditionalFormatsView = ShownInRulesPane & ConditionalFormatsOfPane;
/** A header kept at the top or the left while the grid scrolls, as drawn. */
export type KeptHeaderView = ReturnType<typeof keptHeaderViewsOf>[number];
/** A filter button of the grid, as drawn. */
export type FilterButtonOfGrid = ReturnType<typeof gridViewOf>['filterButtons'][number];
/** Where a seam between rows is drawn. */
export type SeamOfGridRows = ReturnType<typeof gridViewOf>['seams']['rows'][number];
/** Of the grid, what the page puts in besides what `gridViewOf` draws. */
export interface GridOnPage {
  rowsDrawn: ReturnType<typeof rowsWithCellsBehindBars>;
  activeCellElementId: ReturnType<typeof withActiveCellElement>['activeCellElementId'];
  headersKept: KeptHeaderView[];
  /** The columns riding in hand, with the rows of the headers kept in sight riding with them. */
  columnsRiding: ReturnType<typeof gridViewOf>['columnsRiding'];
  cellsHeld: ReturnType<typeof movedCellsView>;
  filterButtons: FilterButtonOfGrid[];
  seams: ReturnType<typeof gridViewOf>['seams'];
}
/** The grid as drawn in the sheet shown, with what the page puts in. */
export type GridOfSheetShown = Omit<ReturnType<typeof gridViewOf>, keyof GridOnPage> & GridOnPage;
/** The entry box laid over the grid while the entry is in another sheet. */
export type EditorOverOtherSheet = ReturnType<typeof editorOverOtherSheet>;
/** The grid as drawn: its rows, headers, boxes and cards, with the entry box over it when the entry is in another sheet. */
export type GridOfPage = GridOfSheetShown | (Omit<GridOfSheetShown, keyof EditorOverOtherSheet> & EditorOverOtherSheet);
/** The list of a filter of one's own, and where it hangs from. */
export type OwnFilterListShown = NonNullable<ReturnType<typeof ownFilterListView>> & { hangsFrom: ReturnType<typeof ownFilterListAnchor> };
/** The words offered to finish what is typed, and the rest of them past what is typed. */
export interface WordsOfferedShown extends WordsOffered {
  rest: string;
}
/** A link of a cell as shown, by itself or among the words of the cell. */
export type LinkShownOfCell = NonNullable<ReturnType<typeof cellLinkShown>>;
/** The dropdown being made or changed in the side pane, as drawn. */
export interface DropdownEditorView {
  options: ReturnType<typeof optionsWithTyped>;
  nameTypedFor: DropdownEditorInPane['typed'];
  nameTaken: { ofOptionId: NonNullable<DropdownEditorInPane['typed']>['optionId']; label: NonNullable<ReturnType<typeof optionWithTypedLabel>>['label'] } | null;
  canAddOption: boolean;
  colorOfferedForEveryOption: ReturnType<typeof everyOptionColorOffer>;
  ownRange: string;
  cellsRefused: DropdownCellsRefused | null;
  cellsTyped: string | null;
  isMade: boolean;
  headerRow: ReturnType<typeof dropdownHeaderRowState>;
  otherRanges: ReturnType<typeof rangesOtherThanIndex>;
  reach: DropdownEditorInPane['reach'];
  startedFrom: ReturnType<typeof chosenOptionSetKey>;
  refused: StateOf<'notice'> | null;
}
/** What the color picker offers besides the standard colors. */
export interface ColorPickerChoices {
  hexColorsInSheet: string[];
  textOfActiveCell: ReturnType<typeof cellShownText>;
}
/** A sheet among the tabs. */
export interface ListedSheet {
  sheetId: SheetId;
  name: string;
  isShown: boolean;
  isInteractive: boolean;
  holdsOpenEntry: boolean;
  canBeDeleted: boolean;
  renaming: { typed: NonNullable<StateOf<'sheetBeingRenamed'>>['typed']; refused: NonNullable<StateOf<'sheetBeingRenamed'>>['refused'] } | null;
  facesOfOthers: typeof NO_PEER_FLAGS | ReturnType<typeof peerFlagsOnSheet>;
  isWhereAgentWorks: boolean;
  openCommentCount: number;
}
/** The range selected, when it is more than the active cell. */
export interface SelectedRangeView {
  cells: string;
  summary: FigureOfCells | null;
  outOfSight: { rowCount: number; columnCount: number };
  ofSeveral?: { rangeCount: number; cellCount: number; lastRange: string };
}
/** The list of a dropdown open under its cell. */
export interface DropdownListView {
  ofCell: CellId;
  dropdownId: NonNullable<ReturnType<typeof dropdownAtActiveCell>>['dropdownId'] | null;
  cell: string;
  rows: NonNullable<ReturnType<typeof dropdownListRows>>;
  highlightedRow: number | null;
  card: ReturnType<typeof drawDropdownCard> | null;
  haveOptionsCards: boolean;
  isCueForCardsDue: boolean;
  isCardOfPointerAlone: boolean;
  isNewOptionBeingNamed: boolean;
  timesNewOptionAsked: number;
}
/** The list of people open under a cell. */
export interface PeopleListView {
  cell: string;
  under: EditingMode['typingIn'] | 'cell';
  rows: NonNullable<ReturnType<typeof peopleListRows>>;
  highlightedRow: ReturnType<typeof indexOfPeopleListRowGoneTo>;
  card: ReturnType<typeof drawnPeopleListCard>;
  isCardOfPointerAlone: boolean;
  isNothingFound: boolean;
  search: ReturnType<typeof peopleSearchStage>;
  searchedFor: NonNullable<StateOf<'peopleList'>>['searchedFor'];
  isOfPeopleAlone: NonNullable<StateOf<'peopleList'>>['isOfPeopleAlone'];
  inField: ReturnType<typeof peopleChipsOfListCell>;
  chipGoneTo: ReturnType<typeof chipGoneToInPeopleCell>;
  foundInField: ReturnType<typeof personInCellMatchingSearch>;
}
/** The list of times of day open under a cell. */
export interface TimeListView {
  cell: string;
  rows: { secondOfDay: number; shown: NonNullable<StateOf<'timeList'>>['rows'][number]['shown'] }[];
  highlightedRow: number | null;
}
/** The error of a cell told under it. */
export interface ErrorExplainedView {
  error: NonNullable<StateOf<'reasonsForErrors'>['ofCellExplained']>;
  by: CellExplained['by'];
  cellKey: string;
  cells: string;
  canBeFixedHere: boolean;
}
/** The links of a cell told under it. */
export interface LinkExplainedView {
  urls: ReturnType<typeof linkAddressesAt> | ReturnType<typeof singleAddressList>;
  urlsOnWords: ReturnType<typeof richTextLinkAddresses>;
  isWholeCell: boolean;
  isInWords: boolean;
  isBuilt: boolean;
  canBeTakenOff: boolean;
  marked: StateOf<'explainedUnderCell'>['markedLink'] | null;
  areKeysNewOnCard: StateOf<'explainedUnderCell'>['areKeysNewOnCard'];
  wordsBox: NonNullable<CellExplained['link']>['box'] | null;
  isByPress: CellExplained['isByPress'];
  by: CellExplained['by'];
  cellKey: string;
}
/** The find bar and what it found. */
export interface FindView {
  text: NonNullable<StateOf<'find'>>['text'];
  count: number;
  isCapped: NonNullable<StateOf<'find'>>['isCapped'];
  editsSinceLooked: NonNullable<StateOf<'find'>>['editsSinceLooked'];
  roomAboveGrid: NonNullable<StateOf<'find'>>['roomAboveGrid'];
  isReplaceShown: boolean;
  options: NonNullable<StateOf<'find'>>['options'];
  within: string | null;
  isInAllSheets: boolean;
  selectedCells: string | null;
  at: number | null;
  shown: string;
  cell: string;
}
/** Everything the page draws, worked out from the page's state and the workbook as read. */
export interface PageView extends SelectedRowHeight {
  /** The grid as drawn: its rows, headers, boxes and cards; the shape comes from `gridViewOf`. */
  grid: GridOfPage;
  listedSheets: ListedSheet[];
  interactive: InteractiveSheet | null;
  nameBoxText: string;
  entryCellText: string | null;
  entryCellKey: string | null;
  activeCellKey: string;
  entrySheetName: string | null;
  selectedRange: SelectedRangeView | null;
  allSelectedText: string;
  menu: StateOf<'menu'>;
  customNumberFormat: StateOf<'customNumberFormat'>;
  isAgentOfferedForPattern: boolean;
  holdsOnAgentsAnswers: ReturnType<typeof holdsOnAgentsAnswers>;
  pasteThatWaits: ReturnType<typeof shownPasteThatWaits>;
  timeZone: ReadsWithTextMeasurer['timeZone'];
  locale: ReadsWithTextMeasurer['locale'];
  decimalSign: ReadsWithTextMeasurer['decimalSign'];
  signsOfNumbers: ReadsWithTextMeasurer['signsOfNumbers'];
  pickForWorkbook: StateOf<'pickForWorkbook'>;
  examplesOfNumberFormats: StateOf<'examplesOfNumberFormats'>;
  isListOfKeysOpen: StateOf<'isListOfKeysOpen'>;
  cellHistory: ReturnType<typeof shownCellHistory>;
  canCellHistoryBeAsked: boolean;
  ownFilterOffers: ReturnType<typeof filterButtonOffer> | null;
  formatAsTableOffer: ReturnType<typeof formatAsTableState> | null;
  tablesNotFormatted: StateOf<'tablesNotFormatted'>;
  columnsToGoTo: ReturnType<typeof tableColumnOffers> | null;
  ownFilterBar: ReturnType<typeof ownFilterBar>;
  tableThatFilterBarAddsTo: ReturnType<typeof onlyOwnFilterKeyOfSheet>;
  hasFilterNotDrawnYet: boolean;
  recordsUnderFilterNotDrawnYet: ReturnType<typeof recordCountsOfPendingOwnFilter>;
  rowsAskedFor: ReturnType<typeof drawnRowsAsk>;
  isSortAndFilterOnBar: boolean;
  ownFilterList: OwnFilterListShown | null;
  wordsOffered: WordsOfferedShown | null;
  wordsOfferedSaid: NonNullable<StateOf<'wordsOffered'>>['offered'] | null;
  isOfferGoneToBeSaid: boolean;
  importOfAFile: StateOf<'importOfAFile'>;
  marksOfImport: StateOf<'marksOfImport'>;
  fileAwaited: StateOf<'fileAwaited'>;
  xlsxFileReady: StateOf<'xlsxFileReady'>;
  calendar: StateOf<'calendar'>;
  canToggleSidePane: boolean;
  isSidePaneAboutDropdown: boolean;
  versionHistory: ReturnType<typeof shownVersionHistory>;
  dropdownList: DropdownListView | null;
  isSidePaneOpen: boolean;
  doRulesOpenInCard: boolean;
  isSomethingTypedInSidePane: boolean | undefined;
  waysIn: StateOf<'waysIn'> | 'areNotToCome';
  isWaitForWaysInPutOff: boolean;
  areWaysInToComeSoon: boolean;
  isAgentOfferedAmongWaysIn: boolean;
  timesSidePaneAsked: StateOf<'timesSidePaneAsked'>;
  timesCalendarAsked: StateOf<'timesCalendarAsked'>;
  dropdownEditor: DropdownEditorView | null;
  conditionalFormats: ConditionalFormatsView | null;
  sortPane: ReturnType<typeof drawnSortPane>;
  pivotTablePane: DrawnPivotTablePane | null;
  pivotTableOutOfDateAt: CellId | null;
  isActiveCellOfPivotTable: boolean;
  /** The sum of the numbers selected, while a menu is open and a cell can take a formula of it. */
  figures: SumFigure | null;
  hasFiguresToWrite: boolean;
  selectionIsOf: SelectionKind;
  selectedRowCount: number;
  selectedColumnCount: number;
  selectedCellCount: number;
  canDropdownBeRemoved: boolean;
  rowCountToSize: number;
  columnCountToSize: number;
  selectedColumnWidth: number;
  isOneRangeNeeded: boolean;
  selectionByAddress: NonNullable<StateOf<'selectedToldToAgent'>>['byAddress'] | null;
  isSelectionCutByOwnFilters: boolean;
  isSelectionCutByOwnSort: boolean;
  chartsOnOffer: StateOf<'chartsOnOffer'>;
  canMergeSelection: boolean;
  canUnmergeSelection: boolean;
  canMoveSelectionBack: boolean;
  canMoveSelectionOn: boolean;
  freezeChoices: ReturnType<typeof freezeChoicesOf> | null;
  groupChoices: { of: SelectedLines['what']; canUngroup: boolean; collapseCount: number; expandCount: number; levelCount: number } | null;
  groupMargins: ReturnType<typeof outlineGutters>;
  canDeleteSelectedRows: boolean;
  canDeleteSelectedColumns: boolean;
  areWholeRowsSelected: boolean;
  areWholeColumnsSelected: boolean;
  columnToSortBy: ReturnType<typeof sheetSortColumnLetters>;
  headingToSortBy: ReturnType<typeof headingToSortBy> | '';
  keysToSortBy: ReturnType<typeof holdsOfTableSortColumn> | ReturnType<typeof sortHoldsForMenu> | null;
  canSortTableAtCell: boolean;
  menuSortsFor: NonNullable<StateOf<'menu'>>['sortsFor'];
  columnsOfferedToSortBy: ReturnType<typeof columnsOfferedToSortBy> | null;
  canSortSelectedRange: boolean;
  columnToSortSelectedRangeBy: ReturnType<typeof rangeSortColumnLetters> | null;
  headingToSortSelectedRangeBy: ReturnType<typeof headingToSortBy> | '';
  keysToSortSelectedRangeBy: ReturnType<typeof sortHoldsForMenu> | null;
  cellsToSortAsked: ReturnType<typeof cellsToSortOfMenu>;
  formatOfSelection: ReturnType<typeof formatOfSelectionWithEntry> | null;
  selectionSeen: StateOf<'selectionSeen'>;
  selectionLeftByPerson: StateOf<'selectionLeftByPerson'>;
  figuresOfSelection: StateOf<'figuresOfSelection'>;
  borderPen: StateOf<'borderPen'>;
  peopleList: PeopleListView | null;
  timeList: TimeListView | null;
  functionList: StateOf<'formulaHelp'>['list'];
  functionGuide: StateOf<'formulaHelp'>['guide'] | null;
  matchingBrackets: StateOf<'formulaHelp'>['brackets'] | null;
  caretAfterPick: StateOf<'formulaHelp'>['caretAfterPick'];
  functionWrittenWhole: StateOf<'formulaHelp'>['writtenWhole'];
  openUnderCell: PopupOverEntry | null;
  escapeInCells: EscapeInCells;
  isEscapeForFix: boolean;
  isSteppedOutOfCells: StateOf<'isSteppedOutOfCells'>;
  isCommentModeOn: StateOf<'isCommentModeOn'>;
  doesCommentModePickCells: StateOf<'doesCommentModePickCells'>;
  hasCommentModeRefused: StateOf<'hasCommentModeRefused'>;
  isAgentWorking: StateOf<'isAgentWorking'>;
  isPressOrEnterAComment: boolean;
  isCommentOffered: boolean;
  hasCommentsOnCells: boolean;
  hasStepsToUndoForNextPageToKnowOf: boolean;
  isFollowingAgent: boolean;
  isFollowingPerson: boolean;
  movesOfViewByItself: StateOf<'movesOfViewByItself'>;
  linkOfActiveCell: LinkShownOfCell['url'] | null;
  linkForm: StateOf<'linkForm'>;
  linkByHandOffered: ReturnType<typeof linkActionAtActiveCell> | null;
  doesKeyOpenLinkForm: boolean;
  linkInWordsOfActiveCell: { url: LinkShownOfCell['url']; cellKey: string } | null;
  linksAmongTextOfActiveCell: { urls: ReturnType<typeof linkAddressesAt>; cellKey: string } | null;
  canLinkCardCome: boolean;
  whereWordsOfActiveCellLink: LinkShownOfCell['url'] | null;
  isAddressOfActiveCellBuilt: boolean;
  errorExplained: ErrorExplainedView | null;
  linkExplained: LinkExplainedView | null;
  errorsOffered: ReturnType<typeof errorsOfferedView> | null;
  fixesOnCells: ReturnType<typeof fixesBarStage> | null;
  fixesOfSelectedCells: ReturnType<typeof fixesInSelectionStage> | null;
  doesFixWaitForCalculation: boolean;
  countOfErrorsOffered: NonNullable<StateOf<'errorsOffered'>>['count'] | null;
  errorOfActiveCell: StateOf<'reasonsForErrors'>['ofEntryCell'];
  canActiveCellBeFixedHere: boolean;
  isFixOfActiveCellYetToBeKnown: boolean;
  formulaBarText: EditingMode['text'] | StateOf<'textToEditOfEntryCell'>;
  formulaSpilledOverEntryCell: ReturnType<typeof formulaSpilledOverCell>;
  formulaOfFixOnEntryCell: ReturnType<typeof cellsOfFixes>[number]['formula'] | null;
  pointedReference: StateOf<'pointedReference'>;
  referencesInEntry: StateOf<'referencesInEntry'>;
  sheetPointedIn: StateOf<'sheetPointedIn'>;
  sheetsToPointIn: ReturnType<typeof sheetsToPointInFor>;
  doesEntryTakeLineBreaks: boolean;
  hasCellsToFill: boolean;
  formulaFromWords: StateOf<'formulaFromWords'>;
  pointedCells: ReturnType<typeof pointedCellsTip>;
  isFormulaBarReadOnly: boolean;
  errorsAtOpening: { sheetId: SheetId; count: NonNullable<StateOf<'errorsAtOpening'>>['count']; cells: string | null; areFixesHeldBack: boolean } | null;
  errorsFoundAtOpening: StateOf<'errorsFoundAtOpening'>;
  noticeOfNoFix: { cells: string; why: NonNullable<StateOf<'formulaFromWords'>['fixThatCameToNothing']>['why'] | 'other' } | null;
  mode: StateOf<'mode'>;
  isUnfinishedFormulaOpen: boolean;
  notice: StateOf<'notice'>;
  newsOfLoss: StateOf<'newsOfLoss'>;
  isEntryEndedUnasked: StateOf<'isEntryEndedUnasked'>;
  undoOffer: StateOf<'undoOffer'>;
  undoOfTurnOffered: StateOf<'undoOfTurnOffered'>;
  latestStep: StateOf<'notesOfSteps'>['latest'];
  isUndoOfTurnAwaited: boolean;
  undoAndRedo: ReturnType<typeof whyUndoRedoUnavailable>;
  isImportAsNewSheetUnanswered: boolean;
  saving: StateOf<'saving'>;
  hasUnsavedEdits: StateOf<'hasUnsavedEdits'>;
  fractionSavedToShow: number | null;
  isLongCalculationTold: boolean;
  ownViewShownAsApplied: StateOf<'ownViewShownAsApplied'>;
  calculating: CalculatingToShow | null;
  calculatingShownWait: Wait | null;
  savingBarWait: NonNullable<StateOf<'savingProgress'>>['wait'] | null;
  longCalculationWait: Wait | null;
  waitForNextEditOfAgent: StateOf<'waitForNextEditOfAgent'>;
  waitForAgentOnComments: NonNullable<StateOf<'commentsWithAgent'>>['wait'] | null;
  contextBarMenu: StateOf<'contextBarMenu'>;
  viewOnlyBecause: ViewOnlyBecause | null;
  isCaretWithCellsBeforeEntryEnds: boolean;
  mostBytesOfAFileToImport: number;
  areFormulasShown: StateOf<'areFormulasShown'>;
  density: StateOf<'density'>;
  lastDone: StateOf<'lastDone'>;
  saidOfAgent: StateOf<'saidOfAgent'>;
  doneByAgent: StateOf<'doneByAgent'>;
  find: FindView | null;
}
