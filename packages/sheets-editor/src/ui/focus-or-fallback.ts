/**
 * Focuses `target` if it may take the focus; when the focus does not land there, focuses the
 * fallback instead. Says whether either of them ends up focused.
 */
export function focusOrFallback(
  target: HTMLElement | null,
  canFocus: (target: HTMLElement) => boolean,
  getFallback: () => HTMLElement | null,
  getActiveElement: () => Element | null,
): boolean {
  if (target === null || !canFocus(target)) return false;
  target.focus({
    preventScroll: true,
    focusVisible: true,
  });
  if (getActiveElement() === target) return true;
  let fallback = getFallback();
  fallback?.focus({
    preventScroll: true,
    focusVisible: false,
  });
  return fallback !== null && getActiveElement() === fallback;
}
