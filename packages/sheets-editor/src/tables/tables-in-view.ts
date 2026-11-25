import { areaCoveringChanges, changeHoldMsForCellCount } from '../agent/changes-by-agent.ts';
import { isAreaWithin } from '../selection/several-ranges.ts';
import { drawnOwnFiltersOfSheet, ownFiltersOfSheet } from './own-filters.ts';
import { tablesInSightOf, isTableCertain, areaOfFilteredTable, hasCellsOnShowIn } from './finding.ts';
import { isInSpan } from '../grid/geometry.ts';
import { hasNoUnformattedMark } from '../grid/sticky-headers.ts';
import type { PageState } from '../state/initial-state.ts';
import type { OwnFilter } from './own-filters.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellArea } from '../selection/model.ts';
import type { TableHeaderArea } from '../selection/move-table-columns.ts';
import type { PlacedTable } from './finding.ts';
/** The outline of a table held back while the agent's change over it shows: the revision of that change, and for how long. */
export interface OutlineHeldBack {
  revisionOfMark: number;
  afterMs: number;
}
/** A table found in sight that the grid outlines: the table placed, how many rows its header takes, and whether its outline comes later. */
export interface OutlinableTable extends PlacedTable, TableHeaderArea {
  comesLater: OutlineHeldBack | null;
}
interface TablesInViewCached {
  reads: ReadsWithTextMeasurer;
  found: OutlinableTable[];
}
export function tableOutlineDelayAfterAgent(
  area: CellArea,
  { sheetId, changesByAgent }: Pick<PageState, 'sheetId' | 'changesByAgent'>,
  reads: WorkbookReads,
): OutlineHeldBack | null {
  for (let change of changesByAgent) {
    if (change.isOfWholeLines || change.cells.activeCell.sheetId !== sheetId) continue;
    let changedArea = areaCoveringChanges([change, ...change.joinedWith], reads);
    if (changedArea === null || !isAreaWithin(area, changedArea)) continue;
    let afterMs = changeHoldMsForCellCount(changedArea.rowCount * changedArea.columnCount);
    return {
      revisionOfMark: change.revision,
      afterMs,
    };
  }
  return null;
}
export function outlinableTablesOf(tables: readonly PlacedTable[], state: PageState, reads: WorkbookReads): OutlinableTable[] {
  let ownFilterAreas = headedAreasOfOwnFilters(drawnOwnFiltersOfSheet(state, state.sheetId), reads);
  return tables.flatMap((table) => {
    let { area, header } = table;
    if (!canOutlineTable(table, state, reads)) return [];
    if (ownFilterAreas.some((ownFilterArea) => doAreasIntersect(area, ownFilterArea.area))) return [];
    let rowCountOfHeader = header.last - header.first + 1;
    return [
      {
        ...table,
        rowCountOfHeader,
        comesLater: tableOutlineDelayAfterAgent(area, state, reads),
      },
    ];
  });
}
export function tablesToOutline(state: PageState, reads: ReadsWithTextMeasurer): OutlinableTable[] {
  if (state.sheetPointedIn !== null) return NO_TABLES_IN_VIEW;
  let cached = tablesInViewCache.get(state);
  if (cached?.reads === reads) return cached.found;
  let tables = tablesInSightOf(state, reads).filter(({ table }) => isTableCertain(table));
  let found = tables.length === 0 ? NO_TABLES_IN_VIEW : outlinableTablesOf(tables, state, reads);
  tablesInViewCache.set(state, {
    reads,
    found,
  });
  return found;
}
export function isRowHeaderOfTables(rowIndex: number, state: PageState, reads: ReadsWithTextMeasurer): boolean {
  let headedAreas = [...tablesToOutline(state, reads), ...headedAreasOfOwnFilters(ownFiltersOfSheet(state, state.sheetId), reads)].filter(
    ({ area, rowCountOfHeader }) => rowCountOfHeader > 0 && area.topRowIndex === rowIndex,
  );
  return (
    headedAreas.length > 0 &&
    reads
      .columnIndexesOnShowIn(state.sheetId, rowIndex)
      .every(
        (columnIndex) =>
          headedAreas.some(({ area }) => isInSpan(columnIndex, area.leftColumnIndex, area.columnCount)),
      )
  );
}
export function makeIsInTableHeader(headedAreas: readonly TableHeaderArea[]): (area: CellArea) => boolean {
  if (headedAreas.length === 0) return isInNoTableHeader;
  return ({ topRowIndex, leftColumnIndex }: CellArea) =>
    headedAreas.some(
      ({ area, rowCountOfHeader }) =>
        isInSpan(topRowIndex, area.topRowIndex, rowCountOfHeader) && isInSpan(leftColumnIndex, area.leftColumnIndex, area.columnCount),
    );
}
export const doAreasIntersect = (area: CellArea, otherArea: CellArea): boolean =>
  area.topRowIndex < otherArea.topRowIndex + otherArea.rowCount &&
  otherArea.topRowIndex < area.topRowIndex + area.rowCount &&
  area.leftColumnIndex < otherArea.leftColumnIndex + otherArea.columnCount &&
  otherArea.leftColumnIndex < area.leftColumnIndex + area.columnCount;
export const NO_TABLES_IN_VIEW: OutlinableTable[] = [];
export const headedAreasOfOwnFilters = (ownFilters: readonly OwnFilter[], reads: WorkbookReads): TableHeaderArea[] =>
  ownFilters.flatMap((ownFilter) => {
    let area = areaOfFilteredTable(reads, ownFilter);
    if (area === null) return [];
    return [
      {
        area,
        rowCountOfHeader: area.rowIndexOfButtons - area.topRowIndex + 1,
      },
    ];
  });
export const tablesInViewCache = new WeakMap<PageState, TablesInViewCached>();
export const canOutlineTable = (
  table: Pick<PlacedTable, 'sheetId' | 'header' | 'columns' | 'table'>,
  state: Pick<PageState, 'tablesNotFormatted'>,
  reads: WorkbookReads,
): boolean => hasCellsOnShowIn(table.sheetId, table.header, table.columns, reads) && hasNoUnformattedMark(state, table, reads);
export const tableAreaOfFilledBody = (
  area: CellArea,
  tables: readonly TableHeaderArea[],
  state: PageState,
  reads: WorkbookReads,
): CellArea | null =>
  [...tables, ...headedAreasOfOwnFilters(ownFiltersOfSheet(state, state.sheetId), reads)].find(
    ({ area: tableArea, rowCountOfHeader }) =>
      isAreaWithin(area, tableArea) &&
      area.columnCount === tableArea.columnCount &&
      area.topRowIndex <= tableArea.topRowIndex + rowCountOfHeader &&
      area.topRowIndex + area.rowCount === tableArea.topRowIndex + tableArea.rowCount,
  )?.area ?? null;
export const isInNoTableHeader = (): boolean => false;
