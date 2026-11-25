/**
 * A session's folder, when nothing said it, comes from its profile's `sessionWorkspace` (a named strategy), not from
 * its harness's name: Codex ships `codex-rollout`; an adapter can never set one; the person's own profile can.
 */

import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { addUserProfile, harnessProfile, saveAdapterProfile, sessionWorkspaceOf } from '../src/harness-profiles.ts';

test('sessionWorkspace: shipped for Codex, the person may name it, an adapter never sets it', () => {
  const codexHome = tempDir('open-artifact-codex-');
  const day = join(codexHome, 'sessions', '2026', '11', '22');
  mkdirSync(day, { recursive: true });
  writeFileSync(join(day, 'rollout-2026-11-22T10-00-00-thread-ws1.jsonl'), `${JSON.stringify({ type: 'session_meta', payload: { cwd: '/work/codex-project' } })}\n`);
  const saved = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const dir = join(TEST_HOME, 'harnesses');
  try {
    assert.equal(harnessProfile('codex').sessionWorkspace, 'codex-rollout');
    assert.equal(sessionWorkspaceOf('codex')?.('thread-ws1'), '/work/codex-project');
    assert.equal(sessionWorkspaceOf('claude-code'), null, 'no strategy: none');

    // An adapter reports one for a harness that has none: dropped, and ignored if written in by hand.
    assert.ok(saveAdapterProfile('sneaky', { title: 'Sneaky', sessionWorkspace: 'codex-rollout' }).dropped.includes('sessionWorkspace'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sneaky.json'), JSON.stringify({ name: 'sneaky', source: 'adapter', sessionWorkspace: 'codex-rollout' }));
    assert.equal(sessionWorkspaceOf('sneaky'), null);
    assert.equal(harnessProfile('sneaky').sessionWorkspace, undefined);
    // An adapter's profile of Codex cannot take the shipped one away either.
    writeFileSync(join(dir, 'codex.json'), JSON.stringify({ name: 'codex', source: 'adapter', title: 'Codex (adapter)' }));
    assert.equal(sessionWorkspaceOf('codex')?.('thread-ws1'), '/work/codex-project');

    // The person's own profile: a known name is kept; an unknown one is refused.
    addUserProfile({ name: 'mine', sessionWorkspace: 'codex-rollout' });
    assert.equal(sessionWorkspaceOf('mine')?.('thread-ws1'), '/work/codex-project');
    assert.throws(() => addUserProfile({ name: 'mine2', sessionWorkspace: 'read-everything' }), /sessionWorkspace/);
    assert.throws(() => addUserProfile({ name: 'mine3', sessionWorkspace: 'constructor' }), /sessionWorkspace/);
  } finally {
    if (saved === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
