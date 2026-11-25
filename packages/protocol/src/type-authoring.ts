/**
 * Making a type: what `open-artifact types new | check | from` and the `types.*` Library API routes take and answer,
 * and the rules `types check` applies that need no file system (the daemon walks the folder).
 *
 * Platform neutral: no Node or DOM APIs.
 */

import { FRAME_BACKED_CAPABILITIES, FRAME_STUBBED_CAPABILITIES } from './page-capabilities.ts';
import type { TypeScope } from './manifest.ts';
import type { LinkTypeImportResult, LinkTypeUnpublishResult, SiteTypeVisibility } from './link.ts';
import { manifestPackageProblems, TYPE_PACKAGE_LIMITS, TYPE_PACKAGE_REQUIRED } from './type-package.ts';

/** The starters `types new` writes: `page` keeps the content in files beside the page, `data` in its `db`. */
export const TYPE_TEMPLATES = ['page', 'data'] as const;
export type TypeTemplate = (typeof TYPE_TEMPLATES)[number];

/** Where `types new` and `types from` may write a type. */
export type AuthoringScope = Extract<TypeScope, 'user' | 'project'>;

/** Ids no type may take: `/open-artifact new-type` is the guide to making one. */
export const RESERVED_TYPE_IDS: readonly string[] = Object.freeze(['new-type']);

/** Type ids the built-in root may provide in this release: no installed, project or site-published type takes one. */
export const BUILTIN_TYPE_IDS: readonly string[] = Object.freeze(['design', 'design-system', 'whiteboard', 'slides', 'data', 'sheets', 'docs', 'motion', 'page']);

/** Limits on a type folder meant to be shared (`types check --for-share`): the package limits (`type-package.ts`). */
export const TYPE_SHARE_LIMITS = TYPE_PACKAGE_LIMITS;

/** Manifest fields a type to share must have (`type-package.ts`). */
export const TYPE_SHARE_REQUIRED = TYPE_PACKAGE_REQUIRED;

/** One finding of `types check`. */
export interface TypeCheckProblem {
  level: 'error' | 'warning';
  /** A stable name for the rule, e.g. `capability_unknown`. */
  code: string;
  message: string;
  /** The file it is about, relative to the type folder. */
  file?: string;
}

/** `open-artifact types check` / `POST /api/open-artifact.types.check`. */
export interface TypeCheckResult {
  ok: boolean;
  id: string;
  dir: string;
  forShare: boolean;
  errors: TypeCheckProblem[];
  warnings: TypeCheckProblem[];
  /** The capabilities the declaration names, by how this computer serves them. */
  capabilities?: { backed: string[]; stubbed: string[]; unknown: string[] };
}

/** `POST /api/open-artifact.types.new`. */
export interface TypesNewRequest {
  id: string;
  /** Default `user`. */
  scope?: AuthoringScope;
  /** Default `page`. */
  template?: TypeTemplate;
  /** Display name; defaults to the id in title case. */
  name?: string;
  /** The project root for `scope: "project"` (default: the daemon's working directory). */
  project?: string;
}

/** `types.new` and `types.from` answer. */
export interface TypesNewResponse {
  id: string;
  uid: string;
  scope: AuthoringScope;
  dir: string;
  files: string[];
  /** The type's check right after it was written. */
  check: TypeCheckResult;
  /** A short prompt the person can give their agent to build the type out. */
  prompt: string;
}

/** `POST /api/open-artifact.types.from`. */
export interface TypesFromRequest {
  /** A `page` artifact: its id or URL. Either this or {@link path}. */
  artifact?: string;
  /**
   * A page saved from elsewhere (claude.ai, say), as an absolute path: a folder with `index.html` (and optionally
   * `metadata.json` and an icon), or an `.html` file. Only with the daemon's token (the command line), never from a page.
   */
  path?: string;
  id: string;
  scope?: AuthoringScope;
  name?: string;
  project?: string;
}

/** The capabilities `types from <path>` found the page using, by name in its literal `use('…')` calls. */
export interface TypesFromCapabilities {
  /** Declared in the new type: names Open Artifact knows (backed, or stubbed here). */
  inferred: string[];
  /** Of those, the ones that answer only an error on this computer (mcp, sample, tts, paste). */
  stubbed: string[];
  /** Names the page uses that Open Artifact does not know: not declared. */
  unknown: string[];
  /** The page declared its capabilities itself: they are kept, and nothing was inferred. */
  declared?: string[];
}

export interface TypesFromResponse extends TypesNewResponse {
  /** Paths of the artifact (or the saved folder) that were not copied into the type (folders end with `/`). */
  skipped: string[];
  /** What to change in the new type for it to work as the page did. */
  notes?: string[];
  /** `types from <path>`: the capabilities found in the page. */
  capabilities?: TypesFromCapabilities;
  /** `types from <path>`: the folder or file the type was made from. */
  source?: string;
}

/** `POST /api/open-artifact.types.enable` and `.disable`: `{ id }`. `types.trust`: `{ dir, trusted? }` (default true). */
export interface TypesSettingResponse {
  ok: true;
  disabledTypes: string[];
  trustedProjects: string[];
}

/**
 * `POST /api/open-artifact.types.publish`: `{ id, remote?, visibility?, workspace? }`. A type of this computer (a user
 * type, one of an extra root, or one of a trusted project; never a built-in or an installed one) packed as
 * `types pack` packs it (the `--for-share` checks first) and published to a site's catalog (`link.types.import`).
 * Only a type whose pages frame-host runs as they are (an `index.html` with a `// artifact.json` declaration, no
 * `entry` of its own, not a page type) goes to a site. The person's: refused inside an agent's session.
 */
export interface TypesPublishRequest {
  id: string;
  remote?: string;
  visibility?: SiteTypeVisibility;
  workspace?: string;
}

/** {@link TypesPublishRequest}'s answer: the site's, plus where it went. */
export interface TypesPublishResponse extends LinkTypeImportResult {
  remote: string;
  host: string;
}

/** `POST /api/open-artifact.types.unpublish`: `{ id, remote? }` → the site's answer, plus where. The person's. */
export interface TypesUnpublishResponse extends LinkTypeUnpublishResult {
  remote: string;
  host: string;
}

/** How a declared capability name is served by frame-host on this computer. */
export type CapabilityStatus = 'backed' | 'stubbed' | 'config' | 'unknown';

/** `self` is `artifact`; `flags` is not a capability but the list of feature flags the page reads. */
export function capabilityStatus(name: string): CapabilityStatus {
  if (name === 'self' || FRAME_BACKED_CAPABILITIES.includes(name)) return 'backed';
  if (Object.hasOwn(FRAME_STUBBED_CAPABILITIES, name)) return 'stubbed';
  if (name === 'flags') return 'config';
  return 'unknown';
}

/** The share rules on a manifest alone (fields, entry, network): {@link manifestPackageProblems}, the one definition. */
export const manifestShareProblems = manifestPackageProblems;

/** A relative path that stays inside its folder: no leading `/` or drive, no `..` segment, no backslash. */
export function isInsidePath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p) || p.includes('\0')) return false;
  return !p.split('/').some((seg) => seg === '..');
}

/** A display name from an id: `trip-planner` → `Trip planner`. */
export function nameFromTypeId(id: string): string {
  const words = id.replace(/[._-]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : id;
}
