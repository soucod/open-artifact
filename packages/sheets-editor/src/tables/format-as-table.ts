import type { EngineCellTable } from '@open-artifact/sheets-core';
import { areasOfAllRanges, isAreaWithin } from '../selection/several-ranges.ts';
import { placedTablesOfSheet, areaOfFilteredTable, isTableCertain, tableEdgesOf, hasCellsOnShowIn, tablesReadState } from './finding.ts';
import { outlinableTablesOf } from './tables-in-view.ts';
import { areasOverlap } from '../model/workbook.ts';
import { ownFiltersOfSheet } from './own-filters.ts';
import { hasNoUnformattedMark, unformattedMarksInHeader } from '../grid/sticky-headers.ts';
import { withNoEffects } from '../state/transitions.ts';
import { keepActiveCellClearOfStuckHeaders } from '../selection/keep-in-view.ts';
import { IF_QUEUED_DEFAULTS, queueEdit } from '../model/edit-effects.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState, TableNotFormatted } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { FormatAsTableChosen, IfQueued } from '../state/event-reducer.ts';
import type { OutlinableTable } from './tables-in-view.ts';
/** What formatting the selected table as a table does: take its declared table away, only change how it looks, or declare one. */
export type FormatAsTableChoice =
  | { kind: 'remove'; table: OutlinableTable; cellTableId: string }
  | { kind: 'look'; table: OutlinableTable; isOn: boolean }
  | { kind: 'declare'; cellTable: EngineCellTable };
/** What formatting as a table tells it did, both as the last thing done and once its edit is queued. */
interface FormatAsTableDone {
  what: 'formattedAsTable' | 'notFormattedAsTable';
}
/** How the menu offers formatting as a table: whether choosing it turns it on, and whether everyone sees the change. */
export interface FormatAsTableOffer {
  isOn: boolean;
  isForEveryone: boolean;
}
export function tableHoldingSelectionToFormat(state: PageState, workbook: WorkbookReads): OutlinableTable | null {
  const areas = areasOfAllRanges(state, workbook);
  if (areas.length === 0) return null;
  const tables = placedTablesOfSheet(state, workbook, state.sheetId).certain.filter(
    ({ area }) => areas.every((areaSelected) => isAreaWithin(areaSelected, area)),
  );
  return (
    outlinableTablesOf(
      tables,
      {
        ...state,
        tablesNotFormatted: [],
      },
      workbook,
    )[0] ?? null
  );
}
export function cellTableToDeclareAtSelection(state: PageState, workbook: WorkbookReads): EngineCellTable | null {
  const { sheetId } = state;
  const [area, ...otherAreas] = areasOfAllRanges(state, workbook);
  if (area === undefined || otherAreas.length > 0) return null;
  const tablesHit = placedTablesOfSheet(state, workbook, sheetId).all.filter((placed) => areasOverlap(area, placed.area));
  if (
    ownFiltersOfSheet(state, sheetId).some((ownFilter) => {
      const filteredArea = areaOfFilteredTable(workbook, ownFilter);
      return filteredArea !== null && areasOverlap(area, filteredArea);
    }) ||
    tablesHit.some((placed) => isTableCertain(placed.table) && hasNoUnformattedMark(state, placed, workbook))
  )
    return null;
  const [firstHit, ...otherHits] = tablesHit;
  if (firstHit === undefined) return null;
  const headerRow = Math.max(area.topRowIndex, Math.min(...tablesHit.map(({ header }) => header.first)));
  const columns = {
    first: Math.max(area.leftColumnIndex, Math.min(...tablesHit.map((placed) => placed.columns.first))),
    last: Math.min(area.leftColumnIndex + area.columnCount - 1, Math.max(...tablesHit.map((placed) => placed.columns.last))),
  };
  if (
    otherHits.length === 0 &&
    (area.rowCount < 2 || columns.last - columns.first + 1 < firstHit.area.columnCount || headerRow <= firstHit.header.last + 1)
  )
    return isTableCertain(firstHit.table) || firstHit.body === null ? null : tableEdgesOf(firstHit.table);
  const hasCellsOnShowInRow = (row: number) =>
    hasCellsOnShowIn(
      sheetId,
      {
        first: row,
        last: row,
      },
      columns,
      workbook,
    );
  const firstCell = workbook.cellIdAt(sheetId, headerRow, columns.first);
  const lastCell = workbook.cellIdAt(sheetId, headerRow, columns.last);
  if (firstCell === null || lastCell === null || !hasCellsOnShowInRow(headerRow) || !hasCellsOnShowInRow(headerRow + 1)) return null;
  return {
    headerRows: {
      firstRow: firstCell.rowId,
      lastRow: firstCell.rowId,
    },
    firstColumn: firstCell.columnId,
    lastColumn: lastCell.columnId,
    footerRows: null,
  };
}
export function formatAsTableChoice(state: PageState, workbook: WorkbookReads, canEdit: boolean): FormatAsTableChoice | null {
  const table = tableHoldingSelectionToFormat(state, workbook);
  const basis = table?.table.basis;
  const canDeclare = canEdit && tablesReadState(state, state.sheetId) === 'asTheyAre';
  if (table !== null && basis?.kind === 'declared')
    return canDeclare
      ? {
          kind: 'remove',
          table,
          cellTableId: basis.cellTableId,
        }
      : null;
  if (table !== null && hasNoUnformattedMark(state, table, workbook))
    return {
      kind: 'look',
      table,
      isOn: false,
    };
  const cellTable = canDeclare ? cellTableToDeclareAtSelection(state, workbook) : null;
  if (cellTable !== null)
    return {
      kind: 'declare',
      cellTable,
    };
  return table === null
    ? null
    : {
        kind: 'look',
        table,
        isOn: true,
      };
}
export function formatAsTableState(state: PageState, workbook: WorkbookReads, canEdit: boolean): FormatAsTableOffer | null {
  const choice = formatAsTableChoice(state, workbook, canEdit);
  return choice === null
    ? null
    : {
        isOn: !isFormatAsTableChoiceOn(choice),
        isForEveryone: choice.kind !== 'look',
      };
}
export function tablesNotFormattedAfterChoice(
  marks: readonly TableNotFormatted[],
  table: OutlinableTable,
  isOn: boolean,
  workbook: WorkbookReads,
): TableNotFormatted[] {
  const { headerRows, firstColumn } = table.table;
  const marksInHeader = unformattedMarksInHeader(table, marks, workbook);
  const keptMarks = marks.filter((mark) => !marksInHeader.includes(mark));
  return isOn
    ? keptMarks
    : [
        ...keptMarks,
        {
          sheetId: table.sheetId,
          rowId: headerRows.firstRow,
          columnId: firstColumn,
        },
      ];
}
export function setFormatAsTable(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  canEdit: boolean,
  { isOn, kept }: Pick<FormatAsTableChosen, 'isOn' | 'kept'>,
): PageTransition {
  const choice = formatAsTableChoice(state, workbook, canEdit);
  const closed = {
    ...state,
    menu: null,
  };
  const done: FormatAsTableDone = {
    what: isOn ? 'formattedAsTable' : 'notFormattedAsTable',
  };
  const marks = kept ?? state.tablesNotFormatted;
  if (choice?.kind === 'look') {
    const looked = {
      ...closed,
      tablesNotFormatted: tablesNotFormattedAfterChoice(marks, choice.table, isOn, workbook),
      formatAsTableChosenLast: {
        isOn,
        before: marks,
      },
      ownSortChosenLast: null,
      lastDone: done,
    };
    return withNoEffects(keepActiveCellClearOfStuckHeaders(state, looked, workbook));
  }
  if (choice === null || isFormatAsTableChoiceOn(choice) !== isOn) return withNoEffects(closed);
  const { sheetId } = state;
  const ifQueued: IfQueued = {
    ...IF_QUEUED_DEFAULTS,
    select: null,
    done,
  };
  if (choice.kind === 'declare') {
    const { cellTable } = choice;
    const scroll = {
      scrollLeft: state.scrollLeft,
      scrollTop: state.scrollTop,
    };
    return queueEdit(
      {
        ...closed,
        leftByKeyAt: scroll,
      },
      {
        kind: 'declareCellTable',
        sheetId,
        cellTable,
        isAskedFor: true,
      },
      ifQueued,
    );
  }
  return queueEdit(
    {
      ...closed,
      tablesNotFormatted: tablesNotFormattedAfterChoice(marks, choice.table, false, workbook),
    },
    {
      kind: 'removeCellTable',
      sheetId,
      cellTableId: choice.cellTableId,
    },
    ifQueued,
  );
}
export function undoFormatAsTableChosenLast(state: PageState, workbook: ReadsWithTextMeasurer): PageState | null {
  if (state.formatAsTableChosenLast === null) return null;
  const { isOn, before } = state.formatAsTableChosenLast;
  const undone: PageState = {
    ...state,
    tablesNotFormatted: before,
    formatAsTableChosenLast: null,
    lastDone: {
      what: isOn ? 'notFormattedAsTable' : 'formattedAsTable',
    },
  };
  return keepActiveCellClearOfStuckHeaders(state, undone, workbook);
}
export const isFormatAsTableChoiceOn = (choice: FormatAsTableChoice): boolean => (choice.kind === 'look' ? choice.isOn : choice.kind === 'declare');
