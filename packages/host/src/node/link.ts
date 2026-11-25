/**
 * The Node host's {@link LinkServices}: artifact files over the data folder, imports through the type server's
 * archive reader, actions through the embedded type server (`rooms.action`), and the presence registry the rooms
 * consult (`createRooms({linkPresence})`) so pages show the owner's agent online while a Link stream is open.
 *
 * Wiring (in `startHost`):
 *
 * ```ts
 * const linkPresence = createLinkPresence();
 * const rooms = await createRooms({ …, linkPresence });
 * const link = nodeLinkServices({ rooms, catalog, events, presence: linkPresence, archive: services.archive, version, log });
 * linkApiRoutes(router, link);
 * // on stop: link.stop()
 * ```
 */

import { lstat, rm, unlink } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { isTypeName, readArtifactTitle } from '@open-artifact/type-server';

import type { Catalog } from '../core/catalog/catalog.ts';
import type { HostEvents } from '../core/events.ts';
import { startLinkFeed } from '../core/link/outbox.ts';
import { LinkPresenceCounter } from '../core/link/presence.ts';
import type { LinkServices } from '../core/link/services.ts';
import { createArtifactFiles } from './files.ts';
import { importInto } from './host.ts';
import type { HostRooms } from './rooms.ts';
import { PAGE_TYPE, pageServices, pageTitleOf, type FrameEngine } from './frames.ts';

/** A presence registry for the Link streams; pass it to `createRooms` as `linkPresence` and to {@link nodeLinkServices}. */
export function createLinkPresence(options: { onChange?: (userId: string, online: boolean) => void } = {}): LinkPresenceCounter {
  return new LinkPresenceCounter(options);
}

/**
 * Deletes an artifact's folder for good (`<dataDir>/artifacts/<id>`, nothing else): the type server closes the artifact
 * first, so no page, store or watcher writes into the folder while it goes. `rootOf` refuses anything but an artifact
 * id, so the path cannot leave the artifacts folder; a folder replaced by a symbolic link loses only the link, never
 * what it points at. A folder already gone is not an error.
 */
export async function removeArtifactFolder(rooms: Pick<HostRooms, 'rootOf' | 'internal'> & { frames?: HostRooms['frames'] }, id: string): Promise<void> {
  const root = rooms.rootOf(id);
  if (basename(root) !== id || basename(dirname(root)) !== 'artifacts') throw new Error(`Not an artifact folder: ${root}`);
  await (await rooms.internal('close', { method: 'POST', body: { id } })).body?.cancel();
  await rooms.frames?.forget(id);
  let entry;
  try {
    entry = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) await unlink(root);
  else await rm(root, { recursive: true, force: true });
}

/** The Link services over the rooms; `stop` ends the outbox feed of people's edits. */
export function nodeLinkServices(input: {
  rooms: Pick<HostRooms, 'rootOf' | 'action' | 'refresh' | 'internal'> & { frames?: HostRooms['frames']; siteTypes?: HostRooms['siteTypes'] };
  catalog: Catalog;
  events: HostEvents;
  presence: LinkPresenceCounter;
  /** The export zip (`nodeServices(…).archive`). */
  archive: LinkServices['archive'];
  version: string;
  log?: (line: string) => void;
}): LinkServices & { stop(): void } {
  const { rooms, catalog, events } = input;
  const stopFeed = startLinkFeed({ catalog, events, ...(input.log ? { log: input.log } : {}) });
  return {
    files: createArtifactFiles((id) => rooms.rootOf(id), { afterWrite: (id, paths) => rooms.frames?.noteChanges(id, paths) }),
    importArchive: (id, bytes) => importInto(rooms.rootOf(id), id, bytes, { pages: !!rooms.frames, siteTypes: rooms.siteTypes ?? null }),
    removeArtifact: (id) => removeArtifactFolder(rooms, id),
    archive: input.archive,
    action: (id, name, args) => rooms.action(id, name, args),
    contentTitle: async (id, type) =>
      isTypeName(type)
        ? (await readArtifactTitle(rooms.rootOf(id), type))?.trim().slice(0, 200) || undefined
        : type === PAGE_TYPE
          ? await pageTitleOf(rooms.rootOf(id))
          : await rooms.siteTypes?.contentTitle(type, rooms.rootOf(id)),
    ...(rooms.frames ? { pages: pageServices(rooms as Pick<HostRooms, 'rootOf'> & { frames: FrameEngine }, events, catalog) } : {}),
    ...(rooms.frames && rooms.siteTypes ? { siteTypes: rooms.siteTypes.services((type) => rooms.frames?.typeChanged(type)) } : {}),
    refreshAccess: (id) => rooms.refresh(id),
    presence: input.presence,
    events,
    version: input.version,
    stop: stopFeed,
  };
}
