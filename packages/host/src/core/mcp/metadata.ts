/**
 * Discovery for remote MCP clients:
 *
 * - RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource` and
 *   `/.well-known/oauth-protected-resource/mcp` (the resource's own path, as RFC 9728 places it);
 * - RFC 8414 authorization-server metadata at `/.well-known/oauth-authorization-server` (and the OpenID name some
 *   clients try first);
 * - the `WWW-Authenticate` challenge a `/mcp` 401 or 403 carries, naming the resource metadata.
 */

import type { McpConfig } from './config.ts';

/** What an MCP token may do. `link` (a Link's sync) is never granted here. */
export const MCP_SCOPES = ['artifacts.read', 'artifacts.write', 'comments', 'share.read'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** How long an MCP access token works. */
export const MCP_ACCESS_TTL_MS = 3600_000;
/** How long an MCP refresh token works after its last use (rolling). */
export const MCP_REFRESH_TTL_MS = 30 * 24 * 3600_000;
/** How long an authorization code may wait for the token request. */
export const MCP_CODE_TTL_MS = 5 * 60_000;

export const OAUTH_PATHS = {
  resourceMetadata: '/.well-known/oauth-protected-resource',
  serverMetadata: '/.well-known/oauth-authorization-server',
  openidConfiguration: '/.well-known/openid-configuration',
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  register: '/oauth/register',
  revoke: '/oauth/revoke',
} as const;

/** The resource metadata URL a challenge names: the resource's own path under the well-known prefix. */
export function resourceMetadataUrl(config: McpConfig): string {
  return `${config.issuer}${OAUTH_PATHS.resourceMetadata}${new URL(config.resource).pathname}`;
}

/** RFC 9728 protected-resource metadata. */
export function protectedResourceMetadata(config: McpConfig): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Open Artifact',
  };
}

/** RFC 8414 authorization-server metadata. */
export function authorizationServerMetadata(config: McpConfig): Record<string, unknown> {
  const o = config.issuer;
  return {
    issuer: o,
    authorization_endpoint: `${o}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${o}${OAUTH_PATHS.token}`,
    registration_endpoint: `${o}${OAUTH_PATHS.register}`,
    revocation_endpoint: `${o}${OAUTH_PATHS.revoke}`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** The `WWW-Authenticate` value of a refused `/mcp` request. */
export function bearerChallenge(config: McpConfig, error?: { error: 'invalid_token' | 'insufficient_scope'; description: string }): string {
  const parts = [`resource_metadata="${resourceMetadataUrl(config)}"`, `scope="${MCP_SCOPES.join(' ')}"`];
  if (error) parts.push(`error="${error.error}"`, `error_description="${error.description.replace(/["\\]/g, '')}"`);
  return `Bearer ${parts.join(', ')}`;
}
