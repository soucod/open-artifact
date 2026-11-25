import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIVE_SNAPSHOT_DOC_MAX_BYTES, type McpToolResult, type UnknownRecord } from '@open-artifact/data-core';
import { refreshDataSnapshot, type DataRefreshDeps } from '../src/data.ts';

/** An in-memory store and connector for one dashboard with two live queries and a file. */
function fixture(): { docs: Map<string, UnknownRecord>; answers: Map<string, McpToolResult | Error>; calls: string[]; deps: DataRefreshDeps; clock: { t: number } } {
  const docs = new Map<string, UnknownRecord>([
    ['dash/meta', { title: 'Sales' }],
    ['dash/params', { days: 7 }],
    ['datasets/sales', { title: 'Sales', source: { kind: 'call', connector: 'shop', tool: 'sales', args: { days: '{{days}}' } } }],
    ['datasets/signups', { title: 'Signups', source: { kind: 'call', connector: 'crm', tool: 'signups', args: {} } }],
    ['datasets/costs', { title: 'Costs', source: { kind: 'file', url: '/_blob/0123456789abcdef0123456789abcdef', name: 'c.csv', format: 'csv' } }],
  ]);
  const answers = new Map<string, McpToolResult | Error>();
  const calls: string[] = [];
  const clock = { t: Date.parse('2026-03-01T10:00:00Z') };
  const deps: DataRefreshDeps = {
    get: (path) => structuredClone(docs.get(path) ?? null),
    list: (collection) =>
      [...docs]
        .filter(([path]) => path.startsWith(`${collection}/`) && path.slice(collection.length + 1).split('/').length === 1)
        .map(([path, data]) => ({ path, data: structuredClone(data) })),
    write: (writes) => {
      for (const write of writes) if (write.op === 'delete') docs.delete(write.path);
      else docs.set(write.path, structuredClone(write.data));
    },
    call: async (connector, tool, args) => {
      calls.push(`${connector}.${tool} ${JSON.stringify(args)}`);
      const answer = answers.get(tool) ?? { content: [{ type: 'text', text: '[]' }] };
      if (answer instanceof Error) throw answer;
      return structuredClone(answer);
    },
    now: () => new Date(clock.t),
  };
  return { docs, answers, calls, deps, clock };
}

const rows = (value: unknown): McpToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

test('refresh: runs every live query at the stored filters and saves each answer as its own document', async () => {
  const { docs, answers, calls, deps } = fixture();
  answers.set('sales', { ...rows([{ n: 1 }]), cache: { storedAt: 5 } });
  answers.set('signups', rows([{ n: 2 }]));
  const result = await refreshDataSnapshot(deps, { owner: 'Ada' });
  assert.deepEqual(result.refreshed, ['sales', 'signups']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(calls, ['shop.sales {"days":7}', 'crm.signups {}']);
  const sales = docs.get('data/live/answers/sales') as UnknownRecord;
  assert.equal(sales.at, '2026-03-01T10:00:00.000Z');
  assert.equal(sales.connector, 'shop');
  // A cache marker is the connector client's, not the answer's.
  assert.deepEqual((sales.calls as UnknownRecord[])[0], { tool: 'sales', args: { days: 7 }, result: rows([{ n: 1 }]) });
  assert.deepEqual(docs.get('data/live'), { at: '2026-03-01T10:00:00.000Z', owner: 'Ada', queries: ['sales', 'signups'] });
  assert.equal(docs.has('data/live/answers/costs'), false);
});

test('refresh: asked for some queries, runs only those', async () => {
  const { calls, deps } = fixture();
  const result = await refreshDataSnapshot(deps, { owner: 'Ada', queries: ['signups', 'costs'] });
  assert.deepEqual(result.refreshed, ['signups']);
  assert.deepEqual(result.skipped, ['costs']);
  assert.deepEqual(calls, ['crm.signups {}']);
});

test('refresh: a failure keeps the last rows and records why; the next success clears it', async () => {
  const { docs, answers, deps, clock } = fixture();
  answers.set('sales', rows([{ n: 1 }]));
  await refreshDataSnapshot(deps, { owner: 'Ada' });
  const before = structuredClone(docs.get('data/live/answers/sales'));

  clock.t += 60_000;
  answers.set('sales', new Error('connection refused'));
  answers.set('signups', { isError: true, content: [{ type: 'text', text: 'token expired' }] });
  const failed = await refreshDataSnapshot(deps, { owner: 'Ada' });
  assert.deepEqual(failed.refreshed, []);
  assert.deepEqual(
    failed.failed.map((item) => item.id),
    ['sales', 'signups'],
  );
  const kept = docs.get('data/live/answers/sales') as UnknownRecord;
  assert.deepEqual(kept.calls, (before as UnknownRecord).calls);
  assert.equal(kept.at, (before as UnknownRecord).at);
  assert.match(String((kept.failed as UnknownRecord).reason), /connection refused/);
  const status = docs.get('data/live') as UnknownRecord;
  assert.equal(status.at, '2026-03-01T10:00:00.000Z', 'the time stays that of the rows shown');
  assert.match(String((status.failed as UnknownRecord).reason), /connection refused.*token expired/);

  clock.t += 60_000;
  answers.set('sales', rows([{ n: 3 }]));
  answers.set('signups', rows([]));
  await refreshDataSnapshot(deps, { owner: 'Ada' });
  assert.equal((docs.get('data/live') as UnknownRecord).failed, undefined);
  assert.equal((docs.get('data/live') as UnknownRecord).at, '2026-03-01T10:02:00.000Z');
  assert.equal((docs.get('data/live/answers/sales') as UnknownRecord).failed, undefined);
});

test('refresh: an answer over 256 KB fails by name and is never cut', async () => {
  const { docs, answers, deps } = fixture();
  answers.set('sales', rows('x'.repeat(LIVE_SNAPSHOT_DOC_MAX_BYTES)));
  const result = await refreshDataSnapshot(deps, { owner: 'Ada' });
  assert.deepEqual(result.refreshed, ['signups']);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0]!.reason, /query "sales" is \d+ KB, over the 256 KB/);
  const sales = docs.get('data/live/answers/sales') as UnknownRecord;
  assert.deepEqual(sales.calls, []);
});

test('refresh: an opted-out or removed query leaves the snapshot; clear removes it all', async () => {
  const { docs, deps } = fixture();
  await refreshDataSnapshot(deps, { owner: 'Ada' });
  assert.ok(docs.has('data/live/answers/signups'));
  docs.set('datasets/signups', { title: 'Signups', snapshot: false, source: { kind: 'call', connector: 'crm', tool: 'signups', args: {} } });
  await refreshDataSnapshot(deps, { owner: 'Ada' });
  assert.equal(docs.has('data/live/answers/signups'), false);
  assert.deepEqual((docs.get('data/live') as UnknownRecord).queries, ['sales']);

  const cleared = await refreshDataSnapshot(deps, { clear: true });
  assert.equal(cleared.cleared, true);
  assert.deepEqual(
    [...docs.keys()].filter((path) => path.startsWith('data/')),
    [],
  );
});
