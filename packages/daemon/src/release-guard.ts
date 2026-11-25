/**
 * Artifacts written by a newer type release than the one installed here (design 16).
 *
 * `ArtifactRecord.typeRelease` (and `.artifact.json`'s `release`) is the type version that last wrote an artifact.
 * When this runtime's type is older, the artifact is opened read-only for the agent: its reads and opens carry
 * `read_only: true` and a note, and its writes (`Artifact publish` with a `url`, `Artifact call`, the write actions of
 * `ArtifactData`) are refused with `newer_release`, telling the person to update. An older format is never written
 * over a newer one. After a write by a newer type than the one recorded, the record says that newer release.
 *
 * Pages: the Library's `ArtifactView`, the Shell boot and the Type API's `artifact` answer carry the same state
 * ({@link releaseView}: `read_only`, `type_release`, `type_version`). The Shell shows a line saying how to update; the
 * built-in type server asks the daemon at each open and serves such an artifact with every role turned `viewer`, the
 * role a share-link viewer has, so its page routes and sockets refuse writes as they do a viewer's.
 *
 * Comments are not guarded: `ArtifactComments` (read, reply, resolve, reopen) stays allowed on such an artifact. The
 * comment format is the platform's, not the type's: `comments.json`, kept by `@open-artifact/server-sdk`'s
 * `CommentStore` the same way for every type, and versioned with the runtime rather than the type release. A newer
 * type release does not change it, so an older one writing a reply cannot damage what the newer one wrote; and the
 * agent's comment writes never place an anchor in the type's content (only a page starts an anchored thread). The
 * person can still be answered while the artifact waits for the update. (On the page, comment writes follow the
 * viewer role and are off.)
 */

import { join } from 'node:path';
import { actionKindOf, type ArtifactRecord, type SessionRef, type ToolCallResult, type ToolName } from '@open-artifact/protocol';
import { compareVersions, parseVersion } from '@open-artifact/harness-kit';
import { readJson, writeJson } from './paths.ts';

/** What the guard needs from the daemon. */
export interface ReleaseGuardOptions {
  /** The artifact a url or id names, or `null`. */
  record: (urlOrId: unknown) => ArtifactRecord | null;
  /** The installed version of the artifact's type, or `null` when unknown. */
  typeVersion: (record: ArtifactRecord) => string | null;
  /** Records a newer release on the artifact (keeping its `updatedAt`). */
  setRelease: (record: ArtifactRecord, release: string) => void;
  /**
   * The refusal to open or write the artifact with the type installed here (`type_mismatch`: it recorded another type
   * uid, `type-packages.ts`), or `null`. Writes and opens are refused with it; reads carry it as a note.
   */
  typeMismatch?: (record: ArtifactRecord) => NonNullable<ToolCallResult['error']> | null;
}

/** The release that last wrote the artifact: the newer of its record's and its folder marker's. */
export function writtenRelease(record: ArtifactRecord): string | null {
  const marker = readJson<{ release?: unknown } | null>(join(record.root, '.artifact.json'), null);
  const candidates = [record.typeRelease, typeof marker?.release === 'string' ? marker.release : null].filter((v): v is string => !!v && !!parseVersion(v));
  return candidates.sort((a, b) => compareVersions(b, a))[0] ?? null;
}

/** Whether `written` is a newer release than `installed` (both versions); unknown versions never block. */
export function isNewerRelease(written: string | null, installed: string | null): boolean {
  return !!written && !!installed && !!parseVersion(written) && !!parseVersion(installed) && compareVersions(written, installed) > 0;
}

/** The refusal of a write on an artifact of a newer release. */
export function newerReleaseError(record: ArtifactRecord, written: string, installed: string): NonNullable<ToolCallResult['error']> {
  return {
    code: 'newer_release',
    message: `${record.title || record.id} was written by ${record.type} ${written}; this computer has ${record.type} ${installed}, so it is read-only here and was not changed.`,
    fix: 'Tell the person to update Open Artifact (open-artifact runtime update, or update the app it came with), then try again.',
  };
}

/** What the Library, the Shell boot and the Type API say of an artifact's release (see the header). */
export function releaseView(record: ArtifactRecord, installed: string | null): { read_only: boolean; type_release: string | null; type_version: string | null } {
  const written = writtenRelease(record);
  return { read_only: isNewerRelease(written, installed), type_release: written, type_version: installed };
}

/** The note on reads of such an artifact. */
function readOnlyNote(record: ArtifactRecord, written: string, installed: string): string {
  return `Read-only here: ${record.type} ${written} wrote this artifact and this computer has ${installed}. Do not try to change it; tell the person to update Open Artifact (open-artifact runtime update).`;
}

/** Records the newer release in the artifact's folder marker too. */
export function writeMarkerRelease(record: ArtifactRecord, release: string): void {
  const file = join(record.root, '.artifact.json');
  const marker = readJson<Record<string, unknown> | null>(file, null);
  if (marker && marker.release !== release) writeJson(file, { ...marker, release });
}

/** Wraps the tools' `call` with the release check. */
export class ReleaseGuard {
  private readonly options: ReleaseGuardOptions;

  constructor(options: ReleaseGuardOptions) {
    this.options = options;
  }

  /** The artifact a call is about, when it names one. */
  private recordOf(args: Record<string, unknown>): ArtifactRecord | null {
    if (typeof args.url !== 'string' || !args.url) return null;
    try {
      return this.options.record(args.url);
    } catch {
      return null;
    }
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    caller: Partial<SessionRef> | null | undefined,
    next: (name: string, args: Record<string, unknown>, caller: Partial<SessionRef> | null | undefined) => Promise<ToolCallResult>,
  ): Promise<ToolCallResult> {
    const input = args && typeof args === 'object' ? args : {};
    const kind = name === 'Artifact' || name === 'ArtifactData' ? actionKindOf(name as ToolName, typeof input.action === 'string' ? input.action : undefined) : null;
    const record = kind === 'write' || kind === 'read' || kind === 'ui' ? this.recordOf(input) : null;
    if (!record) return next(name, args, caller);
    const mismatch = this.options.typeMismatch?.(record) ?? null;
    if (mismatch) {
      if (kind === 'write' || kind === 'ui') return { error: mismatch };
      const result = await next(name, args, caller);
      if (result.error) return result;
      return { ...result, notes: [...(Array.isArray(result.notes) ? result.notes : []), `${mismatch.message} Do not try to change it.`] };
    }
    const installed = this.options.typeVersion(record);
    const written = writtenRelease(record);
    if (isNewerRelease(written, installed)) {
      if (kind === 'write') return { error: newerReleaseError(record, written!, installed!) };
      const result = await next(name, args, caller);
      if (result.error) return result;
      return { ...result, read_only: true, notes: [...(Array.isArray(result.notes) ? result.notes : []), readOnlyNote(record, written!, installed!)] };
    }
    const result = await next(name, args, caller);
    // A newer type wrote it: the record says so, so an older runtime elsewhere will not write over it.
    if (kind === 'write' && !result.error && installed && parseVersion(installed) && (!written || compareVersions(installed, written) > 0)) {
      const now = this.options.record(record.id);
      if (now) this.options.setRelease(now, installed);
    }
    return result;
  }
}
