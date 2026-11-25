import { createLineSizes } from '../model/line-sizes.ts';
import { isInSpan, rangeSpansOnScreen } from './geometry.ts';
import { buildBorderPaths } from './borders.ts';
import { layoutOfView } from './layout.ts';
import type { Border, CellContents, SheetId } from '@open-artifact/sheets-core';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { CellId, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { MoveOfColumnsUnanswered, PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { ColumnsOfTableMoving } from '../selection/move-table-columns.ts';
import type { CellPosition } from '../selection/model.ts';
import type { GridLayout } from './layout.ts';
import type { PaneRect } from './geometry.ts';
/** The columns of a table moved: on which sheet, across which cells, and the column each now holds the cells of. */
export type ColumnsMoved = MoveOfColumnsUnanswered['moved'];
/** Reads that show columns of a table as moved, and how to find the cell a moved cell lay at before. */
export interface ReadsWithColumnsMoved {
  layBefore: (cell: CellId) => CellId;
  reads: ReadsWithTextMeasurer;
}
/** What of a drawn cell a copy of it riding with columns in hand needs. */
export interface CellToRide {
  isInHand: boolean;
  left: number;
  textLeft: number;
  textLeftInWholeRow: number;
}
/** What of a drawn row the rows riding with columns in hand are made from. */
export interface RowToRide<Cell extends CellToRide = CellToRide> {
  key: string;
  rowNumber: number;
  top: number;
  height: number;
  cells: readonly Cell[];
}
/** A copy of a drawn cell riding with columns in hand, placed in the room they ride in. */
export type RidingCell<Cell extends CellToRide> = Omit<
  Cell,
  'isInHand' | 'elementId' | 'isActive' | 'isSelected' | 'cornersOfTable' | 'left' | 'textLeft' | 'textLeftInWholeRow'
> & {
  isInHand: boolean;
  elementId: null;
  isActive: boolean;
  isSelected: boolean;
  cornersOfTable: null;
  left: number;
  textLeft: number;
  textLeftInWholeRow: number;
};
/** A copy of a drawn row with only its cells in hand, placed in the room they ride in. */
export type RidingRow<Row extends RowToRide> = Omit<Row, 'key' | 'top' | 'isActive' | 'isFrozen' | 'cells'> & {
  key: string;
  top: number;
  isActive: boolean;
  isFrozen: boolean;
  cells: RidingCell<Row['cells'][number]>[];
};
/** The drawn rows, the layout and the reads that columns in hand ride over. */
export interface DrawnUnderRidingColumns<Row extends RowToRide> {
  rows: readonly Row[];
  sheet: GridLayout;
  reads: WorkbookReads;
}
/** A border path as the grid draws it. */
export type BorderPathDrawn = ReturnType<typeof buildBorderPaths>[number];
/** Border paths drawn in a box of their own. */
export interface BorderLinesInBox {
  key: string;
  box: PaneRect;
  lines: BorderPathDrawn[];
}
/** A column of the run in hand, the column whose cells it holds, and where it starts on screen. */
export interface ColumnInRidingOrder {
  columnIndex: number;
  holdsCellsOf: number;
  left: number;
}
/** Columns of a table in hand as they ride with the pointer: their rows, borders, and how far they may go. */
export interface ColumnsRiding<Row extends RowToRide> {
  key: string;
  room: PaneRect;
  rows: RidingRow<Row>[];
  borderLines: BorderLinesInBox[];
  homeLeft: number;
  leastLeft: number;
  endOfRun: number;
  gripFromLeft: number;
  firstRowIndex: number;
  lastRowIndex: number;
  order: ColumnInRidingOrder[];
}
/** Drawn rows of headers kept in sight, which ride too. */
export interface HeaderRowsKept<Row extends RowToRide> {
  rows: readonly Row[];
}
export function readsWithColumnsMoved(
  reads: ReadsWithTextMeasurer,
  { sheetId, area, cameFrom, endsOfTable }: ColumnsMoved = {} as ColumnsMoved,
): ReadsWithColumnsMoved {
  let key = [sheetId, area.topRowIndex, area.rowCount, area.leftColumnIndex, endsOfTable?.first, endsOfTable?.last, ...cameFrom].join(' ');
  let isRowMoved = (rowIndex: number): boolean => endsOfTable === null || isInSpan(rowIndex, area.topRowIndex, area.rowCount);
  let byKey = readsWithColumnsMovedCache.get(reads) ?? new Map<string, ReadsWithColumnsMoved>();
  readsWithColumnsMovedCache.set(reads, byKey);
  let cached = byKey.get(key);
  if (cached !== undefined) return cached;
  let layBefore = (cell: CellId): CellId => {
    if (cell.sheetId !== sheetId) return cell;
    let position = reads.positionOfCell(cell);
    if (position === null || !isRowMoved(position.rowIndex)) return cell;
    let columnIndex = cameFrom[position.columnIndex - area.leftColumnIndex];
    if (columnIndex === undefined || columnIndex === position.columnIndex) return cell;
    return reads.cellIdAt(sheetId, position.rowIndex, columnIndex) ?? cell;
  };
  let readBefore =
    <Found extends Pick<CellContents, 'r' | 'c'>>(read: (cell: CellId) => Found | null) =>
    (cell: CellId): Found | null => {
      let before = layBefore(cell);
      let found = read(before);
      return found === null || before === cell
        ? found
        : {
            ...found,
            r: cell.rowId,
            c: cell.columnId,
          };
    };
  let formatOf = (cell: CellId): WholeCellFormat => {
    let before = layBefore(cell);
    let format = reads.formatOf(before);
    if (before === cell || endsOfTable === null) return format;
    let [position, positionBefore] = [reads.positionOfCell(cell), reads.positionOfCell(before)];
    if (position === null || positionBefore === null) return format;
    let borderAtEnd = (side: 'left' | 'right', endColumnIndex: number): Border => {
      let borderOfColumn = (columnIndex: number): Border => {
        let cellAtEnd = reads.cellIdAt(sheetId, position.rowIndex, columnIndex);
        return cellAtEnd === null ? format.border[side] : reads.formatOf(cellAtEnd).border[side];
      };
      if (position.columnIndex === endColumnIndex) return borderOfColumn(endColumnIndex);
      return positionBefore.columnIndex === endColumnIndex
        ? borderOfColumn(cameFrom[endColumnIndex - area.leftColumnIndex] ?? endColumnIndex)
        : format.border[side];
    };
    let [left, right] = [borderAtEnd('left', endsOfTable.first), borderAtEnd('right', endsOfTable.last)];
    return left === format.border.left && right === format.border.right
      ? format
      : {
          ...format,
          border: {
            ...format.border,
            left,
            right,
          },
        };
  };
  let cellOf = readBefore((cell: CellId) => reads.cellOf(cell));
  let spilledCellOf = readBefore((cell: CellId) => reads.spilledCellOf(cell));
  let sheet = reads.listSheets().find((listed: SheetSummary) => listed.sheetId === sheetId);
  let movedSheet =
    sheet === undefined
      ? sheet
      : {
          ...sheet,
          columnEdges: createLineSizes(
            sheet.columnCount,
            Array.from(
              {
                length: sheet.columnCount,
              },
              (_, index) => ({
                firstIndex: index,
                count: 1,
                sizeInPixels: sheet.columnEdges.sizeOf(cameFrom[index - area.leftColumnIndex] ?? index),
              }),
            ),
            0,
          ),
        };
  let sheets = reads.listSheets().map((listed: SheetSummary) => (listed === sheet && movedSheet !== undefined ? movedSheet : listed));
  let moved: ReadsWithColumnsMoved = {
    layBefore,
    reads: {
      ...reads,
      listSheets: () => sheets,
      cellOf,
      spilledCellOf,
      cellOnShowIn: (cell: CellId) => cellOf(cell) ?? spilledCellOf(cell),
      formatOf,
      dropdownOf: (cell: CellId) => reads.dropdownOf(layBefore(cell)),
      columnIndexesOnShowIn(onSheetId: SheetId, rowIndex: number): number[] {
        let onShow = reads.columnIndexesOnShowIn(onSheetId, rowIndex);
        if (onSheetId !== sheetId || !isRowMoved(rowIndex)) return onShow;
        let isOnShow = new Set(onShow);
        let indexes = [
          ...onShow.filter((columnIndex: number) => !isInSpan(columnIndex, area.leftColumnIndex, area.columnCount)),
          ...cameFrom.flatMap(
            (columnIndex: number, offset: number) => (isOnShow.has(columnIndex) ? [area.leftColumnIndex + offset] : []),
          ),
        ];
        indexes.sort((a: number, b: number) => a - b);
        return indexes;
      },
    },
  };
  byKey.set(key, moved);
  return moved;
}
export function rowsInHandWithin<Row extends RowToRide>(
  rows: readonly Row[],
  room: Pick<PaneRect, 'left' | 'top'>,
  keyPrefix: string = '',
): RidingRow<Row>[] {
  let inHand: RidingRow<Row>[] = [];
  for (let row of rows) {
    let cells = row.cells
      .filter(({ isInHand }: Partial<Pick<CellToRide, 'isInHand'>> = {}) => isInHand)
      .map((cell: Row['cells'][number]) => cellRidingFrom(cell, room));
    if (cells.length > 0)
      inHand.push({
        ...row,
        key: keyPrefix + row.key,
        top: row.top - room.top,
        isActive: false,
        isFrozen: false,
        cells,
      });
  }
  return inHand;
}
export function columnsRidingOf<Row extends RowToRide>(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  { area, cameFrom, landsAt, count }: ColumnsOfTableMoving = {} as ColumnsOfTableMoving,
  drawn: DrawnUnderRidingColumns<Row>,
): ColumnsRiding<Row> | null {
  let { dragging, sheetId } = state;
  if (dragging?.kind !== 'movingColumnsOfTable') return null;
  let first = reads.positionOfCell(dragging.first);
  let [withinFirst, withinLast] = [reads.positionOfCell(dragging.within.first), reads.positionOfCell(dragging.within.last)];
  if (first === null || withinFirst === null || withinLast === null) return null;
  let { sheet } = drawn;
  let spansOf = (layout: GridLayout, leftColumnIndex: number, columnCount: number) =>
    rangeSpansOnScreen(
      {
        topRowIndex: area.topRowIndex,
        rowCount: area.rowCount,
        leftColumnIndex,
        columnCount,
      },
      state,
      layout,
      state,
    );
  let landing = spansOf(sheet, landsAt, count);
  let run = spansOf(sheet, withinFirst.columnIndex, withinLast.columnIndex - withinFirst.columnIndex + 1);
  let top = Math.max(landing.down.start, landing.down.showFrom);
  let room: PaneRect = {
    left: landing.across.start,
    top,
    width: landing.across.end - landing.across.start,
    height: (landing.down.end > landing.down.showTo ? landing.down.showTo + 16 : landing.down.end) - top,
  };
  let rows = rowsInHandWithin(drawn.rows, room);
  let topOfRow = new Map<number, number>();
  for (let { rowNumber, top: rowTop, height } of rows) {
    topOfRow.set(rowNumber - 1, rowTop);
    topOfRow.set(rowNumber, rowTop + height);
  }
  let lines: BorderPathDrawn[] = !reads.hasBorderLine(sheetId)
    ? []
    : buildBorderPaths({
        rows: {
          before: (rows[0]?.rowNumber ?? 1) - 2,
          indexes: rows.map(({ rowNumber }: Pick<RowToRide, 'rowNumber'> = {} as Pick<RowToRide, 'rowNumber'>) => rowNumber - 1),
          after: rows.at(-1)?.rowNumber ?? 0,
        },
        columns: {
          before: landsAt - 1,
          indexes: Array.from(
            {
              length: count,
            },
            (_, offset) => landsAt + offset,
          ).filter((columnIndex: number) => sheet.columnEdges.sizeOf(columnIndex) > 0),
          after: landsAt + count,
        },
        formatAt: ({ rowIndex, columnIndex }: CellPosition) => {
          let cell =
            isInSpan(rowIndex, area.topRowIndex, area.rowCount) && isInSpan(columnIndex, landsAt, count)
              ? drawn.reads.cellIdAt(sheetId, rowIndex, columnIndex)
              : null;
          return cell === null ? null : drawn.reads.formatOf(cell);
        },
        mergedAreas: [],
        leftOfColumn: (columnIndex: number) =>
          RIDING_BORDER_ROOM + sheet.columnEdges.startOf(columnIndex) - sheet.columnEdges.startOf(landsAt),
        topOfRow: (rowIndex: number) => RIDING_BORDER_ROOM + (topOfRow.get(rowIndex) ?? -1000),
      });
  let box: PaneRect = {
    left: -RIDING_BORDER_ROOM,
    top: -RIDING_BORDER_ROOM,
    width: room.width + 2 * RIDING_BORDER_ROOM,
    height: room.height + 2 * RIDING_BORDER_ROOM,
  };
  return {
    key: `${dragging.first.columnId} ${dragging.last.columnId}`,
    room,
    rows,
    borderLines:
      lines.length === 0
        ? []
        : [
            {
              key: 'riding',
              box,
              lines,
            },
          ],
    homeLeft: spansOf(layoutOfView(state, reads), first.columnIndex, count).across.start,
    leastLeft: run.across.start,
    endOfRun: run.across.end,
    gripFromLeft: dragging.grip.fromLeft,
    firstRowIndex: area.topRowIndex,
    lastRowIndex: area.topRowIndex + area.rowCount - 1,
    order: Array.from(
      {
        length: withinLast.columnIndex - withinFirst.columnIndex + 1,
      },
      (_, offset): ColumnInRidingOrder => {
        let columnIndex = withinFirst.columnIndex + offset;
        return {
          columnIndex,
          holdsCellsOf: cameFrom[columnIndex - area.leftColumnIndex] ?? columnIndex,
          left: spansOf(sheet, columnIndex, 1).across.start,
        };
      },
    ),
  };
}
export const readsWithColumnsMovedCache = new WeakMap<WorkbookReads, Map<string, ReadsWithColumnsMoved>>();
export const RIDING_BORDER_ROOM = 2;
export const cellRidingFrom = <Cell extends CellToRide>(cell: Cell, room: Pick<PaneRect, 'left'>): RidingCell<Cell> => ({
  ...cell,
  isInHand: false,
  elementId: null,
  isActive: false,
  isSelected: false,
  cornersOfTable: null,
  left: cell.left - room.left,
  textLeft: cell.textLeft - room.left,
  textLeftInWholeRow: cell.textLeftInWholeRow - room.left,
});
export const withKeptHeadersRiding = <Row extends RowToRide>(
  riding: ColumnsRiding<Row>,
  headersKept: readonly HeaderRowsKept<Row>[],
): ColumnsRiding<Row> => ({
  ...riding,
  rows: [...riding.rows, ...headersKept.flatMap((kept: HeaderRowsKept<Row>) => rowsInHandWithin(kept.rows, riding.room, 'kept '))],
});
