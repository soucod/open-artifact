/**
 * Type packages: `open-artifact types pack | install | uninstall | update`, and the `types.preview`,
 * `types.install`, `types.uninstall` and `types.update` routes of the home page.
 *
 * A package (`<id>-<version>.oatype`) is a zip of one type folder, checked with `types check --for-share` before it
 * is written. An install reads the package (a file, or an `https://` address fetched once), checks every entry and the
 * manifest with the protocol's rules (`type-package.ts`) before a byte is written, unpacks it into a dot folder of the
 * installed root (which a scan skips) and renames it into place only once the unpacked folder passes the same rules
 * again. Where each installed type came from is in `<OPEN_ARTIFACT_HOME>/types.json`.
 *
 * Nothing from a package is run in Node: the declaration is read as literal data, and no `entry.start` is ever
 * started for an installed type (`servers.ts`).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import {
  OpenArtifactError,
  TYPE_ID,
  TYPE_PACKAGE_EXTENSION,
  TYPE_PACKAGE_LIMITS,
  isLoopbackHostName,
  packageEntryProblems,
  packageFileName,
  readStaticDeclaration,
  type ArtifactTypeManifest,
  type InstalledTypeEntry,
  type InstalledTypesIndex,
  type OpenArtifactSettings,
  type TypeCheckProblem,
  type TypePackagePreview,
  type TypeSourceKind,
  type ArtifactRecord,
} from '@open-artifact/protocol';
import { checkTypePackage } from '@open-artifact/server-sdk/type-package';
import { moveIntoPlace, unpackZip, zipBytes, ZipRefusal, type ArchiveEntry, type CheckedZipFile } from '@open-artifact/server-sdk/zip';
import { ensureDir, files, readJson, writeFileAtomic } from './paths.ts';
import { checkType, packageFolderEntries } from './type-authoring.ts';
import type { TypeInfo, TypeRegistry } from './types.ts';

/** The most bytes `types install <url>` reads: a package's own limit and room for its zip headers. */
export const PACKAGE_DOWNLOAD_MAX = TYPE_PACKAGE_LIMITS.totalBytes + 4 * 1024 * 1024;
/** How long `types install <url>` waits for the whole package, ms. */
export const PACKAGE_DOWNLOAD_MS = 60_000;
/** Redirects followed, each to the same scheme. */
const MAX_REDIRECTS = 5;

// ---- the index ------------------------------------------------------------------------------------------------------

/** `<OPEN_ARTIFACT_HOME>/types.json`, or an empty one. */
export function installedIndex(): InstalledTypesIndex {
  const read = readJson<Partial<InstalledTypesIndex> | null>(files.typesIndex(), null);
  const types: Record<string, InstalledTypeEntry> = {};
  if (read && typeof read === 'object' && read.types && typeof read.types === 'object') {
    for (const [id, entry] of Object.entries(read.types)) if (entry && typeof entry === 'object' && typeof entry.uid === 'string') types[id] = entry;
  }
  return { version: 1, types };
}

/** The index entry of one installed type, or null. */
export function installedEntry(id: string): InstalledTypeEntry | null {
  return Object.hasOwn(installedIndex().types, id) ? installedIndex().types[id]! : null;
}

function writeIndex(index: InstalledTypesIndex): void {
  writeFileAtomic(files.typesIndex(), `${JSON.stringify(index, null, 2)}\n`);
}

// ---- pack -----------------------------------------------------------------------------------------------------------

/** What `types pack` answers. */
export interface PackResult {
  id: string;
  version: string;
  file: string;
  sha256: string;
  bytes: number;
  files: number;
}

/** A type folder packed in memory ({@link packTypeBytes}): what {@link packType} writes. */
export interface PackedType {
  id: string;
  version: string;
  bytes: Uint8Array;
  sha256: string;
  files: number;
}

/**
 * Packs a type folder in memory after the sharing checks (`types check --for-share`; any error refuses it): what
 * `types pack` writes and `types publish` sends to a site.
 */
export async function packTypeBytes(dir: string, o: { settings: OpenArtifactSettings; registry: TypeRegistry; workspace?: string | null }): Promise<PackedType> {
  const check = checkType(dir, { settings: o.settings, registry: o.registry, workspace: o.workspace ?? null, forShare: true });
  if (!check.ok) {
    throw new OpenArtifactError('invalid_argument', `${check.id} is not ready to share:\n${check.errors.map((e) => `  - ${e.message}`).join('\n')}`, {
      fix: `Fix what open-artifact types check ${dir} --for-share lists, then pack it again.`,
    });
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'artifact-type.json'), 'utf8')) as ArtifactTypeManifest;
  const id = basename(resolve(dir));
  const version = String(manifest.version);
  const entries: ArchiveEntry[] = packageFolderEntries(dir)
    .filter((e) => e.kind === 'file')
    .map((e) => {
      const file = join(dir, ...e.path.split('/'));
      const st = statSync(file);
      return { name: `${id}/${e.path}`, file, size: st.size, mode: st.mode & 0o777, mtime: st.mtime };
    });
  const bytes = await zipBytes(entries);
  return { id, version, bytes, sha256: sha256(bytes), files: entries.length };
}

/**
 * `types pack <dir> [--out]`: checks the folder for sharing ({@link packTypeBytes}) and writes `<id>-<version>.oatype`
 * to `out` (a file, or a folder to put it in; default the working directory).
 */
export async function packType(dir: string, o: { settings: OpenArtifactSettings; registry: TypeRegistry; workspace?: string | null; out?: string; cwd?: string }): Promise<PackResult> {
  const packed = await packTypeBytes(dir, o);
  const cwd = o.cwd ?? process.cwd();
  const where = o.out ? resolve(cwd, o.out) : cwd;
  const file = existsSync(where) && statSync(where).isDirectory() ? join(where, packageFileName(packed.id, packed.version)) : where;
  writeFileAtomic(file, packed.bytes);
  return { id: packed.id, version: packed.version, file, sha256: packed.sha256, bytes: packed.bytes.length, files: packed.files };
}

// ---- reading a package ----------------------------------------------------------------------------------------------

/** A package read and checked, ready to install. */
export interface ReadPackage {
  preview: TypePackagePreview;
  bytes: Uint8Array;
  files: CheckedZipFile[];
}

const refuse = (message: string, fix?: string): OpenArtifactError => new OpenArtifactError('invalid_argument', message, fix ? { fix } : undefined);
const listed = (problems: TypeCheckProblem[]): string => problems.map((p) => `  - ${p.message}`).join('\n');

/**
 * Reads a package's bytes and checks all of it before anything is written (`checkTypePackage`, shared with a site's
 * `types.import`): the zip's shape (`checkZip`: one top
 * folder, plain files, no `..`, absolute path, backslash, NUL or name given twice by case or Unicode form, the size
 * and file limits on what it declares), the entries' paths and kinds (`packageEntryProblems`, the same rules
 * `types check --for-share` applies), the manifest (`manifestPackageProblems`: fields, entry, network), and its
 * declaration (literal data). `as` installs it under another id.
 */
export async function readTypePackage(bytes: Uint8Array, source: string, o: { as?: string | null; registry?: TypeRegistry | null } = {}): Promise<ReadPackage> {
  const pkg = await checkTypePackage(bytes, source, { as: o.as ?? null });
  const { id, uid } = pkg;
  const warnings: string[] = [];
  const known = installedEntry(id);
  if (known && known.uid !== uid) {
    throw new OpenArtifactError('conflict', `An installed type ${id} is another type (uid ${known.uid}, from ${known.source}); this package's uid is ${uid}.`, {
      fix: `Install it under another id: open-artifact types install ${source} --as <id>.`,
    });
  }
  const folder = join(files.installedTypes(), id);
  if (!known && existsSync(folder)) {
    throw new OpenArtifactError('conflict', `${folder} exists but is not in ${files.typesIndex()}: it was not installed by open-artifact types install.`, {
      fix: `Move that folder away, or install this one under another id with --as <id>.`,
    });
  }
  const other = o.registry?.list(null, { includeShadowed: true }).find((t) => t.id === id && t.scope !== 'installed');
  if (other) warnings.push(`A ${other.scope} type ${id} (${other.dir}) wins over an installed one of the same id: this one stays hidden until it is gone.`);
  const skillText = pkg.skill?.text ?? null;
  return {
    preview: {
      id,
      uid,
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      source,
      sha256: pkg.sha256,
      bytes: pkg.bytes,
      files: pkg.files.length,
      capabilities: pkg.capabilities,
      network: pkg.network,
      skill: skillText === null || !pkg.skill ? null : { path: `${pkg.top}/${pkg.skill.path}`, chars: skillText.length, lines: skillText.split('\n').length, text: skillText },
      replaces: known ? { version: known.version, source: known.source, sha256: known.sha256 } : null,
      warnings,
    },
    bytes,
    files: pkg.files,
  };
}

/** The text of a preview for a terminal: everything the person decides on, the full SKILL.md left to its path. */
export function previewText(p: TypePackagePreview): string {
  const lines = [
    `${p.name} ${p.version} (${p.id}, uid ${p.uid})`,
    `  from:         ${p.source}`,
    `  sha256:       ${p.sha256} (${p.bytes} bytes, ${p.files} files)`,
    `  description:  ${p.description}`,
    `  capabilities: ${p.capabilities.length ? p.capabilities.join(', ') : 'none declared'}`,
    `  network:      ${p.network.length ? p.network.join(', ') : 'does not reach the network'}`,
    `  SKILL.md:     ${p.skill ? `${p.skill.path}, ${p.skill.chars} characters, ${p.skill.lines} lines: what agents are told when they make one` : 'none'}`,
    ...(p.replaces ? [`  replaces:     ${p.replaces.version} from ${p.replaces.source}`] : []),
    ...p.warnings.map((w) => `  note:         ${w}`),
    '  Its page runs in your browser, limited to the network above; nothing of it runs on this computer outside the page.',
    "  Its SKILL.md, title and description are the publisher's: agents are told they cannot grant permissions or widen a task.",
  ];
  return lines.join('\n');
}

// ---- fetching a package ---------------------------------------------------------------------------------------------

/**
 * The bytes at `address`: `https:` only (plain `http:` only to this computer, for tests), no user or password in it,
 * redirects followed only to the same scheme (at most {@link MAX_REDIRECTS}), no cookies or credentials sent, at most
 * {@link PACKAGE_DOWNLOAD_MAX} bytes, and {@link PACKAGE_DOWNLOAD_MS} for all of it, the body included.
 */
export async function fetchTypePackage(address: string, o: { timeoutMs?: number; maxBytes?: number } = {}): Promise<Uint8Array> {
  const max = o.maxBytes ?? PACKAGE_DOWNLOAD_MAX;
  const signal = AbortSignal.timeout(o.timeoutMs ?? PACKAGE_DOWNLOAD_MS);
  let url = allowedUrl(address);
  const scheme = url.protocol;
  try {
    for (let hop = 0; ; hop++) {
      const response = await fetch(url, { redirect: 'manual', credentials: 'omit', signal, headers: { accept: 'application/zip, application/octet-stream' } });
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => undefined);
        const location = response.headers.get('location');
        if (!location || hop >= MAX_REDIRECTS) throw new OpenArtifactError('download_failed', `${address} answered with a redirect (${response.status}) that is not followed.`);
        const next = allowedUrl(new URL(location, url).href);
        if (next.protocol !== scheme) throw new OpenArtifactError('redirected', `${address} redirects to ${next.protocol}//: a package is fetched with the scheme it was asked for.`);
        url = next;
        continue;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new OpenArtifactError('download_failed', `${address} answered ${response.status}.`);
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > max) {
        void response.body?.cancel().catch(() => undefined);
        throw new OpenArtifactError('too_large', `${address} is ${declared} bytes, more than a type package may be (${max}).`);
      }
      if (!response.body) return new Uint8Array();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          void reader.cancel().catch(() => undefined);
          throw new OpenArtifactError('too_large', `${address} sent more than a type package may be (${max} bytes).`);
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    }
  } catch (error) {
    if (error instanceof OpenArtifactError) throw error;
    const name = (error as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new OpenArtifactError('timeout', `${address} did not send the package within ${(o.timeoutMs ?? PACKAGE_DOWNLOAD_MS) / 1000} s.`);
    throw new OpenArtifactError('download_failed', `${address} could not be fetched (${(error as Error)?.message ?? error}).`);
  }
}

function allowedUrl(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw refuse(`${address} is not an address.`);
  }
  if (url.username || url.password) throw refuse(`${address} carries a user name or password: a package is fetched without credentials.`);
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && isLoopbackHostName(url.hostname)) return url;
  throw refuse(`${address}: a type package is fetched over https:// (plain http:// only from this computer).`);
}

/** Whether `target` names an address rather than a file. */
export const isAddress = (target: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(target);

/** Reads a package from a file or fetches it from an address; `source` is what the index records. */
export async function loadTypePackage(target: string, cwd = process.cwd()): Promise<{ bytes: Uint8Array; source: string }> {
  if (isAddress(target)) return { bytes: await fetchTypePackage(target), source: target };
  const file = resolve(cwd, target);
  let st;
  try {
    st = statSync(file);
  } catch {
    throw new OpenArtifactError('not_found', `${file} is not there.`);
  }
  if (!st.isFile()) throw refuse(`${file} is not a file.`);
  if (st.size > PACKAGE_DOWNLOAD_MAX) throw new OpenArtifactError('too_large', `${file} is ${st.size} bytes, more than a type package may be.`);
  return { bytes: readFileSync(file), source: file };
}

// ---- install, uninstall ---------------------------------------------------------------------------------------------

/** What an install answers. */
export interface InstallResult extends InstalledTypeEntry {
  dir: string;
  replaced: boolean;
  name: string;
}

/**
 * Installs a package read by {@link readTypePackage}: unpacks it into a dot folder of the installed root (counting
 * the bytes actually inflated) as plain files (mode 0644: an executable bit in the package is dropped), checks the
 * unpacked folder with the same entry rules, then renames it into place (an
 * installed type of the same id and uid is replaced: the old folder is moved aside first and removed after). A failure
 * leaves nothing behind. Records the source, version and sha256 in `types.json`.
 */
export async function installTypePackage(pkg: ReadPackage, o: { expectUid?: string } = {}): Promise<InstallResult> {
  const { preview } = pkg;
  if (o.expectUid && o.expectUid !== preview.uid) {
    throw new OpenArtifactError('type_mismatch', `${preview.source} is now another type (uid ${preview.uid}, not ${o.expectUid}): it is not installed over ${preview.id}.`, {
      fix: `Install it under another id: open-artifact types install ${preview.source} --as <id>.`,
    });
  }
  const root = ensureDir(files.installedTypes());
  const dest = join(root, preview.id);
  let unpacked: { temp: string; files: number; bytes: number };
  try {
    // Plain files only: no execute bit from the package (an installed type never runs a program; nothing in its folder
    // should look runnable either).
    unpacked = await unpackZip(
      pkg.bytes,
      pkg.files.map((f) => ({ ...f, mode: 0o644 })),
      dest,
      TYPE_PACKAGE_LIMITS.totalBytes,
    );
  } catch (error) {
    if (error instanceof ZipRefusal) throw new OpenArtifactError(error.code === 'too_large' ? 'too_large' : 'bad_archive', `${preview.source}: ${error.message}`);
    throw error;
  }
  const { temp } = unpacked;
  let aside: string | null = null;
  try {
    const again = packageEntryProblems(packageFolderEntries(temp));
    if (again.length) throw new OpenArtifactError('bad_archive', `${preview.source} did not unpack as it declared:\n${listed(again)}`);
    const known = installedEntry(preview.id);
    if (existsSync(dest)) {
      if (!known || known.uid !== preview.uid) throw new OpenArtifactError('conflict', `${dest} exists and is not an install of this type.`);
      aside = join(root, `.${preview.id}.${Date.now().toString(36)}.old`);
      renameSync(dest, aside);
    }
    await moveIntoPlace(temp, dest);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    if (aside && !existsSync(dest)) renameSync(aside, dest);
    throw error;
  }
  if (aside) rmSync(aside, { recursive: true, force: true });
  const entry: InstalledTypeEntry = {
    id: preview.id,
    uid: preview.uid,
    source: preview.source,
    version: preview.version,
    sha256: preview.sha256,
    bytes: preview.bytes,
    installedAt: new Date().toISOString(),
  };
  const index = installedIndex();
  index.types[preview.id] = entry;
  writeIndex(index);
  return { ...entry, dir: dest, replaced: !!aside, name: preview.name };
}

/** `types uninstall <id>`: removes the installed type's folder and its index entry. Its artifacts stay where they are. */
export function uninstallType(id: string): { id: string; dir: string; removed: true } {
  if (!TYPE_ID.test(id)) throw refuse(`${JSON.stringify(id)} is not a type id.`);
  const index = installedIndex();
  const dir = join(files.installedTypes(), id);
  if (!Object.hasOwn(index.types, id)) {
    throw new OpenArtifactError('not_found', `${id} is not an installed type.`, { fix: 'open-artifact types list shows each type with its source; only installed ones are uninstalled.' });
  }
  if (existsSync(dir)) {
    // Out of the root first (one rename), so a scan never sees half a folder.
    const aside = join(files.installedTypes(), `.${id}.${Date.now().toString(36)}.removed`);
    renameSync(dir, aside);
    rmSync(aside, { recursive: true, force: true });
  }
  delete index.types[id];
  writeIndex(index);
  return { id, dir, removed: true };
}

/** `types update <id>`: where the installed type came from, to read it again. */
export function updateSource(id: string): InstalledTypeEntry {
  const entry = installedEntry(id);
  if (!entry) throw new OpenArtifactError('not_found', `${id} is not an installed type.`, { fix: 'Only an installed type is updated; open-artifact types list shows the source of each.' });
  return entry;
}

// ---- staging (the home page's preview, then confirm) ----------------------------------------------------------------

/**
 * Keeps the bytes of a package the home page previewed, by sha256, so the install the person confirms is of exactly
 * those bytes (never fetched again). Old ones are dropped after an hour.
 */
export function stagePackage(bytes: Uint8Array, source: string): string {
  const dir = ensureDir(files.typesStaging());
  const now = Date.now();
  for (const name of readdirSync(dir)) {
    try {
      if (now - statSync(join(dir, name)).mtimeMs > 3_600_000) rmSync(join(dir, name), { force: true });
    } catch {
      /* gone */
    }
  }
  const hash = sha256(bytes);
  writeFileSync(join(dir, `${hash}${TYPE_PACKAGE_EXTENSION}`), bytes);
  writeFileSync(join(dir, `${hash}.json`), JSON.stringify({ source }));
  return hash;
}

/** The staged bytes and source of `hash`, or not_found. */
export function stagedPackage(hash: string): { bytes: Uint8Array; source: string } {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw refuse('sha256 is the hex digest the preview gave.');
  const dir = files.typesStaging();
  try {
    const bytes = readFileSync(join(dir, `${hash}${TYPE_PACKAGE_EXTENSION}`));
    const { source } = JSON.parse(readFileSync(join(dir, `${hash}.json`), 'utf8')) as { source: string };
    if (sha256(bytes) !== hash) throw new Error('changed');
    return { bytes, source: String(source) };
  } catch {
    throw new OpenArtifactError('not_found', 'That package is no longer waiting to be installed.', { fix: 'Choose it again.' });
  }
}

/** Drops a staged package once it is installed (or refused). */
export function unstagePackage(hash: string): void {
  if (!/^[0-9a-f]{64}$/.test(hash)) return;
  for (const ext of [TYPE_PACKAGE_EXTENSION, '.json']) rmSync(join(files.typesStaging(), `${hash}${ext}`), { force: true });
}

// ---- helpers --------------------------------------------------------------------------------------------------------

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Whether `dir` is inside the installed root. */
export function isInstalledDir(dir: string): boolean {
  const root = resolve(files.installedTypes());
  return resolve(dir).startsWith(root + sep);
}

/** The folder a package will land in. */
export const installedDirOf = (id: string): string => join(files.installedTypes(), id);

/**
 * The capabilities a type's `index.html` declares, read as literal data (never run); none for a type without one, or
 * whose declaration is not literal data (`types check` names that).
 */
export function typeCapabilities(dir: string): string[] {
  try {
    const decl = readStaticDeclaration(readFileSync(join(dir, 'index.html'), 'utf8'));
    return decl ? Object.keys(decl.capabilities) : [];
  } catch {
    return [];
  }
}

// ---- where a type comes from, and which artifacts it may open ---------------------------------------------------------

/** Where a listed type comes from ({@link TypeSourceKind}), with the address an installed one came from. */
export function typeSourceOf(type: Pick<TypeInfo, 'id' | 'scope'>): { source: TypeSourceKind; installedFrom?: string } {
  if (type.scope === 'builtin') return { source: 'builtin' };
  if (type.scope !== 'installed') return { source: 'local' };
  const entry = installedEntry(type.id);
  return { source: 'installed', ...(entry ? { installedFrom: entry.source } : {}) };
}

/**
 * What `.artifact.json`'s `typeSource` records for an artifact made with `type` (it travels in the artifact's zip): the
 * address an installed type came from, or the name of the package file (never the path on this computer), else
 * `local` or `builtin`.
 */
export function markerSourceOf(type: Pick<TypeInfo, 'id' | 'scope'>): string {
  const { source, installedFrom } = typeSourceOf(type);
  if (!installedFrom) return source;
  return isAddress(installedFrom) ? installedFrom : basename(installedFrom);
}

/**
 * The refusal to open or write `record` with `type`: an artifact that recorded the uid of the type it was made with
 * (`typeUid`) is opened and written only by a type of that uid. No uid recorded: nothing is checked (and none is
 * written in after the fact). The same uid: fine. Another uid, or a type without one: `type_mismatch`.
 */
export function typeMismatch(record: Pick<ArtifactRecord, 'id' | 'title' | 'type' | 'typeUid'>, type: Pick<TypeInfo, 'id' | 'uid' | 'scope' | 'dir'> | null): OpenArtifactError | null {
  if (!record.typeUid || !type) return null;
  if (type.uid === record.typeUid) return null;
  return new OpenArtifactError(
    'type_mismatch',
    `${record.title || record.id} was made with another type named ${record.type} (uid ${record.typeUid}); the ${type.scope} type ${type.id} here ${type.uid ? `is uid ${type.uid}` : 'has no uid'} (${type.dir}), so it is not opened or changed with it.`,
    { fix: `Install the type it was made with (open-artifact types install <its package>), or make the artifact again with this type.` },
  );
}
