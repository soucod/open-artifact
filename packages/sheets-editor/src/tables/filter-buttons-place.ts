import type { ColumnId, SheetId } from '@open-artifact/sheets-core';
import { cellPaddingBeside, textLineMiddleY } from '../grid/cell-metrics.ts';
import { clampBetween } from '../grid/geometry.ts';
import { clampSpanToShown } from './own-filter-list.ts';
import { columnLabelOf } from '../format/conditional/editor-view.ts';
import { isColumnFiltered } from './filter-model.ts';
import type { ColumnSpanOfId, PlacedFilterButton, TableWithFilterButtons, TextLookOfHeaderCell } from './table-drawing.ts';
import type { ShownStretch, SpanOnScreen } from '../grid/geometry.ts';
import type { CellDensity } from '../grid/cell-metrics-values.ts';
/** Where the columns of a table found in sight are on screen, and the room its filter buttons leave at its end. */
export interface FoundTableSpan {
  table: SpanOnScreen;
  takenAtEnd: number;
}
export function roomAroundFilterButton(
  start: number,
  { showFrom, showTo }: ShownStretch,
): [roomBefore: number, roomAfter: number] | null {
  const [roomBefore, roomAfter] = [start - showFrom, showTo - start - FILTER_BUTTON_SIZE];
  return Math.min(roomBefore, roomAfter) <= -FILTER_BUTTON_SIZE ? null : [roomBefore, roomAfter];
}
export function filterButtonLeftInTable(
  left: number,
  across: ShownStretch,
  { table, takenAtEnd }: FoundTableSpan,
  padding: number,
): number {
  const tableStart = Math.max(table.start, table.showFrom);
  const minLeft = table.showFrom < across.showFrom ? Math.max(across.showFrom - padding - FILTER_BUTTON_SIZE, tableStart) : left;
  const maxLeft = Math.max(table.showTo - Math.max(padding, takenAtEnd) - FILTER_BUTTON_SIZE, tableStart);
  return Math.min(Math.max(left, minLeft), maxLeft);
}
export function filterButtonsOfTable(
  filterTable: TableWithFilterButtons,
  placeOfColumn: (columnId: ColumnId) => ColumnSpanOfId | null,
  rowSpan: SpanOnScreen,
  density: CellDensity,
  columnWithListOpen: ColumnId | null,
  textLookOfColumn: (columnIndex: number) => TextLookOfHeaderCell,
  foundTableSpan: FoundTableSpan | null = null,
): PlacedFilterButton[] {
  const rowHeight = rowSpan.end - rowSpan.start;
  if (rowHeight < FILTER_BUTTON_SIZE) return [];
  const columnIndexOfColumn = (sheetId: SheetId, columnId: ColumnId) => placeOfColumn(columnId)?.columnIndex ?? null;
  return filterTable.columns.flatMap(({ c: columnId, name }): PlacedFilterButton[] => {
    const place = placeOfColumn(columnId);
    if (place === null) return [];
    const { start: acrossStart, end: acrossEnd } = place.across;
    const padding = cellPaddingBeside(density);
    const restingLeft = Math.max(acrossStart, acrossEnd - padding - FILTER_BUTTON_SIZE);
    const left = foundTableSpan === null ? restingLeft : filterButtonLeftInTable(restingLeft, place.across, foundTableSpan, padding);
    const span =
      foundTableSpan === null
        ? place.across
        : {
            ...foundTableSpan.table,
            showFrom: Math.max(foundTableSpan.table.start, foundTableSpan.table.showFrom),
            showTo: Math.min(foundTableSpan.table.end, foundTableSpan.table.showTo + 1),
          };
    const clearAcross = roomAroundFilterButton(left, span);
    const heldBy = Math.max(Math.abs(left - restingLeft), span.showFrom < place.across.showFrom ? place.across.showFrom - left : 0);
    const { fontSizeInPoints, isAt, hiddenByBorderAtFoot } = textLookOfColumn(place.columnIndex);
    const textMiddle = textLineMiddleY(rowHeight, fontSizeInPoints, isAt, density, hiddenByBorderAtFoot);
    const top = rowSpan.start + clampBetween(Math.floor(textMiddle - FILTER_BUTTON_SIZE / 2), 0, rowHeight - FILTER_BUTTON_SIZE);
    const clearDown = roomAroundFilterButton(top, rowSpan);
    if (acrossEnd - acrossStart < FILTER_BUTTON_SIZE || clearAcross === null || clearDown === null) return [];
    const [[cellLeft, cellWidth], [cellTop, cellHeight]] = [clampSpanToShown(place.across), clampSpanToShown(rowSpan)];
    const heldRight = left < place.across.showFrom ? Math.min(span.showTo, left + FILTER_BUTTON_SIZE + padding) : span.showTo;
    const fade = clampBetween(left - span.showFrom, 0, Math.min(heldBy, MAX_FILTER_BUTTON_FADE));
    return [
      {
        tableKey: filterTable.key,
        r: filterTable.table.header.lastRow,
        isOfFoundTable: filterTable.columnsOfFound !== undefined,
        c: columnId,
        columnIndex: place.columnIndex,
        column: columnLabelOf(
          {
            columnIndexOf: columnIndexOfColumn,
          },
          filterTable.table.sheetId,
          {
            c: columnId,
            name,
          },
        ),
        left,
        top,
        clearAt: {
          left: clearAcross[0],
          right: clearAcross[1],
          top: clearDown[0],
          bottom: clearDown[1],
        },
        cell: {
          left: cellLeft,
          top: cellTop,
          width: cellWidth,
          height: cellHeight,
        },
        isOn: isColumnFiltered(filterTable.filter, columnId),
        isListOpen: columnId === columnWithListOpen,
        heldInView:
          heldBy === 0
            ? null
            : {
                left: left - fade,
                width: heldRight - (heldRight === span.end ? 1 : 0) - left + fade,
                top: cellTop,
                height: Math.min(cellHeight, rowSpan.end - 1 - cellTop),
                fade,
              },
      },
    ];
  });
}
export const FILTER_BUTTON_SIZE = 20;
export const FILTER_BUTTON_GAP = 2;
export const MAX_FILTER_BUTTON_FADE = 20;
export const ROOM_AT_TABLE_END_FOR_FILTER_BUTTONS = 10;
