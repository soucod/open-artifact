/** What input is held back on: the page's window, or a stand-in where there is none. */
export interface HoldBackTarget extends EventTarget {
  document?: Document;
}

/** The press a pointer began before input was held back, to be called off once it is let through. */
interface PointerPressed {
  path: EventTarget[];
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
}

/** Holds back the person's input to the page for a while, and lets it through again. */
export interface InputHoldBack {
  /** Holds input back; `onInput` hears of the first key or press that would start input. */
  holdBack(onInput: () => void): void;
  letThrough(): void;
  isHeldBack(): boolean;
  /** Typing keeps going for a second: its keys are held back, though input is not. */
  typingRunsOn(): void;
}

export function createInputHoldBack(
  target: HoldBackTarget,
  makePointerEvent: (kind: string, init: PointerEventInit) => Event = (kind, init) => new PointerEvent(kind, init),
  nowMs: () => number = () => performance.now(),
): InputHoldBack {
  let letGo: (() => void) | null = null;
  let pointerDown: PointerPressed | null = null;
  let pointerTarget: PointerPressed | null = null;
  let typingUntil = -1 / 0;
  let wasBlurred = false;
  let wasUnfocused = false;
  let notePointer = (event: Event) => {
    let pointerId = Number(Reflect.get(event, 'pointerId') ?? 0);
    if (event.type === 'pointerdown')
      pointerDown = {
        path: event.composedPath(),
        pointerId,
        pointerType: String(Reflect.get(event, 'pointerType') ?? ''),
        isPrimary: Reflect.get(event, 'isPrimary') === true,
      };
    else if (
      ((event.type === 'pointerup' || event.type === 'pointercancel') && pointerId === pointerDown?.pointerId) ||
      (event.type === 'blur' && event.target === target)
    )
      pointerDown = null;
  };
  let onEvent = (event: Event) => {
    let isKey = event.type.startsWith('key');
    if (isKey && Reflect.get(event, 'key') === 'Escape') return;
    let at = Math.min(event.timeStamp, nowMs());
    if (letGo === null) {
      notePointer(event);
      if (!isKey && EVENTS_THAT_START_INPUT.has(event.type) && Reflect.get(event, 'isReplay') !== true) typingUntil = -1 / 0;
      if (!isKey || at >= typingUntil) return;
    }
    let startsInput = EVENTS_THAT_START_INPUT.has(event.type) && !MODIFIER_KEYS.has(String(Reflect.get(event, 'key')));
    if (event.type === 'keydown' && startsInput) typingUntil = at + 1000;
    if (event.type === 'blur' && event.target === target && wasUnfocused) return;
    if (event.type === 'blur' && event.target === target) wasBlurred = true;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (startsInput) letGo?.();
  };
  for (let kind of HELD_BACK_EVENT_KINDS)
    target.addEventListener(kind, onEvent, {
      capture: true,
    });
  return {
    holdBack(onInput) {
      let wasHolding = letGo !== null;
      letGo = onInput;
      if (wasHolding) return;
      pointerTarget = pointerDown;
      pointerDown = null;
      wasBlurred = false;
      wasUnfocused = target.document?.hasFocus() === false;
      for (let kind of EVENT_KINDS_HELD_WHILE_HOLDING)
        target.addEventListener(kind, onEvent, {
          capture: true,
          passive: false,
        });
    },
    letThrough() {
      if (letGo === null) return;
      letGo = null;
      for (let kind of EVENT_KINDS_HELD_WHILE_HOLDING)
        target.removeEventListener(kind, onEvent, {
          capture: true,
        });
      if (pointerTarget !== null) {
        let { path, ...init } = pointerTarget;
        pointerTarget = null;
        let firstConnected = path.find((node) => node !== undefined && Reflect.get(node, 'isConnected') === true) ?? target;
        for (let kind of ['pointercancel', 'lostpointercapture'])
          firstConnected.dispatchEvent(
            makePointerEvent(kind, {
              ...init,
              bubbles: true,
            }),
          );
      }
      if (wasBlurred && target.document?.hasFocus() === false) target.dispatchEvent(new Event('blur'));
    },
    isHeldBack: () => letGo !== null,
    typingRunsOn: () => void (typingUntil = nowMs() + 1000),
  };
}
export const HELD_BACK_EVENT_KINDS = [
  'pointerdown',
  'mousedown',
  'pointermove',
  'pointerup',
  'mouseup',
  'pointercancel',
  'lostpointercapture',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'keydown',
  'keyup',
  'beforeinput',
  'input',
  'change',
  'submit',
  'blur',
  'focusout',
  'cut',
  'paste',
  'drop',
  'dragstart',
  'dragover',
];
export const EVENT_KINDS_HELD_WHILE_HOLDING = ['wheel', 'touchstart', 'gesturestart', 'gesturechange'];
export const EVENTS_THAT_START_INPUT = new Set(['keydown', 'pointerdown', 'mousedown']);
export const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);
export const pageInputHoldBack = createInputHoldBack(typeof window > 'u' ? new EventTarget() : window);
