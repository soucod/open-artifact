import type { CellId } from '../model/workbook.ts';
import type { CellsOfComment } from '../state/initial-state.ts';

/** The anchor a comment on the cells is stored under, or `null` when their ids cannot make one. */
export function commentAnchorOfCells(topLeft: CellId, bottomRight: CellId): string | null {
  let cornerPart =
    topLeft.rowId === bottomRight.rowId && topLeft.columnId === bottomRight.columnId ? '' : `:${bottomRight.rowId}/${bottomRight.columnId}`;
  let anchor = `cells:${topLeft.sheetId}/${topLeft.rowId}/${topLeft.columnId}${cornerPart}`;
  return anchor.length <= 256 && COMMENT_CELLS_ANCHOR_PATTERN.test(anchor) ? anchor : null;
}
export function cellsOfCommentAnchor(anchor: string): CellsOfComment | null {
  let [, sheetId, rowId, columnId, cornerRowId, cornerColumnId] = COMMENT_CELLS_ANCHOR_PATTERN.exec(anchor) ?? [];
  if (sheetId === undefined || rowId === undefined || columnId === undefined) return null;
  let activeCell: CellId = {
    sheetId,
    rowId,
    columnId,
  };
  return {
    activeCell,
    selectionCorner:
      cornerRowId === undefined || cornerColumnId === undefined
        ? activeCell
        : {
            sheetId,
            rowId: cornerRowId,
            columnId: cornerColumnId,
          },
  };
}
export const COMMENT_CELLS_ANCHOR_PATTERN = /^cells:([\w.]+)\/([\w.]+)\/([\w.]+)(?::([\w.]+)\/([\w.]+))?$/;
