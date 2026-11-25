/** Told whether the window still has the focus when it has left the page's own parts. */
export type OnFocusLeft = (isWindowFocused: boolean) => void;
export const HAS_PERSON_ATTRIBUTE = 'data-has-person';
export let focusLeftChecksHeld: number;
export let windowBlurCount: number;
export function holdFocusLeftChecksForATick() {
  focusLeftChecksHeld += 1;
  setTimeout(() => {
    focusLeftChecksHeld -= 1;
  });
}
export function checkWhereFocusWent(doc: Document, element: Element | null, onLeft: OnFocusLeft, evenWithoutCharts = false) {
  if (element === null) windowBlurCount += 1;
  if (focusLeftChecksHeld > 0) return;
  if (!hasFrameThatTakesFocus(doc) && !evenWithoutCharts) {
    onLeft(false);
    return;
  }
  let blurCountBefore = windowBlurCount;
  setTimeout(() => {
    let [activeElement, isWindowFocused] = [doc.activeElement, doc.hasFocus()];
    if (
      focusLeftChecksHeld === 0 &&
      !(isWindowFocused && (element === null || (activeElement === element && windowBlurCount !== blurCountBefore))) &&
      activeElement?.matches('iframe.sheet-chart-frame, .sheet-interactive:not([data-has-person]) iframe') !== true
    )
      onLeft(isWindowFocused);
  });
}
focusLeftChecksHeld = 0;
windowBlurCount = 0;
export const hasFrameThatTakesFocus = (root: ParentNode) =>
  root.querySelector('iframe.sheet-chart-frame, .sheet-interactive:not([data-has-person]) iframe') !== null;
export const areFocusLeftChecksHeld = () => focusLeftChecksHeld > 0;
export const whenBlurredToNothing = (element: Element, onLeft: OnFocusLeft) =>
  checkWhereFocusWent(element.ownerDocument, element, onLeft);
export const whenBlurredToNothingChecked = (element: Element, onLeft: OnFocusLeft) =>
  checkWhereFocusWent(element.ownerDocument, element, onLeft, true);
export const whenWindowBlurred = (doc: Document, onLeft: OnFocusLeft) => checkWhereFocusWent(doc, null, onLeft);
export const isFocusWithinSameMenu = (element: Element, relatedTarget: Node | null) =>
  element.closest('[role="menu"]')?.contains(relatedTarget) === true;
