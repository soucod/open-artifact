import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { PageEffect, PageTransition } from '../state/transitions.ts';
import type { KeyMove } from './keyboard.ts';
import type { CellArea, CellPosition, RangeWalked } from './model.ts';
import {
  selectedArea,
  mergedAreaOrCellOf,
  isSameArea,
  shownPositionInMerge,
  unionOfAreas,
  areaOfPosition,
  isSameCell,
  selectionAtCell,
  areaOfRangeWalked,
} from './model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { isLineShown } from '../model/line-sizes.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
export function nextPositionWithinArea(area: CellArea, position: CellPosition, move: KeyMove): CellPosition {
  let isAcross = move.columnDelta !== 0;
  let rowOffset = position.rowIndex - area.topRowIndex;
  let columnOffset = position.columnIndex - area.leftColumnIndex;
  let lineLength = isAcross ? area.columnCount : area.rowCount;
  let cellCount = area.rowCount * area.columnCount;
  let nextIndex =
    ((isAcross ? rowOffset * lineLength + columnOffset : columnOffset * lineLength + rowOffset) + move.rowDelta + move.columnDelta + cellCount) %
    cellCount;
  let [major, minor] = [Math.floor(nextIndex / lineLength), nextIndex % lineLength];
  return {
    rowIndex: area.topRowIndex + (isAcross ? major : minor),
    columnIndex: area.leftColumnIndex + (isAcross ? minor : major),
  };
}
export function walkWithinSelection(state: PageState, reads: ReadsWithTextMeasurer, move: KeyMove): RangeWalked | null {
  let area = selectedArea(state, reads);
  let position = reads.positionOfCell(state.activeCell);
  let activeArea = mergedAreaOrCellOf(reads, state.activeCell);
  if (area === null || position === null || activeArea === null) return null;
  if (isSameArea(area, activeArea)) return null;
  let { from, to } = state.rangeWalked ?? {
    from: state.activeCell,
    to: state.selectionCorner,
  };
  let { rowEdges, columnEdges } = layoutOfView(state, reads);
  let next: CellPosition = shownPositionInMerge(state, reads, position);
  for (let stepsLeft = area.rowCount * area.columnCount; stepsLeft > 0; stepsLeft -= 1) {
    next = nextPositionWithinArea(area, next, move);
    if (!isLineShown(rowEdges, next.rowIndex) || !isLineShown(columnEdges, next.columnIndex)) continue;
    let merged = reads.mergedAreaAt(state.sheetId, next);
    let target =
      merged === null
        ? next
        : {
            rowIndex: merged.topRowIndex,
            columnIndex: merged.leftColumnIndex,
          };
    let targetShown = shownPositionInMerge(state, reads, target);
    let cellId =
      targetShown.rowIndex !== next.rowIndex ||
      targetShown.columnIndex !== next.columnIndex ||
      !isSameArea(unionOfAreas(area, areaOfPosition(target)), area)
        ? null
        : reads.cellIdAt(state.sheetId, target.rowIndex, target.columnIndex);
    if (cellId !== null)
      return {
        from,
        to,
        at: cellId,
      };
  }
  return null;
}
export function withRangeWalked(rangeWalked: RangeWalked, { state, effects }: PageTransition): PageTransition | null {
  let { at } = rangeWalked;
  if (isSameCell(state.activeCell, at))
    return {
      state: {
        ...state,
        rangeWalked,
      },
      effects,
    };
  let selectsAt = (effect: PageEffect): boolean => {
    let select = effect.kind === 'queueEdit' ? effect.ifQueued.select : null;
    if (select === null || select === 'placeChanged' || !('activeCell' in select)) return false;
    return isSameCell(select.activeCell, at);
  };
  if (!effects.some(selectsAt)) return null;
  let mapped = effects.map(
    (effect: PageEffect): PageEffect =>
      effect.kind === 'queueEdit' && selectsAt(effect)
        ? {
            ...effect,
            ifQueued: {
              ...effect.ifQueued,
              select: {
                ...selectionAtCell(at),
                rangeWalked,
              },
            },
          }
        : effect,
  );
  return {
    state,
    effects: mapped,
  };
}
export const dropStaleRangeWalked = (state: PageState, reads: WorkbookReads): PageState =>
  state.rangeWalked === null || areaOfRangeWalked(state, reads) !== null
    ? state
    : {
        ...state,
        rangeWalked: null,
      };
