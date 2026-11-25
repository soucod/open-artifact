import type { SheetId } from '@open-artifact/sheets-core';
import type { CellFoundBy } from '../grid/geometry.ts';
import type { StuckHeaderCover } from '../grid/sticky-headers.ts';
import type { GridLayout, LayoutView } from '../grid/layout.ts';
import type { LineSizes } from '../model/line-sizes.ts';
import type { CellId, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';

/** A cell by its row and column indexes. */
export interface CellPosition {
  rowIndex: number;
  columnIndex: number;
}
/** Cells by the indexes of their top left one, and how many rows and columns they take. */
export interface CellArea {
  topRowIndex: number;
  leftColumnIndex: number;
  rowCount: number;
  columnCount: number;
}
/** A range picked out by walking through it: its ends, and the cell the walk is at. */
export interface RangeWalked {
  from: CellId;
  to: CellId;
  at: CellId;
}
/** A selection: the active cell, the corner the selection reaches, and the range walked when there is one. */
export interface CellSelection {
  activeCell: CellId;
  selectionCorner: CellId;
  rangeWalked: RangeWalked | null;
}
export type SelectionKind = 'cells' | 'columns' | 'rows';
export interface AreaAndKind {
  area: CellArea;
  kind: SelectionKind;
}
/** The axes along which to scroll. */
export interface AxesToShow {
  rows: boolean;
  columns: boolean;
}
/** A position to scroll to, kept clear of what covers the rows when that is asked. */
export interface PositionToShow extends CellPosition {
  isToComeClearOf?: StuckHeaderCover;
}
export interface SelectionPositions {
  active: CellPosition;
  corner: CellPosition;
  walked: CellArea | null;
  isOneCell: boolean;
  scrollTop: number;
}
/** A selection to read the cells of, whose walked range may be left out. */
export interface SelectionToRead extends Pick<CellSelection, 'activeCell' | 'selectionCorner'> {
  rangeWalked?: RangeWalked | null;
}
/** How far the active cell's box reaches: the cell alone, or the larger box an enlarged editor takes. */
export type ExtentToShow = 'cellAlone' | 'cellAndLargerBox';
/** A selection as it was at a change count of the workbook. */
export type SelectionAtChange = Pick<PageState, 'activeCell' | 'selectionCorner' | 'rangeWalked' | 'workbookChangeCount'>;
import { layoutOfView, findSheetById } from '../grid/layout.ts';
import { isLineShown, shownLineAtOrAfter, nearestShownLine } from '../model/line-sizes.ts';
import { heightCoveredByStickyHeaders, heightCoveredByStuckHeaders } from '../grid/sticky-headers.ts';
import {
  scrollToShowCell,
  boxOfCellRange,
  withRoomBesideFootNotices,
  cellsHeightAboveFloats,
  frozenRowsHeight,
  clampScrollKeepingReach,
} from '../grid/geometry.ts';
import { isSelectionOneCell } from './keyboard.ts';
import { compactOneLineRowHeight, zoomedEditorExtent, phoneEditorScale } from '../grid/cell-metrics.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
export function mergedAreaOrCellOf(book: WorkbookReads, cellId: CellId): CellArea | null {
  let position = book.positionOfCell(cellId);
  if (position === null) return null;
  return book.mergedAreaAt(cellId.sheetId, position) ?? areaOfPosition(position);
}
export function anchorCellOf(book: WorkbookReads, cellId: CellId): CellId {
  let area = mergedAreaOrCellOf(book, cellId);
  if (area === null) return cellId;
  return book.cellIdAt(cellId.sheetId, area.topRowIndex, area.leftColumnIndex) ?? cellId;
}
export function shownPositionInMerge(view: LayoutView, book: ReadsWithTextMeasurer, position: CellPosition): CellPosition {
  let { rowEdges, columnEdges } = layoutOfView(view, book);
  let { rowIndex, columnIndex } = position;
  if (isLineShown(rowEdges, rowIndex) && isLineShown(columnEdges, columnIndex)) return position;
  let merged = book.mergedAreaAt(view.sheetId, position);
  if (merged === null) return position;
  return {
    rowIndex: shownIndexInMerge(rowEdges, merged.topRowIndex, merged.rowCount, rowIndex),
    columnIndex: shownIndexInMerge(columnEdges, merged.leftColumnIndex, merged.columnCount, columnIndex),
  };
}
export function moveActiveCellTo(view: PageState, book: ReadsWithTextMeasurer, cellId: CellId, how: CellFoundBy = 'key'): PageState {
  let position = book.positionOfCell(cellId);
  if (position === null) return view;
  let anchor = anchorCellOf(book, cellId);
  let layout = layoutOfView(view, book);
  let isLeavingMerge = how === 'key' && !isSameCell(anchor, view.activeCell);
  let shownPosition = shownPositionInMerge(view, book, position);
  let heightCovered = heightCoveredByStickyHeaders(view, book, shownPosition, layout, how);
  let target = {
    ...shownPosition,
    heightCovered,
  };
  let scroll = scrollToShowCell(view, target, layout, view, how, isLeavingMerge);
  let mergedEntry = isSameCell(anchor, cellId) ? null : cellId;
  let cameToMergedCellsAt = how === 'key' ? mergedEntry : view.cameToMergedCellsAt;
  let leftByKeyAt = how === 'key' ? scroll : null;
  return {
    ...view,
    ...selectionAtCell(anchor),
    cameToMergedCellsAt,
    leftByKeyAt,
    ...scroll,
  };
}
export function scrollToShowPosition(view: PageState, book: ReadsWithTextMeasurer, position: PositionToShow, axes: AxesToShow, how: CellFoundBy | undefined): PageState {
  let layout = layoutOfView(view, book);
  let shownPosition = shownPositionInMerge(view, book, position);
  let scrollWith = (heightCoveredNow: number): PageState => {
    let target = {
      ...shownPosition,
      heightCovered: heightCoveredNow,
    };
    let { scrollLeft, scrollTop } = scrollToShowCell(view, target, layout, view, how);
    return {
      ...view,
      scrollLeft: axes.columns ? scrollLeft : view.scrollLeft,
      scrollTop: axes.rows ? scrollTop : view.scrollTop,
    };
  };
  let heightCovered = how === 'key' ? heightCoveredByStickyHeaders(view, book, shownPosition, layout) : 0;
  let scrolled = scrollWith(heightCovered);
  let isToComeClearOf = position.isToComeClearOf;
  if (isToComeClearOf === undefined || !axes.rows) return scrolled;
  let coveredClear = heightCoveredByStuckHeaders(scrolled, book, shownPosition.rowIndex, isToComeClearOf, layout);
  return coveredClear <= heightCovered ? scrolled : scrollWith(coveredClear);
}
export function selectionBetweenPositions(
  view: Pick<PageState, 'sheetId'>,
  book: WorkbookReads,
  active: CellPosition,
  corner: CellPosition,
): CellSelection | null {
  let activeCell = book.cellIdAt(view.sheetId, active.rowIndex, active.columnIndex);
  let selectionCorner = book.cellIdAt(view.sheetId, corner.rowIndex, corner.columnIndex);
  return activeCell === null || selectionCorner === null
    ? null
    : {
        activeCell,
        selectionCorner,
        rangeWalked: null,
      };
}
export function unionOfAreas(a: CellArea, b: CellArea): CellArea {
  let topRowIndex = Math.min(a.topRowIndex, b.topRowIndex);
  let leftColumnIndex = Math.min(a.leftColumnIndex, b.leftColumnIndex);
  return {
    topRowIndex,
    leftColumnIndex,
    rowCount: Math.max(a.topRowIndex + a.rowCount, b.topRowIndex + b.rowCount) - topRowIndex,
    columnCount: Math.max(a.leftColumnIndex + a.columnCount, b.leftColumnIndex + b.columnCount) - leftColumnIndex,
  };
}
export function isSameBoxOnGrid(layout: Pick<GridLayout, 'rowEdges' | 'columnEdges'>, area: CellArea, other: CellArea): boolean {
  let [box, otherBox] = [boxOfCellRange(area, layout), boxOfCellRange(other, layout)];
  return box.left === otherBox.left && box.top === otherBox.top && box.right === otherBox.right && box.bottom === otherBox.bottom;
}
export function areaGrownOverMerges(book: WorkbookReads, sheetId: SheetId, area: CellArea): CellArea {
  let grown = book.mergedAreasIn(sheetId, area).reduce(unionOfAreas, area);
  return isSameArea(grown, area) ? area : areaGrownOverMerges(book, sheetId, grown);
}
export function selectionKindOf(area: CellArea, sheet: Pick<SheetSummary, 'rowCount' | 'columnCount'>): SelectionKind {
  let isAllRows = area.rowCount === sheet.rowCount;
  let isAllColumns = area.columnCount === sheet.columnCount;
  if (isAllRows === isAllColumns || sheet.rowCount === 1 || sheet.columnCount === 1) return 'cells';
  return isAllRows ? 'columns' : 'rows';
}
export function selectedArea(selection: SelectionToRead, book: WorkbookReads): CellArea | null {
  let areaAndKind = selectionAreaAndKind(selection, book);
  if (areaAndKind === null) return null;
  return areaAndKind.kind === 'cells' ? areaGrownOverMerges(book, selection.activeCell.sheetId, areaAndKind.area) : areaAndKind.area;
}
export function selectsSameArea(selection: SelectionToRead, other: SelectionToRead, book: WorkbookReads): boolean {
  let [areaAndKind, otherArea] = [selectionAreaAndKind(selection, book), selectedArea(other, book)];
  return (
    selection.activeCell.sheetId === other.activeCell.sheetId && areaAndKind !== null && otherArea !== null && isSameArea(areaAndKind.area, otherArea)
  );
}
export function areaOfRangeWalked(
  { activeCell, selectionCorner, rangeWalked }: SelectionToRead,
  book: WorkbookReads,
): CellArea | null {
  if (rangeWalked === undefined || rangeWalked === null) return null;
  let { at } = rangeWalked;
  let [from, to] = [book.positionOfCell(rangeWalked.from), book.positionOfCell(rangeWalked.to)];
  return isSameCell(activeCell, at) && isSameCell(selectionCorner, at) && from !== null && to !== null
    ? unionOfAreas(areaOfPosition(from), areaOfPosition(to))
    : null;
}
export function selectionPositionsOf(view: PageState, book: WorkbookReads): SelectionPositions | null {
  let active = book.positionOfCell(view.activeCell);
  let corner = book.positionOfCell(view.selectionCorner);
  if (active === null || corner === null) return null;
  let isOneCell = view.otherRanges.length === 0 && isSelectionOneCell(view, book);
  return {
    active,
    corner,
    walked: areaOfRangeWalked(view, book),
    isOneCell,
    scrollTop: view.scrollTop,
  };
}
export function positionsPastHiddenRow(view: LayoutView, book: ReadsWithTextMeasurer, positions: SelectionPositions): SelectionPositions {
  let { active, isOneCell } = positions;
  if (!isOneCell) return positions;
  let { rowEdges, rowCount } = layoutOfView(view, book);
  let merged = book.mergedAreaAt(view.sheetId, active) ?? areaOfPosition(active);
  if (shownLineAtOrAfter(rowEdges, merged.topRowIndex) < merged.topRowIndex + merged.rowCount) return positions;
  let moved = {
    ...active,
    rowIndex: nearestShownLine(rowEdges, rowCount, active.rowIndex, 1),
  };
  return {
    ...positions,
    active: moved,
    corner: moved,
  };
}
export function selectionFromPositions(
  view: Pick<PageState, 'sheetId' | 'rangeWalked'>,
  book: WorkbookReads,
  { active, corner, walked }: Pick<SelectionPositions, 'active' | 'corner' | 'walked'>,
): CellSelection | null {
  if (walked === null) return selectionBetweenPositions(view, book, active, corner);
  let merged = book.mergedAreaAt(view.sheetId, active);
  let anchorPosition = {
    rowIndex: merged?.topRowIndex ?? active.rowIndex,
    columnIndex: merged?.leftColumnIndex ?? active.columnIndex,
  };
  let anchorCell = book.cellIdAt(view.sheetId, anchorPosition.rowIndex, anchorPosition.columnIndex);
  let walkedSelection = selectionOfArea(view, book, walked);
  if (anchorCell === null || walkedSelection === null) return null;
  let kept: CellSelection = {
    ...selectionAtCell(anchorCell),
    rangeWalked: view.rangeWalked,
  };
  let keptWalked = areaOfRangeWalked(kept, book);
  let selection: CellSelection =
    keptWalked !== null && isSameArea(keptWalked, walked)
      ? kept
      : {
          ...selectionAtCell(anchorCell),
          rangeWalked: {
            from: walkedSelection.activeCell,
            to: walkedSelection.selectionCorner,
            at: anchorCell,
          },
        };
  let area = selectedArea(selection, book);
  return area !== null && isSameArea(unionOfAreas(area, areaOfPosition(anchorPosition)), area) ? selection : selectionAtCell(anchorCell);
}
export function selectionAreaAndKind(selection: SelectionToRead, book: WorkbookReads): AreaAndKind | null {
  let { activeCell, selectionCorner } = selection;
  let active = book.positionOfCell(activeCell);
  let corner = book.positionOfCell(selectionCorner);
  let sheet = book.listSheets().find((summary: SheetSummary) => summary.sheetId === activeCell.sheetId);
  if (active === null || corner === null || sheet === undefined) return null;
  let area = areaOfRangeWalked(selection, book) ?? unionOfAreas(areaOfPosition(active), areaOfPosition(corner));
  return {
    area,
    kind: selectionKindOf(area, sheet),
  };
}
export function selectionKeepsItsCells(selection: SelectionToRead, bookBefore: WorkbookReads, bookAfter: WorkbookReads): boolean {
  let { sheetId } = selection.activeCell;
  let sheet = findSheetById(bookAfter, sheetId);
  if (sheet !== undefined && sheet === findSheetById(bookBefore, sheetId)) return true;
  let [areaBefore, areaAfter] = [selectedArea(selection, bookBefore), selectedArea(selection, bookAfter)];
  if (areaBefore === null || areaAfter === null) return false;
  if (areaBefore.rowCount !== areaAfter.rowCount || areaBefore.columnCount !== areaAfter.columnCount) return false;
  let isStillInside = (rowIndex: number, columnIndex: number) => {
    let cellId = bookBefore.cellIdAt(sheetId, rowIndex, columnIndex);
    let positionAfter = cellId === null ? null : bookAfter.positionOfCell(cellId);
    return positionAfter !== null && isSameArea(unionOfAreas(areaAfter, areaOfPosition(positionAfter)), areaAfter);
  };
  for (let offset = 0; offset < areaBefore.rowCount; offset += 1)
    if (!isStillInside(areaBefore.topRowIndex + offset, areaBefore.leftColumnIndex)) return false;
  for (let offset = 0; offset < areaBefore.columnCount; offset += 1)
    if (!isStillInside(areaBefore.topRowIndex, areaBefore.leftColumnIndex + offset)) return false;
  return true;
}
export function isSelectionUnchangedAcross(
  view: Pick<PageState, 'activeCell' | 'selectionCorner' | 'rangeWalked' | 'otherRanges'>,
  bookBefore: WorkbookReads,
  bookAfter: WorkbookReads,
): boolean {
  return [view, ...view.otherRanges].every((range: CellSelection) => {
    let [before, after] = [selectionAreaAndKind(range, bookBefore), selectionAreaAndKind(range, bookAfter)];
    return (
      before !== null &&
      after !== null &&
      before.kind === after.kind &&
      isSameArea(before.area, after.area) &&
      selectionKeepsItsCells(range, bookBefore, bookAfter)
    );
  });
}
export function scrollToShowSelection(view: PageState, book: ReadsWithTextMeasurer, how: CellFoundBy = 'key'): PageState {
  let active = book.positionOfCell(view.activeCell);
  let area = selectedArea(view, book);
  if (active === null || area === null) return view;
  let layout = layoutOfView(view, book);
  let axes = areaOfRangeWalked(view, book) === null ? axesNotFilledBy(area, layout) : BOTH_AXES;
  let position = how === 'key' && !axes.columns ? clearOfRowNumbers(active) : active;
  return scrollToShowPosition(view, book, position, axes, how);
}
export function scrollToShowActiveCell(view: PageState, book: ReadsWithTextMeasurer, extent: ExtentToShow = 'cellAndLargerBox'): PageState {
  let active = book.positionOfCell(view.activeCell);
  if (active === null) return view;
  let scrolled = scrollToShowPosition(view, book, active, BOTH_AXES, 'key');
  return extent === 'cellAlone' ? scrolled : scrollToShowEnlargedEditor(scrolled, book, 'key');
}
export function withRoomUnderNoticesAtFoot(view: PageState, book: ReadsWithTextMeasurer): PageState {
  let active = view.noticesAtFoot === null ? null : book.positionOfCell(view.activeCell);
  if (active === null) return view;
  return withRoomBesideFootNotices(view, active.columnIndex, view.scrollLeft, layoutOfView(view, book));
}
export function scrollToShowEnlargedEditor(view: PageState, book: ReadsWithTextMeasurer, how: CellFoundBy, showsRowBelow: boolean = false): PageState {
  let anchor = activeAnchorCell(view, book);
  let merged = mergedAreaOrCellOf(book, anchor);
  if (anchor.sheetId !== view.sheetId || merged === null) return view;
  let { size: fontSize } = book.formatOf(anchor).font;
  let scale = editorScaleOf(view, book, fontSize);
  if (scale === 1) return view;
  let layout = layoutOfView(view, book);
  let { rowEdges } = layout;
  let cellHeight = rowEdges.startOf(merged.topRowIndex + merged.rowCount) - rowEdges.startOf(merged.topRowIndex);
  let position = {
    rowIndex: merged.topRowIndex,
    columnIndex: merged.leftColumnIndex,
  };
  let heightCovered = heightCoveredByStickyHeaders(view, book, position, layout);
  if (cellHeight >= cellsHeightAboveFloats(view) - frozenRowsHeight(layout) - heightCovered) return view;
  let lineHeight = compactOneLineRowHeight(fontSize) * scale;
  let rowBelow = shownLineAtOrAfter(rowEdges, merged.topRowIndex + merged.rowCount);
  let scroll = scrollToShowCell(
    view,
    {
      ...position,
      heightCovered,
    },
    layout,
    view,
    how,
    false,
    zoomedEditorExtent(
      Math.max(cellHeight, lineHeight),
      showsRowBelow && rowBelow < layout.rowCount ? Math.min(rowEdges.sizeOf(rowBelow), lineHeight) : 0,
    ),
  );
  return {
    ...view,
    scrollTop: clampScrollKeepingReach(view, scroll, layout, view).scrollTop,
  };
}
export const isSameCell = (a: CellId, b: CellId): boolean =>
  a.sheetId === b.sheetId && a.rowId === b.rowId && a.columnId === b.columnId;
export const isSameSelection = (a: SelectionAtChange, b: SelectionAtChange): boolean =>
  isSameCell(b.activeCell, a.activeCell) &&
  ((isSameCell(b.selectionCorner, a.selectionCorner) && b.rangeWalked === a.rangeWalked) || b.workbookChangeCount !== a.workbookChangeCount);
export const selectionAtCell = (cellId: CellId): CellSelection => ({
  activeCell: cellId,
  selectionCorner: cellId,
  rangeWalked: null,
});
export const areaOfPosition = ({ rowIndex, columnIndex }: CellPosition): CellArea => ({
  topRowIndex: rowIndex,
  leftColumnIndex: columnIndex,
  rowCount: 1,
  columnCount: 1,
});
export const activeAnchorCell = ({ activeCell }: Pick<CellSelection, 'activeCell'>, book: WorkbookReads): CellId => anchorCellOf(book, activeCell);
export const isPeopleListOnActiveCell = (view: Pick<PageState, 'peopleList' | 'activeCell'>, book: WorkbookReads): boolean =>
  view.peopleList?.isOfPeopleAlone === true && isSameCell(view.peopleList.cellId, activeAnchorCell(view, book));
export const editorScaleOf = (view: Pick<PageState, 'mode' | 'peopleList' | 'activeCell' | 'isOnPhone' | 'zoom'>, book: WorkbookReads, fontSize: number): number =>
  view.mode.kind !== 'editing' || isPeopleListOnActiveCell(view, book) ? 1 : phoneEditorScale(view, fontSize);
export const isAnchorOfActiveCell = ({ activeCell }: Pick<CellSelection, 'activeCell'>, book: WorkbookReads, cellId: CellId): boolean =>
  isSameCell(anchorCellOf(book, cellId), activeCell);
export const keyMoveOriginOf = ({ activeCell, cameToMergedCellsAt }: Pick<PageState, 'activeCell' | 'cameToMergedCellsAt'>): CellId =>
  cameToMergedCellsAt ?? activeCell;
export const shownIndexInMerge = (edges: LineSizes, first: number, count: number, index: number): number => {
  let shown = isLineShown(edges, index) ? index : shownLineAtOrAfter(edges, first);
  return shown < first + count ? shown : index;
};
export const BOTH_AXES: AxesToShow = {
  rows: true,
  columns: true,
};
export const selectionOfArea = (view: Pick<PageState, 'sheetId'>, book: WorkbookReads, area: CellArea): CellSelection | null =>
  selectionBetweenPositions(
    view,
    book,
    {
      rowIndex: area.topRowIndex,
      columnIndex: area.leftColumnIndex,
    },
    {
      rowIndex: area.topRowIndex + area.rowCount - 1,
      columnIndex: area.leftColumnIndex + area.columnCount - 1,
    },
  );
export const isSameArea = (a: CellArea, b: CellArea): boolean =>
  a.topRowIndex === b.topRowIndex && a.leftColumnIndex === b.leftColumnIndex && a.rowCount === b.rowCount && a.columnCount === b.columnCount;
export const axesNotFilledBy = (area: CellArea, layout: Pick<GridLayout, 'rowCount' | 'columnCount'>): AxesToShow => ({
  rows: area.rowCount < layout.rowCount,
  columns: area.columnCount < layout.columnCount,
});
export const clearOfRowNumbers = (position: CellPosition): PositionToShow => ({
  ...position,
  isToComeClearOf: 'rowNumbers',
});
