/**
 * `open-artifact harness add | remove` are the person's: refused inside an agent session (a profile is standing
 * configuration, and the person's own may carry a command the daemon runs). `harness list` stays open.
 */

import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));

function run(args: string[], vars: Record<string, string> = {}): { code: number | null; out: string; err: string } {
  const result = spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, OPEN_ARTIFACT_HOME: TEST_HOME, ...vars }, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('harness add and remove are refused inside an agent session; list is not', () => {
  const file = join(tempDir('open-artifact-profile-'), 'myagent.json');
  writeFileSync(file, JSON.stringify({ name: 'myagent', title: 'My agent', nudge: { command: '/bin/echo', args: ['${session}'] } }));
  const saved = join(TEST_HOME, 'harnesses', 'myagent.json');

  const agents: Array<Record<string, string>> = [{ CLAUDECODE: '1' }, { CODEX_THREAD_ID: 't-1' }, { ANTIGRAVITY_AGENT: '1' }];
  for (const agent of agents) {
    const refused = run(['harness', 'add', file], agent);
    assert.notEqual(refused.code, 0);
    assert.match(refused.err, /Adding a harness profile is the person's decision/);
    assert.match(refused.err, /open-artifact harness add /);
    assert.equal(existsSync(saved), false);
  }

  const added = run(['harness', 'add', file]);
  assert.equal(added.code, 0, added.err);
  assert.equal(existsSync(saved), true);

  const listed = run(['harness', 'list', '--json'], { CLAUDECODE: '1' });
  assert.equal(listed.code, 0, listed.err);
  assert.ok((JSON.parse(listed.out) as Array<{ name: string }>).some((p) => p.name === 'myagent'));

  // The person's own profile adds a marker; inside that harness's agent the guard holds too.
  writeFileSync(file, JSON.stringify({ name: 'myagent', title: 'My agent', markers: ['MYAGENT_RUNNING'] }));
  assert.equal(run(['harness', 'add', file]).code, 0);
  const inMine = run(['harness', 'remove', 'myagent'], { MYAGENT_RUNNING: '1' });
  assert.notEqual(inMine.code, 0);
  assert.match(inMine.err, /Removing a harness profile is the person's decision, and this command runs inside an agent session \(myagent: MYAGENT_RUNNING is set\)/);
  assert.equal(existsSync(saved), true);

  const removed = run(['harness', 'remove', 'myagent']);
  assert.equal(removed.code, 0, removed.err);
  assert.equal(existsSync(saved), false);
});
