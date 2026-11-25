/**
 * What the Link routes need from the platform (decision 12, 25): an artifact's files by archive path, packing and
 * unpacking an artifact folder, the embedded type server's actions, the page connections to drop after a sharing
 * change, which users have a Link connected, and the shared in-process events.
 *
 * The Node host fills it with `nodeLinkServices` (`node/link.ts`); tests may pass fakes.
 */

import type { LinkFile, LinkWrite, LinkWriteResult } from '@open-artifact/protocol';
import type { HostEvents } from '../events.ts';
import type { SiteTypeCandidate, SiteTypeRow } from '../catalog/site-types.ts';

/** The files of an artifact by archive path (the paths `archiveKeeps` allows), with sha256 etags. */
export interface ArtifactFiles {
  /** Every file an export zip would hold, path → etag and size. `not_found` when the artifact has no folder. */
  manifest(artifactId: string): Promise<Record<string, LinkFile>>;
  /** One file's bytes and etag, or null when there is no such file (or the path is not an archive path). */
  read(artifactId: string, path: string): Promise<{ bytes: Uint8Array; etag: string } | null>;
  /**
   * Each write is checked on its own (`if_match`: the etag expected, null = must not exist, undefined = no check).
   * Paths under `doc/` and `sheet/` are refused (the server is their only writer), as are `.artifact.json`,
   * `history/` (each server keeps its own version history), `_agent/`, paths an archive leaves out and paths that climb out: the whole request fails with
   * `invalid_argument` (or `too_large` past a path's size limit) before anything is written.
   */
  write(artifactId: string, writes: LinkWrite[], author: string): Promise<LinkWriteResult[]>;
}

/** Which users have a Link connected (the registry behind the rooms' `LinkPresence`). */
export interface LinkPresenceRegistry {
  /** A user's Link event stream opened. */
  connected(userId: string): void;
  /** One of a user's Link event streams closed. */
  disconnected(userId: string): void;
  /** Whether at least one of the user's Link event streams is open. */
  online(userId: string): boolean;
}

export interface LinkServices {
  files: ArtifactFiles;
  /**
   * Unpacks an archive into the new artifact's folder; answers its type and a title. Refuses (an `OpenArtifactError`)
   * anything that is not an artifact archive; `exists` (409) when the folder is there already.
   */
  importArchive(artifactId: string, bytes: Uint8Array): Promise<{ type: string; title: string }>;
  /**
   * Removes an artifact's folder for good, after closing it in the type server (its pages end). For a Link
   * re-publishing, under the same id, an artifact it unpublished (trashed): the catalog record is the caller's.
   */
  removeArtifact(artifactId: string): Promise<void>;
  /** The artifact's folder as a zip (as `AppServices.archive`). */
  archive(artifactId: string, method: 'GET' | 'HEAD'): Promise<Response>;
  /** Runs an action of the embedded type server on the artifact (`rooms.action`); its answer's JSON. */
  action(artifactId: string, name: string, args: Record<string, unknown>): Promise<unknown>;
  /**
   * The title the artifact's own files hold now (the file its type's `titleFrom` names), or undefined when they hold
   * none. A `link.files` push that changes it renames the artifact.
   */
  contentTitle(artifactId: string, type: string): Promise<string | undefined>;
  /** After the artifact's access changed (unpublished): drops the page connections that lost it. */
  refreshAccess(artifactId: string): Promise<void>;
  presence: LinkPresenceRegistry;
  events: HostEvents;
  /** The host's version (`link.hello`). */
  version: string;
  /**
   * Page artifacts, when this host runs them (`link.hello` says `features.pages`; the import takes them, and
   * `link.capabilities` sets what they declare). Absent: a page archive is refused as any unknown type is.
   */
  pages?: PageServices;
  /**
   * The site's type catalog, when this host runs published types (`link.hello` says `features.types`; the `types.*`
   * routes). Absent: those routes answer `unsupported`.
   */
  siteTypes?: SiteTypeServices;
}

/**
 * What a host keeps of a published type (`core/catalog/site-types.ts` keeps the rows): reading a package, its files
 * by uid and version, and running it. Nothing of a package runs on the host: its pages run on the content origin.
 */
export interface SiteTypeServices {
  /**
   * Reads and checks a package (what `types install` checks, and that it is a type a site runs: a page type, with
   * an `index.html` declaration and no server of its own); nothing is kept. Refuses with an `OpenArtifactError`.
   */
  read(bytes: Uint8Array): Promise<SiteTypeCandidate>;
  /** Keeps a checked package's bytes and unpacked files as `uid`'s `version` (replacing what that version had). */
  store(candidate: SiteTypeCandidate, bytes: Uint8Array): Promise<void>;
  /** The kept package of `uid`'s `version`, or null. */
  package(uid: string, version: string): Promise<Uint8Array | null>;
  /** Deletes the files of one version of `uid`, or all of them without `version`. */
  removeFiles(uid: string, version?: string): Promise<void>;
  /** The row changed (a new type, a new version, delisted or listed again): artifacts of it run what it says now. */
  activated(row: SiteTypeRow): Promise<void>;
  /** The row is gone (nothing used it). */
  removed(row: SiteTypeRow): Promise<void>;
}

/** What a host that runs page artifacts adds to the Link (and the site's MCP). */
export interface PageServices {
  /** A page artifact's declared capabilities (its `.artifact.json` block), or null when it is not a page here. */
  capabilities(artifactId: string): Promise<Record<string, unknown> | null>;
  /**
   * Replaces them (the whole block) and tells the open pages (they rewire); `author` other than the Link's sends the
   * change to the owner's Link (an `artifact` event with `capabilities`). Refuses a non-page with `invalid_argument`.
   */
  setCapabilities(artifactId: string, capabilities: Record<string, unknown>, author: string): Promise<void>;
}

/** The scope a Link token carries; every Link route requires it. */
export const LINK_SCOPE = 'link';
/** How long an access token lasts: 1 hour. */
export const LINK_ACCESS_TTL_MS = 3600_000;
/** How long a refresh token lasts from its last use: 90 days. */
export const LINK_REFRESH_TTL_MS = 90 * 24 * 3600_000;
/** How long a device sign-in may wait for the person: 10 minutes. */
export const LINK_DEVICE_TTL_MS = 10 * 60_000;
/** Seconds between polls of `link.token`. */
export const LINK_POLL_INTERVAL_SECONDS = 5;
/** The approval page on the app origin. */
export const LINK_DEVICE_PATH = '/link/device';
/** Largest request body a Link route takes (an import, or a `files` push with its base64 content). */
export const LINK_MAX_BODY_BYTES = 100 * 1024 * 1024;
/** Largest single file the host takes (the largest per-path limit of an import). */
export const LINK_MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Most writes in one `link.files` push, and most ids in one `link.ack`. */
export const LINK_MAX_WRITES = 1000;
/** Cap on the small JSON bodies (`device`, `token`, `call`, `ack`, `unpublish`). */
export const LINK_JSON_BYTES = 1024 * 1024;
