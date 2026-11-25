/**
 * A harness that drafts what it is sent (`caps.wake.mode: "draft"`), end to end through the daemon: a page's wake is
 * answered `delivered` with `drafted: true` (a page older than the field still shows a valid state), nothing waits in
 * the inbox, and the artifact's owner says `wakeMode: "draft"` so the Shell words its Send button for it.
 */

import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createHarness } from '@open-artifact/harness-kit';
import type { DaemonState, TypeApiWakeResult, WakeDeliverParams } from '@open-artifact/protocol';
import { readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { sessionKeyOf } from '../src/store.ts';

let daemon: Daemon;
let state: DaemonState;

before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => daemon.close());

test('a drafted wake: delivered with drafted: true, no inbox, and the owner says wakeMode draft', async () => {
  const delivered: WakeDeliverParams[] = [];
  const harness = await createHarness({
    harness: 'draft-app',
    home: TEST_HOME,
    autoStart: false,
    caps: { wake: { mode: 'draft' } },
    wake: (params) => (delivered.push(params), 'drafted'),
  });
  try {
    const workspace = tempDir('open-artifact-ws-');
    await harness.attach({ session: 'chat-1', workspace });
    const owner = { harness: 'draft-app', session: 'chat-1', workspace };
    const record = daemon.store.create({ root: join(workspace, 'card'), type: 'greeter', owner, title: 'Drafted card' });

    const response = await fetch(`${state.url}/api/open-artifact.type.wake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${daemon.typeToken('greeter')}` },
      body: JSON.stringify({ id: record.id, requests: [{ text: 'Warmer colors' }] }),
    });
    assert.equal(response.status, 200);
    const answer = (await response.json()) as TypeApiWakeResult;
    assert.deepEqual(answer, { status: 'delivered', via: 'live', drafted: true });
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]!.source?.reason, 'request');
    assert.equal(daemon.inbox.count(sessionKeyOf(owner)!), 0, 'drafted counts as delivered: nothing waits in the inbox');

    const view = await fetch(`${state.url}/api/open-artifact.artifact?id=${record.id}`, { headers: { Authorization: `Bearer ${state.token}` } });
    assert.equal(view.status, 200);
    const body = (await view.json()) as { owner?: { wakeMode?: string } } & { artifact?: { owner?: { wakeMode?: string } } };
    assert.equal((body.owner ?? body.artifact?.owner)?.wakeMode, 'draft');
  } finally {
    await harness.close();
  }
});
