/**
 * `open-artifact import <zip>` and the `artifacts.import` route: an artifact archive (what `artifact.archive` and a
 * type's `/__open-artifact/archive` write) made into an artifact of this computer.
 *
 * The zip may come from anyone, so it is checked whole before a byte is written (`checkZip`: one top folder, plain
 * files, no `..`, absolute path, backslash, NUL or name given twice by case or Unicode form, the limits below on what it
 * declares and on what it inflates to), every path must be one an export carries (`archiveKeeps`), and it must hold the
 * `.artifact.json` an export writes. It opens only with a type of this computer that has the uid the marker records
 * (`typeUid`): none here is `type_missing`, naming the type's id, uid and where it came from. It unpacks into a dot
 * folder beside its new folder and is renamed into place once every file is written; a failure leaves nothing behind.
 * Nothing in the zip is run.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenArtifactError } from '@open-artifact/protocol';
import { archiveKeeps, checkZip, moveIntoPlace, unpackZip, unpackZipFile, ZipRefusal, type CheckedZipFile } from '@open-artifact/server-sdk/zip';
import type { ListedType, TypeRegistry } from './types.ts';

/** What an import takes: the zip's bytes (also the body cap of the route), its files, and what they unpack to. */
export const ARTIFACT_IMPORT_LIMITS = {
  /** The zip itself, bytes. */
  zipBytes: 512 * 1024 * 1024,
  /** Files, at most (what a plain zip holds). */
  files: 0xffff,
  /** Everything unpacked, bytes. */
  totalBytes: 2 * 1024 * 1024 * 1024,
  /** One file unpacked, bytes. */
  fileBytes: 256 * 1024 * 1024,
} as const;

/** The `.artifact.json` of an archive, as far as an import reads it. */
export interface ArchiveMarker {
  type: string;
  typeUid: string | null;
  typeSource: string | null;
  raw: Record<string, unknown>;
}

/** An archive read and checked, with the type of this computer that opens it. */
export interface ReadArchive {
  top: string;
  files: CheckedZipFile[];
  marker: ArchiveMarker;
  type: ListedType;
}

const bad = (message: string): OpenArtifactError => new OpenArtifactError('bad_archive', message);

/**
 * Reads and checks an artifact archive, and finds the type that opens it: one with the uid its marker records (the
 * one of the marker's id first, so a type installed with `--as` is found too), or for a marker without a uid the
 * visible type of its id.
 */
export async function readArtifactArchive(bytes: Uint8Array, source: string, o: { registry: TypeRegistry; workspace?: string | null }): Promise<ReadArchive> {
  if (bytes.byteLength > ARTIFACT_IMPORT_LIMITS.zipBytes) throw new OpenArtifactError('too_large', `${source} is larger than ${ARTIFACT_IMPORT_LIMITS.zipBytes} bytes.`, { status: 413 });
  let checked: ReturnType<typeof checkZip>;
  try {
    checked = checkZip(bytes, { noun: 'an artifact archive', maxFiles: ARTIFACT_IMPORT_LIMITS.files, maxBytes: ARTIFACT_IMPORT_LIMITS.totalBytes, maxFileBytes: ARTIFACT_IMPORT_LIMITS.fileBytes, folders: true });
  } catch (error) {
    if (error instanceof ZipRefusal) throw new OpenArtifactError(error.code === 'too_large' ? 'too_large' : 'bad_archive', `${source}: ${error.message}`, error.code === 'too_large' ? { status: 413 } : undefined);
    throw error;
  }
  const kept = checked.files.find((f) => !archiveKeeps(f.path));
  if (kept) throw bad(`${source}: ${kept.path} is not something an artifact's archive carries, so this is not one.`);
  const markerFile = checked.files.find((f) => f.path === '.artifact.json');
  if (!markerFile) throw new OpenArtifactError('bad_archive', `${source} has no .artifact.json in its folder ${checked.top}/: it is not an artifact's archive.`);
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse((await unpackZipFile(bytes, markerFile)).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object');
    raw = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ZipRefusal) throw bad(`${source}: ${error.message}`);
    throw bad(`${source}: its .artifact.json does not parse (${(error as Error).message}).`);
  }
  if (typeof raw.type !== 'string' || !raw.type) throw new OpenArtifactError('bad_archive', `${source}: its .artifact.json names no type.`);
  const typeUid = typeof raw.typeUid === 'string' && raw.typeUid ? raw.typeUid : null;
  const marker: ArchiveMarker = { type: raw.type, typeUid, typeSource: typeUid && typeof raw.typeSource === 'string' ? raw.typeSource : null, raw };
  const visible = o.registry.list(o.workspace ?? null);
  const type = typeUid
    ? (visible.find((t) => t.id === marker.type && t.uid === typeUid) ?? visible.find((t) => t.uid === typeUid))
    : visible.find((t) => t.id === marker.type);
  if (!type) {
    const from = marker.typeSource && marker.typeSource !== 'local' && marker.typeSource !== 'builtin' ? marker.typeSource : null;
    const address = from && /^https?:\/\//i.test(from) ? from : null;
    throw new OpenArtifactError(
      'type_missing',
      `${source} was made with the type ${marker.type}${typeUid ? ` (uid ${typeUid})` : ''}${marker.typeSource ? `, from ${marker.typeSource}` : ''}, and no type here ${typeUid ? 'has that uid' : 'has that id'}.`,
      {
        fix: address
          ? `Install that type first (open-artifact types install ${address}), then import it again.`
          : from
            ? `Install that type's package (${from}) first with open-artifact types install, then import it again.`
            : 'Get that type from whoever made the artifact (its .oatype package), install it, then import it again.',
      },
    );
  }
  return { top: checked.top, files: checked.files, marker, type };
}

/**
 * Unpacks a read archive into `dest` (which must not exist): into a dot folder beside it first, its marker naming the
 * type that opens it here and no artifact id (a new one is given when it is added), then renamed into place.
 */
export async function unpackArtifactArchive(bytes: Uint8Array, read: ReadArchive, dest: string): Promise<{ root: string; files: number; bytes: number }> {
  let unpacked: Awaited<ReturnType<typeof unpackZip>>;
  try {
    unpacked = await unpackZip(bytes, read.files, dest, ARTIFACT_IMPORT_LIMITS.totalBytes);
  } catch (error) {
    if (error instanceof ZipRefusal) throw new OpenArtifactError(error.code === 'too_large' ? 'too_large' : 'bad_archive', error.message);
    throw error;
  }
  try {
    const file = join(unpacked.temp, '.artifact.json');
    const { id: _id, ...rest } = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    rmSync(file, { force: true });
    writeFileSync(file, `${JSON.stringify({ ...rest, type: read.type.id }, null, 2)}\n`, { flag: 'wx' });
    await moveIntoPlace(unpacked.temp, dest);
  } catch (error) {
    rmSync(unpacked.temp, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new OpenArtifactError('conflict', `${dest} exists already.`);
    throw error;
  }
  return { root: dest, files: unpacked.files, bytes: unpacked.bytes };
}
