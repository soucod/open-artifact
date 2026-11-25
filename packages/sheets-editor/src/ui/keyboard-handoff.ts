import { isMobileTouchDevice } from '../comments/card-places.ts';
/** A key pressed while the keyboard waits to be handed to an element. */
export interface KeyPressToHandOff {
  key: string;
  /** The key was pressed inside the element that waits for the keyboard. */
  isAimedWithin: boolean;
  isTakenAlready: boolean;
  isHeldDown: boolean;
  isChord: boolean;
}
/** What a key does to a keyboard hand-off: nothing, shut it, bring the keyboard alone, or bring it and type the key. */
export type KeyHandoffAction = 'nothing' | 'shuts' | 'onlyBringsKeyboard' | 'bringsKeyboard';
/** How keys pressed elsewhere are handed to an element that waits for the keyboard. */
export interface KeysToHandOff {
  /** Whether the target is inside the element, where keys need no hand-off. */
  holds: (target: EventTarget | null) => boolean;
  /** Whether a key is handed off at all; left out, every key is. */
  takes?: (event: KeyboardEvent) => boolean;
  shut: () => void;
  /** Gives the element the keyboard, and says whether it took it. */
  takeKeyboard: (event: KeyboardEvent) => boolean;
  handOn?: (event: KeyboardEvent) => void;
}
/** What is known when a keyboard offer settles. */
export interface KeyboardHandoffState {
  isStillInPage: boolean;
  isKeyboardInsideAlready: boolean;
  isKeyboardWhereItWas: boolean;
  hasKeyGoneDown: boolean;
  hasPointerGoneDownElsewhere: boolean;
}
export type KeyboardHandoffOutcome = 'givesUp' | 'leaves' | 'takes';
/** The keys an element that waits for the keyboard listens for. */
export interface KeysWhileKeyboardOffered {
  onShut: () => void;
  handOn?: (event: KeyboardEvent) => void;
}
export interface KeyboardOffer {
  keys?: KeysWhileKeyboardOffered;
  onGivenUp?: () => void;
}
/** A keyboard offered to a field: the field to focus now (or `false` when it takes the keyboard later), and how to call the offer off. */
export interface KeyboardOfferToField {
  answer: HTMLInputElement | false;
  callOff: () => void;
}
export function keyHandoffAction(keyPress: KeyPressToHandOff): KeyHandoffAction | null {
  if (keyPress.isAimedWithin || isModifierKeyName(keyPress.key)) return null;
  if (keyPress.isTakenAlready || keyPress.isHeldDown) return 'nothing';
  if (keyPress.key === 'Escape') return 'shuts';
  if (/^(Enter|Tab|F\d+)$/.test(keyPress.key)) return 'onlyBringsKeyboard';
  return keyPress.isChord && !/^[acvx]$/i.test(keyPress.key) ? 'onlyBringsKeyboard' : 'bringsKeyboard';
}
export function listenForKeysToHandOff(target: Document, keysToHandOff: KeysToHandOff): () => void {
  function stopListening() {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('focusin', onFocusIn, true);
  }
  function onFocusIn(event: FocusEvent) {
    if (keysToHandOff.holds(event.target)) stopListening();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (keysToHandOff.takes?.(event) === false) return;
    let action = keyHandoffAction({
      key: event.key,
      isAimedWithin: keysToHandOff.holds(event.target),
      isTakenAlready: event.defaultPrevented,
      isHeldDown: event.repeat,
      isChord: (event.metaKey || event.ctrlKey) && !event.altKey,
    });
    if (action === null) return;
    event.stopPropagation();
    if (action !== 'bringsKeyboard') event.preventDefault();
    if (action === 'nothing') return;
    if (action === 'shuts') {
      stopListening();
      return keysToHandOff.shut();
    }
    if (!keysToHandOff.takeKeyboard(event)) return event.preventDefault();
    return keysToHandOff.handOn?.(event);
  }
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('focusin', onFocusIn, true);
  return stopListening;
}
export function keyboardHandoffOutcome(state: KeyboardHandoffState): KeyboardHandoffOutcome {
  if (!state.isStillInPage) return 'givesUp';
  if (state.isKeyboardInsideAlready) return 'leaves';
  if (state.hasPointerGoneDownElsewhere) return 'givesUp';
  return state.isKeyboardWhereItWas || !state.hasKeyGoneDown ? 'takes' : 'givesUp';
}
export function offerKeyboardWhenReady(element: Element, giveKeyboard: () => void, offer: KeyboardOffer = {}): () => void {
  const ownerDocument = element.ownerDocument;
  const view = ownerDocument.defaultView;
  if (view === null)
    return () => {
      return;
    };
  if (isMobileTouchDevice(view.navigator)) {
    giveKeyboard();
    return () => {
      return;
    };
  }
  let activeElementAtStart = ownerDocument.activeElement;
  let isInsideElement = (node: Node | null) => node !== element && element.contains(node);
  let isSettled = false;
  let inputState = {
    hasKeyGoneDown: false,
    hasPointerGoneDownElsewhere: false,
  };
  let onInputEvent = (event: KeyboardEvent | PointerEvent) => {
    if (event.type === 'keydown') {
      let isModifierKey = 'key' in event && isModifierKeyName(event.key);
      let isRepeat = 'repeat' in event && event.repeat === true;
      if (!isModifierKey && !isRepeat) inputState.hasKeyGoneDown = true;
    } else if (!element.contains(event.target as Node | null)) {
      inputState.hasPointerGoneDownElsewhere = true;
      settle(false);
    }
  };
  function callOff() {
    isSettled = true;
    view?.cancelAnimationFrame(frame);
    for (let timer of timers) view?.clearTimeout(timer);
    stopKeyHandoff();
    element.removeAttribute(AWAITS_KEYBOARD_ATTRIBUTE);
    for (let eventType of KEYBOARD_HANDOFF_EVENTS) ownerDocument.removeEventListener(eventType, onInputEvent, true);
  }
  function settle(isKeyboardWhereItWas: boolean): boolean {
    if (isSettled) return element.contains(ownerDocument.activeElement);
    callOff();
    let activeElement = ownerDocument.activeElement;
    let outcome = keyboardHandoffOutcome({
      isStillInPage: element.isConnected,
      isKeyboardInsideAlready: isInsideElement(activeElement),
      isKeyboardWhereItWas:
        isKeyboardWhereItWas || [activeElementAtStart, element, ownerDocument.body, null].some((elementBefore) => elementBefore === activeElement),
      ...inputState,
    });
    if (outcome === 'takes') giveKeyboard();
    if (outcome === 'givesUp') offer.onGivenUp?.();
    return element.contains(ownerDocument.activeElement);
  }
  let settleByTimer = () => void settle(false);
  let timers = [view.setTimeout(settleByTimer, KEYBOARD_HANDOFF_DELAY_MS)];
  let frame = view.requestAnimationFrame(() => void timers.push(view.setTimeout(settleByTimer)));
  let { keys } = offer;
  let stopKeyHandoff =
    keys === undefined
      ? () => {
          return;
        }
      : listenForKeysToHandOff(ownerDocument, {
          holds: (target) => element.contains(target as Node | null),
          takeKeyboard: () => settle(true),
          shut() {
            callOff();
            keys.onShut();
          },
          ...(keys.handOn !== undefined && {
            handOn: keys.handOn,
          }),
        });
  element.setAttribute(AWAITS_KEYBOARD_ATTRIBUTE, '');
  for (let eventType of KEYBOARD_HANDOFF_EVENTS) ownerDocument.addEventListener(eventType, onInputEvent, true);
  return callOff;
}
export function offerKeyboardToField(element: Element, field: HTMLInputElement, onShut: () => void): KeyboardOfferToField {
  let view = element.ownerDocument.defaultView;
  if (view === null || isMobileTouchDevice(view.navigator))
    return {
      answer: field,
      callOff: () => {
        return;
      },
    };
  return {
    answer: false,
    callOff: offerKeyboardWhenReady(element, () => field.focus(), {
      keys: {
        onShut,
      },
    }),
  };
}
export function createOpeningEdgeDetector(): (isOpen: boolean, isOpenElsewhere: boolean) => boolean {
  let wasOpenBefore = false;
  return (isOpen: boolean, isOpenElsewhere: boolean): boolean => {
    let isOpeningEdge = isOpen && !wasOpenBefore;
    wasOpenBefore = isOpen || isOpenElsewhere;
    return isOpeningEdge;
  };
}
export const isModifierKeyName = (key: string): boolean => typeof key === 'string' && /^(Shift|Control|Alt|Meta)$/.test(key);
export const AWAITS_KEYBOARD_ATTRIBUTE = 'data-awaits-keyboard';
export const hasElementAwaitingKeyboard = (container: ParentNode): boolean =>
  container.querySelector(`[${AWAITS_KEYBOARD_ATTRIBUTE}]`) !== null;
export const KEYBOARD_HANDOFF_DELAY_MS = 100;
export const KEYBOARD_HANDOFF_EVENTS: readonly ('keydown' | 'pointerdown')[] = ['keydown', 'pointerdown'];
