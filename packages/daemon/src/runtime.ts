/**
 * The Open Artifact runtime: which ones are on this computer, and how it updates itself (design 10.1, 10.2, 13).
 *
 * Runtimes (`@open-artifact/cli` folders) come from three places: a host's own (registered in `hello`'s `runtime`,
 * kept in `<home>/runtimes.json`), the shared folder `<home>/runtime/<version>/`, and the command line's own build.
 * Which one starts the daemon is chosen in the kit (`@open-artifact/harness-kit`, `runtimes.ts`): the newest
 * compatible. This module keeps the registry, copies the newest runtime a host brought into the shared folder (so
 * uninstalling that host does not take the machine back to an older daemon), and updates from npm.
 *
 * Updates. Source: the npm package `@open-artifact/cli`, from the registry of the usual npm configuration
 * (`$npm_config_registry`, the `@open-artifact:registry` or `registry` of `~/.npmrc`), overridden by
 * `$OPEN_ARTIFACT_REGISTRY` or `settings.json` `runtime.registry`; plain `http` only for a loopback registry. A check
 * requests the package's metadata (no credentials, no cookies, nothing about the person or their artifacts) and picks
 * the newest version that is no pre-release, not deprecated, within the person's pin, runs on this Node, and speaks the
 * Harness API of every adapter seen lately. An update downloads its tarball, refuses it unless its sha512 matches the
 * registry's `dist.integrity`, unpacks it with the reader below into a staging folder and renames that to
 * `<home>/runtime/<version>/`. The daemon switches to a newer runtime only once it is idle (no open pages, no tool
 * call or long action running), or it is used at the next start.
 *
 * Provenance: the registry's attestation (`dist.attestations`) is recorded as present or not and shown by
 * `runtime status`; it is not verified (that takes Sigstore's trust root, certificate chain and transparency-log
 * checks, which this runtime does not carry). What is verified is the integrity digest, which ties the tarball to
 * the registry's metadata, fetched over https.
 *
 * Policy (`prompt` by default): the person's `settings.json` `runtime.update` wins over the adapters' `runtime.update`
 * (the most conservative of the registered ones); `$OPEN_ARTIFACT_RUNTIME_UPDATE=off` or a machine policy file with
 * `{"runtimeUpdate": "off"}` switches checks and updates off for the whole computer (`$OPEN_ARTIFACT_MACHINE_POLICY`,
 * else `/Library/Application Support/Open Artifact/policy.json`, `/etc/open-artifact/policy.json`,
 * `%ProgramData%\Open Artifact\policy.json`). `prompt` checks at most once a day and tells subscribed adapters
 * (`runtime/update`); `auto` also downloads; `bundled` never checks.
 */

import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  LEGACY_PROTOCOLS,
  compareVersions,
  isPrerelease,
  missingRuntimes,
  parseVersion,
  protocolRangeOf,
  rangesMeet,
  rankRuntimes,
  readRuntimePin,
  readRuntimesFile,
  runtimeCandidates,
  runtimeEnv,
  runtimeInfo,
  runtimesFileOf,
  satisfies,
  sharedRuntimes,
  sharedRuntimesOf,
  validRange,
  type OwnRuntime,
  type RuntimeCandidate,
  type RuntimeRecord,
  type RuntimesFile,
} from '@open-artifact/harness-kit';
import {
  OpenArtifactError,
  PROTOCOL_MAX,
  PROTOCOL_MIN,
  type HelloParams,
  type ProtocolRange,
  type RuntimeCheck,
  type RuntimeSource,
  type RuntimeStatus,
  type RuntimeUpdateEvent,
  type RuntimeUpdatePolicy,
  type RuntimeUpdateResult,
} from '@open-artifact/protocol';
import { ensureDir, files, openArtifactHome, readJson, writeJson } from './paths.ts';

/** The npm package a runtime is. */
export const RUNTIME_PACKAGE = '@open-artifact/cli';
/** The registry when nothing else names one. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';
/** How often a background check may run. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60_000;
/** The largest tarball downloaded, and the most it may unpack to. */
const MAX_TARBALL = 256 << 20;
const MAX_UNPACKED = 1024 << 20;
/** The largest package metadata read. */
const MAX_METADATA = 32 << 20;
/** How long adapters' protocol ranges count for an update's compatibility. */
const ADAPTER_MEMORY_MS = 90 * 24 * 60 * 60_000;
/** Shared runtimes kept besides the one running. */
const KEEP_SHARED = 3;

/** `<home>/runtime-update.json`: the last check. */
export const runtimeCheckFile = (): string => join(openArtifactHome(), 'runtime-update.json');

/** Appends a line to the daemon log (installs and switches are recorded there, design 13). */
export function runtimeLog(line: string): void {
  try {
    ensureDir(files.logs());
    appendFileSync(files.daemonLog(), `[${new Date().toISOString()}] runtime: ${line}\n`);
  } catch {
    /* nowhere to log */
  }
}

// ---- settings and policy --------------------------------------------------------------------------------------------

/** `settings.json`'s `runtime`: what the person set. */
export interface RuntimeSettings {
  update?: RuntimeUpdatePolicy;
  pin?: string;
  registry?: string;
}

const POLICIES: readonly RuntimeUpdatePolicy[] = ['auto', 'prompt', 'bundled'];
const isPolicy = (value: unknown): value is RuntimeUpdatePolicy => POLICIES.includes(value as RuntimeUpdatePolicy);

/** The person's runtime settings. */
export function runtimeSettings(): RuntimeSettings {
  const saved = readJson<{ runtime?: Record<string, unknown> } | null>(files.settings(), null)?.runtime ?? {};
  return {
    ...(isPolicy(saved.update) ? { update: saved.update } : {}),
    ...(typeof saved.pin === 'string' && validRange(saved.pin) ? { pin: saved.pin.trim() } : {}),
    ...(typeof saved.registry === 'string' && saved.registry ? { registry: saved.registry } : {}),
  };
}

/** Changes `settings.json`'s `runtime`: a value sets its key, `null` removes it. */
export function saveRuntimeSettings(patch: { [K in keyof RuntimeSettings]?: RuntimeSettings[K] | null }): void {
  const saved = readJson<Record<string, unknown> | null>(files.settings(), {}) ?? {};
  const runtime: Record<string, unknown> = { ...((saved.runtime as Record<string, unknown>) ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete runtime[key];
    else if (value !== undefined) runtime[key] = value;
  }
  const next = { ...saved, runtime };
  if (!Object.keys(runtime).length) delete (next as { runtime?: unknown }).runtime;
  writeJson(files.settings(), next);
}

/** The machine policy file this computer's administrator may place. */
export function machinePolicyFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OPEN_ARTIFACT_MACHINE_POLICY) return env.OPEN_ARTIFACT_MACHINE_POLICY;
  if (process.platform === 'darwin') return '/Library/Application Support/Open Artifact/policy.json';
  if (process.platform === 'win32') return join(env.ProgramData || 'C:\\ProgramData', 'Open Artifact', 'policy.json');
  return '/etc/open-artifact/policy.json';
}

/** Whether updates are off for the whole computer, and by what. */
export function machineOff(env: NodeJS.ProcessEnv = process.env): string | null {
  if (/^(off|0|false|no|disabled)$/i.test(env.OPEN_ARTIFACT_RUNTIME_UPDATE ?? '')) return 'OPEN_ARTIFACT_RUNTIME_UPDATE';
  const file = machinePolicyFile(env);
  const policy = readJson<{ runtimeUpdate?: unknown } | null>(file, null);
  return policy && /^(off|disabled)$/i.test(String(policy.runtimeUpdate ?? '')) ? file : null;
}

/** The policies the registered adapters said, by harness (folders that are gone and the daemon's own entry left out). */
function adapterPolicies(): Map<string, RuntimeUpdatePolicy> {
  const home = openArtifactHome();
  const missing = new Set(missingRuntimes(home).map((r) => r.dir));
  const out = new Map<string, RuntimeUpdatePolicy>();
  for (const record of readRuntimesFile(home).runtimes) {
    if (!record.update || missing.has(record.dir) || record.harness === 'daemon') continue;
    const harness = record.harness ?? record.dir;
    // One harness with several runtimes: its most conservative word counts.
    const seen = out.get(harness);
    if (!seen || STRICTNESS[record.update] > STRICTNESS[seen]) out.set(harness, record.update);
  }
  return out;
}

const STRICTNESS: Record<RuntimeUpdatePolicy, number> = { auto: 0, prompt: 1, bundled: 2 };

/**
 * The update policy in effect: machine off, else the person's setting, else the adapters', else `prompt`.
 *
 * Among adapters, one that says `bundled` (it ships its own runtime and updates it itself) abstains: it speaks for its own
 * runtime, not for the computer, so installing it does not silence updates for every other host. Of the others the more
 * conservative wins (`prompt` over `auto`). Only when every registered adapter says `bundled` is the result `bundled`.
 */
export function effectivePolicy(env: NodeJS.ProcessEnv = process.env): RuntimeStatus['policy'] {
  if (machineOff(env)) return { update: 'off', source: 'machine' };
  const own = runtimeSettings().update;
  if (own) return { update: own, source: 'settings' };
  const said = [...adapterPolicies().values()];
  if (!said.length) return { update: 'prompt', source: 'default' };
  const voting = said.filter((p) => p !== 'bundled');
  if (!voting.length) return { update: 'bundled', source: 'adapter' };
  return { update: voting.reduce((a, b) => (STRICTNESS[b] > STRICTNESS[a] ? b : a)), source: 'adapter' };
}

/** The harnesses whose adapter said `bundled`: they get no `runtime/update` event (they update their own runtime). */
export function bundledHarnesses(): Set<string> {
  return new Set([...adapterPolicies()].filter(([, policy]) => policy === 'bundled').map(([harness]) => harness));
}

/** Whether a host may update the runtime over the Harness API: not when the person said `bundled` or the computer is off. */
export function hostUpdateRefusal(env: NodeJS.ProcessEnv = process.env): OpenArtifactError | null {
  const off = machineOff(env);
  if (off) return new OpenArtifactError('not_granted', `Runtime updates are switched off for this computer (${off}).`, { fix: 'Ask whoever manages this computer.' });
  if (runtimeSettings().update === 'bundled')
    return new OpenArtifactError('not_granted', 'The person set runtime updates to bundled; a host may not update the runtime.', {
      fix: 'The person can run `open-artifact runtime update` themselves, or change the setting with `open-artifact runtime policy`.',
    });
  return null;
}

// ---- the registry ---------------------------------------------------------------------------------------------------

/** `key=value` lines of an `.npmrc`. */
function npmrc(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^#;=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) out[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * The registry updates come from: `$OPEN_ARTIFACT_REGISTRY`, `settings.json` `runtime.registry`, then npm's own
 * configuration (`$npm_config_@open-artifact:registry`, `$npm_config_registry`, then the user `.npmrc`), then
 * {@link DEFAULT_REGISTRY}. Always ends with `/`.
 */
export function registryUrl(env: NodeJS.ProcessEnv = process.env): string {
  const scope = '@open-artifact:registry';
  const lower = (name: string): string | undefined => env[name] ?? env[name.toUpperCase()];
  const rc = npmrc(env.NPM_CONFIG_USERCONFIG || env.npm_config_userconfig || join(homedir(), '.npmrc'));
  const named = env.OPEN_ARTIFACT_REGISTRY || runtimeSettings().registry || lower(`npm_config_${scope}`) || lower('npm_config_registry') || rc[scope] || rc.registry || DEFAULT_REGISTRY;
  return named.endsWith('/') ? named : `${named}/`;
}

/** Refuses an address that is not https, unless it is this computer (a test or a local mirror). */
function checkTransport(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new OpenArtifactError('invalid_argument', `Not an address: ${address}`);
  }
  const loopback = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/i.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new OpenArtifactError('not_granted', `Updates come only over https (${url.origin}).`, { fix: 'Use an https registry (OPEN_ARTIFACT_REGISTRY, settings.json runtime.registry).' });
  }
  if (url.username || url.password) throw new OpenArtifactError('not_granted', 'The registry address carries credentials; updates send none.');
  return url;
}

/** Reads a response body, at most `limit` bytes; throws when it ends early or is larger. */
async function readBody(response: Response, limit: number, what: string): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > limit) throw new OpenArtifactError('too_large', `${what} is ${declared} bytes, more than ${limit}.`);
  if (!response.body) throw new OpenArtifactError('error', `${what}: no body.`);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > limit) throw new OpenArtifactError('too_large', `${what} is more than ${limit} bytes.`);
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error instanceof OpenArtifactError) throw error;
    throw new OpenArtifactError('download_failed', `${what} was interrupted: ${(error as Error)?.message ?? error}`);
  }
  if (Number.isFinite(declared) && size !== declared) throw new OpenArtifactError('download_failed', `${what} ended after ${size} of ${declared} bytes.`);
  return Buffer.concat(chunks);
}

/** A GET with no credentials and nothing about the person: only the address and a generic client name. */
async function get(address: string, accept: string, timeoutMs: number): Promise<Response> {
  checkTransport(address);
  let response: Response;
  try {
    response = await fetch(address, {
      headers: { accept, 'user-agent': 'open-artifact-runtime' },
      redirect: 'follow',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new OpenArtifactError('download_failed', `Could not reach ${new URL(address).origin}: ${(error as Error)?.message ?? error}`);
  }
  // A redirect may not take the request off https.
  checkTransport(response.url || address);
  if (!response.ok) throw new OpenArtifactError(response.status === 404 ? 'not_found' : 'download_failed', `${new URL(address).origin} answered ${response.status}.`);
  return response;
}

/** One version of the package as the registry describes it. */
export interface PackageVersion {
  version: string;
  deprecated?: unknown;
  engines?: { node?: string };
  openArtifact?: { protocols?: unknown };
  dist?: { tarball?: string; integrity?: string; shasum?: string; attestations?: { url?: string; provenance?: { predicateType?: string } } };
}

/** The registry's metadata of the package. */
export interface Packument {
  name?: string;
  versions?: Record<string, PackageVersion>;
  'dist-tags'?: Record<string, string>;
}

/** Fetches the package's metadata from `registry`. */
export async function fetchPackument(registry: string = registryUrl()): Promise<Packument> {
  const address = `${registry}${RUNTIME_PACKAGE.replace('/', '%2f')}`;
  const response = await get(address, 'application/json', 20_000);
  const body = await readBody(response, MAX_METADATA, 'The package metadata');
  try {
    return JSON.parse(body.toString('utf8')) as Packument;
  } catch {
    throw new OpenArtifactError('download_failed', 'The package metadata is not JSON.');
  }
}

/** The sha512 digests an SRI string names (`sha512-<base64>`), base64. */
function sha512Of(integrity: unknown): string[] {
  if (typeof integrity !== 'string') return [];
  return integrity
    .trim()
    .split(/\s+/)
    .map((token) => /^sha512-([A-Za-z0-9+/]+={0,2})(?:\?.*)?$/.exec(token)?.[1])
    .filter((digest): digest is string => !!digest);
}

/** Throws unless `data`'s sha512 is one `integrity` names. A version without a sha512 is refused. */
export function verifyIntegrity(data: Uint8Array, integrity: unknown): void {
  const wanted = sha512Of(integrity);
  if (!wanted.length) throw new OpenArtifactError('integrity_failed', 'The registry gives no sha512 integrity for this version; it is not installed.');
  const actual = createHash('sha512').update(data).digest('base64');
  if (!wanted.includes(actual)) {
    throw new OpenArtifactError('integrity_failed', `The downloaded tarball does not match the registry's integrity (sha512-${actual.slice(0, 16)}…); it is not installed.`);
  }
}

/** The protocol ranges an update must speak: this build's and every adapter's seen in the last 90 days. */
export function requiredProtocols(now = Date.now()): ProtocolRange[] {
  const ranges: ProtocolRange[] = [{ min: PROTOCOL_MIN, max: PROTOCOL_MAX }];
  for (const entry of Object.values(readRuntimesFile(openArtifactHome()).adapters ?? {})) {
    const seen = Date.parse(entry.seenAt);
    if (!Number.isFinite(seen) || now - seen <= ADAPTER_MEMORY_MS) ranges.push(entry.protocols);
  }
  return ranges;
}

/** Why a version of the package may not be installed here, or `null` when it may. */
export function unusable(manifest: PackageVersion | undefined, options: { pin?: string | null; required: ProtocolRange[]; exact?: boolean }): string | null {
  if (!manifest || !parseVersion(manifest.version)) return 'not a version of the package';
  if (manifest.deprecated) return 'deprecated';
  if (!options.exact && isPrerelease(manifest.version)) return 'a pre-release';
  if (options.pin && !satisfies(manifest.version, options.pin)) return `outside the pin ${options.pin}`;
  const node = manifest.engines?.node;
  if (node && validRange(node) && !satisfies(process.versions.node, node)) return `needs Node ${node}`;
  const protocols = protocolRangeOf(manifest.openArtifact?.protocols) ?? LEGACY_PROTOCOLS;
  if (!options.required.every((range) => rangesMeet(range, protocols))) return `speaks Harness API ${protocols.min}–${protocols.max}, which an adapter here does not`;
  if (!manifest.dist?.tarball || !sha512Of(manifest.dist.integrity).length) return 'no tarball with a sha512 integrity';
  return null;
}

/** The newest usable version newer than `newerThan` (or exactly `version`), or `null`. */
export function chooseVersion(packument: Packument, options: { pin?: string | null; required: ProtocolRange[]; newerThan?: string | null; version?: string }): PackageVersion | null {
  const versions = packument.versions ?? {};
  if (options.version) {
    const manifest = versions[options.version];
    const why = unusable(manifest, { ...options, pin: null, exact: true });
    if (why) throw new OpenArtifactError('not_found', `${RUNTIME_PACKAGE}@${options.version} cannot be installed here: ${why}.`);
    return manifest!;
  }
  let best: PackageVersion | null = null;
  for (const manifest of Object.values(versions)) {
    if (unusable(manifest, options)) continue;
    if (options.newerThan && compareVersions(manifest.version, options.newerThan) <= 0) continue;
    if (!best || compareVersions(manifest.version, best.version) > 0) best = manifest;
  }
  return best;
}

/** What the registry says about an attestation of this version. */
function attestationOf(manifest: PackageVersion): NonNullable<RuntimeCheck['attestation']> {
  const att = manifest.dist?.attestations;
  return {
    present: !!att,
    verified: false,
    ...(typeof att?.provenance?.predicateType === 'string' ? { predicateType: att.provenance.predicateType } : {}),
    ...(typeof att?.url === 'string' ? { url: att.url } : {}),
  };
}

// ---- the tarball ----------------------------------------------------------------------------------------------------

/** One entry of a tarball, as the reader keeps it. */
export interface TarEntry {
  /** Its path inside the package (`package/` taken off). */
  path: string;
  type: 'file' | 'dir';
  mode: number;
  data: Buffer;
}

const text = (block: Buffer, start: number, length: number): string => {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? raw.length : end).toString('utf8');
};

/** A numeric header field: octal text, or base-256 when its first byte has the high bit. */
function numeric(block: Buffer, start: number, length: number): number {
  const raw = block.subarray(start, start + length);
  if (raw[0]! & 0x80) {
    let value = raw[0]! & 0x7f;
    for (let i = 1; i < raw.length; i++) {
      value = value * 256 + raw[i]!;
      if (value > Number.MAX_SAFE_INTEGER) throw new OpenArtifactError('bad_archive', 'A tar size is too large.');
    }
    return value;
  }
  const digits = raw.toString('latin1').replace(/[\0 ]+$/g, '').trim();
  if (!digits) return 0;
  if (!/^[0-7]+$/.test(digits)) throw new OpenArtifactError('bad_archive', `A tar header field is not a number (${JSON.stringify(digits)}).`);
  return parseInt(digits, 8);
}

/** The `key=value` records of a pax header. */
function paxRecords(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space < 0) break;
    const length = Number(data.subarray(at, space).toString('latin1'));
    if (!Number.isInteger(length) || length <= 0 || at + length > data.length) throw new OpenArtifactError('bad_archive', 'A pax header is malformed.');
    const record = data.subarray(space + 1, at + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    at += length;
  }
  return out;
}

/**
 * The parts of a tar path, refused when it could land outside the folder it is unpacked into: absolute paths, drive
 * letters, `..`, backslashes and NUL. `.` and empty parts are dropped.
 */
export function safeTarPath(raw: string): string[] {
  if (raw.includes('\0') || raw.includes('\\')) throw new OpenArtifactError('bad_archive', `The package has an unsafe path: ${JSON.stringify(raw)}.`);
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new OpenArtifactError('bad_archive', `The package has an absolute path: ${JSON.stringify(raw)}.`);
  const parts = raw.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.includes('..')) throw new OpenArtifactError('bad_archive', `The package has a path that leaves its folder: ${JSON.stringify(raw)}.`);
  return parts;
}

/**
 * Reads a tarball (gzip of ustar, pax and GNU long names as npm writes them) into its files and folders, with the
 * package's top folder (`package/`) taken off. Refuses links, devices and any other kind of entry, unsafe paths,
 * entries outside the one top folder, bad checksums and truncated data. Node built-ins only.
 */
export function readTarball(gz: Uint8Array): TarEntry[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(gz, { maxOutputLength: MAX_UNPACKED });
  } catch (error) {
    throw new OpenArtifactError('bad_archive', `The package is not a gzip tarball, or unpacks to too much: ${(error as Error)?.message ?? error}`);
  }
  const entries: TarEntry[] = [];
  let top: string | null = null;
  let offset = 0;
  let paxPath: string | null = null;
  let paxSize: number | null = null;
  let longName: string | null = null;
  let ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      ended = true;
      break;
    }
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
    if (numeric(header, 148, 8) !== sum) throw new OpenArtifactError('bad_archive', 'A tar header has a bad checksum.');
    const flag = header[156] === 0 ? '0' : String.fromCharCode(header[156]!);
    const size = paxSize ?? numeric(header, 124, 12);
    const start = offset + 512;
    const end = start + size;
    if (end > tar.length) throw new OpenArtifactError('bad_archive', 'The tarball ends in the middle of an entry.');
    const data = tar.subarray(start, end);
    offset = start + Math.ceil(size / 512) * 512;
    if (flag === 'x') {
      const pax = paxRecords(data);
      paxPath = pax.path ?? null;
      paxSize = pax.size !== undefined ? Number(pax.size) : null;
      if (paxSize !== null && (!Number.isSafeInteger(paxSize) || paxSize < 0)) throw new OpenArtifactError('bad_archive', 'A pax size is malformed.');
      continue;
    }
    if (flag === 'g') continue;
    if (flag === 'L') {
      longName = text(data, 0, data.length);
      continue;
    }
    const name = text(header, 0, 100);
    const magic = text(header, 257, 6);
    const prefix = magic.startsWith('ustar') ? text(header, 345, 155) : '';
    const raw = paxPath ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    paxSize = null;
    longName = null;
    if (flag !== '0' && flag !== '7' && flag !== '5') {
      const kind = flag === '1' ? 'a hard link' : flag === '2' ? 'a symbolic link' : `an entry of kind ${JSON.stringify(flag)}`;
      throw new OpenArtifactError('bad_archive', `The package has ${kind} (${JSON.stringify(raw)}); it is not installed.`);
    }
    const parts = safeTarPath(raw);
    if (!parts.length) continue;
    top ??= parts[0]!;
    if (parts[0] !== top) throw new OpenArtifactError('bad_archive', `The package has entries outside its folder ${top}/ (${JSON.stringify(raw)}).`);
    const path = parts.slice(1).join('/');
    if (!path) continue;
    entries.push({ path, type: flag === '5' ? 'dir' : 'file', mode: numeric(header, 100, 8) & 0o777, data: flag === '5' ? Buffer.alloc(0) : Buffer.from(data) });
  }
  // Without its end marker the archive was cut short (an entry may be missing).
  if (!ended) throw new OpenArtifactError('bad_archive', 'The tarball ends in the middle of an entry, or before its end.');
  return entries;
}

/** Writes the entries into `dest` (a new, empty folder), each checked to stay inside it. */
export function writeEntries(entries: readonly TarEntry[], dest: string): void {
  const root = resolve(dest);
  mkdirSync(root, { recursive: true });
  for (const entry of entries) {
    const target = resolve(root, ...safeTarPath(entry.path));
    const rel = relative(root, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new OpenArtifactError('bad_archive', `The package has a path outside its folder: ${entry.path}.`);
    if (entry.type === 'dir') {
      mkdirSync(target, { recursive: true, mode: 0o755 });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
    // A file only ever replaces a file the same tarball wrote: the folder is new and nothing here makes links.
    writeFileSync(target, entry.data, { mode: entry.mode & 0o111 ? 0o755 : 0o644 });
    chmodSync(target, entry.mode & 0o111 ? 0o755 : 0o644);
  }
}

// ---- installing -----------------------------------------------------------------------------------------------------

/** What is recorded beside an installed runtime (`<dir>/.install.json`). */
export interface InstallRecord {
  version: string;
  integrity: string;
  tarball: string;
  registry: string;
  installedAt: string;
  attestation: NonNullable<RuntimeCheck['attestation']>;
}

/** Moves a finished staging folder to `<home>/runtime/<version>`; an existing one wins (another process installed it). */
function publishFolder(staging: string, version: string): string {
  const target = join(sharedRuntimesOf(openArtifactHome()), version);
  try {
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (!runtimeInfo(target)) throw error;
  }
  return target;
}

/** A new staging folder in the shared folder (same file system as the target, so the rename is atomic). */
function stagingFolder(version: string): string {
  const root = ensureDir(sharedRuntimesOf(openArtifactHome()));
  return join(root, `.staging-${version}-${process.pid}-${randomBytes(4).toString('hex')}`);
}

/**
 * Installs one version from the registry into the shared folder: downloads the tarball, verifies its sha512 against
 * the registry's integrity, unpacks it, checks it is that version of the package, then renames it into place.
 * Nothing is left behind when any step fails.
 */
export async function installFromRegistry(manifest: PackageVersion, registry: string): Promise<string> {
  const version = manifest.version;
  const existing = join(sharedRuntimesOf(openArtifactHome()), version);
  if (runtimeInfo(existing)) return existing;
  const tarball = manifest.dist!.tarball!;
  const response = await get(tarball, 'application/octet-stream', 120_000);
  const data = await readBody(response, MAX_TARBALL, 'The tarball');
  verifyIntegrity(data, manifest.dist!.integrity);
  const entries = readTarball(data);
  const staging = stagingFolder(version);
  try {
    writeEntries(entries, staging);
    const pkg = readJson<{ name?: unknown; version?: unknown } | null>(join(staging, 'package.json'), null);
    if (pkg?.name !== RUNTIME_PACKAGE || pkg.version !== version) {
      throw new OpenArtifactError('bad_archive', `The tarball is not ${RUNTIME_PACKAGE}@${version} (its package.json says ${String(pkg?.name)}@${String(pkg?.version)}).`);
    }
    if (!runtimeInfo(staging)) throw new OpenArtifactError('bad_archive', 'The tarball has no scripts/open-artifact.mjs.');
    const record: InstallRecord = { version, integrity: String(manifest.dist!.integrity), tarball, registry, installedAt: new Date().toISOString(), attestation: attestationOf(manifest) };
    writeFileSync(join(staging, '.install.json'), `${JSON.stringify(record, null, 2)}\n`);
    const dir = publishFolder(staging, version);
    runtimeLog(`installed ${RUNTIME_PACKAGE}@${version} in ${dir} (sha512 verified; attestation ${record.attestation.present ? 'present, not verified' : 'absent'})`);
    return dir;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Keeps the newest {@link KEEP_SHARED} shared runtimes and `keep`; removes the rest and stale staging folders. */
export function pruneShared(keep: readonly string[] = []): string[] {
  const root = sharedRuntimesOf(openArtifactHome());
  const removed: string[] = [];
  const shared = sharedRuntimes(openArtifactHome());
  for (const runtime of shared.slice(KEEP_SHARED)) {
    if (keep.includes(runtime.version)) continue;
    rmSync(runtime.dir!, { recursive: true, force: true });
    removed.push(runtime.version);
  }
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.startsWith('.staging-')) continue;
    try {
      if (Date.now() - statSync(join(root, name)).mtimeMs > 60 * 60_000) rmSync(join(root, name), { recursive: true, force: true });
    } catch {
      /* gone */
    }
  }
  return removed;
}

// ---- checking and updating ------------------------------------------------------------------------------------------

/** The newest runtime on this computer (any source), or `null`. */
function newestLocal(own?: OwnRuntime): string | null {
  const all = runtimeCandidates(openArtifactHome(), own).map((c) => c.version);
  return all.sort((a, b) => compareVersions(b, a))[0] ?? null;
}

/** The last check (`runtime-update.json`), or `null`. */
export function lastCheck(): RuntimeCheck | null {
  const saved = readJson<RuntimeCheck | null>(runtimeCheckFile(), null);
  return saved && typeof saved.at === 'string' ? saved : null;
}

/** Whether a background check is due: never checked, or the last one is older than a day. */
export function checkDue(now = Date.now()): boolean {
  const at = Date.parse(lastCheck()?.at ?? '');
  return !Number.isFinite(at) || now - at >= CHECK_INTERVAL_MS || at > now;
}

/**
 * Asks the registry whether a compatible version newer than every runtime here exists, and records the answer
 * (also a failure) in `runtime-update.json`. Sends only the metadata request.
 */
export async function checkForUpdate(options: { own?: OwnRuntime } = {}): Promise<RuntimeCheck & { manifest?: PackageVersion }> {
  const at = new Date().toISOString();
  try {
    const packument = await fetchPackument(registryUrl());
    const manifest = chooseVersion(packument, { pin: runtimeSettings().pin ?? null, required: requiredProtocols(), newerThan: newestLocal(options.own) });
    const check: RuntimeCheck = { at, available: manifest?.version ?? null, ...(manifest ? { attestation: attestationOf(manifest) } : {}) };
    writeJson(runtimeCheckFile(), check);
    return { ...check, ...(manifest ? { manifest } : {}) };
  } catch (error) {
    const check: RuntimeCheck = { at, available: null, error: (error as Error)?.message ?? String(error) };
    writeJson(runtimeCheckFile(), check);
    return check;
  }
}

/**
 * Installs the newest compatible version newer than every runtime here (or exactly `version`) into the shared folder.
 * Refused when updates are off for the whole computer. Errors (integrity, a bad tarball, an interrupted download) are
 * thrown and nothing is installed.
 */
export async function updateRuntime(options: { version?: string; own?: OwnRuntime; running?: string | null } = {}): Promise<RuntimeUpdateResult> {
  const off = machineOff();
  if (off) throw new OpenArtifactError('not_granted', `Runtime updates are switched off for this computer (${off}).`, { fix: 'Ask whoever manages this computer.' });
  const registry = registryUrl();
  const packument = await fetchPackument(registry);
  const newest = newestLocal(options.own);
  const manifest = chooseVersion(packument, { pin: runtimeSettings().pin ?? null, required: requiredProtocols(), newerThan: newest, ...(options.version ? { version: options.version } : {}) });
  writeJson(runtimeCheckFile(), { at: new Date().toISOString(), available: manifest && (!newest || compareVersions(manifest.version, newest) > 0) ? manifest.version : null, ...(manifest ? { attestation: attestationOf(manifest) } : {}) } satisfies RuntimeCheck);
  if (!manifest) return { installed: null, pending: false, message: `Open Artifact ${newest ?? ''} is the newest compatible runtime; nothing to update.`.replace('  ', ' ') };
  const dir = await installFromRegistry(manifest, registry);
  pruneShared([manifest.version, ...(options.running ? [options.running] : [])]);
  const pending = !!options.running && compareVersions(manifest.version, options.running) > 0;
  return {
    installed: manifest.version,
    pending,
    message: pending
      ? `Installed Open Artifact ${manifest.version} in ${dir}; the daemon (${options.running}) switches to it once no page is open and no tool call runs.`
      : `Installed Open Artifact ${manifest.version} in ${dir}; it starts the next time the daemon starts.`,
  };
}

// ---- status ---------------------------------------------------------------------------------------------------------

const sourceOf = (c: RuntimeCandidate): RuntimeSource => ({ source: c.source, dir: c.dir, version: c.version, protocols: c.protocols, ...(c.harness ? { harness: c.harness } : {}) });

/** The runtimes, the policy and the last check, as `runtime status` shows them. */
export function runtimeStatus(options: { running: string | null; own?: OwnRuntime; pending?: string | null }): RuntimeStatus {
  const home = openArtifactHome();
  const candidates = runtimeCandidates(home, options.own);
  const pin = readRuntimePin(home);
  const selected = rankRuntimes(candidates, { protocols: options.own?.protocols ?? { min: PROTOCOL_MIN, max: PROTOCOL_MAX }, pin })[0] ?? null;
  const pending = options.pending !== undefined ? options.pending : options.running && selected && compareVersions(selected.version, options.running) > 0 ? selected.version : null;
  return {
    running: options.running,
    selected: selected ? sourceOf(selected) : null,
    runtimes: candidates.map(sourceOf),
    missing: missingRuntimes(home).map((r) => ({ dir: r.dir, version: r.version, ...(r.harness ? { harness: r.harness } : {}) })),
    policy: effectivePolicy(),
    pin,
    registry: registryUrl(),
    check: lastCheck(),
    pending,
  };
}

/** `runtime status` for a person. */
export function runtimeStatusText(status: RuntimeStatus): string {
  const lines: string[] = [];
  lines.push(status.running ? `Daemon: ${status.running} (running)` : 'Daemon: not running');
  lines.push(status.selected ? `Starts: ${status.selected.version} (${status.selected.source}${status.selected.dir ? `, ${status.selected.dir}` : ''})` : 'Starts: no runtime found');
  if (status.pending) lines.push(`Pending: ${status.pending}, once the daemon is idle (no open page, no tool call running)`);
  lines.push('Runtimes:');
  for (const r of status.runtimes) lines.push(`  ${r.version.padEnd(12)} ${r.source.padEnd(10)} protocol ${r.protocols.min}–${r.protocols.max}  ${r.dir ?? '(this command)'}${r.harness ? `  [${r.harness}]` : ''}`);
  for (const m of status.missing) lines.push(`  ${m.version.padEnd(12)} gone       ${m.dir}${m.harness ? `  [${m.harness}]` : ''} (skipped)`);
  const policy = status.policy.update === 'off' ? 'off for this computer' : status.policy.update;
  lines.push(`Updates: ${policy} (${status.policy.source})${status.pin ? `, pinned to ${status.pin}` : ''}, from ${status.registry}`);
  const check = status.check;
  if (!check) lines.push('Last check: never');
  else if (check.error) lines.push(`Last check: ${check.at}, failed: ${check.error}`);
  else if (check.available) {
    const att = check.attestation;
    lines.push(`Last check: ${check.at}, ${check.available} is available (open-artifact runtime update)`);
    lines.push(`  Provenance attestation: ${att?.present ? `listed by the registry (${att.predicateType ?? 'unknown kind'}), not verified here` : 'none listed'}; the tarball is checked against the registry's sha512 integrity.`);
  } else lines.push(`Last check: ${check.at}, up to date`);
  return lines.join('\n');
}

// ---- the daemon's side ----------------------------------------------------------------------------------------------

/** Options of {@link RuntimeManager}. */
export interface RuntimeManagerOptions {
  /** This daemon's version. */
  version: string;
  /** This daemon's own runtime (its folder is registered at start). */
  own?: OwnRuntime;
  log: (line: string) => void;
  /** Sends an event to subscribed adapters, except those of the harnesses in `skip`. */
  broadcast: (event: RuntimeUpdateEvent, skip: ReadonlySet<string>) => void;
  /** Whether nothing would be cut off by a switch: no open page, no tool call or long action running. */
  idle: () => boolean;
  /** The harnesses with an adapter connected now. */
  connected: () => string[];
  /** Hands over to another runtime: closes this daemon and starts `bin` with `env`. */
  switchTo: (candidate: RuntimeCandidate, env: NodeJS.ProcessEnv) => void;
  /** The first background check waits this long after the start, ms (default 10 min). */
  checkDelayMs?: number;
}

/** Validates `hello`'s `runtime`: an absolute runtime folder of a version. */
function runtimeOfHello(value: unknown): { dir: string; version: string; update?: RuntimeUpdatePolicy } | null {
  const runtime = value as { dir?: unknown; version?: unknown; update?: unknown } | null;
  if (!runtime || typeof runtime !== 'object' || typeof runtime.dir !== 'string' || !isAbsolute(runtime.dir) || typeof runtime.version !== 'string' || !parseVersion(runtime.version)) return null;
  return { dir: resolve(runtime.dir), version: runtime.version, ...(isPolicy(runtime.update) ? { update: runtime.update } : {}) };
}

/**
 * The daemon's runtime work: records what adapters say in `hello`, copies the newest runtime a host brought into the
 * shared folder, checks for updates as the policy says, and switches to a newer runtime once idle.
 */
export class RuntimeManager {
  private readonly options: RuntimeManagerOptions;
  private readonly startedAt = Date.now();
  private checking: Promise<unknown> | null = null;
  private copying: Promise<unknown> | null = null;
  private switching = false;
  private closed = false;

  constructor(options: RuntimeManagerOptions) {
    this.options = options;
  }

  /** At start: registers the daemon's own runtime folder, when it runs from one. */
  start(): void {
    if (this.options.own?.dir) this.register({ dir: this.options.own.dir, version: this.options.own.version, harness: 'daemon' });
  }

  private writeFile(mutate: (file: RuntimesFile) => void): void {
    const home = openArtifactHome();
    const file = readRuntimesFile(home);
    mutate(file);
    writeJson(runtimesFileOf(home), file);
  }

  /** What an adapter said in `hello`: its protocol range, and the runtime it carries. */
  hello(harness: string, params: Pick<HelloParams, 'protocols' | 'runtime'>): void {
    const protocols = protocolRangeOf(params.protocols) ?? LEGACY_PROTOCOLS;
    this.writeFile((file) => {
      file.adapters = { ...file.adapters, [harness]: { protocols, seenAt: new Date().toISOString() } };
    });
    if (params.runtime === undefined) return;
    const runtime = runtimeOfHello(params.runtime);
    if (!runtime) return this.options.log(`runtime: ${harness} said a runtime that is not { dir (absolute), version }; not recorded`);
    const info = runtimeInfo(runtime.dir);
    if (!info) return this.options.log(`runtime: ${harness}'s runtime ${runtime.dir} has no scripts/open-artifact.mjs; not recorded`);
    if (info.version && info.version !== runtime.version) return this.options.log(`runtime: ${harness} says ${runtime.version} but ${runtime.dir} is ${info.version}; not recorded`);
    this.register({ ...runtime, harness });
  }

  /** Records a runtime in `runtimes.json` (one entry per folder) and copies it into the shared folder when it is the newest. */
  register(record: RuntimeRecord): void {
    this.writeFile((file) => {
      file.runtimes = [...file.runtimes.filter((r) => resolve(r.dir) !== resolve(record.dir)), { ...record, seenAt: new Date().toISOString() }];
    });
    this.adopt(record);
  }

  /**
   * Copies a registered runtime into `<home>/runtime/<version>/` when it is newer than every shared one and is a whole
   * runtime (`vendor/open-artifact.mjs` beside the entry), so the machine keeps it after its host is gone.
   */
  private adopt(record: RuntimeRecord): void {
    const home = openArtifactHome();
    if (this.copying || !existsSync(join(record.dir, 'vendor', 'open-artifact.mjs'))) return;
    if (resolve(record.dir).startsWith(resolve(sharedRuntimesOf(home)) + sep)) return;
    const newest = sharedRuntimes(home)[0]?.version;
    if (newest && compareVersions(record.version, newest) <= 0) return;
    const staging = stagingFolder(record.version);
    this.copying = cp(record.dir, staging, { recursive: true, verbatimSymlinks: true, filter: (from) => !from.split(sep).includes('node_modules') })
      .then(() => {
        const dir = publishFolder(staging, record.version);
        this.options.log(`runtime: kept a copy of ${record.harness ?? 'a host'}'s runtime ${record.version} in ${dir}`);
        pruneShared([record.version, this.options.version]);
      })
      .catch((error: unknown) => {
        rmSync(staging, { recursive: true, force: true });
        this.options.log(`runtime: could not copy ${record.dir}: ${(error as Error)?.message ?? error}`);
      })
      .finally(() => {
        this.copying = null;
      });
  }

  /** Waits for a copy in progress (tests, shutdown). */
  async settled(): Promise<void> {
    await this.copying;
    await this.checking;
  }

  /** The protocol ranges a runtime this daemon switches to must speak: those of the adapters connected now. */
  private connectedProtocols(): ProtocolRange[] {
    const adapters = readRuntimesFile(openArtifactHome()).adapters ?? {};
    return this.options.connected().map((name) => adapters[name]?.protocols ?? LEGACY_PROTOCOLS);
  }

  /** The newer runtime this daemon would switch to, or `null`. */
  pendingSwitch(): RuntimeCandidate | null {
    const home = openArtifactHome();
    const required = this.connectedProtocols();
    const usable = runtimeCandidates(home).filter((c) => required.every((range) => rangesMeet(c.protocols, range)));
    const best = rankRuntimes(usable, { protocols: { min: 1, max: Number.MAX_SAFE_INTEGER }, pin: readRuntimePin(home) })[0];
    return best && compareVersions(best.version, this.options.version) > 0 ? best : null;
  }

  /** `runtime.status`. */
  status(): RuntimeStatus {
    return runtimeStatus({ running: this.options.version, ...(this.options.own ? { own: this.options.own } : {}), pending: this.pendingSwitch()?.version ?? null });
  }

  /** `runtime.update` from a host: downloads now (unless off for the computer); the switch follows once idle. */
  async update(version?: string): Promise<RuntimeUpdateResult> {
    const result = await updateRuntime({ ...(version ? { version } : {}), ...(this.options.own ? { own: this.options.own } : {}), running: this.options.version });
    this.options.log(`runtime: ${result.message}`);
    return result;
  }

  /** Answers the Harness API's `runtime.*` calls. */
  async call(method: string, raw: Record<string, unknown>): Promise<unknown> {
    if (method === 'runtime.status') return this.status();
    if (method === 'runtime.update') {
      const version = typeof raw.version === 'string' && raw.version ? raw.version : undefined;
      if (version && !parseVersion(version)) throw new OpenArtifactError('invalid_argument', 'runtime.update: version is x.y.z.');
      // A host does not override the person: refused under their `bundled` or when the computer is off.
      const refusal = hostUpdateRefusal();
      if (refusal) throw refusal;
      return this.update(version);
    }
    throw new OpenArtifactError('method_not_found', `Unknown method ${method}.`);
  }

  /** Runs a background check when the policy and the once-a-day limit allow, and acts on what it finds. */
  maybeCheck(now = Date.now()): void {
    if (this.checking || this.closed) return;
    const policy = effectivePolicy().update;
    if (policy === 'off' || policy === 'bundled') return;
    if (now - this.startedAt < (this.options.checkDelayMs ?? 10 * 60_000) || !checkDue(now)) return;
    this.checking = checkForUpdate(this.options.own ? { own: this.options.own } : {})
      .then(async (check) => {
        if (check.error) return this.options.log(`runtime: update check failed: ${check.error}`);
        if (!check.available || this.closed) return;
        if (policy === 'auto') {
          const result = await this.update(check.available);
          if (result.installed) this.options.broadcast({ type: 'runtime/update', current: this.options.version, available: result.installed, installed: true }, bundledHarnesses());
        } else {
          this.options.log(`runtime: ${check.available} is available (policy prompt: nothing downloaded)`);
          this.options.broadcast({ type: 'runtime/update', current: this.options.version, available: check.available, installed: false }, bundledHarnesses());
        }
      })
      .catch((error: unknown) => this.options.log(`runtime: background update failed: ${(error as Error)?.message ?? error}`))
      .finally(() => {
        this.checking = null;
      });
  }

  /** Switches to a newer runtime on this computer when the daemon is idle. Returns whether it did. */
  maybeSwitch(): boolean {
    if (this.switching || this.closed) return false;
    const next = this.pendingSwitch();
    if (!next || !this.options.idle()) return false;
    this.switching = true;
    const candidates = runtimeCandidates(openArtifactHome(), this.options.own);
    this.options.log(`runtime: switching from ${this.options.version} to ${next.version} (${next.dir ?? next.bin})`);
    this.options.switchTo(next, runtimeEnv(process.env, next, candidates));
    return true;
  }

  /** Called from the daemon's timer. */
  tick(now = Date.now()): void {
    this.maybeCheck(now);
    this.maybeSwitch();
  }

  close(): void {
    this.closed = true;
  }
}

/** Copies a runtime folder (for tests and tools): the folder without `node_modules`. */
export function copyRuntime(from: string, to: string): void {
  cpSync(from, to, { recursive: true, filter: (path) => !path.split(sep).includes('node_modules') });
}
