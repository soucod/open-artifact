import { afterNextFrameOrTimeout } from '../utils/next-frame.ts';
import { MODIFIER_KEYS } from '../state/escape.ts';
/** The press whose rest is swallowed: where and when it was made, and on what. */
export interface PressToSwallow {
  clientX: number;
  clientY: number;
  timeStamp: number;
  currentTarget: Element;
}
/** An event that may follow a press, as the tracker reads it. */
export interface PressEventSeen {
  type: string;
  clientX: number;
  clientY: number;
  timeStamp: number;
  button: number;
  ctrlKey: boolean;
  /** The event is on something that takes a press as a new one, so it ends the repeat sooner. */
  isMeantAnew: boolean;
}
/** The events that follow a pointer press. */
export type PressFollowUpEventType = 'mousedown' | 'pointerup' | 'pointercancel' | 'mouseup' | 'click' | 'dblclick' | 'auxclick' | 'contextmenu';
export function createRestOfPressTracker(press: Pick<PressToSwallow, 'clientX' | 'clientY' | 'timeStamp'>, isStrict: boolean = false) {
  let lastTimeStamp = press.timeStamp;
  let phase: 'held' | 'lifted' | null = null;
  let wasHeld = false;
  let isOver = false;
  return {
    isOver: () => isOver,
    afterKey() {
      if (phase === 'lifted') phase = null;
    },
    isPartOfRepeat(input: PressEventSeen) {
      if (isOver) return false;
      if (input.type === 'pointercancel') {
        let wasHeld = phase === 'held';
        if (wasHeld) lastTimeStamp = input.timeStamp;
        phase = null;
        return wasHeld;
      }
      if (isZeroPointPointerEvent(input)) return false;
      if (input.type === 'pointerdown' && ((input.button ?? 0) !== 0 || input.ctrlKey === true)) {
        isOver = true;
        return false;
      }
      if (input.type === 'pointerdown') {
        let distance = Math.hypot(input.clientX - press.clientX, input.clientY - press.clientY);
        isOver =
          (isStrict && wasHeld) ||
          (input.isMeantAnew === true && distance >= PRESS_MOVE_ANEW_MAX_PX) ||
          distance >= PRESS_MOVE_MAX_PX ||
          input.timeStamp - lastTimeStamp > PRESS_REPEAT_MAX_MS;
        phase = isOver ? null : 'held';
        wasHeld = !isOver;
        return !isOver;
      }
      if (phase === 'lifted') return input.timeStamp - lastTimeStamp <= PRESS_LIFT_REPEAT_MAX_MS;
      if (phase === null) return false;
      if (input.type === 'pointerup') {
        phase = 'lifted';
        lastTimeStamp = input.timeStamp;
      }
      return true;
    },
  };
}
export function swallowRestOfPress(
  event: PressToSwallow,
  isMeantAnew: (target: EventTarget | null) => boolean = () => false,
  isStrict: boolean = false,
) {
  let win = event.currentTarget.ownerDocument.defaultView;
  if (win === null || isZeroPointPointerEvent(event)) return;
  let { isPartOfRepeat, afterKey, isOver } = createRestOfPressTracker(event, isStrict);
  let eventTypes: ('pointerdown' | PressFollowUpEventType)[] = ['pointerdown', ...PRESS_FOLLOW_UP_EVENT_TYPES];
  let onEvent = (followingEvent: MouseEvent) => {
    let { type, clientX, clientY, timeStamp, button, ctrlKey } = followingEvent;
    let isMeantAnewHere = type === 'pointerdown' && isMeantAnew(followingEvent.target);
    if (
      isPartOfRepeat({
        type,
        clientX,
        clientY,
        timeStamp,
        button,
        ctrlKey,
        isMeantAnew: isMeantAnewHere,
      })
    ) {
      followingEvent.preventDefault();
      followingEvent.stopImmediatePropagation();
    }
    if (!isOver()) return;
    for (let type of eventTypes) win.removeEventListener(type, onEvent, true);
    win.removeEventListener('keydown', afterKey, true);
  };
  for (let type of eventTypes) win.addEventListener(type, onEvent, true);
  win.addEventListener('keydown', afterKey, true);
}
export function swallowRestOfPressFromEvent(event: Event, isStrict: boolean) {
  if (!('clientX' in event) || !(event.target instanceof Element)) return;
  // The checks above make it a mouse or pointer event on an element.
  let { clientX, clientY, timeStamp, target } = event as MouseEvent & { target: Element };
  swallowRestOfPress(
    {
      clientX,
      clientY,
      timeStamp,
      currentTarget: target,
    },
    undefined,
    isStrict,
  );
}
export function swallowPressAfterItemPress(reason: string, event: Event) {
  if (reason === 'item-press') swallowRestOfPressFromEvent(event, false);
}
export function swallowPressAfterTriggerPress(reason: string, event: Event) {
  if (reason === 'trigger-press') swallowRestOfPressFromEvent(event, true);
}
export function swallowRepeatedDeleteKeys(win: Window | null | undefined, onEventsFinished: (then: () => void) => void) {
  if (win === null || win === undefined) return;
  let swallowFrom = Number.POSITIVE_INFINITY;
  onEventsFinished(
    () =>
      afterNextFrameOrTimeout(win, () => {
        swallowFrom = win.performance.now();
      }),
  );
  let eventTypes: ('keydown' | 'keyup' | 'pointerdown')[] = ['keydown', 'keyup', 'pointerdown'];
  let onEvent = (event: KeyboardEvent | PointerEvent) => {
    let key = 'key' in event && typeof event.key === 'string' ? event.key : null;
    let isDeleteKey = key === 'Delete' || key === 'Backspace';
    let isSoon = event.timeStamp - swallowFrom <= PRESS_REPEAT_MAX_MS;
    if (isDeleteKey) swallowFrom = Math.max(swallowFrom, event.timeStamp);
    if (event.type === 'keyup' || (key !== null && isModifierOrFnKey(key))) return;
    if (isDeleteKey && isSoon) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    for (let type of eventTypes) win.removeEventListener(type, onEvent, true);
  };
  for (let type of eventTypes) win.addEventListener(type, onEvent, true);
}
export const PRESS_MOVE_MAX_PX = 24;
export const PRESS_MOVE_ANEW_MAX_PX = 6;
export const PRESS_REPEAT_MAX_MS = 1000;
export const PRESS_LIFT_REPEAT_MAX_MS = 400;
export const isZeroPointPointerEvent = ({ clientX, clientY }: Pick<MouseEvent, 'clientX' | 'clientY'>) => clientX === 0 && clientY === 0;
export const PRESS_FOLLOW_UP_EVENT_TYPES: PressFollowUpEventType[] = [
  'mousedown',
  'pointerup',
  'pointercancel',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
];
export const isModifierOrFnKey = (key: string) => MODIFIER_KEYS.has(key) || key === 'Fn' || key === 'FnLock';
