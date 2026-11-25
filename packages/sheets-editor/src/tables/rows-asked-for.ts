import { selectedArea, activeAnchorCell, isSameArea, isSameCell, scrollToShowSelection, selectionAtCell } from '../selection/model.ts';
import { areasOverlap } from '../model/workbook.ts';
import {
  filterTableAtCell,
  isOwnFilterSortable,
  isFilterTableEmpty,
  ownFiltersOfSheet,
  isOwnFilterUnused,
  refreshStaleOwnFilters,
  lookStampOfWorkbook,
  ownFilterAtCell,
  addOwnFilterForTable,
  ownFilterByKey,
  restoreHeldOwnFilter,
  applyOwnFilter,
  heldOwnFilterSnapshot,
  sortOwnFilter,
  drawnOwnFiltersOfSheet,
  columnLabelOfFilterTable,
  saidOfSortColumn,
  recordCountsOfOwnFilter,
} from './own-filters.ts';
import { tablesToOutline } from './tables-in-view.ts';
import { isInSpan, rowPanes, shownRowIndicesInPane } from '../grid/geometry.ts';
import { filterTableForSelection, ownFilterRecordsArea, clearOwnFilters } from './own-filter-actions.ts';
import { areaOfFilteredTable, tablesInSightOf } from './finding.ts';
import { columnHoldsOf } from '../words/table-holds.ts';
import { suggestedAsksOf } from '../words/suggested-asks.ts';
import { tableToSortOfColumns, sortTableOfColumns } from './table-to-sort.ts';
import { keepActiveCellClearOfStuckHeaders } from '../selection/keep-in-view.ts';
import { filterOfEntries, columnsOfFilterItem } from './filter-model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { asLandedHold, newAwaitedHold } from '../format/answer-holds.ts';
import { withNoEffects } from '../state/transitions.ts';
import { sortOwnFilterTableForEveryone } from './own-filter-list.ts';
import { readWordsAsFilter } from '../words/read-filter.ts';
import { columnLetters } from '../model/a1-references.ts';
import { rowsFromWordsPrompt, ROWS_FROM_WORDS_INSTRUCTIONS, readRowsAnswer } from './rows-from-words.ts';
import { cleanTextForAgent } from '../agent/prompt-text.ts';
import { openSortPane } from './sort-pane.ts';
import { pickNamedView } from './named-view-actions.ts';
import { namedViewsOfOwnFilter } from './named-view-model.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellAt, ColumnId, Filter, SheetId, SortDirection } from '@open-artifact/sheets-core';
import type { CellId } from '../model/workbook.ts';
import type {
  AgentForRowsAsk,
  RowsAskAheadStands,
  RowsAskedFor,
  RowsAskTable,
  SelectionPlace,
  SuggestedAsk,
  TableHolds,
  WhyAgentIsNotAskedWhichRows,
  WordsReadAsFilter,
} from '../state/initial-state.ts';
import type { AgentRepliedWhichRowsAreAskedFor, RowsAsked, RowsAskedForAct } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CellArea } from '../selection/model.ts';
import type { FilterTable, HeldOwnFilterSnapshot, OwnFilter } from './own-filters.ts';
import type { FilteredTableArea } from './finding.ts';
import type { FilterLine } from './filter-model.ts';
import type { FactsToldOfRows, TableToldOfRows } from './rows-from-words.ts';
import type { SortFilterCard } from './sort-filter-card.tsx';
/** The first cell on show of an area, with the index of its row. */
export interface ShownCellOfArea extends CellId {
  rowIndex: number;
}
/** What is taken of the rows asked for: what they ask, and whether their sort is left out. */
export interface RowsToTake {
  asked: RowsAsked;
  isSortLeftOut: boolean;
}
/** The table and the day the agent is told of when asked which rows. */
export interface RowsAskToTell {
  table: RowsAskTable;
  today: string;
}
/** What is kept with the agent's answer: the words read, and why the agent is asked only at Enter from now on. */
interface AgentAnswerKept {
  read?: WordsReadAsFilter | null;
  whyNot?: WhyAgentIsNotAskedWhichRows | null;
}
/** The own filters of the sheets as they stood before a try, and the filters they were worked out of. */
interface OwnFiltersKept {
  of: Map<SheetId, OwnFilter[]>;
  kept: Map<SheetId, OwnFilter[]>;
}
export function filterCornerCellsInSelection(state: PageState, workbook: ReadsWithTextMeasurer): CellId[] {
  let area = selectedArea(state, workbook);
  if (area === null) return [];
  let corners = filterAreasOfSheet(state, workbook)
    .filter((filterArea) => areasOverlap(filterArea, area))
    .map(
      (filterArea) => ({
        rowIndex: Math.max(area.topRowIndex, filterArea.topRowIndex),
        columnIndex: Math.max(area.leftColumnIndex, filterArea.leftColumnIndex),
      }),
    );
  corners.sort(
    (corner, otherCorner) =>
      corner.rowIndex === otherCorner.rowIndex ? corner.columnIndex - otherCorner.columnIndex : corner.rowIndex - otherCorner.rowIndex,
  );
  return corners.flatMap(
    ({ rowIndex, columnIndex }) => workbook.cellIdAt(state.sheetId, rowIndex, columnIndex) ?? [],
  );
}
export function isSortAndFilterOnBar(state: PageState, workbook: ReadsWithTextMeasurer): boolean {
  if (state.rowsAskedFor !== null) return state.rowsAskedFor.isToolOnBar;
  let { shape } = state.selectionSeen;
  if (shape === 'columns') return true;
  if (shape === 'cell' || shape === 'mergedOnly') return false;
  return filterCornerCellsInSelection(state, workbook).length > 0;
}
export function firstShownCellOfArea({ sheetId }: Pick<PageState, 'sheetId'>, workbook: WorkbookReads, area: CellArea): ShownCellOfArea | null {
  let shownArea = workbook.areaOnShowIn(sheetId, area);
  if (shownArea === null) return null;
  let { topRowIndex, leftColumnIndex, columnCount } = shownArea;
  let columnIndex = workbook
    .columnIndexesOnShowIn(sheetId, topRowIndex)
    .find((shownIndex) => shownIndex >= leftColumnIndex && shownIndex < leftColumnIndex + columnCount);
  let cellId = columnIndex === undefined ? null : workbook.cellIdAt(sheetId, topRowIndex, columnIndex);
  return cellId === null
    ? null
    : {
        ...cellId,
        rowIndex: topRowIndex,
      };
}
export function filterTableEndingAbove(workbook: WorkbookReads, cellId: CellId): FilterTable | null {
  let position = workbook.positionOfCell(cellId);
  let cellAbove = position === null ? null : workbook.cellIdAt(cellId.sheetId, position.rowIndex - 1, position.columnIndex);
  let filterTable = cellAbove === null ? null : filterTableAtCell(workbook, cellAbove);
  return filterTable?.table.rowUnderTheBody === cellId.rowId ? filterTable : null;
}
export function filterTableAroundCell(state: PageState, workbook: ReadsWithTextMeasurer, cellId: CellId): FilterTable | null {
  let position = workbook.positionOfCell(cellId);
  let tableOutlined =
    position === null
      ? undefined
      : tablesToOutline(state, workbook).find(
          ({ area }) =>
            isInSpan(position.rowIndex, area.topRowIndex, area.rowCount) && isInSpan(position.columnIndex, area.leftColumnIndex, area.columnCount),
        );
  if (tableOutlined === undefined) return filterTableAtCell(workbook, cellId);
  let { sheetId } = tableOutlined;
  let { headerRows, firstColumn, lastColumn, body } = tableOutlined.table;
  let headerCell = [headerRows.firstRow, cellId.rowId, ...body.slice(0, 1).map(({ firstRow }) => firstRow)]
    .map(
      (rowId) => ({
        sheetId,
        rowId,
        columnId: firstColumn,
      }),
    )
    .find((cell) => workbook.cellOnShowIn(cell) !== null);
  let filterTableOfHeader = headerCell === undefined ? null : filterTableAtCell(workbook, headerCell);
  if (filterTableOfHeader?.table.firstColumn === firstColumn && filterTableOfHeader.table.lastColumn === lastColumn) return filterTableOfHeader;
  return (
    filterTableAtCell(workbook, cellId) ?? (filterTableOfHeader !== null && filterTableOfHeader.cellTableId !== null ? filterTableOfHeader : null)
  );
}
export function guessFilterTableOfSelection(state: PageState, workbook: ReadsWithTextMeasurer): FilterTable | null {
  let { shape } = state.selectionSeen;
  if (shape !== 'columns' && shape !== 'rows')
    return filterTableForSelection(state, workbook) ?? filterTableEndingAbove(workbook, activeAnchorCell(state, workbook));
  let unsureFound: FilterTable | null = null;
  let tryCell = (cellId: CellId) => {
    let filterTable = filterTableAtCell(workbook, cellId) ?? filterTableEndingAbove(workbook, cellId);
    let isUnsure = filterTable !== null && filterTable.columns.length === 1 && !filterTable.table.header.isSure;
    if (isUnsure) unsureFound ??= filterTable;
    return isUnsure ? null : filterTable;
  };
  for (let cornerCell of filterCornerCellsInSelection(state, workbook)) {
    let found = tryCell(cornerCell);
    if (found !== null) return found;
  }
  let area = selectedArea(state, workbook);
  for (let index = 0; area !== null && index < MAX_TABLE_GUESS_STEPS; index += 1) {
    let shownCell = firstShownCellOfArea(state, workbook, area);
    if (shownCell === null) break;
    let found = tryCell(shownCell);
    if (found !== null) return found;
    let filterTable = filterTableAtCell(workbook, shownCell);
    let tableArea = filterTable === null ? null : areaOfFilteredTable(workbook, filterTable);
    let nextTopRowIndex = tableArea === null ? shownCell.rowIndex + 1 : tableArea.topRowIndex + tableArea.rowCount;
    let rowsLeft = area.topRowIndex + area.rowCount - nextTopRowIndex;
    area =
      nextTopRowIndex > shownCell.rowIndex && rowsLeft > 0
        ? {
            ...area,
            topRowIndex: nextTopRowIndex,
            rowCount: rowsLeft,
          }
        : null;
  }
  return unsureFound;
}
export function rowCountOfTableRuns(workbook: WorkbookReads, { table }: Pick<FilterTable, 'table'>): number {
  return table.runs
    .map(({ firstRow, lastRow }) => {
      let firstIndex = workbook.rowIndexOf(table.sheetId, firstRow);
      let lastIndex = workbook.rowIndexOf(table.sheetId, lastRow);
      return firstIndex === null || lastIndex === null ? 0 : lastIndex - firstIndex + 1;
    })
    .reduce((count, rowCount) => count + rowCount, 0);
}
export function holdsOfFilterTable(workbook: WorkbookReads, filterTable: FilterTable, blankRows: number): TableHolds {
  return {
    records: (ownFilterRecordsArea(workbook, filterTable)?.rowCount ?? 0) - blankRows,
    columns: filterTable.columns.map((column) => columnHoldsOf(workbook, filterTable, column)),
  };
}
export function tableOfRowsAsk(state: PageState, workbook: WorkbookReads, ownFilter: OwnFilter, leavesOutCurrent: boolean): RowsAskTable {
  let rowsThatAreNoRecords = rowCountOfTableRuns(workbook, ownFilter);
  let holds = holdsOfFilterTable(workbook, ownFilter, rowsThatAreNoRecords);
  let suggested = suggestedAsksOf(holds, state.viewerId);
  let shownSuggested = leavesOutCurrent ? suggestionsBeyondFilter(ownFilter.filter, suggested) : suggested;
  let { columnId: activeColumnId } = activeAnchorCell(state, workbook);
  let isActiveColumnInTable =
    ownFilter.table.header.isSure && ownFilter.columns.some(({ c }) => c === activeColumnId);
  return {
    key: ownFilter.key,
    holds,
    suggested: shownSuggested,
    columnAtCell: isActiveColumnInTable ? activeColumnId : null,
    sorts: isOwnFilterSortable(workbook, ownFilter) ? 'forOneself' : isFilterTableEmpty(ownFilter) ? 'forEveryone' : null,
    rowsThatAreNoRecords,
    isRead: holds.records > 0 && holds.columns.every(({ values }) => values.length > 0),
  };
}
export function ownFilterOverSelection(state: PageState, workbook: WorkbookReads): OwnFilter | null {
  let area = selectedArea(state, workbook);
  let overlapping = ownFiltersOfSheet(state, state.sheetId).flatMap((ownFilter) => {
    let filterArea = areaOfFilteredTable(workbook, ownFilter);
    return area !== null && filterArea !== null && areasOverlap(filterArea, area)
      ? [
          {
            held: ownFilter,
            top: filterArea.topRowIndex,
          },
        ]
      : [];
  });
  overlapping.sort((one, other) => one.top - other.top);
  return (overlapping.find(({ held }) => !isOwnFilterUnused(held)) ?? overlapping[0])?.held ?? null;
}
export function ownFilterOverlappingTable(state: PageState, workbook: WorkbookReads, filterTable: FilterTable): OwnFilter | null {
  let area = areaOfFilteredTable(workbook, filterTable);
  if (area === null) return null;
  return (
    ownFiltersOfSheet(state, filterTable.table.sheetId).find((ownFilter) => {
      let ownFilterArea = areaOfFilteredTable(workbook, ownFilter);
      return ownFilterArea !== null && areasOverlap(ownFilterArea, area);
    }) ?? null
  );
}
export function openRowsAsk(state: PageState, workbook: ReadsWithTextMeasurer, asked: string | CellAt | null = null): PageState {
  let shownState = refreshStaleOwnFilters(
    {
      ...state,
      ownFilterList: null,
    },
    workbook,
    state.sheetId,
  );
  let rowsAskedFor: RowsAskedFor = {
    table: null,
    placeBefore: rowsAskPlaceOf(shownState),
    placeBeforeAsOf: lookStampOfWorkbook(shownState),
    beforeTry: null,
    placeAfterTry: null,
    isToolOnBar: isSortAndFilterOnBar(
      {
        ...shownState,
        rowsAskedFor: null,
      },
      workbook,
    ),
    isOfFilterBar: false,
    hasTurnedFilterOn: false,
    isFilterNotDrawnYet: false,
    isTableGuessed: false,
    tableUnderLetters: null,
    cameBackFrom: state.ownFilterList?.c ?? null,
    words: '',
    read: null,
    hasStopped: false,
    today: null,
    agent: null,
    askAhead: null,
  };
  let cellAsked =
    typeof asked === 'object' && asked !== null
      ? {
          sheetId: shownState.sheetId,
          rowId: asked.r,
          columnId: asked.c,
        }
      : null;
  let isGuessing = asked === null || asked === GUESS_TABLE_FOR_ROWS_ASK;
  let guessesTable = (cellAsked === null && state.ownFilterList?.isTableGuessed === true) || (isGuessing && isLinesSelection(shownState));
  let columnsTable = guessesTable ? tableToSortOfColumns(shownState, workbook) : null;
  let filterTable =
    cellAsked !== null
      ? (ownFilterAtCell(shownState, workbook, cellAsked) ?? filterTableAroundCell(shownState, workbook, cellAsked))
      : isGuessing
        ? ((columnsTable === null ? null : filterTableAtCell(workbook, columnsTable.at)) ??
          (guessesTable ? ownFilterOverSelection(shownState, workbook) : null) ??
          guessFilterTableOfSelection(shownState, workbook) ??
          ownFilterOverSelection(shownState, workbook))
        : (ownFiltersOfSheet(shownState, shownState.sheetId).find(({ key }) => key === asked) ?? null);
  let found = filterTable === null ? null : (ownFilterOverlappingTable(shownState, workbook, filterTable) ?? filterTable);
  if (found === null)
    return {
      ...shownState,
      rowsAskedFor,
    };
  let withFilter =
    'key' in found ? shownState : keepActiveCellClearOfStuckHeaders(state, addOwnFilterForTable(shownState, workbook, found), workbook);
  let ownFilter = ownFiltersOfSheet(withFilter, found.table.sheetId).find(
    (ownFilterOfSheet) => ownFilterOfSheet === found || ownFilterOfSheet.table === found.table,
  );
  if (ownFilter === undefined)
    return {
      ...shownState,
      rowsAskedFor,
    };
  let ownFilterArea = areaOfFilteredTable(workbook, ownFilter);
  let tableUnderLetters =
    columnsTable !== null && ownFilterArea !== null && isSameArea(ownFilterArea, columnsTable.extent)
      ? {
          table: columnsTable.table,
          columnId: columnsTable.columnId,
        }
      : null;
  let isKeptOnForColumns = withFilter.filterKeptOnForColumnsCard === ownFilter.key;
  let hasTurnedFilterOn = !('key' in found) || isKeptOnForColumns;
  let isFilterNotDrawnYet = isKeptOnForColumns ? state.ownFilterList?.isFilterNotDrawnYet === true : hasTurnedFilterOn && !guessesTable;
  let isOfFilterBar = asked !== null && (isFilterNotDrawnYet || onlyOwnFilterKeyOfSheet(withFilter) === ownFilter.key);
  let table = tableOfRowsAsk(shownState, workbook, ownFilter, isOfFilterBar);
  return {
    ...withFilter,
    filterKeptOnForColumnsCard: isKeptOnForColumns ? null : withFilter.filterKeptOnForColumnsCard,
    rowsAskedFor: {
      ...rowsAskedFor,
      isOfFilterBar,
      hasTurnedFilterOn,
      isFilterNotDrawnYet,
      isTableGuessed: guessesTable,
      tableUnderLetters,
      placeBefore: rowsAskPlaceOf(withFilter),
      table,
    },
  };
}
export function filterBeforeRowsTry({ ownFilters, rowsAskedFor }: Pick<PageState, 'ownFilters' | 'rowsAskedFor'>): Filter | null {
  if (rowsAskedFor === null || rowsAskedFor.table === null) return null;
  if (rowsAskedFor.beforeTry !== null) return rowsAskedFor.beforeTry.held.filter;
  return (
    ownFilterByKey(
      {
        ownFilters,
      },
      rowsAskedFor.table.key,
    )?.filter ?? null
  );
}
export function mergeFilterConditions(filterBefore: Filter, filter: Filter): Filter {
  let columnsAsked = new Set(filter.allOf.map(columnsKeyOfCondition));
  let keptConditions = filterBefore.allOf.filter((line) => !columnsAsked.has(columnsKeyOfCondition(line)));
  return filterOfEntries([...keptConditions, ...filter.allOf]) ?? filter;
}
export function suggestionsBeyondFilter(filter: Filter | null, suggested: readonly SuggestedAsk[]): SuggestedAsk[] {
  let conditions = filter?.allOf ?? [];
  return suggested.flatMap(
    (suggestion) =>
      suggestion.asked.filter?.allOf.every(
        (line) => conditions.some((lineInForce) => areFilterConditionsSame(lineInForce, line)),
      ) === true
        ? []
        : [
            {
              ...suggestion,
              records: null,
            },
          ],
  );
}
export function filterToTryForAsk({ filter, sortBy }: RowsAsked, state: PageState): Filter | null {
  let filterBefore = filterBeforeRowsTry(state);
  if (filter === null) return sortBy.length > 0 ? filterBefore : null;
  let rowsAskedFor = state.rowsAskedFor;
  if (rowsAskedFor?.isOfFilterBar !== true || rowsAskedFor.table === null || filterBefore === null) return filter;
  let merged = mergeFilterConditions(filterBefore, filter);
  let filterNow = ownFilterByKey(state, rowsAskedFor.table.key)?.filter ?? null;
  return [filterBefore, filterNow].find((held) => areFilterConditionsSame(held, merged)) ?? merged;
}
export function restorePlaceBeforeRowsTry(state: PageState, workbook: ReadsWithTextMeasurer, target: PageState = state): PageState {
  let { placeBefore, placeAfterTry = null } = state.rowsAskedFor ?? {};
  if (placeBefore === undefined || placeAfterTry === null) return target;
  if (!(workbook.positionOfCell(placeBefore.activeCell) !== null && workbook.positionOfCell(placeBefore.selectionCorner) !== null)) return target;
  if (state.sheetId !== placeBefore.sheetId)
    return {
      ...target,
      placesLeft: target.placesLeft.map((place, index) => {
        let placeNow = state.placesLeft[index];
        return placeNow?.sheetId === placeAfterTry.sheetId &&
          isSameCell(placeNow.activeCell, placeAfterTry.activeCell) &&
          isSameCell(placeNow.selectionCorner, placeAfterTry.selectionCorner)
          ? {
              ...place,
              ...placeBefore,
            }
          : place;
      }),
    };
  if (!(isSameRowsAskPlace(rowsAskPlaceOf(state), placeAfterTry) || workbook.positionOfCell(placeAfterTry.activeCell) === null)) return target;
  let isScrollUnchanged = state.scrollTop === placeAfterTry.scrollTop;
  let scrollTop = isScrollUnchanged ? placeBefore.scrollTop : target.scrollTop;
  let restored = {
    ...target,
    ...placeBefore,
    scrollTop,
  };
  return !isScrollUnchanged || state.rowsAskedFor?.placeBeforeAsOf === lookStampOfWorkbook(state)
    ? restored
    : scrollToShowSelection(restored, workbook);
}
export function undoRowsTry(state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  let rowsAskedFor = state.rowsAskedFor;
  if (rowsAskedFor === null || rowsAskedFor.table === null) return state;
  if (rowsAskedFor.beforeTry === null && rowsAskedFor.placeAfterTry === null) return state;
  let untried = rowsAskedFor.beforeTry === null ? state : restoreHeldOwnFilter(state, workbook, rowsAskedFor.beforeTry);
  return {
    ...restorePlaceBeforeRowsTry(state, workbook, untried),
    rowsAskedFor: {
      ...rowsAskedFor,
      beforeTry: null,
      placeAfterTry: null,
    },
  };
}
export function scrollToFilterButtonsRow(state: PageState, workbook: ReadsWithTextMeasurer, ownFilter: OwnFilter): PageState {
  let area = areaOfFilteredTable(workbook, ownFilter);
  let activeCellPosition = workbook.positionOfCell(state.activeCell);
  if (area === null || activeCellPosition === null || ownFilter.table.sheetId !== state.sheetId) return state;
  let layout = layoutOfView(state, workbook);
  let isBodyShown = rowPanes(state, layout, state)
    .flatMap((pane) => shownRowIndicesInPane(pane, layout))
    .some((rowIndex) => rowIndex > area.rowIndexOfButtons && rowIndex < area.topRowIndex + area.rowCount);
  let buttonsRowIndex = Math.max(area.rowIndexOfButtons, layout.frozenRowCount);
  let cellAtButtons = workbook.cellIdAt(state.sheetId, buttonsRowIndex, activeCellPosition.columnIndex);
  if (isBodyShown || cellAtButtons === null) return state;
  let { scrollTop } = scrollToShowSelection(
    {
      ...state,
      ...selectionAtCell(cellAtButtons),
    },
    workbook,
  );
  return scrollTop < state.scrollTop
    ? {
        ...state,
        scrollTop,
      }
    : state;
}
export function tryRowsFilter(state: PageState, workbook: ReadsWithTextMeasurer, filter: Filter | null): PageState {
  let rowsAskedFor = state.rowsAskedFor;
  if (rowsAskedFor === null || rowsAskedFor.table === null) return state;
  let ownFilter = ownFilterByKey(state, rowsAskedFor.table.key);
  if (ownFilter === null) return state;
  if (filter === filterBeforeRowsTry(state)) return undoRowsTry(state, workbook);
  if (ownFilter.filter === filter) return state;
  let filtered = applyOwnFilter(restorePlaceBeforeRowsTry(state, workbook), workbook, ownFilter, filter);
  let ownFilterNow = ownFilterByKey(filtered, ownFilter.key);
  if (ownFilterNow === null) return applyOwnFilter(state, workbook, ownFilter, filter);
  if (ownFilterNow.filter !== filter)
    return {
      ...state,
      notice: filtered.notice,
    };
  let scrolled = scrollToFilterButtonsRow(filtered, workbook, ownFilter);
  let beforeTry = rowsAskedFor.beforeTry ?? heldOwnFilterSnapshot(state, ownFilter);
  return {
    ...scrolled,
    rowsAskedFor: {
      ...rowsAskedFor,
      beforeTry,
      placeAfterTry: rowsAskPlaceOf(scrolled),
    },
  };
}
export function tryAskedRows(state: PageState, workbook: ReadsWithTextMeasurer, asked: RowsAsked): PageState {
  let filter = filterToTryForAsk(asked, state);
  let tried = tryRowsFilter(state, workbook, filter);
  let { rowsAskedFor, holdOnRowsFilteredByAgent: hold } = tried;
  if (rowsAskedFor?.agent?.kind !== 'hasRead' || hold?.stands !== 'awaited') return tried;
  let filterOf = (stateOfFilters: PageState) =>
    rowsAskedFor.table === null ? null : (ownFilterByKey(stateOfFilters, rowsAskedFor.table.key)?.filter ?? null);
  if (filterOf(tried) !== filter) return tried;
  let isNewFilter = filter !== filterBeforeRowsTry(state) && filter !== filterOf(state);
  return {
    ...tried,
    holdOnRowsFilteredByAgent: isNewFilter ? asLandedHold(hold) : null,
  };
}
export function areaFromButtonsRow(area: FilteredTableArea): FilteredTableArea {
  let rowIndexOfButtons = area.rowIndexOfButtons;
  return {
    ...area,
    topRowIndex: rowIndexOfButtons,
    rowCount: area.topRowIndex + area.rowCount - rowIndexOfButtons,
  };
}
export function ownFilterAreaFromButtons(workbook: WorkbookReads, ownFilter: OwnFilter): FilteredTableArea | null {
  let area = areaOfFilteredTable(workbook, ownFilter);
  return area === null ? null : areaFromButtonsRow(area);
}
export function takeRowsAsk(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  table: RowsAskTable,
  asked: RowsAsked,
  isWithoutKeyboard: boolean,
  canSort: boolean,
): PageTransition {
  let ownFilter = ownFilterByKey(refreshStaleOwnFilters(state, workbook, state.sheetId), table.key);
  let isColumnInFilter = (columnId: ColumnId) => ownFilter?.columns.some((column) => column.c === columnId) === true;
  if (
    ![
      ...(asked.filter?.allOf ?? []).flatMap(({ anyOf }) => anyOf.flatMap(columnsOfFilterItem)),
      ...asked.sortBy.map(({ c }) => c),
    ].every(isColumnInFilter)
  ) {
    let { words = '', today = null } = state.rowsAskedFor ?? {};
    let tableKey = state.rowsAskedFor?.isOfFilterBar === true ? table.key : null;
    let reopened = openRowsAsk(undoRowsTry(state, workbook), workbook, tableKey);
    let hasTurnedFilterOn = state.rowsAskedFor?.hasTurnedFilterOn === true;
    let isFilterNotDrawnYet = state.rowsAskedFor?.isFilterNotDrawnYet === true;
    let isTableGuessed = state.rowsAskedFor?.isTableGuessed === true;
    let isOfFilterBar = (isFilterNotDrawnYet && tableKey !== null) || reopened.rowsAskedFor?.isOfFilterBar === true;
    let reopenedState =
      reopened.rowsAskedFor === null
        ? reopened
        : {
            ...reopened,
            rowsAskedFor: {
              ...reopened.rowsAskedFor,
              isOfFilterBar,
              hasTurnedFilterOn,
              isFilterNotDrawnYet,
              isTableGuessed,
            },
          };
    return today === null
      ? withNoEffects(reopenedState)
      : actOnRowsAsk(
          reopenedState,
          workbook,
          {
            kind: 'type',
            words,
            today,
          },
          canSort,
        );
  }
  let filter = filterToTryForAsk(asked, state);
  let tried = tryRowsFilter(state, workbook, filter);
  if (ownFilterByKey(tried, table.key)?.filter !== filter) return withNoEffects(tried);
  let shownState = refreshStaleOwnFilters(tried, workbook, tried.sheetId);
  let ownFilterNow = ownFilterByKey(shownState, table.key);
  let closedState = {
    ...shownState,
    contextBarMenu: null,
    rowsAskedFor: null,
  };
  let [firstSort, ...otherSorts] = asked.sortBy;
  if (firstSort !== undefined && ownFilterNow !== null && table.sorts === 'forOneself' && isFilterTableEmpty(ownFilterNow))
    return withNoEffects(sortOwnFilter(closedState, workbook, ownFilterNow, [firstSort, ...otherSorts]));
  let stateAfter = shouldTurnFilterBackOff(state.rowsAskedFor, ownFilterNow)
    ? clearOwnFilters(closedState, workbook, {
        tableKey: table.key,
      })
    : closedState;
  if (firstSort === undefined || ownFilterNow === null) return withNoEffects(stateAfter);
  if (!isFilterTableEmpty(ownFilterNow)) return withNoEffects(tried);
  let tableUnderLetters = state.rowsAskedFor?.tableUnderLetters ?? null;
  if (tableUnderLetters === null) return sortOwnFilterTableForEveryone(stateAfter, workbook, ownFilterNow, asked.sortBy, isWithoutKeyboard);
  let keys = asked.sortBy.map(
    ({ c, direction }) => ({
      columnId: c,
      direction,
    }),
  );
  return sortTableOfColumns(stateAfter, workbook, tableUnderLetters, keys, isWithoutKeyboard);
}
export function reuseHeldFilter(read: WordsReadAsFilter, filters: readonly (Filter | null)[]): WordsReadAsFilter {
  if (read.kind !== 'read') return read;
  let filterText = JSON.stringify(read.asked.filter);
  let sameFilter = filters.find((filter) => JSON.stringify(filter) === filterText);
  return sameFilter === undefined
    ? read
    : {
        ...read,
        asked: {
          ...read.asked,
          filter: sameFilter,
        },
      };
}
export function readRowsAskWords(state: PageState, workbook: WorkbookReads, table: RowsAskTable, words: string, today: string): WordsReadAsFilter {
  let read = readWordsAsFilter(words, table.holds, state.viewerId, {
    today,
    signsOfNumbers: workbook.signsOfNumbers,
    isMonthFirst: workbook.locale === 'en-US',
  });
  let ownFilter = ownFilterByKey(state, table.key);
  return reuseHeldFilter(read, [filterBeforeRowsTry(state), ownFilter?.filter ?? null]);
}
export function rowsAskToTake({ read, table }: Pick<RowsAskedFor, 'read' | 'table'>, canSort: boolean): RowsToTake | null {
  if (read?.kind !== 'read' || table === null) return null;
  let { filter, sortBy } = read.asked;
  if (sortBy.length === 0 || canSortRowsAskTable(table, canSort))
    return {
      asked: read.asked,
      isSortLeftOut: false,
    };
  return filter === null
    ? null
    : {
        asked: {
          filter,
          sortBy: [],
        },
        isSortLeftOut: true,
      };
}
export function doesRowsActionSort({ rowsAskedFor }: Pick<PageState, 'rowsAskedFor'>, action: RowsAskedForAct, canSort: boolean): boolean {
  if (action.kind === 'take') return action.asked.sortBy.length > 0;
  if (action.kind === 'takeNamedView') return true;
  if (action.kind !== 'takeAnswer' || rowsAskedFor === null) return false;
  return (rowsAskToTake(rowsAskedFor, canSort)?.asked.sortBy.length ?? 0) > 0;
}
export function rowsAskPromptInput(state: PageState, workbook: WorkbookReads, { table, today }: RowsAskToTell): [TableToldOfRows, FactsToldOfRows] {
  let ownFilter = ownFilterByKey(state, table.key);
  return [
    {
      columns: table.holds.columns.flatMap((column) => {
        let columnIndex = ownFilter === null ? null : workbook.columnIndexOf(ownFilter.table.sheetId, column.c);
        return columnIndex === null
          ? []
          : [
              {
                letters: columnLetters(columnIndex),
                holds: column,
              },
            ];
      }),
      records: table.holds.records,
    },
    {
      today,
      decimalSign: workbook.decimalSign,
      isMonthFirst: workbook.locale === 'en-US',
    },
  ];
}
export function askAgentAheadWhichRows(state: PageState, workbook: WorkbookReads): PageTransition {
  let rowsAskedFor = state.rowsAskedFor;
  if (rowsAskedFor === null || rowsAskedFor.table === null || rowsAskedFor.today === null) return withNoEffects(state);
  if (rowsAskedFor.askAhead !== null || state.whyAgentIsAskedWhichRowsOnlyAtEnter !== null) return withNoEffects(state);
  let { table, today } = rowsAskedFor;
  let [tableHolds, factsOfTable] = rowsAskPromptInput(state, workbook, {
    table,
    today,
  });
  if (tableHolds.columns.length === 0 || rowsFromWordsPrompt(rowsAskedFor.words, tableHolds, factsOfTable) === null)
    return withNoEffects({
      ...state,
      rowsAskedFor: {
        ...rowsAskedFor,
        askAhead: 'isHeldBack',
      },
    });
  let askId = state.rowsAskedForAskCount + 1;
  return {
    state: {
      ...state,
      rowsAskedForAskCount: askId,
      rowsAskedFor: {
        ...rowsAskedFor,
        askAhead: askId,
      },
    },
    effects: [
      {
        kind: 'askAgentAheadWhichRowsAreAskedFor',
        askId,
        words: ROWS_FROM_WORDS_INSTRUCTIONS,
      },
    ],
  };
}
export function holdBackRowsAskAhead(state: PageState): PageState {
  let rowsAskedFor = state.rowsAskedFor;
  if (rowsAskedFor === null || rowsAskedFor.askAhead === null || rowsAskedFor.askAhead === 'isHeldBack') return state;
  let askAhead: RowsAskAheadStands | null = rowsAskedFor.askAhead === 'hasFailed' ? null : 'isHeldBack';
  return {
    ...state,
    rowsAskedFor: {
      ...rowsAskedFor,
      askAhead,
    },
  };
}
export function askAgentWhichRows(state: PageState, workbook: WorkbookReads, isAtEnter: boolean): PageTransition {
  let rowsAskedFor = state.rowsAskedFor;
  if (rowsAskedFor === null || rowsAskedFor.table === null || rowsAskedFor.today === null) return withNoEffects(state);
  if (!(rowsAskedFor.agent === null || (isAtEnter && rowsAskedFor.agent.kind === 'hasFailed'))) return withNoEffects(state);
  let withAgent = (agent: AgentForRowsAsk | null, askAhead: RowsAskAheadStands | null = null) => ({
    ...state,
    rowsAskedFor: {
      ...rowsAskedFor,
      agent,
      askAhead,
    },
  });
  let whyOnlyAtEnter = isAtEnter ? null : state.whyAgentIsAskedWhichRowsOnlyAtEnter;
  if (whyOnlyAtEnter === 'notToBeHad') return withNoEffects(state);
  if (whyOnlyAtEnter === 'rateLimited' || (!isAtEnter && rowsAskedFor.askAhead === 'hasFailed'))
    return withNoEffects(
      withAgent({
        kind: 'hasFailed',
        askId: state.rowsAskedForAskCount,
        isRateLimited: whyOnlyAtEnter === 'rateLimited',
      }),
    );
  let { table, today, askAhead } = rowsAskedFor;
  let [tableHolds, factsOfTable] = rowsAskPromptInput(state, workbook, {
    table,
    today,
  });
  let { columns } = tableHolds;
  let asked = rowsFromWordsPrompt(rowsAskedFor.words, tableHolds, factsOfTable);
  if (asked === null || columns.length === 0)
    return withNoEffects(
      withAgent(
        {
          kind: 'hasNotRead',
        },
        'isHeldBack',
      ),
    );
  let askedState = (askId: number) => ({
    ...withAgent({
      kind: 'isAsked',
      askId,
      columns,
    }),
    holdOnRowsFilteredByAgent: newAwaitedHold(askId),
  });
  if (typeof askAhead === 'number') {
    let rest = {
      typed: cleanTextForAgent(rowsAskedFor.words),
      data: asked.data,
    };
    return {
      state: askedState(askAhead),
      effects: [
        {
          kind: 'tellAgentWhichRowsAreAskedFor',
          askId: askAhead,
          rest,
        },
      ],
    };
  }
  let askId = state.rowsAskedForAskCount + 1;
  return {
    state: {
      ...askedState(askId),
      rowsAskedForAskCount: askId,
    },
    effects: [
      {
        kind: 'askAgentWhichRowsAreAskedFor',
        askId,
        asked,
        isAtEnter,
      },
    ],
  };
}
export function askIdOfRowsAgentCall({ rowsAskedFor }: Pick<PageState, 'rowsAskedFor'>): number | null {
  if (rowsAskedFor?.agent?.kind === 'isAsked') return rowsAskedFor.agent.askId;
  return typeof rowsAskedFor?.askAhead === 'number' ? rowsAskedFor.askAhead : null;
}
export function takeAgentRowsAnswer(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  askId: number,
  outcome: AgentRepliedWhichRowsAreAskedFor['reply'],
): PageState {
  let rowsAskedFor = state.rowsAskedFor;
  if (rowsAskedFor === null || rowsAskedFor.table === null || rowsAskedFor.today === null) return state;
  let isRateLimited = outcome.kind === 'failed' && outcome.isRateLimited === true;
  if (rowsAskedFor.askAhead === askId) {
    let whyNot: WhyAgentIsNotAskedWhichRows | null = outcome.kind === 'notToBeHad' ? outcome.kind : isRateLimited ? 'rateLimited' : null;
    let isHeldBack = outcome.kind === 'isYetToBeAllowed' || outcome.kind === 'stopped';
    return {
      ...state,
      whyAgentIsAskedWhichRowsOnlyAtEnter: whyNot,
      rowsAskedFor: {
        ...rowsAskedFor,
        askAhead: whyNot !== null ? null : isHeldBack ? 'isHeldBack' : 'hasFailed',
      },
    };
  }
  if (rowsAskedFor.agent?.kind !== 'isAsked' || rowsAskedFor.agent.askId !== askId) return state;
  let withAgent = (agent: AgentForRowsAsk | null, { read: wordsRead = rowsAskedFor.read, whyNot = null }: AgentAnswerKept = {}) => ({
    ...state,
    whyAgentIsAskedWhichRowsOnlyAtEnter: whyNot,
    rowsAskedFor: {
      ...rowsAskedFor,
      agent,
      read: wordsRead,
    },
  });
  if (outcome.kind === 'isYetToBeAllowed') return withAgent(null);
  if (outcome.kind === 'notToBeHad')
    return withAgent(
      {
        kind: 'hasNotRead',
      },
      {
        whyNot: 'notToBeHad',
      },
    );
  if (outcome.kind !== 'answered')
    return withAgent(
      {
        kind: 'hasFailed',
        askId,
        isRateLimited,
      },
      {
        whyNot: isRateLimited ? 'rateLimited' : null,
      },
    );
  let asked = readRowsAnswer(outcome.answer, {
    columns: rowsAskedFor.agent.columns,
    viewer: state.viewerId,
    today: rowsAskedFor.today,
    limits: workbook.limitsOfConditionalFormats(),
  });
  if (asked === null)
    return withAgent({
      kind: 'hasNotRead',
    });
  let ownFilter = ownFilterByKey(state, rowsAskedFor.table.key);
  let read = reuseHeldFilter(
    {
      kind: 'read',
      asked,
    },
    [filterBeforeRowsTry(state), ownFilter?.filter ?? null],
  );
  let hasTried = rowsAskedFor.beforeTry !== null;
  let answeredState = withAgent(
    {
      kind: 'hasRead',
      askId,
    },
    {
      read,
    },
  );
  return read.kind !== 'read' || hasTried ? answeredState : tryAskedRows(answeredState, workbook, read.asked);
}
export function actOnRowsAsk(state: PageState, workbook: ReadsWithTextMeasurer, action: RowsAskedForAct, canSort: boolean): PageTransition {
  let outcome = reduceRowsAsk(state, workbook, action, canSort);
  return askIdOfRowsAgentCall(state) !== null && askIdOfRowsAgentCall(outcome.state) === null
    ? {
        ...outcome,
        effects: [
          ...outcome.effects,
          {
            kind: 'stopAskingAgentWhichRowsAreAskedFor',
          },
        ],
      }
    : outcome;
}
export function reduceRowsAsk(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  action: RowsAskedForAct,
  canSort: boolean,
  isAtEnter: boolean = false,
): PageTransition {
  let rowsAskedFor = state.rowsAskedFor;
  if (action.kind === 'giveUp') {
    let contextBarMenu = state.contextBarMenu === 'sort' ? null : state.contextBarMenu;
    let givenUpState = {
      ...undoRowsTry(state, workbook),
      contextBarMenu,
      rowsAskedFor: null,
    };
    const tableKey = rowsAskedFor?.table?.key;
    const turnsFilterOff =
      action.leavesFilterOn !== true && tableKey !== undefined && shouldTurnFilterBackOff(rowsAskedFor, ownFilterByKey(givenUpState, tableKey));
    return withNoEffects(
      turnsFilterOff
        ? clearOwnFilters(givenUpState, workbook, {
            tableKey,
          })
        : givenUpState,
    );
  }
  if (action.kind === 'customSort') {
    let ownFilter = rowsAskedFor?.isOfFilterBar === true && rowsAskedFor.table !== null ? ownFilterByKey(state, rowsAskedFor.table.key) : null;
    let areaFromButtons = ownFilter === null ? null : ownFilterAreaFromButtons(workbook, ownFilter);
    let givenUpState = reduceRowsAsk(
      state,
      workbook,
      {
        kind: 'giveUp',
      },
      canSort,
    ).state;
    return withNoEffects(openSortPane(givenUpState, workbook, action.of, areaFromButtons));
  }
  if (rowsAskedFor === null || rowsAskedFor.table === null) return withNoEffects(state);
  switch (action.kind) {
    case 'type': {
      if (action.words === rowsAskedFor.words && action.today === rowsAskedFor.today) return withNoEffects(state);
      let ownFilter = ownFilterByKey(state, rowsAskedFor.table.key);
      let table =
        !rowsAskedFor.table.isRead && rowsAskedFor.words === '' && ownFilter !== null
          ? tableOfRowsAsk(state, workbook, ownFilter, rowsAskedFor.isOfFilterBar)
          : rowsAskedFor.table;
      let read = action.words.trim() === '' ? null : readRowsAskWords(state, workbook, table, action.words, action.today);
      let { words, today } = action;
      let typedState = {
        ...state,
        rowsAskedFor: {
          ...rowsAskedFor,
          table,
          words,
          today,
          read,
          hasStopped: false,
          agent: null,
        },
      };
      if (read?.kind === 'read') return withNoEffects(tryRowsFilter(typedState, workbook, filterToTryForAsk(read.asked, typedState)));
      let shownState =
        read?.isOnItsWay === true && action.words.startsWith(rowsAskedFor.words) ? typedState : undoRowsTry(typedState, workbook);
      return read?.kind === 'notRead' && read.wordsNotPlaced.length > 0 && !read.isOnItsWay
        ? askAgentAheadWhichRows(shownState, workbook)
        : withNoEffects(shownState);
    }
    case 'rest': {
      if (rowsAskedFor.read?.kind !== 'notRead') return withNoEffects(holdBackRowsAskAhead(state));
      let stoppedState = {
        ...state,
        rowsAskedFor: {
          ...rowsAskedFor,
          hasStopped: true,
        },
      };
      let read =
        rowsAskedFor.today === null ? null : readRowsAskWords(state, workbook, rowsAskedFor.table, `${rowsAskedFor.words} `, rowsAskedFor.today);
      if (action.isRowPointedAt && read?.kind === 'read') return withNoEffects(holdBackRowsAskAhead(stoppedState));
      if (read?.kind !== 'read') {
        let shownState = action.isRowPointedAt ? stoppedState : undoRowsTry(stoppedState, workbook);
        return action.isColumnFound === true ? withNoEffects(holdBackRowsAskAhead(shownState)) : askAgentWhichRows(shownState, workbook, isAtEnter);
      }
      let readState = holdBackRowsAskAhead({
        ...state,
        rowsAskedFor: {
          ...rowsAskedFor,
          read,
        },
      });
      return withNoEffects(tryRowsFilter(readState, workbook, filterToTryForAsk(read.asked, readState)));
    }
    case 'pointAt': {
      if (action.asked !== null) return withNoEffects(tryRowsFilter(state, workbook, filterToTryForAsk(action.asked, state)));
      return withNoEffects(
        rowsAskedFor.read?.kind === 'read' ? tryAskedRows(state, workbook, rowsAskedFor.read.asked) : undoRowsTry(state, workbook),
      );
    }
    case 'take':
      return takeRowsAsk(state, workbook, rowsAskedFor.table, action.asked, action.isWithNoKeyboard === true, canSort);
    case 'takeNamedView': {
      let { key: tableKey } = rowsAskedFor.table;
      let { picked, told } = pickNamedView(undoRowsTry(state, workbook), workbook, tableKey, action.namedViewId);
      if (picked === null) return withNoEffects(told);
      let stateAfter = {
        ...picked,
        contextBarMenu: null,
        rowsAskedFor: null,
      };
      let ownFilter = ownFilterByKey(stateAfter, tableKey);
      if (shouldTurnFilterBackOff(rowsAskedFor, ownFilter))
        return withNoEffects(
          clearOwnFilters(stateAfter, workbook, {
            tableKey,
          }),
        );
      return withNoEffects(ownFilter === null ? stateAfter : scrollToFilterButtonsRow(stateAfter, workbook, ownFilter));
    }
    case 'takeAnswer': {
      let agentDone = rowsAskedFor.agent?.kind === 'hasRead' || rowsAskedFor.agent?.kind === 'hasFailed' ? rowsAskedFor.agent : null;
      if (agentDone !== null && action.askOnShow !== agentDone.askId) return withNoEffects(state);
      if (agentDone?.kind === 'hasFailed') return askAgentWhichRows(state, workbook, true);
      let rested = reduceRowsAsk(
        state,
        workbook,
        {
          kind: 'rest',
          isRowPointedAt: false,
        },
        canSort,
        true,
      );
      if (rested.state.rowsAskedFor?.agent !== rowsAskedFor.agent) return rested;
      let restedState = rested.state;
      let toTake = restedState.rowsAskedFor === null ? null : rowsAskToTake(restedState.rowsAskedFor, canSort);
      let isReadAgain = restedState.rowsAskedFor?.read !== rowsAskedFor.read;
      if (toTake === null || (isReadAgain && toTake.asked.sortBy.length > 0)) {
        let askAhead = restedState.rowsAskedFor?.askAhead ?? null;
        return withNoEffects({
          ...state,
          rowsAskedFor: {
            ...rowsAskedFor,
            hasStopped: true,
            askAhead,
          },
        });
      }
      return takeRowsAsk(restedState, workbook, rowsAskedFor.table, toTake.asked, action.isWithNoKeyboard === true, canSort);
    }
  }
}
export function dropUnneededAgentRowsHold(state: PageState): PageState {
  let { rowsAskedFor, holdOnRowsFilteredByAgent: hold } = state;
  if (hold === null) return state;
  let agent = rowsAskedFor?.agent ?? null;
  let isAgentAtWork = agent?.kind === 'isAsked' || agent?.kind === 'hasRead';
  let isLandedAndHeld = rowsAskedFor === null && hold.stands === 'landed' && hold.actsHeld > 0;
  return isAgentAtWork || isLandedAndHeld
    ? state
    : {
        ...state,
        holdOnRowsFilteredByAgent: null,
      };
}
export function settlePlaceAfterRowsTry(before: Pick<PageState, 'rowsAskedFor'>, state: PageState, dropsPlaceAfterTry: boolean): PageState {
  let rowsAskedFor = state.rowsAskedFor;
  if (rowsAskedFor === null || rowsAskedFor.placeAfterTry === null) return state;
  if (dropsPlaceAfterTry)
    return {
      ...state,
      rowsAskedFor: {
        ...rowsAskedFor,
        placeAfterTry: null,
      },
    };
  return rowsAskedFor.placeAfterTry !== (before.rowsAskedFor?.placeAfterTry ?? null)
    ? {
        ...state,
        rowsAskedFor: {
          ...rowsAskedFor,
          placeAfterTry: rowsAskPlaceOf(state),
        },
      }
    : state;
}
export function shouldEndRowsAsk(state: PageState): boolean {
  let rowsAskedFor = state.rowsAskedFor;
  if (rowsAskedFor === null) return false;
  let isTableGone = rowsAskedFor.table !== null && ownFilterByKey(state, rowsAskedFor.table.key) === null;
  return state.contextBarMenu !== 'sort' || isTableGone;
}
export function onlyOwnFilterKeyOfSheet(state: PageState): string | null {
  let [onlyFilter, ...otherFilters] = drawnOwnFiltersOfSheet(state, state.sheetId);
  return onlyFilter === undefined || otherFilters.length > 0 ? null : onlyFilter.key;
}
export function drawnRowsAsk(state: PageState, workbook: WorkbookReads, canSort: boolean): SortFilterCard | null {
  const rowsAskedFor: Readonly<RowsAskedFor> | null = state.contextBarMenu === 'sort' ? state.rowsAskedFor : null;
  if (rowsAskedFor === null) return null;
  let ownFilter = rowsAskedFor.table === null ? null : ownFilterByKey(state, rowsAskedFor.table.key);
  let { isOfFilterBar, isFilterNotDrawnYet } = rowsAskedFor;
  if (rowsAskedFor.table === null || ownFilter === null)
    return {
      isOfFilterBar,
      isFilterNotDrawnYet,
      hasTable: false,
      ...DRAWN_ROWS_ASK_WITHOUT_TABLE,
    };
  const { table, read } = rowsAskedFor;
  let filterBefore = filterBeforeRowsTry(state);
  let columnsAsked = new Set(
    (filterBefore?.allOf ?? []).flatMap(({ anyOf }) => anyOf.flatMap(columnsOfFilterItem)),
  );
  let canSortHere = canSortRowsAskTable(table, canSort);
  let usesColumnAtCell = canSortHere && !rowsAskedFor.isTableGuessed;
  let columnUnderLetters = canSortHere ? (rowsAskedFor.tableUnderLetters?.columnId ?? null) : null;
  let sortColumn = usesColumnAtCell
    ? table.columnAtCell
    : ownFilter.columns.some((column) => column.c === columnUnderLetters)
      ? columnUnderLetters
      : null;
  const toTake = rowsAskToTake(rowsAskedFor, canSort);
  const isTaken = toTake !== null && ownFilter.filter === filterToTryForAsk(toTake.asked, state);
  let isSortLeftOut = read?.kind === 'read' && read.asked.sortBy.length > 0 && !canSortHere;
  let isAgentAsked = rowsAskedFor.agent?.kind === 'isAsked';
  const hasAgentFailed = rowsAskedFor.agent?.kind === 'hasFailed';
  const areWordsNotRead = read?.kind === 'notRead' && rowsAskedFor.hasStopped && !isAgentAsked && !hasAgentFailed;
  return {
    isOfFilterBar,
    isFilterNotDrawnYet,
    isFilterTried: rowsAskedFor.beforeTry !== null,
    tableKey: ownFilter.key,
    columnCameBackFrom: rowsAskedFor.cameBackFrom,
    columns: !isOfFilterBar
      ? []
      : ownFilter.columns.map(
          (column) => ({
            c: column.c,
            column: columnLabelOfFilterTable(workbook, ownFilter, column.c),
            isAsked: columnsAsked.has(column.c),
          }),
        ),
    hasTable: true,
    namedViews: namedViewsOfOwnFilter(workbook, ownFilter) ?? [],
    areSortsForOneself: table.sorts === 'forOneself',
    sortsOfColumn:
      sortColumn === null
        ? []
        : SORT_DIRECTIONS.map((direction) => {
            let { column, holds } = saidOfSortColumn(workbook, ownFilter, {
              c: sortColumn,
              direction,
            });
            return {
              column,
              direction,
              holds,
              asked: {
                filter: null,
                sortBy: [
                  {
                    c: sortColumn,
                    direction,
                  },
                ],
              },
            };
          }),
    suggested: (usesColumnAtCell ? table.suggested : suggestionsWithoutSort(table.suggested)).filter(
      (suggestion) => suggestion.asked.filter !== null || suggestion.asked.sortBy[0]?.c !== sortColumn,
    ),
    answer: !isTaken
      ? null
      : {
          asked: toTake.asked,
          lines: toTake.asked.filter === null ? [] : isOfFilterBar ? ownFilter.lines.slice(-toTake.asked.filter.allOf.length) : ownFilter.lines,
          sortBy: toTake.asked.sortBy.map((key) => saidOfSortColumn(workbook, ownFilter, key)),
          records: recordCountsOfOwnFilter(state, workbook, ownFilter)?.inView ?? null,
        },
    sortLeftOutBecause: !isSortLeftOut
      ? null
      : !canSort && table.sorts !== null
        ? 'cannotEdit'
        : ownFilter.table.runs.some(({ role }) => role !== 'spacer')
          ? 'hasSections'
          : {
              blankRows: table.rowsThatAreNoRecords,
            },
    isAgentAsked,
    askThatAnswered: hasAgentFailed || (rowsAskedFor.agent?.kind === 'hasRead' && isTaken) ? rowsAskedFor.agent.askId : null,
    callToAgent: !hasAgentFailed ? null : rowsAskedFor.agent.isRateLimited ? 'rateLimited' : 'failed',
    areWordsNotRead,
    wordsNotKnown: areWordsNotRead ? read.wordsNotKnown : [],
  };
}
export function ownFiltersBeforeRowsTry({ ownFilters, rowsAskedFor }: Pick<PageState, 'ownFilters' | 'rowsAskedFor'>): Map<SheetId, OwnFilter[]> {
  let beforeTry = rowsAskedFor?.beforeTry ?? null;
  if (beforeTry === null) return ownFilters;
  let { key: heldKey, filter: heldFilter } = beforeTry.held;
  let cached = ownFiltersKeptCache.get(beforeTry);
  if (cached?.of === ownFilters) return cached.kept;
  let kept = new Map<SheetId, OwnFilter[]>(
    Array.from<[SheetId, OwnFilter[]], [SheetId, OwnFilter[]]>(
      ownFilters,
      ([sheetId, filtersOfSheet]) => [
        sheetId,
        filtersOfSheet.map((ownFilter) => (ownFilter.key === heldKey ? ownFilterWithFilter(ownFilter, heldFilter) : ownFilter)),
      ],
    ),
  );
  ownFiltersKeptCache.set(beforeTry, {
    of: ownFilters,
    kept,
  });
  return kept;
}
export const GUESS_TABLE_FOR_ROWS_ASK = '';
export const rowsAskPlaceOf = ({
  sheetId,
  activeCell,
  selectionCorner,
  otherRanges,
  rangeWalked,
  scrollTop,
}: SelectionPlace): SelectionPlace => ({
  sheetId,
  activeCell,
  selectionCorner,
  otherRanges,
  rangeWalked,
  scrollTop,
});
export const isSameRowsAskPlace = (place: SelectionPlace, otherPlace: SelectionPlace): boolean =>
  place.sheetId === otherPlace.sheetId &&
  isSameCell(place.activeCell, otherPlace.activeCell) &&
  isSameCell(place.selectionCorner, otherPlace.selectionCorner) &&
  place.otherRanges === otherPlace.otherRanges;
export const filterAreasOfSheet = (state: PageState, workbook: ReadsWithTextMeasurer): CellArea[] => [
  ...ownFiltersOfSheet(state, state.sheetId).flatMap((ownFilter) => areaOfFilteredTable(workbook, ownFilter) ?? []),
  ...tablesInSightOf(state, workbook).map(({ area }) => area),
];
export const MAX_TABLE_GUESS_STEPS = 5;
export const suggestionsWithoutSort = (suggested: readonly SuggestedAsk[]): SuggestedAsk[] =>
  suggested.filter(({ asked }) => asked.sortBy.length === 0);
export const isLinesSelection = ({ selectionSeen: { shape } }: Pick<PageState, 'selectionSeen'>): boolean => shape === 'columns' || shape === 'rows';
export const areFilterConditionsSame = <Compared>(one: Compared, other: Compared): boolean => JSON.stringify(one) === JSON.stringify(other);
export const columnsKeyOfCondition = ({ anyOf }: FilterLine): string =>
  [...new Set(anyOf.flatMap(columnsOfFilterItem))].toSorted().join(' ');
export const canSortRowsAskTable = ({ sorts }: Pick<RowsAskTable, 'sorts'>, canSort: boolean): boolean =>
  sorts === 'forOneself' || (sorts === 'forEveryone' && canSort);
export const isRowsAskOfFilterBar = ({ isOfFilterBar, isFilterNotDrawnYet }: Pick<RowsAskedFor, 'isOfFilterBar' | 'isFilterNotDrawnYet'>): boolean =>
  isOfFilterBar || isFilterNotDrawnYet;
export const shouldTurnFilterBackOff = (rowsAskedFor: RowsAskedFor | null, ownFilter: OwnFilter | null): boolean =>
  rowsAskedFor?.hasTurnedFilterOn === true && isRowsAskOfFilterBar(rowsAskedFor) && (ownFilter === null || isOwnFilterUnused(ownFilter));
export const tableKeyOfFilterBarTurnedOn = ({ rowsAskedFor }: Pick<PageState, 'rowsAskedFor'>): string | null =>
  rowsAskedFor?.hasTurnedFilterOn === true && isRowsAskOfFilterBar(rowsAskedFor) ? (rowsAskedFor.table?.key ?? null) : null;
export const isOwnFilterHeldForTry = ({ rowsAskedFor }: Pick<PageState, 'rowsAskedFor'>, key: string): boolean =>
  rowsAskedFor?.beforeTry?.held.key === key;
export const hasRowsAskEndedWhereBegun = (before: Pick<PageState, 'rowsAskedFor'>, state: PageState): boolean =>
  before.rowsAskedFor !== null && state.rowsAskedFor === null && isSameRowsAskPlace(rowsAskPlaceOf(state), before.rowsAskedFor.placeBefore);
export const SORT_DIRECTIONS: SortDirection[] = ['ascending', 'descending'];
export const DRAWN_ROWS_ASK_WITHOUT_TABLE: Omit<SortFilterCard, 'isOfFilterBar' | 'isFilterNotDrawnYet' | 'hasTable'> = {
  isFilterTried: false,
  tableKey: null,
  columnCameBackFrom: null,
  columns: [],
  namedViews: [],
  areSortsForOneself: false,
  sortsOfColumn: [],
  suggested: [],
  answer: null,
  sortLeftOutBecause: null,
  isAgentAsked: false,
  askThatAnswered: null,
  callToAgent: null,
  areWordsNotRead: false,
  wordsNotKnown: [],
};
export const ownFilterWithFilter = (ownFilter: OwnFilter, filter: Filter | null): OwnFilter => ({
  ...ownFilter,
  filter,
});
export const ownFiltersKeptCache = new WeakMap<HeldOwnFilterSnapshot, OwnFiltersKept>();
