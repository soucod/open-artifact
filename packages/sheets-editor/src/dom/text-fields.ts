export const TEXT_FIELD_SELECTOR = ['input', 'textarea']
  .map((tagName) => `${tagName}:not([inputmode="none"], [readonly])`)
  .concat('[contenteditable]:not([contenteditable="false"])')
  .join();
/** Where the keyboard focus is: outside the page, in a text field, or elsewhere in the page. */
export type FocusPlace = 'outsidePage' | 'inField' | 'elsewhereInPage';
export const createFocusPlaceReader =
  (ownerDocument: Document) =>
  (): FocusPlace => {
    if (!ownerDocument.hasFocus()) return 'outsidePage';
    return ownerDocument.activeElement?.matches(TEXT_FIELD_SELECTOR) === true ? 'inField' : 'elsewhereInPage';
  };
