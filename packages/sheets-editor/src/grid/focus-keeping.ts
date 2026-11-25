import * as React from 'react';
import type { EntryEditorElement } from '../dom/entry-editor.ts';
import type { EntryBox } from '../editor/entry-boxes.ts';
import { isNonNullObject } from '../utils/objects.ts';
import { DRAG_START_DISTANCE } from './geometry.ts';
import type { GridPoint } from './geometry.ts';
import { useKeysOffCells, doCellsTakeNoText } from '../app/keys-off-cells.ts';
/** A box an entry is typed in; the entry editor finds the caret offset at a point itself. */
export type BoxToPlaceCaretIn = EntryBox & Partial<Pick<EntryEditorElement, 'offsetAtPoint'>>;
/** A finger that came down in an entry box, to put the caret where it lifts if it did not move. */
interface FingerInBox {
  box: BoxToPlaceCaretIn;
  pointerId: number;
  at: GridPoint;
}
/** A finger press, and what had the caret when it came down. */
interface FingerPress {
  pointerId: number;
  hadCaret: Element | null;
}
/** What the check run when the window gets focus back needs of the page. */
export interface WindowFocusCheckSetup {
  check: () => void;
  isDialogOpen: () => boolean;
  isDialogOwedCaret: () => boolean;
  timesFocusLeft: () => number;
}
/** A press to note, and whether it was by a finger, on a chart, and what had the caret. */
export interface PressToNote {
  pointerId: number;
  isByFinger: boolean;
  isOnChart: boolean;
  hadCaret: Element | null;
}
export function caretOffsetAtPoint(element: BoxToPlaceCaretIn, { x, y }: GridPoint): number | null {
  if (element.offsetAtPoint !== undefined)
    return element.offsetAtPoint({
      x,
      y,
    });
  let caretPositionFromPoint: unknown = Reflect.get(element.ownerDocument, 'caretPositionFromPoint');
  if (typeof caretPositionFromPoint !== 'function') return null;
  let caretPosition: unknown = Reflect.apply(caretPositionFromPoint, element.ownerDocument, [x, y]);
  if (!isNonNullObject(caretPosition) || caretPosition.offsetNode !== element) return null;
  return typeof caretPosition.offset === 'number' ? caretPosition.offset : null;
}
export function createFingerTapCaret() {
  let fingerDown: FingerInBox | null = null;
  return {
    fingerCameDownIn: (box: BoxToPlaceCaretIn, pointerId: number, at: GridPoint) => {
      fingerDown = {
        box,
        pointerId,
        at,
      };
    },
    fingerLifted: (pointerId: number, { x, y }: GridPoint) => {
      if (fingerDown?.pointerId !== pointerId) return false;
      let { box: tappedBox, at: downAt } = fingerDown;
      fingerDown = null;
      if (Math.hypot(x - downAt.x, y - downAt.y) >= DRAG_START_DISTANCE) return false;
      if (tappedBox.ownerDocument.activeElement === tappedBox) return false;
      let caretOffset = caretOffsetAtPoint(tappedBox, {
        x,
        y,
      });
      if (caretOffset === null) return false;
      tappedBox.focus({
        preventScroll: true,
      });
      tappedBox.setSelectionRange(caretOffset, caretOffset);
      return true;
    },
    forget: () => {
      fingerDown = null;
    },
  };
}
export function refocusInContextBar(
  focusAfterModal: HTMLElement | null,
  activeElement: () => Element | null,
  contextBarField: () => HTMLElement | null,
): boolean {
  let field = focusAfterModal === null || focusAfterModal.isConnected ? focusAfterModal : contextBarField();
  if (field === null) return false;
  if (field.closest('[data-part-of-context-bar]:not([data-ending-style])') === null) return false;
  field.focus({
    preventScroll: true,
  });
  return activeElement() === field;
}
export function createWindowFocusCheck({
  check,
  isDialogOpen,
  isDialogOwedCaret,
  timesFocusLeft,
}: WindowFocusCheckSetup) {
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    windowGotFocus() {
      clearTimeout(checkTimer);
      if (isDialogOpen() && !isDialogOwedCaret()) return check();
      let timesLeftAtFocus = timesFocusLeft();
      let isChecked = false;
      let checkOnce = () => {
        if (isChecked) return;
        isChecked = true;
        if (timesFocusLeft() === timesLeftAtFocus) check();
      };
      queueMicrotask(checkOnce);
      checkTimer = setTimeout(checkOnce);
    },
    stop: () => clearTimeout(checkTimer),
  };
}
export function useCaretAfterComment(restoreCaret: () => void) {
  let { doCellsTakeNoText: isTypingElsewhere, hasKeyboardLeft } = useKeysOffCells();
  let ref = React.useRef(false);
  let restoreCaretEvent = React.useEffectEvent(restoreCaret);
  React.useEffect(() => {
    if (isTypingElsewhere || !ref.current) return;
    ref.current = false;
    if (!hasKeyboardLeft && document.hasFocus()) restoreCaretEvent();
  }, [isTypingElsewhere, hasKeyboardLeft]);
  return {
    noteCommentChosen: React.useCallback(() => void (ref.current = doCellsTakeNoText()), []),
    isCaretLeft: React.useCallback(() => ref.current && doCellsTakeNoText(), []),
  };
}
export function createFingerPressTracker() {
  let fingerPress: FingerPress | null = null;
  return {
    notePress: ({ pointerId, isByFinger, isOnChart, hadCaret }: PressToNote) => (
      (fingerPress =
        isByFinger && !isOnChart
          ? {
              pointerId,
              hadCaret,
            }
          : null),
      fingerPress === null
    ),
    noteLift: (pointerId: number, hasCaret: Element | null) => {
      if (fingerPress?.pointerId !== pointerId) return false;
      let { hadCaret: hadCaretAtPress } = fingerPress;
      fingerPress = null;
      return hasCaret === null || hasCaret === hadCaretAtPress;
    },
  };
}
export const pickFocusTarget = <Target extends Element>(
  returnTo: Target | null,
  caretAfter: Target | false,
  caretAfterLayer: () => Target | false,
): Target | false => (caretAfter === false ? false : (returnTo ?? caretAfterLayer()));
export const isFocusOutsideSearchOrErrors = (active: Element | null | undefined): boolean =>
  ['search', '[data-errors-offered]'].every((selector) => (active?.closest(selector) ?? null) === null);
