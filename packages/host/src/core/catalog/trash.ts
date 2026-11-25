/**
 * Permanent deletion of trashed artifacts: by their owner (`artifacts.purge`) and on a timer, once they have been in
 * the trash `OA_TRASH_DAYS` days (default {@link DEFAULT_TRASH_DAYS}; `0` keeps them until their owner purges them).
 * The catalog rows go after the platform has deleted the bytes (`removeArtifact`), so a failed deletion is retried.
 */

import { ConfigError } from '../config.ts';
import type { Catalog } from './catalog.ts';
import type { ArtifactRow } from '../types.ts';

/** Days an artifact stays in the trash before the upkeep deletes it for good. */
export const DEFAULT_TRASH_DAYS = 30;
/** Most artifacts one upkeep run deletes (the next run takes the rest). */
export const TRASH_PURGE_BATCH = 50;

/** `OA_TRASH_DAYS`: whole days from 0 (never purge on a timer) to 3650; default {@link DEFAULT_TRASH_DAYS}. */
export function parseTrashDays(env: Record<string, string | undefined>): number {
  const text = env.OA_TRASH_DAYS?.trim();
  if (!text) return DEFAULT_TRASH_DAYS;
  const days = Number(text);
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new ConfigError('OA_TRASH_DAYS', `must be a whole number of days from 0 to 3650 (0: never purge on a timer), not ${text}.`);
  return days;
}

/**
 * Deletes one trashed artifact for good: its bytes (`removeArtifact`), then its catalog rows, with an audit entry.
 * The caller has checked who may.
 */
export async function purgeArtifact(
  catalog: Catalog,
  removeArtifact: (id: string) => Promise<void>,
  input: { id: string; actor: { kind: 'user' | 'system'; id?: string }; reason: 'owner' | 'expired' },
): Promise<void> {
  const artifact = await catalog.getArtifact(input.id);
  if (!artifact) return;
  await removeArtifact(input.id);
  await catalog.deleteArtifact(input.id);
  await catalog.appendAudit({
    actorKind: input.actor.kind,
    ...(input.actor.id ? { actorId: input.actor.id } : {}),
    artifactId: input.id,
    action: 'artifact.purge',
    detail: { reason: input.reason, title: artifact.title, type: artifact.type, owner: artifact.ownerUser, trashedAt: artifact.trashedAt },
  });
}

/**
 * Deletes the artifacts trashed more than `days` days ago (at most {@link TRASH_PURGE_BATCH} a run); answers how many
 * went. `days` 0 does nothing. One that fails is logged and left for the next run. `onPurged` hears each one deleted
 * (the hosts tell the plugins: `artifact.deleted`, reason `expired`).
 */
export async function purgeExpiredTrash(
  catalog: Catalog,
  removeArtifact: (id: string) => Promise<void>,
  options: { days: number; now?: Date; log?: (line: string) => void; limit?: number; onPurged?: (artifact: ArtifactRow) => void },
): Promise<number> {
  if (!(options.days > 0)) return 0;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.days * 24 * 3600_000).toISOString();
  let purged = 0;
  for (const artifact of await catalog.listTrashedBefore(cutoff, options.limit ?? TRASH_PURGE_BATCH)) {
    try {
      await purgeArtifact(catalog, removeArtifact, { id: artifact.id, actor: { kind: 'system' }, reason: 'expired' });
      purged++;
      options.onPurged?.(artifact);
    } catch (error) {
      options.log?.(`trash: deleting ${artifact.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return purged;
}
