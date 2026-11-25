export function createPressTracker(pageWindow: Window, nowMs: () => number = () => performance.now()) {
  let pressStartedAt: number | null = null;
  let pressEndedAt: number | null = null;
  let wasPressCancelled = false;
  let afterPressRun: (() => void) | null = null;
  let pressCount = 0;
  let actedAt: number | null = null;
  let touchStartedAt: number | null = null;
  let wasTouchAct = false;
  let wasKeyAct = false;
  let focusLeftCount = 0;
  let caretLeftCount = 0;
  let onPressStart = (event: Event) => {
    pressStartedAt = nowMs();
    if (event.type === 'pointerdown' || touchStartedAt === null) wasPressCancelled = false;
    pressCount += 1;
    if (event.type === 'pointerdown') touchStartedAt = 'pointerType' in event && event.pointerType === 'touch' ? pressStartedAt : null;
  };
  let onPressEnd = (event: Event) => {
    if (event.type === 'pointerup' && 'pointerType' in event && event.pointerType === 'touch' && touchStartedAt !== null) touchStartedAt = nowMs();
    let runAfterPress = afterPressRun;
    if (pressStartedAt !== null && !wasPressCancelled) pressEndedAt = nowMs();
    pressStartedAt = null;
    afterPressRun = null;
    runAfterPress?.();
  };
  let onBlur = () => {
    if (pressStartedAt !== null || touchStartedAt !== null) wasPressCancelled = true;
    pressStartedAt = null;
    pressEndedAt = null;
    afterPressRun = null;
    actedAt = null;
    wasKeyAct = false;
    focusLeftCount += 1;
    caretLeftCount += 1;
  };
  let onAct = (event: Event) => {
    if (event.type !== 'click') return void (wasKeyAct = true);
    if (wasPressCancelled && 'detail' in event && event.detail !== 0) {
      wasPressCancelled = false;
      touchStartedAt = null;
      return;
    }
    actedAt = nowMs();
    wasTouchAct = 'detail' in event && event.detail !== 0 && touchStartedAt !== null && actedAt - touchStartedAt < 1000;
    touchStartedAt = null;
  };
  for (let eventType of PRESS_START_EVENTS) pageWindow.addEventListener(eventType, onPressStart, true);
  for (let eventType of PRESS_END_EVENTS) pageWindow.addEventListener(eventType, onPressEnd, true);
  for (let eventType of ACT_EVENTS) pageWindow.addEventListener(eventType, onAct, true);
  pageWindow.addEventListener('blur', onBlur);
  let isPressUnderWay = () => pressStartedAt !== null && nowMs() - pressStartedAt < 1000;
  let focusLeftTo: EventTarget | null = null;
  let noteCaretLeft = () => {
    let leftTo = focusLeftTo;
    focusLeftTo = null;
    if (leftTo !== null && 'isConnected' in leftTo && leftTo.isConnected === true) caretLeftCount += 1;
  };
  let onFocusOut = (event: FocusEvent) => {
    noteCaretLeft();
    if ('relatedTarget' in event && event.relatedTarget === null && !isPressUnderWay()) focusLeftTo = event.target;
  };
  pageWindow.addEventListener('focusout', onFocusOut, true);
  return {
    afterPress(run: () => void) {
      if (isPressUnderWay()) afterPressRun = run;
      else run();
    },
    isUnderWay: isPressUnderWay,
    timesBegun: () => pressCount,
    hasPersonActedSinceFocusLeft: (which: 'keysToo' | 'pressesOnly' = 'keysToo') =>
      (actedAt !== null && (wasTouchAct || nowMs() - actedAt < 1000)) || (which === 'keysToo' && wasKeyAct) || isPressUnderWay(),
    noteActInShell(): void {
      actedAt = nowMs();
      wasTouchAct = false;
    },
    hasPressJustEnded: () => pressEndedAt !== null && nowMs() - pressEndedAt < 500,
    timesFocusLeft: () => focusLeftCount,
    timesCaretLeft() {
      noteCaretLeft();
      return caretLeftCount;
    },
    stop() {
      for (let eventType of PRESS_START_EVENTS) pageWindow.removeEventListener(eventType, onPressStart, true);
      for (let eventType of PRESS_END_EVENTS) pageWindow.removeEventListener(eventType, onPressEnd, true);
      for (let eventType of ACT_EVENTS) pageWindow.removeEventListener(eventType, onAct, true);
      pageWindow.removeEventListener('blur', onBlur);
      pageWindow.removeEventListener('focusout', onFocusOut, true);
    },
  };
}
export const PRESS_START_EVENTS = ['pointerdown', 'mousedown'];
export const PRESS_END_EVENTS = ['pointerup', 'pointercancel', 'mouseup', 'contextmenu', 'dragstart'];
export const ACT_EVENTS = ['click', 'keydown'];
export const QUICK_FOCUS_RETURN_MS = 1000;

/** Watches presses, clicks and focus leaving across the page window. */
export type PressTracker = ReturnType<typeof createPressTracker>;
