/**
 * The daemon the plugin starts. DSH links a plugin folder in place and installs none of its dependencies, so the build
 * (scripts/build.mjs) puts what the daemon needs into `vendor/`:
 *
 *   vendor/open-artifact.mjs                    the daemon, one Node ESM file
 *   vendor/shell, vendor/home        the Shell and home pages, when built
 *   vendor/frame-host                the type server of original hosted artifact types (the daemon finds it next to open-artifact.mjs)
 *   vendor/harnesses                 the harness profiles
 *   vendor/type-server               the type server every built-in type runs: its CLI, editors and engines
 *   vendor/artifact-types            the built-in types (data, design, design-system, docs, motion, sheets, slides, whiteboard),
 *                                    each scripts/cli.mjs running vendor/type-server (scripts/vendor-types.mjs)
 *
 * and `scripts/open-artifact.mjs`, the open-artifact skill's launcher, with `vendor/runtime.json` (the version and the
 * protocols the daemon speaks). With those two the plugin folder is a runtime folder like the skill's
 * (`scripts/open-artifact.mjs` beside `vendor/`), which is what the daemon records from `hello` and what another
 * harness on this computer may start.
 *
 * Every harness on this computer shares one daemon: whichever starts it first decides these folders.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EnsureDaemonOptions } from '@open-artifact/harness-kit';
import { PROTOCOL_MAX, PROTOCOL_MIN, type HarnessRuntime } from '@open-artifact/protocol';

/** The package's name, as package.json and DSH know it. */
export const PACKAGE_NAME = 'dsh-open-artifact';

/**
 * The plugin folder: the nearest parent of this module whose package.json is this package's. This module runs from
 * `lib/index.js` once bundled and from `src/server/` in tests.
 */
export function packageRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name === PACKAGE_NAME) return dir;
    } catch {
      // no package.json here: look further up
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(from, '..');
    dir = parent;
  }
}

/** Where the vendored pieces are, under the plugin folder. */
export function vendorPaths(root: string = packageRoot()): { bin: string; shell: string; home: string; types: string; harnesses: string } {
  const vendor = join(root, 'vendor');
  return {
    bin: join(vendor, 'open-artifact.mjs'),
    shell: join(vendor, 'shell'),
    home: join(vendor, 'home'),
    types: join(vendor, 'artifact-types'),
    harnesses: join(vendor, 'harnesses'),
  };
}

/**
 * How to start the daemon when none runs. The vendored daemon is the plugin's own runtime (`own`): one candidate of
 * the kit's runtime choice, beside the runtimes other adapters registered and the shared ones under
 * `<home>/runtime/<version>/` — the newest compatible one starts, so a newer runtime already on this computer wins over
 * the vendored one, and the vendored one is never older than what runs (the plugin's version is the floor).
 *
 * The vendored Shell, home page, built-in types and harness profiles go into the environment
 * (`OPEN_ARTIFACT_SHELL_DIR`, `OPEN_ARTIFACT_HOME_DIR`, `OPEN_ARTIFACT_BUILTIN_TYPES`, `OPEN_ARTIFACT_HARNESS_PROFILES`)
 * unless it already names them; the kit drops them again when another runtime starts, which brings its own.
 *
 * `daemonBin` (a DSH setting) or `$OPEN_ARTIFACT_DAEMON_BIN` names one entry instead, and skips the choice.
 */
export function daemonOptions(config: { daemonBin?: string } = {}, root: string = packageRoot(), env: NodeJS.ProcessEnv = process.env): EnsureDaemonOptions {
  const paths = vendorPaths(root);
  const daemonEnv: NodeJS.ProcessEnv = { ...env };
  const folder = (name: string, dir: string) => {
    if (!daemonEnv[name] && existsSync(dir)) daemonEnv[name] = dir;
  };
  folder('OPEN_ARTIFACT_SHELL_DIR', paths.shell);
  folder('OPEN_ARTIFACT_HOME_DIR', paths.home);
  folder('OPEN_ARTIFACT_BUILTIN_TYPES', paths.types);
  folder('OPEN_ARTIFACT_HARNESS_PROFILES', paths.harnesses);
  if (config.daemonBin) return { env: daemonEnv, bin: config.daemonBin };
  if (!existsSync(paths.bin)) return { env: daemonEnv };
  const { dir, version } = runtimeOf(root);
  // The plugin starts the vendored daemon itself (`bin`), with the folders set above, not through the folder's
  // launcher. It is built from this release, so it speaks this protocol range.
  return { env: daemonEnv, own: { dir, bin: paths.bin, version, protocols: { min: PROTOCOL_MIN, max: PROTOCOL_MAX } } };
}

/**
 * The runtime this plugin carries, as `hello` declares it: the plugin folder (a runtime folder, `scripts/open-artifact.mjs`
 * beside `vendor/`) and the plugin's version (the daemon it vendors is built from the same release). DSH's plugin
 * manager updates the plugin, and the runtime with it: `bundled`.
 */
export function runtimeOf(root: string = packageRoot()): HarnessRuntime {
  let version = '0.0.0';
  try {
    version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? version;
  } catch {
    // no package.json: an unbuilt checkout
  }
  return { dir: root, version, update: 'bundled' };
}
