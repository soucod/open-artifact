import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DbCapability, DbChangeEvent } from '@open-artifact/runtime';
import type { McpToolResult, UnknownRecord } from '@open-artifact/data-core';
import {
  askSnapshotRefresh,
  createLiveSnapshotSource,
  snapshotFailure,
  snapshotLine,
  useLiveSnapshot,
  withLiveSnapshot,
} from '../src/data/live-snapshot.ts';
import type { McpToolClient } from '../src/data/mcp.ts';

const rows = (value: unknown): McpToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

/** A store holding a snapshot, whose changes the test sends. */
function store(docs: Record<string, UnknownRecord>): { db: DbCapability; change(event: DbChangeEvent): void } {
  const listeners = new Set<(event: DbChangeEvent) => void>();
  const db = {
    get: async (path: string) => docs[path] ?? null,
    list: async (collection: string) =>
      Object.entries(docs)
        .filter(([path]) => path.startsWith(`${collection}/`))
        .map(([path, data]) => ({ path, data })),
    onChange: (listener: (event: DbChangeEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as DbCapability;
  return { db, change: (event) => listeners.forEach((listener) => listener(event)) };
}

const offline: McpToolClient = {
  call: async () => {
    throw new Error('not available in this view');
  },
  watch: () => () => undefined,
  listServers: async () => null,
  listTools: async () => [],
} as unknown as McpToolClient;

test('snapshot: a page without connectors answers the recorded call, marked with when it was taken', async () => {
  const at = '2026-03-01T10:00:00.000Z';
  const { db, change } = store({
    'data/live': { at, owner: 'Ada' },
    'data/live/answers/sales': { at, connector: 'shop', calls: [{ tool: 'sales', args: { days: 7 }, result: rows([{ n: 1 }]) }] },
  });
  const source = createLiveSnapshotSource(() => db);
  const client = withLiveSnapshot(offline, () => false, source);

  const answer = await client.call('shop', 'sales', { days: 7 });
  assert.deepEqual(answer.content, rows([{ n: 1 }]).content);
  assert.equal(answer.cache?.storedAt, Date.parse(at));
  assert.equal(useLiveSnapshot.getState().inUse, true);
  assert.equal(useLiveSnapshot.getState().status?.owner, 'Ada');
  // Another filter value was not recorded: it stays "not available".
  await assert.rejects(client.call('shop', 'sales', { days: 30 }), /not available/);

  // New answers pushed: the page hears them and the next call has them.
  let heard = 0;
  source.subscribe(() => heard++);
  const later = '2026-03-01T11:00:00.000Z';
  change({
    changes: {
      'data/live/answers/sales': { at: later, connector: 'shop', calls: [{ tool: 'sales', args: { days: 7 }, result: rows([{ n: 2 }]) }] },
      'data/live': { at: later, owner: 'Ada' },
    } as unknown as DbChangeEvent['changes'],
  });
  await Promise.resolve();
  assert.equal(heard, 1);
  assert.deepEqual((await client.call('shop', 'sales', { days: 7 })).content, rows([{ n: 2 }]).content);
  source.dispose();
});

test('snapshot: with connectors the page calls them as before', async () => {
  const { db } = store({ 'data/live/answers/sales': { at: 't', connector: 'shop', calls: [{ tool: 'sales', args: {}, result: rows([1]) }] } });
  const live: McpToolClient = { ...offline, call: async () => rows(['live']) };
  const client = withLiveSnapshot(live, () => true, createLiveSnapshotSource(() => db));
  assert.deepEqual((await client.call('shop', 'sales', {})).content, rows(['live']).content);
});

test('snapshot: the words, and a refresh asked from the page waits for the new status', async () => {
  const status = { at: '2026-03-01T10:00:00.000Z', owner: 'Ada', failed: { at: 't', reason: 'token expired' } };
  assert.match(snapshotLine(status, false) ?? '', /^Data as of .+, from Ada’s computer$/);
  assert.match(snapshotLine(status, true) ?? '', /^数据截至 .+，来自 Ada 的电脑$/);
  assert.equal(snapshotFailure(status, false), 'couldn’t refresh: token expired');
  assert.equal(snapshotLine({ at: null, owner: '' }, false), null);

  const sent: Array<{ url: string; body: string }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body) });
    return new Response(JSON.stringify({ queued: true, online: false }), { status: 202 });
  }) as unknown as typeof fetch;
  (globalThis as { location?: { href: string } }).location = { href: 'https://host.test/a/art_1/' };
  await askSnapshotRefresh(['sales'], fetcher);
  assert.deepEqual(sent, [{ url: 'https://host.test/a/art_1/_api/data/refresh', body: '{"queries":["sales"]}' }]);
  assert.deepEqual(useLiveSnapshot.getState().ask, { kind: 'waiting', online: false, at: useLiveSnapshot.getState().status?.at ?? null });

  const refused = (async () => new Response(JSON.stringify({ message: 'Only the owner can refresh.' }), { status: 403 })) as unknown as typeof fetch;
  await askSnapshotRefresh(undefined, refused);
  assert.deepEqual(useLiveSnapshot.getState().ask, { kind: 'failed', message: 'Only the owner can refresh.' });
});
