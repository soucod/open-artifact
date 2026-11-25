import * as React from 'react';
export function wasFocusDroppedWith(element: Element, ownerDocument: Document): boolean {
  return !element.isConnected && ownerDocument.activeElement === ownerDocument.body;
}
/** Remembers the focused element inside a container, to tell when it was removed with the focus on it. */
export interface FocusRescue {
  focused(event: React.FocusEvent): void;
  blurred(event: React.FocusEvent): void;
  isToBeTaken(): boolean;
}
export interface FocusRescueHandlers {
  onFocus: (event: React.FocusEvent) => void;
  onBlur: (event: React.FocusEvent) => void;
}
export function createFocusRescue(): FocusRescue {
  let focusedElement: Element | null = null;
  let container: Element | null = null;
  return {
    focused({ target, currentTarget }) {
      focusedElement = target;
      container = currentTarget;
    },
    blurred({ currentTarget, relatedTarget }) {
      focusedElement = currentTarget.contains(relatedTarget) ? relatedTarget : null;
      container = currentTarget;
    },
    isToBeTaken() {
      let element = focusedElement;
      if (element === null || element.isConnected) return false;
      let ownerDocument = element.ownerDocument;
      let wasDropped = wasFocusDroppedWith(element, ownerDocument);
      focusedElement = !wasDropped && container?.contains(ownerDocument.activeElement) === true ? ownerDocument.activeElement : null;
      return wasDropped && ownerDocument.hasFocus();
    },
  };
}
/** Calls `onRescue` after a render that removed the focused element inside the handlers' container. */
export function useFocusRescue(onRescue: () => void): FocusRescueHandlers {
  let [rescue] = React.useState(createFocusRescue);
  React.useEffect(() => {
    if (rescue.isToBeTaken()) onRescue();
  });
  return {
    onFocus: rescue.focused,
    onBlur: rescue.blurred,
  };
}
