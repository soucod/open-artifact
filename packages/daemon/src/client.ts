/**
 * The client side of the daemon, for harness adapters and the `open-artifact` command: find or start the daemon, call
 * its Library API, and hold a Harness API connection.
 *
 * The code lives in `@open-artifact/harness-kit`; this module re-exports it with the daemon's own defaults: this build
 * is the caller's own runtime (one candidate among the registered and shared runtimes, the newest compatible of which
 * starts; `runtimes.ts` in the kit), and a running daemon older than this package is replaced.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HarnessClient as KitHarnessClient,
  ensureDaemon as kitEnsureDaemon,
  RUNTIME_ENTRY,
  type EnsureDaemonOptions,
  type HarnessClientOptions,
  type OwnRuntime,
} from '@open-artifact/harness-kit';
import { PROTOCOL_MAX, PROTOCOL_MIN, type DaemonState } from '@open-artifact/protocol';
import pkg from '../package.json' with { type: 'json' };

export { api, isOlderVersion, readDaemon, type ApiOptions, type EnsureDaemonOptions, type HarnessClientOptions, type HarnessConnectionState } from '@open-artifact/harness-kit';

/** This client's daemon version, the one {@link ensureDaemon} starts. */
const VERSION: string = (pkg as { version?: string }).version ?? '0.0.0';

/**
 * This build as a runtime. Bundled (`vendor/open-artifact.mjs` of a runtime folder, whose launcher is
 * `scripts/open-artifact.mjs`): that folder. From source: `bin/open-artifact.ts` beside this file.
 */
export function ownRuntime(): OwnRuntime {
  const here = fileURLToPath(import.meta.url);
  const protocols = { min: PROTOCOL_MIN, max: PROTOCOL_MAX };
  if (here.endsWith('.mjs')) {
    const root = resolve(dirname(here), '..');
    if (existsSync(join(root, RUNTIME_ENTRY))) return { dir: root, version: VERSION, protocols };
    return { bin: here, version: VERSION, protocols };
  }
  return { bin: resolve(dirname(here), 'bin', 'open-artifact.ts'), version: VERSION, protocols };
}

/**
 * The `open-artifact` entry this build starts when it is chosen: `$OPEN_ARTIFACT_DAEMON_BIN`, else its own entry (see
 * {@link ownRuntime}).
 */
export function defaultDaemonBin(): string {
  const own = ownRuntime();
  return process.env.OPEN_ARTIFACT_DAEMON_BIN || own.bin || join(own.dir!, RUNTIME_ENTRY);
}

/** The daemon's defaults under `options`: this build as the caller's own runtime, and its version as the oldest to keep. */
function withDefaults(options: EnsureDaemonOptions = {}): EnsureDaemonOptions {
  return { own: ownRuntime(), version: VERSION, ...options };
}

/**
 * The running daemon, started in the background when there is none (the newest compatible runtime on this computer,
 * this build among them). A daemon older than this client is replaced, so an upgraded harness gets its own types and
 * tools; the harnesses connected to the old one reconnect.
 */
export function ensureDaemon(options: EnsureDaemonOptions = {}): Promise<DaemonState> {
  return kitEnsureDaemon(withDefaults(options));
}

/** A Harness API connection (see `@open-artifact/harness-kit`) that starts this package's daemon. */
export class HarnessClient extends KitHarnessClient {
  constructor(options: HarnessClientOptions) {
    super({ ...options, daemon: withDefaults(options.daemon) });
  }
}
