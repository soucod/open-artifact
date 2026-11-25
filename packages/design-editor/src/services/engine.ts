/**
 * The canvas drawn by the WebGL2 engine (`@open-artifact/canvas-engine`,
 * docs/zh-CN/rust-wasm-core.md §2).
 *
 * The document stays in the stores; the engine keeps a mirror of the current
 * page (lib/scene.ts), patched whenever the canvas, the live frames or the
 * snapshots change. It draws the grid, artboard snapshots and placeholders,
 * note bodies, selection, hover, marquee and snap guides, and runs the
 * object gestures: select, marquee, move, resize, pan and zoom. Selection is
 * 'controlled': the engine proposes it and the view store decides; finished
 * drags arrive as `commit`s and become canvas edits (services/commands.ts).
 *
 * Live artboards are holes in the canvas with their frame placed underneath
 * (`registerLiveBoard`). A pan moves their frames with the camera; while
 * the camera zooms, live artboards that have a snapshot are drawn from it and
 * their frames hidden, and once it settles the frames show again
 * (services/live.ts decides which artboards are live). A snapshot that left
 * web fonts out (`rough`) does not stand in for a frame while zooming: the
 * text would change font twice. Resting artboards keep a frame but show
 * their snapshot.
 *
 * The camera belongs to the engine. Layers that must follow it every frame
 * (note text, artboard labels) subscribe with `onCameraFrame`; the view
 * store's camera is updated at most every `STORE_CAMERA_MS` while moving and
 * once when it settles.
 *
 * `?open_artifact_engine=off` keeps the DOM canvas (components/Canvas.tsx), which is
 * also used when the engine cannot start (no WebGL2).
 */

import { CanvasEngine, parseColor, type CanvasItem, type HoleRect, type Theme } from '@open-artifact/canvas-engine';
import { boardsOnPage, expandNotesToGroups, groupItems, notesOnPage } from '@open-artifact/design-core';
import { boardItem, boardItemId, fromEngineCamera, imageKey, itemTarget, noteItem, noteItemId, smallSnapshot, SMALL_SNAPSHOT_WIDTH, toEngineCamera } from '../lib/scene.ts';
import { useDocument } from '../state/document.ts';
import { MAX_ZOOM, MIN_ZOOM, useView, type Camera, type Selection, type Tool } from '../state/view.ts';
import { commitMove, commitResize } from './commands.ts';
import { isLive, useLive, type MotionSource } from './live.ts';
import { cameraDriver, viewportSize } from './viewport.ts';

/** `?open_artifact_engine=off`: the DOM canvas, for comparing in benchmarks and as a way out. */
export const engineEnabled = (() => {
  try {
    return new URLSearchParams(location.search).get('open_artifact_engine') !== 'off';
  } catch {
    return true;
  }
})();

/** While the camera moves, the view store's camera is updated at most this often. */
const STORE_CAMERA_MS = 100;
/** Image notes are uploaded at most this wide. */
const MAX_IMAGE_WIDTH = 1024;

/** The running engine, while the canvas shows one. */
let active: {
  engine: CanvasEngine;
  /** A note's text box was laid out at a new size. */
  noteResized: () => void;
} | null = null;
const frameListeners = new Set<(camera: Camera) => void>();
const motionListeners = new Set<(moving: boolean) => void>();
const liveBoards = new Map<string, HTMLElement>();
let holes = new Map<string, HoleRect>();

/** The engine drawing the canvas, if one runs. */
export const activeEngine = (): CanvasEngine | null => active?.engine ?? null;

/** The camera as drawn now: the engine's when it runs (the view store's lags while it moves). */
export function liveCamera(): Camera {
  return active ? fromEngineCamera(active.engine.camera) : useView.getState().camera;
}

/** The artboard or note the engine draws at a point of the canvas (CSS pixels from its corner). */
export function itemAt(point: { x: number; y: number }): { board: string } | { note: string } | null {
  const id = active?.engine.hitTest(point);
  return id ? itemTarget(id) : null;
}

/** Calls `listener` with the camera of every frame in which it moved; returns the unsubscribe function. */
export function onCameraFrame(listener: (camera: Camera) => void): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

/** The engine's camera motion, for services/live.ts. */
export const engineMotion: MotionSource = (listener) => {
  motionListeners.add(listener);
  return () => motionListeners.delete(listener);
};

/** Places a live artboard's frame element over its hole; returns the unregister function. */
export function registerLiveBoard(path: string, element: HTMLElement): () => void {
  liveBoards.set(path, element);
  placeLiveBoard(path, element);
  return () => {
    if (liveBoards.get(path) === element) liveBoards.delete(path);
  };
}

/**
 * Starts the engine moving an artboard or note (and the selection, if it is in
 * it) from a press outside its canvas, e.g. on an artboard's title. Returns
 * false when the engine does not run or cannot move it.
 */
export function startEngineMove(target: { board: string } | { note: string }, event: PointerEvent, point: { x: number; y: number }): boolean {
  const engine = active?.engine;
  if (!engine) return false;
  const id = 'board' in target ? boardItemId(target.board) : noteItemId(target.note);
  return engine.startMove(id, { id: event.pointerId, ...point, shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey });
}

/** Rendered text box sizes of notes (kept while the engine starts, and for notes no longer mounted). */
const noteSizes = new Map<string, { w: number; h: number }>();

const noteObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const id = element.dataset.note;
        const w = element.offsetWidth;
        const h = element.offsetHeight;
        const last = id ? noteSizes.get(id) : undefined;
        if (!id || !w || (last && Math.abs(last.w - w) < 0.5 && Math.abs(last.h - h) < 0.5)) continue;
        noteSizes.set(id, { w, h });
        changed = true;
      }
      if (changed) active?.noteResized();
    })
  : null;

/**
 * Reports the size a note's text box renders at (world units; it decides the
 * size of stickies, titles and link cards). Returns the stop function.
 */
export function observeNoteSize(element: HTMLElement): () => void {
  noteObserver?.observe(element);
  return () => noteObserver?.unobserve(element);
}

function placeLiveBoard(path: string, element: HTMLElement): void {
  const hole = holes.get(boardItemId(path));
  if (hole) {
    element.style.transform = hole.transform;
    element.style.visibility = '';
  } else element.style.visibility = 'hidden';
}

/* -------------------------------- colours -------------------------------- */

/** Canvas colours from the page's theme variables. */
function themeOf(element: HTMLElement): Partial<Theme> {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const accent = parseColor(read('--open-artifact-accent', '#2563eb'));
  const withAlpha = (rgba: number, alpha: number) => ((rgba & 0xffffff00) | Math.round(alpha * 255)) >>> 0;
  const line = parseColor(read('--open-artifact-line-strong', 'rgba(0,0,0,0.2)'));
  return {
    // Transparent: the surface's own background shows, and so do live frames' shadows.
    background: 'transparent',
    grid: withAlpha(line, ((line & 0xff) / 255) * 0.6),
    selection: accent,
    marquee: withAlpha(accent, 0.1),
    guide: '#f43f5e',
    handle: '#ffffff',
  };
}

/* --------------------------------- engine -------------------------------- */

/** The engine's tool for the editor's (Space held pans whatever the tool). */
const engineTool = (tool: Tool, spacePan: boolean): 'select' | 'pan' | 'none' => (spacePan || tool === 'hand' ? 'pan' : tool === 'select' ? 'select' : 'none');

/** Engine ids of the selected objects. */
function selectionIds(selection: Selection): string[] {
  if (selection.kind !== 'objects') return [];
  return [...selection.boards.map(boardItemId), ...selection.notes.map(noteItemId)];
}

/**
 * Starts the engine on `canvas` inside the canvas `surface` (which gets
 * `data-moving` while the camera moves and `data-gesture` during a drag).
 * Rejects when it cannot (no WebGL2); resolves to the stop function.
 */
export async function startEngine(canvas: HTMLCanvasElement, surface: HTMLElement): Promise<() => void> {
  const view = useView.getState();
  const engine = await CanvasEngine.create(canvas, {
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    selection: 'controlled',
    snap: true,
    grid: 'dots',
    gridSpacing: 24,
    // Every frame: layers in the DOM follow the camera in the frame it is drawn.
    cameraEventMs: 0,
    settleMs: 150,
    zoomSpeed: 0.0025,
    // The DOM canvas zoomed by exp(-deltaY × 0.0025) per event, unlimited.
    wheelZoomMax: Infinity,
    hitTolerance: 6,
    fadeMs: 120,
    tool: engineTool(view.tool, view.spacePan),
    theme: themeOf(surface),
  });
  let stopped = false;
  const dpr = () => (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  engine.setCamera(toEngineCamera(view.camera));

  /* ---- the mirror ---- */

  /** What was last sent per item: the document object it came from and how it was drawn. */
  const sent = new Map<string, { source: unknown; look: string }>();
  const remember = (item: CanvasItem, source: unknown, look: string): CanvasItem => {
    sent.set(item.id, { source, look });
    return item;
  };
  /** The snapshot texture an artboard shows (uploaded), by path. */
  const shown = new Map<string, string>();
  /** What each texture key is loaded from. */
  const sources = new Map<string, { url: string; path?: string; width?: number }>();
  const loading = new Set<string>();
  let moving = false;
  /** The zoom when the camera started moving, and whether it has changed since (a zoom, not a pan). */
  let motionZoom = 1;
  let zooming = false;
  let syncQueued = false;

  /** Texture key of the snapshot an artboard should show now (by its snapshot and how large it is on screen). */
  const wantedTexture = (path: string): string | undefined => {
    const snapshot = useLive.getState().snapshots[path];
    const entry = useDocument.getState().canvas.boards[path];
    if (!snapshot?.url || !entry) return undefined;
    const small = smallSnapshot(entry, engine.camera.zoom, dpr());
    const key = `snap:${small ? 's' : 'l'}:${snapshot.key}:${path}`;
    if (sources.get(key)?.url !== snapshot.url) sources.set(key, { url: snapshot.url, path, ...(small ? { width: Math.min(SMALL_SNAPSHOT_WIDTH, entry.w) } : {}) });
    return key;
  };

  const sync = (): void => {
    syncQueued = false;
    if (stopped) return;
    const { canvas, readOnly } = useDocument.getState();
    const view = useView.getState();
    const { live, resting, snapshots } = useLive.getState();
    const upsert: CanvasItem[] = [];
    const seen = new Set<string>();
    boardsOnPage(canvas, view.page).forEach((path, z) => {
      const entry = canvas.boards[path]!;
      const id = boardItemId(path);
      seen.add(id);
      const texture = shown.get(path) ?? wantedTexture(path);
      const editing = view.textEdit?.board === path || view.playing === path;
      // A booted frame shows through, except where a snapshot stands in for it: for a resting artboard, and
      // while the camera zooms (a pan only moves the frame, which stays sharp; a snapshot is a fraction of its
      // resolution) unless the snapshot is in other fonts than the frame.
      const standIn = shown.has(path) && (resting.has(path) || (zooming && !snapshots[path]?.rough));
      const hole = isLive(path, live) && Boolean(view.frames[path]?.booted) && (editing || !standIn);
      const look = `${hole ? 'h' : 'i'}|${texture ?? ''}|${z}|${readOnly ? 'r' : 'w'}`;
      const last = sent.get(id);
      if (last && last.source === entry && last.look === look) return;
      upsert.push(remember(boardItem(path, entry, { hole, texture, z, editable: !readOnly }), entry, look));
    });
    notesOnPage(canvas, view.page).forEach((noteId, z) => {
      const note = canvas.notes[noteId]!;
      const id = noteItemId(noteId);
      seen.add(id);
      const size = noteSizes.get(noteId);
      const look = `${z}|${readOnly ? 'r' : 'w'}|${size ? `${size.w}x${size.h}` : ''}`;
      const last = sent.get(id);
      if (last && last.source === note && last.look === look) return;
      if (note.kind === 'image' && note.src) sources.set(imageKey(note.src), { url: note.src });
      upsert.push(remember(noteItem(noteId, note, { z, editable: !readOnly, measured: size }), note, look));
    });
    const remove = [...sent.keys()].filter((id) => !seen.has(id));
    for (const id of remove) sent.delete(id);
    if (!upsert.length && !remove.length) return;
    engine.applyPatch({ upsert, remove });
    // Items created after the selection was made (a new note) join it now.
    engine.setSelection(selectionIds(useView.getState().selection));
  };
  const queueSync = (): void => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  };

  /** Re-sends items whose document objects are unchanged (a commit the document did not take). */
  const resend = (ids: readonly string[]): void => {
    for (const id of ids) sent.delete(id);
    sync();
  };

  /** Loads a texture key into the engine; resolves to whether it is there. */
  const load = async (key: string): Promise<boolean> => {
    const source = sources.get(key);
    if (!source || loading.has(key) || (source.path && useLive.getState().snapshots[source.path]?.url !== source.url)) return false;
    loading.add(key);
    try {
      const blob = await (await fetch(source.url)).blob();
      let bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply', ...(source.width ? { resizeWidth: source.width, resizeQuality: 'medium' as const } : {}) });
      if (!source.path && bitmap.width > MAX_IMAGE_WIDTH) {
        const full = bitmap;
        bitmap = await createImageBitmap(full, { premultiplyAlpha: 'premultiply', resizeWidth: MAX_IMAGE_WIDTH, resizeQuality: 'medium' });
        full.close();
      }
      if (stopped) {
        bitmap.close();
        return false;
      }
      const ok = engine.setTexture(key, bitmap);
      bitmap.close();
      return ok;
    } catch {
      return false;
    } finally {
      loading.delete(key);
    }
  };

  /** Shows a loaded snapshot texture on its artboard. */
  const loaded = (key: string): void => {
    const path = sources.get(key)?.path;
    if (!path || shown.get(path) === key) return;
    shown.set(path, key);
    queueSync();
  };

  /** Artboards in view whose texture is not the one their zoom and snapshot call for get it (the old one shows meanwhile). */
  const refreshTextures = (): void => {
    for (const id of engine.queryRect(engine.viewport())) {
      const target = itemTarget(id);
      if (!target || !('board' in target)) continue;
      const want = wantedTexture(target.board);
      if (want && want !== shown.get(target.board)) void load(want).then((ok) => ok && loaded(want));
    }
  };

  /* ---- events ---- */

  let lastStoreWrite = -Infinity;
  /** Set while the engine's camera is written to the store (so the store does not write it back). */
  let echo = false;
  const writeCamera = (camera: Camera): void => {
    lastStoreWrite = performance.now();
    echo = true;
    useView.getState().setCamera(camera);
    echo = false;
  };

  const off = [
    engine.on('camera', (event) => {
      const camera = fromEngineCamera(event);
      for (const listener of frameListeners) listener(camera);
      if (moving && !zooming && Math.abs(event.zoom - motionZoom) > 1e-6) {
        zooming = true;
        sync();
      }
      if (event.settled || performance.now() - lastStoreWrite >= STORE_CAMERA_MS) writeCamera(camera);
    }),
    engine.on('moving', (event) => {
      moving = event.moving;
      motionZoom = engine.camera.zoom;
      zooming = false;
      surface.toggleAttribute('data-moving', moving);
      // The store holds the final camera before anyone reacts to the stop.
      if (!moving) writeCamera(fromEngineCamera(engine.camera));
      for (const listener of motionListeners) listener(moving);
      sync();
      if (!moving) refreshTextures();
    }),
    engine.on('gesture', (event) => {
      surface.toggleAttribute('data-gesture', event.phase === 'start' && event.kind !== 'pan' && event.kind !== 'pinch');
    }),
    engine.on('holes', (event) => {
      holes = new Map(event.holes.map((hole) => [hole.id, hole]));
      for (const [path, element] of liveBoards) placeLiveBoard(path, element);
    }),
    engine.on('textureNeeded', (event) => {
      for (const key of event.keys) void load(key).then((ok) => ok && loaded(key));
    }),
    engine.on('commit', (intent) => {
      const doc = useDocument.getState();
      if (intent.op === 'select') {
        useView.getState().select(proposedSelection(intent.ids, intent.modifiers.shift));
        return;
      }
      const before = doc.canvas;
      if (intent.op === 'move') {
        const boards: string[] = [];
        const notes: string[] = [];
        for (const id of intent.ids) {
          const target = itemTarget(id);
          if (target && 'board' in target) boards.push(target.board);
          else if (target) notes.push(target.note);
        }
        commitMove(boards, notes, intent.dx, intent.dy);
      } else {
        const target = itemTarget(intent.id);
        if (target) commitResize(target, intent.rect);
      }
      // The mirror shows the drag's result; when the document refused it, put the items back.
      if (useDocument.getState().canvas === before) resend(intent.op === 'move' ? intent.ids : [intent.id]);
    }),
  ];

  /**
   * The selection a click or marquee proposes, with grouped notes brought in
   * or out as whole groups (unless the selection has stepped into a group).
   * With Shift the proposal toggled what was pressed.
   */
  const proposedSelection = (ids: readonly string[], shift: boolean): Selection => {
    const boards: string[] = [];
    let notes: string[] = [];
    for (const id of ids) {
      const target = itemTarget(id);
      if (target && 'board' in target) boards.push(target.board);
      else if (target) notes.push(target.note);
    }
    const current = useView.getState().selection;
    const before = current.kind === 'objects' ? current.notes : [];
    const groups = groupItems(useDocument.getState().canvas);
    if (!shift) notes = notes.length ? expandNotesToGroups(groups, notes, before) : notes;
    else {
      // A Shift-click adds or removes one note: its whole group comes or goes with it.
      const added = notes.filter((n) => !before.includes(n));
      const dropped = before.filter((n) => !notes.includes(n));
      if (added.length) notes = [...new Set([...notes, ...expandNotesToGroups(groups, added, before)])];
      if (dropped.length) {
        const gone = new Set(expandNotesToGroups(groups, dropped, before));
        notes = notes.filter((n) => !gone.has(n));
      }
    }
    return boards.length || notes.length ? { kind: 'objects', boards, notes } : { kind: 'none' };
  };

  /* ---- stores ---- */

  const unsubscribeView = useView.subscribe((state, prev) => {
    if (state.camera !== prev.camera && !echo) engine.setCamera(toEngineCamera(state.camera));
    if (state.tool !== prev.tool || state.spacePan !== prev.spacePan) engine.setTool(engineTool(state.tool, state.spacePan));
    if (state.selection !== prev.selection) engine.setSelection(selectionIds(state.selection));
    if (state.page !== prev.page || state.frames !== prev.frames || state.textEdit !== prev.textEdit || state.playing !== prev.playing) queueSync();
  });
  const unsubscribeDocument = useDocument.subscribe((state, prev) => {
    if (state.canvas !== prev.canvas || state.readOnly !== prev.readOnly) queueSync();
  });
  const unsubscribeLive = useLive.subscribe((state, prev) => {
    if (state.live !== prev.live || state.resting !== prev.resting) queueSync();
    if (state.snapshots !== prev.snapshots) {
      queueSync();
      if (!moving) refreshTextures();
    }
  });

  /* ---- theme ---- */

  const retheme = (): void => engine.setOptions({ theme: themeOf(surface) });
  const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  scheme?.addEventListener('change', retheme);
  const themeObserver = new MutationObserver(retheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---- hand over ---- */

  cameraDriver.current = {
    glide(target, ms) {
      // The rect the target camera shows, framed exactly: no padding, its own zoom.
      const world = toEngineCamera(target);
      const rect = { x: world.x, y: world.y, w: viewportSize.width / target.zoom, h: viewportSize.height / target.zoom };
      engine.glideTo(rect, { duration: ms, padding: 0, maxZoom: target.zoom });
    },
    halt() {
      engine.setCamera(engine.camera);
    },
  };
  active = { engine, noteResized: queueSync };
  sync();
  engine.setSelection(selectionIds(useView.getState().selection));

  // For benchmarks and debugging (e2e/bench/canvas.mjs): what every artboard of the page shows.
  (globalThis as { __openArtifactCanvas?: unknown }).__openArtifactCanvas = () => {
    const { canvas } = useDocument.getState();
    const view = useView.getState();
    const inView = new Set(engine.queryRect(engine.viewport()));
    const { live } = useLive.getState();
    let total = 0, shownCount = 0, visible = 0, visibleShown = 0, visibleLive = 0, liveCount = 0, booted = 0;
    for (const path of boardsOnPage(canvas, view.page)) {
      total++;
      const up = isLive(path, live) && Boolean(view.frames[path]?.booted);
      if (isLive(path, live)) liveCount++;
      if (up) booted++;
      const ok = up || shown.has(path);
      if (ok) shownCount++;
      if (inView.has(boardItemId(path))) {
        visible++;
        if (ok) visibleShown++;
        if (up && holes.has(boardItemId(path))) visibleLive++;
      }
    }
    return {
      engine: true, total, shown: shownCount, visible, visibleShown, visibleLive, live: liveCount, booted, snapshots: shown.size, zoom: engine.camera.zoom, stats: engine.stats(),
    };
  };

  return () => {
    stopped = true;
    for (const unsubscribe of off) unsubscribe();
    unsubscribeView();
    unsubscribeDocument();
    unsubscribeLive();
    scheme?.removeEventListener('change', retheme);
    themeObserver.disconnect();
    if (active?.engine === engine) active = null;
    if (cameraDriver.current && !active) cameraDriver.current = null;
    holes = new Map();
    surface.removeAttribute('data-moving');
    surface.removeAttribute('data-gesture');
    delete (globalThis as { __openArtifactCanvas?: unknown }).__openArtifactCanvas;
    engine.destroy();
  };
}
