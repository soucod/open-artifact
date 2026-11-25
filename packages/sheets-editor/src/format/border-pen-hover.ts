import { createHoverOpenTimer, MOUSE_STILL_SLOP } from '../comments/mouse-around.ts';
/** The two pickers of the border pen: its color and its line style. */
export type PenPicker = 'color' | 'style';
/** The pen picker that is open, and whether it is held open (pressed, focused or opened by a key) rather than open while the pointer rests. */
export interface OpenPenPicker {
  picker: PenPicker;
  isHeld: boolean;
}
/** A timer that can be cancelled before it runs. */
export interface CancelableTimer {
  cancel: () => void;
}
/** Runs `run` after `ms` milliseconds. */
export type RunAfter = (ms: number, run: () => void) => CancelableTimer;
/** How a pen row is about to open its picker. */
export type PenRowOpenedBy = 'pressOrClick' | 'arrowKey';
export interface PenPickerHoverHandlers {
  onChanged: (open: OpenPenPicker | null) => void;
  after: RunAfter;
}
interface PointerPlace {
  x: number;
  y: number;
}
export function createPenPickerHoverIntent(handlers: PenPickerHoverHandlers) {
  let current: OpenPenPicker | null = null;
  let rowUnderPointer: PenPicker | null = null;
  let rowShutByPress: PenPicker | null = null;
  let firstPointerPlace: PointerPlace | 'hasMoved' | null = null;
  let nearestDistance: number | null = null;
  let wasHeldBefore = false;
  let setCurrent = (open: OpenPenPicker | null) => {
    current = open;
    if (open !== null) wasHeldBefore = open.isHeld;
    handlers.onChanged(open);
  };
  let createPickerTimer = (picker: PenPicker) =>
    createHoverOpenTimer({
      open() {
        if (current?.isHeld === true) return;
        stopTimers();
        nearestDistance = null;
        setCurrent({
          picker,
          isHeld: false,
        });
      },
      shut: () => (current?.picker === picker && !current.isHeld ? setCurrent(null) : undefined),
      restMs: PEN_PICKER_REST_MS,
      leaveMs: PEN_PICKER_LEAVE_MS,
      after: handlers.after,
    });
  let timers = {
    color: createPickerTimer('color'),
    style: createPickerTimer('style'),
  };
  let stopTimers = () => {
    timers.color.stop();
    timers.style.stop();
  };
  let hasPointerMoved = (clientX: number, clientY: number) => {
    if (firstPointerPlace === 'hasMoved') return true;
    if (firstPointerPlace !== null && (firstPointerPlace.x !== clientX || firstPointerPlace.y !== clientY)) {
      firstPointerPlace = 'hasMoved';
      return true;
    }
    firstPointerPlace = {
      x: clientX,
      y: clientY,
    };
    return false;
  };
  let pointerOnPicker = (picker: PenPicker, isOnPicker: boolean) => {
    nearestDistance = isOnPicker ? null : 1 / 0;
    if (isOnPicker) timers[picker].entered();
    else timers[picker].left();
  };
  let shutPicker = (picker: PenPicker) => {
    stopTimers();
    if (rowUnderPointer === picker) rowShutByPress = picker;
    if (current !== null) setCurrent(null);
  };
  return {
    pointerOnRow(picker: PenPicker, clientX: number, clientY: number) {
      rowUnderPointer = picker;
      if (!hasPointerMoved(clientX, clientY) || rowShutByPress === picker) return;
      if (current?.picker === picker) pointerOnPicker(picker, true);
      else timers[picker].restedOn(clientX, clientY);
    },
    pointerOffRow(picker: PenPicker) {
      rowUnderPointer = null;
      rowShutByPress = null;
      if (current?.picker === picker) pointerOnPicker(picker, false);
      else timers[picker].movedOff();
    },
    pointerOnPicker: (picker: PenPicker) => (current?.picker === picker ? pointerOnPicker(picker, true) : undefined),
    pointerOffPicker: (picker: PenPicker) => (current?.picker === picker ? pointerOnPicker(picker, false) : undefined),
    pointerDistanceFromPicker(distanceAway: number) {
      if (current === null || current.isHeld || nearestDistance === null) return;
      if (distanceAway > nearestDistance - MOUSE_STILL_SLOP) return;
      nearestDistance = distanceAway;
      timers[current.picker].entered();
      timers[current.picker].left();
    },
    held(picker: PenPicker) {
      if (current?.picker === picker && !current.isHeld)
        setCurrent({
          picker,
          isHeld: true,
        });
    },
    openedByPressOrKey(picker: PenPicker) {
      stopTimers();
      setCurrent({
        picker,
        isHeld: true,
      });
    },
    shutByDesignSystem(picker: PenPicker) {
      if (current?.picker === picker) shutPicker(picker);
    },
    rowAboutToOpenIt(picker: PenPicker, openedBy: PenRowOpenedBy) {
      if (openedBy === 'arrowKey' || current?.isHeld !== true) shutPicker(picker);
    },
    wasHeld: () => wasHeldBefore,
    stop: stopTimers,
  };
}
export const PEN_PICKER_REST_MS = 100;
export const PEN_PICKER_LEAVE_MS = 300;
