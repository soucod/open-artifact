import * as React from 'react';
import { LIST_ANSWER_SETTLE_MS } from '../list-under-cell.tsx';
import type { PressGuardStand } from '../../formulas/from-words/offer-list.tsx';
/** The box whose presses are guarded, its field, and what stands in it now. */
export interface SpentInputGuardOptions {
  box: React.RefObject<HTMLElement | null>;
  field: React.RefObject<Element | null>;
  stands: PressGuardStand;
}
/** The Enter or the presses meant for what stood in the box before the agent's answer took its place. */
export interface SpentInput {
  isEnter: boolean;
  /** Where the buttons that went stood: a press inside one was meant for it. */
  isPressIn: DOMRect[];
  hasAnswer: boolean;
}
/** A button while the agent writes, and where it stands. */
interface StandingButton {
  button: Element;
  stands: DOMRect;
}
/** Where the pointer is, in client pixels. */
export interface PointerPlace {
  clientX: number;
  clientY: number;
}
/** A press to judge, with when it went down and when what it landed on was shown. */
export interface PressInBox extends PointerPlace {
  isByMouse: boolean;
  wentDownAtMs: number;
  shownAtMs: number;
}
/** What stood in the box before and what stands now, once the agent wrote. */
export interface StandsChange {
  stoodBefore: PressGuardStand;
  stands: PressGuardStand;
  wasCaretOnWhatWent: boolean;
  whereButtonsStood: DOMRect[];
}
export interface SpentInputGuard {
  isEnterSpent: () => boolean;
  isPressSpent: (press: PressInBox) => boolean;
  forget: () => void;
  onWheel: (event: Pick<React.SyntheticEvent, 'timeStamp'>) => void;
  onScrolled: (event: Pick<React.SyntheticEvent, 'timeStamp'>) => void;
  onCaretLeft: (event: { relatedTarget: EventTarget | null }) => void;
  onPointerMoved: (event: Pick<React.PointerEvent, 'pointerType' | 'clientX' | 'clientY'>) => void;
  onButtonsMoved: () => void;
}
export function useSpentInputGuard(guarded: SpentInputGuardOptions): SpentInputGuard {
  let { box: boxRef, field: fieldRef, stands } = guarded;
  let spentInputRef = React.useRef(NO_SPENT_INPUT);
  let buttonsStandingRef = React.useRef<StandingButton[]>([]);
  let standsBeforeRef = React.useRef(stands);
  let lastPointerRef = React.useRef<PointerPlace | null>(null);
  let lastWheelTimeRef = React.useRef(-1 / 0);
  let recordButtonsStanding = React.useCallback(() => {
    buttonsStandingRef.current =
      stands === 'whileAgentWrites'
        ? [...(boxRef.current?.querySelectorAll(':is(button, [data-stands-for-button]):not([inert] *)') ?? [])].map(
            (button) => ({
              button,
              stands: button.getBoundingClientRect(),
            }),
          )
        : [];
  }, [boxRef, stands]);
  React.useLayoutEffect(() => {
    if (standsBeforeRef.current === stands) return recordButtonsStanding();
    let stoodBefore = standsBeforeRef.current;
    standsBeforeRef.current = stands;
    let ownerDocument = boxRef.current?.ownerDocument;
    let activeElement = ownerDocument?.activeElement ?? null;
    let wasCaretInBox = activeElement === ownerDocument?.body || boxRef.current?.contains(activeElement) === true;
    spentInputRef.current = spentInputAfterAgentWrote({
      stoodBefore,
      stands,
      wasCaretOnWhatWent: wasCaretInBox && activeElement !== fieldRef.current,
      whereButtonsStood: buttonsStandingRef.current.flatMap((standing) => (standing.button.isConnected ? [] : [standing.stands])),
    });
    lastPointerRef.current = null;
    return recordButtonsStanding();
  });
  let takeSpentInput = React.useCallback(() => {
    let spentInput = spentInputRef.current;
    spentInputRef.current = NO_SPENT_INPUT;
    return spentInput;
  }, []);
  let forget = React.useCallback(() => void takeSpentInput(), [takeSpentInput]);
  return {
    isEnterSpent: () => takeSpentInput().isEnter,
    isPressSpent: (press) => isStalePress(takeSpentInput(), press),
    forget,
    onWheel: ({ timeStamp }) => {
      lastWheelTimeRef.current = timeStamp;
    },
    onScrolled: ({ timeStamp }) => {
      if (isScrollFromWheel(lastWheelTimeRef.current, timeStamp)) takeSpentInput();
    },
    onCaretLeft: ({ relatedTarget }) => {
      if (relatedTarget instanceof Node && boxRef.current?.contains(relatedTarget) !== true) takeSpentInput();
    },
    onPointerMoved: (event) => {
      if (event.pointerType !== 'mouse') return;
      let lastPointer = lastPointerRef.current;
      lastPointerRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
      };
      if (hasPointerMoved(lastPointer, event) && !isPressOnGoneButton(spentInputRef.current, event)) takeSpentInput();
    },
    onButtonsMoved: recordButtonsStanding,
  };
}
export const STANDS_FOR_BUTTON_PROPS = {
  'data-stands-for-button': true,
};
export const NO_SPENT_INPUT: SpentInput = {
  isEnter: false,
  isPressIn: [],
  hasAnswer: false,
};
export const isPointInsidePressRect = (
  { left, right, top, bottom }: Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>,
  { clientX, clientY }: PointerPlace,
): boolean => clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
export const isPressOnGoneButton = ({ isPressIn }: SpentInput, point: PointerPlace): boolean =>
  isPressIn.some((rect) => isPointInsidePressRect(rect, point));
export const isStalePress = (spentInput: SpentInput, press: PressInBox): boolean =>
  isPressOnGoneButton(spentInput, press) &&
  ((press.isByMouse && spentInput.hasAnswer) || press.wentDownAtMs - press.shownAtMs < LIST_ANSWER_SETTLE_MS);
export const hasPointerMoved = (lastPointer: PointerPlace | null, event: PointerPlace): boolean =>
  lastPointer !== null && (lastPointer.clientX !== event.clientX || lastPointer.clientY !== event.clientY);
export const WHEEL_SCROLL_WINDOW_MS = 300;
export const isScrollFromWheel = (wheelAtMs: number, scrollAtMs: number): boolean => scrollAtMs - wheelAtMs < WHEEL_SCROLL_WINDOW_MS;
export const spentInputAfterAgentWrote = (change: StandsChange): SpentInput =>
  change.stoodBefore === 'whileAgentWrites'
    ? {
        isEnter: change.stands === 'withAnswer' && change.wasCaretOnWhatWent,
        isPressIn: change.whereButtonsStood,
        hasAnswer: change.stands === 'withAnswer',
      }
    : NO_SPENT_INPUT;
