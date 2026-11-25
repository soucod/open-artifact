/**
 * The Link outbox: what a user's linked agent is told, kept in the catalog's `outbox` until it acknowledges it.
 *
 * - `wake` rows are written by the rooms (`typeApi.wake`: comments and requests from a page) and by the Library's
 *   Ask (`artifacts.ask`).
 * - `data-refresh` rows are written by the rooms too ({@link queueDataRefresh}): someone on a published dashboard's
 *   page asked for its live data to be run again on the owner's computer. Like a wake, the row waits until a daemon
 *   acknowledges it, so a request made while none is online is honoured once one returns.
 * - `files` and `artifact` rows are written here, by {@link startLinkFeed}: a person's edit through a page
 *   (`artifact-touched`) and a rename, trash or restore (`artifact-changed`) of an artifact whose owner has a Link
 *   token. Changes the Link made itself (author `agent`) are not sent back to it.
 *
 * {@link linkEventOf} turns a row into the {@link LinkEvent} the `link.events` stream sends.
 */

import { DATA_REFRESH_EVENT, type ArtifactRole, type LinkEvent, type WakeRequestItem, type WakeThread } from '@open-artifact/protocol';
import { httpError } from '../http.ts';
import type { Catalog } from '../catalog/catalog.ts';
import type { HostEvents } from '../events.ts';
import type { OutboxRecord } from '../types.ts';
import { LINK_SCOPE } from './services.ts';

/** The author the Link's own changes carry (`files` pushes, imports, unpublish): never echoed to the Link. */
export const LINK_AUTHOR = 'agent';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** An outbox row as the event the Link stream sends, or null for a kind this version does not send. */
export function linkEventOf(row: OutboxRecord): LinkEvent | null {
  const id = String(row.id);
  const payload = isRecord(row.payload) ? row.payload : {};
  switch (row.kind) {
    case 'wake': {
      const from = isRecord(payload.from) && typeof payload.from.name === 'string' && typeof payload.from.role === 'string' ? { name: payload.from.name, role: payload.from.role as ArtifactRole } : undefined;
      return {
        id,
        type: 'wake',
        artifact: row.artifactId,
        ...(Array.isArray(payload.threads) ? { threads: payload.threads as WakeThread[] } : {}),
        ...(Array.isArray(payload.requests) ? { requests: payload.requests as Array<Omit<WakeRequestItem, 'id'> & { id?: string }> } : {}),
        ...(from ? { from } : {}),
      };
    }
    case 'files':
      return {
        id,
        type: 'files',
        artifact: row.artifactId,
        author: typeof payload.author === 'string' ? payload.author : '',
        paths: Array.isArray(payload.paths) ? payload.paths.filter((p): p is string => typeof p === 'string') : [],
        ...(typeof payload.title === 'string' ? { title: payload.title } : {}),
      };
    case 'artifact':
      return {
        id,
        type: 'artifact',
        artifact: row.artifactId,
        ...(typeof payload.title === 'string' ? { title: payload.title } : {}),
        ...(payload.removed === true ? { removed: true } : {}),
        ...(isRecord(payload.capabilities) ? { capabilities: payload.capabilities } : {}),
      };
    case DATA_REFRESH_EVENT: {
      const from = isRecord(payload.from) && typeof payload.from.name === 'string' && typeof payload.from.role === 'string' ? { name: payload.from.name, role: payload.from.role as ArtifactRole } : undefined;
      const queries = Array.isArray(payload.queries) ? payload.queries.filter((q): q is string => typeof q === 'string') : [];
      return { id, type: 'data-refresh', artifact: row.artifactId, ...(queries.length ? { queries } : {}), ...(from ? { from } : {}) };
    }
    default:
      return null;
  }
}

/** Who asks for a refresh, as a page's viewer is known. */
export interface DataRefreshAsker {
  name: string;
  role: ArtifactRole;
}

/**
 * Queues a published dashboard's live-data refresh for its owner's Link (a `data-refresh` row, which `link.events`
 * sends as {@link LinkEvent} `data-refresh`): the owner may always ask, an editor only while the owner lets editors ask
 * their agent (`editorsCanAskAgent`, read live), a commenter or viewer never. The host calls no connector. Returns the
 * owner's user id, for the caller to wake the stream (`outbox`) and say whether their Link is online.
 */
export async function queueDataRefresh(catalog: Catalog, artifactId: string, asker: DataRefreshAsker, queries?: readonly string[]): Promise<string> {
  const artifact = await catalog.getArtifact(artifactId);
  if (!artifact || artifact.trashedAt !== null) throw httpError('not_found', `No artifact ${artifactId}.`);
  if (artifact.type !== 'data') throw httpError('invalid_argument', 'Only a Data dashboard has live data to refresh.');
  if (asker.role !== 'owner' && !(asker.role === 'editor' && artifact.settings.editorsCanAskAgent))
    throw httpError('not_granted', 'Only the owner (or an editor the owner lets ask their agent) can refresh the live data.', { status: 403 });
  const asked = (queries ?? []).filter((q) => typeof q === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(q)).slice(0, 200);
  await catalog.appendOutbox({
    artifactId,
    toUser: artifact.ownerUser,
    kind: DATA_REFRESH_EVENT,
    payload: { ...(asked.length ? { queries: asked } : {}), ...(asker.role === 'owner' ? {} : { from: { name: asker.name, role: asker.role } }) },
  });
  return artifact.ownerUser;
}

/** Whether a user has an unrevoked Link token (only then are their artifacts' changes queued for a Link). */
async function isLinked(catalog: Catalog, userId: string): Promise<boolean> {
  return (await catalog.listAgentTokens(userId)).some((token) => token.revokedAt === null && token.scopes.includes(LINK_SCOPE));
}

/**
 * Queues `files` and `artifact` rows for the owners' Links as artifacts change (see the module comment); returns what
 * stops it. Each change is handled in the order heard.
 */
export function startLinkFeed(input: { catalog: Catalog; events: HostEvents; log?: (line: string) => void }): () => void {
  const { catalog, events } = input;
  const log = input.log ?? (() => undefined);
  let queue = Promise.resolve();
  const enqueue = (work: () => Promise<void>): void => {
    queue = queue.then(work).catch((error: unknown) => log(`link outbox: ${error instanceof Error ? error.message : String(error)}`));
  };
  const append = async (artifactId: string, kind: 'files' | 'artifact', payload: (artifact: { title: string; trashedAt: string | null }) => unknown): Promise<void> => {
    const artifact = await catalog.getArtifact(artifactId);
    if (!artifact || !(await isLinked(catalog, artifact.ownerUser))) return;
    await catalog.appendOutbox({ artifactId, toUser: artifact.ownerUser, kind, payload: payload(artifact) });
    events.emit('outbox', { userId: artifact.ownerUser });
  };
  const offTouched = events.on('artifact-touched', ({ id, author, paths, title }) => {
    if (author === LINK_AUTHOR || paths.length === 0) return;
    enqueue(() => append(id, 'files', () => ({ author, paths, ...(title ? { title } : {}) })));
  });
  const offChanged = events.on('artifact-changed', ({ id, author, capabilities }) => {
    if (author === LINK_AUTHOR) return;
    enqueue(() => append(id, 'artifact', (artifact) => (artifact.trashedAt !== null ? { removed: true } : { title: artifact.title, ...(capabilities ? { capabilities } : {}) })));
  });
  return () => {
    offTouched();
    offChanged();
  };
}
