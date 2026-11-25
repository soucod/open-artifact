/**
 * The view store: what this viewer looks at and has selected. Nothing here
 * is saved to the artifact; parts of it are published as the view context.
 */

import { create } from 'zustand';
import type { BoardError, BoardRect, BoardSize, TextFormats } from '@open-artifact/dc';
import type { ClosedNotices } from '../lib/board-errors.ts';

/** Screen = world × zoom + (x, y). */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 8;

/** In-place text editing of one element. */
export interface TextEditState {
  board: string;
  tid: number;
  /** Text a prop or the script supplies: words only, no formatting. */
  plain?: boolean;
  /** Formatting at the caret (for the format bar). */
  formats?: TextFormats;
  /** The board asks for a link address for the selection. */
  link?: { href: string; collapsed: boolean; host: boolean; rect: BoardRect } | null;
}

/** Canvas tools. */
export type Tool = 'select' | 'hand' | 'board' | 'sticky' | 'title' | 'rect' | 'oval' | 'line' | 'arrow' | 'pen' | 'path' | 'image';

/** A selected element inside an artboard. */
export interface ElementSelection {
  tid: number;
  path: number[];
  /** Which rendered instance was clicked (repeated templates render several). */
  instance: number;
}

export type Selection =
  | { kind: 'none' }
  /** Whole artboards and canvas notes. */
  | { kind: 'objects'; boards: string[]; notes: string[] }
  /** Elements inside one artboard. */
  | { kind: 'elements'; board: string; items: ElementSelection[] };

export const NO_SELECTION: Selection = { kind: 'none' };

/** Runtime state of a mounted artboard frame. */
export interface FrameInfo {
  booted: boolean;
  errors: BoardError[];
  size: BoardSize | null;
}

export interface ViewState {
  camera: Camera;
  /** Current page id (`null`: the canvas has no pages). */
  page: string | null;
  tool: Tool;
  selection: Selection;
  /** Element under the pointer. */
  hover: { board: string; tid: number; instance: number } | null;
  /** The artboard the comment pointer rests on: kept live so its elements can be picked at any zoom (services/live.ts). */
  peek: string | null;
  /** In-place text editing. */
  textEdit: TextEditState | null;
  /** The note whose text is being edited. */
  noteEdit: string | null;
  mode: 'canvas' | 'focused';
  /** The artboard shown in the focused view. */
  focused: string | null;
  focusedExportWidth: number | null;
  playing: string | null;
  /** Right panel. */
  panel: 'properties' | 'code' | 'tweaks' | 'theme';
  panelOpen: boolean;
  frames: Record<string, FrameInfo>;
  /** Bumped whenever rendered element rects may have moved. */
  layoutTick: number;
  /** Live tweak values per artboard (on top of `data-props` defaults). */
  overrides: Record<string, Record<string, unknown>>;
  /** The "Send to agent" composer is open. */
  composer: boolean;
  /** Space is held: drag pans. */
  spacePan: boolean;
  /** Stroke of new pencil drawings. */
  pen: PenStyle;
  /** The find bar is open. */
  findOpen: boolean;
  /** The canvas tools sit at the top of the window instead of the bottom. */
  toolbarTop: boolean;
  /** Image crop mode: the `<img>` (or `<video>`) being cropped. */
  crop: { board: string; tid: number; path: number[] } | null;
  /** The list of artboards with errors (top right) is open. */
  errorsOpen: boolean;
  /** Error notices this viewer closed (lib/board-errors.ts). */
  closedNotices: ClosedNotices;
  /** A fix request the agent could not be reached with, for the viewer to copy; `key` is the errors it was made from. */
  unsentFix: { key: string; text: string } | null;
}

/** Stroke of the pencil tool. */
export interface PenStyle {
  stroke: number;
  dash: 'solid' | 'dashed' | 'dotted';
}

/** Pencil stroke weights offered in the toolbar. */
export const PEN_WEIGHTS = [1.5, 3, 5, 8];

export interface ViewActions {
  setCamera(camera: Camera): void;
  setPage(page: string | null): void;
  setTool(tool: Tool): void;
  select(selection: Selection): void;
  setHover(hover: ViewState['hover']): void;
  setPeek(peek: string | null): void;
  setTextEdit(edit: ViewState['textEdit']): void;
  /** Updates the text edit in progress (nothing when none is). */
  patchTextEdit(patch: Partial<TextEditState>): void;
  setNoteEdit(id: string | null): void;
  focus(path: string | null): void;
  play(path: string | null): void;
  setPanel(panel: ViewState['panel'], open?: boolean): void;
  togglePanel(): void;
  frame(path: string, patch: Partial<FrameInfo>): void;
  dropFrame(path: string): void;
  /** A frame let go of while its artboard stays (not live, see services/live.ts): keeps its errors and size. */
  parkFrame(path: string): void;
  tick(): void;
  setOverride(path: string, key: string, value: unknown): void;
  clearOverrides(path: string): void;
  setComposer(open: boolean): void;
  setSpacePan(on: boolean): void;
  setPen(patch: Partial<PenStyle>): void;
  setFindOpen(open: boolean): void;
  setToolbarTop(top: boolean): void;
  setCrop(crop: ViewState['crop']): void;
  setErrorsOpen(open: boolean): void;
  setClosedNotices(closed: ClosedNotices): void;
  setUnsentFix(fix: ViewState['unsentFix']): void;
}

const TOOLBAR_KEY = 'mc-toolbar/top';

function storedToolbarTop(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(TOOLBAR_KEY) !== '0';
  } catch {
    return true;
  }
}

export const useView = create<ViewState & ViewActions>()((set, get) => ({
  camera: { x: 0, y: 0, zoom: 1 },
  page: null,
  tool: 'select',
  selection: NO_SELECTION,
  hover: null,
  peek: null,
  textEdit: null,
  noteEdit: null,
  mode: 'canvas',
  focused: null,
  focusedExportWidth: null,
  playing: null,
  panel: 'properties',
  panelOpen: false,
  frames: {},
  layoutTick: 0,
  overrides: {},
  composer: false,
  spacePan: false,
  pen: { stroke: 3, dash: 'solid' },
  findOpen: false,
  toolbarTop: storedToolbarTop(),
  crop: null,
  errorsOpen: false,
  closedNotices: {},
  unsentFix: null,

  setCamera(camera) {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom));
    set({ camera: { ...camera, zoom } });
  },
  setPage(page) {
    if (get().page !== page) set({ page, playing: null, selection: NO_SELECTION, hover: null, peek: null, crop: null });
  },
  setTool(tool) {
    set({ tool, playing: null });
  },
  select(selection) {
    set({ selection, playing: null, noteEdit: null, ...(get().crop ? { crop: null } : {}) });
  },
  setHover(hover) {
    const current = get().hover;
    if (current?.board === hover?.board && current?.tid === hover?.tid && current?.instance === hover?.instance) return;
    set({ hover });
  },
  setPeek(peek) {
    if (get().peek !== peek) set({ peek });
  },
  setTextEdit(textEdit) {
    set({ textEdit });
  },
  patchTextEdit(patch) {
    const { textEdit } = get();
    if (textEdit) set({ textEdit: { ...textEdit, ...patch } });
  },
  setNoteEdit(noteEdit) {
    set({ noteEdit });
  },
  focus(path) {
    set(path ? { mode: 'focused', focused: path, playing: null, hover: null } : { mode: 'canvas', focused: null });
  },
  play(path) {
    set({ playing: path, hover: null, selection: NO_SELECTION, tool: 'select', noteEdit: null, textEdit: null });
  },
  setPanel(panel, open = true) {
    set({ panel, panelOpen: open });
  },
  togglePanel() {
    set({ panelOpen: !get().panelOpen });
  },
  frame(path, patch) {
    const frames = get().frames;
    const current = frames[path] ?? { booted: false, errors: [], size: null };
    set({ frames: { ...frames, [path]: { ...current, ...patch } }, layoutTick: get().layoutTick + 1 });
  },
  dropFrame(path) {
    const { [path]: _, ...rest } = get().frames;
    set({ frames: rest });
  },
  parkFrame(path) {
    const current = get().frames[path];
    if (!current) return;
    // Errors and size come from the frame's own realm: copies, so they do not keep its document alive.
    const errors = structuredClone(current.errors) as BoardError[];
    const size = current.size ? (structuredClone(current.size) as BoardSize) : null;
    set({ frames: { ...get().frames, [path]: { booted: false, errors, size } } });
  },
  tick() {
    set({ layoutTick: get().layoutTick + 1 });
  },
  setOverride(path, key, value) {
    const overrides = get().overrides;
    set({ overrides: { ...overrides, [path]: { ...(overrides[path] ?? {}), [key]: value } } });
  },
  clearOverrides(path) {
    const { [path]: _, ...rest } = get().overrides;
    set({ overrides: rest });
  },
  setComposer(composer) {
    set({ composer });
  },
  setPen(patch) {
    set({ pen: { ...get().pen, ...patch } });
  },
  setSpacePan(spacePan) {
    if (get().spacePan !== spacePan) set({ spacePan });
  },
  setFindOpen(findOpen) {
    if (get().findOpen !== findOpen) set({ findOpen });
  },
  setToolbarTop(toolbarTop) {
    try {
      localStorage.setItem(TOOLBAR_KEY, toolbarTop ? '1' : '0');
    } catch {
      /* storage may be unavailable */
    }
    set({ toolbarTop });
  },
  setCrop(crop) {
    set({ crop });
  },
  setErrorsOpen(errorsOpen) {
    if (get().errorsOpen !== errorsOpen) set({ errorsOpen });
  },
  setClosedNotices(closedNotices) {
    if (get().closedNotices !== closedNotices) set({ closedNotices });
  },
  setUnsentFix(unsentFix) {
    set({ unsentFix });
  },
}));

/** Screen point → world point. */
export function toWorld(camera: Camera, x: number, y: number): { x: number; y: number } {
  return { x: (x - camera.x) / camera.zoom, y: (y - camera.y) / camera.zoom };
}

/** World point → screen point. */
export function toScreen(camera: Camera, x: number, y: number): { x: number; y: number } {
  return { x: x * camera.zoom + camera.x, y: y * camera.zoom + camera.y };
}
