/**
 * What remote MCP needs from the platform: the installed types (their metadata, skill text and actions), making a
 * new artifact's folder, the artifact files (the same {@link ArtifactFiles} the Link uses), the type server's actions,
 * and the shared in-process state. The Node host fills it in `node/mcp.ts`; tests pass fakes.
 */

import type { AccessCache } from '../authz/access.ts';
import type { HostEvents } from '../events.ts';
import type { ArtifactFiles, PageServices } from '../link/services.ts';
import type { CimdDeps } from './cimd.ts';

/** One of a type's actions, as `Artifact call` runs it. */
export interface McpTypeAction {
  name: string;
  title: string;
  effect?: 'read' | 'write';
  schema?: Record<string, unknown>;
}

/** An installed type, as the agent tools describe it. */
export interface McpTypeInfo {
  id: string;
  title: string;
  description: string;
  intents: string[];
  when?: string;
  exports: string[];
  /** Types it builds on (`openArtifact.uses`). */
  uses: string[];
  /** `db`: a document store (ArtifactData); `workbook`/`doc`: written only through actions. */
  store: 'db' | 'workbook' | 'doc' | null;
  comments: boolean;
  /** The title a new one gets. */
  artifactTitle?: string;
  /** Show the page after the first playable batch rather than at the end. */
  openEarly: boolean;
  /** Its actions on the host (`Artifact call`). */
  actions: McpTypeAction[];
}

/** The installed types. */
export interface McpTypeService {
  list(): McpTypeInfo[];
  get(id: string): McpTypeInfo | null;
  /** The type's instructions (its SKILL.md without front matter), or null. */
  skill(id: string): string | null;
}

export interface McpServices {
  types: McpTypeService;
  /** Makes a new artifact's folder: its `.artifact.json` and the type's empty content. The catalog row is the caller's. */
  create(input: { id: string; type: string; title: string }): Promise<void>;
  /** Page artifacts' declared capabilities, on a site that runs pages (the Link's `pages`); absent: none. */
  pages?: PageServices;
  /**
   * A type published to the site (`types publish`), by id: its name and description, which its publisher wrote; null
   * for any other type. Absent: the site runs none.
   */
  publishedType?(type: string): { name: string; description: string } | null;
  files: ArtifactFiles;
  /** Runs an action of the embedded type server on an artifact (reserved `open-artifact.*` ones too). */
  action(artifactId: string, name: string, args: Record<string, unknown>): Promise<unknown>;
  /** The title the artifact's content gives (its manifest's `titleFrom`), when it has one. */
  contentTitle(artifactId: string, type: string): Promise<string | undefined>;
  /** After a sharing change: drops the page connections whose holder's role moved. */
  refreshAccess(artifactId: string): Promise<void>;
  events: HostEvents;
  /** The live role lookup, configured like the rooms'. */
  access: AccessCache;
  /** The metadata-document fetcher's platform parts. */
  cimd: Omit<CimdDeps, 'allowPrivate'>;
  /** The host's version. */
  version: string;
}
