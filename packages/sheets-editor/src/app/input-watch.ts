import { MODIFIER_KEYS } from '../state/escape.ts';
export function createPersonInputWatch(win: Window, now: () => number) {
  let hasInputCome = false;
  let lastInputAt = -1 / 0;
  let hadRested = false;
  let wasPointerPressedLast = false;
  // Only keydown events carry `key` and `repeat`.
  let onInput = (event: Event & { key?: string; repeat?: boolean }) => {
    hasInputCome = true;
    if (MODIFIER_KEYS.has(String(Reflect.get(event, 'key')))) return;
    let time = Math.min(event.timeStamp, now());
    hadRested = Reflect.get(event, 'repeat') !== true && time - lastInputAt >= INPUT_REST_MS;
    lastInputAt = Math.max(lastInputAt, time);
  };
  for (let eventType of PERSON_INPUT_EVENTS) win.addEventListener(eventType, onInput, true);
  return {
    hasAnyCome: () => hasInputCome || win.navigator.userActivation?.hasBeenActive !== false,
    hadRestedBeforeLast: () => hadRested,
    restBeginsNow: () => void (lastInputAt = now()),
    notePointerPressedLast: (isPointer: boolean) => void (wasPointerPressedLast = isPointer),
    wasPointerPressedLast: () => wasPointerPressedLast,
  };
}
export const PERSON_INPUT_EVENTS = ['keydown', 'pointerdown', 'mousedown'];
export const INPUT_REST_MS = 1000;

/** Hears whether, and how, the person has used keys or pointer in the page. */
export type PersonInputWatch = ReturnType<typeof createPersonInputWatch>;
