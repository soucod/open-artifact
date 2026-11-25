import type { GridLayout, LayoutView } from '../grid/layout.ts';
import type { SharedCellFormat } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { AxesToShow, CellPosition, SelectionKind, SelectionToRead } from './model.ts';
import {
  shownPositionInMerge,
  mergedAreaOrCellOf,
  areaOfPosition,
  selectedArea,
  BOTH_AXES,
  axesNotFilledBy,
  clearOfRowNumbers,
  scrollToShowPosition,
  isSameCell,
  isSameBoxOnGrid,
  keyMoveOriginOf,
  isSameArea,
  selectionOfArea,
  selectionBetweenPositions,
} from './model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { shownLineAtOrAfter, shownLineAtOrBefore, nearestShownLine } from '../model/line-sizes.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** A move by a key: how many rows and columns it steps, each -1, 0 or 1 for an arrow. */
export interface KeyMove {
  rowDelta: number;
  columnDelta: number;
}
export function positionAfterKeyMove(
  view: LayoutView,
  book: ReadsWithTextMeasurer,
  cellId: CellId,
  { rowDelta, columnDelta }: KeyMove,
  isExtending: boolean,
): CellPosition {
  let position = shownPositionInMerge(
    view,
    book,
    book.positionOfCell(cellId) ?? {
      rowIndex: 0,
      columnIndex: 0,
    },
  );
  let merged = mergedAreaOrCellOf(book, cellId) ?? areaOfPosition(position);
  let rowOrigin = stepOriginInMerge(rowDelta, merged.topRowIndex, merged.rowCount, position.rowIndex);
  let columnOrigin = stepOriginInMerge(columnDelta, merged.leftColumnIndex, merged.columnCount, position.columnIndex);
  let layout = layoutOfView(view, book);
  let target = {
    rowIndex: Math.max(0, Math.min(rowOrigin + rowDelta, layout.rowCount - 1)),
    columnIndex: Math.max(0, Math.min(columnOrigin + columnDelta, layout.columnCount - 1)),
  };
  let skipped = skipHiddenLines(layout, target, {
    rowDelta,
    columnDelta,
  });
  if (!isExtending) return skipped;
  return {
    rowIndex: rowDelta === 0 ? target.rowIndex : skipped.rowIndex,
    columnIndex: columnDelta === 0 ? target.columnIndex : skipped.columnIndex,
  };
}
export function scrollAfterExtendingSelection(view: PageState, book: ReadsWithTextMeasurer, position: CellPosition, axes: AxesToShow): PageState {
  let area = selectedArea(view, book);
  let notFilled = area === null ? BOTH_AXES : axesNotFilledBy(area, layoutOfView(view, book));
  let scrollAxes = {
    rows: axes.rows || notFilled.rows,
    columns: axes.columns || notFilled.columns,
  };
  let target = notFilled.columns ? position : clearOfRowNumbers(position);
  return scrollToShowPosition(view, book, target, scrollAxes, 'key');
}
export function extendSelectionByKey(view: PageState, book: ReadsWithTextMeasurer, deltas: KeyMove): PageState {
  let areaBefore = selectedArea(view, book);
  let layout = layoutOfView(view, book);
  let selectionCorner: CellId = view.selectionCorner;
  for (;;) {
    let target = positionAfterKeyMove(view, book, selectionCorner, deltas, true);
    let cellId = book.cellIdAt(view.sheetId, target.rowIndex, target.columnIndex);
    if (cellId === null || isSameCell(cellId, selectionCorner)) return view;
    selectionCorner = cellId;
    let area = selectedArea(
      {
        ...view,
        selectionCorner,
      },
      book,
    );
    if (area === null || areaBefore === null || !isSameBoxOnGrid(layout, area, areaBefore)) {
      let axes = {
        rows: deltas.rowDelta !== 0,
        columns: deltas.columnDelta !== 0,
      };
      return scrollAfterExtendingSelection(
        {
          ...view,
          selectionCorner,
        },
        book,
        target,
        axes,
      );
    }
  }
}
export function cellToLandOn(view: LayoutView & Pick<PageState, 'activeCell' | 'cameToMergedCellsAt'>, book: ReadsWithTextMeasurer, position: CellPosition): CellId | null {
  let moveOrigin = book.positionOfCell(keyMoveOriginOf(view));
  let merged = book.mergedAreaAt(view.sheetId, position);
  if (moveOrigin === null || merged === null) return book.cellIdAt(view.sheetId, position.rowIndex, position.columnIndex);
  let shown = shownPositionInMerge(view, book, moveOrigin);
  return book.cellIdAt(
    view.sheetId,
    position.rowIndex === shown.rowIndex ? position.rowIndex : merged.topRowIndex,
    position.columnIndex === shown.columnIndex ? position.columnIndex : merged.leftColumnIndex,
  );
}
export function cellAfterKeyMove(view: LayoutView & Pick<PageState, 'activeCell' | 'cameToMergedCellsAt'>, book: ReadsWithTextMeasurer, deltas: KeyMove): CellId {
  let moveOrigin = keyMoveOriginOf(view);
  return cellToLandOn(view, book, positionAfterKeyMove(view, book, moveOrigin, deltas, false)) ?? moveOrigin;
}
export function isSelectionOneCell(selection: SelectionToRead, book: WorkbookReads): boolean {
  let [area, merged] = [selectedArea(selection, book), mergedAreaOrCellOf(book, selection.activeCell)];
  return area !== null && merged !== null && isSameArea(area, merged);
}
export function sharedFormatOfSelection(view: PageState, book: WorkbookReads): SharedCellFormat | null {
  let area = selectedArea(view, book);
  let selection = area === null ? null : selectionOfArea(view, book, area);
  if (area === null || selection === null) return null;
  return book.sharedFormatBetween(selection.activeCell, isSelectionOneCell(view, book) ? selection.activeCell : selection.selectionCorner);
}
export function selectAllCells(view: PageState, book: ReadsWithTextMeasurer): PageState {
  let { rowCount, columnCount } = layoutOfView(view, book);
  return {
    ...view,
    ...selectionOfArea(view, book, {
      topRowIndex: 0,
      leftColumnIndex: 0,
      rowCount,
      columnCount,
    }),
  };
}
export function selectWholeLines(view: PageState, book: ReadsWithTextMeasurer, what: Exclude<SelectionKind, 'cells'>): PageState {
  let active = book.positionOfCell(view.activeCell);
  let corner = book.positionOfCell(view.selectionCorner);
  let area = selectedArea(view, book);
  if (active === null || corner === null || area === null) return view;
  let { rowCount, columnCount, rowEdges, columnEdges } = layoutOfView(view, book);
  let firstRow = shownLineAtOrAfter(rowEdges, area.topRowIndex);
  let firstColumn = shownLineAtOrAfter(columnEdges, area.leftColumnIndex);
  let [lastRow, lastColumn] = [
    shownLineAtOrBefore(rowEdges, area.topRowIndex + area.rowCount - 1),
    shownLineAtOrBefore(columnEdges, area.leftColumnIndex + area.columnCount - 1),
  ];
  let [from, to]: [CellPosition, CellPosition] =
    what === 'rows'
      ? [
          {
            rowIndex: active.rowIndex <= corner.rowIndex ? firstRow : lastRow,
            columnIndex: 0,
          },
          {
            rowIndex: active.rowIndex <= corner.rowIndex ? lastRow : firstRow,
            columnIndex: columnCount - 1,
          },
        ]
      : [
          {
            rowIndex: 0,
            columnIndex: active.columnIndex <= corner.columnIndex ? firstColumn : lastColumn,
          },
          {
            rowIndex: rowCount - 1,
            columnIndex: active.columnIndex <= corner.columnIndex ? lastColumn : firstColumn,
          },
        ];
  return {
    ...view,
    ...selectionBetweenPositions(view, book, from, to),
  };
}
export const stepOriginInMerge = (delta: number, first: number, count: number, index: number): number =>
  delta === 0 ? index : first + (delta > 0 ? count - 1 : 0);
export const skipHiddenLines = (
  { rowEdges, columnEdges, rowCount, columnCount }: Pick<
    GridLayout,
    'rowEdges' | 'columnEdges' | 'rowCount' | 'columnCount'
  >,
  { rowIndex, columnIndex }: CellPosition,
  { rowDelta, columnDelta }: KeyMove,
): CellPosition => ({
  rowIndex: nearestShownLine(rowEdges, rowCount, rowIndex, rowDelta),
  columnIndex: nearestShownLine(columnEdges, columnCount, columnIndex, columnDelta),
});
