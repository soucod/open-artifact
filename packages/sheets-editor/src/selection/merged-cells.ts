import type { SheetId } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CellArea } from './model.ts';
import {
  isAnchorOfActiveCell,
  activeAnchorCell,
  isSameCell,
  keyMoveOriginOf,
  selectionAtCell,
  selectionAreaAndKind,
  areaOfRangeWalked,
} from './model.ts';
import { isSelectionOneCell } from './keyboard.ts';
import { clearPassingNotice, NAVIGATING_MODE } from '../state/transitions.ts';
import { newsOfLossIfTypingLost } from '../state/queries.ts';
export function settleCameToMergedCellsAt(state: PageState, workbook: WorkbookReads): PageState {
  let { cameToMergedCellsAt: cameTo } = state;
  return cameTo === null || (isAnchorOfActiveCell(state, workbook, cameTo) && isSelectionOneCell(state, workbook))
    ? state
    : {
        ...state,
        cameToMergedCellsAt: null,
      };
}
export function settleActiveCellOnMerges(state: PageState, workbook: WorkbookReads): PageState {
  return settleCameToMergedCellsAt(moveActiveCellToMergeAnchor(state, workbook), workbook);
}
export function moveActiveCellToMergeAnchor(state: PageState, workbook: WorkbookReads): PageState {
  let anchor = activeAnchorCell(state, workbook);
  if (isSameCell(anchor, state.activeCell)) return state;
  let cameFrom = keyMoveOriginOf(state);
  if (state.mode.kind === 'editing')
    return {
      ...clearPassingNotice(state),
      ...selectionAtCell(anchor),
      cameToMergedCellsAt: cameFrom,
      mode: NAVIGATING_MODE,
      newsOfLoss: newsOfLossIfTypingLost(state, 'entryDroppedByMerge'),
    };
  if (selectionAreaAndKind(state, workbook)?.kind !== 'cells') return state;
  let isOneCellSelected = isSameCell(state.selectionCorner, state.activeCell) && areaOfRangeWalked(state, workbook) === null;
  return {
    ...state,
    activeCell: anchor,
    selectionCorner: isOneCellSelected ? anchor : state.selectionCorner,
    cameToMergedCellsAt: isOneCellSelected ? cameFrom : null,
  };
}
export function mergedCellsToSkipTest(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): (cellId: CellId) => boolean {
  let skipped = new Set<string>();
  for (let mergedArea of workbook.mergedAreasIn(sheetId, area)) {
    let keptCell = mergedArea.columnCount > 1 ? null : workbook.cellIdAt(sheetId, mergedArea.topRowIndex, mergedArea.leftColumnIndex);
    for (let cellId of workbook.cellsOnShowIn(sheetId, mergedArea))
      if (cellId.rowId !== keptCell?.rowId) skipped.add(mergeCellKey(cellId));
  }
  return (cellId: CellId) => skipped.has(mergeCellKey(cellId));
}
export function mergeAnchorCellsTest(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): (cellId: CellId) => boolean {
  let anchors = new Set<string>();
  for (let { topRowIndex, leftColumnIndex } of workbook.mergedAreasIn(sheetId, area)) {
    let anchor = workbook.cellIdAt(sheetId, topRowIndex, leftColumnIndex);
    if (anchor !== null) anchors.add(mergeCellKey(anchor));
  }
  return (cellId: CellId) => anchors.has(mergeCellKey(cellId));
}
export const mergeCellKey = ({ rowId, columnId }: Pick<CellId, 'rowId' | 'columnId'>): string => `${rowId} ${columnId}`;
