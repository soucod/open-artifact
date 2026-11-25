/**
 * The Open Artifact daemon, as this server uses it: the Type API client
 * from `@open-artifact/server-sdk` plus never-throwing helpers.
 *
 * When the server is started by a daemon (`entry.start` in
 * `artifact-type.json`), the daemon passes the `OPEN_ARTIFACT_*` variables
 * ({@link TypeServerEnv}). Requests from the page are then routed to the agent
 * that owns the artifact through `open-artifact.type.wake`, and page writes are reported
 * with `open-artifact.type.touch` so the daemon can tell people's edits from the agent's.
 *
 * Without those variables the server runs standalone: there is no client
 * (`null`) and requests go to the artifact's local inbox.
 */

import type { TypeApiWakeResult, TypeServerEnv, WakeRequestItem } from '@open-artifact/protocol';
import { TypeApi, typeServerEnv, type TypeApiLike } from '@open-artifact/server-sdk';

export { typeServerEnv };

/** The Type API client for `env`, or `null` when the server runs standalone. */
export function daemonFromEnv(env: Partial<TypeServerEnv> = typeServerEnv()): TypeApi | null {
  const api = new TypeApi({ url: env.OPEN_ARTIFACT_DAEMON_URL ?? null, token: env.OPEN_ARTIFACT_TYPE_TOKEN ?? null, timeoutMs: 10_000 });
  return api.available ? api : null;
}

/** `OPEN_ARTIFACT_PORT` as a port number, or `undefined` when unset or `0`. */
export function envPort(env: Partial<TypeServerEnv> = typeServerEnv()): number | undefined {
  const port = Number(env.OPEN_ARTIFACT_PORT);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

/** A wake answer, or a local failure with its reason. */
export type WakeOutcome = TypeApiWakeResult | { status: 'failed'; via: 'failed'; reason: string };

/** Hands page requests to the agent that owns the artifact. Never throws. */
export async function wakeRequests(daemon: TypeApiLike, id: string, requests: WakeRequestItem[]): Promise<WakeOutcome> {
  try {
    return await daemon.wake(id, { requests });
  } catch (error) {
    return { status: 'failed', via: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Reports a write made through the page. Failures are ignored. */
export async function reportTouch(daemon: TypeApiLike | null, id: string, author: string, paths: string[], title?: string): Promise<void> {
  if (!daemon) return;
  try {
    await daemon.touch(id, { author, paths, ...(title ? { title } : {}) });
  } catch {
    // Best effort.
  }
}
