import { TEST_HOME, tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { VERSION, startDaemon } from '../src/daemon.ts';
import { files } from '../src/paths.ts';

const CLI = resolve(import.meta.dirname, '..', 'src', 'bin', 'open-artifact.ts');
const lines = (file: string): string[] => readFileSync(file, 'utf8').trimEnd().split('\n');
const stopped = (reason: string): RegExp => new RegExp(`^\\[[^\\]]+\\] daemon ${VERSION.replaceAll('.', '\\.')} stopped \\(${reason}\\)$`);

test('close says in the log that the daemon stopped, with why, once', async () => {
  const daemon = await startDaemon({ port: 0, quiet: true });
  assert.ok(existsSync(files.daemon()));
  daemon.close('SIGTERM');
  assert.equal(existsSync(files.daemon()), false);
  const log = lines(files.daemonLog());
  assert.match(log.at(-1)!, stopped('SIGTERM'));
  daemon.close('again');
  assert.deepEqual(lines(files.daemonLog()), log, 'a second close says nothing');
});

test('a close with no reason says closed', async () => {
  const daemon = await startDaemon({ port: 0, quiet: true });
  daemon.close();
  assert.match(lines(files.daemonLog()).at(-1)!, stopped('closed'));
});

test('open-artifact daemon run says which signal stopped it', { skip: process.platform === 'win32' ? 'no signals to handle on Windows' : false }, async () => {
  const home = tempDir('open-artifact-stop-home-');
  assert.notEqual(home, TEST_HOME);
  const child = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', '0'], { env: { ...process.env, OPEN_ARTIFACT_HOME: home }, stdio: 'ignore' });
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
  try {
    await until(() => existsSync(join(home, 'daemon.json')), 20000);
    child.kill('SIGTERM');
    assert.equal(await exited, 0);
    assert.equal(existsSync(join(home, 'daemon.json')), false);
    assert.match(lines(join(home, 'logs', 'daemon.log')).at(-1)!, stopped('SIGTERM'));
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

// The handlers are installed before the daemon starts: a signal that lands while it starts (its lock is taken, its
// `daemon.json` not written yet or only just) must not end the process with the files left behind.
test('a signal that comes while the daemon starts still stops it cleanly', { skip: process.platform === 'win32' ? 'no signals to handle on Windows' : false }, async () => {
  for (let round = 0; round < 5; round++) {
    const home = tempDir('open-artifact-stop-early-');
    assert.notEqual(home, TEST_HOME);
    const child = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', '0'], { env: { ...process.env, OPEN_ARTIFACT_HOME: home }, stdio: 'ignore' });
    const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
    try {
      const start = Date.now();
      while (!existsSync(join(home, 'daemon.lock')) && child.exitCode === null && Date.now() - start < 20000) await new Promise((r) => setTimeout(r, 1));
      assert.ok(existsSync(join(home, 'daemon.lock')), 'the daemon never took its lock');
      child.kill('SIGTERM');
      assert.equal(await exited, 0, `round ${round}: the signal ended the process before the daemon could close`);
      assert.equal(existsSync(join(home, 'daemon.json')), false);
      assert.equal(existsSync(join(home, 'daemon.lock')), false);
      assert.match(lines(join(home, 'logs', 'daemon.log')).at(-1)!, stopped('SIGTERM'));
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
});
