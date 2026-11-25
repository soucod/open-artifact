import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_DATA_REFRESH_MINUTES, DEFAULT_SETTINGS, type ArtifactRecord, type DataRefreshResult, type OpenArtifactSettings } from '@open-artifact/protocol';
import { DataRefresher, liveQueryIds, refreshMinutes } from '../src/data-refresh.ts';
import { loadSettings, saveSettings } from '../src/settings.ts';
import { ArtifactStore } from '../src/store.ts';

const write = (root: string, path: string, value: unknown): void => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), JSON.stringify(value));
};

const REMOTE = { name: 'work', host: 'https://host.test', url: 'https://host.test/a/x', base: {}, syncedAt: null };

/** A dashboard with two live queries, a file and an opted-out query. */
function dashboard(store: ArtifactStore, fields: Partial<ArtifactRecord> = {}): ArtifactRecord {
  const root = join(tempDir('open-artifact-data-refresh-'), 'dash');
  const record = store.create({ root, type: 'data', title: 'Sales' });
  write(root, 'db/datasets/sales.json', { title: 'Sales', source: { kind: 'call', connector: 'shop', tool: 'sales', args: {} } });
  write(root, 'db/datasets/old.json', { title: 'Old', source: { kind: 'query', connector: 'shop', tool: 'sql', args: '{}' } });
  write(root, 'db/datasets/private.json', { title: 'Private', snapshot: false, source: { kind: 'call', connector: 'hr', tool: 'pay', args: {} } });
  write(root, 'db/datasets/costs.json', { title: 'Costs', source: { kind: 'file', url: '/_blob/x', name: 'c.csv' } });
  return store.update(record.id, fields);
}

interface Harness {
  store: ArtifactStore;
  refresher: DataRefresher;
  runs: Array<{ id: string; args: { owner?: string; queries?: string[]; clear?: boolean } }>;
  syncs: string[];
  clock: { t: number };
  settings: OpenArtifactSettings;
  fail: { next: string | null };
}

function harness(): Harness {
  const store = new ArtifactStore();
  const runs: Harness['runs'] = [];
  const syncs: string[] = [];
  const clock = { t: Date.parse('2026-03-01T10:00:00Z') };
  const settings: OpenArtifactSettings = structuredClone(DEFAULT_SETTINGS);
  const fail = { next: null as string | null };
  const refresher = new DataRefresher({
    store,
    settings: () => settings,
    run: async (record, args): Promise<DataRefreshResult> => {
      runs.push({ id: record.id, args });
      if (fail.next) {
        const reason = fail.next;
        fail.next = null;
        throw new Error(reason);
      }
      const at = new Date(clock.t).toISOString();
      if (args.clear) {
        rmSync(join(record.root, 'db', 'data'), { recursive: true, force: true });
        return { at, refreshed: [], failed: [], cleared: true };
      }
      write(record.root, 'db/data/live.json', { at, owner: args.owner ?? '' });
      return { at, refreshed: args.queries ?? liveQueryIds(record.root), failed: [] };
    },
    sync: async (id) => {
      syncs.push(id);
    },
    owner: () => 'Ada',
    log: () => undefined,
    now: () => clock.t,
  });
  return { store, refresher, runs, syncs, clock, settings, fail };
}

test('data refresh: the live queries of a folder are connector calls not kept local', () => {
  const store = new ArtifactStore();
  const record = dashboard(store);
  assert.deepEqual(liveQueryIds(record.root), ['old', 'sales']);
});

test('data refresh: only a published dashboard whose data the person confirmed', async () => {
  const { store, refresher, runs } = harness();
  const unpublished = dashboard(store, { dataPublish: true });
  const unconfirmed = dashboard(store, { remote: REMOTE });
  const design = store.create({ root: join(tempDir('open-artifact-data-refresh-'), 'd'), type: 'design', title: 'D' });
  store.update(design.id, { remote: REMOTE, dataPublish: true });
  const ready = dashboard(store, { remote: REMOTE, dataPublish: true });

  assert.equal(await refresher.refresh(unpublished.id), null, 'never an unpublished artifact');
  assert.equal(await refresher.refresh(unconfirmed.id), null, 'published without rows until confirmed');
  assert.equal(await refresher.refresh(design.id), null);
  assert.equal(runs.length, 0);

  const result = await refresher.refresh(ready.id, { queries: ['sales'] });
  assert.deepEqual(result?.refreshed, ['sales']);
  assert.deepEqual(runs, [{ id: ready.id, args: { owner: 'Ada', queries: ['sales'] } }]);
});

test('data refresh: confirming refreshes and pushes; taking it back removes the snapshot', async () => {
  const { store, refresher, runs, syncs } = harness();
  const record = dashboard(store, { remote: REMOTE });
  assert.equal(refresher.status(record.id).publish, false);

  const confirmed = await refresher.confirm(record.id, true);
  assert.equal(confirmed.dataPublish, true, 'kept in the daemon record of the artifact');
  assert.equal(store.get(record.id)?.dataPublish, true);
  assert.equal(runs.length, 1);
  assert.deepEqual(syncs, [record.id]);
  const status = refresher.status(record.id);
  assert.equal(status.live, true);
  assert.deepEqual(status.queries, ['old', 'sales']);
  assert.equal(status.at, '2026-03-01T10:00:00.000Z');

  await refresher.confirm(record.id, false);
  assert.equal(store.get(record.id)?.dataPublish, false);
  assert.deepEqual(runs[1]?.args, { clear: true });
  assert.equal(refresher.status(record.id).at, null);
});

test('data refresh: the timer follows cloud.dataRefresh, 0 is never', async () => {
  const { store, refresher, runs, clock, settings } = harness();
  assert.equal(refreshMinutes(settings), DEFAULT_DATA_REFRESH_MINUTES);
  assert.equal(DEFAULT_DATA_REFRESH_MINUTES, 360);
  const record = dashboard(store, { remote: REMOTE, dataPublish: true });
  // Records other tests made live in the same home: look only at this one.
  const mine = (ids: string[]): string[] => ids.filter((id) => id === record.id);
  dashboard(store, { remote: REMOTE });

  assert.deepEqual(mine(await refresher.tick()), [record.id], 'never refreshed: due at once');
  assert.deepEqual(mine(await refresher.tick()), []);
  clock.t += (DEFAULT_DATA_REFRESH_MINUTES - 1) * 60_000;
  assert.deepEqual(mine(await refresher.tick()), []);
  clock.t += 2 * 60_000;
  assert.deepEqual(mine(await refresher.tick()), [record.id]);

  settings.cloud = { dataRefresh: 15 };
  clock.t += 16 * 60_000;
  assert.deepEqual(mine(await refresher.tick()), [record.id]);
  settings.cloud = { dataRefresh: 0 };
  clock.t += 24 * 60 * 60_000;
  assert.deepEqual(mine(await refresher.tick()), []);
  assert.equal(runs.filter((run) => run.id === record.id).length, 3);
});

test('data refresh: a failure keeps what was pushed and says why; asked twice while running, runs once more', async () => {
  const { store, refresher, runs, syncs, fail } = harness();
  const record = dashboard(store, { remote: REMOTE, dataPublish: true });
  fail.next = 'the type server is down';
  assert.equal(await refresher.refresh(record.id), null);
  assert.equal(refresher.status(record.id).lastError, 'the type server is down');
  assert.deepEqual(syncs, []);

  const first = refresher.refresh(record.id);
  void refresher.refresh(record.id, { queries: ['sales'] });
  await first;
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(
    runs.map((run) => run.args.queries ?? 'all'),
    ['all', 'all', ['sales']],
  );
  assert.equal(refresher.status(record.id).lastError, null);
});

test('settings: cloud.dataRefresh is kept when it is a number of minutes', () => {
  saveSettings({ cloud: { dataRefresh: 30 } });
  assert.equal(loadSettings().cloud?.dataRefresh, 30);
  saveSettings({ cloud: { dataRefresh: -1 } as never });
  assert.equal(loadSettings().cloud?.dataRefresh, undefined);
});
