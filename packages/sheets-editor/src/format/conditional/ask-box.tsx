import { Collapsible } from '../../kit/collapsible.tsx';
import { FieldDescription, FieldError, FieldRoot } from '../../kit/field.tsx';
import { TextInput } from '../../kit/text-input.tsx';
import { TextLink } from '../../kit/text-link.tsx';
import { useUiWindow } from '../../kit/theme.tsx';
import { Icon } from '../../kit/icon.tsx';
import type { AskFieldStands } from '../../agent/agent-rows.tsx';
import type { IconName } from '../../kit/icon.tsx';
import type { TextLinkProps } from '../../kit/text-link.tsx';
import type { Effect } from '@open-artifact/sheets-core';
import type { MessagePart } from '../../i18n/messages.ts';
import type { ConditionalFormatsOfPane } from '../../view/page-view.ts';
import type { PANE_START_ATTRIBUTE } from '../../ui/side-pane/side-pane.tsx';
import * as React from 'react';
import { cardRowFrameProps, CARD_ROW_HOVER_CLASSES } from '../../ui/card-rows.tsx';
import {
  agentRowHighlightProps,
  agentRowButtonProps,
  SampleRow,
  agentRowClassProps,
  AskForMoreRow,
  useFocusAskField,
  askFieldKeyAction,
  useLastByKey,
  rowKeysStamp,
  useClickGuardOnComingRows,
  SuggestedHeading,
  LineWhileAgentLooks,
  AgentWritingRow,
  WriteWithAgentRow,
  AgentRowContent,
} from '../../agent/agent-rows.tsx';
import { useCoarsePointer } from '../../app/media-queries.ts';
import { useSpentInputGuard } from '../../ui/ask-list/spent-input-guard.ts';
import { NO_LIST_ANSWER_TIMES, isTooSoonAfterListAnswer, reportTimeAfterNextPaint, isWithinClickAfterUp } from '../../ui/list-under-cell.tsx';
import { ContentsBox } from '../../ui/contents-box.tsx';
import { LiveAnnouncer } from '../../ui/live-announcer.tsx';
/** A row of the ask box: a sample of what it makes, and what it says. */
export interface AskBoxRow {
  key: string;
  sample: React.ReactNode;
  title: MessagePart[];
  /** Absent on the row that stands for several rules. */
  second?: string;
}
/** What the agent wrote and has yet to be kept: the row Enter keeps, and the rows shown under it. */
export interface AgentDraft {
  toTake: AskBoxRow;
  shown: AskBoxRow[];
}
/** The words of the ask box. */
export interface AskBoxWords {
  placeholder: string;
  write: string;
  writes: string;
  stop: string;
  hasFailed: string;
  suggested: string;
  suggestedSaid: string;
  askForMore: string;
  moreHasFailed: string;
  draftSaid: string;
}
/** Why the ask cannot be met here, and the words of the link to the chat. */
export interface ChatInsteadWords {
  whyNotHere: string;
  goThere: string;
}
export interface ChatInstead extends ChatInsteadWords {
  onAsked: (words: string) => void;
}
/** How far the agent is with more suggestions. */
export type MoreOfAgent = 'isLookedFor' | 'hasFailed' | 'canBeAsked';
/** A kind of rule the box offers to set up by hand. */
export interface KindToSetUp {
  key: Effect['kind'];
  icon: IconName;
  label: string;
}
/** The handlers that swallow a press that comes too soon after the pane changed. */
export interface PressGuardHandlers {
  onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUpCapture: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancelCapture: () => void;
  onKeyDownCapture: () => void;
  onMouseDownCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
  onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
}
/** Where the mouse rests over the suggestions, so a row that comes under a still mouse is not taken. */
export interface PointerRest {
  /** Where the mouse last was, in client pixels. */
  at: { x: number; y: number } | null;
  /** The suggestion the mouse last moved onto; `null` until it moves. */
  lastMovedOnTo: { row: Element | null } | null;
  haveRowsChanged: boolean;
}
/** A press in the box, with the time of the act before it. */
interface BoxPress {
  beganAtMs: number;
  actBeforeAtMs: number;
  isByMouse: boolean;
}
/** The words Escape emptied the field of, so undo can bring them back. */
interface EmptiedWords {
  words: string;
  changesAskedFor: number;
}
interface ShownSuggestions {
  rows: AskBoxRow[];
  /** What more the agent offers; never `'isLookedFor'`, which is kept as null. */
  more: MoreOfAgent | null;
}
interface AgentDraftRowProps {
  answer: AgentDraft;
  name: string;
  isTakenByEnter: boolean;
  onPressed: () => void;
}
interface SuggestionRowProps {
  row: AskBoxRow;
  onPointedAt: (key: string | null) => void;
  onTaken: (key: string) => void;
}
interface AskForMoreButtonProps {
  words: AskBoxWords;
  onAsked: () => void;
}
interface GoToChatInsteadProps extends ChatInsteadWords, TextLinkProps {
  onTaken: () => void;
}
interface RuleAskBoxProps {
  words: AskBoxWords;
  typed: string;
  onTyped: (typed: string) => void;
  changesAskedFor: number;
  fieldRef: React.RefObject<HTMLInputElement | null>;
  /** Spread on the first stop of the box, so the pane can find where it starts. */
  markOfStart: Record<typeof PANE_START_ATTRIBUTE, true>;
  agent: ConditionalFormatsOfPane['agent'];
  draft: AgentDraft | null;
  own: AskBoxRow[];
  ofAgent: AskBoxRow[];
  moreOfAgent: MoreOfAgent | null;
  kindsToSetUp: KindToSetUp[];
  ofAgentRef: React.RefObject<HTMLUListElement | null>;
  chatInstead: ChatInstead | null;
  onAsked: (words: string) => void;
  onStopped: () => void;
  onKept: () => void;
  onDiscarded: () => void;
  onKindSetUp: (kind: Effect['kind']) => void;
  onPointedAt: (key: string | null) => void;
  onTaken: (key: string) => void;
  onAskedForMore: () => void;
  deafToPointer: PressGuardHandlers;
}
export function withPointerAt(rest: PointerRest, pointer: { x: number; y: number; row: Element | null }): PointerRest {
  let at = {
    x: pointer.x,
    y: pointer.y,
  };
  if (rest.at === null)
    return {
      ...rest,
      at,
    };
  if (rest.at.x === at.x && rest.at.y === at.y) return rest;
  return {
    ...rest,
    at,
    lastMovedOnTo: {
      row: pointer.row,
    },
  };
}
export function AgentDraftRow(props: AgentDraftRowProps) {
  let { answer, name: listName, isTakenByEnter, onPressed } = props;
  return <div className="sheet-comes-in-pane flex min-w-0 flex-col pb-2"><div className={`${cardRowFrameProps.className} ${CARD_ROW_HOVER_CLASSES} ${isTakenByEnter ? agentRowHighlightProps.className : ''}`}><button type="button" data-stop-of-walk className={agentRowButtonProps.className} onKeyDown={(event) => {
            if (event.repeat && event.key === 'Enter') event.preventDefault();
          }} onClick={onPressed}><SampleRow row={answer.toTake} /></button></div>{answer.shown.length > 0 &&
        (<ul aria-label={listName} className="flex flex-col">{answer.shown.map(
            (row) =>
              <li key={row.key} className={cardRowFrameProps.className}><div className={agentRowButtonProps.className}><SampleRow row={row} /></div></li>,
          )}</ul>)}</div>;
}
export function SuggestionRow(props: SuggestionRowProps) {
  let { row, onPointedAt, onTaken } = props;
  let { key } = row;
  return <li className={`${cardRowFrameProps.className} ${CARD_ROW_HOVER_CLASSES}`}><button type="button" data-stop-of-walk data-suggestion className={agentRowButtonProps.className} onKeyDown={(event) => {
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
      }} onPointerMove={() => onPointedAt(key)} onPointerLeave={() => onPointedAt(null)} onFocus={() => onPointedAt(key)} onBlur={() => onPointedAt(null)} onClick={() => onTaken(key)}><SampleRow row={row} /></button></li>;
}
export function AskForMoreButton(props: AskForMoreButtonProps) {
  let { words, onAsked } = props;
  return <div className={`${cardRowFrameProps.className} ${CARD_ROW_HOVER_CLASSES}`}><button type="button" data-stop-of-walk className={agentRowClassProps.className} onClick={onAsked}><AskForMoreRow words={words} /></button></div>;
}
export function GoToChatInstead({ whyNotHere, goThere, onTaken, ...linkProps }: GoToChatInsteadProps) {
  return <>{whyNotHere}{' '}<TextLink inheritColor className="whitespace-nowrap" onMouseDown={(event) => event.preventDefault()} onClick={onTaken} {...linkProps}>{goThere}</TextLink></>;
}
export function RuleAskBox(props: RuleAskBoxProps) {
  let {
    words,
    typed,
    onTyped,
    changesAskedFor,
    fieldRef,
    markOfStart,
    agent,
    draft,
  } = props;
  const { own, ofAgent, kindsToSetUp, ofAgentRef, chatInstead } = props;
  let { onAsked, onStopped, onKept, onDiscarded, onKindSetUp } = props;
  let { onTaken, onAskedForMore, deafToPointer } = props;
  let pointedRef = React.useRef<string | null>(null);
  let pointAt = (key: string | null) => {
    if (key !== null || pointedRef.current !== null) props.onPointedAt(key);
    pointedRef.current = key;
  };
  let isCoarse = useCoarsePointer();
  let [isFieldFocused, setFieldFocused] = React.useState(false);
  let [wordsAsked, setWordsAsked] = React.useState<string | null>(null);
  let headingId = React.useId();
  let boxRef = React.useRef<HTMLDivElement>(null);
  let keepFieldFocus = useFocusAskField(fieldRef);
  let trimmed = typed.trim();
  let canAsk = agent !== 'writes' && draft === null;
  let hasFailed = agent === 'hasFailed';
  let isFailedForTyped = hasFailed && typed === wordsAsked;
  const isForChat = isFailedForTyped && chatInstead !== null;
  let ask = () => {
    if (trimmed === '' || !canAsk) return;
    keepFieldFocus();
    if (isForChat) return chatInstead.onAsked(trimmed);
    setWordsAsked(typed);
    return onAsked(trimmed);
  };
  let walkByArrows = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let stops = [...(boxRef.current?.querySelectorAll<HTMLElement>('[data-stop-of-walk]') ?? [])];
    let stopIndex = stops.findIndex((stop) => stop === event.target);
    if (stopIndex < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.length === 1 && event.key !== ' ' && event.target !== fieldRef.current)
      fieldRef.current?.focus({
        preventScroll: true,
      });
    if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.shiftKey) return;
    let nextStop = stops[stopIndex + (event.key === 'ArrowDown' ? 1 : -1)];
    event.stopPropagation();
    if (nextStop === undefined) return;
    event.preventDefault();
    nextStop.focus({
      focusVisible: true,
    });
  };
  let hasDraft = draft !== null;
  let spentPresses = useSpentInputGuard({
    box: boxRef,
    field: fieldRef,
    stands: agent === 'writes' ? 'whileAgentWrites' : hasDraft ? 'withAnswer' : 'otherwise',
  });
  let timesRef = React.useRef(NO_LIST_ANSWER_TIMES);
  let noteAct = (atMs: number) => {
    timesRef.current = {
      ...timesRef.current,
      lastActAtMs: atMs,
    };
  };
  let pressRef = React.useRef<BoxPress | null>(null);
  let isPressOnFieldRef = React.useRef(false);
  let pointerUpAtRef = React.useRef<number | null>(null);
  let spaceDownAtRef = React.useRef<number | null>(null);
  let lastPressRef = React.useRef<BoxPress | null>(null);
  let isTooSoon = ({ beganAtMs, actBeforeAtMs }: Pick<BoxPress, 'beganAtMs' | 'actBeforeAtMs'>) =>
    isTooSoonAfterListAnswer(
      {
        ...timesRef.current,
        lastActAtMs: actBeforeAtMs,
      },
      beganAtMs,
    );
  let keep = (press: BoxPress) => {
    if (!isTooSoon(press)) onKept();
  };
  let askNow = (press: BoxPress) => {
    if (!isFailedForTyped || !isTooSoon(press)) ask();
  };
  let isAgentWriting = agent === 'writes';
  let wasWritingRef = React.useRef(isAgentWriting);
  let pageWindow = useUiWindow();
  React.useLayoutEffect(() => {
    let isAnswerShown = hasDraft || hasFailed || (wasWritingRef.current && !isAgentWriting);
    wasWritingRef.current = isAgentWriting;
    if (!isAnswerShown) return;
    return reportTimeAfterNextPaint(pageWindow, (shownAtMs: number) => {
      timesRef.current = {
        ...timesRef.current,
        answerShownAtMs: shownAtMs,
      };
    });
  }, [hasDraft, hasFailed, isAgentWriting, pageWindow]);
  let emptiedRef = React.useRef<EmptiedWords | null>(null);
  let onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return event.stopPropagation();
    let isUndoKey = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
    let undone = typed === '' ? undoneWordsFor(emptiedRef.current, changesAskedFor) : null;
    if (isUndoKey && undone !== null) {
      event.preventDefault();
      event.stopPropagation();
      spentPresses.forget();
      pointAt(null);
      onTyped(undone);
      emptiedRef.current = null;
      return;
    }
    let press: BoxPress = {
      beganAtMs: event.timeStamp,
      actBeforeAtMs: timesRef.current.lastActAtMs,
      isByMouse: false,
    };
    if (event.key === 'Enter') noteAct(event.timeStamp);
    let isEnterSpent = event.key === 'Enter' ? spentPresses.isEnterSpent() : spentPresses.forget();
    let stands: AskFieldStands = draft !== null ? 'withDraft' : canAsk ? 'atRest' : 'whileAgentWrites';
    let isUndoOrRedoKey = (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase());
    let keyAct = askFieldKeyAction(event, {
      typed,
      stands: isUndoOrRedoKey && stands === 'withDraft' ? 'atRest' : stands,
    });
    if (keyAct === null) return;
    event.stopPropagation();
    if (keyAct === 'isOfField') return;
    event.preventDefault();
    if (keyAct === 'ask' && isEnterSpent !== true) askNow(press);
    if (keyAct === 'keep' && isEnterSpent !== true) keep(press);
    if (keyAct === 'empty') {
      emptiedRef.current = {
        words: typed,
        changesAskedFor,
      };
      onTyped('');
    }
    return;
  };
  let isAtRest = canAsk && trimmed === '';
  let isMoreLookedFor = props.moreOfAgent === 'isLookedFor';
  let more = isMoreLookedFor ? null : props.moreOfAgent;
  let hasSuggestions = ofAgent.length > 0 || more !== null;
  let shownSuggestions: ShownSuggestions = useLastByKey(
    hasSuggestions
      ? {
          rows: ofAgent,
          more,
        }
      : null,
    ({ rows, more: moreKind }: ShownSuggestions) => `${moreKind} ${rowKeysStamp(rows)}`,
  ) ?? {
    rows: [],
    more: null,
  };
  let shownRows: AskBoxRow[] = useLastByKey(ofAgent.length > 0 ? ofAgent : null, rowKeysStamp) ?? [];
  let suggestionsRef = React.useRef<HTMLDivElement>(null);
  let moreSuggestionsRef = React.useRef<HTMLDivElement>(null);
  let rowsEaseIn = useClickGuardOnComingRows({
    rows: ofAgent,
    whereRowsCome: suggestionsRef,
    easeInMs: own.length === 0 ? 0 : SUGGESTIONS_EASE_IN_MS,
  });
  let rowsKey = rowKeysStamp(ofAgent);
  let answerShownAtRef = React.useRef(Number.NEGATIVE_INFINITY);
  let answerKey = isAtRest ? rowsKey : '';
  let answerKeyRef = React.useRef(answerKey);
  React.useLayoutEffect(() => {
    let lastAnswerKey = answerKeyRef.current;
    answerKeyRef.current = answerKey;
    if (answerKey === '' || answerKey === lastAnswerKey) return;
    let isMotionReduced = pageWindow?.matchMedia('(prefers-reduced-motion:reduce)').matches === true;
    return reportTimeAfterNextPaint(pageWindow, (shownAtMs: number) => {
      answerShownAtRef.current = shownAtMs + (isMotionReduced ? 0 : SUGGESTIONS_EASE_IN_MS);
    });
  }, [answerKey, pageWindow]);
  let take = (key: string) => {
    let lastPress = lastPressRef.current;
    if (
      !(
        lastPress !== null &&
        ofAgent.some((row) => row.key === key) &&
        isTooSoonAfterListAnswer(
          {
            answerShownAtMs: answerShownAtRef.current,
            lastActAtMs: lastPress.actBeforeAtMs,
          },
          lastPress.beganAtMs,
        )
      )
    )
      onTaken(key);
  };
  let pointerRestRef = React.useRef(NO_POINTER_REST);
  let isPointerAway = (target: EventTarget | null) => {
    let row = suggestionButtonOf(target);
    return row !== null && !isPointerStillOn(pointerRestRef.current, row);
  };
  let rowsChangeKey = `${isAtRest} ${rowKeysStamp(own)} ${rowsKey}`;
  let rowsChangeKeyRef = React.useRef(rowsChangeKey);
  React.useLayoutEffect(() => {
    if (rowsChangeKey === rowsChangeKeyRef.current) return;
    rowsChangeKeyRef.current = rowsChangeKey;
    pointerRestRef.current = withRowsChanged(pointerRestRef.current);
  }, [rowsChangeKey]);
  React.useEffect(() => {
    let ownerDocument = boxRef.current?.ownerDocument;
    let wheelAt = Number.NEGATIVE_INFINITY;
    let onWheel = ({ timeStamp }: WheelEvent) => {
      wheelAt = timeStamp;
    };
    let onScroll = ({ target, timeStamp }: Event) => {
      let { at: pointerAt } = pointerRestRef.current;
      if (pointerAt === null || !(target instanceof Node) || !target.contains(boxRef.current)) return;
      let isWheelScroll = timeStamp - wheelAt < SCROLL_AFTER_WHEEL_MS;
      if (isWheelScroll) wheelAt = timeStamp;
      let elementUnderPointer = isWheelScroll ? (ownerDocument?.elementFromPoint(pointerAt.x, pointerAt.y) ?? null) : null;
      pointerRestRef.current = withMovedOnTo(pointerRestRef.current, elementUnderPointer === null ? null : suggestionButtonOf(elementUnderPointer));
    };
    let onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons !== 0 || event.target === null) return;
      let [clientX, clientY] = [event.clientX, event.clientY];
      pointerRestRef.current = withPointerAt(pointerRestRef.current, {
        x: clientX,
        y: clientY,
        row: suggestionButtonOf(event.target),
      });
    };
    ownerDocument?.addEventListener('pointermove', onPointerMove, {
      capture: true,
      passive: true,
    });
    ownerDocument?.addEventListener('wheel', onWheel, {
      capture: true,
      passive: true,
    });
    ownerDocument?.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      ownerDocument?.removeEventListener('pointermove', onPointerMove, {
        capture: true,
      });
      ownerDocument?.removeEventListener('wheel', onWheel, {
        capture: true,
      });
      ownerDocument?.removeEventListener('scroll', onScroll, {
        capture: true,
      });
    };
  }, []);
  let focusField = React.useCallback(() => {
    ((isCoarse ? null : fieldRef.current) ?? boxRef.current?.querySelector<HTMLButtonElement>('button[data-stop-of-walk]'))?.focus({
      preventScroll: true,
    });
  }, [isCoarse, fieldRef]);
  React.useLayoutEffect(() => {
    let hasFocusInSuggestions = [suggestionsRef.current, moreSuggestionsRef.current].some(
      (list) => list?.contains(list.ownerDocument.activeElement) === true,
    );
    if (!hasSuggestions && hasFocusInSuggestions) focusField();
  }, [hasSuggestions, focusField]);
  let rowOfSuggestion = (row: AskBoxRow) =>
    <SuggestionRow key={row.key} row={row} onPointedAt={pointAt} onTaken={take} />;
  let moreState = own.length === 0 ? shownSuggestions.more : more;
  let moreFailedNote =
    moreState === 'hasFailed' &&
    (<p aria-hidden className="pt-1 ps-lg pe-md text-footnote text-secondary">{words.moreHasFailed}</p>);
  let askForMore =
    moreState !== null &&
    (<AskForMoreButton words={words} onAsked={() => {
        focusField();
        onAskedForMore();
      }} />);
  let suggestedHeading = (isSaidInFull: boolean) =>
    <SuggestedHeading id={headingId} words={words} isSaidInFull={isSaidInFull} />;
  return <ContentsBox ref={boxRef} onKeyDown={walkByArrows} onPointerDownCapture={(event: React.PointerEvent<HTMLDivElement>) => {
      if (event.isPrimary) {
        pressRef.current = {
          beganAtMs: event.timeStamp,
          actBeforeAtMs: timesRef.current.lastActAtMs,
          isByMouse: event.pointerType === 'mouse',
        };
        pointerUpAtRef.current = null;
        isPressOnFieldRef.current = event.target instanceof Element && event.target.closest('[data-ui=TextInput]') !== null;
        if (!isPressOnFieldRef.current) noteAct(event.timeStamp);
      }
      deafToPointer.onPointerDownCapture(event);
      rowsEaseIn.onPointerDownCapture(event);
    }} onKeyDownCapture={(event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== fieldRef.current) spentPresses.forget();
      pressRef.current = null;
      if (event.key !== ' ' || event.target === fieldRef.current) spaceDownAtRef.current = null;
      else if (!event.repeat) spaceDownAtRef.current = event.timeStamp;
      deafToPointer.onKeyDownCapture();
    }} onKeyUpCapture={(event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === ' ')
        setTimeout(() => {
          spaceDownAtRef.current = null;
        });
    }} onPointerMoveCapture={spentPresses.onPointerMoved} onBlurCapture={(event: React.FocusEvent<HTMLDivElement>) => {
      spentPresses.onCaretLeft(event);
      if (!(event.relatedTarget instanceof Node && boxRef.current?.contains(event.relatedTarget) === true)) spaceDownAtRef.current = null;
    }} onMouseDownCapture={(event: React.MouseEvent<HTMLDivElement>) => {
      deafToPointer.onMouseDownCapture(event);
      if (pressRef.current?.isByMouse === true && isPointerAway(event.target)) event.preventDefault();
    }} onPointerUpCapture={(event: React.PointerEvent<HTMLDivElement>) => {
      deafToPointer.onPointerUpCapture(event);
      rowsEaseIn.onPointerUpCapture(event);
      if (!event.isPrimary) return;
      pointerUpAtRef.current = event.timeStamp;
      if (!isPressOnFieldRef.current) noteAct(event.timeStamp);
      if (event.button !== 0) pressRef.current = null;
    }} onPointerCancelCapture={(event: React.PointerEvent<HTMLDivElement>) => {
      spentPresses.forget();
      deafToPointer.onPointerCancelCapture();
      if (!event.isPrimary || pressRef.current === null) return;
      pressRef.current = null;
      if (!isPressOnFieldRef.current) noteAct(event.timeStamp);
    }} onClickCapture={(event: React.MouseEvent<HTMLDivElement>) => {
      let pointerUpAt = pointerUpAtRef.current;
      let pointerPress = pointerUpAt === null || isWithinClickAfterUp(pointerUpAt, event.timeStamp) ? pressRef.current : null;
      lastPressRef.current = pointerPress ?? {
        beganAtMs: spaceDownAtRef.current ?? event.timeStamp,
        actBeforeAtMs: timesRef.current.lastActAtMs,
        isByMouse: false,
      };
      pressRef.current = null;
      spaceDownAtRef.current = null;
      let isOnField = event.target instanceof Element && event.target.closest('[data-ui=TextInput]') !== null;
      if (!isOnField && !(pointerPress !== null && isPressOnFieldRef.current)) noteAct(event.timeStamp);
      if (isOnField) spentPresses.forget();
      else if (
        spentPresses.isPressSpent({
          clientX: event.clientX,
          clientY: event.clientY,
          isByMouse: lastPressRef.current.isByMouse,
          wentDownAtMs: lastPressRef.current.beganAtMs,
          shownAtMs: timesRef.current.answerShownAtMs,
        })
      ) {
        event.stopPropagation();
        keepFieldFocus();
      }
      deafToPointer.onClickCapture(event);
      rowsEaseIn.onClickCapture(event);
      if (lastPressRef.current.isByMouse && isPointerAway(event.target)) event.stopPropagation();
    }}><section className="flex min-w-0 shrink-0 flex-col pt-md">{agent !== null &&
            (<FieldRoot invalid={isFailedForTyped && !isForChat} className={`${cardRowFrameProps.className} flex-col items-stretch px-2`}><div className="relative"><TextInput ref={fieldRef} data-stop-of-walk fullWidth dir="auto" aria-label={words.placeholder} autoComplete="off" spellCheck={false} enterKeyHint="go" placeholder={words.placeholder} readOnly={agent === 'writes'} value={typed} {...(!isCoarse && markOfStart)} onFocus={() => setFieldFocused(true)} onBlur={() => {
                        emptiedRef.current = null;
                        setFieldFocused(false);
                      }} onChange={(event) => {
                        emptiedRef.current = null;
                        pointAt(null);
                        if (draft !== null) onDiscarded();
                        onTyped(event.target.value);
                      }} onKeyDown={onFieldKeyDown} />{isMoreLookedFor &&
                      <LineWhileAgentLooks isOnBox />}</div>{isFailedForTyped &&
                  !isForChat &&
                  <FieldError match className="leading-4">{words.hasFailed}</FieldError>}{isForChat &&
                  (<FieldDescription className="leading-4"><GoToChatInstead whyNotHere={chatInstead.whyNotHere} goThere={chatInstead.goThere} data-stop-of-walk onTaken={() => {
                        if (lastPressRef.current !== null) askNow(lastPressRef.current);
                      }} /></FieldDescription>)}</FieldRoot>)}<div className="flex min-w-0 flex-col pt-2">{agent === 'writes' &&
                (<AgentWritingRow words={words} onStopped={() => {
                    keepFieldFocus();
                    onStopped();
                  }} />)}{canAsk &&
                agent !== null &&
                trimmed !== '' &&
                !isForChat &&
                (<div className={`${cardRowFrameProps.className} ${CARD_ROW_HOVER_CLASSES} ${isFieldFocused ? agentRowHighlightProps.className : ''}`}><button type="button" data-stop-of-walk className={agentRowClassProps.className} onClick={() => {
                      if (lastPressRef.current !== null) askNow(lastPressRef.current);
                    }}><WriteWithAgentRow words={words} /></button></div>)}{draft !== null &&
                (<AgentDraftRow answer={draft} name={words.draftSaid} isTakenByEnter={isFieldFocused} onPressed={() => {
                    if (lastPressRef.current !== null) keep(lastPressRef.current);
                  }} />)}{agent !== 'writes' &&
                kindsToSetUp.map(
                  ({ key, icon, label }, index) =>
                    (<div key={key} className={`${cardRowFrameProps.className} ${CARD_ROW_HOVER_CLASSES}`}><button type="button" data-stop-of-walk className={agentRowClassProps.className} {...(index === 0 && (agent === null || isCoarse) && markOfStart)} onKeyDown={(event) => {
                            if (event.repeat && event.key === 'Enter') event.preventDefault();
                          }} onClick={() => onKindSetUp(key)}><AgentRowContent icon={<Icon name={icon} size="md" />}>{label}</AgentRowContent></button></div>),
                )}</div></section>{isAtRest &&
        own.length === 0 &&
        <Collapsible.Root open={hasSuggestions}><Collapsible.Panel ref={suggestionsRef} inert={!hasSuggestions}><section className="flex min-w-0 shrink-0 flex-col pb-2">{moreFailedNote}{askForMore}{shownSuggestions.rows.length > 0 && suggestedHeading(true)}<Collapsible.Root open={ofAgent.length > 0}><Collapsible.Panel inert={ofAgent.length === 0}><ul ref={ofAgentRef} aria-labelledby={headingId} className="flex flex-col">{shownRows.map((row) => rowOfSuggestion(row))}</ul></Collapsible.Panel></Collapsible.Root></section></Collapsible.Panel></Collapsible.Root>}{isAtRest &&
        own.length > 0 &&
        <section className="flex min-w-0 shrink-0 flex-col pb-2">{suggestedHeading(false)}<Collapsible.Root open={ofAgent.length > 0}><Collapsible.Panel ref={suggestionsRef} inert={ofAgent.length === 0}><ul ref={ofAgentRef} aria-label={words.suggestedSaid} className="flex flex-col">{shownRows.slice(0, 1).map((row) => rowOfSuggestion(row))}</ul></Collapsible.Panel></Collapsible.Root><ul aria-labelledby={headingId} className="flex flex-col">{own.map((row) => rowOfSuggestion(row))}</ul><Collapsible.Root open={ofAgent.length > 1}><Collapsible.Panel ref={moreSuggestionsRef} inert={ofAgent.length < 2}><ul aria-label={words.suggestedSaid} className="flex flex-col">{shownRows.slice(1).map((row) => rowOfSuggestion(row))}</ul></Collapsible.Panel></Collapsible.Root>{moreFailedNote}{askForMore}</section>}<LiveAnnouncer words={isForChat && goToChatInsteadWords(chatInstead)} /></ContentsBox>;
}
export const NO_POINTER_REST: PointerRest = {
  at: null,
  lastMovedOnTo: null,
  haveRowsChanged: false,
};
export const withRowsChanged = (rest: PointerRest): PointerRest => ({
  ...rest,
  haveRowsChanged: true,
});
export const withMovedOnTo = (rest: PointerRest, row: Element | null): PointerRest => ({
  ...rest,
  lastMovedOnTo: {
    row,
  },
});
export const isPointerStillOn = (rest: PointerRest, row: Element): boolean =>
  rest.lastMovedOnTo === null ? !rest.haveRowsChanged : rest.lastMovedOnTo.row === row;
export const SUGGESTIONS_EASE_IN_MS = 200;
export const SCROLL_AFTER_WHEEL_MS = 300;
export const suggestionButtonOf = (target: EventTarget | null): Element | null =>
  target instanceof Element ? target.closest('button[data-suggestion]') : null;
export const undoneWordsFor = (emptied: EmptiedWords | null, changesAskedFor: number): string | null =>
  emptied?.changesAskedFor === changesAskedFor ? emptied.words : null;
export const goToChatInsteadWords = ({ whyNotHere, goThere }: ChatInsteadWords): string => `${whyNotHere} ${goThere}`;
