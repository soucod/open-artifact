import { DRAG_START_DISTANCE } from '../grid/geometry.ts';
import { getKeyboardInset } from './bottom-insets.ts';
/** A touch that has moved far enough over a text field to tell whether it scrolls the field or the page. */
export interface TouchOverField {
  dx: number;
  dy: number;
  field: Element;
  /** The field's computed `overflow-x` and `overflow-y`. */
  overflow: { x: string; y: string };
  isKeyboardUp: boolean;
}
export function shouldPreventTouchScroll({ dx, dy, field, overflow, isKeyboardUp }: TouchOverField): boolean {
  let scrollsDown = field.scrollHeight - field.clientHeight > 1 && isScrollableOverflow(overflow.y);
  let scrollsAcross = Math.abs(dx) > Math.abs(dy) && field.scrollWidth - field.clientWidth > 1 && isScrollableOverflow(overflow.x);
  return isKeyboardUp && !scrollsDown && !scrollsAcross;
}
export function preventPageScrollOverField(field: HTMLElement): () => void {
  let touchStart: { x: number; y: number } | null = null;
  let isPrevented: boolean | null = null;
  let onTouchStart = ({ targetTouches }: TouchEvent) => {
    let [touch] = targetTouches;
    isPrevented = null;
    touchStart =
      touch === undefined || targetTouches.length > 1
        ? null
        : {
            x: touch.clientX,
            y: touch.clientY,
          };
  };
  let onTouchMove = (touchEvent: TouchEvent) => {
    let [touch] = touchEvent.targetTouches;
    if (touchStart === null || touch === undefined || touchEvent.targetTouches.length > 1) return;
    if (isPrevented === null) {
      let [dx, dy] = [touch.clientX - touchStart.x, touch.clientY - touchStart.y];
      if (Math.hypot(dx, dy) < DRAG_START_DISTANCE) return;
      let { overflowX, overflowY } = getComputedStyle(field);
      isPrevented = shouldPreventTouchScroll({
        dx,
        dy,
        field,
        overflow: {
          x: overflowX,
          y: overflowY,
        },
        isKeyboardUp: getKeyboardInset() > 0,
      });
    }
    if (isPrevented && touchEvent.cancelable) touchEvent.preventDefault();
  };
  field.addEventListener('touchstart', onTouchStart, {
    passive: true,
  });
  field.addEventListener('touchmove', onTouchMove, {
    passive: false,
  });
  return () => {
    field.removeEventListener('touchstart', onTouchStart);
    field.removeEventListener('touchmove', onTouchMove);
  };
}
export const isScrollableOverflow = (overflow: string): boolean => overflow === 'auto' || overflow === 'scroll';
