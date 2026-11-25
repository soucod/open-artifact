import type { DecimalSignName } from '@open-artifact/sheets-core';
import { isFormulaCell } from '../model/workbook.ts';
import { isCheckboxCell, isShownCheckboxCell } from './checkboxes.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { shownTimeFor, isTwelveHourPattern, timeTypedAs, dayFractionOfTime } from './time-of-day.ts';
import { isPlainCellClick } from './dropdown-sync.ts';
import { isSameCell, activeAnchorCell, mergedAreaOrCellOf, selectionAtCell, scrollToShowActiveCell } from '../selection/model.ts';
import { withNoEffects, clearPassingNotice, NAVIGATING_MODE } from '../state/transitions.ts';
import { enterEntryEdit, queueEdit, IF_QUEUED_DEFAULTS, enterTextEdit } from '../model/edit-effects.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { isRangeInSight } from '../grid/geometry.ts';
import { layoutOfView } from '../grid/layout.ts';
import { cleanEnteredCellText } from '../format/shown-text.ts';
import { withDecimalSign } from '../format/number-signs.ts';
import { dateToSerial } from '../model/date-serials.ts';
import type { PageState, TimeOfDay } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { KindedNumberFormat, WholeCellFormat } from '../model/cell-format.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { PointerPressed } from '../state/event-reducer.ts';
import type { EnterEdit } from '../model/edit-effects.ts';
/** The time a cell holds as the calendar shows it, and an example of a time typed in the cell's format. */
export interface CalendarTime {
  held: string;
  example: string;
}
/** What the calendar does once a time is chosen: shuts, or stays open. */
export type CalendarAfterTime = 'shuts' | 'stays';
/** A time chosen in the calendar, the day it goes with when the cell holds none, and what the calendar does then. */
export interface TimeChosenInCalendar {
  time: TimeOfDay;
  today: string;
  thenCalendar: CalendarAfterTime;
}
/** What opening the calendar on a late tap needs to know of the page. */
export interface CalendarTapContext {
  reads: ReadsWithTextMeasurer;
  canEdit: boolean;
}
export function isCalendarFormat(
  { numberFormat, cellControl }: Pick<WholeCellFormat, 'numberFormat' | 'cellControl'>,
  reads: WorkbookReads,
  cell: CellId,
): boolean {
  let isNotDropdown = cellControl.kind !== 'dropdown';
  return isDateNumberFormat(numberFormat) && isNotDropdown && !isFormulaCell(reads, cell) && !isCheckboxCell(reads, cell);
}
export function isoDayInCell(reads: WorkbookReads, cell: CellId): string | null {
  let value = cellValueOf(reads.cellOf(cell));
  return value?.kind === 'number' ? isoDayOfSerial(reads, value.value) : null;
}
export function calendarTimeOfCell(reads: WorkbookReads, cell: CellId): CalendarTime | null {
  let { numberFormat } = reads.formatOf(cell);
  if (numberFormat.kind !== 'dateAndTime') return null;
  let value = cellValueOf(reads.cellOf(cell));
  let shownTime = value?.kind === 'number' ? reads.shownWithRoomForAll(value, TIME_WITH_SECONDS_FORMAT) : null;
  let [, hour = 0, minute = 0, second = 0] = (/^(\d+):(\d+):(\d+)$/.exec(shownTime ?? '') ?? []).map(Number);
  let showTime = (time: TimeOfDay) => shownTimeFor(reads, time, numberFormat.pattern) ?? '';
  return {
    held: showTime({
      hour,
      minute,
      second,
    }),
    example: showTime({
      hour: isTwelveHourPattern(numberFormat.pattern) ? 9 : 14,
      minute: 30,
      second: 0,
    }),
  };
}
export function openCalendarOnLateTap(
  stateBefore: PageState,
  pressed: PageTransition,
  pointer: Pick<PointerPressed, 'isByFinger' | 'isToldOfLate' | 'isShiftHeld'>,
  { reads, canEdit }: CalendarTapContext,
): PageTransition {
  let { state } = pressed;
  if (
    !(
      canEdit &&
      stateBefore.isOnPhone &&
      pointer.isByFinger &&
      pointer.isToldOfLate === true &&
      isPlainCellClick(pressed, pointer.isShiftHeld) &&
      isSameCell(state.activeCell, stateBefore.activeCell)
    ) ||
    stateBefore.calendar !== null
  )
    return pressed;
  return doesCellTakeCalendar(reads, activeAnchorCell(state, reads)) ? withNoEffects(withCalendarOpen(state, reads)) : pressed;
}
export function dayTypedWithTime(reads: WorkbookReads, text: string): string | null {
  let day = reads.dayTypedAs(text);
  let trailingTime = day === null ? trailingTimePattern.exec(text) : null;
  if (trailingTime === null || timeTypedAs(trailingTime[1] ?? '') === null) return day;
  return reads.dayTypedAs(text.slice(0, trailingTime.index));
}
export function pickDayInCalendar(state: PageState, reads: WorkbookReads, day: string, time: TimeOfDay | null): PageTransition {
  let cell = activeAnchorCell(state, reads);
  if (state.calendar === null || !doesCellTakeCalendar(reads, cell)) return withNoEffects(state);
  let stateShut = {
    ...state,
    calendar: null,
  };
  if (time === null && day === isoDayInCell(reads, cell))
    return withNoEffects({
      ...clearPassingNotice(stateShut),
      mode: NAVIGATING_MODE,
    });
  let edit =
    time === null || state.calendar.time === null
      ? enterEntryEdit(cell, {
          kind: 'day',
          day,
        })
      : dayAndTimeEntry(cell, day, time, reads.decimalSign);
  return queueEdit(stateShut, edit, {
    ...IF_QUEUED_DEFAULTS,
    select: state,
    done: null,
  });
}
export function enterTodayInCell(state: PageState, reads: WorkbookReads, today: string): PageTransition {
  let cell = activeAnchorCell(state, reads);
  let { kind: cellControl } = reads.formatOf(cell).cellControl;
  let controlOfCell = cellControl === 'checkbox' && !isShownCheckboxCell(reads, cell) ? 'none' : cellControl;
  if (controlOfCell !== 'none') {
    let cellArea = mergedAreaOrCellOf(reads, cell);
    if (cellArea === null) return withNoEffects(state);
    return withNoEffects({
      ...state,
      lastDone: {
        what: 'noDateEntered',
        cellHas: controlOfCell,
        cell: areaToA1AsStored(cellArea, ownRowOrderOfSheet(reads, cell.sheetId)),
      },
    });
  }
  return queueEdit(
    state,
    enterEntryEdit(cell, {
      kind: 'day',
      day: today,
    }),
    {
      ...IF_QUEUED_DEFAULTS,
      select: selectionAtCell(cell),
      done: 'todayEntered',
    },
  );
}
export function pickTimeInCalendar(state: PageState, reads: WorkbookReads, { time, today, thenCalendar }: TimeChosenInCalendar): PageTransition {
  let cell = activeAnchorCell(state, reads);
  if (state.calendar === null || state.calendar.time === null || !doesCellTakeCalendar(reads, cell)) return withNoEffects(state);
  let edit = dayAndTimeEntry(cell, state.calendar.day ?? today, time, reads.decimalSign);
  if (thenCalendar === 'shuts')
    return queueEdit(
      {
        ...state,
        calendar: null,
      },
      edit,
      {
        ...IF_QUEUED_DEFAULTS,
        select: state,
        done: null,
      },
    );
  return queueEdit(
    {
      ...state,
      lastDone: null,
    },
    edit,
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: null,
    },
  );
}
export function keepCalendarInStep(stateBefore: PageState, stateAfter: PageState, reads: ReadsWithTextMeasurer): PageState {
  let isStillEditing = stateAfter.mode.kind === 'editing' && stateBefore.mode.kind === 'editing';
  let state =
    stateAfter.timesCalendarAsked === 0 || isStillEditing
      ? stateAfter
      : {
          ...stateAfter,
          timesCalendarAsked: 0,
        };
  if (state.calendar === null) return state;
  let cell = activeAnchorCell(state, reads);
  let cellArea = mergedAreaOrCellOf(reads, cell);
  let isOnSameCell =
    stateBefore.calendar === null ||
    (isSameCell(cell, activeAnchorCell(stateBefore, reads)) && (state.mode.kind === 'editing' || stateBefore.mode.kind === 'navigating'));
  let isCellShown =
    state.menu === null &&
    cellArea !== null &&
    isRangeInSight(cellArea, state, layoutOfView(state, reads), state) &&
    doesCellTakeCalendar(reads, cell);
  if (!isOnSameCell || !isCellShown)
    return {
      ...state,
      calendar: null,
    };
  let day =
    (state.mode.kind === 'editing' ? dayTypedWithTime(reads, cleanEnteredCellText(state.mode.text)) : null) ?? isoDayInCell(reads, cell);
  let time = calendarTimeOfCell(reads, cell);
  let isSameTime = time?.held === state.calendar.time?.held && time?.example === state.calendar.time?.example;
  return day === state.calendar.day && isSameTime
    ? state
    : {
        ...state,
        calendar: {
          day,
          time,
        },
      };
}
export const EARLIEST_ISO_DAY = '0001-01-01';
export const LATEST_ISO_DAY = '9999-12-31';
export const zeroPadded = (number: number, width: number): string => String(number).padStart(width, '0');
export const isoDayOfDate = (date: Date): string =>
  `${zeroPadded(date.getFullYear(), 4)}-${zeroPadded(date.getMonth() + 1, 2)}-${zeroPadded(date.getDate(), 2)}`;
export const ISO_DAY_FORMAT = 'yyyy-mm-dd';
export const isDateNumberFormat = ({ kind }: Pick<KindedNumberFormat, 'kind'>): boolean => kind === 'date' || kind === 'dateAndTime';
export const doesCellTakeCalendar = (reads: WorkbookReads, cell: CellId): boolean => isCalendarFormat(reads.formatOf(cell), reads, cell);
export const isoDayOfSerial = (reads: WorkbookReads, serial: number): string | null =>
  reads.shownWithRoomForAll(
    {
      kind: 'number',
      value: serial,
    },
    ISO_DAY_FORMAT,
  );
export const TIME_WITH_SECONDS_FORMAT = 'h:mm:ss';
export const emptyCalendar = () => ({
  day: null,
  time: null,
});
export const withCalendarShut = (state: PageState): PageState =>
  state.calendar === null
    ? state
    : {
        ...state,
        calendar: null,
      };
export const withCalendarOpen = (state: PageState, reads: ReadsWithTextMeasurer): PageState =>
  reads.positionOfCell(state.activeCell) === null
    ? state
    : scrollToShowActiveCell(
        {
          ...state,
          calendar: emptyCalendar(),
        },
        reads,
      );
export const trailingTimePattern = /(?<=\S)\s+(\d[\d:]*\s?[ap.m]*)$/iu;
export const dayAndTimeEntry = (cell: CellId, day: string, time: TimeOfDay, decimalSign: DecimalSignName): EnterEdit =>
  enterTextEdit(cell, withDecimalSign(String(dateToSerial(day) + dayFractionOfTime(time)), decimalSign));
