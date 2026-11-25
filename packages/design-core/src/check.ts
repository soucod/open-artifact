/**
 * Whole-project checks of a Design artifact: `canvas.json` against the
 * files, then every artboard file. Paths are relative to `project/`.
 */

import { checkDcFile, isBoardPath, type Diagnostic } from '@open-artifact/dc';
import {
  CANVAS_VERSION,
  DS_FOLDER_PATTERN,
  ID_PATTERN,
  MAX_BOARD_SIZE,
  MAX_GUIDES,
  MAX_INDEX_BYTES,
  MAX_NOTE_GROUPS,
  MAX_PAGES,
  MIN_BOARD_SIZE,
  intersects,
  noteFontSize,
  pageOf,
} from './canvas.ts';

/** A finding tied to a file. */
export interface ProjectDiagnostic extends Diagnostic {
  /** Path under `project/`. */
  file: string;
}

/** Most files a design holds (under `project/`). */
export const MAX_PROJECT_FILES = 512;
/** Most bytes a design holds: its files and uploads together. */
export const MAX_PROJECT_BYTES = 256 * 1024 * 1024;

/** What the host knows of the folder beyond the text files (all optional). */
export interface DesignCheckOptions {
  /** Whether an upload exists (`/_blob/<id>`); without it uploads are not checked. */
  blobExists?: (id: string) => boolean;
  /** Every file under `project/` (path under `project/` → bytes), for the file and size limits. */
  sizes?: ReadonlyMap<string, number>;
  /** Bytes of the uploads (`_blobs/`), counted in the size limit. */
  blobBytes?: number;
  /** Symbolic links found under `project/` (paths under `project/`). */
  symlinks?: readonly string[];
}

/** Checks a project given all of its text files (path under `project/` → content). */
export function checkDesignProject(files: ReadonlyMap<string, string>, options: DesignCheckOptions = {}): ProjectDiagnostic[] {
  const out: ProjectDiagnostic[] = [];
  const add = (file: string, level: Diagnostic['level'], message: string): void => {
    out.push({ file, level, message });
  };
  const paths = new Set(files.keys());
  const canvasText = files.get('canvas.json');
  if (canvasText === undefined) {
    add('canvas.json', 'error', 'project/canvas.json is missing.');
    return out;
  }
  const indexBytes = new TextEncoder().encode(canvasText).length;
  if (indexBytes >= MAX_INDEX_BYTES) add('canvas.json', 'error', `canvas.json is ${indexBytes} bytes; keep the index under 1 MiB.`);

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(canvasText) as Record<string, unknown>;
  } catch (error) {
    add('canvas.json', 'error', `canvas.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return out;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    add('canvas.json', 'error', 'canvas.json must be an object.');
    return out;
  }
  if (raw.v !== CANVAS_VERSION) add('canvas.json', 'error', `"v" must be ${CANVAS_VERSION}.`);
  if (!raw.createdOnFiles) add('canvas.json', 'warning', 'A new index should carry "createdOnFiles": {"v":1,"at":"<now>"}.');

  const boards = (raw.boards && typeof raw.boards === 'object' ? raw.boards : {}) as Record<string, Record<string, unknown>>;
  const order = Array.isArray(raw.order) ? (raw.order as unknown[]) : [];
  const pages = Array.isArray(raw.pages) ? (raw.pages as Record<string, unknown>[]) : [];
  const notes = (raw.notes && typeof raw.notes === 'object' ? raw.notes : {}) as Record<string, Record<string, unknown>>;

  // Pages.
  if (pages.length > MAX_PAGES) add('canvas.json', 'error', `At most ${MAX_PAGES} pages.`);
  const pageIds = new Set<string>();
  for (const page of pages) {
    if (typeof page?.id !== 'string' || !ID_PATTERN.test(page.id)) add('canvas.json', 'error', `Page id ${JSON.stringify(page?.id)} must match [A-Za-z0-9_-]{1,40}.`);
    else if (pageIds.has(page.id)) add('canvas.json', 'error', `Duplicate page id "${page.id}".`);
    else pageIds.add(page.id);
  }

  // Boards.
  for (const [path, entry] of Object.entries(boards)) {
    if (!isBoardPath(path)) add('canvas.json', 'error', `Board key "${path}" is not a valid artboard path.`);
    if (!paths.has(path)) add('canvas.json', 'error', `Board "${path}" has no file: write project/${path}.`);
    for (const key of ['x', 'y', 'w', 'h']) {
      if (typeof entry?.[key] !== 'number') add('canvas.json', 'error', `Board "${path}" needs a numeric "${key}".`);
    }
    for (const key of ['w', 'h']) {
      const size = entry?.[key];
      if (typeof size === 'number' && (size < MIN_BOARD_SIZE || size > MAX_BOARD_SIZE)) {
        add('canvas.json', 'error', `Board "${path}" ${key}=${size} is outside ${MIN_BOARD_SIZE}–${MAX_BOARD_SIZE}.`);
      }
    }
    if (entry?.page !== undefined && !pageIds.has(String(entry.page))) add('canvas.json', 'error', `Board "${path}" names unknown page "${String(entry.page)}".`);
    if (entry?.expand !== undefined && entry.expand !== 'fill') add('canvas.json', 'error', `Board "${path}" expand must be "fill".`);
    if (entry?.print !== undefined && entry.print !== 'flow' && entry.print !== 'fixed') add('canvas.json', 'error', `Board "${path}" print must be "flow" or "fixed".`);
    if (entry?.paper !== undefined && entry.paper !== 'letter' && entry.paper !== 'a4') add('canvas.json', 'error', `Board "${path}" paper must be "letter" or "a4".`);
    if (Array.isArray(entry?.guides) && entry.guides.length > MAX_GUIDES) add('canvas.json', 'error', `Board "${path}" has more than ${MAX_GUIDES} guides.`);
    if (!order.includes(path)) add('canvas.json', 'error', `Board "${path}" is missing from "order".`);
  }
  for (const path of order) {
    if (typeof path !== 'string' || !boards[path]) add('canvas.json', 'error', `"order" lists ${JSON.stringify(path)}, which has no board entry.`);
  }
  if (new Set(order).size !== order.length) add('canvas.json', 'error', '"order" lists a board twice.');

  // Every artboard file outside ds/ must be on the canvas.
  for (const path of paths) {
    if (!path.endsWith('.dc.html') || path.startsWith('ds/')) continue;
    if (!boards[path]) add(path, 'error', `${path} is not in canvas.json "boards"; every artboard file must be listed (w,h = its $preview).`);
  }

  // Overlapping frames on one page.
  const entries = Object.entries(boards).filter(([, entry]) => ['x', 'y', 'w', 'h'].every((key) => typeof entry?.[key] === 'number'));
  const canvasLike = { pages: pages.filter((p) => typeof p?.id === 'string') as { id: string; name: string }[] } as Parameters<typeof pageOf>[0];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [pa, a] = entries[i]!;
      const [pb, b] = entries[j]!;
      if (pageOf(canvasLike, a as { page?: string }) !== pageOf(canvasLike, b as { page?: string })) continue;
      const ra = { x: a.x as number, y: a.y as number, w: a.w as number, h: a.h as number };
      const rb = { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number };
      if (intersects(ra, rb)) add('canvas.json', 'warning', `Boards "${pa}" and "${pb}" overlap.`);
    }
  }

  // Launch.
  const launch = raw.launch as Record<string, unknown> | undefined;
  if (launch) {
    if (launch.view === 'focused') {
      if (typeof launch.file !== 'string' || !boards[launch.file]) add('canvas.json', 'error', 'launch.file must name a board.');
    } else if (launch.view === 'canvas') {
      if (launch.page !== undefined && !pageIds.has(String(launch.page))) add('canvas.json', 'error', 'launch.page must name a listed page.');
    } else {
      add('canvas.json', 'error', 'launch.view must be "canvas" or "focused".');
    }
  }

  // Notes.
  const noteIds = Object.keys(notes);
  for (const id of noteIds) {
    const note = notes[id];
    if (!ID_PATTERN.test(id)) add('canvas.json', 'error', `Note id "${id}" must match [A-Za-z0-9_-]{1,40}.`);
    if (typeof note?.x !== 'number' || typeof note?.y !== 'number') {
      add('canvas.json', 'error', `Note "${id}" needs numeric x and y.`);
      continue;
    }
    if ((!note.kind || note.kind === 'sticky' || note.kind === 'title1') && typeof note.text !== 'string') add('canvas.json', 'error', `Note "${id}" needs text.`);
    if (note.kind === 'link' && (typeof note.href !== 'string' || !note.href.trim())) add('canvas.json', 'error', `Link card "${id}" needs an href.`);
    if (note.page !== undefined && !pageIds.has(String(note.page))) add('canvas.json', 'error', `Note "${id}" names unknown page "${String(note.page)}".`);
    if (note.kind === 'title1' && noteFontSize(note.size, 'title1') >= 72 && typeof note.text === 'string') {
      if (note.maxW === undefined) add('canvas.json', 'warning', `Title note "${id}" should set maxW (its row's width).`);
      const width = typeof note.maxW === 'number' && note.maxW > 0 ? note.maxW : Math.max(1, note.text.length) * noteFontSize(note.size, 'title1');
      const page = note.page ?? pages[0]?.id;
      const x = note.x, y = note.y;
      const inColumn = entries.filter(([, b]) => (b.page ?? pages[0]?.id) === page && Number(b.x) < x + width && Number(b.x) + Number(b.w) > x);
      const below = inColumn.filter(([, b]) => Number(b.y) >= y && Number(b.y) - y < 223).sort((a, b) => Number(a[1].y) - Number(b[1].y));
      const over = inColumn.filter(([, b]) => Number(b.y) < y && Number(b.y) + Number(b.h) > y);
      if (below.length) add('canvas.json', 'error', `Title "${id}" is ${Number(below[0]![1].y) - y} px above ${below[0]![0]}. Leave 223 px above its row (y ≤ ${Number(below[0]![1].y) - 223}).`);
      if (over.length) add('canvas.json', 'error', `Title "${id}" sits over ${over[0]![0]}. Move it at least 223 px above its row.`);
    }
    if (note?.groups !== undefined) {
      const groups = note.groups;
      if (!Array.isArray(groups) || groups.some((group) => typeof group !== 'string' || !ID_PATTERN.test(group))) {
        add('canvas.json', 'warning', `Note "${id}" groups must be a list of ids matching [A-Za-z0-9_-]{1,40}; bad entries are dropped.`);
      } else if (groups.length > MAX_NOTE_GROUPS) {
        add('canvas.json', 'warning', `Note "${id}" is in ${groups.length} groups; groups nest at most ${MAX_NOTE_GROUPS} deep and the rest are dropped.`);
      }
    }
  }

  // Installed design systems.
  const systems = Array.isArray(raw.designSystems) ? (raw.designSystems as Record<string, unknown>[]) : [];
  const recorded = new Set<string>();
  for (const system of systems) {
    const folder = system?.namespace;
    if (typeof folder !== 'string' || !DS_FOLDER_PATTERN.test(folder)) {
      add('canvas.json', 'error', `designSystems namespace ${JSON.stringify(folder)} must match [a-z0-9][a-z0-9_-]{0,63}.`);
      continue;
    }
    if (recorded.has(folder)) add('canvas.json', 'error', `designSystems has the namespace "${folder}" more than once.`);
    recorded.add(folder);
    if (!paths.has(`ds/${folder}/tokens.json`)) add('canvas.json', 'warning', `Design system "${folder}" has no project/ds/${folder}/tokens.json.`);
  }
  const allPaths = new Set([...paths, ...(options.sizes?.keys() ?? [])]);
  const dsFolders = new Set<string>();
  for (const path of allPaths) {
    const parts = path.split('/');
    if (parts[0] !== 'ds') continue;
    if (parts.length === 2) add(path, 'warning', `Files under ds/ belong in ds/<folder>/, one folder per design system.`);
    else dsFolders.add(parts[1]!);
  }
  for (const folder of dsFolders) {
    if (!recorded.has(folder)) {
      add(`ds/${folder}/`, 'warning', `ds/${folder}/ has no record in canvas.json designSystems; the editor offers a design system's colours, text styles and components only when both are there.`);
    }
  }

  // Artboard file names: <dc-import name> and links find an artboard by its name.
  const stems = new Map<string, string>();
  for (const path of [...paths].sort()) {
    if (!path.endsWith('.dc.html') || path.startsWith('ds/')) continue;
    const stem = path.slice(path.lastIndexOf('/') + 1, -'.dc.html'.length);
    const other = stems.get(stem);
    if (other !== undefined) add(path, 'warning', `Has the same name as ${other}; give artboard files (without .dc.html) unique names.`);
    else stems.set(stem, path);
  }

  // Limits and links.
  if (options.sizes) {
    if (options.sizes.size > MAX_PROJECT_FILES) {
      add('.', 'error', `The design has ${options.sizes.size} files under project/; it holds at most ${MAX_PROJECT_FILES} (the editor lists only the first ${MAX_PROJECT_FILES}).`);
    }
    let total = options.blobBytes ?? 0;
    for (const size of options.sizes.values()) total += size;
    if (total > MAX_PROJECT_BYTES) add('.', 'error', `Files and uploads add up to ${total} bytes; a design holds at most ${MAX_PROJECT_BYTES} (256 MB).`);
  }
  for (const link of options.symlinks ?? []) {
    add(link, 'error', 'Is a symbolic link; the editor ignores symbolic links. Replace it with a regular file or folder.');
  }

  // Artboard files.
  for (const [path, source] of files) {
    if (!path.endsWith('.dc.html')) continue;
    const entry = boards[path];
    const board = entry && typeof entry.w === 'number' && typeof entry.h === 'number' ? { w: entry.w, h: entry.h } : undefined;
    const blobExists = path.startsWith('ds/') ? undefined : options.blobExists;
    for (const diagnostic of checkDcFile(path, source, { files: allPaths, ...(board ? { board } : {}), ...(blobExists ? { blobExists } : {}) })) {
      out.push({ file: path, ...diagnostic });
    }
  }
  // Uploads named by the other text files (stylesheets, scripts, data) outside ds/.
  if (options.blobExists) {
    for (const [path, text] of files) {
      if (path.endsWith('.dc.html') || path.startsWith('ds/') || !text) continue;
      const reported = new Set<string>();
      for (const match of text.matchAll(/\/_blob\/([0-9a-f]{32})/g)) {
        const id = match[1]!;
        if (reported.has(id) || options.blobExists(id)) continue;
        reported.add(id);
        add(path, 'error', `/_blob/${id} is not an upload of this design: upload the file and use the /_blob/<id> it prints.`);
      }
    }
  }
  return out;
}
