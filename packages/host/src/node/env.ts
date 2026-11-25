/**
 * The Node host's own settings, beside the shared `HostConfig`:
 * `OA_DATA_DIR` (default `~/.open-artifact-host`), `OA_PORT` (default 4900),
 * `OA_BIND` (default `127.0.0.1`; the host is meant to sit behind a
 * reverse proxy) and `OA_ASSETS_DIR` (default: this checkout's built
 * `dist/server`, with the editors the embedded type server serves).
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '../core/config.ts';

export interface NodeHostEnv {
  /** Absolute folder of the catalog database and the artifacts. */
  dataDir: string;
  port: number;
  bind: string;
  /** Absolute folder with `editors/<type>/`, `shell/` and `support.js` (the type server's `assetsDir`). */
  assetsDir: string;
}

/** The repository's `dist/server`, resolved from this package (`packages/host/src/node/`). */
export const DEFAULT_ASSETS_DIR = fileURLToPath(new URL('../../../../dist/server', import.meta.url));

/** `OA_DATA_DIR` as an absolute folder (default `~/.open-artifact-host`). */
export function dataDirOf(env: Record<string, string | undefined>): string {
  return resolve(env.OA_DATA_DIR?.trim() || join(homedir(), '.open-artifact-host'));
}

export function parseNodeEnv(env: Record<string, string | undefined>): NodeHostEnv {
  const dataDir = dataDirOf(env);
  const portText = env.OA_PORT?.trim() || '4900';
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('OA_PORT', `must be a port number (0-65535), not "${portText}".`);
  const bind = env.OA_BIND?.trim() || '127.0.0.1';
  const given = env.OA_ASSETS_DIR?.trim();
  const assetsDir = resolve(given || DEFAULT_ASSETS_DIR);
  if (!existsSync(join(assetsDir, 'editors'))) {
    throw new ConfigError(
      'OA_ASSETS_DIR',
      given
        ? `${assetsDir} has no editors/ folder: point it at a built dist/server.`
        : `the editors are not built (${join(assetsDir, 'editors')} is missing): run \`npm run build\` in the Open Artifact checkout first, or set OA_ASSETS_DIR to a built dist/server.`,
    );
  }
  return { dataDir, port, bind, assetsDir };
}
