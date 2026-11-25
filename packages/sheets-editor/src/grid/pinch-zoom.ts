import * as React from 'react';
import type { SheetId } from '@open-artifact/sheets-core';
import { clampZoom, isNearFullZoom, pointInZoomedElement, type ZoomStore } from './zoom.ts';
import { frameSchedulerOf, type FrameScheduler } from './frame-scheduler.ts';
import type { GridPoint } from './geometry.ts';
import type { SheetController } from '../state/controller.ts';
/** A finger on the screen, as its pointer events tell of it. */
export type Finger = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>;
/** How far apart two fingers are, and the point halfway between them. */
export interface FingersApart {
  apart: number;
  middle: GridPoint;
}
/** A pinch as it started: how far apart the fingers were, the zoom then and the point on the sheet under their middle. */
export interface PinchStart {
  apart: number;
  zoom: number;
  under: GridPoint;
}
/** A pinch under way, on the sheet it started on. */
export interface PinchUnderWay extends PinchStart {
  sheetId: SheetId;
}
/** The zoom and the scroll a pinch comes to. */
export interface PinchZoomAndScroll {
  zoom: number;
  scroll: GridPoint;
}
/** The sheet in view and how far it is scrolled. */
export interface PinchPlace {
  sheetId: SheetId;
  scroll: GridPoint;
}
/** What a pinch reads from the grid and does to it. */
export interface PinchZoomView {
  zoom(): number;
  place(): PinchPlace | null;
  placeOnGrid(finger: Finger): GridPoint | null;
  goTo(zoom: number, scroll: GridPoint): boolean;
}
/** A finger left down when the other of a pinch was lifted, and since when. */
export interface FingerLeftAfterPinch {
  pointerId: number;
  sinceMs: number;
}
/** What a finger's move is to a pinch: part of it, the first move after it, or nothing to do with one. */
export type FingerMoveInPinch = 'isOfPinch' | 'isFirstAfterPinch' | 'isOfNoPinch';
/** Follows the fingers on the grid and zooms and scrolls as two of them pinch. */
export interface PinchZoom {
  firstCameDown(finger: Finger): void;
  secondCameDown(finger: Finger, canPinch: boolean): boolean;
  fingerMovedTo(finger: Finger, atMs: number): FingerMoveInPinch;
  fingerLifted(pointerId: number, atMs: number): void;
  onlyFingerDown(): Finger | null;
  forget(): void;
  isOn(): boolean;
}
export interface PinchZoomProps {
  store: Pick<SheetController, 'scrollOnShow' | 'isEventUnfinished' | 'dispatch'>;
  grid: React.RefObject<Element | null>;
  gridZoom: ZoomStore;
}
export function pinchZoomAndScroll(pinchStart: PinchStart, firstFinger: GridPoint, secondFinger: GridPoint): PinchZoomAndScroll {
  let { apart, middle } = fingersApartAndMiddle(firstFinger, secondFinger);
  let zoomAsPinched = pinchStart.apart > 0 ? clampZoom((pinchStart.zoom * apart) / pinchStart.apart) : pinchStart.zoom;
  let zoom = isNearFullZoom(zoomAsPinched) && (pinchStart.zoom === 1 || !isNearFullZoom(pinchStart.zoom)) ? 1 : zoomAsPinched;
  return {
    zoom,
    scroll: {
      x: pinchStart.under.x - middle.x / zoom,
      y: pinchStart.under.y - middle.y / zoom,
    },
  };
}
export function createPinchZoom(view: PinchZoomView, getWindow: () => FrameScheduler | null): PinchZoom {
  let fingers = new Map<number, Finger>();
  let pinch: PinchUnderWay | null = null;
  let fingerLeft: FingerLeftAfterPinch | null = null;
  let frame: { of: FrameScheduler; id: number } | null = null;
  let cancelFrame = () => {
    frame?.of.cancelAnimationFrame(frame.id);
    frame = null;
  };
  let fingersOnGrid = () => [...fingers.values()].map((finger: Finger) => view.placeOnGrid(finger));
  let startPinch = () => {
    let [firstFinger, secondFinger] = fingersOnGrid();
    let place = view.place();
    pinch =
      firstFinger === undefined || firstFinger === null || secondFinger === undefined || secondFinger === null || place === null
        ? null
        : {
            ...pinchStartOf(firstFinger, secondFinger, view.zoom(), place.scroll),
            sheetId: place.sheetId,
          };
  };
  let askFrame = () => {
    if (frame !== null) return;
    let frameWindow = getWindow();
    if (frameWindow === null) followPinch();
    else
      frame = {
        of: frameWindow,
        id: frameWindow.requestAnimationFrame(followPinch),
      };
  };
  function followPinch() {
    cancelFrame();
    if (pinch !== null && view.place()?.sheetId !== pinch.sheetId) startPinch();
    let [firstFinger, secondFinger] = fingersOnGrid();
    if (pinch === null || firstFinger === undefined || firstFinger === null) return;
    if (secondFinger === undefined || secondFinger === null) return;
    let { zoom, scroll } = pinchZoomAndScroll(pinch, firstFinger, secondFinger);
    if (!view.goTo(zoom, scroll) && getWindow() !== null) askFrame();
  }
  let forgetPinch = () => {
    cancelFrame();
    fingers.clear();
    pinch = null;
    fingerLeft = null;
  };
  return {
    firstCameDown(finger: Finger) {
      forgetPinch();
      fingers.set(finger.pointerId, finger);
    },
    secondCameDown(finger: Finger, canPinch: boolean) {
      if (fingers.size !== 1) return false;
      fingers.set(finger.pointerId, finger);
      fingerLeft = null;
      if (canPinch) startPinch();
      return pinch !== null;
    },
    fingerMovedTo(finger: Finger, atMs: number) {
      if (!fingers.has(finger.pointerId)) return 'isOfNoPinch';
      let { pointerId, clientX, clientY } = finger;
      fingers.set(pointerId, {
        pointerId,
        clientX,
        clientY,
      });
      if (fingerLeft?.pointerId === pointerId) {
        if (atMs - fingerLeft.sinceMs <= PINCH_FINGER_LAG_MS) return 'isOfPinch';
        fingerLeft = null;
        return 'isFirstAfterPinch';
      }
      if (pinch === null) return 'isOfNoPinch';
      askFrame();
      return 'isOfPinch';
    },
    fingerLifted(pointerId: number, atMs: number) {
      if (!fingers.has(pointerId)) return;
      if (frame !== null) followPinch();
      cancelFrame();
      fingers.delete(pointerId);
      let [fingerLeftId] = fingers.keys();
      fingerLeft =
        pinch !== null && fingerLeftId !== undefined
          ? {
              pointerId: fingerLeftId,
              sinceMs: atMs,
            }
          : null;
      pinch = null;
    },
    onlyFingerDown: () => (fingers.size === 1 ? ([...fingers.values()][0] ?? null) : null),
    forget: forgetPinch,
    isOn: () => pinch !== null,
  };
}
export function usePinchZoom({ store, grid, gridZoom }: PinchZoomProps): PinchZoom {
  let pinchZoom = React.useMemo(() => {
    let place = (): PinchPlace | null => {
      let scrollOnShow = store.scrollOnShow();
      return scrollOnShow === null
        ? null
        : {
            sheetId: scrollOnShow.sheetId,
            scroll: {
              x: scrollOnShow.scrollLeft,
              y: scrollOnShow.scrollTop,
            },
          };
    };
    let view: PinchZoomView = {
      zoom: gridZoom.now,
      place,
      placeOnGrid: (finger: Finger) => (grid.current === null ? null : pointInZoomedElement(grid.current, 1, finger)),
      goTo(zoom: number, scroll: GridPoint) {
        if (store.isEventUnfinished()) return false;
        gridZoom.set(zoom, true);
        let scrollNow = place()?.scroll;
        if (scrollNow !== undefined)
          store.dispatch({
            kind: 'wheelTurned',
            deltaX: scroll.x - scrollNow.x,
            deltaY: scroll.y - scrollNow.y,
            isByFinger: true,
          });
        return true;
      },
    };
    return createPinchZoom(view, () => frameSchedulerOf(grid.current));
  }, [store, grid, gridZoom]);
  React.useEffect(() => () => pinchZoom.forget(), [pinchZoom]);
  return pinchZoom;
}
export const PINCH_FINGER_LAG_MS = 150;
export const fingersApartAndMiddle = (first: GridPoint, second: GridPoint): FingersApart => ({
  apart: Math.hypot(first.x - second.x, first.y - second.y),
  middle: {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  },
});
export const pinchStartOf = (first: GridPoint, second: GridPoint, zoom: number, scroll: GridPoint): PinchStart => {
  let { apart, middle } = fingersApartAndMiddle(first, second);
  return {
    apart,
    zoom,
    under: {
      x: scroll.x + middle.x / zoom,
      y: scroll.y + middle.y / zoom,
    },
  };
};
