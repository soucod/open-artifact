/**
 * A host for the auth tests: a fresh catalog (node:sqlite in a temp folder),
 * a movable clock, the auth routes on a router, and a tiny cookie jar.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { parseConfig } from '../src/core/config.ts';
import { Router, type BaseCtx } from '../src/core/http.ts';
import type { ProviderDeps } from '../src/core/auth/provider.ts';
import { authRoutes } from '../src/core/auth/routes.ts';
import type { HostConfig } from '../src/core/types.ts';
import { openSqlite } from '../src/node/sqlite.ts';

export const SIGNING_KEY = 's'.repeat(40);

export interface TestHost {
  config: HostConfig;
  catalog: Catalog;
  ctx: BaseCtx;
  logs: string[];
  /** Moves the clock. */
  advance(ms: number): void;
  /** Answers a request through the auth routes. `path` is on the app origin unless absolute. */
  fetch(path: string, init?: RequestInit & { cookies?: Record<string, string> }): Promise<Response>;
  close(): Promise<void>;
}

export async function makeHost(env: Record<string, string> = {}, deps: ProviderDeps = {}): Promise<TestHost> {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-auth-'));
  const driver = openSqlite(join(dir, 'catalog.db'));
  const config = parseConfig({ OA_SIGNING_KEYS: SIGNING_KEY, ...env });
  let clock = new Date('2026-06-01T00:00:00.000Z');
  const now = (): Date => clock;
  const catalog = await Catalog.open(driver, { signingKeys: config.signingKeys, now });
  const logs: string[] = [];
  const ctx: BaseCtx = { config, catalog, now, log: (line) => logs.push(line) };
  const router = authRoutes(new Router(), deps);
  return {
    config,
    catalog,
    ctx,
    logs,
    advance(ms) {
      clock = new Date(clock.getTime() + ms);
    },
    async fetch(path, init = {}) {
      const { cookies, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (cookies && Object.keys(cookies).length > 0) headers.set('cookie', Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '));
      const url = path.startsWith('http') ? path : `${config.appOrigin}${path}`;
      return router.handle(new Request(url, { ...rest, headers }), ctx);
    },
    async close() {
      driver.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** The `name=value` pairs a response sets (deleted cookies as empty strings). */
export function setCookies(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of response.headers.getSetCookie()) {
    const first = line.split(';')[0]!;
    const eq = first.indexOf('=');
    out[first.slice(0, eq)] = decodeURIComponent(first.slice(eq + 1));
  }
  return out;
}

/** The full `Set-Cookie` line for a cookie name. */
export function setCookieLine(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

/** A urlencoded form POST from the app origin. */
export function form(fields: Record<string, string>, origin?: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) },
    body: new URLSearchParams(fields).toString(),
  };
}
