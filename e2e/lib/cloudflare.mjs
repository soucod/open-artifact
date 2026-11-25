// Helpers for the Cloudflare end-to-end tests: `wrangler dev` of `deploy/cloudflare` on a free port with a state folder
// of its own, its local D1 read and written with `wrangler d1 execute --local`, and an artifact folder zipped as the
// host's export does.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { until } from './http.mjs';
import { repoRoot } from './target.mjs';

export const DEPLOY = path.join(repoRoot, 'deploy', 'cloudflare');
export const WRANGLER = path.join(DEPLOY, 'node_modules', '.bin', 'wrangler');
/** The product Worker's D1 database name (`wrangler.jsonc`). */
export const D1_NAME = 'open-artifact';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Why the Cloudflare tests cannot run here, or false. */
export function wranglerMissing() {
  return fs.existsSync(WRANGLER) ? false : 'deploy/cloudflare has no node_modules (cd deploy/cloudflare && npm install)';
}

/** A TCP port nobody listens on now. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Builds `deploy/cloudflare` (both Workers); throws with the output when it fails. Under `e2e/run.mjs` the Workers are
 * built once before the suites start (`E2E_CLOUDFLARE_BUILT=1`) and this does nothing: suites run two at a time, and a
 * suite rebuilding `deploy/cloudflare/dist` while another suite's `wrangler dev` serves it made that wrangler reload its
 * Workers mid-test (a room's SQLite counters started again from zero, a page lost its data), or the two builds collided
 * on the same folder (`EEXIST`).
 */
export function buildWorkers() {
  if (process.env.E2E_CLOUDFLARE_BUILT === '1') return 'built once by e2e/run.mjs';
  const built = spawnSync(process.execPath, ['build.mjs'], { cwd: DEPLOY, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);
  return built.stdout;
}

/**
 * Starts `wrangler dev` in `deploy/cloudflare`; resolves once `ready(origin)` answers true. `vars` are passed with
 * `--var` (they win over `.dev.vars`), `config` picks the wrangler file. Answers `{ log(), stop() }`.
 *
 * Two suites run at once, and two `wrangler dev` starting together can pick the same free port for one of their inner
 * sockets (workerd's `direct:…` sockets; wrangler finds them free, then binds them later): the loser stops at once with
 * "Address already in use". That start, and only that, is tried again, at most twice.
 */
export async function startWrangler(options) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await startWranglerOnce(options);
    } catch (error) {
      if (attempt >= 3 || !/Address already in use/.test(String(error?.message))) throw error;
      console.log(`# wrangler dev lost a port to another start (attempt ${attempt}); starting it again`);
      await sleep(500 + Math.floor(Math.random() * 1500));
    }
  }
}

async function startWranglerOnce({ port, state, vars = {}, config, ready, timeout = 90000 }) {
  let log = '';
  const args = ['dev', ...(config ? ['--config', config] : []), '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state, '--log-level', 'log', '--show-interactive-dev-session=false'];
  for (const [name, value] of Object.entries(vars)) args.push('--var', `${name}:${value}`);
  const child = spawn(WRANGLER, args, { cwd: DEPLOY, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  child.stdout.on('data', d => (log += d));
  child.stderr.on('data', d => (log += d));
  const kill = () => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  };
  process.on('exit', kill);
  const origin = `http://localhost:${port}`;
  const up = await until(async () => {
    if (child.exitCode !== null) return true;
    try {
      return await ready(origin);
    } catch {
      return false;
    }
  }, timeout, 250);
  if (!up || child.exitCode !== null) {
    kill();
    process.off('exit', kill);
    throw new Error(`wrangler dev did not start:\n${log.slice(-3000)}`);
  }
  return {
    log: () => log,
    async stop() {
      const exited = new Promise(r => (child.exitCode !== null ? r() : child.once('exit', r)));
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
      await Promise.race([exited, sleep(5000)]);
      kill();
      process.off('exit', kill);
    },
  };
}

/**
 * Runs SQL on the product Worker's local D1 (`wrangler d1 execute --local`, the state folder of a `wrangler dev`):
 * the rows of the last statement.
 */
export function d1(state, sql) {
  const run = spawnSync(WRANGLER, ['d1', 'execute', D1_NAME, '--local', '--persist-to', state, '--json', '--command', sql], {
    cwd: DEPLOY,
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    timeout: 60000,
  });
  if (run.status !== 0) throw new Error(`wrangler d1 execute failed (${run.status}):\n${run.stdout}\n${run.stderr}`);
  const results = JSON.parse(run.stdout);
  return results.at(-1)?.results ?? [];
}

/** SQL text for a value (strings quoted, null as NULL). */
export const sqlValue = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

/** The catalog's hash of a secret (sessions, links): SHA-256, hex. */
export const tokenHash = token => createHash('sha256').update(token).digest('hex');

/** An artifact folder as the host's export zips it (the type server's own archive code). */
export async function zipFolder(dir) {
  const { archiveEntries, writeZip } = await import(pathToFileURL(path.join(repoRoot, 'packages/type-server/src/archive.ts')).href);
  const chunks = [];
  await writeZip(await archiveEntries(dir), async chunk => {
    chunks.push(Buffer.from(chunk));
  });
  return Buffer.concat(chunks);
}

/** The D1 counts the Worker reports on an answer with `OA_DEBUG_STATS=1`: `{ queries, read, written }`, or null. */
export function d1Cost(response) {
  const header = response.headers.get('x-open-artifact-d1');
  if (!header) return null;
  return Object.fromEntries(header.split(';').map(part => part.split('=')).map(([k, v]) => [k, Number(v)]));
}
