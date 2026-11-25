/**
 * The host origins connected adapters declared (`caps.open.origins`), from the daemon's `GET /api/open-artifact.embed`:
 * the Shell and the home page take `host_hello` only from these while there are any.
 */

import { LIBRARY_ROUTES } from '@open-artifact/protocol';

/** The declared host origins; `null` when they could not be read (a cloud host, a type server's own Shell). */
export async function declaredHosts(): Promise<string[] | null> {
  try {
    const response = await fetch(`/api/open-artifact.${LIBRARY_ROUTES.embed}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { hosts?: unknown };
    return Array.isArray(body.hosts) ? body.hosts.filter((h): h is string => typeof h === 'string') : null;
  } catch {
    return null;
  }
}
