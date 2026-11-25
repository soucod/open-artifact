/**
 * The cloud host's configuration from the Worker's `env`: the host core's `parseConfig`, with the rules of a
 * deployment that has no terminal and no private network.
 *
 * - Both origins must be https, except a localhost origin (`localhost`, `*.localhost`, `127.0.0.1`) for `wrangler dev`.
 *   The core's private-network allowance (a `.lan` name, a private address) does not apply: a Worker is never on one.
 * - `OA_ALLOW_HTTP` does not apply here, and is refused rather than ignored, so a copied Node setting is noticed.
 * - With the owner-key sign-in on, `OA_OWNER_KEY` is required (a secret, `wrangler secret put OA_OWNER_KEY`): the Node
 *   host generates a key and prints it once to its terminal, which a Worker does not have.
 *
 * Everything else is the core's (`OA_APP_ORIGIN`, `OA_CONTENT_ORIGIN`, `OA_SIGNING_KEYS`, `OA_AUTH`, `OA_OWNERS`,
 * `OA_SIGNUP`, `OA_LINK_MAX_ROLE`, `OA_PUBLIC_ACCESS`, `OA_OWNER_NAME`, `OA_CONTENT_SAME_SITE` for one zone serving
 * both origins, where `site.ts` then refuses hosts that are neither), `OA_TRASH_DAYS` (checked here, read by the
 * hourly upkeep), the rooms' timings `OA_ROOM_IDLE_CLOSE_MS` and `OA_SSE_HEARTBEAT_MS` ({@link parseRoomTimings}), and
 * `OA_PAGE_NETWORK` (what a page artifact may reach: `self` or `https`, `frames.ts`).
 * A mistake is a {@link ConfigError} naming the
 * variable; the Worker answers every request with it (see `site.ts`) until it is fixed.
 */

import { ConfigError, parseConfig, parseTrashDays, type HostConfig } from '@open-artifact/host';
import { parsePageNetwork } from './frames.ts';

/** Whether a host name is this computer's (the only plain-http origins a Worker takes, for `wrangler dev`). */
export function isLocalHostName(hostname: string): boolean {
  const name = hostname.toLowerCase();
  return name === 'localhost' || name.endsWith('.localhost') || name === '127.0.0.1' || name === '[::1]';
}

/** The variables of `env` that are strings (bindings and other values left out). */
export function stringVars(env: object): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string') out[key] = value;
  return out;
}

/** The host configuration from a Worker's `env` (see the module comment); throws a {@link ConfigError}. */
export function parseCloudflareConfig(env: object): HostConfig {
  const vars = stringVars(env);
  if (vars.OA_ALLOW_HTTP?.trim()) {
    throw new ConfigError('OA_ALLOW_HTTP', 'does not apply to the Cloudflare host: its origins are https (a localhost origin may be http, for wrangler dev). Remove it.');
  }
  const config = parseConfig(vars);
  for (const [variable, origin] of [
    ['OA_APP_ORIGIN', config.appOrigin],
    ['OA_CONTENT_ORIGIN', config.contentOrigin.replace('{id}', 'art-0000000000')],
  ] as const) {
    const url = new URL(origin);
    if (url.protocol === 'http:' && !isLocalHostName(url.hostname)) {
      throw new ConfigError(variable, `must use https on Cloudflare (plain http only for a localhost origin under wrangler dev): ${origin}`);
    }
  }
  if (config.auth.some((auth) => auth.kind === 'owner-key') && !config.ownerKey) {
    throw new ConfigError(
      'OA_OWNER_KEY',
      'is required while the owner-key sign-in is on (OA_AUTH lists owner-key, the default): a Worker cannot print a generated key. Set a random secret of at least 24 characters with `wrangler secret put OA_OWNER_KEY` (locally: in .dev.vars).',
    );
  }
  parseTrashDays(vars);
  parseRoomTimings(vars);
  parsePageNetwork(vars);
  return config;
}

/**
 * The rooms' timings, when set: `OA_ROOM_IDLE_CLOSE_MS` (an artifact with no page and no request closes after this
 * long; 0 never; default 60 000) and `OA_SSE_HEARTBEAT_MS` (an idle event stream gets a comment this often, which is
 * how a page that left is noticed where the request's abort signal does not reach the object; 0 never; default 1000).
 */
export function parseRoomTimings(vars: Record<string, string | undefined>): { idleCloseMs?: number; sseHeartbeatMs?: number } {
  const out: { idleCloseMs?: number; sseHeartbeatMs?: number } = {};
  for (const [variable, key] of [
    ['OA_ROOM_IDLE_CLOSE_MS', 'idleCloseMs'],
    ['OA_SSE_HEARTBEAT_MS', 'sseHeartbeatMs'],
  ] as const) {
    const raw = vars[variable]?.trim();
    if (!raw) continue;
    if (!/^\d+$/.test(raw) || Number(raw) > 86_400_000) throw new ConfigError(variable, `must be a whole number of milliseconds (0 to 86400000): ${raw}`);
    out[key] = Number(raw);
  }
  return out;
}
