import type { Edit, OptionInAnEditor, StepGivenUpAnswer } from '@open-artifact/sheets-core';
import type { CellId, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { LineSizes } from '../model/line-sizes.ts';
import type { OwnRowOrder } from '../model/line-ids.ts';
import type { RefusalMessageKey } from '../model/refusals.ts';
import type { GridLayout } from '../grid/layout.ts';
import type { CellArea, CellSelection, SelectionPositions, SelectionToRead } from '../selection/model.ts';
import type { LastDone, PageState } from './initial-state.ts';
import type { DoneToArea, DoneWithDetail, IfQueued, PageEvent, PlaceAreaChanged } from './event-reducer.ts';
import type { PageEffect, UndoOrRedoEffect } from './transitions.ts';
import type { Place } from './places.ts';
import { nearestShownLine } from '../model/line-sizes.ts';
import { keepScrollAnchoredAcrossChange, layoutOfView, findSheetById, clampScrollOfView } from '../grid/layout.ts';
import { remapSelectionOverShownRows, unhideAreaIfAllFiltered, trimAreaToShownRows } from '../tables/filtered-rows.ts';
import { isActiveCellFullyInView } from '../selection/remap.ts';
import {
  scrollToShowSelection,
  selectionKeepsItsCells,
  selectionAtCell,
  selectedArea,
  isSameArea,
  selectionOfArea,
  scrollToShowPosition,
  BOTH_AXES,
  positionsPastHiddenRow,
  selectionFromPositions,
  isSameCell,
  selectionKindOf,
} from '../selection/model.ts';
import { newsOfLossIfTypingLost, dropdownEditorOfPane } from './queries.ts';
import { clearPassingNotice, NAVIGATING_MODE, lastDoneWorthKeeping } from './transitions.ts';
import { firstPlaceInSheet, firstPlaceInWorkbook, isAreaReadByInteractive } from './places.ts';
import { showSheet } from './sheet-tabs.ts';
import { areaToA1AsStored, areasToA1AsStored } from '../formulas/from-words/where.ts';
import { rowLabelEnds, columnLabelEnds, isAreaSplitWhenStored } from '../model/a1-references.ts';
import { selectPastedChart } from './copy-paste.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { scrollToShowSelectedLines, mergeBrokenByMove } from '../selection/move-lines.ts';
import { settleActiveCellOnMerges } from '../selection/merged-cells.ts';
import { withoutOtherRanges, areasOfAllRanges } from '../selection/several-ranges.ts';
import { bringEndIntoView } from '../grid/lines-at-end.ts';
import { usersOfCell } from '../model/cell-values.ts';
import { actOfEdit } from '../edits/rows-out-of-view.ts';
import type { ActStoppedByHiddenRows } from '../messages/filter-refusals.ts';
import { refusalMessageKey, isEditRefusalReason, undoRefusalKind } from '../model/refusals.ts';
import { afterFormatApplied } from '../format/custom-number-format.ts';
import { discardCopiedChartNodes } from '../charts/copied-chart-nodes.ts';
import { areasOverlap } from '../model/workbook.ts';
import { showPlacedViewChange } from '../charts/placed-views.ts';
import { IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
export function keepSelectionInShownLines(
  selection: SelectionToRead,
  previousState: Place,
  { rowEdges, rowCount, columnEdges, columnCount }: GridLayout,
  workbook: WorkbookReads,
): SelectionToRead {
  let { sheetId } = previousState;
  let activePosition = workbook.positionOfCell(selection.activeCell);
  let cornerPosition = workbook.positionOfCell(selection.selectionCorner);
  if (activePosition === null || cornerPosition === null) return selection;
  let isRowGone = workbook.rowIndexOf(sheetId, previousState.activeCell.rowId) === null;
  let isColumnGone = workbook.columnIndexOf(sheetId, previousState.activeCell.columnId) === null;
  let rowIndex = isRowGone ? nearestShownLine(rowEdges, rowCount, activePosition.rowIndex, 1) : activePosition.rowIndex;
  let columnIndex = isColumnGone ? nearestShownLine(columnEdges, columnCount, activePosition.columnIndex, 1) : activePosition.columnIndex;
  let activeCell = workbook.cellIdAt(sheetId, rowIndex, columnIndex);
  let selectionCorner = workbook.cellIdAt(
    sheetId,
    cornerPosition.rowIndex === activePosition.rowIndex ? rowIndex : cornerPosition.rowIndex,
    cornerPosition.columnIndex === activePosition.columnIndex ? columnIndex : cornerPosition.columnIndex,
  );
  return activeCell === null || selectionCorner === null
    ? selection
    : {
        activeCell,
        selectionCorner,
      };
}
export function reconcileWithWorkbook(
  state: PageState,
  previousWorkbook: ReadsWithTextMeasurer,
  workbook: ReadsWithTextMeasurer,
  { ownCollapsing, rowsOutOfViewByOwnFilters }: Pick<PageState, 'ownCollapsing' | 'rowsOutOfViewByOwnFilters'> = state,
): PageState {
  let anchored = keepScrollAnchoredAcrossChange(
    {
      ...state,
      ownCollapsing,
      rowsOutOfViewByOwnFilters,
    },
    previousWorkbook,
    workbook,
    state,
  );
  let remapPlace = <P extends Place>(previousPlace: Place, place: P): P | null => {
    let selection = remapSelectionOverShownRows(previousPlace, anchored, previousWorkbook, workbook);
    if (selection === null) return null;
    let isActiveCellThere = workbook.positionOfCell(previousPlace.activeCell) !== null;
    let layout = layoutOfView(
      {
        ...anchored,
        sheetId: previousPlace.sheetId,
        dragging: null,
      },
      workbook,
    );
    let placeRemapped = {
      ...place,
      ...(isActiveCellThere ? selection : keepSelectionInShownLines(selection, previousPlace, layout, workbook)),
    };
    let isStepSelecting = state.answerAwaited === 'toUndoOrRedo';
    if (isActiveCellThere || isStepSelecting || !isActiveCellFullyInView(previousPlace, state, previousWorkbook)) return placeRemapped;
    let scrolledState = {
      ...anchored,
      dragging: null,
      ...placeRemapped,
    };
    let { scrollLeft, scrollTop } = scrollToShowSelection(scrolledState, workbook, 'pointer');
    if (scrollTop === scrolledState.scrollTop)
      return {
        ...placeRemapped,
        scrollLeft,
      };
    return {
      ...placeRemapped,
      scrollLeft,
      scrollTop: scrollToShowSelection(scrolledState, workbook).scrollTop,
    };
  };
  let remapped = {
    ...anchored,
    placesLeft: anchored.placesLeft.map((place: Place, index: number) => remapPlace(state.placesLeft[index] ?? place, place) ?? place),
  };
  if ((remapped.mode.kind === 'editing' || remapped.rangeWalked !== null) && workbook.positionOfCell(remapped.activeCell) !== null)
    return selectionKeepsItsCells(remapped, previousWorkbook, workbook)
      ? remapped
      : {
          ...remapped,
          ...selectionAtCell(remapped.activeCell),
        };
  if (selectedArea(remapped, workbook) !== null) return remapPlace(state, remapped) ?? remapped;
  let wasEditing = remapped.mode.kind === 'editing';
  let newsOfLoss = newsOfLossIfTypingLost(remapped, 'entryDroppedByRemoval');
  let stateWithoutEntry: PageState = {
    ...(wasEditing ? clearPassingNotice(remapped) : remapped),
    mode: NAVIGATING_MODE,
    dragging: null,
    newsOfLoss,
  };
  let remappedHere = remapPlace(
    wasEditing
      ? {
          ...state,
          ...selectionAtCell(state.activeCell),
        }
      : state,
    stateWithoutEntry,
  );
  if (remappedHere !== null) return remappedHere;
  let sheetExists = ({ sheetId }: Pick<Place, 'sheetId'>) =>
    workbook.listSheets().some((sheet: SheetSummary) => sheet.sheetId === sheetId);
  let sheetHasPlace = ({ sheetId }: Pick<Place, 'sheetId'>) => firstPlaceInSheet(workbook, sheetId) !== null;
  let sheetIdToShow = (
    remapped.placesLeft.find((place: Place) => place.sheetId === remapped.sheetPointedIn && sheetHasPlace(place)) ??
    remapped.placesLeft.findLast(sheetHasPlace) ??
    firstPlaceInWorkbook(workbook)
  )?.sheetId;
  if (sheetIdToShow === undefined) return remapped;
  let shownState = showSheet(stateWithoutEntry, workbook, sheetIdToShow);
  let entryReset = wasEditing ? selectionAtCell(shownState.activeCell) : {};
  return {
    ...shownState,
    ...entryReset,
    placesLeft: shownState.placesLeft.filter(sheetExists),
    notice: stateWithoutEntry.notice,
  };
}
export function lastDoneForArea(done: DoneToArea | DoneWithDetail, area: CellArea, ownRowOrder: OwnRowOrder | null): LastDone {
  if (typeof done === 'string')
    return {
      what: done,
      cells: areaToA1AsStored(area, ownRowOrder),
    };
  switch (done.what) {
    case 'rowsSized':
    case 'rowsInserted':
      return {
        ...done,
        ...rowLabelEnds(area, ownRowOrder),
      };
    case 'columnsSized':
    case 'columnsInserted':
      return {
        ...done,
        ...columnLabelEnds(area),
      };
    case 'formatted':
      return {
        ...done,
        cells: done.cellEnteredIn ?? areaToA1AsStored(area, ownRowOrder),
      };
    case 'bordersDrawn':
      return {
        ...done,
        cells: areaToA1AsStored(area, ownRowOrder),
      };
    case 'checkboxesMade':
    case 'cellsSorted': {
      let { headingRowCount, ...doneWithoutHeading } = done;
      if (doneWithoutHeading.what === 'cellsSorted' && doneWithoutHeading.cells !== undefined)
        return {
          ...doneWithoutHeading,
          cells: doneWithoutHeading.cells,
        };
      let topRowIndex = area.topRowIndex + headingRowCount;
      let rowCount = area.rowCount - headingRowCount;
      return {
        ...doneWithoutHeading,
        cells: areaToA1AsStored(
          {
            ...area,
            topRowIndex,
            rowCount,
          },
          ownRowOrder,
        ),
      };
    }
    case 'rowsFrozen':
    case 'columnsFrozen':
    case 'gridlinesHidden':
    case 'gridlinesShown':
    case 'interactiveReset':
    case 'interactiveDefaultsSaved':
    case 'pivotTableAdded':
    case 'pivotTableUpdated':
    case 'formattedAsTable':
    case 'notFormattedAsTable':
    case 'placedViewMoved':
    case 'placedViewSized':
    case 'grouped':
    case 'ungrouped':
    case 'collapsed':
    case 'expanded':
    case 'groupsCollapsed':
    case 'groupsExpanded':
    case 'shownToLevel':
    case 'dropdownCellsSet':
    case 'dropdownOptionsSet':
    case 'dropdownOptionMoved':
    case 'dropdownOptionRemoved':
    case 'dropdownOptionsAdded':
    case 'dropdownStartedFrom':
    case 'headerRowSet':
    case 'offeredWordsEntered':
    case 'typedTextEntered':
    case 'entryEmptiedCell':
    case 'formulaOfAgentEntered':
    case 'fixKept':
    case 'fixesKept':
    case 'columnsOfTableMoved':
    case 'personAdded':
    case 'personRemoved':
    case 'peopleReplaced':
    case 'contentsReplaced':
    case 'rowsSorted':
    case 'checked':
    case 'unchecked':
    case 'movedOverCells':
    case 'boxOfLineSet':
    case 'undoOfferMade':
    case 'timeZoneSet':
    case 'localeSet':
    case 'rulesAdded':
    case 'ruleChanged':
    case 'movedToNumbers':
    case 'scaleColorsNothing':
    case 'ruleRemoved':
    case 'ruleMoved':
    case 'offerDiscarded':
    case 'agentStopped':
    case 'namedViewPicked':
    case 'namedViewSaved':
    case 'namedViewUpdated':
    case 'namedViewRenamed':
      return done;
  }
}
export function selectAreaUnlessHeld(state: PageState, workbook: WorkbookReads, area: CellArea): CellSelection | null {
  let selected = selectedArea(state, workbook);
  return selected !== null && isSameArea(area, selected) ? state : selectionOfArea(state, workbook, area);
}
export function narrowToLineOfCell(area: CellArea | null, narrowTo: LineOfCell | undefined, workbook: WorkbookReads): CellArea | null {
  if (area === null || narrowTo === undefined) return area;
  let position = workbook.positionOfCell('inRowOf' in narrowTo ? narrowTo.inRowOf : narrowTo.inColumnOf);
  if (position === null) return area;
  return 'inRowOf' in narrowTo
    ? {
        ...area,
        topRowIndex: position.rowIndex,
        rowCount: 1,
      }
    : {
        ...area,
        leftColumnIndex: position.columnIndex,
        columnCount: 1,
      };
}
export function selectAfterEdit(state: PageState, workbook: ReadsWithTextMeasurer, ifQueued: IfQueued, answer: PlaceAreaChanged | null): PageState {
  if (ifQueued.select === 'placeChanged' && ifQueued.done === 'pasted' && answer?.placementId !== undefined) {
    let stateOnSheet = showSheet(state, workbook, answer.sheetId);
    return selectPastedChart(stateOnSheet, workbook, answer.placementId) ?? state;
  }
  let selected = applySelectionAfterEdit(state, workbook, ifQueued, answer);
  let area = answer?.area ?? null;
  if (ifQueued.isPlaceOnlyShown !== true || ifQueued.select !== 'placeChanged' || area === null) return selected;
  let { topRowIndex, rowCount, leftColumnIndex } = area;
  let { frozenRowCount } = layoutOfView(selected, workbook);
  let topRowToShow = Math.max(frozenRowCount, topRowIndex - ROWS_SHOWN_ABOVE_PLACE);
  let bottomShown = scrollToShowPosition(
    selected,
    workbook,
    {
      rowIndex: topRowIndex + rowCount - 1,
      columnIndex: leftColumnIndex,
    },
    {
      rows: true,
      columns: false,
    },
    'key',
  );
  let shown =
    ifQueued.isViewLeftAsItIs === true
      ? selected
      : scrollToShowPosition(
          bottomShown,
          workbook,
          {
            rowIndex: topRowToShow,
            columnIndex: leftColumnIndex,
          },
          BOTH_AXES,
          'key',
        );
  let {
    activeCell,
    selectionCorner,
    otherRanges,
    rangeWalked,
    cameToMergedCellsAt,
  } = showSheet(state, workbook, selected.sheetId);
  return {
    ...shown,
    activeCell,
    selectionCorner,
    otherRanges,
    rangeWalked,
    cameToMergedCellsAt,
  };
}
export function applySelectionAfterEdit(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  {
    select,
    foundBy,
    isViewLeftAsItIs,
    isSelectedAlone,
    endBroughtIntoView,
    done,
    thenSheet,
    keepsWordsOnEntryBefore,
    onlyCellOfPlaceChanged,
  }: IfQueued,
  answer: PlaceAreaChanged | null,
): PageState {
  if (select !== null && select !== 'placeChanged' && 'corner' in select) {
    let positions = positionsPastHiddenRow(state, workbook, select);
    let selectionPastHiddenRow = selectionFromPositions(state, workbook, positions);
    let stateScrolled: PageState = {
      ...state,
      scrollTop: select.scrollTop,
    };
    return applySelectionAfterEdit(
      stateScrolled,
      workbook,
      {
        select: selectionPastHiddenRow,
        foundBy: positions === select ? 'fillHandle' : 'key',
        done,
      },
      answer,
    );
  }
  let isPlaceChanged = select === 'placeChanged';
  let sheetToShow = isPlaceChanged ? answer?.sheetId : thenSheet;
  let stateOnSheet = sheetToShow === undefined ? state : showSheet(state, workbook, sheetToShow);
  let stateWithDone: PageState =
    thenSheet === undefined
      ? stateOnSheet
      : {
          ...stateOnSheet,
          lastDone: null,
        };
  // `isPlaceChanged` is false here, so `select` is not 'placeChanged'; positions returned above.
  let selectTarget = isPlaceChanged
    ? narrowToLineOfCell(answer?.area ?? null, onlyCellOfPlaceChanged, workbook)
    : (select as Exclude<IfQueued['select'], 'placeChanged' | SelectionPositions>);
  if (selectTarget === null) {
    let areaSelected = done === null ? null : selectedArea(stateWithDone, workbook);
    if (done === null || areaSelected === null) return stateWithDone;
    let stateDone: PageState = {
      ...stateWithDone,
      lastDone: lastDoneForArea(done, areaSelected, ownRowOrderOfSheet(workbook, stateWithDone.sheetId)),
    };
    return done === 'moved' ? scrollToShowSelectedLines(stateDone, workbook) : stateDone;
  }
  let selection = 'activeCell' in selectTarget ? selectTarget : selectAreaUnlessHeld(stateWithDone, workbook, selectTarget);
  let area = selection === null ? null : selectedArea(selection, workbook);
  if (selection === null || area === null)
    return {
      ...stateWithDone,
      lastDone: null,
    };
  let isSameActiveCell = isSameCell(selection.activeCell, stateWithDone.activeCell);
  let mergedArea = workbook.mergedAreaAt(stateWithDone.sheetId, {
    rowIndex: area.topRowIndex,
    columnIndex: area.leftColumnIndex,
  });
  let isMergedArea = mergedArea !== null && isSameArea(mergedArea, area);
  let doneArea = 'activeCell' in selectTarget || isMergedArea ? area : selectTarget;
  let keptLastDone = keepsWordsOnEntryBefore === true ? lastDoneWorthKeeping(stateWithDone) : null;
  let settled = settleActiveCellOnMerges(
    {
      ...(isSelectedAlone === true ? withoutOtherRanges(stateWithDone) : stateWithDone),
      activeCell: selection.activeCell,
      selectionCorner: selection.selectionCorner,
      rangeWalked: selection.rangeWalked ?? null,
      cameToMergedCellsAt: isSameActiveCell ? stateWithDone.cameToMergedCellsAt : null,
      lastDone: done !== null ? lastDoneForArea(done, doneArea, ownRowOrderOfSheet(workbook, stateWithDone.sheetId)) : keptLastDone,
    },
    workbook,
  );
  let selectedState =
    foundBy === 'key' || isSameActiveCell
      ? settled
      : {
          ...settled,
          cameToMergedCellsAt: null,
        };
  if (foundBy === 'fillHandle' || isViewLeftAsItIs === true) return selectedState;
  if (endBroughtIntoView !== undefined) return bringEndIntoView(selectedState, workbook, endBroughtIntoView);
  if (foundBy === 'key') {
    let scrolled = scrollToShowSelection(selectedState, workbook, foundBy);
    let { scrollLeft, scrollTop } = scrolled;
    return {
      ...scrolled,
      leftByKeyAt: {
        scrollLeft,
        scrollTop,
      },
    };
  }
  let position = workbook.positionOfCell(selection.activeCell);
  return position === null ? selectedState : scrollToShowPosition(selectedState, workbook, position, BOTH_AXES, foundBy);
}
export function selectionToQueue(ifQueued: IfQueued, edit: Edit, state: PageState, workbook: WorkbookReads): IfQueued {
  let { scrollIfRefused, movesColumnsOfTable, ...withoutScroll } = ifQueued;
  let rest =
    movesColumnsOfTable === undefined
      ? withoutScroll
      : {
          ...withoutScroll,
          movesColumnsOfTable: {
            ...movesColumnsOfTable,
            before: null,
          },
        };
  let { select } = rest;
  if (select === null || select === 'placeChanged' || 'activeCell' in select) return rest;
  if ('corner' in select) return rest;
  let selection = LINE_COUNT_EDIT_KINDS.has(edit.kind) ? null : selectAreaUnlessHeld(state, workbook, select);
  if (selection === null)
    return {
      ...rest,
      select: null,
      done: null,
      isSelectionGivenUp: true,
    };
  let { activeCell, selectionCorner } = selection;
  return {
    ...rest,
    select: {
      activeCell,
      selectionCorner,
    },
  };
}
export function isSelectionLostByAnswer(event: PageEvent, workbook: WorkbookReads): boolean {
  if (event.kind !== 'editAnswered' || event.outcome.kind === 'refused') return false;
  let { select, isSelectionGivenUp } = event.ifQueued;
  if (isSelectionGivenUp === true) return true;
  return select !== null && select !== 'placeChanged' && 'activeCell' in select && selectedArea(select, workbook) === null;
}
export function askedKindOfEdit(
  edit: Edit,
  state: PageState,
  { done, undoOffer, thenEvent, movesColumnsOfTable }: Pick<IfQueued, 'done' | 'undoOffer' | 'thenEvent' | 'movesColumnsOfTable'>,
): AskedKindOfEdit {
  let doneWhat = done !== null && typeof done === 'object' ? done.what : done;
  if (doneWhat === 'checked' || doneWhat === 'unchecked' || doneWhat === 'replaced') return 'otherEdit';
  if (doneWhat === 'checkboxesMade') return 'otherEdit';
  if (undoOffer?.kind === 'replacedInCells' || undoOffer?.kind === 'textsConverted') return 'otherEdit';
  if (thenEvent?.kind === 'fixesKeptAnswered' || thenEvent?.kind === 'fixKeptAnswered') return 'otherEdit';
  if (thenEvent?.kind === 'linkFormShut') return 'otherEdit';
  if (doneWhat === 'namedViewUpdated') return 'updateOfNamedView';
  if (doneWhat === 'namedViewRenamed') return 'renameOfNamedView';
  if (PASTE_EDIT_KINDS.has(edit.kind)) return 'paste';
  if (edit.kind === 'moveCells') return 'pasteOfCut';
  if (edit.kind === 'moveRows' || edit.kind === 'moveColumns') return 'move';
  if (edit.kind === 'moveColumnsOfCells')
    return movesColumnsOfTable !== undefined && movesColumnsOfTable.area.columnCount - movesColumnsOfTable.count > 1
      ? 'moveOfColumnsOfTable'
      : 'moveOfColumnsOfTablePastOne';
  if (edit.kind === 'sortRows') return 'sort';
  if (edit.kind === 'sortCells') return 'sortOfRange';
  if (edit.kind === 'fillCells') return 'fill';
  if (edit.kind === 'importTableAsNewSheet' || edit.kind === 'importTableIntoSheet') return 'import';
  if (edit.kind === 'groupRows') return 'groupOfRows';
  if (edit.kind === 'groupColumns') return 'groupOfColumns';
  if (edit.kind === 'duplicateSheet') return 'duplicateOfSheet';
  if (edit.kind === 'fitColumns') return 'fitOfColumns';
  if (edit.kind === 'insertPivotTable') return 'newPivotTable';
  if (edit.kind === 'changePivotTable') return 'changeOfPivotTable';
  if (edit.kind !== 'setDropdownOptions')
    return edit.kind === 'formatCells' || edit.kind === 'setBorders' || edit.kind === 'makeDropdown' ? 'format' : 'otherEdit';
  if (edit.appliesTo.kind === 'cellsInRows') return 'format';
  let optionIds = new Set(edit.options.map(({ optionId }: OptionInAnEditor) => optionId));
  return (dropdownEditorOfPane(state)?.options ?? []).filter(({ optionId }: OptionOfDropdownEditor) => !optionIds.has(optionId)).length === 1
    ? 'removalOfOneOption'
    : 'otherEdit';
}
export function noticeOfRefusedEdit(state: PageState, workbook: WorkbookReads, edit: Edit, reason: string, ifQueued: IfQueued): PageState {
  if (edit.kind === 'addUserToCell' && reason === 'tooManyUsersInCell') {
    let { sheetId, cell } = edit;
    let length = usersOfCell(
      workbook.cellOf({
        sheetId,
        rowId: cell.r,
        columnId: cell.c,
      }),
    ).length;
    return {
      ...state,
      notice: {
        kind: 'cellHoldsNoMorePeople',
        most: length,
      },
    };
  }
  if (reason === 'groupsTooDeep')
    return {
      ...state,
      notice: {
        kind: 'groupsTooDeep',
        most: workbook.deepestGroup(),
      },
    };
  if (reason === 'tooManyNamedViews') {
    let most = workbook.limitsOfNamedViews().mostNamedViewsInASheet;
    return {
      ...state,
      notice: {
        kind: 'tooManyNamedViews',
        most,
      },
    };
  }
  if (reason === 'unknownNamedView' && edit.kind === 'removeNamedView') return state;
  if (reason === 'formulaReadsAnotherRow') {
    let act: OwnSortInTheWayNotice['act'] = edit.kind === 'fillCells' ? 'fillOfFormula' : 'pasteOfFormula';
    return {
      ...state,
      notice: {
        kind: 'ownSortInTheWay',
        act,
      },
    };
  }
  if (reason === 'rowNotNamedInTheWay') {
    let act = actOfEdit(edit);
    let hasRowsOutOfView = state.rowsOutOfViewByOwnFilters.size > 0;
    if (!(hasRowsOutOfView && (act === 'paste' || act === 'fill')) && ownRowOrderOfSheet(workbook, state.sheetId) !== null)
      return {
        ...state,
        notice: {
          kind: 'ownSortInTheWay',
          act,
        },
      };
    if (hasRowsOutOfView)
      return {
        ...state,
        notice: {
          kind: 'rowsOutOfViewInTheWay',
          act,
        },
      };
  }
  let why = refusalMessageKey(reason);
  let customNumberFormat = afterFormatApplied(state.customNumberFormat, edit, reason);
  if (customNumberFormat !== null && customNumberFormat !== state.customNumberFormat)
    return {
      ...state,
      customNumberFormat,
    };
  if (edit.kind !== 'renameSheet') {
    let isTypingLost = state.customNumberFormat !== null && customNumberFormat === null;
    let noticeOfRefusal: EditAnswerRefusedNotice = {
      kind: 'editRefused',
      why,
      asked: askedKindOfEdit(edit, state, ifQueued),
    };
    let mergeBroken =
      why === 'moveSplitsMergedCells' && (edit.kind === 'moveRows' || edit.kind === 'moveColumns') ? mergeBrokenByMove(workbook, edit) : null;
    let refusalNotice: EditAnswerRefusedNotice =
      mergeBroken === null
        ? noticeOfRefusal
        : {
            ...noticeOfRefusal,
            mergedCells: areaToA1AsStored(mergeBroken, ownRowOrderOfSheet(workbook, state.sheetId)),
          };
    return {
      ...state,
      customNumberFormat,
      notice: isTypingLost
        ? {
            ...refusalNotice,
            isTypingLost,
          }
        : refusalNotice,
    };
  }
  let refusedName: SheetNameRefusal = {
    name: edit.name,
    why,
  };
  let { sheetBeingRenamed } = state;
  return sheetBeingRenamed?.sheetId === edit.sheetId
    ? {
        ...state,
        sheetBeingRenamed: {
          ...sheetBeingRenamed,
          refused: refusedName,
        },
      }
    : {
        ...state,
        notice: {
          kind: 'sheetNameRefused',
          refused: refusedName,
        },
      };
}
export function discardEffectsOfRefusal(edit: Edit, reason: string): PageEffect[] {
  return isEditRefusalReason(refusalMessageKey(reason)) || reason === 'widgetNodeOfAnotherView' ? [] : discardCopiedChartNodes(edit);
}
export function noticeOfStepNotTaken(
  { refusal, sheetNameInTheWay }: Pick<StepGivenUpAnswer, 'refusal' | 'sheetNameInTheWay'>,
  direction: UndoOrRedoEffect['direction'],
): StepNotTakenNotice {
  if (sheetNameInTheWay?.kind === 'ofSheetToBringBack')
    return {
      kind: 'sheetNotBroughtBack',
      direction,
    };
  if (sheetNameInTheWay?.kind === 'ofSheetToName' && sheetNameInTheWay.takenBy !== null)
    return {
      kind: 'sheetNameTakenSinceEdit',
      direction,
      name: sheetNameInTheWay.takenBy,
    };
  switch (undoRefusalKind(refusal)) {
    case 'changedSince':
      return {
        kind: 'changedSinceEdit',
        direction,
      };
    case 'formatsTooMixed':
      return {
        kind: 'formatsTooMixedSinceEdit',
        direction,
      };
    case 'noOtherSheetLeft':
      return {
        kind: 'nothingElseLeftSinceEdit',
        direction,
        lastOf: 'sheet',
      };
    case 'noOtherRowLeft':
      return {
        kind: 'nothingElseLeftSinceEdit',
        direction,
        lastOf: 'row',
      };
    case 'noOtherColumnLeft':
      return {
        kind: 'nothingElseLeftSinceEdit',
        direction,
        lastOf: 'column',
      };
    case null:
      return {
        kind: 'stepGivenUp',
        direction,
      };
  }
}
export function shownLinesOfArea(state: PageState, workbook: ReadsWithTextMeasurer, area: CellArea): CellArea | null {
  let layout = layoutOfView(state, workbook);
  let kind = selectionKindOf(area, layout);
  if (kind === 'cells') return null;
  let [first, count, lineCount, edges]: [number, number, number, LineSizes] =
    kind === 'rows'
      ? [area.topRowIndex, area.rowCount, layout.rowCount, layout.rowEdges]
      : [area.leftColumnIndex, area.columnCount, layout.columnCount, layout.columnEdges];
  let firstShown = nearestShownLine(edges, lineCount, first, 1);
  if (firstShown === first) return null;
  let shownCount = firstShown > first && firstShown < first + count ? first + count - firstShown : Math.min(count, lineCount - firstShown);
  return kind === 'rows'
    ? {
        ...area,
        topRowIndex: firstShown,
        rowCount: shownCount,
      }
    : {
        ...area,
        leftColumnIndex: firstShown,
        columnCount: shownCount,
      };
}
export function selectionKeptOrCornerOf(state: PageState, workbook: WorkbookReads, area: CellArea): SelectionToRead | null {
  let selected = selectedArea(state, workbook);
  if (selected !== null && areasOverlap(selected, area))
    return {
      activeCell: state.activeCell,
      selectionCorner: state.selectionCorner,
    };
  return selectionOfArea(state, workbook, {
    ...area,
    rowCount: 1,
    columnCount: 1,
  });
}
export function showChangedPlace(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  what: StepShown,
  place: PlaceAreaChanged | null,
  selectionBefore: SelectionToRead | null = null,
): PageState {
  let stateNotDragging: PageState = {
    ...state,
    dragging: null,
  };
  if (place === null || isAreaReadByInteractive(state, workbook, place))
    return {
      ...stateNotDragging,
      lastDone: {
        what,
        cells: null,
      },
    };
  let { sheetId, placementId } = place;
  let chartShown =
    placementId === undefined ? null : showPlacedViewChange(showSheet(stateNotDragging, workbook, sheetId), workbook, placementId, what);
  if (chartShown !== null) return chartShown;
  let { area } = place;
  if (area === null) {
    let shownState = selectAfterEdit(
      stateNotDragging,
      workbook,
      {
        ...IF_QUEUED_DEFAULTS,
        select: 'placeChanged',
        done: what,
      },
      place,
    );
    let sheetShown = shownState.sheetId === state.sheetId ? undefined : findSheetById(workbook, shownState.sheetId)?.name;
    return {
      ...shownState,
      lastDone: {
        what,
        cells: null,
        sheetShown,
      },
    };
  }
  let unhiddenState = unhideAreaIfAllFiltered(stateNotDragging, workbook, area, sheetId);
  let trimmedArea = trimAreaToShownRows(unhiddenState, workbook, area, sheetId);
  let stateOnSheet = showSheet(unhiddenState, workbook, sheetId);
  let selectTarget =
    selectionBefore !== null && selectedArea(selectionBefore, workbook) !== null
      ? selectionBefore
      : isAreaSplitWhenStored(area, ownRowOrderOfSheet(workbook, sheetId))
        ? selectionKeptOrCornerOf(stateOnSheet, workbook, trimmedArea)
        : shownLinesOfArea(stateOnSheet, workbook, trimmedArea);
  let selected =
    selectTarget === null
      ? selectAfterEdit(
          unhiddenState,
          workbook,
          {
            ...IF_QUEUED_DEFAULTS,
            select: 'placeChanged',
            done: what,
          },
          {
            ...place,
            area: trimmedArea,
          },
        )
      : {
          ...selectAfterEdit(
            stateOnSheet,
            workbook,
            {
              ...IF_QUEUED_DEFAULTS,
              select: selectTarget,
              done: what,
            },
            null,
          ),
          lastDone: lastDoneForArea(what, area, ownRowOrderOfSheet(workbook, stateOnSheet.sheetId)),
        };
  return {
    ...withoutOtherRanges(selected),
    placementSelected: null,
  };
}
export function showUndoneOrRedone(state: PageState, workbook: ReadsWithTextMeasurer, what: StepShown, places: PlaceAreaChanged[]): PageState {
  let areas = places.flatMap(({ area }: PlaceAreaChanged) => area ?? []);
  let distinctAreas = areas.filter(
    (area: CellArea, index: number) => !areas.slice(0, index).some((earlierArea: CellArea) => isSameArea(earlierArea, area)),
  );
  let [lastPlace = null, lastArea] = [places.at(-1), distinctAreas.at(-1)];
  if (lastPlace === null || lastArea === undefined) return showChangedPlace(state, workbook, what, lastPlace);
  if (places.every((place: PlaceAreaChanged) => isAreaReadByInteractive(state, workbook, place))) return showChangedPlace(state, workbook, what, null);
  let { sheetId } = lastPlace;
  let unhiddenState = distinctAreas.reduce(
    (stateUnhidden: PageState, area: CellArea) => unhideAreaIfAllFiltered(stateUnhidden, workbook, area, sheetId),
    state,
  );
  let shown = showChangedPlace(unhiddenState, workbook, what, {
    sheetId,
    area: lastArea,
  });
  let otherRanges = distinctAreas
    .slice(0, -1)
    .filter((area: CellArea) => !isAreaSplitWhenStored(area, ownRowOrderOfSheet(workbook, sheetId)))
    .flatMap((area: CellArea) => selectionOfArea(shown, workbook, trimAreaToShownRows(shown, workbook, area, sheetId)) ?? []);
  let stateWithRanges: PageState = {
    ...shown,
    otherRanges,
  };
  if (otherRanges.length === 0) return stateWithRanges;
  let allAreas = areasOfAllRanges(stateWithRanges, workbook);
  return {
    ...stateWithRanges,
    lastDone: {
      what,
      cells: areasToA1AsStored(allAreas, ownRowOrderOfSheet(workbook, stateWithRanges.sheetId)),
      rangeCount: allAreas.length,
    },
  };
}
export const ROWS_SHOWN_ABOVE_PLACE = 3;
export const LINE_COUNT_EDIT_KINDS = new Set<Edit['kind']>(['insertRows', 'insertColumns', 'deleteRows', 'deleteColumns']);
export const PASTE_EDIT_KINDS = new Set<Edit['kind']>([
  'pasteTexts',
  'pasteRowsOfTexts',
  'pasteCopiedCells',
  'pasteCellsOfAnotherProgram',
  'pasteValuesOfCopiedCells',
  'copyPlacedView',
]);
export const restoreViewOfRefusedEdit = (
  state: PageState,
  { scrollIfRefused, selectionIfRefused, isViewLeftAsItIs }: IfQueued,
  workbook: ReadsWithTextMeasurer,
): PageState =>
  clampScrollOfView(
    {
      ...state,
      ...selectionIfRefused,
      ...(isViewLeftAsItIs === true ? {} : scrollIfRefused),
    },
    workbook,
  );
/** What a refused edit was asked as, as the notice of its refusal tells it. */
export type AskedKindOfEdit =
  | 'otherEdit'
  | 'paste'
  | 'pasteOfCut'
  | 'move'
  | 'sort'
  | 'sortOfRange'
  | 'fill'
  | 'import'
  | 'groupOfRows'
  | 'groupOfColumns'
  | 'duplicateOfSheet'
  | 'fitOfColumns'
  | 'format'
  | 'removalOfOneOption'
  | 'updateOfNamedView'
  | 'renameOfNamedView'
  | 'moveOfColumnsOfTable'
  | 'moveOfColumnsOfTablePastOne'
  | 'newPivotTable'
  | 'changeOfPivotTable';
/** The notice that the workbook refused an edit, why, and what was asked. */
export interface EditAnswerRefusedNotice {
  kind: 'editRefused';
  why: RefusalMessageKey;
  asked: AskedKindOfEdit;
  /** The merged cells a move would split, when that is why. */
  mergedCells?: ReturnType<typeof areaToA1AsStored>;
  /** Set when the custom number format typed is lost with the refusal. */
  isTypingLost?: boolean;
}
/** The notice that a cell takes no more people. */
export interface CellHoldsNoMorePeopleNotice {
  kind: 'cellHoldsNoMorePeople';
  most: number;
}
/** The notice that groups of rows or columns would go deeper than they may. */
export interface GroupsTooDeepNotice {
  kind: 'groupsTooDeep';
  most: number;
}
/** The notice that the page's own sort, or rows filtered out of view, are in the way of an act. */
export type LinesInTheWayNotice = OwnSortInTheWayNotice | RowsOutOfViewInTheWayNotice;
/** An act stopped by the page's own sort of the rows. */
export interface OwnSortInTheWayNotice {
  kind: 'ownSortInTheWay';
  /** The act stopped; a formula's reference is stopped only by the page's own sort. */
  act: ActStoppedByHiddenRows | 'referTo' | 'fillOfFormula' | 'pasteOfFormula';
}
/** An edit stopped by rows the page's own filters keep out of view. */
export interface RowsOutOfViewInTheWayNotice {
  kind: 'rowsOutOfViewInTheWay';
  act: ActStoppedByHiddenRows;
}
/** A name of a sheet the workbook refused, and why. */
export interface SheetNameRefusal {
  name: string;
  why: RefusalMessageKey;
}
/** The notice that a sheet's name was refused, when the sheet is no longer being renamed. */
export interface SheetNameRefusedNotice {
  kind: 'sheetNameRefused';
  refused: SheetNameRefusal;
}
/** The notice that a sheet holds as many named views as it may. */
export interface TooManyNamedViewsNotice {
  kind: 'tooManyNamedViews';
  most: number;
}
/** The notices of an edit the workbook refused. */
export type RefusedEditNotice =
  | EditAnswerRefusedNotice
  | CellHoldsNoMorePeopleNotice
  | GroupsTooDeepNotice
  | TooManyNamedViewsNotice
  | LinesInTheWayNotice
  | SheetNameRefusedNotice;
/** The notice that an undo or a redo was not taken, and why. */
export interface StepNotTakenWithoutNameNotice {
  kind: 'sheetNotBroughtBack' | 'changedSinceEdit' | 'formatsTooMixedSinceEdit' | 'stepGivenUp';
  direction: UndoOrRedoEffect['direction'];
}
/** The notice that an undo or a redo was not taken, for the sheet's name is now taken by another. */
export interface SheetNameTakenNotice {
  kind: 'sheetNameTakenSinceEdit';
  direction: UndoOrRedoEffect['direction'];
  name: string;
}
/** The notice that an undo or a redo was not taken, for it would leave no sheet, row or column. */
export interface NothingElseLeftNotice {
  kind: 'nothingElseLeftSinceEdit';
  direction: UndoOrRedoEffect['direction'];
  lastOf: 'sheet' | 'row' | 'column';
}
/** The notices of an undo or a redo not taken. */
export type StepNotTakenNotice = StepNotTakenWithoutNameNotice | SheetNameTakenNotice | NothingElseLeftNotice;
/** What an undo or a redo did, as the page says it did. */
export type StepShown = 'undone' | 'redone';
/** The line of a cell a changed place narrows to: its row, or its column. */
type LineOfCell = { inRowOf: CellId } | { inColumnOf: CellId };
/** An option of the dropdown open in the side pane. */
type OptionOfDropdownEditor = NonNullable<ReturnType<typeof dropdownEditorOfPane>>['options'][number];
