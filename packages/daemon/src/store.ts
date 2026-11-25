/**
 * The artifact library: one record per artifact in
 * `<open-artifact home>/artifacts/<id>.json` (protocol `ArtifactRecord`), and a
 * `.artifact.json` marker in each artifact folder.
 */

import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ARTIFACT_ID,
  OpenArtifactError,
  artifactIdOf,
  sessionKey,
  type ArtifactMarker,
  type ArtifactRecord,
  type SessionRef,
} from '@open-artifact/protocol';
import { ensureDir, files, readJson, writeJson } from './paths.ts';

/** A new artifact id: `art_` + base36 time + 16 random hex digits. */
export function newArtifactId(): string {
  const time = Date.now().toString(36).padStart(9, '0');
  return `art_${time}${randomBytes(8).toString('hex')}`;
}

/** A folder name from a title: lower case, ASCII letters, digits and CJK, dashes between. */
export function slugify(text: unknown): string {
  const slug = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'artifact';
}

/** The first 12 hex digits of the SHA-1 of the resolved workspace path. */
export function hashWorkspace(workspace: string): string {
  return createHash('sha1').update(resolve(workspace)).digest('hex').slice(0, 12);
}

/** The string form of a Session Ref (protocol `sessionKey` with this platform's hash). */
export function sessionKeyOf(ref: Partial<SessionRef> | null | undefined): string | null {
  return sessionKey(ref, hashWorkspace);
}

/** What {@link ArtifactStore} emits as `changed`: a record, or a removed one. */
export type StoreChange = ArtifactRecord & { removed?: boolean };

/** Most files {@link userEditsAfter} keeps. */
const MAX_USER_EDITS = 200;

/**
 * A record's `userEdits` after people changed `paths` at `at`: entries the
 * agent has seen since are dropped, the newest {@link MAX_USER_EDITS} kept.
 */
export function userEditsAfter(record: ArtifactRecord, paths: string[], at: string): Record<string, string> {
  const seen = record.agentSeenAt ?? '';
  const edits = Object.entries(record.userEdits ?? {}).filter(([, when]) => typeof when === 'string' && when > seen);
  const changed = new Set(paths);
  const merged = [...edits.filter(([path]) => !changed.has(path)), ...paths.map((path): [string, string] => [path, at])];
  merged.sort((a, b) => b[1].localeCompare(a[1]));
  return Object.fromEntries(merged.slice(0, MAX_USER_EDITS));
}

/** The files people changed since the agent last read or wrote the artifact, newest first. */
export function changedFiles(record: ArtifactRecord): string[] {
  const seen = record.agentSeenAt ?? '';
  return Object.entries(record.userEdits ?? {})
    .filter(([, when]) => typeof when === 'string' && when > seen)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([path]) => path);
}

/** Fields of a new record. */
export interface CreateRecord {
  root: string;
  type: string;
  typeSource?: string | null;
  typeRelease?: string | null;
  /** The `uid` of the type it is made with ({@link ArtifactRecord.typeUid}); also in `.artifact.json`. */
  typeUid?: string | null;
  /** Where that type came from, for `.artifact.json` (`builtin`, `local`, or an installed type's address). */
  typeFrom?: string | null;
  owner?: SessionRef | null;
  title?: string;
  /** A page artifact's declared capabilities ({@link ArtifactRecord.capabilities}). */
  capabilities?: Record<string, unknown> | null;
}

/** The records of every artifact. Emits `changed` after each write. */
export class ArtifactStore extends EventEmitter<{ changed: [StoreChange] }> {
  constructor() {
    super();
    ensureDir(files.artifacts());
  }

  /** The record file of an id. */
  fileOf(id: string): string {
    return join(files.artifacts(), `${id}.json`);
  }

  /** The record of an id, or `null`. */
  get(id: string | null | undefined): ArtifactRecord | null {
    if (!id || !ARTIFACT_ID.test(id)) return null;
    return readJson<ArtifactRecord | null>(this.fileOf(id), null);
  }

  /** The record of a url or id; throws `not_found`. */
  require(urlOrId: unknown): ArtifactRecord {
    const id = artifactIdOf(urlOrId);
    const record = id ? this.get(id) : null;
    if (!record) {
      throw new OpenArtifactError('not_found', `No artifact ${JSON.stringify(urlOrId)}.`, {
        fix: 'Use the url Artifact returned when it was made (open-artifact://artifact/<id>).',
      });
    }
    return record;
  }

  /** Every record, pinned first, then the most recently updated. */
  list(): ArtifactRecord[] {
    let names: string[];
    try {
      names = readdirSync(files.artifacts());
    } catch {
      return [];
    }
    const out: ArtifactRecord[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const record = readJson<ArtifactRecord | null>(join(files.artifacts(), name), null);
      if (record?.id) out.push(record);
    }
    return out.sort(
      (a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '') || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
    );
  }

  /** The record whose folder is `root`, or `null`. */
  byRoot(root: string): ArtifactRecord | null {
    const wanted = resolve(root);
    return this.list().find((a) => resolve(a.root) === wanted) ?? null;
  }

  /** Writes a record and emits `changed`. */
  save(record: ArtifactRecord): ArtifactRecord {
    writeJson(this.fileOf(record.id), record);
    this.emit('changed', record);
    return record;
  }

  /** Makes a new record, its folder and the folder's `.artifact.json` marker. */
  create(fields: CreateRecord): ArtifactRecord {
    const now = new Date().toISOString();
    const owner = fields.owner ?? null;
    const record: ArtifactRecord = {
      id: newArtifactId(),
      root: resolve(fields.root),
      type: fields.type,
      typeSource: fields.typeSource ?? null,
      typeRelease: fields.typeRelease ?? null,
      owner,
      createdBy: owner ? { harness: owner.harness, session: owner.session } : null,
      title: fields.title || 'Untitled',
      createdAt: now,
      updatedAt: now,
      pinnedAt: null,
      openedAt: null,
      agentSeenAt: now,
      lastUserEditAt: null,
      ...(fields.typeUid ? { typeUid: fields.typeUid } : {}),
      ...(fields.capabilities ? { capabilities: fields.capabilities } : {}),
    };
    ensureDir(record.root);
    const marker: ArtifactMarker = {
      type: record.type,
      id: record.id,
      release: record.typeRelease,
      ...(fields.typeUid ? { typeUid: fields.typeUid } : {}),
      ...(fields.typeUid && fields.typeFrom ? { typeSource: fields.typeFrom } : {}),
      ...(fields.capabilities ? { capabilities: fields.capabilities } : {}),
    };
    writeJson(join(record.root, '.artifact.json'), marker);
    return this.save(record);
  }

  /**
   * Sets a page artifact's declared capabilities, in its record and in its folder's `.artifact.json` (what frame-host
   * reads); `null` clears them. The marker's other fields stay as they are.
   */
  setCapabilities(id: string, capabilities: Record<string, unknown> | null): ArtifactRecord {
    const record = this.get(id);
    if (!record) throw new OpenArtifactError('not_found', `No artifact ${id}.`);
    const file = join(record.root, '.artifact.json');
    const marker = readJson<Record<string, unknown> | null>(file, null) ?? { type: record.type, id: record.id, release: record.typeRelease };
    const { capabilities: _old, ...rest } = marker;
    writeJson(file, capabilities ? { ...rest, capabilities } : rest);
    const { capabilities: _was, ...kept } = record;
    return this.save({ ...kept, ...(capabilities ? { capabilities } : {}), updatedAt: new Date().toISOString() });
  }

  /** Merges `patch` into a record; `updatedAt` moves unless the patch sets it. */
  update(id: string, patch: Partial<ArtifactRecord>): ArtifactRecord {
    const record = this.get(id);
    if (!record) throw new OpenArtifactError('not_found', `No artifact ${id}.`);
    return this.save({ ...record, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() });
  }

  /** Puts back a record {@link remove} took out of the list (Undo). */
  restore(id: string | null | undefined): ArtifactRecord | null {
    if (!id || !ARTIFACT_ID.test(id)) return null;
    const from = join(files.trash(), `${id}.json`);
    if (!existsSync(from)) return null;
    renameSync(from, this.fileOf(id));
    const record = this.get(id);
    if (record) this.emit('changed', record);
    return record;
  }

  /** Forgets a record (to the trash); the folder stays where it is, it is the person's. */
  remove(id: string): boolean {
    const record = this.get(id);
    if (!record) return false;
    const trash = ensureDir(files.trash());
    renameSync(this.fileOf(id), join(trash, `${id}.json`));
    this.emit('changed', { ...record, removed: true });
    return true;
  }
}
