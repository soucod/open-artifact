import * as React from 'react';

const scrollsOn = (overflow: string): boolean => !/visible|hidden|clip/.test(overflow);

/**
 * Whether an element's content runs past it on an axis it scrolls along. It is measured again
 * whenever the element or anything inside it changes size, and when children come or go.
 */
export function useScrollableOverflow(element: HTMLElement | null): boolean {
  const [overflows, setOverflows] = React.useState(false);
  const overflowsRef = React.useRef(false);
  React.useLayoutEffect(() => {
    const win = element?.ownerDocument.defaultView;
    if (!element || !win) return undefined;
    const measure = (): void => {
      const { overflowX, overflowY } = win.getComputedStyle(element);
      const next =
        (element.scrollWidth > element.clientWidth + 1 && scrollsOn(overflowX)) ||
        (element.scrollHeight > element.clientHeight + 1 && scrollsOn(overflowY));
      if (overflowsRef.current === next) return;
      overflowsRef.current = next;
      setOverflows(next);
    };
    measure();
    if (typeof win.ResizeObserver !== 'function') return undefined;

    // Each child is watched for size; a child shown as `display: contents` is looked through.
    const watched = new Set<Element>();
    const resizes = new win.ResizeObserver(measure);
    const mutations = new win.MutationObserver((records) => {
      for (const { target, addedNodes } of records) if (element.contains(target)) addedNodes.forEach(watch);
      if (records.some((record) => record.removedNodes.length > 0)) {
        for (const node of watched) {
          if (element.contains(node)) continue;
          resizes.unobserve(node);
          watched.delete(node);
        }
      }
      resizes.unobserve(element);
      resizes.observe(element);
    });
    const view = win;
    function watch(node: Node): void {
      if (!(node instanceof view.Element)) {
        mutations.observe(node, { characterData: true });
      } else if (view.getComputedStyle(node).display === 'contents') {
        mutations.observe(node, { childList: true });
        node.childNodes.forEach(watch);
      } else {
        resizes.observe(node);
        watched.add(node);
      }
    }
    resizes.observe(element);
    mutations.observe(element, { childList: true });
    element.childNodes.forEach(watch);
    return () => {
      resizes.disconnect();
      mutations.disconnect();
    };
  }, [element]);
  return overflows;
}
