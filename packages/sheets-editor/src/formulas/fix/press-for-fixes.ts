import { MODIFIER_KEYS } from '../../state/escape.ts';
/** The window a press asking for fixes was heard in, and when. */
interface PressNoted {
  heardBy: Window;
  atMs: number;
}
/** Remembers a press that asked for fixes until the person presses anything else. */
export interface PressForFixesTracker {
  note: (heardBy: Window | null) => void;
  isFresh: () => boolean;
  forget: () => void;
}
export function createPressForFixesTracker(now: () => number = () => performance.now()): PressForFixesTracker {
  let noted: PressNoted | null = null;
  let forget = () => {
    for (let eventType of PRESS_EVENT_TYPES) noted?.heardBy.removeEventListener(eventType, onPressAfter, true);
    noted = null;
  };
  function onPressAfter(pressEvent: Event) {
    if (pressEvent.type !== 'keydown' || !isRepeatOrModifierKey(pressEvent)) forget();
  }
  return {
    note: (heardBy) => {
      forget();
      if (heardBy === null) return;
      noted = {
        heardBy,
        atMs: now(),
      };
      for (let eventType of PRESS_EVENT_TYPES) heardBy.addEventListener(eventType, onPressAfter, true);
    },
    isFresh: () => noted !== null && now() - noted.atMs < PRESS_FOR_FIXES_FRESH_MS,
    forget,
  };
}
export const PRESS_EVENT_TYPES = ['pointerdown', 'keydown'];
export const PRESS_FOR_FIXES_FRESH_MS = 3000;
export const isRepeatOrModifierKey = (pressEvent: Event): boolean =>
  ('repeat' in pressEvent && pressEvent.repeat === true) ||
  ('key' in pressEvent && typeof pressEvent.key === 'string' && MODIFIER_KEYS.has(pressEvent.key));
