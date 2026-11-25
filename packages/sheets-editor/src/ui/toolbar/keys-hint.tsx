import { likelyHasKeyboard, subscribeSheetMedia } from '../../kit/platform.ts';
import * as React from 'react';
import { isWithinToolbarOrContextBar } from '../toolbar-tooltip.tsx';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
export function toolbarTabStopOf(toolbar: Element | null): HTMLElement | null {
  let tabStop = toolbar?.querySelector<HTMLElement>(TOOLBAR_TAB_STOP_SELECTOR) ?? null;
  if (tabStop !== null && isElementRendered(tabStop)) return tabStop;
  return [...(toolbar?.querySelectorAll<HTMLElement>('button:enabled') ?? [])].find(isElementRendered) ?? null;
}
export function describeToolbarTabStop(toolbar: HTMLElement, hintId: string) {
  let ownerDocument = toolbar.ownerDocument;
  let view = ownerDocument.defaultView;
  if (view === null) return () => {};
  let removeHintFromOthers = (keptOn: Element | null) => {
    for (let element of toolbar.querySelectorAll(`[aria-describedby~="${hintId}"]`)) {
      if (element === keptOn) continue;
      let idsLeft = describedByIdsOf(element).filter((id) => id !== hintId);
      if (idsLeft.length === 0) element.removeAttribute('aria-describedby');
      else element.setAttribute('aria-describedby', idsLeft.join(' '));
    }
  };
  let putHintOnTabStop = () => {
    let tabStop = toolbar.querySelector(TOOLBAR_TAB_STOP_SELECTOR);
    removeHintFromOthers(tabStop);
    if (tabStop !== null && !describedByIdsOf(tabStop).includes(hintId))
      tabStop.setAttribute('aria-describedby', [...describedByIdsOf(tabStop), hintId].join(' '));
  };
  let isCaretOutside = true;
  let noteCaret = (focused: Element | null) => {
    isCaretOutside = !isWithinToolbarOrContextBar(toolbar, focused);
    if (isCaretOutside) putHintOnTabStop();
    else removeHintFromOthers(focused);
  };
  let onFocusIn = () => noteCaret(ownerDocument.activeElement);
  let onWindowBlur = () => noteCaret(null);
  let observer = new view.MutationObserver(() => {
    if (isCaretOutside) putHintOnTabStop();
  });
  noteCaret(ownerDocument.activeElement);
  observer.observe(toolbar, {
    subtree: true,
    attributeFilter: ['tabindex'],
  });
  ownerDocument.addEventListener('focusin', onFocusIn);
  view.addEventListener('blur', onWindowBlur);
  return () => {
    observer.disconnect();
    ownerDocument.removeEventListener('focusin', onFocusIn);
    view.removeEventListener('blur', onWindowBlur);
    removeHintFromOthers(null);
  };
}
export function useToolbarArrowKeysHint() {
  let hintId = React.useId();
  let toolbarRef = React.useCallback((toolbar: HTMLElement) => describeToolbarTabStop(toolbar, hintId), [hintId]);
  if (!React.useSyncExternalStore(subscribeSheetMedia, likelyHasKeyboard, () => false))
    return {
      sentence: null,
      ofToolbar: {},
    };
  return {
    sentence: <span id={hintId} hidden>{sheetMessages.arrowKeysMoveBetweenTools()}</span>,
    ofToolbar: {
      ref: toolbarRef,
    },
  };
}
export const TOOLBAR_TAB_STOP_SELECTOR = '[tabindex="0"]:not(:disabled, [data-base-ui-focus-guard])';
export const isElementRendered = (element: Element) => element.getClientRects().length > 0;
export const describedByIdsOf = (element: Element) =>
  (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
