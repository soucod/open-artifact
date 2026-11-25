/**
 * The remote MCP endpoint's settings, from environment variables (Node passes `process.env`, Workers pass `env`):
 *
 * | Variable | Default |
 * |---|---|
 * | `OA_MCP_ORIGINS` | none: comma-separated browser origins that may call `/mcp` besides the app origin |
 * | `OA_OAUTH_CLIENTS` | none: a JSON array of pre-registered clients, `[{"client_id", "client_name", "redirect_uris"}]` |
 * | `OA_TEST_SNAPSHOT_TTL_SECONDS` | none: for tests only, a shorter life (1 to 300 s) for the `snapshot` call's page addresses |
 *
 * The resource is always `<app origin>/mcp` and the authorization server the app origin itself.
 */

import { ConfigError } from '../config.ts';
import { SNAPSHOT_TOKEN_TTL_SECONDS } from '../page-token.ts';
import type { HostConfig } from '../types.ts';

/** The path of the MCP endpoint on the app origin. */
export const MCP_PATH = '/mcp';

/** A client listed in `OA_OAUTH_CLIENTS`. */
export interface PreregisteredClient {
  clientId: string;
  name: string;
  redirectUris: string[];
}

export interface McpConfig {
  /** The protected resource (the audience of every MCP token): `<app origin>/mcp`. */
  resource: string;
  /** The authorization server's issuer: the app origin. */
  issuer: string;
  /** Browser origins let in besides the app origin (`OA_MCP_ORIGINS`). */
  origins: string[];
  clients: PreregisteredClient[];
  /**
   * Whether the app origin is a local one (localhost, a `.localhost` name or a loopback address): only then may a
   * client metadata document live on a private or loopback address.
   */
  local: boolean;
  /**
   * The life of a `snapshot` page address, seconds, when shorter than the default (`SNAPSHOT_TOKEN_TTL_SECONDS`): set
   * by tests (`OA_TEST_SNAPSHOT_TTL_SECONDS`) to see one expire without waiting. It can only shorten it.
   */
  snapshotTtlSeconds?: number;
}

/** Whether a host name is this machine or a private network's (`localhost`, loopback and private literals). */
export function isLocalHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return name === 'localhost' || name.endsWith('.localhost') || isPrivateAddress(name);
}

/** Whether an IP literal is loopback, private, link-local, unspecified, CGNAT or another non-public range. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (!ip.includes(':')) return false;
  if (ip === '::' || ip === '::1') return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]!);
  const first = ip.split(':')[0] ?? '';
  const word = first === '' ? 0 : parseInt(first, 16);
  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
  return (word & 0xfe00) === 0xfc00 || (word & 0xffc0) === 0xfe80 || (word & 0xff00) === 0xff00;
}

/** A redirect URI a client may register: absolute, no fragment, https, http on a loopback host, or an app's own scheme. */
export function redirectUriProblem(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 2000) return 'is not a URL';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'is not an absolute URL';
  }
  if (url.hash || value.includes('#')) return 'has a fragment';
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:') return isLoopbackHost(url.hostname) ? null : 'is http on a host other than this computer (use https)';
  if (/^(javascript|data|file|blob|vbscript|about):$/.test(url.protocol)) return 'has a scheme that cannot be a redirect';
  // A native app's private scheme (com.example.app:/callback, cursor://…).
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) ? null : 'has an unusable scheme';
}

/** Whether a host name is this computer: `localhost`, `127.0.0.0/8` or `::1`. */
export function isLoopbackHost(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return name === 'localhost' || name.endsWith('.localhost') || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name) || name === '::1';
}

/** The MCP settings for a host configuration and its environment. */
export function parseMcpConfig(env: Record<string, string | undefined>, config: Pick<HostConfig, 'appOrigin'>): McpConfig {
  const origins: string[] = [];
  for (const raw of (env.OA_MCP_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    let origin: string;
    try {
      origin = new URL(raw).origin;
    } catch {
      throw new ConfigError('OA_MCP_ORIGINS', `"${raw}" is not an origin.`);
    }
    if (origin === 'null' || origin !== raw.replace(/\/$/, '')) throw new ConfigError('OA_MCP_ORIGINS', `"${raw}" is not an origin (scheme://host[:port], no path).`);
    origins.push(origin);
  }

  const clients: PreregisteredClient[] = [];
  const text = env.OA_OAUTH_CLIENTS?.trim();
  if (text) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ConfigError('OA_OAUTH_CLIENTS', 'is not JSON.');
    }
    if (!Array.isArray(parsed)) throw new ConfigError('OA_OAUTH_CLIENTS', 'must be a JSON array of {"client_id", "client_name", "redirect_uris"}.');
    for (const entry of parsed as unknown[]) {
      const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const clientId = record.client_id;
      if (typeof clientId !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(clientId) || /^https?:/.test(clientId)) {
        throw new ConfigError('OA_OAUTH_CLIENTS', 'each client_id is 1-100 letters, digits, ".", "_", ":" or "-", and not a URL.');
      }
      const uris = record.redirect_uris;
      if (!Array.isArray(uris) || uris.length === 0) throw new ConfigError('OA_OAUTH_CLIENTS', `${clientId}: redirect_uris must list at least one URL.`);
      for (const uri of uris) {
        const problem = redirectUriProblem(uri);
        if (problem) throw new ConfigError('OA_OAUTH_CLIENTS', `${clientId}: the redirect URI ${String(uri)} ${problem}.`);
      }
      const name = typeof record.client_name === 'string' && record.client_name.trim() ? record.client_name.trim().slice(0, 100) : clientId;
      clients.push({ clientId, name, redirectUris: uris as string[] });
    }
  }

  const ttlText = env.OA_TEST_SNAPSHOT_TTL_SECONDS?.trim();
  let snapshotTtlSeconds: number | undefined;
  if (ttlText) {
    const ttl = Number(ttlText);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > SNAPSHOT_TOKEN_TTL_SECONDS) throw new ConfigError('OA_TEST_SNAPSHOT_TTL_SECONDS', `must be a whole number of seconds from 1 to ${SNAPSHOT_TOKEN_TTL_SECONDS}.`);
    snapshotTtlSeconds = ttl;
  }

  return {
    resource: `${config.appOrigin}${MCP_PATH}`,
    issuer: config.appOrigin,
    origins,
    clients,
    local: isLocalHostname(new URL(config.appOrigin).hostname),
    ...(snapshotTtlSeconds !== undefined ? { snapshotTtlSeconds } : {}),
  };
}
