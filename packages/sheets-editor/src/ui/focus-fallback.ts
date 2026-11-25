import * as React from 'react';
/** Handlers that tell the container whether the focus is inside it. */
export interface FocusFallbackHandlers {
  onFocus: () => void;
  onBlur: () => void;
}
/**
 * Moves the focus to the container's first button when the focused control inside it goes away
 * (`isFocusKept` turns false) and the focus would otherwise drop to the page body.
 */
export function useFocusFallbackToButton(
  isFocusKept: boolean,
  { preventScroll = false }: FocusOptions = {},
): [React.RefObject<HTMLDivElement | null>, FocusFallbackHandlers] {
  let containerRef = React.useRef<HTMLDivElement>(null);
  let hasFocusRef = React.useRef(false);
  let focusHandlers = React.useMemo<FocusFallbackHandlers>(
    () => ({
      onFocus: () => void (hasFocusRef.current = true),
      onBlur: () => void (hasFocusRef.current = false),
    }),
    [],
  );
  React.useEffect(() => {
    if (isFocusKept) return;
    let hadFocus = hasFocusRef.current;
    hasFocusRef.current = false;
    let ownerDocument = containerRef.current?.ownerDocument;
    if (hadFocus && ownerDocument !== undefined && ownerDocument.activeElement === ownerDocument.body && ownerDocument.hasFocus())
      containerRef.current?.querySelector<HTMLElement>('button, [role="button"]')?.focus({
        preventScroll,
      });
  }, [isFocusKept, preventScroll]);
  return [containerRef, focusHandlers];
}
