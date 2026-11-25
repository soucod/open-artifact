import { isInSpan } from './geometry.ts';
import { createLineSizes } from '../model/line-sizes.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { NO_OWN_COLLAPSING } from './line-runs.ts';
import { layoutOfView } from './layout.ts';
import { ROW_HEADER_WIDTH, oneLineRowHeight } from './cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT, hasRoomForText, textRoomInWidth } from './cell-metrics.ts';
import { mayRowsGrowInSheet, wrappedTextOfCell, rowGrowthsOfTexts, heightForPeopleInCell } from './wrapped-rows.ts';
import { buildBorderPaths } from './borders.ts';
import { checkboxCentreInCell } from '../chips/checkbox-presses.ts';
import type { RowId, SheetId } from '@open-artifact/sheets-core';
import type { PageState } from '../state/initial-state.ts';
import type { CellId, CellsByRow, FormatsGiven, RowSizing, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { LineSpan } from '../model/line-ids.ts';
import type { LineSizes, SizedRun } from '../model/line-sizes.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellDensity } from './cell-metrics-values.ts';
import type { GridLayout } from './layout.ts';
import type { BorderLinesInBox, BorderPathDrawn } from './moved-columns.ts';
import type { GridView } from './grid-view.ts';
import type { DrawnCell, DrawnRow } from './grid-drawing.tsx';
/** The rows and the columns of held cells that a copy of them is made of. */
export interface WindowOfHeldCells {
  rows: LineSpan;
  columns: LineSpan;
}
/** Cells being moved: where they are held from, and where they would land. */
export interface MoveOfHeldCells {
  held: CellArea;
  landing: CellArea;
}
/** The sheet the cells are moved on, laid out as in view. */
export interface PlaceOfHeldCells {
  sheetId: SheetId;
  layout: GridLayout;
}
/** The grid as drawn, which a copy of held cells is drawn from. */
export type GridViewDrawn = GridView;
/** A row of the grid as drawn. */
export type RowDrawn = DrawnRow;
/** A cell of the grid as drawn. */
export type CellDrawn = DrawnCell;
/** A filter button of the grid as drawn. */
export type FilterButtonDrawn = GridViewDrawn['filterButtons'][number];
/** How the grid is drawn for a state and its reads. */
export type DrawGridView = (state: PageState, reads: ReadsWithTextMeasurer) => GridViewDrawn;
/** A state and reads that show only the held cells, as they would land. */
export interface ViewOfHeldCells {
  reads: ReadsWithTextMeasurer;
  state: PageState;
}
/** A text of a cell that wraps, with the width it wraps in. */
export type WrappedTextInWidth = NonNullable<ReturnType<typeof wrappedTextOfCell>> & { widthInPixels: number };
/** A row whose cells are measured: which of its columns count, how wide each is, and whether its cells may be merged. */
export type RowOfCellsToMeasure = [
  rowIndex: number,
  isWanted: (columnIndex: number) => boolean,
  widthOfColumn: (columnIndex: number) => number,
  mayBeMerged: boolean,
];
/** The least height of a landing row, and the texts that may make it taller. */
export interface LandingRowNeeds {
  least: number;
  texts: WrappedTextInWidth[];
}
/** The held cells drawn in a window of their own, before their rows take the heights they would land with. */
export interface HeldCellsDrawn {
  rows: RowDrawn[];
  filterButtons: FilterButtonDrawn[];
  width: number;
  leftOfColumn: (columnIndex: number) => number;
}
/** A copy of held cells as drawn under the pointer: its rows, borders and filter buttons. */
export interface CopyOfHeldCells {
  rows: RowDrawn[];
  borderLines: BorderLinesInBox[];
  filterButtons: FilterButtonDrawn[];
  width: number;
  height: number;
}
/** Parts of copies of held cells, kept while the cells are moved so that they are not drawn again. */
export interface MovedCellsParts {
  byLanding: Map<string, CopyOfHeldCells | null>;
  across: Map<string, HeldCellsDrawn | null>;
  drawn: Map<string, CopyOfHeldCells>;
}
export function columnEdgesAtLanding(
  { columnEdges, columnCount }: Pick<GridLayout, 'columnEdges' | 'columnCount'>,
  sheetColumnEdges: LineSizes,
  columns: LineSpan,
  shift: number,
): LineSizes {
  let runs: SizedRun[] = [];
  for (let index = 0; index < columnCount; index += 1) {
    let size = isInSpan(index, columns.firstIndex, columns.count) ? columnEdges.sizeOf(index + shift) : sheetColumnEdges.sizeOf(index);
    let last = runs.at(-1);
    if (last?.sizeInPixels === size)
      runs[runs.length - 1] = {
        ...last,
        count: last.count + 1,
      };
    else
      runs.push({
        firstIndex: index,
        count: 1,
        sizeInPixels: size,
      });
  }
  return createLineSizes(columnCount, runs, 0);
}
export function viewOfHeldCells(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  place: PlaceOfHeldCells,
  { rows, columns }: WindowOfHeldCells = {} as WindowOfHeldCells,
  { held, landing }: MoveOfHeldCells = {} as MoveOfHeldCells,
): ViewOfHeldCells | null {
  let sheet = reads.listSheets().find(({ sheetId }: Pick<SheetSummary, 'sheetId'> = {} as Pick<SheetSummary, 'sheetId'>) => sheetId === place.sheetId);
  if (sheet === undefined) return null;
  let sheetAtLanding: SheetSummary = {
    ...sheet,
    columnEdges: columnEdgesAtLanding(place.layout, sheet.columnEdges, columns, landing.leftColumnIndex - held.leftColumnIndex),
    frozenRowCount: 0,
    frozenColumnCount: 0,
    rowGroups: [],
    columnGroups: [],
  };
  let sheets = reads.listSheets().map((listed: SheetSummary) => (listed === sheet ? sheetAtLanding : listed));
  let heldReads: ReadsWithTextMeasurer = {
    ...reads,
    listSheets: () => sheets,
    mergedAreaAt: () => null,
    mergedAreasIn: () => [],
    formatsGivenIn: () => NO_FORMATS_GIVEN_TO_COPY,
    whereTextWraps: () => [],
    cellsWithListsIn: () => NO_CELLS_WITH_LISTS,
    placementsIn: () => [],
    columnIndexesOnShowIn: (sheetId: SheetId, rowIndex: number) =>
      reads.columnIndexesOnShowIn(sheetId, rowIndex).filter((columnIndex: number) => isInArea(held, rowIndex, columnIndex)),
    formatOf(cell: CellId) {
      let position = reads.positionOfCell(cell);
      return position !== null && isInArea(held, position.rowIndex, position.columnIndex) ? reads.formatOf(cell) : DEFAULT_CELL_FORMAT;
    },
  };
  let heldState: PageState = {
    ...state,
    dragging: null,
    selectionsOfOthers: [],
    changesByAgent: [],
    marksOfImport: null,
    sidePane: null,
    ownCollapsing: NO_OWN_COLLAPSING,
    rowsOutOfViewByOwnFilters: new Map<SheetId, Set<RowId>>(),
  };
  let { rowEdges, columnEdges } = layoutOfView(heldState, heldReads);
  let [scrollLeft, scrollTop] = [columnEdges.startOf(columns.firstIndex), rowEdges.startOf(rows.firstIndex)];
  return {
    reads: heldReads,
    state: {
      ...heldState,
      scrollLeft,
      scrollTop,
      gridWidth: ROW_HEADER_WIDTH + columnEdges.startOf(columns.firstIndex + columns.count) - scrollLeft + COPY_ROOM_AT_RIGHT,
      gridHeight: COLUMN_HEADER_HEIGHT + rowEdges.startOf(rows.firstIndex + rows.count) - scrollTop,
    },
  };
}
export function heightsOfLandingRows(
  rows: LineSpan,
  { held, landing }: MoveOfHeldCells = {} as MoveOfHeldCells,
  { sheetId, layout: { rowEdges, columnEdges, columnCount } }: PlaceOfHeldCells = {} as PlaceOfHeldCells,
  reads: ReadsWithTextMeasurer,
  density: CellDensity,
): number[] {
  let [rowShift, columnShift] = [landing.topRowIndex - held.topRowIndex, landing.leftColumnIndex - held.leftColumnIndex];
  let sizing = reads.rowSizingOf(sheetId);
  let sizingOfRow = (rowIndex: number): RowSizing | undefined =>
    sizing.find(({ firstIndex, count }: LineSpan = {} as LineSpan) => isInSpan(rowIndex, firstIndex, count));
  let defaultSize = DEFAULT_CELL_FORMAT.font.size;
  let largestFontSize = (rowIndex: number, isWanted: (columnIndex: number) => boolean): number => {
    if ((sizingOfRow(rowIndex)?.largestFontSizeInPoints ?? defaultSize) <= defaultSize) return defaultSize;
    let largest = defaultSize;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      let cell = isWanted(columnIndex) ? reads.cellIdAt(sheetId, rowIndex, columnIndex) : null;
      if (cell !== null) largest = Math.max(largest, reads.formatOf(cell).font.size);
    }
    return largest;
  };
  let mayRowsGrow = mayRowsGrowInSheet(sheetId, reads);
  let wrappedTextsOf = (
    rowIndex: number,
    isWanted: (columnIndex: number) => boolean,
    widthOfColumn: (columnIndex: number) => number,
    mayBeMerged: boolean,
  ): WrappedTextInWidth[] =>
    !mayRowsGrow
      ? []
      : reads
          .columnIndexesOnShowIn(sheetId, rowIndex)
          .filter(isWanted)
          .flatMap((columnIndex: number): WrappedTextInWidth[] => {
            let cell = reads.cellIdAt(sheetId, rowIndex, columnIndex);
            if (cell === null) return [];
            let isMerged =
              mayBeMerged &&
              reads.mergedAreaAt(sheetId, {
                rowIndex,
                columnIndex,
              }) !== null;
            let wrapped = wrappedTextOfCell(cell, isMerged, reads);
            let width = widthOfColumn(columnIndex);
            return wrapped === null || !hasRoomForText(width, wrapped.font.size)
              ? []
              : [
                  {
                    ...wrapped,
                    widthInPixels: textRoomInWidth(width),
                  },
                ];
          });
  let heightForPeopleOf = (...[rowIndex, isWanted, widthOfColumn, mayBeMerged]: RowOfCellsToMeasure): number =>
    !mayRowsGrow
      ? 0
      : Math.max(
          0,
          ...reads
            .columnIndexesOnShowIn(sheetId, rowIndex)
            .filter(isWanted)
            .map((columnIndex: number): number => {
              let cell = reads.cellIdAt(sheetId, rowIndex, columnIndex);
              let isMerged =
                mayBeMerged &&
                reads.mergedAreaAt(sheetId, {
                  rowIndex,
                  columnIndex,
                }) !== null;
              return cell === null || isMerged ? 0 : heightForPeopleInCell(cell, widthOfColumn(columnIndex), reads, density);
            }),
        );
  let isHeldColumn = (columnIndex: number): boolean => isInSpan(columnIndex, held.leftColumnIndex, held.columnCount);
  let landingRows = indexesOfSpan(rows).map((rowIndex: number): LandingRowNeeds => {
    let landingRowIndex = rowIndex + rowShift;
    if (rowEdges.sizeOf(landingRowIndex) === 0)
      return {
        least: 0,
        texts: [],
      };
    let isLeftInPlace = (columnIndex: number): boolean =>
      !isInArea(held, landingRowIndex, columnIndex) && !isInArea(landing, landingRowIndex, columnIndex);
    let fontSize = () => Math.max(largestFontSize(rowIndex, isHeldColumn), largestFontSize(landingRowIndex, isLeftInPlace));
    let heldRow: RowOfCellsToMeasure = [
      rowIndex,
      isHeldColumn,
      (columnIndex: number) => columnEdges.sizeOf(columnIndex + columnShift),
      false,
    ];
    let landingRow: RowOfCellsToMeasure = [landingRowIndex, isLeftInPlace, (columnIndex: number) => columnEdges.sizeOf(columnIndex), true];
    return {
      least: Math.max(
        sizingOfRow(landingRowIndex)?.heightInPixels ?? oneLineRowHeight(fontSize(), density),
        heightForPeopleOf(...heldRow),
        heightForPeopleOf(...landingRow),
      ),
      texts: [...wrappedTextsOf(...heldRow), ...wrappedTextsOf(...landingRow)],
    };
  });
  let growths: number[] = rowGrowthsOfTexts(
    landingRows.flatMap(({ texts }: Pick<LandingRowNeeds, 'texts'> = {} as Pick<LandingRowNeeds, 'texts'>) => texts),
    reads,
    density,
  );
  let measuredSoFar = 0;
  return landingRows.map(
    ({ least, texts }: LandingRowNeeds = {} as LandingRowNeeds) => (
      (measuredSoFar += texts.length),
      Math.max(least, ...growths.slice(measuredSoFar - texts.length, measuredSoFar))
    ),
  );
}
export function drawnHeldCells(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  place: PlaceOfHeldCells,
  window: WindowOfHeldCells,
  move: MoveOfHeldCells,
  viewOf: DrawGridView,
): HeldCellsDrawn | null {
  let held = viewOfHeldCells(state, reads, place, window, move);
  if (held === null) return null;
  let { rows, filterButtons } = viewOf(held.state, held.reads);
  let isInWindow = (rowIndex: number, columnIndex: number): boolean =>
    isInSpan(rowIndex, window.rows.firstIndex, window.rows.count) && isInSpan(columnIndex, window.columns.firstIndex, window.columns.count);
  let { columnEdges } = layoutOfView(held.state, held.reads);
  return {
    rows: rows.flatMap((row: RowDrawn): RowDrawn[] => {
      let cells = row.cells.filter((cell: CellDrawn) => cell.width > 0 && isInWindow(row.rowNumber - 1, cell.columnNumber - 1));
      return cells.length === 0
        ? []
        : [
            {
              ...row,
              isActive: false,
              isFrozen: false,
              cells: cells.map(cellOfCopy),
            },
          ];
    }),
    filterButtons: filterButtons.filter(
      ({ headerKept, heldInView, columnIndex, cell }: FilterButtonDrawn = {} as FilterButtonDrawn) =>
        headerKept === null && heldInView === null && cell.width > 0 && isInSpan(columnIndex, window.columns.firstIndex, window.columns.count),
    ),
    width: held.state.gridWidth - ROW_HEADER_WIDTH - COPY_ROOM_AT_RIGHT,
    leftOfColumn: (columnIndex: number) => columnEdges.startOf(columnIndex) - held.state.scrollLeft,
  };
}
export function copyOfHeldCells(
  drawn: HeldCellsDrawn,
  heights: readonly number[],
  window: WindowOfHeldCells,
  held: CellArea,
  sheetId: SheetId,
  reads: WorkbookReads,
): CopyOfHeldCells {
  let tops = [0];
  for (let height of heights) tops.push((tops.at(-1) ?? 0) + height);
  let topOfRow = (rowIndex: number): number => tops[rowIndex - window.rows.firstIndex] ?? 0;
  let heightOfRow = (rowIndex: number): number => heights[rowIndex - window.rows.firstIndex] ?? 0;
  let rows = drawn.rows.filter(({ rowNumber }: Pick<RowDrawn, 'rowNumber'> = {} as Pick<RowDrawn, 'rowNumber'>) => heightOfRow(rowNumber - 1) > 0);
  let lines: BorderPathDrawn[] = !reads.hasBorderLine(sheetId)
    ? []
    : buildBorderPaths({
        rows: {
          before: window.rows.firstIndex - 1,
          indexes: rows.map(({ rowNumber }: Pick<RowDrawn, 'rowNumber'> = {} as Pick<RowDrawn, 'rowNumber'>) => rowNumber - 1),
          after: window.rows.firstIndex + window.rows.count,
        },
        columns: {
          before: window.columns.firstIndex - 1,
          indexes: indexesOfSpan(window.columns).filter(
            (columnIndex: number) => drawn.leftOfColumn(columnIndex + 1) > drawn.leftOfColumn(columnIndex),
          ),
          after: window.columns.firstIndex + window.columns.count,
        },
        formatAt: ({ rowIndex, columnIndex }: CellPosition) => {
          let cell = isInArea(held, rowIndex, columnIndex) ? reads.cellIdAt(sheetId, rowIndex, columnIndex) : null;
          return cell === null ? null : reads.formatOf(cell);
        },
        mergedAreas: [],
        leftOfColumn: (columnIndex: number) => COPY_BORDER_ROOM + drawn.leftOfColumn(columnIndex),
        topOfRow: (rowIndex: number) => COPY_BORDER_ROOM + topOfRow(rowIndex),
      });
  let rowAtHeight = (row: RowDrawn): RowDrawn => {
    let [top, height] = [topOfRow(row.rowNumber - 1), heightOfRow(row.rowNumber - 1)];
    return {
      ...row,
      top,
      height,
      outOfViewAbove: 0,
      outOfViewBelow: 0,
      cells: row.cells.map(cellAtHeight(height)),
    };
  };
  let height = tops.at(-1) ?? 0;
  return {
    rows: rows.map(rowAtHeight),
    borderLines:
      lines.length === 0
        ? []
        : [
            {
              key: 'copy',
              box: {
                left: -COPY_BORDER_ROOM,
                top: -COPY_BORDER_ROOM,
                width: drawn.width + 2 * COPY_BORDER_ROOM,
                height: height + 2 * COPY_BORDER_ROOM,
              },
              lines,
            },
          ],
    filterButtons: drawn.filterButtons.flatMap((button: FilterButtonDrawn): FilterButtonDrawn[] => {
      let row = drawn.rows.find(({ top, height: rowHeight }: Pick<RowDrawn, 'top' | 'height'> = {} as Pick<RowDrawn, 'top' | 'height'>) => isInSpan(button.cell.top, top, rowHeight));
      return row === undefined || heightOfRow(row.rowNumber - 1) === 0 ? [] : [filterButtonMovedDown(button, topOfRow(row.rowNumber - 1) - row.top)];
    }),
    width: drawn.width,
    height,
  };
}
export function keptOrMade<Part>(kept: Map<string, Part>, key: string, make: () => Part): Part {
  let found = kept.get(key);
  if (found !== undefined) return found;
  let made = make();
  let [oldestKey] = kept.keys();
  if (kept.size >= MOST_PARTS_KEPT && oldestKey !== undefined) kept.delete(oldestKey);
  kept.set(key, made);
  return made;
}
export function movedCellsCopy(
  parts: MovedCellsParts,
  window: WindowOfHeldCells,
  move: MoveOfHeldCells,
  place: PlaceOfHeldCells,
  state: PageState,
  reads: ReadsWithTextMeasurer,
  viewOf: DrawGridView,
): CopyOfHeldCells | null {
  let windowKey = `${window.rows.firstIndex} ${window.rows.count} ${window.columns.firstIndex} ${window.columns.count}`;
  return keptOrMade(parts.byLanding, `${windowKey} ${move.landing.topRowIndex} ${move.landing.leftColumnIndex}`, (): CopyOfHeldCells | null => {
    let columnShift = move.landing.leftColumnIndex - move.held.leftColumnIndex;
    let widths = indexesOfSpan(window.columns).map(
      (columnIndex: number) => place.layout.columnEdges.sizeOf(columnIndex + columnShift),
    );
    let acrossKey = `${windowKey} ${widths.join(' ')}`;
    let drawn = keptOrMade(parts.across, acrossKey, () => drawnHeldCells(state, reads, place, window, move, viewOf));
    if (drawn === null) return null;
    let heights = heightsOfLandingRows(window.rows, move, place, reads, state.density);
    return keptOrMade(
      parts.drawn,
      `${acrossKey} ${heights.join(' ')}`,
      () => copyOfHeldCells(drawn, heights, window, move.held, place.sheetId, reads),
    );
  });
}
export function windowOfLines(lines: LineSpan, inSight: LineSpan): LineSpan {
  if (lines.count <= MOST_LINES_UNWINDOWED) return lines;
  let firstStep = Math.floor((inSight.firstIndex - lines.firstIndex) / WINDOW_STEP) - 1;
  let lastStep = Math.ceil((inSight.firstIndex + inSight.count - lines.firstIndex) / WINDOW_STEP) + 1;
  let firstIndex = lines.firstIndex + Math.max(0, firstStep * WINDOW_STEP);
  let end = Math.min(lines.firstIndex + lines.count, lines.firstIndex + lastStep * WINDOW_STEP);
  return {
    firstIndex,
    count: end - firstIndex,
  };
}
export const NO_CELLS_WITH_LISTS: CellsByRow = new Map();
export const isInArea = (area: CellArea, rowIndex: number, columnIndex: number): boolean =>
  isInSpan(rowIndex, area.topRowIndex, area.rowCount) && isInSpan(columnIndex, area.leftColumnIndex, area.columnCount);
export const indexesOfSpan = ({ firstIndex, count }: LineSpan): number[] =>
  Array.from(
    {
      length: count,
    },
    (_, offset) => firstIndex + offset,
  );
export const COPY_ROOM_AT_RIGHT = 48;
export const NO_FORMATS_GIVEN_TO_COPY: FormatsGiven = {
  notWorkedOut: null,
  formats: [],
  colorScales: [],
  matches: [],
};
export const COPY_BORDER_ROOM = 2;
export const cellOfCopy = (cell: CellDrawn): CellDrawn => ({
  ...cell,
  elementId: null,
  isActive: false,
  isSelected: false,
});
export const cellAtHeight =
  (height: number) =>
  (cell: CellDrawn): CellDrawn => {
    let centre = checkboxCentreInCell(cell.width, height, cell.hiddenByBorderAtFoot);
    let checkbox =
      cell.checkbox === null
        ? null
        : {
            ...cell.checkbox,
            middleFromLeft: centre.x,
            middleFromTop: centre.y,
          };
    return {
      ...cell,
      height,
      checkbox,
    };
  };
export const filterButtonMovedDown = (button: FilterButtonDrawn, by: number): FilterButtonDrawn => ({
  ...button,
  isInActiveCell: false,
  isListOpen: false,
  top: button.top + by,
  cell: {
    ...button.cell,
    top: button.cell.top + by,
  },
});
export const newMovedCellsParts = (): MovedCellsParts => ({
  byLanding: new Map(),
  across: new Map(),
  drawn: new Map(),
});
export const MOST_PARTS_KEPT = 32;
export const WINDOW_STEP = 16;
export const MOST_LINES_UNWINDOWED = 96;
