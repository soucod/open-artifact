import * as React from 'react';

export const COARSE_OR_HOVERLESS_MEDIA_QUERY = '(pointer: coarse), (hover: none)';
export const NARROW_VIEWPORT_MEDIA_QUERY = '(width < 40rem)';
export const COARSE_POINTER_MEDIA_QUERY = '(pointer: coarse)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const REDUCED_MOTION_ATTRIBUTE = 'data-reduce-motion';
const DESKTOP_SHELL_USER_AGENT_TOKEN = ' Electron/';

const browserWindow = (win?: Window | null): Window | undefined => win ?? (typeof window === 'undefined' ? undefined : window);

export function windowMatchesMedia(query: string, win?: Window | null): boolean {
  const target = browserWindow(win);
  return typeof target?.matchMedia === 'function' && target.matchMedia(query).matches;
}

export function ownerWindowOf(element: Element | null | undefined): Window & typeof globalThis {
  return element?.ownerDocument.defaultView ?? window;
}

/** Whether touch is the main way in: no fine pointer, or nothing that hovers. */
export function usesCoarsePointer(win?: Window | null): boolean {
  return windowMatchesMedia(COARSE_OR_HOVERLESS_MEDIA_QUERY, win);
}

/** A guess at whether a hardware keyboard is at hand, so shortcut hints are worth showing. */
export function likelyHasKeyboard(win?: Window | null): boolean {
  const target = browserWindow(win);
  if (target?.navigator?.userAgent?.includes(DESKTOP_SHELL_USER_AGENT_TOKEN)) return true;
  return !(windowMatchesMedia(COARSE_POINTER_MEDIA_QUERY, target) && (target?.navigator?.maxTouchPoints ?? 0) > 0);
}

/** Calls back whenever the pointer, viewport width or keyboard guess may have changed. */
export function subscribeSheetMedia(onChange: () => void, win?: Window | null): () => void {
  const target = browserWindow(win);
  if (typeof target?.matchMedia !== 'function') return () => {};
  const lists = [COARSE_OR_HOVERLESS_MEDIA_QUERY, NARROW_VIEWPORT_MEDIA_QUERY, COARSE_POINTER_MEDIA_QUERY].map((query) => target.matchMedia(query));
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  return windowMatchesMedia(REDUCED_MOTION_QUERY) || document.documentElement.getAttribute(REDUCED_MOTION_ATTRIBUTE) === 'true';
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const list = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY) : undefined;
  list?.addEventListener('change', onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [REDUCED_MOTION_ATTRIBUTE] });
  return () => {
    list?.removeEventListener('change', onChange);
    observer.disconnect();
  };
}

export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

function subscribeCoarsePointer(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const list = window.matchMedia(COARSE_OR_HOVERLESS_MEDIA_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

export function useCoarsePointerMedia(): boolean {
  return React.useSyncExternalStore(subscribeCoarsePointer, () => usesCoarsePointer(), () => false);
}

const isMacLike = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

export function isApplePlatform(): boolean {
  return isMacLike();
}
