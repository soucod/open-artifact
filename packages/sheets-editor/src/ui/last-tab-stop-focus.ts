import { ENTRY_EDITOR_ATTRIBUTE } from '../dom/entry-editor.ts';
import { ERRORS_NOTICE_TAB_STOP_ATTRIBUTE } from '../formulas/fix/errors-notice.tsx';
/** The tab stop that comes before `element` in the page's tab order, or `null` when none can take the focus. */
export function tabStopBefore(page: HTMLElement | null, element: HTMLElement | null): HTMLElement | null {
  let tabStops = [...(page?.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR) ?? [])];
  let index = element === null ? -1 : tabStops.indexOf(element);
  return tabStops.slice(0, Math.max(index, 0)).findLast(isReachableTabStop) ?? null;
}
/** Focuses the page's last tab stop that is shown, marks it as focused first, and returns it. */
export function focusLastTabStopOfPage(page: HTMLElement | null): HTMLElement | null {
  let focusOptions: FocusOptions = {
    preventScroll: true,
    focusVisible: true,
  };
  for (let tabStop of [...(page?.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR) ?? [])]
    .filter(isShownTabStop)
    .toReversed()) {
    let hasFocus = () => tabStop.ownerDocument.activeElement === tabStop;
    tabStop.focus(focusOptions);
    if (!hasFocus()) tabStop.focus(focusOptions);
    if (!hasFocus()) continue;
    tabStop.setAttribute('data-initial-focus', '');
    let dropInitialFocusMark = () => {
      if (hasFocus()) return;
      tabStop.removeAttribute('data-initial-focus');
      tabStop.removeEventListener('blur', dropInitialFocusMark);
    };
    tabStop.addEventListener('blur', dropInitialFocusMark);
    return tabStop;
  }
  return null;
}
export const FOCUSABLE_ELEMENTS_SELECTOR = `a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [${ENTRY_EDITOR_ATTRIBUTE}], [tabindex]`;
export const isReachableTabStop = (element: HTMLElement): boolean =>
  element.tabIndex >= 0 && element.closest('[inert], [hidden]') === null && element.getClientRects().length > 0;
export const SKIPPED_TAB_STOP_SELECTOR = `[data-base-ui-focus-guard], [${ERRORS_NOTICE_TAB_STOP_ATTRIBUTE}]`;
export const isShownTabStop = (element: HTMLElement): boolean =>
  isReachableTabStop(element) && element.closest(SKIPPED_TAB_STOP_SELECTOR) === null;
