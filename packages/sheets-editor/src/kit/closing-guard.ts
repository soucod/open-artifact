import type * as React from 'react';

type Handler<E> = ((event: E) => void) | undefined;

function isElement(target: EventTarget | null): target is Element {
  return target !== null && (target as Node).nodeType === 1;
}

function isNode(target: EventTarget | null): target is Node {
  return target !== null && typeof (target as Node).nodeType === 'number';
}

function isEditable(element: Element): boolean {
  return (element as HTMLElement).isContentEditable === true || element.matches('input, textarea, select');
}

/** Enter or Space that would press a button, or Enter that would submit a field's form. */
export function isActivationKey(event: React.KeyboardEvent<Element>): boolean {
  if (event.nativeEvent.isComposing || (event.key !== 'Enter' && event.key !== ' ')) return false;
  const target = event.target;
  if (!isElement(target) || !isEditable(target)) return true;
  if (event.key !== 'Enter') return false;
  return event.metaKey || event.ctrlKey || (target.tagName !== 'TEXTAREA' && (target as HTMLElement).isContentEditable !== true);
}

const always = (): boolean => true;

/** The button pressed while the popup was still open, keyed by popup. */
const pressedWhileOpen = new WeakMap<Element, Element>();

/** A form submitted by the button pressed before the popup began closing still goes through. */
function swallowsSubmit(event: React.FormEvent<Element>): boolean {
  const pressed = pressedWhileOpen.get(event.currentTarget);
  pressedWhileOpen.delete(event.currentTarget);
  const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
  return !(pressed !== undefined && submitter !== null && submitter.contains(pressed));
}

function swallowWhile<E extends React.SyntheticEvent<Element>>(
  handler: Handler<E>,
  attribute: string,
  swallows: (event: E) => boolean,
  prevent: boolean,
): (event: E) => void {
  return (event) => {
    if (event.currentTarget.hasAttribute(attribute) && swallows(event)) {
      if (prevent) event.preventDefault();
      event.stopPropagation();
      return;
    }
    handler?.(event);
  };
}

interface GuardedHandlers<P, K, M, S> {
  onPointerDownCapture?: Handler<P>;
  onMouseDownCapture?: Handler<M>;
  onClickCapture?: Handler<M>;
  onAuxClickCapture?: Handler<M>;
  onKeyDownCapture?: Handler<K>;
  onSubmitCapture?: Handler<S>;
}

/**
 * While a popup is animating out it still covers the page; presses and activation keys that
 * land on it are swallowed, so nothing in a closing popup acts twice.
 */
export function guardWhileClosing<
  P extends React.PointerEvent<Element>,
  K extends React.KeyboardEvent<Element>,
  M extends React.MouseEvent<Element>,
  S extends React.FormEvent<Element>,
>(handlers: GuardedHandlers<P, K, M, S>, attribute: string): Required<GuardedHandlers<P, K, M, S>> {
  return {
    onPointerDownCapture: swallowWhile(handlers.onPointerDownCapture, attribute, always, false),
    onMouseDownCapture: swallowWhile(handlers.onMouseDownCapture, attribute, always, true),
    onClickCapture: swallowWhile(
      (event: M) => {
        const target = event.target;
        if (isElement(target)) pressedWhileOpen.set(event.currentTarget, target.closest('button, input') ?? target);
        handlers.onClickCapture?.(event);
      },
      attribute,
      always,
      true,
    ),
    onAuxClickCapture: swallowWhile(handlers.onAuxClickCapture, attribute, always, true),
    onKeyDownCapture: swallowWhile(handlers.onKeyDownCapture, attribute, isActivationKey, true),
    onSubmitCapture: swallowWhile(handlers.onSubmitCapture, attribute, swallowsSubmit, true),
  };
}

/**
 * A held Enter or Space on a menu row repeats its keydown; only the first press acts, so a row
 * that closes the menu or toggles a check does not fire again on whatever the repeats land on.
 */
export function preventRepeatedActivation(event: React.KeyboardEvent<Element>): void {
  if (!event.repeat || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  (event as React.KeyboardEvent<Element> & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
}

const KEY_GUARD_MAX_MS = 2000;

/**
 * Pressing Enter or Space on a toast's button can close the toast before the key is let go.
 * Until it is, the held key's repeats and release are kept from whatever has focus next.
 */
export function guardHeldActivationKey(event: React.KeyboardEvent<Element>, card: Element | null = event.currentTarget): void {
  if (card === null || event.repeat || !isActivationKey(event) || !isNode(event.target) || !card.contains(event.target)) return;
  const win = card.ownerDocument.defaultView;
  if (win === null) return;
  const key = event.key;
  const isInside = (target: EventTarget | null): boolean => isNode(target) && card.isConnected && card.contains(target);
  const onKey = (keyEvent: KeyboardEvent): void => {
    if (keyEvent.key !== key) return;
    if (keyEvent.type === 'keyup') {
      if (!isInside(keyEvent.target)) keyEvent.preventDefault();
      stop();
      return;
    }
    if (!isInside(keyEvent.target)) {
      keyEvent.preventDefault();
      keyEvent.stopImmediatePropagation();
    }
  };
  const stop = (): void => {
    win.clearTimeout(timer);
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('keyup', onKey, true);
  };
  const timer = win.setTimeout(stop, KEY_GUARD_MAX_MS);
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('keyup', onKey, true);
}
