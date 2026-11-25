import { pivotTableCellsOfSheet, pivotTableOfSidePane } from '../tables/pivot-tables.ts';
import { isSameCell } from '../selection/model.ts';
import { withNoEffects } from './transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { cellRefOf } from '../model/workbook.ts';
import type { PivotTable, PivotTableAtAnswer, Refused, SheetId } from '@open-artifact/sheets-core';
import type { PageState } from './initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageTransition } from './transitions.ts';
export function withPivotTablesOutOfDate(state: PageState, reads: WorkbookReads): PageState {
  if (sheetCheckedForPivotTables.get(reads) === state.sheetId) return state;
  let outOfDateBefore = state.pivotTablesOutOfDateAt;
  let cells = pivotTableCellsOfSheet(reads, state.sheetId).slice(0, MOST_PIVOT_TABLES_CHECKED);
  let answers: (PivotTableAtAnswer | Refused | null)[] = cells.map((cell) => reads.pivotTableAt(cell));
  if (answers.includes(null)) sheetCheckedForPivotTables.delete(reads);
  else sheetCheckedForPivotTables.set(reads, state.sheetId);
  let outOfDate = cells.filter((cell, index) => {
    let answer = answers[index] ?? null;
    if (answer === null) return outOfDateBefore.some((before) => isSameCell(before, cell));
    let read = answer.kind === 'pivotTableAt' ? answer.read : null;
    return read !== null && read.pivotTable !== null && read.table !== null && !read.readsJustTheRecords;
  });
  return JSON.stringify(outOfDate) === JSON.stringify(outOfDateBefore)
    ? state
    : {
        ...state,
        pivotTablesOutOfDateAt: outOfDate,
      };
}
export function pivotTableOutOfDateShown(state: PageState): CellId | null {
  let pivotTableInPane = pivotTableOfSidePane(state);
  let isShown = (cell: CellId): boolean =>
    cell.sheetId === state.sheetId && (pivotTableInPane === null || !isSameCell(pivotTableInPane.cellId, cell));
  return state.pivotTablesOutOfDateAt.find(isShown) ?? null;
}
export function updatePivotTable(state: PageState, reads: WorkbookReads, cell: CellId): PageTransition {
  let answer: PivotTableAtAnswer | Refused | null = reads.pivotTableAt(cell);
  let pivotTable: PivotTable | null = answer?.kind === 'pivotTableAt' ? (answer.read?.pivotTable ?? null) : null;
  if (pivotTable === null) return withNoEffects(state);
  return queueEdit(
    state,
    {
      kind: 'changePivotTable',
      sheetId: cell.sheetId,
      cell: cellRefOf(cell),
      pivotTable,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: 'pivotTableUpdated',
      },
    },
  );
}
/** The most pivot tables of a sheet read to tell which are out of date. */
export const MOST_PIVOT_TABLES_CHECKED = 10;
/** The sheet whose pivot tables were checked against each read of the workbook. */
export const sheetCheckedForPivotTables = new WeakMap<WorkbookReads, SheetId>();
