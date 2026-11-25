/**
 * The host's catalog tests (`packages/host/test/catalog.test.ts`), unchanged, on D1: once on the in-process fake that
 * keeps D1's rules, once on real local D1 (workerd through wrangler's platform proxy, from `deploy/cloudflare/node_modules`;
 * skipped when it is not installed). Two tests are SQLite's own and skipped: the journal mode (WAL) and the scan of the database files for
 * secrets in clear.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const hooks = fileURLToPath(new URL('./catalog-d1-hooks.ts', import.meta.url));
const catalogTests = join(repo, 'packages/host/test/catalog.test.ts');
const SQLITE_ONLY = ['migrations are idempotent and recorded', 'no secret is stored in clear'];

function run(d1: 'fake' | 'miniflare'): { passed: number; failed: number; total: number; output: string } {
  const args = ['--import', hooks, '--test', '--test-reporter=tap', ...SQLITE_ONLY.map((name) => `--test-skip-pattern=^${name}$`), catalogTests];
  const child = spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', env: { ...withoutTestContext(process.env), OA_TEST_D1: d1 }, timeout: 120_000 });
  const output = `${child.stdout}\n${child.stderr}`;
  const passed = Number(/^# pass (\d+)/m.exec(output)?.[1] ?? 0);
  const total = Number(/^# tests (\d+)/m.exec(output)?.[1] ?? 0);
  const failed = Number(/^# fail (\d+)/m.exec(output)?.[1] ?? -1);
  return { passed, failed, total, output };
}

test('the catalog scenarios pass on the D1 fake', () => {
  check(run('fake'));
});

test('the catalog scenarios pass on real local D1', { skip: !existsSync(join(repo, 'deploy/cloudflare/node_modules/wrangler')) && 'deploy/cloudflare has no node_modules' }, () => {
  check(run('miniflare'));
});

/** Every scenario but the SQLite-only ones ran and passed. */
function check({ passed, failed, total, output }: { passed: number; failed: number; total: number; output: string }): void {
  assert.equal(failed, 0, output.slice(-4000));
  assert.ok(total >= 15, `only ${total} scenarios ran:\n${output.slice(-2000)}`);
  assert.equal(passed, total, output.slice(-2000));
}

/** The environment without the runner's marker, so the child runs its tests rather than reporting to this run. */
function withoutTestContext(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NODE_TEST_CONTEXT: _, ...rest } = env;
  return rest;
}
