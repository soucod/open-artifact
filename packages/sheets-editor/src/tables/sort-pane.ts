import { headingRowCountByFreeze, sortHoldsOfColumn, widenToRegionColumns, withoutFooterRows } from './sort.ts';
import { headedTableBoundsAtCell } from './table-to-sort.ts';
import { lacksHeadingRow, sortHeadingOfColumn, headingTextAt } from '../ui/sort-menu.ts';
import { sortColumnOfMenu, withNoEffects } from '../state/transitions.ts';
import { layoutOfView, sheetOfViewOrEmpty } from '../grid/layout.ts';
import { selectedArea, selectionPositionsOf } from '../selection/model.ts';
import { isSelectionOneCell } from '../selection/keyboard.ts';
import { currentRegionAround } from '../selection/jumps.ts';
import { parseA1AreaAsSeen, columnLetters } from '../model/a1-references.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { areaRefBetween } from '../model/workbook.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { openMenuAtActiveCell } from '../ui/menu.ts';
import type { ColumnId, SheetId, SortDirection } from '@open-artifact/sheets-core';
import type { PageState, SortHoldsOfColumn } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CellArea, SelectionPositions } from '../selection/model.ts';
import type { ColumnSpan } from '../grid/sticky-headers.ts';
import type { RowsToSort, SortEdit, SortWidening } from './sort.ts';
/** What the sort pane sorts: the selected range, or the whole sheet. */
export type SortPaneScope = 'sheet' | 'range';
/** Whom a sort is made for: the person alone (a sort of their own) or everyone. */
export type SortsFor = 'oneself' | 'everyone';
/** A column to sort by, and which way. */
export interface SortKey {
  columnId: ColumnId;
  direction: SortDirection;
}
/** A column the sort in the pane goes by, under the id the pane gave it. */
export interface SortKeyWithId extends SortKey {
  keyId: number;
}
/**
 * The sort open in the side pane: the cells it sorts (their sheet, corners, and the area and sheet size they stood at),
 * whether their top row is a header, the columns it goes by, the cells typed in its field, and whether it moves whole rows.
 */
export interface SortOfPane {
  sheetId: SheetId;
  topLeft: CellId;
  bottomRight: CellId;
  stoodAt: CellArea;
  sizeOfSheet: Pick<CellArea, 'rowCount' | 'columnCount'>;
  hasHeaderRow: boolean;
  keys: SortKeyWithId[];
  nextKeyId: number;
  cellsTyped?: string;
  areCellsTypedRefused?: true;
  movesWholeRows?: boolean;
  sortsFor?: SortsFor | null;
  isAskedForEveryone?: true;
}
/** A column the sort in the pane can go by: its id, its letters, and its heading (`''` when it has none). */
export interface SortPaneColumn {
  columnId: ColumnId;
  letters: string;
  heading: string;
}
/** A column the sort in the pane goes by, its direction, and what its cells hold. */
export interface SortKeyInPane extends SortKeyWithId {
  holds: SortHoldsOfColumn | null;
}
/** The custom sort pane as drawn. */
export interface DrawnSortPane {
  cells: string;
  cellsTyped: string | null;
  areCellsTypedRefused: boolean;
  hasHeaderRow: boolean;
  columns: SortPaneColumn[];
  keys: SortKeyInPane[];
  isLargeEditBeingSaved: boolean;
  canAddKey: boolean;
  canSort: boolean;
  sortsFor: SortsFor | null;
}
/** What the person does in the custom sort pane. */
export type SortPaneAct =
  | { kind: 'typeCells'; text: string }
  | { kind: 'dropTypedCells' }
  | { kind: 'useSelection' }
  | { kind: 'enterCells' }
  | { kind: 'setHeaderRow'; isOn: boolean }
  | { kind: 'setColumn'; keyId: number; columnId: ColumnId }
  | { kind: 'setDirection'; keyId: number; direction: SortDirection }
  | { kind: 'addKey' }
  | { kind: 'removeKey'; keyId: number }
  | { kind: 'moveKey'; keyId: number; toIndex: number }
  | { kind: 'sort' };
/** An act in the sort pane as the page gets it, saying whether it was done with no keyboard. */
export type SortPaneActSent = SortPaneAct & { isWithNoKeyboard?: boolean };
/** A table to sort by keys: its cells, whether their top row is a header, and whether the sort moves whole rows. */
export interface TableToSortByKeys {
  cells: CellArea;
  hasHeaderRow: boolean;
  movesWholeRows?: boolean;
}
interface DrawnSortPaneCached {
  reads: WorkbookReads;
  frozenRowCount: number;
  profilesById: PageState['profilesById'];
  isLargeEditBeingSaved: boolean;
  drawn: DrawnSortPane;
}
export function withSortPaneSortsFor(state: PageState, sortsFor: SortsFor | null): PageState {
  let sort = sortOfSidePane(state);
  return sort === null || sort.sortsFor === sortsFor ? state : withSortPane(state, { ...sort, sortsFor });
}
export function withSortPaneAskedForEveryone(state: PageState): PageState {
  let sort = sortOfSidePane(state);
  return sort === null ? state : withSortPane(state, { ...sort, isAskedForEveryone: true });
}
export function areaOfSortCorners(workbook: WorkbookReads, { topLeft, bottomRight }: Pick<SortOfPane, 'topLeft' | 'bottomRight'>): CellArea | null {
  let [topLeftPosition, bottomRightPosition] = [workbook.positionOfCell(topLeft), workbook.positionOfCell(bottomRight)];
  if (topLeftPosition === null || bottomRightPosition === null) return null;
  if (bottomRightPosition.rowIndex < topLeftPosition.rowIndex || bottomRightPosition.columnIndex < topLeftPosition.columnIndex) return null;
  return {
    topRowIndex: topLeftPosition.rowIndex,
    leftColumnIndex: topLeftPosition.columnIndex,
    rowCount: bottomRightPosition.rowIndex - topLeftPosition.rowIndex + 1,
    columnCount: bottomRightPosition.columnIndex - topLeftPosition.columnIndex + 1,
  };
}
export function guessHasHeaderRow(state: PageState, workbook: WorkbookReads, area: CellArea): boolean {
  let recordsTopRowIndex = headingRowCountByFreeze(state, workbook);
  if (area.topRowIndex < recordsTopRowIndex) return true;
  let topRowCells = workbook.cellsOnShowIn(state.sheetId, {
    ...area,
    rowCount: 1,
  });
  if (area.topRowIndex === recordsTopRowIndex && !lacksHeadingRow(state, workbook, topRowCells)) return false;
  return (
    area.rowCount > 1 &&
    topRowCells.length > 0 &&
    topRowCells.every((cellId) => valueOrInputOfCell(workbook, cellId)?.kind === 'text')
  );
}
export function sortSpecOfArea(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  area: CellArea,
  sort: Pick<SortOfPane, 'topLeft' | 'hasHeaderRow' | 'keys' | 'nextKeyId'> | null,
  holds: SortPaneScope = 'range',
): SortOfPane | null {
  let { sheetId } = state;
  let { topRowIndex, leftColumnIndex, rowCount, columnCount } = area;
  let topLeft = workbook.cellIdAt(sheetId, topRowIndex, leftColumnIndex);
  let bottomRight = workbook.cellIdAt(sheetId, topRowIndex + rowCount - 1, leftColumnIndex + columnCount - 1);
  if (topLeft === null || bottomRight === null) return null;
  let isColumnInSortArea = (columnId: ColumnId) => isColumnInArea(workbook, sheetId, area, columnId);
  let keys = sort?.keys.filter(({ columnId }) => isColumnInSortArea(columnId)) ?? [];
  let nextKeyId = sort?.nextKeyId ?? 0;
  let columnPicked = sortColumnOfMenu(state.menu, holds) ?? state.activeCell.columnId;
  let firstKeyColumnId = isColumnInSortArea(columnPicked) ? columnPicked : topLeft.columnId;
  let { rowCount: sheetRowCount, columnCount: sheetColumnCount } = layoutOfView(state, workbook);
  return {
    sheetId,
    topLeft,
    bottomRight,
    stoodAt: area,
    sizeOfSheet: {
      rowCount: sheetRowCount,
      columnCount: sheetColumnCount,
    },
    hasHeaderRow: sort?.topLeft.rowId === topLeft.rowId ? sort.hasHeaderRow : guessHasHeaderRow(state, workbook, area),
    ...(keys.length > 0
      ? {
          keys,
          nextKeyId,
        }
      : {
          keys: [
            {
              keyId: nextKeyId,
              columnId: firstKeyColumnId,
              direction: 'ascending',
            },
          ],
          nextKeyId: nextKeyId + 1,
        }),
  };
}
export function areaOnShowIfWhole(state: PageState, workbook: ReadsWithTextMeasurer, area: CellArea): CellArea | null {
  let { rowCount, columnCount } = layoutOfView(state, workbook);
  if (area.rowCount < rowCount && area.columnCount < columnCount) return area;
  return workbook.areaOnShowIn(state.sheetId, area);
}
export function areaToSortFromSelection(state: PageState, workbook: ReadsWithTextMeasurer): CellArea | null {
  let area = selectedArea(state, workbook);
  if (area === null) return null;
  return isSelectionOneCell(state, workbook)
    ? currentRegionAround(state, workbook, area)
    : areaOnShowIfWhole(state, workbook, withoutFooterRows(state, workbook, area));
}
export function areaToSort(state: PageState, workbook: ReadsWithTextMeasurer, holds: SortPaneScope): CellArea | null {
  if (holds === 'range') return areaToSortFromSelection(state, workbook);
  let { rowCount, columnCount } = layoutOfView(state, workbook);
  let wholeSheet = {
    topRowIndex: 0,
    leftColumnIndex: 0,
    rowCount,
    columnCount,
  };
  return workbook.areaOnShowIn(state.sheetId, wholeSheet);
}
export function areaWithoutHeadingRow(state: PageState, workbook: WorkbookReads, area: CellArea): CellArea {
  if (area.topRowIndex > 0) return area;
  let areaBelowTopRow = {
    ...area,
    topRowIndex: 1,
    rowCount: area.rowCount - 1,
  };
  let shownArea = workbook.areaOnShowIn(state.sheetId, areaBelowTopRow);
  if (shownArea === null) return area;
  let topRowCells = workbook.cellsOnShowIn(state.sheetId, {
    ...shownArea,
    rowCount: 1,
  });
  return lacksHeadingRow(state, workbook, topRowCells) ? shownArea : area;
}
export function areaOfTypedCells(state: PageState, workbook: ReadsWithTextMeasurer, typed: string): CellArea | null {
  let area = parseA1AreaAsSeen(typed, {
    ...layoutOfView(state, workbook),
    ownRowOrder: ownRowOrderOfSheet(workbook, state.sheetId),
  });
  if (area === null) return null;
  let shownArea = areaOnShowIfWhole(state, workbook, area) ?? area;
  return /\d/.test(typed) ? shownArea : areaWithoutHeadingRow(state, workbook, shownArea);
}
export function areaToSortFor(state: PageState, workbook: ReadsWithTextMeasurer, holds: SortPaneScope): CellArea | null {
  let area = areaToSort(state, workbook, holds);
  if (area === null) return null;
  let selected = selectedArea(state, workbook);
  let { rowCount, columnCount } = layoutOfView(state, workbook);
  return holds === 'range' &&
    selected !== null &&
    !isSelectionOneCell(state, workbook) &&
    selected.rowCount < rowCount &&
    selected.columnCount < columnCount
    ? area
    : areaWithoutHeadingRow(state, workbook, area);
}
export function tableRecordsAreaToSort(state: PageState, workbook: ReadsWithTextMeasurer): CellArea | null {
  if (!isSelectionOneCell(state, workbook)) return null;
  let records = headedTableBoundsAtCell(workbook, state.activeCell)?.records;
  return records === undefined
    ? null
    : {
        ...records,
        topRowIndex: records.topRowIndex - 1,
        rowCount: records.rowCount + 1,
      };
}
export function sortSpecOfSelection(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  holds: SortPaneScope,
  sort: Pick<SortOfPane, 'topLeft' | 'hasHeaderRow' | 'keys' | 'nextKeyId'> | null,
): SortOfPane | null {
  let tableArea = holds === 'range' ? tableRecordsAreaToSort(state, workbook) : null;
  let area = tableArea ?? areaToSortFor(state, workbook, holds);
  let spec = area === null ? null : sortSpecOfArea(state, workbook, area, sort, holds);
  return spec === null || tableArea === null ? spec : { ...spec, hasHeaderRow: true };
}
export function openSortPane(state: PageState, workbook: ReadsWithTextMeasurer, holds: SortPaneScope, givenArea: CellArea | null = null): PageState {
  let sort = sortSpecFor(state, workbook, holds, givenArea);
  if (sort === null)
    return {
      ...state,
      menu: null,
    };
  let timesSidePaneAsked = state.timesSidePaneAsked + (sortOfSidePane(state) === null ? 0 : 1);
  return withSortPane(
    {
      ...state,
      menu: null,
      dropdown: null,
      timesSidePaneAsked,
    },
    sort,
  );
}
export function settleSortPane(state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  let sort = sortOfSidePane(state);
  if (sort === null) return state;
  let isOnSheet = sort.sheetId === state.sheetId;
  let areaNow = isOnSheet ? areaOfSortCorners(workbook, sort) : null;
  let { rowCount, columnCount } = layoutOfView(state, workbook);
  let isSheetSameSize = rowCount === sort.sizeOfSheet.rowCount && columnCount === sort.sizeOfSheet.columnCount;
  let isSameSize = areaNow?.rowCount === sort.stoodAt.rowCount && areaNow.columnCount === sort.stoodAt.columnCount;
  const area = isOnSheet && isSheetSameSize && !isSameSize ? sort.stoodAt : areaNow;
  if (
    area !== null &&
    isSheetSameSize &&
    areSortAreasSame(area, sort.stoodAt) &&
    isSameSize &&
    sort.keys.every(({ columnId }) => isColumnInArea(workbook, sort.sheetId, area, columnId))
  )
    return state;
  let nextSort = area === null ? null : sortSpecOfArea(state, workbook, area, sort);
  if (nextSort === null) {
    let sortOfRange = sortSpecFor(state, workbook, 'range');
    return sortOfRange === null
      ? {
          ...state,
          sidePane: null,
        }
      : withSortPane(state, sortOfRange);
  }
  let { hasHeaderRow, cellsTyped, areCellsTypedRefused } = sort;
  return withSortPane(state, {
    ...nextSort,
    hasHeaderRow,
    ...(cellsTyped !== undefined && {
      cellsTyped,
    }),
    ...(areCellsTypedRefused === true && {
      areCellsTypedRefused,
    }),
  });
}
export function recordsAreaOfSort(
  state: PageState,
  workbook: WorkbookReads,
  sort: Pick<SortOfPane, 'topLeft' | 'bottomRight' | 'hasHeaderRow'>,
): CellArea | null {
  let area = areaOfSortCorners(workbook, sort);
  return area === null ? null : areaBelowRows(area, headingRowCountOfSort(state, workbook, area, sort));
}
export function drawnSortPane(state: PageState, workbook: WorkbookReads): DrawnSortPane | null {
  let sort = sortOfSidePane(state);
  if (sort === null) return null;
  let { frozenRowCount } = sheetOfViewOrEmpty(state, workbook);
  let { profilesById } = state;
  let isLargeEditBeingSaved = state.isLargeEditUnsaved && state.saving !== 'allSaved';
  let cached = drawnSortPaneCache.get(sort);
  if (
    cached?.reads === workbook &&
    cached.isLargeEditBeingSaved === isLargeEditBeingSaved &&
    cached.frozenRowCount === frozenRowCount &&
    cached.profilesById === profilesById
  )
    return cached.drawn;
  let drawn = drawSortPane(state, workbook, sort, isLargeEditBeingSaved);
  drawnSortPaneCache.set(sort, {
    reads: workbook,
    frozenRowCount,
    profilesById,
    isLargeEditBeingSaved,
    drawn,
  });
  return drawn;
}
export function drawSortPane(state: PageState, workbook: WorkbookReads, sort: SortOfPane, isLargeEditBeingSaved: boolean): DrawnSortPane {
  const area = areaOfSortCorners(workbook, sort);
  const recordsArea = recordsAreaOfSort(state, workbook, sort);
  let { sheetId, hasHeaderRow, keys } = sort;
  const startsAtRecordsTop = recordsArea?.topRowIndex === headingRowCountByFreeze(state, workbook);
  let lacksHeadings =
    startsAtRecordsTop &&
    lacksHeadingRow(
      state,
      workbook,
      workbook.cellsOnShowIn(sheetId, {
        ...recordsArea,
        rowCount: 1,
      }),
    );
  let columns =
    area === null || recordsArea === null
      ? []
      : Array.from(
          {
            length: area.columnCount,
          },
          (_, offset): SortPaneColumn[] => {
            let columnIndex = area.leftColumnIndex + offset;
            let headingRowIndex = Math.max(recordsArea.topRowIndex - 1, 0);
            let cellId = workbook.cellIdAt(sheetId, headingRowIndex, columnIndex);
            if (cellId === null) return [];
            let sortHeading = startsAtRecordsTop ? sortHeadingOfColumn(state, workbook, columnIndex) : '';
            let heading = hasHeaderRow
              ? headingTextAt(
                  state,
                  workbook,
                  {
                    rowIndex: headingRowIndex,
                    columnIndex,
                  },
                  true,
                )
              : sortHeading;
            let shownHeading = lacksHeadings ? '' : heading;
            return [
              {
                columnId: cellId.columnId,
                letters: columnLetters(columnIndex),
                heading: shownHeading,
              },
            ];
          },
        ).flat();
  return {
    cells: area === null ? '' : areaToA1AsStored(area, ownRowOrderOfSheet(workbook, sort.sheetId)),
    cellsTyped: sort.cellsTyped ?? null,
    areCellsTypedRefused: sort.areCellsTypedRefused === true,
    hasHeaderRow,
    columns,
    keys: keys.map(
      ({ keyId, columnId, direction }) => ({
        keyId,
        columnId,
        direction,
        holds:
          recordsArea === null
            ? null
            : sortHoldsOfColumn(
                workbook,
                {
                  sheetId,
                  columnId,
                },
                recordsArea,
              ),
      }),
    ),
    isLargeEditBeingSaved,
    canAddKey: keys.length < columns.length,
    canSort: !isLargeEditBeingSaved && recordsArea !== null && recordsArea.rowCount > 1 && sort.areCellsTypedRefused !== true,
    sortsFor: sort.isAskedForEveryone === true ? 'everyone' : (sort.sortsFor ?? null),
  };
}
export function sortMovesWholeRows(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): boolean {
  let isInsideArea = ({ leftColumnIndex, columnCount }: ColumnSpan) =>
    leftColumnIndex >= area.leftColumnIndex && leftColumnIndex + columnCount <= area.leftColumnIndex + area.columnCount;
  let rowsArea = {
    ...area,
    leftColumnIndex: 0,
    columnCount: 1 / 0,
  };
  let shownRowsArea = workbook.areaOnShowIn(sheetId, rowsArea);
  return (shownRowsArea === null || isInsideArea(shownRowsArea)) && workbook.mergedAreasIn(sheetId, rowsArea).every(isInsideArea);
}
export function sortCells(
  state: PageState,
  workbook: WorkbookReads,
  sort: SortOfPane,
  isWithoutKeyboard: boolean,
  select?: SelectionPositions,
): PageTransition {
  let area = areaOfSortCorners(workbook, sort);
  let recordsArea = recordsAreaOfSort(state, workbook, sort);
  if (area === null || recordsArea === null || recordsArea.rowCount < 2) return withNoEffects(state);
  let topLeftCellId = workbook.cellIdAt(sort.sheetId, recordsArea.topRowIndex, recordsArea.leftColumnIndex);
  let keys = sort.keys.flatMap(({ columnId, direction }) => {
    let columnIndex = workbook.columnIndexOf(sort.sheetId, columnId);
    return columnIndex !== null && isColumnInArea(workbook, sort.sheetId, area, columnId)
      ? [
          {
            sent: {
              byColumn: columnId,
              direction,
            },
            said: {
              column: columnLetters(columnIndex),
              direction,
            },
          },
        ]
      : [];
  });
  let [firstKey, ...thenByKeys] = keys;
  if (topLeftCellId === null || firstKey === undefined || keys.length < sort.keys.length) return withNoEffects(state);
  let sortBy = {
    ...firstKey.sent,
    ...(thenByKeys.length > 0 && {
      thenBy: thenByKeys.map(({ sent }) => sent),
    }),
  };
  let movesWholeRows = sort.movesWholeRows ?? sortMovesWholeRows(workbook, sort.sheetId, recordsArea);
  let edit: SortEdit = movesWholeRows
    ? {
        kind: 'sortRows',
        sheetId: sort.sheetId,
        oneRow: topLeftCellId.rowId,
        otherRow: sort.bottomRight.rowId,
        ...sortBy,
      }
    : {
        kind: 'sortCells',
        cells: areaRefBetween(topLeftCellId, sort.bottomRight),
        ...sortBy,
      };
  let selectAfter: SelectionPositions = {
    active: {
      rowIndex: area.topRowIndex,
      columnIndex: area.leftColumnIndex,
    },
    corner: {
      rowIndex: area.topRowIndex + area.rowCount - 1,
      columnIndex: area.leftColumnIndex + area.columnCount - 1,
    },
    walked: null,
    isOneCell: false,
    scrollTop: state.scrollTop,
  };
  return queueEdit(state, edit, {
    ...IF_QUEUED_DEFAULTS,
    select: select ?? (movesWholeRows ? selectAfter : area),
    done: {
      what: 'cellsSorted',
      ...firstKey.said,
      headingRowCount: area.rowCount - recordsArea.rowCount,
      ...(select !== undefined && {
        cells: areaToA1AsStored(recordsArea, ownRowOrderOfSheet(workbook, sort.sheetId)),
      }),
      ...(thenByKeys.length > 0 && {
        thenBy: thenByKeys.map(({ said }) => said),
      }),
    },
    undoOffer: isWithoutKeyboard
      ? {
          kind: 'sortedWithNoKeyboard',
          ...firstKey.said,
          isSaved: false,
        }
      : null,
  });
}
export function sortByPane(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  sort: SortOfPane,
  isWithoutKeyboard: boolean,
  select?: SelectionPositions,
): PageTransition {
  let recordsArea = recordsAreaOfSort(state, workbook, sort);
  if (recordsArea === null || recordsArea.rowCount < 2) return withNoEffects(state);
  let table = widenToRegionColumns(state, workbook, recordsArea);
  if (table.columnCount === recordsArea.columnCount || sort.movesWholeRows === true)
    return sortCells(state, workbook, sort, isWithoutKeyboard, select);
  return withNoEffects(
    openMenuAtActiveCell(state, workbook, {
      holds: 'cellsToSort',
      cellsToSort: {
        change: 'sortByKeysOfPane',
        selection: areaToA1AsStored(recordsArea, ownRowOrderOfSheet(workbook, sort.sheetId)),
        table: areaToA1AsStored(table, ownRowOrderOfSheet(workbook, sort.sheetId)),
      },
    }),
  );
}
export function sortTableWithKeys(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  { cells, hasHeaderRow, movesWholeRows }: TableToSortByKeys,
  keys: readonly SortKey[],
  isWithoutKeyboard: boolean,
): PageTransition {
  let sort = sortSpecOfArea(state, workbook, cells, null);
  if (sort === null || keys.length === 0) return withNoEffects(state);
  let keysWithIds = keys.map(
    (key, keyId) => ({
      ...key,
      keyId,
    }),
  );
  let sortState = {
    ...sort,
    hasHeaderRow,
    keys: keysWithIds,
    nextKeyId: keysWithIds.length,
  };
  let sortToRun = {
    ...sortState,
    ...(movesWholeRows !== undefined && {
      movesWholeRows,
    }),
  };
  let stateWithPane = withSortPane(state, sortToRun);
  let coversAllRecords = recordsAreaOfSort(stateWithPane, workbook, sortToRun)?.rowCount === cells.rowCount - (hasHeaderRow ? 1 : 0);
  if (drawnSortPane(stateWithPane, workbook)?.canSort !== true || !coversAllRecords) return withNoEffects(withSortPane(state, sortState));
  let select = selectionPositionsOf(state, workbook) ?? undefined;
  let outcome = sortByPane(stateWithPane, workbook, sortToRun, isWithoutKeyboard, select);
  return outcome.state.menu !== null
    ? {
        ...outcome,
        state: withSortPane(outcome.state, sortState),
      }
    : {
        ...outcome,
        state: {
          ...outcome.state,
          sidePane: state.sidePane,
        },
      };
}
export function sortChosenCells(state: PageState, workbook: ReadsWithTextMeasurer, chosen: SortWidening, isWithoutKeyboard: boolean): PageTransition {
  let sort = sortOfSidePane(state);
  let area = sort === null ? null : areaOfSortCorners(workbook, sort);
  let recordsArea = sort === null ? null : recordsAreaOfSort(state, workbook, sort);
  if (sort === null || area === null || recordsArea === null) return withNoEffects(state);
  if (chosen === 'selection') return sortCells(state, workbook, sort, isWithoutKeyboard);
  let { leftColumnIndex, columnCount } = widenToRegionColumns(state, workbook, recordsArea);
  let widenedSort = sortSpecOfArea(
    state,
    workbook,
    {
      ...area,
      leftColumnIndex,
      columnCount,
    },
    sort,
  );
  return widenedSort === null ? withNoEffects(state) : sortCells(withSortPane(state, widenedSort), workbook, widenedSort, isWithoutKeyboard);
}
export function actInSortPane(state: PageState, workbook: ReadsWithTextMeasurer, action: SortPaneActSent): PageTransition {
  const sort = sortOfSidePane(state);
  if (sort === null) return withNoEffects(state);
  let { cellsTyped, areCellsTypedRefused, ...sortWithoutTyped } = sort;
  let withSort = (nextSort: SortOfPane) => withNoEffects(withSortPane(state, nextSort));
  let withKeys = (keys: SortKeyWithId[]) =>
    withSort({
      ...sort,
      keys,
    });
  let changeKey = (keyId: number, change: Partial<SortKey>) =>
    withKeys(
      sort.keys.map(
        (key) =>
          key.keyId === keyId
            ? {
                ...key,
                ...change,
              }
            : key,
      ),
    );
  switch (action.kind) {
    case 'typeCells':
      return withSort({
        ...sortWithoutTyped,
        cellsTyped: action.text,
      });
    case 'dropTypedCells':
      return withSort(sortWithoutTyped);
    case 'useSelection': {
      let selected = selectedArea(state, workbook);
      return withSort(
        sortSpecOfSelection(state, workbook, 'range', sortWithoutTyped) ??
          (selected === null ? null : sortSpecOfArea(state, workbook, selected, sortWithoutTyped)) ??
          sortWithoutTyped,
      );
    }
    case 'enterCells': {
      if (cellsTyped === undefined) return withNoEffects(state);
      if (cellsTyped.trim() === '') return withSort(sortWithoutTyped);
      let typedArea = areaOfTypedCells(state, workbook, cellsTyped);
      let sortOfTypedArea = typedArea === null ? null : sortSpecOfArea(state, workbook, typedArea, sortWithoutTyped);
      return withSort(
        sortOfTypedArea ?? {
          ...sortWithoutTyped,
          cellsTyped,
          areCellsTypedRefused: true,
        },
      );
    }
    case 'setHeaderRow':
      return withSort({
        ...sort,
        hasHeaderRow: action.isOn,
      });
    case 'setColumn':
      return changeKey(action.keyId, {
        columnId: action.columnId,
      });
    case 'setDirection':
      return changeKey(action.keyId, {
        direction: action.direction,
      });
    case 'addKey': {
      let columnIdsOfKeys = new Set(sort.keys.map(({ columnId }) => columnId));
      let drawn = drawnSortPane(state, workbook);
      let columnToAdd = drawn?.columns.find(({ columnId }) => !columnIdsOfKeys.has(columnId));
      if (columnToAdd === undefined || drawn?.canAddKey !== true) return withNoEffects(state);
      let addedKey: SortKeyWithId = {
        keyId: sort.nextKeyId,
        columnId: columnToAdd.columnId,
        direction: 'ascending',
      };
      return withSort({
        ...sort,
        keys: [...sort.keys, addedKey],
        nextKeyId: sort.nextKeyId + 1,
      });
    }
    case 'removeKey':
      return sort.keys.length < 2 ? withNoEffects(state) : withKeys(sort.keys.filter(({ keyId }) => keyId !== action.keyId));
    case 'moveKey': {
      let match = sort.keys.find(({ keyId }) => keyId === action.keyId);
      if (match === undefined) return withNoEffects(state);
      let otherKeys = sort.keys.filter((key) => key !== match);
      return withKeys([...otherKeys.slice(0, action.toIndex), match, ...otherKeys.slice(action.toIndex)]);
    }
    case 'sort': {
      let { state: enteredState } = actInSortPane(state, workbook, {
        kind: 'enterCells',
      });
      let enteredSort = sortOfSidePane(enteredState);
      let cannotSort = drawnSortPane(enteredState, workbook)?.canSort !== true || enteredSort?.cellsTyped !== undefined;
      return enteredSort === null || cannotSort ? withNoEffects(enteredState) : sortByPane(enteredState, workbook, enteredSort, action.isWithNoKeyboard === true);
    }
  }
}
export const sortOfSidePane = ({ sidePane }: Pick<PageState, 'sidePane'>): SortOfPane | null => (sidePane?.kind === 'sort' ? sidePane.sort : null);
export const withSortPane = (state: PageState, sort: SortOfPane): PageState => ({
  ...state,
  sidePane: {
    kind: 'sort',
    sort,
  },
});
export const valueOrInputOfCell = (workbook: WorkbookReads, cellId: CellId) => {
  let cell = workbook.cellOnShowIn(cellId);
  if (cell === null) return;
  return 'input' in cell ? (cell.value ?? cell.input) : cell.value;
};
export const isColumnInArea = (
  workbook: WorkbookReads,
  sheetId: SheetId,
  { leftColumnIndex, columnCount }: ColumnSpan,
  columnId: ColumnId,
): boolean => {
  let columnIndex = workbook.columnIndexOf(sheetId, columnId);
  return columnIndex !== null && columnIndex >= leftColumnIndex && columnIndex < leftColumnIndex + columnCount;
};
export const areSortAreasSame = (one: CellArea, other: CellArea): boolean =>
  one.topRowIndex === other.topRowIndex &&
  one.leftColumnIndex === other.leftColumnIndex &&
  one.rowCount === other.rowCount &&
  one.columnCount === other.columnCount;
export const sortSpecFor = (
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  holds: SortPaneScope,
  givenArea: CellArea | null = null,
): SortOfPane | null =>
  givenArea === null ? sortSpecOfSelection(state, workbook, holds, null) : sortSpecOfArea(state, workbook, givenArea, null, holds);
export const headingRowCountOfSort = (
  state: PageState,
  workbook: WorkbookReads,
  { topRowIndex, rowCount }: RowsToSort,
  { hasHeaderRow }: Pick<SortOfPane, 'hasHeaderRow'>,
): number => Math.min(rowCount, Math.max(hasHeaderRow ? 1 : 0, sheetOfViewOrEmpty(state, workbook).frozenRowCount - topRowIndex));
export const areaBelowRows = (area: CellArea, rowCount: number): CellArea => ({
  ...area,
  topRowIndex: area.topRowIndex + rowCount,
  rowCount: area.rowCount - rowCount,
});
export const drawnSortPaneCache = new WeakMap<SortOfPane, DrawnSortPaneCached>();
