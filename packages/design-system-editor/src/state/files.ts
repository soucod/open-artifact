/**
 * The files store: the project's files as the server holds them, the
 * viewer's working copy, the undo history and the save state.
 *
 * Paths are project paths (`tokens.json`, `components/Button/README.md`);
 * the artifact API uses `project/<path>`.
 *
 * Three views of a file:
 * - `listing[path]`: the server's hash and size, for every file (binary too).
 * - `server[path]`: the server's text, for text files that were read.
 * - `texts[path]`: the working copy; `null` = deleted here. A path is dirty
 *   when its working copy, written back to disk form, differs from `server`.
 *
 * Some files are shown in a different form than they are stored: the README
 * is shown without its generated usage block. {@link fromDisk} and
 * {@link toDisk} convert between the two.
 */

import { create } from 'zustand';
import { stripUsageBlock } from '@open-artifact/design-system-core';

/** The server's record of one file. */
export interface ListedFile {
  hash: string;
  size: number;
}

/** Save state shown in the top bar. */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'readonly';

/** One change in an undo step. */
export interface FileChange {
  path: string;
  before: string | null | undefined;
  after: string | null;
}

/** One undo step. */
export interface HistoryEntry {
  changes: FileChange[];
  /** Consecutive edits with the same key within {@link COALESCE_MS} merge into one step. */
  key?: string;
  at: number;
}

/** A file both sides changed. */
export interface Conflict {
  recovered?: boolean;
  path: string;
  /** Our working copy (shown form). */
  mine: string | null;
  /** Their text (disk form), `null` when they deleted it. */
  theirs: string | null;
  theirsHash: string | null;
}

/** One file in {@link FilesState.acknowledge}. */
export interface AckFile {
  /** The server's text (disk form); omitted for binary files. */
  text?: string;
  /** `null`: the file is gone. */
  hash: string | null;
  size?: number;
  /** The working copy takes this text even when it has unsaved changes. */
  adopt?: boolean;
  /**
   * The working copy stays as it is, even when it reads like the server's text before: a save's answer for a file
   * the viewer changed while it was on its way. Undo can bring the text back to what the server held before that
   * save (Remove a link, the save goes out, ⌘Z), and that text is still the viewer's change to save next.
   */
  keep?: boolean;
}

/** Longest undo history kept. */
const HISTORY_LIMIT = 200;
/** Window in which same-key edits merge into one undo step, ms. */
const COALESCE_MS = 1200;

/** README files carry a generated block the page hides. */
const isReadme = (path: string): boolean => path.toLowerCase() === 'readme.md';

/** The shown form of a stored file. */
export function fromDisk(path: string, text: string): string {
  return isReadme(path) ? stripUsageBlock(text) : text;
}

/**
 * The stored form of a shown file, given what the server holds. The README
 * keeps the server's generated block; the save adds the current one.
 */
export function toDisk(path: string, text: string, server: string | undefined): string {
  if (!isReadme(path) || server === undefined) return text;
  return fromDisk(path, server) === text ? server : text;
}

export interface FilesState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  title: string;
  readOnly: boolean;
  /** Why the page is read-only, when it is for a reason other than the viewer's role. */
  readOnlyReason: 'off' | 'code' | 'index' | null;
  listing: Record<string, ListedFile>;
  server: Record<string, string>;
  texts: Record<string, string | null>;
  /** Paths being read right now (lazy loading). */
  reading: Record<string, true>;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  save: SaveState;
  conflicts: Conflict[];
  /** Hand edits made in this tab (reported to the agent). */
  edits: number;
  /** A version of the history shown read-only instead of the current files (see `services/history.ts`). */
  preview: number | null;

  /** Initial load. */
  load(input: { title: string; readOnly: boolean; listing: Record<string, ListedFile>; server: Record<string, string> }): void;
  fail(message: string): void;
  /** Edits one or more files as one undo step. */
  edit(changes: Record<string, string | null>, key?: string): void;
  undoStep(): void;
  redoStep(): void;
  setSave(save: SaveState): void;
  /**
   * Records what the server now holds (after a read, a save or a remote
   * change). The working copy follows when it had no unsaved change, or
   * when `adopt` says so (the text is ours, or the viewer chose theirs).
   */
  acknowledge(files: Record<string, AckFile>): void;
  addConflict(conflict: Conflict): void;
  resolveConflict(path: string): void;
  setReading(path: string, reading: boolean): void;
}

export const useFiles = create<FilesState>()((set, get) => ({
  status: 'loading',
  error: null,
  title: '',
  readOnly: true,
  readOnlyReason: null,
  listing: {},
  server: {},
  texts: {},
  reading: {},
  undo: [],
  redo: [],
  save: 'saved',
  conflicts: [],
  edits: 0,
  preview: null,

  load({ title, readOnly, listing, server }) {
    const texts: Record<string, string> = {};
    for (const [path, text] of Object.entries(server)) texts[path] = fromDisk(path, text);
    set({ status: 'ready', title, readOnly, listing, server, texts, save: readOnly ? 'readonly' : 'saved' });
  },

  fail(message) {
    set({ status: 'error', error: message });
  },

  edit(changes, key) {
    const state = get();
    if (state.readOnly || state.preview !== null) return;
    const texts = { ...state.texts };
    const list: FileChange[] = [];
    for (const [path, after] of Object.entries(changes)) {
      const before = state.texts[path];
      if (before === after) continue;
      list.push({ path, before, after });
      texts[path] = after;
    }
    if (!list.length) return;
    const now = Date.now();
    const last = state.undo[state.undo.length - 1];
    let undo: HistoryEntry[];
    if (key && last?.key === key && now - last.at < COALESCE_MS) {
      // Merge: keep the first `before` of each path.
      const merged = [...last.changes];
      for (const change of list) {
        const existing = merged.findIndex((c) => c.path === change.path);
        if (existing >= 0) merged[existing] = { ...merged[existing]!, after: change.after };
        else merged.push(change);
      }
      undo = [...state.undo.slice(0, -1), { changes: merged, key, at: now }];
    } else {
      undo = [...state.undo, { changes: list, ...(key ? { key } : {}), at: now }].slice(-HISTORY_LIMIT);
    }
    set({ texts, undo, redo: [], edits: state.edits + 1 });
  },

  undoStep() {
    const state = get();
    const entry = state.undo[state.undo.length - 1];
    if (!entry || state.readOnly) return;
    const texts = { ...state.texts };
    for (const change of entry.changes) {
      if (change.before === undefined) delete texts[change.path];
      else texts[change.path] = change.before;
    }
    set({ texts, undo: state.undo.slice(0, -1), redo: [...state.redo, entry], edits: state.edits + 1 });
  },

  redoStep() {
    const state = get();
    const entry = state.redo[state.redo.length - 1];
    if (!entry || state.readOnly) return;
    const texts = { ...state.texts };
    for (const change of entry.changes) texts[change.path] = change.after;
    set({ texts, redo: state.redo.slice(0, -1), undo: [...state.undo, { ...entry, at: 0 }], edits: state.edits + 1 });
  },

  setSave(save) {
    if (get().save !== save) set({ save });
  },

  acknowledge(files) {
    const state = get();
    const listing = { ...state.listing };
    const server = { ...state.server };
    const texts = { ...state.texts };
    for (const [path, { text, hash, size, adopt = false, keep = false }] of Object.entries(files)) {
      // Is the working copy still what the server held before? Then it follows the server.
      const clean = !keep && (path in state.server ? texts[path] === fromDisk(path, state.server[path]!) : !(path in texts));
      if (hash === null) {
        delete listing[path];
        delete server[path];
        if (adopt || clean) delete texts[path];
        continue;
      }
      listing[path] = { hash, size: size ?? (typeof text === 'string' ? new TextEncoder().encode(text).length : state.listing[path]?.size ?? 0) };
      if (typeof text === 'string') {
        server[path] = text;
        if (adopt || clean || texts[path] === undefined) texts[path] = fromDisk(path, text);
      }
    }
    set({ listing, server, texts });
  },

  addConflict(conflict) {
    set({ conflicts: [...get().conflicts.filter((c) => c.path !== conflict.path), conflict] });
  },

  resolveConflict(path) {
    set({ conflicts: get().conflicts.filter((c) => c.path !== path) });
  },

  setReading(path, reading) {
    const next = { ...get().reading };
    if (reading) next[path] = true;
    else delete next[path];
    set({ reading: next });
  },
}));

/** Paths whose working copy differs from the server (excluding generated files). */
export function dirtyPaths(state: Pick<FilesState, 'texts' | 'server' | 'listing'>): string[] {
  const out: string[] = [];
  for (const [path, text] of Object.entries(state.texts)) {
    if (text === null) {
      if (path in state.listing) out.push(path);
    } else if (toDisk(path, text, state.server[path]) !== state.server[path]) {
      out.push(path);
    }
  }
  return out;
}

/** True while anything is unsaved. */
export const isDirty = (state: Pick<FilesState, 'texts' | 'server' | 'listing'>): boolean => dirtyPaths(state).length > 0;

/** The working copy as a map, with binary paths present as empty strings (for the core helpers). */
export function fileMap(state: Pick<FilesState, 'texts' | 'listing'>): Map<string, string> {
  const map = new Map<string, string>();
  for (const path of Object.keys(state.listing)) map.set(path, '');
  for (const [path, text] of Object.entries(state.texts)) {
    if (text === null) map.delete(path);
    else map.set(path, text);
  }
  return map;
}
