import * as React from 'react';
export function useDocumentElementAttribute(attributeName: string): string | null {
  let subscribe = React.useCallback(
    (onChange: () => void) => {
      let observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [attributeName],
      });
      return () => observer.disconnect();
    },
    [attributeName],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => document.documentElement.getAttribute(attributeName),
    () => null,
  );
}
