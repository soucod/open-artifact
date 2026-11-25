/**
 * A wake the harness drafted reaches the page as `delivered` plus `drafted: true`: a page that knows the field says
 * the message is in the conversation for the person to send; one that does not still shows `delivered`.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TypeApiWakeResult } from '@open-artifact/protocol';
import { normalizeRequest, sendToAgent } from '../src/agent.ts';

function daemonAnswering(answer: TypeApiWakeResult): Parameters<typeof sendToAgent>[0]['daemon'] {
  return { wake: async () => answer } as unknown as Parameters<typeof sendToAgent>[0]['daemon'];
}

test('sendToAgent passes drafted on, and only with delivered', async () => {
  const root = mkdtempSync(join(tmpdir(), 'open-artifact-drafted-'));
  const request = () => normalizeRequest({ text: 'Warmer', title: 'Colors' }, 'send');
  const send = (answer: TypeApiWakeResult) => sendToAgent({ root, artifactId: 'art_d', request: request(), daemon: daemonAnswering(answer) });
  assert.deepEqual(await send({ status: 'delivered', via: 'live', drafted: true }), { status: 'delivered', drafted: true });
  assert.deepEqual(await send({ status: 'delivered', via: 'live' }), { status: 'delivered' });
  assert.deepEqual(await send({ status: 'resumed', via: 'live' }), { status: 'delivered' });
  assert.deepEqual(await send({ status: 'inbox', via: 'inbox' }), { status: 'queued' });
});
