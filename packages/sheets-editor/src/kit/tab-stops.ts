/** Everything that might be reached with Tab, before checking that it is enabled and shown. */
const TAB_STOP_CANDIDATES = [
  'a[href]',
  'button',
  'iframe',
  'input',
  'select',
  'textarea',
  'summary',
  'audio[controls]',
  'video[controls]',
  "[contenteditable]:not([contenteditable='false'])",
  '[tabindex]',
].join(', ');

/** Elements Tab reaches without a tabindex of their own, though their `tabIndex` reads -1 in some browsers. */
const TAB_STOPS_WITHOUT_TABINDEX = "audio[controls], video[controls], [contenteditable]:not([contenteditable='false'])";

function isInTabOrder(element: HTMLElement): boolean {
  return element.tabIndex >= 0 || (!element.hasAttribute('tabindex') && element.matches(TAB_STOPS_WITHOUT_TABINDEX));
}

function isShownAndEnabled(element: HTMLElement): boolean {
  if (element.matches(':disabled')) return false;
  return typeof element.checkVisibility !== 'function' || element.checkVisibility({ visibilityProperty: true });
}

/** Whether Tab stops on the element. */
export function isTabStop(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    isInTabOrder(element) &&
    element.getAttribute('aria-hidden') !== 'true' &&
    isShownAndEnabled(element)
  );
}

/** The elements inside a container that Tab stops on, in document order. */
export function tabStopsWithin(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll(TAB_STOP_CANDIDATES)).filter(isTabStop);
}
