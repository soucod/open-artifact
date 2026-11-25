/**
 * Which artboards run live, and snapshots for the rest.
 *
 * An artboard on the canvas is a whole document in an iframe. Hundreds of
 * them make panning and zooming slow (every frame is a layer the browser
 * composites and rasterizes again at each zoom) and cost memory. So only a
 * few artboards are live at a time:
 *
 * - the ones on screen (plus a margin) once the camera has been still for a
 *   moment, at a zoom where their content can be read, at most `MAX_LIVE`,
 *   nearest the middle of the view first;
 * - the ones the person is working with: selected, edited in place, or
 *   under the pointer in comment mode (so a comment reaches an element at
 *   any zoom);
 * - a few "warming" ones in the background, mounted only to take their
 *   snapshot and let go again.
 *
 * Every other artboard shows its snapshot: an image of its page taken from
 * its live frame, once its web fonts loaded, and carrying them (see
 * `pageImage`). A snapshot is keyed by the source, size and tweaks it was
 * taken with; when they change, the artboard is warmed again.
 *
 * An artboard that stops being live keeps its frame for a while, hidden
 * behind its snapshot ("resting", at most `MAX_RESTING`, the most recently
 * shown first). Zooming out past `LIVE_MIN_ZOOM` and back in, or panning
 * between two groups of artboards, then shows the frames at once instead of
 * loading every page and its fonts again.
 *
 * `?open_artifact_live=all` turns this off: every artboard is live, as before (for
 * comparing in benchmarks, and as a way out).
 *
 * This is the P0 prototype of docs/zh-CN/rust-wasm-core.md.
 */

import { create } from 'zustand';
import { fontEmbedStats } from '@open-artifact/export-kit';
import { boardsOnPage } from '@open-artifact/design-core';
import { snapshotScale } from '../lib/scene.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { frameOf } from './frames.ts';
import { pageImage } from './capture.ts';
import { viewportSize, visibleRect } from './viewport.ts';

/** Below this zoom, artboards on screen stay snapshots (their text is too small to read). */
export const LIVE_MIN_ZOOM = 0.3;
/** At most this many artboards are live for being on screen. */
export const MAX_LIVE = 16;
/** The camera counts as still after this long without moving. */
const IDLE_MS = 150;
/** A booted artboard is captured once it has been quiet this long (images, first effects). */
const SETTLE_MS = 400;
/** Web fonts still loading hold an artboard's snapshot back, this long at most. */
const FONT_WAIT_MS = 8_000;
/** Artboards warmed at the same time. */
const WARM_CONCURRENCY = 3;
/** A warming artboard that has not booted by then is given up on (until its source changes). */
const WARM_TIMEOUT_MS = 10_000;
/** Longest side of a snapshot in image pixels, unless the artboard needs more to stay sharp (lib/scene.ts `snapshotScale`). */
const SNAPSHOT_MAX_SIDE = 1024;
/** No snapshot is larger than this on its longest side. */
const SNAPSHOT_LIMIT_SIDE = 2048;
/**
 * Most web font data one snapshot carries, characters of `data:` URL. The
 * browser reads the fonts again for every snapshot, about 30 ms of main
 * thread a megabyte. A TrueType font is inlined as a subset holding only the
 * ideographs and Hangul the artboard uses (export-kit font-subset.ts), so a
 * big CJK font costs a few megabytes; CFF (OpenType-CFF) fonts, variable
 * fonts with `gvar`, WOFF and WOFF2 files, TrueType collections and AAT
 * (`morx`) fonts are still inlined whole. Families that do not fit are left
 * out: their text shows in a fallback font and the snapshot is marked `rough`.
 */
const SNAPSHOT_FONT_BYTES = 8 * 1024 * 1024;
/** Frames kept, hidden, after their artboards stopped being live. */
const MAX_RESTING = 16;

/** `?open_artifact_live=all`: every artboard live, no snapshots. */
export const liveAll = (() => {
  try {
    return new URLSearchParams(location.search).get('open_artifact_live') === 'all';
  } catch {
    return false;
  }
})();

export interface Snapshot {
  /** Object URL of the image, `null` when it could not be taken. */
  url: string | null;
  /** What it was taken from (see {@link snapshotKey}). */
  key: string;
  /** Some web fonts were too large to carry: its text is in fallback fonts, so it never stands in for a frame that could show. */
  rough?: boolean;
}

interface LiveState {
  /** Artboards that have a frame. */
  live: ReadonlySet<string>;
  /** Those of `live` whose frame is only kept for later: they show their snapshot (once they have one). */
  resting: ReadonlySet<string>;
  snapshots: Readonly<Record<string, Snapshot>>;
}

export const useLive = create<LiveState>(() => ({ live: new Set(), resting: new Set(), snapshots: {} }));

/** Whether an artboard has a frame on the canvas. */
export const isLive = (path: string, live: ReadonlySet<string>): boolean => liveAll || live.has(path);

/** FNV-1a of a string, as 8 hex digits. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** What a snapshot of the artboard must have been taken from to be current, or null (no source yet). */
function snapshotKey(path: string): string | null {
  const source = useDocument.getState().boards[path]?.source;
  const entry = useDocument.getState().canvas.boards[path];
  if (source == null || !entry) return null;
  const overrides = useView.getState().overrides[path];
  return `${hash(source)}:${entry.w}x${entry.h}:${overrides ? hash(JSON.stringify(overrides)) : ''}`;
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** Reports when the camera starts and stops moving; returns the unsubscribe function. */
export type MotionSource = (listener: (moving: boolean) => void) => () => void;

/**
 * Runs while the canvas is mounted: keeps `live` current and takes
 * snapshots. Returns the stop function. Without a `motion` source, any
 * camera change in the view store counts as motion until it has been still
 * for a moment; the canvas engine reports motion itself (services/engine.ts).
 */
export function startLive(motion?: MotionSource): () => void {
  if (liveAll) return () => {};
  let moving = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let pumpTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerDown = false;
  let capturing = false;
  let stopped = false;
  /** Snapshots taken and the main-thread time they took (for benchmarks). */
  const stats = { captures: 0, captureMs: 0, worstCaptureMs: 0 };
  /** Artboards mounted only to be captured, with when they were mounted. */
  const warming = new Map<string, number>();
  /** Key an artboard could not be warmed or captured with: not tried again until it changes. */
  const failed = new Map<string, string>();
  /** When each live artboard last booted or changed. */
  const changedAt = new Map<string, number>();
  /** Since when each artboard's snapshot has waited for web fonts. */
  const fontWait = new Map<string, number>();
  /** When each artboard was last live for itself (on screen or worked with, not only warmed). */
  const shownAt = new Map<string, number>();

  /** The artboards that should be live now for themselves (those warming come on top). */
  const wanted = (): Set<string> => {
    const view = useView.getState();
    const { canvas } = useDocument.getState();
    const out = new Set<string>();
    const exists = (path: string) => Boolean(canvas.boards[path]);
    const selection = view.selection;
    if (selection.kind === 'objects') selection.boards.filter(exists).forEach((p) => out.add(p));
    if (selection.kind === 'elements' && exists(selection.board)) out.add(selection.board);
    if (view.textEdit && exists(view.textEdit.board)) out.add(view.textEdit.board);
    if (view.hover && exists(view.hover.board)) out.add(view.hover.board);
    if (view.playing && exists(view.playing)) out.add(view.playing);
    if (view.peek && exists(view.peek)) out.add(view.peek);
    const camera = view.camera;
    if (camera.zoom >= LIVE_MIN_ZOOM && viewportSize.width > 0) {
      const rect = visibleRect(camera);
      const mx = rect.w / 2;
      const my = rect.h / 2;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const near = boardsOnPage(canvas, view.page)
        .map((path) => ({ path, e: canvas.boards[path]! }))
        .filter(({ e }) => e.x < rect.x + rect.w + mx && e.x + e.w > rect.x - mx && e.y < rect.y + rect.h + my && e.y + e.h > rect.y - my)
        .map(({ path, e }) => ({ path, d: Math.hypot(e.x + e.w / 2 - cx, e.y + e.h / 2 - cy) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_LIVE);
      for (const { path } of near) out.add(path);
    }
    return out;
  };

  /**
   * Applies `wanted()`. While the camera moves, only what the person works
   * with is added (nothing mounts mid-motion) and nothing is let go. Once it
   * is still, frames no longer wanted rest, the most recently shown first,
   * and the others are let go.
   */
  const recompute = (): void => {
    if (stopped) return;
    const current = useLive.getState();
    const { canvas } = useDocument.getState();
    const want = wanted();
    const live = new Set<string>();
    const resting = new Set<string>();
    if (moving) {
      for (const p of current.live) {
        if (!canvas.boards[p]) continue;
        live.add(p);
        if (current.resting.has(p) && !isPinned(p)) resting.add(p);
      }
      for (const p of want) if (isPinned(p)) live.add(p);
      for (const p of warming.keys()) if (canvas.boards[p]) live.add(p);
    } else {
      const now = performance.now();
      for (const p of shownAt.keys()) if (!canvas.boards[p]) shownAt.delete(p);
      for (const p of want) {
        live.add(p);
        shownAt.set(p, now);
      }
      for (const p of warming.keys()) if (canvas.boards[p]) live.add(p);
      const page = new Set(boardsOnPage(canvas, useView.getState().page));
      const kept = [...current.live]
        .filter((p) => !live.has(p) && page.has(p) && shownAt.has(p))
        .sort((a, b) => shownAt.get(b)! - shownAt.get(a)!)
        .slice(0, MAX_RESTING);
      for (const p of kept) {
        live.add(p);
        resting.add(p);
      }
    }
    if (!sameSet(current.live, live) || !sameSet(current.resting, resting)) useLive.setState({ live, resting });
  };

  const isPinned = (path: string): boolean => {
    const view = useView.getState();
    const s = view.selection;
    return (s.kind === 'objects' && s.boards.includes(path)) || (s.kind === 'elements' && s.board === path) || view.textEdit?.board === path || view.playing === path;
  };

  const schedule = (ms: number): void => {
    clearTimeout(pumpTimer);
    pumpTimer = setTimeout(pump, ms);
  };

  /** Takes the next snapshot that is due, then starts warming what still has none. */
  const pump = (): void => {
    if (stopped || capturing) return;
    // A capture is one long task: never while the camera moves, a pointer is down, or someone types on the canvas.
    const typing = useView.getState().textEdit !== null || useView.getState().noteEdit !== null;
    if (moving || pointerDown || typing) {
      schedule(300);
      return;
    }
    const now = performance.now();
    const view = useView.getState();
    const { live, snapshots } = useLive.getState();
    let waitMs = Infinity;
    for (const path of live) {
      const key = snapshotKey(path);
      if (!key || snapshots[path]?.key === key || failed.get(path) === key) continue;
      if (!view.frames[path]?.booted) {
        const since = warming.get(path);
        if (since !== undefined && now - since > WARM_TIMEOUT_MS) {
          failed.set(path, key);
          warming.delete(path);
          recompute();
        }
        continue;
      }
      // A face still loading is not in the page yet: its text would be captured in a fallback font.
      if (frameOf(path)?.contentDocument?.fonts?.status === 'loading') {
        const since = fontWait.get(path) ?? now;
        fontWait.set(path, since);
        if (now - since < FONT_WAIT_MS) {
          waitMs = Math.min(waitMs, 200);
          continue;
        }
      } else if (fontWait.delete(path)) changedAt.set(path, now); // the fonts arrived: let the layout settle with them
      const quiet = now - (changedAt.get(path) ?? 0);
      if (quiet < SETTLE_MS) {
        waitMs = Math.min(waitMs, SETTLE_MS - quiet);
        continue;
      }
      void capture(path, key);
      return;
    }
    // Warm what has no current snapshot, nearest the middle of the view first.
    if (warming.size < WARM_CONCURRENCY) {
      const { canvas } = useDocument.getState();
      const rect = visibleRect(view.camera);
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const due = boardsOnPage(canvas, view.page)
        .filter((path) => !live.has(path))
        .filter((path) => {
          const key = snapshotKey(path);
          return key !== null && snapshots[path]?.key !== key && failed.get(path) !== key;
        })
        .map((path) => {
          const e = canvas.boards[path]!;
          return { path, d: Math.hypot(e.x + e.w / 2 - cx, e.y + e.h / 2 - cy) };
        })
        .sort((a, b) => a.d - b.d)
        .slice(0, WARM_CONCURRENCY - warming.size);
      if (due.length) {
        for (const { path } of due) warming.set(path, now);
        recompute();
        waitMs = Math.min(waitMs, SETTLE_MS);
      }
    }
    if (warming.size) waitMs = Math.min(waitMs, 500);
    if (waitMs < Infinity) schedule(waitMs);
  };

  const capture = async (path: string, key: string): Promise<void> => {
    capturing = true;
    try {
      const doc = frameOf(path)?.contentDocument;
      const entry = useDocument.getState().canvas.boards[path];
      if (!doc || !entry) return;
      const scale = snapshotScale(entry, { side: SNAPSHOT_MAX_SIDE, limit: SNAPSHOT_LIMIT_SIDE, sharpZoom: LIVE_MIN_ZOOM, dpr: window.devicePixelRatio || 1 });
      let url: string | null = null;
      let rough = false;
      const started = performance.now();
      try {
        url = URL.createObjectURL(await pageImage(doc, entry.w, entry.h, { scale, type: 'image/jpeg', fontBytes: SNAPSHOT_FONT_BYTES, onSkippedFonts: () => (rough = true) }));
      } catch {
        failed.set(path, key);
      }
      const took = performance.now() - started;
      stats.captures++;
      stats.captureMs += took;
      stats.worstCaptureMs = Math.max(stats.worstCaptureMs, took);
      if (stopped) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      // The source may have changed while the capture ran: keep the image, but under the key it was taken with.
      const old = useLive.getState().snapshots[path];
      if (url || !old) {
        if (old?.url) URL.revokeObjectURL(old.url);
        useLive.setState({ snapshots: { ...useLive.getState().snapshots, [path]: { url, key, ...(rough ? { rough } : {}) } } });
      }
    } finally {
      capturing = false;
      fontWait.delete(path);
      if (warming.delete(path)) recompute();
      schedule(0);
    }
  };

  const stopMotion = motion?.((now) => {
    moving = now;
    if (!now) {
      recompute();
      schedule(0);
    }
  });
  const unsubscribeView = useView.subscribe((state, prev) => {
    if (state.camera !== prev.camera && !motion) {
      moving = true;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        moving = false;
        recompute();
        schedule(0);
      }, IDLE_MS);
    }
    if (state.page !== prev.page || state.selection !== prev.selection || state.textEdit !== prev.textEdit || state.hover !== prev.hover || state.peek !== prev.peek || state.playing !== prev.playing) recompute();
    if (state.frames !== prev.frames) {
      const now = performance.now();
      for (const [path, info] of Object.entries(state.frames)) if (info !== prev.frames[path]) changedAt.set(path, now);
      schedule(0);
    }
    if (state.overrides !== prev.overrides || state.layoutTick !== prev.layoutTick) schedule(SETTLE_MS);
  });
  const unsubscribeDocument = useDocument.subscribe((state, prev) => {
    if (state.canvas !== prev.canvas) recompute();
    if (state.boards !== prev.boards) {
      const now = performance.now();
      for (const path of Object.keys(state.boards)) if (state.boards[path] !== prev.boards[path]) changedAt.set(path, now);
      schedule(SETTLE_MS);
    }
  });
  const onDown = () => (pointerDown = true);
  const onUp = () => {
    pointerDown = false;
    schedule(IDLE_MS);
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);

  recompute();
  schedule(SETTLE_MS);
  // For benchmarks and debugging (e2e/bench/canvas.mjs).
  (globalThis as { __openArtifactLive?: unknown }).__openArtifactLive = () => ({
    live: [...useLive.getState().live],
    resting: [...useLive.getState().resting],
    warming: [...warming.keys()],
    moving,
    pointerDown,
    capturing,
    failed: failed.size,
    snapshots: Object.keys(useLive.getState().snapshots).length,
    camera: useView.getState().camera,
    viewport: { ...viewportSize },
    captures: stats.captures,
    meanCaptureMs: stats.captures ? Math.round(stats.captureMs / stats.captures) : 0,
    worstCaptureMs: Math.round(stats.worstCaptureMs),
    fonts: fontEmbedStats(),
  });
  return () => {
    stopped = true;
    clearTimeout(idleTimer);
    clearTimeout(pumpTimer);
    stopMotion?.();
    unsubscribeView();
    unsubscribeDocument();
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    warming.clear();
    useLive.setState({ resting: new Set() });
  };
}
