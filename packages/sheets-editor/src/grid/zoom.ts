import type { CSSProperties } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { ROW_HEADER_WIDTH } from './cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT } from './cell-metrics.ts';
import type { GridPoint } from './geometry.ts';
import type { SizeOnPage } from '../view/page-view.ts';
/** Which way a zoom step goes: in (1) or out (-1). */
export type ZoomDirection = 1 | -1;
/** A zoom that fits something in view, and the zoom to go back to when it is asked for again. */
export interface ZoomFit {
  of: string;
  zoom: number;
  zoomBefore: number;
}
/** The zoom to set when fitting is asked for, and the fit it makes (none when it goes back). */
export interface ZoomForFitting {
  zoom: number;
  fit: ZoomFit | null;
}
/** A box by its top left corner and its size, in pixels. */
export interface PointBox extends GridPoint {
  width: number;
  height: number;
}
export function zoomStepFrom(zoom: number, direction: ZoomDirection, minZoom: number, maxZoom: number): number {
  let steps = ZOOM_STEPS_OFFERED.filter((step: number) => step > minZoom + 0.005 && step < maxZoom - 0.005);
  return direction === 1
    ? (steps.find((step: number) => step > zoom + 0.005) ?? maxZoom)
    : (steps.filter((step: number) => step < zoom - 0.005).at(-1) ?? minZoom);
}
export function zoomForFitting(fitOf: string, fitZoom: number, zoomNow: number, lastFit: ZoomFit | null): ZoomForFitting {
  let fit = lastFit !== null && isSameZoom(zoomNow, lastFit.zoom) ? lastFit : null;
  if (fit?.of === fitOf)
    return {
      zoom: fit.zoomBefore,
      fit: null,
    };
  if (fit === null && isSameZoom(zoomNow, fitZoom))
    return {
      zoom: 1,
      fit: null,
    };
  let zoomBefore = fit?.zoomBefore ?? zoomNow;
  return {
    zoom: fitZoom,
    fit: {
      of: fitOf,
      zoom: fitZoom,
      zoomBefore: isSameZoom(zoomBefore, fitZoom) ? 1 : zoomBefore,
    },
  };
}
export function readStoredZoom(getStorage: () => Storage): number {
  try {
    return clampZoom(Number.parseFloat(getStorage().getItem(ZOOM_STORAGE_KEY) ?? ''));
  } catch {
    return 1;
  }
}
export interface ZoomState {
  zoom: number;
  /** Whether the last change zoomed about the pointer rather than the top left of the cells. */
  isAboutPointer: boolean;
}
export interface ZoomStore {
  store: StoreApi<ZoomState>;
  now(): number;
  set(next: number, isAboutPointer?: boolean): void;
  subscribe(listener: (isAboutPointer: boolean) => void): () => void;
}
export function createZoomStore(getStorage: () => Storage): ZoomStore {
  const store = createStore<ZoomState>()(() => ({ zoom: readStoredZoom(getStorage), isAboutPointer: false }));
  return {
    store,
    now: () => store.getState().zoom,
    set(next, isAboutPointer = false) {
      const zoom = clampZoom(next);
      if (zoom === store.getState().zoom) return;
      try {
        getStorage().setItem(ZOOM_STORAGE_KEY, String(zoom));
      } catch {}
      store.setState({ zoom, isAboutPointer });
    },
    subscribe: (listener) => store.subscribe((state) => listener(state.isAboutPointer)),
  };
}
const zoomOf = (state: ZoomState): number => state.zoom;
export const useZoom = (zoom: ZoomStore): number => useStore(zoom.store, zoomOf);
export function pointInZoomedElement(element: Element, zoom: number, { clientX, clientY }: Pick<MouseEvent, 'clientX' | 'clientY'>): GridPoint {
  let { left, top } = element.getBoundingClientRect();
  return {
    x: unzoomLength(clientX - left - element.clientLeft, zoom),
    y: unzoomLength(clientY - top - element.clientTop, zoom),
  };
}
export function boxOnScreen(element: Element, zoom: number, { x, y, width, height }: PointBox): PointBox {
  let { left, top } = element.getBoundingClientRect();
  return {
    x: left + element.clientLeft + x * zoom,
    y: top + element.clientTop + y * zoom,
    width: width * zoom,
    height: height * zoom,
  };
}
export const ZOOM_STEPS_OFFERED = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2];
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const nextZoomStep = (zoom: number, direction: ZoomDirection): number => zoomStepFrom(zoom, direction, MIN_ZOOM, MAX_ZOOM);
export const ZOOM_STEP_FACTOR = 1.25;
export const zoomPercent = (zoom: number): number => Math.round(zoom * 100);
export const ZOOM_STORAGE_KEY = 'sheets-zoom';
export const clampZoom = (zoom: number): number => (Number.isFinite(zoom) && zoom > 0 ? Math.max(MIN_ZOOM, Math.min(zoom, MAX_ZOOM)) : 1);
export const FIT_ZOOM_MARGIN = 8;
export const zoomToFit = (content: SizeOnPage, room: SizeOnPage): number =>
  clampZoom(
    Math.min(
      1,
      room.width / (ROW_HEADER_WIDTH + content.width + 2 * FIT_ZOOM_MARGIN),
      room.height / (COLUMN_HEADER_HEIGHT + content.height + 2 * FIT_ZOOM_MARGIN),
    ),
  );
export const isSameZoom = (zoom: number, other: number): boolean => Math.abs(zoom - other) < 0.005;
export const withFitZoom = (fit: ZoomFit, zoom: number): ZoomFit => ({
  ...fit,
  zoom,
  zoomBefore: isSameZoom(fit.zoomBefore, zoom) ? 1 : fit.zoomBefore,
});
export const NEAR_FULL_ZOOM_TOLERANCE = 0.04;
export const isNearFullZoom = (zoom: number): boolean => Math.abs(zoom - 1) <= NEAR_FULL_ZOOM_TOLERANCE;
export const zoomedStyle = (zoom: number): CSSProperties =>
  zoom === 1
    ? {}
    : {
        width: `${100 / zoom}%`,
        height: `${100 / zoom}%`,
        transform: `scale(${zoom})`,
      };
export const unzoomLength = (length: number, zoom: number): number => length / zoom;
