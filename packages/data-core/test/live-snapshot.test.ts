import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LIVE_SNAPSHOT_DOC_MAX_BYTES,
  canonicalJson,
  checkDataProject,
  findSnapshotCall,
  isLiveSnapshotPath,
  liveAnswerSizeProblem,
  liveSnapshotAnswerPath,
  parseLiveSnapshotAnswer,
  parseLiveSnapshotStatus,
  planLiveQueries,
  type LiveSnapshotAnswer,
  type UnknownRecord,
} from '../src/index.ts';

const documents = (extra: [string, UnknownRecord][] = []): Map<string, UnknownRecord> =>
  new Map<string, UnknownRecord>([
    ['dash/meta', { title: 'Sales' }],
    ['dash/params', { days: 30 }],
    ['datasets/sales', { title: 'Sales', source: { kind: 'call', connector: 'shop', tool: 'run', args: { days: '{{days}}', q: 'select 1' } } }],
    ['datasets/signups', { title: 'Signups', source: { kind: 'call', connector: 'crm', tool: 'signups', args: {} } }],
    ['datasets/costs', { title: 'Costs', source: { kind: 'file', url: '/_blob/0123456789abcdef0123456789abcdef', name: 'c.csv', format: 'csv' } }],
    ['files/index.html', { text: '<p>x</p>' }],
    ...extra,
  ]);

describe('live snapshot: which queries', () => {
  it('plans every live query, filled at the stored filters, in id order; files are not queries', () => {
    const plans = planLiveQueries(documents());
    assert.deepEqual(
      plans.map((plan) => plan.id),
      ['sales', 'signups'],
    );
    const sales = plans[0]!;
    assert.equal(sales.connector, 'shop');
    assert.equal(sales.tool, 'run');
    assert.equal(sales.args.q, 'select 1');
    assert.equal(String(sales.args.days), '30');
  });

  it('keeps only the asked queries, and leaves out a dataset with "snapshot": false', () => {
    assert.deepEqual(
      planLiveQueries(documents(), ['signups', 'nope']).map((plan) => plan.id),
      ['signups'],
    );
    const optedOut = documents([['datasets/signups', { title: 'Signups', snapshot: false, source: { kind: 'call', connector: 'crm', tool: 'signups', args: {} } }]]);
    assert.deepEqual(
      planLiveQueries(optedOut).map((plan) => plan.id),
      ['sales'],
    );
  });

  it('check accepts "snapshot": false and refuses any other value', () => {
    const files = (snapshot: unknown): Map<string, string> =>
      new Map([
        ['dash/meta', JSON.stringify({ title: 'S' })],
        ['datasets/a', JSON.stringify({ title: 'A', snapshot, source: { kind: 'call', connector: 'c', tool: 't', args: {} } })],
        ['files/index.html', JSON.stringify({ text: '<p data-dash-source="a"></p>' })],
      ]);
    const about = (snapshot: unknown): string[] =>
      checkDataProject(files(snapshot))
        .filter((finding) => /snapshot/.test(JSON.stringify(finding)))
        .map((finding) => JSON.stringify(finding));
    assert.deepEqual(about(false), []);
    assert.equal(about('no').length, 1);
  });
});

describe('live snapshot: documents', () => {
  it('names its paths', () => {
    assert.equal(liveSnapshotAnswerPath('sales'), 'data/live/answers/sales');
    assert.equal(isLiveSnapshotPath('data/live'), true);
    assert.equal(isLiveSnapshotPath('data/live/answers/sales'), true);
    assert.equal(isLiveSnapshotPath('data/users/me/x'), false);
  });

  it('reads status and answers, and drops what is not one', () => {
    assert.equal(parseLiveSnapshotStatus('x'), null);
    assert.deepEqual(parseLiveSnapshotStatus({ at: '2026-01-01T00:00:00Z', owner: 'Ada', failed: { at: 't', reason: 'down', queries: ['a', 1] } }), {
      at: '2026-01-01T00:00:00Z',
      owner: 'Ada',
      failed: { at: 't', reason: 'down', queries: ['a'] },
    });
    assert.equal(parseLiveSnapshotAnswer({ connector: 'c' }), null);
    const answer = parseLiveSnapshotAnswer({ at: 't', connector: 'c', calls: [{ tool: 'run', args: { a: 1 }, result: { content: [] } }, { bad: true }] });
    assert.equal(answer?.calls.length, 1);
  });

  it('finds the recorded answer of the same call, whatever the key order', () => {
    const answers: LiveSnapshotAnswer[] = [{ at: 't1', connector: 'shop', calls: [{ tool: 'run', args: { b: 2, a: { y: 1, x: 2 } }, result: { content: [{ type: 'text', text: '[1]' }] } }] }];
    assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}');
    const found = findSnapshotCall(answers, 'shop', 'run', { a: { x: 2, y: 1 }, b: 2 });
    assert.equal(found?.at, 't1');
    assert.equal(findSnapshotCall(answers, 'shop', 'run', { a: { x: 2, y: 1 }, b: 3 }), null);
    assert.equal(findSnapshotCall(answers, 'other', 'run', { a: { x: 2, y: 1 }, b: 2 }), null);
  });

  it('refuses an answer over a document, naming the query, and never cuts it', () => {
    const small: LiveSnapshotAnswer = { at: 't', connector: 'c', calls: [{ tool: 't', args: {}, result: { content: [{ type: 'text', text: 'x' }] } }] };
    assert.equal(liveAnswerSizeProblem('sales', small), null);
    const big: LiveSnapshotAnswer = { ...small, calls: [{ tool: 't', args: {}, result: { content: [{ type: 'text', text: 'x'.repeat(LIVE_SNAPSHOT_DOC_MAX_BYTES) }] } }] };
    const problem = liveAnswerSizeProblem('sales', big);
    assert.match(problem ?? '', /query "sales"/);
    assert.match(problem ?? '', /256 KB/);
    assert.match(problem ?? '', /nothing was cut/);
  });
});
