import * as React from 'react';
import { isNearFullZoom, clampZoom, type ZoomStore } from './zoom.ts';
/** A zoom asked for by a run of wheel turns or a gesture, and whether the run has gone away from full zoom. */
export interface ZoomAsk {
  asked: number;
  isAway: boolean;
}
/** A run of wheel turns that zoom: what it asked for, the zoom it shows and when it last turned. */
export interface WheelZoomRun extends ZoomAsk {
  shown: number;
  lastAtMs: number;
}
/** One wheel turn that zooms: the zoom it starts from, the factor it zooms by and when it came. */
export interface WheelZoomTurn {
  zoomNow: number;
  factor: number;
  atMs: number;
}
/** The last wheel turn that scrolled, to tell whether a pinch on the trackpad goes on. */
export type LastWheel = Pick<WheelEvent, 'deltaY' | 'timeStamp'>;
/** Where a zoom gesture or wheel turn is on screen. */
export type ZoomPointer = Pick<MouseEvent, 'clientX' | 'clientY'>;
/** A pinch on a trackpad as the browser reports it in a gesture event. */
export interface PinchGestureEvent extends Event, ZoomPointer {
  scale: number;
}
export interface GridZoomGesturesProps {
  gridRef: React.RefObject<HTMLElement | null>;
  overGridRef: React.RefObject<HTMLElement | null>;
  gridZoom: ZoomStore;
  zoomTo: (nextZoom: number, pointer: ZoomPointer) => void;
}
export function nextWheelZoom(run: WheelZoomRun | null, { zoomNow, factor, atMs }: WheelZoomTurn): WheelZoomRun {
  let baseRun = run !== null && atMs - run.lastAtMs <= ZOOM_WHEEL_RUN_MS && run.shown === zoomNow ? run : zoomAsked(zoomNow);
  let nextRun = zoomAskedTimes(baseRun, baseRun.asked * factor);
  return {
    ...nextRun,
    shown: zoomShown(nextRun),
    lastAtMs: atMs,
  };
}
export function useGridZoomGestures({ gridRef, overGridRef, gridZoom, zoomTo }: GridZoomGesturesProps): void {
  let zoomToEvent = React.useEffectEvent(zoomTo);
  React.useEffect(() => {
    let scroller = gridRef.current?.parentElement;
    let overGrid = overGridRef.current;
    let defaultView = scroller?.ownerDocument.defaultView;
    if (scroller === null || scroller === undefined || overGrid === null) return;
    if (defaultView === null || defaultView === undefined) return;
    let targets = [scroller, overGrid];
    let zoomAtGestureStart = 1;
    let gestureRun = zoomAsked(1);
    let { NEGATIVE_INFINITY: lastGestureAt, NEGATIVE_INFINITY: lastPlainWheelAt } = Number;
    let lastWheel: LastWheel = {
      deltaY: 0,
      timeStamp: Number.NEGATIVE_INFINITY,
    };
    let isModifierHeldForZoom = false;
    let wheelRun: WheelZoomRun | null = null;
    let touchPointers = new Set<number>();
    let onWheel = (event: WheelEvent) => {
      let isRightAfterGesture = event.timeStamp - lastGestureAt <= GESTURE_WHEEL_GUARD_MS;
      if (!isZoomModifier(event)) lastPlainWheelAt = event.timeStamp;
      if (!event.ctrlKey && !event.metaKey) isModifierHeldForZoom = false;
      let isPinchWheel =
        isZoomModifier(event) && !isModifierHeldForZoom && isPinchWheelContinuing(scroller.ownerDocument.hasFocus(), event, lastWheel);
      let isScrollWheel = !isZoomModifier(event) || isModifierHeldForZoom || isPinchWheel;
      if (isScrollWheel)
        lastWheel = {
          deltaY: event.deltaY,
          timeStamp: event.timeStamp,
        };
      if (isPinchWheel && event.ctrlKey) event.preventDefault();
      if (!isRightAfterGesture && isScrollWheel) return;
      event.preventDefault();
      event.stopPropagation();
      if (isRightAfterGesture) return;
      let deltaUnit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? WHEEL_LINE_PIXELS
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? defaultView.innerHeight
            : 1;
      wheelRun = nextWheelZoom(wheelRun, {
        zoomNow: gridZoom.now(),
        factor: wheelZoomFactor(event.deltaY * deltaUnit),
        atMs: event.timeStamp,
      });
      zoomToEvent(wheelRun.shown, event);
    };
    let onModifierKey = (event: KeyboardEvent) => {
      if ((event.key !== 'Control' && event.key !== 'Meta') || event.repeat) return;
      if (event.type === 'keydown') isModifierHeldForZoom ||= event.timeStamp - lastPlainWheelAt <= ZOOM_WHEEL_RUN_MS;
      else if (!event.ctrlKey && !event.metaKey) isModifierHeldForZoom = false;
    };
    let onWindowBlur = () => {
      isModifierHeldForZoom = false;
    };
    let onTouchPointer = (event: PointerEvent | TouchEvent) => {
      if ('touches' in event) return void (event.touches.length === 0 && touchPointers.clear());
      if (event.pointerType !== 'touch') return;
      if (event.type === 'pointerup') return void touchPointers.delete(event.pointerId);
      if (event.isPrimary) touchPointers.clear();
      return void touchPointers.add(event.pointerId);
    };
    let onGesture = (event: Event) => {
      if (touchPointers.size === 0 || event.currentTarget !== overGrid) event.preventDefault();
      if (touchPointers.size > 0) {
        if (isGestureEvent(event) && event.scale > 0) zoomAtGestureStart = gridZoom.now() / event.scale;
        gestureRun = zoomAsked(gridZoom.now());
        return;
      }
      lastGestureAt = event.type === 'gestureend' ? Number.NEGATIVE_INFINITY : event.timeStamp;
      if (event.type === 'gestureend') return;
      if (event.type === 'gesturestart') {
        zoomAtGestureStart = gridZoom.now();
        gestureRun = zoomAsked(zoomAtGestureStart);
      } else if (isGestureEvent(event)) {
        gestureRun = zoomAskedTimes(gestureRun, zoomAtGestureStart * event.scale);
        zoomToEvent(zoomShown(gestureRun), event);
      }
    };
    for (let target of targets)
      target.addEventListener('wheel', onWheel, {
        capture: true,
        passive: false,
      });
    let gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'];
    for (let target of targets)
      for (let eventName of gestureEvents)
        target.addEventListener(eventName, onGesture, {
          passive: false,
        });
    let pointerEvents: readonly ('pointerdown' | 'pointerup' | 'touchend' | 'touchcancel')[] = ['pointerdown', 'pointerup', 'touchend', 'touchcancel'];
    for (let eventName of pointerEvents) defaultView.addEventListener(eventName, onTouchPointer, true);
    for (let eventName of ['keydown', 'keyup'] as const) defaultView.addEventListener(eventName, onModifierKey, true);
    defaultView.addEventListener('blur', onWindowBlur);
    return () => {
      for (let target of targets) {
        target.removeEventListener('wheel', onWheel, true);
        for (let eventName of gestureEvents) target.removeEventListener(eventName, onGesture);
      }
      for (let eventName of pointerEvents) defaultView.removeEventListener(eventName, onTouchPointer, true);
      for (let eventName of ['keydown', 'keyup'] as const) defaultView.removeEventListener(eventName, onModifierKey, true);
      defaultView.removeEventListener('blur', onWindowBlur);
    };
  }, [gridRef, overGridRef, gridZoom]);
}
export const wheelZoomFactor = (wheelDelta: number): number => Math.min(1.25, Math.max(0.8, Math.exp(-wheelDelta * 0.01)));
export const isZoomModifier = ({ ctrlKey, metaKey, altKey, shiftKey }: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean =>
  (ctrlKey || metaKey) && !altKey && !shiftKey;
export const WHEEL_LINE_PIXELS = 16;
export const GESTURE_WHEEL_GUARD_MS = 1000;
export const ZOOM_WHEEL_RUN_MS = 200;
export const isPinchWheelContinuing = (isPageFocused: boolean, wheelEvent: WheelEvent, lastWheel: LastWheel): boolean =>
  !isPageFocused &&
  wheelEvent.timeStamp - lastWheel.timeStamp <= ZOOM_WHEEL_RUN_MS &&
  (!wheelEvent.ctrlKey || (wheelEvent.deltaY * lastWheel.deltaY >= 0 && Math.abs(wheelEvent.deltaY) <= Math.abs(lastWheel.deltaY)));
export const zoomAsked = (askedZoom: number): ZoomAsk => ({
  asked: askedZoom,
  isAway: !isNearFullZoom(askedZoom),
});
export const zoomAskedTimes = ({ isAway }: ZoomAsk, nextZoom: number): ZoomAsk => {
  let clampedZoom = clampZoom(nextZoom);
  return {
    asked: clampedZoom,
    isAway: isAway || !isNearFullZoom(clampedZoom),
  };
};
export const zoomShown = ({ asked, isAway }: ZoomAsk): number => (isAway && isNearFullZoom(asked) ? 1 : asked);
export const isGestureEvent = (gestureEvent: Event): gestureEvent is PinchGestureEvent =>
  'scale' in gestureEvent &&
  typeof gestureEvent.scale === 'number' &&
  'clientX' in gestureEvent &&
  typeof gestureEvent.clientX === 'number' &&
  'clientY' in gestureEvent &&
  typeof gestureEvent.clientY === 'number';
