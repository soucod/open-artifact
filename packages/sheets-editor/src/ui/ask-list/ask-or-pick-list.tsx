import { Combobox } from '../../kit/combobox.tsx';
import { useUiWindow } from '../../kit/theme.tsx';
import { Icon } from '../../kit/icon.tsx';
import { Tooltip } from '../../kit/tooltip.tsx';
import { Button } from '../../kit/button.tsx';
import * as React from 'react';
import {
  askFieldKeyAction,
  useFocusAskField,
  useClickGuardOnComingRows,
  agentRowHighlightProps,
  LineWhileAgentLooks,
  KeepOrDiscardBar,
} from '../../agent/agent-rows.tsx';
import type { AskFieldKeyAction, AskFieldStands, KeyInAskField } from '../../agent/agent-rows.tsx';
import { scrollItemAboveBottom } from '../menu-scroll.ts';
import { useSpentInputGuard } from './spent-input-guard.ts';
import { NO_LIST_ANSWER_TIMES, reportTimeAfterNextPaint, isWithinClickAfterUp, isTooSoonAfterListAnswer } from '../list-under-cell.tsx';
import { useCoarsePointer } from '../../app/media-queries.ts';
import { FieldShortcutButton } from './field-shortcut.tsx';
import { LiveAnnouncer } from '../live-announcer.tsx';
import type { LiveAnnouncerProps } from '../live-announcer.tsx';
import { TypedSearchAnnouncer } from '../search-announcer.tsx';
import type { FoundWords } from '../search-announcer.tsx';
import { joinWithDots } from '../../messages/conditional-format.ts';
/** A row of an ask-or-pick list. */
export interface AskListRow<RowId extends string = string> {
  id: RowId;
  drawn: React.ReactNode;
  /** The row lays out what it draws itself, wrapping, in place of one truncated line. */
  laysItselfOut?: boolean;
  /** A second, quieter line under the row. */
  second?: React.ReactNode;
  /** What is drawn before the row, such as an icon. */
  mark?: React.ReactNode;
  atEnd?: React.ReactNode;
  /** The row's text in full, for its tooltip when it is cut short. */
  inFull?: string;
  isChecked?: boolean;
  isTicked?: boolean | 'some';
  isOutOfUse?: boolean;
  easesIn?: boolean;
  isOfAgent?: boolean;
  /** The row stands where a row the user may have meant to press stood before. */
  isLikeWhatStoodThere?: boolean;
}
/** A section of rows of an ask-or-pick list, with rows that come late and rows under them. */
export interface AskListSection<RowId extends string = string> {
  id: string;
  /** The section's heading; with none, the section is set off by a line only. */
  heading: React.ReactNode;
  rows: readonly AskListRow<RowId>[];
  lateRows?: readonly AskListRow<RowId>[];
  rowsUnderLateRows?: readonly AskListRow<RowId>[];
}
/** A section of controls shown over the rows of the list. */
export interface OverListSection {
  id: string;
  heading: React.ReactNode;
  controls: React.ReactNode;
}
/** What a search of the list found, to be said. */
export interface AskListFound {
  rowOfEnter: string | null;
  count: string | null;
  note: string | null;
}
/** The rows of an ask-or-pick list now, to tell which row is lit and which Enter takes. */
export interface AskListRowsNow<RowId extends string> {
  stands: AskFieldStands;
  highlighted: RowId | null;
  doesFirstRowAnswer: boolean;
  rows: readonly Pick<AskListRow<RowId>, 'id' | 'isOutOfUse'>[];
}
/** The row the pointer last moved onto, or `null` when it moved onto no row. */
export interface RowMovedOnTo {
  row: string | null;
}
/** A click on a row of an ask-or-pick list, to weigh whether it takes the row. */
export interface RowClick {
  by: 'mouse' | 'other';
  row: string;
  lastMovedOnTo: RowMovedOnTo | null;
  haveRowsChanged: boolean;
  isHeld: boolean;
  isLitAsEnters: boolean;
  isWhereStopStood: boolean;
  isLikeWhatStoodThere: boolean;
}
/** The field of an ask-or-pick list now, as a key pressed in it finds it. */
export interface AskListFieldNow {
  typed: string;
  stands: AskFieldStands;
  isRowPointedAt: boolean;
  doesFirstRowAnswer: boolean;
  isListShut: boolean;
  isHeld: boolean;
}
/** What a key does in an ask-or-pick list: what it does in the field to ask the agent in, or steps of the list's own. */
export type AskListKeyAction = Exclude<AskFieldKeyAction, 'ask'> | 'stepBack' | 'takeRowOfEnter' | 'enter';
/** Where an arrow key moves the caret to: a stop by its index, the field, or the first row. */
export type ArrowStop = number | 'field' | 'firstRow';
/** What tells whether the words of what was found are to be said. */
export interface FoundSayingNow {
  highlighted: string | null;
  rowThatAnswers: string | null;
  isAnswerTaken: boolean;
}
/** The words of the buttons at the foot of the list. */
export interface AskListFootWords {
  keep: string;
  discard: string;
  stop: string;
}
/** Where the pointer was and what a press on the list began as. */
interface PointerOnList {
  at: [number, number] | null;
  lastMovedOnTo: RowMovedOnTo | null;
  rowsAtFirst: string;
  isPressing: boolean;
  wentDownAtMs: number | null;
}
export interface AskOrPickListProps<RowId extends string = string> {
  nameOfField: string;
  nameOfList: string;
  placeholder: string;
  text: string;
  idOfWhyFieldIsOutOfUse?: string;
  /** The list is shown without its field. */
  isFieldLeftOut?: boolean;
  mostCharacters?: number;
  stands: AskFieldStands;
  hasAnswer?: boolean;
  isAgentAtWork: boolean;
  said: LiveAnnouncerProps['words'];
  foundSaid?: (isNotComposing: boolean) => FoundWords;
  note: React.ReactNode;
  idOfAgentsNote?: string | null;
  overList?: readonly OverListSection[];
  sections: readonly AskListSection<RowId>[];
  /** What is shown in place of the rows. */
  inPlaceOfList?: React.ReactNode;
  doesFirstRowAnswer: boolean;
  rowPointedAtFirst?: RowId;
  foot: React.ReactNode;
  wordsOfFoot: AskListFootWords;
  isFootUnderRows?: boolean;
  height: string | { atMost: string };
  width: number;
  isUnderTitle?: boolean;
  /** Whether a key is meant for something other than the list, which then leaves it alone. */
  isKeyOfAnother?: (event: React.KeyboardEvent<HTMLElement>) => boolean;
  onTextChange: (text: string) => void;
  onCompositionBegun?: () => void;
  onRowPointedAt: (rowId: RowId | null) => void;
  onRowTaken: (rowId: RowId) => void;
  onEntered: () => void;
  onKept: () => void;
  onSteppedBack: () => void;
}
export function askListRowState<RowId extends string>(list: AskListRowsNow<RowId>) {
  let areLive = list.stands === 'atRest';
  let highlighted = areLive ? list.highlighted : null;
  let usableRowIds = list.rows
    .filter(({ isOutOfUse }) => isOutOfUse !== true)
    .map(({ id }) => id);
  let filled = highlighted ?? (list.doesFirstRowAnswer ? (usableRowIds[0] ?? null) : null);
  let active = areLive ? filled : null;
  return {
    areLive,
    highlighted,
    filled,
    active,
    ofEnter: active !== null && usableRowIds.includes(active) ? active : null,
  };
}
export function isRowClickAllowed(click: RowClick) {
  let { isWhereStopStood = false, isLikeWhatStoodThere = false } = click;
  if (click.isHeld || (isWhereStopStood && !isLikeWhatStoodThere)) return false;
  if (click.by !== 'mouse' || click.isLitAsEnters || isLikeWhatStoodThere) return true;
  return click.lastMovedOnTo === null ? !click.haveRowsChanged : click.lastMovedOnTo.row === click.row;
}
export function askListKeyAction(event: KeyInAskField, field: AskListFieldNow): AskListKeyAction {
  let {
    typed,
    stands,
    isRowPointedAt,
    doesFirstRowAnswer,
    isListShut,
  } = field;
  if (stands !== 'atRest' && event.key === 'Escape') return 'stepBack';
  if (stands !== 'atRest' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) return 'nothing';
  if (event.key === 'Enter' && field.isHeld) return 'nothing';
  if ((event.key === 'Home' || event.key === 'End') && typed !== '') return 'isOfField';
  let fieldAction = askFieldKeyAction(event, {
    typed,
    stands,
    isRowHighlighted: isRowPointedAt,
  });
  if (fieldAction === 'ask') return doesFirstRowAnswer ? 'takeRowOfEnter' : 'enter';
  return fieldAction === null && event.key === 'Enter' && isListShut ? 'takeRowOfEnter' : fieldAction;
}
export function nextArrowStop(
  key: string,
  from: 'field' | number,
  fieldStop: 'none' | 'first' | 'other',
  rowCount: number,
): ArrowStop | null {
  if (rowCount === 0 || (key !== 'ArrowDown' && key !== 'ArrowUp')) return null;
  let isDown = key === 'ArrowDown';
  if (from === 'field') {
    if (fieldStop === 'none') return isDown ? 0 : 'field';
    return !isDown && fieldStop === 'first' ? rowCount - 1 : null;
  }
  if (isDown) return from === rowCount - 1 ? 'firstRow' : from + 1;
  return from === 0 ? 'field' : from - 1;
}
export function isRowTextClipped(box: HTMLElement | null, rowId: string) {
  let row = box?.ownerDocument.getElementById(rowId) ?? null;
  if (box === null || row === null) return false;
  let { left: boxLeft, right: boxRight } = box.getBoundingClientRect();
  let viewportWidth = box.ownerDocument.documentElement.clientWidth;
  return (
    Math.max(boxLeft, viewportWidth - boxRight) >= TOOLTIP_ROOM_PX &&
    [...row.querySelectorAll('*:not(.sr-only, [data-mark-of-row] *)')].some(
      (element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
    )
  );
}
export function stopKeyEvent(event: React.SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}
export function usePointAtRowFirst(listRef: React.RefObject<HTMLElement | null>, rowId: string | null, onPointedAt: () => void) {
  let onPointedAtEvent = React.useEffectEvent(onPointedAt);
  React.useLayoutEffect(() => {
    let list = listRef.current;
    let row = rowId === null ? null : (list?.ownerDocument.getElementById(rowId) ?? null);
    let view = list?.ownerDocument.defaultView ?? null;
    if (list === null || row === null || view === null) return;
    row.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        movementX: 1,
      }),
    );
    onPointedAtEvent();
    let followedScrollTop: number | null = null;
    let resizeObserver = new view.ResizeObserver(() => {
      let scroller: HTMLElement | null = row.parentElement;
      while (scroller !== null && scroller !== list && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
      if (scroller === null || scroller === list) return;
      if (followedScrollTop !== null && scroller.scrollTop !== followedScrollTop) return;
      scrollItemAboveBottom(row, scroller);
      followedScrollTop = scroller.scrollTop;
    });
    resizeObserver.observe(list);
    let stopFollowing = () => resizeObserver.disconnect();
    SCROLL_FOLLOW_STOP_EVENTS.forEach(
      (eventType) =>
        list.addEventListener(eventType, stopFollowing, {
          once: true,
          passive: true,
        }),
    );
    return () => {
      stopFollowing();
      SCROLL_FOLLOW_STOP_EVENTS.forEach((eventType) => list.removeEventListener(eventType, stopFollowing));
    };
  }, [listRef, rowId]);
}
export function AskOrPickList<RowId extends string = string>({
  nameOfField,
  nameOfList,
  placeholder,
  text,
  idOfWhyFieldIsOutOfUse,
  isFieldLeftOut = false,
  mostCharacters,
  stands,
  hasAnswer = true,
  isAgentAtWork,
  said,
  foundSaid,
  note,
  idOfAgentsNote = null,
  overList = NO_OVER_LIST_SECTIONS,
  sections,
  inPlaceOfList,
  doesFirstRowAnswer,
  rowPointedAtFirst,
  foot,
  wordsOfFoot,
  isFootUnderRows = false,
  height,
  width,
  isUnderTitle = false,
  isKeyOfAnother,
  onTextChange,
  onCompositionBegun,
  onRowPointedAt,
  onRowTaken,
  onEntered,
  onKept,
  onSteppedBack,
}: AskOrPickListProps<RowId>) {
  let boxRef = React.useRef<HTMLDivElement | null>(null);
  let searchFieldRef = React.useRef<HTMLInputElement | null>(null);
  let listRef = React.useRef<HTMLDivElement | null>(null);
  let noteRef = React.useRef<HTMLDivElement | null>(null);
  let fieldRef = isFieldLeftOut ? listRef : searchFieldRef;
  let focusField = useFocusAskField(fieldRef);
  let listId = React.useId();
  let [isInSheet, setIsInSheet] = React.useState(false);
  React.useLayoutEffect(() => {
    setIsInSheet((boxRef.current?.closest('[data-presentation="sheet"]') ?? null) !== null);
  }, []);
  let allRows =
    inPlaceOfList === undefined
      ? sections.flatMap((section) => [...section.rows, ...(section.lateRows ?? []), ...(section.rowsUnderLateRows ?? [])])
      : [];
  let lateRowsRef = React.useRef<HTMLDivElement | null>(null);
  let lateRowsEaseIn = useClickGuardOnComingRows({
    rows: sections.flatMap(
      ({ lateRows = [], rowsUnderLateRows = [] }) =>
        [...lateRows, ...rowsUnderLateRows.filter(({ easesIn }) => easesIn === true)].map(
          ({ id }) => ({
            key: id,
          }),
        ),
    ),
    whereRowsCome: lateRowsRef,
    easeInMs: ROW_EASE_IN_MS,
  });
  let [highlightedRow, setHighlightedRow] = React.useState<RowId | null>(null);
  let [isRowTooltipOpen, setIsRowTooltipOpen] = React.useState(false);
  let baseHighlightedRef = React.useRef<RowId | null>(null);
  let [lastStands, setLastStands] = React.useState(stands);
  let [lastIsFieldLeftOut, setLastIsFieldLeftOut] = React.useState(isFieldLeftOut);
  if (lastStands !== stands || lastIsFieldLeftOut !== isFieldLeftOut) {
    setLastStands(stands);
    setLastIsFieldLeftOut(isFieldLeftOut);
    setHighlightedRow(null);
  }
  let spentInputGuard = useSpentInputGuard({
    box: boxRef,
    field: fieldRef,
    stands: stands === 'whileAgentWrites' ? stands : hasAnswer ? 'withAnswer' : 'otherwise',
  });
  let standsRef = React.useRef(stands);
  let isFieldLeftOutRef = React.useRef(isFieldLeftOut);
  React.useLayoutEffect(() => {
    if (standsRef.current === stands && isFieldLeftOutRef.current === isFieldLeftOut) return;
    standsRef.current = stands;
    isFieldLeftOutRef.current = isFieldLeftOut;
    let ownerDocument = boxRef.current?.ownerDocument;
    let activeElement = ownerDocument?.activeElement ?? null;
    let wasCaretInBox = activeElement === ownerDocument?.body || boxRef.current?.contains(activeElement) === true;
    if (ownerDocument?.hasFocus() !== true || !wasCaretInBox) return;
    if (isFieldLeftOut)
      listRef.current?.focus({
        preventScroll: true,
      });
    else focusField();
  });
  let {
    areLive,
    highlighted,
    filled,
    active,
    ofEnter: rowOfEnter,
  } = askListRowState({
    stands,
    highlighted: highlightedRow,
    doesFirstRowAnswer,
    rows: allRows,
  });
  let rowElementId = (rowId: RowId) =>
    `${listId}-${String(allRows.findIndex((row) => row.id === rowId))}`;
  let rowIdOfTarget = (target: EventTarget | null) => {
    let option = target instanceof Element ? target.closest('[role="option"]') : null;
    return allRows.find(({ id }) => rowElementId(id) === option?.id)?.id ?? null;
  };
  let pointerStateRef = React.useRef<PointerOnList>({
    at: null,
    lastMovedOnTo: null,
    rowsAtFirst: allRows.map(({ id }) => id).join(),
    isPressing: false,
    wentDownAtMs: null,
  });
  let onPointerMoveCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    spentInputGuard.onPointerMoved(event);
    if (event.pointerType !== 'mouse') return;
    let { at: lastAt } = pointerStateRef.current;
    let hasMoved = lastAt === null || lastAt[0] !== event.clientX || lastAt[1] !== event.clientY;
    pointerStateRef.current.at = [event.clientX, event.clientY];
    if (hasMoved)
      pointerStateRef.current.lastMovedOnTo = {
        row: rowIdOfTarget(event.target),
      };
  };
  let answerTimingRef = React.useRef(NO_LIST_ANSWER_TIMES);
  let lastActBeforePressRef = React.useRef(NO_LIST_ANSWER_TIMES.lastActAtMs);
  let wasPressOnFieldRef = React.useRef(false);
  let wasPressHeldRef = React.useRef(false);
  let heldEnterAtMsRef = React.useRef<number | null>(null);
  let lastStandsRef = React.useRef(stands);
  let pageWindow = useUiWindow();
  React.useLayoutEffect(() => {
    let isAnswerShown = stands === 'withDraft' || lastStandsRef.current === 'whileAgentWrites';
    lastStandsRef.current = stands;
    if (!isAnswerShown) return;
    return reportTimeAfterNextPaint(pageWindow, (paintedAtMs) => {
      answerTimingRef.current = {
        ...answerTimingRef.current,
        answerShownAtMs: paintedAtMs,
      };
    });
  }, [stands, pageWindow]);
  let agentRowIdsKey = [
    ...allRows.flatMap(({ id, isOfAgent }) => (isOfAgent === true ? [id] : [])),
    ...(idOfAgentsNote === null ? [] : [idOfAgentsNote]),
  ].join(`
`);
  let seenAgentRowIdsRef = React.useRef(
    new Set(
      agentRowIdsKey.split(`
`),
    ),
  );
  let agentRowsEaseEndMsRef = React.useRef(Number.NEGATIVE_INFINITY);
  React.useLayoutEffect(() => {
    let agentRowIds =
      agentRowIdsKey === ''
        ? []
        : agentRowIdsKey.split(`
`);
    let hasNewAgentRow = agentRowIds.some((rowId) => !seenAgentRowIdsRef.current.has(rowId));
    seenAgentRowIdsRef.current = new Set([...seenAgentRowIdsRef.current, ...agentRowIds]);
    if (!hasNewAgentRow) return;
    let prefersReducedMotion = pageWindow?.matchMedia('(prefers-reduced-motion:reduce)').matches === true;
    return reportTimeAfterNextPaint(pageWindow, (paintedAtMs) => {
      agentRowsEaseEndMsRef.current = paintedAtMs + (prefersReducedMotion ? 0 : ROW_EASE_IN_MS);
    });
  }, [agentRowIdsKey, seenAgentRowIdsRef, agentRowsEaseEndMsRef, pageWindow]);
  let answerTiming = () => ({
    ...answerTimingRef.current,
    answerShownAtMs: Math.max(answerTimingRef.current.answerShownAtMs, agentRowsEaseEndMsRef.current),
  });
  let noteActAt = (atMs: number) => {
    answerTimingRef.current = {
      ...answerTimingRef.current,
      lastActAtMs: atMs,
    };
  };
  let onScrollCapture = (event: React.UIEvent<HTMLDivElement>) => {
    spentInputGuard.onScrolled(event);
    let { at: lastAt } = pointerStateRef.current;
    let elementAtPointer = lastAt === null ? null : (boxRef.current?.ownerDocument.elementFromPoint(...lastAt) ?? null);
    if (elementAtPointer !== null)
      pointerStateRef.current.lastMovedOnTo = {
        row: rowIdOfTarget(elementAtPointer),
      };
  };
  let onMouseUpCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (rowIdOfTarget(event.target) !== null) event.stopPropagation();
  };
  let onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    let rowId = rowIdOfTarget(event.target);
    let {
      isPressing: isByMouse,
      lastMovedOnTo,
      rowsAtFirst,
      wentDownAtMs,
    } = pointerStateRef.current;
    pointerStateRef.current.isPressing = false;
    pointerStateRef.current.wentDownAtMs = null;
    if (event.target === fieldRef.current) return spentInputGuard.forget();
    let heldEnterAtMs = heldEnterAtMsRef.current;
    let isHeld =
      !(wentDownAtMs === null && heldEnterAtMs !== null && isWithinClickAfterUp(heldEnterAtMs, event.timeStamp)) &&
      (wentDownAtMs === null
        ? isTooSoonAfterListAnswer(answerTiming(), event.timeStamp)
        : isTooSoonAfterListAnswer(
            {
              ...answerTiming(),
              lastActAtMs: lastActBeforePressRef.current,
            },
            wentDownAtMs,
          ));
    heldEnterAtMsRef.current = null;
    noteActAt(event.timeStamp);
    let isWhereStopStood = spentInputGuard.isPressSpent({
      clientX: event.clientX,
      clientY: event.clientY,
      isByMouse,
      wentDownAtMs: wentDownAtMs ?? event.timeStamp,
      shownAtMs: answerTimingRef.current.answerShownAtMs,
    });
    wasPressHeldRef.current = isHeld || isWhereStopStood;
    if (event.target instanceof Node && noteRef.current?.contains(event.target) === true && (isHeld || isWhereStopStood)) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (rowId === null) return;
    if (
      isRowClickAllowed({
        by: isByMouse ? 'mouse' : 'other',
        row: rowId,
        lastMovedOnTo,
        haveRowsChanged: rowsAtFirst !== allRows.map(({ id }) => id).join(),
        isHeld,
        isLitAsEnters: highlighted === null && rowId === filled,
        isWhereStopStood,
        isLikeWhatStoodThere: allRows.some(
          ({ id, isLikeWhatStoodThere }) => id === rowId && isLikeWhatStoodThere === true,
        ),
      })
    )
      return;
    event.preventDefault();
    event.stopPropagation();
  };
  let ofEnter = askListRowState({
    stands,
    highlighted: null,
    doesFirstRowAnswer,
    rows: allRows,
  }).ofEnter;
  let [answerTakenWithText, setAnswerTakenWithText] = React.useState<string | null>(null);
  if (answerTakenWithText !== null && answerTakenWithText !== text) setAnswerTakenWithText(null);
  let takeRow = (rowId: RowId) => {
    if (rowId === ofEnter) setAnswerTakenWithText(text);
    onRowTaken(rowId);
  };
  let doesListGrow = doesAskListGrow({
    stands,
    isFootUnderRows,
  });
  let pointAtRow = (rowId: RowId | null) => {
    setHighlightedRow(rowId);
    setIsRowTooltipOpen(false);
    onRowPointedAt(rowId !== null && allRows.some((row) => row.id === rowId && row.isOutOfUse !== true) ? rowId : null);
  };
  let isTouch = useCoarsePointer();
  let firstUsableRowId = allRows.find(({ isOutOfUse }) => isOutOfUse !== true)?.id;
  React.useLayoutEffect(() => {
    if (!isFieldLeftOut || isTouch || highlighted !== null || firstUsableRowId === undefined) return;
    boxRef.current?.ownerDocument.getElementById(rowElementId(firstUsableRowId))?.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        movementX: 1,
      }),
    );
    if (baseHighlightedRef.current === firstUsableRowId) pointAtRow(firstUsableRowId);
  });
  usePointAtRowFirst(boxRef, rowPointedAtFirst === undefined || isTouch ? null : rowElementId(rowPointedAtFirst), () => {
    if (rowPointedAtFirst !== undefined && baseHighlightedRef.current === rowPointedAtFirst) pointAtRow(rowPointedAtFirst);
  });
  let moveBetweenArrowStops = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let arrowStops = [...(boxRef.current?.querySelectorAll<HTMLElement>('[data-stop-of-arrows]:enabled') ?? [])];
    let stopIndex = arrowStops.findIndex((stop) => stop === event.target);
    if (event.target instanceof HTMLButtonElement && event.target.closest('fieldset') !== null && isPagingKey(event.key)) {
      stopKeyEvent(event);
      return true;
    }
    if (stopIndex === -1 && event.target !== fieldRef.current) return false;
    let [firstRow] = allRows;
    let nextStop = nextArrowStop(
      event.key,
      stopIndex === -1 ? 'field' : stopIndex,
      highlighted === null ? 'none' : highlighted === firstRow?.id ? 'first' : 'other',
      stands === 'atRest' ? arrowStops.length : 0,
    );
    if (nextStop === null) return false;
    stopKeyEvent(event);
    if (typeof nextStop === 'number') {
      pointAtRow(null);
      arrowStops[nextStop]?.focus();
      arrowStops[nextStop]?.scrollIntoView({
        block: 'nearest',
      });
      return true;
    }
    fieldRef.current?.focus();
    if (nextStop === 'field' || firstRow === undefined) return true;
    let firstRowElement = boxRef.current?.ownerDocument.getElementById(rowElementId(firstRow.id));
    firstRowElement?.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        movementX: 1,
      }),
    );
    if (baseHighlightedRef.current === firstRow.id) pointAtRow(firstRow.id);
    firstRowElement?.scrollIntoView({
      block: 'nearest',
    });
    return true;
  };
  let shownOverList = stands === 'atRest' ? overList : NO_OVER_LIST_SECTIONS;
  let withOverList = (list: React.ReactNode) =>
    shownOverList.length === 0
      ? list
      : <div className="scroll-fade-y flex min-h-0 flex-1 flex-col overflow-y-auto">{shownOverList.map(
              ({ id, heading, controls }) =>
                <fieldset key={id} aria-labelledby={`${listId}-${id}`} className="m-0 flex min-w-0 shrink-0 flex-col border-0 p-0"><div id={`${listId}-${id}`} className="px-md pt-2 pb-1 text-footnote font-medium text-muted select-none">{heading}</div>{controls}<Combobox.Separator className="forced-colors:bg-[CanvasText]" /></fieldset>,
            )}{list}</div>;
  let onKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return event.stopPropagation();
    if (isKeyOfAnother?.(event) === true) return;
    if (moveBetweenArrowStops(event)) return;
    if (event.target !== fieldRef.current && event.key !== 'Escape') return;
    pointerStateRef.current.wentDownAtMs = null;
    pointerStateRef.current.isPressing = false;
    let isEnterSpent = event.key === 'Enter' && spentInputGuard.isEnterSpent();
    let isAgentsRowOfEnter =
      idOfAgentsNote !== null || allRows.some(({ id, isOfAgent }) => id === rowOfEnter && isOfAgent === true);
    if (event.key !== 'Enter') spentInputGuard.forget();
    let isHeld =
      event.key === 'Enter' &&
      (isEnterSpent ||
        isTooSoonAfterListAnswer(highlighted === null && !isAgentsRowOfEnter ? answerTimingRef.current : answerTiming(), event.timeStamp));
    if (event.key === 'Enter') noteActAt(event.timeStamp);
    let keyAction = askListKeyAction(event, {
      typed: text,
      stands,
      isRowPointedAt: highlighted !== null,
      doesFirstRowAnswer: rowOfEnter !== null,
      isListShut: isInSheet,
      isHeld,
    });
    heldEnterAtMsRef.current = keyAction === null && event.key === 'Enter' ? event.timeStamp : null;
    if (keyAction === null) return;
    if (keyAction === 'isOfField') return event.stopPropagation();
    switch ((stopKeyEvent(event), keyAction)) {
      case 'nothing':
        return;
      case 'empty':
        return onTextChange('');
      case 'stepBack':
        focusField();
        return onSteppedBack();
      case 'keep':
        return onKept();
      case 'enter':
        return onEntered();
      case 'takeRowOfEnter':
        return rowOfEnter === null ? undefined : takeRow(rowOfEnter);
    }
  };
  let rowHighlightClass = (rowId: RowId) => {
    if (highlighted !== null) return '';
    return rowId === filled ? agentRowHighlightProps.className : 'data-[highlighted]:bg-transparent!';
  };
  let renderRow = ({
    id,
    drawn,
    laysItselfOut = false,
    second,
    mark,
    atEnd,
    inFull,
    isChecked = false,
    isTicked,
    isOutOfUse = false,
    easesIn = false,
  }: AskListRow<RowId>) => {
    let item = <Combobox.Item key={id} render={<div id={rowElementId(id)} />} value={id} aria-selected={isChecked || undefined} aria-checked={isTicked === 'some' ? 'mixed' : isTicked} disabled={isOutOfUse || !areLive} description={second} className={`${!areLive && !isOutOfUse ? 'opacity-100!' : ''} ${easesIn ? 'sheet-row-eases-in' : ''} ${rowHighlightClass(id)}`}><span className={`flex w-full items-center gap-2 ${laysItselfOut ? 'whitespace-normal' : ''}`}>{mark !== undefined &&
              <span data-mark-of-row="" className="contents">{mark}</span>}{laysItselfOut
              ? drawn
              : <span className="min-w-0 flex-1 truncate">{drawn}</span>}{atEnd !== undefined &&
              <span className="max-w-[60%] shrink-0 truncate text-footnote text-muted">{atEnd}</span>}{isChecked &&
              <span className="flex shrink-0 text-accent"><Icon name="Check" size="md" /></span>}</span></Combobox.Item>;
    let tooltipText = inFull ?? (typeof drawn === 'string' ? drawn : undefined);
    return tooltipText === undefined
      ? item
      : <Tooltip key={id} content={tooltipText} side="inline-end" sideOffset={10} collisionAvoidance={{
              fallbackAxisSide: 'none',
            }} hoverable={false} open={id === highlighted && isRowTooltipOpen}>{item}</Tooltip>;
  };
  let stepBack = () => {
    focusField();
    onSteppedBack();
  };
  return <div ref={boxRef} role="presentation" className={`flex max-h-[var(--available-height)] max-w-[var(--available-width)] flex-col p-[var(--ui-menu-gutter,0.25rem)] [[data-presentation=sheet]_&]:w-full! [[data-presentation=sheet]_&]:max-w-none ${isUnderTitle ? 'min-h-0' : ''}`} style={typeof height === 'string'
        ? {
            height,
            width,
          }
        : {
            maxHeight: `min(${height.atMost}, var(--available-height))`,
            width,
          }} onKeyDownCapture={onKeyDownCapture} onCompositionStartCapture={onCompositionBegun} onPointerMoveCapture={onPointerMoveCapture} onWheelCapture={spentInputGuard.onWheel} onPointerCancelCapture={spentInputGuard.forget} onPointerDownCapture={(event) => {
      pointerStateRef.current.isPressing = event.pointerType === 'mouse';
      pointerStateRef.current.wentDownAtMs = event.timeStamp;
      wasPressOnFieldRef.current = event.target === fieldRef.current;
      if (wasPressOnFieldRef.current) return;
      lastActBeforePressRef.current = answerTimingRef.current.lastActAtMs;
      noteActAt(event.timeStamp);
    }} onPointerUpCapture={(event) => {
      if (!wasPressOnFieldRef.current) noteActAt(event.timeStamp);
      if (event.button === 0) return;
      pointerStateRef.current.wentDownAtMs = null;
      pointerStateRef.current.isPressing = false;
    }} onMouseUpCapture={onMouseUpCapture} onClickCapture={onClickCapture} onScrollCapture={onScrollCapture}>{isInSheet &&
        !isFieldLeftOut &&
        <FieldShortcutButton name={nameOfField} field={searchFieldRef} />}<Combobox.Root inline open={!isInSheet} {...(isFieldLeftOut && {
          inputRef: makeInputReadOnly,
        })} filter={null} items={allRows.map(({ id }) => id)} value={null} inputValue={text} onInputValueChange={(typedText, { reason }) => {
          if (reason !== 'input-change' && typedText !== '') return;
          onTextChange(typedText);
        }} onItemHighlighted={(rowId, { reason }) => {
          baseHighlightedRef.current = rowId ?? null;
          if (reason === 'none' && rowId !== undefined && highlightedRow !== null && rowId !== highlightedRow) {
            boxRef.current?.ownerDocument.getElementById(rowElementId(highlightedRow))?.dispatchEvent(
              new MouseEvent('mousemove', {
                bubbles: true,
                movementX: 1,
              }),
            );
            if (baseHighlightedRef.current === highlightedRow) return;
          }
          let nowHighlighted = reason === 'none' ? null : (rowId ?? null);
          setHighlightedRow(nowHighlighted);
          setIsRowTooltipOpen(nowHighlighted !== null && isRowTextClipped(boxRef.current, rowElementId(nowHighlighted)));
          let isUsable = allRows.some((row) => row.id === nowHighlighted && row.isOutOfUse !== true);
          onRowPointedAt(isUsable ? nowHighlighted : null);
        }} onValueChange={(rowId, details) => {
          details.cancel();
          if (rowId !== null) takeRow(rowId);
        }}>{!isFieldLeftOut &&
            (<div className={`relative -mx-[var(--ui-menu-gutter,0.25rem)] -mt-[var(--ui-menu-gutter,0.25rem)] sheet-divider-under-field shrink-0 ${inPlaceOfList === undefined ? 'mb-1' : ''}`}><Combobox.PopupSearch ref={searchFieldRef} aria-label={nameOfField} aria-activedescendant={active === null ? undefined : rowElementId(active)} {...(inPlaceOfList !== undefined && {
                    'aria-expanded': false,
                    'aria-controls': undefined,
                  })} aria-describedby={idOfWhyFieldIsOutOfUse} placeholder={placeholder} readOnly={!areLive || idOfWhyFieldIsOutOfUse !== undefined} maxLength={mostCharacters} spellCheck={false} onKeyDown={(event) => {
                    if (isKeyOfAnother?.(event) === true) event.preventBaseUIHandler();
                  }} className={`m-0 w-full border-b-0 ${areLive && idOfWhyFieldIsOutOfUse === undefined ? '' : 'text-muted'}`} />{isAgentAtWork && <LineWhileAgentLooks />}</div>)}<LiveAnnouncer words={said} />{foundSaid !== undefined &&
            (<TypedSearchAnnouncer typed={text} found={(isNotComposing) =>
                shouldAnnounceFound({
                  highlighted,
                  rowThatAnswers: ofEnter,
                  isAnswerTaken: answerTakenWithText !== null,
                }) && foundSaid(isNotComposing)} />)}<div ref={noteRef} className="contents">{note}</div>{inPlaceOfList === undefined
            ? withOverList(
                (<Combobox.List ref={listRef} aria-label={nameOfList} {...(isFieldLeftOut && {
                    tabIndex: 0,
                    'aria-activedescendant': active === null ? undefined : rowElementId(active),
                  })} className={shownOverList.length > 0 ? 'max-h-none! flex-none! overflow-visible!' : doesListGrow ? undefined : 'flex-initial'} {...lateRowsEaseIn}>{sections.map((section, sectionIndex) => {
                    let { id: sectionId, heading, rows, lateRows = [] } = section;
                    let lateRowsGroup =
                      section.lateRows !== undefined &&
                      (<div ref={lateRowsRef} role="presentation">{lateRows.map(
                          (row) =>
                            renderRow({
                              ...row,
                              easesIn: true,
                            }),
                        )}</div>);
                    return heading === null
                      ? (<div key={sectionId} role="presentation">{sectionIndex > 0 &&
                                <Combobox.Separator className="forced-colors:bg-[CanvasText]" />}{rows.map(renderRow)}{lateRowsGroup}{section.rowsUnderLateRows?.map(renderRow)}</div>)
                      : (<Combobox.Group key={sectionId}>{sectionIndex > 0 &&
                                sections[sectionIndex - 1]?.heading !== null &&
                                <Combobox.Separator className="forced-colors:bg-[CanvasText]" />}<Combobox.GroupLabel>{heading}</Combobox.GroupLabel>{rows.map(renderRow)}{lateRowsGroup}{section.rowsUnderLateRows?.map(renderRow)}</Combobox.Group>);
                  })}</Combobox.List>),
              )
            : <div className={`scroll-fade-y min-h-0 overflow-y-auto pt-1 ${doesListGrow ? 'flex-1' : ''}`}>{inPlaceOfList}</div>}{stands === 'atRest' &&
            foot !== null &&
            <Combobox.Footer>{foot}</Combobox.Footer>}{stands === 'whileAgentWrites' &&
            inPlaceOfList === undefined &&
            <Combobox.Footer className={`flex justify-end ${isFootUnderRows ? 'px-md pt-2 pb-1' : 'p-1'}`}><Button variant="ghost" shortcut="esc" onClick={stepBack}>{wordsOfFoot.stop}</Button></Combobox.Footer>}{stands === 'withDraft' &&
            (<Combobox.Footer className={isFootUnderRows ? 'px-md pt-2 pb-1' : 'p-1'}><KeepOrDiscardBar words={wordsOfFoot} onKept={() => {
                  if (wasPressHeldRef.current) return;
                  focusField();
                  onKept();
                }} onDiscarded={stepBack} /></Combobox.Footer>)}</Combobox.Root></div>;
}
export const doesAskListGrow = (list: { stands: AskFieldStands; isFootUnderRows: boolean }) =>
  list.stands === 'atRest' || !list.isFootUnderRows;
export const NO_OVER_LIST_SECTIONS: readonly OverListSection[] = [];
export const askListFoundSaid =
  (found: AskListFound | null) =>
  (withRowOfEnter: boolean): FoundWords => {
    if (found === null) return false;
    let parts = [withRowOfEnter ? found.rowOfEnter : null, found.count, found.note].filter((part) => part !== null);
    return parts.length > 0 && joinWithDots(parts);
  };
export const shouldAnnounceFound = (saying: FoundSayingNow) =>
  (saying.highlighted === null || saying.highlighted === saying.rowThatAnswers) && !saying.isAnswerTaken;
export const labelWithCount = (label: React.ReactNode, count: React.ReactNode, isCountRead: boolean = true) =>
  <span className="flex items-baseline justify-between gap-2"><span>{label}</span>{count !== null &&
        <span aria-hidden={!isCountRead} className="font-normal tabular-nums">{count}</span>}</span>;
export const isPagingKey = (key: string) => key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown';
export const ARROW_STOP_ATTRIBUTES = {
  'data-stop-of-arrows': '',
};
export const TOOLTIP_ROOM_PX = 256;
export const ROW_EASE_IN_MS = 240;
export const makeInputReadOnly = (field: HTMLInputElement | null) => field?.setAttribute('readonly', '');
export const SCROLL_FOLLOW_STOP_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'];
