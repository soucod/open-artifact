/**
 * The artifact types this server knows. Each one names its index file (the
 * marker `detect` looks for), how to start an empty artifact, how to check a
 * project and how to validate the view context its editor publishes.
 */

import { checkDesignProject, emptyCanvas, serializeCanvas, validateViewContext } from '@open-artifact/design-core';
import { checkDesignSystem, emptySystemIndex } from '@open-artifact/design-system-core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DECK_CSS_FILE,
  NEW_DECK_STYLESHEET,
  checkSlidesProject,
  newDeckIndex,
  serializeDeckIndex,
  validateViewContext as validateSlidesContext,
} from '@open-artifact/slides-core';
import { DOC_MARKER, checkDoc, scaffoldDocType, validateDocContext } from './docs/type.ts';
import { DATA_MARKER, checkData, dataCommenterWrites, dataHistoryIgnoresPath, dataWritesProblem, scaffoldData, validateDataContext } from './data.ts';
import { MOTION_MARKER, checkMotion, motionHistoryIgnores, motionTypeWritesProblem, scaffoldMotion, validateMotionContext } from './motion.ts';
import { SHEET_MARKER, checkSheet, scaffoldSheet, validateSheetContext } from './sheets/type.ts';
import { WHITEBOARD_MARKER, checkWhiteboard, scaffoldWhiteboard, validateWhiteboardContext, whiteboardHistoryIgnores } from './whiteboard.ts';

/** True when `dir` holds at least one slide file (`<id>.html`). */
function hasSlideFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => name.endsWith('.html'));
  } catch {
    return false;
  }
}

/** One finding of a project check. */
export interface CheckFinding {
  /** Path under `project/`. */
  file: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
}

/**
 * What a check may know of the folder beyond the text files it is given
 * (the CLI and the server fill it from disk; every field is optional).
 */
export interface CheckContext {
  /** Whether an upload exists (`/_blob/<id>`, 32 hex). */
  blobExists?: (id: string) => boolean;
  /** Whether a file exists, by artifact-relative path (`project/ds/acme/fonts/a.woff2`). */
  fileExists?: (path: string) => boolean;
  /** Every file under `project/` (path under `project/` → bytes). */
  sizes?: ReadonlyMap<string, number>;
  /** Symbolic links under `project/` (paths under `project/`). */
  symlinks?: readonly string[];
  /** Bytes of the uploads (`_blobs/`). */
  blobBytes?: number;
  /** The text of an upload, or `null` when it is missing (db-backed types). */
  readBlob?: (id: string) => string | null;
  /** The size of an upload in bytes, or `undefined` when it is missing. */
  blobSize?: (id: string) => number | undefined;
  /** When a document (`datasets/sales`) was last written, epoch ms (db-backed types). */
  modifiedAt?: (path: string) => number | undefined;
  /** The connectors the owner set up (`connectors.json`'s server names); `null` when there is no readable file. */
  connectors?: ReadonlySet<string> | null;
}

/** A batch the type refuses before the store writes any of it. */
export interface WriteRefusal {
  code: string;
  message: string;
}

/** What the server needs to know about a type. */
export interface TypeDefinition {
  /** Type name, also the URL segment (`/design/<token>/`). */
  name: TypeName;
  /** Display name. */
  title: string;
  /** Index file under `project/` that marks a folder as this type. */
  marker: string;
  /**
   * Files of a new artifact whose marker is missing (paths under `project/`).
   * `dir` is that folder on disk; files already in it are not overwritten.
   */
  scaffold(title: string, dir: string): Record<string, string>;
  /** Checks every text file of `project/` (path under `project/` → content). */
  check(files: ReadonlyMap<string, string>, context?: CheckContext): CheckFinding[];
  /** Returns the validated view context, or `null` to discard it. */
  validateContext(value: unknown): unknown;
  /**
   * Folder (under the artifact root) that `marker`, `scaffold` paths and
   * `check` files are relative to. Default `project`.
   */
  contentDir?: string;
  /**
   * `db`: the type keeps a document store (`db/`, the `db` capability). `workbook`: an edit log the engine makes a
   * workbook of (`sheet/`, the `sheet` capability), with its own versions in place of the version history. `doc`: a
   * doc of tabs whose blocks and characters carry ids (`doc/`, the `doc` capability), with its own versions in place
   * of the version history.
   */
  store?: 'db' | 'workbook' | 'doc';
  /** The type keeps comment threads (`comments.json`, the `comments` capability). */
  comments?: boolean;
  /**
   * Documents the version history leaves out (path without `db/`): live
   * state that is no content, such as claims, a timer or per-person data.
   */
  historyIgnores?(path: string): boolean;
  /**
   * Refuses an agent's db batch the type's page would drop part of (checked
   * before the store writes anything). `read` gives a document's data now.
   */
  writesProblem?(writes: readonly unknown[], read: (path: string) => unknown): WriteRefusal | null;
  /**
   * The store documents (path without `db/`) a commenter of a share link may write, given their id: their own
   * per-person data. A type without it lets a commenter write nothing to the store.
   */
  commenterWrites?(path: string, guestId: string): boolean;
}

export type TypeName = 'design' | 'design-system' | 'slides' | 'whiteboard' | 'data' | 'sheets' | 'docs' | 'motion';

export const TYPES: Record<TypeName, TypeDefinition> = {
  design: {
    name: 'design',
    title: 'Design',
    marker: 'canvas.json',
    scaffold: (title) => ({ 'canvas.json': serializeCanvas(emptyCanvas(title)) }),
    check: (files, context = {}) =>
      checkDesignProject(files, {
        ...(context.blobExists ? { blobExists: context.blobExists } : {}),
        ...(context.sizes ? { sizes: context.sizes } : {}),
        ...(context.symlinks ? { symlinks: context.symlinks } : {}),
        ...(context.blobBytes !== undefined ? { blobBytes: context.blobBytes } : {}),
      }),
    validateContext: (value) => validateViewContext(value),
    // Threads live in `comments.json` beside `project/` (no document store).
    comments: true,
  },
  'design-system': {
    name: 'design-system',
    title: 'Design System',
    marker: 'design-system.json',
    scaffold: (title) => ({ 'design-system.json': `${JSON.stringify(emptySystemIndex(title), null, 2)}\n` }),
    check: (files, context) => checkDesignSystem(files, context?.blobExists),
    // The Design System editor publishes a small record (tab, selection); accept plain objects only.
    validateContext: (value) => (value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= 8192 ? value : null),
    // Threads on tokens, text styles, components, assets and sections (anchors: the view's focus shape).
    comments: true,
  },
  slides: {
    name: 'slides',
    title: 'Slides',
    marker: 'deck.json',
    // An empty deck: the agent writes the slides (project/slides/<id>.html) and lists them in `order`.
    // A new deck is a source deck (`"v":5`, `format`, project/deck.css); a folder that already holds
    // slide files but no index keeps them inline, since a `format` key would restyle them.
    scaffold: (title, dir) => {
      const source = !hasSlideFiles(join(dir, 'slides'));
      return {
        'deck.json': serializeDeckIndex(newDeckIndex(title, new Date(), { source })),
        ...(source && !existsSync(join(dir, DECK_CSS_FILE)) ? { [DECK_CSS_FILE]: NEW_DECK_STYLESHEET } : {}),
      };
    },
    check: (files, context = {}) => checkSlidesProject(files, { ...(context.blobExists && context.fileExists ? { exists: slidesRefExists(context) } : {}) }),
    validateContext: (value) => validateSlidesContext(value),
    // Threads live in `comments.json` beside `project/` (no document store).
    comments: true,
  },
  whiteboard: {
    name: 'whiteboard',
    title: 'Whiteboard',
    // Content is the document store: `check` gets document paths (`elements/n1`) → JSON text.
    contentDir: 'db',
    marker: WHITEBOARD_MARKER,
    scaffold: (title) => scaffoldWhiteboard(title),
    check: (files, context = {}) => checkWhiteboard(files, context.blobExists),
    validateContext: (value) => validateWhiteboardContext(value),
    store: 'db',
    comments: true,
    historyIgnores: whiteboardHistoryIgnores,
  },
  data: {
    name: 'data',
    title: 'Data',
    contentDir: 'db',
    marker: DATA_MARKER,
    scaffold: (title) => scaffoldData(title),
    check: (files, context = {}) =>
      checkData(files, {
        ...(context.blobExists ? { blobExists: context.blobExists } : {}),
        ...(context.readBlob ? { readBlob: context.readBlob } : {}),
        ...(context.blobSize ? { blobSize: context.blobSize } : {}),
        ...(context.modifiedAt ? { modifiedAt: context.modifiedAt } : {}),
        ...(context.connectors !== undefined ? { connectors: context.connectors } : {}),
      }),
    validateContext: (value) => validateDataContext(value),
    store: 'db',
    comments: true,
    historyIgnores: dataHistoryIgnoresPath,
    writesProblem: dataWritesProblem,
    commenterWrites: dataCommenterWrites,
  },
  sheets: {
    name: 'sheets',
    title: 'Sheets',
    contentDir: 'sheet',
    marker: SHEET_MARKER,
    scaffold: (title) => scaffoldSheet(title),
    check: (files) => checkSheet(files),
    validateContext: (value) => validateSheetContext(value),
    store: 'workbook',
    comments: true,
  },
  docs: {
    name: 'docs',
    title: 'Docs',
    contentDir: 'doc',
    marker: DOC_MARKER,
    scaffold: (title) => scaffoldDocType(title),
    check: (files) => checkDoc(files),
    validateContext: (value) => validateDocContext(value),
    store: 'doc',
    comments: true,
  },
  motion: {
    name: 'motion',
    title: 'Motion',
    contentDir: 'db',
    marker: MOTION_MARKER,
    scaffold: (title) => scaffoldMotion(title),
    check: (files, context = {}) => checkMotion(files, context),
    validateContext: (value) => validateMotionContext(value),
    store: 'db',
    comments: true,
    historyIgnores: motionHistoryIgnores,
    writesProblem: motionTypeWritesProblem,
  },
};

/**
 * A slide's or face's reference as the slides check names it: `/_blob/<id>`
 * (an upload) or `project/…` (a file, usually a design system's copy).
 */
function slidesRefExists(context: CheckContext): (ref: string) => boolean {
  return (ref) => {
    const blob = /^\/?_blob\/([0-9a-f]{32})$/.exec(ref);
    if (blob) return context.blobExists!(blob[1]!);
    const path = ref.replace(/^\/+/, '');
    if (path.split('/').some((part) => part === '..')) return false;
    return context.fileExists!(path.startsWith('project/') ? path : `project/${path}`);
  };
}

/** Which documents the version history tracks, for a type that leaves some out (else undefined: all). */
export function historyTracksOf(type: TypeName): ((path: string) => boolean) | undefined {
  const ignores = TYPES[type].historyIgnores;
  return ignores ? (path) => !ignores(path) : undefined;
}

/** The folder (under the artifact root) a type's marker and files live in. */
export function contentDirOf(type: TypeName): string {
  return TYPES[type].contentDir ?? 'project';
}

/** True when the name is a known type. */
export function isTypeName(value: unknown): value is TypeName {
  return typeof value === 'string' && Object.hasOwn(TYPES, value);
}
