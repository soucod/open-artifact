export function scrollableMenuAncestor(element: Element, evenIfElementFocused: boolean) {
  const menu = element.closest('[role="menu"]');
  let scroller = element.parentElement;
  while (scroller !== null && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller === menu ? null : scroller.parentElement;
  const activeElement = element.ownerDocument.activeElement;
  return !(evenIfElementFocused && activeElement === element) && scroller?.contains(activeElement) === true ? null : scroller;
}
export function scrollItemToCenter(item: Element, scroller: Element) {
  const { top: itemTop, bottom: itemBottom } = item.getBoundingClientRect();
  const scrollerBounds = scroller.getBoundingClientRect();
  scroller.scrollTop += (itemTop + itemBottom - scrollerBounds.top - scrollerBounds.bottom) / 2;
}
export function scrollItemAboveBottom(item: Element, scroller: Element) {
  scroller.scrollTop = 0;
  scroller.scrollTop = overflowBelowView(item.getBoundingClientRect(), scroller.getBoundingClientRect().bottom);
}
export const MENU_MAX_VISIBLE_ITEMS = 10.5;
export const overflowBelowView = ({ bottom, height }: Pick<DOMRect, 'bottom' | 'height'>, viewBottom: number) =>
  Math.max(0, bottom + height / 2 - viewBottom);
export const menusFocusedOnCheckedItem = new WeakSet<Element>();
export const createCheckedItemRef =
  (scrollItem: (item: HTMLElement, scroller: HTMLElement) => void, shouldFocus: boolean) =>
  (item: HTMLElement | null) => {
    const menu = item?.closest('[role="menu"]') ?? null;
    const view = item?.ownerDocument.defaultView ?? null;
    if (item === null || menu === null || view === null) return;
    let isFirstResize = true;
    let followedScrollTop: number | null = null;
    const resizeObserver = new view.ResizeObserver(() => {
      if (isFirstResize && shouldFocus) {
        const activeElement = item.ownerDocument.activeElement;
        const isFocusInMenu =
          !menusFocusedOnCheckedItem.has(menu) && activeElement !== menu && activeElement?.tagName !== 'INPUT' && menu.contains(activeElement);
        menusFocusedOnCheckedItem.add(menu);
        if (!isFocusInMenu) {
          resizeObserver.disconnect();
          return;
        }
        item.focus({
          preventScroll: true,
        });
      }
      isFirstResize = false;
      const scroller = scrollableMenuAncestor(item, shouldFocus);
      if (scroller === null || (followedScrollTop !== null && scroller.scrollTop !== followedScrollTop)) return;
      scrollItem(item, scroller);
      followedScrollTop = scroller.scrollTop;
    });
    resizeObserver.observe(menu);
    return () => resizeObserver.disconnect();
  };
export const centerCheckedItemRef = createCheckedItemRef(scrollItemToCenter, false);
export const focusCheckedItemRef = createCheckedItemRef(scrollItemAboveBottom, true);
