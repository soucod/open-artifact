/**
 * The Python host (`main.py`) against a real daemon in a temporary `OPEN_ARTIFACT_HOME`, through
 * `open-artifact harness --stdio`: it says hello, attaches its session, lists the tools, makes an artifact with
 * quickstart and publish (answering the `host.open` that comes while publish waits), keeps its session when the
 * daemon goes away and comes back (`bridge.state`, `bridge.reattached`), and answers the page's request
 * (`wake.deliver`) as a turn from the owner.
 *
 * Skipped, saying so, when python3 (3.9 or later) is not on the PATH.
 *
 * Run: node --test examples/harness-stdio/harness-stdio.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { api, readDaemon } from '@open-artifact/harness-kit';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

/** Why the test cannot run here, or null. */
function noPython() {
  const found = spawnSync('python3', ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
  if (found.error || found.status !== 0) return 'python3 is not on the PATH';
  const [major, minor] = found.stdout.trim().split('.').map(Number);
  return major > 3 || (major === 3 && minor >= 9) ? null : `python3 is ${found.stdout.trim()}; the example needs 3.9 or later`;
}
const skip = noPython();
if (skip) console.log(`# harness-stdio: skipped: ${skip}`);

describe('the Python host against a real daemon', { skip: skip ?? false }, () => {
  let dir;
  let env;
  let bin;
  let child;
  const lines = [];

  /** Bundles the daemon from source, as examples/harness-node does, and sets up a home with one type. */
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'oa-harness-stdio-'));
    bin = join(dir, 'open-artifact.mjs');
    buildSync({
      entryPoints: [join(repo, 'packages/daemon/src/bin/open-artifact.ts')],
      outfile: bin,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      charset: 'utf8',
      legalComments: 'none',
      logLevel: 'silent',
      banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" },
    });
    const type = join(dir, 'types', 'note');
    mkdirSync(type, { recursive: true });
    writeFileSync(join(type, 'artifact-type.json'), JSON.stringify({ name: 'Note', description: 'A one-page note as a local HTML file.', when: 'The person wants a short note.' }));
    writeFileSync(join(type, 'index.html'), '<!doctype html><title>note</title><iframe src="note.html"></iframe>\n');
    mkdirSync(join(dir, 'builtin'));
    mkdirSync(join(dir, 'work'));
    env = {
      ...process.env,
      OPEN_ARTIFACT_HOME: join(dir, 'home'),
      OPEN_ARTIFACT_USER_TYPES: join(dir, 'types'),
      OPEN_ARTIFACT_BUILTIN_TYPES: join(dir, 'builtin'),
      OPEN_ARTIFACT_DAEMON_BIN: bin,
      OPEN_ARTIFACT_PORT: '0',
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
      OPEN_ARTIFACT_WAKE_MERGE_MS: '20',
      PYTHONDONTWRITEBYTECODE: '1',
    };
  });

  after(() => {
    child?.kill('SIGKILL');
    try {
      const { pid } = JSON.parse(readFileSync(join(dir, 'home', 'daemon.json'), 'utf8'));
      if (pid) process.kill(pid, 'SIGTERM');
    } catch {
      // no daemon came up
    }
    rmSync(dir, { recursive: true, force: true });
  });

  /** Resolves with the first stdout line (after `from`) that starts with `word`. */
  function lineOf(word, ms = 30_000, from = 0) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`no "${word}" line in ${ms} ms; got:\n${lines.join('\n')}`)), ms);
      const check = () => {
        const line = lines.slice(from).find((l) => l === word || l.startsWith(`${word} `));
        if (line) {
          clearTimeout(timer);
          clearInterval(poll);
          done(line);
        }
      };
      const poll = setInterval(check, 20);
      check();
    });
  }

  it('makes an artifact, keeps its session across a daemon restart, and takes the owner\'s request', { timeout: 120_000 }, async () => {
    child = spawn('python3', [join(here, 'main.py'), '--cli', `"${process.execPath}" "${bin}"`, '--workspace', join(dir, 'work'), '--type', 'note', '--once'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop();
      lines.push(...parts);
    });
    const exited = new Promise((done) => child.on('exit', (code) => done(code)));
    const died = exited.then((code) => Promise.reject(new Error(`main.py exited ${code}\n${lines.join('\n')}\n${stderr}`)));
    died.catch(() => undefined);

    const ready = await Promise.race([lineOf('ready'), died]);
    const url = ready.slice('ready '.length);
    assert.match(url, /^open-artifact:\/\/artifact\//);
    assert.match(await lineOf('state'), /^state connected/);
    assert.match(await lineOf('connected'), /^connected protocol=1 daemon=/);
    assert.match(await lineOf('attached'), /^attached py-1 inbox=0/);
    assert.match(await lineOf('tools'), /Artifact,.*ArtifactData/);
    // publish {open: "now"} asked the host to show it while publish waited.
    assert.match(await lineOf('open'), new RegExp(`^open ${url} view=http://127\\.0\\.0\\.1:\\d+/`));

    // The daemon goes away: the bridge says so, starts it again, attaches the session again and says that too.
    const mark = lines.length;
    const old = await readDaemon(env.OPEN_ARTIFACT_HOME);
    process.kill(old.pid, 'SIGTERM');
    await Promise.race([lineOf('state disconnected', 15_000, mark), died]);
    assert.match(await Promise.race([lineOf('reattached', 45_000, mark), died]), /^reattached py-1 inbox=0/);
    const state = await readDaemon(env.OPEN_ARTIFACT_HOME);
    assert.notEqual(state.pid, old.pid, 'a new daemon');

    // The page's "Ask": the daemon wakes the owner session, live through the bridge.
    const answer = await api(state, 'artifacts.ask', { id: url.split('/').pop(), text: 'Make the title bigger' });
    assert.equal(answer.via, 'live', JSON.stringify(answer));
    assert.match(await lineOf('wake'), /^wake turn request from owner on "Hello from Python"/);
    assert.equal(await exited, 0, stderr);
  });
});
