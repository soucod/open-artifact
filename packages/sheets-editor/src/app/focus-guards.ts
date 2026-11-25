/** Something that takes focus: the window or an element. */
interface Focusable {
  focus(options?: FocusOptions): void;
}
export function patchMethodUntilUndone<Target, Name extends keyof Target>(
  target: Target,
  methodName: Name,
  wrap: (original: Target[Name]) => Target[Name],
) {
  let original = target[methodName];
  let patched = wrap(original);
  target[methodName] = patched;
  return () => {
    if (target[methodName] === patched) target[methodName] = original;
  };
}
export function holdProgrammaticFocus(
  view: Window & typeof globalThis,
  shouldHold: () => boolean,
  onHeld: (focused: Focusable) => void = () => {},
) {
  let isActive = true;
  let isHolding = () => isActive && shouldHold();
  let elementClasses = [view.HTMLElement, view.SVGElement, view.MathMLElement];
  let undoPatches = [
    ...[view, ...elementClasses.flatMap((elementClass) => elementClass?.prototype ?? [])].map(
      (target: Focusable) =>
        patchMethodUntilUndone(
          target,
          'focus',
          (originalFocus) =>
            function (this: Focusable, focusOptions?: FocusOptions) {
              if (isHolding()) onHeld(this);
              else originalFocus.call(this, focusOptions);
            },
        ),
    ),
    ...[view.HTMLInputElement, view.HTMLTextAreaElement].map(
      ({ prototype }) =>
        patchMethodUntilUndone(
          prototype,
          'select',
          (originalSelect) =>
            function (this: HTMLInputElement | HTMLTextAreaElement) {
              if (!isHolding()) originalSelect.call(this);
            },
        ),
    ),
  ];
  return () => {
    isActive = false;
    undoPatches.forEach((undo) => undo());
  };
}
export function createScrollGestureTimer(now: () => number = () => performance.now()) {
  let startedAt = Number.NEGATIVE_INFINITY;
  return {
    begin: () => void (startedAt = now()),
    end: () => void (startedAt = Number.NEGATIVE_INFINITY),
    isUnderWay: () => now() - startedAt < SCROLL_GESTURE_HOLD_MS,
  };
}
export function watchWindowFocusLeft(view: Window, now: () => number = () => performance.now()) {
  let leftAt = view.document.hasFocus() ? null : Number.NEGATIVE_INFINITY;
  let hadFocusLeft = false;
  let onBlur = () => {
    leftAt = now();
  };
  let onFocus = () => {
    leftAt = null;
  };
  let onVisibilityChange = () => {
    hadFocusLeft = view.document.visibilityState === 'hidden' && leftAt !== null && now() - leftAt > 500;
  };
  view.addEventListener('blur', onBlur);
  view.addEventListener('focus', onFocus);
  view.addEventListener('visibilitychange', onVisibilityChange);
  return {
    hadFocusLeftBefore: () => hadFocusLeft,
    stop() {
      view.removeEventListener('blur', onBlur);
      view.removeEventListener('focus', onFocus);
      view.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
export const isTrustedPointerDownEvent = ({ event }: Pick<Window, 'event'>) => event?.isTrusted === true && event.type === 'pointerdown';
export const SCROLL_GESTURE_HOLD_MS = 500;

export type ScrollGestureTimer = ReturnType<typeof createScrollGestureTimer>;
export type WindowFocusWatch = ReturnType<typeof watchWindowFocusLeft>;
