import { boundsOfTableToSort } from '../selection/table-select.ts';
import { layoutOfView, sheetOfViewOrEmpty } from '../grid/layout.ts';
import { COLUMN_HEADER_HEIGHT } from '../grid/cell-metrics.ts';
import { cellsHeightAboveFloats, rowPanes, shownRowIndicesInPane, columnPanes, shownColumnIndicesInPane } from '../grid/geometry.ts';
import { formulaTextOf, cellValueOf } from '../model/cell-values.ts';
import { findFormulaReferences, formulaMatchesOutsideReferences, resolveFormulaReference } from '../formulas/references.ts';
import { areasOverlap, tableAtCellIfAny } from '../model/workbook.ts';
import { isAreaWithin, hasOtherRanges } from '../selection/several-ranges.ts';
import { cachedSelectedArea } from '../presence/selections.ts';
import { isSameArea, selectedArea } from '../selection/model.ts';
import { ownFiltersOfSheet } from './own-filters.ts';
import { areaOfFilteredTable, isPlainListTable } from './finding.ts';
import { pivotTableCellAt } from './pivot-tables.ts';
import { headingRowCountByFreeze, sortHoldsOfColumn } from './sort.ts';
import { withNoEffects, sortColumnOfMenu } from '../state/transitions.ts';
import { openSortPane, sortTableWithKeys } from './sort-pane.ts';
import type { SheetId } from '@open-artifact/sheets-core';
import type { PageState, SortHoldsOfColumn, TableToSort, TableUnderLetters } from '../state/initial-state.ts';
import type { CellId, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CellArea } from '../selection/model.ts';
import type { BoundsOfTableToSort, RowsAndColumnsOfTableToSort } from '../selection/table-select.ts';
import type { ColumnSpan } from '../grid/sticky-headers.ts';
import type { RowsToSort, SheetSortChange } from './sort.ts';
import type { SortKey } from './sort-pane.ts';
/**
 * A table with a header found at a cell, as areas to sort: its rows and columns as ids, whether its header is sure,
 * and whether it holds only records (with blank rows between) and any blank rows.
 */
export interface HeadedTableBounds extends BoundsOfTableToSort {
  ids: RowsAndColumnsOfTableToSort;
  isHeaderSure: boolean;
  isAPlainList: boolean;
  holdsRecordsOnly: boolean;
  holdsBlankRows: boolean;
}
/** How a sort of a table moves its cells: whole rows or the cells alone, and the columns it moves. */
export interface SortMove extends ColumnSpan {
  moves: TableToSort['moves'];
}
/** Where a table to sort is asked of: a cell of it, or the letters of its columns. */
export type TableToSortAskedFrom = 'cell' | 'letters';
/** The table under the selected column letters, the cell its records are first shown at, and all of its area. */
export interface TableUnderSelectedLetters extends TableUnderLetters {
  at: CellId;
  extent: CellArea;
}
export function headedTableBoundsAtCell(workbook: WorkbookReads, cellId: CellId): HeadedTableBounds | null {
  let tableAtCell = tableAtCellIfAny(workbook, cellId);
  let table = tableAtCell?.table;
  if (tableAtCell === null || table === undefined || table.header === null) return null;
  let {
    sheetId,
    header,
    firstColumn,
    lastColumn,
    firstRowOfBody,
    lastRowOfBody,
    runs,
  } = table;
  let ids = {
    firstRowOfHeader: header.firstRow,
    firstRecord: firstRowOfBody,
    lastRecord: lastRowOfBody,
    firstColumn,
    lastColumn,
  };
  let bounds = boundsOfTableToSort(workbook, sheetId, ids);
  if (bounds === null || workbook.rowIndexOf(sheetId, header.lastRow) !== bounds.records.topRowIndex - 1) return null;
  return {
    ...bounds,
    ids,
    isHeaderSure: header.isSure,
    isAPlainList: isPlainListTable(tableAtCell),
    holdsRecordsOnly: runs.every(({ role }) => role === 'record' || role === 'spacer'),
    holdsBlankRows: runs.some(({ role }) => role === 'spacer'),
  };
}
export function shownRowIndexesWithoutFloats(state: PageState, workbook: ReadsWithTextMeasurer): number[] {
  let layout = layoutOfView(state, workbook);
  let stateWithoutFloats = {
    ...state,
    gridHeight: COLUMN_HEADER_HEIGHT + cellsHeightAboveFloats(state),
    heightUnderWhatFloats: 0,
  };
  return rowPanes(state, layout, stateWithoutFloats).flatMap((pane) => shownRowIndicesInPane(pane, layout));
}
export function isAreaInView(state: PageState, workbook: ReadsWithTextMeasurer, area: CellArea): boolean {
  let layout = layoutOfView(state, workbook);
  let stateWithoutFloats = {
    ...state,
    gridHeight: COLUMN_HEADER_HEIGHT + cellsHeightAboveFloats(state),
    heightUnderWhatFloats: 0,
  };
  return (
    shownRowIndexesWithoutFloats(state, workbook).some((rowIndex) => isIndexWithinSpan(rowIndex, area.topRowIndex, area.rowCount)) &&
    columnPanes(state, layout, stateWithoutFloats).some(
      (pane) =>
        shownColumnIndicesInPane(pane, layout).some(
          (columnIndex) => isIndexWithinSpan(columnIndex, area.leftColumnIndex, area.columnCount),
        ),
    )
  );
}
export function hasNoRecordsToSort(workbook: WorkbookReads, cellId: CellId): boolean {
  let table = tableAtCellIfAny(workbook, cellId)?.table;
  return table === undefined || (table.header === null && table.firstRowOfBody === table.lastRowOfBody);
}
export function columnRunsOf(columnIndexes: readonly number[]): ColumnSpan[] {
  let runs: ColumnSpan[] = [];
  for (let columnIndex of columnIndexes) {
    let lastRun = runs.at(-1);
    if (lastRun !== undefined && columnIndex === lastRun.leftColumnIndex + lastRun.columnCount)
      runs[runs.length - 1] = {
        ...lastRun,
        columnCount: lastRun.columnCount + 1,
      };
    else
      runs.push({
        leftColumnIndex: columnIndex,
        columnCount: 1,
      });
  }
  return runs;
}
export function isFormulaRunTiedToRecords(
  workbook: WorkbookReads,
  sheets: readonly SheetSummary[],
  sheetId: SheetId,
  run: CellArea,
  records: CellArea,
  tiedRuns: readonly CellArea[],
): boolean {
  let cells = Array.from(
    {
      length: run.columnCount,
    },
    (_, offset) => {
      let cellId = workbook.cellIdAt(sheetId, run.topRowIndex, run.leftColumnIndex + offset);
      return cellId === null ? null : workbook.cellOnShowIn(cellId);
    },
  );
  let formulas = cells.map(
    (cell) => (cell !== null && 'input' in cell && cell.input.kind === 'formula' ? formulaTextOf(cell) : null),
  );
  let presentFormulas = formulas.filter((formula) => formula !== null);
  let startsWithFormulaOrText = formulas[0] !== null || cellValueOf(cells[0] ?? null)?.kind === 'text';
  if (presentFormulas.length === 0 || formulas.lastIndexOf(null) > 0 || !startsWithFormulaOrText) return false;
  if (presentFormulas.some((formula) => formula.length > MAX_FORMULA_LENGTH_FOR_TIED_CHECK)) return false;
  let parsedFormulas = presentFormulas.map((formula) => findFormulaReferences(formula, workbook.decimalSign));
  if (presentFormulas.some((formula) => formulaMatchesOutsideReferences(formula, POSITION_FORMULA_PATTERN, workbook.decimalSign)))
    return false;
  let references = parsedFormulas.flatMap((parsed) => parsed.references);
  if (
    references.some(
      ({ ends: [oneEnd, otherEnd = oneEnd] }) =>
        oneEnd.digits !== '' && otherEnd.digits !== '' && oneEnd.dollarOfRow !== otherEnd.dollarOfRow,
    )
  )
    return false;
  let resolvedReferences = references.map((reference) => resolveFormulaReference(reference, sheetId, sheets));
  if (resolvedReferences.includes(null)) return false;
  let areasOnSheet = resolvedReferences.flatMap((resolved) => (resolved?.sheet.sheetId === sheetId ? [resolved.area] : []));
  let areasInRecords = areasOnSheet.filter((areaOnSheet) => areasOverlap(areaOnSheet, records));
  let spansRecordRows = ({ topRowIndex, rowCount }: RowsToSort) =>
    topRowIndex <= records.topRowIndex && topRowIndex + rowCount >= records.topRowIndex + records.rowCount;
  if (!areasInRecords.every(spansRecordRows)) return false;
  if (
    areasOnSheet.some(
      (areaOnSheet) =>
        !areasInRecords.includes(areaOnSheet) &&
        areaOnSheet.rowCount > 1 &&
        isIndexWithinSpan(run.topRowIndex, areaOnSheet.topRowIndex, areaOnSheet.rowCount),
    )
  )
    return false;
  let rowAbove = {
    ...run,
    topRowIndex: run.topRowIndex - 1,
  };
  let overlapsTiedRun = (area: CellArea) => tiedRuns.some((tiedRun) => areasOverlap(area, tiedRun));
  return areasInRecords.length > 0 || (overlapsTiedRun(rowAbove) && areasOnSheet.some(overlapsTiedRun));
}
export function formulaRunsTiedToRecords(
  workbook: WorkbookReads,
  sheetId: SheetId,
  { table, records }: BoundsOfTableToSort,
  area: CellArea,
): Map<number, CellArea[]> {
  let rowIndexes = Array.from(
    {
      length: table.rowCount,
    },
    (_, offset) => table.topRowIndex + offset,
  );
  let tableColumnIndexes = new Set(
    rowIndexes.flatMap((rowIndex) => workbook.columnIndexesOnShowIn(sheetId, rowIndex)),
  );
  let tableRightEdge = table.leftColumnIndex + table.columnCount;
  let tiedRuns: CellArea[] = [];
  let tiedRunsByRow = new Map<number, CellArea[]>();
  let sheets = workbook.listSheets();
  let [rowsWithTiedRuns, cellsChecked] = [0, 0];
  for (let rowIndex of rowIndexes) {
    for (let columnRun of columnRunsOf(workbook.columnIndexesOnShowIn(sheetId, rowIndex))) {
      let runArea = {
        ...columnRun,
        topRowIndex: rowIndex,
        rowCount: 1,
      };
      let runEnd = runArea.leftColumnIndex + runArea.columnCount;
      let isOutsideTable = runArea.leftColumnIndex >= tableRightEdge || runEnd <= table.leftColumnIndex;
      let adjacentColumnIndex = runArea.leftColumnIndex >= tableRightEdge ? runArea.leftColumnIndex - 1 : runEnd;
      if (!isOutsideTable || tableColumnIndexes.has(adjacentColumnIndex)) continue;
      cellsChecked += runArea.columnCount;
      if (cellsChecked > MAX_CELLS_CHECKED_FOR_TIED_FORMULAS) return new Map<number, CellArea[]>();
      if (!isFormulaRunTiedToRecords(workbook, sheets, sheetId, runArea, records, tiedRuns)) continue;
      tiedRuns.push(runArea);
      tiedRunsByRow.set(rowIndex, [...(tiedRunsByRow.get(rowIndex) ?? []), runArea]);
    }
    if (tiedRunsByRow.has(rowIndex) && isIndexWithinSpan(rowIndex, area.topRowIndex, area.rowCount)) rowsWithTiedRuns += 1;
    if (rowsWithTiedRuns * 2 > area.rowCount) return new Map<number, CellArea[]>();
  }
  let isRecordRow = (rowIndex: number) => isIndexWithinSpan(rowIndex, records.topRowIndex, records.rowCount);
  let isBackedByNeighbors = (run: CellArea) =>
    [run.topRowIndex - 1, run.topRowIndex + 1].filter(isRecordRow).every(
      (rowIndex) =>
        workbook
          .columnIndexesOnShowIn(sheetId, rowIndex)
          .filter((columnIndex) => isIndexWithinSpan(columnIndex, run.leftColumnIndex, run.columnCount))
          .every(
            (columnIndex) =>
              (tiedRunsByRow.get(rowIndex) ?? []).some(
                (neighborRun) => isIndexWithinSpan(columnIndex, neighborRun.leftColumnIndex, neighborRun.columnCount),
              ),
          ),
    );
  let toCheck = [...tiedRuns];
  for (let run = toCheck.pop(); run !== undefined; run = toCheck.pop()) {
    let runsOfRow = tiedRunsByRow.get(run.topRowIndex) ?? [];
    if (!runsOfRow.includes(run) || isBackedByNeighbors(run)) continue;
    tiedRunsByRow.set(
      run.topRowIndex,
      runsOfRow.filter((runOfRow) => runOfRow !== run),
    );
    toCheck.push(...(tiedRunsByRow.get(run.topRowIndex - 1) ?? []), ...(tiedRunsByRow.get(run.topRowIndex + 1) ?? []));
  }
  return new Map(
    [...tiedRunsByRow].filter(([rowIndex, runs]) => runs.length > 0 && isIndexWithinSpan(rowIndex, area.topRowIndex, area.rowCount)),
  );
}
export function areFormulasBesideUntied(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): boolean {
  let sheets = workbook.listSheets();
  let cellsChecked = 0;
  for (let rowIndex = area.topRowIndex; rowIndex < area.topRowIndex + area.rowCount; rowIndex += 1)
    for (let columnIndex of workbook.columnIndexesOnShowIn(sheetId, rowIndex)) {
      if (isIndexWithinSpan(columnIndex, area.leftColumnIndex, area.columnCount)) continue;
      let cellId = workbook.cellIdAt(sheetId, rowIndex, columnIndex);
      let cell = cellId === null ? null : workbook.cellOnShowIn(cellId);
      if (cell === null) continue;
      if (!('input' in cell)) {
        if (cell.from.r !== cell.r) return false;
        continue;
      }
      if (cell.input.kind !== 'formula') continue;
      cellsChecked += 1;
      if (cellsChecked > MAX_CELLS_CHECKED_FOR_TIED_FORMULAS) return false;
      let formulaText = formulaTextOf(cell);
      if (formulaText.length > MAX_FORMULA_LENGTH_FOR_TIED_CHECK) return false;
      let { quoted, references } = findFormulaReferences(formulaText, workbook.decimalSign);
      let unquotedText = quoted.reduceRight(
        (text, { start, end }) => text.slice(0, start) + text.slice(end),
        formulaText,
      );
      if (POSITION_FORMULA_PATTERN.test(unquotedText)) return false;
      if (
        !references.every((reference) => {
          let resolved = resolveFormulaReference(reference, sheetId, sheets);
          if (resolved === null) return false;
          let { area: referenceArea } = resolved;
          let isOnSheet = resolved.sheet.sheetId === sheetId;
          let isOwnRowOnly =
            isOnSheet &&
            referenceArea.rowCount === 1 &&
            referenceArea.topRowIndex === rowIndex &&
            reference.ends.every(({ dollarOfRow }) => dollarOfRow === '');
          let hasFixedRows = reference.ends.every(
            ({ digits, dollarOfRow }) => digits === '' || dollarOfRow !== '',
          );
          let overlapsRows =
            referenceArea.topRowIndex < area.topRowIndex + area.rowCount && area.topRowIndex < referenceArea.topRowIndex + referenceArea.rowCount;
          return !isOnSheet || isOwnRowOnly || (hasFixedRows && !overlapsRows);
        })
      )
        return false;
    }
  return true;
}
export function doFormulasInAreaReachOut(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): boolean | null {
  let sheets = workbook.listSheets();
  let cellsChecked = 0;
  for (let rowIndex = area.topRowIndex; rowIndex < area.topRowIndex + area.rowCount; rowIndex += 1)
    for (let columnIndex of workbook.columnIndexesOnShowIn(sheetId, rowIndex)) {
      if (!isIndexWithinSpan(columnIndex, area.leftColumnIndex, area.columnCount)) continue;
      let cellId = workbook.cellIdAt(sheetId, rowIndex, columnIndex);
      let cell = cellId === null ? null : workbook.cellOnShowIn(cellId);
      if (cell === null || !('input' in cell) || cell.input.kind !== 'formula') continue;
      cellsChecked += 1;
      if (cellsChecked > MAX_CELLS_CHECKED_FOR_TIED_FORMULAS) return null;
      if (
        findFormulaReferences(formulaTextOf(cell), workbook.decimalSign).references.some((reference) => {
          let resolved = resolveFormulaReference(reference, sheetId, sheets);
          if (resolved?.sheet.sheetId !== sheetId) return false;
          let { area: referenceArea } = resolved;
          let isWithinColumns =
            referenceArea.leftColumnIndex >= area.leftColumnIndex &&
            referenceArea.leftColumnIndex + referenceArea.columnCount <= area.leftColumnIndex + area.columnCount;
          let isOwnRowOnly =
            referenceArea.rowCount === 1 &&
            referenceArea.topRowIndex === rowIndex &&
            reference.ends.every(({ dollarOfRow }) => dollarOfRow === '');
          let overlapsRows =
            referenceArea.topRowIndex < area.topRowIndex + area.rowCount && area.topRowIndex < referenceArea.topRowIndex + referenceArea.rowCount;
          return !isWithinColumns && !isOwnRowOnly && overlapsRows;
        })
      )
        return true;
    }
  return false;
}
export function sortMoveForTable(state: PageState, workbook: WorkbookReads, tableBounds: BoundsOfTableToSort, area: CellArea): SortMove | null {
  let { table, records } = tableBounds;
  let { sheetId } = state;
  let rowsArea = {
    ...area,
    leftColumnIndex: 0,
    columnCount: 1 / 0,
  };
  let reachesOutside = ({ leftColumnIndex: leftOfOther, columnCount: countOfOther }: ColumnSpan) =>
    leftOfOther < area.leftColumnIndex || leftOfOther + countOfOther > area.leftColumnIndex + area.columnCount;
  if (workbook.mergedAreasIn(sheetId, rowsArea).some((mergedArea) => reachesOutside(mergedArea) || mergedArea.rowCount > 1)) return null;
  let { leftColumnIndex, columnCount } = area;
  let shownRowsArea = workbook.areaOnShowIn(sheetId, rowsArea);
  if (shownRowsArea === null || !reachesOutside(shownRowsArea))
    return {
      moves: 'rows',
      leftColumnIndex,
      columnCount,
    };
  if (area.rowCount > MAX_RECORD_ROWS_FOR_CELL_SORT) return null;
  let sameRowsTables: CellArea[] = [];
  let otherTables: CellArea[] = [];
  let tiedRuns = formulaRunsTiedToRecords(workbook, sheetId, tableBounds, area);
  let [checkedCount, hasEmptyTableBeside] = [0, false];
  for (let topRowIndex = area.topRowIndex; topRowIndex < area.topRowIndex + area.rowCount; topRowIndex += 1)
    for (let columnIndex of workbook.columnIndexesOnShowIn(sheetId, topRowIndex)) {
      let cellArea = {
        topRowIndex,
        leftColumnIndex: columnIndex,
        rowCount: 1,
        columnCount: 1,
      };
      if (!reachesOutside(cellArea)) continue;
      if (
        [sameRowsTables, otherTables, tiedRuns.get(topRowIndex) ?? []].some(
          (areas) => areas.some((areaBeside) => isAreaWithin(cellArea, areaBeside)),
        )
      )
        continue;
      if (checkedCount === MAX_SORT_KEYS_IN_SPEC) return null;
      checkedCount += 1;
      let cellId = workbook.cellIdAt(sheetId, topRowIndex, columnIndex);
      if (cellId === null) return null;
      let tableBeside = headedTableBoundsAtCell(workbook, cellId);
      let isSameRowsTable =
        tableBeside !== null &&
        tableBeside.holdsRecordsOnly &&
        tableBeside.table.topRowIndex === table.topRowIndex &&
        tableBeside.records.topRowIndex === records.topRowIndex &&
        tableBeside.records.rowCount === records.rowCount;
      if (tableBeside === null || (!tableBeside.isHeaderSure && !isSameRowsTable)) {
        if (!hasNoRecordsToSort(workbook, cellId)) return null;
        hasEmptyTableBeside = true;
        continue;
      }
      let overlapsHeader = tableBeside.table.topRowIndex < records.topRowIndex && table.topRowIndex < tableBeside.records.topRowIndex;
      if (!isSameRowsTable && overlapsHeader) return null;
      (isSameRowsTable ? sameRowsTables : otherTables).push(tableBeside.table);
    }
  if (otherTables.length === 0 && tiedRuns.size === 0) {
    let leftOfRows = Math.min(leftColumnIndex, shownRowsArea.leftColumnIndex);
    let rightOfRows = Math.max(leftColumnIndex + columnCount, shownRowsArea.leftColumnIndex + shownRowsArea.columnCount);
    return {
      moves: 'rows',
      leftColumnIndex: leftOfRows,
      columnCount: rightOfRows - leftOfRows,
    };
  }
  let hasComment = (state.comments ?? []).some(({ cells }) => {
    let commentArea = cells.activeCell.sheetId === sheetId ? cachedSelectedArea(cells, workbook) : null;
    return commentArea !== null && areasOverlap(commentArea, area);
  });
  return hasEmptyTableBeside || sameRowsTables.length > 0 || hasComment
    ? null
    : {
        moves: 'cells',
        leftColumnIndex,
        columnCount,
      };
}
export function columnBlockAtColumn(
  workbook: WorkbookReads,
  sheetId: SheetId,
  table: CellArea,
  records: RowsToSort,
  columnIndex: number,
): ColumnSpan {
  if (table.rowCount > MAX_RECORD_ROWS_FOR_CELL_SORT) return table;
  let headerColumns = new Set<number>();
  let recordColumnCounts = new Map<number, number>();
  let recordRowCount = 0;
  for (let rowIndex = table.topRowIndex; rowIndex < records.topRowIndex + records.rowCount; rowIndex += 1) {
    let columnIndexes = workbook.columnIndexesOnShowIn(sheetId, rowIndex);
    if (
      rowIndex >= records.topRowIndex &&
      columnIndexes.some((index) => isIndexWithinSpan(index, table.leftColumnIndex, table.columnCount))
    )
      recordRowCount += 1;
    for (let index of columnIndexes)
      if (rowIndex < records.topRowIndex) headerColumns.add(index);
      else recordColumnCounts.set(index, (recordColumnCounts.get(index) ?? 0) + 1);
  }
  let isInBlock = (index: number) =>
    headerColumns.has(index) || (recordColumnCounts.get(index) ?? 0) >= Math.max(recordRowCount, 1);
  if (!isInBlock(columnIndex))
    return recordColumnCounts.has(columnIndex)
      ? {
          leftColumnIndex: columnIndex,
          columnCount: 1,
        }
      : table;
  let [left, right] = [columnIndex, columnIndex + 1];
  while (left > table.leftColumnIndex && isInBlock(left - 1)) left -= 1;
  while (right < table.leftColumnIndex + table.columnCount && isInBlock(right)) right += 1;
  return {
    leftColumnIndex: left,
    columnCount: right - left,
  };
}
export function tableToSortAtCell(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  cellId: CellId,
  askedFrom: TableToSortAskedFrom = 'cell',
): TableToSort | null {
  let position = workbook.positionOfCell(cellId);
  if (position === null) return null;
  if (askedFrom === 'cell' && pivotTableCellAt(workbook, cellId) !== null) return null;
  let cellArea = {
    topRowIndex: position.rowIndex,
    leftColumnIndex: position.columnIndex,
    rowCount: 1,
    columnCount: 1,
  };
  let tableBounds = headedTableBoundsAtCell(workbook, cellId);
  if (tableBounds === null || !tableBounds.holdsRecordsOnly || !isAreaWithin(cellArea, tableBounds.table)) return null;
  let { table, records } = tableBounds;
  if (
    ownFiltersOfSheet(state, state.sheetId).some((ownFilter) => {
      let area = areaOfFilteredTable(workbook, ownFilter);
      return area !== null && isAreaWithin(cellArea, area) && !isSameArea(area, table);
    })
  )
    return null;
  if (!isAreaInView(state, workbook, cellArea) || !isAreaInView(state, workbook, records)) return null;
  let isHeaderKnown =
    tableBounds.isHeaderSure || (tableBounds.isAPlainList && records.topRowIndex === headingRowCountByFreeze(state, workbook));
  let firstRecordIndex = Math.max(records.topRowIndex, sheetOfViewOrEmpty(state, workbook).frozenRowCount);
  let recordCount = records.topRowIndex + records.rowCount - firstRecordIndex;
  let firstRecordRowId = workbook.cellIdAt(state.sheetId, firstRecordIndex, position.columnIndex)?.rowId;
  if (!isHeaderKnown || recordCount < 2 || firstRecordRowId === undefined) return null;
  let move = sortMoveForTable(state, workbook, tableBounds, {
    ...records,
    topRowIndex: firstRecordIndex,
    rowCount: recordCount,
  });
  if (move === null) return null;
  if (askedFrom === 'cell' && move.moves === 'rows') {
    let block = {
      ...columnBlockAtColumn(
        workbook,
        state.sheetId,
        table,
        {
          topRowIndex: firstRecordIndex,
          rowCount: recordCount,
        },
        position.columnIndex,
      ),
      topRowIndex: firstRecordIndex,
      rowCount: recordCount,
    };
    if (
      (move.leftColumnIndex < block.leftColumnIndex || move.leftColumnIndex + move.columnCount > block.leftColumnIndex + block.columnCount) &&
      (!areFormulasBesideUntied(workbook, state.sheetId, block) || doFormulasInAreaReachOut(workbook, state.sheetId, block) === true)
    )
      return null;
  }
  let lastColumnIndex = move.leftColumnIndex + move.columnCount - 1;
  let firstColumnId = workbook.cellIdAt(state.sheetId, firstRecordIndex, move.leftColumnIndex)?.columnId;
  let lastColumnId = workbook.cellIdAt(state.sheetId, firstRecordIndex, lastColumnIndex)?.columnId;
  return firstColumnId === undefined || lastColumnId === undefined
    ? null
    : {
        ...tableBounds.ids,
        firstRecord: firstRecordRowId,
        firstColumn: firstColumnId,
        lastColumn: lastColumnId,
        moves: move.moves,
      };
}
export function withTableToSortInMenu(state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  let { menu } = state;
  return menu?.holds !== 'all' || state.selectionSeen.shape !== 'cell'
    ? state
    : {
        ...state,
        menu: {
          ...menu,
          tableToSort: tableToSortAtActiveCell(state, workbook),
        },
      };
}
export function sortTableFromMenu(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  menu: PageState['menu'],
  command: SheetSortChange,
  isWithoutKeyboard: boolean,
): PageTransition {
  let table = tableToSortAtActiveCell(state, workbook);
  let tableInMenu = menu?.tableToSort === undefined ? table : menu.tableToSort;
  let bounds = table === null ? null : boundsOfTableToSort(workbook, state.sheetId, table);
  if (table === null || bounds === null || tableInMenu === null || !isSameTableToSort(table, tableInMenu))
    return withNoEffects(openSortPane(state, workbook, 'range'));
  let columnId = sortColumnOfMenu(menu, 'sheet') ?? state.activeCell.columnId;
  const direction = command === 'sortAscending' ? 'ascending' : 'descending';
  let sortTarget = {
    cells: bounds.records,
    hasHeaderRow: false,
    movesWholeRows: table.moves === 'rows',
  };
  return sortTableWithKeys(
    state,
    workbook,
    sortTarget,
    [
      {
        columnId,
        direction,
      },
    ],
    isWithoutKeyboard,
  );
}
export function holdsOfTableSortColumn(state: PageState, workbook: WorkbookReads): SortHoldsOfColumn | null {
  let table = state.menu?.tableToSort ?? null;
  let bounds = table === null ? null : boundsOfTableToSort(workbook, state.sheetId, table);
  if (bounds === null) return null;
  let columnId = sortColumnOfMenu(state.menu, 'sheet') ?? state.activeCell.columnId;
  return sortHoldsOfColumn(
    workbook,
    {
      sheetId: state.sheetId,
      columnId,
    },
    bounds.records,
  );
}
export function areaOfTableAtCell(workbook: WorkbookReads, cellId: CellId): CellArea | null {
  let table = tableAtCellIfAny(workbook, cellId)?.table;
  if (table === undefined) return null;
  let {
    sheetId,
    header,
    firstRowOfBody,
    lastRowOfBody,
    firstColumn,
    lastColumn,
  } = table;
  let topRowIndex = workbook.rowIndexOf(sheetId, header?.firstRow ?? firstRowOfBody);
  let bottomRowIndex = workbook.rowIndexOf(sheetId, lastRowOfBody);
  let leftColumnIndex = workbook.columnIndexOf(sheetId, firstColumn);
  let rightColumnIndex = workbook.columnIndexOf(sheetId, lastColumn);
  return topRowIndex === null || bottomRowIndex === null || leftColumnIndex === null || rightColumnIndex === null
    ? null
    : {
        topRowIndex,
        leftColumnIndex,
        rowCount: bottomRowIndex - topRowIndex + 1,
        columnCount: rightColumnIndex - leftColumnIndex + 1,
      };
}
export function areCellsBesideTableLoose(workbook: WorkbookReads, sheetId: SheetId, { table, records }: BoundsOfTableToSort): boolean {
  let [columnsBeside, headerColumnsBeside] = [new Set<number>(), new Set<number>()];
  for (let rowIndex = table.topRowIndex; rowIndex < table.topRowIndex + table.rowCount; rowIndex += 1)
    for (let columnIndex of workbook.columnIndexesOnShowIn(sheetId, rowIndex)) {
      if (isIndexWithinSpan(columnIndex, table.leftColumnIndex, table.columnCount)) continue;
      columnsBeside.add(columnIndex);
      if (rowIndex < records.topRowIndex) headerColumnsBeside.add(columnIndex);
      else if (!headerColumnsBeside.has(columnIndex)) {
        let cellId = workbook.cellIdAt(sheetId, rowIndex, columnIndex);
        if (cellValueOf(cellId === null ? null : workbook.cellOnShowIn(cellId))?.kind !== 'text') return false;
      }
    }
  let columnIndexes = [...columnsBeside];
  columnIndexes.sort((one, other) => one - other);
  return columnRunsOf(columnIndexes).every(({ columnCount }) => columnCount === 1);
}
export function recordsSortableAsCells(state: PageState, workbook: WorkbookReads, { table, records }: BoundsOfTableToSort): CellArea | null {
  let firstRecordCellId = workbook.cellIdAt(state.sheetId, records.topRowIndex, records.leftColumnIndex);
  let bounds = firstRecordCellId === null ? null : headedTableBoundsAtCell(workbook, firstRecordCellId);
  if (
    !(
      bounds !== null &&
      bounds.table.topRowIndex === table.topRowIndex &&
      bounds.records.topRowIndex === records.topRowIndex &&
      bounds.records.rowCount >= records.rowCount
    )
  )
    return null;
  let [leftEdge, rightEdge] = [table.leftColumnIndex, table.leftColumnIndex + table.columnCount];
  let boundsRightEdge = bounds.table.leftColumnIndex + bounds.table.columnCount;
  let hasCellAtEdge = (rowIndex: number) =>
    workbook
      .columnIndexesOnShowIn(state.sheetId, rowIndex)
      .some((columnIndex) => columnIndex === leftEdge - 1 || columnIndex === rightEdge);
  let rowIndexes = Array.from(
    {
      length: table.rowCount,
    },
    (_, index) => table.topRowIndex + index,
  );
  let isSameColumns = bounds.table.leftColumnIndex === leftEdge && boundsRightEdge === rightEdge;
  let isWithinBounds = bounds.table.leftColumnIndex <= leftEdge && boundsRightEdge >= rightEdge;
  if (!isSameColumns && (!isWithinBounds || table.rowCount > MAX_RECORD_ROWS_FOR_CELL_SORT || rowIndexes.some(hasCellAtEdge))) return null;
  let move = sortMoveForTable(
    state,
    workbook,
    {
      table,
      records,
    },
    records,
  );
  return move?.moves === 'rows' &&
    areCellsBesideTableLoose(workbook, state.sheetId, {
      table,
      records,
    }) &&
    !hasDeclaredTableBeside(workbook, state.sheetId, records) &&
    areFormulasBesideUntied(workbook, state.sheetId, records) &&
    doFormulasInAreaReachOut(workbook, state.sheetId, records) === false
    ? {
        ...records,
        leftColumnIndex: move.leftColumnIndex,
        columnCount: move.columnCount,
      }
    : null;
}
export function hasEmptyColumnWithoutHeading(workbook: WorkbookReads, sheetId: SheetId, { table, records }: BoundsOfTableToSort): boolean {
  let headingColumnIndexes = new Set(workbook.columnIndexesOnShowIn(sheetId, records.topRowIndex - 1));
  return Array.from(
    {
      length: table.columnCount,
    },
    (_, offset) => table.leftColumnIndex + offset,
  ).some(
    (columnIndex) =>
      !headingColumnIndexes.has(columnIndex) &&
      workbook.areaOnShowIn(sheetId, {
        ...table,
        leftColumnIndex: columnIndex,
        columnCount: 1,
      }) === null,
  );
}
export function firstShownRecordCell(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  area: ColumnSpan,
  { records }: Pick<BoundsOfTableToSort, 'records'>,
): CellId | null {
  let { frozenRowCount } = sheetOfViewOrEmpty(state, workbook);
  let rowIndex = shownRowIndexesWithoutFloats(state, workbook).find(
    (shownRowIndex) => shownRowIndex >= Math.max(records.topRowIndex, frozenRowCount) && shownRowIndex < records.topRowIndex + records.rowCount,
  );
  let fromColumnIndex = Math.max(area.leftColumnIndex, records.leftColumnIndex);
  let toColumnIndex = Math.min(area.leftColumnIndex + area.columnCount, records.leftColumnIndex + records.columnCount);
  let columnIndex = Array.from(
    {
      length: Math.max(0, toColumnIndex - fromColumnIndex),
    },
    (_, offset) => fromColumnIndex + offset,
  ).find(
    (candidateIndex) =>
      workbook.areaOnShowIn(state.sheetId, {
        ...records,
        leftColumnIndex: candidateIndex,
        columnCount: 1,
      }) !== null,
  );
  return rowIndex === undefined || columnIndex === undefined ? null : workbook.cellIdAt(state.sheetId, rowIndex, columnIndex);
}
export function tableUnderSelectedColumns(state: PageState, workbook: ReadsWithTextMeasurer, area: CellArea): HeadedTableBounds | null {
  let { sheetId } = state;
  let overlapsAreaColumns = ({ leftColumnIndex, columnCount }: ColumnSpan) =>
    leftColumnIndex < area.leftColumnIndex + area.columnCount && area.leftColumnIndex < leftColumnIndex + columnCount;
  let seenTables: CellArea[] = [];
  let found: HeadedTableBounds | null = null;
  let checkedCount = 0;
  for (let rowIndex of shownRowIndexesWithoutFloats(state, workbook))
    for (let columnIndex of workbook.columnIndexesOnShowIn(sheetId, rowIndex)) {
      let cellArea = singleCellArea(rowIndex, columnIndex);
      if (seenTables.some((seenTable) => isAreaWithin(cellArea, seenTable))) continue;
      let cellId = workbook.cellIdAt(sheetId, rowIndex, columnIndex);
      if (cellId === null || checkedCount === MAX_CELLS_CHECKED_UNDER_COLUMNS) return null;
      if (((checkedCount += 1), workbook.tableAtCell(cellId) === null)) return null;
      if (hasNoRecordsToSort(workbook, cellId)) continue;
      let tableBounds = headedTableBoundsAtCell(workbook, cellId);
      let tableArea = tableBounds?.table ?? areaOfTableAtCell(workbook, cellId);
      if (tableArea === null) return null;
      if (
        (seenTables.push(tableArea, {
          ...tableArea,
          topRowIndex: rowIndex,
          rowCount: 1,
        }),
        !overlapsAreaColumns(tableArea))
      )
        continue;
      if (tableBounds === null || (found !== null && !isSameArea(found.table, tableArea))) return null;
      found = tableBounds;
    }
  let { table: foundTable } = found ?? {
    table: null,
  };
  return ownFiltersOfSheet(state, sheetId).some((ownFilter) => {
    let filteredArea = areaOfFilteredTable(workbook, ownFilter);
    return filteredArea !== null && overlapsAreaColumns(filteredArea) && (foundTable === null || !isSameArea(filteredArea, foundTable));
  })
    ? null
    : found;
}
export function tableToSortOfColumns(state: PageState, workbook: ReadsWithTextMeasurer): TableUnderSelectedLetters | null {
  let area = state.selectionSeen.shape === 'columns' && !hasOtherRanges(state) ? selectedArea(state, workbook) : null;
  let tableBounds = area === null ? null : tableUnderSelectedColumns(state, workbook, area);
  if (area === null || tableBounds === null) return null;
  if (!tableBounds.isHeaderSure) return null;
  if (tableBounds.holdsBlankRows || hasEmptyColumnWithoutHeading(workbook, state.sheetId, tableBounds)) return null;
  let { records } = tableBounds;
  let { frozenRowCount } = sheetOfViewOrEmpty(state, workbook);
  let recordCellId = firstShownRecordCell(state, workbook, area, tableBounds);
  let tableToSort = recordCellId === null ? null : tableToSortAtCell(state, workbook, recordCellId, 'letters');
  let bounds = tableToSort === null ? null : boundsOfTableToSort(workbook, state.sheetId, tableToSort);
  if (recordCellId === null || tableToSort === null || bounds === null) return null;
  return bounds.table.topRowIndex === tableBounds.table.topRowIndex &&
    bounds.table.rowCount === tableBounds.table.rowCount &&
    bounds.records.topRowIndex === Math.max(records.topRowIndex, frozenRowCount) &&
    isAreaWithin(
      {
        ...bounds.table,
        leftColumnIndex: records.leftColumnIndex,
        columnCount: records.columnCount,
      },
      bounds.table,
    )
    ? {
        table: tableToSort,
        columnId: recordCellId.columnId,
        at: recordCellId,
        extent: tableBounds.table,
      }
    : null;
}
export function sortTableOfColumns(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  pick: TableUnderLetters,
  keys: readonly SortKey[],
  isWithoutKeyboard: boolean,
): PageTransition {
  let columnTable = tableToSortOfColumns(state, workbook);
  let bounds = columnTable === null ? null : boundsOfTableToSort(workbook, state.sheetId, columnTable.table);
  if (columnTable === null || bounds === null || columnTable.columnId !== pick.columnId || !isSameTableToSort(columnTable.table, pick.table))
    return withNoEffects(openSortPane(state, workbook, 'sheet'));
  let sortTarget = {
    cells: bounds.records,
    hasHeaderRow: false,
    movesWholeRows: columnTable.table.moves === 'rows',
  };
  return sortTableWithKeys(state, workbook, sortTarget, keys, isWithoutKeyboard);
}
export const MAX_RECORD_ROWS_FOR_CELL_SORT = 5000;
export const MAX_SORT_KEYS_IN_SPEC = 8;
export const MAX_CELLS_CHECKED_FOR_TIED_FORMULAS = 500;
export const MAX_FORMULA_LENGTH_FOR_TIED_CHECK = 250;
export const isIndexWithinSpan = (index: number, firstIndex: number, count: number): boolean =>
  index >= firstIndex && index < firstIndex + count;
export const POSITION_FORMULA_PATTERN = /\b(?:ROW|COLUMN|OFFSET|INDIRECT)\s*\(/i;
export const tableToSortAtActiveCell = (state: PageState, workbook: ReadsWithTextMeasurer): TableToSort | null =>
  state.selectionSeen.shape === 'cell' ? tableToSortAtCell(state, workbook, state.activeCell) : null;
export const isSameTableToSort = (one: TableToSort, other: TableToSort): boolean => JSON.stringify(one) === JSON.stringify(other);
export const hasDeclaredTableBeside = (workbook: WorkbookReads, sheetId: SheetId, area: CellArea): boolean =>
  workbook.cellTablesDeclaredIn(sheetId).some(({ liveCellTable }) => {
    let firstColumnIndex = workbook.columnIndexOf(sheetId, liveCellTable.firstColumn);
    let lastColumnIndex = workbook.columnIndexOf(sheetId, liveCellTable.lastColumn);
    let headerRowIndex = workbook.rowIndexOf(sheetId, liveCellTable.headerRows.firstRow);
    if (firstColumnIndex === null || lastColumnIndex === null || headerRowIndex === null) return true;
    return (
      (lastColumnIndex < area.leftColumnIndex || firstColumnIndex >= area.leftColumnIndex + area.columnCount) &&
      headerRowIndex < area.topRowIndex + area.rowCount
    );
  });
export const MAX_CELLS_CHECKED_UNDER_COLUMNS = 12;
export const singleCellArea = (rowIndex: number, columnIndex: number): CellArea => ({
  topRowIndex: rowIndex,
  leftColumnIndex: columnIndex,
  rowCount: 1,
  columnCount: 1,
});
