/**
 * Test setup, imported first by every test file: a temporary `OPEN_ARTIFACT_HOME`, no
 * user or installed types, a short wake merge window and no idle exit.
 */

import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { agentVariables } from '../src/agent-session.ts';

/** A fresh temporary folder. */
export function tempDir(prefix = 'open-artifact-test-'): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** The temporary Open Artifact home of this test process. */
export const TEST_HOME = tempDir('open-artifact-home-');

process.env.OPEN_ARTIFACT_HOME = TEST_HOME;
process.env.OPEN_ARTIFACT_USER_TYPES = tempDir('open-artifact-user-types-');
process.env.OPEN_ARTIFACT_INSTALLED_TYPES = tempDir('open-artifact-installed-types-');
process.env.OPEN_ARTIFACT_WAKE_MERGE_MS = '40';
process.env.OPEN_ARTIFACT_IDLE_MS = '0';
process.env.OPEN_ARTIFACT_BROWSER = 'none';
// Runtime updates (runtime.ts) never reach the network or this computer's policy: a registry nothing listens on
// (tests that update start their own), no machine policy file, no user .npmrc.
process.env.OPEN_ARTIFACT_REGISTRY = 'http://127.0.0.1:9/';
process.env.OPEN_ARTIFACT_MACHINE_POLICY = join(TEST_HOME, 'no-machine-policy.json');
process.env.NPM_CONFIG_USERCONFIG = join(TEST_HOME, 'no-npmrc');
delete process.env.OPEN_ARTIFACT_RUNTIME_UPDATE;
delete process.env.OPEN_ARTIFACT_DAEMON_BIN;
delete process.env.OPEN_ARTIFACT_EXTRA_TYPES;
delete process.env.OPEN_ARTIFACT_BUILTIN_TYPES;
delete process.env.OPEN_ARTIFACT_SHELL_DIR;
delete process.env.OPEN_ARTIFACT_HOME_DIR;
// These tests may themselves run inside an agent's session (CLAUDECODE, CODEX_THREAD_ID, …): the command lines they
// start stand for a person's own terminal, where the publishing guard (`agent-session.ts`) lets everything through.
for (const variable of agentVariables([resolve(import.meta.dirname, '..', 'harnesses')]).keys()) delete process.env[variable];

/** Polls `check` until it returns a truthy value or the time runs out. */
export async function until<T>(check: () => T | Promise<T>, timeoutMs = 3000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((done) => setTimeout(done, 20));
  }
}
