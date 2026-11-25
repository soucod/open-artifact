import { useUiWindow } from '../kit/theme.tsx';
import * as React from 'react';
import { NO_LIST_ANSWER_TIMES, listAnswerSettlesAtMs, reportTimeAfterNextPaint, isWithinClickAfterUp } from '../ui/list-under-cell.tsx';
import { ANSWER_HOLD_KINDS } from '../format/answer-holds.ts';
import type { AnswerSeen, HoldsOnAgentsAnswers } from '../format/answer-holds.ts';
import type { ActHoldAtAnswer } from '../format/custom-format-row.tsx';
import type { AnswerHold } from '../state/initial-state.ts';
import type { HoldOfAgentsAnswer } from '../state/event-reducer.ts';
import type { SheetController } from '../state/controller.ts';
/** The answer the acts were last counted at, and how many were held. */
export interface ActsAtAnswer {
  answerId: number;
  actsHeld: number;
}
/** Tells when an answer that landed has been seen long enough. */
export interface AnswerSeenTimer {
  noteActs(acts: ActsAtAnswer): void;
  /** Starts timing an answer that landed; gives back how to stop. */
  answerLanded(answerId: number): () => void;
}
/** How an act began: whether the answer was still held then, and whether it is no act at all. */
export interface ActBegun {
  wasHeld: boolean;
  isNoAct: boolean;
}
/** The press of a pointer being tracked: how it began, when it was let go, and which press it was. */
interface PointerActTracked extends ActBegun {
  letGoAtMs: number | null;
  nth: number;
}
/** The press of a key being tracked: whether the answer was still held then, and when it was let go. */
interface KeyActTracked {
  wasHeld: boolean;
  letGoAtMs: number | null;
}
/** Keeps the last presses of pointer and keys, to tell whether a click began before the answer was seen. */
export interface ActTracker {
  /** Gives back what to call when the pointer is let go. */
  pointerWentDown(act: ActBegun): (letGoAtMs: number) => void;
  /** Whether the press let go was an act. */
  pointerWasLetGo(button: number, letGoAtMs: number): boolean;
  pointerWasCalledOff(): void;
  keyWentDown(key: string, wasHeld: boolean, nowMs: number): void;
  keyWasLetGo(key: string, letGoAtMs: number): void;
  clicked(nowMs: number): void;
  hasBegunTooSoon(): boolean;
}
/** The hold to keep acts at, what to tell when an act is held, and which targets take no act. */
export interface ActHoldSetup {
  hold: AnswerHold | null;
  tellOfActHeld: () => void;
  isNoAct: (target: EventTarget) => boolean;
}
/** The time now, and a way to hear once that the pointer is let go. */
export interface ActClock {
  nowMs: () => number;
  oncePointerIsLetGo(target: EventTarget, onLetGo: () => void): void;
}
/** What of the store an answer seen is told to. */
type StoreToTellAnswerSeen = Pick<SheetController, 'dispatch'>;
interface AnswerSeenWatcherProps extends Pick<AnswerHold, 'answerId' | 'stands' | 'actsHeld'> {
  at: HoldOfAgentsAnswer;
  store: StoreToTellAnswerSeen;
}
interface AgentsAnswerHoldsProps {
  holds: HoldsOnAgentsAnswers;
  store: StoreToTellAnswerSeen;
}
export function createAnswerSeenTimer(view: Window, onAnswerSeen: (seen: AnswerSeen) => void, shownDelayMs: number = 0): AnswerSeenTimer {
  let answerTiming = NO_LIST_ANSWER_TIMES;
  let lastActs: ActsAtAnswer | null = null;
  let landedAnswerId: number | null = null;
  let shownAnswerId: number | null = null;
  let seenTimer: number | undefined;
  let scheduleSeen = () => {
    view.clearTimeout(seenTimer);
    let [answerId, seenAtMs] = [landedAnswerId, listAnswerSettlesAtMs(answerTiming)];
    if (answerId !== null && seenAtMs !== Number.POSITIVE_INFINITY)
      seenTimer = view.setTimeout(
        () =>
          onAnswerSeen({
            answerId,
            actsHeld: lastActs?.actsHeld ?? 0,
            sinceMs: seenAtMs,
          }),
        seenAtMs - view.performance.now(),
      );
  };
  return {
    noteActs({ answerId, actsHeld }: ActsAtAnswer) {
      if (lastActs?.answerId === answerId && lastActs.actsHeld === actsHeld) return;
      lastActs = {
        answerId,
        actsHeld,
      };
      answerTiming = {
        ...answerTiming,
        lastActAtMs: view.performance.now(),
      };
      scheduleSeen();
    },
    answerLanded(answerId: number) {
      landedAnswerId = answerId;
      let isShownAlready = shownAnswerId === answerId;
      if (isShownAlready) scheduleSeen();
      let stopWatchingFrame = isShownAlready
        ? () => {}
        : reportTimeAfterNextPaint(view, (shownAtMs: number) => {
            answerTiming = {
              ...answerTiming,
              answerShownAtMs: shownAtMs + shownDelayMs,
            };
            if (shownAtMs !== Number.POSITIVE_INFINITY) shownAnswerId = answerId;
            scheduleSeen();
          });
      return () => {
        landedAnswerId = null;
        stopWatchingFrame();
        view.clearTimeout(seenTimer);
      };
    },
  };
}
export function createActTracker(): ActTracker {
  let pointerAct: PointerActTracked | null = null;
  let pointerCount = 0;
  let keyAct: KeyActTracked | null = null;
  let wasKeyLast = false;
  let hasBegunTooSoon = false;
  return {
    pointerWentDown(act: ActBegun) {
      pointerCount += 1;
      let nth = pointerCount;
      pointerAct = {
        ...act,
        letGoAtMs: null,
        nth,
      };
      return (letGoAtMs: number) => {
        if (pointerAct?.nth !== nth) return;
        pointerAct = {
          ...pointerAct,
          letGoAtMs,
        };
        wasKeyLast = false;
      };
    },
    pointerWasLetGo(button: number, letGoAtMs: number) {
      let wasAct = pointerAct?.isNoAct === false;
      pointerAct =
        button !== 0 || pointerAct === null
          ? null
          : {
              ...pointerAct,
              letGoAtMs,
            };
      wasKeyLast = false;
      return wasAct;
    },
    pointerWasCalledOff() {
      pointerAct = null;
    },
    keyWentDown(key: string, wasHeld: boolean, nowMs: number) {
      hasBegunTooSoon = wasHeld;
      if (key === 'Enter')
        keyAct = {
          wasHeld,
          letGoAtMs: nowMs,
        };
      if (key === ' ')
        keyAct = {
          wasHeld,
          letGoAtMs: null,
        };
      if (key === 'Enter') wasKeyLast = true;
    },
    keyWasLetGo(key: string, letGoAtMs: number) {
      if (key !== ' ' || keyAct === null) return;
      keyAct = {
        ...keyAct,
        letGoAtMs,
      };
      wasKeyLast = true;
    },
    clicked(nowMs: number) {
      let isByKey = keyAct !== null && (pointerAct === null || (keyAct.letGoAtMs !== null && (pointerAct.letGoAtMs === null || wasKeyLast)));
      let act = isByKey ? keyAct : pointerAct;
      hasBegunTooSoon = act !== null && act.wasHeld && (act.letGoAtMs === null || isWithinClickAfterUp(act.letGoAtMs, nowMs));
      if (isByKey) keyAct = null;
      else pointerAct = null;
    },
    hasBegunTooSoon: () => hasBegunTooSoon,
  };
}
export function actHoldHandlers(
  tracker: ActTracker,
  { hold, tellOfActHeld, isNoAct }: ActHoldSetup,
  { nowMs: timeNow, oncePointerIsLetGo }: ActClock,
): ActHoldAtAnswer {
  let isHolding = hold !== null && hold.stands !== 'seen';
  let noteActHeld = () => {
    if (isHolding) tellOfActHeld();
  };
  return {
    handlers: {
      onPointerDownCapture({ target, timeStamp }: Pick<React.PointerEvent, 'target' | 'timeStamp'>) {
        let act = {
          wasHeld: isBeforeAnswerSeen(hold, eventTimeOrNow(timeStamp, timeNow())),
          isNoAct: isNoAct(target),
        };
        let onLetGo = tracker.pointerWentDown(act);
        oncePointerIsLetGo(target, () => onLetGo(timeNow()));
        if (!act.isNoAct) noteActHeld();
      },
      onPointerUpCapture({ button }: Pick<React.PointerEvent, 'button'>) {
        if (tracker.pointerWasLetGo(button, timeNow())) noteActHeld();
      },
      onPointerCancelCapture: tracker.pointerWasCalledOff,
      onClickCapture: () => tracker.clicked(timeNow()),
      onKeyDownCapture({ key, repeat, timeStamp }: Pick<React.KeyboardEvent, 'key' | 'repeat' | 'timeStamp'>) {
        if (repeat) return;
        tracker.keyWentDown(key, isBeforeAnswerSeen(hold, eventTimeOrNow(timeStamp, timeNow())), timeNow());
      },
      onKeyUpCapture: ({ key }: Pick<React.KeyboardEvent, 'key'>) => tracker.keyWasLetGo(key, timeNow()),
    },
    noteKeyThatTakesNothing: noteActHeld,
    howActBegan: () =>
      tracker.hasBegunTooSoon()
        ? {
            hasBegunBeforeAnswerWasSeen: true,
          }
        : {},
    isActRefused: () => isHolding || tracker.hasBegunTooSoon(),
  };
}
export function useActHoldAtAnswer(setup: ActHoldSetup): ActHoldAtAnswer {
  let [tracker] = React.useState(createActTracker);
  return actHoldHandlers(tracker, setup, BROWSER_ACT_CLOCK);
}
export const ANSWER_SEEN_DELAY_MS = {
  numberFormat: 0,
  fixes: 300,
  rowsAskedFor: 300,
};
export const answerSeenTimerFor = (holdAt: HoldOfAgentsAnswer, view: Window, store: StoreToTellAnswerSeen): AnswerSeenTimer =>
  createAnswerSeenTimer(
    view,
    (seen) =>
      store.dispatch({
        kind: 'agentsAnswerSeen',
        at: holdAt,
        ...seen,
      }),
    ANSWER_SEEN_DELAY_MS[holdAt],
  );
export const AnswerSeenWatcher = React.memo(function ({
  at: holdAt,
  answerId,
  stands,
  actsHeld,
  store,
}: AnswerSeenWatcherProps) {
  let pageWindow = useUiWindow();
  let seenTimer = React.useMemo(
    () => (pageWindow === undefined ? null : answerSeenTimerFor(holdAt, pageWindow, store)),
    [pageWindow, holdAt, store],
  );
  React.useLayoutEffect(() => (stands === 'landed' ? seenTimer?.answerLanded(answerId) : undefined), [seenTimer, stands, answerId]);
  React.useEffect(
    () =>
      seenTimer?.noteActs({
        answerId,
        actsHeld,
      }),
    [seenTimer, answerId, actsHeld],
  );
  return null;
});
export const AgentsAnswerHolds = ({ holds, store }: AgentsAnswerHoldsProps) =>
  <>{ANSWER_HOLD_KINDS.map((holdAt) => {
      let hold = holds[holdAt];
      if (hold === null) return null;
      let { answerId, stands, actsHeld } = hold;
      return <AnswerSeenWatcher key={holdAt} at={holdAt} answerId={answerId} stands={stands} actsHeld={actsHeld} store={store} />;
    })}</>;
export const EVENT_TIME_TOLERANCE_MS = 1e4;
export const eventTimeOrNow = (eventAtMs: number, nowMs: number): number =>
  nowMs - eventAtMs >= 0 && nowMs - eventAtMs < EVENT_TIME_TOLERANCE_MS ? eventAtMs : nowMs;
export const eventTimeMs = ({ timeStamp }: Pick<Event, 'timeStamp'>): number => eventTimeOrNow(timeStamp, performance.now());
export const isBeforeAnswerSeen = (hold: AnswerHold | null, atMs: number): boolean =>
  hold !== null && (hold.seenSinceMs === null || atMs < hold.seenSinceMs);
export const BROWSER_ACT_CLOCK: ActClock = {
  nowMs: () => performance.now(),
  oncePointerIsLetGo(target: EventTarget, onLetGo: () => void) {
    (target instanceof Node ? target.ownerDocument?.defaultView : null)?.addEventListener('pointerup', onLetGo, {
      once: true,
      capture: true,
    });
  },
};
