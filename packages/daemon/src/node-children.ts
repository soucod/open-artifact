/**
 * Node children: how the daemon runs a Node.js script of its own (a type server whose `start.command` is `node`).
 *
 * - `process`: `process.execPath <script> …` as a child process, with `ELECTRON_RUN_AS_NODE=1` so an Electron host's
 *   executable runs it as plain Node. The default.
 * - `threads`: a `worker_threads` Worker in the daemon's own process, for a daemon that runs inside an Electron process
 *   (a `utilityProcess`, as an app whose `RunAsNode` fuse is off starts it): its executable is an Electron helper or the
 *   app and must not be started as Node. The script sees the argv, environment and working folder it would have had
 *   (`process.cwd()` answers the folder; the operating system's own stays the daemon's), its stdout and stderr come out
 *   as a child's would, a stop is delivered as `SIGTERM` to its handlers (signals never reach a thread), and its end is
 *   the Worker's `exit` with the code.
 *
 * Which one, decided from how the daemon itself runs (nothing is started to find out):
 * 1. `$OPEN_ARTIFACT_NODE_CHILDREN` (`process` or `threads`) when set;
 * 2. plain Node.js (`process.versions.electron` unset): `process`;
 * 3. Electron with no `process.type`: Electron running as Node (`ELECTRON_RUN_AS_NODE` honoured), which shows its
 *    executable runs scripts: `process`;
 * 4. Electron with a `process.type` (`utility`, `browser`, …): `threads`. An app with the fuse on that still wants child
 *    processes for a daemon in a utility process sets the variable to `process`.
 * `ELECTRON_RUN_AS_NODE` in the environment is not a signal: a fuse-off app may have it set and ignore it.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { Worker } from 'node:worker_threads';

export type NodeChildrenMode = 'process' | 'threads';

/** Which mode is in effect, and why. */
export interface NodeChildrenChoice {
  mode: NodeChildrenMode;
  /** `env`: `$OPEN_ARTIFACT_NODE_CHILDREN` says; `node`: plain Node.js; `electron`: how Electron runs the daemon. */
  reason: 'env' | 'node' | 'electron';
  /** One line for logs and `doctor`. */
  detail: string;
}

/** The variable that chooses the mode. */
export const NODE_CHILDREN_VARIABLE = 'OPEN_ARTIFACT_NODE_CHILDREN';

/** `$OPEN_ARTIFACT_NODE_CHILDREN` when it names a mode; `null` when unset, empty or anything else (see {@link badModeVariable}). */
export function modeFromEnv(env: NodeJS.ProcessEnv = process.env): NodeChildrenMode | null {
  const value = env[NODE_CHILDREN_VARIABLE]?.trim().toLowerCase();
  return value === 'process' || value === 'threads' ? value : null;
}

/** A line saying the variable is set to something that is no mode (it is then ignored), or `null`. */
export function badModeVariable(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[NODE_CHILDREN_VARIABLE]?.trim();
  if (!value || modeFromEnv(env)) return null;
  return `${NODE_CHILDREN_VARIABLE}=${value} is neither "process" nor "threads"; it is ignored`;
}

/** What {@link chooseNodeChildren} goes by (tests pass their own). */
export interface NodeChildrenFacts {
  env?: NodeJS.ProcessEnv;
  /** Electron's version when Electron runs this process (`process.versions.electron`). */
  electron?: string | undefined;
  /** Electron's process type (`process.type`: `utility`, `browser`, `renderer`); unset when Electron runs as Node. */
  processType?: string | undefined;
}

/** Decides the mode (see the module comment). */
export function chooseNodeChildren(facts: NodeChildrenFacts = {}): NodeChildrenChoice {
  const env = facts.env ?? process.env;
  const electron = 'electron' in facts ? facts.electron : process.versions.electron;
  const processType = 'processType' in facts ? facts.processType : (process as { type?: string }).type;
  const forced = modeFromEnv(env);
  if (forced) return { mode: forced, reason: 'env', detail: `${NODE_CHILDREN_VARIABLE}=${forced}` };
  if (!electron) return { mode: 'process', reason: 'node', detail: 'plain Node.js runs child processes' };
  if (!processType) return { mode: 'process', reason: 'electron', detail: `Electron ${electron} runs the daemon as Node, so its executable runs scripts` };
  return { mode: 'threads', reason: 'electron', detail: `the daemon runs inside an Electron ${processType} process (Electron ${electron}), whose executable is not started as Node` };
}

let decided: NodeChildrenChoice | null = null;

/** This process's choice, made once at the first call and kept. */
export function nodeChildren(): NodeChildrenChoice {
  return (decided ??= chooseNodeChildren());
}

/** Forgets the kept choice (tests). */
export function resetNodeChildren(): void {
  decided = null;
}

// ---- running one --------------------------------------------------------------------------------------------------

/** A running Node child, in either mode (or any other command, as a child process). */
export interface NodeChild extends EventEmitter {
  readonly mode: NodeChildrenMode;
  /** The process id (`process` mode). */
  readonly pid: number | undefined;
  /** What identifies it while it runs, for logs: `pid 123` or `thread 4`. */
  readonly label: string;
  /** Unique on this computer while the daemon runs: the pid, or `<daemon pid>:<thread id>`. */
  readonly instance: number | string | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  /** True once it has ended. */
  readonly ended: boolean;
  /** Asks it to stop (`SIGTERM`, or the same delivered to the thread), then forces it after `forceAfterMs`. */
  stop(forceAfterMs: number): void;
  /** Ends it now (`SIGKILL`, `Worker.terminate()`). */
  kill(): void;
  // Events: 'exit' (code: number | null, signal: string | null), 'error' (error: Error) when it could not start.
}

/** What {@link startChild} runs. */
export interface ChildStart {
  /** `node` runs with this process's runtime (in the chosen mode); anything else as a child process. */
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** For a `node` command: how (default `process`). */
  mode?: NodeChildrenMode;
  /** A name for the thread (shows in debuggers). */
  name?: string;
}

/** Starts a child. Throws when it cannot be started at all (a bad command line); a failed start is an `error` event. */
export function startChild(start: ChildStart): NodeChild {
  const isNode = start.command === 'node';
  if (isNode && start.mode === 'threads') return new ThreadChild(start);
  // `node` is this process's own runtime (in an Electron host, the app run as Node), so no node is needed on PATH.
  const command = isNode ? process.execPath : start.command;
  const env = isNode ? { ...start.env, ELECTRON_RUN_AS_NODE: '1' } : start.env;
  return new ProcessChild(spawn(command, start.args, { cwd: start.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
}

class ProcessChild extends EventEmitter implements NodeChild {
  readonly mode = 'process' as const;
  private readonly child: ChildProcess;
  constructor(child: ChildProcess) {
    super();
    this.child = child;
    child.on('error', (error) => this.emit('error', error));
    child.on('exit', (code, signal) => this.emit('exit', code, signal));
  }
  get pid(): number | undefined {
    return this.child.pid;
  }
  get label(): string {
    return `pid ${this.child.pid ?? '?'}`;
  }
  get instance(): number | null {
    return this.child.pid ?? null;
  }
  get stdout(): Readable | null {
    return this.child.stdout;
  }
  get stderr(): Readable | null {
    return this.child.stderr;
  }
  get ended(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }
  stop(forceAfterMs: number): void {
    if (this.ended) return;
    try {
      this.child.kill('SIGTERM');
    } catch {
      return;
    }
    const timer = setTimeout(() => {
      if (!this.ended) this.child.kill('SIGKILL');
    }, forceAfterMs);
    timer.unref?.();
  }
  kill(): void {
    if (!this.ended) this.child.kill('SIGKILL');
  }
}

/** The message a thread takes as `SIGTERM`. */
const STOP_MESSAGE = 'open-artifact:stop';

/**
 * What runs first in the thread: the argv, working folder and stop message as a child process would have them, then
 * the script. CommonJS, evaluated (no file to ship beside a bundle or inside the single executable).
 */
const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
process.argv = [process.execPath, workerData.script, ...workerData.args];
const cwd = workerData.cwd;
process.cwd = () => cwd;
parentPort.on('message', (message) => {
  if (message !== ${JSON.stringify(STOP_MESSAGE)}) return;
  if (process.listenerCount('SIGTERM') > 0) process.emit('SIGTERM', 'SIGTERM');
  else process.exit(143);
});
parentPort.unref();
import(pathToFileURL(workerData.script).href).catch((error) => {
  process.stderr.write(String((error && error.stack) || error) + '\\n');
  process.exit(1);
});
`;

/** Splits `[...node flags, script, ...args]`; the script is resolved against `cwd`, as Node would. */
export function threadEntry(args: string[], cwd: string): { execArgv: string[]; script: string; args: string[] } {
  const at = args.findIndex((arg) => !arg.startsWith('-'));
  if (at < 0) throw new Error(`no script to run in ${JSON.stringify(args)}`);
  const given = isAbsolute(args[at]!) ? args[at]! : resolve(cwd, args[at]!);
  let script = given;
  try {
    // The module's own URL is its real path: a CLI that checks `process.argv[1]` against it sees the same.
    script = realpathSync(given);
  } catch {
    /* the import says it is missing */
  }
  return { execArgv: args.slice(0, at), script, args: args.slice(at + 1) };
}

class ThreadChild extends EventEmitter implements NodeChild {
  readonly mode = 'threads' as const;
  readonly pid = undefined;
  readonly label: string;
  readonly instance: string;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  private exited = false;
  private readonly worker: Worker;

  constructor(start: ChildStart) {
    super();
    const entry = threadEntry(start.args, start.cwd);
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.worker = new Worker(BOOTSTRAP, {
      eval: true,
      argv: [],
      execArgv: entry.execArgv,
      env: { ...start.env },
      stdin: false,
      stdout: true,
      stderr: true,
      workerData: { script: entry.script, args: entry.args, cwd: start.cwd },
      ...(start.name ? { name: start.name } : {}),
    });
    const threadId = this.worker.threadId;
    this.label = `thread ${threadId}`;
    this.instance = `${process.pid}:${threadId}`;
    this.worker.stdout.pipe(this.stdout);
    this.worker.stderr.pipe(this.stderr);
    // An uncaught error ends the thread (its `exit` follows with code 1): written where a process's would be.
    this.worker.on('error', (error) => this.stderr.write(`${(error as Error)?.stack ?? String(error)}\n`));
    this.worker.on('exit', (code) => {
      this.exited = true;
      this.emit('exit', code, null);
    });
  }
  get ended(): boolean {
    return this.exited;
  }
  stop(forceAfterMs: number): void {
    if (this.exited) return;
    this.worker.postMessage(STOP_MESSAGE);
    const timer = setTimeout(() => this.kill(), forceAfterMs);
    timer.unref?.();
  }
  kill(): void {
    if (!this.exited) void this.worker.terminate();
  }
}
