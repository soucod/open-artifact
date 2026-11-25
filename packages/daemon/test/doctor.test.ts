/**
 * `open-artifact doctor` (`doctor.ts`, `doctor-checks.ts`, design 12): a healthy setup passes, a broken one fails with
 * one line of what to do and a non-zero exit, and checks are a list another module extends.
 */

import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { HarnessClient } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { doctorText, runDoctor, type DoctorCheck } from '../src/doctor.ts';
import { DOCTOR_CHECKS } from '../src/doctor-checks.ts';
import { files } from '../src/paths.ts';
import { makeRuntime } from './runtime-fixtures.ts';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));
let daemon: Daemon;
let client: HarnessClient;

before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  client = new HarnessClient({ harness: 'docapp', autoStart: false, daemon: { home: TEST_HOME } });
  await client.connect();
  await client.attach({ session: 'doc-1', workspace: TEST_HOME });
});

after(() => {
  client.close();
  daemon.close();
});

/** The CLI, without blocking this process (the daemon answers from here). */
function cli(args: string[]): Promise<{ status: number | null; stdout: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, OPEN_ARTIFACT_HOME: TEST_HOME } });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('close', (status) => done({ status, stdout }));
  });
}

test('a healthy setup: no failures, and the harness asked about is connected', async () => {
  const report = await runDoctor({ checks: DOCTOR_CHECKS, harness: 'docapp' });
  assert.equal(report.ok, true, doctorText(report));
  const byId = (id: string) => report.findings.filter((f) => f.id === id);
  assert.match(byId('daemon')[0]!.message, /^Daemon .* running at http:\/\/127\.0\.0\.1:/);
  assert.equal(byId('harness-adapter')[0]?.status, 'ok');
  assert.match(byId('harness-adapter')[0]!.message, /1 adapter of docapp connected, 1 session attached/);
  assert.equal(byId('tools')[0]?.status, 'ok');
  assert.equal(byId('runtime')[0]?.status, 'ok');
  for (const finding of report.findings) assert.ok(!finding.message.includes('\n'), 'one line each');

  const shown = await cli(['doctor', '--harness', 'docapp']);
  assert.equal(shown.status, 0, shown.stdout);
  assert.match(shown.stdout, /0 failed/);
});

test('a broken setup fails with what to do, and the command exits non-zero', async () => {
  writeFileSync(files.settings(), '{ not json');
  chmodSync(files.daemon(), 0o644);
  const gone = makeRuntime(tempDir('open-artifact-gone-'), '3.0.0');
  writeFileSync(join(TEST_HOME, 'runtimes.json'), JSON.stringify({ runtimes: [{ dir: gone, version: '3.0.0', harness: 'oldapp' }] }));
  rmSync(gone, { recursive: true });
  try {
    const report = await runDoctor({ checks: DOCTOR_CHECKS, harness: 'nosuchapp' });
    assert.equal(report.ok, false);
    const failed = report.findings.filter((f) => f.status === 'fail');
    assert.ok(failed.some((f) => f.id === 'settings' && /not valid JSON/.test(f.message) && /Fix or remove/.test(f.fix ?? '')));
    if (process.platform !== 'win32') assert.ok(failed.some((f) => f.id === 'daemon' && f.fix === `chmod 600 ${files.daemon()}`));
    const warned = report.findings.filter((f) => f.status === 'warn');
    assert.ok(warned.some((f) => f.id === 'runtime' && /oldapp registered runtime 3.0.0/.test(f.message)));
    assert.ok(warned.some((f) => f.id === 'harness-profile'));
    assert.ok(warned.some((f) => f.id === 'harness-adapter' && /No adapter of nosuchapp/.test(f.message)));
    for (const f of [...failed, ...warned]) assert.ok(f.fix && !f.fix.includes('\n'), `${f.id} says what to do in one line`);

    const json = await cli(['doctor', '--json']);
    assert.equal(json.status, 1);
    assert.equal(JSON.parse(json.stdout).ok, false);
  } finally {
    rmSync(files.settings(), { force: true });
    rmSync(join(TEST_HOME, 'runtimes.json'), { force: true });
    chmodSync(files.daemon(), 0o600);
  }
});

test('checks are a list: another module adds its own, and a check that throws is a failure of its own', async () => {
  const extra: DoctorCheck[] = [
    { id: 'remote-x', title: 'Remote x', run: () => ({ status: 'warn', message: 'Remote x is slow', fix: 'Check your network.' }) },
    { id: 'conformance', title: 'Conformance', applies: ({ harness }) => harness === 'never', run: () => ({ status: 'fail', message: 'not run' }) },
    { id: 'broken', title: 'Broken', run: () => { throw new Error('boom'); } },
  ];
  const report = await runDoctor({ checks: [...DOCTOR_CHECKS, ...extra] });
  assert.deepEqual(report.findings.find((f) => f.id === 'remote-x'), { id: 'remote-x', status: 'warn', message: 'Remote x is slow', fix: 'Check your network.' });
  assert.equal(report.findings.some((f) => f.id === 'conformance'), false);
  assert.match(report.findings.find((f) => f.id === 'broken')!.message, /the check itself failed: boom/);
  assert.equal(report.ok, false);
});

test('every command a fix line names is one the CLI has (its USAGE lists it)', () => {
  const source = (name: string): string => readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8');
  const usage = /const USAGE = `([\s\S]*?)`;/.exec(source('bin/open-artifact.ts'))![1]!;
  const withSubcommands = new Set(['daemon', 'harness', 'runtime', 'remote', 'skill']);
  const named = new Set<string>();
  for (const file of ['doctor.ts', 'doctor-checks.ts', 'doctor-conformance.ts', 'doctor-remote.ts']) {
    for (const [line] of source(file).matchAll(/fix:[^\n]*/g)) {
      for (const [, command, sub] of line.matchAll(/open-artifact ([a-z]+)(?: ([a-z]+))?/g)) named.add(withSubcommands.has(command!) && sub ? `${command} ${sub}` : command!);
    }
  }
  assert.ok(named.has('daemon stop') && named.has('runtime update'), [...named].join(', '));
  for (const command of named) {
    const [word, sub] = command.split(' ');
    const lines = usage.split('\n').filter((l) => l.startsWith(`open-artifact ${word} `) || l === `open-artifact ${word}`);
    assert.ok(lines.length, `open-artifact ${word} is not in USAGE`);
    if (sub) assert.ok(lines.some((l) => new RegExp(`\\b${sub}\\b`).test(l)), `open-artifact ${command} is not in USAGE`);
  }
  assert.ok(!source('doctor-conformance.ts').includes('daemon logs'));
});

test('open-artifact --version and -v print the runtime version, as the single-file executable does', async () => {
  const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };
  for (const flag of ['--version', '-v']) {
    const shown = await cli([flag]);
    assert.equal(shown.status, 0);
    assert.equal(shown.stdout, `${version}\n`);
  }
});
