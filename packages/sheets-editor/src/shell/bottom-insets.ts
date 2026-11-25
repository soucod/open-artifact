import * as React from 'react';
import type { Popover } from '@base-ui/react/popover';
import { QUICK_FOCUS_RETURN_MS } from '../app/press-tracker.ts';
import { POPUP_EDGE_GAP } from '../ui/popup-placement.ts';
/** Reads the time and runs a callback later; a test can stand in its own. */
export interface InsetClock {
  now(): number;
  callAfter(delayMs: number, run: () => void): void;
}
/** The space kept clear of a popup's edges, in pixels. */
export interface PopupCollisionPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
type PopupPositionerProps = Popover.Positioner.Props;
/** Positioner props that keep a popup clear of what covers the foot of the page. */
export interface PopupRoomAtFoot {
  sideOffset: Exclude<NonNullable<PopupPositionerProps['sideOffset']>, number>;
  collisionPadding: PopupCollisionPadding;
  collisionAvoidance: NonNullable<PopupPositionerProps['collisionAvoidance']>;
}
export let keyboardInset: number;
export let bottomSafeAreaInset: number;
export let isBottomSafeAreaTold: boolean;
export let currentFootInset: number;
export let barsInsetAtFoot: number;
export let safeAreaSettlesAt: number;
export let hasSafeAreaSettled: boolean;
export function setKeyboardInset(inset: number): void {
  keyboardInset = inset;
  for (let listener of bottomInsetListeners) listener();
}
export function setBottomSafeAreaInset(inset: number): void {
  isBottomSafeAreaTold = true;
  if (inset === bottomSafeAreaInset) return;
  if (inset === 0) {
    safeAreaSettlesAt = -1 / 0;
    hasSafeAreaSettled = false;
  }
  bottomSafeAreaInset = inset;
  for (let listener of bottomInsetListeners) listener();
}
export function setBarsInsetAtFoot(inset: number): void {
  if (inset === barsInsetAtFoot) return;
  barsInsetAtFoot = inset;
  for (let listener of bottomInsetListeners) listener();
}
export function setCurrentFootInset(inset: number): void {
  if (inset === currentFootInset) return;
  currentFootInset = inset;
  for (let listener of bottomInsetListeners) listener();
}
export function useFootInsetOf(footElement: HTMLElement | null): void {
  React.useLayoutEffect(() => (setCurrentFootInset(footElement?.offsetHeight ?? 0), () => setCurrentFootInset(0)), [footElement]);
}
export function subscribeBottomInsets(listener: () => void): () => void {
  bottomInsetListeners.add(listener);
  return () => void bottomInsetListeners.delete(listener);
}
export function useCoveredUnderCellsProperty(elementRef: React.RefObject<HTMLElement | null>): void {
  React.useLayoutEffect(() => {
    let writeProperty = () => elementRef.current?.style.setProperty('--sheet-covered-under-cells', `${getCoveredUnderCells()}px`);
    writeProperty();
    return subscribeBottomInsets(writeProperty);
  }, [elementRef]);
}
export function waitForSafeAreaToSettle(clock: InsetClock = DEFAULT_INSET_CLOCK): void {
  if (bottomSafeAreaInset === 0 || hasSafeAreaSettled) return;
  let settlesAt = clock.now() + SAFE_AREA_SETTLE_MS;
  safeAreaSettlesAt = settlesAt;
  clock.callAfter(SAFE_AREA_SETTLE_MS, () => {
    if (safeAreaSettlesAt !== settlesAt) return;
    safeAreaSettlesAt = -1 / 0;
    hasSafeAreaSettled = true;
    for (let listener of bottomInsetListeners) listener();
  });
}
export function onActsWhileFootCovered(
  target: EventTarget,
  act: () => void,
  isFootCovered: () => boolean | null = hasBottomSafeArea,
): () => void {
  let actIfCovered = () => {
    if (isFootCovered() !== false) act();
  };
  actIfCovered();
  let eventTypes = ['pointerdown', 'click', 'keydown'];
  for (let eventType of eventTypes) target.addEventListener(eventType, actIfCovered, true);
  return () => {
    for (let eventType of eventTypes) target.removeEventListener(eventType, actIfCovered, true);
  };
}
export function callAgainOnQuickReturn(
  win: Window,
  call: () => void,
  shouldCallAgain: () => boolean,
  isFootCovered: () => boolean | null = hasBottomSafeArea,
  readNowMs: () => number = DEFAULT_INSET_CLOCK.now,
): () => void {
  call();
  if (win.document.hasFocus() || !shouldCallAgain()) return () => {};
  let calledAt = readNowMs();
  let stopListening = () => win.removeEventListener('focus', onFocus);
  function onFocus() {
    stopListening();
    if (readNowMs() - calledAt <= QUICK_FOCUS_RETURN_MS && isFootCovered() !== false) call();
  }
  win.addEventListener('focus', onFocus);
  return stopListening;
}
export function useBottomInsetWhileOpen(isOpen: boolean, followsHover: boolean = true, afterSettling: boolean = false): number {
  let readInset = afterSettling ? bottomInsetAfterSettling : getBottomInset;
  let [inset, setInset] = React.useState(0);
  let [wasOpen, setWasOpen] = React.useState(false);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setInset(readInset());
  }
  React.useEffect(() => {
    if (!isOpen) return;
    let updateCoveredHeight = () => {
      let next = readInset();
      let isHoverOff = followsHover && document.querySelector(`${OPEN_PORTAL_POPUP_SELECTOR}:hover`) === null;
      setInset((current) => (next > current || isHoverOff ? next : current));
    };
    let unsubscribe = subscribeBottomInsets(updateCoveredHeight);
    if (!followsHover) return unsubscribe;
    document.addEventListener('pointerover', updateCoveredHeight);
    document.documentElement.addEventListener('pointerleave', updateCoveredHeight);
    return () => {
      unsubscribe();
      document.removeEventListener('pointerover', updateCoveredHeight);
      document.documentElement.removeEventListener('pointerleave', updateCoveredHeight);
    };
  }, [isOpen, followsHover, readInset]);
  return inset;
}
export function popupPropsUnderHeader(): Partial<PopupRoomAtFoot> {
  return NO_POPUP_PROPS;
}
export const NO_POPUP_PROPS: Partial<PopupRoomAtFoot> = {};
export function usePopupRoomAtFoot(
  isOpen: boolean,
  getAnchor: () => HTMLElement | null | undefined,
  afterSettling: boolean = false,
): PopupRoomAtFoot | null {
  let inset = useBottomInsetWhileOpen(isOpen, true, afterSettling);
  if (inset === 0) return null;
  return {
    sideOffset: ({ side, anchor }) => {
      let anchorElement = getAnchor();
      if (side !== 'top' || anchorElement === null || anchorElement === undefined) return POPUP_SIDE_OFFSET;
      let bounds = anchorElement.getBoundingClientRect();
      let centerTop = bounds.top + (bounds.height - anchor.height) / 2;
      let roomTop = anchorElement.ownerDocument.documentElement.clientHeight - inset;
      return POPUP_SIDE_OFFSET + Math.max(0, centerTop - roomTop);
    },
    collisionPadding: popupCollisionPadding(inset),
    collisionAvoidance: {
      fallbackAxisSide: 'none',
    },
  };
}
keyboardInset = 0;
bottomSafeAreaInset = 0;
isBottomSafeAreaTold = false;
currentFootInset = 0;
barsInsetAtFoot = 0;
export const bottomInsetListeners = new Set<() => void>();
export const getBottomSafeAreaInset = (): number => bottomSafeAreaInset;
export const hasBottomSafeArea = (): boolean | null => (isBottomSafeAreaTold ? bottomSafeAreaInset > 0 : null);
export const getKeyboardInset = (): number => keyboardInset;
export const getBottomInset = (): number => Math.max(keyboardInset, bottomSafeAreaInset);
export const zeroBottomInset = (): number => 0;
export const useBottomInset = (): number => React.useSyncExternalStore(subscribeBottomInsets, getBottomInset, zeroBottomInset);
export const getBarsInsetAtFoot = (): number => barsInsetAtFoot;
export const useBarsInsetAtFoot = (): number => React.useSyncExternalStore(subscribeBottomInsets, getBarsInsetAtFoot, zeroBottomInset);
export const getCoveredUnderCells = (): number => getBottomInset() + currentFootInset;
export const useCoveredUnderCells = (): number => React.useSyncExternalStore(subscribeBottomInsets, getCoveredUnderCells, zeroBottomInset);
export const SAFE_AREA_SETTLE_MS = 750;
safeAreaSettlesAt = -1 / 0;
hasSafeAreaSettled = false;
export const DEFAULT_INSET_CLOCK: InsetClock = {
  now: () => performance.now(),
  callAfter: (delayMs, run) => void setTimeout(run, delayMs),
};
export const bottomInsetAfterSettling = (now: number = performance.now()): number =>
  now < safeAreaSettlesAt ? keyboardInset : getBottomInset();
export const OPEN_PORTAL_POPUP_SELECTOR = '[data-base-ui-portal] :is([role="menu"], [role="dialog"], [role="listbox"])';
export const popupCollisionPadding = (bottomInset: number): PopupCollisionPadding => ({
  top: POPUP_EDGE_GAP,
  right: POPUP_EDGE_GAP,
  bottom: POPUP_EDGE_GAP + bottomInset,
  left: POPUP_EDGE_GAP,
});
export const POPUP_SIDE_OFFSET = 6;
