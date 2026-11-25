/**
 * Where Open Artifact keeps its things. Every path can be moved with an
 * environment variable, so tests and dev checkouts never touch the real
 * home folder.
 */

import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { OpenArtifactError } from '@open-artifact/protocol';

/**
 * One word of a command line an agent types: as it is, or in double quotes when it has spaces or shell characters
 * (on Windows, where a path cannot hold `"` and `\` is the separator, only quoted).
 */
export function shellWord(word: string, platform: NodeJS.Platform = process.platform): string {
  if (!/[\s"'$`\\]/.test(word)) return word;
  return platform === 'win32' ? `"${word}"` : `"${word.replace(/(["$`\\])/g, '\\$1')}"`;
}

/** What {@link scriptRunner} goes by (tests pass their own). */
export interface RunnerFacts {
  execPath: string;
  /** This process is the single-file executable (`node:sea`). */
  sea: boolean;
  /** Electron runs it (its binary is not a Node.js without `ELECTRON_RUN_AS_NODE`). */
  electron: boolean;
}

/** The facts of this process. */
export const runnerFacts = (): RunnerFacts => ({
  execPath: process.execPath,
  // Asked lazily, so a Node.js without `node:sea` (none this runtime supports, but Electron's may lack it) still loads.
  sea: !!process.getBuiltinModule?.('node:sea')?.isSea(),
  electron: !!process.versions.electron,
});

/**
 * The program an agent runs this runtime's scripts with (`<it> <script> …`): `node` under a plain Node.js (or Electron),
 * else the program actually running, quoted when needed: the single-file executable has no `node` beside it, and runs a
 * script given as its first argument.
 */
export function scriptRunner(facts: RunnerFacts = runnerFacts()): string {
  if (!facts.sea && (facts.electron || /^node(\.exe)?$/i.test(facts.execPath.split(/[\\/]/).pop() ?? ''))) return 'node';
  return shellWord(facts.execPath);
}

/** Expands a leading `~` to the home folder. */
export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/** `~/.agents/open-artifact`, or `$OPEN_ARTIFACT_HOME`. */
export function openArtifactHome(): string {
  return resolve(expandHome(process.env.OPEN_ARTIFACT_HOME || '~/.agents/open-artifact'));
}

/** Well-known files and folders under {@link openArtifactHome}. */
export const files = {
  daemon: (): string => join(openArtifactHome(), 'daemon.json'),
  lock: (): string => join(openArtifactHome(), 'daemon.lock'),
  settings: (): string => join(openArtifactHome(), 'settings.json'),
  artifacts: (): string => join(openArtifactHome(), 'artifacts'),
  inbox: (): string => join(openArtifactHome(), 'inbox'),
  harnesses: (): string => join(openArtifactHome(), 'harnesses'),
  sessions: (): string => join(openArtifactHome(), 'sessions.json'),
  logs: (): string => join(openArtifactHome(), 'logs'),
  /** The daemon's log (runtime installs and switches are written there too). */
  daemonLog: (): string => join(openArtifactHome(), 'logs', 'daemon.log'),
  trash: (): string => join(openArtifactHome(), 'trash'),
  thumbnails: (): string => join(openArtifactHome(), 'thumbnails'),
  servers: (): string => join(openArtifactHome(), 'servers'),
  /** Cloud remotes and their tokens (`remotes.json`, mode 0600). */
  remotes: (): string => join(openArtifactHome(), 'remotes.json'),
  /** Install-time cloud presets for machines that cannot set environment variables (`preset.json`, read at start). */
  preset: (): string => join(openArtifactHome(), 'preset.json'),
  /** The installed types (`types install`): `$OPEN_ARTIFACT_INSTALLED_TYPES`, else `<home>/types`. */
  installedTypes: (): string => resolve(expandHome(process.env.OPEN_ARTIFACT_INSTALLED_TYPES || join(openArtifactHome(), 'types'))),
  /** Where each installed type came from (`types.json`, {@link InstalledTypesIndex}). */
  typesIndex: (): string => join(openArtifactHome(), 'types.json'),
  /** Packages read for an install the person has not confirmed yet (the home page's preview), by sha256. */
  typesStaging: (): string => join(openArtifactHome(), 'types-staging'),
};

/** Creates a folder (and its parents) and returns it. */
export function ensureDir(dir: string, mode?: number): string {
  mkdirSync(dir, { recursive: true, ...(mode ? { mode } : {}) });
  return dir;
}

/** Writes a file through a temporary one, so a reader never sees half of it. */
export function writeFileAtomic(file: string, data: string | Uint8Array, mode?: number): void {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data, mode ? { mode } : undefined);
  renameSync(tmp, file);
}

/** Reads a JSON file, or returns `fallback` when it is missing or broken. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Writes a JSON file atomically, pretty-printed. */
export function writeJson(file: string, value: unknown, mode?: number): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

/** Whether two folder paths point to the same location (resolving symlinks when present, and case on Windows). */
export function samePath(a: string, b: string): boolean {
  const normalize = (dir: string): string => {
    let full = resolve(dir);
    try {
      full = realpathSync(full);
    } catch {
      /* folder may not exist yet */
    }
    return process.platform === 'win32' ? full.toLowerCase() : full;
  };
  return normalize(a) === normalize(b);
}

/** Whether the file at `full` (it exists) is still under `root` once links are followed. */
export function realInside(root: string, full: string): boolean {
  try {
    const real = realpathSync(full);
    const realRoot = realpathSync(root);
    return real === realRoot || real.startsWith(realRoot + sep);
  } catch {
    return false;
  }
}

/** A path under `root` that does not leave it. Throws `bad_path` on `..` and absolute paths. */
export function inside(root: string, rel: unknown): string {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new OpenArtifactError('bad_path', `Not a usable path: ${JSON.stringify(rel)}`);
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const full = resolve(root, clean);
  if (full !== root && !full.startsWith(root + sep)) throw new OpenArtifactError('bad_path', `${rel} leaves the artifact folder.`);
  return full;
}
