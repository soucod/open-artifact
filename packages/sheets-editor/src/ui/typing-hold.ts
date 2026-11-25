import type { SheetController } from '../state/controller.ts';
import * as React from 'react';
import { isBrowserReservedKey } from '../keys/key-press.ts';
/** Where a key or text came: in the pane that holds typing back, or anywhere else. */
export type TypingHoldWhere = 'inPane' | 'elsewhere';
export interface TypingHoldOptions {
  store: Pick<SheetController, 'lookOnceEventsAreFinished' | 'isEventUnfinished'>;
  /** Calls back after a delay, and returns a way to clear the timer. */
  afterMs: (delayMs: number, callback: () => void) => () => void;
  onChange: (isHolding: boolean) => void;
}
/** Holds typing back while the sheet is still busy with what came before, until it has settled. */
export interface TypingHold {
  /** Notes a key or text, and tells whether to swallow it. */
  keyOrTextCame(where: TypingHoldWhere): boolean;
  keyThatMovesOrLeavesCame(where: TypingHoldWhere): boolean;
  keyRepeated(where: TypingHoldWhere): boolean;
  pressBegan(): void;
  stop(): void;
}
export function createTypingHold({ store, afterMs, onChange }: TypingHoldOptions): TypingHold {
  let isHolding = false;
  let stopTimer: (() => void) | null = null;
  const setHolding = (holding: boolean) => {
    stopTimer?.();
    if (isHolding !== holding) onChange(holding);
    isHolding = holding;
  };
  const holdUntilSettled = () => {
    setHolding(true);
    let isStopped = false;
    const clearTimer = afterMs(
      TYPING_HOLD_MS,
      () =>
        store.lookOnceEventsAreFinished(() => {
          if (!isStopped) setHolding(false);
        }),
    );
    stopTimer = () => {
      isStopped = true;
      clearTimer();
    };
  };
  return {
    keyOrTextCame: (where: TypingHoldWhere) => {
      if (isHolding || (where === 'inPane' && store.isEventUnfinished())) holdUntilSettled();
      return isHolding;
    },
    keyThatMovesOrLeavesCame: (where: TypingHoldWhere) => {
      if (!isHolding && where === 'inPane' && store.isEventUnfinished()) holdUntilSettled();
      return isHolding;
    },
    keyRepeated: (where: TypingHoldWhere) => isHolding || (where === 'inPane' && store.isEventUnfinished()),
    pressBegan: () => setHolding(false),
    stop: () => stopTimer?.(),
  };
}
export interface TypingHoldForPanesOptions {
  store: TypingHoldOptions['store'];
  paneRef: React.RefObject<HTMLElement | null>;
  /** An element that is always on the page, for its document. */
  always: React.RefObject<HTMLElement | null>;
  /** Whether a field in the pane is still to come and should get the typing. */
  isFieldToCome: () => boolean;
}
export function useTypingHoldForPanes({ store, paneRef, always, isFieldToCome }: TypingHoldForPanesOptions) {
  const [takesNoTyping, setTakesNoTyping] = React.useState(false);
  React.useEffect(() => {
    const ownerDocument = always.current?.ownerDocument;
    const defaultView = ownerDocument?.defaultView;
    if (ownerDocument === undefined || defaultView === null || defaultView === undefined) return;
    const typingHold = createTypingHold({
      store,
      afterMs: (delayMs: number, callback: () => void) => {
        const timer = defaultView.setTimeout(callback, delayMs);
        return () => defaultView.clearTimeout(timer);
      },
      onChange: setTakesNoTyping,
    });
    const whereEventIs = ({ target }: Pick<Event, 'target'>): TypingHoldWhere =>
      target instanceof defaultView.Node && paneRef.current?.contains(target) === true && isFieldToCome() ? 'inPane' : 'elsewhere';
    const swallowEvent = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (MODIFIER_ONLY_KEY_PATTERN.test(event.key) || isBrowserReservedKey(event)) return;
      if (
        event.repeat
          ? typingHold.keyRepeated(whereEventIs(event))
          : MOVE_OR_LEAVE_KEY_PATTERN.test(event.key)
            ? typingHold.keyThatMovesOrLeavesCame(whereEventIs(event))
            : typingHold.keyOrTextCame(whereEventIs(event))
      )
        swallowEvent(event);
    };
    const onTextInput = (event: Event) => {
      if (event.cancelable && typingHold.keyOrTextCame(whereEventIs(event))) swallowEvent(event);
    };
    ownerDocument.addEventListener('keydown', onKeyDown, true);
    ownerDocument.addEventListener('paste', onTextInput, true);
    ownerDocument.addEventListener('beforeinput', onTextInput, true);
    for (const pressEventName of TYPING_HOLD_PRESS_EVENTS) ownerDocument.addEventListener(pressEventName, typingHold.pressBegan, true);
    return () => {
      typingHold.stop();
      ownerDocument.removeEventListener('keydown', onKeyDown, true);
      ownerDocument.removeEventListener('paste', onTextInput, true);
      ownerDocument.removeEventListener('beforeinput', onTextInput, true);
      for (const pressEventName of TYPING_HOLD_PRESS_EVENTS) ownerDocument.removeEventListener(pressEventName, typingHold.pressBegan, true);
    };
  }, [store, paneRef, always, isFieldToCome]);
  return takesNoTyping;
}
export const TYPING_HOLD_MS = 1000;
export const MODIFIER_ONLY_KEY_PATTERN =
  /^(?:Shift|Control|Meta|Alt|AltGraph|CapsLock|NumLock|ScrollLock|Fn|FnLock|Insert|Dead|Process|Unidentified)$/;
export const TYPING_HOLD_PRESS_EVENTS = ['pointerdown', 'click'];
export const MOVE_OR_LEAVE_KEY_PATTERN = /^(?:Tab|Escape|F6|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/;
