import type { ColumnId, RowId, SheetId } from '@open-artifact/sheets-core';
import type { LineIndex, LineSpan } from '../model/line-ids.ts';
import type { LineSizes, SizedRun } from '../model/line-sizes.ts';
import type { GroupOnGrid, PlacementOnGrid, SheetRead, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import type { TextMeasurer } from '../state/controller.ts';
import type { Dragging, PageState } from '../state/initial-state.ts';
import type { Place } from '../state/places.ts';
import type { CellDensity } from './cell-metrics-values.ts';
import { mayRowsGrowInSheet, wrappedRowHeightsOfSheet, wrappedHeightOfRow } from './wrapped-rows.ts';
import { createLineSizes, collapseLineSizes, clampPixelsPast, shownLineAtOrAfter } from '../model/line-sizes.ts';
import { rowHeightRuns, EMPTY_GRID_LAYOUT } from './cell-metrics.ts';
import { defaultRowHeightAtDensity } from './cell-metrics-values.ts';
import { collapsedIndexRuns, withOwnCollapsing, indexRunsOfIds, mergeIndexRuns } from './line-runs.ts';
import {
  frozenRowsHeight,
  frozenColumnsWidth,
  frozenCountsThatFit,
  clampBetween,
  cellsAreaHeight,
  cellsAreaWidth,
  clampScrollWithFloats,
} from './geometry.ts';
import { borderOverhangBelow, bordersAtCellOf } from './borders.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** How far the views that float over the cells reach, across and down, past the frozen lines. */
export interface ReachOfWhatFloats {
  across: number;
  down: number;
}
/** The lines of the sheet in view as the grid lays them out: their edges, the frozen lines, and the lines out of sight. */
export interface GridLayout {
  rowCount: number;
  columnCount: number;
  rowEdges: LineSizes;
  columnEdges: LineSizes;
  frozenRowCount: number;
  frozenColumnCount: number;
  rowsOutOfSight: readonly LineSpan[];
  columnsOutOfSight: readonly LineSpan[];
  reachOfWhatFloats?: ReachOfWhatFloats;
}
/** What a cell layout is kept under: the sheet as summed up, or as it stands when its rows may grow with wrapped text. */
export type CellLayoutKey = SheetSummary | SheetRead;
/** The cell layouts laid out at one density: those of sheets with no wrapped text, and those by the measurer of wrapped text. */
export interface CellLayoutCaches {
  withNoWrappedText: WeakMap<CellLayoutKey, GridLayout>;
  withWrappedText: WeakMap<TextMeasurer['lineCountsOfWrappedTexts'], WeakMap<CellLayoutKey, GridLayout>>;
}
/** The row edges last laid out for a sheet's rows, and the sizes they were laid out from. */
export interface RowEdgesCacheEntry {
  sized: readonly SizedRun[];
  plain: number;
  edges: LineSizes;
}
/** The rows out of sight, those hidden by the page's own filters and all of them. */
export interface RowsOutOfSight {
  byOwnFilters: LineSpan[];
  all: LineSpan[];
}
/** The rows out of sight last found for a set of filtered rows, and what they were found from. */
export interface RowsOutOfSightCacheEntry {
  rows: LineIndex | undefined;
  frozenRowCount: number;
  rowGroups: GroupOnGrid[];
  ownCollapsing: Map<string, boolean>;
  named: LineSpan[];
  inGroups: LineSpan[];
  found: RowsOutOfSight;
}
/** A layout with its hidden lines collapsed, and what hid them. */
export interface LayoutWithHiddenLinesCacheEntry {
  ownCollapsing: Map<string, boolean>;
  rowIds: Set<RowId> | undefined;
  layout: GridLayout;
}
/** Row edges with the rows out of sight collapsed. */
export interface RowEdgesWithHiddenRowsCacheEntry {
  outOfSight: readonly LineSpan[];
  edges: LineSizes;
}
/** A layout with the reach of the views that float over it. */
export interface ReachOfFloatsCacheEntry {
  ofCells: GridLayout;
  withReach: GridLayout;
}
/** A row or a column being resized, by its index. */
export interface LineResize {
  isA: 'row' | 'column';
  index: number;
  sizeInPixels: number;
  isByFinger: boolean;
}
/** What of the view the grid is laid out from. */
export type LayoutView = Pick<
  PageState,
  | 'sheetId'
  | 'density'
  | 'ownCollapsing'
  | 'rowsOutOfViewByOwnFilters'
  | 'dragging'
  | 'heldUntilAnswered'
  | 'gridWidth'
  | 'gridHeight'
  | 'find'
  | 'heightUnderCardAtFoot'
>;
/** The lines of one axis that a scroll is kept anchored by: their edges, the size of the frozen ones, and their ids. */
export interface ScrollAnchorLines<LineId extends RowId | ColumnId = RowId | ColumnId> {
  edges: LineSizes;
  sizeOfFrozen: number;
  idAt: (index: number) => LineId | null;
  indexOf: (lineId: LineId) => number | null;
}
/** The rows and the columns a scroll is kept anchored by. */
export interface ScrollAnchorsOfView {
  rows: ScrollAnchorLines<RowId>;
  columns: ScrollAnchorLines<ColumnId>;
}
/** A line in sight before a change, and its index after it. */
export interface AnchorCandidate {
  index: number;
  indexNow: number;
}
/** A view whose scroll is kept anchored across a change. */
export type AnchoredView = LayoutView & Pick<PageState, 'scrollTop' | 'scrollLeft' | 'placesLeft'>;
export function cellLayoutCacheFor(
  sheet: SheetSummary,
  book: ReadsWithTextMeasurer,
  density: CellDensity,
): [WeakMap<CellLayoutKey, GridLayout>, CellLayoutKey] {
  let { withNoWrappedText, withWrappedText } = cellLayoutCachesByDensity[density];
  let sheetAsItStands = book.sheetAsItStands(sheet.sheetId);
  if (sheetAsItStands === null || !mayRowsGrowInSheet(sheet.sheetId, book)) return [withNoWrappedText, sheet];
  let cached = withWrappedText.get(book.lineCountsOfWrappedTexts);
  if (cached !== undefined) return [cached, sheetAsItStands];
  let cache = new WeakMap<CellLayoutKey, GridLayout>();
  withWrappedText.set(book.lineCountsOfWrappedTexts, cache);
  return [cache, sheetAsItStands];
}
export function cachedRowEdges(rowLines: LineIndex | undefined, rowCount: number, sizedRuns: readonly SizedRun[], plainSize: number): LineSizes {
  let cached = rowLines === undefined ? undefined : rowEdgesCache.get(rowLines);
  let isSame =
    cached?.plain === plainSize &&
    cached.sized.length === sizedRuns.length &&
    cached.sized.every((run: SizedRun, index: number) => {
      let other = sizedRuns[index];
      return other?.firstIndex === run.firstIndex && other.count === run.count && other.sizeInPixels === run.sizeInPixels;
    });
  if (cached !== undefined && isSame) return cached.edges;
  let edges = createLineSizes(rowCount, sizedRuns, plainSize);
  if (rowLines !== undefined)
    rowEdgesCache.set(rowLines, {
      sized: sizedRuns,
      plain: plainSize,
      edges,
    });
  return edges;
}
export function cellLayoutOfSheet(sheet: SheetSummary, book: ReadsWithTextMeasurer, density: CellDensity): GridLayout {
  let {
    sheetId,
    rowCount,
    columnCount,
    columnEdges,
    frozenRowCount,
    frozenColumnCount,
  } = sheet;
  let [cache, cacheKey] = cellLayoutCacheFor(sheet, book, density);
  let cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  let rowEdges = cachedRowEdges(
    book.linesOf(sheetId)?.rows,
    rowCount,
    rowHeightRuns(rowCount, book.rowSizingOf(sheetId), density, wrappedRowHeightsOfSheet(sheet, book, density)),
    defaultRowHeightAtDensity(density),
  );
  let layout: GridLayout = {
    rowCount,
    columnCount,
    rowEdges,
    columnEdges,
    frozenRowCount,
    frozenColumnCount,
    rowsOutOfSight: [],
    columnsOutOfSight: [],
  };
  cache.set(cacheKey, layout);
  return layout;
}
export function rowsOutOfSightOf(
  { ownCollapsing, rowsOutOfViewByOwnFilters }: Pick<PageState, 'ownCollapsing' | 'rowsOutOfViewByOwnFilters'>,
  book: WorkbookReads,
  { sheetId, rowGroups, rowCount, frozenRowCount }: Pick<SheetSummary, 'sheetId' | 'rowGroups' | 'rowCount' | 'frozenRowCount'>,
): RowsOutOfSight {
  let filteredRowIds = rowsOutOfViewByOwnFilters.get(sheetId);
  let rowLines = book.linesOf(sheetId)?.rows;
  let cached = filteredRowIds === undefined ? undefined : rowsOutOfSightCache.get(filteredRowIds);
  let reusable = cached?.rows === rowLines && cached?.frozenRowCount === frozenRowCount ? cached : null;
  if (reusable?.rowGroups === rowGroups && reusable.ownCollapsing === ownCollapsing) return reusable.found;
  let collapsedRuns = collapsedIndexRuns(withOwnCollapsing(ownCollapsing, rowGroups));
  if (filteredRowIds === undefined || rowLines === undefined)
    return {
      byOwnFilters: [],
      all: collapsedRuns,
    };
  let filteredRuns = reusable?.named ?? indexRunsOfIds(rowLines, filteredRowIds, frozenRowCount);
  let found =
    reusable !== null && sameLineRuns(reusable.inGroups, collapsedRuns) ? reusable.found : mergeRowsOutOfSight(collapsedRuns, filteredRuns, rowCount);
  let cacheEntry: RowsOutOfSightCacheEntry = {
    rows: rowLines,
    frozenRowCount,
    rowGroups,
    ownCollapsing,
    named: filteredRuns,
    inGroups: collapsedRuns,
    found,
  };
  rowsOutOfSightCache.set(filteredRowIds, cacheEntry);
  return found;
}
export function mergeRowsOutOfSight(collapsedRuns: LineSpan[], filteredRuns: LineSpan[], rowCount: number): RowsOutOfSight {
  let merged = mergeIndexRuns(collapsedRuns, filteredRuns);
  return merged[0]?.count === rowCount
    ? {
        byOwnFilters: [],
        all: collapsedRuns,
      }
    : {
        byOwnFilters: filteredRuns,
        all: merged,
      };
}
export function rowsHiddenByOwnFilters(view: Pick<PageState, 'ownCollapsing' | 'rowsOutOfViewByOwnFilters'>, book: WorkbookReads, sheetId: SheetId): LineSpan[] {
  let sheet = findSheetById(book, sheetId);
  return sheet === undefined ? [] : rowsOutOfSightOf(view, book, sheet).byOwnFilters;
}
export function rowEdgesWithHiddenRows(rowEdges: LineSizes, outOfSight: readonly LineSpan[]): LineSizes {
  let cached = rowEdgesWithHiddenRowsCache.get(rowEdges);
  if (cached?.outOfSight === outOfSight) return cached.edges;
  let edges = collapseLineSizes(rowEdges, outOfSight);
  rowEdgesWithHiddenRowsCache.set(rowEdges, {
    outOfSight,
    edges,
  });
  return edges;
}
export function withHiddenLines(
  layout: GridLayout,
  sheet: SheetSummary,
  book: WorkbookReads,
  view: Pick<PageState, 'ownCollapsing' | 'rowsOutOfViewByOwnFilters'>,
): GridLayout {
  let { sheetId, rowGroups, columnGroups } = sheet;
  let { ownCollapsing } = view;
  let filteredRowIds = view.rowsOutOfViewByOwnFilters.get(sheetId);
  if (rowGroups.length === 0 && columnGroups.length === 0 && filteredRowIds === undefined) return layout;
  let cached = layoutWithHiddenLinesCache.get(layout);
  if (cached?.ownCollapsing === ownCollapsing && cached.rowIds === filteredRowIds) return cached.layout;
  let rowsOutOfSight = rowsOutOfSightOf(view, book, sheet).all;
  let columnsOutOfSight = collapsedIndexRuns(withOwnCollapsing(ownCollapsing, columnGroups));
  let layoutWithHidden: GridLayout = {
    ...layout,
    rowsOutOfSight,
    columnsOutOfSight,
    rowEdges: rowEdgesWithHiddenRows(layout.rowEdges, rowsOutOfSight),
    columnEdges: collapseLineSizes(layout.columnEdges, columnsOutOfSight),
  };
  layoutWithHiddenLinesCache.set(layout, {
    ownCollapsing,
    rowIds: filteredRowIds,
    layout: layoutWithHidden,
  });
  return layoutWithHidden;
}
export function withFreezeBeingDragged(view: Pick<PageState, 'dragging' | 'heldUntilAnswered' | 'sheetId'>, layout: GridLayout): GridLayout {
  let dragging = draggingOrHeld(view);
  if (dragging?.kind !== 'freezing' || dragging.count === null) return layout;
  if (dragging.sheetId !== view.sheetId) return layout;
  return dragging.what === 'rows'
    ? {
        ...layout,
        frozenRowCount: dragging.count,
      }
    : {
        ...layout,
        frozenColumnCount: dragging.count,
      };
}
export function lineBeingResized(
  { dragging, sheetId, density }: Pick<PageState, 'dragging' | 'sheetId' | 'density'>,
  book: ReadsWithTextMeasurer,
): LineResize | null {
  if (dragging?.kind !== 'resizing') return null;
  let { line, sizeInPixels } = dragging;
  let isByFinger = dragging.isByFinger === true;
  if (line.isA === 'column') {
    let columnIndex = book.columnIndexOf(sheetId, line.columnId);
    return columnIndex === null
      ? null
      : {
          isA: 'column',
          index: columnIndex,
          sizeInPixels,
          isByFinger,
        };
  }
  let rowIndex = book.rowIndexOf(sheetId, line.rowId);
  if (rowIndex === null) return null;
  let wrappedHeight = wrappedHeightOfRow(line.rowId, findSheetById(book, sheetId), book, density);
  return {
    isA: 'row',
    index: rowIndex,
    sizeInPixels: Math.max(sizeInPixels, wrappedHeight),
    isByFinger,
  };
}
export function keepResizedLineInSight<V extends LayoutView & Pick<PageState, 'scrollTop' | 'scrollLeft'>>(
  view: V,
  dragging: Dragging | null,
  book: ReadsWithTextMeasurer,
): V {
  let resize = lineBeingResized(
    {
      ...view,
      dragging,
    },
    book,
  );
  if (resize === null) return view;
  let layout = layoutOfView(view, book);
  let [scroll, scrollAtLineEnd] =
    resize.isA === 'row'
      ? [view.scrollTop, layout.rowEdges.startOf(resize.index + 1) - frozenRowsHeight(layout)]
      : [view.scrollLeft, layout.columnEdges.startOf(resize.index + 1) - frozenColumnsWidth(layout)];
  if (resize.index < (resize.isA === 'row' ? layout.frozenRowCount : layout.frozenColumnCount) || scroll === 0 || scroll !== scrollAtLineEnd)
    return view;
  return resize.isA === 'row'
    ? {
        ...view,
        scrollTop: scroll - 1,
      }
    : {
        ...view,
        scrollLeft: scroll - 1,
      };
}
export function layoutOfView(view: LayoutView, book: ReadsWithTextMeasurer): GridLayout {
  let sheet = sheetOfView(view, book);
  let cellLayout =
    sheet === undefined ? EMPTY_GRID_LAYOUT : withHiddenLines(cellLayoutOfSheet(sheet, book, view.density), sheet, book, view);
  let frozenLayout = withFreezeBeingDragged(view, cellLayout);
  let layout =
    frozenLayout === cellLayout && frozenLayout.frozenRowCount === 0 && frozenLayout.frozenColumnCount === 0
      ? cellLayout
      : {
          ...cellLayout,
          ...frozenCountsThatFit(frozenLayout, cellLayout, view),
        };
  return withReachOfFloats(layout, book.placementsIn(view.sheetId));
}
export function withReachOfFloats(layout: GridLayout, placements: readonly PlacementOnGrid[]): GridLayout {
  if (placements.length === 0) return layout;
  let { rowEdges, columnEdges, frozenRowCount, frozenColumnCount } = layout;
  let cached = reachOfFloatsCache.get(placements);
  if (cached?.ofCells === layout) return cached.withReach;
  if (
    cached?.ofCells.rowEdges === rowEdges &&
    cached.ofCells.columnEdges === columnEdges &&
    cached.ofCells.frozenRowCount === frozenRowCount &&
    cached.ofCells.frozenColumnCount === frozenColumnCount
  )
    return {
      ...layout,
      reachOfWhatFloats: cached.withReach.reachOfWhatFloats,
    };
  let [across, down]: [number, number] = [0, 0];
  for (let { rowIndex, columnIndex, offsetFromAnchorCell, ...size } of placements) {
    let [columnPoint, rowPoint] = [
      {
        index: columnIndex,
        pixelsPast: offsetFromAnchorCell.xInPixels,
      },
      {
        index: rowIndex,
        pixelsPast: offsetFromAnchorCell.yInPixels,
      },
    ];
    if (columnIndex >= frozenColumnCount)
      across = Math.max(across, columnEdges.startOf(columnIndex) + clampPixelsPast(columnEdges, columnPoint) + size.widthInPixels);
    if (rowIndex >= frozenRowCount) down = Math.max(down, rowEdges.startOf(rowIndex) + clampPixelsPast(rowEdges, rowPoint) + size.heightInPixels);
  }
  let layoutWithReach: GridLayout = {
    ...layout,
    reachOfWhatFloats: {
      across,
      down,
    },
  };
  reachOfFloatsCache.set(placements, {
    ofCells: layout,
    withReach: layoutWithReach,
  });
  return layoutWithReach;
}
export function hiddenByBorderAtFoot(view: Pick<PageState, 'sheetId' | 'scrollTop' | 'density'>, book: ReadsWithTextMeasurer, layout: GridLayout, area: CellArea): number {
  if (!book.hasBorderLine(view.sheetId)) return 0;
  let { topRowIndex, rowCount, leftColumnIndex, columnCount } = area;
  let isManyCells = rowCount > 1 || columnCount > 1;
  let isWithinFrozen = view.scrollTop > 0 && topRowIndex + rowCount <= layout.frozenRowCount;
  let borderHidden = borderOverhangBelow(
    area,
    {
      rowEdges: layout.rowEdges,
      rowCount: isWithinFrozen ? layout.frozenRowCount : layout.rowCount,
    },
    bordersAtCellOf(book, view.sheetId),
  );
  let cellId = borderHidden === 0 || isManyCells ? null : book.cellIdAt(view.sheetId, topRowIndex, leftColumnIndex);
  if (cellId === null || book.formatOf(cellId).alignment.wrap !== true) return borderHidden;
  let wrappedHeight = wrappedHeightOfRow(cellId.rowId, sheetOfView(view, book), book, view.density);
  let rowHeight = layout.rowEdges.startOf(topRowIndex + 1) - layout.rowEdges.startOf(topRowIndex);
  return wrappedHeight === 0 ? borderHidden : clampBetween(rowHeight - wrappedHeight, 0, borderHidden);
}
export function anchoredScrollOffset<LineId extends RowId | ColumnId>(
  scroll: number,
  viewportSize: number,
  before: ScrollAnchorLines<LineId>,
  after: ScrollAnchorLines<LineId>,
): number {
  if (scroll === 0) return scroll;
  let offset = scroll + before.sizeOfFrozen;
  let isPastEnd = offset >= before.edges.totalSize;
  let index = before.edges.indexAt(offset) - (isPastEnd ? 1 : 0);
  let lastIndex = Math.max(index, before.edges.indexAt(scroll + viewportSize));
  let candidates: AnchorCandidate[] = [];
  while (index <= lastIndex) {
    let lineId = before.idAt(index);
    let indexNow = lineId === null ? null : after.indexOf(lineId);
    if (indexNow !== null)
      candidates.push({
        index,
        indexNow,
      });
    index = Math.max(index + 1, shownLineAtOrAfter(before.edges, index + 1));
  }
  let anchor = candidates.find(
    ({ indexNow }: AnchorCandidate, position: number) =>
      candidates.every((other: AnchorCandidate, otherPosition: number) => otherPosition < position === other.indexNow < indexNow),
  );
  if (anchor === undefined) return scroll;
  let pixelsIntoAnchor = Math.min(offset - before.edges.startOf(anchor.index), isPastEnd ? 1 / 0 : after.edges.sizeOf(anchor.indexNow));
  return Math.max(0, after.edges.startOf(anchor.indexNow) + pixelsIntoAnchor - after.sizeOfFrozen);
}
export function scrollAnchorLinesOf(view: LayoutView, book: ReadsWithTextMeasurer): ScrollAnchorsOfView {
  let { sheetId } = view;
  let layout = layoutOfView(view, book);
  let { rowEdges, columnEdges } = layout;
  return {
    rows: {
      edges: rowEdges,
      sizeOfFrozen: frozenRowsHeight(layout),
      idAt: (index: number) => book.cellIdAt(sheetId, index, 0)?.rowId ?? null,
      indexOf: (rowId: RowId) => book.rowIndexOf(sheetId, rowId),
    },
    columns: {
      edges: columnEdges,
      sizeOfFrozen: frozenColumnsWidth(layout),
      idAt: (index: number) => book.cellIdAt(sheetId, 0, index)?.columnId ?? null,
      indexOf: (columnId: ColumnId) => book.columnIndexOf(sheetId, columnId),
    },
  };
}
export function keepScrollAnchoredAcrossChange<V extends AnchoredView>(
  view: V,
  bookBefore: ReadsWithTextMeasurer,
  bookAfter: ReadsWithTextMeasurer,
  viewBefore: Pick<PageState, 'ownCollapsing' | 'rowsOutOfViewByOwnFilters' | 'density'> = view,
): V {
  let reanchor = <P extends Pick<Place, 'sheetId' | 'scrollTop' | 'scrollLeft'>>(place: P): P => {
    let { sheetId, scrollTop, scrollLeft } = place;
    if (scrollTop === 0 && scrollLeft === 0) return place;
    let dragging = view.dragging?.kind === 'freezing' ? null : view.dragging;
    let placeView = {
      ...view,
      sheetId,
      dragging,
    };
    let { ownCollapsing, rowsOutOfViewByOwnFilters, density } = viewBefore;
    let [linesBefore, linesAfter] = [
      scrollAnchorLinesOf(
        {
          ...placeView,
          ownCollapsing,
          rowsOutOfViewByOwnFilters,
          density,
        },
        bookBefore,
      ),
      scrollAnchorLinesOf(placeView, bookAfter),
    ];
    let [viewportHeight, viewportWidth] = [cellsAreaHeight(view), cellsAreaWidth(view)];
    return {
      ...place,
      scrollTop: anchoredScrollOffset(scrollTop, viewportHeight, linesBefore.rows, linesAfter.rows),
      scrollLeft: anchoredScrollOffset(scrollLeft, viewportWidth, linesBefore.columns, linesAfter.columns),
    };
  };
  return {
    ...reanchor(view),
    placesLeft: view.placesLeft.map(reanchor),
  };
}
export function clampScrollOfView<V extends LayoutView & Pick<PageState, 'scrollTop' | 'scrollLeft' | 'heightUnderWhatFloats'>>(view: V, book: ReadsWithTextMeasurer): V {
  return {
    ...view,
    ...clampScrollWithFloats(view, layoutOfView(view, book), view),
  };
}
export function resetScrollForFreezeDrag<V extends Pick<PageState, 'dragging' | 'scrollTop' | 'scrollLeft'>>(view: V): V {
  if (view.dragging?.kind !== 'freezing' || view.dragging.count === null) return view;
  return view.dragging.what === 'rows'
    ? {
        ...view,
        scrollTop: 0,
      }
    : {
        ...view,
        scrollLeft: 0,
      };
}
export const findSheetById = (book: WorkbookReads, sheetId: SheetId): SheetSummary | undefined =>
  book.listSheets().find((sheet: SheetSummary) => sheet.sheetId === sheetId);
export const isNumberedSheetName = (sheetName: string, stem: string): boolean =>
  sheetName.startsWith(stem) && /^\d+$/.test(sheetName.slice(stem.length));
export const DEFAULT_SHEET_NAME_STEM = 'Sheet';
export const isDefaultSheetName = (sheetName: string, localStem: string): boolean =>
  [localStem, DEFAULT_SHEET_NAME_STEM].some((stem: string) => isNumberedSheetName(sheetName, stem));
export const sheetOfView = ({ sheetId }: Pick<PageState, 'sheetId'>, book: WorkbookReads): SheetSummary | undefined => findSheetById(book, sheetId);
export const createCellLayoutCaches = (): CellLayoutCaches => ({
  withNoWrappedText: new WeakMap<CellLayoutKey, GridLayout>(),
  withWrappedText: new WeakMap<TextMeasurer['lineCountsOfWrappedTexts'], WeakMap<CellLayoutKey, GridLayout>>(),
});
export const cellLayoutCachesByDensity: Record<CellDensity, CellLayoutCaches> = {
  comfortable: createCellLayoutCaches(),
  compact: createCellLayoutCaches(),
};
export const rowEdgesCache = new WeakMap<LineIndex, RowEdgesCacheEntry>();
export const rowsOutOfSightCache = new WeakMap<Set<RowId>, RowsOutOfSightCacheEntry>();
export const sameLineRuns = (runs: readonly LineSpan[], others: readonly LineSpan[]): boolean =>
  runs.length === others.length &&
  runs.every(
    ({ firstIndex, count }: LineSpan, index: number) =>
      others[index]?.firstIndex === firstIndex && others[index].count === count,
  );
export const layoutWithHiddenLinesCache = new WeakMap<GridLayout, LayoutWithHiddenLinesCacheEntry>();
export const rowEdgesWithHiddenRowsCache = new WeakMap<LineSizes, RowEdgesWithHiddenRowsCacheEntry>();
export const sheetOfViewOrEmpty = (view: Pick<PageState, 'sheetId'>, book: WorkbookReads): SheetSummary | GridLayout => sheetOfView(view, book) ?? EMPTY_GRID_LAYOUT;
export const draggingOrHeld = ({ dragging, heldUntilAnswered }: Pick<PageState, 'dragging' | 'heldUntilAnswered'>): Dragging | null =>
  dragging ?? heldUntilAnswered?.held ?? null;
export const lineResizeOfView = (view: Pick<PageState, 'dragging' | 'heldUntilAnswered' | 'sheetId' | 'density'>, book: ReadsWithTextMeasurer): LineResize | null =>
  lineBeingResized(
    {
      ...view,
      dragging: draggingOrHeld(view),
    },
    book,
  );
export const reachOfFloatsCache = new WeakMap<readonly PlacementOnGrid[], ReachOfFloatsCacheEntry>();
export const viewWithDensity = <V extends AnchoredView & Pick<PageState, 'heightUnderWhatFloats'>>(view: V, book: ReadsWithTextMeasurer, density: CellDensity): V =>
  clampScrollOfView(
    keepScrollAnchoredAcrossChange(
      {
        ...view,
        density,
      },
      book,
      book,
      view,
    ),
    book,
  );
