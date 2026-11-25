/**
 * The site's type catalog: artifact types people published to the site (`open-artifact types publish`), one row per
 * type (its uid) holding its current version. Pure (a {@link SqlDriver} and a clock), so every host keeps the same
 * rules; where a type's files live is the host's business (`SiteTypeFiles`).
 *
 * The rules:
 * - The id is unique on the site. A built-in id, a reserved one and one that is not a type id are refused.
 * - A type is its uid. Publishing again with the same uid is a new version, which only its publisher or a site admin
 *   may publish; a package with another uid that takes a published id is refused, naming who has it.
 * - The same version again with other bytes is refused (raise the version); the same bytes again change nothing.
 *   Any other version string is the new current version: a site keeps one version, and artifacts run that one.
 * - Who may publish at all is `OA_TYPES_PUBLISH` ({@link mayPublishTypes}).
 * - `visibility` says who may list and download the package: `private` (its publisher and the site admins), `site`
 *   (any account on the site) or `link` (anyone naming it, while only the first two list it). It never gates running:
 *   whoever may open an artifact runs its type.
 * - Unpublishing a type that artifacts still use (trashed ones count) only delists it: it is no longer listed,
 *   downloaded or used by new artifacts, and its artifacts keep running. With none left, the row goes and the host
 *   deletes the files. Publishing a delisted type again lists it again.
 */

import { BUILTIN_TYPE_IDS, RESERVED_TYPE_IDS, TYPE_ID, type SiteTypeVisibility, type TypesPublishPolicy } from '@open-artifact/protocol';
import { httpError } from '../http.ts';
import type { SiteRole } from '../types.ts';
import type { SqlDriver } from './driver.ts';

export interface SiteTypeRow {
  uid: string;
  id: string;
  name: string;
  version: string;
  description: string;
  publisherUser: string;
  visibility: SiteTypeVisibility;
  sha256: string;
  bytes: number;
  capabilities: string[];
  network: string[];
  unpublished: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What a package says it is, read by the host before anything of it is kept. */
export interface SiteTypeCandidate {
  id: string;
  uid: string;
  name: string;
  version: string;
  description: string;
  sha256: string;
  bytes: number;
  capabilities: string[];
  network: string[];
}

export interface SiteTypeActor {
  id: string;
  siteRole: SiteRole;
}

/** What publishing a candidate would do. */
export type SiteTypePlan = { change: 'new' } | { change: 'version' | 'unchanged'; previous: SiteTypeRow };

/** A uid: what `types new` makes (a UUID) and anything else folder-safe. */
export const SITE_TYPE_UID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** A version string that can name a folder. */
export const SITE_TYPE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

interface Row {
  uid: string;
  id: string;
  name: string;
  version: string;
  description: string;
  publisher_user: string;
  visibility: string;
  sha256: string;
  bytes: number;
  capabilities: string;
  network: string;
  unpublished: number;
  created_at: string;
  updated_at: string;
}

const strings = (json: string): string[] => {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

const fromRow = (row: Row): SiteTypeRow => ({
  uid: row.uid,
  id: row.id,
  name: row.name,
  version: row.version,
  description: row.description,
  publisherUser: row.publisher_user,
  visibility: row.visibility === 'site' || row.visibility === 'link' ? row.visibility : 'private',
  sha256: row.sha256,
  bytes: Number(row.bytes),
  capabilities: strings(row.capabilities),
  network: strings(row.network),
  unpublished: Number(row.unpublished) === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Whether a person of this site role may publish types under `OA_TYPES_PUBLISH`. */
export function mayPublishTypes(policy: TypesPublishPolicy, role: SiteRole): boolean {
  return policy === 'members' || (policy === 'admins' && role === 'admin');
}

/** Why a person may not publish types, or null when they may. `sameSite` says the site runs on one domain. */
export function typesPublishRefusal(policy: TypesPublishPolicy, role: SiteRole, sameSite = false): string | null {
  if (mayPublishTypes(policy, role)) return null;
  if (sameSite) return 'This site runs its app and its artifact pages on one domain (OA_CONTENT_SAME_SITE=true), where page artifacts do not run, so it takes no published types.';
  if (policy === 'off') return 'This site does not take published types (OA_TYPES_PUBLISH=off).';
  return 'Only the site admins may publish types to this site (OA_TYPES_PUBLISH=admins).';
}

/** Whether `viewer` may list a type (`site` and their own; admins see all). Delisted types are listed only to those who may manage them. */
export function mayListSiteType(row: SiteTypeRow, viewer: SiteTypeActor): boolean {
  const manages = row.publisherUser === viewer.id || viewer.siteRole === 'admin';
  if (row.unpublished) return manages;
  return manages || row.visibility === 'site';
}

/** Whether `viewer` may download a type's package by naming it: what lists it, plus `link`. */
export function mayDownloadSiteType(row: SiteTypeRow, viewer: SiteTypeActor): boolean {
  if (mayListSiteType(row, viewer)) return true;
  return !row.unpublished && row.visibility === 'link';
}

/** Whether `actor` may publish a new version of, or unpublish, this type. */
export function managesSiteType(row: SiteTypeRow, actor: SiteTypeActor): boolean {
  return row.publisherUser === actor.id || actor.siteRole === 'admin';
}

export class SiteTypes {
  readonly #driver: SqlDriver;
  readonly #now: () => Date;

  constructor(driver: SqlDriver, now: () => Date = () => new Date()) {
    this.#driver = driver;
    this.#now = now;
  }

  async get(uid: string): Promise<SiteTypeRow | undefined> {
    const row = await this.#driver.get<Row>('SELECT * FROM types WHERE uid = ?', [uid]);
    return row ? fromRow(row) : undefined;
  }

  async byId(id: string): Promise<SiteTypeRow | undefined> {
    const row = await this.#driver.get<Row>('SELECT * FROM types WHERE id = ?', [id]);
    return row ? fromRow(row) : undefined;
  }

  /** Every type, delisted ones too, by id. */
  async all(): Promise<SiteTypeRow[]> {
    return (await this.#driver.all<Row>('SELECT * FROM types ORDER BY id')).map(fromRow);
  }

  /** How many artifacts (trashed ones too) are of this type. */
  async artifactCount(id: string): Promise<number> {
    return Number((await this.#driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM artifacts WHERE type = ?', [id]))?.n ?? 0);
  }

  /**
   * What publishing `candidate` as `actor` would do, or the refusal (an `OpenArtifactError`: `invalid_argument`,
   * `not_granted`, `conflict`). Writes nothing. `builtins` adds ids the host runs itself.
   */
  async plan(candidate: SiteTypeCandidate, actor: SiteTypeActor, builtins: readonly string[] = []): Promise<SiteTypePlan> {
    const { id, uid, version } = candidate;
    if (!TYPE_ID.test(id)) throw httpError('invalid_argument', `${JSON.stringify(id)} is not a type id: letters, digits, ".", "_" and "-", at most 64.`);
    if (BUILTIN_TYPE_IDS.includes(id) || builtins.includes(id)) throw httpError('invalid_argument', `${id} is a built-in type's id: a published type never takes one.`, { fix: 'Give the type another slug in its artifact-type.json.' });
    if (RESERVED_TYPE_IDS.includes(id)) throw httpError('invalid_argument', `${id} is reserved.`, { fix: 'Give the type another slug in its artifact-type.json.' });
    if (!SITE_TYPE_UID.test(uid)) throw httpError('invalid_argument', `The package's uid ${JSON.stringify(uid)} is not one a site keeps: letters, digits, ".", "_" and "-", at most 128.`);
    if (!SITE_TYPE_VERSION.test(version)) throw httpError('invalid_argument', `The package's version ${JSON.stringify(version)} is not one a site keeps: letters, digits, ".", "+", "_" and "-", at most 64.`);
    const taken = await this.byId(id);
    if (taken && taken.uid !== uid) {
      throw httpError('conflict', `The id ${id} is taken on this site by another type (uid ${taken.uid}), so this package (uid ${uid}) cannot be published under it.`, {
        fix: 'If this is a new version of that type, build it from the same type folder (its artifact-type.json keeps the uid); otherwise give the type another slug.',
      });
    }
    const previous = taken ?? (await this.get(uid));
    if (!previous) return { change: 'new' };
    if (!managesSiteType(previous, actor)) throw httpError('not_granted', `${previous.id} was published by someone else: only its publisher or a site admin may publish a new version.`);
    if (previous.id !== id) {
      throw httpError('conflict', `This type (uid ${uid}) is published on this site as ${previous.id}, not ${id}: a type keeps its id.`, { fix: `Publish it as ${previous.id}, or unpublish ${previous.id} first.` });
    }
    if (previous.version === version) {
      if (previous.sha256 === candidate.sha256) return { change: 'unchanged', previous };
      throw httpError('conflict', `Version ${version} of ${id} is already on this site with other contents.`, { fix: 'Raise the version in artifact-type.json, then publish again.' });
    }
    return { change: 'version', previous };
  }

  /** Writes the row for a planned publish (the files are already in place); answers it. */
  async save(candidate: SiteTypeCandidate, actor: SiteTypeActor, plan: SiteTypePlan, visibility?: SiteTypeVisibility): Promise<SiteTypeRow> {
    const now = this.#now().toISOString();
    const values = [
      candidate.name,
      candidate.version,
      candidate.description,
      candidate.sha256,
      candidate.bytes,
      JSON.stringify(candidate.capabilities),
      JSON.stringify(candidate.network),
    ];
    if (plan.change === 'new') {
      await this.#driver.run(
        'INSERT INTO types (uid, id, name, version, description, sha256, bytes, capabilities, network, publisher_user, visibility, unpublished, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
        [candidate.uid, candidate.id, ...values, actor.id, visibility ?? 'private', now, now],
      );
    } else {
      await this.#driver.run(
        'UPDATE types SET name = ?, version = ?, description = ?, sha256 = ?, bytes = ?, capabilities = ?, network = ?, visibility = ?, unpublished = 0, updated_at = ? WHERE uid = ?',
        [...values, visibility ?? plan.previous.visibility, plan.change === 'unchanged' && !plan.previous.unpublished && !visibility ? plan.previous.updatedAt : now, candidate.uid],
      );
    }
    return (await this.get(candidate.uid))!;
  }

  /** Delists a type: kept for the artifacts of it, no longer listed or used by new ones. */
  async delist(uid: string): Promise<void> {
    await this.#driver.run('UPDATE types SET unpublished = 1, updated_at = ? WHERE uid = ?', [this.#now().toISOString(), uid]);
  }

  async remove(uid: string): Promise<void> {
    await this.#driver.run('DELETE FROM types WHERE uid = ?', [uid]);
  }
}
