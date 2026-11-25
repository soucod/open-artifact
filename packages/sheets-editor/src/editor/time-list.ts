import { isFormulaCell } from '../model/workbook.ts';
import { isCheckboxCell } from '../chips/checkboxes.ts';
import { activeAnchorCell, isSameCell } from '../selection/model.ts';
import { cleanEnteredCellText } from '../format/shown-text.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { timeOfDayFraction, timesTypedAs, timesFrom, shownTimeIn, secondsOfTime, timeTypedAs, shownTimeFor } from '../chips/time-of-day.ts';
import { withEntryText } from './text-looks.ts';
import { isDropdownListOutOfPlace } from '../chips/dropdown-sync.ts';
import type { PageState, TimeOfDay, TimeRow } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellFoundBy } from '../grid/geometry.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** The row of the time list a key or the pointer is on, and the row chosen, each by its time in seconds. */
export interface TimeListFocus {
  pointedAt: number | null;
  highlighted: number | null;
}
/** How the time list is moved through: picks the row to go to from the row in focus (`null` for none) and the count of rows. */
export type TimeListStep = (focusIndex: number | null, rowCount: number) => number | null;
export function isTimeCell(reads: WorkbookReads, cell: CellId): boolean {
  let { numberFormat, cellControl } = reads.formatOf(cell);
  return numberFormat.kind === 'time' && cellControl.kind !== 'dropdown' && !isFormulaCell(reads, cell) && !isCheckboxCell(reads, cell);
}
export function typedTimeText(state: PageState, reads: WorkbookReads): string | null {
  let { mode } = state;
  if (mode.kind !== 'editing' || !isTimeCell(reads, activeAnchorCell(state, reads))) return null;
  return mode.text === mode.textAtStart && (mode.isTypedOverCell !== true || mode.text === '') ? null : cleanEnteredCellText(mode.text);
}
export function timeInCell(reads: WorkbookReads, cell: CellId) {
  let value = cellValueOf(reads.cellOf(cell));
  return value?.kind === 'number' ? timeOfDayFraction(value.value) : null;
}
export function timesForTyped({ mode }: Pick<PageState, 'mode'>, typed: string, most: number): TimeOfDay[] {
  if (mode.kind !== 'editing' || mode.isTypedOverCell === true) return timesTypedAs(typed, most);
  let halfOfDayAtStart = / (AM|PM)$/.exec(mode.textAtStart)?.[1];
  if (halfOfDayAtStart === undefined) return timesTypedAs(typed, most);
  let isInSameHalf = ({ hour }: TimeOfDay) => hour >= 12 === (halfOfDayAtStart === 'PM');
  let times = timesTypedAs(typed, 1 / 0);
  let timesInOtherHalf = times.filter((time) => !isInSameHalf(time));
  return [...times.filter(isInSameHalf), ...timesInOtherHalf].slice(0, most);
}
export function timeListRows(state: PageState, reads: WorkbookReads): TimeRow[] {
  let { mode } = state;
  let cell = activeAnchorCell(state, reads);
  if (mode.kind !== 'editing' || mode.typingIn !== 'cell' || !isTimeCell(reads, cell)) return [];
  let typed = typedTimeText(state, reads);
  let times =
    typed === null
      ? timesFrom(timeInCell(reads, cell)?.time ?? DEFAULT_LIST_TIME, TIME_LIST_STEP_MINUTES, TIME_LIST_ROWS)
      : timesForTyped(state, typed, TIME_LIST_ROWS);
  let { pattern } = reads.formatOf(cell).numberFormat;
  let rows = times.map(
    (time) => ({
      time,
      shown: shownTimeIn(reads, time, pattern),
    }),
  );
  return rows.filter(
    ({ shown }, index) => rows.findIndex((row) => row.shown === shown) === index,
  );
}
export function openTimeList(state: PageState, reads: WorkbookReads): PageState {
  let rows = timeListRows(state, reads);
  let [firstRow] = rows;
  if (firstRow === undefined)
    return state.timeList === null
      ? state
      : {
          ...state,
          timeList: null,
        };
  let cell = activeAnchorCell(state, reads);
  let typed = typedTimeText(state, reads);
  let highlighted = (typed === null ? timeInCell(reads, cell)?.isExact === true : !isDigitsOnly(typed))
    ? secondsOfTime(firstRow.time)
    : null;
  return {
    ...state,
    timeList: {
      cellId: cell,
      rows,
      highlighted,
      isChosen: false,
      pointedAt: null,
    },
  };
}
export function moveInTimeList(state: PageState, how: 'chosen' | 'pointedAt', stepTo: TimeListStep): PageState {
  let { timeList } = state;
  if (timeList === null) return state;
  let { rows } = timeList;
  let focusIndex = rows.findIndex(({ time }) => secondsOfTime(time) === timeListFocusOf(timeList));
  let row = rows[stepTo(focusIndex === -1 ? null : focusIndex, rows.length) ?? -1];
  if (row === undefined) return state;
  let timeKey = secondsOfTime(row.time);
  return {
    ...state,
    timeList:
      how === 'chosen'
        ? {
            ...timeList,
            highlighted: timeKey,
            isChosen: true,
            pointedAt: null,
          }
        : {
            ...timeList,
            pointedAt: timeKey,
          },
  };
}
export function takeTimeFromList(state: PageState, reads: WorkbookReads, how: CellFoundBy): PageState {
  let { mode, timeList } = state;
  let stateShut =
    timeList === null
      ? state
      : {
          ...state,
          timeList: null,
        };
  if (mode.kind !== 'editing') return stateShut;
  let chosenKey = timeList?.isChosen === true ? timeList.highlighted : null;
  let takenKey = (how === 'key' ? timeList?.pointedAt : null) ?? chosenKey;
  let takenRow = timeList?.rows.find(({ time: rowTime }) => secondsOfTime(rowTime) === takenKey);
  let typed = typedTimeText(state, reads);
  let cell = activeAnchorCell(state, reads);
  let timeAtStart =
    isTimeCell(reads, cell) && timeInCell(reads, cell)?.isExact === true && mode.textAtStart.includes(':') ? timeTypedAs(mode.textAtStart) : null;
  let typedTime = typed === null || isDigitsOnly(typed) ? null : (timesForTyped(state, typed, 1)[0] ?? null);
  let time = takenRow?.time ?? (typed === null ? timeAtStart : typedTime);
  if (time === null && timeAtStart === null) return stateShut;
  let { pattern } = reads.formatOf(cell).numberFormat;
  let shownTimeOf = (timeToShow: TimeOfDay | null) => (timeToShow === null ? null : shownTimeFor(reads, timeToShow, pattern));
  let text = shownTimeOf(time) ?? mode.text;
  let textAtStart = shownTimeOf(timeAtStart) ?? mode.textAtStart;
  return {
    ...stateShut,
    mode: {
      ...withEntryText(mode, text),
      textAtStart,
    },
  };
}
export function keepTimeListInStep(stateBefore: PageState, state: PageState, reads: ReadsWithTextMeasurer): PageState {
  let { timeList } = state;
  if (timeList === null) return state;
  let isOnSameCell = stateBefore.timeList !== null && isSameCell(stateBefore.timeList.cellId, timeList.cellId);
  let isOnlyScrolled =
    state.gridHeight === stateBefore.gridHeight &&
    state.gridWidth === stateBefore.gridWidth &&
    state.heightUnderWhatFloats === stateBefore.heightUnderWhatFloats &&
    (state.scrollTop !== stateBefore.scrollTop || state.scrollLeft !== stateBefore.scrollLeft);
  let rows = timeListRows(state, reads);
  if (
    !(
      isSameCell(timeList.cellId, activeAnchorCell(state, reads)) &&
      !(isOnSameCell && isOnlyScrolled) &&
      !isDropdownListOutOfPlace(state, reads, state) &&
      state.menu === null &&
      state.peopleList === null &&
      state.dragging?.kind !== 'resizing' &&
      rows.length > 0
    )
  )
    return {
      ...state,
      timeList: null,
    };
  if (rows.length === timeList.rows.length && rows.every((row, index) => isSameTimeRow(row, timeList.rows[index])))
    return state;
  return timeList.isChosen && rows.some(({ time }) => secondsOfTime(time) === timeList.highlighted)
    ? {
        ...state,
        timeList: {
          ...timeList,
          rows,
          pointedAt: null,
        },
      }
    : openTimeList(state, reads);
}
export const TIME_LIST_ROWS = 5;
export const TIME_LIST_STEP_MINUTES = 30;
export const DEFAULT_LIST_TIME: TimeOfDay = {
  hour: 9,
  minute: 0,
  second: 0,
};
export const timeListFocusOf = ({ pointedAt, highlighted }: TimeListFocus): number | null => pointedAt ?? highlighted;
export const isDigitsOnly = (text: string): boolean => /^\d+$/u.test(text.trim());
export const isSameTimeRow = (row: TimeRow, otherRow: TimeRow): boolean =>
  row.shown === otherRow?.shown && secondsOfTime(row.time) === secondsOfTime(otherRow.time);
