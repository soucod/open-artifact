/**
 * The on-demand TLS "ask" endpoint: a reverse proxy that issues certificates as names are first visited (Caddy's
 * `on_demand_tls { ask … }`) asks here before it requests one, so it only ever asks a certificate authority for names
 * this host serves.
 *
 *     GET /tls-ask?domain=<name>   200 for the app host, for the content host of an artifact that exists and is
 *                                  not in the trash, and (only with `OA_PAGE_HOST_ON_DEMAND_TLS=true`) for a page
 *                                  artifact's page host (`<idlabel>--<opaque>`) whose opaque part names someone with
 *                                  access now; 404 for anything else
 *
 * Page hosts are refused by default. Every certificate a public authority issues is written to the Certificate
 * Transparency logs, which anyone can read; a page host's name carries a per-person opaque part, so certificates
 * issued for page hosts would publish who opened which page and when. Serve page artifacts with a wildcard certificate
 * for the content domain instead (`*.<content domain>`), which names nobody; set the variable only where that is not
 * a concern (a private authority, a test site).
 *
 * It answers on its own listener (`OA_INTERNAL_PORT`, bound to `OA_INTERNAL_BIND`, default `127.0.0.1`), never on the
 * public one: whether a name is an artifact's is not the internet's to ask. Answers are cached briefly, so a burst of
 * handshakes for one name costs one catalog read.
 *
 * Variables (Node only): `OA_INTERNAL_PORT` (unset: no internal listener), `OA_INTERNAL_BIND`, and
 * `OA_PAGE_HOST_ON_DEMAND_TLS` (`true` allows page hosts; default refuses them).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Catalog } from '../core/catalog/catalog.ts';
import { ConfigError } from '../core/config.ts';
import { pageHostOf } from '../core/page-host.ts';
import { artifactOfContentHost } from '../core/page-token.ts';
import type { HostConfig } from '../core/types.ts';

/** The path the proxy asks. */
export const TLS_ASK_PATH = '/tls-ask';
/** How long an answer is kept, ms. */
export const TLS_ASK_CACHE_MS = 30_000;
/** The most answers kept at once (the cache is emptied when it is full). */
const MAX_CACHED = 10_000;

export interface TlsAskOptions {
  config: Pick<HostConfig, 'appOrigin' | 'contentOrigin'>;
  catalog: Pick<Catalog, 'getArtifact'>;
  /** How long an answer is kept, ms (default {@link TLS_ASK_CACHE_MS}). */
  cacheMs?: number;
  /** The clock, ms (tests move it). */
  now?: () => number;
  /**
   * Whether a page host (the `Host` form, port included) names someone with access now (the frame engine's check);
   * absent: no page host is allowed (a site that runs no page artifact).
   */
  pageHost?: (host: string) => Promise<boolean>;
  /**
   * Whether page hosts may get a certificate on demand (`OA_PAGE_HOST_ON_DEMAND_TLS=true`). Off by default: their
   * names would land in the public Certificate Transparency logs, so page artifacts want a wildcard certificate.
   */
  pageHostsOnDemand?: boolean;
}

/** The internal listener's settings from the environment, or null when `OA_INTERNAL_PORT` is unset. */
export function parseInternalEnv(env: Record<string, string | undefined>): { port: number; bind: string } | null {
  const text = env.OA_INTERNAL_PORT?.trim();
  if (!text) return null;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('OA_INTERNAL_PORT', `must be a port number (0-65535), not "${text}".`);
  return { port, bind: env.OA_INTERNAL_BIND?.trim() || '127.0.0.1' };
}

/** `OA_PAGE_HOST_ON_DEMAND_TLS`: whether the ask endpoint allows page hosts (default false). */
export function parsePageHostOnDemand(env: Record<string, string | undefined>): boolean {
  const text = env.OA_PAGE_HOST_ON_DEMAND_TLS?.trim().toLowerCase();
  if (!text || text === 'false' || text === '0') return false;
  if (text === 'true' || text === '1') return true;
  throw new ConfigError('OA_PAGE_HOST_ON_DEMAND_TLS', `must be true or false, not "${env.OA_PAGE_HOST_ON_DEMAND_TLS}".`);
}

/** A domain as a proxy sends it, normalised (lower case, no trailing dot), or null when it is not a host name. */
function domainOf(text: string | null): string | null {
  const name = text?.trim().toLowerCase().replace(/\.$/, '');
  if (!name || name.length > 253 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(name)) return null;
  return name;
}

/** Whether a certificate may be issued for `domain`: the app host, or a live artifact's content host. */
export function tlsAllowed(options: TlsAskOptions): (domain: string) => Promise<boolean> {
  const cacheMs = options.cacheMs ?? TLS_ASK_CACHE_MS;
  const now = options.now ?? Date.now;
  const appHost = new URL(options.config.appOrigin).hostname;
  // A proxy asks for the bare name; the template may carry a port (development), which the Host form needs.
  const contentPort = new URL(options.config.contentOrigin.replace('{id}', 'x')).port;
  const cache = new Map<string, { ok: boolean; at: number }>();

  const decide = async (domain: string): Promise<boolean> => {
    if (domain === appHost) return true;
    const host = contentPort ? `${domain}:${contentPort}` : domain;
    const id = artifactOfContentHost(options.config, host);
    // A page host: only when allowed, and only one the engine can place (a made-up `art-x--…` name costs a
    // certificate request nothing).
    if (!id) return !!options.pageHostsOnDemand && pageHostOf(options.config, host) !== null && !!options.pageHost && (await options.pageHost(host));
    const artifact = await options.catalog.getArtifact(id);
    return !!artifact && artifact.trashedAt === null;
  };

  return async (text) => {
    const domain = domainOf(text);
    if (!domain) return false;
    const at = now();
    const hit = cache.get(domain);
    if (hit && at - hit.at < cacheMs) return hit.ok;
    const ok = await decide(domain);
    if (cache.size >= MAX_CACHED) cache.clear();
    cache.set(domain, { ok, at });
    return ok;
  };
}

/** The ask endpoint as a Node listener: `GET|HEAD /tls-ask?domain=`; everything else is 404. */
export function tlsAskHandler(options: TlsAskOptions & { log?: (line: string) => void }): (req: IncomingMessage, res: ServerResponse) => void {
  const allowed = tlsAllowed(options);
  const log = options.log ?? (() => undefined);
  const answer = (res: ServerResponse, status: number): void => {
    const body = status === 200 ? 'ok\n' : 'not found\n';
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
    res.end(res.req.method === 'HEAD' ? undefined : body);
  };
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://internal');
    if ((req.method !== 'GET' && req.method !== 'HEAD') || url.pathname !== TLS_ASK_PATH) return answer(res, 404);
    allowed(url.searchParams.get('domain') ?? '').then(
      (ok) => answer(res, ok ? 200 : 404),
      (error: unknown) => {
        log(`tls-ask: ${error instanceof Error ? error.message : String(error)}`);
        answer(res, 503);
      },
    );
  };
}

export interface InternalListener {
  server: Server;
  /** Where it listens, e.g. `http://127.0.0.1:4901`. */
  listening: string;
  port: number;
  stop(): Promise<void>;
}

/** Starts the internal listener with the ask endpoint on `port` at `bind`. */
export async function startTlsAsk(options: TlsAskOptions & { port: number; bind: string; log?: (line: string) => void }): Promise<InternalListener> {
  const server = createServer(tlsAskHandler(options));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.bind, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    listening: `http://${options.bind.includes(':') ? `[${options.bind}]` : options.bind}:${port}`,
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
