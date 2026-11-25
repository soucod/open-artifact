/**
 * The product Worker's bindings, as local structural types (no `@cloudflare/workers-types`): see
 * `deploy/cloudflare/wrangler.jsonc`.
 */

import type { D1Database } from './d1.ts';
import type { FetchStub } from './room-calls.ts';
import type { AssetsBinding } from './room.ts';

/** A Durable Object id. */
export interface DurableObjectId {
  toString(): string;
  readonly name?: string;
}

/** A Durable Object namespace, as far as the Worker uses one. */
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): FetchStub;
}

/** What `ctx` of a Worker's `fetch` offers. */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** The product Worker's `env`: bindings, and the `OA_*` variables and secrets as strings. */
export interface ProductEnv {
  /** The catalog. */
  DB: D1Database;
  /** One `ArtifactObject` per artifact (`idFromName(artifactId)`). */
  ROOMS: DurableObjectNamespace;
  /** The one `SiteHubObject` (`idFromName('hub')`). */
  HUB: DurableObjectNamespace;
  /** The built editors, Shell and home page (`dist/assets`). */
  ASSETS: AssetsBinding;
  [variable: string]: unknown;
}
