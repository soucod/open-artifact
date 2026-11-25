import { FieldError, FieldRoot } from '../kit/field.tsx';
import { TextInput } from '../kit/text-input.tsx';
import { Calendar } from '../kit/calendar.tsx';
import { Popover } from '../kit/popover.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { timeTypedAs, secondsOfTime } from './time-of-day.ts';
import { enterTimeHint, timeValueLabel } from '../i18n/grid-action-labels.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { offerKeyboardWhenReady } from '../ui/keyboard-handoff.ts';
import { comboboxAriaProps } from '../ui/list-under-cell.tsx';
import { isoDayOfDate, EARLIEST_ISO_DAY, LATEST_ISO_DAY } from './calendar.ts';
import { useCoveredUnderCells, popupCollisionPadding } from '../shell/bottom-insets.ts';
import { useOnPhone } from '../app/media-queries.ts';
import { DOUBLE_TAP_GAP_MS } from '../selection/finger-taps.ts';
import { calendarLabel } from '../i18n/ui-labels.ts';
import type { CalendarAfterTime, CalendarTime } from './calendar.ts';
import type { CalendarOpen, PageState, TimeOfDay } from '../state/initial-state.ts';
import type { AnchorOnPage, ListboxIds } from './people-list-view.tsx';
/** How a time typed in the calendar was given: by a press outside it, the Tab key, or the Enter key. */
export type TimeChosenBy = 'pressOutside' | 'tabKey' | 'enterKey';
export interface CalendarTimeRowProps {
  time: CalendarTime;
  timeNotEnteredRef: React.RefObject<TimeOfDay | null>;
  onTodayChosen: () => void;
  onTimeChosen: (time: TimeOfDay, how: TimeChosenBy) => void;
  onShut: () => void;
}
export interface CalendarKeyWatcherProps {
  doesDayTakeIt: boolean;
  isShut: boolean;
  onShut: () => void;
  onKeyBroughtIt: (event: KeyboardEvent) => void;
}
/** What the calendar under the cell shows, and what it has seen of the page since it last opened. */
export interface CalendarUnderCellState {
  calendar: PageState['calendar'];
  day: string | null;
  time: CalendarTime | null;
  timesOpened: number;
  dayThatCameWithTime: string | null;
  isCaretOnDays: boolean;
  timesAnswered: number;
  isGivenUp: boolean;
  isEntryOpen: boolean;
  timesAsked: number;
}
export interface CalendarUnderCellProps extends Pick<CalendarUnderCellState, 'calendar' | 'isEntryOpen' | 'timesAsked'> {
  popupRef: React.RefObject<HTMLDivElement | null>;
  anchor: AnchorOnPage;
  whatHasCaretAfter: () => HTMLElement | false;
  isKeyboardLeftOutside: () => boolean;
  onGivenUp: (ifStill: CalendarOpen) => void;
  onShut: () => void;
  onDayChosen: (day: string, time: TimeOfDay | null) => void;
  onTimeChosen: (time: TimeOfDay, today: string, thenCalendar: CalendarAfterTime) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyBroughtCaret: (event: KeyboardEvent) => void;
}
export function wrapTabInCalendar(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  let focusables = [...event.currentTarget.querySelectorAll<HTMLElement>('button:enabled, [tabindex="0"], input:enabled')];
  let [edgeElement, wrapTo] = event.shiftKey ? [focusables.at(0), focusables.at(-1)] : [focusables.at(-1), focusables.at(0)];
  if (edgeElement !== event.currentTarget.ownerDocument.activeElement) return;
  event.preventDefault();
  wrapTo?.focus({
    preventScroll: true,
  });
}
export function swallowKeyEvent(event: React.SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}
export function CalendarTimeRow({
  time,
  timeNotEnteredRef,
  onTodayChosen,
  onTimeChosen,
  onShut,
}: CalendarTimeRowProps) {
  let [typedTime, setTypedTime] = React.useState<string | null>(null);
  let [isTimeRefused, setIsTimeRefused] = React.useState(false);
  let timeInputRef = React.useRef<HTMLInputElement>(null);
  let timeButtonRef = React.useRef<HTMLButtonElement>(null);
  let rowRef = React.useRef<HTMLDivElement>(null);
  let isTyping = typedTime !== null;
  let isFocusMovingRef = React.useRef(false);
  let isLeavingByTabRef = React.useRef(false);
  React.useEffect(() => {
    if (!isFocusMovingRef.current) return;
    isFocusMovingRef.current = false;
    (isTyping ? timeInputRef : timeButtonRef).current?.focus({
      preventScroll: true,
    });
  }, [isTyping]);
  React.useEffect(() => {
    let rowDocument = rowRef.current?.ownerDocument;
    let onPointerDownOutside = ({ target }: Event) => {
      let timeNotEntered = timeNotEnteredRef.current;
      let dialog = rowRef.current?.closest('[role="dialog"]');
      let isInsideDialog = target instanceof Node && dialog?.contains(target) === true;
      if (timeNotEntered === null || isInsideDialog) return;
      timeNotEnteredRef.current = null;
      onTimeChosen(timeNotEntered, 'pressOutside');
    };
    rowDocument?.addEventListener('pointerdown', onPointerDownOutside, true);
    return () => rowDocument?.removeEventListener('pointerdown', onPointerDownOutside, true);
  }, [timeNotEnteredRef, onTimeChosen]);
  React.useEffect(
    () => () => {
      timeNotEnteredRef.current = null;
    },
    [timeNotEnteredRef],
  );
  let typeTime = (timeText: string | null) => {
    let typedTimeParsed = timeTypedAs(timeText ?? '');
    let heldTime = timeTypedAs(time.held);
    let isSameAsHeld = typedTimeParsed !== null && heldTime !== null && secondsOfTime(typedTimeParsed) === secondsOfTime(heldTime);
    timeNotEnteredRef.current = isSameAsHeld ? null : typedTimeParsed;
    setIsTimeRefused(false);
    setTypedTime(timeText);
  };
  let startTyping = (timeText: string | null) => {
    isFocusMovingRef.current = true;
    typeTime(timeText);
  };
  let timeRefusal = isTimeRefused ? enterTimeHint(time.example.replace(' ', ' ')) : null;
  return <FieldRoot invalid={isTimeRefused} className="sheet-divider-over-group w-0 min-w-full pt-sm"><div ref={rowRef} className="flex items-center justify-between"><Button variant="secondary" size="sm" onClick={onTodayChosen}>{sheetMessages.today()}</Button>{typedTime === null
            ? (<Button ref={timeButtonRef} variant="ghost" size="sm" aria-label={timeValueLabel(time.held)} onClick={() => startTyping(time.held)} onKeyDown={(event) => {
                  if (!(event.key.length === 1 && event.key !== ' ') || event.ctrlKey || event.metaKey) return;
                  event.preventDefault();
                  event.stopPropagation();
                  startTyping(event.key);
                }}>{time.held}</Button>)
            : (<TextInput ref={timeInputRef} size="sm" fullWidth={false} className="w-24 text-end" aria-label={sheetMessages.time()} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={typedTime} onFocus={({ currentTarget }) => {
                  if (typedTime === time.held) currentTarget.select();
                }} onChange={({ target }) => typeTime(target.value)} onBlur={() => {
                  if (isLeavingByTabRef.current) typeTime(null);
                  isLeavingByTabRef.current = false;
                }} onKeyDown={(event) => {
                  if (event.key !== 'Tab') event.stopPropagation();
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  let timeNotEntered = timeNotEnteredRef.current;
                  if (event.key === 'Escape') startTyping(null);
                  if (event.key === 'Tab') {
                    isLeavingByTabRef.current = true;
                    if (timeNotEntered !== null) onTimeChosen(timeNotEntered, 'tabKey');
                  }
                  if (event.key !== 'Enter') return;
                  if (timeNotEntered !== null) onTimeChosen(timeNotEntered, 'enterKey');
                  else if (timeTypedAs(typedTime) === null) setIsTimeRefused(true);
                  else onShut();
                }} />)}</div>{timeRefusal !== null &&
        <FieldError match>{timeRefusal}</FieldError>}<p role="alert" className="sr-only">{timeRefusal}</p></FieldRoot>;
}
export function CalendarKeyWatcher(props: CalendarKeyWatcherProps) {
  let markerRef = React.useRef<HTMLSpanElement>(null);
  let [doesDayTakeKeys] = React.useState(props.doesDayTakeIt);
  let { isShut } = props;
  let onShutEvent = React.useEffectEvent(props.onShut);
  let onKeyBroughtItEvent = React.useEffectEvent(props.onKeyBroughtIt);
  React.useEffect(() => {
    let calendarBox = markerRef.current?.parentElement ?? null;
    if (calendarBox === null || !doesDayTakeKeys || isShut) return;
    let focusDay = () =>
      calendarBox.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')?.focus({
        preventScroll: true,
      });
    let isInsideCalendar = ({ target }: Event) =>
      target instanceof Node && calendarBox.closest(`#${CALENDAR_UNDER_CELL_ID}`)?.contains(target) === true;
    return offerKeyboardWhenReady(calendarBox, focusDay, {
      keys: {
        onShut: onShutEvent,
        handOn: (event: KeyboardEvent) => {
          if (!isInsideCalendar(event)) onKeyBroughtItEvent(event);
        },
      },
    });
  }, [doesDayTakeKeys, isShut]);
  return <span ref={markerRef} hidden />;
}
export function nextCalendarUnderCellState(
  state: CalendarUnderCellState,
  { calendar, isEntryOpen, timesAsked }: Pick<CalendarUnderCellState, 'calendar' | 'isEntryOpen' | 'timesAsked'>,
  isKeyboardLeftOutside: () => boolean,
): CalendarUnderCellState {
  let isAskedAgain = calendar !== null && timesAsked > state.timesAsked;
  let keepsCaretOnDays = state.calendar !== null && isEntryOpen === state.isEntryOpen && state.isCaretOnDays;
  let isCaretOnDays = isAskedAgain || (calendar !== null && keepsCaretOnDays);
  let doesDayTakeKeys = doesCalendarDayTakeKeys({
    isEntryOpen,
    timesAsked,
    isCaretOnDays,
  });
  let isGivenUp = calendar !== null && (state.isGivenUp || doesDayTakeKeys) && isKeyboardLeftOutside();
  let shownFrom = calendar === null || isGivenUp ? state : calendar;
  let isReopened = state.isGivenUp && !isGivenUp;
  return {
    calendar,
    day: shownFrom.day,
    time: shownFrom.time,
    timesOpened: state.timesOpened + (calendar !== null && (state.calendar === null || isReopened) ? 1 : 0),
    dayThatCameWithTime: state.calendar === null ? null : state.dayThatCameWithTime,
    isCaretOnDays,
    timesAnswered: state.timesAnswered + (isAskedAgain && !isGivenUp ? 1 : 0),
    isGivenUp,
    isEntryOpen,
    timesAsked,
  };
}
export const CALENDAR_UNDER_CELL_ID = 'calendar-under-cell';
export const CALENDAR_REOPEN_DELAY_MS = 50;
export const CALENDAR_GIVE_UP_EVENTS = ['focus', 'pointerdown', 'click', 'keydown'];
export const calendarCellComboboxProps = (
  isOpen: boolean,
  listbox: ListboxIds | null,
): Pick<React.HTMLAttributes<HTMLElement>, 'role' | 'aria-expanded' | 'aria-haspopup' | 'aria-autocomplete' | 'aria-controls' | 'aria-activedescendant'> =>
  listbox !== null
    ? comboboxAriaProps(true, listbox)
    : {
        role: 'combobox',
        'aria-haspopup': 'dialog',
        'aria-expanded': isOpen,
        ...(isOpen && {
          'aria-controls': CALENDAR_UNDER_CELL_ID,
        }),
      };
export const doesCalendarDayTakeKeys = ({
  isEntryOpen,
  timesAsked,
  isCaretOnDays,
}: Pick<CalendarUnderCellState, 'isEntryOpen' | 'timesAsked' | 'isCaretOnDays'>): boolean => !isEntryOpen || (timesAsked > 0 && isCaretOnDays);
export const initialCalendarUnderCellState = ({
  isEntryOpen,
  timesAsked,
}: Pick<CalendarUnderCellState, 'isEntryOpen' | 'timesAsked'>): CalendarUnderCellState => ({
  calendar: null,
  day: null,
  time: null,
  timesOpened: 0,
  dayThatCameWithTime: null,
  isCaretOnDays: false,
  timesAnswered: 0,
  isGivenUp: false,
  isEntryOpen,
  timesAsked,
});
export const CalendarUnderCell = React.memo(function ({
  popupRef,
  calendar,
  anchor,
  isEntryOpen,
  timesAsked,
  whatHasCaretAfter,
  isKeyboardLeftOutside,
  onGivenUp,
  onShut,
  onDayChosen,
  onTimeChosen,
  onKeyDown,
  onKeyBroughtCaret,
}: CalendarUnderCellProps) {
  let [calendarState, setCalendarState] = React.useState(
    () =>
      initialCalendarUnderCellState({
        isEntryOpen,
        timesAsked,
      }),
  );
  if (!(calendar === calendarState.calendar && isEntryOpen === calendarState.isEntryOpen && timesAsked === calendarState.timesAsked))
    setCalendarState(
      nextCalendarUnderCellState(
        calendarState,
        {
          calendar,
          isEntryOpen,
          timesAsked,
        },
        isKeyboardLeftOutside,
      ),
    );
  let { isGivenUp } = calendarState;
  React.useEffect(() => {
    if (!isGivenUp || calendar === null) return;
    let giveUp = () => onGivenUp(calendar);
    giveUp();
    let controller = new AbortController();
    for (let eventType of CALENDAR_GIVE_UP_EVENTS)
      window.addEventListener(eventType, giveUp, {
        capture: true,
        signal: controller.signal,
      });
    return () => controller.abort();
  }, [isGivenUp, calendar, onGivenUp]);
  let onKeyDownInCalendar = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      wrapTabInCalendar(event);
      onKeyDown(event);
    },
    [onKeyDown],
  );
  let isKeyFreshRef = React.useRef(false);
  let onBlurInCalendar = React.useCallback(({ currentTarget, relatedTarget }: React.FocusEvent<HTMLDivElement>) => {
    if (relatedTarget instanceof Node && !currentTarget.contains(relatedTarget)) isKeyFreshRef.current = false;
  }, []);
  let swallowHeldKeys = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!event.repeat) isKeyFreshRef.current = true;
    else if (!isKeyFreshRef.current) swallowKeyEvent(event);
  }, []);
  let noteCaretOnDays = React.useCallback(
    () =>
      setCalendarState(
        (shown) =>
          shown.isCaretOnDays
            ? shown
            : {
                ...shown,
                isCaretOnDays: true,
              },
      ),
    [],
  );
  let noteCaretLeftDays = React.useCallback(({ currentTarget, relatedTarget }: React.FocusEvent<HTMLDivElement>) => {
    if (!(relatedTarget instanceof Node && currentTarget.contains(relatedTarget)))
      setCalendarState(
        (shown) =>
          shown.isCaretOnDays
            ? {
                ...shown,
                isCaretOnDays: false,
              }
            : shown,
      );
  }, []);
  let timeNotEnteredRef = React.useRef<TimeOfDay | null>(null);
  let chooseDay = React.useCallback((day: string) => onDayChosen(day, timeNotEnteredRef.current), [onDayChosen]);
  let chooseToday = React.useCallback(() => chooseDay(isoDayOfDate(new Date())), [chooseDay]);
  let chooseTime = React.useCallback(
    (time: TimeOfDay, how: TimeChosenBy) => {
      let today = isoDayOfDate(new Date());
      if (how === 'tabKey')
        setCalendarState(
          (shown) =>
            shown.day === null
              ? {
                  ...shown,
                  dayThatCameWithTime: today,
                }
              : shown,
        );
      onTimeChosen(time, today, how === 'enterKey' ? 'shuts' : 'stays');
    },
    [onTimeChosen],
  );
  let onOpenChange = React.useCallback(
    (isOpen: boolean) => {
      if (!isOpen) onShut();
    },
    [onShut],
  );
  let coveredUnderCells = useCoveredUnderCells();
  let isOnPhone = useOnPhone();
  let { timesOpened } = calendarState;
  let [shownTimesOpened, setShownTimesOpened] = React.useState(timesOpened);
  let isReopenHeld = isOnPhone && shownTimesOpened !== timesOpened;
  React.useEffect(() => {
    if (!isReopenHeld) return;
    let showReopened = () => setShownTimesOpened(timesOpened);
    let timer = setTimeout(showReopened, DOUBLE_TAP_GAP_MS);
    let controller = new AbortController();
    let listenerOptions = {
      capture: true,
      signal: controller.signal,
    };
    window.addEventListener('pointerdown', () => clearTimeout(timer), listenerOptions);
    let restartTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(showReopened, CALENDAR_REOPEN_DELAY_MS);
    };
    for (let eventType of ['pointerup', 'pointercancel']) window.addEventListener(eventType, restartTimer, listenerOptions);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isReopenHeld, timesOpened]);
  let calendarKey = `${timesOpened} ${calendarState.timesAnswered} ${calendarState.day === calendarState.dayThatCameWithTime ? null : calendarState.day}`;
  return <Popover.Root open={calendar !== null && !calendarState.isGivenUp && !isReopenHeld} onOpenChange={onOpenChange}><Popover.Popup ref={popupRef} id={CALENDAR_UNDER_CELL_ID} anchor={anchor} align="start" collisionPadding={popupCollisionPadding(coveredUnderCells)} padding="sm" aria-label={calendarLabel()} initialFocus={false} finalFocus={whatHasCaretAfter} keepFocus onFocusCapture={onBlurInCalendar} onKeyDownCapture={swallowHeldKeys} onKeyDown={onKeyDownInCalendar}><div className="flex flex-col gap-sm"><div className="contents" onFocus={noteCaretOnDays} onBlur={noteCaretLeftDays}><Calendar key={calendarKey} aria-label={sheetMessages.dateToPick()} value={calendarState.day} onChange={chooseDay} minDate={EARLIEST_ISO_DAY} maxDate={LATEST_ISO_DAY} /><CalendarKeyWatcher key={`after ${calendarKey}`} doesDayTakeIt={!calendarState.isGivenUp &&
                    doesCalendarDayTakeKeys({
                      ...calendarState,
                      isEntryOpen,
                      timesAsked,
                    })} isShut={calendar === null || calendarState.isGivenUp} onShut={onShut} onKeyBroughtIt={onKeyBroughtCaret} /></div>{calendarState.time === null
            ? <div className="sheet-divider-over-group pt-sm"><Button variant="secondary" size="sm" onClick={chooseToday}>{sheetMessages.today()}</Button></div>
            : <CalendarTimeRow key={calendarState.timesOpened} time={calendarState.time} timeNotEnteredRef={timeNotEnteredRef} onTodayChosen={chooseToday} onTimeChosen={chooseTime} onShut={onShut} />}</div></Popover.Popup></Popover.Root>;
});
