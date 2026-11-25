/**
 * MCP over HTTP (`POST /mcp`, JSON answers) and the caller's identity.
 * `open-artifact mcp` bridges a stdio MCP client to it, adding the `X-Open-Artifact-*` headers.
 */

import type { IncomingMessage } from 'node:http';
import { serveMcp, type McpMessage, type McpMeta, type McpReply, type SessionRef, type ToolCallResult, type ToolDefinition } from '@open-artifact/protocol';
import { MCP_APP_NOTE, SHOW_TOOL, VIEW_URI, clientShowsApps, viewContents, viewListing } from './mcp-app.ts';
import { samePath } from './paths.ts';

export { MCP_PROTOCOL, type McpMessage, type McpMeta, type McpReply } from '@open-artifact/protocol';

/** Headers the `open-artifact mcp` bridge sets. */
export const MCP_HEADERS = {
  harness: 'x-open-artifact-harness',
  session: 'x-open-artifact-session',
  workspace: 'x-open-artifact-workspace',
  /** Comma-separated ancestor process ids, to find a session a hook registered. */
  ppid: 'x-open-artifact-ppid',
  /** `1`: the client shows MCP Apps (it declared the extension in `initialize`). */
  ui: 'x-open-artifact-ui',
} as const;

/** Finds a session from process ids or recent hooks, and a session's folder (the Harness hub). */
export interface PidLookup {
  byPid(pids: number[], harness?: string): SessionRef | null;
  recentSession?(harness: string, workspace?: string | null): SessionRef | null;
  workspaceOf?(ref: SessionRef): string | null;
}

const header = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Who calls: the headers the bridge sets, or `_meta` an MCP client passes. Plain clients are harness `mcp`. */
export function callerFromRequest(request: IncomingMessage, pids: PidLookup, meta: McpMeta = {}): SessionRef {
  const harness = String(header(request, MCP_HEADERS.harness) ?? meta.harness ?? 'mcp');
  const sessionHeader = header(request, MCP_HEADERS.session);
  const session = sessionHeader ? String(sessionHeader) : (meta.sessionId ?? meta.threadId ?? meta.conversationId ?? null);
  const workspaceHeader = header(request, MCP_HEADERS.workspace);
  let workspace: string | null = meta.workspace ?? null;
  if (workspaceHeader) {
    try {
      workspace = decodeURIComponent(workspaceHeader);
    } catch {
      workspace = workspaceHeader;
    }
  }
  if (!session) {
    const ppid = header(request, MCP_HEADERS.ppid);
    if (ppid) {
      const ref = pids.byPid(
        ppid.split(',').map(Number).filter((n) => n > 1),
        harness,
      );
      if (ref && (!workspace || !ref.workspace || samePath(ref.workspace, workspace))) {
        return { harness: ref.harness, session: ref.session, workspace: ref.workspace || workspace };
      }
    }
    const recent = pids.recentSession?.(harness, workspace) ?? null;
    if (recent) return { harness: recent.harness, session: recent.session, workspace: recent.workspace || workspace };
  }
  return { harness, session, workspace };
}

/** What {@link handleMcp} needs from the tools. */
export interface McpTools {
  definitions(workspace?: string | null): ToolDefinition[];
  instructions(workspace?: string | null, harness?: string | null): string;
  call(name: string, args: Record<string, unknown>, caller: SessionRef): Promise<ToolCallResult>;
}

/** Whether a request comes from a client that shows MCP Apps: the bridge's header. */
export function uiFromRequest(request: IncomingMessage): boolean {
  return header(request, MCP_HEADERS.ui) === '1';
}

/** One JSON-RPC message → its answer (`null` for a notification). */
export async function handleMcp(
  message: McpMessage,
  context: {
    tools: McpTools;
    caller: SessionRef;
    version: string;
    workspaceOf?: (ref: SessionRef) => string | null;
    /** The client shows MCP Apps ({@link MCP_HEADERS}`.ui`); `initialize` also reads it from the client's capabilities. */
    ui?: boolean;
    /** The daemon's origin, which the MCP App's view frames. */
    origin?: string;
  },
): Promise<McpReply | null> {
  const { tools, caller, version, origin } = context;
  const ui = !!context.ui && !!origin;
  return serveMcp(message, {
    version,
    // initialize also reads the client's capabilities; tools/list goes by the bridge's header alone.
    apps: (method, capabilities) => !!origin && (ui || (method === 'initialize' && clientShowsApps(capabilities))),
    instructions: (apps) => {
      const instructions = tools.instructions(caller.workspace, caller.harness);
      return apps ? `${instructions}\n\n${MCP_APP_NOTE}`.trim() : instructions;
    },
    tools: (apps) => (apps ? [...tools.definitions(caller.workspace), SHOW_TOOL] : tools.definitions(caller.workspace)),
    call: (name, args, meta) => {
      const metaSession = meta.sessionId ?? meta.threadId ?? meta.conversationId;
      const who: SessionRef = { ...caller, ...(metaSession ? { session: metaSession } : {}) };
      // A bridge started in a plugin's folder names no folder: the session's own, when the daemon knows it.
      if (!who.workspace) who.workspace = context.workspaceOf?.(who) ?? null;
      return tools.call(name, args, who);
    },
    // The view reads what to show from structuredContent.
    structured: (name) => name === SHOW_TOOL.name,
    resources: {
      list: () => (origin ? [viewListing(origin)] : []),
      read: (uri) => (origin && uri === VIEW_URI ? viewContents(origin, version) : null),
    },
  });
}
