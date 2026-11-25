/**
 * Finding and starting the local daemon, and calling its Library API.
 *
 * One daemon runs per Open Artifact home (`~/.agents/open-artifact`, or `$OPEN_ARTIFACT_HOME`); it writes where it
 * listens and its token to `daemon.json` there. Uses the global `fetch` (Node ≥ 22, Electron's Node).
 *
 * Which runtime starts it is chosen in `runtimes.ts` (design 10.1): the newest compatible one among the caller's own,
 * the ones adapters registered and the shared ones. `$OPEN_ARTIFACT_DAEMON_BIN` and an explicit `bin` skip the choice.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { OpenArtifactError, PROTOCOL_MAX, PROTOCOL_MIN, type DaemonHealth, type DaemonState, type ProtocolRange } from '@open-artifact/protocol';
import { compareVersions, rankRuntimes, readRuntimePin, realOrResolved, runtimeCandidates, runtimeEnv, within, type OwnRuntime, type RuntimeCandidate } from './runtimes.ts';

/**
 * The Open Artifact home: `home` when given, else `$OPEN_ARTIFACT_HOME`, else `~/.agents/open-artifact`. A leading `~`
 * is the home folder.
 */
export function openArtifactHome(home?: string): string {
  const path = home || process.env.OPEN_ARTIFACT_HOME || '~/.agents/open-artifact';
  if (path === '~') return homedir();
  return resolve(path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
}

/**
 * Whether version `a` is older than `b`, by major.minor.patch only: a pre-release (a local build) is not replaced by
 * its own release. Choosing among runtimes uses full semver order (`compareVersions`).
 */
export function isOlderVersion(a: string, b: string): boolean {
  const core = (v: string): string => v.replace(/[-+].*$/, '');
  return compareVersions(core(a), core(b)) < 0;
}

/**
 * The `open-artifact` entry to start when no daemon runs, as far as the kit knows it: `$OPEN_ARTIFACT_DAEMON_BIN`.
 * `undefined` when it is not set; a host then passes `bin` (or `runtime.dir` to `createHarness`).
 */
export function defaultDaemonBin(): string | undefined {
  return process.env.OPEN_ARTIFACT_DAEMON_BIN || undefined;
}

/** True when a process with this id is alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * `daemon.json` of the home (see {@link openArtifactHome}) when its process is alive and answers health; `null`
 * otherwise.
 */
export async function readDaemon(home?: string): Promise<DaemonState | null> {
  let state: DaemonState | null = null;
  try {
    state = JSON.parse(readFileSync(join(openArtifactHome(home), 'daemon.json'), 'utf8')) as DaemonState;
  } catch {
    return null;
  }
  if (!state?.url || !state.pid || !alive(state.pid)) return null;
  try {
    const response = await fetch(`${state.url}/__open-artifact/health`, { signal: AbortSignal.timeout(1500) });
    const body = (await response.json()) as Partial<DaemonHealth>;
    return body?.openArtifact === 1 ? state : null;
  } catch {
    return null;
  }
}

/** Options of {@link ensureDaemon}. */
export interface EnsureDaemonOptions {
  /** How long to wait for the daemon to answer, ms. Default 15 s. */
  timeoutMs?: number;
  /** Environment of the started daemon. */
  env?: NodeJS.ProcessEnv;
  /**
   * The `open-artifact` entry to run, skipping the choice of runtime (as `$OPEN_ARTIFACT_DAEMON_BIN` does). Left out:
   * the newest compatible runtime starts (see {@link own}).
   */
  bin?: string;
  /**
   * The version `bin` (or {@link own}) starts. A running daemon older than it is replaced, so an upgraded harness gets
   * its own types and tools. Left out: any running daemon is used.
   */
  version?: string;
  /**
   * The caller's own runtime (`createHarness`: `runtime.dir`): one candidate among the registered and shared ones, the
   * newest compatible of which starts. A running daemon older than it is replaced.
   */
  own?: OwnRuntime;
  /** The Harness API versions the caller speaks (default this kit's): a runtime that speaks none of them is not started. */
  protocols?: ProtocolRange;
  /**
   * The Open Artifact home (default `$OPEN_ARTIFACT_HOME` of `env`, then of this process): a home of its own gives the
   * harness its own daemon and library.
   */
  home?: string;
  /**
   * Starts the daemon process instead of the kit, for a host that cannot run a script with its own executable (an
   * Electron app whose `RunAsNode` fuse is off: `utilityProcess.fork(start.bin, start.args, { env: start.env })`).
   * Called once per runtime tried; the kit still waits for the daemon to answer, checks its version, and tries the next
   * runtime when this one throws or ends without a daemon. See {@link DaemonSpawn}.
   */
  spawn?: DaemonSpawn;
}

/** What {@link EnsureDaemonOptions.spawn} is given: one daemon to start. */
export interface DaemonStart {
  /** The `open-artifact` entry script to run (`scripts/open-artifact.mjs` of a runtime). */
  bin: string;
  /** What follows the entry on the command line: `['daemon', 'run']`. */
  args: string[];
  /**
   * The environment to start it with: the kit's choice for this runtime (`OPEN_ARTIFACT_HOME` included when a home was
   * given). `ELECTRON_RUN_AS_NODE` is not in it: a host that runs `bin` with Node by other means does not need it.
   */
  env: NodeJS.ProcessEnv;
  /** `<home>/logs/daemon.out`, where the kit's own start appends the daemon's output (the host may do the same). */
  logFile: string;
}

/**
 * Starts one daemon (see {@link EnsureDaemonOptions.spawn}). It may return the started process (anything with
 * `once('exit', …)`, such as Electron's `UtilityProcess` or a `ChildProcess`): then a runtime that ends without
 * starting is given up at once and the next one tried; otherwise the kit waits for it until its timeout.
 */
export type DaemonSpawn = (start: DaemonStart) => void | DaemonExitSource | Promise<void | DaemonExitSource>;

/** A started daemon process, as far as the kit watches it: its end. */
export interface DaemonExitSource {
  once(event: 'exit', listener: (...args: unknown[]) => void): unknown;
}

/** What {@link ensureDaemon} would start, in order of preference. */
export interface DaemonStartPlan {
  /** The runtimes to try, best first (the next one when one exits without starting). */
  tries: Array<{ bin: string; version?: string; env: NodeJS.ProcessEnv; candidate?: RuntimeCandidate }>;
  /** A running daemon older than this is replaced; `undefined`: any running daemon is used. */
  floor?: string;
  /** Whether the choice was overridden (`bin`, `$OPEN_ARTIFACT_DAEMON_BIN`). */
  override: boolean;
}

/** The entry override in `env`, unless it is the caller's own runtime (a launcher names itself there). */
function envOverride(env: NodeJS.ProcessEnv, own: OwnRuntime | undefined): string | undefined {
  const named = env.OPEN_ARTIFACT_DAEMON_BIN;
  if (!named) return undefined;
  if (own?.bin && realOrResolved(own.bin) === realOrResolved(named)) return undefined;
  if (own?.dir && within(own.dir, named)) return undefined;
  return named;
}

/**
 * What {@link ensureDaemon} starts for these options: the override when there is one, else the compatible runtimes
 * of the home, newest first (`runtimes.ts`).
 */
export function daemonStartPlan(options: EnsureDaemonOptions = {}): DaemonStartPlan {
  const env = options.env ?? process.env;
  const home = openArtifactHome(options.home ?? env.OPEN_ARTIFACT_HOME ?? undefined);
  const override = options.bin ?? envOverride(env, options.own);
  if (override) {
    const version = options.version ?? (options.own?.bin && realOrResolved(options.own.bin) === realOrResolved(override) ? options.own.version : undefined);
    return { tries: [{ bin: override, ...(version ? { version } : {}), env }], ...(version ? { floor: version } : {}), override: true };
  }
  const candidates = runtimeCandidates(home, options.own);
  const ranked = rankRuntimes(candidates, { protocols: options.protocols ?? { min: PROTOCOL_MIN, max: PROTOCOL_MAX }, pin: readRuntimePin(home) });
  const floor = options.own?.version ?? options.version;
  return {
    tries: ranked.slice(0, 3).map((candidate) => ({ bin: candidate.bin, version: candidate.version, env: runtimeEnv(env, candidate, candidates), candidate })),
    ...(floor ? { floor } : {}),
    override: false,
  };
}

/** Stops a running daemon and waits until it has gone, so a new one can take its port. */
async function replaceDaemon(state: DaemonState, timeoutMs: number): Promise<void> {
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (alive(state.pid) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
}

/**
 * Starts `bin daemon run` in the background for a home, its output appended to `<home>/logs/daemon.out`. Runs with
 * this process's executable (`ELECTRON_RUN_AS_NODE` lets an Electron host's run plain Node).
 */
export function startDaemonProcess(bin: string, options: { env?: NodeJS.ProcessEnv; home?: string } = {}): ChildProcess {
  const env = options.env ?? process.env;
  const logs = join(openArtifactHome(options.home ?? env.OPEN_ARTIFACT_HOME ?? undefined), 'logs');
  mkdirSync(logs, { recursive: true });
  const fd = openSync(join(logs, 'daemon.out'), 'a');
  try {
    const child = spawn(process.execPath, [bin, 'daemon', 'run'], {
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...env, ...(options.home ? { OPEN_ARTIFACT_HOME: options.home } : {}), ELECTRON_RUN_AS_NODE: '1' },
    });
    child.on('error', () => undefined);
    child.unref();
    return child;
  } finally {
    closeSync(fd);
  }
}

/**
 * The running daemon, started in the background when there is none. The runtime that starts is the newest one
 * compatible with the caller (see {@link daemonStartPlan}); when it exits without starting, the next one is tried. A
 * running daemon older than the caller's own runtime (`own`, or `version` with `bin`) is replaced; the harnesses
 * connected to it reconnect. A newer runtime that is only on disk does not replace a running daemon: the daemon
 * switches to it by itself once idle.
 */
export async function ensureDaemon(options: EnsureDaemonOptions = {}): Promise<DaemonState> {
  const { timeoutMs = 15_000, env = process.env } = options;
  const home = options.home ?? env.OPEN_ARTIFACT_HOME ?? undefined;
  const running = await readDaemon(home);
  const plan = daemonStartPlan({ ...options, env });
  if (running && (!plan.floor || !isOlderVersion(running.version ?? '0.0.0', plan.floor))) return running;
  if (!plan.tries.length) {
    throw new OpenArtifactError('no_daemon', 'No open-artifact daemon is running, and there is no runtime to start one.', {
      fix: 'Set OPEN_ARTIFACT_DAEMON_BIN to the open-artifact entry, or pass bin (createHarness: runtime.dir).',
    });
  }
  if (running) await replaceDaemon(running, 5_000);
  const logFile = join(openArtifactHome(home), 'logs', 'daemon.out');
  const deadline = Date.now() + timeoutMs;
  // What the host's own start threw, per runtime: the error names them when no daemon came up.
  const thrown: string[] = [];
  for (const attempt of plan.tries) {
    let exited = false;
    const onExit = (): void => {
      exited = true;
    };
    if (options.spawn) {
      const start: DaemonStart = { bin: attempt.bin, args: ['daemon', 'run'], env: { ...attempt.env, ...(home ? { OPEN_ARTIFACT_HOME: home } : {}) }, logFile };
      delete start.env.ELECTRON_RUN_AS_NODE;
      try {
        mkdirSync(join(openArtifactHome(home), 'logs'), { recursive: true });
        const started = await options.spawn(start);
        if (started && typeof started.once === 'function') started.once('exit', onExit);
      } catch (error) {
        thrown.push(`${attempt.bin}: ${(error as Error)?.message ?? String(error)}`);
        continue;
      }
    } else {
      startDaemonProcess(attempt.bin, { env: attempt.env, ...(home ? { home } : {}) }).once('exit', onExit);
    }
    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 150));
      const state = await readDaemon(home);
      if (state) return state;
      // It ended without a daemon (a broken runtime): the next one; one that lost a race to another starter is found above.
      if (exited) break;
    }
    if (!exited) break;
  }
  const state = await readDaemon(home);
  if (state) return state;
  const why = thrown.length ? ` The host's start failed: ${thrown.join('; ')}.` : '';
  throw new OpenArtifactError('daemon_failed', `The open-artifact daemon did not start; see ${logFile}.${why}`);
}

/** Options of {@link api}. */
export interface ApiOptions {
  /** Defaults to `GET` without a body and `POST` with one. */
  method?: 'GET' | 'POST' | 'DELETE';
  /** Query parameters. */
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** More request headers (the CLI says who it is: `X-Open-Artifact-Client`, `X-Open-Artifact-Agent`). */
  headers?: Record<string, string>;
}

/** One Library API call (`/api/open-artifact.<name>`) with the daemon token. Returns the parsed JSON body. */
export async function api<T = unknown>(state: DaemonState, name: string, body?: unknown, options: ApiOptions = {}): Promise<T> {
  const url = new URL(`/api/open-artifact.${name}`, state.url);
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...options.headers, Authorization: `Bearer ${state.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return (await response.json()) as T;
}
