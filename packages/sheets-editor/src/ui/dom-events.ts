import type * as React from 'react';
export function wrapTabFocusInBar(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  let tabbables = tabbableControlsIn(event.currentTarget);
  let [leavingControl, wrapTarget] = event.shiftKey ? [tabbables.at(0), tabbables.at(-1)] : [tabbables.at(-1), tabbables.at(0)];
  if (leavingControl !== event.currentTarget.ownerDocument.activeElement) return;
  event.preventDefault();
  wrapTarget?.focus({
    preventScroll: true,
  });
}
export function cycleTabFocusForward(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab' || event.shiftKey) return;
  let tabbables = tabbableControlsIn(event.currentTarget);
  let activeIndex = tabbables.findIndex((control) => control === event.currentTarget.ownerDocument.activeElement);
  event.preventDefault();
  tabbables[(activeIndex + 1) % tabbables.length]?.focus({
    preventScroll: true,
  });
}
export const preventMouseDownDefault = (event: React.SyntheticEvent): void => event.preventDefault();
export const IS_APPLE_PLATFORM = /Mac|iPhone|iPad/.test(navigator.platform);
export const isContextMenuClick = ({ button, ctrlKey }: Pick<MouseEvent, 'button' | 'ctrlKey'>): boolean => button === 2 || (IS_APPLE_PLATFORM && ctrlKey);
export const isTouchOrPenPointer = ({ nativeEvent }: Pick<React.MouseEvent, 'nativeEvent'>): boolean =>
  'pointerType' in nativeEvent && (nativeEvent.pointerType === 'touch' || nativeEvent.pointerType === 'pen');
export const opensMenuAtPointer = (event: React.MouseEvent): boolean => isContextMenuClick(event) || isTouchOrPenPointer(event);
export const tabbableControlsIn = (container: ParentNode): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>('button:enabled:not([tabindex="-1"]), input:enabled:not([tabindex="-1"]), [role="listbox"][tabindex="0"]')].filter(
    (control) => control.getClientRects().length > 0,
  );
