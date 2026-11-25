/**
 * What the app-origin routes need from the platform: the things the core cannot do itself (mint a page address
 * through the embedded type server, unpack or pack an artifact folder, read the built Shell and home page) plus the
 * shared in-process state (events, the access cache).
 *
 * The Node host fills it in `node/main.ts`; the tests pass fakes.
 */

import type { PrincipalRef } from '../authz/access.ts';
import type { AccessCache } from '../authz/access.ts';
import type { HostEvents } from '../events.ts';
import type { PluginDescription } from '../plugins/registry.ts';
import type { Ctx } from '../http.ts';
import type { ArtifactRole, ArtifactRow, Principal } from '../types.ts';

/** Cap on an uploaded artifact archive (`artifacts.import`) when the platform sets none. */
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;

export interface AppServices {
  events: HostEvents;
  /** The live role lookup (decision 15), configured with the same `groupsOf` as the rooms. */
  access: AccessCache;
  /** The page address the Shell frames for this principal (`url`, with the Shell parameter) and the bare page (`pageUrl`). */
  pageFor(artifact: ArtifactRow, principal: Principal, role: ArtifactRole): Promise<{ url: string; pageUrl: string }>;
  /** After a sharing change: drops the page connections whose holder's role moved. */
  refreshAccess(artifactId: string): Promise<void>;
  /** A known type's title, or null when the type is not installed. */
  typeInfo(type: string): { title: string } | null;
  /** The artifact's folder as a zip; `HEAD` answers the same headers (or 413 for a folder too big to zip) without zipping. */
  archive(artifactId: string, method: 'GET' | 'HEAD'): Promise<Response>;
  /**
   * Unpacks an uploaded archive into the new artifact's folder; answers its type and a title. Refuses (with an
   * `OpenArtifactError` or the type server's `HttpError`) anything that is not an artifact archive.
   */
  importArchive(artifactId: string, bytes: Uint8Array): Promise<{ type: string; title: string }>;
  /** The built Shell's `index.html`, with the boot placeholder in it. */
  shellHtml(): Promise<string>;
  /** The built home page's `index.html`, with the home boot placeholder in it. */
  homeHtml(): Promise<string>;
  /**
   * The principals that have a page of the artifact open now (for the Share panel's "online"). A platform whose pages
   * live elsewhere (Cloudflare: the artifact's object) answers asynchronously.
   */
  connected(artifactId: string): PrincipalRef[] | Promise<PrincipalRef[]>;
  /**
   * A file of the built Shell or home page under `/_open-artifact/…` (hashed assets cached for a year,
   * `index.html` never), or null when there is no such file.
   */
  uiFile(pathname: string, request: Request): Promise<Response | null>;
  /** The host's version. */
  version: string;
  /**
   * Deletes an artifact's bytes for good (its folder; on Cloudflare its object's storage), after closing its pages.
   * The catalog rows are the caller's. Without it `artifacts.purge` is not offered.
   */
  removeArtifact?(artifactId: string): Promise<void>;
  /**
   * Days an artifact stays in the trash before the upkeep deletes it for good (`OA_TRASH_DAYS`; 0: never), for the
   * home page's note. Left out: the page says nothing of a limit.
   */
  trashDays?: number;
  /**
   * Whether the user's linked computer is connected now (a Link stream is open), for the Ask pane's words. Left out:
   * never (a platform without Link).
   */
  linkOnline?(userId: string): boolean | Promise<boolean>;
  /**
   * Every plugin of the site's list, running or not (`GET /api/open-artifact.admin.plugins`). Left out: the site
   * has no plugin list.
   */
  pluginDescriptions?(): PluginDescription[];
  /** The largest uploaded archive the platform takes, for the home page to refuse a bigger one before uploading it. Default {@link IMPORT_MAX_BYTES}. */
  importMaxBytes?: number;
}

/** The context of an app-origin request. */
export type AppCtx = Ctx<AppServices>;
