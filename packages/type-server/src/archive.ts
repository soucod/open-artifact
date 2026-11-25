/**
 * The whole artifact folder as one .zip (`archive <dir> [--out file.zip]`),
 * to back it up, move it to another computer or send it to someone:
 * unzipped anywhere, it opens again with `open <folder>`. Node built-ins only.
 *
 * What goes in the zip and how it is written (`archiveKeeps`, `archiveEntries`, `writeZip`, `sendArchive`) is in
 * `@open-artifact/server-sdk/zip`, shared with frame-host and the daemon, and re-exported here; the import of an
 * artifact archive, which knows the artifact types, stays here.
 */

import { constants, existsSync, statSync } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { archiveFileName, archiveKeeps, crc32, writeArchive } from '@open-artifact/server-sdk/zip';
import { HttpError } from './http.ts';
import { MAX_FILE_BYTES } from './store.ts';
import { unpackEntry, entryBytes, ZipError, zipEntries, type ZipEntry } from './unzip.ts';

export {
  archiveEntries,
  archiveFileName,
  archiveKeeps,
  ArchiveTooLarge,
  attachmentHeader,
  crc32,
  sendArchive,
  writeArchive,
  writeZip,
  type ArchiveEntry,
} from '@open-artifact/server-sdk/zip';

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

/**
 * `archive <dir> [--out file.zip | folder]`: by default the zip goes beside
 * the artifact folder (in its parent), named by {@link archiveFileName};
 * `--out` an existing folder puts it there under that name.
 */
export async function archiveCommand(root: string, out: string | undefined): Promise<{ file: string; folder: string; files: number; bytes: number }> {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${root} is not a folder.`);
  const where = out ? resolve(out) : dirname(resolve(root));
  const target = existsSync(where) && statSync(where).isDirectory() ? join(where, archiveFileName(root)) : where;
  const { file, files, bytes } = await writeArchive(root, target);
  return { file, folder: basename(resolve(root)), files, bytes };
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

/** Caps on what an imported archive may unpack to. */
export interface ImportLimits {
  /** Files, at most. Default 65 535 (what a plain zip holds). */
  maxFiles?: number;
  /** Unpacked bytes of all files together, at most. Default 4 GiB. */
  maxBytes?: number;
  /** Unpacked bytes of any one file, at most; when given it replaces the per-folder defaults ({@link importFileLimit}). */
  maxFileBytes?: number;
}

/** An archive unpacked into an artifact folder. */
export interface ImportedArchive {
  /** The artifact folder (`dest`, resolved). */
  root: string;
  /** Its type, detected from the unpacked folder. */
  type: string;
  files: number;
  bytes: number;
}

/** Largest upload under `_blobs/`, as the type server takes one (its `MAX_UPLOAD`). */
const IMPORT_MAX_BLOB_BYTES = 25 * 1024 * 1024;
/** Largest other file outside `project/` (history, comments, a sheet's imported workbook of up to 50 MB, a db document). */
const IMPORT_MAX_OTHER_BYTES = 64 * 1024 * 1024;

/**
 * The most one imported file may unpack to: a `project/` file what a page may write ({@link MAX_FILE_BYTES},
 * 16 MB), an upload under `_blobs/` what the server takes (25 MB), anything else 64 MB.
 */
export function importFileLimit(path: string): number {
  if (path.startsWith('project/')) return MAX_FILE_BYTES;
  if (path.startsWith('_blobs/')) return IMPORT_MAX_BLOB_BYTES;
  return IMPORT_MAX_OTHER_BYTES;
}

const UNIX_HOST = 3;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const DOS_DIRECTORY = 0x10;
/** Flag bits of an encrypted entry: encrypted, strong encryption, masked local header. */
const ENCRYPTED = (1 << 0) | (1 << 6) | (1 << 13);
/** `wx`, and never through a symbolic link. */
const WRITE_NEW = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);

const refuse = (message: string): HttpError => new HttpError(400, 'invalid_archive', message);
const tooLarge = (message: string): HttpError => new HttpError(413, 'too_large', message);

/** How a name compares on a case-insensitive, normalization-insensitive disk. */
const folded = (path: string): string => path.normalize('NFC').toLowerCase();

/** One entry, checked: where it goes under the artifact folder and its permissions. */
interface ImportEntry {
  entry: ZipEntry;
  path: string;
  mode: number;
}

/** Checks one central directory entry and splits its name into the top folder and the path under it. */
function checkEntry(entry: ZipEntry): { top: string; path: string; mode: number } {
  const name = entry.name;
  const shown = JSON.stringify(name);
  if (entry.flags & ENCRYPTED) throw refuse(`${shown} is encrypted; an artifact archive never is.`);
  if (entry.method !== 0 && entry.method !== 8) throw refuse(`${shown} is packed with method ${entry.method}; only stored and deflated files are read.`);
  const mode = entry.externalAttributes >>> 16;
  if (entry.madeBy >>> 8 !== UNIX_HOST || (mode & S_IFMT) !== S_IFREG || entry.externalAttributes & DOS_DIRECTORY || name.endsWith('/')) {
    throw refuse(`${shown} is not a regular file (a folder, a symbolic link or another kind of entry); an artifact archive holds files only.`);
  }
  if (name.includes('\0') || name.includes('\\')) throw refuse(`${shown} has a backslash or a NUL in its name.`);
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw refuse(`${shown} is an absolute path.`);
  const steps = name.split('/');
  if (steps.some((step) => step === '..')) throw refuse(`${shown} climbs out of its folder (..).`);
  if (steps.some((step) => step === '' || step === '.')) throw refuse(`${shown} has an empty or "." step in its path.`);
  if (steps.length < 2) throw refuse(`${shown} is at the top of the zip; an artifact archive holds one folder.`);
  const path = steps.slice(1).join('/');
  if (!archiveKeeps(path) || !archiveKeeps(folded(path))) throw refuse(`${shown} is not part of an artifact archive (the agent channel, a dot file, a temp file or junk).`);
  return { top: steps[0]!, path, mode: (mode & 0o755) | 0o600 };
}

/** Every entry checked, before a byte is unpacked: names, kinds, duplicates, one top folder and the declared sizes. */
function checkEntries(bytes: Uint8Array, limits: Required<Omit<ImportLimits, 'maxFileBytes'>> & { maxFileBytes?: number }): ImportEntry[] {
  let directory: ReturnType<typeof zipEntries>;
  try {
    directory = zipEntries(bytes);
  } catch (error) {
    if (error instanceof ZipError) throw refuse('This file is not a zip.');
    throw error;
  }
  if (directory.declared > limits.maxFiles) throw tooLarge(`The archive holds ${directory.declared} files, more than ${limits.maxFiles}.`);
  if (directory.entries.length !== directory.declared) throw refuse('The zip is damaged: its central directory is short.');
  if (directory.declared === 0) throw refuse('The archive is empty.');
  const checked: ImportEntry[] = [];
  const seen = new Set<string>();
  const folders = new Set<string>();
  let top: string | undefined;
  let declaredBytes = 0;
  for (const entry of directory.entries) {
    const { top: folder, path, mode } = checkEntry(entry);
    if (top === undefined) top = folder;
    else if (folder !== top) throw refuse(`The archive holds more than one folder (${JSON.stringify(top)} and ${JSON.stringify(folder)}); an artifact archive holds one.`);
    const key = folded(path);
    if (seen.has(key)) throw refuse(`${JSON.stringify(entry.name)} is in the archive twice (names that differ only in case count as the same).`);
    seen.add(key);
    const steps = key.split('/');
    for (let index = 1; index < steps.length; index++) folders.add(steps.slice(0, index).join('/'));
    const cap = limits.maxFileBytes ?? importFileLimit(path);
    if (entry.size > cap) throw tooLarge(`${path} unpacks to ${entry.size} bytes, more than ${cap}.`);
    declaredBytes += entry.size;
    if (declaredBytes > limits.maxBytes) throw tooLarge(`The archive unpacks to more than ${limits.maxBytes} bytes.`);
    const local = entryBytes(bytes, entry);
    if (local.start + entry.packedSize > directory.directoryOffset || directory.directoryOffset > bytes.byteLength) throw refuse(`The zip is damaged: the data of ${path} runs past its end.`);
    if (local.localName !== entry.name || local.localMethod !== entry.method || local.localFlags & ENCRYPTED) throw refuse(`The zip is damaged: the local header of ${path} does not match its directory entry.`);
    if (entry.method === 0 && entry.packedSize !== entry.size) throw refuse(`The zip is damaged: ${path} is stored but its sizes differ.`);
    checked.push({ entry, path, mode });
  }
  for (const key of seen) if (folders.has(key)) throw refuse(`${key} is in the archive both as a file and as a folder.`);
  return checked;
}

/** One entry's bytes: never past its declared size, which must be its real size, and its CRC must hold. */
async function unpackChecked(bytes: Uint8Array, item: ImportEntry): Promise<Buffer> {
  let data: Buffer;
  try {
    data = await unpackEntry(bytes, item.entry, item.entry.size);
  } catch (error) {
    if (error instanceof RangeError) throw tooLarge(`${item.path} unpacks to more than the ${item.entry.size} bytes it declares.`);
    if (error instanceof ZipError) throw refuse(error.message);
    throw refuse(`The zip is damaged: ${item.path} cannot be unpacked.`);
  }
  if (data.length !== item.entry.size) throw refuse(`The zip is damaged: ${item.path} unpacks to ${data.length} bytes, not the ${item.entry.size} it declares.`);
  if (crc32(data) !== item.entry.crc) throw refuse(`The zip is damaged: ${item.path} fails its CRC check.`);
  return data;
}

/** Writes a new file, refusing one that exists and never following a symbolic link. */
async function writeNew(file: string, data: Uint8Array, mode: number): Promise<void> {
  const handle = await open(file, WRITE_NEW, mode);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}

/** `.artifact.json` with `id` in place of the archive's: the shape the daemon writes (`{type, id, release}`), other fields kept. */
/** The `.artifact.json` type of an unpacked folder when it is one of `accepted`, else null. */
async function markerTypeOf(root: string, accepted: readonly string[] | undefined, inspect?: (marker: Record<string, unknown> | null) => void | Promise<void>): Promise<string | null> {
  if (!accepted?.length && !inspect) return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(await readFile(join(root, '.artifact.json'), 'utf8')) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    /* none, or not JSON */
  }
  await inspect?.(parsed);
  return typeof parsed?.type === 'string' && accepted?.includes(parsed.type) ? parsed.type : null;
}

async function stampId(root: string, type: string, id: string): Promise<void> {
  const file = join(root, '.artifact.json');
  let marker: Record<string, unknown> = { type, id, release: null };
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) marker = { ...(parsed as Record<string, unknown>), id };
  } catch {
    /* none, or not JSON: a fresh marker */
  }
  await rm(file, { force: true });
  await writeNew(file, Buffer.from(`${JSON.stringify(marker, null, 2)}\n`), 0o644);
}

/**
 * Unpacks an artifact archive (what `sendArchive` writes) into `dest`, which must not exist yet.
 * `id`, when given, is written into the folder's `.artifact.json` in place of the archive's. `markerTypes` names types
 * this server does not run that the caller takes (a hosted site's `page`): a folder whose `.artifact.json` says one is
 * that type; anything else unknown is still refused. `inspectMarker` sees the unpacked `.artifact.json` (or null) first
 * and may refuse it by throwing (a site checks a published type's `typeUid`); what it throws is thrown as it is.
 *
 * The zip may come from anyone, so it must be exactly the shape {@link archiveEntries} and {@link writeZip} make:
 * regular files only (Unix host, regular-file mode), all under one top folder whose name is dropped, every path one
 * the export would carry ({@link archiveKeeps}, so no `_agent/`, `.sharing.json` or other dot file), no `..`,
 * absolute path, backslash or NUL, no name given twice (case and Unicode normalization ignored), not encrypted, and
 * within `limits`: declared sizes are checked first, and each file is inflated no further than it declared, so a
 * size that lies fails. It unpacks into a temp folder beside `dest` that becomes `dest` only once every file is
 * written and the folder is a known artifact type; on any failure the temp folder is removed. Refusals are
 * {@link HttpError}s: 400 `invalid_archive` or `not_artifact`, 409 `exists`, 413 `too_large`.
 */
export async function importArchive(
  bytes: Uint8Array,
  dest: string,
  options: { id?: string; limits?: ImportLimits; markerTypes?: readonly string[]; inspectMarker?: (marker: Record<string, unknown> | null) => void | Promise<void> } = {},
): Promise<ImportedArchive> {
  const root = resolve(dest);
  const limits = { maxFiles: options.limits?.maxFiles ?? MAX_ENTRIES, maxBytes: options.limits?.maxBytes ?? MAX_BYTES, ...(options.limits?.maxFileBytes !== undefined ? { maxFileBytes: options.limits.maxFileBytes } : {}) };
  const exists = async (): Promise<boolean> => lstat(root).then(() => true, () => false);
  if (await exists()) throw new HttpError(409, 'exists', `${root} exists already.`);
  if (options.id !== undefined && (typeof options.id !== 'string' || !options.id)) throw new HttpError(400, 'invalid', 'id must be a non-empty string.');
  const entries = checkEntries(bytes, limits);

  await mkdir(dirname(root), { recursive: true });
  const temp = join(dirname(root), `.${basename(root)}.${randomBytes(6).toString('hex')}.import.tmp`);
  await mkdir(temp);
  try {
    let total = 0;
    for (const item of entries) {
      const data = await unpackChecked(bytes, item);
      total += data.length;
      if (total > limits.maxBytes) throw tooLarge(`The archive unpacks to more than ${limits.maxBytes} bytes.`);
      const file = resolve(temp, ...item.path.split('/'));
      if (!file.startsWith(temp + sep)) throw refuse(`${item.path} would land outside the artifact folder.`);
      await mkdir(dirname(file), { recursive: true });
      await writeNew(file, data, item.mode);
    }
    // Loaded here: server.ts imports this module, and modules the sheets and docs types load import it too.
    const { detectType } = await import('./server.ts');
    // A type this server does not run, that the caller does (a page): named by the archive's `.artifact.json` alone,
    // and looked at first, so a page whose db/ holds a built-in type's collection is still the page it says it is.
    const type = (await markerTypeOf(temp, options.markerTypes, options.inspectMarker)) ?? (await detectType(temp));
    if (!type) throw new HttpError(400, 'not_artifact', 'The archive is not an artifact: it holds no known type\'s marker file.');
    if (options.id !== undefined) await stampId(temp, type, options.id);
    if (await exists()) throw new HttpError(409, 'exists', `${root} exists already.`);
    await rename(temp, root);
    return { root, type, files: entries.length, bytes: total };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    if (error instanceof HttpError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTDIR') throw refuse('The archive\'s paths collide with one another.');
    throw error;
  }
}
