/**
 * Loading, autosave, generated files and changes made elsewhere.
 *
 * - Load: the listing, then the text files every view needs (index, tokens,
 *   READMEs, previews, type declarations, generated files). Everything else
 *   (component sources, libraries, archived files) is read when opened.
 * - Save: shortly after a change, one batch with only the paths that differ
 *   from the server, each guarded by `ifMatch`, plus the generated files
 *   (`tokens.css`, `manifest.json`, `api/**`, the README's usage block) when
 *   they are out of date. The index records the change (`lastChange`).
 * - Conflicts: a generated file is simply regenerated; the index is merged
 *   key by key; any other file both sides changed raises the conflict bar
 *   and is not written until the viewer chooses.
 * - Remote changes: applied in place; a file with unsaved local changes is
 *   handled like a conflict.
 */

import { hasMarker, fileRole, generateSystemFiles } from '@open-artifact/design-system-core';
import { isArtifactError, type ConflictPath, type PublishBatch } from '@open-artifact/runtime';
import { toast } from '@open-artifact/ui';
import { dirtyPaths, fromDisk, isDirty, toDisk, useFiles, type AckFile, type FilesState, type ListedFile } from '../state/files.ts';
import { deriveModel } from '../state/model.ts';
import { startRecovery } from './recovery.ts';
import { autoMerge } from '../lib/merge.ts';
import { artifactPath, projectPath, session } from './session.ts';

/** Delay between the last change and the save, ms. */
const SAVE_DELAY = 700;
/** Conflict retries per save. */
const MAX_RETRIES = 4;
const INDEX = 'design-system.json';

let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let offlineDelay = 2_000;

/** Files the page writes itself; agents never do. */
export function isGenerated(path: string): boolean {
  return path === 'tokens.css' || path === 'manifest.json' || path.startsWith('api/');
}

/** Text files read at load. */
function isEager(path: string): boolean {
  if (/^assets\/[^/]+\/README\.md$/i.test(path)) return true;
  return ['index', 'tokens', 'tokens-css', 'manifest', 'readme', 'section', 'bundle', 'types', 'component-preview', 'component-readme', 'component-types', 'api-card'].includes(
    fileRole(path),
  );
}

/** Files the page can show and edit as text. */
export function isTextPath(path: string): boolean {
  return /\.(md|mdx|json|html?|css|js|mjs|ts|tsx|jsx|txt|svg|xml|csv|ya?ml)$/i.test(path);
}

/** Loads the project. */
export async function loadSystem(): Promise<void> {
  const { artifact, canEdit } = session();
  const store = useFiles.getState();
  try {
    const [title, raw] = await Promise.all([artifact.title(), artifact.list()]);
    const listing: Record<string, ListedFile> = {};
    for (const [path, entry] of Object.entries(raw)) {
      const project = projectPath(path);
      if (project && !project.startsWith('_blobs/')) listing[project] = { hash: entry.sha256, size: entry.size };
    }
    const server: Record<string, string> = {};
    await Promise.all(
      Object.keys(listing)
        .filter(isEager)
        .map(async (path) => {
          server[path] = await artifact.readText(artifactPath(path));
        }),
    );
    const mode = editingMode(server[INDEX]);
    store.load({ title, readOnly: !canEdit || mode !== null, listing, server });
    useFiles.setState({ readOnlyReason: canEdit ? mode : null });
    await startRecovery();
  } catch (error) {
    store.fail(error instanceof Error ? error.message : String(error));
    return;
  }
  artifact.onChange((event) => void applyRemote(event.changes));
  useFiles.subscribe((state, previous) => {
    if (state.texts !== previous.texts) schedule();
  });
  window.addEventListener('beforeunload', (event) => {
    if (isDirty(useFiles.getState())) {
      void flush();
      event.preventDefault();
    }
  });
  // Bring generated files up to date with what the agent wrote.
  schedule(0);
}

/** `editing` of an index text: `"off"` and `"code"` make the page read-only. */
function editingMode(indexText: string | undefined): FilesState['readOnlyReason'] {
  try {
    const index = JSON.parse(indexText ?? '{}');
    if (!hasMarker(index) || typeof index.v !== 'number' || index.v < 3 || index.layout !== 'files') return 'index';
    const editing = index.editing;
    return editing === 'off' || editing === 'code' ? editing : null;
  } catch {
    return 'index';
  }
}

/** Reads a file that was not loaded yet. */
export async function ensureLoaded(path: string): Promise<void> {
  const state = useFiles.getState();
  if (path in state.server || state.reading[path] || !(path in state.listing) || !isTextPath(path)) return;
  state.setReading(path, true);
  try {
    const { preview } = state;
    const history = session().history;
    const text = preview !== null && history ? await history.read(preview, artifactPath(path)) : await session().artifact.readText(artifactPath(path));
    // A preview that ended meanwhile: the text is of the wrong version.
    if (useFiles.getState().preview !== preview) return;
    const hash = useFiles.getState().listing[path]?.hash;
    if (hash) useFiles.getState().acknowledge({ [path]: { text, hash } });
  } catch (error) {
    toast.add({ title: `Could not read ${path}`, description: error instanceof Error ? error.message : String(error) });
  } finally {
    useFiles.getState().setReading(path, false);
  }
}

/** Schedules a save. */
export function schedule(delay = SAVE_DELAY): void {
  const state = useFiles.getState();
  if (state.readOnly) return;
  if (isDirty(state)) state.setSave(state.save === 'offline' ? 'offline' : 'dirty');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

/** What a save sent, to tell afterwards whether the working copy may follow the server. */
type Sent = Record<string, { shown: string | null | undefined; disk: string | null }>;

/** Builds the next batch: the viewer's changes, the index with `lastChange`, then generated files. */
function collect(): { batch: PublishBatch; sent: Sent } {
  const state = useFiles.getState();
  const conflicted = new Set(state.conflicts.map((c) => c.path));
  const batch: PublishBatch = {};
  const sent: Sent = {};
  const put = (path: string, disk: string | null): void => {
    batch[artifactPath(path)] = disk === null ? null : { content: disk, ifMatch: state.listing[path]?.hash ?? null };
    sent[path] = { shown: state.texts[path], disk };
  };

  const changed = dirtyPaths(state).filter((path) => !conflicted.has(path) && !isGenerated(path));
  for (const path of changed) {
    const text = state.texts[path];
    put(path, text === null || text === undefined ? null : toDisk(path, text, state.server[path]));
  }

  // The index records who changed what, when the viewer changed anything.
  let indexText = state.texts[INDEX] ?? undefined;
  if (changed.length && indexText !== undefined && !conflicted.has(INDEX)) {
    try {
      const index = JSON.parse(indexText) as Record<string, unknown>;
      index.lastChange = { by: session().viewer.name, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), via: 'page' };
      indexText = `${JSON.stringify(index, null, 2)}\n`;
      put(INDEX, indexText);
    } catch {
      // An index that does not parse is written as the viewer left it.
    }
  }

  for (const [path, text] of Object.entries(generatedFiles(indexText))) {
    if (conflicted.has(path)) continue;
    if (text === null ? path in state.listing : text !== state.server[path]) put(path, text);
  }
  return { batch, sent };
}

/** The generated files as they should be now (`null`: remove). */
function generatedFiles(indexText: string | undefined): Record<string, string | null> {
  const state = useFiles.getState();
  const model = deriveModel(state);
  if (model.empty || model.indexError) return {};
  const files = new Map(model.files);
  if (indexText !== undefined) files.set(INDEX, indexText);
  // The previous manifest's islands are read from disk, not the working copy.
  const disk = state.server['manifest.json'];
  if (disk !== undefined) files.set('manifest.json', disk);
  const out = generateSystemFiles({ files, fallbackTitle: state.title });
  // Cards of components that are gone, including ones never loaded.
  for (const path of Object.keys(state.listing)) if (path.startsWith('api/') && !(path in out)) out[path] = null;
  // The README is rewritten only once its text is here.
  if (model.readme && typeof state.texts[model.readme.path] !== 'string') delete out[model.readme.path];
  return out;
}

/** Saves now (coalescing with a save already running). */
export async function flush(): Promise<void> {
  if (useFiles.getState().readOnly) return;
  while (saving) await saving;
  if (useFiles.getState().readOnly) return;
  saving = saveBatch().finally(() => { saving = null; });
  await saving;
}

async function saveBatch(): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const { batch, sent } = collect();
    if (Object.keys(batch).length === 0) break;
    useFiles.getState().setSave('saving');
    try {
      const result = await session().artifact.publish(batch);
      const ack: Record<string, AckFile> = {};
      for (const [path, hash] of Object.entries(result.hashes)) {
        const project = projectPath(path);
        if (!project || !sent[project]) continue;
        const { shown, disk } = sent[project];
        // The working copy follows what we wrote unless the viewer changed it since: then it is kept for the next save.
        const adopt = useFiles.getState().texts[project] === shown;
        ack[project] = disk === null ? { hash: null, adopt, keep: !adopt } : { text: disk, hash: hash ?? '', adopt, keep: !adopt };
      }
      useFiles.getState().acknowledge(ack);
      offlineDelay = 2_000;
      break;
    } catch (error) {
      if (isArtifactError(error, 'conflict') && attempt < MAX_RETRIES) {
        await resolveConflicts(error.paths ?? []);
        continue;
      }
      if (isArtifactError(error, 'not_writer')) {
        useFiles.setState({ readOnly: true, save: 'readonly' });
        toast.add({ title: 'You can no longer edit this design system', description: 'Your changes since the last save were not saved.' });
        return;
      }
      useFiles.getState().setSave('offline');
      offlineDelay = Math.min(offlineDelay * 2, 30_000);
      schedule(offlineDelay);
      return;
    }
  }
  const state = useFiles.getState();
  if (isDirty(state) && dirtyPaths(state).some((path) => !state.conflicts.some((c) => c.path === path))) {
    schedule();
  } else {
    state.setSave(isDirty(state) ? 'dirty' : 'saved');
  }
}

/** Reads the files that lost a race and merges or flags each. */
async function resolveConflicts(paths: readonly ConflictPath[]): Promise<void> {
  const changes: Record<string, string | null> = {};
  for (const conflict of paths) changes[conflict.path] = conflict.actual;
  await applyRemote(changes, { force: true });
}

/**
 * Applies changes made elsewhere. `changes` maps artifact paths to their new
 * hash (`null`: deleted). Changes we already have are skipped.
 */
export async function applyRemote(changes: Record<string, string | null>, options: { force?: boolean } = {}): Promise<void> {
  const { artifact } = session();
  // While a version is previewed, changes wait until the preview ends.
  if (useFiles.getState().preview !== null) {
    held = { ...(held ?? {}), ...changes };
    return;
  }
  // The news of our own save can come before the save's answer: the listing has the new hashes only once that answer
  // is in, so wait for it. Otherwise our own write reads as made elsewhere and replaces an edit made since it went out
  // (one that undid it back to the text before reads as no change at all). A conflict inside a save comes here with
  // `force` and must not wait for itself.
  if (!options.force) while (saving) await saving;
  for (const [path, hash] of Object.entries(changes)) {
    const project = projectPath(path);
    if (!project || project.startsWith('_blobs/')) continue;
    const state = useFiles.getState();
    if (!options.force && state.listing[project]?.hash === hash) continue;
    const dirty = dirtyPaths(state).includes(project) && !isGenerated(project);

    if (hash === null) {
      if (dirty && state.texts[project] !== null) state.addConflict({ path: project, mine: state.texts[project] ?? null, theirs: null, theirsHash: null });
      else state.acknowledge({ [project]: { hash: null } });
      continue;
    }
    // Files nobody has opened only need their new hash.
    const loaded = project in state.server || isEager(project);
    if (!loaded) {
      state.acknowledge({ [project]: { hash } });
      continue;
    }
    let text: string;
    try {
      text = await artifact.readText(path);
    } catch {
      continue;
    }
    const now = useFiles.getState();
    const mine = now.texts[project];
    if (!dirty || isGenerated(project) || (typeof mine === 'string' && fromDisk(project, text) === mine)) {
      now.acknowledge({ [project]: { text, hash, adopt: !dirty || isGenerated(project) } });
      continue;
    }
    // Both sides changed it: merge when they changed different parts.
    if (typeof mine === 'string' && project in now.server) {
      const merged = autoMerge(project, fromDisk(project, now.server[project]!), mine, fromDisk(project, text));
      if (merged !== null) {
        now.acknowledge({ [project]: { text, hash } });
        useFiles.setState({ texts: { ...useFiles.getState().texts, [project]: merged } });
        if (project !== INDEX) toast.add({ title: `Merged changes to ${project}`, description: 'Your edits and the ones made elsewhere touched different parts; both are kept.' });
        continue;
      }
    }
    now.addConflict({ path: project, mine: mine ?? null, theirs: text, theirsHash: hash });
  }
  // A changed index may switch the page to read-only ("off" / "code").
  const state = useFiles.getState();
  const mode = editingMode(state.server[INDEX]);
  if (session().canEdit && mode !== state.readOnlyReason) {
    useFiles.setState({ readOnly: mode !== null, readOnlyReason: mode, save: mode ? 'readonly' : 'saved' });
  }
  schedule();
}

/* -------------------------------------------------------------------------- */
/* Previewing a version                                                        */
/* -------------------------------------------------------------------------- */

/** The working state while a version is previewed. */
let stashed: Pick<FilesState, 'listing' | 'server' | 'texts' | 'readOnly' | 'save' | 'undo' | 'redo' | 'conflicts'> | null = null;
/** Remote changes that arrived during a preview. */
let held: Record<string, string | null> | null = null;

/**
 * Shows version `n` read-only: saves first, then swaps the store's files
 * for the version's (every view reads them as usual). Rejects when the
 * version cannot be read.
 */
export async function enterPreview(n: number): Promise<void> {
  const history = session().history;
  if (!history) return;
  if (useFiles.getState().preview === null) await flush();
  const raw = await history.files(n);
  const listing: Record<string, ListedFile> = {};
  for (const [path, entry] of Object.entries(raw)) {
    const project = projectPath(path);
    if (project) listing[project] = { hash: entry.sha256, size: entry.size };
  }
  const server: Record<string, string> = {};
  await Promise.all(
    Object.keys(listing)
      .filter(isEager)
      .map(async (path) => {
        try {
          server[path] = await history.read(n, artifactPath(path));
        } catch {
          // A file the version lists but cannot serve shows as not loaded.
        }
      }),
  );
  const state = useFiles.getState();
  if (state.preview === null) {
    stashed = { listing: state.listing, server: state.server, texts: state.texts, readOnly: state.readOnly, save: state.save, undo: state.undo, redo: state.redo, conflicts: state.conflicts };
  }
  const texts: Record<string, string> = {};
  for (const [path, text] of Object.entries(server)) texts[path] = fromDisk(path, text);
  useFiles.setState({ preview: n, listing, server, texts, readOnly: true, save: 'readonly', undo: [], redo: [], conflicts: [] });
}

/** Back to the current files; changes that arrived meanwhile are applied. */
export async function exitPreview(): Promise<void> {
  if (useFiles.getState().preview === null || !stashed) return;
  useFiles.setState({ ...stashed, preview: null });
  stashed = null;
  const changes = held;
  held = null;
  if (changes) await applyRemote(changes);
}

/* -------------------------------------------------------------------------- */
/* Conflict choices                                                            */
/* -------------------------------------------------------------------------- */

/** Takes their version and drops ours. */
export function takeTheirs(path: string): void {
  const state = useFiles.getState();
  const conflict = state.conflicts.find((c) => c.path === path);
  if (!conflict) return;
  state.acknowledge({ [path]: conflict.theirs === null ? { hash: null, adopt: true } : { text: conflict.theirs, hash: conflict.theirsHash, adopt: true } });
  state.resolveConflict(path);
}

/** Keeps ours: the next save overwrites theirs. */
export function keepMine(path: string): void {
  const state = useFiles.getState();
  const conflict = state.conflicts.find((c) => c.path === path);
  if (!conflict) return;
  state.acknowledge({ [path]: conflict.theirs === null ? { hash: null } : { text: conflict.theirs, hash: conflict.theirsHash } });
  // A deleted file comes back: make sure the working copy is still ours.
  if (conflict.mine !== null) useFiles.setState({ texts: { ...useFiles.getState().texts, [path]: conflict.mine } });
  state.resolveConflict(path);
  schedule(0);
}

/** Saves ours next to theirs (`name (mine).ext`) and takes theirs. */
export function saveMineAsCopy(path: string): void {
  const state = useFiles.getState();
  const conflict = state.conflicts.find((c) => c.path === path);
  if (!conflict || conflict.mine === null) return;
  const dot = path.lastIndexOf('.');
  const stem = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
  const ext = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
  let copy = `${stem}-mine${ext}`;
  for (let n = 2; copy in state.listing || typeof state.texts[copy] === 'string'; n++) copy = `${stem}-mine-${n}${ext}`;
  takeTheirs(path);
  useFiles.getState().edit({ [copy]: conflict.mine });
  toast.add({ title: 'Your version was saved as a copy', description: copy });
}

/* -------------------------------------------------------------------------- */
/* Binary files                                                                */
/* -------------------------------------------------------------------------- */

/** Base64 of bytes. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Writes uploaded files into the project (fonts, assets kept as files). Not undoable. */
export async function writeFiles(files: { path: string; data: Blob }[]): Promise<boolean> {
  const state = useFiles.getState();
  if (state.readOnly || !files.length) return false;
  const batch: PublishBatch = {};
  for (const file of files) {
    batch[artifactPath(file.path)] = {
      content: toBase64(new Uint8Array(await file.data.arrayBuffer())),
      encoding: 'base64',
      ifMatch: state.listing[file.path]?.hash ?? null,
    };
  }
  try {
    const result = await session().artifact.publish(batch);
    const ack: Record<string, AckFile> = {};
    for (const file of files) {
      const hash = result.hashes[artifactPath(file.path)];
      if (hash) ack[file.path] = { hash, size: file.data.size, ...(isTextPath(file.path) ? { text: await file.data.text() } : {}) };
    }
    useFiles.getState().acknowledge(ack);
    return true;
  } catch (error) {
    toast.add({ title: 'Upload failed', description: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Apply folder moves and their index metadata in one publish, so a failed move leaves the group intact. */
export async function publishAssetMove(moves: Map<string, string>, index: Record<string, unknown>): Promise<boolean> {
  const state = useFiles.getState();
  if (state.readOnly || isDirty(state)) return false;
  const indexText = JSON.stringify(index, null, 2) + '\n';
  const batch: PublishBatch = { [artifactPath(INDEX)]: { content: indexText, ifMatch: state.listing[INDEX]!.hash } };
  try {
    for (const [from, to] of moves) {
      if (!state.listing[from] || state.listing[to]) throw new Error(`Cannot move ${from} to ${to}.`);
      const bytes = await session().artifact.readBytes(artifactPath(from));
      batch[artifactPath(to)] = { content: toBase64(bytes), encoding: 'base64', ifMatch: null };
      batch[artifactPath(from)] = null;
    }
    const latest = useFiles.getState();
    if (latest.readOnly || isDirty(latest) || [...moves.keys()].some((from) => latest.listing[from]?.hash !== state.listing[from]?.hash)) {
      throw new Error('Files changed during the move. Try again after they sync.');
    }
    const { hashes } = await session().artifact.publish(batch);
    const ack: Record<string, AckFile> = { [INDEX]: { text: indexText, hash: hashes[artifactPath(INDEX)]! } };
    for (const [from, to] of moves) {
      const text = state.server[from];
      ack[from] = { hash: null };
      ack[to] = { hash: hashes[artifactPath(to)]!, size: state.listing[from]!.size, ...(text === undefined ? {} : { text }) };
    }
    useFiles.getState().acknowledge(ack);
    return true;
  } catch (error) {
    toast.add({ title: 'Could not move the assets', description: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Moves a file (rename, or archive into `archived/`). Not undoable. */
export async function moveFile(from: string, to: string): Promise<boolean> {
  const state = useFiles.getState();
  const entry = state.listing[from];
  if (state.readOnly || !entry || to in state.listing) return false;
  try {
    const bytes = await session().artifact.readBytes(artifactPath(from));
    const result = await session().artifact.publish({
      [artifactPath(to)]: { content: toBase64(bytes), encoding: 'base64', ifMatch: null },
      [artifactPath(from)]: null,
    });
    const text = state.server[from];
    const hash = result.hashes[artifactPath(to)] ?? '';
    useFiles.getState().acknowledge({
      [from]: { hash: null, adopt: true },
      [to]: text === undefined ? { hash, size: entry.size } : { text, hash, adopt: true },
    });
    return true;
  } catch (error) {
    toast.add({ title: `Could not move ${from}`, description: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Deletes project files at once (binary or text; the history keeps them).
 * Generated files and the index are left alone. Returns the paths deleted.
 */
export async function deleteFiles(paths: readonly string[]): Promise<string[]> {
  const state = useFiles.getState();
  if (state.readOnly) return [];
  const doomed = paths.filter((path) => path !== INDEX && !isGenerated(path) && (path in state.listing || typeof state.texts[path] === 'string'));
  if (!doomed.length) return [];
  const batch: PublishBatch = {};
  for (const path of doomed) if (path in state.listing) batch[artifactPath(path)] = null;
  try {
    if (Object.keys(batch).length) await session().artifact.publish(batch);
    const acknowledged: Parameters<FilesState['acknowledge']>[0] = {};
    for (const path of doomed) acknowledged[path] = { hash: null, adopt: true };
    useFiles.getState().acknowledge(acknowledged);
    // A file never saved only lived in the working copy.
    const texts = { ...useFiles.getState().texts };
    for (const path of doomed) if (!(path in state.listing)) delete texts[path];
    useFiles.setState({ texts });
    return doomed;
  } catch (error) {
    toast.add({ title: 'Could not delete', description: error instanceof Error ? error.message : String(error) });
    return [];
  }
}
