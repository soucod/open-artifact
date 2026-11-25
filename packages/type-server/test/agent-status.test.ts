import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TypeApi } from '@open-artifact/server-sdk';
import { ASKING_MAX_MS, agentStatus, clearAsking, isAsking, markAsking } from '../src/agent.ts';

test("agent status: the daemon's name for the agent, and whether an idle one is woken", async () => {
  const root = await mkdtemp(join(tmpdir(), 'oa-agent-status-'));
  let asked = 0;
  const daemon = {
    presence: async (id: string) => {
      asked++;
      return id === 'art_cursor'
        ? { presence: 'offline', canSend: true, canSendSession: true, busy: false, agentName: 'Cursor', wakesIdle: false }
        : { presence: 'offline', canSend: true, canSendSession: true, busy: false, agentName: 'Codex', wakesIdle: true };
    },
  } as unknown as TypeApi;
  assert.deepEqual(await agentStatus(root, daemon, false, 'art_cursor'), { available: true, busy: false, name: 'Cursor', wakesIdle: false });
  assert.deepEqual(await agentStatus(root, daemon, true, 'art_codex'), { available: true, busy: true, name: 'Codex' });
  await agentStatus(root, daemon, false, 'art_cursor');
  assert.equal(asked, 2, 'kept for a few seconds, not asked on every refresh');

  const failing = { presence: async () => Promise.reject(new Error('down')) } as unknown as TypeApi;
  assert.deepEqual(await agentStatus(root, failing, false, 'art_gone'), { available: true, busy: false, name: 'Agent' });
  assert.deepEqual(await agentStatus(root, null, false), { available: false, busy: false, name: 'Agent' });
});

test('agent status: an agent that asked waits on the person until it changes something, or for 30 minutes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oa-agent-asking-'));
  assert.deepEqual(await agentStatus(root, null, false), { available: false, busy: false, name: 'Agent' });
  await markAsking(root);
  const askedAt = Date.now();
  assert.deepEqual(await agentStatus(root, null, false, undefined, askedAt - 60_000), { available: true, busy: false, name: 'Agent', waitingForPerson: true });
  assert.equal(await isAsking(root, askedAt + 1_000), true, 'a write already on its way does not end it');
  assert.equal(await isAsking(root, askedAt + 10_000), false, 'a later change does');
  assert.equal(await isAsking(root, 0, askedAt + ASKING_MAX_MS + 1_000), false);
  clearAsking(root);
  assert.equal(await isAsking(root, 0), false);
});
