import * as React from 'react';
import { areFocusLeftChecksHeld } from '../../grid/focus-left.ts';
import type { PagePoint } from '../../comments/page-comments.ts';
/** What is done as the window is left and come back to. */
export interface WindowLeaveWatch {
  windowLeft(isLeft: boolean): void;
  /** Draws the menu shut at once, before it closes. */
  drawShut(): void;
  close(): void;
  staysOpen(): boolean;
}
export function watchWindowLeave(
  target: Window,
  { windowLeft, drawShut, close, staysOpen }: WindowLeaveWatch,
) {
  let isClosing = false;
  const onBlur = ({ isTrusted }: FocusEvent) => {
    if (!isTrusted || areFocusLeftChecksHeld()) return;
    windowLeft(true);
    if (isClosing || staysOpen()) return;
    isClosing = true;
    drawShut();
    close();
  };
  const onFocus = ({ isTrusted }: FocusEvent) => {
    if (!isTrusted) return;
    windowLeft(false);
    if (isClosing) close();
  };
  target.addEventListener('blur', onBlur);
  target.addEventListener('focus', onFocus);
  return {
    stop: () => {
      target.removeEventListener('blur', onBlur);
      target.removeEventListener('focus', onFocus);
    },
  };
}
/** A menu that shuts as the window is left: whether it is open, where it was asked, and how it closes. */
export interface MenuShutOnWindowLeave {
  isOpen: boolean;
  placeAsked: PagePoint | null;
  close(placeAsked: PagePoint): void;
  staysOpen(): boolean;
}
export function useShutOnWindowLeave({ isOpen, placeAsked, close, staysOpen }: MenuShutOnWindowLeave) {
  const [isShut, setIsShut] = React.useState(false);
  const [isWindowLeft, setIsWindowLeft] = React.useState(false);
  if (isWindowLeft && !isOpen) setIsWindowLeft(false);
  const [seenPlaceAsked, setSeenPlaceAsked] = React.useState(placeAsked);
  if (placeAsked !== seenPlaceAsked) setSeenPlaceAsked(placeAsked);
  if (isShut && (!isOpen || placeAsked !== seenPlaceAsked)) setIsShut(false);
  const openPlace = isOpen ? placeAsked : null;
  React.useLayoutEffect(() => {
    if (openPlace === null) return;
    return watchWindowLeave(window, {
      windowLeft: setIsWindowLeft,
      drawShut: () => setIsShut(true),
      close: () => close(openPlace),
      staysOpen,
    }).stop;
  }, [openPlace, close, staysOpen]);
  return {
    isShut: isOpen && isShut,
    isWindowLeft,
  };
}
