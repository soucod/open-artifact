/**
 * The camera store: where this tab looks. Panning and zooming update it many
 * times a second, so the board layer subscribes imperatively and writes its
 * transform straight to the DOM; React components select only what they
 * render (usually the zoom).
 */

import { create } from 'zustand';
import { DEFAULT_CAMERA, MAX_ZOOM, MIN_ZOOM, clampZoom, sameCamera, type Camera, type Point } from '../lib/camera.ts';

/** Screen space taken by floating chrome, so fitting avoids it. */
export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CameraState {
  camera: Camera;
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
  /** Chrome over the viewport edges. */
  insets: ViewportInsets;
  /** Last pointer position over the board, screen pixels (for paste and cursor chat). */
  pointer: Point | null;
  /** Sets the camera (clamped to the zoom range). */
  setCamera(camera: Camera): void;
  setViewport(width: number, height: number): void;
  setInsets(insets: ViewportInsets): void;
  setPointer(pointer: Point | null): void;
}

/**
 * The zoom range: the same in every viewport. A narrow pane or a touch screen has no larger minimum: one made "Fit the
 * board" stop short of the whole board there, with nothing left to zoom out to.
 */
export function zoomRange(): { min: number; max: number } {
  return { min: MIN_ZOOM, max: MAX_ZOOM };
}

export const useCamera = create<CameraState>()((set, get) => ({
  camera: DEFAULT_CAMERA,
  width: 1,
  height: 1,
  insets: { top: 56, right: 16, bottom: 88, left: 16 },
  pointer: null,
  setCamera(camera) {
    const { min, max } = zoomRange();
    const next = { ...camera, zoom: clampZoom(camera.zoom, min, max) };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || sameCamera(next, get().camera)) return;
    set({ camera: next });
  },
  setViewport(width, height) {
    if (width === get().width && height === get().height) return;
    set({ width, height });
  },
  setInsets(insets) {
    set({ insets });
  },
  setPointer(pointer) {
    set({ pointer });
  },
}));
