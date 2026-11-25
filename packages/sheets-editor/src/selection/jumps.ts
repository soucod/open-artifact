import type { LineSizes } from '../model/line-sizes.ts';
import type { PageState } from '../state/initial-state.ts';
import type { KeyMove } from './keyboard.ts';
import type { CellArea, CellPosition } from './model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { areaOfPosition, shownPositionInMerge, keyMoveOriginOf, isSameCell, moveActiveCellTo, selectedArea, isSameBoxOnGrid } from './model.ts';
import { stepOriginInMerge, skipHiddenLines, cellToLandOn, scrollAfterExtendingSelection } from './keyboard.ts';
import { isInSpan, cellsHeightAboveFloats, frozenRowsHeight, clampScrollKeepingReach } from '../grid/geometry.ts';
import { tallestStickyHeaderOverColumn } from '../grid/sticky-headers.ts';
import { shownLineAtOrBefore, shownLineAtOrAfter } from '../model/line-sizes.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** A page up or down. */
export type PageStep = 1 | -1;
/** A jump to the start or end of the row or the sheet. */
export interface JumpToEnd {
  kind: 'startOfRow' | 'startOfSheet' | 'endOfRow' | 'endOfSheet';
}
/** A jump to the edge of the data the way of a move. */
export interface JumpToEdgeOfData extends KeyMove {
  kind: 'edgeOfData';
}
/** A jump a page up or down. */
export interface JumpByPage {
  kind: 'page';
  by: PageStep;
}
/** Where a key jumps the selection to. */
export type Jump = JumpToEnd | JumpToEdgeOfData | JumpByPage;
/** The first and last index of a stretch of lines. */
export type IndexEnds = readonly [number, number];
/** Whether any cell is filled in the rows and columns between their first and last index. */
export type FilledCellTest = (rowSpan: IndexEnds, columnSpan: IndexEnds) => boolean;
export function walkToDataEdge(filledIndexes: Set<number>, start: number, from: number, step: (index: number) => number | null): number {
  let isInsideData = filledIndexes.has(start) && filledIndexes.has(from);
  let current = from;
  for (
    let next = step(current);
    next !== null && (isInsideData ? filledIndexes.has(next) : !filledIndexes.has(current));
    next = step(current)
  )
    current = next;
  return current;
}
export function edgeOfDataFrom(state: PageState, reads: ReadsWithTextMeasurer, cell: CellPosition, direction: KeyMove): CellPosition {
  let { sheetId } = state;
  let { rowCount, columnCount, rowEdges, columnEdges } = layoutOfView(state, reads);
  let isAcross = direction.rowDelta === 0;
  let indexAlong = ({ rowIndex, columnIndex }: CellPosition) => (isAcross ? columnIndex : rowIndex);
  let spanAlong = (area: CellArea): [number, number] =>
    isAcross ? [area.leftColumnIndex, area.columnCount] : [area.topRowIndex, area.rowCount];
  let cellAt = (index: number): CellPosition =>
    isAcross
      ? {
          ...cell,
          columnIndex: index,
        }
      : {
          ...cell,
          rowIndex: index,
        };
  let step = indexAlong({
    rowIndex: direction.rowDelta,
    columnIndex: direction.columnDelta,
  });
  let [mergeStart, mergeSpan] = spanAlong(reads.mergedAreaAt(sheetId, cell) ?? areaOfPosition(cell));
  let startIndex = stepOriginInMerge(step, mergeStart, mergeSpan, indexAlong(cell));
  let stepVisible = visibleIndexStepper(isAcross ? columnEdges : rowEdges, isAcross ? columnCount : rowCount, step);
  let firstStep = stepVisible(startIndex);
  if (firstStep === null) return cellAt(startIndex);
  let entryPosition = shownPositionInMerge(state, reads, reads.positionOfCell(keyMoveOriginOf(state)) ?? cell);
  let lineArea = isAcross
    ? {
        topRowIndex: entryPosition.rowIndex,
        leftColumnIndex: 0,
        rowCount: 1,
        columnCount,
      }
    : {
        topRowIndex: 0,
        leftColumnIndex: entryPosition.columnIndex,
        rowCount,
        columnCount: 1,
      };
  let filledIndexes = new Set<number>();
  for (let filledCell of reads.cellsOnShowIn(sheetId, lineArea)) {
    let position = reads.positionOfCell(filledCell);
    if (position === null) throw Error('a filled cell is not in the sheet');
    filledIndexes.add(indexAlong(position));
  }
  for (let mergedArea of reads.mergedAreasIn(sheetId, lineArea)) {
    let position = shownPositionInMerge(state, reads, {
      rowIndex: mergedArea.topRowIndex,
      columnIndex: mergedArea.leftColumnIndex,
    });
    let isOnEntryLine = isAcross ? position.rowIndex === entryPosition.rowIndex : position.columnIndex === entryPosition.columnIndex;
    let anchorCellId = reads.cellIdAt(sheetId, mergedArea.topRowIndex, mergedArea.leftColumnIndex);
    let isAnchorShown =
      anchorCellId !== null && (isOnEntryLine || isSameCell(anchorCellId, state.activeCell)) && reads.cellOnShowIn(anchorCellId) !== null;
    let [spanStart, spanLength] = spanAlong(mergedArea);
    for (let index = spanStart; index < spanStart + spanLength; index += 1)
      if (isAnchorShown) filledIndexes.add(index);
      else filledIndexes.delete(index);
  }
  return cellAt(walkToDataEdge(filledIndexes, startIndex, firstStep, stepVisible));
}
export function filledCellTester(state: PageState, reads: ReadsWithTextMeasurer): FilledCellTest {
  let { sheetId } = state;
  let { rowCount, columnCount } = layoutOfView(state, reads);
  let wholeSheet = {
    topRowIndex: 0,
    leftColumnIndex: 0,
    rowCount,
    columnCount,
  };
  let filledKeys = new Set<number>();
  let keyOf = (rowIndex: number, columnIndex: number) => rowIndex * columnCount + columnIndex;
  for (let filledCell of reads.cellsOnShowIn(sheetId, wholeSheet)) {
    let position = reads.positionOfCell(filledCell);
    if (position === null) throw Error('a filled cell is not in the sheet');
    filledKeys.add(keyOf(position.rowIndex, position.columnIndex));
  }
  for (let mergedArea of reads.mergedAreasIn(sheetId, wholeSheet)) {
    let isAnchorFilled = filledKeys.has(keyOf(mergedArea.topRowIndex, mergedArea.leftColumnIndex));
    for (let rowIndex = mergedArea.topRowIndex; rowIndex < mergedArea.topRowIndex + mergedArea.rowCount; rowIndex += 1)
      for (let columnIndex = mergedArea.leftColumnIndex; columnIndex < mergedArea.leftColumnIndex + mergedArea.columnCount; columnIndex += 1)
        if (isAnchorFilled) filledKeys.add(keyOf(rowIndex, columnIndex));
        else filledKeys.delete(keyOf(rowIndex, columnIndex));
  }
  let isFilled = (rowIndex: number, columnIndex: number) =>
    isInSpan(rowIndex, 0, rowCount) && isInSpan(columnIndex, 0, columnCount) && filledKeys.has(keyOf(rowIndex, columnIndex));
  return (rowSpan: IndexEnds, columnSpan: IndexEnds) => {
    for (let rowIndex = rowSpan[0]; rowIndex <= rowSpan[1]; rowIndex += 1)
      for (let columnIndex = columnSpan[0]; columnIndex <= columnSpan[1]; columnIndex += 1) if (isFilled(rowIndex, columnIndex)) return true;
    return false;
  };
}
export function growToCurrentRegion(isFilledIn: FilledCellTest, area: CellArea): CellArea {
  let [top, left]: [number, number] = [area.topRowIndex, area.leftColumnIndex];
  let [bottom, right]: [number, number] = [top + area.rowCount - 1, left + area.columnCount - 1];
  for (let lastSize = -1; lastSize !== bottom - top + right - left; ) {
    lastSize = bottom - top + right - left;
    while (isFilledIn([top - 1, top - 1], [left - 1, right + 1])) top -= 1;
    while (isFilledIn([bottom + 1, bottom + 1], [left - 1, right + 1])) bottom += 1;
    while (isFilledIn([top - 1, bottom + 1], [left - 1, left - 1])) left -= 1;
    while (isFilledIn([top - 1, bottom + 1], [right + 1, right + 1])) right += 1;
  }
  return {
    topRowIndex: top,
    leftColumnIndex: left,
    rowCount: bottom - top + 1,
    columnCount: right - left + 1,
  };
}
export function lastRowOfDataBelow(state: PageState, reads: ReadsWithTextMeasurer, area: CellArea): number {
  let isFilledIn = filledCellTester(state, reads);
  let bottomRowIndex = area.topRowIndex + area.rowCount - 1;
  let region = growToCurrentRegion(isFilledIn, {
    ...area,
    topRowIndex: bottomRowIndex,
    rowCount: 1,
  });
  let regionBottom = region.topRowIndex + region.rowCount - 1;
  let columnSpan: [number, number] = [area.leftColumnIndex, area.leftColumnIndex + area.columnCount - 1];
  for (let rowIndex = bottomRowIndex + 1; rowIndex <= regionBottom; rowIndex += 1)
    if (isFilledIn([rowIndex, rowIndex], columnSpan)) return rowIndex - 1;
  return regionBottom;
}
export function pageRowIndex(state: PageState, reads: ReadsWithTextMeasurer, { rowIndex, columnIndex }: CellPosition, by: PageStep): number {
  let layout = layoutOfView(state, reads);
  let { rowEdges, rowCount } = layout;
  let pageHeight =
    cellsHeightAboveFloats(state) - frozenRowsHeight(layout) - tallestStickyHeaderOverColumn(state, reads, columnIndex, layout);
  if (by === 1) {
    let targetRow = rowEdges.indexAt(rowEdges.startOf(rowIndex) + pageHeight);
    let pageRow = shownLineAtOrBefore(rowEdges, targetRow - 1);
    return Math.min(Math.max(pageRow, rowIndex + 1), rowCount - 1);
  }
  let pageTop = rowEdges.startOf(rowIndex + 1) - pageHeight;
  let rowAtTop = rowEdges.indexAt(pageTop);
  let firstFullRow = rowEdges.startOf(rowAtTop) < pageTop ? shownLineAtOrAfter(rowEdges, rowAtTop + 1) : rowAtTop;
  return Math.max(Math.min(firstFullRow, rowIndex - 1), 0);
}
export function jumpDirection(jump: Jump): KeyMove {
  switch (jump.kind) {
    case 'startOfRow':
    case 'startOfSheet':
      return {
        rowDelta: 1,
        columnDelta: 1,
      };
    case 'endOfRow':
      return {
        rowDelta: 1,
        columnDelta: -1,
      };
    case 'endOfSheet':
      return {
        rowDelta: -1,
        columnDelta: -1,
      };
    case 'edgeOfData':
      return jump;
    case 'page':
      return {
        rowDelta: jump.by,
        columnDelta: 1,
      };
  }
}
export function jumpTarget(state: PageState, reads: ReadsWithTextMeasurer, jump: Jump, from: CellPosition, isExtending: boolean): CellPosition {
  let target = jumpCell(state, reads, jump, from);
  let visibleTarget = skipHiddenLines(layoutOfView(state, reads), target, jumpDirection(jump));
  if (!isExtending) return visibleTarget;
  return {
    rowIndex: target.rowIndex === from.rowIndex ? from.rowIndex : visibleTarget.rowIndex,
    columnIndex: target.columnIndex === from.columnIndex ? from.columnIndex : visibleTarget.columnIndex,
  };
}
export function jumpCell(state: PageState, reads: ReadsWithTextMeasurer, jump: Jump, from: CellPosition): CellPosition {
  switch (jump.kind) {
    case 'startOfRow':
      return {
        ...from,
        columnIndex: 0,
      };
    case 'endOfRow':
      return {
        ...from,
        columnIndex: layoutOfView(state, reads).columnCount - 1,
      };
    case 'startOfSheet':
      return {
        rowIndex: 0,
        columnIndex: 0,
      };
    case 'endOfSheet': {
      let { rowCount, columnCount } = layoutOfView(state, reads);
      return {
        rowIndex: rowCount - 1,
        columnIndex: columnCount - 1,
      };
    }
    case 'edgeOfData':
      return edgeOfDataFrom(state, reads, from, jump);
    case 'page':
      return {
        ...from,
        rowIndex: pageRowIndex(state, reads, from, jump.by),
      };
  }
}
export function pageStartRow(state: PageState, reads: ReadsWithTextMeasurer, position: CellPosition, by: PageStep): CellPosition {
  let { topRowIndex, rowCount } = reads.mergedAreaAt(state.sheetId, position) ?? areaOfPosition(position);
  let { rowEdges } = layoutOfView(state, reads);
  let pageStart = stepOriginInMerge(by, topRowIndex, rowCount, position.rowIndex);
  let rowIndex =
    by === 1
      ? Math.max(position.rowIndex, shownLineAtOrBefore(rowEdges, pageStart))
      : Math.min(position.rowIndex, shownLineAtOrAfter(rowEdges, pageStart));
  return {
    ...position,
    rowIndex,
  };
}
export function scrollForPage(state: PageState, reads: ReadsWithTextMeasurer, from: CellPosition, to: CellPosition): PageState {
  let layout = layoutOfView(state, reads);
  let { rowEdges } = layout;
  let scrollTop = state.scrollTop + rowEdges.startOf(to.rowIndex) - rowEdges.startOf(from.rowIndex);
  return {
    ...state,
    ...clampScrollKeepingReach(
      state,
      {
        ...state,
        scrollTop,
      },
      layout,
      state,
    ),
  };
}
export function jumpSelection(state: PageState, reads: ReadsWithTextMeasurer, jump: Jump, isExtending: boolean): PageState | null {
  let startPosition = reads.positionOfCell(isExtending ? state.selectionCorner : keyMoveOriginOf(state));
  if (startPosition === null) return null;
  let visiblePosition = shownPositionInMerge(state, reads, startPosition);
  let from = jump.kind === 'page' ? pageStartRow(state, reads, visiblePosition, jump.by) : visiblePosition;
  let target = jumpTarget(state, reads, jump, from, isExtending);
  let targetCell = isExtending ? reads.cellIdAt(state.sheetId, target.rowIndex, target.columnIndex) : cellToLandOn(state, reads, target);
  if (targetCell === null) return null;
  let scrolledState = jump.kind === 'page' ? scrollForPage(state, reads, from, target) : state;
  if (!isExtending) return moveActiveCellTo(scrolledState, reads, targetCell);
  if (isSameCell(targetCell, state.selectionCorner)) return null;
  return scrollAfterExtendingSelection(
    {
      ...scrolledState,
      selectionCorner: targetCell,
    },
    reads,
    target,
    {
      rows: target.rowIndex !== from.rowIndex,
      columns: target.columnIndex !== from.columnIndex,
    },
  );
}
export function jumpOrExtendSelection(state: PageState, reads: ReadsWithTextMeasurer, jump: Jump, isExtending: boolean): PageState {
  if (!isExtending) return jumpSelection(state, reads, jump, false) ?? state;
  let selectedBefore = selectedArea(state, reads);
  let layout = layoutOfView(state, reads);
  let jumped: PageState | null = jumpSelection(state, reads, jump, true);
  while (jumped !== null) {
    let selectedNow = selectedArea(jumped, reads);
    if (selectedNow === null || selectedBefore === null || !isSameBoxOnGrid(layout, selectedNow, selectedBefore)) return jumped;
    jumped = jumpSelection(jumped, reads, jump, true);
  }
  return state;
}
export const visibleIndexStepper =
  (edges: LineSizes, count: number, direction: number) =>
  (index: number): number | null => {
    let next = direction > 0 ? shownLineAtOrAfter(edges, index + 1) : shownLineAtOrBefore(edges, index - 1);
    return isInSpan(next, 0, count) ? next : null;
  };
export const currentRegionAround = (state: PageState, reads: ReadsWithTextMeasurer, area: CellArea): CellArea =>
  growToCurrentRegion(filledCellTester(state, reads), area);
