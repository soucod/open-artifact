import type { RowId, SheetId, TableOfASheet } from '@open-artifact/sheets-core';
import { areaOfFilteredTable, tableKeyOf, indexRangesOverlap, placedTablesOfSheet, isTableCertain, hasCellsOnShowIn } from '../tables/finding.ts';
import {
  cellsHeightAboveFloats,
  frozenRowsHeight,
  columnPanes,
  cellUnderPointer,
  cellsAreaHeight,
  freezeGripAt,
  isInSpan,
  rowResizeLineAt,
} from './geometry.ts';
import { layoutOfView } from './layout.ts';
import { COLUMN_HEADER_HEIGHT } from './cell-metrics.ts';
import { ROW_HEADER_WIDTH } from './cell-metrics-values.ts';
import type { OwnFilter, PageState, TableNotFormatted } from '../state/initial-state.ts';
import type { CellId, SheetRead, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { PartsOfPlacedTable, TableIndexRun } from '../selection/table-select.ts';
import type { MenuAsked, PageContext, PageEvent, PointerPressed, PointerPressedTwice } from '../state/event-reducer.ts';
import type { GridLayout } from './layout.ts';
import type { CellFoundBy, GridPoint, RowLines } from './geometry.ts';
/** A table placed on the grid: its key, its sheet, the table read, and the rows and columns it spans. */
export interface PlacedTableOnSheet extends Pick<PartsOfPlacedTable, 'header' | 'columns' | 'area'> {
  key: string;
  sheetId: SheetId;
  table: TableOfASheet;
}
/** The tables of a sheet placed on the grid, those of them that are certain, and those that could not be placed. */
export interface PlacedTablesOfSheet {
  all: PlacedTableOnSheet[];
  certain: PlacedTableOnSheet[];
  lost: TableOfASheet[];
}
/** The heading rows of a table or a filter that stay in sight as its rows scroll by, and the rows and columns it reaches. */
export interface StickyHeader {
  key: string;
  header: TableIndexRun;
  columns: TableIndexRun;
  lastRowIndex: number;
}
/** A sticky header as the view lays it out: its rows and columns, its height, and where it and its table end in the sheet. */
export interface StickyHeaderInView {
  key: string;
  firstRowIndex: number;
  rowCount: number;
  firstColumnIndex: number;
  columnCount: number;
  lastRowIndex: number;
  height: number;
  topInSheet: number;
  endOfTable: number;
}
/** The part of a sticky header shown in one pane of columns, and whether it goes on past either side. */
export interface StickyHeaderPart {
  startOfPane: number;
  left: number;
  width: number;
  goesOnAtLeft: boolean;
  goesOnAtRight: boolean;
}
/** A sticky header stuck at the top of the scrolled rows, with its parts in the panes. */
export interface StuckHeaderInPlace extends StickyHeaderInView {
  top: number;
  showFrom: number;
  parts: StickyHeaderPart[];
}
/** A stuck header, and whether it shows the row numbers too. */
export interface StuckHeader extends StuckHeaderInPlace {
  areRowNumbersItsOwn: boolean;
}
/** A run of columns. */
export type ColumnSpan = Pick<CellArea, 'leftColumnIndex' | 'columnCount'>;
/** What stuck headers may cover: the row numbers, or a run of columns. */
export type StuckHeaderCover = 'rowNumbers' | ColumnSpan;
/** How a dragged or pointed position keeps clear of stuck headers: along which lines, from which row, and the area grown so far. */
export interface ClearOfStuckHeaders {
  of: 'rows' | 'columns' | ((columnIndex: number) => StuckHeaderCover);
  fromRow: number;
  grownSoFar?: Pick<CellArea, 'topRowIndex' | 'leftColumnIndex'> | null;
}
/** A position kept clear of stuck headers, and what it is to come clear of when it lies under them. */
export interface PositionClearOfStuckHeaders extends CellPosition {
  isToComeClearOf?: StuckHeaderCover;
}
/** A press of a pointer on the grid, once or twice. */
export type PressOnGrid = PointerPressed | PointerPressedTwice;
/** A page event, with what the pointer was over when the event is a press or a menu asked for. */
export type PageEventMadeOver = PageEvent & Pick<MenuAsked, 'madeOver'>;
/** The top, bottom and left edges of the cell being edited, on screen. */
export interface EditedCellBox {
  top: number;
  bottom: number;
  left: number;
}
/** The sticky header of a filter last found, with the lines it was found in. */
export interface FilterStickyHeaderCacheEntry {
  rows: SheetRead['rows'];
  columns: SheetRead['columns'];
  found: StickyHeader | null;
}
/** The sticky headers of a sheet last found, with what they were found from. */
export interface StickyHeadersOnSheetCacheEntry {
  tables: PlacedTablesOfSheet;
  reads: WorkbookReads;
  filtered: OwnFilter[] | undefined;
  found: StickyHeader[];
}
export function unformattedMarksInHeader(
  { sheetId, header, columns }: Pick<PlacedTableOnSheet, 'sheetId' | 'header' | 'columns'>,
  marks: readonly TableNotFormatted[],
  book: WorkbookReads,
): TableNotFormatted[] {
  return marks.filter((mark: CellId) => {
    let position = mark.sheetId === sheetId ? book.positionOfCell(mark) : null;
    if (position === null || position.rowIndex < header.first || position.rowIndex > header.last) return false;
    return position.columnIndex >= columns.first && position.columnIndex <= columns.last;
  });
}
export function stickyHeaderOfFilter(filter: OwnFilter, book: WorkbookReads): StickyHeader | null {
  let { table } = filter;
  let area = areaOfFilteredTable(book, filter);
  if (area === null) return null;
  let header: TableIndexRun = {
    first: area.topRowIndex,
    last: area.rowIndexOfButtons,
  };
  if ([table.firstRowOfBody, table.lastRowOfBody].some((rowId: RowId) => (book.rowIndexOf(table.sheetId, rowId) ?? 1 / 0) <= header.last))
    return null;
  let { leftColumnIndex, columnCount } = area;
  return {
    key: tableKeyOf(table.header!.firstRow, table.firstColumn),
    header,
    lastRowIndex: area.topRowIndex + area.rowCount - 1,
    columns: {
      first: leftColumnIndex,
      last: leftColumnIndex + columnCount - 1,
    },
  };
}
export function cachedStickyHeaderOfFilter(filter: OwnFilter, book: WorkbookReads): StickyHeader[] {
  let lines = book.linesOf(filter.table.sheetId);
  if (lines === null) return [];
  let { rows, columns } = lines;
  let cached = filterStickyHeaderCache.get(filter);
  let isCached = cached?.rows === rows && cached.columns === columns;
  let found = isCached ? cached!.found : stickyHeaderOfFilter(filter, book);
  if (!isCached)
    filterStickyHeaderCache.set(filter, {
      rows,
      columns,
      found,
    });
  return found === null ? [] : [found];
}
export function clipStickyHeaderToNext(header: StickyHeader, others: readonly StickyHeader[]): StickyHeader[] {
  let { header: rows } = header;
  let below = others.filter(
    (other: StickyHeader) => indexRangesOverlap(other.columns, header.columns) && other.lastRowIndex >= rows.first,
  );
  let lastRowIndex = Math.min(header.lastRowIndex, ...below.map((other: StickyHeader) => other.header.first - 1));
  return lastRowIndex > rows.last
    ? [
        {
          ...header,
          lastRowIndex,
        },
      ]
    : [];
}
export function columnRangeOfTable(
  sheetId: SheetId,
  { firstColumn, lastColumn }: Pick<TableOfASheet, 'firstColumn' | 'lastColumn'> = {} as Pick<TableOfASheet, 'firstColumn' | 'lastColumn'>,
  book: WorkbookReads,
): TableIndexRun {
  let first = book.columnIndexOf(sheetId, firstColumn);
  let last = book.columnIndexOf(sheetId, lastColumn);
  if (first === null || last === null)
    return {
      first: 0,
      last: 1 / 0,
    };
  return {
    first: Math.min(first, last),
    last: Math.max(first, last),
  };
}
export function stickyHeadersOnSheet(state: PageState, book: WorkbookReads): StickyHeader[] {
  let { sheetId, tablesNotFormatted } = state;
  let [placed, filters]: [PlacedTablesOfSheet, OwnFilter[] | undefined] = [placedTablesOfSheet(state, book, sheetId), state.ownFilters.get(sheetId)];
  let cached = stickyHeadersOnSheetCache.get(tablesNotFormatted);
  if (cached?.tables === placed && cached.reads === book && cached.filtered === filters) return cached.found;
  let tableHeaders = placed.certain
    .filter((table: PlacedTableOnSheet) => hasNoUnformattedMark(state, table, book))
    .map(
      ({ key, header, columns, area }: PlacedTableOnSheet): StickyHeader => ({
        key,
        header,
        columns,
        lastRowIndex: area.topRowIndex + area.rowCount - 1,
      }),
    );
  let lostColumns: TableIndexRun[] = placed.lost.filter(isTableCertain).map((table: TableOfASheet) => columnRangeOfTable(sheetId, table, book));
  let filterHeaders = (filters ?? [])
    .flatMap((filter: OwnFilter) => cachedStickyHeaderOfFilter(filter, book))
    .filter(
      ({ columns }: StickyHeader) => lostColumns.every((tableColumns: TableIndexRun) => !indexRangesOverlap(tableColumns, columns)),
    );
  let clippedFilterHeaders = filterHeaders.flatMap(
    (header: StickyHeader) =>
      clipStickyHeaderToNext(header, [...tableHeaders, ...filterHeaders.filter((other: StickyHeader) => other !== header)]),
  );
  let found = [...tableHeaders, ...clippedFilterHeaders].filter(
    ({ header, columns }: StickyHeader) => hasCellsOnShowIn(sheetId, header, columns, book),
  );
  stickyHeadersOnSheetCache.set(tablesNotFormatted, {
    tables: placed,
    reads: book,
    filtered: filters,
    found,
  });
  return found;
}
export function stickyHeadersOverRow(state: PageState, book: WorkbookReads, rowIndex: number): StickyHeader[] {
  return stickyHeadersOnSheet(
    {
      ...state,
      tablesNotFormatted: NO_TABLES_NOT_FORMATTED,
    },
    book,
  ).filter(({ header, lastRowIndex }: StickyHeader) => rowIndex > header.last && rowIndex <= lastRowIndex);
}
export function stickyHeadersOfView(
  view: PageState,
  book: WorkbookReads,
  layout: GridLayout,
  isWanted: (header: StickyHeader) => boolean = () => true,
): StickyHeaderInView[] {
  if (view.sheetPointedIn !== null) return [];
  let headers = stickyHeadersOnSheet(view, book).filter(isWanted);
  let roomBelowFrozen = cellsHeightAboveFloats(view) - frozenRowsHeight(layout);
  let { rowEdges } = layout;
  return headers.flatMap(({ key, header, lastRowIndex, columns }: StickyHeader): StickyHeaderInView[] => {
    if (header.first < layout.frozenRowCount) return [];
    let topInSheet = rowEdges.startOf(header.first);
    let height = rowEdges.startOf(header.last + 1) - topInSheet;
    if (height <= 0 || height > roomBelowFrozen * MAX_STICKY_HEADER_SHARE) return [];
    return [
      {
        key,
        firstRowIndex: header.first,
        rowCount: header.last - header.first + 1,
        firstColumnIndex: columns.first,
        columnCount: columns.last - columns.first + 1,
        lastRowIndex,
        height,
        topInSheet,
        endOfTable: rowEdges.startOf(lastRowIndex + 1),
      },
    ];
  });
}
export function stickyHeaderPartsInPanes(
  { firstColumnIndex, columnCount }: Pick<StickyHeaderInView, 'firstColumnIndex' | 'columnCount'>,
  view: Pick<PageState, 'scrollLeft' | 'gridWidth'>,
  layout: GridLayout,
): StickyHeaderPart[] {
  let start = layout.columnEdges.startOf(firstColumnIndex);
  let end = layout.columnEdges.startOf(firstColumnIndex + columnCount);
  return columnPanes(view, layout, view).flatMap(({ scroll, showFrom, showTo }): StickyHeaderPart[] => {
    let left = Math.max(start - scroll, showFrom);
    let width = Math.min(end - scroll, showTo) - left;
    let goesOnAtLeft = start - scroll < showFrom;
    let goesOnAtRight = end - scroll > showTo;
    return width > 0
      ? [
          {
            startOfPane: showFrom,
            left,
            width,
            goesOnAtLeft,
            goesOnAtRight,
          },
        ]
      : [];
  });
}
export function editedCellBoxInGrid(
  position: CellPosition,
  view: Pick<PageState, 'sheetId' | 'scrollTop' | 'scrollLeft'>,
  book: WorkbookReads,
  { rowEdges, columnEdges, frozenRowCount, frozenColumnCount }: GridLayout,
): EditedCellBox | null {
  let { rowIndex, columnIndex } = position;
  let { rowCount } = book.mergedAreaAt(view.sheetId, position) ?? {
    rowCount: 1,
  };
  if (rowIndex < frozenRowCount) return null;
  return {
    top: rowEdges.startOf(rowIndex) - view.scrollTop,
    bottom: rowEdges.startOf(rowIndex + rowCount) - view.scrollTop,
    left: columnEdges.startOf(columnIndex) - (columnIndex < frozenColumnCount ? 0 : view.scrollLeft),
  };
}
export function stuckHeadersOfView(
  view: PageState,
  book: ReadsWithTextMeasurer,
  layout: GridLayout = layoutOfView(view, book),
  pulledDownBy: number = 0,
): StuckHeader[] {
  let frozenHeight = frozenRowsHeight(layout);
  let topOfScrolled = view.scrollTop + frozenHeight;
  let active = book.positionOfCell(view.activeCell);
  let isEditing = view.mode.kind === 'editing';
  let editedBox = isEditing && active !== null ? editedCellBoxInGrid(active, view, book, layout) : null;
  let rowAtTop = layout.rowEdges.indexAt(topOfScrolled);
  let stuck = stickyHeadersOfView(
    view,
    book,
    layout,
    ({ header, lastRowIndex }: StickyHeader) => header.first <= rowAtTop && rowAtTop <= lastRowIndex,
  ).flatMap((header: StickyHeaderInView): StuckHeaderInPlace[] => {
    let { topInSheet, endOfTable, height } = header;
    if (topInSheet >= topOfScrolled || endOfTable <= topOfScrolled) return [];
    if (
      (topInSheet + height > topOfScrolled + Math.max(0, pulledDownBy) || isEditing) &&
      active !== null &&
      stickyHeaderSpansPosition(header, active)
    )
      return [];
    let topEdge = frozenHeight + Math.min(0, endOfTable - topOfScrolled - height);
    let parts = stickyHeaderPartsInPanes(header, view, layout);
    let isOverEditor =
      editedBox !== null &&
      editedBox.top < topEdge + height &&
      editedBox.bottom > frozenHeight &&
      parts.some(({ left, width }: StickyHeaderPart) => left + width > editedBox.left);
    return parts.length === 0 || isOverEditor
      ? []
      : [
          {
            ...header,
            top: topEdge,
            showFrom: frozenHeight,
            parts,
          },
        ];
  });
  let [first] = stuck;
  let isAllAlike = stuck.every(
    ({ firstRowIndex, rowCount, top: topEdge }: StuckHeaderInPlace) =>
      firstRowIndex === first?.firstRowIndex && rowCount === first.rowCount && topEdge === first.top,
  );
  return stuck.map(
    (header: StuckHeaderInPlace, index: number): StuckHeader =>
      Object.assign(header, {
        areRowNumbersItsOwn: index === 0 && isAllAlike,
      }),
  );
}
export function bottomOfStuckHeadersInSheet(view: PageState, book: ReadsWithTextMeasurer, cover: StuckHeaderCover, layout: GridLayout): number | null {
  let bottom = stuckHeadersBottom(cover, stuckHeadersOfView(view, book, layout));
  return bottom === 0 ? null : view.scrollTop + frozenRowsHeight(layout) + bottom;
}
export function pointedPositionClearOfStuckHeaders(
  position: CellPosition,
  { of, fromRow }: Pick<ClearOfStuckHeaders, 'of' | 'fromRow'>,
  view: PageState,
  book: ReadsWithTextMeasurer,
  layout: GridLayout,
): PositionClearOfStuckHeaders {
  let { rowEdges } = layout;
  if (of === 'columns' || position.rowIndex < layout.frozenRowCount) return position;
  let topEdge = rowEdges.startOf(position.rowIndex) - view.scrollTop;
  let roomBelowFrozen = cellsHeightAboveFloats(view) - frozenRowsHeight(layout);
  if (topEdge > frozenRowsHeight(layout) + roomBelowFrozen * MAX_STICKY_HEADER_SHARE) return position;
  let cover = of === 'rows' ? 'rowNumbers' : of(position.columnIndex);
  let headersBottom = bottomOfStuckHeadersInSheet(view, book, cover, layout);
  if (headersBottom === null) return position;
  let rowIndex = rowPushedBelowHeaders(position.rowIndex, rowEdges.indexAt(headersBottom), fromRow);
  return rowEdges.startOf(rowIndex) < headersBottom && rowEdges.startOf(rowIndex + 1) > headersBottom
    ? {
        ...position,
        rowIndex,
        isToComeClearOf: cover,
      }
    : {
        ...position,
        rowIndex,
      };
}
export function dragPositionClearOfStuckHeaders(
  point: GridPoint,
  view: PageState,
  book: ReadsWithTextMeasurer,
  layout: GridLayout,
  drag: ClearOfStuckHeaders,
): PositionClearOfStuckHeaders {
  let position = cellUnderPointer(point, view, layout, view, drag.grownSoFar ?? null);
  if (drag.of === 'columns' || position.rowIndex < layout.frozenRowCount) return position;
  if (!isPointerOverFrozenRows(point, layout)) return pointedPositionClearOfStuckHeaders(position, drag, view, book, layout);
  let cover = drag.of === 'rows' ? 'rowNumbers' : drag.of(position.columnIndex);
  let headersBottom = bottomOfStuckHeadersInSheet(view, book, cover, layout);
  if (headersBottom === null)
    return {
      ...position,
      isToComeClearOf: cover,
    };
  let { rowEdges } = layout;
  let yInGrid = point.y - COLUMN_HEADER_HEIGHT;
  let rowIndex = rowEdges.indexAt(headersBottom + Math.min(-1, yInGrid));
  let rowToShow =
    rowEdges.startOf(rowIndex + 1) > headersBottom && rowEdges.sizeOf(rowIndex) > cellsAreaHeight(view) - (headersBottom - view.scrollTop)
      ? rowEdges.indexAt(rowEdges.startOf(rowIndex) - 1)
      : rowIndex;
  return {
    ...position,
    rowIndex: rowPushedBelowHeaders(position.rowIndex, rowToShow, drag.fromRow),
    isToComeClearOf: cover,
  };
}
export function stuckHeaderAtPoint(point: GridPoint, view: PageState, book: ReadsWithTextMeasurer): StuckHeader | undefined {
  let y = point.y - COLUMN_HEADER_HEIGHT;
  let x = point.x - ROW_HEADER_WIDTH;
  let layout = layoutOfView(view, book);
  if (freezeGripAt(point, layout) !== null) return;
  return stuckHeadersOfView(view, book, layout).findLast(
    ({ showFrom, top: topEdge, height, parts, areRowNumbersItsOwn }: StuckHeader) =>
      isInSpan(y, showFrom, topEdge + height - showFrom) &&
      (x < 0 ? areRowNumbersItsOwn : parts.some(({ left, width }: StickyHeaderPart) => isInSpan(x, left, width))),
  );
}
export function scrollToStuckHeaderOnPress(
  pressEvent: PageEventMadeOver,
  view: PageState,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageState {
  let isPress = pressEvent.kind === 'pointerPressed' || pressEvent.kind === 'pointerPressedTwice';
  let isMenuAsked = pressEvent.kind === 'menuAsked' && pressEvent.inContextBar === undefined;
  let point = isPress ? (pressEvent as PressOnGrid) : isMenuAsked ? (pressEvent as MenuAsked).at : null;
  if (point === null || (!isPress && !isMenuAsked)) return view;
  let draggingKind = view.dragging?.kind;
  if (draggingKind !== undefined && draggingKind !== 'tapping' && draggingKind !== 'selecting') return view;
  let mayStartEditing =
    pressEvent.kind === 'pointerPressed' && !pressEvent.isByFinger && refusalOfEveryEdit === null && view.mode.kind !== 'editing';
  let layout = layoutOfView(view, reads);
  if (mayStartEditing && (rowResizeLineAt(point, view, layout) ?? 1 / 0) < layout.frozenRowCount) return view;
  let header = stuckHeaderAtPoint(point, view, reads);
  let isOtherHeader = pressEvent.madeOver !== undefined && pressEvent.madeOver.headerKept !== header?.key;
  if (header === undefined || isOtherHeader) return view;
  return {
    ...view,
    scrollTop: Math.max(0, header.topInSheet - header.top),
  };
}
export function isRowUnderStuckHeader(rowIndex: number, view: PageState, book: ReadsWithTextMeasurer, layout: GridLayout): boolean {
  let [first] = stuckHeadersOfView(view, book, layout);
  let rowBottom = layout.rowEdges.startOf(rowIndex + 1) - view.scrollTop;
  return first?.areRowNumbersItsOwn === true && rowIndex >= layout.frozenRowCount && rowBottom <= first.top + first.height;
}
export const MAX_STICKY_HEADER_SHARE = 0.3333333333333333;
export const hasNoUnformattedMark = (
  { tablesNotFormatted }: Pick<PageState, 'tablesNotFormatted'>,
  placed: Pick<PlacedTableOnSheet, 'sheetId' | 'header' | 'columns' | 'table'>,
  book: WorkbookReads,
): boolean =>
  placed.table.basis.kind === 'declared' || unformattedMarksInHeader(placed, tablesNotFormatted, book).length === 0;
export const filterStickyHeaderCache = new WeakMap<OwnFilter, FilterStickyHeaderCacheEntry>();
export const stickyHeadersOnSheetCache = new WeakMap<TableNotFormatted[], StickyHeadersOnSheetCacheEntry>();
export const NO_TABLES_NOT_FORMATTED: TableNotFormatted[] = [];
export const stickyHeaderSpansColumn = (header: Pick<StickyHeaderInView, 'firstColumnIndex' | 'columnCount'>, columnIndex: number): boolean =>
  isInSpan(columnIndex, header.firstColumnIndex, header.columnCount);
export const stickyHeaderSpansPosition = (
  header: Pick<StickyHeaderInView, 'firstRowIndex' | 'rowCount' | 'firstColumnIndex' | 'columnCount'>,
  { rowIndex, columnIndex }: CellPosition,
): boolean =>
  isInSpan(rowIndex, header.firstRowIndex, header.rowCount) && stickyHeaderSpansColumn(header, columnIndex);
export const stickyHeaderHeightAboveRow = (
  { height, topInSheet }: Pick<StickyHeaderInView, 'height' | 'topInSheet'>,
  rowIndex: number,
  { rowEdges }: Pick<GridLayout, 'rowEdges'>,
): number => Math.min(height, rowEdges.startOf(rowIndex) - topInSheet);
export const heightCoveredByStickyHeaders = (
  view: PageState,
  book: WorkbookReads,
  position: CellPosition,
  layout: GridLayout,
  how: CellFoundBy = 'key',
): number =>
  Math.max(
    0,
    ...stickyHeadersOfView(view, book, layout)
      .filter(
        (header: StickyHeaderInView) =>
          stickyHeaderSpansColumn(header, position.columnIndex) &&
          position.rowIndex >= header.firstRowIndex + (how === 'key' ? 0 : header.rowCount) &&
          position.rowIndex <= header.lastRowIndex,
      )
      .map((header: StickyHeaderInView) => stickyHeaderHeightAboveRow(header, position.rowIndex, layout)),
  );
export const tallestStickyHeaderOverColumn = (view: PageState, book: WorkbookReads, columnIndex: number, layout: GridLayout): number =>
  Math.max(
    0,
    ...stickyHeadersOfView(view, book, layout)
      .filter((header: StickyHeaderInView) => stickyHeaderSpansColumn(header, columnIndex))
      .map(({ height }: StickyHeaderInView) => height),
  );
export const stuckHeaderCovers = (
  header: Pick<StuckHeader, 'areRowNumbersItsOwn' | 'firstColumnIndex' | 'columnCount'>,
  cover: StuckHeaderCover,
): boolean =>
  cover === 'rowNumbers'
    ? header.areRowNumbersItsOwn
    : header.firstColumnIndex < cover.leftColumnIndex + cover.columnCount && cover.leftColumnIndex < header.firstColumnIndex + header.columnCount;
export const stuckHeadersBottom = (cover: StuckHeaderCover, stuck: readonly StuckHeader[]): number =>
  Math.max(
    0,
    ...stuck
      .filter((header: StuckHeader) => stuckHeaderCovers(header, cover))
      .map(({ top: topEdge, height, showFrom }: StuckHeader) => topEdge + height - showFrom),
  );
export const heightCoveredByStuckHeaders = (
  view: PageState,
  book: ReadsWithTextMeasurer,
  rowIndex: number,
  cover: StuckHeaderCover,
  layout: GridLayout,
): number =>
  Math.max(
    0,
    ...stuckHeadersOfView(view, book, layout)
      .filter((header: StuckHeader) => stuckHeaderCovers(header, cover) && rowIndex <= header.lastRowIndex)
      .map((header: StuckHeader) => stickyHeaderHeightAboveRow(header, rowIndex, layout)),
  );
export const columnSpanAt = (columnIndex: number): ColumnSpan => ({
  leftColumnIndex: columnIndex,
  columnCount: 1,
});
export const rowPushedBelowHeaders = (rowIndex: number, candidate: number, fromRow: number): number =>
  Math.max(rowIndex, fromRow >= rowIndex ? Math.min(candidate, fromRow) : candidate);
export const isPointerOverFrozenRows = (point: Pick<GridPoint, 'y'>, layout: RowLines): boolean =>
  point.y - COLUMN_HEADER_HEIGHT < frozenRowsHeight(layout);
