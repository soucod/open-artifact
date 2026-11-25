import type { ColumnId, RowId, SheetId } from '@open-artifact/sheets-core';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CellArea, CellPosition } from './model.ts';
import { tablesInSightOf, tablesReadState, areaOfRowsAndColumns } from '../tables/finding.ts';
import { areasOfAllRanges, isAreaWithin, withoutOtherRanges } from './several-ranges.ts';
import { selectedLines } from './move-lines.ts';
import { layoutOfView } from '../grid/layout.ts';
import { isRangeInSight, isInSpan, boxOfCellRange } from '../grid/geometry.ts';
import { hasFilteredRowsIn } from '../tables/filtered-rows.ts';
import { selectedArea, isSameArea, selectionBetweenPositions } from './model.ts';
import { selectAllCells } from './keyboard.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** The first and last index of a run of rows or columns of a table. */
export interface TableIndexRun {
  first: number;
  last: number;
}
/** The parts of a table placed on the grid that picking one goes by. */
export interface PartsOfPlacedTable {
  header: TableIndexRun;
  body: TableIndexRun | null;
  columns: TableIndexRun;
  area: CellArea;
}
/** The rows and columns that bound a table to sort, by id. */
export interface RowsAndColumnsOfTableToSort {
  firstRowOfHeader: RowId;
  firstRecord: RowId;
  lastRecord: RowId;
  firstColumn: ColumnId;
  lastColumn: ColumnId;
}
/** A table to sort as areas: the whole of it with its header, and its records. */
export interface BoundsOfTableToSort {
  table: CellArea;
  records: CellArea;
}
/** A table found to chart, and whether a filter hides some of its rows. */
export interface TableToChart {
  area: CellArea;
  isCutByFilter: boolean;
}
/** Why there is nothing to chart. */
export type WhyNothingToChart = 'tablesNotFoundYet' | 'noCells' | 'filterCutsTable';
/** What the chart card opens on. */
export type ChartCardOpening = 'waiting' | 'nothing' | 'filter' | 'selection' | 'lone_cell' | 'in_table' | 'near_table';
/** A corner of an area to make the active cell, and the corner across from it. */
export interface CornersOfArea {
  active: CellPosition;
  opposite: CellPosition;
}
export function isLexicallyLess(keys: readonly number[], otherKeys: readonly number[]): boolean {
  let matchIndex = keys.findIndex((key, index) => key !== otherKeys[index]);
  return matchIndex !== -1 && (keys[matchIndex] ?? 0) < (otherKeys[matchIndex] ?? 0);
}
export function nearestArea(target: CellArea, areas: readonly CellArea[]): CellArea | null {
  let sortKeyOf = (area: CellArea): number[] => [
    distanceOutsideIndexRun(target.topRowIndex, area.topRowIndex, area.rowCount) +
      distanceOutsideIndexRun(target.leftColumnIndex, area.leftColumnIndex, area.columnCount),
    area.topRowIndex + area.rowCount <= target.topRowIndex ? 0 : 1,
    area.leftColumnIndex + area.columnCount <= target.leftColumnIndex ? 0 : 1,
    area.topRowIndex,
    area.leftColumnIndex,
  ];
  return areas.reduce<CellArea | null>(
    (nearest, area) => (nearest === null || isLexicallyLess(sortKeyOf(area), sortKeyOf(nearest)) ? area : nearest),
    null,
  );
}
export function boundsOfTableToSort(
  reads: WorkbookReads,
  sheetId: SheetId,
  { firstRowOfHeader, firstRecord, lastRecord, firstColumn, lastColumn }: RowsAndColumnsOfTableToSort,
): BoundsOfTableToSort | null {
  let topRowIndex = reads.rowIndexOf(sheetId, firstRowOfHeader);
  let firstRecordIndex = reads.rowIndexOf(sheetId, firstRecord);
  let lastRecordIndex = reads.rowIndexOf(sheetId, lastRecord);
  let leftColumnIndex = reads.columnIndexOf(sheetId, firstColumn);
  let rightColumnIndex = reads.columnIndexOf(sheetId, lastColumn);
  if (topRowIndex === null || firstRecordIndex === null || lastRecordIndex === null || leftColumnIndex === null || rightColumnIndex === null)
    return null;
  if (topRowIndex >= firstRecordIndex || firstRecordIndex > lastRecordIndex || leftColumnIndex > rightColumnIndex) return null;
  let columnSpan = {
    leftColumnIndex,
    columnCount: rightColumnIndex - leftColumnIndex + 1,
  };
  return {
    table: {
      topRowIndex,
      rowCount: lastRecordIndex - topRowIndex + 1,
      ...columnSpan,
    },
    records: {
      topRowIndex: firstRecordIndex,
      rowCount: lastRecordIndex - firstRecordIndex + 1,
      ...columnSpan,
    },
  };
}
export function selectableTablesInSight(state: PageState, reads: ReadsWithTextMeasurer): PartsOfPlacedTable[] {
  let tables = tablesInSightOf(state, reads);
  if (tablesReadState(state, state.sheetId) !== 'behind') return tables;
  let hasCellsOnShowInRow = (rowIndex: number, first: number, last: number = first): boolean =>
    reads.columnIndexesOnShowIn(state.sheetId, rowIndex).some((columnIndex) => columnIndex >= first && columnIndex <= last);
  return tables.filter(({ header, columns: { first, last }, area }: PartsOfPlacedTable) => {
    let rowAfter = area.topRowIndex + area.rowCount;
    return (
      hasCellsOnShowInRow(header.first, first, last) &&
      hasCellsOnShowInRow(rowAfter - 1, first, last) &&
      !hasCellsOnShowInRow(rowAfter, first, last) &&
      !hasCellsOnShowInRow(header.last, first - 1) &&
      !hasCellsOnShowInRow(header.last, last + 1)
    );
  });
}
export function tableHoldingSelection(state: PageState, reads: ReadsWithTextMeasurer): PartsOfPlacedTable | null {
  let rangeAreas = areasOfAllRanges(state, reads);
  if (rangeAreas.length === 0 || selectedLines(state, reads) !== null) return null;
  return (
    selectableTablesInSight(state, reads).find(
      ({ area }) => rangeAreas.every((rangeArea) => isAreaWithin(rangeArea, area)),
    ) ?? null
  );
}
export function nearestTableInSight(target: CellArea, state: PageState, reads: ReadsWithTextMeasurer): TableToChart | null {
  let areas: CellArea[] = tablesInSightOf(state, reads).map(fullAreaOfTable);
  let layout = layoutOfView(state, reads);
  let nearest = nearestArea(
    target,
    areas.filter((tableArea) => !isTinyArea(tableArea) && isRangeInSight(tableArea, state, layout, state)),
  );
  return nearest === null
    ? null
    : {
        area: nearest,
        isCutByFilter: hasFilteredRowsIn(state, reads, nearest),
      };
}
export function tableToChartFromSelection(state: PageState, reads: ReadsWithTextMeasurer, area: CellArea): TableToChart | 'notFoundYet' | null {
  let tablesRead = tablesReadState(state, state.sheetId);
  let holding = tableHoldingSelection(state, reads);
  let isAnchorShown = reads.columnIndexesOnShowIn(state.sheetId, area.topRowIndex).includes(area.leftColumnIndex);
  let tableArea = holding === null ? (tablesRead === 'asTheyAre' && isAnchorShown ? area : null) : fullAreaOfTable(holding);
  let found: TableToChart | null =
    tableArea === null
      ? null
      : {
          area: tableArea,
          isCutByFilter: hasFilteredRowsIn(state, reads, tableArea),
        };
  if ((tableArea !== null && !isTinyArea(tableArea)) || state.contextBarMenu !== 'chart') return found;
  if (tablesRead === 'behind') return 'notFoundYet';
  return nearestTableInSight(area, state, reads) ?? found;
}
export function areaToChart(state: PageState, reads: ReadsWithTextMeasurer, isOneCellSeen: boolean = state.selectionSeen.shape === 'cell'): CellArea | null {
  let area: CellArea | null = selectedArea(state, reads);
  if (!isOneCellSeen || area === null) return area;
  let found = tableToChartFromSelection(state, reads, area);
  return found === null || found === 'notFoundYet' || found.isCutByFilter ? null : found.area;
}
export function isAreaToChartUnchanged(before: PageState, state: PageState, reads: ReadsWithTextMeasurer): boolean {
  if (
    !(
      state.scrollTop !== before.scrollTop ||
      state.scrollLeft !== before.scrollLeft ||
      state.gridWidth !== before.gridWidth ||
      state.gridHeight !== before.gridHeight
    ) ||
    state.contextBarMenu !== 'chart' ||
    state.selectionSeen.shape !== 'cell'
  )
    return true;
  let [areaBefore, area] = [areaToChart(before, reads), areaToChart(state, reads)];
  return areaBefore === null || area === null ? areaBefore === area : isSameArea(areaBefore, area);
}
export function areTablesForChartPending(state: PageState, reads: ReadsWithTextMeasurer): boolean {
  let area: CellArea | null = state.selectionSeen.shape === 'cell' ? selectedArea(state, reads) : null;
  return area !== null && tableToChartFromSelection(state, reads, area) === 'notFoundYet';
}
export function whyNothingToChart(state: PageState, reads: ReadsWithTextMeasurer): WhyNothingToChart | null {
  let area = areaToChart(state, reads);
  let selected: CellArea | null = selectedArea(state, reads);
  if (area === null && selected !== null && state.selectionSeen.shape === 'cell') {
    let tableFound = tableToChartFromSelection(state, reads, selected);
    if (tableFound === 'notFoundYet') return 'tablesNotFoundYet';
    return tableFound === null ? 'noCells' : 'filterCutsTable';
  }
  if (area === null) return 'noCells';
  for (let topRowIndex: number = area.topRowIndex; topRowIndex < area.topRowIndex + area.rowCount; topRowIndex += 1)
    if (
      reads
        .columnIndexesOnShowIn(state.sheetId, topRowIndex)
        .some((columnIndex) => isInSpan(columnIndex, area.leftColumnIndex, area.columnCount))
    )
      return null;
  return 'noCells';
}
export function whatChartCardOpensOn(state: PageState, reads: ReadsWithTextMeasurer): ChartCardOpening {
  let why = whyNothingToChart(state, reads);
  if (why !== null)
    return (
      {
        tablesNotFoundYet: 'waiting',
        noCells: 'nothing',
        filterCutsTable: 'filter',
      } satisfies Record<WhyNothingToChart, ChartCardOpening>
    )[why];
  if (state.selectionSeen.shape !== 'cell') return 'selection';
  let [holding, area] = [tableHoldingSelection(state, reads), areaToChart(state, reads)];
  if (area !== null && isTinyArea(area)) return 'lone_cell';
  return holding !== null && area !== null && isAreaWithin(area, holding.area) ? 'in_table' : 'near_table';
}
export function startOfAreaToChart(state: PageState, reads: ReadsWithTextMeasurer): CellArea | null {
  let isChartMenuOnCell = state.contextBarMenu === 'chart' && state.selectionSeen.shape === 'cell';
  if (state.menu?.holds === 'all' && state.selectionSeen.shape === 'cell') {
    let tableToSort = state.menu.tableToSort ?? null;
    return tableToSort === null ? null : (boundsOfTableToSort(reads, state.sheetId, tableToSort)?.table ?? null);
  }
  if (state.menu?.holds === 'all') return tableHoldingSelection(state, reads)?.area ?? null;
  let area = isChartMenuOnCell ? areaToChart(state, reads) : null;
  return area === null || isTinyArea(area) ? null : area;
}
export function selectAreaFromSeenCorner(state: PageState, reads: ReadsWithTextMeasurer, area: CellArea) {
  let layout = layoutOfView(state, reads);
  let rowEnds = [area.topRowIndex, area.topRowIndex + area.rowCount - 1];
  let columnEnds = [area.leftColumnIndex, area.leftColumnIndex + area.columnCount - 1];
  let corners = [0, 1].flatMap(
    (rowEnd) =>
      [0, 1].map(
        (columnEnd): CornersOfArea => ({
          active: {
            rowIndex: rowEnds[rowEnd],
            columnIndex: columnEnds[columnEnd],
          },
          opposite: {
            rowIndex: rowEnds[rowEnd === 0 ? 1 : 0],
            columnIndex: columnEnds[columnEnd === 0 ? 1 : 0],
          },
        }),
      ),
  );
  let isCornerSeen = ({ active }: CornersOfArea): boolean => {
    let { rowIndex, columnIndex } = active;
    let cellArea = {
      topRowIndex: rowIndex,
      leftColumnIndex: columnIndex,
      rowCount: 1,
      columnCount: 1,
    };
    let { left, top, right, bottom } = boxOfCellRange(cellArea, layout);
    return right > left && bottom > top;
  };
  let corner = corners.find(isCornerSeen) ?? corners[0];
  return corner === undefined ? null : selectionBetweenPositions(state, reads, corner.active, corner.opposite);
}
export function selectTableOrAll(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  let tableArea = tableHoldingSelection(state, reads)?.area ?? null;
  let isTableNotSelected =
    tableArea !== null && !areasOfAllRanges(state, reads).some((rangeArea) => isSameArea(rangeArea, tableArea));
  let singleRange = {
    ...withoutOtherRanges(state),
    rangeWalked: null,
  };
  return isTableNotSelected
    ? {
        ...singleRange,
        ...selectAreaFromSeenCorner(singleRange, reads, tableArea!),
      }
    : selectAllCells(singleRange, reads);
}
export const distanceOutsideIndexRun = (index: number, start: number, count: number): number =>
  index < start ? start - index : Math.max(0, index - (start + count - 1));
export const fullAreaOfTable = ({ header, body, columns }: Pick<PartsOfPlacedTable, 'header' | 'body' | 'columns'>): CellArea =>
  areaOfRowsAndColumns(
    {
      first: header.first,
      last: (body ?? header).last,
    },
    columns,
  );
export const isTinyArea = ({ rowCount, columnCount }: Pick<CellArea, 'rowCount' | 'columnCount'>): boolean => rowCount * columnCount < 3;
