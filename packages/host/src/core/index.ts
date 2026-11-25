/**
 * `@open-artifact/host`: the platform-neutral core of the Open Artifact cloud host.
 *
 * - `types.ts`: `Principal`, `HostConfig`, `SqlDriver` and the catalog's records.
 * - `http.ts`: handlers on Fetch `Request`/`Response`, a router, JSON and error answers, cookies, the same-origin check.
 * - `crypto.ts`: random ids and tokens, SHA-256, HMAC with key rotation, AES-GCM for small strings (WebCrypto).
 * - `page-token.ts`: signed page tokens and content host names.
 * - `page-host.ts`: a page artifact's page hosts (`<idlabel>--<opaque>`), for both sites' frame engines.
 * - `config.ts`: the configuration from environment variables.
 * - `catalog/`: the schema, its migrations and the `Catalog` over a `SqlDriver`.
 * - `authz/`: a principal's role on an artifact (`roles.ts`) and its live lookup (`access.ts`).
 * - `auth/`: sign-in providers, accounts, sessions and principals, the sign-in routes and page shell.
 * - `events.ts`: what happened inside the process (artifact touched or changed, access changed, outbox).
 * - `app/`: the app origin (home, Shell, Library API, sharing, share links, event stream) as one handler.
 * - `link/`: the Link API (device sign-in, file sync, events) a local daemon publishes through.
 * - `mcp/`: remote MCP with OAuth (`/mcp`, the discovery documents, `/oauth/*`) and the agent tools behind it.
 * - `plugins/`: host plugins (decisions 47-53): the operator's list, the running registry, their key-value store, and
 *   the helpers the call sites use.
 *
 * Nothing here imports Node: it runs unchanged on Workers. The Node adapter is `@open-artifact/host/node`.
 */
export * from './types.ts';
export * from './http.ts';
export * from './crypto.ts';
export * from './page-token.ts';
export * from './page-host.ts';
export * from './config.ts';
export * from './catalog/schema.ts';
export * from './catalog/catalog.ts';
export * from './authz/index.ts';
export * from './auth/index.ts';
export * from './events.ts';
export * from './app/index.ts';
export * from './link/index.ts';
export * from './mcp/index.ts';
export * from './plugins/index.ts';
