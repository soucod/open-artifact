/**
 * Camera helpers: the viewport element's size, zooming around a point,
 * fitting content, and which artboards are on screen.
 */

import { noteBounds } from '../lib/notes.ts';
import { nextZoomStep, ZOOM_PRESETS } from '@open-artifact/canvas-engine/camera';
import { boardsOnPage, notesOnPage, unionRect, type Canvas, type Rect } from '@open-artifact/design-core';
import { useDocument } from '../state/document.ts';
import { MAX_ZOOM, MIN_ZOOM, useView, type Camera } from '../state/view.ts';

/** The viewport element's size, updated by the canvas component. */
export const viewportSize = { width: 1, height: 1 };

/** Fit the page, or `boards` when set, once the canvas has measured itself (on load, after the focused view). */
export const pendingFit: { current: boolean; boards: string[] | null } = { current: true, boards: null };

/** Zoom presets offered by the zoom menu. */
export { ZOOM_PRESETS };

/** Zooms around a screen point, keeping it fixed. */
export function zoomAt(camera: Camera, zoom: number, x: number, y: number): Camera {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const wx = (x - camera.x) / camera.zoom;
  const wy = (y - camera.y) / camera.zoom;
  return { zoom: clamped, x: x - wx * clamped, y: y - wy * clamped };
}

/** The next zoom step in a direction. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  return nextZoomStep(zoom, direction, MIN_ZOOM, MAX_ZOOM, 1e-6);
}

/** Zooms by one step around the viewport center. */
export function zoomStep(direction: 1 | -1): void {
  const view = useView.getState();
  view.setCamera(zoomAt(view.camera, stepZoom(view.camera.zoom, direction), viewportSize.width / 2, viewportSize.height / 2));
}

/** Sets an exact zoom around the viewport center. */
export function zoomTo(zoom: number): void {
  const view = useView.getState();
  view.setCamera(zoomAt(view.camera, zoom, viewportSize.width / 2, viewportSize.height / 2));
}

const BOARD_HEADER_HEIGHT = 40;

/** World rects of everything on a page, including the artboard title bars. */
export function pageRects(canvas: Canvas, page: string | null): Rect[] {
  const rects: Rect[] = boardsOnPage(canvas, page).map((path) => {
    const entry = canvas.boards[path]!;
    return { x: entry.x, y: entry.y - BOARD_HEADER_HEIGHT, w: entry.w, h: entry.h + BOARD_HEADER_HEIGHT };
  });
  for (const id of notesOnPage(canvas, page)) {
    const note = canvas.notes[id]!;
    rects.push(noteBounds(note));
  }
  return rects;
}

/** Fits a world rect in the viewport with a margin. */
export function fitRect(rect: Rect, margin = 64, maxZoom = 1, top = 0): Camera {
  const width = Math.max(1, viewportSize.width - margin * 2);
  const height = Math.max(1, viewportSize.height - top - margin * 2);
  const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, width / Math.max(1, rect.w), height / Math.max(1, rect.h)));
  return {
    zoom,
    x: viewportSize.width / 2 - (rect.x + rect.w / 2) * zoom,
    y: (viewportSize.height + top) / 2 - (rect.y + rect.h / 2) * zoom,
  };
}

/** Fits the current page. */
export function zoomToFit(): void {
  const { canvas } = useDocument.getState();
  const view = useView.getState();
  const rect = unionRect(pageRects(canvas, view.page));
  if (rect) view.setCamera(fitRect(rect, 48, 2, Math.min(56, viewportSize.height / 4)));
  else view.setCamera({ x: viewportSize.width / 2, y: viewportSize.height / 2, zoom: 1 });
}

/** Fits the given artboards. */
export function zoomToBoards(paths: readonly string[]): void {
  const { canvas } = useDocument.getState();
  const rect = unionRect(paths.map((path) => canvas.boards[path]).filter(Boolean).map((e) => ({ x: e!.x, y: e!.y, w: e!.w, h: e!.h })));
  if (rect) useView.getState().setCamera(fitRect(rect, 80, 2));
}

/** The visible world rect. */
export function visibleRect(camera: Camera = useView.getState().camera): Rect {
  return { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, w: viewportSize.width / camera.zoom, h: viewportSize.height / camera.zoom };
}

/** Artboards of the current page intersecting the viewport, in canvas order. */
export function visibleBoards(): string[] {
  const { canvas } = useDocument.getState();
  const view = useView.getState();
  const rect = visibleRect(view.camera);
  return boardsOnPage(canvas, view.page).filter((path) => {
    const e = canvas.boards[path]!;
    return e.x < rect.x + rect.w && e.x + e.w > rect.x && e.y < rect.y + rect.h && e.y + e.h > rect.y;
  });
}

/* -------------------------------- glide ---------------------------------- */

let glide: { frame: number } | null = null;

/** Moves the camera when something other than the store animates it (the canvas engine, services/engine.ts). */
export interface CameraDriver {
  /** Animates to a camera over `ms` (0 jumps). */
  glide(target: Camera, ms: number): void;
  /** Stops an animation where it is. */
  halt(): void;
}

/** The driver in use, if any. */
export const cameraDriver: { current: CameraDriver | null } = { current: null };

/** Stops a running glide where it is. */
export function haltGlide(): void {
  cameraDriver.current?.halt();
  if (glide) cancelAnimationFrame(glide.frame);
  glide = null;
}

/**
 * Moves the camera to `target` over `ms` with an ease-out, zooming in log
 * space so the motion feels even. Viewers who prefer reduced motion jump.
 */
export function glideTo(target: Camera, ms = 450): void {
  haltGlide();
  const view = useView.getState();
  const from = view.camera;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (cameraDriver.current) {
    cameraDriver.current.glide(target, reduced ? 0 : ms);
    return;
  }
  if (reduced || ms <= 0) {
    view.setCamera(target);
    return;
  }
  const start = performance.now();
  // Interpolate the world point at the screen centre and the log of zoom.
  const cx = viewportSize.width / 2;
  const cy = viewportSize.height / 2;
  const fromCentre = { x: (cx - from.x) / from.zoom, y: (cy - from.y) / from.zoom };
  const toCentre = { x: (cx - target.x) / target.zoom, y: (cy - target.y) / target.zoom };
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / ms);
    const k = 1 - (1 - t) ** 3;
    const zoom = Math.exp(Math.log(from.zoom) + (Math.log(target.zoom) - Math.log(from.zoom)) * k);
    const wx = fromCentre.x + (toCentre.x - fromCentre.x) * k;
    const wy = fromCentre.y + (toCentre.y - fromCentre.y) * k;
    useView.getState().setCamera(t >= 1 ? target : { zoom, x: cx - wx * zoom, y: cy - wy * zoom });
    if (t < 1 && glide) glide.frame = requestAnimationFrame(step);
    else glide = null;
  };
  glide = { frame: requestAnimationFrame(step) };
}
