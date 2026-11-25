/**
 * The single executable (design 11, 15): `open-artifact-<platform>-<arch>`, one file per platform for a host that has
 * neither Node nor Electron (a Python, Go, Rust or Swift app). It is Node with this module as its entry and the runtime
 * (`@open-artifact/cli`'s folder: `scripts/open-artifact.mjs`, `vendor/` with the daemon, the Shell, the type server and
 * the built-in types) as one embedded gzip tarball. Built by `scripts/build-sea.mjs`.
 *
 * What it does, by its first argument:
 *
 * - a script (`<file>.mjs`, `.cjs` or `.js` that exists, relative to the current folder or absolute): runs it as
 *   `node <file> <args…>` would, with `process.argv` `[executable, <file>, …args]`. Every place the runtime starts a
 *   process of its own runs `process.execPath <script>` (the daemon start, the runtime switch, type servers and
 *   frame-host, the type server's own background server, the skill launcher's `open`), and in the executable
 *   `process.execPath` is the executable, so those work unchanged with no `node` on the computer. Nothing is unpacked
 *   in this mode. Node options go in `NODE_OPTIONS`.
 * - `--version`: prints the runtime's version.
 * - anything else: the `open-artifact` command line. The embedded runtime is unpacked once into the shared folder
 *   `<OPEN_ARTIFACT_HOME>/runtime/<version>/` the way `runtime update` installs one (sha512 checked against the
 *   embedded manifest, written to a staging folder, renamed into place, `.install.json` beside it), then its
 *   `scripts/open-artifact.mjs` runs with the arguments. The folder is an ordinary runtime: the selection rule
 *   (`runtimes.ts` in the kit) sees it as a shared one, and a newer runtime on the computer may still win. Whichever
 *   wins is run by this executable (a runtime folder is plain JavaScript), as long as its `engines.node` takes this
 *   executable's Node (`rankRuntimes` skips one that does not).
 */

import { randomBytes } from 'node:crypto';
import { existsSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import * as sea from 'node:sea';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { RUNTIME_ENTRY, parseVersion, runtimeInfo, sharedRuntimesOf } from '@open-artifact/harness-kit';
import { ensureDir, openArtifactHome, readJson } from './paths.ts';
import { readTarball, runtimeLog, verifyIntegrity, writeEntries, type InstallRecord } from './runtime.ts';

/** The asset that holds the runtime: a gzip tarball with one top folder (`package/`), as npm packs it. */
export const SEA_PAYLOAD = 'runtime.tgz';
/** The asset that says what the payload is ({@link SeaManifest}). */
export const SEA_MANIFEST = 'runtime.json';

/** What the executable carries, as `scripts/build-sea.mjs` writes it. */
export interface SeaManifest {
  /** The runtime's version (`@open-artifact/cli`'s). */
  version: string;
  /** The payload's sha512, `sha512-<base64>`. */
  integrity: string;
  /** The Harness API versions the runtime speaks. */
  protocols?: { min: number; max: number };
}

/** The runtime an executable carries: its manifest, and the payload read only when it is unpacked. */
export interface EmbeddedRuntime {
  manifest: SeaManifest;
  payload: () => Uint8Array;
}

/** `.install.json` of a runtime unpacked from an executable: an install record, and which executable it came from. */
export interface SeaInstallRecord extends InstallRecord {
  executable: string;
}

/** The runtime embedded in this executable, or `null` when this process is not one (or carries no runtime). */
export function embeddedRuntime(): EmbeddedRuntime | null {
  if (!sea.isSea()) return null;
  let manifest: SeaManifest;
  try {
    manifest = JSON.parse(sea.getAsset(SEA_MANIFEST, 'utf8')) as SeaManifest;
  } catch {
    return null;
  }
  return { manifest, payload: () => new Uint8Array(sea.getRawAsset(SEA_PAYLOAD)) };
}

/**
 * The script `args` asks to run (node's `node <file> …`), as an absolute path, or `null` when the first argument is a
 * command. A script is a file ending in `.mjs`, `.cjs` or `.js` that exists; no `open-artifact` command looks like one.
 */
export function scriptArgument(args: readonly string[], cwd: string = process.cwd()): string | null {
  const first = args[0];
  if (!first || first.startsWith('-') || !/\.(mjs|cjs|js)$/i.test(first)) return null;
  const file = isAbsolute(first) ? first : resolve(cwd, first);
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/**
 * Imports a module from disk with Node's own loader. The executable's entry is compiled as an embedded script whose
 * `import()` reaches only built-in modules, so the call is made from a script compiled with the main context's
 * default loader (the experimental warning that option raises is left out; nothing else is).
 */
function importFromDisk(file: string): Promise<unknown> {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String((warning as Error)?.message ?? warning).includes('USE_MAIN_CONTEXT_DEFAULT_LOADER')) return;
    (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    const options = { filename: 'open-artifact-sea-import.js', importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER } as vm.ScriptOptions;
    const load = new vm.Script('(url) => import(url)', options).runInThisContext() as (url: string) => Promise<unknown>;
    return load(pathToFileURL(file).href);
  } finally {
    process.emitWarning = emit;
  }
}

/** Runs `file` as `node <file> …args` does: `process.argv` becomes `[executable, file, …args]`. */
export function runScript(file: string, args: readonly string[]): Promise<unknown> {
  process.argv.splice(1, process.argv.length - 1, file, ...args);
  return importFromDisk(file);
}

const recordOf = (dir: string): Partial<SeaInstallRecord> | null => readJson<Partial<SeaInstallRecord> | null>(join(dir, '.install.json'), null);

/** A folder name in the shared folder that the selection rule skips and `pruneShared` removes once it is old. */
const asideName = (what: string, version: string): string => `.staging-${what}-${version}-${process.pid}-${randomBytes(4).toString('hex')}`;

/** What {@link ensureUnpacked} did. */
export interface UnpackResult {
  dir: string;
  /** `unpacked`: written now; `present`: this payload was there; `kept`: the same version from elsewhere was there. */
  state: 'unpacked' | 'present' | 'kept';
}

/**
 * The embedded runtime as a folder of the shared runtimes, `<home>/runtime/<version>/`, unpacked when it is not there:
 * the payload's sha512 is checked against the manifest, it is written to a staging folder, its `package.json` must
 * say that version, and the folder is renamed into place (another process that won the race wins). The same version
 * already there from elsewhere (installed from npm, copied from a host) is kept: it is that runtime. One that an
 * executable unpacked from a different payload (a rebuilt executable of the same version) is replaced.
 */
export function ensureUnpacked(embedded: EmbeddedRuntime, options: { home?: string; executable?: string } = {}): UnpackResult {
  const { manifest } = embedded;
  if (!parseVersion(manifest.version)) throw new Error(`the embedded runtime has no valid version (${JSON.stringify(manifest.version)})`);
  const root = ensureDir(sharedRuntimesOf(options.home ?? openArtifactHome()));
  const target = join(root, manifest.version);
  const there = runtimeInfo(target);
  const record = there ? recordOf(target) : null;
  if (there && (!there.version || there.version === manifest.version)) {
    if (record?.integrity === manifest.integrity) return { dir: target, state: 'present' };
    if (!record?.executable) return { dir: target, state: 'kept' };
  }
  const payload = embedded.payload();
  verifyIntegrity(payload, manifest.integrity);
  const entries = readTarball(payload);
  const staging = join(root, asideName('sea', manifest.version));
  try {
    writeEntries(entries, staging);
    const pkg = readJson<{ version?: unknown } | null>(join(staging, 'package.json'), null);
    if (pkg?.version !== manifest.version) throw new Error(`the embedded runtime's package.json says ${String(pkg?.version)}, not ${manifest.version}`);
    if (!runtimeInfo(staging)) throw new Error(`the embedded runtime has no ${RUNTIME_ENTRY}`);
    const install: SeaInstallRecord = {
      version: manifest.version,
      integrity: manifest.integrity,
      tarball: SEA_PAYLOAD,
      registry: 'executable',
      installedAt: new Date().toISOString(),
      attestation: { present: false, verified: false },
      executable: options.executable ?? process.execPath,
    };
    writeFileSync(join(staging, '.install.json'), `${JSON.stringify(install, null, 2)}\n`);
    // A folder in the way (a broken one, or another payload of this version) is moved aside first, then removed.
    let aside: string | null = null;
    if (existsSync(target)) {
      aside = join(root, asideName('old', manifest.version));
      try {
        renameSync(target, aside);
      } catch {
        // In use and not movable (Windows): the one there stays.
        rmSync(staging, { recursive: true, force: true });
        return { dir: target, state: 'kept' };
      }
    }
    try {
      renameSync(staging, target);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      // Another process unpacked it first.
      if (!runtimeInfo(target)) throw error;
      return { dir: target, state: 'present' };
    } finally {
      if (aside) rmSync(aside, { recursive: true, force: true });
    }
    runtimeLog(`unpacked ${manifest.version} from the executable ${install.executable} into ${target} (sha512 verified)`);
    return { dir: target, state: 'unpacked' };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function fail(message: string): never {
  process.stderr.write(`open-artifact: ${message}\n`);
  process.exit(1);
}

/** The executable's entry (see the top of this file). */
export async function seaMain(): Promise<void> {
  const args = process.argv.slice(2);
  const script = scriptArgument(args);
  if (script) {
    await runScript(script, args.slice(1));
    return;
  }
  const embedded = embeddedRuntime();
  if (!embedded) fail('this executable carries no runtime (build it with node scripts/build-sea.mjs).');
  if (args[0] === '--version' && args.length === 1) {
    process.stdout.write(`${embedded.manifest.version}\n`);
    return;
  }
  let dir: string;
  try {
    dir = ensureUnpacked(embedded).dir;
  } catch (error) {
    fail(`could not unpack the runtime into ${join(sharedRuntimesOf(openArtifactHome()), embedded.manifest.version)}: ${(error as Error)?.message ?? error}`);
  }
  await runScript(join(dir, RUNTIME_ENTRY), args);
}
