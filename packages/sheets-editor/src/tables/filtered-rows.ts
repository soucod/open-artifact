import type { IdRun, RowId, SheetId } from '@open-artifact/sheets-core';
import { allRangesOf, withoutOtherRanges } from '../selection/several-ranges.ts';
import {
  selectedArea,
  selectionOfArea,
  mergedAreaOrCellOf,
  selectionAreaAndKind,
  areaOfPosition,
  moveActiveCellTo,
  scrollToShowSelection,
} from '../selection/model.ts';
import type { CellArea, CellPosition, CellSelection } from '../selection/model.ts';
import { isSelectionOneCell } from '../selection/keyboard.ts';
import { rowsHiddenByOwnFilters, findSheetById, clampScrollOfView, keepScrollAnchoredAcrossChange, layoutOfView } from '../grid/layout.ts';
import type { GridLayout } from '../grid/layout.ts';
import { collapseLineSizes, createLineSizes, isLineShown, nearestShownLine, shownLineAtOrBefore, shownLineAtOrAfter } from '../model/line-sizes.ts';
import type { LineSizes } from '../model/line-sizes.ts';
import { NO_ROWS_OUT_OF_VIEW_BY_FILTERS, clipIndexRuns } from '../grid/line-runs.ts';
import { createLineIndex } from '../model/line-ids.ts';
import type { LineIndex, LineSpan } from '../model/line-ids.ts';
import { remapSelectionCorners } from '../selection/remap.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { Place } from '../state/places.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** How much of a selection is cut into the pieces on show: all of it, or only its first pieces. */
export type ShownPiecesScope = 'allOfIt' | 'theFirstParts';
/**
 * Reads of a workbook as if the rows out of view were not there, with the ways between areas
 * on show (`here`) and areas in the sheet (`there`).
 */
export interface ReadsOverShownRows {
  there: (area: CellArea) => CellArea;
  here: (area: CellArea) => CellArea;
  reads: WorkbookReads;
}
/** The rows an area takes up. */
type RowsOfArea = Pick<CellArea, 'topRowIndex' | 'rowCount'>;
export function shownPiecesOfArea(state: PageState, reads: WorkbookReads, area: CellArea): CellArea[] {
  const filteredRuns = filteredRowRunsIn(state, reads, area);
  if (filteredRuns.length === 0) return [area];
  const pieces: CellArea[] = [];
  let nextTop = area.topRowIndex;
  for (const run of [
    ...filteredRuns,
    {
      firstIndex: area.topRowIndex + area.rowCount,
      count: 0,
    },
  ]) {
    if (run.firstIndex > nextTop)
      pieces.push({
        ...area,
        topRowIndex: nextTop,
        rowCount: run.firstIndex - nextTop,
      });
    nextTop = run.firstIndex + run.count;
  }
  return pieces;
}
export function lastShownRowIndex(state: PageState, reads: WorkbookReads, rowCount: number): number | null {
  const lastRun = filteredRowRunsIn(state, reads, {
    topRowIndex: 0,
    rowCount,
  }).at(-1);
  const lastShown = lastRun !== undefined && lastRun.firstIndex + lastRun.count === rowCount ? lastRun.firstIndex - 1 : rowCount - 1;
  return lastShown < 0 ? null : lastShown;
}
export function selectionOfShownPieces(selection: PageState, reads: WorkbookReads, scope: ShownPiecesScope): PageState {
  if (!selection.rowsOutOfViewByOwnFilters.has(selection.sheetId)) return selection;
  const ranges = allRangesOf(selection);
  const newRanges = ranges.flatMap((range) => {
    const area = selectedArea(range, reads);
    if (area === null || isSelectionOneCell(range, reads)) return range;
    const pieces = shownPiecesOfArea(selection, reads, area);
    const isTooSplit = pieces.length > MAX_SHOWN_PIECES && scope === 'allOfIt';
    return pieces[0] === area || isTooSplit
      ? range
      : pieces.slice(0, MAX_SHOWN_PIECES).flatMap((piece) => selectionOfArea(selection, reads, piece) ?? []);
  });
  const current = newRanges.at(-1);
  return newRanges.every((range, rangeIndex) => range === ranges[rangeIndex]) || current === undefined
    ? selection
    : {
        ...selection,
        ...current,
        otherRanges: newRanges.slice(0, -1),
      };
}
export function makeIsCellFilteredOut(state: PageState, reads: WorkbookReads): (cell: CellId) => boolean {
  const hiddenRowIds = state.rowsOutOfViewByOwnFilters.get(state.sheetId);
  if (hiddenRowIds === undefined || rowsHiddenByOwnFilters(state, reads, state.sheetId).length === 0) return () => false;
  return (cell: CellId) => {
    const mergedArea = hiddenRowIds.has(cell.rowId) ? mergedAreaOrCellOf(reads, cell) : null;
    return mergedArea !== null && shownPiecesOfArea(state, reads, mergedArea).length === 0;
  };
}
export function readsOverShownRows(selection: PageState, reads: WorkbookReads): ReadsOverShownRows | null {
  const hiddenRuns = rowsHiddenByOwnFilters(selection, reads, selection.sheetId);
  const rowCount = findSheetById(reads, selection.sheetId)?.rowCount;
  if (hiddenRuns.length === 0 || rowCount === undefined) return null;
  const shownRowEdges = shownRowEdgesCache.get(hiddenRuns) ?? collapseLineSizes(createLineSizes(rowCount, [], 1), hiddenRuns);
  shownRowEdgesCache.set(hiddenRuns, shownRowEdges);
  const toActualArea = (area: CellArea): CellArea => {
    const topRowIndex = shownRowEdges.startOf(area.topRowIndex);
    const actualRowCount = shownRowEdges.startOf(area.topRowIndex + area.rowCount) - topRowIndex;
    return {
      ...area,
      topRowIndex,
      rowCount: actualRowCount,
    };
  };
  const toShownArea = (area: CellArea): CellArea => {
    const topRowIndex = shownRowEdges.indexAt(area.topRowIndex);
    const bottomRowIndex = shownRowEdges.indexAt(area.topRowIndex + area.rowCount - 1);
    return {
      ...area,
      topRowIndex,
      rowCount: bottomRowIndex - topRowIndex + 1,
    };
  };
  const isOtherSheet = (sheetId: SheetId) => sheetId !== selection.sheetId;
  return {
    there: toActualArea,
    here: toShownArea,
    reads: {
      ...reads,
      cellIdAt(sheetId: SheetId, rowIndex: number, columnIndex: number) {
        if (isOtherSheet(sheetId)) return reads.cellIdAt(sheetId, rowIndex, columnIndex);
        const position = {
          rowIndex: shownRowEdges.indexAt(rowIndex),
          columnIndex,
        };
        const mergedAbove =
          position.rowIndex > 0 && !isLineShown(shownRowEdges, position.rowIndex - 1) ? reads.mergedAreaAt(sheetId, position) : null;
        const startsAtRow = mergedAbove?.leftColumnIndex === columnIndex && shownRowEdges.startOf(mergedAbove.topRowIndex) === rowIndex;
        return reads.cellIdAt(sheetId, startsAtRow ? mergedAbove.topRowIndex : position.rowIndex, columnIndex);
      },
      mergedAreaAt(sheetId: SheetId, position: CellPosition) {
        if (isOtherSheet(sheetId)) return reads.mergedAreaAt(sheetId, position);
        const mergedArea = reads.mergedAreaAt(sheetId, {
          ...position,
          rowIndex: shownRowEdges.indexAt(position.rowIndex),
        });
        return mergedArea === null ? null : toActualArea(mergedArea);
      },
      mergedAreasIn: (sheetId: SheetId, area: CellArea) =>
        isOtherSheet(sheetId)
          ? reads.mergedAreasIn(sheetId, area)
          : reads
              .mergedAreasIn(sheetId, toShownArea(area))
              .map(toActualArea)
              .filter((mergedArea) => mergedArea.rowCount > 0),
    },
  };
}
export function withRowsHiddenByOwnFilters(
  selection: PageState,
  reads: ReadsWithTextMeasurer,
  sheetId: SheetId,
  hiddenRowKeys: Set<RowId>,
): PageState {
  const hiddenBySheet = new Map(selection.rowsOutOfViewByOwnFilters);
  if (hiddenRowKeys.size === 0) hiddenBySheet.delete(sheetId);
  else hiddenBySheet.set(sheetId, hiddenRowKeys);
  return clampScrollOfView(
    keepScrollAnchoredAcrossChange(
      {
        ...selection,
        rowsOutOfViewByOwnFilters: hiddenBySheet,
      },
      reads,
      reads,
      selection,
    ),
    reads,
  );
}
export function moveSelectionOffFilteredRows(selection: PageState, reads: ReadsWithTextMeasurer): PageState {
  const [activePosition, cornerPosition] = [reads.positionOfCell(selection.activeCell), reads.positionOfCell(selection.selectionCorner)];
  const area = selectedArea(selection, reads);
  if (activePosition === null || cornerPosition === null || area === null) return selection;
  const layout = layoutOfView(selection, reads);
  if (area.rowCount === layout.rowCount) return selection;
  const isWholeRows = selectionAreaAndKind(selection, reads)?.kind === 'rows';
  const isCellFilteredOut = (position: CellPosition) => {
    const cellArea = (isWholeRows ? null : reads.mergedAreaAt(selection.sheetId, position)) ?? areaOfPosition(position);
    return !areaHasShownRow(layout, cellArea) && filteredRowRunsIn(selection, reads, cellArea).length > 0;
  };
  const { rowEdges, rowCount, columnEdges, columnCount } = layout;
  const { scrollTop, scrollLeft } = selection;
  if (isCellFilteredOut(activePosition)) {
    const newActiveCell = reads.cellIdAt(
      selection.sheetId,
      nearestShownLine(rowEdges, rowCount, activePosition.rowIndex, 1),
      nearestShownLine(columnEdges, columnCount, activePosition.columnIndex, 1),
    );
    if (newActiveCell === null) return selection;
    return {
      ...moveActiveCellTo(withoutOtherRanges(selection), reads, newActiveCell),
      scrollTop,
      scrollLeft,
    };
  }
  if (!isCellFilteredOut(cornerPosition)) return selection;
  const newCorner = reads.cellIdAt(
    selection.sheetId,
    cornerPosition.rowIndex >= activePosition.rowIndex
      ? shownLineAtOrBefore(rowEdges, area.topRowIndex + area.rowCount - 1)
      : shownLineAtOrAfter(rowEdges, area.topRowIndex),
    cornerPosition.columnIndex,
  );
  return newCorner === null
    ? selection
    : {
        ...selection,
        selectionCorner: newCorner,
      };
}
export function dropFilteredOutOtherRanges(selection: PageState, reads: ReadsWithTextMeasurer): PageState {
  const layout = layoutOfView(selection, reads);
  const keptRanges = selection.otherRanges.filter((range) => {
    const area = selectedArea(range, reads);
    return area === null || areaHasShownRow(layout, area) || filteredRowRunsIn(selection, reads, area).length === 0;
  });
  return keptRanges.length === selection.otherRanges.length
    ? selection
    : {
        ...selection,
        otherRanges: keptRanges,
      };
}
export function keepSelectionOnShownRows(selection: PageState, reads: ReadsWithTextMeasurer): PageState {
  if (selection.rowsOutOfViewByOwnFilters.size === 0) return selection;
  const placesLeft = selection.placesLeft.map((place) => {
    const placeSelection = {
      ...selection,
      ...place,
    };
    const { activeCell, selectionCorner } = moveSelectionOffFilteredRows(placeSelection, reads);
    return activeCell === place.activeCell && selectionCorner === place.selectionCorner
      ? place
      : {
          ...place,
          activeCell,
          selectionCorner,
        };
  });
  const withPlacesKept = {
    ...selection,
    placesLeft,
  };
  if (selection.mode.kind === 'editing' || selection.activeCell.sheetId !== selection.sheetId) return withPlacesKept;
  const moved = moveSelectionOffFilteredRows(dropFilteredOutOtherRanges(withPlacesKept, reads), reads);
  return moved.activeCell === selection.activeCell || selection.ownFilterList !== null ? moved : scrollToShowSelection(moved, reads);
}
export function withoutFrozenRowKeys(reads: WorkbookReads, sheetId: SheetId, rowKeys: Set<RowId>): Set<RowId> {
  const frozenRowCount = findSheetById(reads, sheetId)?.frozenRowCount ?? 0;
  const keptKeys = [...rowKeys].filter((rowKey) => (reads.rowIndexOf(sheetId, rowKey) ?? -1) >= frozenRowCount);
  return keptKeys.length === rowKeys.size ? rowKeys : new Set(keptKeys);
}
export function rowsHiddenByOwnFiltersAfterChange(
  { rowsOutOfViewByOwnFilters: hiddenBySheet }: Pick<PageState, 'rowsOutOfViewByOwnFilters'>,
  readsBefore: WorkbookReads,
  readsNow: WorkbookReads,
): Map<SheetId, Set<RowId>> {
  if (hiddenBySheet.size === 0) return hiddenBySheet;
  const kept = new Map<SheetId, Set<RowId>>();
  for (const [sheetId, rowKeys] of hiddenBySheet) {
    const keptKeys =
      readsNow.linesOf(sheetId)?.rows === readsBefore.linesOf(sheetId)?.rows &&
      findSheetById(readsNow, sheetId)?.frozenRowCount === findSheetById(readsBefore, sheetId)?.frozenRowCount
        ? rowKeys
        : withoutFrozenRowKeys(readsNow, sheetId, rowKeys);
    if (keptKeys.size > 0 && findSheetById(readsNow, sheetId) !== undefined) kept.set(sheetId, keptKeys);
  }
  if (kept.size === 0) return NO_ROWS_OUT_OF_VIEW_BY_FILTERS;
  return kept.size === hiddenBySheet.size && [...kept].every(([sheetId, rowKeys]) => hiddenBySheet.get(sheetId) === rowKeys)
    ? hiddenBySheet
    : kept;
}
export function shownRowRunsOfLines(rows: LineIndex, hiddenRuns: readonly LineSpan[]): IdRun[] {
  const shownRuns: IdRun[] = [];
  let nextIndex = 0;
  for (const hiddenRun of [
    ...hiddenRuns,
    {
      firstIndex: rows.count,
      count: 0,
    },
  ]) {
    shownRuns.push(
      ...rows.runsIn({
        firstIndex: nextIndex,
        count: hiddenRun.firstIndex - nextIndex,
      }),
    );
    nextIndex = hiddenRun.firstIndex + hiddenRun.count;
  }
  return shownRuns;
}
export function readsWithOnlyShownRows(
  reads: WorkbookReads,
  sheetId: SheetId,
  hiddenRuns: readonly LineSpan[],
): Pick<WorkbookReads, 'linesOf' | 'cellIdAt'> {
  const lines = reads.linesOf(sheetId);
  if (lines === null) return reads;
  const shownRows = createLineIndex(shownRowRunsOfLines(lines.rows, hiddenRuns));
  return {
    linesOf: (otherSheetId: SheetId) =>
      otherSheetId === sheetId
        ? {
            ...lines,
            rows: shownRows,
          }
        : reads.linesOf(otherSheetId),
    cellIdAt(otherSheetId: SheetId, rowIndex: number, columnIndex: number) {
      if (otherSheetId !== sheetId) return reads.cellIdAt(otherSheetId, rowIndex, columnIndex);
      const actualRowIndex = lines.rows.indexOf(shownRows.idAt(rowIndex) ?? '');
      return actualRowIndex === null ? null : reads.cellIdAt(otherSheetId, actualRowIndex, columnIndex);
    },
  };
}
export function remapSelectionOverShownRows(
  place: Pick<Place, 'sheetId' | 'activeCell' | 'selectionCorner'>,
  selection: Pick<PageState, 'ownCollapsing' | 'rowsOutOfViewByOwnFilters'>,
  readsBefore: WorkbookReads,
  readsNow: WorkbookReads,
): Pick<CellSelection, 'activeCell' | 'selectionCorner'> | null {
  const { sheetId, activeCell, selectionCorner } = place;
  const hiddenRowKeys = selection.rowsOutOfViewByOwnFilters.get(sheetId);
  if (
    hiddenRowKeys === undefined ||
    hiddenRowKeys.has(activeCell.rowId) ||
    hiddenRowKeys.has(selectionCorner.rowId) ||
    readsBefore.linesOf(sheetId)?.rows === readsNow.linesOf(sheetId)?.rows
  )
    return remapSelectionCorners(place, readsBefore, readsNow);
  const hiddenRuns = rowsHiddenByOwnFilters(selection, readsNow, sheetId);
  return (
    remapSelectionCorners(place, readsBefore, readsWithOnlyShownRows(readsNow, sheetId, hiddenRuns)) ??
    remapSelectionCorners(place, readsBefore, readsNow)
  );
}
export function unhideFilteredRowsIn(
  selection: PageState,
  reads: ReadsWithTextMeasurer,
  sheetId: SheetId,
  { topRowIndex, rowCount }: RowsOfArea,
): PageState {
  const hiddenRowKeys = selection.rowsOutOfViewByOwnFilters.get(sheetId);
  if (hiddenRowKeys === undefined || rowCount === findSheetById(reads, sheetId)?.rowCount) return selection;
  const stillHidden = new Set(hiddenRowKeys);
  const runs = reads.linesOf(sheetId)?.rows.runsIn({
    firstIndex: topRowIndex,
    count: rowCount,
  });
  for (const { base, first, count } of runs ?? [])
    for (let index = first; index < first + count && stillHidden.size > 0; index += 1) stillHidden.delete(`${base}.${index}`);
  return stillHidden.size === hiddenRowKeys.size ? selection : withRowsHiddenByOwnFilters(selection, reads, sheetId, stillHidden);
}
export function unhideFilteredRowsOfSelection(selection: PageState, reads: ReadsWithTextMeasurer): PageState {
  const area = selectedArea(selection, reads);
  return area === null ? selection : unhideFilteredRowsIn(selection, reads, selection.activeCell.sheetId, area);
}
export function trimAreaToShownRows(selection: PageState, reads: WorkbookReads, area: CellArea, sheetId: SheetId): CellArea {
  const pieces = shownPiecesOfArea(
    {
      ...selection,
      sheetId,
    },
    reads,
    area,
  );
  const [firstPiece, lastPiece] = [pieces[0], pieces.at(-1)];
  if (firstPiece === undefined || lastPiece === undefined || firstPiece === area) return area;
  if (area.rowCount === findSheetById(reads, sheetId)?.rowCount) return area;
  const { topRowIndex } = firstPiece;
  return {
    ...area,
    topRowIndex,
    rowCount: lastPiece.topRowIndex + lastPiece.rowCount - topRowIndex,
  };
}
export function unhideRowsUnderActiveCell(before: Pick<PageState, 'activeCell'>, selection: PageState, reads: ReadsWithTextMeasurer): PageState {
  if (selection.rowsOutOfViewByOwnFilters.size === 0 || selection.activeCell.sheetId !== selection.sheetId) return selection;
  const cellArea = mergedAreaOrCellOf(reads, selection.activeCell);
  const area = selectedArea(selection, reads);
  if (cellArea === null || area === null) return selection;
  const layout = layoutOfView(selection, reads);
  if ((selection.mode.kind !== 'editing' && area.rowCount === layout.rowCount) || areaHasShownRow(layout, cellArea)) return selection;
  const unhidden = unhideFilteredRowsIn(selection, reads, selection.sheetId, cellArea);
  return unhidden === selection || selection.activeCell === before.activeCell ? unhidden : scrollToShowSelection(unhidden, reads);
}
export const filteredRowRunsIn = (state: PageState, reads: WorkbookReads, { topRowIndex, rowCount }: RowsOfArea): LineSpan[] =>
  clipIndexRuns(rowsHiddenByOwnFilters(state, reads, state.sheetId), {
    firstIndex: topRowIndex,
    count: rowCount,
  });
export const hasFilteredRowsIn = (state: PageState, reads: WorkbookReads, area: RowsOfArea): boolean =>
  filteredRowRunsIn(
    {
      ...state,
      sheetId: state.activeCell.sheetId,
    },
    reads,
    area,
  ).length > 0;
export const shownRowCountIn = (state: PageState, reads: WorkbookReads, area: RowsOfArea): number =>
  filteredRowRunsIn(state, reads, area).reduce((shown, { count }) => shown - count, area.rowCount);
export const MAX_SHOWN_PIECES = 100;
export const shownRowEdgesCache = new WeakMap<LineSpan[], LineSizes>();
export const areaHasShownRow = ({ rowEdges }: Pick<GridLayout, 'rowEdges'>, { topRowIndex, rowCount }: RowsOfArea): boolean =>
  shownLineAtOrAfter(rowEdges, topRowIndex) < topRowIndex + rowCount;
export const setRowsHiddenByOwnFilters = (selection: PageState, reads: ReadsWithTextMeasurer, sheetId: SheetId, rowKeys: Set<RowId>): PageState =>
  keepSelectionOnShownRows(withRowsHiddenByOwnFilters(selection, reads, sheetId, withoutFrozenRowKeys(reads, sheetId, rowKeys)), reads);
export const unhideAreaIfAllFiltered = (
  selection: PageState,
  reads: ReadsWithTextMeasurer,
  area: RowsOfArea,
  sheetId: SheetId = selection.sheetId,
): PageState =>
  areaHasShownRow(
    layoutOfView(
      {
        ...selection,
        sheetId,
      },
      reads,
    ),
    area,
  )
    ? selection
    : unhideFilteredRowsIn(selection, reads, sheetId, area);
