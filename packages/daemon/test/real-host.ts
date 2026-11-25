/**
 * The real Node host (`packages/host`) for the daemon's Link tests, in this process over real HTTP: a temporary data
 * folder, a free port, fake editor assets for the whiteboard and docs types, and stub Shell pages. The daemon imports
 * the host's source by path (as it imports the type server's), so the host's own tests stay free of the daemon.
 *
 * Content hosts (`{id}.content.localhost`) have no DNS here: {@link call} sends an explicit `Host`.
 */

import { tempDir } from './helpers.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { parseConfig } from '../../host/src/core/config.ts';
import type { UserRecord } from '../../host/src/core/types.ts';
import { parseNodeEnv } from '../../host/src/node/env.ts';
import { startHost, type RunningHost } from '../../host/src/node/host.ts';

/** An HTTP answer, its body as text. */
export interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A request to 127.0.0.1:`port` with `url`'s host as the `Host` header. */
export function call(port: number, method: string, url: string, headers: Record<string, string> = {}, body?: string): Promise<Answer> {
  const target = new URL(url);
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: target.pathname + target.search, headers: { host: target.host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** A port nothing listens on now. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/** A running real host and what a test drives it with. */
export interface RealHost {
  host: RunningHost;
  port: number;
  /** The app origin, `http://localhost:<port>`. */
  app: string;
  /** A signed-in person: their record and the session cookie a browser would send. */
  person(name: string, email: string): Promise<{ user: UserRecord; cookie: string }>;
  /** Approves (or denies) a device sign-in as the person, with the headers the approval page's form sends. */
  decide(cookie: string, userCode: string, decision?: 'approve' | 'deny'): Promise<Answer>;
  stop(): Promise<void>;
}

/** Starts the real host on a free port with a temporary data folder; `extra` adds settings (`OA_TYPES_PUBLISH`, …). */
export async function startRealHost(extra: Record<string, string> = {}): Promise<RealHost> {
  const hostDir = tempDir('open-artifact-host-');
  const assets = join(hostDir, 'assets');
  for (const type of ['whiteboard', 'docs']) {
    mkdirSync(join(assets, 'editors', type, 'assets'), { recursive: true });
    writeFileSync(join(assets, 'editors', type, 'index.html'), '<!doctype html><html><head><script src="./assets/index-Ab12Cd34.js"></script></head><body></body></html>');
    writeFileSync(join(assets, 'editors', type, 'assets', 'index-Ab12Cd34.js'), '/* editor */');
  }
  writeFileSync(join(assets, 'support.js'), '/* runtime */');
  const uiDir = join(hostDir, 'ui');
  mkdirSync(join(uiDir, 'shell'), { recursive: true });
  mkdirSync(join(uiDir, 'home'), { recursive: true });
  writeFileSync(join(uiDir, 'shell', 'index.html'), '<!doctype html><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
  writeFileSync(join(uiDir, 'home', 'index.html'), '<!doctype html><script>window.home=/*__OPEN_ARTIFACT_HOME__*/null;</script>');

  const port = await freePort();
  const app = `http://localhost:${port}`;
  const config = parseConfig({ OA_APP_ORIGIN: app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`, OA_SIGNING_KEYS: 'k'.repeat(40), OA_OWNER_KEY: 'owner-key-for-the-remote-host-test-0123', ...extra });
  const env = parseNodeEnv({ OA_DATA_DIR: join(hostDir, 'data'), OA_PORT: String(port), OA_BIND: '127.0.0.1', OA_ASSETS_DIR: assets });
  const host = await startHost({ config, env, uiDir, log: () => undefined });
  return {
    host,
    port,
    app,
    async person(name, email) {
      const user = await host.catalog.createUser({ name, email, emailVerified: true });
      const cookie = `oa_session=${(await host.catalog.createSession({ userId: user.id, ttlMs: 3600_000 })).token}`;
      return { user, cookie };
    },
    decide(cookie, userCode, decision = 'approve') {
      return call(
        port,
        'POST',
        `${app}/link/device`,
        { cookie, origin: app, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'content-type': 'application/x-www-form-urlencoded' },
        new URLSearchParams({ user_code: userCode, decision }).toString(),
      );
    },
    stop: () => host.stop(),
  };
}
