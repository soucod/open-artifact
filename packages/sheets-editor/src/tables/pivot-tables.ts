import { readsAsStored, cellRefOf } from '../model/workbook.ts';
import { isSameCell, areaOfPosition } from '../selection/model.ts';
import { withNoEffects } from '../state/transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS, IF_QUEUED_PLACE_CHANGED } from '../model/edit-effects.ts';
import { cellShownText } from '../clipboard/text-escaping.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { parseA1AreaAsSeen, columnLetters } from '../model/a1-references.ts';
import type {
  ColumnId,
  KindOfAColumn,
  PivotAxis,
  PivotFilter,
  PivotKeeps,
  PivotListed,
  PivotMeasure,
  PivotOrder,
  PivotPeriod,
  PivotTable,
  PivotTableAtAnswer,
  PivotTableRead,
  PivotTotal,
  PivotWrittenValue,
  PlaceOfAPivotTable,
  Refused,
  RowId,
  SheetId,
  TableOfASheet,
  TablesOfSheetAnswer,
  ValueContents,
  ValuesOfFilteredColumnAnswer,
} from '@open-artifact/sheets-core';
import type { EditRefusedOnPage, PageState } from '../state/initial-state.ts';
import type { PageEvent } from '../state/event-reducer.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageTransition } from '../state/transitions.ts';
/** A section of the pivot table pane. */
export type PivotSectionName = 'rows' | 'columns' | 'values' | 'filters';
/** A field of the pane that groups the rows or the columns, by its place in its section. */
export interface PivotGroupingAt {
  among: 'rows' | 'columns';
  at: number;
}
/** A field of the pane that totals a column, by its place among the values. */
export interface PivotValueAt {
  among: 'values';
  at: number;
}
/** A field of the pane that filters the records, by its place among the filters. */
export interface PivotFilterAt {
  among: 'filters';
  at: number;
}
/** A field of the pane: its section and its place there. */
export type PivotFieldAt = PivotGroupingAt | PivotValueAt | PivotFilterAt;
/** Text typed in a field of the pane and not entered yet; `isRefused` when it named no cell. */
export interface PivotTyped {
  of: PivotFieldAt;
  text: string;
  isRefused?: true;
}
/**
 * A filter the pane shows that the pivot table does not hold: one that keeps every value, one that keeps none, or one
 * that waits for a cell to be named. `hidesOne` when it stands in place of the filter at its place.
 */
export interface PivotFilterToBe {
  at: number;
  hidesOne: boolean;
  column: ColumnId;
  keeps: 'all' | 'none' | 'whatACellHolds';
}
/** A filter as the pane shows it: one the pivot table holds, or one still to be. */
export type PivotFilterShown = PivotFilter | PivotFilterToBe;
/** A value of a source column listed under a filter, with the text it is shown as and whether it is ticked. */
export interface PivotFilterValue {
  firstInRow: RowId;
  /** `null`: blank. */
  value: ValueContents | null;
  text: string | null;
  isTicked: boolean;
}
/** The values listed under a filter, and the values the filter names that the list leaves out. */
export interface PivotFilterValues {
  values: PivotFilterValue[];
  areMoreLeftOut: boolean;
  namedBeyondTheList: (PivotWrittenValue | null)[];
}
/** The values listed under a filter, or why there are none yet. */
export type PivotListedValues = PivotFilterValues | 'notReadYet' | 'notToBeListed';
/** The filter whose values are listed open in the pane. */
export interface PivotListedInPane {
  at: number;
  values: PivotListedValues;
}
/** The pivot table the pane read at its cell, or why there is none to show. */
export type PivotPaneRead = PivotTableRead | 'notReadYet' | 'notToBeRead' | 'isNoPivotTable';
/** What the pane showed before a change of its pivot table was sent, to go back to if the change is refused. */
export interface PivotPaneBeforeEdit {
  read: PivotPaneRead;
  filterToBe: PivotFilterToBe | null;
  listed: PivotListedInPane | null;
}
/** The pivot table open in the side pane. */
export interface PivotTableOfPane {
  cellId: CellId;
  read: PivotPaneRead;
  filterToBe: PivotFilterToBe | null;
  listed: PivotListedInPane | null;
  typed: PivotTyped | null;
  beforeEdit: PivotPaneBeforeEdit | null;
}
/** A column of the table a pivot table reads. */
export type PivotSourceColumn = TableOfASheet['columns'][number];
/** A column of the table as the pane offers it: its id, its letters, its heading (`''` when it has none) and its kind. */
export interface PivotColumnOfTable {
  columnId: ColumnId;
  letters: string;
  heading: string;
  kind: KindOfAColumn;
}
/** A value of the pivot table as the pane shows it, with the totals it can take. */
export interface PivotValueInPane extends PivotMeasure {
  totals: PivotTotal[];
}
/** How a filter of the pane picks its records: by values (counted), or by the value of a cell (its address). */
export type PivotFilterBy = { kind: 'cell'; address: string } | { kind: 'values'; keeps: 'all' | PivotKeeps; count: number };
/** A filter as the pane shows it. */
export interface PivotFilterInPane {
  column: ColumnId;
  by: PivotFilterBy;
}
/** Which sections of the pane can take another field. */
export type PivotSectionsThatCanAdd = Record<PivotSectionName, boolean>;
/** The fields of a pivot table as the pane shows them. */
export interface PivotTablePaneFields {
  shows: 'fields';
  sheetName: string;
  cells: string;
  isOutOfDate: boolean;
  columnsOfTable: PivotColumnOfTable[];
  rows: PivotAxis[];
  columns: PivotAxis[];
  values: PivotValueInPane[];
  filters: PivotFilterInPane[];
  canAdd: PivotSectionsThatCanAdd;
  /** The section that holds one field at most while the other holds more. */
  isHeldToOneValue: 'values' | 'columns' | null;
  listed: PivotListedInPane | null;
  typed: PivotTyped | null;
}
/** What the pane shows: the fields, or why it cannot show them. */
export type PivotTablePaneShown = { shows: 'nothingYet' | 'notRead' | 'formulaItCannotShow' | 'tableNotClear' } | PivotTablePaneFields;
/** The pivot table pane as drawn, with the cell of its pivot table. */
export type DrawnPivotTablePane = PivotTablePaneShown & { cellId: CellId };
/** The pane drawn for a read of the workbook. */
export interface DrawnPivotTablePaneCached {
  reads: WorkbookReads;
  drawn: DrawnPivotTablePane;
}
/** How a filter of the pane is asked to pick its records. */
export type PivotFilterByKind = PivotFilterBy['kind'];
/** What is done in the pivot table pane. */
export type PivotTablePaneAct =
  | { kind: 'add'; among: PivotSectionName }
  | { kind: 'remove'; field: PivotFieldAt }
  | { kind: 'setColumn'; field: PivotFieldAt; column: ColumnId }
  | { kind: 'setPeriod'; field: PivotGroupingAt; by: PivotPeriod | null }
  | { kind: 'setOrder'; field: PivotGroupingAt; order: PivotOrder }
  | { kind: 'setTotal'; at: number; total: PivotTotal }
  | { kind: 'setOrderByValue'; at: number; order: PivotOrder | null }
  | { kind: 'type'; field: PivotFieldAt; text: string }
  | { kind: 'dropTyped' }
  | { kind: 'enterTyped'; field: PivotFieldAt; text: string }
  | { kind: 'filterBy'; at: number; by: PivotFilterByKind }
  | { kind: 'useSelection'; at: number }
  | { kind: 'toggleList'; at: number }
  | { kind: 'tick'; index: number; isTicked: boolean }
  | { kind: 'tickAll'; isTicked: boolean }
  | { kind: 'update' };
/** Something done in the pivot table pane open at a cell. */
export interface PivotTablePaneActedIn {
  kind: 'pivotTablePaneActedIn';
  act: PivotTablePaneAct;
  of: CellId;
}
/** What a pivot table edit says it did. */
export interface PivotTableDone {
  what: 'pivotTableAdded' | 'pivotTableUpdated';
}
export function pivotTypingToEnter(state: PageState): PivotTablePaneActedIn | null {
  let pane = pivotTableOfSidePane(state);
  if (pane === null || pane.typed === null || pane.typed.isRefused === true) return null;
  let { of: field, text } = pane.typed;
  return {
    kind: 'pivotTablePaneActedIn',
    act: {
      kind: 'enterTyped',
      field,
      text,
    },
    of: pane.cellId,
  };
}
export function pivotTableCellAt(reads: WorkbookReads, cellId: CellId): CellId | null {
  let stored = readsAsStored(reads),
    cell = stored.cellOf(cellId);
  if (cell !== null) return PIVOT_FORMULA_PATTERN.test(cell.formulaText ?? '') ? cellId : null;
  let spill = stored.spillOver(cellId);
  return spill !== null && PIVOT_FORMULA_PATTERN.test(spill.formulaText)
    ? stored.cellIdAt(cellId.sheetId, spill.area.topRowIndex, spill.area.leftColumnIndex)
    : null;
}
export function pivotTotalsOfKind(kind: KindOfAColumn): PivotTotal[] {
  switch (kind) {
    case 'number':
    case 'currency':
      return ['sum', ...PIVOT_COUNT_TOTALS, 'average', 'min', 'max', 'shareOfTotal'];
    case 'percent':
      return ['average', 'sum', ...PIVOT_COUNT_TOTALS, 'min', 'max', 'shareOfTotal'];
    case 'date':
      return [...PIVOT_COUNT_TOTALS, 'average', 'min', 'max'];
    case 'fewWords':
    case 'checkbox':
    case 'text':
      return PIVOT_COUNT_TOTALS;
  }
}
export function newPivotTableOfTable(sheetId: SheetId, table: TableOfASheet, activeColumnId: ColumnId): PivotTable | null {
  let rowColumn =
    table.columns.find(({ c: columnId, kind }) => columnId === activeColumnId && kind === 'fewWords') ??
    pivotRowColumnOf(table.columns);
  if (rowColumn === undefined) return null;
  let valueColumn = pivotValueColumnOf(table.columns.filter((column) => column !== rowColumn));
  return {
    source: {
      sheetId,
      headerRow: table.headerRows.lastRow,
    },
    rows: [pivotGroupingOfColumn(rowColumn)],
    columns: null,
    values: [valueColumn === undefined ? pivotValueOfColumn(rowColumn, 'count') : pivotValueOfColumn(valueColumn)],
    filters: [],
  };
}
export function isCellInTableOfPivot(reads: WorkbookReads, table: TableOfASheet, cellId: CellId): boolean {
  let { headerRows, body, footerRows, firstColumn, lastColumn } = table,
    lastRow = (footerRows ?? body.at(-1) ?? headerRows).lastRow,
    [position = null, topLeft = null, bottomRight = null] = [
      cellId,
      {
        ...cellId,
        rowId: headerRows.firstRow,
        columnId: firstColumn,
      },
      {
        ...cellId,
        rowId: lastRow,
        columnId: lastColumn,
      },
    ].map((cell) => readsAsStored(reads).positionOfCell(cell));
  return (
    position !== null &&
    topLeft !== null &&
    bottomRight !== null &&
    topLeft.rowIndex <= position.rowIndex &&
    position.rowIndex <= bottomRight.rowIndex &&
    topLeft.columnIndex <= position.columnIndex &&
    position.columnIndex <= bottomRight.columnIndex
  );
}
export function askForPivotTable(state: PageState, reads: WorkbookReads, sheetName: string): PageTransition {
  let menuShut: PageState = {
      ...state,
      menu: null,
      dropdown: null,
    },
    pivotCellId = pivotTableCellAt(reads, state.activeCell);
  if (pivotCellId !== null) {
    const pane = pivotTableOfSidePane(state),
      timesSidePaneAsked = state.timesSidePaneAsked + (pane === null ? 0 : 1),
      keepsPane = pane !== null && isSameCell(pane.cellId, pivotCellId) && pane.read !== 'notToBeRead';
    return withNoEffects(
      withPivotTablePane(
        {
          ...menuShut,
          timesSidePaneAsked,
        },
        keepsPane ? pane : freshPivotTablePane(pivotCellId),
      ),
    );
  }
  let tables: TablesOfSheetAnswer | Refused | null = reads.tablesOfSheet(state.activeCell.sheetId);
  if (tables === null) return withNoEffects(menuShut);
  let table = (tables.kind === 'refused' ? [] : tables.tables).find((candidate) => isCellInTableOfPivot(reads, candidate, state.activeCell)) ?? null,
    pivotTable = table === null ? null : newPivotTableOfTable(state.sheetId, table, state.activeCell.columnId);
  if (pivotTable === null) {
    let why: EditRefusedOnPage['why'] = tables.kind === 'refused' ? 'formulasNotCalculated' : 'noTableForPivotTable';
    return withNoEffects({
      ...menuShut,
      notice: {
        kind: 'editRefused',
        why,
        asked: 'newPivotTable',
      },
    });
  }
  let place: PlaceOfAPivotTable = {
    kind: 'newSheet',
    afterSheet: state.sheetId,
    name: sheetName,
  };
  return queueEdit(
    menuShut,
    {
      kind: 'insertPivotTable',
      place,
      pivotTable,
    },
    {
      ...IF_QUEUED_PLACE_CHANGED,
      done: {
        what: 'pivotTableAdded',
      },
      dropsWhatIsHeld: 'always',
    },
  );
}
export function pivotFilterValuesListed(reads: WorkbookReads, pivotTable: PivotTable, filter: PivotFilterShown): PivotFilterValues | 'notToBeListed' | null {
  let writtenValues: (PivotWrittenValue | null)[] = 'listed' in filter && filter.listed.kind === 'written' ? filter.listed.values : [],
    keeps: PivotKeeps = 'listed' in filter ? filter.keeps : 'oneOf',
    { source } = pivotTable,
    answer: ValuesOfFilteredColumnAnswer | Refused | null = reads.valuesToFilterPivotTableBy(source, filter.column, keeps, writtenValues);
  if (answer === null) return null;
  if (answer.kind === 'refused') return 'notToBeListed';
  let shown = answer.values.filter(({ value }, index) => index < MAX_PIVOT_FILTER_VALUES_LISTED || value === null),
    values = shown.map(({ value, firstInRow, meetsTheLinesOfItsColumn }): PivotFilterValue => {
      let cellId: CellId = {
        sheetId: source.sheetId,
        rowId: firstInRow,
        columnId: filter.column,
      };
      return {
        firstInRow,
        value,
        text: value === null ? null : cellShownText(reads.cellOnShowIn(cellId), reads.decimalSign),
        isTicked: filter.keeps !== 'none' && meetsTheLinesOfItsColumn,
      };
    }),
    areMoreLeftOut = answer.areMoreLeftOut || shown.length < answer.values.length,
    shownKeys = new Set(values.map(({ value }) => pivotValueKey(value))),
    namedBeyondTheList = areMoreLeftOut ? writtenValues.filter((value) => !shownKeys.has(pivotValueKey(value))) : [];
  return {
    values,
    areMoreLeftOut,
    namedBeyondTheList,
  };
}
export function dropStalePivotTyping(before: PivotTableOfPane, pane: PivotTableOfPane): PivotTableOfPane {
  if (pane.typed === null) return pane;
  let { among, at: index } = pane.typed.of,
    pivotTable = pivotTableOfPaneRead(pane),
    filter: PivotFilterShown | undefined = pivotTable === null ? undefined : pivotFiltersToShow(pivotTable, pane.filterToBe)[index],
    isCellFilter =
      filter !== undefined && ('listed' in filter ? filter.listed.kind === 'inACell' : filter.keeps === 'whatACellHolds');
  return pivotFieldsKey(before) === pivotFieldsKey(pane) && (among !== 'filters' || isCellFilter)
    ? pane
    : {
        ...pane,
        typed: null,
      };
}
export function settlePivotTablePane(state: PageState, reads: WorkbookReads, event: PageEvent, areFormulasLeft: boolean): PageState {
  let isNewPivotTableQueued =
      event.kind === 'editAnswered' && event.edit.kind === 'insertPivotTable' && event.outcome.kind === 'editQueued',
    pane = pivotTableOfSidePane(state);
  if (pane === null && !isNewPivotTableQueued) return state;
  const pivotCellId = pivotTableCellAt(reads, state.activeCell),
    isOtherPivotTable = pivotCellId !== null && (pane === null || !isSameCell(pane.cellId, pivotCellId)),
    isChangeAnswered = event.kind === 'editAnswered' && event.edit.kind === 'changePivotTable',
    isChangeKept = isChangeAnswered && ['editQueued', 'nothingToChange'].includes(event.outcome.kind),
    nextPane = isOtherPivotTable
      ? freshPivotTablePane(pivotCellId)
      : pane !== null && pane.beforeEdit !== null && isChangeAnswered
        ? pivotPaneAfterChange(pane, isChangeKept)
        : pane;
  if (nextPane === null) return state;
  if (pivotTableCellAt(reads, nextPane.cellId) === null)
    return {
      ...state,
      sidePane: null,
    };
  let nextState = nextPane === pane ? state : withPivotTablePane(state, nextPane);
  if (pivotPaneReadsCache.get(nextPane) === reads || areFormulasLeft) return nextState;
  let answer: PivotTableAtAnswer | Refused | null = reads.pivotTableAt(nextPane.cellId);
  if (answer === null) return nextState;
  const read: PivotPaneRead = answer.kind === 'refused' ? 'notToBeRead' : (answer.read ?? 'isNoPivotTable'),
    pivotTable = pivotTableOfPaneRead({
      read,
    }),
    filterToBe =
      JSON.stringify(pivotTable?.filters) === JSON.stringify(pivotTableOfPaneRead(nextPane)?.filters) ? nextPane.filterToBe : null,
    listedFilterOf = (pivotTableRead: PivotTable | null, filterToBeShown: PivotFilterToBe | null): PivotFilterShown | undefined =>
      pivotTableRead === null || nextPane.listed === null
        ? undefined
        : pivotFiltersToShow(pivotTableRead, filterToBeShown)[nextPane.listed.at],
    listedFilter = listedFilterOf(pivotTable, filterToBe),
    isListedColumnSame =
      listedFilter !== undefined &&
      listedFilter.column === listedFilterOf(pivotTableOfPaneRead(nextPane), nextPane.filterToBe)?.column,
    listedValues = pivotTable !== null && isListedColumnSame ? pivotFilterValuesListed(reads, pivotTable, listedFilter) : 'notToBeListed';
  if (listedValues === null) return nextState;
  let listed: PivotListedInPane | null =
      nextPane.listed !== null && isListedColumnSame
        ? {
            ...nextPane.listed,
            values: listedValues,
          }
        : null,
    settledPane = dropStalePivotTyping(nextPane, {
      ...nextPane,
      read,
      filterToBe,
      listed,
    });
  return (pivotPaneReadsCache.set(settledPane, reads), withPivotTablePane(state, settledPane));
}
export function pivotCellAddress(reads: WorkbookReads, cellId: CellId, localSheetId: SheetId): string {
  let position = readsAsStored(reads).positionOfCell(cellId);
  if (position === null) return '';
  let address = areaToA1AsStored(areaOfPosition(position), null);
  return cellId.sheetId === localSheetId ? address : `${sheetNameOfId(reads, cellId.sheetId)}!${address}`;
}
export function pivotCellOfAddress(reads: WorkbookReads, address: string, localSheetId: SheetId): CellId | null {
  let bang = address.lastIndexOf('!'),
    sheetName = address
      .slice(0, Math.max(bang, 0))
      .trim()
      .replace(/^'(.*)'$/, '$1')
      .toLowerCase(),
    sheet = reads
      .listSheets()
      .find((candidate) => (bang < 0 ? candidate.sheetId === localSheetId : candidate.name.toLowerCase() === sheetName)),
    area = sheet === undefined ? null : parseA1AreaAsSeen(address.slice(bang + 1), sheet);
  if (sheet === undefined || area?.rowCount !== 1 || area.columnCount !== 1) return null;
  return reads.cellIdAt(sheet.sheetId, area.topRowIndex, area.leftColumnIndex);
}
export function pivotSectionsThatCanAdd(pivotTable: PivotTable, table: TableOfASheet, filterToBe: PivotFilterToBe | null): PivotSectionsThatCanAdd {
  let hasUnusedColumns = columnsNotUsedBy(table, pivotRowAndColumnGroupings(pivotTable)).length > 0;
  return {
    rows: hasUnusedColumns,
    columns: hasUnusedColumns && pivotTable.columns === null && pivotTable.values.length === 1,
    values: pivotTable.columns === null,
    filters: filterToBe === null && columnsNotUsedBy(table, pivotTable.filters).length > 0,
  };
}
export function drawnPivotTablePane(state: PageState, reads: WorkbookReads): DrawnPivotTablePane | null {
  let pane = pivotTableOfSidePane(state);
  if (pane === null) return null;
  let cached = drawnPivotPaneCache.get(pane);
  if (cached?.reads === reads) return cached.drawn;
  let drawn: DrawnPivotTablePane = {
    ...pivotTablePaneOf(reads, pane),
    cellId: pane.cellId,
  };
  return (
    drawnPivotPaneCache.set(pane, {
      reads,
      drawn,
    }),
    drawn
  );
}
export function pivotTablePaneOf(reads: WorkbookReads, pane: PivotTableOfPane): PivotTablePaneShown {
  if (pane.read === 'notReadYet')
    return {
      shows: 'nothingYet',
    };
  if (pane.read === 'notToBeRead')
    return {
      shows: 'notRead',
    };
  if (pane.read === 'isNoPivotTable')
    return {
      shows: 'formulaItCannotShow',
    };
  const { pivotTable, table, readsJustTheRecords } = pane.read;
  if (pivotTable === null || pivotTable.filters.some(isNoneOfACellFilter))
    return {
      shows: 'formulaItCannotShow',
    };
  if (table === null)
    return {
      shows: 'tableNotClear',
    };
  let { sheetId } = pivotTable.source,
    lastRecordRow = table.body.findLast(({ role }) => role === 'record')?.lastRow,
    positionOf = (rowId: RowId = table.headerRows.lastRow, columnId: ColumnId = table.firstColumn) =>
      readsAsStored(reads).positionOfCell({
        sheetId,
        rowId,
        columnId,
      }),
    [topLeft, bottomRight] = [positionOf(), positionOf(lastRecordRow, table.lastColumn)],
    kindOfColumn = (columnId: ColumnId): KindOfAColumn => table.columns.find(({ c: candidateId }) => candidateId === columnId)?.kind ?? 'number';
  return {
    shows: 'fields',
    sheetName: sheetNameOfId(reads, sheetId),
    cells:
      topLeft === null || bottomRight === null
        ? ''
        : areaToA1AsStored(
            {
              topRowIndex: topLeft.rowIndex,
              leftColumnIndex: topLeft.columnIndex,
              rowCount: bottomRight.rowIndex - topLeft.rowIndex + 1,
              columnCount: bottomRight.columnIndex - topLeft.columnIndex + 1,
            },
            null,
          ),
    isOutOfDate: !readsJustTheRecords,
    columnsOfTable: table.columns.flatMap(({ c: columnId, name: heading, kind }): PivotColumnOfTable[] => {
      let columnIndex = reads.columnIndexOf(sheetId, columnId);
      return columnIndex === null
        ? []
        : [
            {
              columnId,
              letters: columnLetters(columnIndex),
              heading: heading ?? '',
              kind,
            },
          ];
    }),
    rows: pivotTable.rows,
    columns: pivotTable.columns === null ? [] : [pivotTable.columns],
    values: pivotTable.values.map((value) => {
      let totals = pivotTotalsOfKind(kindOfColumn(value.column));
      return {
        ...value,
        totals: totals.includes(value.total) ? totals : [value.total, ...totals],
      };
    }),
    filters: pivotFiltersToShow(pivotTable, pane.filterToBe).map((filter): PivotFilterInPane => {
      let { column } = filter;
      if (!('listed' in filter))
        return filter.keeps === 'whatACellHolds'
          ? {
              column,
              by: {
                kind: 'cell',
                address: '',
              },
            }
          : {
              column,
              by: {
                kind: 'values',
                keeps: filter.keeps === 'all' ? 'all' : 'oneOf',
                count: 0,
              },
            };
      let { listed, keeps } = filter;
      if (listed.kind === 'written')
        return {
          column,
          by: {
            kind: 'values',
            keeps,
            count: listed.values.length,
          },
        };
      let cellId: CellId = {
        sheetId: listed.sheetId,
        rowId: listed.cell.r,
        columnId: listed.cell.c,
      };
      return {
        column,
        by: {
          kind: 'cell',
          address: pivotCellAddress(reads, cellId, pane.cellId.sheetId),
        },
      };
    }),
    canAdd: pivotSectionsThatCanAdd(pivotTable, table, pane.filterToBe),
    isHeldToOneValue: pivotTable.columns !== null ? 'values' : pivotTable.values.length > 1 ? 'columns' : null,
    listed: pane.listed,
    typed: pane.typed,
  };
}
export function actInPivotTablePane(state: PageState, reads: WorkbookReads, act: PivotTablePaneAct, paneCellId: CellId): PageTransition {
  let pane = pivotTableOfSidePane(state);
  if (pane === null || !isSameCell(pane.cellId, paneCellId) || typeof pane.read !== 'object') return withNoEffects(state);
  if (!(act.kind === 'type' || act.kind === 'dropTyped') && pivotPaneReadsCache.get(pane) !== reads) return withNoEffects(state);
  let { read } = pane,
    { pivotTable, table } = read;
  if (pivotTable === null || table === null) return withNoEffects(state);
  let withPane = (changes: Partial<PivotTableOfPane>, keepsReads: boolean = false): PageState => {
      let nextPane = dropStalePivotTyping(pane, {
          ...pane,
          ...changes,
        }),
        readsBefore = pivotPaneReadsCache.get(pane),
        isListUnchanged = nextPane.listed === null || (nextPane.listed === pane.listed && nextPane.filterToBe === pane.filterToBe);
      if (readsBefore !== undefined && (isListUnchanged || keepsReads)) pivotPaneReadsCache.set(nextPane, readsBefore);
      return withPivotTablePane(state, nextPane);
    },
    changePivotTable = (changes: Partial<PivotTable>, paneChanges: Partial<PivotTableOfPane> = {}, done: PivotTableDone | null = null): PageTransition => {
      let changed: PivotTable = {
          ...pivotTable,
          ...changes,
        },
        beforeEdit: PivotPaneBeforeEdit = {
          read,
          filterToBe: pane.filterToBe,
          listed: pane.listed,
        };
      return queueEdit(
        withPane(
          {
            ...paneChanges,
            read: {
              ...read,
              pivotTable: changed,
            },
            beforeEdit,
          },
          true,
        ),
        {
          kind: 'changePivotTable',
          sheetId: pane.cellId.sheetId,
          cell: cellRefOf(pane.cellId),
          pivotTable: changed,
        },
        {
          ...IF_QUEUED_DEFAULTS,
          select: null,
          done,
          dropsWhatIsHeld: 'ifRefused',
        },
      );
    },
    { rows, columns, values, filters } = pivotTable,
    changeValues = (nextValues: PivotMeasure[], paneChanges: Partial<PivotTableOfPane> = {}): PageTransition => {
      let [first, ...rest] = nextValues;
      return first === undefined
        ? withNoEffects(state)
        : changePivotTable(
            {
              values: [first, ...rest],
            },
            paneChanges,
          );
    },
    changeGrouping = ({ among, at: index }: PivotGroupingAt, changes: Partial<PivotAxis>, paneChanges: Partial<PivotTableOfPane> = {}): PageTransition => {
      let grouping: PivotAxis | null | undefined = among === 'rows' ? rows[index] : columns;
      if (grouping === undefined || grouping === null) return withNoEffects(state);
      let changed: PivotAxis = {
        ...grouping,
        ...changes,
      };
      return changePivotTable(
        among === 'rows'
          ? {
              rows: rows.with(index, changed),
            }
          : {
              columns: changed,
            },
        paneChanges,
      );
    },
    changeValue = (index: number, changes: Partial<PivotMeasure>, paneChanges: Partial<PivotTableOfPane> = {}): PageTransition => {
      let value: PivotMeasure | undefined = values[index];
      return value === undefined
        ? withNoEffects(state)
        : changeValues(
            values.with(index, {
              ...value,
              ...changes,
            }),
            paneChanges,
          );
    },
    filtersShown = pivotFiltersToShow(pivotTable, pane.filterToBe),
    filterToBe = pane.filterToBe,
    placeOfFilter = (index: number) => ({
      place: filterToBe !== null && !filterToBe.hidesOne && filterToBe.at < index ? index - 1 : index,
      count: filterToBe?.at === index && !filterToBe.hidesOne ? 0 : 1,
    }),
    filterToBeAt = (index: number, column: ColumnId, keeps: PivotFilterToBe['keeps']): PivotFilterToBe => {
      let { place, count } = placeOfFilter(index);
      return {
        at: place,
        hidesOne: keeps === 'none' && count === 1,
        column,
        keeps,
      };
    },
    startFilter = (index: number, column: ColumnId, listedValues: PivotListedValues | 'untilACellIsNamed' = 'notReadYet'): PageTransition => {
      let { place, count } = placeOfFilter(index),
        paneChanges: Partial<PivotTableOfPane> =
          listedValues === 'untilACellIsNamed'
            ? {
                filterToBe: filterToBeAt(index, column, 'whatACellHolds'),
                listed: null,
              }
            : {
                filterToBe: filterToBeAt(index, column, 'all'),
                listed: {
                  at: place,
                  values: listedValues,
                },
              };
      return count === 0 || place >= filters.length
        ? withNoEffects(withPane(paneChanges))
        : changePivotTable(
            {
              filters: withoutItemAt(filters, place),
            },
            paneChanges,
          );
    },
    setFilter = (index: number, filter: PivotFilter, paneChanges: Partial<PivotTableOfPane> = {}): PageTransition => {
      let { place, count } = placeOfFilter(index);
      return changePivotTable(
        {
          filters: filters.toSpliced(place, count, filter),
        },
        {
          filterToBe: filterToBe?.at === index ? null : filterToBe,
          ...paneChanges,
        },
      );
    },
    typedAfterEntering = ({ among, at: index }: PivotFieldAt, text: string | undefined = pane.typed?.text): Pick<PivotTableOfPane, 'typed'> => {
      let { typed } = pane;
      return {
        typed: typed?.of.among === among && typed.of.at === index && typed.text === text ? null : typed,
      };
    },
    filterByCell = (index: number, cellId: CellId, text?: string): PageTransition => {
      let filter: PivotFilterShown | undefined = filtersShown[index];
      if (filter === undefined) return withNoEffects(state);
      let listed: PivotListed = {
          kind: 'inACell',
          sheetId: cellId.sheetId,
          cell: cellRefOf(cellId),
        },
        paneChanges = typedAfterEntering(
          {
            among: 'filters',
            at: index,
          },
          text,
        );
      return setFilter(
        index,
        {
          column: filter.column,
          keeps: 'oneOf',
          listed,
        },
        paneChanges,
      );
    },
    tickValues = (isTickedOf: (item: PivotFilterValue, itemIndex: number) => boolean, isWholeList: boolean): PageTransition => {
      let filter: PivotFilterShown | undefined = pane.listed === null ? undefined : filtersShown[pane.listed.at];
      if (typeof pane.listed?.values !== 'object' || filter === undefined) return withNoEffects(state);
      let { at: index, values: listedValues } = pane.listed,
        ticked = listedValues.values.map((item, itemIndex) => ({
          ...item,
          isTicked: isTickedOf(item, itemIndex),
        })),
        namedBeyond = isWholeList ? [] : listedValues.namedBeyondTheList,
        nextListed: PivotFilterValues = {
          ...listedValues,
          values: ticked,
          namedBeyondTheList: namedBeyond,
        },
        keeps: PivotKeeps = filter.keeps === 'oneOf' || filter.keeps === 'none' ? 'oneOf' : 'noneOf',
        named: (PivotWrittenValue | null)[] = [
          ...ticked.filter((item) => item.isTicked === (keeps === 'oneOf')).map(({ value }) => value),
          ...namedBeyond,
        ],
        isAllKnown = isWholeList || !listedValues.areMoreLeftOut,
        tickedCount = ticked.filter((item) => item.isTicked).length,
        isNoneNamed = named.length === 0;
      if ((isAllKnown && tickedCount === ticked.length) || (isNoneNamed && keeps === 'noneOf')) return startFilter(index, filter.column, nextListed);
      if ((isAllKnown && tickedCount === 0) || isNoneNamed) {
        let noneFilter = filterToBeAt(index, filter.column, 'none');
        return withNoEffects(
          withPane({
            filterToBe: noneFilter,
            listed: {
              at: noneFilter.at,
              values: nextListed,
            },
          }),
        );
      }
      let [firstNamed = null, ...restNamed] = named,
        written: PivotListed = {
          kind: 'written',
          values: [firstNamed, ...restNamed],
        };
      return setFilter(
        index,
        {
          column: filter.column,
          keeps,
          listed: written,
        },
        {
          listed: {
            at: index,
            values: nextListed,
          },
        },
      );
    };
  switch (act.kind) {
    case 'add': {
      if (!pivotSectionsThatCanAdd(pivotTable, table, pane.filterToBe)[act.among]) return withNoEffects(state);
      if (act.among === 'values') {
        let unused = columnsNotUsedBy(table, values),
          column = pivotValueColumnOf(unused) ?? unused[0] ?? table.columns[0];
        return column === undefined ? withNoEffects(state) : changeValues([...values, pivotValueOfColumn(column)]);
      }
      let used = act.among === 'filters' ? filters : pivotRowAndColumnGroupings(pivotTable),
        column = pivotRowColumnOf(columnsNotUsedBy(table, used));
      if (column === undefined) return withNoEffects(state);
      if (act.among === 'filters') return startFilter(filters.length, column.c);
      return changePivotTable(
        act.among === 'rows'
          ? {
              rows: [...rows, pivotGroupingOfColumn(column)],
            }
          : {
              columns: pivotGroupingOfColumn(column),
            },
      );
    }
    case 'remove': {
      let { among, at: index } = act.field;
      if (among === 'rows')
        return changePivotTable({
          rows: withoutItemAt(rows, index),
        });
      if (among === 'columns')
        return changePivotTable({
          columns: null,
        });
      if (among === 'values') return changeValues(withoutItemAt(values, index));
      let paneChanges: Partial<PivotTableOfPane> = {
          filterToBe: null,
          listed: null,
        },
        { place, count } = placeOfFilter(index);
      return count === 1
        ? changePivotTable(
            {
              filters: withoutItemAt(filters, place),
            },
            paneChanges,
          )
        : withNoEffects(withPane(paneChanges));
    }
    case 'setColumn': {
      let column = table.columns.find(({ c: columnId }) => columnId === act.column);
      if (column === undefined) return withNoEffects(state);
      let { among, at: index } = act.field;
      if (among === 'values') {
        let { total } = pivotValueOfColumn(column, values[index]?.total);
        return changeValue(index, {
          column: column.c,
          total,
          name: null,
        });
      }
      if (among !== 'filters')
        return changeGrouping(
          {
            among,
            at: index,
          },
          pivotGroupingOfColumn(column),
        );
      let filter: PivotFilterShown | undefined = filtersShown[index];
      if (filter === undefined) return withNoEffects(state);
      if (filter.keeps === 'whatACellHolds')
        return withNoEffects(
          withPane({
            filterToBe: {
              ...filter,
              column: column.c,
            },
          }),
        );
      return 'listed' in filter && filter.listed.kind === 'inACell'
        ? setFilter(index, {
            ...filter,
            column: column.c,
          })
        : startFilter(index, column.c);
    }
    case 'setPeriod':
      return changeGrouping(act.field, {
        by: act.by,
      });
    case 'setOrder':
      return changeGrouping(act.field, {
        order: act.order,
      });
    case 'setTotal':
      return changeValue(act.at, {
        total: act.total,
      });
    case 'setOrderByValue':
      return changeValues(
        values.map(({ column, total, name }, index) => ({
          column,
          total,
          name,
          order: index === act.at ? act.order : null,
        })),
      );
    case 'type':
      return withNoEffects(
        withPane({
          typed: {
            of: act.field,
            text: act.text,
          },
        }),
      );
    case 'dropTyped':
      return withNoEffects(
        withPane({
          typed: null,
        }),
      );
    case 'enterTyped': {
      let { field, text } = act,
        paneChanges = typedAfterEntering(field, text);
      if (field.among === 'filters') {
        if (text.trim() === '') return withNoEffects(withPane(paneChanges));
        let cellId = pivotCellOfAddress(reads, text, pane.cellId.sheetId);
        if (cellId !== null) return filterByCell(field.at, cellId, text);
        return withNoEffects(
          withPane({
            typed: paneChanges.typed ?? {
              of: field,
              text,
              isRefused: true,
            },
          }),
        );
      }
      let name = text.trim() === '' ? null : text.trim();
      return field.among === 'values'
        ? changeValue(
            field.at,
            {
              name,
            },
            paneChanges,
          )
        : changeGrouping(
            field,
            {
              name,
            },
            paneChanges,
          );
    }
    case 'filterBy': {
      let filter: PivotFilterShown | undefined = filtersShown[act.at];
      if (filter === undefined) return withNoEffects(state);
      let listedValues: 'notReadYet' | 'untilACellIsNamed' = act.by === 'values' ? 'notReadYet' : 'untilACellIsNamed';
      return startFilter(act.at, filter.column, listedValues);
    }
    case 'useSelection':
      return filterByCell(act.at, state.activeCell);
    case 'toggleList':
      return withNoEffects(
        withPane({
          listed:
            pane.listed?.at === act.at
              ? null
              : {
                  at: act.at,
                  values: 'notReadYet',
                },
        }),
      );
    case 'tick':
      return tickValues(({ isTicked }, index) => (index === act.index ? act.isTicked : isTicked), false);
    case 'tickAll':
      return tickValues(() => act.isTicked, true);
    case 'update':
      return changePivotTable(
        {},
        {},
        {
          what: 'pivotTableUpdated',
        },
      );
  }
}
/** The most values of a source column listed under a filter; a blank is listed even past them. */
export const MAX_PIVOT_FILTER_VALUES_LISTED = 200;
export const pivotTableOfSidePane = ({ sidePane }: Pick<PageState, 'sidePane'>): PivotTableOfPane | null =>
  sidePane?.kind === 'pivotTable' ? sidePane.pivotTable : null;
export const withPivotTablePane = (state: PageState, pane: PivotTableOfPane): PageState => ({
  ...state,
  sidePane: {
    kind: 'pivotTable',
    pivotTable: pane,
  },
});
export const freshPivotTablePane = (cellId: CellId): PivotTableOfPane => ({
  cellId,
  read: 'notReadYet',
  filterToBe: null,
  listed: null,
  typed: null,
  beforeEdit: null,
});
/** A formula that makes a pivot table. */
export const PIVOT_FORMULA_PATTERN = /^=\s*PIVOT\s*\(/i;
export const pivotTableCellsOfSheet = (reads: WorkbookReads, sheetId: SheetId): CellId[] =>
  reads
    .cellsWithSpillIn(sheetId)
    .filter(({ formulaText }) => PIVOT_FORMULA_PATTERN.test(formulaText ?? ''))
    .map(({ r: rowId, c: columnId }) => ({
      sheetId,
      rowId,
      columnId,
    }));
export const PIVOT_COUNT_TOTALS: PivotTotal[] = ['count', 'distinctCount'];
export const pivotGroupingOfColumn = ({ c: columnId, kind }: PivotSourceColumn): PivotAxis => ({
  column: columnId,
  by: kind === 'date' ? 'month' : null,
  order: 'ascending',
  name: null,
});
export const pivotValueOfColumn = ({ c: columnId, kind }: PivotSourceColumn, preferredTotal?: PivotTotal): PivotMeasure => {
  let totals = pivotTotalsOfKind(kind),
    total = totals.find((candidate) => candidate === preferredTotal) ?? totals[0] ?? 'count';
  return {
    column: columnId,
    total,
    order: null,
    name: null,
  };
};
export const firstColumnOfKinds = (columns: PivotSourceColumn[], kinds: KindOfAColumn[]): PivotSourceColumn | undefined =>
  kinds.map((kind) => columns.find((column) => column.kind === kind)).find((column) => column !== undefined);
export const pivotRowColumnOf = (columns: PivotSourceColumn[]): PivotSourceColumn | undefined =>
  firstColumnOfKinds(columns, ['fewWords', 'checkbox', 'date', 'text']) ?? columns[0];
export const pivotValueColumnOf = (columns: PivotSourceColumn[]): PivotSourceColumn | undefined =>
  firstColumnOfKinds(columns, ['currency']) ?? firstColumnOfKinds(columns.toReversed(), ['number', 'percent']);
export const pivotFiltersToShow = ({ filters }: Pick<PivotTable, 'filters'>, filterToBe: PivotFilterToBe | null): PivotFilterShown[] =>
  filterToBe === null
    ? filters
    : [...filters.slice(0, filterToBe.at), filterToBe, ...filters.slice(filterToBe.at + (filterToBe.hidesOne ? 1 : 0))];
/** A value as a key that tells it from the others whatever the case of its text. */
export const pivotValueKey = (value: PivotWrittenValue | null): string => JSON.stringify(value).toLowerCase();
export const pivotTableOfPaneRead = ({ read }: Pick<PivotTableOfPane, 'read'>): PivotTable | null =>
  typeof read === 'object' ? read.pivotTable : null;
/** The columns of the fields the pane shows, as a key that changes when a field is added, removed or moved. */
export const pivotFieldsKey = (pane: Pick<PivotTableOfPane, 'read' | 'filterToBe'>): string => {
  let pivotTable = pivotTableOfPaneRead(pane);
  if (pivotTable === null) return '';
  let { rows, columns, values } = pivotTable,
    filters = pivotFiltersToShow(pivotTable, pane.filterToBe);
  return JSON.stringify(
    [rows, columns === null ? [] : [columns], values, filters].map((fields: readonly { column: ColumnId }[]) =>
      fields.map(({ column }) => column),
    ),
  );
};
/** The read of the workbook each pane was settled against. */
export const pivotPaneReadsCache = new WeakMap<PivotTableOfPane, WorkbookReads>();
export const pivotPaneAfterChange = (pane: PivotTableOfPane, isKept: boolean): PivotTableOfPane =>
  dropStalePivotTyping(pane, {
    ...pane,
    ...(!isKept && pane.beforeEdit),
    beforeEdit: null,
  });
export const sheetNameOfId = (reads: WorkbookReads, sheetId: SheetId): string =>
  reads.listSheets().find((sheet) => sheet.sheetId === sheetId)?.name ?? '';
export const columnsNotUsedBy = ({ columns }: Pick<TableOfASheet, 'columns'>, used: readonly { column: ColumnId }[]): PivotSourceColumn[] =>
  columns.filter(({ c: columnId }) => !used.some(({ column: usedColumn }) => usedColumn === columnId));
export const pivotRowAndColumnGroupings = ({ rows, columns }: Pick<PivotTable, 'rows' | 'columns'>): PivotAxis[] =>
  columns === null ? rows : [...rows, columns];
export const drawnPivotPaneCache = new WeakMap<PivotTableOfPane, DrawnPivotTablePaneCached>();
export const isNoneOfACellFilter = ({ keeps, listed }: PivotFilter): boolean => keeps === 'noneOf' && listed.kind === 'inACell';
export const withoutItemAt = <Item>(items: readonly Item[], index: number): Item[] => items.toSpliced(index, 1);
