import type { RangeCorners, SheetId } from '@open-artifact/sheets-core';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { CellArea } from '../selection/model.ts';
import type { PageState } from '../state/initial-state.ts';
import type { PageMode } from '../state/transitions.ts';
import type { TextMeasurer } from '../state/controller.ts';
import type { PaneRect } from './geometry.ts';
import type { DrawnCell, DrawnRow } from './grid-drawing.tsx';
import { cellsJoinForOverflow, flattenLineBreaks } from './text-overflow.ts';
import { unzoomedEditorWidth, listIndentOfLines, textRoomPastPadding } from './cell-metrics.ts';
import { resolvePlaceArea } from '../agent/changes-by-agent.ts';
import { readsAsStored } from '../model/workbook.ts';
import { areaAsSeen } from '../model/a1-references.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
/** The cell being entered, as far as the hint under its entry needs to know it. */
export interface EntryCellOfHint {
  format: WholeCellFormat;
  frozenBy: DrawnCell['frozenBy'];
  /** Whether the hint may run on over the blank cells to the right of the entry. */
  canHintReachOn: boolean;
}
/** The size of an entry drawn zoomed in, and how far it is zoomed. */
export interface ZoomedEntrySize {
  scale: number;
  width: number;
}
/** The cells a formula's array fills, would fill if not blocked, or would fill if the formula is kept. */
export interface SpillOutline {
  kind: 'fills' | 'blocked' | 'ifKept';
  area: CellArea;
}
export function frozenCellsAcrossEntry(
  entryBox: Pick<PaneRect, 'top' | 'height'>,
  frozenBy: DrawnCell['frozenBy'],
  drawnRows: readonly DrawnRow[],
): DrawnCell[] {
  let cells = drawnRows.flatMap(
    (row) =>
      row.cells.filter(
        (cell) =>
          cell.frozenBy === frozenBy &&
          row.top + cell.top < entryBox.top + entryBox.height - GRID_PIXEL_SLACK &&
          row.top + cell.top + cell.height > entryBox.top + GRID_PIXEL_SLACK,
      ),
  );
  cells.sort((first, second) => first.left - second.left);
  return cells;
}
export function entryHintRoomOf(
  entryBox: PaneRect,
  entryCell: EntryCellOfHint,
  drawnRows: readonly DrawnRow[],
  shownLeft: number,
  shownRight: number,
  zoomedSize: ZoomedEntrySize | undefined,
): number | null {
  let entryRight = entryBox.left + entryBox.width;
  let hintRight = entryCell.canHintReachOn ? shownRight : entryRight;
  let formatSoFar = entryCell.format;
  for (let cell of entryCell.canHintReachOn ? frozenCellsAcrossEntry(entryBox, entryCell.frozenBy, drawnRows) : []) {
    if (cell.left + cell.width <= entryRight + GRID_PIXEL_SLACK) continue;
    let looksSame = cell.mergedRowCount === null && cellsJoinForOverflow(formatSoFar, cell.format, true);
    if (cell.text !== '' || !looksSame) {
      hintRight = Math.max(entryRight, Math.min(cell.left, cell.textLeft));
      break;
    }
    formatSoFar = cell.format;
  }
  let room = Math.min(hintRight, shownRight) - entryBox.left;
  let hintRoom = zoomedSize === undefined ? room : Math.max(zoomedSize.width, unzoomedEditorWidth(room, zoomedSize.scale, 'along'));
  return entryBox.left < shownLeft - GRID_PIXEL_SLACK || hintRoom < ENTRY_HINT_MIN_FONT_WIDTHS * entryCell.format.font.size ? null : hintRoom;
}
export function seenAreaOfCells(reads: WorkbookReads, sheetId: SheetId, cells: RangeCorners): CellArea | null {
  let area =
    resolvePlaceArea(
      {
        sheetId,
        cells,
      },
      readsAsStored(reads),
    )?.area ?? null;
  return area === null ? null : areaAsSeen(area, ownRowOrderOfSheet(reads, sheetId));
}
export function spillOutlineOfCell(reads: WorkbookReads, cellId: CellId): SpillOutline | null {
  let cell = reads.cellOf(cellId);
  if (cell?.spill?.kind !== 'blocked') {
    let spill = reads.spillOver(cellId);
    return spill === null
      ? null
      : {
          kind: 'fills',
          area: spill.area,
        };
  }
  let cellsBlocked = {
    topLeft: cell,
    bottomRight: cell.spill.wouldFillTo,
  };
  let area = seenAreaOfCells(reads, cellId.sheetId, cellsBlocked);
  return area === null
    ? null
    : {
        kind: 'blocked',
        area,
      };
}
export function spillOutlineOfEntry(
  { formulaFromWords: { stage } }: Pick<PageState, 'formulaFromWords'>,
  reads: WorkbookReads,
  cellId: CellId,
): SpillOutline | null {
  if (stage?.kind !== 'proposed') return spillOutlineOfCell(reads, cellId);
  if (stage.value.fillsTo === undefined) return null;
  let cellsFilled = {
    topLeft: {
      r: cellId.rowId,
      c: cellId.columnId,
    },
    bottomRight: stage.value.fillsTo,
  };
  let area = seenAreaOfCells(reads, cellId.sheetId, cellsFilled);
  return area === null
    ? null
    : {
        kind: 'ifKept',
        area,
      };
}
export function formulaSpilledOverCell(reads: WorkbookReads, cellId: CellId): string | null {
  if (reads.cellOf(cellId) !== null) return null;
  return reads.spillOver(cellId)?.formulaText ?? null;
}
export function endOfWrappedTextIfCut(
  {
    text,
    listLines,
    format: { font },
    alignment,
    left,
    width,
    textLeft,
    textWidth,
    textLeftInWholeRow,
  }: Pick<DrawnCell, 'text' | 'listLines' | 'format' | 'alignment' | 'left' | 'width' | 'textLeft' | 'textWidth' | 'textLeftInWholeRow'>,
  measure: TextMeasurer,
): number | null {
  let shownText = flattenLineBreaks(text);
  let [middle, textRight] = [left + width / 2, textLeft + textWidth];
  let indent = listIndentOfLines(listLines, font.size);
  let roomForText =
    (alignment === 'center' ? 2 * Math.min(middle - textLeftInWholeRow, textRight - middle) : textRight - textLeftInWholeRow) - indent;
  let [lineCount = 1] = measure.lineCountsOfWrappedTexts([
    {
      text: shownText,
      font,
      widthInPixels: textRoomPastPadding(roomForText),
    },
  ]);
  if (lineCount < 2) return null;
  return alignment === 'center' ? Math.min(textRight, middle + (measure.widthOfCharacters(shownText, font) + indent) / 2) : textRight;
}
export const isCellEntryBlank = (mode: PageMode): boolean => mode.kind === 'editing' && mode.typingIn === 'cell' && mode.text === '';
export const ENTRY_HINT_MIN_FONT_WIDTHS = 7;
export const GRID_PIXEL_SLACK = 0.5;
