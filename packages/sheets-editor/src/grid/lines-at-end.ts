import {
  rowsEndOnScreen,
  cellsAreaHeight,
  ROOM_BELOW_LAST_ROW,
  cellsAreaWidth,
  columnsEndOnScreen,
  ROOM_RIGHT_OF_LAST_COLUMN_BASE,
  cellsHeightAboveFloats,
  frozenRowsHeight,
  frozenColumnsWidth,
  ROOM_RIGHT_OF_LAST_COLUMN,
  maxScrollTop,
  maxScrollLeft,
} from './geometry.ts';
import { layoutOfView } from './layout.ts';
import { withNoEffects } from '../state/transitions.ts';
import { IF_QUEUED_DEFAULTS, queueEdit } from '../model/edit-effects.ts';
import { skipRowsAddedAfterEntries, mostRowsToInsert } from '../edits/insert-lines.ts';
import type { Edit } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import type { CaretAtEnd, PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { EndToBringIntoView, IfQueued, LinesAtEndAsked } from '../state/event-reducer.ts';
import type { GridLayout } from './layout.ts';
import type { LinesAxisName, PaneRect } from './geometry.ts';
/** How the end of the rows or the columns sits on screen, and the room around it. */
export interface EndOfLinesMeasure {
  end: number;
  sizeOfFrozen: number;
  sizeOfBody: number;
  sizeOfControl: number;
  clearRoom: number;
  isScrolledOnPastCells: boolean;
}
/** Where the control that adds columns sits across the column headers. */
export type AddColumnsControlBox = Pick<PaneRect, 'left' | 'width'>;
/** An edit that inserts rows. */
export type InsertRowsEdit = Extract<Edit, { kind: 'insertRows' }>;
/** An edit that inserts columns. */
export type InsertColumnsEdit = Extract<Edit, { kind: 'insertColumns' }>;
export function parseLineCount(text: string): number | null {
  let cleaned = text.normalize('NFKC').trim();
  if (!/^\d[\d,]*$/.test(cleaned)) return null;
  let count = Number(cleaned.replaceAll(',', ''));
  return Number.isSafeInteger(count) && count >= 1 ? count : null;
}
export function isEndOfLinesShown(what: CaretAtEnd, state: PageState, layout: GridLayout): boolean {
  let {
    end,
    sizeOfFrozen,
    sizeOfBody,
    isScrolledOnPastCells,
  } = endOfLinesMeasure(what, state, layout);
  return end < sizeOfBody && (end >= sizeOfFrozen || !isScrolledOnPastCells);
}
export function addRowsControlBox(state: PageState, layout: GridLayout, isHiddenAnyway: boolean): PaneRect | null {
  let rowsEnd = rowsEndOnScreen(state, layout);
  let hasNoRoom = roomForMoreLines('rows', layout.rowCount) === 0;
  let isEndOffScreen = !isEndOfLinesShown('rows', state, layout);
  if (isLinesAtEndControlHidden(state, isHiddenAnyway) || hasNoRoom || (isEndOffScreen && state.caretAtEnd !== 'rows')) return null;
  return {
    left: 0,
    top: isEndOffScreen ? cellsAreaHeight(state) + ROOM_BELOW_LAST_ROW : rowsEnd,
    width: cellsAreaWidth(state),
    height: ROOM_BELOW_LAST_ROW,
  };
}
export function addColumnsControlBox(state: PageState, layout: GridLayout, isHiddenAnyway: boolean): AddColumnsControlBox | null {
  let columnsEnd = columnsEndOnScreen(state, layout);
  let hasNoRoom = roomForMoreLines('columns', layout.columnCount) === 0;
  let isEndOffScreen = !isEndOfLinesShown('columns', state, layout);
  if (isLinesAtEndControlHidden(state, isHiddenAnyway) || hasNoRoom || (isEndOffScreen && state.caretAtEnd !== 'columns')) return null;
  return {
    left: isEndOffScreen ? cellsAreaWidth(state) + ROOM_RIGHT_OF_LAST_COLUMN_BASE : columnsEnd,
    width: ROOM_RIGHT_OF_LAST_COLUMN_BASE,
  };
}
export function addLinesAtEnd(state: PageState, workbook: ReadsWithTextMeasurer, event: LinesAtEndAsked): PageTransition {
  let { sheetId } = state;
  let layout = layoutOfView(state, workbook);
  let { rowCount, columnCount } = layout;
  let isRows = event.what === 'rows';
  let countNow = isRows ? rowCount : columnCount;
  if (state.mode.kind !== 'navigating' || countNow !== event.countSeen) return withNoEffects(state);
  let ifQueuedFor = (count: number): IfQueued => ({
    ...IF_QUEUED_DEFAULTS,
    select: 'placeChanged',
    endBroughtIntoView: {
      what: event.what,
      count,
    },
    done: {
      what: isRows ? 'rowsInserted' : 'columnsInserted',
    },
  });
  if (!isRows) {
    let lastCell = workbook.cellIdAt(sheetId, rowCount - 1, columnCount - 1);
    let columnsToAdd = Math.min(event.count, roomForMoreLines('columns', countNow));
    if (lastCell === null || !isLineCount(columnsToAdd)) return withNoEffects(state);
    return queueEdit(state, insertColumnsAtEndEdit(lastCell, columnsToAdd), ifQueuedFor(columnsToAdd));
  }
  let lastArea = lastRowArea(state, workbook, layout);
  let firstCellOfLastRow = workbook.cellIdAt(sheetId, lastArea.topRowIndex, 0);
  let rowsToAdd = Math.min(event.count, rowsAddableAtEnd(state, workbook, layout, lastArea));
  if (firstCellOfLastRow === null || !isLineCount(rowsToAdd)) return withNoEffects(state);
  return queueEdit(
    state,
    {
      ...insertRowsAtEndEdit(firstCellOfLastRow, rowsToAdd),
      formulasFromRow: firstCellOfLastRow.rowId,
    },
    ifQueuedFor(rowsToAdd + rowCount - lastArea.topRowIndex - 1),
  );
}
export function keepCaretAtEndInView(state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  if (state.caretAtEnd === null) return state;
  let {
    end,
    sizeOfFrozen,
    sizeOfControl,
    clearRoom,
  } = endOfLinesMeasure(state.caretAtEnd, state, layoutOfView(state, workbook));
  return end >= sizeOfFrozen && end + sizeOfControl <= clearRoom ? state : scrollToCaretAtEnd(state, workbook);
}
export function followCaretAtEnd(
  previousState: PageState,
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  previousWorkbook: ReadsWithTextMeasurer = workbook,
): PageState {
  if (previousState.caretAtEnd === null || state.sheetId !== previousState.sheetId) return state;
  let previousLayout = layoutOfView(previousState, previousWorkbook);
  if (!isEndOfLinesShown(previousState.caretAtEnd, previousState, previousLayout)) return state;
  return endOfLinesMeasure(previousState.caretAtEnd, state, layoutOfView(state, workbook)).isScrolledOnPastCells
    ? keepCaretAtEndInView(state, workbook)
    : scrollToCaretAtEnd(state, workbook);
}
export function bringEndIntoView(state: PageState, workbook: ReadsWithTextMeasurer, { what, count }: EndToBringIntoView): PageState {
  let layout = layoutOfView(state, workbook);
  let [edges, lineCount, room, roomAfterEnd] =
    what === 'rows'
      ? [layout.rowEdges, layout.rowCount, cellsHeightAboveFloats(state) - frozenRowsHeight(layout), ROOM_BELOW_LAST_ROW]
      : [layout.columnEdges, layout.columnCount, cellsAreaWidth(state) - frozenColumnsWidth(layout), ROOM_RIGHT_OF_LAST_COLUMN];
  if (edges.totalSize - edges.startOf(lineCount - count) + roomAfterEnd > room) return state;
  return what === 'rows'
    ? {
        ...state,
        scrollTop: Math.max(0, maxScrollTop(layout, state)),
      }
    : {
        ...state,
        scrollLeft: Math.max(0, maxScrollLeft(layout, state)),
      };
}
export const DEFAULT_LINES_TO_ADD = 1;
export const MOST_SHEET_LINES: Record<LinesAxisName, number> = {
  rows: 1048576,
  columns: 16384,
};
export const MOST_LINES_ADDED_AT_ONCE: Record<LinesAxisName, number> = {
  rows: 1e4,
  columns: 100,
};
export const roomForMoreLines = (what: LinesAxisName, count: number): number =>
  Math.max(0, Math.min(MOST_LINES_ADDED_AT_ONCE[what], MOST_SHEET_LINES[what] - count));
export const lastRowArea = (state: Pick<PageState, 'sheetId' | 'rowsAddedAfterEntries'>, workbook: WorkbookReads, layout: GridLayout): CellArea => ({
  topRowIndex: skipRowsAddedAfterEntries(state, workbook, layout, layout.rowCount - 1),
  leftColumnIndex: 0,
  rowCount: 1,
  columnCount: layout.columnCount,
});
export const rowsAddableAtEnd = (
  state: PageState,
  workbook: WorkbookReads,
  layout: GridLayout,
  lastArea: CellArea = lastRowArea(state, workbook, layout),
): number => Math.min(roomForMoreLines('rows', layout.rowCount), mostRowsToInsert(workbook, state.sheetId, lastArea));
export const isLinesAtEndControlHidden = (state: PageState, isHiddenAnyway: boolean): boolean =>
  isHiddenAnyway || state.sheetPointedIn !== null;
export const endOfLinesMeasure = (what: CaretAtEnd, state: PageState, layout: GridLayout): EndOfLinesMeasure =>
  what === 'rows'
    ? {
        end: rowsEndOnScreen(state, layout),
        sizeOfFrozen: frozenRowsHeight(layout),
        sizeOfBody: cellsAreaHeight(state),
        sizeOfControl: ROOM_BELOW_LAST_ROW,
        clearRoom: cellsHeightAboveFloats(state),
        isScrolledOnPastCells: state.scrollTop > maxScrollTop(layout, state),
      }
    : {
        end: columnsEndOnScreen(state, layout),
        sizeOfFrozen: frozenColumnsWidth(layout),
        sizeOfBody: cellsAreaWidth(state),
        sizeOfControl: ROOM_RIGHT_OF_LAST_COLUMN_BASE,
        clearRoom: cellsAreaWidth(state),
        isScrolledOnPastCells: state.scrollLeft > maxScrollLeft(layout, state),
      };
export const insertRowsAtEndEdit = ({ sheetId, rowId }: Pick<CellId, 'sheetId' | 'rowId'>, count: number): InsertRowsEdit => ({
  kind: 'insertRows',
  sheetId,
  afterRow: rowId,
  count,
  formatsFromRow: rowId,
  groupsFromRow: null,
});
export const insertColumnsAtEndEdit = ({ sheetId, columnId }: Pick<CellId, 'sheetId' | 'columnId'>, count: number): InsertColumnsEdit => ({
  kind: 'insertColumns',
  sheetId,
  afterColumn: columnId,
  count,
  formatsFromColumn: columnId,
  groupsFromColumn: null,
});
export const isLineCount = (count: number): boolean => Number.isInteger(count) && count >= 1;
export const scrollToCaretAtEnd = (state: PageState, workbook: ReadsWithTextMeasurer): PageState =>
  state.caretAtEnd === null
    ? state
    : bringEndIntoView(state, workbook, {
        what: state.caretAtEnd,
        count: 0,
      });
export const dropCaretAtEndOfOtherSheet = (previousState: Pick<PageState, 'sheetId'>, state: PageState): PageState =>
  state.caretAtEnd === null || state.sheetId === previousState.sheetId
    ? state
    : {
        ...state,
        caretAtEnd: null,
      };
