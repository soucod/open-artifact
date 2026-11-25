/**
 * The artifact's owner carries its harness's display name (`harnessTitle`) for the Shell's Ask pane: from a shipped
 * profile, or from the profile a kit app reports in `hello`; left out when the profile has no title of its own, so the
 * Shell shows the harness id as it is.
 */

import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createHarness } from '@open-artifact/harness-kit';
import type { ArtifactView, DaemonState } from '@open-artifact/protocol';
import { readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';

let daemon: Daemon;
let state: DaemonState;

before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => daemon.close());

async function ownerOf(harness: string): Promise<ArtifactView['owner']> {
  const workspace = tempDir('open-artifact-ws-');
  const record = daemon.store.create({ root: join(workspace, 'card'), type: 'greeter', owner: { harness, session: 's1', workspace }, title: 'Card' });
  const view = await fetch(`${state.url}/api/open-artifact.artifact?id=${record.id}`, { headers: { Authorization: `Bearer ${state.token}` } });
  assert.equal(view.status, 200);
  const body = (await view.json()) as { owner?: ArtifactView['owner'] } & { artifact?: { owner?: ArtifactView['owner'] } };
  return body.owner ?? body.artifact?.owner ?? null;
}

test('owner.harnessTitle: a shipped profile’s title', async () => {
  assert.equal((await ownerOf('claude-code'))?.harnessTitle, 'Claude Code');
});

test('owner.harnessTitle: the title a kit app reports in hello', async () => {
  const harness = await createHarness({ harness: 'titled-app', home: TEST_HOME, autoStart: false, profile: { title: 'Titled App' } });
  try {
    await harness.attach({ session: 's1', workspace: tempDir('open-artifact-ws-') });
    const owner = await ownerOf('titled-app');
    assert.equal(owner?.harness, 'titled-app');
    assert.equal(owner?.harnessTitle, 'Titled App');
  } finally {
    await harness.close();
  }
});

test('owner.harnessTitle: left out when the profile has no title of its own', async () => {
  const owner = await ownerOf('untitled-app');
  assert.equal(owner?.harness, 'untitled-app');
  assert.equal('harnessTitle' in (owner ?? {}), false);
});
