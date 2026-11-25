/**
 * Artifacts written by a newer type release than the one installed (`release-guard.ts`, design 16): the agent's writes
 * are refused with `newer_release`, its reads say `read_only`, and a write by a newer type records the newer release.
 */

import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { ArtifactRecord, ToolCallResult } from '@open-artifact/protocol';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { ReleaseGuard, isNewerRelease, writtenRelease } from '../src/release-guard.ts';

function record(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  const root = tempDir('open-artifact-release-');
  return {
    id: 'art_release1',
    root,
    type: 'slides',
    typeSource: 'builtin',
    typeRelease: '2.0.0',
    owner: null,
    createdBy: null,
    title: 'Deck',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    pinnedAt: null,
    agentSeenAt: null,
    lastUserEditAt: null,
    ...overrides,
  };
}

test('the guard: writes refused, reads marked read-only, a newer writer recorded', async () => {
  let current = record();
  const released: string[] = [];
  let installed = '1.5.0';
  const guard = new ReleaseGuard({ record: () => current, typeVersion: () => installed, setRelease: (_r, release) => void released.push(release) });
  const calls: string[] = [];
  const next = async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    calls.push(`${name} ${String(args.action)}`);
    return { ok: true, notes: ['a note'] };
  };
  for (const [name, action] of [['Artifact', 'publish'], ['Artifact', 'call'], ['ArtifactData', 'set'], ['ArtifactData', 'batch']] as const) {
    const refused = await guard.call(name, { action, url: 'open-artifact://artifact/art_release1' }, {}, next);
    assert.equal(refused.error?.code, 'newer_release');
    assert.match(refused.error!.message, /written by slides 2\.0\.0; this computer has slides 1\.5\.0/);
    assert.match(refused.error!.fix!, /open-artifact runtime update/);
  }
  assert.deepEqual(calls, []);
  const read = await guard.call('Artifact', { action: 'read', url: 'x' }, {}, next);
  assert.equal(read.read_only, true);
  assert.equal(read.notes?.length, 2);
  assert.match(read.notes![1]!, /^Read-only here/);
  // Comments are not the artifact's content.
  assert.equal((await guard.call('ArtifactComments', { action: 'list', url: 'x' }, {}, next)).read_only, undefined);

  // Updated: the write goes through, and nothing needs recording (same release).
  installed = '2.0.0';
  assert.equal((await guard.call('ArtifactData', { action: 'set', url: 'x' }, {}, next)).error, undefined);
  assert.deepEqual(released, []);
  // A newer type writes an older artifact: it records its release.
  installed = '2.1.0';
  await guard.call('Artifact', { action: 'publish', url: 'x' }, {}, next);
  assert.deepEqual(released, ['2.1.0']);
  // The folder marker counts too (a folder brought from a newer computer).
  current = record({ typeRelease: '1.0.0' });
  writeFileSync(join(current.root, '.artifact.json'), JSON.stringify({ type: 'slides', id: current.id, release: '3.0.0' }));
  assert.equal(writtenRelease(current), '3.0.0');
  assert.equal(isNewerRelease('3.0.0', '2.1.0'), true);
  assert.equal(isNewerRelease(null, '2.1.0'), false);
  assert.equal(isNewerRelease('3.0.0', null), false);
});

let daemon: Daemon;
before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
});
after(() => daemon.close());

test('the daemon\'s tools go through the guard', async (t) => {
  const type = daemon.types.list().find((candidate) => candidate.enabled && candidate.version);
  if (!type) return t.skip('no installed type with a version here');
  const root = tempDir('open-artifact-newer-');
  const made = daemon.store.create({ root, type: type.id, typeSource: type.scope, typeRelease: '999.0.0', owner: null, title: 'From the future' });
  const url = `open-artifact://artifact/${made.id}`;
  const refused = await daemon.tools.call('ArtifactData', { action: 'set', url, collection: 'c', doc_id: 'd', data: { a: 1 } }, { harness: 'test' });
  assert.equal(refused.error?.code, 'newer_release');
  assert.equal(JSON.parse(readFileSync(join(root, '.artifact.json'), 'utf8')).release, '999.0.0');
  const read = await daemon.tools.call('Artifact', { action: 'read', url }, { harness: 'test' });
  if (!read.error) assert.equal(read.read_only, true);
});

test('the Library view, the Shell boot and the Type API say read_only and both versions', async (t) => {
  const type = daemon.types.list().find((candidate) => candidate.enabled && candidate.version);
  if (!type) return t.skip('no installed type with a version here');
  const root = tempDir('open-artifact-newer-view-');
  const made = daemon.store.create({ root, type: type.id, typeSource: type.scope, typeRelease: '999.0.0', owner: null, title: 'From the future' });
  const view = daemon.artifactView(made);
  assert.equal(view.read_only, true);
  assert.equal(view.type_release, '999.0.0');
  assert.equal(view.type_version, type.version);
  const state = JSON.parse(readFileSync(join(process.env.OPEN_ARTIFACT_HOME!, 'daemon.json'), 'utf8')) as { url: string };
  const answer = await fetch(`${state.url}/api/open-artifact.type.artifact?id=${made.id}`, { headers: { authorization: `Bearer ${daemon.typeToken(type.id)}` } });
  assert.equal(answer.status, 200);
  const said = (await answer.json()) as { read_only?: boolean; type_release?: string; type_version?: string };
  assert.deepEqual([said.read_only, said.type_release, said.type_version], [true, '999.0.0', type.version]);
  const boot = (await (await fetch(`${state.url}/api/open-artifact.artifacts.boot?id=${made.id}`)).json()) as { read_only?: boolean; type_release?: string };
  assert.equal(boot.read_only, true);
  assert.equal(boot.type_release, '999.0.0');

  // Written by this release (or none recorded): writable, nothing said.
  const same = daemon.store.create({ root: tempDir('open-artifact-same-'), type: type.id, typeSource: type.scope, owner: null, title: 'Today' });
  assert.equal(daemon.artifactView(same).read_only, false);
});
