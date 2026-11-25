import {
  hitTestGrid,
  columnRunSpanOnScreen,
  rowRunSpanOnScreen,
  isInSpan,
  frozenColumnsWidth,
  frozenRowsHeight,
  rangeSpansOnScreen,
  cellsAreaWidth,
} from '../grid/geometry.ts';
import { ROW_HEADER_WIDTH, firstLineHeight } from '../grid/cell-metrics-values.ts';
import { areaOfFilteredTable } from './finding.ts';
import { shownLineAtOrAfter, shownLineAtOrBefore } from '../model/line-sizes.ts';
import { FILTER_BUTTON_SIZE, filterButtonsOfTable, ROOM_AT_TABLE_END_FOR_FILTER_BUTTONS, FILTER_BUTTON_GAP } from './filter-buttons-place.ts';
import { layoutOfView } from '../grid/layout.ts';
import { drawnOwnFiltersOfSheet, ownFiltersOfSheet, ownFilterNotDrawnYet } from './own-filters.ts';
import { tablesToOutline } from './tables-in-view.ts';
import { flattenLineBreaks } from '../grid/text-overflow.ts';
import { textRoomPastPadding, cellPaddingBeside } from '../grid/cell-metrics.ts';
import type { ColumnId, RowId, SheetId, TableOfASheet, VerticalAlignment } from '@open-artifact/sheets-core';
import type { WorkbookReads } from '../model/workbook.ts';
import type { FontToMeasure, ReadsWithTextMeasurer, TextMeasurer } from '../state/controller.ts';
import type { PageState } from '../state/initial-state.ts';
import type { OwnFilter } from './own-filters.ts';
import type { CellArea } from '../selection/model.ts';
import type { LineSpan } from '../model/line-ids.ts';
import type { GridLayout } from '../grid/layout.ts';
import type { AreaSpansOnScreen, GridPoint, PaneRect, SpanOnScreen } from '../grid/geometry.ts';
import type { StickyHeaderInView, StuckHeader } from '../grid/sticky-headers.ts';
import type { FadingBox, GroundUnderButton } from '../grid/grid-drawing.tsx';
import type { PaintPair } from '../grid/cell-drawing.tsx';
import type { RuleColumn } from '../messages/conditional-format.ts';
import type { OutlinableTable } from './tables-in-view.ts';
/** A column under a filter button held in view, and the part of it the button covers. */
export interface ColumnUnderHeldButton {
  left: number;
  width: number;
  columnIndex: number;
}
/** A filter of the page's own that is drawn, with the row its buttons are on. */
export interface OwnFilterWithButtons extends OwnFilter {
  rowIndex: number;
  /** Only a table found in sight has its columns spanned. */
  columnsOfFound?: undefined;
}
/** A table found in sight, with the one button to filter it by on the last row of its header. */
export interface FoundTableWithButton {
  key: string;
  table: { sheetId: SheetId; header: TableOfASheet['headerRows'] };
  columns: { c: ColumnId; name: null }[];
  filter: null;
  columnsOfFound: LineSpan;
  rowIndex: number;
}
/** A table whose header row has filter buttons. */
export type TableWithFilterButtons = OwnFilterWithButtons | FoundTableWithButton;
/** The room a header cell has beside its filter button: its width, and the room its text keeps at its left. */
export interface RoomOfHeaderCell {
  cellWidth: number;
  clearAtLeft: number;
}
/** The filter button a point is on: its table, and its column. */
export interface FilterButtonAt {
  tableKey: string;
  c: ColumnId;
}
/** A side of a table's outline cut off by the edge of the panes it is drawn in. */
export type CutSideOfTable = 'left' | 'top' | 'right' | 'foot';
/** A table's area by the lines shown at its edges, and the sides of it cut off. */
interface TableBoxInLines {
  top: number;
  bottom: number;
  left: number;
  right: number;
  cut: CutSideOfTable[];
}
/** The rows a table spans, and the columns from the shown column before it to its last one. */
interface TableColumnLines {
  topRowIndex: number;
  rowCount: number;
  first: number;
  count: number;
}
/** A column of a table to filter, where it is, and where it is on screen. */
export interface ColumnSpanOfId {
  columnIndex: number;
  across: SpanOnScreen;
}
/** How the text of a header cell sits, which the filter button beside it lines up with. */
export interface TextLookOfHeaderCell {
  fontSizeInPoints: number;
  isAt: VerticalAlignment;
  hiddenByBorderAtFoot: number;
}
/** How a header cell under a filter button looks, as the button takes its colors from it. */
export interface LooksUnderFilterButton {
  text: TextLookOfHeaderCell;
  ink: PaintPair | null;
  ground: string | PaintPair | null;
  groundOverText: string | PaintPair;
  givesWayToText: boolean;
  isInActiveCell: boolean;
  atRest: PaintPair | null;
}
/** The space around a filter button kept clear of anything else, on each side. */
export interface ClearAroundButton {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
/** A filter button placed in a header row: its table, row and column, where it is, and whether its list is open. */
export interface PlacedFilterButton {
  tableKey: string;
  r: RowId;
  isOfFoundTable: boolean;
  c: ColumnId;
  columnIndex: number;
  column: RuleColumn;
  left: number;
  top: number;
  clearAt: ClearAroundButton;
  cell: PaneRect;
  isOn: boolean;
  isListOpen: boolean;
  heldInView: FadingBox | null;
}
/** A filter button as the grid draws it: placed, with the looks of the cell under it and the header it is kept in. */
export interface FilterButtonInView extends PlacedFilterButton, Omit<LooksUnderFilterButton, 'text' | 'groundOverText'> {
  headerKept: string | null;
  groundsWhereHeld: GroundUnderButton[];
}
/** Tells how a header cell looks, by its row and column. */
export type LooksOfHeaderCell = (rowIndex: number, columnIndex: number) => LooksUnderFilterButton;
interface TablesWithButtonsCached {
  reads: ReadsWithTextMeasurer;
  tables: TableWithFilterButtons[];
}
export function columnsUnderHeldButton(
  heldInView: Pick<FadingBox, 'left' | 'width'> | null,
  view: PageState,
  layout: GridLayout,
): ColumnUnderHeldButton[] {
  let columns: ColumnUnderHeldButton[] = [];
  let end = heldInView === null ? 0 : heldInView.left + heldInView.width;
  for (let left = heldInView?.left ?? 0; left < end; ) {
    let hit = hitTestGrid(
      {
        x: ROW_HEADER_WIDTH + left + 0.5,
        y: 0,
      },
      view,
      layout,
    );
    if (hit?.kind !== 'columnHeader') break;
    let { columnIndex } = hit;
    let columnSpan = columnRunSpanOnScreen(
      {
        firstIndex: columnIndex,
        count: 1,
      },
      view,
      layout,
      view,
    );
    let width = Math.min(end, columnSpan.end) - left;
    if (width <= 0) break;
    columns.push({
      left,
      width,
      columnIndex,
    });
    left += width;
  }
  return columns;
}
export function filterButtonRowIndex(
  reads: WorkbookReads,
  ownFilter: OwnFilter,
  { rowEdges, rowCount }: Pick<GridLayout, 'rowEdges' | 'rowCount'>,
): number | null {
  let area = areaOfFilteredTable(reads, ownFilter);
  if (area === null) return null;
  let rowIndex = shownLineAtOrAfter(rowEdges, area.rowIndexOfButtons);
  return rowIndex < rowCount ? rowIndex : null;
}
export function lastWideColumnOfFoundTable({ area }: Pick<OutlinableTable, 'area'>, { columnEdges }: Pick<GridLayout, 'columnEdges'>): number {
  let leftColumnIndex = area.leftColumnIndex;
  for (let columnIndex = leftColumnIndex + area.columnCount - 1; columnIndex > leftColumnIndex; columnIndex -= 1)
    if (columnEdges.sizeOf(columnIndex) >= FILTER_BUTTON_SIZE) return columnIndex;
  return leftColumnIndex;
}
export function tablesWithFilterButtons(view: PageState, reads: ReadsWithTextMeasurer): TableWithFilterButtons[] {
  let cached = tablesWithButtonsCache.get(view);
  if (cached?.reads === reads) return cached.tables;
  let { sheetId } = view;
  let layout = layoutOfView(view, reads);
  let ownFilterTables = drawnOwnFiltersOfSheet(view, sheetId).flatMap((ownFilter: OwnFilter): OwnFilterWithButtons[] => {
    let rowIndex = filterButtonRowIndex(reads, ownFilter, layout);
    return rowIndex === null
      ? []
      : [
          {
            ...ownFilter,
            rowIndex,
          },
        ];
  });
  let foundTables = tablesToOutline(view, reads).flatMap((foundTable): FoundTableWithButton[] => {
    let { key, area, rowCountOfHeader } = foundTable;
    let table = {
      sheetId,
      header: foundTable.table.headerRows,
    };
    let rowIndex = area.topRowIndex + rowCountOfHeader - 1;
    let cellId = reads.cellIdAt(sheetId, rowIndex, lastWideColumnOfFoundTable(foundTable, layout));
    if (shownLineAtOrAfter(layout.rowEdges, rowIndex) !== rowIndex || cellId === null) return [];
    let columns = [
      {
        c: cellId.columnId,
        name: null,
      },
    ];
    let columnsOfFound = {
      firstIndex: area.leftColumnIndex,
      count: area.columnCount,
    };
    return [
      {
        key,
        table,
        columns,
        filter: null,
        columnsOfFound,
        rowIndex,
      },
    ];
  });
  let tables: TableWithFilterButtons[] = [...ownFilterTables, ...foundTables];
  tablesWithButtonsCache.set(view, {
    reads,
    tables,
  });
  return tables;
}
export function rowSpanInStuckHeader(
  stuckHeader: Pick<StuckHeader, 'top' | 'topInSheet' | 'showFrom' | 'height'>,
  rowIndex: number,
  { rowEdges }: Pick<GridLayout, 'rowEdges'>,
): SpanOnScreen {
  let start = stuckHeader.top + rowEdges.startOf(rowIndex) - stuckHeader.topInSheet;
  return {
    start,
    end: start + rowEdges.startOf(rowIndex + 1) - rowEdges.startOf(rowIndex),
    showFrom: stuckHeader.showFrom,
    showTo: stuckHeader.top + stuckHeader.height,
    isEndUnderFrozenLines: false,
  };
}
export function doesHeaderTextWrapBesideButton(
  textMeasurer: TextMeasurer,
  cellText: string,
  font: FontToMeasure,
  { cellWidth, clearAtLeft }: RoomOfHeaderCell,
): boolean {
  let flatText = flattenLineBreaks(cellText);
  let textRoom = textRoomPastPadding(cellWidth - filterButtonRoomInCell(cellWidth)) + (cellPaddingBeside('comfortable') - clearAtLeft);
  let textWidth = textMeasurer.widthOfCharacters(flatText, font);
  if (firstLineHeight(font.size) > FILTER_BUTTON_SIZE || textWidth <= textRoom || textWidth > textRoomPastPadding(cellWidth)) return false;
  let [lineCount = 1] = textMeasurer.lineCountsOfWrappedTexts([
    {
      text: flatText,
      font,
      widthInPixels: textRoom,
    },
  ]);
  return lineCount > 1;
}
export function filterButtonAtPoint(
  point: GridPoint,
  { body, filterButtons }: { body: Pick<PaneRect, 'left' | 'top'>; filterButtons: readonly Pick<PlacedFilterButton, 'tableKey' | 'c' | 'cell'>[] },
): FilterButtonAt | null {
  let [x, y] = [point.x - body.left, point.y - body.top];
  let match = filterButtons.find(
    ({ cell }) => x >= cell.left && x < cell.left + cell.width && y >= cell.top && y < cell.top + cell.height,
  );
  return match === undefined
    ? null
    : {
        tableKey: match.tableKey,
        c: match.c,
      };
}
export function makeHasFilterButton(view: PageState, reads: ReadsWithTextMeasurer, layout: GridLayout): (rowIndex: number, columnId: ColumnId | null) => boolean {
  let tables = tablesWithFilterButtons(view, reads);
  if (tables.length === 0) return matchesNoCell;
  let columnIdsByRow = new Map<number, Set<ColumnId | null>>();
  for (let table of tables) {
    let { rowIndex } = table;
    let { start, end } = rowRunSpanOnScreen(
      {
        firstIndex: rowIndex,
        count: 1,
      },
      view,
      layout,
      view,
    );
    if (end - start < FILTER_BUTTON_SIZE) continue;
    let columnIds = columnIdsByRow.get(rowIndex) ?? new Set<ColumnId | null>();
    for (let { c: columnId } of table.columns) columnIds.add(columnId);
    columnIdsByRow.set(rowIndex, columnIds);
  }
  return (rowIndex: number, columnId: ColumnId | null) => columnIdsByRow.get(rowIndex)?.has(columnId) === true;
}
export function makeIsFilterHeaderArea(view: PageState, reads: ReadsWithTextMeasurer, layout: GridLayout): (area: CellArea) => boolean {
  let hasFilterButton = makeHasFilterButton(view, reads, layout);
  let columnIndexesByRow = new Map<number, Set<number>>();
  for (let ownFilter of drawnOwnFiltersOfSheet(view, view.sheetId)) {
    let rowIndex = areaOfFilteredTable(reads, ownFilter)?.rowIndexOfButtons;
    if (rowIndex === undefined) continue;
    let columnIndexes = columnIndexesByRow.get(rowIndex) ?? new Set<number>();
    for (let { c: columnId } of ownFilter.columns) {
      let columnIndex = hasFilterButton(rowIndex, columnId) ? reads.columnIndexOf(view.sheetId, columnId) : null;
      if (columnIndex !== null) columnIndexes.add(columnIndex);
    }
    columnIndexesByRow.set(rowIndex, columnIndexes);
  }
  return ({ topRowIndex, leftColumnIndex, rowCount, columnCount }: CellArea) => {
    for (let [rowIndex, columnIndexes] of columnIndexesByRow) {
      if (!isInSpan(rowIndex, topRowIndex, rowCount)) continue;
      for (let columnIndex = leftColumnIndex; columnIndex < leftColumnIndex + columnCount; columnIndex += 1)
        if (columnIndexes.has(columnIndex)) return true;
    }
    return false;
  };
}
export function makeIsColumnLineInTable(
  view: PageState,
  reads: WorkbookReads,
  { columnEdges }: Pick<GridLayout, 'columnEdges'>,
  foundTables: readonly Pick<OutlinableTable, 'area'>[],
): (rowIndex: number, columnIndex: number) => boolean {
  let spans = [
    ...ownFiltersOfSheet(view, view.sheetId).map((ownFilter: OwnFilter) => areaOfFilteredTable(reads, ownFilter)),
    ...foundTables.map(({ area }) => area),
  ].flatMap((area): TableColumnLines[] => {
    if (area === null) return [];
    let { topRowIndex, rowCount, leftColumnIndex, columnCount } = area;
    let first = shownLineAtOrBefore(columnEdges, leftColumnIndex - 1);
    if (shownLineAtOrBefore(columnEdges, leftColumnIndex + columnCount - 1) === first) return [];
    return [
      {
        topRowIndex,
        rowCount,
        first,
        count: leftColumnIndex + columnCount - first,
      },
    ];
  });
  if (spans.length === 0) return matchesNoCell;
  return (rowIndex: number, columnIndex: number) =>
    spans.some(
      ({ topRowIndex, rowCount, first, count }) =>
        isInSpan(rowIndex, topRowIndex, rowCount) && isInSpan(columnIndex, first, count),
    );
}
export function makeIsInTable(
  view: PageState,
  reads: WorkbookReads,
  foundTables: readonly Pick<OutlinableTable, 'area'>[],
): (area: Pick<CellArea, 'topRowIndex' | 'leftColumnIndex'>) => boolean {
  let areas = [
    ...ownFiltersOfSheet(view, view.sheetId).map((ownFilter: OwnFilter) => areaOfFilteredTable(reads, ownFilter)),
    ...foundTables.map(({ area }) => area),
  ].filter((area) => area !== null);
  return ({ topRowIndex, leftColumnIndex }: Pick<CellArea, 'topRowIndex' | 'leftColumnIndex'>) =>
    areas.some(
      (area) =>
        isInSpan(topRowIndex, area.topRowIndex, area.rowCount) && isInSpan(leftColumnIndex, area.leftColumnIndex, area.columnCount),
    );
}
export function makeTableEdgeColumnsOfRow(
  view: PageState,
  reads: WorkbookReads,
  { columnEdges }: Pick<GridLayout, 'columnEdges'>,
  foundTables: readonly Pick<OutlinableTable, 'area'>[],
): (rowIndex: number) => number[] {
  let areas = [
    ...ownFiltersOfSheet(view, view.sheetId).map((ownFilter: OwnFilter) => areaOfFilteredTable(reads, ownFilter)),
    ...foundTables.map(({ area }) => area),
  ]
    .filter((area) => area !== null)
    .filter(
      ({ leftColumnIndex, columnCount }) =>
        shownLineAtOrAfter(columnEdges, leftColumnIndex) < leftColumnIndex + columnCount,
    );
  if (areas.length === 0) return () => NO_TABLE_EDGE_COLUMNS;
  return (rowIndex: number) =>
    areas.flatMap(
      ({ topRowIndex, rowCount, leftColumnIndex, columnCount }) =>
        isInSpan(rowIndex, topRowIndex, rowCount) ? [leftColumnIndex - 1, leftColumnIndex + columnCount - 1] : [],
    );
}
export function cutSidesOfTableSpans({ across, down }: AreaSpansOnScreen, layout: GridLayout): CutSideOfTable[] {
  let [frozenWidth, frozenHeight] = [frozenColumnsWidth(layout), frozenRowsHeight(layout)];
  return (
    [
      isSpanCutAtStart(across) ? 'left' : null,
      isSpanCutAtStart(down) ? 'top' : null,
      isSpanCutAtEnd(across, frozenWidth) ? 'right' : null,
      isSpanCutAtEnd(down, frozenHeight) ? 'foot' : null,
    ] as const
  ).filter((side) => side !== null);
}
export function makeCornersOfTable(
  view: PageState,
  reads: WorkbookReads,
  layout: GridLayout,
  foundTables: readonly Pick<OutlinableTable, 'area'>[],
): (area: CellArea) => string | null {
  let { rowEdges, columnEdges } = layout;
  let boxes = [
    ...ownFiltersOfSheet(view, view.sheetId).map((ownFilter: OwnFilter) => areaOfFilteredTable(reads, ownFilter)),
    ...foundTables.map(({ area }) => area),
  ].flatMap((area): TableBoxInLines[] => {
    if (area === null) return [];
    let topLine = shownLineAtOrAfter(rowEdges, area.topRowIndex);
    let bottomLine = shownLineAtOrBefore(rowEdges, area.topRowIndex + area.rowCount - 1);
    let leftLine = shownLineAtOrAfter(columnEdges, area.leftColumnIndex);
    let rightLine = shownLineAtOrBefore(columnEdges, area.leftColumnIndex + area.columnCount - 1);
    if (topLine > bottomLine || leftLine > rightLine) return [];
    return [
      {
        top: topLine,
        bottom: bottomLine,
        left: leftLine,
        right: rightLine,
        cut: cutSidesOfTableSpans(rangeSpansOnScreen(area, view, layout, view), layout),
      },
    ];
  });
  if (boxes.length === 0) return noTableCorners;
  return ({ topRowIndex, rowCount, leftColumnIndex, columnCount }: CellArea) => {
    for (let { top: topLine, bottom: bottomLine, left: leftLine, right: rightLine, cut } of boxes) {
      let hasTop = isInSpan(topLine, topRowIndex, rowCount);
      let hasBottom = isInSpan(bottomLine, topRowIndex, rowCount);
      if (!hasTop && !hasBottom) continue;
      let hasLeft = isInSpan(leftLine, leftColumnIndex, columnCount);
      let hasRight = isInSpan(rightLine, leftColumnIndex, columnCount);
      if (!hasLeft && !hasRight) continue;
      let isNotCut = (...sides: CutSideOfTable[]) => !sides.some((side) => cut.includes(side));
      let corners = [
        hasTop && hasLeft && isNotCut('top', 'left') ? 'top-left' : null,
        hasTop && hasRight && isNotCut('top', 'right') ? 'top-right' : null,
        hasBottom && hasLeft && isNotCut('foot', 'left') ? 'bottom-left' : null,
        hasBottom && hasRight && isNotCut('foot', 'right') ? 'bottom-right' : null,
      ].filter((corner) => corner !== null);
      if (corners.length > 0) return corners.join(' ');
    }
    return null;
  };
}
export function filterButtonsInView(
  view: PageState,
  reads: ReadsWithTextMeasurer,
  stuckHeaders: readonly StuckHeader[],
  cellLooks: LooksOfHeaderCell,
): FilterButtonInView[] {
  let layout = layoutOfView(view, reads);
  let tables = tablesWithFilterButtons(view, reads);
  if (tables.length === 0) return NO_FILTER_BUTTONS;
  let columnSpanOf = columnSpanOfIdFinder(view, reads, layout);
  let filterNotDrawnYet: OwnFilter | null = view.rowsAskedFor?.isOfFilterBar === false ? null : ownFilterNotDrawnYet(view);
  return tables.flatMap((table) => {
    let { rowIndex } = table;
    let ownFilterList = view.ownFilterList;
    let { columnsOfFound } = table;
    let firstColumnId = columnsOfFound === undefined ? undefined : table.columns[0]?.c;
    let isNotDrawnYet =
      filterNotDrawnYet !== null &&
      columnsOfFound !== undefined &&
      filterNotDrawnYet.table.header.lastRow === table.table.header.lastRow &&
      filterNotDrawnYet.columns.some(({ c: columnId }) => {
        let columnIndex = columnSpanOf(columnId)?.columnIndex;
        return columnIndex !== undefined && isInSpan(columnIndex, columnsOfFound.firstIndex, columnsOfFound.count);
      });
    let foundColumnsSpan = columnsOfFound === undefined ? null : columnRunSpanOnScreen(columnsOfFound, view, layout, view);
    let buttonsAcross = (rowSpan: SpanOnScreen): PlacedFilterButton[] =>
      filterButtonsOfTable(
        table,
        columnSpanOf,
        rowSpan,
        view.density,
        isNotDrawnYet ? (firstColumnId ?? null) : ownFilterList?.tableKey === table.key ? ownFilterList.c : null,
        (columnIndex: number) => cellLooks(rowIndex, columnIndex).text,
        foundColumnsSpan === null
          ? null
          : {
              table: foundColumnsSpan,
              takenAtEnd: foundColumnsSpan.showTo === cellsAreaWidth(view) ? ROOM_AT_TABLE_END_FOR_FILTER_BUTTONS / view.zoom : 0,
            },
      );
    let headerKeyOf = ({ columnIndex }: Pick<PlacedFilterButton, 'columnIndex'>) => stuckHeaderAt(stuckHeaders, rowIndex, columnIndex)?.key ?? null;
    let buttons = [
      ...stuckHeaders.flatMap(
        (stuckHeader) =>
          buttonsAcross(rowSpanInStuckHeader(stuckHeader, rowIndex, layout)).filter(
            (button) => headerKeyOf(button) === stuckHeader.key,
          ),
      ),
      ...buttonsAcross(
        rowRunSpanOnScreen(
          {
            firstIndex: rowIndex,
            count: 1,
          },
          view,
          layout,
          view,
        ),
      ).filter((button) => headerKeyOf(button) === null),
    ];
    buttons.sort((first, second) => first.columnIndex - second.columnIndex);
    return buttons.map((button): FilterButtonInView => {
      let { text, groundOverText, ...looks } = cellLooks(rowIndex, button.columnIndex);
      let heldColumns = columnsUnderHeldButton(button.heldInView, view, layout);
      let middle = button.left + FILTER_BUTTON_SIZE / 2;
      let heldColumnIndex = heldColumns.find((held) => middle < held.left + held.width)?.columnIndex;
      return Object.assign({}, button, looks, {
        ...(heldColumnIndex !== undefined && {
          ink: cellLooks(rowIndex, heldColumnIndex).ink,
          ground: null,
        }),
        headerKept: headerKeyOf(button),
        groundsWhereHeld: heldColumns.map(
          ({ left, width, columnIndex }) => ({
            left,
            width,
            ground: cellLooks(rowIndex, columnIndex).groundOverText,
          }),
        ),
      });
    });
  });
}
export const columnSpanOfIdFinder =
  (view: PageState, reads: WorkbookReads, layout: GridLayout) =>
  (columnId: ColumnId): ColumnSpanOfId | null => {
    let columnIndex = reads.columnIndexOf(view.sheetId, columnId);
    return columnIndex === null
      ? null
      : {
          columnIndex,
          across: columnRunSpanOnScreen(
            {
              firstIndex: columnIndex,
              count: 1,
            },
            view,
            layout,
            view,
          ),
        };
  };
export const tablesWithButtonsCache = new WeakMap<PageState, TablesWithButtonsCached>();
export const stuckHeaderAt = <Header extends StickyHeaderInView>(
  stuckHeaders: readonly Header[],
  rowIndex: number,
  columnIndex: number,
): Header | undefined =>
  stuckHeaders.find(
    (stuckHeader) =>
      isInSpan(rowIndex, stuckHeader.firstRowIndex, stuckHeader.rowCount) &&
      isInSpan(columnIndex, stuckHeader.firstColumnIndex, stuckHeader.columnCount),
  );
export const filterButtonRoomInCell = (cellWidth: number): number =>
  cellWidth < FILTER_BUTTON_SIZE ? 0 : FILTER_BUTTON_GAP + FILTER_BUTTON_SIZE + cellPaddingBeside('comfortable');
export const matchesNoCell = (): boolean => false;
export const NO_TABLE_EDGE_COLUMNS: number[] = [];
export const noTableCorners = (): string | null => null;
export const isSpanCutAtStart = ({ start, showFrom }: Pick<SpanOnScreen, 'start' | 'showFrom'>): boolean => start < showFrom + 1;
export const isSpanCutAtEnd = (
  { end, showTo, isEndUnderFrozenLines }: Pick<SpanOnScreen, 'end' | 'showTo' | 'isEndUnderFrozenLines'>,
  frozenEnd: number,
): boolean => end > showTo || isEndUnderFrozenLines || (end > frozenEnd && end < frozenEnd + 1);
export const NO_FILTER_BUTTONS: FilterButtonInView[] = [];
