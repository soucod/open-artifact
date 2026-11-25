import { isInSpan } from '../grid/geometry.ts';
import { rangeSortArea, sheetSortArea, sortColumnIndex, headingRowCountByFreeze } from '../tables/sort.ts';
import { layoutOfView, sheetOfViewOrEmpty } from '../grid/layout.ts';
import { isLineShown } from '../model/line-sizes.ts';
import { anchorCellOf } from '../selection/model.ts';
import { peopleNamesOfCell } from './find.ts';
import { cellShownText } from '../clipboard/text-escaping.ts';
import { columnLetters } from '../model/a1-references.ts';
import { flattenEnteredText } from '../format/shown-text.ts';
import type { PageState, SortColumnsPointedAt } from '../state/initial-state.ts';
import type { ColumnId } from '@open-artifact/sheets-core';
import type { CellId, SheetRead, WorkbookReads } from '../model/workbook.ts';
import type { CellPosition } from '../selection/model.ts';
import type { GridHit } from '../grid/geometry.ts';
import type { RowsToSort } from '../tables/sort.ts';
import type { SortPaneColumn } from '../tables/sort-pane.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
export function filledColumnIndexesOf({ sheetId }: Pick<PageState, 'sheetId'>, workbook: WorkbookReads): number[] {
  let sheet = workbook.sheetAsItStands(sheetId);
  let cached = sheet === null ? undefined : filledColumnIndexesCache.get(sheet);
  if (sheet === null || cached !== undefined) return cached ?? [];
  let columnIds = new Set<ColumnId>();
  let columnIndexes = new Set<number>();
  for (let [rowId, cellsOfRow] of workbook.cellsHeldByRow(sheetId)) {
    if (workbook.rowIndexOf(sheetId, rowId) === null) continue;
    for (let columnId of cellsOfRow.keys()) columnIds.add(columnId);
    for (let { c: columnId, spill } of cellsOfRow.cellsWithUsersARichTextOrASpill()) {
      if (spill?.kind !== 'fills') continue;
      let fromIndex = workbook.columnIndexOf(sheetId, columnId);
      let toIndex = workbook.columnIndexOf(sheetId, spill.to.c);
      if (fromIndex === null || toIndex === null) continue;
      for (let index = fromIndex; index <= toIndex; index += 1) columnIndexes.add(index);
    }
  }
  for (let columnId of columnIds) {
    let columnIndex = workbook.columnIndexOf(sheetId, columnId);
    if (columnIndex !== null) columnIndexes.add(columnIndex);
  }
  let sortedIndexes = [...columnIndexes];
  sortedIndexes.sort((left, right) => left - right);
  filledColumnIndexesCache.set(sheet, sortedIndexes);
  return sortedIndexes;
}
export function columnHasCellsInRows(
  workbook: WorkbookReads,
  { sheetId, columnId }: Pick<CellId, 'sheetId' | 'columnId'>,
  { topRowIndex, rowCount }: RowsToSort,
): boolean {
  for (let rowId of workbook.rowsAsTheyStand(sheetId).keys()) {
    if (
      workbook.cellOnShowIn({
        sheetId,
        rowId,
        columnId,
      }) === null
    )
      continue;
    let rowIndex = workbook.rowIndexOf(sheetId, rowId);
    if (rowIndex !== null && isInSpan(rowIndex, topRowIndex, rowCount)) return true;
  }
  return false;
}
export function sortColumnsPointedAtOf(state: PageState, workbook: ReadsWithTextMeasurer, pointedAt: GridHit): SortColumnsPointedAt {
  if (pointedAt.kind === 'rowHeader' || pointedAt.kind === 'corner') return NO_SORT_COLUMNS_POINTED_AT;
  let { sheetId } = state;
  let columnId = workbook.cellIdAt(sheetId, 0, pointedAt.columnIndex)?.columnId;
  if (columnId === undefined || columnId === state.activeCell.columnId) return NO_SORT_COLUMNS_POINTED_AT;
  let columnIfFilledIn = (rows: RowsToSort | null) =>
    rows !== null &&
    columnHasCellsInRows(
      workbook,
      {
        sheetId,
        columnId,
      },
      rows,
    )
      ? columnId
      : null;
  return {
    range: columnIfFilledIn(rangeSortArea(state, workbook)),
    sheet: columnIfFilledIn(sheetSortArea(state, workbook)),
  };
}
export function columnsOfferedToSortBy(state: PageState, workbook: ReadsWithTextMeasurer): SortPaneColumn[] {
  let { sheetId } = state;
  let { columnEdges } = layoutOfView(state, workbook);
  let columnIndexes = new Set(
    filledColumnIndexesOf(state, workbook)
      .filter((columnIndex) => isLineShown(columnEdges, columnIndex))
      .slice(0, MAX_COLUMNS_OFFERED_TO_SORT_BY),
  );
  for (let columnId of [null, state.menu?.sortColumnsPointedAt?.sheet ?? null]) {
    let columnIndex = sortColumnIndex(state, workbook, columnId);
    if (columnIndex !== null) columnIndexes.add(columnIndex);
  }
  let sortedIndexes = [...columnIndexes];
  sortedIndexes.sort((left, right) => left - right);
  let headingRowIndex = headingRowCountByFreeze(state, workbook) - 1;
  return sortedIndexes.flatMap((columnIndex): SortPaneColumn[] => {
    let cellId = workbook.cellIdAt(sheetId, headingRowIndex, columnIndex);
    if (cellId === null) return [];
    let cell = workbook.cellOnShowIn(anchorCellOf(workbook, cellId));
    let heading = peopleNamesOfCell(cell, state.profilesById) ?? cellShownText(cell, workbook.decimalSign);
    return [
      {
        columnId: cellId.columnId,
        letters: columnLetters(columnIndex),
        heading: flattenEnteredText(heading).trim(),
      },
    ];
  });
}
export function pickColumnToSortBy(state: PageState, workbook: ReadsWithTextMeasurer, columnId: ColumnId): PageState {
  let { menu } = state;
  if (menu?.holds !== 'all') return state;
  return columnsOfferedToSortBy(state, workbook).some((column) => column.columnId === columnId)
    ? {
        ...state,
        menu: {
          ...menu,
          sortColumnPicked: columnId,
        },
      }
    : state;
}
export function headingTextAt(
  state: PageState,
  workbook: WorkbookReads,
  { rowIndex, columnIndex }: CellPosition,
  takesAnyKind: boolean,
): string {
  let { sheetId } = state;
  let cellId = workbook.cellIdAt(sheetId, rowIndex, columnIndex);
  if (cellId === null) return '';
  let cellCorner = {
    topRowIndex: rowIndex,
    leftColumnIndex: columnIndex,
  };
  let isInWideMerge = workbook
    .mergedAreasIn(sheetId, {
      ...cellCorner,
      rowCount: 1,
      columnCount: 1,
    })
    .some(({ columnCount }) => columnCount > 1);
  let cell = workbook.cellOnShowIn(anchorCellOf(workbook, cellId));
  if (cell === null || isInWideMerge) return '';
  let cellValue = 'input' in cell ? (cell.value ?? cell.input) : cell.value;
  let text =
    peopleNamesOfCell(cell, state.profilesById) ?? (takesAnyKind || cellValue.kind === 'text' ? cellShownText(cell, workbook.decimalSign) : '');
  return flattenEnteredText(text).trim();
}
export function lacksHeadingRow(state: PageState, workbook: WorkbookReads, cells: CellId[]): boolean {
  if (sheetOfViewOrEmpty(state, workbook).frozenRowCount > 0) return false;
  let headingRowIndex = headingRowCountByFreeze(state, workbook) - 1;
  let headingCount = 0;
  for (let { sheetId, columnId } of cells) {
    let columnIndex = workbook.columnIndexOf(sheetId, columnId);
    if (columnIndex === null) continue;
    if (
      headingTextAt(
        state,
        workbook,
        {
          rowIndex: headingRowIndex,
          columnIndex,
        },
        true,
      ) !== ''
    )
      headingCount += 1;
    if (headingCount === 2) return false;
  }
  return headingCount < cells.length;
}
export function headingToSortBy(state: PageState, workbook: ReadsWithTextMeasurer, scope: 'sheet' | 'range', columnId: ColumnId | null): string {
  let columnIndex = sortColumnIndex(state, workbook, columnId);
  let topRowIndex = headingRowCountByFreeze(state, workbook);
  let { columnCount } = layoutOfView(state, workbook);
  let area =
    scope === 'sheet'
      ? {
          topRowIndex,
          leftColumnIndex: 0,
          columnCount,
        }
      : rangeSortArea(state, workbook);
  if (columnIndex === null || area?.topRowIndex !== topRowIndex) return '';
  let topRowCells = workbook.cellsOnShowIn(state.sheetId, {
    ...area,
    rowCount: 1,
  });
  return lacksHeadingRow(state, workbook, topRowCells) ? '' : sortHeadingOfColumn(state, workbook, columnIndex);
}
export const filledColumnIndexesCache = new WeakMap<SheetRead, number[]>();
export const NO_SORT_COLUMNS_POINTED_AT: SortColumnsPointedAt = {
  range: null,
  sheet: null,
};
export const MAX_COLUMNS_OFFERED_TO_SORT_BY = 100;
export const sortHeadingOfColumn = (state: PageState, workbook: WorkbookReads, columnIndex: number): string =>
  headingTextAt(
    state,
    workbook,
    {
      rowIndex: headingRowCountByFreeze(state, workbook) - 1,
      columnIndex,
    },
    sheetOfViewOrEmpty(state, workbook).frozenRowCount > 0,
  );
