/**
 * Runtime updates (`runtime.ts`, design 10.2) against a fake registry on 127.0.0.1: the happy path, integrity, the
 * tar reader's refusals, an interrupted download, policy precedence, the once-a-day check, the switch once idle, and
 * the CLI (`runtime status | update | pin`, person-only).
 */

import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';
import { readRuntimesFile } from '@open-artifact/harness-kit';
import type { RuntimeUpdateEvent } from '@open-artifact/protocol';
import { ownRuntime } from '../src/client.ts';
import {
  RuntimeManager,
  bundledHarnesses,
  checkDue,
  chooseVersion,
  effectivePolicy,
  readTarball,
  registryUrl,
  runtimeStatus,
  runtimeStatusText,
  saveRuntimeSettings,
  updateRuntime,
  verifyIntegrity,
} from '../src/runtime.ts';
import { makeRuntime, runtimeTarball, sri, startRegistry, tarball, type FakeRegistry } from './runtime-fixtures.ts';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));
const SHARED = join(TEST_HOME, 'runtime');
const POLICY = process.env.OPEN_ARTIFACT_MACHINE_POLICY!;
let registry: FakeRegistry | null = null;

function reset(): void {
  for (const name of ['runtime', 'runtime-update.json', 'runtimes.json', 'settings.json']) rmSync(join(TEST_HOME, name), { recursive: true, force: true });
  rmSync(POLICY, { force: true });
  delete process.env.OPEN_ARTIFACT_RUNTIME_UPDATE;
}

async function serve(...versions: Parameters<typeof startRegistry>[0]): Promise<FakeRegistry> {
  registry = await startRegistry(versions);
  process.env.OPEN_ARTIFACT_REGISTRY = registry.url;
  return registry;
}

beforeEach(reset);
afterEach(async () => {
  await registry?.close();
  registry = null;
  process.env.OPEN_ARTIFACT_REGISTRY = 'http://127.0.0.1:9/';
});

const installed = (): string[] => (existsSync(SHARED) ? readdirSync(SHARED) : []);

test('update installs the newest compatible version, verified, and status shows it', async () => {
  const reg = await serve(
    { version: '99.1.0', tarball: runtimeTarball('99.1.0') },
    { version: '99.2.0', tarball: runtimeTarball('99.2.0'), attestations: true },
    { version: '99.3.0-beta.1', tarball: runtimeTarball('99.3.0-beta.1') },
    { version: '99.4.0', tarball: runtimeTarball('99.4.0'), deprecated: 'broken' },
    { version: '99.5.0', tarball: runtimeTarball('99.5.0'), protocols: { min: 7, max: 7 } },
  );
  const result = await updateRuntime({ own: ownRuntime(), running: null });
  assert.equal(result.installed, '99.2.0');
  assert.deepEqual(installed(), ['99.2.0']);
  const dir = join(SHARED, '99.2.0');
  assert.equal(readFileSync(join(dir, 'scripts', 'open-artifact.mjs'), 'utf8'), "console.log('runtime 99.2.0');\n");
  const record = JSON.parse(readFileSync(join(dir, '.install.json'), 'utf8'));
  assert.equal(record.integrity, sri(runtimeTarball('99.2.0')));
  assert.deepEqual(record.attestation, { present: true, verified: false, predicateType: 'https://slsa.dev/provenance/v1', url: `${reg.url}/attestations/99.2.0` });

  // Nothing about the person goes out: two GETs, no credentials or cookies.
  assert.deepEqual(reg.requests.map((r) => r.path), ['/@open-artifact%2fcli', '/tarballs/99.2.0.tgz']);
  for (const request of reg.requests) {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers['user-agent'], 'open-artifact-runtime');
  }

  const status = runtimeStatus({ running: '0.0.1', own: ownRuntime() });
  assert.equal(status.selected?.version, '99.2.0');
  assert.equal(status.selected?.source, 'shared');
  assert.equal(status.pending, '99.2.0');
  assert.equal(status.check?.attestation?.present, true);
  assert.match(runtimeStatusText(status), /Provenance attestation: listed by the registry .*not verified here/);

  // Up to date now.
  const again = await updateRuntime({ own: ownRuntime(), running: null });
  assert.equal(again.installed, null);
});

test('a tarball that does not match the registry integrity is refused and nothing is left', async () => {
  await serve({ version: '99.1.0', tarball: runtimeTarball('99.1.0'), integrity: sri(Buffer.from('something else')) });
  await assert.rejects(updateRuntime({ own: ownRuntime() }), (error: { code?: string }) => error.code === 'integrity_failed');
  assert.deepEqual(installed(), []);
  assert.throws(() => verifyIntegrity(Buffer.from('x'), 'sha1-abc'), /no sha512/);
});

test('malicious tarballs are refused: path traversal, absolute paths, links, entries outside the package', async () => {
  const outside = tempDir('open-artifact-outside-');
  const cases: Array<[string, Buffer, RegExp]> = [
    ['traversal', runtimeTarball('99.1.0', [{ name: `package/../../../../${outside.slice(1)}/evil.txt`, data: 'x' }]), /leaves its folder/],
    ['absolute', runtimeTarball('99.1.0', [{ name: `${outside}/evil.txt`, data: 'x' }]), /absolute path/],
    ['symlink', runtimeTarball('99.1.0', [{ name: 'package/vendor/link', type: '2', link: '/etc/passwd' }]), /symbolic link/],
    ['hard link', runtimeTarball('99.1.0', [{ name: 'package/vendor/hard', type: '1', link: 'package/package.json' }]), /hard link/],
    ['other top folder', runtimeTarball('99.1.0', [{ name: 'other/evil.txt', data: 'x' }]), /outside its folder/],
    ['backslash', runtimeTarball('99.1.0', [{ name: 'package\\..\\evil.txt', data: 'x' }]), /unsafe path/],
  ];
  for (const [what, data, message] of cases) {
    assert.throws(() => readTarball(data), message, what);
    await serve({ version: '99.1.0', tarball: data });
    await assert.rejects(updateRuntime({ own: ownRuntime() }), (error: { code?: string }) => error.code === 'bad_archive', what);
    await registry!.close();
    registry = null;
    assert.deepEqual(installed().filter((n) => !n.startsWith('.')), [], what);
    assert.deepEqual(installed().filter((n) => n.startsWith('.staging')), [], what);
    assert.deepEqual(readdirSync(outside), [], what);
  }
  // A corrupt header checksum and a truncated archive.
  const good = runtimeTarball('99.1.0');
  const { gunzipSync, gzipSync } = await import('node:zlib');
  const raw = gunzipSync(good);
  raw[10] = raw[10]! ^ 0xff;
  assert.throws(() => readTarball(gzipSync(raw)), /bad checksum/);
  assert.throws(() => readTarball(gzipSync(gunzipSync(good).subarray(0, 700))), /ends in the middle/);
  // A tarball of something else than the runtime.
  await serve({ version: '99.1.0', tarball: tarball([{ name: 'package/package.json', data: JSON.stringify({ name: 'evil', version: '99.1.0' }) }, { name: 'package/scripts/open-artifact.mjs', data: '' }]) });
  await assert.rejects(updateRuntime({ own: ownRuntime() }), /is not @open-artifact\/cli@99.1.0/);
});

test('an interrupted download installs nothing', async () => {
  await serve({ version: '99.1.0', tarball: runtimeTarball('99.1.0'), interrupt: true });
  await assert.rejects(updateRuntime({ own: ownRuntime() }), (error: { code?: string }) => error.code === 'download_failed' || error.code === 'integrity_failed');
  assert.deepEqual(installed().filter((n) => !n.startsWith('.')), []);
});

test('policy: machine off > settings > the most conservative adapter (bundled abstains) > prompt', () => {
  assert.deepEqual(effectivePolicy(), { update: 'prompt', source: 'default' });
  const a = makeRuntime(tempDir('open-artifact-rt-a-'), '1.0.0');
  const b = makeRuntime(tempDir('open-artifact-rt-b-'), '1.0.0');
  const c = makeRuntime(tempDir('open-artifact-rt-c-'), '1.0.0');
  const write = (runtimes: object[]): void => writeFileSync(join(TEST_HOME, 'runtimes.json'), JSON.stringify({ runtimes }));
  write([{ dir: a, version: '1.0.0', update: 'auto', harness: 'a' }]);
  assert.deepEqual(effectivePolicy(), { update: 'auto', source: 'adapter' });
  // A bundled adapter (DSH) abstains: it does not silence updates for the other hosts.
  write([{ dir: a, version: '1.0.0', update: 'auto', harness: 'a' }, { dir: b, version: '1.0.0', update: 'bundled', harness: 'b' }]);
  assert.deepEqual(effectivePolicy(), { update: 'auto', source: 'adapter' });
  assert.deepEqual([...bundledHarnesses()], ['b']);
  // Of the others, the more conservative wins.
  write([{ dir: a, version: '1.0.0', update: 'auto', harness: 'a' }, { dir: b, version: '1.0.0', update: 'bundled', harness: 'b' }, { dir: c, version: '1.0.0', update: 'prompt', harness: 'c' }]);
  assert.deepEqual(effectivePolicy(), { update: 'prompt', source: 'adapter' });
  // Every adapter bundled: bundled.
  write([{ dir: b, version: '1.0.0', update: 'bundled', harness: 'b' }]);
  assert.deepEqual(effectivePolicy(), { update: 'bundled', source: 'adapter' });
  write([{ dir: a, version: '1.0.0', update: 'auto', harness: 'a' }, { dir: b, version: '1.0.0', update: 'bundled', harness: 'b' }]);
  // An uninstalled host's policy no longer counts.
  rmSync(a, { recursive: true });
  assert.deepEqual(effectivePolicy(), { update: 'bundled', source: 'adapter' });
  rmSync(b, { recursive: true });
  assert.deepEqual(effectivePolicy(), { update: 'prompt', source: 'default' });
  assert.deepEqual([...bundledHarnesses()], []);
  saveRuntimeSettings({ update: 'prompt' });
  assert.deepEqual(effectivePolicy(), { update: 'prompt', source: 'settings' });
  writeFileSync(POLICY, JSON.stringify({ runtimeUpdate: 'off' }));
  assert.deepEqual(effectivePolicy(), { update: 'off', source: 'machine' });
  rmSync(POLICY);
  process.env.OPEN_ARTIFACT_RUNTIME_UPDATE = 'off';
  assert.deepEqual(effectivePolicy(), { update: 'off', source: 'machine' });
});

test('updates are refused when off for the computer, before any request', async () => {
  const reg = await serve({ version: '99.1.0', tarball: runtimeTarball('99.1.0') });
  writeFileSync(POLICY, JSON.stringify({ runtimeUpdate: 'off' }));
  await assert.rejects(updateRuntime({ own: ownRuntime() }), /switched off for this computer/);
  assert.equal(reg.requests.length, 0);
});

test('the registry: OPEN_ARTIFACT_REGISTRY, settings, npm config; https only off loopback', async () => {
  const saved = process.env.OPEN_ARTIFACT_REGISTRY;
  delete process.env.OPEN_ARTIFACT_REGISTRY;
  try {
    assert.equal(registryUrl({ NPM_CONFIG_USERCONFIG: '/nonexistent' }), 'https://registry.npmjs.org/');
    assert.equal(registryUrl({ npm_config_registry: 'https://mirror.example/npm', NPM_CONFIG_USERCONFIG: '/nonexistent' }), 'https://mirror.example/npm/');
    const rc = join(tempDir('open-artifact-npmrc-'), '.npmrc');
    writeFileSync(rc, 'registry=https://a.example/\n@open-artifact:registry=https://b.example/\n');
    assert.equal(registryUrl({ NPM_CONFIG_USERCONFIG: rc }), 'https://b.example/');
    saveRuntimeSettings({ registry: 'https://c.example' });
    assert.equal(registryUrl({ NPM_CONFIG_USERCONFIG: rc }), 'https://c.example/');
    process.env.OPEN_ARTIFACT_REGISTRY = 'http://registry.example/';
    await assert.rejects(updateRuntime({ own: ownRuntime() }), /only over https/);
  } finally {
    process.env.OPEN_ARTIFACT_REGISTRY = saved;
  }
});

test('the pin limits what is chosen; an exact version may be asked for', () => {
  const versions = Object.fromEntries(
    ['99.1.0', '99.1.4', '99.2.0'].map((v) => [v, { version: v, dist: { tarball: `http://127.0.0.1/${v}.tgz`, integrity: sri(Buffer.from(v)) } }]),
  );
  assert.equal(chooseVersion({ versions }, { required: [{ min: 1, max: 1 }] })?.version, '99.2.0');
  assert.equal(chooseVersion({ versions }, { pin: '~99.1', required: [{ min: 1, max: 1 }] })?.version, '99.1.4');
  assert.equal(chooseVersion({ versions }, { pin: '~99.1', required: [{ min: 1, max: 1 }], newerThan: '99.1.4' }), null);
  assert.equal(chooseVersion({ versions }, { required: [{ min: 1, max: 1 }], version: '99.1.0' })?.version, '99.1.0');
  assert.throws(() => chooseVersion({ versions }, { required: [{ min: 1, max: 1 }], version: '98.0.0' }), /cannot be installed/);
  // An adapter that speaks only protocol 2 rules out every protocol-1 version.
  assert.equal(chooseVersion({ versions }, { required: [{ min: 1, max: 1 }, { min: 2, max: 2 }] }), null);
});

function manager(events: RuntimeUpdateEvent[], options: { idle?: () => boolean; switched?: string[]; version?: string; skipped?: string[][] } = {}): RuntimeManager {
  return new RuntimeManager({
    version: options.version ?? '0.0.1',
    own: ownRuntime(),
    log: () => undefined,
    broadcast: (event, skip) => {
      events.push(event);
      options.skipped?.push([...skip]);
    },
    idle: options.idle ?? (() => true),
    connected: () => [],
    switchTo: (candidate) => options.switched?.push(candidate.version),
    checkDelayMs: 0,
  });
}

test('prompt: checks at most once a day, tells adapters, downloads nothing', async () => {
  const reg = await serve({ version: '99.1.0', tarball: runtimeTarball('99.1.0') });
  const events: RuntimeUpdateEvent[] = [];
  const m = manager(events, { idle: () => false });
  m.tick();
  await m.settled();
  assert.deepEqual(events, [{ type: 'runtime/update', current: '0.0.1', available: '99.1.0', installed: false }]);
  assert.deepEqual(installed(), []);
  assert.equal(reg.requests.length, 1);
  assert.equal(checkDue(), false);
  m.tick();
  await m.settled();
  assert.equal(reg.requests.length, 1, 'no second check the same day');
  // A day later it checks again.
  m.tick(Date.now() + 24 * 60 * 60_000 + 1000);
  await m.settled();
  assert.equal(reg.requests.length, 2);
  m.close();
});

test('bundled never checks; auto downloads in the background and switches once idle', async () => {
  const reg = await serve({ version: '99.1.0', tarball: runtimeTarball('99.1.0') });
  saveRuntimeSettings({ update: 'bundled' });
  const events: RuntimeUpdateEvent[] = [];
  const bundled = manager(events);
  bundled.tick();
  await bundled.settled();
  assert.equal(reg.requests.length, 0);
  bundled.close();

  saveRuntimeSettings({ update: 'auto' });
  let idle = false;
  const switched: string[] = [];
  const auto = manager(events, { idle: () => idle, switched });
  auto.tick();
  await auto.settled();
  assert.deepEqual(installed(), ['99.1.0']);
  assert.deepEqual(events, [{ type: 'runtime/update', current: '0.0.1', available: '99.1.0', installed: true }]);
  // Busy (a page open, a tool call running): no switch.
  auto.tick();
  assert.deepEqual(switched, []);
  idle = true;
  auto.tick();
  assert.deepEqual(switched, ['99.1.0']);
  auto.close();
});

test('runtime update and pin are the person\'s; status is not', async () => {
  await serve({ version: '99.1.0', tarball: runtimeTarball('99.1.0') });
  // Not spawnSync: the fake registry answers from this process.
  const run = (args: string[], vars: Record<string, string> = {}): Promise<{ status: number | null; stdout: string; stderr: string }> =>
    new Promise((done) => {
      const child = spawn(process.execPath, [BIN, 'runtime', ...args], { env: { ...process.env, ...vars } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (status) => done({ status, stdout, stderr }));
    });
  const refused = await run(['update'], { CLAUDECODE: '1' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Updating the Open Artifact runtime is the person's decision/);
  assert.deepEqual(installed(), []);
  assert.match((await run(['pin', '^99'], { CODEX_THREAD_ID: 't' })).stderr, /Pinning the Open Artifact runtime/);

  const pinned = await run(['pin', '~99.1']);
  assert.equal(pinned.status, 0, pinned.stderr);
  assert.equal(JSON.parse(readFileSync(join(TEST_HOME, 'settings.json'), 'utf8')).runtime.pin, '~99.1');
  assert.notEqual((await run(['pin', 'not a range'])).status, 0);

  const updated = await run(['update', '--json']);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(JSON.parse(updated.stdout).installed, '99.1.0');

  const status = await run(['status', '--json'], { CLAUDECODE: '1' });
  assert.equal(status.status, 0, status.stderr);
  const shown = JSON.parse(status.stdout);
  assert.equal(shown.selected.version, '99.1.0');
  assert.equal(shown.pin, '~99.1');
  assert.equal((await run(['pin', '--clear'])).status, 0);
  assert.equal(readRuntimesFile(TEST_HOME).runtimes.length, 0);
});

test('the update event skips bundled adapters; a host may not update under the person\'s bundled or the machine switch', async () => {
  const reg = await serve({ version: '99.1.0', tarball: runtimeTarball('99.1.0') });
  const a = makeRuntime(tempDir('open-artifact-rt-a-'), '1.0.0');
  const b = makeRuntime(tempDir('open-artifact-rt-b-'), '1.0.0');
  writeFileSync(join(TEST_HOME, 'runtimes.json'), JSON.stringify({ runtimes: [{ dir: a, version: '1.0.0', update: 'prompt', harness: 'claude-code' }, { dir: b, version: '1.0.0', update: 'bundled', harness: 'dsh' }] }));
  const events: RuntimeUpdateEvent[] = [];
  const skipped: string[][] = [];
  const m = manager(events, { idle: () => false, skipped });
  m.tick();
  await m.settled();
  assert.equal(events.length, 1);
  assert.deepEqual(skipped, [['dsh']]);

  // runtime.update over the Harness API: refused under the person's bundled, before any request.
  saveRuntimeSettings({ update: 'bundled' });
  const before = reg.requests.length;
  await assert.rejects(m.call('runtime.update', {}), (error: { code?: string; fix?: string }) => error.code === 'not_granted' && /runtime policy/.test(error.fix ?? ''));
  saveRuntimeSettings({ update: null });
  writeFileSync(POLICY, JSON.stringify({ runtimeUpdate: 'off' }));
  await assert.rejects(m.call('runtime.update', {}), (error: { code?: string; fix?: string }) => error.code === 'not_granted' && !!error.fix);
  assert.equal(reg.requests.length, before);
  // An adapter's bundled is not the person's: a host may still update.
  rmSync(POLICY);
  const result = (await m.call('runtime.update', {})) as { installed: string | null };
  assert.equal(result.installed, '99.1.0');
  m.close();
});

test('runtime policy is the person\'s; their update works under bundled; errors print the fix line', async () => {
  await serve({ version: '99.1.0', tarball: runtimeTarball('99.1.0') });
  const run = (args: string[], vars: Record<string, string> = {}): Promise<{ status: number | null; stdout: string; stderr: string }> =>
    new Promise((done) => {
      const child = spawn(process.execPath, [BIN, 'runtime', ...args], { env: { ...process.env, ...vars } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (status) => done({ status, stdout, stderr }));
    });
  const settings = (): Record<string, unknown> | undefined => (existsSync(join(TEST_HOME, 'settings.json')) ? JSON.parse(readFileSync(join(TEST_HOME, 'settings.json'), 'utf8')).runtime : undefined);
  const shown = await run(['policy']);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /prompt \(default/);
  assert.match((await run(['policy', 'auto'], { CLAUDECODE: '1' })).stderr, /Changing the Open Artifact runtime update policy is the person's decision/);
  assert.equal(settings(), undefined);
  assert.notEqual((await run(['policy', 'sometimes'])).status, 0);

  const set = await run(['policy', 'bundled']);
  assert.equal(set.status, 0, set.stderr);
  assert.equal(settings()?.update, 'bundled');
  assert.match((await run(['policy', '--json'])).stdout, /"source": ?"settings"/);
  // The person's own update still works under bundled (they typed it).
  const updated = await run(['update', '--json']);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(JSON.parse(updated.stdout).installed, '99.1.0');

  const cleared = await run(['policy', 'default']);
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(settings()?.update, undefined);

  // The machine switch still refuses it, and the error carries its fix line.
  writeFileSync(POLICY, JSON.stringify({ runtimeUpdate: 'off' }));
  const off = await run(['update']);
  assert.notEqual(off.status, 0);
  assert.match(off.stderr, /switched off for this computer/);
  assert.match(off.stderr, /Ask whoever manages this computer/);
  assert.match((await run(['policy'])).stdout, /off for this computer \(machine/);
});
