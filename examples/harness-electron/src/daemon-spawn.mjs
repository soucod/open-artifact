/**
 * Starting the daemon in an Electron utility process, for an app whose `RunAsNode` fuse is off.
 *
 * With that fuse off, the app's executable no longer runs scripts under `ELECTRON_RUN_AS_NODE=1`, so the kit's own
 * start cannot work. The kit then hands the start to the app (`createHarness({ daemon: { spawn } })`): it still picks
 * the runtime, waits for the daemon, checks its version and tries the next runtime when one does not start.
 *
 * - `process.argv` in a utility process is `[<Electron Helper>, bin, ...args]`, the shape the daemon reads, so `bin`
 *   is forked as it is, without a wrapper script.
 * - `OPEN_ARTIFACT_NODE_CHILDREN=threads` says explicitly that type servers run in worker threads of the daemon. A daemon
 *   in a utility process chooses threads anyway (its executable must not be started as Node); an app with the fuse on
 *   that wants child processes passes `process` instead.
 * - The process is returned so the kit leaves a runtime that ended at once without waiting for its timeout.
 * - A utility process ends with the app, and Electron ends it without asking: the daemon gets no chance to remove
 *   `daemon.json` and its lock, or to let its type servers finish. So the app asks it to stop before it quits
 *   (`stopDaemonUtilityProcess`, from `before-quit` in `main.mjs`) and waits a bounded time for it to end. The next
 *   app to connect starts the daemon again.
 */
import { createWriteStream } from 'node:fs';
import { utilityProcess } from 'electron';

/** The daemon this app forked, while it runs (`null`: none, or another app's daemon answered and nothing was forked). */
let daemon = null;

/** `daemon.spawn` for `createHarness`: forks the daemon in a utility process and appends its output to the log file. */
export function spawnDaemonInUtilityProcess({ bin, args, env, logFile }) {
  const child = utilityProcess.fork(bin, args, {
    env: { ...env, OPEN_ARTIFACT_NODE_CHILDREN: 'threads' },
    stdio: 'pipe',
    serviceName: 'Open Artifact',
  });
  const log = createWriteStream(logFile, { flags: 'a' });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  daemon = child;
  child.once('exit', () => {
    log.end();
    if (daemon === child) daemon = null;
  });
  return child;
}

/**
 * How long the app waits for the daemon to end, ms. The daemon itself waits up to 6 s for its type servers in threads
 * before it exits.
 */
export const DAEMON_STOP_TIMEOUT_MS = 8000;

/**
 * Asks the daemon this app forked to stop, and waits for it to end: `'none'` when this app forked no daemon (or it has
 * ended), `'stopped'` once it exited, `'timeout'` when it did not within `timeoutMs` (the app quits anyway, and
 * Electron ends the process).
 *
 * `kill()` sends `SIGTERM` on macOS and Linux: the daemon closes, waits for its type servers' threads, removes
 * `daemon.json` and its lock, and writes `daemon <version> stopped (SIGTERM)` to `<home>/logs/daemon.log`. On Windows
 * `kill()` ends the process at once, as quitting would; the next daemon to start replaces the files left behind.
 */
export function stopDaemonUtilityProcess({ timeoutMs = DAEMON_STOP_TIMEOUT_MS } = {}) {
  const child = daemon;
  if (!child || child.pid === undefined) return Promise.resolve('none');
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve('stopped');
    });
    if (!child.kill()) {
      clearTimeout(timer);
      resolve('none');
    }
  });
}
