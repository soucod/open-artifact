import type { ColumnId, Edit, Effect, SheetId } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { OwnFilter, PageState } from '../state/initial-state.ts';
import type { PageContext, PointerPressed } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { GridPoint } from '../grid/geometry.ts';
import type { CellArea, CellSelection } from './model.ts';
import type { LinesLanding } from './move-lines.ts';
import type { TableIndexRun } from './table-select.ts';
import { layoutOfView } from '../grid/layout.ts';
import { areasOverlap } from '../model/workbook.ts';
import { areasOfRuleRanges } from '../format/conditional/descriptions.ts';
import { tablesToOutline } from '../tables/tables-in-view.ts';
import { drawnOwnFiltersOfSheet, ownFilterTableArea } from '../tables/own-filters.ts';
import { areaOfFilteredTable } from '../tables/finding.ts';
import { isInSpan, rangeSpansOnScreen, dropIndexAtPointer } from '../grid/geometry.ts';
import { selectedArea, scrollToShowPosition, isSameCell, selectionBetweenPositions, isSameArea } from './model.ts';
import { ROW_HEADER_WIDTH } from '../grid/cell-metrics-values.ts';
import { MOVE_LINES_DRAG_THRESHOLD } from './move-lines.ts';
import { dragPositionClearOfStuckHeaders, stuckHeadersOfView } from '../grid/sticky-headers.ts';
import { withNoEffects } from '../state/transitions.ts';
import { cellShownText } from '../clipboard/text-escaping.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { areaRefBetween } from '../model/workbook.ts';
import { NUMBER_OPERAND_FIELDS, numberConditionOperand } from '../format/conditional/editor-view.ts';
import { columnLetters } from '../model/a1-references.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** A table's area and how many of its rows are its header. */
export interface TableHeaderArea {
  area: CellArea;
  rowCountOfHeader: number;
}
/** A table's header area, and whether something stands right under it that its rows would leave behind. */
export interface TableToFindColumnsFreeIn extends TableHeaderArea {
  hasSomethingRightUnder: boolean;
}
/** Which columns of a table may move as whole columns, and which may move as the table's cells only. */
export interface ColumnsFreeToMove {
  wholeColumns: boolean[];
  cells: boolean[];
}
/** How columns of a table move: as whole columns of the sheet, or as the table's cells only. */
export type KindOfColumnMove = keyof ColumnsFreeToMove;
/** The ranges a run of moved columns may not cut across, for each kind of move. */
export type RangesThatStopAMove = Record<KindOfColumnMove, CellArea[]>;
/** A table whose columns may be moved: which of them may, the ranges that stop a move, and how many columns are frozen. */
export interface TableToMoveColumnsOf extends TableHeaderArea {
  mayMove: ColumnsFreeToMove;
  rangesThatStop: RangesThatStopAMove;
  frozenColumnCount: number;
}
/** The columns pressed columns may move within, and those they may move within as whole columns, if any. */
export interface ColumnRunToMove {
  within: TableIndexRun;
  whole: TableIndexRun | null;
}
/** A column whose cells moved and the column they landed in. */
export type ColumnWentTo = [cameFrom: ColumnId, landed: ColumnId];
/** The cells at the two ends of a run of columns. */
export interface CellsAtEnds {
  first: CellId;
  last: CellId;
}
/** The top left and bottom right cells of a table. */
export interface CornersOfTable {
  topLeft: CellId;
  bottomRight: CellId;
}
/** Columns of a table pressed by their grip, to move: the pressed cell, the columns, the run they may move within, the table, and what was selected. */
export interface ColumnMoveOfPress extends CellsAtEnds {
  pressedAt: GridPoint;
  pressed: CellId;
  within: CellsAtEnds;
  whole: CellsAtEnds | null;
  table: CornersOfTable;
  selectedAtPress: CellSelection;
}
/** How far the pointer is from the left and right edges of the columns it holds. */
export interface GripOfColumns {
  fromLeft: number;
  toRight: number;
}
/** Columns of a table dragged by their grip. */
export interface MovingColumnsOfTableDrag extends ColumnMoveOfPress {
  kind: 'movingColumnsOfTable';
  grip: GripOfColumns;
  landing: LinesLanding | null;
}
/** Columns of a table being moved, as drawn: the columns they cross, the order they came from, where they land and how many. */
export interface ColumnsOfTableMoving {
  sheetId: SheetId;
  area: CellArea;
  cameFrom: number[];
  endsOfTable: TableIndexRun | null;
  landsAt: number;
  count: number;
  isToMove: boolean;
}
/** Where a grip of a column reaches down the table on screen. */
export interface ExtentOfGrip {
  from: number;
  to: number;
}
/** The grip on a table's header cell that moves its column. */
export interface ColumnGripOfTable {
  key: string;
  cell: CellId;
  left: number;
  top: number;
  width: number;
  height: number;
  extent: ExtentOfGrip;
}
export function columnsEmptyOutsideArea(
  view: PageState,
  reads: ReadsWithTextMeasurer,
  { topRowIndex, rowCount, leftColumnIndex, columnCount }: CellArea,
): boolean[] {
  let { sheetId } = view;
  let key = [sheetId, topRowIndex, rowCount, leftColumnIndex, columnCount].join(' ');
  let byArea = columnsFreeToMoveCache.get(reads) ?? new Map<string, boolean[]>();
  columnsFreeToMoveCache.set(reads, byArea);
  let cached = byArea.get(key);
  if (cached !== undefined) return cached;
  let isEmpty = Array.from(
    {
      length: columnCount,
    },
    () => true,
  );
  let rowAfter = topRowIndex + rowCount;
  for (let outside of [
    {
      topRowIndex: 0,
      rowCount: topRowIndex,
      leftColumnIndex,
      columnCount,
    },
    {
      topRowIndex: rowAfter,
      rowCount: layoutOfView(view, reads).rowCount - rowAfter,
      leftColumnIndex,
      columnCount,
    },
  ] as CellArea[]) {
    if (outside.rowCount <= 0) continue;
    for (let cellId of reads.cellsOnShowIn(sheetId, outside)) {
      let position = reads.positionOfCell(cellId);
      if (position !== null) isEmpty[position.columnIndex - leftColumnIndex] = false;
    }
    for (let merged of reads.mergedAreasIn(sheetId, outside))
      for (let offset = 0; offset < merged.columnCount; offset += 1) {
        let index = merged.leftColumnIndex + offset - leftColumnIndex;
        if (index >= 0 && index < columnCount) isEmpty[index] = false;
      }
  }
  return (byArea.set(key, isEmpty), isEmpty);
}
export function columnsFreeToMove(
  view: PageState,
  reads: ReadsWithTextMeasurer,
  { area, rowCountOfHeader, hasSomethingRightUnder }: TableToFindColumnsFreeIn = {} as TableToFindColumnsFreeIn,
  columnsReadAcrossRows: ReadonlySet<number>,
): ColumnsFreeToMove {
  let { columnEdges } = layoutOfView(view, reads);
  let mayMove = Array.from(
    {
      length: area.columnCount,
    },
    (_unused, offset) => columnEdges.sizeOf(area.leftColumnIndex + offset) > 0,
  );
  let holdColumnsOf = ({ leftColumnIndex, columnCount }: Pick<CellArea, 'leftColumnIndex' | 'columnCount'>): void => {
    for (let offset = 0; offset < columnCount; offset += 1) {
      let index = leftColumnIndex + offset - area.leftColumnIndex;
      if (index >= 0 && index < area.columnCount) mayMove[index] = false;
    }
  };
  reads.mergedAreasIn(view.sheetId, area).forEach(holdColumnsOf);
  for (let { r: rowId, c: columnId } of reads.cellsWithSpillIn(view.sheetId)) {
    let spillArea = reads.spillOver({
      sheetId: view.sheetId,
      rowId,
      columnId,
    })?.area;
    let isOneColumnWithinRows =
      spillArea !== undefined &&
      spillArea.columnCount === 1 &&
      spillArea.topRowIndex >= area.topRowIndex &&
      spillArea.topRowIndex + spillArea.rowCount <= area.topRowIndex + area.rowCount;
    if (spillArea !== undefined && !isOneColumnWithinRows && areasOverlap(spillArea, area)) holdColumnsOf(spillArea);
  }
  let isEmptyOutside = columnsEmptyOutsideArea(view, reads, area);
  let wholeColumns = mayMove.map((isFree, offset) => isFree && isEmptyOutside[offset] === true);
  let cells = mayMove.map(
    (isFree, offset) =>
      isFree && rowCountOfHeader === 1 && !hasSomethingRightUnder && !columnsReadAcrossRows.has(area.leftColumnIndex + offset),
  );
  return {
    wholeColumns,
    cells,
  };
}
export function tablesToMoveColumnsOf(view: PageState, reads: ReadsWithTextMeasurer): TableToMoveColumnsOf[] {
  let rules = reads.conditionalFormatsOf(view.sheetId).map(({ liveRanges, effect }) => ({
    effect,
    ranges: areasOfRuleRanges(reads, view.sheetId, liveRanges),
  }));
  return [
    ...tablesToOutline(view, reads).map(
      ({ area, rowCountOfHeader }: TableHeaderArea): TableToFindColumnsFreeIn => ({
        area,
        rowCountOfHeader,
        hasSomethingRightUnder: false,
      }),
    ),
    ...drawnOwnFiltersOfSheet(view, view.sheetId).flatMap((ownFilter: OwnFilter): TableToFindColumnsFreeIn[] => {
      let [filteredArea, tableArea] = [areaOfFilteredTable(reads, ownFilter), ownFilterTableArea(reads, ownFilter)];
      if (filteredArea === null || tableArea === null) return [];
      let columnsUnder = reads.columnIndexesOnShowIn(view.sheetId, tableArea.topRowIndex + tableArea.rowCount);
      let hasSomethingRightUnder =
        ownFilter.liveCellTable!.footerRows === null &&
        columnsUnder.some((columnIndex: number) => isInSpan(columnIndex, tableArea.leftColumnIndex, tableArea.columnCount));
      let rowCountOfHeader = filteredArea.rowIndexOfButtons - tableArea.topRowIndex + 1;
      return [
        {
          area: tableArea,
          rowCountOfHeader,
          hasSomethingRightUnder,
        },
      ];
    }),
  ].map(({ area, rowCountOfHeader, hasSomethingRightUnder }: TableToFindColumnsFreeIn): TableToMoveColumnsOf => {
    let rowAfter = area.topRowIndex + area.rowCount;
    let isAmongRows = ({ topRowIndex, rowCount }: CellArea): boolean => topRowIndex < rowAfter && topRowIndex + rowCount > area.topRowIndex;
    let goesPastRows = ({ topRowIndex, rowCount }: CellArea): boolean => topRowIndex < area.topRowIndex || topRowIndex + rowCount > rowAfter;
    let rangesOverTable = rules.flatMap(({ ranges }) => ranges.filter((range: CellArea) => areasOverlap(range, area)));
    let columnsReadAcrossRows = rules
      .filter(({ ranges }) => ranges.some(isAmongRows) && ranges.some(goesPastRows))
      .flatMap(({ effect }) => columnsReadByEffect(effect))
      .flatMap((columnId: ColumnId) => reads.columnIndexOf(view.sheetId, columnId) ?? []);
    return {
      area,
      rowCountOfHeader,
      mayMove: columnsFreeToMove(
        view,
        reads,
        {
          area,
          rowCountOfHeader,
          hasSomethingRightUnder,
        },
        new Set(columnsReadAcrossRows),
      ),
      rangesThatStop: {
        wholeColumns: rangesOverTable.filter(({ columnCount }: CellArea) => columnCount > 1),
        cells: rangesOverTable.filter(goesPastRows),
      },
      frozenColumnCount: layoutOfView(view, reads).frozenColumnCount,
    };
  });
}
export function columnRunToMoveWithin(
  { area, mayMove, rangesThatStop, frozenColumnCount }: TableToMoveColumnsOf,
  firstColumnIndex: number,
  count: number,
): ColumnRunToMove | null {
  let runOf = (kind: KindOfColumnMove): TableIndexRun | null => {
    let widest = kind === 'cells' ? MOST_CELLS_IN_A_MOVE / area.rowCount : Infinity;
    let mayJoin = (columnIndex: number): boolean =>
      mayMove[kind][columnIndex - area.leftColumnIndex] === true &&
      (kind === 'cells' || firstColumnIndex < frozenColumnCount === columnIndex < frozenColumnCount) &&
      Math.max(firstColumnIndex + count - columnIndex, columnIndex - firstColumnIndex + 1) <= widest &&
      rangesThatStop[kind].every(
        ({ leftColumnIndex, columnCount }) =>
          isInSpan(firstColumnIndex, leftColumnIndex, columnCount) === isInSpan(columnIndex, leftColumnIndex, columnCount),
      );
    for (let columnIndex = firstColumnIndex; columnIndex < firstColumnIndex + count; columnIndex += 1) if (!mayJoin(columnIndex)) return null;
    let [first, last]: [number, number] = [firstColumnIndex, firstColumnIndex + count - 1];
    while (mayJoin(first - 1)) first -= 1;
    while (mayJoin(last + 1)) last += 1;
    return last - first + 1 > count
      ? {
          first,
          last,
        }
      : null;
  };
  let whole = runOf('wholeColumns');
  let runs = [whole, runOf('cells')].filter((run): run is TableIndexRun => run !== null);
  if (runs.length === 0) return null;
  return {
    within: {
      first: Math.min(...runs.map((run: TableIndexRun) => run.first)),
      last: Math.max(...runs.map((run: TableIndexRun) => run.last)),
    },
    whole,
  };
}
export function columnMoveOfPress(
  view: PageState,
  press: PointerPressed,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): ColumnMoveOfPress | null {
  if (press.onGripOfColumn === undefined || refusalOfEveryEdit !== null) return null;
  if (view.mode.kind === 'editing' || press.isToldOfLate === true) return null;
  if (press.isShiftHeld || press.isModifierHeld === true || press.isByFinger) return null;
  let pressedPosition = reads.positionOfCell(press.onGripOfColumn);
  if (pressedPosition === null) return null;
  let { rowIndex, columnIndex } = pressedPosition;
  let table = tablesToMoveColumnsOf(view, reads).find(
    ({ area, rowCountOfHeader }) =>
      isInSpan(rowIndex, area.topRowIndex, rowCountOfHeader) && isInSpan(columnIndex, area.leftColumnIndex, area.columnCount),
  );
  if (table === undefined) return null;
  let { topRowIndex, rowCount, leftColumnIndex, columnCount } = table.area;
  let selected: CellArea | null = view.otherRanges.length === 0 ? selectedArea(view, reads) : null;
  let isSelectedHeaderPressed =
    selected !== null &&
    isInSpan(rowIndex, selected.topRowIndex, selected.rowCount) &&
    isInSpan(columnIndex, selected.leftColumnIndex, selected.columnCount) &&
    selected.leftColumnIndex >= leftColumnIndex &&
    selected.leftColumnIndex + selected.columnCount <= leftColumnIndex + columnCount &&
    selected.topRowIndex >= topRowIndex &&
    selected.topRowIndex + selected.rowCount <= topRowIndex + table.rowCountOfHeader &&
    selected.columnCount < columnCount;
  let [firstColumnIndex, count] = isSelectedHeaderPressed ? [selected!.leftColumnIndex, selected!.columnCount] : [columnIndex, 1];
  let run = columnRunToMoveWithin(table, firstColumnIndex, count);
  if (run === null) return null;
  let cellAt = (row: number, column: number): CellId | null => reads.cellIdAt(view.sheetId, row, column);
  let endsOf = (span: TableIndexRun): CellsAtEnds | null => {
    let [first, last] = [cellAt(topRowIndex, span.first), cellAt(topRowIndex, span.last)];
    return first === null || last === null
      ? null
      : {
          first,
          last,
        };
  };
  let [moved, within, whole] = [
    endsOf({
      first: firstColumnIndex,
      last: firstColumnIndex + count - 1,
    }),
    endsOf(run.within),
    run.whole === null ? null : endsOf(run.whole),
  ];
  let [topLeft, bottomRight] = [cellAt(topRowIndex, leftColumnIndex), cellAt(topRowIndex + rowCount - 1, leftColumnIndex + columnCount - 1)];
  if (moved === null || within === null || (run.whole !== null && whole === null)) return null;
  if (topLeft === null || bottomRight === null) return null;
  let { activeCell, selectionCorner } = view;
  return {
    pressedAt: {
      x: press.x,
      y: press.y,
    },
    pressed: press.onGripOfColumn,
    ...moved,
    within,
    whole,
    table: {
      topLeft,
      bottomRight,
    },
    selectedAtPress: {
      activeCell,
      selectionCorner,
      rangeWalked: null,
    },
  };
}
export function areaOfColumnsMoved({ first, last, table }: Pick<ColumnMoveOfPress, 'first' | 'last' | 'table'>, reads: WorkbookReads): CellArea | null {
  let [firstPosition, lastPosition] = [reads.positionOfCell(first), reads.positionOfCell(last)];
  let [topLeft, bottomRight] = [reads.positionOfCell(table.topLeft), reads.positionOfCell(table.bottomRight)];
  if (firstPosition === null || lastPosition === null || topLeft === null || bottomRight === null) return null;
  return {
    topRowIndex: topLeft.rowIndex,
    rowCount: bottomRight.rowIndex - topLeft.rowIndex + 1,
    leftColumnIndex: Math.min(firstPosition.columnIndex, lastPosition.columnIndex),
    columnCount: Math.abs(lastPosition.columnIndex - firstPosition.columnIndex) + 1,
  };
}
export function canColumnsStillMove(
  view: PageState,
  reads: ReadsWithTextMeasurer,
  dragging: Pick<ColumnMoveOfPress, 'pressed' | 'first' | 'last' | 'table' | 'within' | 'whole'>,
): boolean {
  let [pressedPosition, movedArea, tableArea] = [
    reads.positionOfCell(dragging.pressed),
    areaOfColumnsMoved(dragging, reads),
    areaOfTableMoving(dragging, reads),
  ];
  if (pressedPosition === null || movedArea === null || tableArea === null) return false;
  let isSameRun = (run: TableIndexRun | null, ends: CellsAtEnds | null): boolean =>
    run === null || ends === null
      ? run === null && ends === null
      : reads.positionOfCell(ends.first)?.columnIndex === run.first && reads.positionOfCell(ends.last)?.columnIndex === run.last;
  if (!isInSpan(pressedPosition.rowIndex, tableArea.topRowIndex, tableArea.rowCount)) return false;
  let table = tablesToMoveColumnsOf(view, reads).find(({ area }) => isSameArea(area, tableArea));
  let run = table === undefined ? null : columnRunToMoveWithin(table, movedArea.leftColumnIndex, movedArea.columnCount);
  return run !== null && isSameRun(run.within, dragging.within) && isSameRun(run.whole, dragging.whole);
}
export function startMovingColumnsOfTable(view: PageState, move: ColumnMoveOfPress, reads: ReadsWithTextMeasurer) {
  let area = areaOfColumnsMoved(move, reads);
  if (area === null) return null;
  let { across } = rangeSpansOnScreen(area, view, layoutOfView(view, reads), view);
  let x = move.pressedAt.x - ROW_HEADER_WIDTH;
  return {
    ...view,
    menu: null,
    dragging: {
      kind: 'movingColumnsOfTable',
      ...move,
      grip: {
        fromLeft: x - across.start,
        toRight: across.end - x,
      },
      landing: null,
    } satisfies MovingColumnsOfTableDrag,
  };
}
export function dragMovingColumnsOfTable(view: PageState, drag: MovingColumnsOfTableDrag, pointer: GridPoint, reads: ReadsWithTextMeasurer) {
  let { pressedAt, grip, within } = drag;
  if (drag.landing === null && Math.hypot(pointer.x - pressedAt.x, pointer.y - pressedAt.y) < MOVE_LINES_DRAG_THRESHOLD) return view;
  let area = areaOfColumnsMoved(drag, reads);
  let [withinFirst, withinLast] = [reads.positionOfCell(within.first), reads.positionOfCell(within.last)];
  if (area === null || withinFirst === null || withinLast === null || !canColumnsStillMove(view, reads, drag)) return stopMovingColumnsOfTable(view);
  let layout = layoutOfView(view, reads);
  let position = dragPositionClearOfStuckHeaders(pointer, view, reads, layout, {
    of: 'columns',
    fromRow: area.leftColumnIndex,
  });
  let columnIndex = Math.max(withinFirst.columnIndex, Math.min(position.columnIndex, withinLast.columnIndex));
  let scrolled = scrollToShowPosition(
    view,
    reads,
    {
      ...position,
      columnIndex,
    },
    {
      rows: false,
      columns: true,
    },
    'pointer',
  );
  let across = rangeSpansOnScreen(area, scrolled, layout, scrolled).across;
  let leftEdge = pointer.x - grip.fromLeft;
  let edgeX = leftEdge >= ROW_HEADER_WIDTH + across.start ? pointer.x + grip.toRight : leftEdge;
  let dropIndex = dropIndexAtPointer(
    {
      ...pointer,
      x: edgeX,
    },
    scrolled,
    layout,
    scrolled,
    'columns',
  );
  let landsAt = Math.max(withinFirst.columnIndex, Math.min(dropIndex, withinLast.columnIndex + 1));
  let after = landsAt === 0 ? null : reads.cellIdAt(view.sheetId, area.topRowIndex, landsAt - 1);
  let landing = drag.landing;
  if (
    landing !== null &&
    (after === null || landing.after === null ? after === landing.after : isSameCell(after, landing.after)) &&
    scrolled.scrollLeft === view.scrollLeft
  )
    return view;
  return {
    ...scrolled,
    dragging: {
      ...drag,
      landing: {
        after,
      },
    } satisfies MovingColumnsOfTableDrag,
  };
}
export function columnsOfTableMoving(view: PageState, reads: ReadsWithTextMeasurer): ColumnsOfTableMoving | null {
  let { dragging, sheetId } = view;
  if (dragging?.kind !== 'movingColumnsOfTable') return null;
  let [area, tableArea] = [areaOfColumnsMoved(dragging, reads), areaOfTableMoving(dragging, reads)];
  if (area === null || tableArea === null || !canColumnsStillMove(view, reads, dragging)) return null;
  let wholeArea =
    dragging.whole === null
      ? null
      : areaOfColumnsMoved(
          {
            ...dragging,
            ...dragging.whole,
          },
          reads,
        );
  let { leftColumnIndex, columnCount } = area;
  let after = dragging.landing?.after ?? null;
  let afterIndex = after === null ? null : (reads.positionOfCell(after)?.columnIndex ?? null);
  let dropIndex = dragging.landing === null ? leftColumnIndex : after === null ? 0 : afterIndex === null ? leftColumnIndex : afterIndex + 1;
  let landing = isInSpan(dropIndex, leftColumnIndex, columnCount + 1) ? leftColumnIndex : dropIndex;
  let [first, last] = [Math.min(leftColumnIndex, landing), Math.max(leftColumnIndex + columnCount, landing) - 1];
  let columnIndexes = Array.from(
    {
      length: last - first + 1,
    },
    (_unused, offset) => first + offset,
  );
  let isMoving = (columnIndex: number): boolean => isInSpan(columnIndex, leftColumnIndex, columnCount);
  let [moving, others] = [columnIndexes.filter(isMoving), columnIndexes.filter((columnIndex) => !isMoving(columnIndex))];
  return {
    sheetId,
    area: {
      topRowIndex: area.topRowIndex,
      rowCount: area.rowCount,
      leftColumnIndex: first,
      columnCount: last - first + 1,
    },
    cameFrom: landing > leftColumnIndex ? [...others, ...moving] : [...moving, ...others],
    endsOfTable:
      wholeArea !== null && first >= wholeArea.leftColumnIndex && last < wholeArea.leftColumnIndex + wholeArea.columnCount
        ? null
        : {
            first: tableArea.leftColumnIndex,
            last: tableArea.leftColumnIndex + tableArea.columnCount - 1,
          },
    landsAt: landing > leftColumnIndex ? landing - columnCount : landing,
    count: columnCount,
    isToMove: landing !== leftColumnIndex,
  };
}
export function dropMovedColumnsOfTable(
  view: PageState,
  drag: MovingColumnsOfTableDrag,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition {
  let stopped = stopMovingColumnsOfTable(view);
  let moving = columnsOfTableMoving(view, reads);
  if (moving === null) return withNoEffects(stopped);
  let { sheetId } = view;
  let { area, landsAt, count } = moving;
  if (drag.landing === null) {
    let selection = selectionBetweenPositions(
      stopped,
      reads,
      {
        rowIndex: area.topRowIndex,
        columnIndex: landsAt,
      },
      {
        rowIndex: area.topRowIndex + area.rowCount - 1,
        columnIndex: landsAt + count - 1,
      },
    );
    return withNoEffects(
      selection === null
        ? stopped
        : {
            ...stopped,
            ...selection,
          },
    );
  }
  if (!moving.isToMove) return withNoEffects(stopped);
  if (refusalOfEveryEdit !== null)
    return withNoEffects({
      ...stopped,
      notice: {
        kind: 'editRefused',
        why: refusalOfEveryEdit,
        asked: 'otherEdit',
      },
    });
  let [pressedPosition, firstPosition] = [reads.positionOfCell(drag.pressed), reads.positionOfCell(drag.first)];
  if (pressedPosition === null || firstPosition === null) return withNoEffects(stopped);
  let isWholeColumns = moving.endsOfTable === null;
  let cellAt = (row: number, column: number): CellId | null => reads.cellIdAt(sheetId, row, column);
  let afterIndex = landsAt > firstPosition.columnIndex ? landsAt + count - 1 : landsAt - 1;
  let afterColumn = (moving.endsOfTable === null ? afterIndex < 0 : landsAt === moving.endsOfTable.first)
    ? null
    : cellAt(area.topRowIndex, afterIndex)?.columnId;
  let cellOfPressedRow = (columnIndex: number): CellId | null =>
    cellAt(pressedPosition.rowIndex, isWholeColumns ? columnIndex - landsAt + firstPosition.columnIndex : columnIndex);
  let pressedColumnLandsAt = landsAt + pressedPosition.columnIndex - firstPosition.columnIndex;
  let [activeIndex, cornerIndex] =
    pressedColumnLandsAt === landsAt + count - 1 ? [landsAt + count - 1, landsAt] : [landsAt, landsAt + count - 1];
  let activeCell = cellOfPressedRow(activeIndex);
  let selectionCorner = cellOfPressedRow(cornerIndex);
  if (afterColumn === undefined || activeCell === null || selectionCorner === null) return withNoEffects(stopped);
  let columnsOfMove = {
    oneColumn: drag.first.columnId,
    otherColumn: drag.last.columnId,
    afterColumn,
  };
  let edit: Edit = isWholeColumns
    ? {
        kind: 'moveColumns',
        sheetId,
        ...columnsOfMove,
      }
    : {
        kind: 'moveColumnsOfCells',
        cells: areaRefBetween(drag.table.topLeft, drag.table.bottomRight),
        ...columnsOfMove,
        widthsGoAlong: true,
      };
  let heading = cellShownText(reads.cellOnShowIn(drag.first), reads.decimalSign).trim();
  let { landsAt: _landsAt, count: _count, isToMove: _isToMove, ...moved } = moving;
  let wentTo = (isWholeColumns ? [] : moved.cameFrom).flatMap((columnIndex: number, offset: number): ColumnWentTo[] => {
    let [cameFrom, landed] = [cellAt(area.topRowIndex, columnIndex), cellAt(area.topRowIndex, area.leftColumnIndex + offset)];
    return cameFrom === null || landed === null || cameFrom.columnId === landed.columnId ? [] : [[cameFrom.columnId, landed.columnId]];
  });
  let selected = {
    ...stopped,
    activeCell,
    selectionCorner,
    rangeWalked: null,
    otherRanges: [],
  };
  let pressedLandsAt = {
    rowIndex: pressedPosition.rowIndex,
    columnIndex: pressedColumnLandsAt,
  };
  return queueEdit(
    {
      ...selected,
      scrollLeft: scrollToShowPosition(
        selected,
        reads,
        pressedLandsAt,
        {
          rows: false,
          columns: true,
        },
        'pointer',
      ).scrollLeft,
      moveOfColumnsUnanswered: {
        moved,
        before: reads,
      },
    },
    edit,
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: 'columnsOfTableMoved',
        heading: heading === '' ? null : heading,
        count,
        first: columnLetters(landsAt),
        last: columnLetters(landsAt + count - 1),
      },
      movesColumnsOfTable: {
        ...moved,
        count,
        ofTableAt: drag.table.topLeft,
        wentTo,
        before: reads,
        selectedIfNotMade: drag.selectedAtPress,
      },
    },
  );
}
export function columnGripsOfTables(view: PageState, reads: ReadsWithTextMeasurer, isEditRefused: boolean): ColumnGripOfTable[] {
  if (isEditRefused || view.mode.kind === 'editing') return [];
  if (view.dragging?.kind === 'movingColumnsOfTable') return [];
  let layout = layoutOfView(view, reads);
  let stuckHeaders = stuckHeadersOfView(view, reads, layout);
  return tablesToMoveColumnsOf(view, reads).flatMap((table) => {
    let { area, rowCountOfHeader } = table;
    let headerKept = stuckHeaders.find(
      ({ firstRowIndex, firstColumnIndex, top, showFrom }) =>
        firstRowIndex === area.topRowIndex && firstColumnIndex === area.leftColumnIndex && top >= showFrom,
    );
    return Array.from(
      {
        length: area.columnCount,
      },
      (_unused, offset): ColumnGripOfTable[] => {
        let columnIndex = area.leftColumnIndex + offset;
        let cell = reads.cellIdAt(view.sheetId, area.topRowIndex, columnIndex);
        let spansOfRows = (rowCount: number) =>
          rangeSpansOnScreen(
            {
              topRowIndex: area.topRowIndex,
              rowCount,
              leftColumnIndex: columnIndex,
              columnCount: 1,
            },
            view,
            layout,
            view,
          );
        let { across, down } = spansOfRows(rowCountOfHeader);
        let [left, right] = [Math.max(across.start, across.showFrom), Math.min(across.end, across.showTo)];
        let isHeaderShown = headerKept !== undefined || (down.start >= down.showFrom && down.start < down.showTo);
        if (cell === null || right - left < 1 || !isHeaderShown) return [];
        if (columnRunToMoveWithin(table, columnIndex, 1) === null) return [];
        let tableDown = spansOfRows(area.rowCount).down;
        return [
          {
            key: `${cell.rowId} ${cell.columnId}`,
            cell,
            left,
            top: headerKept?.top ?? down.start,
            width: right - left,
            height: headerKept?.height ?? Math.min(down.end, down.showTo) - down.start,
            extent: {
              from: Math.max(tableDown.start, tableDown.showFrom),
              to: Math.min(tableDown.end, tableDown.showTo),
            },
          },
        ];
      },
    ).flat();
  });
}
export const columnsFreeToMoveCache = new WeakMap<WorkbookReads, Map<string, boolean[]>>();
export const MOST_CELLS_IN_A_MOVE = 2800;
export const columnsReadByEffect = (effect: Effect): ColumnId[] =>
  effect.kind === 'colorScale'
    ? []
    : effect.allOf.flatMap(({ tested, condition }) =>
        [tested, ...NUMBER_OPERAND_FIELDS.map((field) => numberConditionOperand(condition, field))].flatMap((operand) =>
          operand?.kind === 'sameRowInColumn' ? [operand.c] : [],
        ),
      );
export const areaOfTableMoving = ({ table }: Pick<ColumnMoveOfPress, 'table'>, reads: WorkbookReads): CellArea | null =>
  areaOfColumnsMoved(
    {
      first: table.topLeft,
      last: table.bottomRight,
      table,
    },
    reads,
  );
export const stopMovingColumnsOfTable = (view: PageState): PageState => ({
  ...view,
  ...(view.dragging?.kind === 'movingColumnsOfTable' && view.dragging.selectedAtPress),
  dragging: null,
});
