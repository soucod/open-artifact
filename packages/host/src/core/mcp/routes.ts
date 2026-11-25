/**
 * The remote MCP endpoint and its OAuth, as one handler for the paths {@link isMcpPath} names:
 *
 * - `POST /mcp`: Streamable HTTP, stateless and JSON-only (no `GET` stream: 405). It needs an MCP access token
 *   (`Authorization: Bearer`) whose grant names this resource; otherwise 401 with a `WWW-Authenticate` challenge
 *   that points at the resource metadata. A browser's `Origin` must be the app origin or one of `OA_MCP_ORIGINS`;
 *   a request without `Origin` (a server or desktop client) passes. An `MCP-Protocol-Version` header must name a
 *   version this server speaks (the `initialize` era: 2025-11-25 back to 2024-11-05); a missing one is 2025-03-26.
 * - The discovery documents (RFC 9728, RFC 8414) and the OAuth endpoints (`oauth.ts`).
 *
 * These are machine routes: they sit outside the app handler's same-origin rule for writes (a client posts from
 * its own origin or none), and the consent form makes its own same-origin check.
 */

import {
  cardContents,
  CARD_LISTING,
  CARD_URI,
  isSupportedProtocol,
  MCP_PROTOCOL_HEADER,
  MCP_PROTOCOL_VERSIONS,
  mcpError,
  serveMcp,
  type McpEndpoint,
  type McpMessage,
  type McpReply,
} from '@open-artifact/protocol';
import { userPrincipal } from '../auth/session.ts';
import { LINK_SCOPE } from '../link/services.ts';
import { errorResponse, httpError, json, readBody, Router, type BaseCtx, type Handler } from '../http.ts';
import type { AgentPrincipal } from '../types.ts';
import { MCP_PATH, type McpConfig } from './config.ts';
import { authorizationServerMetadata, bearerChallenge, MCP_SCOPES, OAUTH_PATHS, protectedResourceMetadata } from './metadata.ts';
import { MCP_HARNESS, MCP_USE_MARK_MS, mcpOAuthRoutes, type RegistrationRate } from './oauth.ts';
import type { McpServices } from './services.ts';
import { McpStore } from './store.ts';
import { HostTools } from './tools.ts';

/** The largest `/mcp` request body (a publish carries files). */
export const MCP_MAX_BODY_BYTES = 32 * 1024 * 1024;

export interface McpRouteDeps {
  config: McpConfig;
  services: McpServices;
  registrationRate?: RegistrationRate;
  /** The longest `ArtifactComments wait` (at most 25 s). */
  waitCapMs?: number;
}

/** Whether the MCP handler answers this path. */
export function isMcpPath(pathname: string): boolean {
  return pathname === MCP_PATH || pathname.startsWith('/.well-known/oauth-') || pathname === OAUTH_PATHS.openidConfiguration || pathname.startsWith('/oauth/');
}

/** The cross-origin answer headers for the public machine routes (no cookies are read there). */
const OPEN_CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-protocol-version',
  'access-control-max-age': '600',
};

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) out.headers.set(name, value);
  return out;
}

/** Whether a browser origin may call `/mcp`. */
function originAllowed(origin: string | null, config: McpConfig): boolean {
  return origin === null || origin === config.issuer || config.origins.includes(origin);
}

/** The MCP endpoint for one agent token's tools. */
function endpointOf(tools: HostTools, version: string): McpEndpoint {
  return {
    version,
    apps: () => true,
    instructions: () => tools.instructions(),
    tools: () => tools.definitions(),
    call: (name, args) => tools.call(name, args),
    structured: (name) => name === 'ShowArtifact',
    resources: {
      list: () => [CARD_LISTING],
      read: (uri) => (uri === CARD_URI ? cardContents('the agent') : null),
    },
  };
}

/** The agent behind a `/mcp` request's Bearer token, when it is an MCP token for this resource. */
async function mcpAgent(request: Request, ctx: BaseCtx, config: McpConfig): Promise<AgentPrincipal | null> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) return null;
  const { catalog } = ctx;
  const token = await catalog.findAgentTokenByAccess(match[1]!);
  if (!token || token.harness !== MCP_HARNESS) return null;
  const grant = await new McpStore(catalog, ctx.now).grantOf(token.id);
  if (!grant || grant.resource !== config.resource || grant.userId !== token.userId) return null;
  const user = await catalog.getUser(token.userId);
  if (!user || user.disabledAt) return null;
  const now = ctx.now().getTime();
  if (!token.usedAt || now - Date.parse(token.usedAt) >= MCP_USE_MARK_MS) await catalog.markAgentTokenUsed(token.id);
  return { kind: 'agent', id: token.id, user: await userPrincipal(user, ctx), label: token.label, harness: MCP_HARNESS, scopes: token.scopes };
}

/** Why `/mcp` refused the Bearer token sent: a Link token is named as one (it works on the Link API only). */
async function refusedTokenDescription(request: Request, ctx: BaseCtx): Promise<string> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '');
  const token = match ? await ctx.catalog.findAgentTokenByAccess(match[1]!).catch(() => undefined) : undefined;
  if (token && token.harness !== MCP_HARNESS && token.scopes.includes(LINK_SCOPE)) {
    return 'This is a Link token (a computer linked with `open-artifact remote add`): it works only on the Link API. /mcp takes an MCP token: connect the MCP client to /mcp and it signs in with OAuth.';
  }
  return 'The access token is expired, revoked or not for this server.';
}

async function serveMcpPost(request: Request, ctx: BaseCtx, deps: McpRouteDeps): Promise<Response> {
  const { config } = deps;
  const header = request.headers.get(MCP_PROTOCOL_HEADER);
  if (header !== null && !isSupportedProtocol(header.trim())) {
    return json(mcpError(-32600, `Unsupported MCP-Protocol-Version ${header}. This server speaks ${MCP_PROTOCOL_VERSIONS.join(', ')}; start with initialize.`, null, { supported: MCP_PROTOCOL_VERSIONS }), { status: 400 });
  }
  const agent = await mcpAgent(request, ctx, config);
  if (!agent) {
    const carried = request.headers.has('authorization');
    const description = carried ? await refusedTokenDescription(request, ctx) : 'Sign in: this server needs an OAuth access token.';
    return json(
      { error: carried ? 'invalid_token' : 'unauthorized', error_description: description },
      {
        status: 401,
        headers: { 'www-authenticate': bearerChallenge(config, carried ? { error: 'invalid_token', description } : undefined) },
      },
    );
  }
  if (!MCP_SCOPES.some((scope) => agent.scopes.includes(scope))) {
    return json(
      { error: 'insufficient_scope', error_description: 'This token allows nothing here.' },
      { status: 403, headers: { 'www-authenticate': bearerChallenge(config, { error: 'insufficient_scope', description: 'This token allows nothing here.' }) } },
    );
  }
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') return json(mcpError(-32700, 'Send JSON (Content-Type: application/json).'), { status: 415 });
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(await readBody(request, MCP_MAX_BODY_BYTES)));
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'too_large') return json(mcpError(-32600, `The request is larger than ${MCP_MAX_BODY_BYTES} bytes.`), { status: 413 });
    return json(mcpError(-32700, 'The body is not JSON.'), { status: 400 });
  }
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as unknown[];
  if (!messages.length) return json(mcpError(-32600, 'An empty batch.'), { status: 400 });
  const endpoint = endpointOf(new HostTools({ ctx, services: deps.services, config, agent, waitCapMs: deps.waitCapMs }), deps.services.version);
  const replies: McpReply[] = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object' || (message as McpMessage).jsonrpc !== '2.0') {
      replies.push(mcpError(-32600, 'Not a JSON-RPC 2.0 message.'));
      continue;
    }
    // A client's answers to requests this server never sends are accepted and dropped.
    if (typeof (message as McpMessage).method !== 'string') continue;
    let reply: McpReply | null;
    try {
      reply = await serveMcp(message as McpMessage, endpoint);
    } catch (error) {
      ctx.log(`mcp: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      const id = (message as McpMessage).id;
      reply = id === undefined ? null : mcpError(-32603, 'The server failed to answer.', id);
    }
    if (reply) replies.push(reply);
  }
  if (!replies.length) return new Response(null, { status: 202 });
  return json(batch ? replies : replies[0]);
}

/** The handler for `/mcp`, the discovery documents and the OAuth endpoints (see the module comment). */
export function mcpHandler(deps: McpRouteDeps): Handler<BaseCtx> {
  const { config } = deps;
  const oauth = mcpOAuthRoutes(new Router<BaseCtx>(), { config, cimd: deps.services.cimd, ...(deps.registrationRate ? { registrationRate: deps.registrationRate } : {}) });
  const resourceDoc = async (): Promise<Response> => json(protectedResourceMetadata(config));
  const serverDoc = async (): Promise<Response> => json(authorizationServerMetadata(config));
  const discovery = new Router<BaseCtx>()
    .get(OAUTH_PATHS.resourceMetadata, resourceDoc)
    .get(`${OAUTH_PATHS.resourceMetadata}${MCP_PATH}`, resourceDoc)
    .get(OAUTH_PATHS.serverMetadata, serverDoc)
    .get(`${OAUTH_PATHS.serverMetadata}${MCP_PATH}`, serverDoc)
    .get(OAUTH_PATHS.openidConfiguration, serverDoc);

  return async (request, ctx) => {
    const { pathname } = new URL(request.url);
    const origin = request.headers.get('origin');

    if (pathname === MCP_PATH) {
      if (!originAllowed(origin, config)) return errorResponse(httpError('not_granted', `Requests from ${origin} may not use this server.`, { status: 403 }));
      const cors: Record<string, string> =
        origin === null
          ? {}
          : { ...OPEN_CORS, 'access-control-allow-origin': origin, vary: 'Origin' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') {
        return withHeaders(json(mcpError(-32600, 'This server answers POST only: it opens no event stream.'), { status: 405 }), { ...cors, allow: 'POST' });
      }
      try {
        return withHeaders(await serveMcpPost(request, ctx, deps), cors);
      } catch (error) {
        return withHeaders(errorResponse(error, ctx.log), cors);
      }
    }

    // The consent page is a page of the app: no cross-origin access.
    if (pathname === OAUTH_PATHS.authorize) return oauth.handle(request, ctx);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: OPEN_CORS });
    const found = discovery.match(request.method, pathname);
    const response = found && !('allow' in found) ? await discovery.handle(request, ctx) : await oauth.handle(request, ctx);
    return withHeaders(response, OPEN_CORS);
  };
}
