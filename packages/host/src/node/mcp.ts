/**
 * The Node host's remote MCP services: the installed types read from an `artifact-types` folder (each type's
 * `artifact-type.json` and `SKILL.md`, limited to the types the embedded type server runs), a new artifact's folder
 * made the way the type server makes one, the artifact files and actions over the rooms, and the client metadata
 * fetcher's `fetch` and DNS lookup.
 *
 * Wiring (in `startHost`):
 *
 * ```ts
 * const mcp = await nodeMcpServices({ rooms, events, access: services.access, contentTitle: link.contentTitle, version });
 * const handleMcp = mcpRoutes({ config: parseMcpConfig(process.env, config), services: mcp });
 * // requests whose path isMcpPath(...) go to handleMcp, ahead of the app handler
 * ```
 */

import { lookup } from 'node:dns/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionsOfType, contentDirOf, isTypeName, TYPES, type TypeName } from '@open-artifact/type-server';

import type { AccessCache } from '../core/authz/access.ts';
import type { HostEvents } from '../core/events.ts';
import type { BaseCtx, Handler } from '../core/http.ts';
import { LINK_REFUSED_ACTIONS } from '../core/link/routes.ts';
import { mcpHandler, type McpRouteDeps } from '../core/mcp/routes.ts';
import type { McpServices, McpTypeAction, McpTypeInfo, McpTypeService } from '../core/mcp/services.ts';
import { createArtifactFiles } from './files.ts';
import type { HostRooms } from './rooms.ts';

/** This checkout's `artifact-types` folder, resolved from this package (`packages/host/src/node/`). */
export const DEFAULT_TYPES_DIR = fileURLToPath(new URL('../../../../artifact-types', import.meta.url));

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/** A SKILL.md without its front matter. */
export function skillBody(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return (match ? text.slice(match[0].length) : text).trim();
}

/**
 * The actions of a type the agent may run here: the type server's list for that type ({@link actionsOfType}), less
 * those a hosted agent cannot use (an upload from a local path, a snapshot path, sharing, duplicate, import).
 */
export function mcpActionsOf(type: TypeName): McpTypeAction[] {
  return actionsOfType(type)
    .filter((action) => !LINK_REFUSED_ACTIONS.has(action.name))
    .map((action) => ({ name: action.name, title: action.title, effect: action.effect, schema: action.schema }));
}

/**
 * The types installed in `typesDir` that the embedded type server runs, with their actions; with `pages`, the `page`
 * type too (the frame engine runs it: its only action here is `info`).
 */
export function readMcpTypes(typesDir: string, options: { pages?: boolean } = {}): McpTypeService {
  const types = new Map<string, { info: McpTypeInfo; skill: string | null }>();
  const folders = existsSync(typesDir) ? readdirSync(typesDir, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
  for (const folder of folders) {
    const dir = join(typesDir, folder.name);
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'artifact-type.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!isRecord(manifest)) continue;
    const id = typeof manifest.slug === 'string' ? manifest.slug : folder.name;
    const oa = isRecord(manifest.openArtifact) ? manifest.openArtifact : {};
    if (id === 'page' && options.pages && oa.style === 'page') {
      types.set(id, { skill: readSkill(dir, manifest), info: pageTypeInfo(manifest) });
      continue;
    }
    if (!isTypeName(id)) continue;
    const store = TYPES[id].store ?? null;
    let skill: string | null = null;
    try {
      skill = skillBody(readFileSync(join(dir, typeof manifest.skill === 'string' ? manifest.skill : 'SKILL.md'), 'utf8'));
    } catch {
      skill = null;
    }
    types.set(id, {
      skill,
      info: {
        id,
        title: typeof manifest.title === 'string' ? manifest.title : TYPES[id].title,
        description: typeof manifest.description === 'string' ? manifest.description : typeof manifest.summary === 'string' ? manifest.summary : '',
        intents: strings(manifest.intents),
        ...(typeof manifest.when === 'string' ? { when: manifest.when } : {}),
        exports: strings(oa.exports),
        uses: strings(oa.uses),
        store,
        comments: TYPES[id].comments === true || oa.comments === true,
        ...(typeof manifest.artifactTitle === 'string' ? { artifactTitle: manifest.artifactTitle } : {}),
        openEarly: oa.openEarly === true,
        actions: mcpActionsOf(id),
      },
    });
  }
  const list = [...types.values()].map((t) => t.info).sort((a, b) => a.id.localeCompare(b.id));
  return {
    list: () => list,
    get: (id) => types.get(id)?.info ?? null,
    skill: (id) => types.get(id)?.skill ?? null,
  };
}

function readSkill(dir: string, manifest: Record<string, unknown>): string | null {
  try {
    return skillBody(readFileSync(join(dir, typeof manifest.skill === 'string' ? manifest.skill : 'SKILL.md'), 'utf8'));
  } catch {
    return null;
  }
}

/** The page type as the site's MCP lists it: a free page with a db, comments, and `info` as its only action. */
function pageTypeInfo(manifest: Record<string, unknown>): McpTypeInfo {
  return {
    id: 'page',
    title: typeof manifest.title === 'string' ? manifest.title : 'Page',
    description: typeof manifest.description === 'string' ? manifest.description : '',
    intents: strings(manifest.intents),
    ...(typeof manifest.when === 'string' ? { when: manifest.when } : {}),
    exports: [],
    uses: [],
    store: 'db',
    comments: true,
    ...(typeof manifest.artifactTitle === 'string' ? { artifactTitle: manifest.artifactTitle } : {}),
    openEarly: false,
    actions: [{ name: 'info', title: 'What the artifact holds', effect: 'read', schema: { type: 'object', properties: {} } }],
  };
}

/** Makes a new artifact's folder as the type server would: `.artifact.json` and the type's empty content. */
export async function scaffoldArtifact(root: string, input: { id: string; type: string; title: string }): Promise<void> {
  if (input.type === 'page') {
    // A page starts empty: the core shows its empty page until index.html is written.
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(join(root, '.artifact.json'), `${JSON.stringify({ type: 'page', id: input.id, title: input.title, release: null, capabilities: {} }, null, 2)}\n`, { flag: 'wx' });
    return;
  }
  if (!isTypeName(input.type)) throw new Error(`Unknown type ${input.type}.`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, '.artifact.json'), `${JSON.stringify({ type: input.type, id: input.id, title: input.title, release: null }, null, 2)}\n`, { flag: 'wx' });
  const dir = join(root, contentDirOf(input.type));
  for (const [path, content] of Object.entries(TYPES[input.type].scaffold(input.title, dir))) {
    const file = join(dir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, { flag: 'wx' });
  }
}

/** The addresses a host name resolves to (every family). */
async function resolveAll(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

/** The remote MCP services over the rooms. */
export async function nodeMcpServices(input: {
  rooms: Pick<HostRooms, 'rootOf' | 'action' | 'refresh'> & { frames?: HostRooms['frames']; siteTypes?: HostRooms['siteTypes'] };
  events: HostEvents;
  /** Page artifacts' capabilities (`nodeLinkServices(…).pages`), on a site that runs pages. */
  pages?: McpServices['pages'];
  access: AccessCache;
  /** The title an artifact's content gives (`nodeLinkServices(…).contentTitle`). */
  contentTitle: McpServices['contentTitle'];
  version: string;
  /** Where the installed types are (`OA_TYPES_DIR`; default this checkout's `artifact-types`). */
  typesDir?: string;
  /** The metadata-document fetcher's `fetch` and lookup (tests stub them). */
  cimd?: McpServices['cimd'];
}): Promise<McpServices> {
  const { rooms } = input;
  const types = readMcpTypes(input.typesDir ?? DEFAULT_TYPES_DIR, { pages: !!rooms.frames });
  return {
    types,
    create: (artifact) => scaffoldArtifact(rooms.rootOf(artifact.id), artifact),
    ...(input.pages ? { pages: input.pages } : {}),
    ...(rooms.siteTypes ? { publishedType: (type: string) => ((row) => (row ? { name: row.name, description: row.description } : null))(rooms.siteTypes!.row(type)) } : {}),
    files: createArtifactFiles((id) => rooms.rootOf(id), { afterWrite: (id, paths) => rooms.frames?.noteChanges(id, paths) }),
    action: (id, name, args) => rooms.action(id, name, args),
    contentTitle: input.contentTitle,
    refreshAccess: (id) => rooms.refresh(id),
    events: input.events,
    access: input.access,
    cimd: input.cimd ?? { fetch: (url, init) => fetch(url, init), lookup: resolveAll },
    version: input.version,
  };
}

/** The handler for `/mcp`, discovery and `/oauth/*` (send the paths `isMcpPath` names to it). */
export function mcpRoutes(deps: McpRouteDeps): Handler<BaseCtx> {
  return mcpHandler(deps);
}
