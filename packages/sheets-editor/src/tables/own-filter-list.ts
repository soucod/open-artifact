import type {
  Asked,
  CellCondition,
  ColumnId,
  Filter,
  KindOfAColumn,
  RowId,
  SortDirection,
  ValueAskedFor,
  ValueContents,
} from '@open-artifact/sheets-core';
import { clampBetween, rowRunSpanOnScreen, isInSpan } from '../grid/geometry.ts';
import {
  ownFilterByKey,
  isFilterTableEmpty,
  refreshStaleOwnFilters,
  sortOwnFilter,
  filterOnKnownColumns,
  isOwnFilterKeyUnused,
  isOwnFilterSortable,
  applyOwnFilter,
  recordCountsOfOwnFilter,
  columnLabelOfFilterTable,
} from './own-filters.ts';
import { layoutOfView } from '../grid/layout.ts';
import { filterButtonRowIndex, columnSpanOfIdFinder, stuckHeaderAt, rowSpanInStuckHeader, tablesWithFilterButtons } from './table-drawing.ts';
import { stuckHeadersOfView } from '../grid/sticky-headers.ts';
import { ROW_HEADER_WIDTH } from '../grid/cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT } from '../grid/cell-metrics.ts';
import { mergedAreaOrCellOf, selectionOfArea, selectionAtCell, isSameArea } from '../selection/model.ts';
import { areaOfFilteredTable } from './finding.ts';
import { ownFilterRecordsArea, filterValueOfCell, clearOwnFilters, removeOwnFilterLine } from './own-filter-actions.ts';
import { shownPiecesOfArea } from './filtered-rows.ts';
import { rangeSortArea, rangeSortWideningChoice, sortRange, sortHoldsOfColumn } from './sort.ts';
import { withNoEffects, sortColumnOfMenu, clearPassingNotice } from '../state/transitions.ts';
import { recordsSortableAsCells } from './table-to-sort.ts';
import { sortMovesWholeRows, sortTableWithKeys, sortOfSidePane, withSortPaneAskedForEveryone } from './sort-pane.ts';
import { openMenuWith } from '../ui/menu.ts';
import { readsAsStored } from '../model/workbook.ts';
import { withDecimalSign } from '../format/number-signs.ts';
import { isShownCheckboxCell } from '../chips/checkboxes.ts';
import { cachedOptionChipColors } from '../format/cell-colors.ts';
import {
  filterForColumnValues,
  filterReplacingColumn,
  conditionFilterOfColumn,
  MAX_FILTER_CONDITIONS,
  withConditionFilter,
  valueFiltersOfColumn,
  withValueFilter,
  mixedEntryIndexesOfColumn,
} from './filter-model.ts';
import { cellShownText } from '../clipboard/text-escaping.ts';
import { dueDatePresetCondition } from '../model/date-serials.ts';
import { suggestedAsksOf, isDoneStatus } from '../words/suggested-asks.ts';
import { columnHoldsOf } from '../words/table-holds.ts';
import {
  isConditionEditableAsChoice,
  filterChoiceFromCondition,
  conditionFromFilterChoice,
  inputsOfFilterChoice,
  isFilterInputInvalid,
} from './own-filter-conditions.ts';
import { operatorsForColumnKind } from '../format/conditional/conditions.ts';
import { undoOwnFilterTry, tryOwnFilter } from './own-filter-tries.ts';
import { readWordsAsFilter } from '../words/read-filter.ts';
import { isColumnOfFewValues } from '../words/column-names.ts';
import { numberTypedFor } from '../format/conditional/editor-edits.ts';
import type {
  ColumnHolds,
  FilterValueDrawn,
  Menu,
  OwnFilterCondition,
  OwnFilterConditionHeld,
  OwnFilterList,
  OwnFilterListSort,
  OwnFilterValues,
  PageState,
  ReadyFilter,
  ReadyFilterWhat,
} from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { ShownStretch, StartAndEnd } from '../grid/geometry.ts';
import type { FilteredTableArea } from './finding.ts';
import type { OwnFilter, RecordCountsOfFilter, SaidOfFilterItem, TableToFilter } from './own-filters.ts';
import type { FilterButtonAt } from './table-drawing.ts';
import type { ConditionJoin } from './filter-model.ts';
import type { FilterChoiceHeld, FilterInputKind, FilterInputLimits } from './own-filter-conditions.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { OwnFilterListAct, PageEvent, SortKeyOfColumn } from '../state/event-reducer.ts';
import type { DueDatePreset } from '../model/date-serials.ts';
import type { RuleColumn, RuleTest } from '../messages/conditional-format.ts';
/** Where the own filter list hangs from: the header cell of its column, in the grid's frame. */
export interface OwnFilterListAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** The filter button in the cell the selection is at: its table and column, and the header row it is on. */
export interface FilterButtonAtCell extends FilterButtonAt {
  r: RowId;
  isOfFoundTable: boolean;
}
/** The records of an own filter that a sort can take in, with the page selecting them. */
export interface SortableRecordsOfOwnFilter {
  selected: PageState;
  table: FilteredTableArea;
  records: FilteredTableArea;
}
/** A filter offered ready-made for a kind of column: what it is, and the condition it asks for. */
export type QuickFilterOfColumn = [what: ReadyFilterWhat, condition: CellCondition];
/** What the words typed in the own filter list ask for, and whether the agent is still reading them. */
export interface FilterListWordsRead {
  asked: Asked | null;
  isOnItsWay: boolean;
  isRead: boolean;
}
/** A condition of the own filter list as it is drawn. */
export interface OwnFilterConditionDrawn {
  key: number;
  held: OwnFilterConditionHeld;
  fields: FilterInputKind[];
  isMistyped: boolean[];
  said: RuleTest | null;
}
/** A line of the filter beside the column's own conditions and values. */
export interface OtherFilterLineDrawn {
  lineIndex: number;
  line: SaidOfFilterItem[];
}
/** The own filter list of a column, as it is drawn. */
export interface OwnFilterListDrawn {
  tableKey: string;
  c: ColumnId;
  join: ConditionJoin;
  choices: OwnFilterList['choices'];
  isOfDays: boolean;
  mostCounted: number;
  sort: OwnFilterListSort | null;
  canSortNow: boolean;
  areWordsOnTheirWay: boolean;
  conditions: OwnFilterConditionDrawn[];
  answer: { line: SaidOfFilterItem[]; records: number | null } | null;
  ready: Pick<ReadyFilter, 'what' | 'label' | 'records'>[];
  otherLines: OtherFilterLineDrawn[];
  records: RecordCountsOfFilter | null;
  isOnTrial: boolean;
  column: RuleColumn;
  values: FilterValueDrawn[] | null;
  areMoreLeftOut: boolean;
  ticked: 'all' | 'some' | 'none';
}
/** The family of conditions a kind of column is filtered by, `null` when it has none. */
export type ConditionFamily = 'numbers' | 'days' | 'text' | null;
export function clampSpanToShown({ start, end, showFrom, showTo }: StartAndEnd & ShownStretch): [from: number, length: number] {
  const from = clampBetween(start, showFrom, showTo);
  return [from, clampBetween(end, from, showTo) - from];
}
export function ownFilterListAnchor(view: PageState, reads: ReadsWithTextMeasurer): OwnFilterListAnchor | null {
  let ownFilterList = view.ownFilterList;
  let ownFilter = ownFilterList === null ? null : ownFilterByKey(view, ownFilterList.tableKey);
  if (ownFilterList === null || ownFilter === null) return null;
  let layout = layoutOfView(view, reads);
  let rowIndex = filterButtonRowIndex(reads, ownFilter, layout);
  let column = columnSpanOfIdFinder(view, reads, layout)(ownFilterList.c);
  if (rowIndex === null || column === null) return null;
  let stuckHeader = stuckHeaderAt(stuckHeadersOfView(view, reads, layout), rowIndex, column.columnIndex);
  let rowSpan =
    stuckHeader === undefined
      ? rowRunSpanOnScreen(
          {
            firstIndex: rowIndex,
            count: 1,
          },
          view,
          layout,
          view,
        )
      : rowSpanInStuckHeader(stuckHeader, rowIndex, layout);
  let [[x, width], [y, height]] = [clampSpanToShown(column.across), clampSpanToShown(rowSpan)];
  return {
    x: ROW_HEADER_WIDTH + x,
    y: COLUMN_HEADER_HEIGHT + y,
    width,
    height,
  };
}
export function filterButtonAtActiveCell(view: PageState, reads: ReadsWithTextMeasurer, activeCell: CellId): FilterButtonAtCell | null {
  let cellArea = mergedAreaOrCellOf(reads, activeCell);
  if (cellArea === null || activeCell.sheetId !== view.sheetId) return null;
  for (let table of tablesWithFilterButtons(view, reads)) {
    let { rowIndex, table: tableInIds } = table;
    let isInHeaderRow = rowIndex >= cellArea.topRowIndex && rowIndex < cellArea.topRowIndex + cellArea.rowCount;
    let columnsToMatch = table.columnsOfFound === undefined ? 1 : cellArea.columnCount;
    let match = table.columns.find(
      ({ c: columnId }) => isInSpan(reads.columnIndexOf(view.sheetId, columnId) ?? -1, cellArea.leftColumnIndex, columnsToMatch),
    );
    if (isInHeaderRow && match !== undefined)
      return {
        tableKey: table.key,
        r: tableInIds.header.lastRow,
        c: match.c,
        isOfFoundTable: table.columnsOfFound !== undefined,
      };
  }
  return null;
}
export function sortableRecordsOfOwnFilter(
  view: PageState,
  reads: ReadsWithTextMeasurer,
  ownFilter: OwnFilter,
): SortableRecordsOfOwnFilter | null {
  let [tableArea, recordsArea] = [areaOfFilteredTable(reads, ownFilter), ownFilterRecordsArea(reads, ownFilter)];
  if (tableArea === null || recordsArea === null || !isFilterTableEmpty(ownFilter)) return null;
  let selection = selectionOfArea(view, reads, recordsArea);
  let [firstPiece] = shownPiecesOfArea(view, reads, recordsArea);
  if (selection === null || firstPiece === undefined) return null;
  let cellId = reads.cellIdAt(view.sheetId, firstPiece.topRowIndex, firstPiece.leftColumnIndex);
  if (cellId === null) return null;
  let rangeWalked = {
    from: selection.activeCell,
    to: selection.selectionCorner,
    at: cellId,
  };
  let selected: PageState = {
    ...view,
    ...selectionAtCell(cellId),
    rangeWalked,
    otherRanges: [],
  };
  let sortArea = rangeSortArea(selected, reads);
  return sortArea !== null && isSameArea(sortArea, recordsArea)
    ? {
        selected,
        table: tableArea,
        records: recordsArea,
      }
    : null;
}
export function sortFromOwnFilterList(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  direction: SortDirection,
  isWithoutKeyboard: boolean,
): PageTransition {
  let ownFilterList = state.ownFilterList;
  let view = refreshStaleOwnFilters(state, reads, state.sheetId);
  let ownFilter = ownFilterList === null ? null : ownFilterByKey(view, ownFilterList.tableKey);
  if (ownFilterList?.sort?.isForOneself === true) {
    let closed = {
      ...view,
      ownFilterList: null,
      lastDone: null,
      notice: null,
    };
    return withNoEffects(
      ownFilter === null
        ? closed
        : sortOwnFilter(closed, reads, ownFilter, [
            {
              c: ownFilterList.c,
              direction,
            },
          ]),
    );
  }
  let sortable = ownFilter === null ? null : sortableRecordsOfOwnFilter(view, reads, ownFilter);
  let anchor = ownFilterListAnchor(view, reads);
  if (ownFilterList === null || ownFilterList.sort === null || sortable === null || anchor === null) return withNoEffects(state);
  let nextState = {
    ...sortable.selected,
    ownFilterList: null,
    lastDone: null,
    notice: null,
  };
  let { table, records } = sortable;
  let cellsToSort = recordsSortableAsCells(nextState, reads, {
    table,
    records,
  });
  if (
    (cellsToSort !== null || sortMovesWholeRows(reads, nextState.sheetId, records)) &&
    reads.mergedAreasIn(nextState.sheetId, records).length === 0
  ) {
    let sortColumns = [
      {
        columnId: ownFilterList.c,
        direction,
      },
    ];
    let cellsOfSort =
      cellsToSort === null
        ? {
            cells: records,
            hasHeaderRow: false,
          }
        : {
            cells: cellsToSort,
            hasHeaderRow: false,
            movesWholeRows: true,
          };
    let sorted = sortTableWithKeys(
      {
        ...nextState,
        rangeWalked: null,
      },
      reads,
      cellsOfSort,
      sortColumns,
      isWithoutKeyboard,
    );
    if (sortOfSidePane(sorted.state) === sortOfSidePane(nextState)) return sorted;
  }
  let sortMenu: Menu = {
    at: {
      x: anchor.x,
      y: anchor.y + anchor.height,
    },
    side: null,
    isAskedByKey: false,
    holds: 'all',
    sortColumnsPointedAt: {
      range: ownFilterList.c,
      sheet: null,
    },
  };
  const change = direction === 'ascending' ? 'sortRangeAscending' : 'sortRangeDescending';
  let wideningChoice = rangeSortWideningChoice(nextState, reads);
  return wideningChoice === null
    ? sortRange(nextState, reads, change, 'selection', sortColumnOfMenu(sortMenu, 'range'), isWithoutKeyboard)
    : withNoEffects(
        openMenuWith(nextState, reads, sortMenu, {
          holds: 'cellsToSort',
          cellsToSort: {
            change,
            ...wideningChoice,
          },
        }),
      );
}
export function sortOwnFilterTableForEveryone(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  ownFilter: OwnFilter,
  by: SortKeyOfColumn[],
  isWithoutKeyboard: boolean,
): PageTransition {
  let [tableArea, recordsArea] = [areaOfFilteredTable(reads, ownFilter), ownFilterRecordsArea(reads, ownFilter)];
  if (tableArea === null || recordsArea === null) return withNoEffects(state);
  let keys = by.map(
    ({ c: columnId, direction }) => ({
      columnId,
      direction,
    }),
  );
  let withHeader = {
    ...recordsArea,
    topRowIndex: recordsArea.topRowIndex - 1,
    rowCount: recordsArea.rowCount + 1,
  };
  let cellsToSort = recordsSortableAsCells(state, readsAsStored(reads), {
    table: tableArea,
    records: recordsArea,
  });
  if (cellsToSort !== null) {
    let { leftColumnIndex, columnCount } = cellsToSort;
    let sortCells = {
      cells: {
        ...withHeader,
        leftColumnIndex,
        columnCount,
      },
      hasHeaderRow: true,
      movesWholeRows: true,
    };
    let sorted = sortTableWithKeys(state, reads, sortCells, keys, isWithoutKeyboard);
    if (sortOfSidePane(sorted.state) === sortOfSidePane(state)) return sorted;
  }
  return sortTableWithKeys(
    state,
    reads,
    {
      cells: withHeader,
      hasHeaderRow: true,
    },
    keys,
    isWithoutKeyboard,
  );
}
export function makeOwnSortForEveryone(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  tableKey: string,
  isWithoutKeyboard: boolean,
): PageTransition {
  let view = refreshStaleOwnFilters(state, reads, state.sheetId);
  let ownFilter = ownFilterByKey(view, tableKey);
  if (ownFilter === null || ownFilter.sort === null || !isFilterTableEmpty(ownFilter)) return withNoEffects(view);
  let sorted = sortOwnFilterTableForEveryone(view, reads, ownFilter, ownFilter.sort.by, isWithoutKeyboard);
  return sortOfSidePane(sorted.state) === sortOfSidePane(view)
    ? sorted
    : {
        ...sorted,
        state: withSortPaneAskedForEveryone(sorted.state),
      };
}
export function operandTextOfNumber(reads: Pick<WorkbookReads, 'decimalSign'>, number: number, numberKind: KindOfAColumn): string {
  const text = numberKind === 'percent' ? `${Number((number * 100).toPrecision(15))}%` : String(number);
  return withDecimalSign(text, reads.decimalSign);
}
export function withDrawnFilterValues(
  reads: WorkbookReads,
  { table: { sheetId } }: Pick<OwnFilter, 'table'>,
  columnId: ColumnId,
  listState: Omit<OwnFilterValues, 'drawn'>,
): OwnFilterValues {
  return {
    ...listState,
    drawn: listState.found.slice(0, MAX_LISTED_FILTER_VALUES).flatMap((index) => {
      const listed = listState.listed[index];
      if (listed === undefined) return [];
      let cell: CellId = {
        sheetId,
        rowId: listed.firstInRow,
        columnId,
      };
      let cellOnShow = reads.cellOnShowIn(cell);
      let dropdownOption = cellOnShow !== null && 'dropdownOption' in cellOnShow ? cellOnShow.dropdownOption : undefined;
      return [
        {
          index,
          text: listState.texts[index] ?? null,
          isChecked: listed.value?.kind === 'boolean' && isShownCheckboxCell(reads, cell) ? listed.value.value : null,
          optionPaints: dropdownOption === undefined ? null : cachedOptionChipColors(dropdownOption.color),
          records: listed.records,
          isTicked: listState.ticks[index] === true,
        },
      ];
    }),
  };
}
export function readFilterListValues(
  reads: WorkbookReads,
  ownFilter: Pick<OwnFilter, 'table' | 'filter'>,
  columnId: ColumnId,
): OwnFilterValues | 'tableIsGone' | null {
  let { table, filter } = ownFilter;
  let filterOfOtherColumns = filter === null ? null : filterOnKnownColumns(reads, table.sheetId, filter);
  let answer = reads.valuesOfFilteredColumn(table, filterForColumnValues(filterOfOtherColumns, columnId), columnId);
  if (answer === null) return null;
  if (answer.kind === 'refused')
    return answer.refusal === 'filteredTableIsGone' || answer.refusal === 'headerOfFilteredTableIsGone' ? 'tableIsGone' : null;
  let texts = answer.values.map(
    ({ value, firstInRow }) =>
      value === null
        ? null
        : cellShownText(
            reads.cellOnShowIn({
              sheetId: table.sheetId,
              rowId: firstInRow,
              columnId,
            }),
            reads.decimalSign,
          ),
  );
  return withDrawnFilterValues(reads, ownFilter, columnId, {
    listed: answer.values,
    areMoreLeftOut: answer.areMoreLeftOut,
    texts,
    ticks: answer.values.map(({ meetsTheLinesOfItsColumn }) => meetsTheLinesOfItsColumn),
    found: texts.map((text, index) => index),
  });
}
export function sortDirectionInForce(
  reads: WorkbookReads,
  ownFilter: TableToFilter,
  columnId: ColumnId,
  { listed, areMoreLeftOut }: Pick<OwnFilterValues, 'listed' | 'areMoreLeftOut'>,
): SortDirection | null {
  let recordsArea = ownFilterRecordsArea(reads, ownFilter);
  if (recordsArea === null || areMoreLeftOut || recordsArea.rowCount > MAX_ROWS_TO_READ_SORT) return null;
  let indexOfValue = new Map<string, number>(
    listed.map(({ value }, index) => [JSON.stringify(value), index]),
  );
  let previousIndex: number | null = null;
  let isAscending = true;
  let isDescending = true;
  let hasBlank = false;
  let hasChange = false;
  for (let rowOffset = 0; rowOffset < recordsArea.rowCount; rowOffset += 1) {
    let cellId = reads.cellIdAt(ownFilter.table.sheetId, recordsArea.topRowIndex + rowOffset, recordsArea.leftColumnIndex);
    let value =
      cellId === null
        ? undefined
        : filterValueOfCell(reads, {
            ...cellId,
            columnId,
          });
    let index = value === undefined ? undefined : indexOfValue.get(JSON.stringify(value));
    if (index === undefined) return null;
    if (value === null) {
      hasBlank = true;
      continue;
    }
    if (hasBlank) return null;
    if (previousIndex !== null && index > previousIndex) isDescending = false;
    if (previousIndex !== null && index < previousIndex) isAscending = false;
    hasChange ||= previousIndex !== null && index !== previousIndex;
    previousIndex = index;
  }
  if (!hasChange || isAscending === isDescending) return null;
  return isAscending ? 'ascending' : 'descending';
}
export function quickFiltersOfColumnKind(columnKind: KindOfAColumn, today: string | null): QuickFilterOfColumn[] {
  switch (columnKind) {
    case 'date':
      return today === null ? [] : DATE_QUICK_FILTERS.map((preset) => [preset, dueDatePresetCondition(preset, today)]);
    case 'number':
    case 'currency':
    case 'percent':
      return [
        [
          'largest',
          {
            kind: 'isAmongTheLargest',
            count: QUICK_FILTER_COUNT,
          },
        ],
        [
          'smallest',
          {
            kind: 'isAmongTheSmallest',
            count: QUICK_FILTER_COUNT,
          },
        ],
      ];
    case 'checkbox':
    case 'text':
    case 'fewWords':
      return [];
  }
}
export function readyFiltersOfColumn(
  reads: WorkbookReads,
  { table, filter }: Pick<OwnFilter, 'table' | 'filter'>,
  column: ColumnHolds & { c: ColumnId },
  viewerId: string | null,
  today: string | null,
): ReadyFilter[] {
  let { c: columnId } = column;
  let recordsWhere = (isCounted: (value: ValueContents | null) => boolean) =>
    column.values.reduce((sum, { value, records }) => (isCounted(value) ? sum + records : sum), 0);
  let suggestedAsks = suggestedAsksOf(
    {
      records: recordsWhere(() => true),
      columns: [column],
    },
    viewerId,
  );
  let doneTexts = column.values.filter(({ value }) => value?.kind === 'text' && isDoneStatus(value.value));
  let isOfTexts = column.kind === 'text' || column.kind === 'fewWords';
  let singleRecordValues = column.values.filter((value) => value.records === 1 && value.userIds.length === 0);
  let duplicatesChoice: QuickFilterOfColumn[] =
    isOfTexts && column.optionsOfDropdown === null && singleRecordValues.length * 2 > column.values.length
      ? [
          [
            'duplicates',
            {
              kind: 'appearsMoreThanOnce',
            },
          ],
        ]
      : [];
  let readyFilters: Omit<ReadyFilter, 'records'>[] = [
    ...suggestedAsks.flatMap(({ what, asked: { filter: askedFilter } }) => {
      let asked = askedFilter?.allOf[0].anyOf[0].asked;
      if (asked === undefined || (what.kind !== 'mine' && what.kind !== 'allBut')) return [];
      if (what.kind === 'allBut' && doneTexts.length > 1) return [];
      return [
        {
          what: what.kind,
          asked,
          label: what.kind === 'allBut' ? what.label : null,
        },
      ];
    }),
    ...[...quickFiltersOfColumnKind(column.kind, today), ...duplicatesChoice].map(
      ([what, condition]): Omit<ReadyFilter, 'records'> => ({
        what,
        asked: {
          kind: 'meets',
          condition,
        },
        label: null,
      }),
    ),
  ];
  let filterOfOtherColumns = filter === null ? null : filterOnKnownColumns(reads, table.sheetId, filter);
  return readyFilters.flatMap((readyFilter) => {
    let answer = reads.filteredRows(table, filterReplacingColumn(filterOfOtherColumns, columnId, readyFilter.asked));
    if (answer?.kind !== 'filteredRows') return [];
    let { recordsInView } = answer;
    let isOfCounts = readyFilter.what === 'largest' || readyFilter.what === 'smallest';
    return recordsInView === 0 ||
      recordsInView === answer.records ||
      (isOfCounts && recordsWhere((value) => value?.kind === 'number') <= QUICK_FILTER_COUNT)
      ? []
      : [
          {
            ...readyFilter,
            records: recordsInView,
          },
        ];
  });
}
export function dropFilterKeptForColumnsCard(state: PageState, reads: ReadsWithTextMeasurer, tableKey: string): PageState {
  let filterKeptOnForColumnsCard = state.filterKeptOnForColumnsCard;
  if (filterKeptOnForColumnsCard === null || filterKeptOnForColumnsCard === tableKey || !isOwnFilterKeyUnused(state, filterKeptOnForColumnsCard))
    return state;
  return {
    ...clearOwnFilters(state, reads, {
      tableKey: filterKeptOnForColumnsCard,
    }),
    filterKeptOnForColumnsCard: null,
  };
}
export function openOwnFilterList(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  tableKey: string,
  columnId: ColumnId,
  today: string | null,
): PageState {
  let triedEnded = endOwnFilterTrial(state, reads);
  let sheetId = ownFilterByKey(triedEnded, tableKey)?.table.sheetId;
  let refreshed = sheetId === undefined ? triedEnded : refreshStaleOwnFilters(triedEnded, reads, sheetId);
  let withoutKeptFilter = dropFilterKeptForColumnsCard(refreshed, reads, tableKey);
  let { ownFilterList } = state;
  let ownFilter = ownFilterByKey(withoutKeptFilter, tableKey);
  let column = ownFilter?.columns.find((tableColumn) => tableColumn.c === columnId);
  if (ownFilter === null || column === undefined) return withoutKeptFilter;
  let { kind: columnKind } = column;
  let columnValues = columnHoldsOf(reads, ownFilter, column);
  let values = readFilterListValues(reads, ownFilter, columnId);
  if (values === 'tableIsGone')
    return {
      ...clearOwnFilters(withoutKeptFilter, reads, {
        tableKey,
      }),
      notice: {
        kind: 'filteredTableIsGone',
      },
    };
  let { conditions, join } = conditionFilterOfColumn(
    ownFilter.filter,
    columnId,
    (condition) => isConditionEditableAsChoice(condition, columnKind === 'date'),
  );
  let isForOneself = isOwnFilterSortable(reads, ownFilter);
  let sortRecords = isForOneself
    ? ownFilterRecordsArea(reads, ownFilter)
    : (sortableRecordsOfOwnFilter(withoutKeptFilter, reads, ownFilter)?.records ?? null);
  let [firstSortBy] = ownFilter.sort?.by ?? [];
  return {
    ...clearPassingNotice(withoutKeptFilter),
    menu: null,
    dropdown: null,
    calendar: null,
    ownFilterList: {
      tableKey,
      isFilterNotDrawnYet: ownFilterList?.tableKey === tableKey && ownFilterList.isFilterNotDrawnYet,
      isTableGuessed: ownFilterList?.tableKey === tableKey && ownFilterList.isTableGuessed,
      c: columnId,
      values,
      startsFromNone: false,
      conditions: conditions.map(
        (condition, index) =>
          ownFilterConditionRow(
            reads,
            columnKind,
            index,
            filterChoiceFromCondition(
              condition,
              columnKind === 'date',
              (number) => operandTextOfNumber(reads, number, columnKind),
            ),
            condition,
          ),
      ),
      join,
      choices: conditionFamilyOfColumnKind(columnKind) === null ? [] : operatorsForColumnKind(columnKind),
      sort:
        sortRecords === null || (ownFilterList?.tableKey === tableKey && ownFilterList.isTableGuessed && ownFilterList.sort === null)
          ? null
          : {
              keys: sortHoldsOfColumn(
                reads,
                {
                  sheetId: ownFilter.table.sheetId,
                  columnId,
                },
                sortRecords,
              ),
              inForce:
                firstSortBy?.c === columnId
                  ? firstSortBy.direction
                  : values === null
                    ? null
                    : sortDirectionInForce(reads, ownFilter, columnId, values),
              isForOneself,
            },
      today,
      holds: {
        records: 0,
        columns: ownFilter.columns.map(
          (tableColumn) =>
            tableColumn.c === columnId
              ? columnValues
              : {
                  ...tableColumn,
                  values: [],
                  areMoreValuesLeftOut: true,
                  optionsOfDropdown: null,
                },
        ),
      },
      ready: readyFiltersOfColumn(reads, ownFilter, columnValues, withoutKeptFilter.viewerId, today),
      words: '',
      answer: null,
      isAnswerRead: false,
      areWordsOnTheirWay: false,
    },
  };
}
export function applyOwnFilterListChange(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  filterChange: (ownFilter: OwnFilter, ownFilterList: OwnFilterList) => Filter | null,
  listChange: Partial<OwnFilterList>,
): PageState {
  let [ownFilterList, ownFilter] = [state.ownFilterList, ownFilterOfList(state)];
  if (ownFilterList === null || ownFilter === null) return state;
  let nextState = applyOwnFilter(clearPassingNotice(state), reads, ownFilter, filterChange(ownFilter, ownFilterList));
  return ownFilterByKey(nextState, ownFilterList.tableKey) !== ownFilter
    ? {
        ...nextState,
        ownFilterList: {
          ...ownFilterList,
          ...listChange,
        },
      }
    : nextState;
}
export function setOwnFilterConditions(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  conditions: OwnFilterCondition[],
  join: ConditionJoin,
): PageState {
  let ownFilterList = state.ownFilterList;
  if (ownFilterList === null) return state;
  let asksOf = (conditionRows: readonly OwnFilterCondition[]) => conditionRows.flatMap(({ asks }) => asks ?? []);
  let [askedBefore, askedNow] = [asksOf(ownFilterList.conditions), asksOf(conditions)];
  if (
    askedBefore.length === askedNow.length &&
    askedBefore.every((asked, index) => asked === askedNow[index]) &&
    (join === ownFilterList.join || askedNow.length < MAX_FILTER_CONDITIONS)
  )
    return {
      ...state,
      ownFilterList: {
        ...ownFilterList,
        conditions,
        join,
      },
    };
  return applyOwnFilterListChange(
    state,
    reads,
    ({ filter }, { c: columnId }) =>
      withConditionFilter(filter, columnId, askedBefore, {
        conditions: askedNow,
        join,
      }),
    {
      conditions,
      join,
    },
  );
}
export function endOwnFilterTrial(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  let ownFilterTried = state.ownFilterTried;
  return ownFilterTried === null
    ? state
    : {
        ...undoOwnFilterTry(state, reads, ownFilterTried),
        ownFilterTried: null,
      };
}
export function tryOwnFilterAsked(state: PageState, reads: ReadsWithTextMeasurer, asked: Asked): PageState {
  let [ownFilterList, ownFilter, ownFilterTried] = [state.ownFilterList, ownFilterOfList(state), state.ownFilterTried];
  if (ownFilterList === null || ownFilter === null) return state;
  if (ownFilterTried !== null && filterLineIndexOfAsked(ownFilter, ownFilterList.c, asked) !== -1) return state;
  let { filter } = ownFilterTried?.before.held ?? ownFilter;
  let filterOfOtherColumns = filter === null ? null : filterOnKnownColumns(reads, ownFilter.table.sheetId, filter);
  let { state: triedState, tried } = tryOwnFilter(
    clearPassingNotice(state),
    reads,
    ownFilter,
    ownFilterTried,
    filterReplacingColumn(filterOfOtherColumns, ownFilterList.c, asked),
  );
  return {
    ...triedState,
    ownFilterTried: tried,
  };
}
export function readFilterListWords(
  reads: WorkbookReads,
  ownFilterList: OwnFilterList,
  words: string,
  foundIndexes: number[],
  viewerId: string | null,
): FilterListWordsRead {
  let trimmed = words.trim();
  if (trimmed === '')
    return {
      asked: null,
      isOnItsWay: false,
      isRead: false,
    };
  let wordsRead = readWordsAsFilter(words, ownFilterList.holds, viewerId, {
    only: ownFilterList.c,
    today: ownFilterList.today,
    signsOfNumbers: reads.signsOfNumbers,
    isMonthFirst: reads.locale === 'en-US',
  });
  if (wordsRead.kind === 'read') {
    let [firstLine, ...otherLines] = wordsRead.asked.filter?.allOf ?? [];
    let asked =
      otherLines.length === 0 && firstLine?.anyOf.length === 1 && firstLine.anyOf[0].c === ownFilterList.c ? firstLine.anyOf[0].asked : null;
    if (!(asked?.kind === 'meets' && asked.condition.kind === 'numberIs' && asked.condition.comparison === 'equalTo'))
      return {
        asked,
        isOnItsWay: false,
        isRead: asked !== null,
      };
  }
  let onItsWay = {
    isOnItsWay: wordsRead.kind === 'notRead' && wordsRead.isOnItsWay,
    isRead: false,
  };
  let column = ownFilterList.holds.columns.find(({ c: columnId }) => columnId === ownFilterList.c);
  if (ownFilterList.values === null || column === undefined)
    return {
      asked: null,
      ...onItsWay,
    };
  let { listed, areMoreLeftOut } = ownFilterList.values;
  let [firstValue, ...moreValues] = foundIndexes.flatMap((index) => listed[index]?.value ?? []);
  let isFreeText = column.kind === 'text' && !isColumnOfFewValues(column);
  if (isFreeText && (firstValue !== undefined || areMoreLeftOut))
    return {
      asked: {
        kind: 'meets',
        condition: {
          kind: 'textContains',
          text: trimmed,
        },
      },
      ...onItsWay,
    };
  if (isFreeText || areMoreLeftOut || firstValue === undefined || foundIndexes.length === listed.length)
    return {
      asked: null,
      ...onItsWay,
    };
  return {
    asked: {
      kind: 'isOneOf',
      values: [firstValue, ...moreValues],
    },
    ...onItsWay,
  };
}
export function valuesLeftOutKept(
  { listed, ticks, areMoreLeftOut }: Pick<OwnFilterValues, 'listed' | 'ticks' | 'areMoreLeftOut'>,
  lines: Asked[],
  isTicked: boolean,
): (ValueAskedFor | null)[] {
  if (!areMoreLeftOut) return [];
  const lineKind = isTicked ? 'isOneOf' : 'isNoneOf';
  let keptValues = lines.flatMap((line) => (line.kind === lineKind ? line.values : []));
  let listedValues = new Set(listed.map(({ value }) => JSON.stringify(value)));
  let notListed = keptValues.filter((value) => !listedValues.has(JSON.stringify(value)));
  let tickedCount = ticks.filter((tick) => tick === isTicked).length;
  return keptValues.length - notListed.length === tickedCount ? notListed : [];
}
export function setFilterListTicks(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  ticks: boolean[],
  startsFromNone: boolean | null,
): PageState {
  let [ownFilterList, ownFilter] = [state.ownFilterList, ownFilterOfList(state)];
  if (ownFilterList === null || ownFilterList.values === null || ownFilter === null) return state;
  let valueLines = valueFiltersOfColumn(ownFilter.filter, ownFilterList.c);
  let isShowOnly =
    valueLines.length === 0 ? ownFilterList.startsFromNone : valueLines.some(({ kind }) => kind === 'isOneOf');
  let [firstValue, ...otherValues] = [
    ...ownFilterList.values.listed.flatMap(({ value }, index) => (ticks[index] === isShowOnly ? [value] : [])),
    ...valuesLeftOutKept(ownFilterList.values, valueLines, isShowOnly),
  ];
  const valueLine: Asked | null =
    firstValue === undefined
      ? null
      : {
          kind: isShowOnly ? 'isOneOf' : 'isNoneOf',
          values: [firstValue, ...otherValues],
        };
  let lineToSet = startsFromNone === null ? valueLine : null;
  return applyOwnFilterListChange(
    state,
    reads,
    ({ filter }, { c: columnId }) => withValueFilter(filter, columnId, lineToSet),
    {
      startsFromNone: startsFromNone ?? (valueLine === null ? isShowOnly : ownFilterList.startsFromNone),
      values: withDrawnFilterValues(reads, ownFilter, ownFilterList.c, {
        ...ownFilterList.values,
        ticks,
      }),
    },
  );
}
export function reduceOwnFilterList(state: PageState, reads: ReadsWithTextMeasurer, act: OwnFilterListAct): PageState {
  if (act.kind === 'giveUp') return endOwnFilterTrial(state, reads);
  let [ownFilterList, ownFilter] = [state.ownFilterList, ownFilterOfList(state)];
  if (ownFilterList === null || ownFilter === null) return state;
  if (!(act.kind === 'type' || act.kind === 'pointAt' || act.kind === 'take') && (state.ownFilterTried !== null || ownFilterList.answer !== null))
    return reduceOwnFilterList(
      {
        ...endOwnFilterTrial(state, reads),
        ownFilterList: {
          ...ownFilterList,
          answer: null,
        },
      },
      reads,
      act,
    );
  let columnKind = ownFilter.columns.find(({ c: columnId }) => columnId === ownFilterList.c)?.kind ?? 'text';
  switch (act.kind) {
    case 'tick': {
      let ticks = ownFilterList.values?.ticks ?? [];
      let isTicked = ticks[act.index];
      return isTicked === undefined ? state : setFilterListTicks(state, reads, ticks.with(act.index, !isTicked), null);
    }
    case 'tickAll':
    case 'tickNone': {
      let isTickedNow = act.kind === 'tickAll';
      let { ticks = [], found = [] }: Partial<OwnFilterValues> = ownFilterList.values ?? {};
      let foundIndexes = new Set(found);
      return setFilterListTicks(
        state,
        reads,
        ticks.map((tick, index) => (foundIndexes.has(index) ? isTickedNow : tick)),
        found.length === ticks.length ? !isTickedNow : null,
      );
    }
    case 'type': {
      let found = ownFilterList.values === null ? [] : indexesOfMatchingTexts(ownFilterList.values.texts, act.blank, act.words);
      let values =
        ownFilterList.values === null
          ? null
          : withDrawnFilterValues(reads, ownFilter, ownFilterList.c, {
              ...ownFilterList.values,
              found,
            });
      let {
        asked: askedInWords,
        isOnItsWay: areWordsOnTheirWay,
        isRead: areWordsRead,
      } = readFilterListWords(reads, ownFilterList, act.words, found, state.viewerId);
      let isTypedOn = act.words.startsWith(ownFilterList.words);
      let keepsAnswer = askedInWords === null && areWordsOnTheirWay && ownFilterList.isAnswerRead && isTypedOn;
      let answer = keepsAnswer ? ownFilterList.answer : askedInWords;
      let typedState: PageState = {
        ...state,
        ownFilterList: {
          ...ownFilterList,
          values,
          words: act.words,
          answer,
          isAnswerRead: keepsAnswer || areWordsRead,
          areWordsOnTheirWay,
        },
      };
      return answer === null ? endOwnFilterTrial(typedState, reads) : tryOwnFilterAsked(typedState, reads, answer);
    }
    case 'pointAt': {
      let asked = act.row === null ? ownFilterList.answer : askedOfFilterListRow(ownFilterList, act.row);
      return asked === null ? endOwnFilterTrial(state, reads) : tryOwnFilterAsked(state, reads, asked);
    }
    case 'take': {
      let asked = askedOfFilterListRow(ownFilterList, act.row);
      if (asked === null) return state;
      let triedState = tryOwnFilterAsked(state, reads, asked);
      let ownFilterAfter = ownFilterOfList(triedState);
      if (ownFilterAfter === null || filterLineIndexOfAsked(ownFilterAfter, ownFilterList.c, asked) === -1) return triedState;
      return {
        ...triedState,
        ownFilterTried: null,
        ownFilterList: null,
      };
    }
    case 'addCondition': {
      let hasRoom = ownFilterList.conditions.length < MAX_FILTER_CONDITIONS;
      if (ownFilterList.choices.length === 0 || !hasRoom || ownFilterList.conditions.some(({ key }) => key === act.key))
        return state;
      let family = conditionFamilyOfColumnKind(columnKind);
      let held: FilterChoiceHeld = {
        choice: family === 'text' ? 'textContains' : family === 'days' ? 'lessThan' : 'greaterThan',
        first: '',
        second: '',
      };
      return setOwnFilterConditions(
        state,
        reads,
        [...ownFilterList.conditions, ownFilterConditionRow(reads, columnKind, act.key, held, null)],
        ownFilterList.join,
      );
    }
    case 'changeCondition': {
      let asks = conditionFromFilterChoice(act.held, columnKind === 'date', conditionInputLimits(reads, columnKind));
      return setOwnFilterConditions(
        state,
        reads,
        ownFilterList.conditions.map(
          (condition) =>
            condition.key === act.key ? ownFilterConditionRow(reads, columnKind, condition.key, act.held, asks) : condition,
        ),
        ownFilterList.join,
      );
    }
    case 'removeCondition':
      return setOwnFilterConditions(
        state,
        reads,
        ownFilterList.conditions.filter(({ key }) => key !== act.key),
        ownFilterList.join,
      );
    case 'joinConditions':
      return setOwnFilterConditions(state, reads, ownFilterList.conditions, act.by);
    case 'removeLine': {
      let reopened = openOwnFilterList(
        removeOwnFilterLine(clearPassingNotice(state), reads, ownFilterList.tableKey, act.lineIndex),
        reads,
        ownFilterList.tableKey,
        ownFilterList.c,
        ownFilterList.today,
      );
      let { conditions, join } = ownFilterList;
      return reopened.ownFilterList === null
        ? reopened
        : {
            ...reopened,
            ownFilterList: {
              ...reopened.ownFilterList,
              conditions,
              join,
            },
          };
    }
  }
}
export function closeOwnFilterListOnEvent(state: PageState, trigger: PageEvent): PageState {
  if (state.ownFilterList === null) return state;
  if (
    ownFilterOfList(state)?.table.sheetId === state.sheetId &&
    state.sheetPointedIn === null &&
    state.mode.kind === 'navigating' &&
    state.menu === null &&
    trigger.kind !== 'pointerPressed'
  )
    return state;
  let { ownFilterTried, filterKeptOnForColumnsCard } = state;
  let isKeptFilterUnused =
    filterKeptOnForColumnsCard !== null && !state.ownFilterList.isFilterNotDrawnYet && isOwnFilterKeyUnused(state, filterKeptOnForColumnsCard);
  let isTrialLeftOpen = ownFilterTried !== null || isKeptFilterUnused;
  let dropsDragging = trigger.kind === 'pointerPressed' && isTrialLeftOpen;
  let dropsPlaceAfterTry = trigger.kind === 'pointerPressed' || (trigger.kind === 'menuAsked' && trigger.at !== null);
  return {
    ...state,
    ownFilterList: null,
    dragging: dropsDragging ? null : state.dragging,
    ownFilterTried:
      ownFilterTried !== null && dropsPlaceAfterTry
        ? {
            ...ownFilterTried,
            placeAfterTry: null,
          }
        : ownFilterTried,
  };
}
export function ownFilterListView(state: PageState, reads: WorkbookReads): OwnFilterListDrawn | null {
  let [ownFilterList, ownFilter] = [state.ownFilterList, ownFilterOfList(state)];
  if (ownFilterList === null || ownFilter === null) return null;
  let { c: columnId, tableKey } = ownFilterList;
  let columnKind = ownFilter.columns.find((column) => column.c === columnId)?.kind ?? 'text';
  let ticked = (ownFilterList.values?.found ?? []).map((index) => ownFilterList.values?.ticks[index] === true);
  let answerLine =
    ownFilterList.answer === null ? undefined : ownFilter.lines[filterLineIndexOfAsked(ownFilter, columnId, ownFilterList.answer)];
  let recordCounts = recordCountsOfOwnFilter(state, reads, ownFilter);
  let filterShown = state.ownFilterTried?.before.held ?? ownFilter;
  let testsOfConditions = new Map<CellCondition, RuleTest>(
    (filterShown.filter?.allOf ?? []).flatMap(
      ({ anyOf }, lineIndex) =>
        anyOf.flatMap(({ asked }, index) => {
          let said = filterShown.lines[lineIndex]?.[index];
          return asked.kind === 'meets' && said?.kind === 'test' ? [[asked.condition, said.test]] : [];
        }),
    ),
  );
  let asksOfConditions = ownFilterList.conditions.flatMap(({ asks }) => asks ?? []);
  return {
    tableKey,
    c: columnId,
    join: ownFilterList.join,
    choices: ownFilterList.choices,
    isOfDays: columnKind === 'date',
    mostCounted: reads.limitsOfConditionalFormats().largestCountInACondition,
    sort: ownFilterList.sort,
    canSortNow: recordCounts?.inView !== 0,
    areWordsOnTheirWay: ownFilterList.areWordsOnTheirWay,
    conditions: ownFilterList.conditions.map(
      ({ key, held, asks, isMistyped }) => ({
        key,
        held,
        fields: inputsOfFilterChoice(held.choice, columnKind === 'date'),
        isMistyped,
        said: asks === null ? null : (testsOfConditions.get(asks) ?? null),
      }),
    ),
    answer:
      answerLine === undefined
        ? null
        : {
            line: answerLine,
            records: recordCounts?.inView ?? null,
          },
    ready: ownFilterList.ready.map(
      ({ what, label, records }) => ({
        what,
        label,
        records,
      }),
    ),
    otherLines: mixedEntryIndexesOfColumn(filterShown.filter, columnId, asksOfConditions).flatMap((lineIndex) => {
      let line = filterShown.lines[lineIndex];
      return line === undefined
        ? []
        : [
            {
              lineIndex,
              line,
            },
          ];
    }),
    records: state.ownFilterTried === null ? recordCounts : null,
    isOnTrial: state.ownFilterTried !== null,
    column: columnLabelOfFilterTable(reads, ownFilter, columnId),
    values: ownFilterList.values?.drawn ?? null,
    areMoreLeftOut: ownFilterList.values?.areMoreLeftOut === true,
    ticked: ticked.every(Boolean) ? 'all' : ticked.some(Boolean) ? 'some' : 'none',
  };
}
export const conditionFamilyOfColumnKind = (columnKind: KindOfAColumn): ConditionFamily => {
  switch (columnKind) {
    case 'number':
    case 'currency':
    case 'percent':
      return 'numbers';
    case 'date':
      return 'days';
    case 'fewWords':
    case 'text':
      return 'text';
    case 'checkbox':
      return null;
  }
};
export const QUICK_FILTER_COUNT = 10;
export const MAX_LISTED_FILTER_VALUES = 200;
export const ownFilterConditionRow = (
  reads: WorkbookReads,
  columnKind: KindOfAColumn,
  key: number,
  held: FilterChoiceHeld,
  asks: CellCondition | null,
) => ({
  key,
  held,
  asks,
  isMistyped: inputsOfFilterChoice(held.choice, columnKind === 'date').map(
    (field, fieldIndex) =>
      isFilterInputInvalid(field, fieldIndex === 0 ? held.first : held.second, conditionInputLimits(reads, columnKind)),
  ),
});
export const ownFilterOfList = (state: PageState): OwnFilter | null =>
  state.ownFilterList === null ? null : ownFilterByKey(state, state.ownFilterList.tableKey);
export const conditionInputLimits = (reads: WorkbookReads, columnKind: KindOfAColumn): FilterInputLimits => ({
  numberTyped: (text: string) => numberTypedFor(reads, text, columnKind),
  mostCounted: reads.limitsOfConditionalFormats().largestCountInACondition,
  longestText: reads.limitsOfConditionalFormats().longestTextOfAConditionInCharacters,
});
export const indexesOfMatchingTexts = (texts: readonly (string | null)[], blank: string, words: string): number[] => {
  let wordsLower = words.trim().toLowerCase();
  return texts.flatMap((text, index) => ((text ?? blank).toLowerCase().includes(wordsLower) ? [index] : []));
};
export const MAX_ROWS_TO_READ_SORT = 5000;
export const DATE_QUICK_FILTERS: DueDatePreset[] = ['thisWeek', 'nextWeek', 'thisMonth', 'overdue'];
export const filterLineIndexOfAsked = ({ filter }: Pick<OwnFilter, 'filter'>, columnId: ColumnId, asked: Asked): number =>
  (filter?.allOf ?? []).findIndex(
    ({ anyOf: [firstAsk, ...otherAsks] }) => otherAsks.length === 0 && firstAsk.c === columnId && firstAsk.asked === asked,
  );
export const askedOfFilterListRow = ({ answer, ready }: Pick<OwnFilterList, 'answer' | 'ready'>, row: string): Asked | null =>
  row === 'answer' ? answer : (ready.find(({ what }) => what === row)?.asked ?? null);
export const isOwnFilterTrialLeftOpen = ({ ownFilterList, ownFilterTried }: Pick<PageState, 'ownFilterList' | 'ownFilterTried'>): boolean =>
  ownFilterList === null && ownFilterTried !== null;
