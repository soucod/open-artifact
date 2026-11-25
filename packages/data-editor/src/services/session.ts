/**
 * The page's connection to its host: installs `window.openartifact` (unless
 * a host already did) and resolves every capability the data page uses.
 *
 * Only `db` is required: the page is its document store. Without `mcp` the
 * connector datasets cannot load; without `agent`, `comments`, `room`,
 * `history` or `downloads` the matching features are hidden.
 */

import type {
  AgentCapability,
  AssetsCapability,
  CommentsCapability,
  DbCapability,
  DownloadsCapability,
  HistoryCapability,
  McpCapability,
  RoomCapability,
  ShellConnection,
  Viewer,
} from '@open-artifact/runtime';
import { connectHost, sessionSlot, type RoleAbilities } from '@open-artifact/editor-kit';
import { inlineAbilities, isInlineView, readOnlyDb } from '../platform/inline-view.ts';

/** Everything the page talks to. Missing capabilities are `null`. */
export interface Session extends RoleAbilities {
  db: DbCapability;
  mcp: McpCapability | null;
  comments: CommentsCapability | null;
  assets: AssetsCapability | null;
  agent: AgentCapability | null;
  room: RoomCapability | null;
  downloads: DownloadsCapability | null;
  history: HistoryCapability | null;
  viewer: Viewer;
  peerId: string;
  shell: ShellConnection | null;
}

const slot = sessionSlot<Session>();

const NO_STORE_MESSAGE = 'This page could not reach its document store. Open it again from your agent.';

/** The session; throws before {@link startSession} resolved. */
export const session = slot.session;

/** The session, or `null` before it started. */
export const maybeSession = slot.maybeSession;

/**
 * The embedded view's session: the store, read only, and the connectors to load data; nothing that comments,
 * asks, joins the room, saves files or keeps history.
 */
async function startInlineSession(): Promise<Session> {
  const { caps, viewer, abilities } = await connectHost(['db', 'mcp']);
  if (!caps.db) throw new Error(NO_STORE_MESSAGE);
  const none = { comments: null, assets: null, agent: null, room: null, downloads: null, history: null, shell: null };
  return slot.set({ db: readOnlyDb(caps.db), mcp: caps.mcp, ...none, viewer, peerId: viewer.id, ...inlineAbilities(abilities) });
}

/** Connects to the host. Rejects when the document store is unavailable. */
export async function startSession(): Promise<Session> {
  if (isInlineView()) return startInlineSession();
  const { caps, viewer, abilities, shell } = await connectHost(['db', 'mcp', 'comments', 'assets', 'agent', 'room', 'downloads', 'history']);
  const { db, mcp, comments, assets, agent, room, downloads, history } = caps;
  if (!db) throw new Error(NO_STORE_MESSAGE);
  const peerId = (await room?.self().catch(() => null)) ?? viewer.id;
  return slot.set({ db, mcp, comments, assets, agent, room, downloads: abilities.canSaveToHost ? downloads : null, history, viewer, peerId, ...abilities, shell });
}
