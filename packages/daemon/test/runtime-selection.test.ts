/**
 * Which runtime starts the daemon (design 10.1; `runtimes.ts` in the kit, `RuntimeManager` here): the newest
 * compatible wins, a gone folder is skipped, uninstalling a host does not take the machine back to an older runtime,
 * and `bin` / `$OPEN_ARTIFACT_DAEMON_BIN` override the choice.
 */

import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { daemonStartPlan, missingRuntimes, rankRuntimes, readRuntimesFile, runtimeCandidates, runtimeEnv, satisfies, compareVersions } from '@open-artifact/harness-kit';
import { RuntimeManager } from '../src/runtime.ts';
import { makeRuntime } from './runtime-fixtures.ts';

const SHARED = join(TEST_HOME, 'runtime');
const P1 = { min: 1, max: 1 };

beforeEach(() => {
  for (const name of ['runtime', 'runtimes.json', 'settings.json']) rmSync(join(TEST_HOME, name), { recursive: true, force: true });
});

function register(records: Array<{ dir: string; version: string; harness?: string }>): void {
  writeFileSync(join(TEST_HOME, 'runtimes.json'), JSON.stringify({ runtimes: records }));
}

test('the newest runtime that speaks the caller\'s protocol wins, whatever its source', () => {
  makeRuntime(join(SHARED, '1.0.0'), '1.0.0');
  makeRuntime(join(SHARED, '2.0.0'), '2.0.0');
  const host = makeRuntime(tempDir('open-artifact-host-'), '2.5.0');
  const future = makeRuntime(tempDir('open-artifact-future-'), '3.0.0', { min: 2, max: 2 });
  register([
    { dir: host, version: '2.5.0', harness: 'app-a' },
    { dir: future, version: '3.0.0', harness: 'app-b' },
  ]);
  const ownBin = join(tempDir('open-artifact-own-bin-'), 'own.mjs');
  writeFileSync(ownBin, '');
  const own = { bin: ownBin, version: '1.5.0', protocols: P1 };
  const ranked = rankRuntimes(runtimeCandidates(TEST_HOME, own), { protocols: P1, pin: null });
  assert.deepEqual(ranked.map((c) => `${c.version}:${c.source}`), ['2.5.0:registered', '2.0.0:shared', '1.5.0:own', '1.0.0:shared']);
  const plan = daemonStartPlan({ own, env: { OPEN_ARTIFACT_HOME: TEST_HOME } });
  assert.equal(plan.override, false);
  assert.equal(plan.tries[0]?.bin, join(host, 'scripts', 'open-artifact.mjs'));
  assert.equal(plan.tries.length, 3);
  // A running daemon older than the caller's own runtime is replaced; a newer one on disk does not replace it.
  assert.equal(plan.floor, '1.5.0');
  // A caller that speaks protocol 2 gets the protocol-2 runtime.
  assert.equal(daemonStartPlan({ own, protocols: { min: 1, max: 2 }, env: { OPEN_ARTIFACT_HOME: TEST_HOME } }).tries[0]?.version, '3.0.0');
});

test('a registered runtime whose folder is gone is skipped, and listed as missing', () => {
  const host = makeRuntime(tempDir('open-artifact-host-'), '4.0.0');
  register([{ dir: host, version: '4.0.0', harness: 'app' }]);
  rmSync(host, { recursive: true });
  assert.deepEqual(runtimeCandidates(TEST_HOME).map((c) => c.version), []);
  assert.deepEqual(missingRuntimes(TEST_HOME).map((r) => r.version), ['4.0.0']);
  // A folder that now holds another version does not count as the registered one.
  makeRuntime(host, '0.1.0');
  assert.deepEqual(runtimeCandidates(TEST_HOME).map((c) => c.version), []);
});

test('uninstalling a host does not downgrade: the daemon keeps a copy of the newest runtime it brought', async () => {
  makeRuntime(join(SHARED, '1.0.0'), '1.0.0');
  const host = makeRuntime(tempDir('open-artifact-host-'), '5.0.0');
  const manager = new RuntimeManager({ version: '1.0.0', log: () => undefined, broadcast: () => undefined, idle: () => true, connected: () => ['app'], switchTo: () => undefined });
  manager.hello('app', { protocols: P1, runtime: { dir: host, version: '5.0.0', update: 'auto' } });
  await manager.settled();
  assert.equal(readRuntimesFile(TEST_HOME).runtimes[0]?.harness, 'app');
  assert.deepEqual(readRuntimesFile(TEST_HOME).adapters?.app?.protocols, P1);
  assert.equal(existsSync(join(SHARED, '5.0.0', 'scripts', 'open-artifact.mjs')), true);
  rmSync(host, { recursive: true });
  const plan = daemonStartPlan({ env: { OPEN_ARTIFACT_HOME: TEST_HOME } });
  assert.equal(plan.tries[0]?.version, '5.0.0');
  assert.equal(plan.tries[0]?.bin, join(SHARED, '5.0.0', 'scripts', 'open-artifact.mjs'));
  // An older host is recorded but not copied.
  const older = makeRuntime(tempDir('open-artifact-host-'), '3.0.0');
  manager.hello('old-app', { runtime: { dir: older, version: '3.0.0' } });
  await manager.settled();
  assert.equal(existsSync(join(SHARED, '3.0.0')), false);
  // A runtime that is not what it says is not recorded.
  manager.hello('liar', { runtime: { dir: older, version: '9.0.0' } });
  assert.equal(readRuntimesFile(TEST_HOME).runtimes.some((r) => r.harness === 'liar'), false);
  // The idle daemon (1.0.0) switches to the newest.
  assert.equal(manager.pendingSwitch()?.version, '5.0.0');
  manager.close();
});

test('bin and $OPEN_ARTIFACT_DAEMON_BIN override the choice; a launcher naming its own runtime does not', () => {
  makeRuntime(join(SHARED, '7.0.0'), '7.0.0');
  const own = makeRuntime(tempDir('open-artifact-own-'), '6.0.0');
  const ownRuntime = { dir: own, version: '6.0.0', protocols: P1 };
  const env = { OPEN_ARTIFACT_HOME: TEST_HOME };
  assert.deepEqual(daemonStartPlan({ own: ownRuntime, bin: '/x/explicit.mjs', env }).tries.map((t) => t.bin), ['/x/explicit.mjs']);
  const byEnv = daemonStartPlan({ own: ownRuntime, env: { ...env, OPEN_ARTIFACT_DAEMON_BIN: '/x/env.mjs' } });
  assert.equal(byEnv.override, true);
  assert.deepEqual(byEnv.tries.map((t) => t.bin), ['/x/env.mjs']);
  // The launcher of the own runtime sets DAEMON_BIN to itself: the choice still runs, and the newer one starts, without
  // the own runtime's launcher variables.
  const launched = daemonStartPlan({
    own: ownRuntime,
    env: { ...env, OPEN_ARTIFACT_DAEMON_BIN: join(own, 'scripts', 'open-artifact.mjs'), OPEN_ARTIFACT_SHELL_DIR: join(own, 'vendor', 'shell') },
  });
  assert.equal(launched.override, false);
  assert.equal(launched.tries[0]?.version, '7.0.0');
  assert.equal(launched.tries[0]?.env.OPEN_ARTIFACT_DAEMON_BIN, undefined);
  assert.equal(launched.tries[0]?.env.OPEN_ARTIFACT_SHELL_DIR, undefined);
  assert.equal(runtimeEnv({ OPEN_ARTIFACT_SHELL_DIR: '/elsewhere' }, launched.tries[0]!.candidate!, []).OPEN_ARTIFACT_SHELL_DIR, '/elsewhere');
});

test('a pin keeps the choice in its range; a pin nothing matches is ignored', () => {
  makeRuntime(join(SHARED, '1.2.0'), '1.2.0');
  makeRuntime(join(SHARED, '2.0.0'), '2.0.0');
  writeFileSync(join(TEST_HOME, 'settings.json'), JSON.stringify({ runtime: { pin: '~1.2' } }));
  assert.equal(daemonStartPlan({ env: { OPEN_ARTIFACT_HOME: TEST_HOME } }).tries[0]?.version, '1.2.0');
  writeFileSync(join(TEST_HOME, 'settings.json'), JSON.stringify({ runtime: { pin: '^9' } }));
  assert.equal(daemonStartPlan({ env: { OPEN_ARTIFACT_HOME: TEST_HOME } }).tries[0]?.version, '2.0.0');
});

test('versions and ranges', () => {
  assert.ok(compareVersions('1.0.0-beta.2', '1.0.0') < 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(satisfies('0.14.3', '^0.14'));
  assert.ok(!satisfies('0.15.0', '^0.14'));
  assert.ok(satisfies('1.4.0', '>=1.2 <2 || 3.x'));
  assert.ok(satisfies('3.1.0', '>=1.2 <2 || 3.x'));
  assert.ok(!satisfies('2.0.0-rc.1', '>=1'));
});
