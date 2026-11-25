/**
 * The connection to Open Artifact, as every host in these examples makes it: one `createHarness` call.
 *
 * Shared with `examples/harness-electron`, which passes `embed` and `open` to show pages in its own window; this
 * headless host shows none, so the daemon answers an open with the page's address instead.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, runtimeInfo } from '@open-artifact/harness-kit';

/**
 * Where an Open Artifact runtime may be: the installed `@open-artifact/cli` package (a real host depends on it), else,
 * inside this repository, the runtime `node scripts/build-plugins.mjs` builds in `skills/open-artifact/`.
 */
export function runtimeFolders(from = import.meta.url) {
  const folders = [];
  try {
    folders.push(dirname(createRequire(from).resolve('@open-artifact/cli/package.json')));
  } catch {
    // not installed
  }
  for (let dir = dirname(fileURLToPath(from)); dir !== dirname(dir); dir = dirname(dir)) {
    const skill = join(dir, 'skills', 'open-artifact');
    if (existsSync(join(skill, 'SKILL.md'))) {
      folders.push(skill);
      break;
    }
  }
  return folders;
}

/**
 * The runtime this host carries, as `createHarness({ runtime })` takes it: the kit starts it when no daemon runs.
 * `undefined` when `OPEN_ARTIFACT_DAEMON_BIN` names the daemon to run instead (development and tests).
 */
export function hostRuntime(folders = runtimeFolders()) {
  for (const dir of folders) {
    const version = runtimeInfo(dir)?.version;
    if (version) return { dir, version };
  }
  if (process.env.OPEN_ARTIFACT_DAEMON_BIN) return undefined;
  throw new Error('No Open Artifact runtime: install @open-artifact/cli (npm install @open-artifact/cli), or in this repository build it (npm run build, then node scripts/build-plugins.mjs).');
}

/**
 * Connects to the daemon (starting it when it is not running) and says hello.
 *
 * - `name` is the harness name the daemon routes by; `agentName` is what pages call the agent ("Ask Example").
 * - `wake(params)` gets each message for one of this host's sessions: answer `delivered`, `queued`, `resumed` (it
 *   started the session again to take it), `drafted` (it put it in the session's draft for the person) or `failed`.
 * - `runtime` is the Open Artifact runtime this host carries ({@link hostRuntime}); the kit starts it when needed.
 * - `tools: 'native'` says the tools reach the agent through this host (from `oa.tools()`), not through MCP.
 * - Anything else in `options` goes to `createHarness` as it is (`embed`, `open`, `home`, `log`, …).
 */
export function connectHarness({ name = 'example-node', agentName = 'Example', wake, runtime = hostRuntime(), ...options } = {}) {
  return createHarness({
    harness: name,
    agentName,
    ...(runtime ? { runtime } : {}),
    commands: ['open-artifact'],
    caps: { wake: { resume: true }, tools: 'native', library: 'own' },
    wake,
    ...options,
  });
}

/** The session a tool call or a wake is about, as the daemon names it. */
export function callerOf(session) {
  return { session: session.id, workspace: session.workspace };
}
