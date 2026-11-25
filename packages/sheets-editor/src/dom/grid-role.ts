export const isGridOrGridPopupTrigger = (element: Element): boolean =>
  element.getAttribute('role') === 'grid' || element.getAttribute('aria-haspopup') === 'grid';
