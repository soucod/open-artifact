import { OVERLAY_ATTRIBUTE } from '../kit/layers.tsx';
import * as ReactDOM from 'react-dom';
import type { FrameChrome } from '../shell/frame-chrome.ts';
export function dispatchEscapeTo(element: Element) {
  let keyboardEventClass = element.ownerDocument.defaultView?.KeyboardEvent;
  if (keyboardEventClass === undefined) return;
  let escapeEvent = new keyboardEventClass('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  syntheticEscapes.add(escapeEvent);
  element.dispatchEvent(escapeEvent);
  escapeEvent.preventDefault();
}
export function closeOpenMenusAndPopovers(ownerDocument: Document) {
  for (let overlay of openOverlaysToClose(ownerDocument).toReversed())
    if (overlay.matches('[role="menu"], [data-ui="Popover"]') && overlay.hasAttribute(DATA_OPEN_ATTRIBUTE))
      ReactDOM.flushSync(() => dispatchEscapeTo(overlay));
}
export function offerOverlayClosing(element: HTMLElement, host: Pick<FrameChrome, 'offerCloseOfTopLayer'>) {
  let ownerDocument = element.ownerDocument;
  let defaultView = ownerDocument.defaultView;
  if (defaultView === null) return;
  let closeTopOverlay = () => {
    let overlay = openOverlaysToClose(ownerDocument).at(-1);
    if (overlay !== undefined) dispatchEscapeTo(overlay);
  };
  let watched = new WeakSet<Element>();
  let observer = new defaultView.MutationObserver(onMutation);
  function onMutation() {
    for (let child of ownerDocument.body.children) {
      if (watched.has(child) || child.contains(element)) continue;
      watched.add(child);
      observer.observe(child, OPEN_OVERLAY_OBSERVE_OPTIONS);
    }
    host.offerCloseOfTopLayer('popup', openOverlaysToClose(ownerDocument).length > 0 ? closeTopOverlay : null);
  }
  observer.observe(ownerDocument.body, {
    childList: true,
  });
  onMutation();
}
export function blockSaveShortcut(event: KeyboardEvent) {
  if (isSaveShortcut(event)) event.preventDefault();
}
export function blockFileDrop(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files') !== true) return;
  event.preventDefault();
  if (event.type === 'dragover') event.dataTransfer.dropEffect = 'none';
}
export function installPageGuards(target: Window) {
  target.addEventListener('keydown', blockSaveShortcut, true);
  target.addEventListener('dragover', blockFileDrop, true);
  target.addEventListener('drop', blockFileDrop, true);
}
export const DATA_OPEN_ATTRIBUTE = 'data-open';
export const OPEN_OVERLAY_OBSERVE_OPTIONS = {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: [DATA_OPEN_ATTRIBUTE],
};
export const CELL_OVERLAYS_SELECTOR =
  '[data-list-under-cell],[data-function-guide],[data-link-card],[data-error-card],[data-errors-offered],[data-pill-of-fix]';
export const openOverlaysToClose = (root: ParentNode) =>
  [...root.querySelectorAll(`[${OVERLAY_ATTRIBUTE}][${DATA_OPEN_ATTRIBUTE}]`)].filter(
    (overlay) => !overlay.matches(CELL_OVERLAYS_SELECTOR),
  );
export const isTrustedEscapeClose = (reason: string, event: Event) => reason === 'escape-key' && event.isTrusted;
export const isSyntheticEscapeClose = (reason: string, event: Event) => reason === 'escape-key' && !event.isTrusted;
export const syntheticEscapes = new WeakSet<Event>();
export const isSyntheticEscape = (event: Event) => syntheticEscapes.has(event);
export const isSaveShortcut = (event: KeyboardEvent) =>
  event.metaKey !== event.ctrlKey && !event.altKey && !event.shiftKey && event.keyCode === 83;
