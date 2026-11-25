/**
 * Which Open Artifact runtime starts the daemon (design 10.1).
 *
 * A runtime is a folder with the content of `@open-artifact/cli`: `scripts/open-artifact.mjs` (the entry), `vendor/`,
 * and a `package.json` (the npm package) or `vendor/runtime.json` (a skill folder) that says its version and the
 * Harness API versions it speaks (`openArtifact.protocols`, `protocols`; left out: protocol 1). Three places hold them:
 *
 * - the caller's own (the folder a host carries, or the command line's own build);
 * - the ones adapters registered in `hello` (`runtime: { dir, version }`), kept by the daemon in
 *   `<OPEN_ARTIFACT_HOME>/runtimes.json`; a folder that is gone (its host was uninstalled) is skipped;
 * - the shared folder `<OPEN_ARTIFACT_HOME>/runtime/<version>/`, where `open-artifact runtime update` installs and
 *   where the daemon copies the newest runtime a host brought, so uninstalling that host does not take it away.
 *
 * The one that starts is the highest version whose protocols meet the caller's, within the person's pin
 * (`settings.json` `runtime.pin`) when any candidate is; ties go to the caller's own. Everything here reads files only.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ProtocolRange, RuntimeSource } from '@open-artifact/protocol';

/** The entry of a runtime folder, relative to it. */
export const RUNTIME_ENTRY = join('scripts', 'open-artifact.mjs');

/** The protocol range of a runtime that does not say (every runtime before protocol 2). */
export const LEGACY_PROTOCOLS: ProtocolRange = Object.freeze({ min: 1, max: 1 });

/** One runtime `runtimes.json` records. */
export interface RuntimeRecord {
  dir: string;
  version: string;
  /** The update policy the adapter that registered it asked for. */
  update?: 'auto' | 'prompt' | 'bundled';
  /** The harness that registered it (`daemon`: the daemon's own folder). */
  harness?: string;
  /** When it was last registered (ISO). */
  seenAt?: string;
}

/** What `runtimes.json` holds. */
export interface RuntimesFile {
  runtimes: RuntimeRecord[];
  /** The protocol range each harness's adapter last said in `hello`, so an update stays compatible with all of them. */
  adapters?: Record<string, { protocols: ProtocolRange; seenAt: string }>;
}

/** A runtime that could start the daemon. */
export interface RuntimeCandidate extends RuntimeSource {
  /** The file to run with Node (`<dir>/scripts/open-artifact.mjs`, or the caller's own entry). */
  bin: string;
}

/** The caller's own runtime: a folder, or an entry file (a source checkout). */
export interface OwnRuntime {
  dir?: string;
  bin?: string;
  version: string;
  protocols?: ProtocolRange;
}

// ---- versions and ranges -----------------------------------------------------------------------------------------

interface Parsed {
  n: [number, number, number];
  pre: string[];
}

/** `x.y.z[-pre][+build]`, with a leading `v` or `=` allowed; `null` when it is not one. */
export function parseVersion(version: unknown): Parsed | null {
  if (typeof version !== 'string') return null;
  const match = /^[v=\s]*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(version);
  if (!match) return null;
  return { n: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] };
}

function comparePre(a: string[], b: string[]): number {
  if (!a.length || !b.length) return a.length === b.length ? 0 : a.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny && Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Semver order: negative when `a` is older than `b`. A version that does not parse is older than any that does. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i]! < y.n[i]! ? -1 : 1;
  return comparePre(x.pre, y.pre);
}

/** Whether a version is a pre-release (`0.14.0-beta.1`). */
export function isPrerelease(version: string): boolean {
  return !!parseVersion(version)?.pre.length;
}

type Comparator = { op: '>=' | '>' | '<' | '<=' | '='; v: Parsed };

const tuple = (n: number[]): Parsed => ({ n: [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0], pre: [] });

/** One range token (`^0.13.1`, `0.13.x`, `>=1.2`, `*`) as comparators; throws on what it does not know. */
function comparatorsOf(token: string): Comparator[] {
  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\*|x|X|\d+)(?:\.(\*|x|X|\d+))?(?:\.(\*|x|X|\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(token);
  if (!match) throw new Error(`not a version range: ${token}`);
  const op = match[1] ?? '';
  const parts = [match[2], match[3], match[4]];
  const wild = (p: string | undefined): boolean => p === undefined || /^[*xX]$/.test(p);
  const fixed: number[] = [];
  for (const part of parts) {
    if (wild(part)) break;
    fixed.push(Number(part));
  }
  const pre = match[5] ? match[5].split('.') : [];
  if (fixed.length === 0) return op === '<' || op === '>' ? [{ op: '<', v: tuple([0, 0, 0]) }] : [];
  const low = { ...tuple(fixed), pre: fixed.length === 3 ? pre : [] };
  // The first version past the partial one: 1.2 → 1.3.0, 1 → 2.0.0.
  const next = (n: number[]): Parsed => tuple(n.length === 1 ? [n[0]! + 1, 0, 0] : n.length === 2 ? [n[0]!, n[1]! + 1, 0] : [n[0]!, n[1]!, n[2]! + 1]);
  switch (op) {
    case '^': {
      const [a = 0, b = 0, c = 0] = fixed;
      const upper = a > 0 || fixed.length === 1 ? tuple([a + 1, 0, 0]) : b > 0 || fixed.length === 2 ? tuple([0, b + 1, 0]) : tuple([0, 0, c + 1]);
      return [{ op: '>=', v: low }, { op: '<', v: upper }];
    }
    case '~':
      return [{ op: '>=', v: low }, { op: '<', v: next(fixed.length === 3 ? fixed.slice(0, 2) : fixed) }];
    case '>=':
      return [{ op: '>=', v: low }];
    case '<':
      return [{ op: '<', v: low }];
    case '>':
      return fixed.length === 3 ? [{ op: '>', v: low }] : [{ op: '>=', v: next(fixed) }];
    case '<=':
      return fixed.length === 3 ? [{ op: '<=', v: low }] : [{ op: '<', v: next(fixed) }];
    default:
      return fixed.length === 3 ? [{ op: '=', v: low }] : [{ op: '>=', v: low }, { op: '<', v: next(fixed) }];
  }
}

const cmp = (a: Parsed, b: Parsed): number => {
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i]! < b.n[i]! ? -1 : 1;
  return comparePre(a.pre, b.pre);
};

/** A range in npm's notation, as sets of comparators (`||` between sets). Throws when it is not one this reader knows. */
export function parseRange(range: string): Comparator[][] {
  const text = range.trim();
  if (!text) throw new Error('an empty range');
  return text.split('||').map((set) => {
    const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(set);
    if (hyphen) return [...comparatorsOf(`>=${hyphen[1]}`), ...comparatorsOf(`<=${hyphen[2]}`)];
    const tokens = set.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).filter(Boolean);
    if (!tokens.length) throw new Error(`an empty part in ${range}`);
    return tokens.flatMap(comparatorsOf);
  });
}

/** Whether `range` is a range this reader knows. */
export function validRange(range: string): boolean {
  try {
    parseRange(range);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `version` is in `range` (npm notation: `0.13.x`, `^0.13.1`, `~0.13.0`, `>=0.13 <0.15`, `1.2.3 - 1.4`,
 * `a || b`, `*`). A pre-release is only in a range that names that same version exactly. A range that does not
 * parse matches nothing.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  let sets: Comparator[][];
  try {
    sets = parseRange(range);
  } catch {
    return false;
  }
  return sets.some((set) => {
    if (v.pre.length && !set.some((c) => c.op === '=' && cmp(c.v, v) === 0)) return false;
    return set.every((c) => {
      const order = cmp(v, c.v);
      return c.op === '=' ? order === 0 : c.op === '>=' ? order >= 0 : c.op === '>' ? order > 0 : c.op === '<' ? order < 0 : order <= 0;
    });
  });
}

/** Whether two protocol ranges share a version. */
export function rangesMeet(a: ProtocolRange, b: ProtocolRange): boolean {
  return Math.max(a.min, b.min) <= Math.min(a.max, b.max);
}

/** A `{min, max}` of whole numbers, else `null`. */
export function protocolRangeOf(value: unknown): ProtocolRange | null {
  const range = value as Partial<ProtocolRange> | null;
  if (!range || typeof range !== 'object' || !Number.isInteger(range.min) || !Number.isInteger(range.max) || range.min! < 1 || range.max! < range.min!) return null;
  return { min: range.min!, max: range.max! };
}

// ---- folders ------------------------------------------------------------------------------------------------------

const readJsonFile = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * What a runtime folder says about itself: its entry, version and protocols (`package.json`, then
 * `vendor/runtime.json`). `null` when it is not a runtime folder (no entry).
 */
export function runtimeInfo(dir: string): { bin: string; version: string | null; protocols: ProtocolRange | null } | null {
  const bin = join(dir, RUNTIME_ENTRY);
  if (!existsSync(bin)) return null;
  const pkg = readJsonFile(join(dir, 'package.json')) as { version?: unknown; openArtifact?: { protocols?: unknown } } | null;
  const own = readJsonFile(join(dir, 'vendor', 'runtime.json')) as { version?: unknown; protocols?: unknown } | null;
  const version = [pkg?.version, own?.version].find((v): v is string => typeof v === 'string' && !!parseVersion(v)) ?? null;
  return { bin, version, protocols: protocolRangeOf(pkg?.openArtifact?.protocols) ?? protocolRangeOf(own?.protocols) };
}

/** `<home>/runtimes.json`. */
export const runtimesFileOf = (home: string): string => join(home, 'runtimes.json');

/** `<home>/runtime`: the shared runtimes, one folder per version. */
export const sharedRuntimesOf = (home: string): string => join(home, 'runtime');

/** `runtimes.json` of a home (an empty one when it is missing or broken). */
export function readRuntimesFile(home: string): RuntimesFile {
  const raw = readJsonFile(runtimesFileOf(home)) as Partial<RuntimesFile> | null;
  const runtimes = Array.isArray(raw?.runtimes)
    ? raw!.runtimes.filter((r): r is RuntimeRecord => !!r && typeof r.dir === 'string' && isAbsolute(r.dir) && typeof r.version === 'string')
    : [];
  const adapters: RuntimesFile['adapters'] = {};
  for (const [name, entry] of Object.entries(raw?.adapters ?? {})) {
    const protocols = protocolRangeOf((entry as { protocols?: unknown })?.protocols);
    if (protocols) adapters[name] = { protocols, seenAt: String((entry as { seenAt?: unknown }).seenAt ?? '') };
  }
  return { runtimes, adapters };
}

/** The person's pin (`settings.json` `runtime.pin`), or `null`. */
export function readRuntimePin(home: string): string | null {
  const settings = readJsonFile(join(home, 'settings.json')) as { runtime?: { pin?: unknown } } | null;
  const pin = settings?.runtime?.pin;
  return typeof pin === 'string' && pin.trim() && validRange(pin) ? pin.trim() : null;
}

/** The versions installed in the shared folder, newest first (folders named by a version, with an entry). */
export function sharedRuntimes(home: string): RuntimeCandidate[] {
  const root = sharedRuntimesOf(home);
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const found: RuntimeCandidate[] = [];
  for (const name of names) {
    if (name.startsWith('.') || !parseVersion(name)) continue;
    const dir = join(root, name);
    const info = runtimeInfo(dir);
    // A folder whose package says another version is not what its name claims.
    if (!info || (info.version && info.version !== name)) continue;
    found.push({ source: 'shared', dir, bin: info.bin, version: name, protocols: info.protocols ?? LEGACY_PROTOCOLS });
  }
  return found.sort((a, b) => compareVersions(b.version, a.version));
}

/** The caller's own runtime as a candidate, when it names a folder or an entry that is there. */
export function ownCandidate(own: OwnRuntime | undefined): RuntimeCandidate | null {
  if (!own?.version) return null;
  if (own.dir) {
    const info = runtimeInfo(own.dir);
    const bin = own.bin ?? info?.bin;
    if (!bin || !existsSync(bin)) return null;
    return { source: 'own', dir: resolve(own.dir), bin, version: own.version, protocols: own.protocols ?? info?.protocols ?? LEGACY_PROTOCOLS };
  }
  if (!own.bin || !existsSync(own.bin)) return null;
  return { source: 'own', dir: null, bin: own.bin, version: own.version, protocols: own.protocols ?? LEGACY_PROTOCOLS };
}

/**
 * Every runtime that could start the daemon for this home: the caller's own, the registered ones whose folder is
 * still a runtime of the recorded version, and the shared ones.
 */
export function runtimeCandidates(home: string, own?: OwnRuntime): RuntimeCandidate[] {
  const out: RuntimeCandidate[] = [];
  const mine = ownCandidate(own);
  if (mine) out.push(mine);
  for (const record of readRuntimesFile(home).runtimes) {
    const info = runtimeInfo(record.dir);
    if (!info || !parseVersion(record.version) || (info.version && info.version !== record.version)) continue;
    out.push({ source: 'registered', dir: record.dir, bin: info.bin, version: record.version, protocols: info.protocols ?? LEGACY_PROTOCOLS, ...(record.harness ? { harness: record.harness } : {}) });
  }
  out.push(...sharedRuntimes(home));
  return out;
}

/** The registered runtimes whose folder is gone or is no longer that runtime. */
export function missingRuntimes(home: string): RuntimeRecord[] {
  return readRuntimesFile(home).runtimes.filter((record) => {
    const info = runtimeInfo(record.dir);
    return !info || (!!info.version && info.version !== record.version);
  });
}

const SOURCE_RANK: Record<RuntimeSource['source'], number> = { own: 0, shared: 1, registered: 2 };

/** Whether this process's Node meets a runtime folder's `engines.node` (the caller's own runs already; no range: yes). */
function runsOnThisNode(c: RuntimeCandidate): boolean {
  if (c.source === 'own' || !c.dir) return true;
  const node = (readJsonFile(join(c.dir, 'package.json')) as { engines?: { node?: unknown } } | null)?.engines?.node;
  return typeof node !== 'string' || !validRange(node) || satisfies(process.versions.node, node);
}

/**
 * The candidates that may start a daemon for a caller speaking `protocols`, best first: those within `pin` (when any
 * is), each highest version first; on a tie the caller's own, then the shared copy. Empty when none speaks the
 * caller's protocols. A runtime folder whose `package.json` `engines.node` this process's Node does not meet is left
 * out: the daemon runs with this process's executable (in a single executable, the Node inside it).
 */
export function rankRuntimes(candidates: readonly RuntimeCandidate[], options: { protocols: ProtocolRange; pin?: string | null }): RuntimeCandidate[] {
  const usable = candidates.filter((c) => !!parseVersion(c.version) && rangesMeet(c.protocols, options.protocols) && runsOnThisNode(c));
  const pinned = options.pin ? usable.filter((c) => satisfies(c.version, options.pin!)) : usable;
  const pool = pinned.length ? pinned : usable;
  const seen = new Set<string>();
  return [...pool]
    .sort((a, b) => compareVersions(b.version, a.version) || SOURCE_RANK[a.source] - SOURCE_RANK[b.source])
    .filter((c) => {
      const key = realOrResolved(c.bin);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** The runtime to start (see {@link rankRuntimes}), or `null`. */
export function selectRuntime(candidates: readonly RuntimeCandidate[], options: { protocols: ProtocolRange; pin?: string | null }): RuntimeCandidate | null {
  return rankRuntimes(candidates, options)[0] ?? null;
}

/** A path with links resolved, or resolved as it is when it is not there. */
export function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Whether `path` is `dir` or inside it. */
export function within(dir: string, path: string): boolean {
  const rel = relative(realOrResolved(dir), realOrResolved(path));
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`));
}

/** Whether `dir` is a folder. */
export function isFolder(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The variables a launcher sets to point the daemon at its own folder's pieces. When another runtime starts, the ones
 * that point into a runtime folder other than the one starting are dropped, so its daemon serves its own Shell and types.
 */
export const RUNTIME_VARIABLES = ['OPEN_ARTIFACT_DAEMON_BIN', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_HARNESS_PROFILES'] as const;

/** `env` for starting `chosen`: without the entry override, nor the variables that point into another runtime's folder. */
export function runtimeEnv(env: NodeJS.ProcessEnv, chosen: RuntimeCandidate, others: readonly RuntimeCandidate[]): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  delete out.OPEN_ARTIFACT_DAEMON_BIN;
  const foreign = others.map((c) => c.dir ?? null).filter((dir): dir is string => !!dir && (!chosen.dir || realOrResolved(dir) !== realOrResolved(chosen.dir)));
  for (const name of RUNTIME_VARIABLES) {
    const value = out[name];
    if (value && foreign.some((dir) => within(dir, value))) delete out[name];
  }
  return out;
}
