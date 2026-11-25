/**
 * Nudges: waking an agent session that is idle, for harnesses whose hooks hand over the inbox only when a turn runs.
 * A wake that went to such a session's inbox starts a turn there with a short message; the harness's hook then gives
 * the agent the waiting messages themselves.
 *
 * How a harness is nudged is its profile's `nudge` ({@link HarnessNudge}): a program and its arguments, run without a
 * shell, with `${session}` and `${text}` filled in. It is read only from a profile file on disk that ships with the
 * daemon or is the person's own (`nudgeOf` in `harness-profiles.ts`), never from what an adapter reports: whoever can
 * put a file there can run commands on this computer anyway. The shipped ones:
 *
 * - `antigravity`: `agentapi send-message <conversationId> <text>`, the Antigravity app's own command line, pointed at
 *   the running app by its hub file (`~/.gemini/antigravity/daemon/hub_<port>.json`, `envFile`).
 * - `codex`: `codex queue --thread <threadId> --message <text>`, Codex's own queue of messages for a thread
 *   (`~/.codex/queue_1.sqlite`); the desktop app runs a queued message as soon as the thread is idle.
 */

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import type { HarnessNudge, SessionRef } from '@open-artifact/protocol';
import { nudgeOf } from './harness-profiles.ts';

/** How long a nudge command may run, ms. */
const NUDGE_TIMEOUT_MS = 15_000;

/** Runs a command; resolves with its error, if any. */
export type NudgeRun = (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<Error | null>;

/** Options of {@link nudgeSession}. */
export interface NudgeOptions {
  /** The home folder `~/` stands for (default: the person's). */
  home?: string;
  /** Whether a process is alive (default: `process.kill(pid, 0)`). */
  alive?: (pid: number) => boolean;
  run?: NudgeRun;
  log?: (line: string) => void;
  /** The nudge of a harness (default: its profile's, {@link nudgeOf}). */
  nudgeOf?: (harness: string) => HarnessNudge | null;
}

const defaultRun: NudgeRun = (command, args, env) =>
  new Promise((done) => {
    execFile(command, args, { env, timeout: NUDGE_TIMEOUT_MS, windowsHide: true, shell: false }, (error) => done(error));
  });

const defaultAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** `~/…` in the home folder. */
function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  return path.startsWith('~/') ? join(home, path.slice(2)) : path;
}

/** `${env:NAME}` filled in from the daemon's environment; `null` when a variable it names is unset. */
function fillEnv(text: string): string | null {
  let missing = false;
  const filled = text.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const value = process.env[name];
    if (!value) missing = true;
    return value ?? '';
  });
  return missing ? null : filled;
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** A Windows batch file: Node refuses to run one without a shell (CVE-2024-27980), and a nudge never adds a shell. */
const isBatch = (path: string): boolean => /\.(cmd|bat)$/i.test(path);

/**
 * A program on `PATH`. On Windows an `.exe` is looked for first, through every folder; a `.cmd` or `.bat` is only
 * reported (`batch`), never run: Node runs those only through a shell, and the session id and message must not pass
 * through one.
 */
export function onPath(name: string, platform: NodeJS.Platform = process.platform, path: string = process.env.PATH ?? ''): { found: string } | { batch: string } | null {
  const dirs = path.split(delimiter).filter(Boolean);
  const at = (dir: string, file: string): string => join(dir, file);
  if (platform !== 'win32') {
    for (const dir of dirs) if (isFile(at(dir, name))) return { found: at(dir, name) };
    return null;
  }
  const exe = /\.exe$/i.test(name) ? [name] : isBatch(name) ? [] : [`${name}.exe`];
  for (const file of exe) for (const dir of dirs) if (isFile(at(dir, file))) return { found: at(dir, file) };
  for (const file of isBatch(name) ? [name] : [`${name}.cmd`, `${name}.bat`]) for (const dir of dirs) if (isFile(at(dir, file))) return { batch: at(dir, file) };
  return null;
}

/**
 * The program a nudge runs, with the arguments that go before its own: the first of `command` that is found. A
 * `${env:NAME}` one is taken as it is; a path must exist; a bare name is looked up on `PATH`.
 */
export function nudgeProgram(
  command: HarnessNudge['command'],
  home: string,
  options: { log?: (line: string) => void; platform?: NodeJS.Platform; path?: string } = {},
): { command: string; args: string[] } | null {
  const platform = options.platform ?? process.platform;
  const skipBatch = (path: string): void => options.log?.(`nudge: ${path} is a .cmd/.bat script, which Node runs only through a shell; not run (no .exe found)`);
  const candidates = typeof command === 'string' ? [command] : Array.isArray(command) ? command : [];
  for (const candidate of candidates) {
    const [program, ...before] = typeof candidate === 'string' ? [candidate] : Array.isArray(candidate) ? candidate : [];
    if (typeof program !== 'string' || !program || !before.every((arg) => typeof arg === 'string')) continue;
    const named = /\$\{env:/.test(program);
    const filled = fillEnv(program);
    if (!filled) continue;
    if (named) {
      if (platform === 'win32' && isBatch(filled)) {
        skipBatch(filled);
        continue;
      }
      return { command: filled, args: before };
    }
    const path = expandHome(filled, home);
    if (isAbsolute(path) || path.includes('/') || path.includes('\\')) {
      if (platform === 'win32' && isBatch(path)) {
        if (existsSync(path)) skipBatch(path);
        continue;
      }
      if (existsSync(path)) return { command: path, args: before };
      continue;
    }
    const found = onPath(path, platform, options.path);
    if (found && 'found' in found) return { command: found.found, args: before };
    if (found) skipBatch(found.batch);
  }
  return null;
}

/**
 * The fields of the first live `envFile` (see {@link HarnessNudge.envFile}) that has every field in `needs`, or `null`
 * when there is none (the harness's app is not running).
 */
export function liveEnvFile(
  spec: NonNullable<HarnessNudge['envFile']>,
  needs: readonly string[],
  home: string,
  alive: (pid: number) => boolean = defaultAlive,
): Record<string, unknown> | null {
  let pattern: RegExp;
  try {
    pattern = new RegExp(spec.pattern);
  } catch {
    return null;
  }
  const dir = expandHome(spec.dir, home);
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => pattern.test(name));
  } catch {
    return null;
  }
  for (const name of names) {
    try {
      const fields = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
      if (!fields || typeof fields !== 'object' || needs.some((field) => fields[field] === undefined || fields[field] === null || fields[field] === '')) continue;
      const pid = spec.pid ? Number(fields[spec.pid]) : 0;
      if (pid && !alive(pid)) continue;
      return fields;
    } catch {
      // a file being written: skip it
    }
  }
  return null;
}

/** Fills `${session}` and `${text}` into one argument, in one pass (what is filled in is never read again). */
export function fillArg(arg: string, values: { session: string; text: string }): string {
  return arg.replace(/\$\{(session|text)\}/g, (_, name: 'session' | 'text') => values[name]);
}

/** The message a nudge starts the turn with; the hook, or the next tool call, adds the waiting messages themselves. */
export function nudgeText(artifact: string): string {
  return `Open Artifact: the person sent comments or requests from ${artifact}. They come with this message or your next Open Artifact tool call; handle them (ArtifactComments {action: "read", url: "${artifact}"} shows them too).`;
}

/** A session id a nudge passes on: no control characters, and never one an argument parser could take for an option. */
const SAFE_SESSION = /^[^\s\x00-\x1f\x7f-][^\x00-\x1f\x7f]{0,255}$/;

/**
 * Wakes `ref`'s session when its harness's profile has a nudge; `false` when it was not (no nudge, no session, the
 * app not running, no program, or the command failed).
 */
export async function nudgeSession(ref: SessionRef, artifact: string, options: NudgeOptions = {}): Promise<boolean> {
  if (!ref.session) return false;
  const log = options.log ?? (() => undefined);
  const nudge = (options.nudgeOf ?? nudgeOf)(ref.harness);
  if (!nudge) return false;
  const who = `${ref.harness}:${ref.session}`;
  if (!SAFE_SESSION.test(ref.session)) {
    log(`nudge ${who}: not a session id a command takes`);
    return false;
  }
  const home = options.home ?? homedir();
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (nudge.env) {
    const needs = [...new Set(Object.values(nudge.env).flatMap((value) => [...String(value).matchAll(/\$\{file\.([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!)))];
    const file = nudge.envFile ? liveEnvFile(nudge.envFile, needs, home, options.alive) : needs.length ? null : {};
    if (!file) {
      log(`nudge ${who}: the app is not running (no live ${nudge.envFile?.dir ?? 'file'})`);
      return false;
    }
    for (const [name, template] of Object.entries(nudge.env)) {
      const value = fillEnv(String(template).replace(/\$\{file\.([A-Za-z0-9_]+)\}/g, (_, field: string) => String(file[field] ?? '')));
      if (value === null) {
        log(`nudge ${who}: ${name} names a variable that is not set`);
        return false;
      }
      env[name] = value;
    }
  }
  const program = nudgeProgram(nudge.command, home, { log });
  if (!program) {
    log(`nudge ${who}: no command`);
    return false;
  }
  const values = { session: ref.session, text: nudgeText(artifact) };
  const error = await (options.run ?? defaultRun)(program.command, [...program.args, ...nudge.args.map((arg) => fillArg(String(arg), values))], env);
  log(`nudge ${who}: ${error ? `failed: ${error.message}` : 'sent'}`);
  return !error;
}
