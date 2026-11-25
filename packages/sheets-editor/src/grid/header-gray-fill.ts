import { makeIsFilterHeaderArea } from '../tables/table-drawing.ts';
import { layoutOfView } from './layout.ts';
import { makeIsInTableHeader, tablesToOutline } from '../tables/tables-in-view.ts';
import { LIGHT_GRAY_HEX, hasFontOrBorderFormatting, DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { cellColorsOfFormat, NO_CELL_COLORS } from '../format/cell-colors.ts';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { ChipPaints } from './cell-drawing.tsx';
/** How a cell is drawn: its format with what rules give it, its paints, and whether a rule gave its text color or its fill. */
export interface CellLook {
  format: WholeCellFormat;
  paints: ChipPaints;
  isTextColorFromRule: boolean;
  isFillFromRule: boolean;
}
/** Tells how the cells of a sheet are drawn, with the formats their rules give them. */
export interface CellLooks {
  formatOf(cellId: CellId): WholeCellFormat;
  formatOver(format: WholeCellFormat, cellId: Pick<CellId, 'rowId' | 'columnId'>): WholeCellFormat;
  lookOf(cellId: CellId, position: CellPosition): CellLook;
}
export function isHeaderGrayHidden(state: PageState, reads: ReadsWithTextMeasurer, cellId: CellId, position: CellPosition, look: CellLook): boolean {
  if (cellId.sheetId !== state.sheetId || !isPlainLightGrayLook(look, reads, cellId)) return false;
  let area = mergedAreaOrCellAt(reads, cellId, position);
  return makeIsFilterHeaderArea(state, reads, layoutOfView(state, reads))(area) || makeIsInTableHeader(tablesToOutline(state, reads))(area);
}
export const isPlainLightGrayFill = (format: Pick<WholeCellFormat, 'fillColor' | 'font'>): boolean =>
  format.fillColor.kind === 'rgb' &&
  format.fillColor.hex === LIGHT_GRAY_HEX &&
  !hasFontOrBorderFormatting({
    font: format.font,
    border: DEFAULT_CELL_FORMAT.border,
  });
export const mergedAreaOrCellAt = (reads: WorkbookReads, { sheetId }: Pick<CellId, 'sheetId'>, position: CellPosition): CellArea =>
  reads.mergedAreaAt(sheetId, position) ?? {
    topRowIndex: position.rowIndex,
    rowCount: 1,
    leftColumnIndex: position.columnIndex,
    columnCount: 1,
  };
export const isPlainLightGrayLook = (look: CellLook, reads: WorkbookReads, cellId: CellId): boolean =>
  isPlainLightGrayFill(look.format) &&
  isPlainLightGrayFill(reads.formatOf(cellId)) &&
  !look.isFillFromRule &&
  look.paints === cellColorsOfFormat(look.format);
export const looksWithoutHeaderGray = (looks: CellLooks, reads: WorkbookReads, isHeaderArea: (area: CellArea) => boolean): CellLooks => ({
  formatOf: (cellId: CellId) => looks.formatOf(cellId),
  formatOver: (format: WholeCellFormat, cellId: Pick<CellId, 'rowId' | 'columnId'>) => looks.formatOver(format, cellId),
  lookOf(cellId: CellId, position: CellPosition) {
    let look = looks.lookOf(cellId, position);
    return isPlainLightGrayLook(look, reads, cellId) && isHeaderArea(mergedAreaOrCellAt(reads, cellId, position))
      ? {
          ...look,
          paints: NO_CELL_COLORS,
        }
      : look;
  },
});
